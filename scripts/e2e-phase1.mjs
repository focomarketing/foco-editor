// Roteiro manual obrigatório da Fase 1, automatizado num navegador real (Edge).
// Uso: npm run test:e2e:phase1   (E2E_HEADED=1 para assistir, E2E_SHOTS=pasta para screenshots)
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
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// mídia gravada pelo editor vai para uma pasta temporária, não para Documentos
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
process.env.FOCO_PROJECTS_DIR ??= path.join(os.tmpdir(), 'foco-e2e-projetos');
const server = await createServer({ server: { port: 5193, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge', headless: !process.env.E2E_HEADED, args: ['--autoplay-policy=no-user-gesture-required'] });

const S = (page) => page.evaluate(() => {
  const st = window.__foco.store.getState();
  return { clips: Object.values(st.project.clips), tracks: st.project.tracks, project: st.project, selection: st.selection };
});
const onTrack = (state, name) => {
  const t = state.tracks.find((x) => x.name === name);
  return state.clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start);
};
const numberField = (page, label) => page.locator('.field', { has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) }).locator('input[type=number]');

try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
  await page.addInitScript(() => {
    window.__autoDialog = (title) => (title.startsWith('Versão de recuperação') ? 'restore' : title === 'Criar proxy?' ? 'no' : undefined);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5193/');
  await page.waitForFunction(() => window.__foco);

  console.log('1. Novo projeto');
  await page.evaluate(() => window.__foco.actions.newProject());
  check((await S(page)).clips.length === 0, 'projeto vazio criado');

  console.log('2–3. Importar vídeo e áudio');
  const files = await page.evaluate(async () => {
    const f = window.__foco;
    const video = await f.makeTestVideo({ name: 'VIDEO', seconds: 6, width: 640, height: 360, fps: 30, hue: 0, freq: 440 });
    const audio = await f.makeTestAudio({ name: 'MUSICA', seconds: 8, freq: 660 });
    await f.actions.importItems([{ file: video }, { file: audio }]);
    for (const a of Object.values(f.store.getState().project.assets)) await f.media.whenLevels(a.id);
    const b64 = async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    };
    return { video: await b64(video), audio: await b64(audio) };
  });
  await page.waitForFunction(() => document.querySelectorAll('.asset').length === 2);
  check(true, 'vídeo e áudio no Media Bin');
  await page.locator('[data-testid="bin-search"]').fill('MUS');
  check((await page.locator('.asset').count()) === 1, 'busca no Media Bin filtra', 'MUS → 1 item');
  await page.locator('[data-testid="bin-search"]').fill('');

  console.log('4–5. Colocar vídeo e áudio na timeline (arrastar)');
  await page.locator('.asset[data-asset="VIDEO.mp4"]').dragTo(page.locator('.lane[data-track="V1"]'), { targetPosition: { x: 4, y: 30 } });
  await page.locator('.asset[data-asset="MUSICA.m4a"]').dragTo(page.locator('.lane[data-track="A1"]'), { targetPosition: { x: 4, y: 25 } });
  let st = await S(page);
  check(onTrack(st, 'V1').length === 1 && onTrack(st, 'A1').length === 1, 'clipes criados por arrastar', `${onTrack(st, 'V1').length} vídeo, ${onTrack(st, 'A1').length} áudio`);

  console.log('6. Reproduzir');
  await page.locator('.viewer canvas').click();
  await page.waitForTimeout(1300);
  const play = await page.evaluate(() => window.__foco.playback.getSnapshot());
  check(play.playing && play.time > 0.8, 'reprodução avança', play.time.toFixed(2));
  await page.keyboard.press('Space');
  const px = await page.evaluate(() => {
    const c = document.querySelector('.viewer canvas');
    return [...c.getContext('2d').getImageData(c.width / 2, c.height * 0.15, 1, 1).data].slice(0, 3);
  });
  check(px[0] > px[2] && px[0] > 30, 'preview mostra o vídeo', px.join(','));

  console.log('7. Split (S)');
  await page.evaluate(() => window.__foco.playback.seek(2));
  await page.evaluate(() => window.__foco.store.select([]));
  await page.keyboard.press('s');
  st = await S(page);
  check(onTrack(st, 'V1').length === 2 && onTrack(st, 'A1').length === 2, 'vídeo e áudio divididos no playhead');
  check(near(onTrack(st, 'V1')[1].sourceIn, 2, 0.001), 'parte B continua apontando para o mesmo arquivo (entrada em 2 s)');

  console.log('8. Mover clipe');
  const zoom = await page.evaluate(() => window.__foco.store.getState().zoom);
  const second = onTrack(st, 'V1')[1];
  let box = await page.locator(`[data-clip="${second.id}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + zoom, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  st = await S(page);
  check(near(st.project.clips[second.id].start, 3, 0.05), 'clipe movido 1 s', st.project.clips[second.id].start.toFixed(2));

  console.log('9. Trim');
  const first = onTrack(st, 'V1')[0];
  box = await page.locator(`[data-clip="${first.id}"] .handle.r`).boundingBox();
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 3 - zoom * 0.5, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  st = await S(page);
  check(near(st.project.clips[first.id].duration, 1.5, 0.04), 'trim pela borda direita', st.project.clips[first.id].duration.toFixed(2));

  console.log('10–12. Apagar, desfazer, refazer');
  await page.locator(`[data-clip="${second.id}"]`).click();
  await page.keyboard.press('Delete');
  check(!(await S(page)).project.clips[second.id], 'Delete apagou o clipe');
  await page.keyboard.press('Control+z');
  check(!!(await S(page)).project.clips[second.id], 'Ctrl+Z trouxe de volta');
  await page.keyboard.press('Control+Shift+z');
  check(!(await S(page)).project.clips[second.id], 'Ctrl+Shift+Z refez a exclusão');
  await page.keyboard.press('Control+z');
  const hist = await page.evaluate(() => window.__foco.store.history.map((h) => h.command.type));
  check(hist.includes('SPLIT_CLIP') && hist.includes('MOVE_CLIPS') && hist.includes('TRIM_CLIP'), 'histórico guarda comandos nomeados', hist.slice(-5).join(' → '));

  console.log('13–15. Posição, escala e volume (Inspector)');
  await page.locator(`[data-clip="${first.id}"]`).click();
  await numberField(page, 'Posição X').fill('10');
  await numberField(page, 'Posição X').press('Enter');
  await numberField(page, 'Escala').fill('50');
  await numberField(page, 'Escala').press('Enter');
  const audioClip = onTrack(await S(page), 'A1')[0];
  await page.locator(`[data-clip="${audioClip.id}"]`).click();
  await numberField(page, 'Volume').fill('50');
  await numberField(page, 'Volume').press('Enter');
  st = await S(page);
  check(near(st.project.clips[first.id].transform.x, 0.1, 1e-6) && near(st.project.clips[first.id].transform.scale, 0.5, 1e-6), 'posição e escala aplicadas', JSON.stringify({ x: st.project.clips[first.id].transform.x, s: st.project.clips[first.id].transform.scale }));
  check(near(st.project.clips[audioClip.id].volume, 0.5, 1e-6), 'volume aplicado', st.project.clips[audioClip.id].volume);
  await page.evaluate(() => window.__foco.playback.seek(1));
  await page.waitForTimeout(400);
  const moved = await page.evaluate(() => {
    const c = document.querySelector('.viewer canvas');
    const d = c.getContext('2d').getImageData(Math.round(c.width * 0.08), Math.round(c.height * 0.5), 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  check(moved[0] + moved[1] + moved[2] < 60, 'preview reflete posição/escala (borda esquerda virou fundo preto)', moved.join(','));

  console.log('Extras da spec: razor, markers, J/K/L, velocidade, timecode');
  await page.keyboard.press('c');
  const audioNow = onTrack(await S(page), 'A1');
  const target = audioNow[audioNow.length - 1];
  box = await page.locator(`[data-clip="${target.id}"]`).boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  check(onTrack(await S(page), 'A1').length === audioNow.length + 1, 'Razor (C) cortou o clipe no clique');
  await page.keyboard.press('v');
  await page.evaluate(() => window.__foco.playback.seek(1));
  await page.keyboard.press('m');
  check((await S(page)).project.markers.length === 1 && (await page.locator('.marker').count()) === 1, 'M adiciona marcador na régua');
  await page.keyboard.press('l');
  await page.keyboard.press('l');
  await page.waitForTimeout(300);
  const fast = await page.evaluate(() => window.__foco.playback.getSnapshot());
  await page.keyboard.press('k');
  check(fast.playing && fast.rate === 2, 'L L = 2x para frente; K pausa', `rate ${fast.rate}`);
  const t0 = await page.evaluate(() => window.__foco.playback.time);
  await page.keyboard.press('j');
  await page.waitForTimeout(500);
  const t1 = await page.evaluate(() => window.__foco.playback.time);
  await page.keyboard.press('k');
  check(t1 < t0 - 0.2, 'J reproduz para trás', `${t0.toFixed(2)} → ${t1.toFixed(2)}`);
  const tcBefore = await page.locator('[data-testid="timecode"]').textContent();
  await page.locator('[data-testid="timecode"]').click();
  const tcAfter = await page.locator('[data-testid="timecode"]').textContent();
  check(/:\d\d$/.test(tcBefore) && /\.\d{3}$/.test(tcAfter), 'timecode alterna HH:MM:SS:FF ↔ .mmm', `${tcBefore} → ${tcAfter}`);
  await page.locator('[data-testid="timecode"]').click();
  const lastVideo = onTrack(await S(page), 'V1').at(-1);
  await page.evaluate((id) => window.__foco.store.execute(window.__foco.Cmd.setSpeed([id], 2)), lastVideo.id);
  check(near((await S(page)).project.clips[lastVideo.id].duration, lastVideo.duration / 2, 1e-6), 'velocidade 2x encurta o clipe', `${lastVideo.duration} → ${(await S(page)).project.clips[lastVideo.id].duration}`);
  if (shots) await page.screenshot({ path: path.join(shots, 'phase1.png') });

  console.log('16. Salvar (formato do arquivo .foco)');
  const saved = await page.evaluate(() => window.__foco.serialize(window.__foco.store.getState().project, []));
  check(saved.includes('"format":"foco-editor-project"') && saved.includes('"version":2'), 'projeto serializado com a estrutura da edição', `${saved.length} bytes`);
  const before = (await S(page)).project;
  await page.waitForTimeout(1600); // autosave

  console.log('17–18. Fechar e abrir novamente');
  await page.reload();
  await page.waitForFunction(() => window.__foco);
  // A recuperação roda depois do primeiro render (lê o IndexedDB): espera ela terminar.
  await page.waitForFunction(() => Object.keys(window.__foco.store.getState().project.clips).length > 0, null, { polling: 200, timeout: 10000 }).catch(() => {});
  const restored = (await S(page)).project;
  check(JSON.stringify({ ...restored, updatedAt: 0 }) === JSON.stringify({ ...before, updatedAt: 0 }), 'autosave restaurou exatamente a mesma timeline após fechar');
  await page.evaluate(async (text) => {
    const f = window.__foco;
    const { project } = f.deserialize(text);
    await f.actions.load(project);
  }, saved);
  const reopened = (await S(page)).project;
  check(JSON.stringify({ ...reopened, updatedAt: 0 }) === JSON.stringify({ ...before, updatedAt: 0 }), 'abrir o arquivo salvo recupera timeline, cortes, posições e configurações');
  // relink: os arquivos originais continuam no disco do usuário
  const linked = await page.evaluate(async (b) => {
    const f = window.__foco;
    const toFile = (data, name, type) => new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type, lastModified: 1 });
    return f.media.relink(Object.values(f.store.getState().project.assets), [
      { file: toFile(b.video, 'VIDEO.mp4', 'video/mp4') },
      { file: toFile(b.audio, 'MUSICA.m4a', 'audio/mp4') },
    ]);
  }, files);
  check(linked === 2, 'mídias reconectadas aos arquivos originais', linked);

  console.log('19. Exportar (MP4 H.264 1080p)');
  const dur = await page.evaluate(() => Math.max(...Object.values(window.__foco.store.getState().project.clips).map((c) => c.start + c.duration)));
  const exp = await page.evaluate(() => window.__foco.exportAndProbe({ width: 1920, height: 1080, fps: 30, bitrate: 8_000_000, codec: 'avc' }));
  check(exp.width === 1920 && exp.height === 1080 && exp.videoCodec === 'avc', 'MP4 H.264 1920×1080', `${exp.width}x${exp.height} ${exp.videoCodec}`);
  check(exp.videoPackets === Math.ceil(dur * 30 - 1e-6), 'quadros = duração da timeline', `${exp.videoPackets} quadros, ${dur.toFixed(3)} s`);
  check(exp.audioCodec === 'aac' && near(exp.audioDuration, dur, 0.1), 'áudio AAC com a duração da timeline', exp.audioDuration.toFixed(2));

  console.log('20. Assistir ao vídeo exportado');
  const watched = await page.evaluate(() => window.__foco.playExported());
  check(watched.played && watched.width === 1920, 'o arquivo exportado toca num player de vídeo', JSON.stringify(watched));
  const ep = await page.evaluate(() => window.__foco.exportedPixel(0.5));
  check(ep && ep[0] > ep[2] && ep[0] > 30, 'conteúdo do export confere (quadro do vídeo vermelho)', ep?.join(','));

  check(errors.length === 0, 'sem erros no console', errors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
