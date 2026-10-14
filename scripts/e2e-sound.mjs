// Teste end-to-end da biblioteca de sons: cada som é gerado no navegador (Web Audio offline),
// e conferimos que sai com som, sem estourar, no tamanho pedido e em tempo razoável.
// Uso: npm run test:e2e:sound
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const server = await createServer({ server: { port: 5197, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge', headless: !process.env.E2E_HEADED });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5197/', { waitUntil: 'domcontentloaded' });
  const results = await page.evaluate(async () => {
    const lib = await import('/src/engine/audio/soundLibrary.ts');
    const out = [];
    for (const s of lib.SOUND_LIBRARY) {
      const duration = s.kind === 'sfx' ? s.duration : 30;
      const t0 = performance.now();
      const r = await lib.renderSound(s.id, { duration });
      const ms = performance.now() - t0;
      let peak = 0;
      let sum = 0;
      let nan = false;
      for (const c of r.channels)
        for (let i = 0; i < c.length; i++) {
          const v = c[i];
          if (!Number.isFinite(v)) nan = true;
          peak = Math.max(peak, Math.abs(v));
          sum += v * v;
        }
      const rms = Math.sqrt(sum / (r.channels[0].length * r.channels.length));
      const wav = lib.encodeWav(r.channels, r.sampleRate);
      out.push({ id: s.id, kind: s.kind, seconds: r.channels[0].length / r.sampleRate, duration, peak, rms, nan, ms, wav: wav.byteLength });
    }
    // trilha longa (3 min): o tempo de geração cabe numa etapa
    const t0 = performance.now();
    await lib.renderSound('contemplativa', { duration: 180 });
    out.push({ id: 'contemplativa-180s', ms: performance.now() - t0 });
    return out;
  });
  for (const r of results) {
    if (r.id === 'contemplativa-180s') {
      check(r.ms < 30000, 'trilha de 3 min gerada em menos de 30 s', `${(r.ms / 1000).toFixed(1)} s`);
      continue;
    }
    check(!r.nan && r.peak > 0.5 && r.peak <= 0.9 && Math.abs(r.seconds - r.duration) < 0.05 && r.rms > 0.005, `${r.kind} ${r.id}`, `pico ${r.peak.toFixed(2)} · rms ${r.rms.toFixed(3)} · ${r.seconds.toFixed(2)} s · ${Math.round(r.ms)} ms · ${(r.wav / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} falha(s)` : '\nbiblioteca de sons ok');
process.exit(failures ? 1 : 0);
