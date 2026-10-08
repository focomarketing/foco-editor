// Teste end-to-end da Fase 1 num navegador real (Edge/Chrome instalado no sistema).
// Uso: npm run test:e2e   (opcional: E2E_BROWSER=chrome, E2E_HEADED=1, E2E_SHOTS=pasta)
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
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// mídia gravada pelo editor vai para uma pasta temporária, não para Documentos
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  channel,
  headless: !process.env.E2E_HEADED,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await page.addInitScript(() => {
    window.__autoDialog = (title) => (title.startsWith('Versão de recuperação') ? 'restore' : title === 'Criar proxy?' ? 'no' : undefined);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://localhost:5199/');
  await page.waitForFunction(() => window.__foco);

  console.log('Importação');
  const assets = await page.evaluate(async () => {
    const f = window.__foco;
    const a = await f.makeTestVideo({ name: 'TAKE_A', seconds: 4, width: 640, height: 360, fps: 30, hue: 0, freq: 440 });
    const b = await f.makeTestVideo({ name: 'TAKE_B', seconds: 3, width: 640, height: 360, fps: 30, hue: 220, freq: 880 });
    await f.actions.importItems([{ file: a }, { file: b }]);
    return Object.values(f.store.getState().project.assets);
  });
  check(assets.length === 2, 'dois arquivos importados');
  const A = assets.find((x) => x.name === 'TAKE_A.mp4');
  check(A && near(A.duration, 4, 0.05), 'duração lida do container', A?.duration);
  check(A?.fps === 30 && A.width === 640 && A.height === 360, 'fps e resolução reais', `${A?.fps} ${A?.width}x${A?.height}`);
  check(A?.videoCodec === 'avc' && A.audioCodec === 'aac' && A.videoDecodable, 'codecs detectados e decodificáveis');
  await page.waitForFunction(() => {
    const f = window.__foco;
    return Object.keys(f.store.getState().project.assets).every((id) => f.media.get(id)?.thumbnail && f.media.get(id)?.waveform && f.media.get(id)?.waveformProgress === undefined);
  }, null, { timeout: 20000 });
  check(true, 'thumbnail e waveform gerados');

  console.log('Timeline (UI)');
  const lane = page.locator('.lane[data-track="V1"]');
  await page.locator('.asset', { hasText: 'TAKE_A.mp4' }).dragTo(lane, { targetPosition: { x: 5, y: 30 } });
  await page.locator('.asset', { hasText: 'TAKE_B.mp4' }).dblclick();
  let clips = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).sort((a, b) => a.start - b.start));
  check(clips.length === 2, 'arrastar da mídia + duplo clique criaram 2 clipes');
  check(clips[0]?.start === 0 && near(clips[1]?.start, 4, 0.001), 'clipes encostados (snap no 0 e append)', clips.map((c) => c.start).join(', '));

  await page.evaluate(() => window.__foco.playback.seek(2));
  await page.locator('body').click({ position: { x: 800, y: 10 } });
  await page.evaluate(() => window.__foco.store.select([]));
  await page.keyboard.press('s');
  clips = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).sort((a, b) => a.start - b.start));
  check(clips.length === 3 && near(clips[1].sourceIn, 2, 0.001), 'atalho S dividiu no playhead', clips.map((c) => `${c.start}/${c.sourceIn}`).join(' '));

  // mover o último clipe 2s para a direita arrastando com o mouse
  const zoom = await page.evaluate(() => window.__foco.store.getState().zoom);
  const last = page.locator(`[data-clip="${clips[2].id}"]`);
  const box = await last.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + zoom * 1, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2 + zoom * 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  let moved = await page.evaluate((id) => window.__foco.store.getState().project.clips[id].start, clips[2].id);
  check(near(moved, 6, 0.04), 'arrastar moveu o clipe', moved);

  await page.keyboard.press('Control+z');
  moved = await page.evaluate((id) => window.__foco.store.getState().project.clips[id].start, clips[2].id);
  check(near(moved, 4, 0.001), 'Ctrl+Z desfez o movimento como um único passo', moved);
  await page.keyboard.press('Control+Shift+z');
  moved = await page.evaluate((id) => window.__foco.store.getState().project.clips[id].start, clips[2].id);
  check(near(moved, 6, 0.04), 'Ctrl+Shift+Z refez', moved);

  // aparar o fim do primeiro clipe (0..2) em 0.5s
  const first = page.locator(`[data-clip="${clips[0].id}"] .handle.r`);
  const hb = await first.boundingBox();
  await page.mouse.move(hb.x + 3, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 3 - zoom * 0.5, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  const trimmed = await page.evaluate((id) => window.__foco.store.getState().project.clips[id].duration, clips[0].id);
  check(near(trimmed, 1.5, 0.04), 'trim pela alça', trimmed);

  // ripple delete do clipe do meio
  await page.locator(`[data-clip="${clips[1].id}"]`).click();
  await page.keyboard.press('Shift+Delete');
  clips = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).sort((a, b) => a.start - b.start));
  check(clips.length === 2 && near(clips[1].start, 4, 0.04), 'ripple delete fechou o buraco', clips.map((c) => c.start).join(', '));

  console.log('Preview');
  await page.evaluate(() => window.__foco.playback.seek(0.5));
  await page.waitForTimeout(600);
  const pixel = async () =>
    page.evaluate(() => {
      const c = document.querySelector('.viewer canvas');
      const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
  const px = await pixel();
  check(px[0] > px[2] && px[0] > 30, 'canvas mostra o quadro do TAKE_A (vermelho)', px.join(','));
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  const t = await page.evaluate(() => window.__foco.playback.getSnapshot());
  check(t.playing && t.time > 1.0, 'reprodução avança o relógio', t.time.toFixed(2));
  await page.keyboard.press('Space');
  await page.evaluate(() => window.__foco.playback.seek(4.5));
  await page.waitForTimeout(700);
  const px2 = await pixel();
  check(px2[2] > px2[0], 'após o corte o preview mostra o TAKE_B (azul)', px2.join(','));
  if (shots) await page.screenshot({ path: path.join(shots, 'editor.png') });

  console.log('Export');
  const exp = await page.evaluate(() => window.__foco.exportAndProbe({ width: 1280, height: 720, fps: 30, bitrate: 4_000_000, codec: 'avc' }));
  const dur = await page.evaluate(() => {
    const cs = Object.values(window.__foco.store.getState().project.clips);
    return Math.max(...cs.map((c) => c.start + c.duration));
  });
  check(exp.width === 1280 && exp.height === 720 && exp.videoCodec === 'avc', 'MP4 H.264 1280x720', `${exp.width}x${exp.height} ${exp.videoCodec}`);
  check(exp.videoPackets === Math.ceil(dur * 30 - 1e-6), 'número de quadros = duração da timeline', `${exp.videoPackets} quadros, timeline ${dur.toFixed(3)}s`);
  check(exp.audioCodec === 'aac' && near(exp.audioDuration, dur, 0.1), 'áudio AAC com a duração da timeline', exp.audioDuration.toFixed(3));
  check(exp.bytes > 50_000, 'arquivo com conteúdo', `${exp.bytes} bytes`);

  console.log('Autosave / reabrir');
  await page.waitForTimeout(1600);
  await page.reload();
  await page.waitForFunction(() => window.__foco);
  await page.waitForFunction(() => Object.keys(window.__foco.store.getState().project.clips).length > 0, null, { polling: 200, timeout: 10000 }).catch(() => {});
  const restored = await page.evaluate(() => Object.keys(window.__foco.store.getState().project.clips).length);
  check(restored === 2, 'projeto restaurado do autosave após recarregar', restored);
  // mídia sem vínculo com o disco foi gravada na pasta de mídia do FOCO ao importar: volta sozinha
  await page.waitForFunction(() => Object.values(window.__foco.store.getState().project.assets).every((a) => window.__foco.media.get(a.id)?.status === 'ready'), null, { timeout: 15000 }).catch(() => {});
  const statuses = await page.evaluate(() => Object.values(window.__foco.store.getState().project.assets).map((a) => window.__foco.media.get(a.id)?.status));
  check(statuses.length > 0 && statuses.every((s) => s === 'ready'), 'mídia sem vínculo volta do disco do PC ao recarregar (sem "offline")', statuses.join(','));

  check(errors.length === 0, 'sem erros no console', errors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  await server.close();
}

console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
