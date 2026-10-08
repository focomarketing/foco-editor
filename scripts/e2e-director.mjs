// Diretor de edição de ponta a ponta no navegador. A API do Claude é trocada por um roteiro
// (gancho de teste, só no modo dev); todo o resto é real: folha de contato renderizada da mídia
// decodificada, edição e verificação no rascunho, timeline intacta até aplicar, aplicar = 1 undo,
// pedir ajuste continua a conversa.
// Uso: node scripts/e2e-director.mjs   (E2E_SHOTS=pasta para capturas)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const profile = path.join(os.tmpdir(), 'foco-e2e-director');
fs.rmSync(profile, { recursive: true, force: true });
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
process.env.FOCO_PROJECTS_DIR ??= path.join(os.tmpdir(), 'foco-e2e-projetos');
const server = await createServer({ server: { port: 5192, strictPort: true }, logLevel: 'error' });
await server.listen();
const context = await chromium.launchPersistentContext(profile, { channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge', headless: !process.env.E2E_HEADED, viewport: { width: 1500, height: 900 } });

try {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5192/');
  await page.waitForFunction(() => window.__foco);

  // projeto manual: fala principal (vermelha) na timeline + um take de apoio (azul) só na Mídia
  await page.evaluate(async () => {
    const f = window.__foco;
    const a = await f.makeTestVideo({ name: 'FALA', seconds: 6, width: 640, height: 360, fps: 30, hue: 0, freq: 440 });
    const b = await f.makeTestVideo({ name: 'TAKE', seconds: 4, width: 640, height: 360, fps: 30, hue: 220, freq: 660 });
    await f.workflow.createGuidedProject({ name: 'Teste do Diretor', track: 'manual', subtype: null }, [{ file: a }]);
    await f.actions.importItems([{ file: b }]);
    f.ai.saveSettings({ provider: 'claude', claudeKey: 'chave-de-teste', cloudConsent: true, claudeModel: 'claude-opus-5-5' });
  });
  await page.waitForFunction(() => Object.values(window.__foco.store.getState().project.assets).every((a) => window.__foco.media.get(a.id)?.status === 'ready'), null, { timeout: 30_000 });

  // roteiro no lugar da API: olhar → editar (título + take) → olhar de novo + verificar → entregar
  await page.evaluate(() => {
    const f = window.__foco;
    const take = Object.values(f.store.getState().project.assets).find((a) => a.name.startsWith('TAKE'));
    const m = (content, stop = 'tool_use') => ({ id: `m${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 400, cache_read_input_tokens: 2000 } });
    const u = (id, name, input) => ({ type: 'tool_use', id, name, input });
    const turns = [
      m([{ type: 'thinking', thinking: 'Vou entender o projeto e olhar o começo.', signature: 's' }, u('a1', 'project_overview', {}), u('a2', 'view_frames', { times: [0.5, 3] })]),
      m([u('b1', 'set_plan', { summary: 'Gancho com título e take de apoio no meio.', target_duration: 6, structure: [{ start: 0, end: 2, part: 'gancho' }, { start: 2, end: 6, part: 'desenvolvimento' }] }), u('b2', 'edit_timeline', { edits: [{ action: 'title', start: 0.5, end: 2.5, text: 'TESTE DO DIRETOR', template: 'title', reason: 'gancho' }, { action: 'broll', asset_id: take.id, start: 3, end: 5, source_in: 0.5, reason: 'ilustra' }] })]),
      m([u('c1', 'view_frames', { times: [1.5, 4] }), u('c2', 'verify', {})]),
      m([{ type: 'text', text: 'Edição pronta.' }, u('d1', 'finish', { summary: 'Coloquei um título no gancho e o take de apoio no meio.', changes: ['título no gancho', 'take de apoio 0:03–0:05'], open_questions: ['Quer música?'] })]),
      // ajuste
      m([u('e1', 'edit_timeline', { edits: [{ action: 'title', start: 4.6, end: 5.8, text: 'FIM', template: 'callout', reason: 'pedido de ajuste' }] }), u('e2', 'finish', { summary: 'Acrescentei o destaque final.', changes: ['destaque FIM'] })]),
    ];
    let i = 0;
    window.__focoDirectorCalls = [];
    window.__focoDirectorCreate = async (params) => {
      window.__focoDirectorCalls.push(params.messages.length);
      return turns[Math.min(i++, turns.length - 1)];
    };
  });

  console.log('Diretor');
  await page.locator('.rail-btn', { hasText: 'Diretor' }).click();
  await page.locator('[data-testid="director-brief"]').fill('Vídeo curto de teste, deixe o gancho forte.');
  const clipsBefore = await page.evaluate(() => Object.keys(window.__foco.store.getState().project.clips).length);
  await page.locator('[data-testid="director-start"]').click();
  await page.locator('[data-testid="director-finished"]').waitFor({ timeout: 60_000 });
  const st = await page.evaluate(() => window.__foco.director.directorStore.get());
  check(st.stopped === 'finished' && st.turns === 4, 'roteiro completo: entendeu, editou, conferiu e entregou', `${st.stopped} em ${st.turns} passos`);
  check(st.costUsd > 0, 'custo somado pelo uso', `US$ ${st.costUsd.toFixed(4)}`);
  check(!!st.plan && st.plan.structure.length === 2, 'plano editorial na tela');
  check((st.issues ?? []).every((x) => x.severity !== 'erro'), 'verificação sem erros', (st.issues ?? []).map((x) => x.kind).join(', ') || 'nenhum problema');

  // a folha de contato foi renderizada da mídia real (não preta)
  const sheet = await page.evaluate(async () => {
    const imgs = window.__foco.director.directorStore.get().log.filter((e) => e.image);
    const last = imgs[imgs.length - 1];
    if (!last) return null;
    const img = new Image();
    img.src = `data:image/jpeg;base64,${last.image}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    // célula 2 (t=4 s): o take azul por cima da fala vermelha
    const cell = (k) => {
      const cw = (img.width - 6) / 2;
      const d = g.getImageData(Math.round(6 + k * cw + cw * 0.15), Math.round(img.height * 0.55), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    return { count: imgs.length, w: img.width, h: img.height, c1: cell(0), c2: cell(1) };
  });
  check(sheet && sheet.count === 2, 'Diretor olhou os quadros duas vezes', sheet?.count);
  check(sheet && sheet.c1[0] > sheet.c1[2] + 30, 'quadro 1: a fala (vermelha) com o título', sheet?.c1.join(','));
  check(sheet && sheet.c2[2] > sheet.c2[0] + 30, 'quadro 2: o take de apoio (azul) por cima da fala', sheet?.c2.join(','));
  if (shots) await page.screenshot({ path: path.join(shots, 'director-1.png') });

  const clipsAfterRun = await page.evaluate(() => Object.keys(window.__foco.store.getState().project.clips).length);
  check(clipsAfterRun === clipsBefore, 'timeline real intacta até aplicar', `${clipsBefore} → ${clipsAfterRun}`);

  await page.locator('[data-testid="director-preview"]').click();
  check(await page.evaluate(() => window.__foco.director.directorStore.get().previewing), 'Ver no player mostra o rascunho');
  await page.locator('[data-testid="director-apply"]').click();
  const applied = await page.evaluate(() => {
    const p = window.__foco.store.getState().project;
    return { titles: Object.values(p.clips).filter((c) => c.title).map((c) => c.title.text), takes: Object.values(p.clips).filter((c) => p.assets[c.assetId]?.name.startsWith('TAKE')).length, undo: window.__foco.store.undoLabel };
  });
  check(applied.titles.includes('TESTE DO DIRETOR') && applied.takes === 1, 'Aplicar leva título e take para a timeline', JSON.stringify(applied));
  check(applied.undo === 'Edição do Diretor', 'tudo num passo de undo', applied.undo);
  await page.keyboard.press('Control+z');
  const undone = await page.evaluate(() => Object.keys(window.__foco.store.getState().project.clips).length);
  check(undone === clipsBefore, 'Ctrl+Z desfaz a edição inteira', undone);
  await page.keyboard.press('Control+y');

  console.log('Pedir ajuste');
  await page.locator('[data-testid="director-adjust"]').fill('Coloque um destaque no final.');
  await page.locator('[data-testid="director-adjust-send"]').click();
  await page.waitForFunction(() => window.__foco.director.directorStore.get().status === 'done' && window.__foco.director.directorStore.get().finished?.summary?.includes('final'), null, { timeout: 30_000 });
  const calls = await page.evaluate(() => window.__focoDirectorCalls);
  check(calls[calls.length - 1] > calls[0], 'ajuste continua a mesma conversa', calls.join(' → '));
  await page.locator('[data-testid="director-apply"]').click();
  const finalTitles = await page.evaluate(() => Object.values(window.__foco.store.getState().project.clips).filter((c) => c.title).map((c) => c.title.text));
  check(finalTitles.includes('FIM') && finalTitles.includes('TESTE DO DIRETOR'), 'ajuste aplicado por cima do que já estava', finalTitles.join(', '));
  if (shots) await page.screenshot({ path: path.join(shots, 'director-2.png') });
  check(errors.length === 0, 'sem erros de página', errors.join(' | ').slice(0, 300));
} finally {
  await context.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
