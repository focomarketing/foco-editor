// Fase 2 ponta a ponta: ingestão com status, metadados, fila de jobs, cache, duplicatas,
// proxy (criar / cancelar / usar / desligar), offline + relink por hash, arquivo alterado,
// recuperação, backups, salvar/abrir pelo menu, export como job e Performance Panel.
// Os seletores de arquivo do sistema são trocados por arquivos reais no disco privado
// do navegador (OPFS) — o resto do fluxo é o mesmo do usuário.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

// mídia gravada pelo editor vai para uma pasta temporária, não para Documentos
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
process.env.FOCO_PROJECTS_DIR ??= path.join(os.tmpdir(), 'foco-e2e-projetos');
const server = await createServer({ server: { port: 5191, strictPort: true }, logLevel: 'error' });
await server.listen();
const profile = path.join(os.tmpdir(), 'foco-e2e-phase2');
fs.rmSync(profile, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge',
  headless: !process.env.E2E_HEADED,
  viewport: { width: 1680, height: 980 },
  args: ['--autoplay-policy=no-user-gesture-required'],
});
await context.addInitScript(() => {
  window.__dialogs = [];
  window.__answers = {};
  window.__autoDialog = (title) => {
    window.__dialogs.push(title);
    return window.__answers[title] ?? (title.startsWith('Versão de recuperação') ? 'restore' : title === 'Criar proxy?' ? 'no' : undefined);
  };
  // Seletores do sistema → arquivos reais no OPFS (não dá para clicar em janelas nativas num teste).
  const dir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-files', { create: true });
  window.showSaveFilePicker = async ({ suggestedName } = {}) => (await dir()).getFileHandle(window.__saveAs ?? suggestedName ?? 'arquivo', { create: true });
  window.showOpenFilePicker = async () => {
    const d = await dir();
    return Promise.all((window.__openNames ?? []).map((n) => d.getFileHandle(n)));
  };
});

const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => d.accept());
const _wff = page.waitForFunction.bind(page);
page.waitForFunction = (fn, arg, opts = {}) => _wff(fn, arg, { polling: 200, ...opts });
const go = async () => {
  await page.goto('http://localhost:5191/');
  await page.waitForFunction(() => window.__foco);
};
await go();
const ev = (fn, arg) => page.evaluate(fn, arg);

try {
  console.log('Ingestão: status, metadados, jobs');
  await ev(async () => {
    const f = window.__foco;
    // 4K 60 fps, 2 min, escrito no OPFS e importado COM handle (como pelo seletor de arquivos)
    const file = await f.makeLongVideo({ name: 'CAMERA_4K60', seconds: 120, width: 3840, height: 2160, fps: 60, bitrate: 8_000_000 });
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-files', { create: true });
    const h = await d.getFileHandle('CAMERA_4K60.mp4', { create: true });
    const w = await h.createWritable();
    await w.write(file);
    await w.close();
    window.__openNames = ['CAMERA_4K60.mp4'];
  });
  const sawPending = ev(async () => {
    for (let i = 0; i < 200; i++) {
      if (document.querySelector('[data-testid="pending-import"]')) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return false;
  });
  await ev(() => window.__foco.actions.importMedia());
  check(await sawPending, 'mídia aparece no bin como "Analisando" enquanto o job roda');
  await page.waitForFunction(() => Object.keys(window.__foco.store.getState().project.assets).length === 1);
  const asset = await ev(() => Object.values(window.__foco.store.getState().project.assets)[0]);
  check(asset.width === 3840 && asset.height === 2160 && Math.round(asset.fps) === 60 && asset.videoCodec === 'avc' && asset.audioCodec === 'aac', 'metadados: resolução, fps, codecs', `${asset.width}x${asset.height} ${asset.fps}fps`);
  check(asset.sampleRate === 48000 && asset.audioChannels === 2 && asset.bitrate > 0 && !!asset.metadata?.videoCodecString && !!asset.hash, 'metadados: sample rate, canais, bitrate, codec string, hash', `${asset.sampleRate} Hz · ${asset.audioChannels} ch · ${(asset.bitrate / 1e6).toFixed(1)} Mbps · ${asset.metadata?.videoCodecString} · ${asset.hash?.slice(0, 8)}`);
  check(await page.locator('[data-testid="asset-status"]').first().textContent() !== null, 'status visível no Media Bin');
  await page.waitForFunction(() => {
    const f = window.__foco;
    const id = Object.keys(f.store.getState().project.assets)[0];
    const e = f.media.get(id);
    return e.thumbnail && e.filmstrip && e.waveMips && e.previewThumbs && !f.jobs.forAsset(id).some((j) => j.type !== 'proxy' && (j.status === 'queued' || j.status === 'processing'));
  }, null, { timeout: 120000 });
  const jobTypes = await ev(() => window.__foco.jobs.jobs.map((j) => `${j.type}:${j.status}`));
  check(['analyze:completed', 'thumbnail:completed', 'preview-thumbs:completed', 'waveform:completed'].every((t) => jobTypes.includes(t)), 'cada etapa virou um job concluído', jobTypes.join(' '));
  check(await ev(() => window.__dialogs.includes('Criar proxy?')), 'arquivo 4K60 pesado → sugestão de proxy');
  const mips = await ev(() => window.__foco.media.get(Object.keys(window.__foco.store.getState().project.assets)[0]).waveMips.map((m) => m.length));
  check(mips.length > 5 && mips[0] === 12000, 'waveform em várias resoluções', mips.slice(0, 6).join(' → '));

  console.log('Cache');
  const cacheKinds = await ev(async () => (await window.__foco.cache.entries()).map((e) => e.kind));
  check(['thumbnail', 'filmstrip', 'preview-thumbs', 'waveform'].every((k) => cacheKinds.includes(k)), 'thumbnails, filmstrip, scrubbing e waveform no cache central', [...new Set(cacheKinds)].join(', '));
  const before = await ev(() => window.__foco.jobs.jobs.length);
  await ev(async () => {
    window.__answers['Arquivo já está no projeto'] = 'existing';
    await window.__foco.actions.importMedia();
  });
  check(await ev(() => window.__dialogs.includes('Arquivo já está no projeto')), 'reimportar o mesmo arquivo → aviso de duplicata');
  check(await ev(() => Object.keys(window.__foco.store.getState().project.assets).length === 1), '"Usar o existente" não duplica a mídia');
  // nova sessão: o cache evita gerar tudo de novo
  await ev(async () => {
    const f = window.__foco;
    f.metrics.timings.length = 0;
    const a = Object.values(f.store.getState().project.assets)[0];
    f.media.release(a.id);
    const h = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-files')).getFileHandle('CAMERA_4K60.mp4');
    await f.media.linkFile(a, await h.getFile(), h);
  });
  await page.waitForFunction(() => {
    const f = window.__foco;
    const id = Object.keys(f.store.getState().project.assets)[0];
    const e = f.media.get(id);
    return e?.waveMips && e.previewThumbs && e.filmstrip;
  }, null, { timeout: 30000 });
  const reuse = await ev(() => Object.fromEntries(window.__foco.metrics.timings.map((t) => [t.kind, Math.round(t.ms)])));
  check((reuse.waveform ?? 0) < 300 && (reuse['preview-thumbs'] ?? 0) < 600, 'segunda abertura usa o cache (não recalcula)', JSON.stringify(reuse));

  console.log('Proxy');
  await ev(() => window.__foco.actions.addAssetToTimeline(Object.keys(window.__foco.store.getState().project.assets)[0]));
  await page.locator('[data-testid="create-proxy"]').selectOption('720p');
  await page.waitForFunction(() => {
    const f = window.__foco;
    return f.media.get(Object.keys(f.store.getState().project.assets)[0]).proxy.status === 'processing';
  });
  await ev(() => window.__foco.media.cancelProxy(Object.keys(window.__foco.store.getState().project.assets)[0]));
  await page.waitForFunction(() => window.__foco.media.get(Object.keys(window.__foco.store.getState().project.assets)[0]).proxy.status === 'cancelled');
  check(true, 'proxy em andamento cancelado');
  const t0 = Date.now();
  await ev(() => window.__foco.media.createProxy(Object.keys(window.__foco.store.getState().project.assets)[0], '720p'));
  const proxy = await ev(() => window.__foco.media.get(Object.keys(window.__foco.store.getState().project.assets)[0]).proxy);
  check(proxy.status === 'ready' && proxy.size > 100000, 'proxy 720p gerado (tentativa nova depois de cancelar)', `${(proxy.size / 1e6).toFixed(1)} MB em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const probe = await ev(async (url) => {
    const f = window.__foco;
    const a = Object.values(f.store.getState().project.assets)[0];
    const b = (await f.cache.get('proxy', `${a.hash}|720p`)).file;
    // o <video> do preview consegue abrir a URL do proxy?
    const el = document.createElement("video");
    el.muted = true;
    el.src = url;
    await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('video: ' + el.error?.message)); });
    const r = await f.probeBlob(b);
    return { w: r.w, h: r.h, d: r.d };
  }, proxy.url);
  check(probe.w === 1280 && probe.h === 720 && Math.abs(probe.d - 120) < 0.2, 'proxy é 1280×720 com a mesma duração', JSON.stringify(probe));
  await ev(() => window.__foco.playback.seek(30));
  await page.waitForTimeout(500);
  const src = await ev(() => [...window.__foco.playback.pool.values()][0]?.dataset.src);
  check(src === proxy.url, 'preview usa o proxy');
  await page.locator('[data-testid="proxy-toggle"]').click();
  await page.waitForTimeout(500);
  const src2 = await ev(() => [...window.__foco.playback.pool.values()][0]?.dataset.src);
  check(src2 && src2 !== proxy.url, 'Proxy OFF → preview volta ao original');
  await page.locator('[data-testid="proxy-toggle"]').click();
  const seeks = await ev(async () => {
    const f = window.__foco;
    const out = [];
    for (let i = 0; i < 8; i++) out.push(await f.measureSeek(5 + i * 13));
    return out.sort((a, b) => a - b)[4];
  });
  check(seeks < 120, 'seek com proxy (mediana)', `${Math.round(seeks)} ms`);

  console.log('Export (diálogo → job → arquivo real)');
  await ev(() => {
    const f = window.__foco;
    const c = Object.values(f.store.getState().project.clips)[0];
    f.store.execute(f.Cmd.trimClip(c.id, 'end', 6));
    window.__saveAs = 'export-teste.mp4';
  });
  await page.keyboard.press('Control+e');
  await page.locator('[data-testid="export-start"]').click();
  await page.waitForFunction(() => window.__foco.jobs.jobs.some((j) => j.type === 'export' && j.status === 'completed'), null, { timeout: 120000 });
  const exported = await ev(async () => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-files');
    const f = await (await d.getFileHandle('export-teste.mp4')).getFile();
    return window.__foco.probeBlob(f);
  });
  check(exported.w === 1920 && Math.abs(exported.d - 6) < 0.15, 'export como job gravou o MP4 a partir do ORIGINAL 4K', `${exported.w}px · ${exported.d.toFixed(2)} s · ${(exported.size / 1e6).toFixed(1)} MB`);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 300);

  console.log('Salvar / abrir pelo menu, backups');
  await ev(() => { window.__saveAs = 'projeto-teste.foco'; });
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => !window.__foco.store.getState().dirty);
  const backups = await ev(async () => (await window.__foco.projectFile.backups(window.__foco.store.getState().project.id)).map((b) => b.reason));
  check(backups.includes('manual'), 'salvar cria versão no histórico', backups.join(','));
  const savedClips = await ev(() => Object.keys(window.__foco.store.getState().project.clips).length);

  console.log('Recuperação após fechar sem salvar');
  await ev(() => window.__foco.store.execute(window.__foco.Cmd.addMarker({ id: 'mx', time: 2, label: 'não salvo', color: '#f00' })));
  await page.waitForTimeout(1500);
  await go();
  await page.waitForFunction(() => window.__dialogs.some((t) => t.startsWith('Versão de recuperação')));
  check(true, 'ao reabrir: "versão de recuperação disponível"');
  await page.waitForFunction(() => window.__foco.store.getState().project.markers.some((m) => m.id === 'mx'));
  check(true, 'Restaurar trouxe a alteração não salva');
  const st = await ev(() => window.__foco.media.get(Object.keys(window.__foco.store.getState().project.assets)[0])?.status);
  check(st === 'ready' || st === 'needs-permission', 'mídia religada pelo handle ao reabrir', st);

  console.log('Arquivo alterado e arquivo sumido (fora do editor)');
  await ev(async () => {
    const f = window.__foco;
    const a = Object.values(f.store.getState().project.assets)[0];
    if (f.media.get(a.id).status !== 'ready') await f.media.reconnect([a]);
    const h = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-files')).getFileHandle('CAMERA_4K60.mp4');
    const w = await h.createWritable({ keepExistingData: true });
    await w.seek((await h.getFile()).size);
    await w.write(new Uint8Array(1024));
    await w.close();
  });
  await ev(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => window.__foco.media.get(Object.keys(window.__foco.store.getState().project.assets)[0]).status === 'changed');
  check(true, 'arquivo modificado fora do editor → status "Alterado" (sem atualizar sozinho)');
  await ev(() => window.__foco.actions.reloadChangedMedia(Object.keys(window.__foco.store.getState().project.assets)[0]));
  await page.waitForFunction(() => window.__foco.media.get(Object.keys(window.__foco.store.getState().project.assets)[0]).status === 'ready');
  check(true, '"Recarregar" reanalisa e volta a "Pronto"');
  await ev(async () => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-files');
    const f = await (await d.getFileHandle('CAMERA_4K60.mp4')).getFile();
    window.__keep = new File([await f.arrayBuffer()], 'CAMERA_4K60.mp4', { type: 'video/mp4' });
    await d.removeEntry('CAMERA_4K60.mp4');
  });
  await ev(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => window.__foco.media.get(Object.keys(window.__foco.store.getState().project.assets)[0]).status === 'offline');
  check(await page.locator('text=Localizar mídia').count() > 0, 'arquivo apagado → "Offline" com "Localizar mídia"');
  const relinked = await ev(async () => {
    const f = window.__foco;
    const renamed = new File([window.__keep], 'renomeado.mp4', { type: 'video/mp4' });
    return f.media.relink(Object.values(f.store.getState().project.assets), [{ file: renamed }]);
  });
  check(relinked === 1, 'relink pelo hash do conteúdo mesmo com outro nome de arquivo');

  console.log('Configurações, armazenamento, Performance Panel');
  await page.waitForFunction(() => !window.__foco.jobs.active.length, null, { timeout: 120000 });
  await page.getByRole('button', { name: /Arquivo/ }).click();
  await page.locator('[data-testid="menu-settings"]').click();
  await page.waitForFunction(() => /[1-9]/.test(document.querySelector('[data-testid="cache-total"]')?.textContent ?? ''));
  check(true, 'monitor de armazenamento mostra o tamanho do cache', await page.locator('[data-testid="cache-total"]').textContent());
  if (shots) await page.screenshot({ path: path.join(shots, 'settings.png') });
  await page.getByRole('button', { name: 'Fechar' }).click();
  await page.keyboard.press('Control+Shift+P');
  check(await page.locator('[data-testid="perf-panel"]').isVisible(), 'Performance Panel (Ctrl+Shift+P)');
  await page.locator('[data-testid="jobs-button"]').click();
  check((await page.locator('[data-testid="job-item"]').count()) > 3, 'painel de tarefas lista os jobs');
  if (shots) await page.screenshot({ path: path.join(shots, 'phase2.png') });

  check(errors.length === 0, 'sem erros no console', errors.join(' | ').slice(0, 400));
  check(savedClips >= 1, 'projeto salvo tinha a edição');
} finally {
  await context.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
