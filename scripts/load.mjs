// Testes de carga da Fase 2 (medições reais num navegador real).
// Uso: node scripts/load.mjs [testes]   ex.: node scripts/load.mjs t1,t2,t6
//   t1 = 1080p 10 min · t2 = 4K 20 min · t3 = 4K 60 min · t4 = 4K 2 h
//   t5 = 10 vídeos simultâneos · t6 = 500 clipes · t7 = 1000 clipes
// Saída: tabela no console + JSON em scripts/load-results/<data>.json
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const which = (process.argv[2] ?? 't1,t2,t6').split(',');
const TESTS = {
  t1: { label: '1080p · 10 min', videos: [{ seconds: 600, width: 1920, height: 1080, fps: 30, bitrate: 3_000_000 }] },
  t2: { label: '4K · 20 min', videos: [{ seconds: 1200, width: 3840, height: 2160, fps: 30, bitrate: 6_000_000 }] },
  t3: { label: '4K · 60 min', videos: [{ seconds: 3600, width: 3840, height: 2160, fps: 30, bitrate: 3_000_000 }] },
  t4: { label: '4K · 2 h', videos: [{ seconds: 7200, width: 3840, height: 2160, fps: 30, bitrate: 1_500_000 }] },
  t5: { label: '10 vídeos 1080p · 3 min cada', videos: Array.from({ length: 10 }, () => ({ seconds: 180, width: 1920, height: 1080, fps: 30, bitrate: 3_000_000 })) },
  t6: { label: 'timeline com 500 clipes', clips: 500 },
  t7: { label: 'timeline com 1000 clipes', clips: 1000 },
};

function gpuSample() {
  return new Promise((res) =>
    execFile('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits'], (err, out) => {
      if (err) return res(null);
      const [util, mem] = out.trim().split(',').map((x) => Number(x));
      res({ util, mem });
    }),
  );
}

/** Amostra GPU a cada 500 ms enquanto `fn` roda; devolve pico e média de uso. */
async function withGpu(fn) {
  const samples = [];
  let on = true;
  const loop = (async () => {
    while (on) {
      const s = await gpuSample();
      if (s) samples.push(s);
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
  const t0 = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - t0, gpu: samples.length ? { avgUtil: Math.round(samples.reduce((a, s) => a + s.util, 0) / samples.length), peakUtil: Math.max(...samples.map((s) => s.util)), peakMemMB: Math.max(...samples.map((s) => s.mem)) } : null };
  } finally {
    on = false;
    await loop;
  }
}

const server = await createServer({ server: { port: 5192, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const work = path.join(os.tmpdir(), 'foco-load');
fs.mkdirSync(work, { recursive: true });
const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  channel: 'msedge',
  headless: !!process.env.LOAD_HEADLESS,
  viewport: { width: 1600, height: 950 },
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'],
});
  await context.addInitScript(() => {
    window.__autoDialog = (title) => (title.startsWith('Versão de recuperação') ? 'restore' : title === 'Criar proxy?' ? 'no' : title === 'Arquivo já está no projeto' ? 'import' : undefined);
  });
const page = context.pages()[0] ?? (await context.newPage());
page.on('dialog', (d) => d.accept());
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5192/');
await page.waitForFunction(() => window.__foco);

const heapMB = async () => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (n) => metrics.find((m) => m.name === n)?.value ?? 0;
  return { heapMB: Math.round(get('JSHeapUsedSize') / 1048576), taskSec: get('TaskDuration') };
};
const mainThreadBusy = async () => (await heapMB()).taskSec;
const cpuTime = async () => {
  try {
    const info = await cdp.send('SystemInfo.getProcessInfo');
    return info.processInfo.reduce((a, p) => a + p.cpuTime, 0);
  } catch {
    return null;
  }
};

// começa limpo (restos de execuções interrompidas ocupam a cota do navegador)
await page.evaluate(async () => {
  await window.__foco.cache.clearAll();
  await window.__foco.clearLoadFiles();
});
const results = { date: new Date().toISOString(), machine: { cpus: os.cpus().length, cpuModel: os.cpus()[0].model, ramGB: Math.round(os.totalmem() / 1e9) }, tests: {} };

async function fresh() {
  await page.evaluate(async () => {
    await window.__foco.actions.newProject();
    window.__foco.metrics.resetCounters();
  });
}

const step = (s) => console.log(`   [${new Date().toLocaleTimeString()}] ${s}`);

async function videoTest(id, t) {
  await fresh();
  step('gerando arquivos');
  const r = { label: t.label };
  // 1. gerar arquivos (não é métrica do editor)
  const gen = Date.now();
  await page.evaluate(async (videos) => {
    window.__loadFiles = [];
    for (const [i, v] of videos.entries()) {
      window.__loadFiles.push(await window.__foco.makeLongVideo({ name: `LOAD_${v.width}p_${v.seconds}s_${i}`, ...v, hue: (i * 37) % 360 }));
    }
  }, t.videos);
  r.generateSec = (Date.now() - gen) / 1000;
  r.fileGB = await page.evaluate(() => window.__loadFiles.reduce((a, f) => a + f.size, 0) / 1e9);

  step(`importando ${r.fileGB.toFixed(2)} GB`);
  // 2. importar + análise (metadata, thumbnail, waveform)
  const cpu0 = await mainThreadBusy();
  const ingest = await withGpu(() =>
    page.evaluate(async () => {
      const f = window.__foco;
      f.metrics.resetCounters();
      const t0 = performance.now();
      await f.actions.importItems(window.__loadFiles.map((file) => ({ file })));
      const imported = performance.now() - t0;
      const ids = Object.keys(f.store.getState().project.assets);
      // espera thumbnails, filmstrips e waveforms terminarem
      for (let i = 0; i < 20000; i++) {
        const done = ids.every((id) => {
          const e = f.media.get(id);
          return e && e.thumbnail && e.levels && (e.filmstrip || !f.store.getState().project.assets[id].hasVideo) && e.waveformProgress === undefined && !f.jobs.forAsset(id).some((j) => j.type !== 'proxy' && (j.status === 'queued' || j.status === 'processing'));
        });
        if (done) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const analyzed = performance.now() - t0;
      const names = new Set(window.__loadFiles.map((x) => x.name));
      const last = (k) => f.metrics.timings.filter((x) => x.kind === k && names.has(x.label)).reduce((a, x) => Math.max(a, x.ms), 0);
      return {
        importMs: Math.round(imported),
        totalAnalysisMs: Math.round(analyzed),
        probeMs: Math.round(last('import')),
        thumbnailMs: Math.round(last('thumbnail')),
        previewThumbsMs: Math.round(last('preview-thumbs')),
        waveformMs: Math.round(last('waveform')),
        longTasks: f.metrics.longTasks,
        longTaskMs: Math.round(f.metrics.longTaskMs),
        maxLongTaskMs: Math.round(f.metrics.maxLongTaskMs),
        meta: Object.values(f.store.getState().project.assets).map((a) => `${a.width}x${a.height} ${a.fps}fps ${a.videoCodec}/${a.audioCodec} ${Math.round(a.duration)}s`)[0],
      };
    }),
  );
  const cpu1 = await mainThreadBusy();
  Object.assign(r, ingest.value, { ingestGpu: ingest.gpu, ingestMainThreadBusySec: +(cpu1 - cpu0).toFixed(2) });
  Object.assign(r, { heapAfterImport: (await heapMB()).heapMB });

  step('proxy');
  // 3. timeline + proxy (se existir na versão em teste)
  r.proxy = await page.evaluate(async () => {
    const f = window.__foco;
    const a = Object.values(f.store.getState().project.assets)[0];
    f.actions.addAssetToTimeline(a.id);
    if (!f.media.createProxy) return 'n/d';
    f.metrics.resetCounters();
    const t0 = performance.now();
    await f.media.createProxy(a.id, '720p');
    const ms = performance.now() - t0;
    const e = f.media.get(a.id);
    return { ms: Math.round(ms), speedX: +(a.duration / (ms / 1000)).toFixed(1), sizeMB: Math.round((e.proxy.size ?? 0) / 1e6), status: e.proxy.status, longTasks: f.metrics.longTasks, maxLongTaskMs: Math.round(f.metrics.maxLongTaskMs) };
  });

  step('seek');
  // 4. seek: 12 posições aleatórias espalhadas pelo vídeo
  r.seek = await page.evaluate(async () => {
    const f = window.__foco;
    const d = Math.max(...Object.values(f.store.getState().project.clips).map((c) => c.start + c.duration));
    const out = [];
    for (let i = 0; i < 12; i++) out.push(await f.measureSeek(((i * 7919) % 100) / 100 * d * 0.98));
    out.sort((a, b) => a - b);
    return { medianMs: Math.round(out[6]), p90Ms: Math.round(out[10]), maxMs: Math.round(out[11]) };
  });

  // 5. reprodução de 5 s
  r.playback = await page.evaluate(async () => {
    const f = window.__foco;
    f.playback.seek(30);
    await new Promise((r) => setTimeout(r, 800));
    f.metrics.resetCounters();
    const fr0 = f.metrics.previewFrames;
    f.playback.play();
    await new Promise((r) => setTimeout(r, 5000));
    f.playback.pause();
    const v = document.querySelector('video') ?? [...(f.playback.pool?.values?.() ?? [])].find((e) => e instanceof HTMLVideoElement);
    const q = v?.getVideoPlaybackQuality?.();
    return { fps: +((f.metrics.previewFrames - fr0) / 5).toFixed(1), droppedFrames: q?.droppedVideoFrames ?? null, longTasks: f.metrics.longTasks, maxLongTaskMs: Math.round(f.metrics.maxLongTaskMs) };
  });

  step('export');
  // 6. export de 30 s (1080p) a partir da mídia
  const exp = await withGpu(() =>
    page.evaluate(async () => {
      const f = window.__foco;
      const clip = Object.values(f.store.getState().project.clips)[0];
      f.store.execute(f.Cmd.trimClip(clip.id, 'end', 30));
      const t0 = performance.now();
      const e = await f.exportAndProbe({ width: 1920, height: 1080, fps: 30, bitrate: 8_000_000, codec: 'avc' });
      const ms = performance.now() - t0;
      return { ms: Math.round(ms), fps: +((e.videoPackets / ms) * 1000).toFixed(1), ok: e.width === 1920 && Math.abs(e.duration - 30) < 0.2 };
    }),
  );
  r.export30s = { ...exp.value, gpu: exp.gpu };
  r.heapEnd = (await heapMB()).heapMB;
  // limpa entre testes: arquivos gerados e cache (proxies de GBs)
  await page.evaluate(async () => {
    const f = window.__foco;
    await f.actions.newProject();
    await f.cache.clearAll();
    await f.clearLoadFiles();
  });
  results.tests[id] = r;
}

async function clipsTest(id, t) {
  await fresh();
  const r = { label: t.label };
  r.build = await page.evaluate(async (n) => {
    const f = window.__foco;
    if (!Object.keys(f.store.getState().project.assets).length) {
      const file = await f.makeTestVideo({ name: 'CLIPS', seconds: 4, width: 640, height: 360, fps: 30, hue: 120, freq: 330 });
      await f.actions.importItems([{ file }]);
    }
    const a = Object.values(f.store.getState().project.assets)[0];
    const tracks = f.store.getState().project.tracks;
    const v1 = tracks.find((x) => x.name === 'V1').id;
    const a1 = tracks.find((x) => x.name === 'A1').id;
    const cmds = [];
    for (let i = 0; i < n; i++) {
      const c = f.ops.createClip(a, i % 2 ? a1 : v1, i * 1.5);
      c.duration = 1.2;
      cmds.push(f.Cmd.addClip(c));
    }
    const t0 = performance.now();
    f.store.execute(f.Cmd.batch(`${n} clipes`, cmds));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { executeAndPaintMs: Math.round(performance.now() - t0), domClips: document.querySelectorAll('.clip').length };
  }, t.clips);

  // rolar a timeline inteira e medir quadros
  r.scroll = await page.evaluate(async () => {
    const el = document.querySelector('[data-testid="timeline-scroll"]');
    const f = window.__foco;
    f.metrics.resetCounters();
    const times = [];
    let last = performance.now();
    for (let i = 0; i < 60; i++) {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) * (i / 59);
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    times.sort((a, b) => a - b);
    return { medianFrameMs: +times[30].toFixed(1), p95FrameMs: +times[56].toFixed(1), worstFrameMs: +times[59].toFixed(1), longTasks: f.metrics.longTasks };
  });

  // zoom e um gesto de mover no meio de muitos clipes
  r.zoomAndEdit = await page.evaluate(async () => {
    const f = window.__foco;
    const t0 = performance.now();
    for (const z of [10, 4, 1, 40, 200]) {
      f.store.setZoom(z);
      await new Promise((r) => requestAnimationFrame(r));
    }
    const zoomMs = performance.now() - t0;
    const c = Object.values(f.store.getState().project.clips)[10];
    const t1 = performance.now();
    f.store.execute(f.Cmd.moveClips([{ id: c.id, start: c.start + 0.1, trackId: c.trackId }]));
    await new Promise((r) => requestAnimationFrame(r));
    const editMs = performance.now() - t1;
    const t2 = performance.now();
    f.store.undo();
    await new Promise((r) => requestAnimationFrame(r));
    return { zoom5StepsMs: Math.round(zoomMs), moveMs: Math.round(editMs), undoMs: Math.round(performance.now() - t2) };
  });
  r.heapMB = (await heapMB()).heapMB;
  results.tests[id] = r;
}

for (const id of which) {
  const t = TESTS[id];
  if (!t) continue;
  console.log(`\n== ${id}: ${t.label}`);
  try {
    if (t.clips) await clipsTest(id, t);
    else await videoTest(id, t);
    console.log(JSON.stringify(results.tests[id], null, 1));
  } catch (e) {
    results.tests[id] = { label: t.label, error: String(e).slice(0, 500) };
    console.log('ERRO', String(e).slice(0, 500));
  }
}
await page.evaluate(() => window.__foco.clearLoadFiles());
results.pageErrors = errors;
const outDir = path.join(import.meta.dirname, 'load-results');
fs.mkdirSync(outDir, { recursive: true });
const tag = process.env.LOAD_TAG ?? 'run';
fs.writeFileSync(path.join(outDir, `${tag}-${results.date.slice(0, 19).replace(/[:T]/g, '-')}.json`), JSON.stringify(results, null, 2));
await context.close();
await server.close();
process.exit(0);
