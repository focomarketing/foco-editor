// Transições de ponta a ponta: o preview e o arquivo exportado desenham a transição (pixels),
// a biblioteca aplica no clipe selecionado, o Inspector ajusta/remove e a skill
// professional-transition-designer sugere com preview antes de aplicar.
// Uso: node scripts/e2e-transitions.mjs   (E2E_SHOTS=pasta para capturas)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const profile = path.join(os.tmpdir(), 'foco-e2e-transitions');
fs.rmSync(profile, { recursive: true, force: true });
// mídia gravada pelo editor vai para uma pasta temporária, não para Documentos
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
process.env.FOCO_PROJECTS_DIR ??= path.join(os.tmpdir(), 'foco-e2e-projetos');
const server = await createServer({ server: { port: 5194, strictPort: true }, logLevel: 'error' });
await server.listen();
const context = await chromium.launchPersistentContext(profile, { channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge', headless: !process.env.E2E_HEADED, viewport: { width: 1500, height: 900 } });

/** Pixel do preview num ponto (fração do quadro), depois de posicionar o player. */
const previewPixel = (page, t, fx = 0.1, fy = 0.12) =>
  page.evaluate(async ({ t, fx, fy }) => {
    const f = window.__foco;
    await f.measureSeek(t);
    await new Promise((r) => setTimeout(r, 250));
    await f.measureSeek(t);
    const c = document.querySelector('.viewer canvas');
    const d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { t, fx, fy });

const setTr = (page, spec) => page.evaluate((spec) => window.__foco.store.execute(window.__foco.Cmd.setTransition({ [window.__foco.__B]: spec })), spec);

try {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5194/');
  await page.waitForFunction(() => window.__foco);

  // projeto manual com A (vermelho) e B (azul) colados
  await page.evaluate(async () => {
    const f = window.__foco;
    const a = await f.makeTestVideo({ name: 'A', seconds: 4, width: 640, height: 360, fps: 30, hue: 0, freq: 440 });
    const b = await f.makeTestVideo({ name: 'B', seconds: 4, width: 640, height: 360, fps: 30, hue: 220, freq: 660 });
    await f.workflow.createGuidedProject({ name: 'Teste transições', track: 'manual', subtype: null }, [{ file: a }, { file: b }]);
    const p = f.store.getState().project;
    const clips = Object.values(p.clips).sort((x, y) => x.start - y.start);
    f.__B = clips[1].id;
  });
  await page.waitForFunction(() => Object.values(window.__foco.store.getState().project.assets).every((a) => window.__foco.media.get(a.id)?.status === 'ready'), null, { timeout: 30_000 });
  const layout = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).map((c) => [c.start, c.duration]).sort());
  check(layout.length === 2 && Math.abs(layout[1][0] - 4) < 0.05, 'A e B colados na timeline', JSON.stringify(layout));

  console.log('Preview');
  const plainB = await previewPixel(page, 4.5);
  check(plainB[2] > plainB[0] + 30, 'sem transição, depois do corte é só B (azul)', plainB.join(','));

  await setTr(page, { type: 'cross-dissolve', duration: 1, by: 'user' });
  await previewPixel(page, 3.9); // passa pelo fim de A (guarda o último quadro)
  const mix = await previewPixel(page, 4.5);
  check(mix[0] > plainB[0] + 25 && mix[2] > 40, 'dissolve: no meio da janela A e B misturados', `${plainB.join(',')} → ${mix.join(',')}`);
  if (shots) await page.locator('.viewer canvas').first().screenshot({ path: path.join(shots, 'tr-dissolve.png') });

  await setTr(page, { type: 'flash-cut', duration: 0.3, intensity: 1, by: 'user' });
  const flash = await previewPixel(page, 4.0);
  check(Math.min(...flash) > 185, 'flash cut: clarão no corte', flash.join(','));

  await setTr(page, { type: 'whip-transition', duration: 0.4, by: 'user' });
  const whip = await previewPixel(page, 3.95, 0.5, 0.5);
  check(whip.some((v) => v > 0), 'whip desenha sem buraco preto (bordas espelhadas)', whip.join(','));
  if (shots) await page.locator('.viewer canvas').first().screenshot({ path: path.join(shots, 'tr-whip.png') });

  await setTr(page, { type: 'product-reveal', duration: 0.6, by: 'user' });
  await previewPixel(page, 3.9);
  const center = await previewPixel(page, 4.3, 0.5, 0.15);
  const corner = await previewPixel(page, 4.3, 0.02, 0.03);
  check(center[2] > center[0] && corner[0] > corner[2], 'máscara circular: centro já é B, canto ainda é A', `centro ${center.join(',')} · canto ${corner.join(',')}`);
  if (shots) await page.locator('.viewer canvas').first().screenshot({ path: path.join(shots, 'tr-mask.png') });

  console.log('Export');
  await setTr(page, { type: 'cross-dissolve', duration: 1, by: 'user' });
  const exp = await page
    .evaluate(async () => {
      await window.__foco.exportAndProbe({ width: 640, height: 360, fps: 30, bitrate: 2_000_000, codec: 'avc' });
      return { ok: true };
    })
    .catch((e) => ({ ok: false, error: String(e) }));
  check(exp.ok, 'export com transição terminou', exp.error ?? '');
  const px = await page.evaluate(async () => {
    const f = window.__foco;
    const at = async (t) => f.exportedPixelAt(t, 0.1, 0.12);
    return { plain: await at(5.6), mid: await at(4.5) };
  });
  check(px.mid && px.plain && px.mid[0] > px.plain[0] + 25, 'arquivo exportado tem o dissolve (mesmo motor do preview)', `${px.plain?.join(',')} → ${px.mid?.join(',')}`);

  console.log('Biblioteca e Inspector');
  await page.evaluate(() => {
    window.__foco.store.execute(window.__foco.Cmd.setTransition({ [window.__foco.__B]: undefined }));
    window.__foco.workflow.setPhase('editor');
    window.__foco.store.select([window.__foco.__B]);
  });
  await page.locator('.rail-btn', { hasText: 'Transições' }).click();
  await page.locator('[data-testid="transition-library"]').waitFor();
  const cards = await page.locator('.tr-card').count();
  check(cards >= 10, 'biblioteca com previews', `${cards} modelos na aba`);
  await page.locator('[data-testid="tr-zoom-clean"]').hover();
  await page.waitForTimeout(400);
  if (shots) await page.screenshot({ path: path.join(shots, 'tr-library.png') });
  await page.locator('[data-testid="tr-zoom-clean"]').click();
  const applied = await page.evaluate(() => window.__foco.store.getState().project.clips[window.__foco.__B].transitionIn);
  check(applied?.type === 'zoom-clean' && applied.by === 'user', 'clicar no modelo aplica no clipe selecionado (escolha do usuário)', JSON.stringify(applied));
  check((await page.locator('[data-testid="transition-badge"]').count()) === 1, 'marca da transição no clipe da timeline');
  await page.locator('[data-testid="transition-inspector"]').waitFor();
  await page.locator('[data-testid="transition-remove"]').click();
  const removed = await page.evaluate(() => window.__foco.store.getState().project.clips[window.__foco.__B].transitionIn);
  check(!removed, 'Inspector remove a transição');
  await page.keyboard.press('Control+z');
  const back = await page.evaluate(() => window.__foco.store.getState().project.clips[window.__foco.__B].transitionIn?.type);
  check(back === 'zoom-clean', 'Ctrl+Z traz de volta', back);

  console.log('Skill professional-transition-designer');
  await page.evaluate(() => window.__foco.store.execute(window.__foco.Cmd.setTransition({ [window.__foco.__B]: undefined })));
  await page.evaluate(() => window.__foco.phases.runPhase('transitions', { autoApply: false }));
  const sk = await page.evaluate(() => {
    const f = window.__foco;
    const r = f.phases.phaseRunStore.get();
    const op = f.phases.currentOperation(r.opId);
    return { summary: r.summary, error: r.error, cmds: op?.commands.map((c) => ({ id: c.payload.transitionId, conf: c.confidence, why: c.reason })) ?? [], status: op?.status, now: f.store.getState().project.clips[f.__B].transitionIn };
  });
  console.log(`    ${sk.summary ?? sk.error}`);
  for (const c of sk.cmds) console.log(`      ${c.id} · ${Math.round(c.conf * 100)}% · ${c.why}`);
  check(!sk.error && sk.cmds.length === 1, 'troca de cena forte sem fala: uma sugestão com motivo', sk.error ?? sk.cmds.length);
  check(sk.status === 'preview' && !sk.now, 'sugestão fica em preview, timeline intacta');
  check(errors.length === 0, 'sem erros de página', errors.join(' | ').slice(0, 300));
} finally {
  await context.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
