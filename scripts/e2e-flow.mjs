// Teste ponta a ponta do fluxo guiado: Projetos → Novo projeto (trilha + tipo) → fases → Editor
// → volta para Projetos → reabre na mesma fase.
// Uso: FLOW_VIDEO="C:/caminho/fala.mp4" node scripts/e2e-flow.mjs   (E2E_SHOTS=pasta para capturas)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const video = process.env.FLOW_VIDEO;
if (!video) {
  console.error('Defina FLOW_VIDEO com o caminho de um vídeo com fala.');
  process.exit(2);
}
const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const profile = path.join(os.tmpdir(), 'foco-e2e-flow');
fs.rmSync(profile, { recursive: true, force: true }); // catálogo vazio a cada execução
// mídia gravada pelo editor vai para uma pasta temporária, não para Documentos
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
process.env.FOCO_PROJECTS_DIR ??= path.join(os.tmpdir(), 'foco-e2e-projetos');
const server = await createServer({ server: { port: 5197, strictPort: true }, logLevel: 'error' });
await server.listen();
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge',
  headless: !process.env.E2E_HEADED,
  viewport: { width: 1500, height: 900 },
});
const shot = async (page, name) => shots && page.screenshot({ path: path.join(shots, `flow-${name}.png`) });

try {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5197/');
  await page.waitForFunction(() => window.__foco);

  console.log('Projetos (início)');
  await page.locator('[data-testid="projects-home"]').waitFor();
  check(await page.locator('[data-testid="project-card"]').count() === 0, 'catálogo vazio no começo');
  await shot(page, '1-home');

  console.log('Novo projeto');
  await page.locator('[data-testid="home-new"]').click();
  check(await page.locator('[data-testid="track-avatar"]').isDisabled(), 'avatar aparece como "em breve"');
  await shot(page, '2-trilhas');
  await page.locator('[data-testid="track-youtube"]').click();
  check(await page.locator('[data-testid="new-create"]').isDisabled(), 'sem tipo escolhido não cria');
  await page.locator('[data-testid="sub-cristao"]').click();
  await page.locator('[data-testid="new-name"]').fill('Estudo de teste');
  await shot(page, '3-tipo');

  // O botão abre o seletor nativo de arquivos; no teste os vídeos entram pela mesma função.
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'file';
    i.id = '__flow_file';
    i.style.display = 'none';
    document.body.appendChild(i);
  });
  await page.setInputFiles('#__flow_file', video);
  await page.evaluate(async () => {
    const f = window.__foco;
    await f.workflow.createGuidedProject({ name: 'Estudo de teste', track: 'youtube', subtype: 'cristao' }, [{ file: document.getElementById('__flow_file').files[0] }]);
  });
  await page.locator('[data-testid="phasebar"]').waitFor();
  const st = await page.evaluate(() => {
    const p = window.__foco.store.getState().project;
    return { w: p.settings.width, h: p.settings.height, clips: Object.keys(p.clips).length, wf: p.metadata.workflow, mode: window.__foco.smartCut.smartCutStore.get().options.mode };
  });
  check(st.w === 1920 && st.h === 1080, 'formato da trilha aplicado', `${st.w}×${st.h}`);
  check(st.clips >= 1, 'vídeo na timeline', st.clips);
  check(st.wf.current === 'cut', 'abre na fase Corte');
  check(st.mode === 'natural', 'ritmo de corte vem do tipo (cristão de estudo → natural)', st.mode);
  check(await page.locator('[data-testid="phase-panel-cut"]').isVisible(), 'painel da fase Corte na lateral');
  await shot(page, '4-fase-corte');

  console.log('Fases');
  const undoBefore = await page.evaluate(() => window.__foco.store.getState().canUndo);
  await page.locator('[data-testid="phase-done"]').click();
  check(await page.evaluate(() => window.__foco.store.getState().project.metadata.workflow.current) === 'images', 'concluir corte → Imagens');
  check(await page.evaluate(() => window.__foco.store.getState().canUndo) === undoBefore, 'mudar de fase não entra no Ctrl+Z');
  await shot(page, '5-fase-imagens');
  for (let i = 0; i < 6; i++) {
    const cur = await page.evaluate(() => window.__foco.store.getState().project.metadata.workflow.current);
    if (cur === 'editor') break;
    await page.locator('[data-testid="phase-skip"]').click();
  }
  check(await page.evaluate(() => window.__foco.store.getState().project.metadata.workflow.current) === 'editor', 'pulando as fases chega ao Editor');
  check(await page.locator('[data-testid="rail-media"]').isVisible(), 'no Editor aparecem todas as ferramentas');
  await shot(page, '6-editor');

  console.log('Voltar para Projetos e reabrir');
  await page.locator('[data-testid="phase-cut"]').click();
  await page.locator('[data-testid="go-home"]').click();
  await page.locator('[data-testid="project-card"]').first().waitFor();
  const card = await page.locator('[data-testid="project-card"]').first().innerText();
  check(/Estudo de teste/.test(card) && /Cristão de estudo/.test(card), 'card com nome e trilha', card.replace(/\s+/g, ' ').slice(0, 120));
  await shot(page, '7-home-com-projeto');
  await page.locator('[data-testid="project-card"] .proj-open').first().click();
  await page.locator('[data-testid="phasebar"]').waitFor();
  check(await page.evaluate(() => window.__foco.store.getState().project.metadata.workflow.current) === 'cut', 'reabre na fase em que parou');
  check(await page.evaluate(() => Object.keys(window.__foco.store.getState().project.clips).length) >= 1, 'timeline reaberta com o vídeo');

  console.log('Projeto sem fluxo (compatibilidade)');
  await page.evaluate(() => window.__foco.actions.newProject());
  check(!(await page.locator('[data-testid="phasebar"]').count()), 'projeto comum abre direto no editor, sem barra de fases');
  check(errors.length === 0, 'sem erros de página', errors.join(' | ').slice(0, 300));
} finally {
  await context.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
