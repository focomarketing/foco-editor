// Teste end-to-end da Fase 2 com fala real: transcrição (Whisper local), detecção de
// pausas e erros, aplicação dos cortes, legendas e export.
// Uso: npm run test:e2e:ai   (gera a fala com a voz pt-BR do Windows na primeira vez)
// Opcional: E2E_HEADED=1, E2E_SHOTS=pasta, E2E_MODEL=onnx-community/whisper-small_timestamped
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const shots = process.env.E2E_SHOTS;
const model = process.env.E2E_MODEL ?? 'onnx-community/whisper-base_timestamped';
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const work = path.join(os.tmpdir(), 'foco-e2e');
fs.mkdirSync(work, { recursive: true });
const wav = path.join(work, 'fala-teste.wav');
if (!fs.existsSync(wav)) {
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'make-speech.ps1'), wav], { stdio: 'inherit' });
}

// mídia gravada pelo editor vai para uma pasta temporária, não para Documentos
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
const server = await createServer({ server: { port: 5197, strictPort: true }, logLevel: 'error' });
await server.listen();
// Perfil persistente: o modelo baixado fica no cache entre execuções.
const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge',
  headless: !process.env.E2E_HEADED,
  viewport: { width: 1600, height: 950 },
  args: ['--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'],
});

try {
  await context.addInitScript(() => {
    window.__autoDialog = (title) => (title.startsWith('Versão de recuperação') ? 'restore' : title === 'Criar proxy?' ? 'no' : undefined);
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('crash', () => console.log('    [crash] a aba do navegador travou'));
  page.on('worker', (w) => { if (process.env.E2E_DEBUG) { console.log('    [worker]', w.url()); w.on('close', () => console.log('    [worker fechado]')); } });
  context.on('close', () => console.log('    [contexto fechado]'));
  page.on('console', (m) => {
    if (process.env.E2E_DEBUG) console.log('    [browser]', m.type(), m.text().slice(0, 300));
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('framenavigated', (f) => process.env.E2E_DEBUG && console.log('    [nav]', f.url()));
  await page.goto('http://localhost:5197/');
  await page.waitForFunction(() => window.__foco);
  page.on('dialog', (d) => d.accept());
  await page.evaluate(() => window.__foco.actions.newProject());

  console.log('Importação de fala');
  const b64 = fs.readFileSync(wav).toString('base64');
  const asset = await page.evaluate(async (data) => {
    const f = window.__foco;
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'fala-teste.wav', { type: 'audio/wav', lastModified: 1 });
    await f.actions.importItems([{ file }]);
    const a = Object.values(f.store.getState().project.assets)[0];
    await f.media.whenLevels(a.id);
    f.actions.addAssetToTimeline(a.id);
    return a;
  }, b64);
  check(asset.kind === 'audio' && asset.duration > 15, 'WAV importado como áudio', asset.duration.toFixed(2));
  const dur0 = await page.evaluate(() => Math.max(...Object.values(window.__foco.store.getState().project.clips).map((c) => c.start + c.duration)));

  console.log('Pausas só pelo áudio');
  const silenceOnly = await page.evaluate(async (id) => {
    await window.__foco.actions.analyzeCuts(id, 'safe');
    return window.__foco.analysisStore.get().suggestions;
  }, asset.id);
  const longPauses = silenceOnly.filter((s) => s.kind === 'silence');
  check(longPauses.length >= 2, 'SEGURO encontrou as pausas longas (1,8 s e 2,2 s)', longPauses.map((s) => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(' '));

  console.log(`Transcrição local (${model.split('/')[1]})`);
  const t0 = Date.now();
  const tr = await page.evaluate(
    async ({ id, model }) => {
      const f = window.__foco;
      await f.actions.transcribe(id, model, 'portuguese');
      const t = f.transcripts.get(id);
      return t ? { words: t.words, text: t.words.map((w) => w.text).join(' '), device: t.device, seconds: t.seconds } : null;
    },
    { id: asset.id, model },
  );
  check(!!tr && tr.words.length > 20, 'transcrição com palavras e tempos', `${tr?.words.length} palavras · ${tr?.device} · ${tr?.seconds?.toFixed(1)} s de inferência, ${((Date.now() - t0) / 1000).toFixed(0)} s no total`);
  console.log(`    "${tr?.text}"`);
  check(/felicidade/i.test(tr?.text ?? ''), 'reconheceu "felicidade"');
  const ordered = tr?.words.every((w, i, a) => w.end >= w.start && (i === 0 || w.start >= a[i - 1].start - 0.05));
  check(!!ordered, 'tempos das palavras em ordem');
  const fel = tr?.words.find((w) => /felicidade/i.test(w.text));
  check(!!fel && fel.start > 3 && fel.start < 9, 'tempo da palavra coerente com o áudio', fel?.start.toFixed(2));

  console.log('Cortes com transcrição (equilibrado)');
  const sugg = await page.evaluate(async (id) => {
    await window.__foco.actions.analyzeCuts(id, 'balanced');
    return window.__foco.analysisStore.get().suggestions;
  }, asset.id);
  const kinds = [...new Set(sugg.map((s) => s.kind))];
  check(sugg.length >= 3, 'sugestões geradas', sugg.map((s) => `${s.kind}@${s.start.toFixed(1)}`).join(' '));
  check(kinds.includes('repeat') || kinds.includes('stutter'), 'detectou repetição/gagueira', kinds.join(','));
  // nenhuma sugestão pode cortar no meio de uma palavra
  const cutsWord = sugg.some((s) => s.kind === 'silence' && tr.words.some((w) => w.start < s.end - 0.01 && w.end > s.start + 0.01 && (w.start > s.start && w.end < s.end)));
  check(!cutsWord, 'pausas não engolem palavras inteiras');
  if (shots) {
    await page.locator('[data-testid="rail-ai"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, 'ai-review.png') });
  }

  const applied = await page.evaluate(() => {
    const f = window.__foco;
    const chosen = f.analysisStore.get().suggestions.reduce((acc, s) => acc + (s.end - s.start), 0);
    f.actions.applyCuts();
    const clips = Object.values(f.store.getState().project.clips);
    return { chosen, dur: Math.max(...clips.map((c) => c.start + c.duration)), clips: clips.length, summary: f.analysisStore.get().lastEdit };
  });
  check(Math.abs(dur0 - applied.dur - applied.chosen) < 0.05, 'timeline encurtou exatamente o total cortado', `${dur0.toFixed(2)} → ${applied.dur.toFixed(2)} s (−${applied.chosen.toFixed(2)})`);
  check(!!applied.summary && applied.summary.cuts > 0, 'resumo da edição registrado', JSON.stringify(applied.summary?.counts));
  await page.keyboard.press('Control+z');
  const undone = await page.evaluate(() => Math.max(...Object.values(window.__foco.store.getState().project.clips).map((c) => c.start + c.duration)));
  check(Math.abs(undone - dur0) < 0.001, 'Ctrl+Z desfaz todos os cortes de uma vez', undone.toFixed(2));
  await page.keyboard.press('Control+Shift+z');

  console.log('Legendas');
  const caps = await page.evaluate((id) => {
    const f = window.__foco;
    f.actions.generateCaptions(id, 'shorts');
    const p = f.store.getState().project;
    const c = Object.values(p.clips).filter((x) => x.caption);
    return { n: c.length, track: p.tracks.find((t) => t.name === 'Legendas')?.id, srt: f.toSRT(p), first: c.sort((a, b) => a.start - b.start)[0] };
  }, asset.id);
  check(caps.n >= 5 && !!caps.track, 'blocos de legenda criados numa trilha própria', caps.n);
  check(caps.first.caption.words.length <= 3, 'preset Shorts usa no máximo 3 palavras por bloco', caps.first.caption.words.map((w) => w.text).join(' '));
  check(/^1\n\d\d:\d\d:\d\d,\d{3} --> /.test(caps.srt), 'SRT válido', caps.srt.split('\n').slice(0, 3).join(' | '));

  // preview desenha a legenda (pixels brancos/amarelos sobre o fundo preto)
  const mid = caps.first.start + caps.first.duration / 2;
  await page.evaluate((t) => window.__foco.playback.seek(t), mid);
  await page.waitForTimeout(400);
  const lit = await page.evaluate(() => {
    const c = document.querySelector('.viewer canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 180) n++;
    return n;
  });
  check(lit > 500, 'legenda aparece no preview', `${lit} px claros`);
  if (shots) await page.screenshot({ path: path.join(shots, 'captions.png') });

  console.log('Export com legendas');
  const exp = await page.evaluate(() => window.__foco.exportAndProbe({ width: 1080, height: 1920, fps: 30, bitrate: 4_000_000, codec: 'avc' }));
  check(exp.width === 1080 && exp.height === 1920 && exp.audioCodec === 'aac', 'MP4 vertical com áudio', `${exp.width}x${exp.height} ${exp.videoCodec}/${exp.audioCodec}`);
  check(Math.abs(exp.duration - applied.dur) < 0.15, 'duração = timeline editada', `${exp.duration.toFixed(2)} s`);

  const relevant = errors.filter((e) => !/onnxruntime|WebGPU|powerPreference/i.test(e));
  check(relevant.length === 0, 'sem erros no console', relevant.join(' | ').slice(0, 300));
} finally {
  await context.close();
  await server.close();
}

console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
