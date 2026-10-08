// Teste ponta a ponta da aba Corte com uma fala real.
// Uso: CUT_VIDEO="C:/caminho/fala.mp4" node scripts/e2e-cut.mjs   (E2E_SHOTS=pasta para capturas)
// Importa o vídeo, transcreve (Whisper base, local), analisa nos três ritmos, aplica o
// "Dinâmico" pela tela, confere a conferência e desfaz com um Ctrl+Z.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';

const video = process.env.CUT_VIDEO;
if (!video) {
  console.error('Defina CUT_VIDEO com o caminho de um vídeo com fala.');
  process.exit(2);
}
const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const server = await createServer({ server: { port: 5196, strictPort: true }, logLevel: 'error' });
await server.listen();
const context = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'foco-e2e-cut'), {
  channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge',
  headless: !process.env.E2E_HEADED,
  viewport: { width: 1600, height: 950 },
  args: ['--enable-unsafe-webgpu'],
});

try {
  await context.addInitScript(() => {
    window.__autoDialog = (title) => (title.startsWith('Versão de recuperação') ? 'discard' : title === 'Criar proxy?' ? 'no' : title.startsWith('Usar') ? 'existing' : undefined);
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5196/');
  await page.waitForFunction(() => window.__foco);
  await page.evaluate(() => window.__foco.actions.newProject());

  // Importa e coloca na timeline
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'file';
    i.id = '__cut_file';
    i.style.display = 'none';
    document.body.appendChild(i);
  });
  await page.setInputFiles('#__cut_file', video);
  const assetId = await page.evaluate(async () => {
    const f = window.__foco;
    await f.actions.importItems([{ file: document.getElementById('__cut_file').files[0] }]);
    const a = Object.values(f.store.getState().project.assets)[0];
    await f.media.whenLevels(a.id);
    f.actions.addAssetToTimeline(a.id);
    return a.id;
  });

  console.log('Transcrição (Whisper base, local)');
  let t0 = Date.now();
  const words = await page.evaluate(async (id) => {
    const f = window.__foco;
    if (!f.transcripts.get(id)) await f.actions.transcribe(id, 'onnx-community/whisper-base_timestamped', 'portuguese');
    return f.transcripts.get(id)?.words.length ?? 0;
  }, assetId);
  check(words > 20, 'fala transcrita', `${words} palavras em ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // Aba Corte pela tela
  await page.locator('[data-testid="rail-cut"]').click();
  await page.locator('[data-testid="cut-panel"]').waitFor();

  const dur = () => page.evaluate(() => Math.max(...Object.values(window.__foco.store.getState().project.clips).map((c) => c.start + c.duration)));
  const d0 = await dur();
  console.log('Análise nos três ritmos');
  const byMode = {};
  for (const mode of ['natural', 'dynamic', 'dry']) {
    await page.locator(`[data-testid="cut-mode-${mode}"]`).click();
    await page.locator('[data-testid="cut-analyze"]').click();
    await page.waitForFunction(() => !window.__foco.smartCut.smartCutStore.get().busy);
    byMode[mode] = await page.evaluate(() => {
      const s = window.__foco.smartCut.smartCutStore.get();
      const kinds = {};
      for (const c of s.cuts) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      return { n: s.cuts.length, removed: s.cuts.reduce((a, c) => a + c.end - c.start, 0), kinds, overlaps: s.cuts.some((c, i) => i && c.start < s.cuts[i - 1].end) };
    });
    const r = byMode[mode];
    console.log(`    ${mode}: ${r.n} cortes, −${r.removed.toFixed(1)} s ${JSON.stringify(r.kinds)}`);
    check(!r.overlaps, `${mode}: cortes sem sobreposição`);
  }
  check(byMode.natural.removed <= byMode.dynamic.removed && byMode.dynamic.removed <= byMode.dry.removed, 'quanto mais seco o ritmo, mais tempo sai', `${byMode.natural.removed.toFixed(1)} ≤ ${byMode.dynamic.removed.toFixed(1)} ≤ ${byMode.dry.removed.toFixed(1)}`);

  // Aplica o ritmo mais suave que tenha algo a cortar (fala já limpa só tem cortes no Seco).
  const applyMode = ['dynamic', 'natural', 'dry'].find((m) => byMode[m].n > 0);
  if (!applyMode) throw new Error('nenhum ritmo encontrou cortes: use uma fala bruta');
  console.log(`Aplicar o ritmo ${applyMode}`);
  await page.locator(`[data-testid="cut-mode-${applyMode}"]`).click();
  await page.locator('[data-testid="cut-analyze"]').click();
  await page.waitForFunction(() => !window.__foco.smartCut.smartCutStore.get().busy);
  const planned = await page.evaluate(() => window.__foco.smartCut.smartCutStore.get().cuts.reduce((a, c) => a + c.end - c.start, 0));
  await page.locator('[data-testid="cut-apply"]').click();
  await page.locator('[data-testid="cut-check"]').waitFor();
  const d1 = await dur();
  check(Math.abs(d0 - d1 - planned) < 0.15, 'a timeline encurtou o planejado', `${d0.toFixed(1)} → ${d1.toFixed(1)} s (plano −${planned.toFixed(1)} s)`);
  const chk = await page.evaluate(() => window.__foco.smartCut.smartCutStore.get().lastApply.check);
  console.log(`    conferência: ${chk.longPauses.length} pausa(s) longa(s), ${chk.riskySplices.length} emenda(s) com som`);
  check(chk.riskySplices.length <= Math.max(1, Math.round(byMode[applyMode].n * 0.1)), 'emendas com som: no máximo 10% dos cortes', chk.riskySplices.length);
  if (shots) await page.screenshot({ path: path.join(shots, 'cut-panel.png') });

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const d2 = await dur();
  check(Math.abs(d2 - d0) < 0.01, 'um Ctrl+Z desfaz o corte inteiro', `${d2.toFixed(2)} s`);
  console.log('Diretor IA: comando smart_cut pelo executor do chat');
  const ai = await page.evaluate(async () => {
    const f = window.__foco;
    const v = f.commands.validateCommands([{ type: 'smart_cut', mode: 'natural' }, { type: 'smart_cut', mode: 'xyz' }], { duration: 60 });
    const results = await f.ai.runCommands(v.commands, 'teste');
    return { valid: v.commands.length, rejected: v.errors.length, results };
  });
  const d3 = await dur();
  check(ai.valid === 1 && ai.rejected === 1, 'validador aceita ritmo válido e recusa inválido');
  check(ai.results[0]?.ok && d3 < d0 - 5, 'smart_cut pelo chat corta a fala', `${ai.results[0]?.label} — ${ai.results[0]?.detail}`);
  check(errors.length === 0, 'sem erros de página', errors.join(' | ').slice(0, 300));
} finally {
  await context.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
