// App de Windows de ponta a ponta (sem tocar nos projetos da pessoa: pastas temporárias):
// cria um projeto pela tela, importa um vídeo pelo seletor do sistema, fecha o app (que grava
// tudo), reabre e confere: projeto na lista, .foco na pasta Projetos com o caminho do vídeo e a
// mídia pronta sem pedir nada. Depois simula a memória do navegador apagada: o projeto volta
// da pasta Projetos e o vídeo, do disco.
// Uso: DESKTOP_VIDEO="C:/video.mp4" node scripts/e2e-desktop.mjs   (antes: node scripts/build-desktop.mjs --prepare)
import { _electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const video = process.env.DESKTOP_VIDEO;
if (!video) {
  console.error('Defina DESKTOP_VIDEO com o caminho de um vídeo.');
  process.exit(2);
}
const out = process.env.FOCO_DESKTOP_DIR || 'D:\\FocoLabs\\foco-editor-desktop';
const shots = process.env.E2E_SHOTS;
let failures = 0;
const check = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra !== '' ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

const tmp = path.join(os.tmpdir(), 'foco-e2e-desktop');
fs.rmSync(tmp, { recursive: true, force: true });
const dataDir = path.join(tmp, 'FOCO Editor');
const env = (userData) => {
  const e = { ...process.env, FOCO_APP_PORT: '51791', FOCO_USER_DATA: userData, FOCO_DATA_DIR: dataDir };
  delete e.ELECTRON_RUN_AS_NODE;
  delete e.FOCO_MEDIA_DIR;
  delete e.FOCO_PROJECTS_DIR;
  return e;
};
const launch = (userData) => _electron.launch({ executablePath: path.join(out, 'node_modules', 'electron', 'dist', 'electron.exe'), args: ['.'], cwd: out, env: env(userData) });

async function mediaReady(page) {
  // sem aviso de mídia offline/sem permissão e com o vídeo desenhado no player
  await page.waitForTimeout(2500);
  const banner = await page.locator('[data-testid="media-reconnect"], .banner').count();
  const px = await page.evaluate(() => {
    const c = document.querySelector('.viewer canvas');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    return lit;
  });
  return { banner, px };
}

const errors = [];
try {
  console.log('1 · Primeira abertura: criar projeto e importar vídeo');
  let app = await launch(path.join(tmp, 'userdata-1'));
  let page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('[data-testid="projects-home"]');
  check(await page.evaluate(() => window.focoDesktop?.isDesktop === true), 'rodando como app (ponte do Windows ativa)');
  await page.locator('[data-testid="home-new"]').click();
  await page.locator('[data-testid="track-manual"]').click();
  await page.locator('[data-testid="new-name"]').fill('Projeto do app');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-testid="new-create"]').click();
  await (await chooser).setFiles(video);
  await page.waitForFunction(() => document.querySelectorAll('.clip').length > 0, null, { timeout: 60_000 });
  check(true, 'vídeo importado pelo seletor do sistema e colocado na timeline');
  await page.waitForTimeout(3500); // catálogo + .foco (gravação agrupada de 2 s)
  if (shots) await page.screenshot({ path: path.join(shots, 'desktop-1.png') });
  await app.close(); // fechar grava tudo antes

  const projDir = path.join(dataDir, 'Projetos');
  const files = fs.existsSync(projDir) ? fs.readdirSync(projDir).filter((f) => f.endsWith('.foco')) : [];
  check(files.length === 1 && files[0].startsWith('Projeto do app ['), 'projeto salvo como arquivo .foco na pasta Projetos', files.join(', '));
  const saved = files[0] ? JSON.parse(fs.readFileSync(path.join(projDir, files[0]), 'utf8')) : null;
  const asset = saved && Object.values(saved.assets)[0];
  check(!!asset && path.resolve(asset.localPath ?? '') === path.resolve(video), 'o projeto guarda o caminho do vídeo no PC', asset?.localPath);

  console.log('2 · Reabrir o app');
  app = await launch(path.join(tmp, 'userdata-1'));
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('[data-testid="projects-home"]');
  await page.waitForSelector('.proj-card, [data-testid^="proj-"]', { timeout: 15_000 }).catch(() => {});
  const cards = await page.getByText('Projeto do app').count();
  check(cards > 0, 'projeto aparece na lista ao reabrir');
  await page.getByText('Projeto do app').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.clip').length > 0, null, { timeout: 30_000 });
  const r1 = await mediaReady(page);
  check(r1.banner === 0 && r1.px > 0, 'vídeo abre sozinho, sem pedir permissão nem localizar', `aviso ${r1.banner} · pixels ${r1.px}`);
  if (shots) await page.screenshot({ path: path.join(shots, 'desktop-2.png') });
  await app.close();

  console.log('3 · Memória do navegador apagada (pasta de dados nova)');
  app = await launch(path.join(tmp, 'userdata-2'));
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('[data-testid="projects-home"]');
  await page.waitForTimeout(1500);
  check((await page.getByText('Projeto do app').count()) > 0, 'projeto volta da pasta Projetos do PC');
  await page.getByText('Projeto do app').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.clip').length > 0, null, { timeout: 30_000 });
  const r2 = await mediaReady(page);
  check(r2.banner === 0 && r2.px > 0, 'e o vídeo volta do disco pelo caminho guardado', `aviso ${r2.banner} · pixels ${r2.px}`);
  if (shots) await page.screenshot({ path: path.join(shots, 'desktop-3.png') });
  await app.close();
  check(errors.length === 0, 'sem erros de página', errors.join(' | ').slice(0, 300));
} catch (e) {
  failures++;
  console.error(e);
}
console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
