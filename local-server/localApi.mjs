// API local do FOCO Editor: arquivos do PC para o editor (que roda sempre na máquina da pessoa).
// Usada pelo servidor do Vite (desenvolvimento) e pelo app instalado (Electron). Só aceita
// conexões da própria máquina.
//
//   GET    /__foco/local/ping                 → { mediaDir, projectsDir, desktop }
//   GET    /__foco/local/file?p=<caminho>     → mídia do disco (com Range: vídeo grande não vai inteiro)
//   POST   /__foco/local/save?name=<nome>     → grava o corpo na pasta de mídia e devolve { path }
//   GET    /__foco/local/projects             → [{ id, name, file, mtimeMs }]
//   GET    /__foco/local/projects/<id>        → o arquivo .foco do projeto
//   PUT    /__foco/local/projects/<id>?name=  → grava o .foco (escrita atômica)
//   DELETE /__foco/local/projects/<id>        → move para Projetos/.lixeira (nada é apagado de vez)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TYPES = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

const base = () => process.env.FOCO_DATA_DIR || path.join(os.homedir(), 'Documents', 'FOCO Editor');
export const mediaDir = () => process.env.FOCO_MEDIA_DIR || path.join(base(), 'Mídia');
export const projectsDir = () => process.env.FOCO_PROJECTS_DIR || path.join(base(), 'Projetos');

const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
const safeName = (s) =>
  [...String(s)]
    .map((ch) => (ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? '_' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Projeto';
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** Arquivos de projeto: "<nome> [<id>].foco". */
function projectFiles() {
  const dir = projectsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => ({ f, m: /\[([A-Za-z0-9_-]+)\]\.foco$/.exec(f) }))
    .filter((x) => x.m)
    .map(({ f, m }) => {
      const st = fs.statSync(path.join(dir, f));
      return { id: m[1], name: f.replace(/\s*\[[^\]]+\]\.foco$/, ''), file: path.join(dir, f), mtimeMs: Math.round(st.mtimeMs) };
    });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendFile(req, res, p) {
  const type = TYPES[path.extname(p).toLowerCase()];
  if (!p || !path.isAbsolute(p) || !type) return json(res, 400, { error: 'caminho inválido' });
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return json(res, 404, { error: 'arquivo não encontrado' });
  }
  if (!st.isFile()) return json(res, 404, { error: 'arquivo não encontrado' });
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Last-Modified', st.mtime.toUTCString());
  res.setHeader('X-Last-Modified-Ms', String(Math.round(st.mtimeMs)));
  res.setHeader('X-File-Size', String(st.size));
  res.setHeader('Access-Control-Expose-Headers', 'X-Last-Modified-Ms, X-File-Size, Content-Range');
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(st.size - 1, Number(range[2])) : st.size - 1;
    if (start > end || start >= st.size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${st.size}`);
      return res.end();
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(p, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', String(st.size));
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(p).pipe(res);
}

/**
 * Trata uma requisição /__foco/local/*. `url` é o caminho já sem o prefixo (ex.: "/file?p=...").
 * Devolve false se a rota não é desta API.
 */
export async function handleLocal(req, res, url, opts = {}) {
  if (!isLocal(req)) return json(res, 403, { error: 'somente nesta máquina' });
  const u = new URL(url, 'http://local');
  const parts = u.pathname.split('/').filter(Boolean);
  try {
    if (u.pathname === '/ping') return json(res, 200, { mediaDir: mediaDir(), projectsDir: projectsDir(), desktop: !!opts.desktop });
    if (u.pathname === '/file' && (req.method === 'GET' || req.method === 'HEAD')) return sendFile(req, res, u.searchParams.get('p') ?? '');
    if (u.pathname === '/save' && req.method === 'POST') {
      const name = path.basename(u.searchParams.get('name') ?? '').replace(/[<>:"/\\|?*]+/g, '_');
      if (!name || !TYPES[path.extname(name).toLowerCase()]) return json(res, 400, { error: 'nome inválido' });
      fs.mkdirSync(mediaDir(), { recursive: true });
      const target = path.join(mediaDir(), name);
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(target);
        req.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
      });
      return json(res, 200, { path: target });
    }
    if (parts[0] === 'projects') {
      if (parts.length === 1 && req.method === 'GET') return json(res, 200, projectFiles().map(({ id, name, file, mtimeMs }) => ({ id, name, file, mtimeMs })));
      const id = parts[1];
      if (!id || !ID.test(id)) return json(res, 400, { error: 'id inválido' });
      const existing = projectFiles().filter((x) => x.id === id);
      if (req.method === 'GET') {
        if (!existing.length) return json(res, 404, { error: 'projeto não encontrado' });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return fs.createReadStream(existing[0].file).pipe(res);
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        JSON.parse(body.toString('utf8')); // só grava JSON válido
        const dir = projectsDir();
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, `${safeName(u.searchParams.get('name') ?? 'Projeto')} [${id}].foco`);
        const tmp = `${target}.tmp`;
        fs.writeFileSync(tmp, body);
        fs.renameSync(tmp, target); // atômico: nunca fica um arquivo pela metade
        for (const x of existing) if (x.file !== target) fs.rmSync(x.file, { force: true }); // renomeado
        return json(res, 200, { file: target });
      }
      if (req.method === 'DELETE') {
        const trash = path.join(projectsDir(), '.lixeira');
        fs.mkdirSync(trash, { recursive: true });
        for (const x of existing) fs.renameSync(x.file, path.join(trash, `${Date.now()}-${path.basename(x.file)}`));
        return json(res, 200, { moved: existing.length });
      }
    }
    return json(res, 404, { error: 'rota desconhecida' });
  } catch (e) {
    return json(res, 500, { error: String(e?.message ?? e) });
  }
}
