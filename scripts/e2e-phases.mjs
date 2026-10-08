// Teste ponta a ponta das fases automáticas: cria um projeto guiado, a fase Corte roda sozinha,
// conclui, a fase Imagens roda sozinha (diretor de IA + acervos) e as imagens entram no vídeo.
// Uso: PHASES_VIDEO="C:/fala.mp4" [PHASES_SUBTYPE=cristao] node scripts/e2e-phases.mjs
//      (E2E_SHOTS=pasta para capturas · usa o Ollama local se estiver no ar)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const video = process.env.PHASES_VIDEO;
if (!video) {
  console.error('Defina PHASES_VIDEO com o caminho de um vídeo com fala.');
  process.exit(2);
}
const subtype = process.env.PHASES_SUBTYPE || 'cristao';
const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const profile = path.join(os.tmpdir(), 'foco-e2e-phases');
fs.rmSync(profile, { recursive: true, force: true });
const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge',
  headless: !process.env.E2E_HEADED,
  viewport: { width: 1500, height: 900 },
  args: ['--enable-unsafe-webgpu'],
});

const waitPhase = (page, phase, timeoutMs) =>
  page.waitForFunction((ph) => {
    const r = window.__foco.phases.phaseRunStore.get();
    return r && r.phase === ph && !r.running;
  }, phase, { timeout: timeoutMs, polling: 1000 });

try {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5198/');
  await page.waitForFunction(() => window.__foco);

  await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'file';
    i.id = '__ph_file';
    i.style.display = 'none';
    document.body.appendChild(i);
  });
  await page.setInputFiles('#__ph_file', video);
  await page.evaluate(async (sub) => {
    await window.__foco.workflow.createGuidedProject({ name: 'Teste das fases', track: 'youtube', subtype: sub }, [{ file: document.getElementById('__ph_file').files[0] }]);
  }, subtype);

  console.log('Fase 1 · Corte (automática)');
  let t0 = Date.now();
  await page.locator('[data-testid="phase-run"]').waitFor();
  await waitPhase(page, 'cut', 15 * 60_000);
  const cut = await page.evaluate(() => window.__foco.phases.phaseRunStore.get());
  console.log(`    ${cut.summary ?? cut.error} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  check(!cut.error, 'corte rodou sozinho ao entrar na fase', cut.error ?? '');
  if (shots) await page.screenshot({ path: path.join(shots, 'phases-1-corte.png') });

  console.log('Fase 2 · Imagens (automática ao concluir o corte)');
  await page.locator('[data-testid="phase-done"]').click();
  t0 = Date.now();
  await page.waitForFunction(() => window.__foco.phases.phaseRunStore.get()?.phase === 'images', null, { timeout: 30_000 });
  // progresso visível durante a execução
  const midStep = await page.evaluate(() => window.__foco.phases.phaseRunStore.get().step);
  check(!!midStep, 'barra de progresso com a etapa atual', midStep);
  if (shots) await page.screenshot({ path: path.join(shots, 'phases-2-progresso.png') });
  await waitPhase(page, 'images', 15 * 60_000);
  const img = await page.evaluate(() => {
    const f = window.__foco;
    const r = f.phases.phaseRunStore.get();
    const p = f.store.getState().project;
    const track = p.tracks.find((t) => t.name === 'B-roll');
    const clips = Object.values(p.clips).filter((c) => c.trackId === track?.id);
    return { summary: r.summary, error: r.error, images: r.images.map((i) => ({ at: i.start.toFixed(1), q: i.query, title: i.credit.title.slice(0, 50), lic: i.credit.license, src: i.credit.source })), clips: clips.length, topTrack: p.tracks[0]?.name, undo: f.store.getState().canUndo && r.undoLabel };
  });
  console.log(`    ${img.summary ?? img.error} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const i of img.images) console.log(`      ${i.at}s · "${i.q}" → ${i.title} [${i.src} · ${i.lic}]`);
  check(img.clips > 0, 'imagens colocadas no vídeo', img.clips);
  check(img.topTrack === 'B-roll', 'trilha B-roll acima do vídeo', img.topTrack);
  check(img.images.every((i) => /public domain|pd|cc0|pexels|pixabay/i.test(i.lic)), 'só licenças livres');
  check(!!img.undo, 'a fase pode ser desfeita em um passo');

  // quadros no meio de cada imagem
  if (shots) {
    await page.screenshot({ path: path.join(shots, 'phases-3-imagens.png') });
    const times = img.images.slice(0, 4).map((i) => Number(i.at) + 1.5);
    for (const [k, t] of times.entries()) {
      await page.evaluate(async (tt) => {
        window.__foco.playback.seek(tt);
        await window.__foco.measureSeek(tt);
        await new Promise((r) => setTimeout(r, 600));
      }, t);
      await page.locator('.viewer canvas').first().screenshot({ path: path.join(shots, `phases-frame-${k + 1}.png`) });
    }
  }

  const before = img.clips;
  await page.locator('[data-testid="phase-undo"]').click();
  const after = await page.evaluate(() => {
    const p = window.__foco.store.getState().project;
    const track = p.tracks.find((t) => t.name === 'B-roll');
    return Object.values(p.clips).filter((c) => c.trackId === track?.id).length;
  });
  check(before > 0 && after === 0, 'Desfazer esta fase tira todas as imagens', `${before} → ${after}`);
  check(errors.length === 0, 'sem erros de página', errors.join(' | ').slice(0, 300));
} finally {
  await context.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
