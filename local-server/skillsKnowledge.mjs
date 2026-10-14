// Skills da pessoa como base de conhecimento do editor. O Diretor e as etapas leem as regras de
// direção, lettering, som, transição e cor das skills que ela criou ou comprou:
//   - as do projeto (transição e colorista) vêm junto com o editor (local-server/skills);
//   - TODAS as do Claude Code da pessoa (~/.claude/skills) são lidas NESTE computador, na hora de
//     usar, inteiras (SKILL.md e todas as referências), e só vão para a conta Claude dela. Nada
//     disso é copiado para o instalador. As skills do sistema do Claude (pasta "synced") ficam fora.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USER_SKILLS = () => process.env.FOCO_SKILLS_DIR || path.join(os.homedir(), '.claude', 'skills');

/** Limite de segurança por arquivo (um markdown de skill nunca chega perto disto). */
const MAX_PART = 400_000;
/** Pastas da skill que têm texto de conhecimento (o resto é código, modelos, ambiente). */
const KNOWLEDGE_DIRS = ['references', 'fichas', 'docs', 'guides'];

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

/** Corpo do markdown sem o cabeçalho YAML e sem blocos de comando de terminal. */
function body(md) {
  return md
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/```(?:bash|sh|shell|powershell|ps1|zsh|console)[\s\S]*?```/g, '')
    .slice(0, MAX_PART);
}

const describe = (md) => /description:\s*(.+)/.exec(md ?? '')?.[1]?.trim() ?? '';

/** Em que etapa uma referência ajuda (pelo nome do arquivo). */
function focusOf(file) {
  const f = file.toLowerCase();
  const out = ['director'];
  if (/letter|anima|motion|texto|tipogra/.test(f)) out.push('motion');
  if (/dire[cç]|bloco|enquadra|broll|imagem|modelo/.test(f)) out.push('broll', 'motion');
  if (/som|trilha|audio|sfx|music/.test(f)) out.push('audio');
  if (/cor|color|grade|lut/.test(f)) out.push('color');
  if (/transi/.test(f)) out.push('transitions');
  return [...new Set(out)];
}

/**
 * Partes: { id, label, kind: 'skill' | 'ref', focus[], description, text }.
 * kind 'skill' = SKILL.md (entra inteiro no Diretor); 'ref' = referência (o Diretor lê sob demanda).
 */
export function loadSkills() {
  const parts = [];
  const bundled = [
    ['professional-video-editor', 'Colorista (skill do projeto)', ['color', 'director']],
    ['professional-transition-designer', 'Transições (skill do projeto)', ['transitions', 'director']],
  ];
  for (const [id, label, focus] of bundled) {
    const t = read(path.join(HERE, 'skills', `${id}.md`));
    if (t) parts.push({ id, label, kind: 'skill', focus, description: describe(t), text: body(t) });
  }
  const dir = USER_SKILLS();
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'synced' && !d.name.startsWith('.')).map((d) => d.name);
  } catch {
    /* sem skills */
  }
  for (const name of names) {
    const md = read(path.join(dir, name, 'SKILL.md'));
    if (!md) continue;
    parts.push({ id: name, label: `${name} (sua skill)`, kind: 'skill', focus: ['director', 'motion', 'broll', 'audio', 'color', 'transitions'], description: describe(md), text: body(md) });
    for (const sub of KNOWLEDGE_DIRS) {
      let files = [];
      try {
        files = fs.readdirSync(path.join(dir, name, sub)).filter((f) => /\.(md|txt)$/i.test(f));
      } catch {
        continue;
      }
      for (const f of files) {
        const t = read(path.join(dir, name, sub, f));
        if (t) parts.push({ id: `${name}/${sub}/${f.replace(/\.(md|txt)$/i, '')}`, label: `${name} · ${f}`, kind: 'ref', focus: focusOf(f), description: (t.match(/^#\s+(.+)$/m)?.[1] ?? '').slice(0, 120), text: body(t) });
      }
    }
  }
  return { parts };
}
