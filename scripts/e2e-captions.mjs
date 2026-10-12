// Teste end-to-end da Fase 4 (banco de legendas, personalização e animações) num navegador real.
// Uso: npm run test:e2e:captions   (E2E_HEADED=1 mostra o navegador; E2E_SHOTS=pasta salva capturas)
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

const server = await createServer({ server: { port: 5197, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel, headless: !process.env.E2E_HEADED });

/** Analisa o quadro do preview: caixa com texto claro e quantidade de pixels de uma cor. */
const frame = (page, t, rgb) =>
  page.evaluate(
    async ({ t, rgb }) => {
      const f = window.__foco;
      f.playback.seek(t);
      await new Promise((r) => setTimeout(r, 250));
      const c = document.querySelector('.viewer canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let minX = c.width, maxX = -1, minY = c.height, maxY = -1, ink = 0, color = 0;
      // só a faixa da legenda (o vídeo de teste tem um texto branco no meio do quadro)
      for (let i = Math.floor(c.height * 0.66) * c.width * 4; i < d.length; i += 4) {
        const x = (i / 4) % c.width, y = Math.floor(i / 4 / c.width);
        if (d[i] > 225 && d[i + 1] > 225 && d[i + 2] > 225) {
          ink++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (rgb && Math.abs(d[i] - rgb[0]) < 30 && Math.abs(d[i + 1] - rgb[1]) < 30 && Math.abs(d[i + 2] - rgb[2]) < 30) color++;
      }
      return { ink, width: maxX < 0 ? 0 : maxX - minX, top: minY, color, h: c.height };
    },
    { t, rgb },
  );

const capStyle = (page) => page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).find((c) => c.caption)?.caption.style);
const setAll = (page, patch) =>
  page.evaluate((patch) => {
    const f = window.__foco;
    const caps = Object.values(f.store.getState().project.clips).filter((c) => c.caption);
    f.store.execute(f.Cmd.batch('teste', caps.map((c) => f.Cmd.setCaption(c.id, { ...c.caption, style: { ...c.caption.style, ...patch } }))));
  }, patch);

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto('http://localhost:5197/');
  await page.waitForFunction(() => window.__foco);

  console.log('Legenda na timeline');
  await page.evaluate(async () => {
    const f = window.__foco;
    f.viewStore.set('project');
    localStorage.removeItem('foco.captionStyles');
    const v = await f.makeTestVideo({ name: 'FALA', seconds: 4, width: 640, height: 360, fps: 30, hue: 200, freq: 440 });
    await f.actions.importItems([{ file: v }]);
  });
  await page.locator('.asset', { hasText: 'FALA.mp4' }).dragTo(page.locator('.lane[data-track="V1"]'), { targetPosition: { x: 5, y: 30 } });
  await page.evaluate(() => {
    const f = window.__foco;
    // "você precisa saber isso agora" — um bloco só (minimal), de 0,5 s a 3 s
    const words = ['você', 'precisa', 'saber', 'isso', 'agora'].map((text, i) => ({ text, start: 0.5 + i * 0.5, end: 0.9 + i * 0.5, limit: 4 }));
    f.store.execute(f.Cmd.generateCaptions(words, 'minimal'));
  });
  const capClips = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).filter((c) => c.caption).length);
  check(capClips === 1, 'um bloco de legenda criado', capClips);
  const base = await frame(page, 2);
  check(base.ink > 200, 'legenda aparece no preview', `${base.ink} px`);

  console.log('Banco de estilos');
  await page.locator('.clip', { hasText: 'você' }).first().click();
  await page.getByTestId('cap-gallery-toggle').click();
  const cards = await page.locator('.cap-card').count();
  check(cards >= 30, 'galeria com o banco de estilos', `${cards} estilos`);
  await page.waitForTimeout(600);
  if (shots) await page.screenshot({ path: path.join(shots, 'legendas-galeria.png') });
  const before = await page.locator('[data-testid="cap-preset-caixa"] canvas').screenshot();
  await page.getByTestId('cap-preset-caixa').hover();
  await page.waitForTimeout(350);
  const during = await page.locator('[data-testid="cap-preset-caixa"] canvas').screenshot();
  check(!before.equals(during), 'prévia anima com o mouse em cima');
  await page.getByTestId('cap-preset-caixa').click();
  const st = await capStyle(page);
  check(st.preset === 'caixa' && st.highlightBg === '#7c3aed' && st.fontFamily.startsWith('"Montserrat"'), 'estilo "Caixa na palavra" aplicado', st.fontFamily);
  await page.waitForFunction(() => [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Montserrat' && f.status === 'loaded'));
  check(true, 'fonte do estilo (Montserrat) carregada');
  const boxed = await frame(page, 1.1, [124, 58, 237]);
  check(boxed.color > 150, 'caixa roxa atrás da palavra falada', `${boxed.color} px roxos`);

  console.log('Animações');
  await setAll(page, { animIn: 'slideUp', animOut: 'none', animDuration: 0.3, highlightBg: null, mode: 'block', wordAnim: 'none', y: 0.85 });
  const entering = await frame(page, 0.56);
  const settled = await frame(page, 1.5);
  check(entering.top > settled.top + 3, 'entrada "Sobe": começa mais abaixo e assenta', `topo ${entering.top} → ${settled.top}`);
  await setAll(page, { animIn: 'none', animOut: 'fade', animDuration: 0.4 });
  const fading = await frame(page, 3.1 - 0.06);
  check(fading.ink < settled.ink * 0.5, 'saída "Fade" apaga o bloco no fim', `${settled.ink} → ${fading.ink} px`);
  await setAll(page, { animOut: 'none', mode: 'reveal', wordAnim: 'none' });
  const r1 = await frame(page, 0.7);
  const r3 = await frame(page, 1.8);
  check(r1.width > 0 && r3.width > r1.width * 1.8, 'modo "aparece conforme a fala"', `${r1.width} → ${r3.width} px`);
  const again = await frame(page, 0.7);
  check(again.ink === r1.ink, 'mesmo tempo, mesmo quadro (preview e export iguais)');

  console.log('Personalização');
  await page.getByTestId('cap-word-2').click();
  const emph = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).find((c) => c.caption).caption.words.map((w) => !!w.emphasis));
  check(JSON.stringify(emph) === '[false,false,true,false,false]', 'clique destaca a palavra "saber"');
  await setAll(page, { mode: 'block', emphasisColor: '#ff0000' });
  const red = await frame(page, 2, [255, 0, 0]);
  check(red.color > 50, 'palavra destacada na cor de ênfase', `${red.color} px vermelhos`);
  await page.evaluate(() => window.__foco.store.undo());
  await page.getByTestId('cap-save-style').click();
  await page.getByTestId('cap-style-name').fill('Meu canal');
  await page.getByTestId('cap-style-name').press('Enter');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('foco.captionStyles') ?? '[]').map((p) => p.label));
  check(saved.includes('Meu canal'), 'salvo em "Meus estilos"', saved.join(', '));
  check((await page.locator('.font-chip', { hasText: 'Meus estilos' }).count()) === 1, 'categoria "Meus estilos" na galeria');
  if (shots) await page.screenshot({ path: path.join(shots, 'legendas-inspector.png') });

  console.log('Export');
  await setAll(page, { mode: 'karaoke', highlightBg: '#7c3aed', animIn: 'pop' });
  const exp = await page.evaluate(() => window.__foco.exportAndProbe({ width: 640, height: 360, fps: 30, bitrate: 2_000_000, codec: 'avc' }));
  check(exp.width === 640 && Math.abs(exp.duration - 4) < 0.1, 'MP4 exportado com as legendas', `${exp.width}x${exp.height} ${exp.duration.toFixed(2)} s`);

  check(errors.length === 0, 'sem erros no console', errors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
