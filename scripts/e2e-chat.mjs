// Teste end-to-end do AI Editor (chat) com LLM real.
// Local: precisa do Ollama com o modelo (padrão qwen3:4b). Uso: npm run test:e2e:chat
// Claude: defina ANTHROPIC_API_KEY para testar também o caminho da API.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const work = path.join(os.tmpdir(), 'foco-e2e');
fs.mkdirSync(work, { recursive: true });
const wav = path.join(work, 'fala-teste.wav');
if (!fs.existsSync(wav)) {
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'make-speech.ps1'), wav], { stdio: 'inherit' });
}

const server = await createServer({ server: { port: 5194, strictPort: true }, logLevel: 'error' });
await server.listen();
const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge',
  headless: !process.env.E2E_HEADED,
  viewport: { width: 1600, height: 950 },
  args: ['--enable-unsafe-webgpu'],
});

async function ask(page, text) {
  const before = await page.evaluate(() => window.__foco.ai.aiStore.get().messages.length);
  await page.locator('[data-testid="chat-input"]').fill(text);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => {
    const s = window.__foco.ai.aiStore.get();
    return !s.busy && s.messages.length >= n + 2;
  }, before, { timeout: 240_000 });
  return page.evaluate(() => window.__foco.ai.aiStore.get().messages.at(-1));
}

const dur = (page) => page.evaluate(() => Math.max(...Object.values(window.__foco.store.getState().project.clips).filter((c) => !c.caption && !c.title).map((c) => c.start + c.duration)));

try {
  await context.addInitScript(() => {
    window.__autoDialog = (title) => (title.startsWith('Versão de recuperação') ? 'restore' : title === 'Criar proxy?' ? 'no' : undefined);
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5194/');
  await page.waitForFunction(() => window.__foco);
  await page.evaluate(() => window.__foco.actions.newProject());
  await page.evaluate(() => window.__foco.ai.saveSettings({ provider: 'ollama', ollamaModel: 'qwen3:4b', ollamaUrl: 'http://localhost:11434' }));

  const b64 = fs.readFileSync(wav).toString('base64');
  await page.evaluate(async (data) => {
    const f = window.__foco;
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    await f.actions.importItems([{ file: new File([bytes], 'fala-teste.wav', { type: 'audio/wav', lastModified: 1 }) }]);
    const a = Object.values(f.store.getState().project.assets)[0];
    await f.media.whenLevels(a.id);
    f.actions.addAssetToTimeline(a.id);
  }, b64);
  await page.locator('[data-testid="rail-ai"]').click();
  const d0 = await dur(page);

  console.log('Chat local (Ollama · qwen3:4b)');
  let t0 = Date.now();
  let m = await ask(page, 'Remova as pausas longas e melhore o áudio para podcast');
  console.log(`    IA: "${m.text}" (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const a of m.actions ?? []) console.log(`      ${a.ok ? '✓' : '✗'} ${a.label} — ${a.detail}`);
  if (m.rejected?.length) console.log('      descartados:', m.rejected.join(' | '));
  const kinds = (m.actions ?? []).map((a) => a.label);
  check(kinds.some((k) => /pausas/i.test(k)) && kinds.some((k) => /áudio/i.test(k)), 'interpretou os dois pedidos como comandos', kinds.join(' + '));
  const d1 = await dur(page);
  check(d1 < d0 - 2, 'timeline encurtou', `${d0.toFixed(1)} → ${d1.toFixed(1)} s`);
  const fx = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips)[0].audio);
  check(fx?.preset === 'podcast', 'processamento de áudio aplicado', fx?.preset);
  check(await page.locator('[data-testid="ai-session"]').isVisible(), 'barra ORIGINAL vs EDIÇÃO DA IA');

  t0 = Date.now();
  m = await ask(page, 'Agora crie legendas estilo podcast');
  console.log(`    IA: "${m.text}" (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const a of m.actions ?? []) console.log(`      ${a.ok ? '✓' : '✗'} ${a.label} — ${a.detail}`);
  if (m.rejected?.length) console.log('      descartados:', m.rejected.join(' | '));
  const caps = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).filter((c) => c.caption).length);
  check(caps > 3, 'legendas criadas pelo chat (transcrição automática local)', caps);

  t0 = Date.now();
  m = await ask(page, 'Coloque um título com a palavra principal do vídeo no começo');
  console.log(`    IA: "${m.text}" (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const a of m.actions ?? []) console.log(`      ${a.ok ? '✓' : '✗'} ${a.label} — ${a.detail}`);
  if (m.rejected?.length) console.log('      descartados:', m.rejected.join(' | '));
  const title = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).find((c) => c.title)?.title?.text);
  check(!!title, 'gráfico criado', title);
  check(/felicidade/i.test(title ?? ''), 'texto do título tirado da transcrição (sem inventar)', title);

  m = await ask(page, 'Troque o fundo do vídeo por uma praia');
  check((m.actions ?? []).length === 0, 'pedido impossível: explica e não executa nada', m.text);
  if (shots) await page.screenshot({ path: path.join(shots, 'chat.png') });

  console.log('Claude (API)');
  const key = process.env.ANTHROPIC_API_KEY;
  await page.evaluate((k) => window.__foco.ai.saveSettings({ provider: 'claude', claudeKey: k || 'sk-ant-invalida', cloudConsent: true }), key ?? '');
  m = await ask(page, 'Deixe o vídeo mais dinâmico');
  if (key) {
    for (const a of m.actions ?? []) console.log(`      ${a.ok ? '✓' : '✗'} ${a.label} — ${a.detail}`);
  if (m.rejected?.length) console.log('      descartados:', m.rejected.join(' | '));
    check((m.actions ?? []).length >= 2, 'Claude interpretou "mais dinâmico" em vários comandos');
  } else {
    check(/inválida/i.test(m.text), 'sem chave real: erro de autenticação tratado e explicado', m.text);
  }
  check(errors.length === 0, 'sem erros de página', errors.join(' | ').slice(0, 300));
} finally {
  await context.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
