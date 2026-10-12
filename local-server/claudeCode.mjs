// "Minha conta Claude": o editor usa o Claude Code instalado nesta máquina, com o login da
// assinatura da pessoa (sem chave de API). Cada pergunta roda `claude -p` isolado: sem
// ferramentas, sem MCP, sem as configurações/hooks pessoais, sem guardar sessão, numa pasta
// vazia (nenhum CLAUDE.md entra) e com saída estruturada pelo JSON Schema da skill.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXE = process.platform === 'win32' ? 'claude.exe' : 'claude';
const TIMEOUT_MS = 10 * 60_000;

/** Pastas de extensões de editores onde o Claude Code traz o próprio executável. */
const EXTENSION_DIRS = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.antigravity-ide', '.vscodium'].map((d) => path.join(os.homedir(), d, 'extensions'));

const versionOf = (name) => (/(\d+)\.(\d+)\.(\d+)/.exec(name) ?? [0, 0, 0, 0]).slice(1).map(Number);
const newer = (a, b) => {
  const [x, y] = [versionOf(a), versionOf(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return 0;
};

let cached;

/** Caminho do executável do Claude Code (ou null). */
export function findClaude() {
  if (cached !== undefined && (cached === null || fs.existsSync(cached))) return cached;
  const candidates = [];
  if (process.env.FOCO_CLAUDE_PATH) candidates.push(process.env.FOCO_CLAUDE_PATH);
  candidates.push(path.join(os.homedir(), '.local', 'bin', EXE), path.join(os.homedir(), '.claude', 'local', EXE));
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    candidates.push(...out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/\.(cmd|ps1|bat)$/i.test(s)));
  } catch {
    /* não está no PATH */
  }
  for (const dir of EXTENSION_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const exts = fs.readdirSync(dir).filter((n) => n.startsWith('anthropic.claude-code-')).sort(newer);
    for (const n of exts) candidates.push(path.join(dir, n, 'resources', 'native-binary', EXE));
  }
  cached = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) ?? null;
  return cached;
}

/** Login da assinatura feito no Claude Code? (arquivo de credenciais ou, no Mac, o chaveiro) */
export function claudeStatus() {
  const bin = findClaude();
  const creds = fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'));
  return { available: !!bin, path: bin, loggedIn: creds || process.platform === 'darwin' };
}

function workDir() {
  const dir = path.join(os.tmpdir(), 'foco-editor-claude');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Uma pergunta estruturada: system + user (texto) → objeto do schema.
 * `signal` cancela (o processo é encerrado).
 */
export function askClaude({ system, user, schema, model, effort = 'medium' }, signal) {
  const bin = findClaude();
  if (!bin) return Promise.reject(new Error('Claude Code não encontrado neste computador. Instale o Claude Code e faça login com a sua conta.'));
  const dir = workDir();
  const sysFile = path.join(dir, `sys-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(sysFile, system ?? '', 'utf8');
  const args = ['-p', '--output-format', 'json', '--system-prompt-file', sysFile, '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '', '--effort', effort];
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (model) args.push('--model', model);
  // a cobrança vai para a assinatura: nenhuma chave de API herdada do ambiente
  const env = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete env[k];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: dir, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      fs.rm(sysFile, { force: true }, () => {});
      fn();
    };
    const onAbort = () => finish(() => {
      child.kill();
      reject(Object.assign(new Error('Cancelado.'), { name: 'AbortError' }));
    });
    const timer = setTimeout(() => finish(() => {
      child.kill();
      reject(new Error('O Claude demorou demais (10 min).'));
    }), TIMEOUT_MS);
    signal?.addEventListener?.('abort', onAbort);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish(() => reject(new Error(`Não consegui abrir o Claude Code: ${e.message}`))));
    child.on('close', () =>
      finish(() => {
        let r;
        try {
          r = JSON.parse(out);
        } catch {
          const msg = (err || out).trim().slice(0, 300);
          return reject(new Error(/login|auth|credential/i.test(msg) ? 'Faça login no Claude Code com a sua conta (rode "claude" uma vez).' : `O Claude Code não respondeu: ${msg || 'sem saída'}`));
        }
        if (r.is_error) return reject(new Error(String(r.result || r.subtype || 'erro do Claude').slice(0, 300)));
        let data = r.structured_output;
        if (data === undefined && typeof r.result === 'string') {
          const s = r.result;
          try {
            data = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
          } catch {
            return reject(new Error('o Claude não devolveu JSON'));
          }
        }
        resolve({ data, model: Object.keys(r.modelUsage ?? {}).find((m) => !/haiku/.test(m)) ?? model ?? 'claude' });
      }),
    );
    child.stdin.end(user ?? '', 'utf8');
  });
}
