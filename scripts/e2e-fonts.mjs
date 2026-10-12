// Teste end-to-end da biblioteca de fontes (Fase 3): seleção embutida, Google Fonts baixado pela
// API local, fonte no preview e no export, e fonte do projeto recarregada ao reabrir.
// Uso: npm run test:e2e:fonts   (precisa de internet para o Google Fonts; E2E_HEADED=1, E2E_SHOTS=pasta)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const channel = process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge';
const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

// fontes baixadas vão para uma pasta temporária limpa, não para Documentos
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
process.env.FOCO_PROJECTS_DIR ??= path.join(os.tmpdir(), 'foco-e2e-projetos');
process.env.FOCO_FONTS_DIR = path.join(os.tmpdir(), 'foco-e2e-fontes');
fs.rmSync(process.env.FOCO_FONTS_DIR, { recursive: true, force: true });

const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel, headless: !process.env.E2E_HEADED });

/** Largura (px) da área com texto branco no preview: muda quando a fonte muda. */
const inkWidth = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.viewer canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let min = c.width, max = -1;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) {
        const x = (i / 4) % c.width;
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
    return max < 0 ? 0 : max - min;
  });

const titleFont = (page) => page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).find((c) => c.title)?.title.fontFamily ?? '');

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await page.addInitScript(() => {
    window.__autoDialog = (title) => (title.startsWith('Versão de recuperação') ? 'restore' : undefined);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://localhost:5198/');
  await page.waitForFunction(() => window.__foco);

  console.log('Título na timeline');
  await page.evaluate(async () => {
    const f = window.__foco;
    f.viewStore.set('project');
    const v = await f.makeTestVideo({ name: 'FUNDO', seconds: 3, width: 640, height: 360, fps: 30, hue: 220, freq: 440 });
    await f.actions.importItems([{ file: v }]);
  });
  await page.locator('.asset', { hasText: 'FUNDO.mp4' }).dragTo(page.locator('.lane[data-track="V1"]'), { targetPosition: { x: 5, y: 30 } });
  await page.evaluate(() => {
    const f = window.__foco;
    f.store.execute(f.Cmd.addTitle({ template: 'title', text: 'FELICIDADE', at: 0, duration: 3 }));
    f.playback.seek(1.5);
  });
  await page.waitForTimeout(500);
  const w0 = await inkWidth(page);
  check(w0 > 50, 'título aparece no preview', `${w0} px de largura`);

  console.log('Biblioteca embutida');
  await page.locator('.clip.title').click();
  await page.getByTestId('font-select').click();
  await page.waitForSelector('[data-testid="font-Anton"]');
  const libCount = await page.locator('.font-row').count();
  check(libCount >= 60, 'seletor lista a biblioteca + sistema', `${libCount} fontes`);
  if (shots) await page.waitForTimeout(500).then(() => page.screenshot({ path: path.join(shots, 'fontes-biblioteca.png') }));
  await page.getByTestId('font-Anton').click();
  await page.waitForFunction(() => document.fonts.check('40px "Anton"') && [...document.fonts].some((f) => f.family === 'Anton' && f.status === 'loaded'));
  check((await titleFont(page)).startsWith('"Anton"'), 'título passa a usar Anton', await titleFont(page));
  await page.waitForTimeout(400);
  const w1 = await inkWidth(page);
  check(Math.abs(w1 - w0) > 20, 'preview redesenhado com a fonte nova', `${w0} → ${w1} px`);

  console.log('Google Fonts');
  await page.getByTestId('font-select').click();
  await page.getByTestId('font-search').fill('rubik mono');
  await page.waitForSelector('[data-testid="font-Rubik Mono One"]', { timeout: 30000 });
  if (shots) await page.waitForTimeout(1000).then(() => page.screenshot({ path: path.join(shots, 'fontes-google.png') }));
  await page.getByTestId('font-Rubik Mono One').click();
  await page.waitForFunction(() => Object.values(window.__foco.store.getState().project.clips).some((c) => c.title?.fontFamily.startsWith('"Rubik Mono One"')), null, { timeout: 30000 });
  check(true, 'fonte do Google baixada e aplicada ao título');
  const saved = path.join(process.env.FOCO_FONTS_DIR, 'Rubik-Mono-One', 'faces.json');
  check(fs.existsSync(saved), 'guardada na pasta Fontes do PC (funciona offline depois)');
  await page.waitForTimeout(400);
  const w2 = await inkWidth(page);
  check(Math.abs(w2 - w1) > 20, 'preview com a fonte do Google', `${w1} → ${w2} px`);
  if (shots) await page.screenshot({ path: path.join(shots, 'fontes-preview.png') });

  console.log('Reabrir o projeto');
  await page.evaluate(() => window.__focoFlush?.());
  await page.waitForTimeout(1500); // autosave
  await page.reload();
  await page.waitForFunction(() => window.__foco);
  await page.evaluate(() => window.__foco.viewStore.set('project'));
  await page.waitForFunction(() => [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Rubik Mono One' && f.status === 'loaded'), null, { timeout: 15000 });
  check(true, 'fonte do projeto recarregada sozinha ao reabrir');

  console.log('Export');
  const exp = await page.evaluate(() => window.__foco.exportAndProbe({ width: 640, height: 360, fps: 30, bitrate: 2_000_000, codec: 'avc' }));
  check(exp.width === 640 && Math.abs(exp.duration - 3) < 0.1, 'MP4 exportado com o título', `${exp.width}x${exp.height} ${exp.duration.toFixed(2)} s`);

  check(errors.length === 0, 'sem erros no console', errors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
