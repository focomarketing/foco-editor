// Teste end-to-end da Fase 6 (efeitos): biblioteca, camada de efeito, efeitos no clipe,
// Inspector (ligar/desligar, mistura) e o mesmo resultado no arquivo exportado.
// Uso: npm run test:e2e:effects   (E2E_HEADED=1 mostra o navegador; E2E_SHOTS=pasta salva capturas)
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

const server = await createServer({ server: { port: 5195, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel, headless: !process.env.E2E_HEADED });

// ponto do fundo do vídeo de teste (verde), longe do texto do meio
const PX = [0.1, 0.85];
const pixel = (page, t) =>
  page.evaluate(
    async ({ t, PX }) => {
      window.__foco.playback.seek(t);
      await new Promise((r) => setTimeout(r, 350));
      const c = document.querySelector('.viewer canvas');
      return [...c.getContext('2d').getImageData(Math.round(PX[0] * (c.width - 1)), Math.round(PX[1] * (c.height - 1)), 1, 1).data].slice(0, 3);
    },
    { t, PX },
  );
const signature = (page, t) =>
  page.evaluate(async (t) => {
    window.__foco.playback.seek(t);
    await new Promise((r) => setTimeout(r, 350));
    const c = document.querySelector('.viewer canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sig = 0;
    for (let i = 0; i < d.length; i += 4) sig = (sig * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007;
    return sig;
  }, t);
const gray = (p) => Math.max(Math.abs(p[0] - p[1]), Math.abs(p[1] - p[2])) < 14;
const greenish = (p) => p[1] > p[0] + 25 && p[1] > p[2] + 15;
const inverted = (p) => p[0] > p[1] + 25 && p[2] > p[1] + 15; // verde invertido = magenta
const clips = (page) => page.evaluate(() => Object.values(window.__foco.store.getState().project.clips));

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto('http://localhost:5195/');
  await page.waitForFunction(() => window.__foco);

  console.log('Vídeo de fundo');
  await page.evaluate(async () => {
    const f = window.__foco;
    f.viewStore.set('project');
    const v = await f.makeTestVideo({ name: 'CENA', seconds: 5, width: 640, height: 360, fps: 30, hue: 140, freq: 440 });
    await f.actions.importItems([{ file: v }]);
  });
  await page.locator('.asset', { hasText: 'CENA.mp4' }).dragTo(page.locator('.lane[data-track="V1"]'), { targetPosition: { x: 5, y: 30 } });
  const base = await pixel(page, 1);
  check(greenish(base), 'fundo verde sem efeito', base);

  console.log('Biblioteca de efeitos');
  await page.getByTestId('rail-effects').click();
  const cards = await page.locator('[data-testid^="fx-card-"]').count();
  check(cards >= 19, 'biblioteca de efeitos', `${cards} efeitos`);
  const card = page.locator('[data-testid="fx-card-shake"] canvas');
  const still = await card.screenshot();
  await page.getByTestId('fx-card-shake').hover();
  await page.waitForTimeout(300);
  check(!still.equals(await card.screenshot()), 'prévia anima com o mouse em cima');
  if (shots) await page.screenshot({ path: path.join(shots, 'efeitos-biblioteca.png') });

  console.log('Camada de efeito');
  await page.evaluate(() => {
    const f = window.__foco;
    f.store.select([]);
    f.playback.seek(0);
  });
  check((await page.getByTestId('fx-target').textContent()).includes('camada de efeito'), 'sem clipe selecionado: vai criar camada de efeito');
  await page.getByTestId('fx-card-bw').click();
  let adj = (await clips(page)).find((c) => c.adjustment);
  check(adj && adj.start === 0 && adj.duration === 3 && adj.effects[0].type === 'bw', 'camada "Preto e branco" de 3 s no playhead');
  const bw = await pixel(page, 1);
  const after = await pixel(page, 3.6);
  check(gray(bw), 'dentro do trecho: tudo embaixo fica cinza', bw);
  check(greenish(after), 'depois do trecho: cor volta', after);
  await page.evaluate(() => {
    const f = window.__foco;
    const a = Object.values(f.store.getState().project.clips).find((c) => c.adjustment);
    f.store.execute(f.Cmd.setTransform({ [a.id]: { opacity: 0 } }));
  });
  check(greenish(await pixel(page, 1)), 'mistura 0%: efeito some');
  await page.evaluate(() => window.__foco.store.undo());
  check(gray(await pixel(page, 1)), 'Ctrl+Z: efeito volta');

  console.log('Efeito no clipe');
  await page.locator('.clip', { hasText: 'CENA.mp4' }).first().click();
  check((await page.getByTestId('fx-target').textContent()).includes('CENA.mp4'), 'com o vídeo selecionado: aplica no clipe');
  await page.getByTestId('fx-card-invert').click();
  const vid = (await clips(page)).find((c) => c.assetId && !c.adjustment);
  check(vid.effects?.[0]?.type === 'invert', 'efeito "Inverter" na pilha do clipe');
  const inv = await pixel(page, 3.6);
  check(inverted(inv), 'fora da camada: vídeo invertido (verde → magenta)', inv);
  check(gray(await pixel(page, 1)), 'dentro da camada: invertido e depois cinza (ordem das camadas)');
  await page.getByTestId('fx-item-invert').locator('input[type=checkbox]').uncheck();
  check(greenish(await pixel(page, 3.6)), 'desligar no Inspector: volta ao normal');
  await page.getByTestId('fx-item-invert').locator('input[type=checkbox]').check();
  if (shots) await page.screenshot({ path: path.join(shots, 'efeitos-inspector.png') });

  console.log('Determinismo');
  await page.getByTestId('fx-add').click();
  await page.getByTestId('fx-add-glitch').click();
  const g1 = await signature(page, 3.73);
  const g2 = await signature(page, 3.73);
  check(g1 === g2, 'glitch: mesmo instante, mesmo quadro (preview = export)');

  console.log('Export');
  const exp = await page.evaluate(() => window.__foco.exportAndProbe({ width: 640, height: 360, fps: 30, bitrate: 3_000_000, codec: 'avc' }));
  check(exp.width === 640 && Math.abs(exp.duration - 5) < 0.1, 'MP4 exportado', `${exp.width}x${exp.height} ${exp.duration.toFixed(2)} s`);
  const e1 = await page.evaluate((PX) => window.__foco.exportedPixelAt(1, PX[0], PX[1]), PX);
  const e2 = await page.evaluate((PX) => window.__foco.exportedPixelAt(4.5, PX[0], PX[1]), PX);
  check(gray(e1), 'arquivo: cinza dentro da camada de efeito', e1);
  check(inverted(e2), 'arquivo: invertido depois dela', e2);

  check(errors.length === 0, 'sem erros no console', errors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
