// Arquivos do PC pelo servidor local do editor (o app roda sempre na máquina da pessoa).
// - GET  /__foco/local/ping           → { dir } se o recurso está ativo
// - GET  /__foco/local/file?p=<path>  → conteúdo de um arquivo de mídia do disco
// - POST /__foco/local/save?name=<n>  → grava o corpo na pasta de mídia do FOCO e devolve { path }
// Só aceita conexões da própria máquina e só lida com extensões de mídia.

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

export const mediaDir = () => process.env.FOCO_MEDIA_DIR || path.join(os.homedir(), 'Documents', 'FOCO Editor', 'Mídia');

const isLocal = (req: IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

function fail(res: ServerResponse, code: number, msg: string) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: msg }));
}

export function localFiles(): Plugin {
  return {
    name: 'foco-local-files',
    configureServer(server) {
      server.middlewares.use('/__foco/local', (req, res) => {
        if (!isLocal(req)) return fail(res, 403, 'somente nesta máquina');
        const url = new URL(req.url ?? '/', 'http://local');
        if (url.pathname === '/ping') {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ dir: mediaDir() }));
        }
        if (url.pathname === '/file' && req.method === 'GET') {
          const p = url.searchParams.get('p') ?? '';
          const type = TYPES[path.extname(p).toLowerCase()];
          if (!p || !path.isAbsolute(p) || !type) return fail(res, 400, 'caminho inválido');
          let st: fs.Stats;
          try {
            st = fs.statSync(p);
          } catch {
            return fail(res, 404, 'arquivo não encontrado');
          }
          if (!st.isFile()) return fail(res, 404, 'arquivo não encontrado');
          res.setHeader('Content-Type', type);
          res.setHeader('Content-Length', String(st.size));
          res.setHeader('Last-Modified', st.mtime.toUTCString());
          res.setHeader('X-Last-Modified-Ms', String(Math.round(st.mtimeMs)));
          return fs.createReadStream(p).pipe(res);
        }
        if (url.pathname === '/save' && req.method === 'POST') {
          const name = path.basename(url.searchParams.get('name') ?? '').replace(/[<>:"/\\|?*]+/g, '_');
          if (!name || !TYPES[path.extname(name).toLowerCase()]) return fail(res, 400, 'nome inválido');
          const dir = mediaDir();
          fs.mkdirSync(dir, { recursive: true });
          const target = path.join(dir, name);
          const out = fs.createWriteStream(target);
          req.pipe(out);
          out.on('finish', () => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ path: target }));
          });
          out.on('error', (e) => fail(res, 500, String(e)));
          return;
        }
        fail(res, 404, 'rota desconhecida');
      });
    },
  };
}
