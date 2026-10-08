// Teste end-to-end da Fase 3 (sem LLM): executor de comandos, cor, áudio, gráficos,
// keyframes, comparação original vs IA e export. Uso: npm run test:e2e:fx
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';

const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

// mídia gravada pelo editor vai para uma pasta temporária, não para Documentos
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
const server = await createServer({ server: { port: 5195, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge', headless: !process.env.E2E_HEADED, args: ['--autoplay-policy=no-user-gesture-required'] });

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await page.addInitScript(() => {
    window.__autoDialog = (title) => (title.startsWith('Versão de recuperação') ? 'restore' : title === 'Criar proxy?' ? 'no' : undefined);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5195/');
  await page.waitForFunction(() => window.__foco);

  // vídeo escuro e azulado: a cor automática precisa clarear e esquentar
  await page.evaluate(async () => {
    const f = window.__foco;
    const file = await f.makeTestVideo({ name: 'ESCURO', seconds: 4, width: 640, height: 360, fps: 30, hue: 225, freq: 220 });
    await f.actions.importItems([{ file }]);
    const a = Object.values(f.store.getState().project.assets)[0];
    await f.media.whenLevels(a.id);
    f.actions.addAssetToTimeline(a.id);
  });
  const pixel = async (x = 0.5, y = 0.15) =>
    page.evaluate(([x, y]) => {
      const c = document.querySelector('.viewer canvas');
      const d = c.getContext('2d').getImageData(Math.round(c.width * x), Math.round(c.height * y), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [x, y]);
  await page.evaluate(() => window.__foco.playback.seek(0.2));
  await page.waitForTimeout(500);
  const before = await pixel();

  console.log('Cor automática (executor)');
  await page.evaluate(() => window.__foco.ai.runManual({ type: 'auto_color' }));
  const color = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips)[0].color);
  check(color && color.preset === 'auto' && color.exposure > 0.2, 'analisou quadros reais e clareou', JSON.stringify({ exp: color?.exposure, temp: color?.temperature }));
  check(color && color.temperature > 0.1, 'corrigiu o tom azulado (temperatura +)', color?.temperature);
  await page.waitForTimeout(400);
  const graded = await pixel();
  check(graded[0] + graded[1] + graded[2] > before[0] + before[1] + before[2] + 30, 'preview mostra a imagem corrigida (shader WebGL)', `${before} → ${graded}`);
  await page.evaluate(() => window.__foco.playback.setCompareOriginal(true));
  await page.waitForTimeout(300);
  const orig = await pixel();
  check(Math.abs(orig[0] - before[0]) < 6 && Math.abs(orig[2] - before[2]) < 6, '"segurar: original" mostra sem correção', orig.join(','));
  await page.evaluate(() => window.__foco.playback.setCompareOriginal(false));

  console.log('Sessão ORIGINAL vs EDIÇÃO DA IA');
  const sess = await page.evaluate(() => !!window.__foco.ai.aiStore.get().session);
  check(sess, 'sessão da IA aberta');
  check(await page.locator('[data-testid="ai-session"]').isVisible(), 'barra de comparação visível no preview');
  await page.locator('[data-testid="ai-session"] button', { hasText: 'Desfazer' }).click();
  const undone = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips)[0].color);
  check(!undone, '"Desfazer" reverte toda a edição da IA');
  await page.keyboard.press('Control+Shift+z');

  console.log('Áudio');
  await page.evaluate(() => window.__foco.ai.runManual({ type: 'enhance_audio', preset: 'podcast' }));
  const fx = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips)[0].audio);
  check(fx && fx.preset === 'podcast' && fx.compressor && fx.highpass > 0, 'cadeia de áudio configurada', JSON.stringify(fx));
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  const routed = await page.evaluate(() => window.__foco.playback.routes.size);
  check(routed >= 1, 'preview roteado pela Web Audio (mesma cadeia do export)', routed);

  console.log('Gráfico + keyframes');
  const titleId = await page.evaluate(() => {
    const f = window.__foco;
    const patch = f.store.execute(f.Cmd.addTitle({ template: 'title', text: 'FELICIDADE', at: 1, duration: 2.5 }));
    return f.createdIds(patch, 'clips')[0];
  });
  await page.evaluate(() => window.__foco.playback.seek(2));
  await page.waitForTimeout(400);
  const titlePx = await page.evaluate(() => {
    const c = document.querySelector('.viewer canvas');
    const d = c.getContext('2d').getImageData(0, Math.round(c.height * 0.4), c.width, Math.round(c.height * 0.2)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) n++;
    return n;
  });
  check(titlePx > 300, 'título aparece no preview', `${titlePx} px brancos`);
  check(await page.locator('.clip.title').count() === 1, 'clipe de gráfico na timeline (trilha Gráficos)');

  // keyframe de escala no clipe de vídeo: 1 → 2 entre 0 e 2 s
  const scales = await page.evaluate(() => {
    const f = window.__foco;
    const clip = Object.values(f.store.getState().project.clips).find((c) => !c.title);
    f.store.execute(f.Cmd.setKeyframes({ [clip.id]: { scale: [{ t: 0, v: 1, ease: 'linear' }, { t: 2, v: 2, ease: 'linear' }] } }));
    const c2 = f.store.getState().project.clips[clip.id];
    return [0, 1, 2, 3].map((t) => f.anim.transformAt(c2, t).scale);
  });
  check(JSON.stringify(scales) === '[1,1.5,2,2]', 'keyframes interpolam no tempo da mídia', scales.join(','));
  check((await page.locator('.kf-dot').count()) >= 2, 'keyframes desenhados no clipe');
  if (shots) await page.screenshot({ path: path.join(shots, 'fx.png') });

  console.log('Validador');
  const v = await page.evaluate(() =>
    window.__foco.commands.validateCommands([{ type: 'auto_color' }, { type: 'rm -rf' }, { type: 'add_title', template: 'title', text: '', at: 1, duration: 2 }], { duration: 4 }),
  );
  check(v.commands.length === 1 && v.errors.length === 2, 'comandos inválidos são descartados', v.errors.join(' | '));

  console.log('Export com cor, áudio, gráfico e keyframes');
  const exp = await page.evaluate(() => window.__foco.exportAndProbe({ width: 1280, height: 720, fps: 30, bitrate: 4_000_000, codec: 'avc' }));
  check(exp.width === 1280 && exp.audioCodec === 'aac' && Math.abs(exp.duration - 4) < 0.1, 'MP4 exportado', `${exp.width}x${exp.height} ${exp.duration.toFixed(2)} s`);
  void titleId;

  check(errors.length === 0, 'sem erros no console', errors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
