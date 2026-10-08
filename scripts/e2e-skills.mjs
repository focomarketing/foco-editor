// Teste ponta a ponta das skills de montagem e motion: projeto "pela fala" com o vídeo principal
// e takes de apoio. Corte → Imagens (edit-interview-with-broll: takes por cima da fala, mudos)
// → Efeitos e motion (motion-graphics-designer: títulos + zoom). Sem erros de página.
// Uso: SKILLS_VIDEO="C:/fala.mp4" SKILLS_TAKES="C:/takes" node scripts/e2e-skills.mjs
//      (E2E_SHOTS=pasta para capturas · usa o Ollama local se estiver no ar)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const video = process.env.SKILLS_VIDEO;
const takesDir = process.env.SKILLS_TAKES;
if (!video || !takesDir) {
  console.error('Defina SKILLS_VIDEO (vídeo com fala) e SKILLS_TAKES (pasta com takes .mp4).');
  process.exit(2);
}
const takes = fs.readdirSync(takesDir).filter((f) => /\.(mp4|mov|webm)$/i.test(f)).map((f) => path.join(takesDir, f));
const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const profile = path.join(os.tmpdir(), 'foco-e2e-skills');
fs.rmSync(profile, { recursive: true, force: true });
// mídia gravada pelo editor vai para uma pasta temporária, não para Documentos
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge',
  headless: !process.env.E2E_HEADED,
  viewport: { width: 1500, height: 900 },
});

const waitPhase = (page, phase, timeoutMs) =>
  page.waitForFunction((ph) => {
    const r = window.__foco.phases.phaseRunStore.get();
    return r && r.phase === ph && !r.running;
  }, phase, { timeout: timeoutMs, polling: 1000 });

const opInfo = (page) =>
  page.evaluate(() => {
    const f = window.__foco;
    const r = f.phases.phaseRunStore.get();
    const op = f.phases.currentOperation(r.opId);
    return { summary: r.summary, error: r.error, commands: op?.commands ?? [], selected: op?.selected ?? [], status: op?.status };
  });

try {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5199/');
  await page.waitForFunction(() => window.__foco);
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'file';
    i.multiple = true;
    i.id = '__sk_file';
    i.style.display = 'none';
    document.body.appendChild(i);
  });
  await page.setInputFiles('#__sk_file', [video, ...takes]);
  await page.evaluate(async () => {
    const files = [...document.getElementById('__sk_file').files].map((file) => ({ file }));
    await window.__foco.workflow.createGuidedProject({ name: 'Teste das skills', track: 'youtube', subtype: 'cristao', mode: 'audio-led' }, files);
  });

  const start = await page.evaluate(() => {
    const p = window.__foco.store.getState().project;
    return { assets: Object.keys(p.assets).length, clips: Object.keys(p.clips).length };
  });
  check(start.assets === takes.length + 1 && start.clips >= 1 && start.clips <= 2, 'pela fala: só o vídeo principal na timeline, takes na Mídia', `${start.assets} mídias · ${start.clips} clipe(s)`);

  console.log('Fase 1 · Corte');
  await page.locator('[data-testid="phase-run"]').waitFor();
  await waitPhase(page, 'cut', 15 * 60_000);
  const cut = await opInfo(page);
  console.log(`    ${cut.summary ?? cut.error}`);
  check(!cut.error, 'corte rodou', cut.error ?? '');

  console.log('Fase 2 · Imagens (takes de apoio + acervo nos vãos)');
  await page.locator('[data-testid="phase-done"]').click();
  await page.waitForFunction(() => window.__foco.phases.phaseRunStore.get()?.phase === 'images', null, { timeout: 30_000 });
  await waitPhase(page, 'images', 15 * 60_000);
  const img = await opInfo(page);
  console.log(`    ${img.summary ?? img.error}`);
  const takeCmds = img.commands.filter((c) => c.skill === 'edit-interview-with-broll');
  for (const c of img.commands) console.log(`      ${c.start?.toFixed(1)}–${c.end?.toFixed(1)}s · ${c.skill} · ${Math.round(c.confidence * 100)}% · ${c.payload.label} · ${c.reason?.slice(0, 70)}`);
  check(takeCmds.length > 0, 'takes do usuário sugeridos sobre a fala', takeCmds.length);
  check(new Set(takeCmds.map((c) => c.payload.assetId)).size === takeCmds.length, 'nenhum take repetido');
  const overlap = img.commands.some((a, i) => img.commands.some((b, j) => i < j && a.start < b.end && b.start < a.end));
  check(!overlap, 'acervo não disputa trecho com os takes');
  const appliedAll = !img.selected.length && img.commands.length > 0;
  if (appliedAll) await page.locator('[data-testid="apply-all"]').click(); // nada entrou sozinho: aprova tudo, como a pessoa faria
  const placed = await page.evaluate(() => {
    const f = window.__foco;
    const p = f.store.getState().project;
    const t = p.tracks.find((x) => x.name === 'B-roll');
    const clips = Object.values(p.clips).filter((c) => c.trackId === t?.id && p.assets[c.assetId]?.kind === 'video');
    return { n: clips.length, mute: clips.every((c) => c.volume === 0), speechAssets: [...new Set(f.smartCut.timelineSpeech(p).words.map((w) => w.assetId))].length };
  });
  // take com confiança baixa (ex.: só pelo nome do arquivo) fica para revisão, não entra sozinho
  const takesInReview = takeCmds.filter((c) => !img.selected.includes(c.id)).length;
  const takesAutoApplied = appliedAll ? takeCmds.length : takeCmds.length - takesInReview;
  check(placed.n === takesAutoApplied && placed.mute, 'takes de confiança alta no B-roll, mudos; os de baixa ficam para revisão', `${placed.n} aplicado(s) · ${takesInReview} para revisar`);
  check(takeCmds.every((c) => img.selected.includes(c.id) === c.confidence >= 0.6), 'aplicação automática respeita a confiança');
  check(placed.speechAssets === 1, 'a fala da timeline continua só a do vídeo principal', placed.speechAssets);
  if (shots) await page.screenshot({ path: path.join(shots, 'skills-1-imagens.png') });

  console.log('Fase 4 · Efeitos e motion');
  await page.locator('[data-testid="phase-done"]').click(); // → transições (automática)
  await page.waitForFunction(() => window.__foco.workflow.currentWorkflow()?.current === 'transitions', null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__foco.phases.phaseRunStore.get()?.phase === 'transitions', null, { timeout: 30_000 });
  // avança sem esperar a análise acabar: a fase seguinte tem de esperar e rodar mesmo assim
  await page.locator('[data-testid="phase-done"]').click(); // → motion (automática)
  await waitPhase(page, 'transitions', 15 * 60_000).catch(() => {});
  await page.waitForFunction(() => window.__foco.phases.phaseRunStore.get()?.phase === 'motion', null, { timeout: 30_000 });
  await waitPhase(page, 'motion', 15 * 60_000);
  const mo = await opInfo(page);
  console.log(`    ${mo.summary ?? mo.error}`);
  for (const c of mo.commands) console.log(`      ${c.start?.toFixed(1)}s · ${c.type} · ${Math.round(c.confidence * 100)}% · ${c.payload.title?.template ?? ''} "${c.payload.title?.text ?? c.payload.label}"`);
  check(!mo.error, 'motion rodou sozinho ao entrar na fase', mo.error ?? '');
  check(mo.commands.some((c) => c.payload.title), 'títulos/destaques sugeridos');
  if (mo.status === 'preview') await page.locator('[data-testid="apply-all"]').click();
  const gfx = await page.evaluate(() => {
    const p = window.__foco.store.getState().project;
    const t = p.tracks.find((x) => x.name === 'Gráficos');
    return Object.values(p.clips).filter((c) => c.trackId === t?.id && c.title).map((c) => ({ start: c.start, text: c.title.text }));
  });
  check(gfx.length > 0, 'títulos na faixa Gráficos', gfx.map((g) => `"${g.text}"`).join(', '));
  if (shots && gfx[0]) {
    await page.evaluate(async (tt) => {
      window.__foco.playback.seek(tt);
      await window.__foco.measureSeek(tt);
      await new Promise((r) => setTimeout(r, 800));
    }, gfx[0].start + 1.2);
    await page.locator('.viewer canvas').first().screenshot({ path: path.join(shots, 'skills-2-titulo.png') });
  }
  await page.locator('[data-testid="phase-undo"]').click();
  const after = await page.evaluate(() => {
    const p = window.__foco.store.getState().project;
    return Object.values(p.clips).filter((c) => c.origin?.skill === 'motion-graphics-designer').length;
  });
  check(after === 0, 'Desfazer etapa tira os títulos', after);
  check(errors.length === 0, 'sem erros de página', errors.join(' | ').slice(0, 300));
} finally {
  await context.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
