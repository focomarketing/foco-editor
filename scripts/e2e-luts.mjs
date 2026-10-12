// Teste end-to-end da Fase 7 (LUTs): importar .cube, aplicar no clipe (intensidade), looks prontos,
// look na camada de efeito, mesmo resultado no arquivo exportado e LUT de volta ao reabrir.
// Uso: npm run test:e2e:luts   (E2E_HEADED=1 mostra o navegador; E2E_SHOTS=pasta salva capturas)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';

const channel = process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge';
const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
process.env.FOCO_PROJECTS_DIR ??= path.join(os.tmpdir(), 'foco-e2e-projetos');
process.env.FOCO_FONTS_DIR ??= path.join(os.tmpdir(), 'foco-e2e-fontes');

// LUT 2³ que troca o vermelho com o azul (ordem .cube: vermelho varia mais rápido)
const SWAP_RB = ['TITLE "Troca R/B"', 'LUT_3D_SIZE 2', '0 0 0', '0 0 1', '0 1 0', '0 1 1', '1 0 0', '1 0 1', '1 1 0', '1 1 1', ''].join('\n');

const server = await createServer({ server: { port: 5194, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel, headless: !process.env.E2E_HEADED });

const PX = [0.1, 0.85]; // fundo do vídeo de teste, longe do texto
const pixel = (page, t) =>
  page.evaluate(
    async ({ t, PX }) => {
      window.__foco.playback.seek(t);
      window.__foco.playback.invalidate();
      await new Promise((r) => setTimeout(r, 400));
      const c = document.querySelector('.viewer canvas');
      return [...c.getContext('2d').getImageData(Math.round(PX[0] * (c.width - 1)), Math.round(PX[1] * (c.height - 1)), 1, 1).data].slice(0, 3);
    },
    { t, PX },
  );
const reddish = (p) => p[0] > p[2] + 40;
const bluish = (p) => p[2] > p[0] + 40;
const gray = (p) => Math.max(Math.abs(p[0] - p[1]), Math.abs(p[1] - p[2])) < 16;
const videoClip = (page) => page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).find((c) => c.assetId && !c.adjustment));

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await page.addInitScript(() => {
    window.__autoDialog = (title) => (title.startsWith('Versão de recuperação') ? 'restore' : title === 'Criar proxy?' ? 'no' : undefined);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto('http://localhost:5194/');
  await page.waitForFunction(() => window.__foco);

  console.log('Importação');
  await page.evaluate(async (cube) => {
    const f = window.__foco;
    f.viewStore.set('project');
    const v = await f.makeTestVideo({ name: 'VERMELHO', seconds: 4, width: 640, height: 360, fps: 30, hue: 0, freq: 440 });
    await f.actions.importItems([{ file: v }, { file: new File([cube], 'troca-rb.cube', { type: '' }) }]);
  }, SWAP_RB);
  await page.locator('.asset', { hasText: 'VERMELHO.mp4' }).dragTo(page.locator('.lane[data-track="V1"]'), { targetPosition: { x: 5, y: 30 } });
  const lutAsset = await page.evaluate(() => Object.values(window.__foco.store.getState().project.assets).find((a) => a.kind === 'lut'));
  check(lutAsset?.lutSize === 2 && lutAsset.name === 'troca-rb.cube', 'arquivo .cube importado como LUT', `${lutAsset?.name} · ${lutAsset?.lutSize}³`);
  check((await page.locator('.asset', { hasText: 'troca-rb.cube' }).count()) === 1, 'LUT aparece no Media Bin');
  const bad = await page.evaluate(async () => {
    try {
      await window.__foco.actions.importItems([{ file: new File(['LUT_3D_SIZE 2\n0 0 0\n'], 'quebrada.cube') }]);
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
    return Object.values(window.__foco.store.getState().project.assets).some((a) => a.name === 'quebrada.cube');
  });
  check(!bad, '.cube quebrado é recusado (não entra no projeto)');
  const base = await pixel(page, 1);
  check(reddish(base), 'vídeo vermelho sem LUT', base);

  console.log('LUT no clipe');
  await page.locator('.clip', { hasText: 'VERMELHO.mp4' }).first().click();
  await page.getByTestId('lut-select').first().selectOption({ label: 'troca-rb' });
  let vc = await videoClip(page);
  check(vc.color?.lut === lutAsset.id && (vc.color.lutAmount ?? 1) === 1, 'LUT escolhida no Inspector (Cor)');
  const swapped = await pixel(page, 1);
  check(bluish(swapped), 'vermelho vira azul no preview', swapped);
  await page.evaluate(() => {
    const f = window.__foco;
    const c = Object.values(f.store.getState().project.clips).find((x) => x.assetId && !x.adjustment);
    f.store.execute(f.Cmd.setColor({ [c.id]: { ...c.color, lutAmount: 0.5 } }));
  });
  const half = await pixel(page, 1);
  check(Math.abs(half[0] - half[2]) < 40 && !gray(half), 'intensidade 50%: meio caminho (roxo)', half);
  await page.evaluate(() => window.__foco.store.undo());
  if (shots) await page.screenshot({ path: path.join(shots, 'luts-clipe.png') });

  console.log('Looks prontos e presets');
  await page.getByTestId('lut-select').first().selectOption({ label: 'Noir' });
  check(gray(await pixel(page, 1)), 'look "Noir" deixa preto e branco');
  await page.locator('.insp select').filter({ has: page.locator('option[value="warm"]') }).first().selectOption('warm');
  vc = await videoClip(page);
  check(vc.color?.preset === 'warm' && vc.color.lut === 'look:noir', 'trocar o preset de cor mantém o look', `${vc.color?.preset} + ${vc.color?.lut}`);
  await page.getByTestId('lut-select').first().selectOption({ label: 'Nenhum' });
  vc = await videoClip(page);
  check(!vc.color?.lut && vc.color?.preset === 'warm', '"Nenhum" tira só o look');

  console.log('Look na camada de efeito');
  await page.evaluate((lutId) => {
    const f = window.__foco;
    const c = Object.values(f.store.getState().project.clips).find((x) => x.assetId && !x.adjustment);
    f.store.execute(f.Cmd.setColor({ [c.id]: undefined }));
    f.store.execute(f.Cmd.addAdjustment({ effects: [{ id: 'fx1', type: 'look', amount: 1, lut: lutId }], at: 2, duration: 2 }));
  }, lutAsset.id);
  const before = await pixel(page, 1);
  const inside = await pixel(page, 3);
  check(reddish(before) && bluish(inside), 'camada "Look" troca a cor só no trecho dela', `${before} → ${inside}`);

  console.log('Export');
  const exp = await page.evaluate(() => window.__foco.exportAndProbe({ width: 640, height: 360, fps: 30, bitrate: 3_000_000, codec: 'avc' }));
  check(exp.width === 640 && Math.abs(exp.duration - 4) < 0.1, 'MP4 exportado', `${exp.width}x${exp.height} ${exp.duration.toFixed(2)} s`);
  const e1 = await page.evaluate((PX) => window.__foco.exportedPixelAt(1, PX[0], PX[1]), PX);
  const e2 = await page.evaluate((PX) => window.__foco.exportedPixelAt(3, PX[0], PX[1]), PX);
  check(reddish(e1) && bluish(e2), 'arquivo: vermelho antes, azul dentro da camada Look', `${e1} → ${e2}`);

  console.log('Reabrir');
  await page.evaluate(() => window.__focoFlush?.());
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(() => window.__foco);
  await page.waitForFunction(() => Object.keys(window.__foco.store.getState().project.clips).length > 0, null, { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => window.__foco.viewStore.set('project'));
  await page.waitForTimeout(800);
  const again = await pixel(page, 3);
  check(bluish(again), 'LUT importada volta sozinha ao reabrir o projeto', again);

  check(errors.length === 0, 'sem erros no console', errors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
