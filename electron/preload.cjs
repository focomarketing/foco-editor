// Ponte mínima entre o app e o editor: caminho real dos arquivos escolhidos/arrastados e
// abrir as pastas do FOCO no Explorer. Nada mais do sistema fica exposto à página.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('focoDesktop', {
  isDesktop: true,
  version: process.versions.electron,
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  openFolder: (which) => ipcRenderer.send('foco:open-folder', which === 'media' ? 'media' : 'projects'),
  
  // Atualizações (AutoUpdater)
  onUpdateAvailable: (callback) => ipcRenderer.on('updater:available', (_event, value) => callback(value)),
  onUpdateReady: (callback) => ipcRenderer.on('updater:ready', (_event, value) => callback(value)),
  applyUpdate: () => ipcRenderer.send('foco:apply-update'),
  checkForUpdates: () => ipcRenderer.send('foco:check-update'),
  onUpdateChecking: (callback) => ipcRenderer.on('updater:checking', () => callback()),
  onUpdateNone: (callback) => ipcRenderer.on('updater:none', (_event, value) => callback(value)),
  onUpdateError: (callback) => ipcRenderer.on('updater:error', (_event, value) => callback(value)),
  onUpdateProgress: (callback) => ipcRenderer.on('updater:progress', (_event, value) => callback(value)),
  openReleases: () => ipcRenderer.send('foco:open-releases'),
  appVersion: (() => {
    try {
      return ipcRenderer.sendSync('foco:version');
    } catch {
      return '';
    }
  })(),
});
