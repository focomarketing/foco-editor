// FOCO Editor como app de Windows (Electron). O editor (dist/) é servido por um servidor
// interno SEMPRE no mesmo endereço (127.0.0.1:51730): a memória do navegador (catálogo,
// autosave) fica estável entre aberturas. A mesma API local do modo de desenvolvimento lê e
// grava mídia e projetos em Documentos\FOCO Editor. Ao fechar, o editor grava tudo antes.

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.FOCO_APP_PORT || 51730);
const DEV_URL = process.env.FOCO_DEV_URL; // npm run app:dev → usa o servidor do Vite
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.onnx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};

let api = null;
async function localApi() {
  api ??= await import(require('node:url').pathToFileURL(path.join(ROOT, 'local-server', 'localApi.mjs')).href);
  return api;
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://local');
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) {
    res.statusCode = 403;
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html'); // app de uma página
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
  fs.createReadStream(file).pipe(res);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url.startsWith('/__foco/local')) {
          const { handleLocal } = await localApi();
          return void (await handleLocal(req, res, req.url.slice('/__foco/local'.length) || '/', { desktop: true }));
        }
        serveStatic(req, res);
      } catch (e) {
        res.statusCode = 500;
        res.end(String(e));
      }
    });
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

let win = null;
let closing = false;

async function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 680,
    title: 'FOCO Editor',
    backgroundColor: '#0b0d12',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  // links externos (acervos, documentação) abrem no navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // antes de fechar: o editor grava o projeto (catálogo + .foco na pasta Projetos)
  win.on('close', (e) => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    const flush = win.webContents.executeJavaScript('window.__focoFlush ? window.__focoFlush().then(() => true) : true', true).catch(() => true);
    const timeout = new Promise((r) => setTimeout(r, 4000));
    void Promise.race([flush, timeout]).then(() => win && win.destroy());
  });
  await win.loadURL(DEV_URL || `http://127.0.0.1:${PORT}/`);
}

ipcMain.on('foco:open-folder', async (_e, which) => {
  const { mediaDir, projectsDir } = await localApi();
  const dir = which === 'media' ? mediaDir() : projectsDir();
  fs.mkdirSync(dir, { recursive: true });
  void shell.openPath(dir);
});

// testes automáticos usam outra pasta de dados (não mexem nos projetos da pessoa)
if (process.env.FOCO_USER_DATA) app.setPath('userData', process.env.FOCO_USER_DATA);

// uma janela só: abrir de novo traz a que já está aberta
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    if (!DEV_URL) {
      try {
        await startServer();
      } catch (e) {
        dialog.showErrorBox('FOCO Editor', `Não consegui abrir o servidor interno na porta ${PORT} (outro programa está usando?).\n\n${e.message}`);
        app.quit();
        return;
      }
    }
    await createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
