// Recarregar a página não pode sumir com a mídia: arquivos sem acesso ao disco (escolhidos por
// <input>, imagens baixadas pela IA) ficam guardados no navegador e voltam ao reabrir.
// Uso: RELOAD_VIDEO="C:/fala.mp4" node scripts/e2e-reload.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const video = process.env.RELOAD_VIDEO;
if (!video) {
  console.error('Defina RELOAD_VIDEO com o caminho de um vídeo.');
  process.exit(2);
}
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const profile = path.join(os.tmpdir(), 'foco-e2e-reload');
fs.rmSync(profile, { recursive: true, force: true });
// mídia gravada pelo editor vai para uma pasta temporária, não para Documentos
process.env.FOCO_MEDIA_DIR ??= path.join(os.tmpdir(), 'foco-e2e-media');
process.env.FOCO_PROJECTS_DIR ??= path.join(os.tmpdir(), 'foco-e2e-projetos');
const server = await createServer({ server: { port: 5196, strictPort: true }, logLevel: 'error' });
await server.listen();
const context = await chromium.launchPersistentContext(profile, { channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge', headless: !process.env.E2E_HEADED, viewport: { width: 1400, height: 860 } });

const status = (page) =>
  page.evaluate(() => {
    const f = window.__foco;
    const p = f.store.getState().project;
    return { name: p.name, clips: Object.keys(p.clips).length, assets: Object.values(p.assets).map((a) => ({ name: a.name, status: f.media.get(a.id)?.status })) };
  });

try {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5196/');
  await page.waitForFunction(() => window.__foco);
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'file';
    i.id = '__rl_file';
    document.body.appendChild(i);
  });
  await page.setInputFiles('#__rl_file', video);
  const mediaDir = process.env.FOCO_MEDIA_DIR;
  fs.rmSync(mediaDir, { recursive: true, force: true });
  await page.evaluate(async (videoPath) => {
    // o vídeo entra com o caminho no PC (relido do disco ao reabrir, sem cópia)
    await window.__foco.workflow.createGuidedProject({ name: 'Teste recarregar', track: 'youtube', subtype: 'cristao' }, [{ file: document.getElementById('__rl_file').files[0], path: videoPath }]);
    // uma imagem "baixada pela IA" (sem arquivo no disco)
    const c = new OffscreenCanvas(1280, 720);
    c.getContext('2d').fillRect(0, 0, 1280, 720);
    const blob = await c.convertToBlob({ type: 'image/jpeg' });
    await window.__foco.actions.importItems([{ file: new File([blob], 'acervo-teste.jpg', { type: 'image/jpeg' }) }]);
  }, path.resolve(video));
  await page.waitForTimeout(1500);
  const onDisk = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : [];
  check(onDisk.length === 1 && onDisk[0].endsWith('acervo-teste.jpg'), 'imagem sem vínculo gravada na pasta de mídia do PC (o vídeo não é copiado)', onDisk.join(', '));
  const before = await status(page);
  console.log('    antes:', JSON.stringify(before.assets));
  check(before.assets.every((a) => a.status === 'ready'), 'mídias prontas antes de recarregar');

  await page.reload();
  await page.waitForFunction(() => window.__foco);
  // o projeto fica na tela Projetos: abre pelo catálogo, como a pessoa faria
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const f = window.__foco;
    if (f.viewStore.get() !== 'project') {
      const list = await f.projectFile.catalog();
      const id = list?.[0]?.id ?? f.store.getState().project.id;
      await f.workflow.openFromCatalog(id);
    }
  });
  await page.waitForFunction(() => Object.values(window.__foco.store.getState().project.assets).every((a) => window.__foco.media.get(a.id)?.status === 'ready'), null, { timeout: 30_000 }).catch(() => {});
  const after = await status(page);
  console.log('    depois:', JSON.stringify(after.assets));
  check(after.name === 'Teste recarregar' && after.clips > 0, 'projeto reaberto com o vídeo na timeline', `${after.clips} clipe(s)`);
  check(after.assets.length === 2 && after.assets.every((a) => a.status === 'ready'), 'vídeo e imagem continuam disponíveis depois de recarregar');
  const opfs = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names = [];
    try {
      for await (const k of (await root.getDirectoryHandle('media')).keys()) names.push(k);
    } catch {}
    return names.length;
  });
  check(opfs === 0, 'nada guardado na memória do navegador (tudo no disco)', opfs);
  check(errors.length === 0, 'sem erros de página', errors.join(' | ').slice(0, 300));
} finally {
  await context.close();
  await server.close();
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
