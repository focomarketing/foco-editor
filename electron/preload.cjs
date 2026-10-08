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
});
