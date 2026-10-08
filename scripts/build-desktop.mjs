// Gera o app de Windows do FOCO Editor.
//   node scripts/build-desktop.mjs          → compila o editor e cria o instalador (release/)
//   node scripts/build-desktop.mjs --run    → compila e abre o app sem instalar (para testar)
//   node scripts/build-desktop.mjs --no-web → reaproveita o dist/ já compilado
//   node scripts/build-desktop.mjs --prepare → só monta a pasta do app (usado pelo e2e-desktop)
// O empacotamento acontece numa pasta local (FOCO_DESKTOP_DIR, padrão D:\FocoLabs\foco-editor-desktop)
// porque o Google Drive não aguenta as milhares de gravações do npm/electron-builder.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const out = process.env.FOCO_DESKTOP_DIR || 'D:\\FocoLabs\\foco-editor-desktop';
const args = new Set(process.argv.slice(2));
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', env: process.env });

if (!fs.existsSync(path.join(out, 'node_modules', 'electron', 'dist'))) {
  console.error(`Electron não está instalado em ${out}. Rode lá: npm install -D electron electron-builder && npm approve-scripts electron && node node_modules/electron/install.js`);
  process.exit(2);
}

if (!args.has('--no-web')) {
  console.log('1/3 · compilando o editor (vite build)…');
  run('npx vite build', repo);
}

console.log('2/3 · copiando para a pasta do app…');
for (const dir of ['dist', 'electron', 'local-server']) {
  fs.rmSync(path.join(out, dir), { recursive: true, force: true });
  fs.cpSync(path.join(repo, dir), path.join(out, dir), { recursive: true });
}
const editorPkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const pkgPath = path.join(out, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
Object.assign(pkg, {
  name: 'foco-editor-desktop',
  productName: 'FOCO Editor',
  version: editorPkg.version && editorPkg.version !== '0.0.0' ? editorPkg.version : pkg.version || '1.0.0',
  description: 'FOCO Editor — editor de vídeo com IA',
  author: 'FOCO Marketing',
  main: 'electron/main.cjs',
  build: {
    appId: 'com.focomarketing.editor',
    productName: 'FOCO Editor',
    directories: { output: 'release' },
    files: ['dist/**', 'electron/**', 'local-server/**', 'package.json', '!**/node_modules/**'],
    win: { target: 'nsis', icon: 'electron/icon.png' },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'FOCO Editor',
      deleteAppDataOnUninstall: false,
    },
  },
});
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

if (args.has('--prepare')) {
  console.log('3/3 · pasta do app pronta (sem instalador).');
  process.exit(0);
}

if (args.has('--run')) {
  console.log('3/3 · abrindo o app (sem instalar)…');
  const electron = path.join(out, 'node_modules', 'electron', 'dist', 'electron.exe');
  // o VS Code define ELECTRON_RUN_AS_NODE para os filhos: com ela o Electron vira Node puro
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(electron, ['.'], { cwd: out, detached: true, stdio: 'ignore', env }).unref();
  process.exit(0);
}

console.log('3/3 · gerando o instalador (electron-builder)…');
run('npx electron-builder --win nsis --x64', out);
const setup = fs.readdirSync(path.join(out, 'release')).find((f) => /Setup.*\.exe$/i.test(f));
console.log(setup ? `\nInstalador: ${path.join(out, 'release', setup)}` : '\nInstalador não encontrado em release/.');
