// Teste end-to-end da Fase 5 (Motion Graphics: elementos, partículas, grupos e máscaras).
// Uso: npm run test:e2e:elements   (E2E_HEADED=1 mostra o navegador; E2E_SHOTS=pasta salva capturas)
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

const server = await createServer({ server: { port: 5196, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel, headless: !process.env.E2E_HEADED });

/** Pixels do preview no tempo t: quantos parecidos com `rgb` e uma assinatura do quadro. */
const frame = (page, t, rgb) =>
  page.evaluate(
    async ({ t, rgb }) => {
      window.__foco.playback.seek(t);
      await new Promise((r) => setTimeout(r, 300));
      const c = document.querySelector('.viewer canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let color = 0, sig = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (rgb && Math.abs(d[i] - rgb[0]) < 40 && Math.abs(d[i + 1] - rgb[1]) < 40 && Math.abs(d[i + 2] - rgb[2]) < 40) color++;
        sig = (sig * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007;
      }
      const px = (fx, fy) => [...c.getContext('2d').getImageData(Math.round(fx * (c.width - 1)), Math.round(fy * (c.height - 1)), 1, 1).data].slice(0, 3);
      return { color, sig, corner: px(0.02, 0.04), center: px(0.5, 0.5) };
    },
    { t, rgb },
  );
const elementClips = (page) => page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).filter((c) => c.element));
const dark = (p) => p[0] + p[1] + p[2] < 40;

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto('http://localhost:5196/');
  await page.waitForFunction(() => window.__foco);

  console.log('Vídeo de fundo');
  await page.evaluate(async () => {
    const f = window.__foco;
    f.viewStore.set('project');
    const v = await f.makeTestVideo({ name: 'FUNDO', seconds: 4, width: 640, height: 360, fps: 30, hue: 140, freq: 440 });
    await f.actions.importItems([{ file: v }]);
  });
  await page.locator('.asset', { hasText: 'FUNDO.mp4' }).dragTo(page.locator('.lane[data-track="V1"]'), { targetPosition: { x: 5, y: 30 } });

  console.log('Biblioteca de elementos');
  await page.getByTestId('rail-elements').click();
  const cards = await page.locator('[data-testid^="el-preset-"]').count();
  check(cards >= 24, 'biblioteca com elementos prontos', `${cards} elementos`);
  const card = page.locator('[data-testid="el-preset-circulo"] canvas');
  const still = await card.screenshot();
  await page.getByTestId('el-preset-circulo').hover();
  await page.waitForTimeout(250);
  check(!still.equals(await card.screenshot()), 'prévia anima com o mouse em cima');
  if (shots) await page.screenshot({ path: path.join(shots, 'elementos-biblioteca.png') });

  await page.evaluate(() => window.__foco.playback.seek(0));
  await page.getByTestId('el-preset-selo-novo').click();
  let els = await elementClips(page);
  check(els.length === 1 && els[0].element.layers.length === 2 && els[0].start === 0, 'selo NOVO inserido no playhead (grupo de 2 camadas)');
  const red = await frame(page, 1.5, [255, 59, 59]);
  check(red.color > 500, 'estrela vermelha no preview', `${red.color} px`);
  const before = await frame(page, 0.05, [255, 59, 59]);
  check(before.color < red.color * 0.5, 'entrada "girar" ainda pequena no começo', `${before.color} → ${red.color} px`);

  console.log('Camadas (grupo)');
  await page.getByTestId('el-add-layer').click();
  await page.getByTestId('el-add-text').click();
  els = await elementClips(page);
  check(els[0].element.layers.length === 3 && els[0].element.layers[2].kind === 'text', 'camada de texto adicionada ao grupo');
  await page.getByTestId('el-text').fill('PROMO');
  await page.getByTestId('el-text').press('Tab');
  els = await elementClips(page);
  check(els[0].element.layers[2].text === 'PROMO', 'texto da camada editado');
  await page.evaluate(() => window.__foco.store.undo());
  els = await elementClips(page);
  check(els[0].element.layers[2].text === 'Seu texto', 'Ctrl+Z desfaz a edição da camada');
  // keyframe no grupo: o elemento inteiro anda para a esquerda
  const moved = await page.evaluate(async () => {
    const f = window.__foco;
    const c = Object.values(f.store.getState().project.clips).find((x) => x.element);
    f.store.execute(f.Cmd.setKeyframes({ [c.id]: { x: [{ t: 0, v: 0, ease: 'linear' }, { t: 3, v: -0.5, ease: 'linear' }] } }));
    return true;
  });
  const g1 = await frame(page, 1.5, [255, 59, 59]);
  check(moved && g1.sig !== red.sig, 'keyframes movem o grupo inteiro');
  if (shots) await page.screenshot({ path: path.join(shots, 'elementos-inspector.png') });

  console.log('Partículas');
  await page.evaluate(() => window.__foco.playback.seek(0));
  await page.getByTestId('el-preset-confete').click();
  els = await elementClips(page);
  check(els.length === 2 && els.some((c) => c.element.layers[0].kind === 'particles'), 'confete inserido');
  // só o confete: esconde o selo para comparar quadros
  await page.evaluate(() => {
    const f = window.__foco;
    const selo = Object.values(f.store.getState().project.clips).find((c) => c.element?.preset === 'selo-novo');
    f.store.execute(f.Cmd.deleteClips([selo.id]));
  });
  const a1 = await frame(page, 1.2);
  const a2 = await frame(page, 1.2);
  const b1 = await frame(page, 1.45);
  check(a1.sig === a2.sig, 'mesmo instante, mesmo quadro (preview = export)');
  check(a1.sig !== b1.sig, 'partículas se movem com o tempo');

  console.log('Máscara');
  await page.locator('.clip', { hasText: 'FUNDO.mp4' }).first().click();
  await page.getByTestId('mask-circle').click();
  const mask = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).find((c) => c.assetId && c.mask)?.mask);
  check(mask?.shape === 'ellipse', 'máscara circular no clipe de vídeo');
  // esconde as trilhas de gráficos para ver só o vídeo mascarado
  await page.evaluate(() => {
    const f = window.__foco;
    const gs = f.store.getState().project.tracks.filter((t) => t.name.startsWith('Gráficos'));
    f.store.execute(f.Cmd.batch('Esconder gráficos', gs.map((g) => f.Cmd.updateTrack(g.id, { hidden: true }))));
  });
  const m = await frame(page, 2);
  check(dark(m.corner) && !dark(m.center), 'canto preto, centro com imagem', `canto ${m.corner} · centro ${m.center}`);
  if (shots) await page.screenshot({ path: path.join(shots, 'elementos-mascara.png') });

  console.log('Export');
  const exp = await page.evaluate(() => window.__foco.exportAndProbe({ width: 640, height: 360, fps: 30, bitrate: 2_000_000, codec: 'avc' }));
  check(exp.width === 640 && Math.abs(exp.duration - 4) < 0.1, 'MP4 exportado', `${exp.width}x${exp.height} ${exp.duration.toFixed(2)} s`);
  const ec = await page.evaluate(() => window.__foco.exportedPixelAt(2, 0.02, 0.04));
  const em = await page.evaluate(() => window.__foco.exportedPixelAt(2, 0.5, 0.5));
  check(dark(ec) && !dark(em), 'máscara aplicada no arquivo exportado', `canto ${ec} · centro ${em}`);

  check(errors.length === 0, 'sem erros no console', errors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
