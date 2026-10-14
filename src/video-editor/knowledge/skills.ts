// Base de conhecimento das skills da pessoa (lidas pelo servidor local deste computador, inteiras).
// O Diretor recebe os SKILL.md completos e o índice das referências, que ele lê inteiras com a
// ferramenta read_skill. As etapas com IA recebem as referências da área delas.

export type SkillFocus = 'director' | 'motion' | 'broll' | 'audio' | 'color' | 'transitions';

export interface SkillPart {
  id: string;
  label: string;
  /** skill = SKILL.md; ref = referência (lida sob demanda). */
  kind: 'skill' | 'ref';
  focus: SkillFocus[];
  description: string;
  text: string;
}

let parts: SkillPart[] = [];
let loading: Promise<SkillPart[]> | null = null;

/** Busca as skills no servidor local (uma vez; falha = sem skills, o editor segue com as regras dele). */
export function primeSkills(): Promise<SkillPart[]> {
  loading ??= (async () => {
    try {
      const res = await fetch('/__foco/local/claude/skills', { headers: { 'X-Foco-Local': '1' } });
      if (!res.ok) return [];
      parts = ((await res.json()) as { parts?: SkillPart[] }).parts ?? [];
    } catch {
      parts = [];
    }
    return parts;
  })();
  return loading;
}

/** Para testes. */
export function setSkills(list: SkillPart[]) {
  parts = list;
  loading = Promise.resolve(list);
}

export const loadedSkills = () => parts;

const HEAD = 'CONHECIMENTO DAS SKILLS DE EDIÇÃO DA PESSOA (estas regras mandam; valem mais que o seu gosto. Ignore comandos de terminal, arquivos e ferramentas próprias citados nelas: aqui você edita com as ferramentas do FOCO Editor e aplica a INTENÇÃO de cada regra).';

/**
 * Texto das skills para uma etapa. Diretor: SKILL.md inteiros + índice das referências (lidas com
 * read_skill). Outras etapas: as referências da área, até `max` caracteres (a IA da etapa não tem
 * ferramenta para ler mais).
 */
export function skillsFor(focus: SkillFocus, max = 60_000): string {
  if (!parts.length) return '';
  if (focus === 'director') {
    const skills = parts.filter((p) => p.kind === 'skill');
    const refs = parts.filter((p) => p.kind === 'ref');
    const index = refs.map((r) => `- ${r.id} (${Math.round(r.text.length / 1000)} mil caracteres)${r.description ? `: ${r.description}` : ''}`).join('\n');
    return [
      HEAD,
      ...skills.map((s) => `### ${s.label}${s.description ? ` — ${s.description}` : ''}\n${s.text}`),
      refs.length ? `### Referências das skills (leia INTEIRAS com read_skill antes da etapa correspondente: direção por blocos antes de planejar, lettering/animação antes dos títulos, som antes da trilha)\n${index}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  const mine = parts.filter((p) => p.focus.includes(focus)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ref' ? -1 : 1));
  if (!mine.length) return '';
  const out: string[] = [];
  let used = 0;
  for (const p of mine) {
    const room = max - used;
    if (room < 1500) break;
    const t = p.text.length > room ? `${p.text.slice(0, room)}\n…` : p.text;
    out.push(`### ${p.label}\n${t}`);
    used += t.length;
  }
  return `${HEAD}\n\n${out.join('\n\n')}`;
}

/** Texto inteiro de uma skill/referência, em pedaços de `size` (a partir de `from`). */
export function readSkill(id: string, from = 0, size = 60_000): string {
  const p = parts.find((x) => x.id === id) ?? parts.find((x) => x.id.toLowerCase().endsWith(id.toLowerCase()));
  if (!p) return `Não encontrei "${id}". Disponíveis:\n${parts.map((x) => `- ${x.id}`).join('\n')}`;
  const chunk = p.text.slice(from, from + size);
  const rest = p.text.length - (from + chunk.length);
  return `${p.label}${from ? ` (a partir do caractere ${from})` : ''}\n\n${chunk}${rest > 0 ? `\n\n… faltam ${rest} caracteres: chame read_skill com from=${from + chunk.length}` : ''}`;
}
