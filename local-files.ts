// Plugin do Vite: expõe a API local de arquivos (local-server/localApi.mjs) no servidor de
// desenvolvimento. O app instalado (electron/main.cjs) usa a mesma API.

import type { Plugin } from 'vite';
import { handleLocal } from './local-server/localApi.mjs';

export function localFiles(): Plugin {
  return {
    name: 'foco-local-files',
    configureServer(server) {
      server.middlewares.use('/__foco/local', (req, res) => {
        void handleLocal(req, res, req.url ?? '/');
      });
    },
  };
}
