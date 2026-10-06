// Extrai quadros de um vídeo em PNG (1920x1080) usando o decodificador do próprio FOCO Editor
// (Mediabunny + WebCodecs no Edge). Funciona com HEVC/4K, que o Pillow não lê.
//
// Uso: node extract_frames.mjs <video> <t1,t2,...> <pastaSaida> [prefixo]
//   Sem tempos explícitos ("auto"), pega 6 pontos espalhados pelo vídeo.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const EDITOR = path.resolve(import.meta.dirname, '../../../..');
const req = createRequire(path.join(EDITOR, 'package.json'));
const { chromium } = req('playwright-core');
const { createServer } = await import('file:///' + path.join(EDITOR, 'node_modules/vite/dist/node/index.js').split(path.sep).join('/'));

const [video, timesArg = 'auto', outDir = 'frames', prefix = 'frame'] = process.argv.slice(2);
if (!video) {
  console.error('uso: node extract_frames.mjs <video> <t1,t2,...|auto> <pastaSaida> [prefixo]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const port = 5300 + Math.floor(Math.random() * 400);
const server = await createServer({ root: EDITOR, configFile: path.join(EDITOR, 'vite.config.ts'), server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge', headless: false });
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.__foco);
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'vf'; document.body.appendChild(i); });
  await page.setInputFiles('#vf', path.resolve(video));
  const res = await page.evaluate(async (timesArg) => {
    const mb = await import('/node_modules/.vite/deps/mediabunny.js').catch(() => import('mediabunny'));
    const input = new mb.Input({ source: new mb.BlobSource(document.getElementById('vf').files[0]), formats: mb.ALL_FORMATS });
    const v = await input.getPrimaryVideoTrack();
    const dur = await input.computeDuration();
    const times = timesArg === 'auto' ? Array.from({ length: 6 }, (_, i) => +((dur * (i + 0.5)) / 6).toFixed(2)) : timesArg.split(',').map(Number);
    const sink = new mb.CanvasSink(v, { width: 1920, height: 1080, fit: 'contain' });
    const frames = [];
    for (const t of times) {
      const w = await sink.getCanvas(Math.min(t, dur - 0.05));
      if (!w) continue;
      const c = w.canvas;
      const blob = await (c.convertToBlob ? c.convertToBlob({ type: 'image/png' }) : new Promise((r) => c.toBlob(r, 'image/png')));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      frames.push({ t, b64: btoa(s) });
    }
    return { dur, codec: await v.getCodec(), frames };
  }, timesArg);
  for (const f of res.frames) {
    const p = path.join(outDir, `${prefix}-${f.t}.png`);
    fs.writeFileSync(p, Buffer.from(f.b64, 'base64'));
    console.log(p);
  }
  console.error(`duração ${res.dur.toFixed(1)} s · codec ${res.codec}`);
} finally {
  await browser.close();
  await server.close();
}
