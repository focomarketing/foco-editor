// Teste ponta a ponta do "Editar vídeo inteiro": projeto cristão pela fala, briefing + roteiro,
// um clique, e as 6 etapas em sequência (corte, imagens, transições, motion, trilha e efeitos,
// legendas). Usa a IA configurada (a conta Claude, se o Claude Code estiver logado).
// Uso: FULL_VIDEO="C:/fala.mp4" [FULL_REF="C:/roteiro.txt"] [E2E_SHOTS=pasta] node scripts/e2e-full.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const video = process.env.FULL_VIDEO;
if (!video) {
  console.error('Defina FULL_VIDEO (vídeo com fala).');
  process.exit(2);
}
const reference = process.env.FULL_REF ? fs.readFileSync(process.env.FULL_REF, 'utf8') : '';
const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const profile = path.join(os.tmpdir(), 'foco-e2e-full');
fs.rmSync(profile, { recursive: true, force: true });
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
process.env.FOCO_PROJECTS_DIR ??= path.join(os.tmpdir(), 'foco-e2e-projetos');
const server = await createServer({ server: { port: 5201, strictPort: true }, logLevel: 'error' });
await server.listen();
const context = await chromium.launchPersistentContext(profile, { channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge', headless: !process.env.E2E_HEADED, viewport: { width: 1500, height: 900 } });

try {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5201/');
  await page.waitForFunction(() => window.__foco);
  // o vínculo com a conta Claude acontece sozinho ao abrir
  await page.waitForTimeout(2000);
  const provider = await page.evaluate(() => window.__foco.ai.aiStore?.get?.().settings.provider ?? JSON.parse(localStorage.getItem('foco.ai.settings') || '{}').provider);
  console.log(`IA: ${provider}`);
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'file';
    i.id = '__full_file';
    i.style.display = 'none';
    document.body.appendChild(i);
  });
  await page.setInputFiles('#__full_file', [video]);
  await page.evaluate(async () => {
    const files = [...document.getElementById('__full_file').files].map((file) => ({ file }));
    await window.__foco.workflow.createGuidedProject({ name: 'Teste completo', track: 'youtube', subtype: 'cristao', mode: 'audio-led' }, files);
  });
  // a etapa de corte começa sozinha (transcreve); espera ela acabar antes do comando único
  await page.waitForFunction(() => window.__foco.phases.phaseRunStore.get()?.phase === 'cut', null, { timeout: 60_000 });
  await page.waitForFunction(() => !window.__foco.phases.phaseRunStore.get()?.running, null, { timeout: 20 * 60_000, polling: 1000 });
  await page.evaluate((ref) => window.__foco.workflow.setBriefing('Canal cristão moderno com uma narrativa diferente do normal. Prender a atenção, imagens coerentes com cada bloco, motion elegante.', ref, 'emocional', 'auto'), reference);
  console.log('Editar vídeo inteiro…');
  const t0 = Date.now();
  await page.locator('[data-testid="run-all"]').click();
  let lastStep = '';
  for (;;) {
    const s = await page.evaluate(() => ({ wf: window.__foco.workflow.currentWorkflow()?.current, run: window.__foco.phases.phaseRunStore.get(), all: window.__foco.phases.runningAll() }));
    if (s.run?.step && s.run.step !== lastStep) {
      lastStep = s.run.step;
      console.log(`    ${((Date.now() - t0) / 1000).toFixed(0)}s · ${lastStep}`);
    }
    if (!s.all && !s.run?.running) break;
    if (Date.now() - t0 > 40 * 60_000) throw new Error('demorou demais');
    await page.waitForTimeout(1500);
  }
  console.log(`    etapas em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  // revisão final do Diretor (pela conta Claude): espera entregar
  await page.waitForFunction(() => window.__foco.director.directorStore.get().status !== 'idle', null, { timeout: 15_000 }).catch(() => {});
  const review = await page.evaluate(() => window.__foco.director.directorStore.get().status);
  if (review !== 'idle') {
    console.log('Revisão do Diretor…');
    let n = 0;
    for (;;) {
      const d = await page.evaluate(() => {
        const s = window.__foco.director.directorStore.get();
        return { status: s.status, turns: s.turns, stopped: s.stopped, message: s.message, last: s.log.at(-1)?.text?.slice(0, 120), finished: s.finished };
      });
      if (d.turns !== n) {
        n = d.turns;
        console.log(`    passo ${n} · ${d.last ?? ''}`);
      }
      if (d.status !== 'running') {
        console.log(`    Diretor: ${d.stopped} ${d.message ?? ''}`);
        if (d.finished) console.log(`    entregou: ${d.finished.summary}`, ...(d.finished.changes ?? []).map((c) => `\n      - ${c}`));
        check(d.stopped === 'finished', 'Diretor revisou e entregou pela conta Claude', d.stopped);
        break;
      }
      if (Date.now() - t0 > 60 * 60_000) throw new Error('revisão demorou demais');
      await page.waitForTimeout(3000);
    }
  }
  const r = await page.evaluate(() => {
    const p = window.__foco.store.getState().project;
    const by = (name) => {
      const t = p.tracks.find((x) => x.name === name);
      return t ? Object.values(p.clips).filter((c) => c.trackId === t.id) : [];
    };
    const ops = (p.metadata.operations ?? []).map((o) => ({ stage: o.stage, status: o.status, n: o.commands.length, notes: (o.notes ?? []).join(' '), warnings: (o.warnings ?? []).join(' ') }));
    return {
      wf: window.__foco.workflow.currentWorkflow()?.current,
      error: window.__foco.phases.phaseRunStore.get()?.error,
      music: by('Música').map((c) => ({ start: c.start, dur: c.duration, vol: c.volume, name: p.assets[c.assetId]?.name })),
      sfx: by('Efeitos sonoros').map((c) => ({ start: c.start, name: p.assets[c.assetId]?.name })),
      captions: by('Legendas').filter((c) => c.caption).map((c) => c.caption.words.map((w) => w.text).join(' ')),
      captionFont: by('Legendas')[0]?.caption?.style?.fontFamily,
      titles: by('Gráficos').filter((c) => c.title).map((c) => `${c.start.toFixed(1)} ${c.title.template} "${c.title.text}" y=${c.title.y}`),
      broll: by('B-roll').map((c) => `${c.start.toFixed(1)} ${p.assets[c.assetId]?.name}`),
      ops,
      sidebar: localStorage.getItem('foco.sidebar'),
      ctas: by('Chamadas').map((c) => `${c.start.toFixed(1)} ${c.element?.name}`),
      color: Object.values(p.clips).filter((c) => c.color?.preset === 'colorista').map((c) => JSON.stringify(Object.fromEntries(Object.entries(c.color).filter(([k, v]) => typeof v === 'number' && v !== 0)))),
    };
  });
  for (const o of r.ops) console.log(`    [${o.stage}] ${o.status} · ${o.n} · ${o.notes} ${o.warnings}`);
  console.log(`    títulos: ${r.titles.join(' | ')}`);
  console.log(`    imagens: ${r.broll.join(' | ')}`);
  console.log(`    trilha: ${r.music.map((m) => `${m.start.toFixed(1)}+${m.dur.toFixed(1)}s ${m.name} vol ${m.vol}`).join(' | ')}`);
  console.log(`    efeitos: ${r.sfx.map((s) => `${s.start.toFixed(1)} ${s.name}`).join(' | ')}`);
  console.log(`    chamadas: ${r.ctas.join(' | ')}`);
  console.log(`    cor: ${r.color.join(' | ') || 'sem correção'}`);
  console.log(`    legendas (${r.captions.length}, ${r.captionFont}): ${r.captions.slice(0, 6).join(' / ')}`);
  check(!r.error, 'nenhuma etapa falhou', r.error ?? '');
  check(r.wf === 'editor', 'terminou na timeline (Editor)', r.wf);
  check(r.sidebar === 'director', 'abre o painel do Diretor com o campo de ajustes', r.sidebar);
  check(r.music.length > 0 && r.music.every((m) => m.vol <= 0.2), 'trilha na faixa Música, baixa sob a voz', r.music.length);
  check(r.captions.length > 0, 'legendas na faixa Legendas', r.captions.length);
  check(r.titles.length > 0, 'títulos do motion na faixa Gráficos', r.titles.length);
  check(r.ctas.some((c) => /Inscreva/.test(c)), 'botão de inscrição na tela na palavra "inscreve"', r.ctas.join(', '));
  check(r.sfx.some((s) => /pop/.test(s.name)), 'som de pop na chamada');
  check(await page.locator('[data-testid="adjust-first"]').isVisible(), 'campo "Pedir ajuste na edição" visível');
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    const times = [5, ...r.titles.map((t) => Number(t.split(' ')[0]) + 1.2).slice(0, 3)];
    for (const [i, tt] of times.entries()) {
      await page.evaluate(async (x) => {
        window.__foco.playback.seek(x);
        await window.__foco.measureSeek(x);
      }, tt);
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(shots, `full-${i + 1}-${tt.toFixed(0)}s.png`) });
    }
  }
  // vídeo final para assistir: aplica a revisão do Diretor e exporta em 720p
  if (process.env.FULL_EXPORT) {
    await page.evaluate(() => window.__foco.director.directorStore.get().hasDraft && window.__foco.director.applyDirector());
    console.log('Exportando…');
    const info = await page.evaluate(() => window.__foco.exportAndProbe({ width: 1280, height: 720, fps: 30, bitrate: 650_000, codec: 'avc' }));
    const b64 = await page.evaluate(() => window.__foco.exportedBase64());
    fs.writeFileSync(process.env.FULL_EXPORT, Buffer.from(b64, 'base64'));
    console.log(`    ${process.env.FULL_EXPORT} · ${(info.bytes / 1e6).toFixed(1)} MB · ${info.duration.toFixed(1)} s`);
    check(info.duration > 10 && info.audioDuration > 10, 'vídeo exportado com imagem e som', `${info.duration.toFixed(1)} s`);
  }
  check(errors.length === 0, 'sem erros de página', errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await context.close();
  await server.close();
}
console.log(failures ? `\n${failures} falha(s)` : '\nedição completa ok');
process.exit(failures ? 1 : 0);
