// Patches reversíveis entre dois estados do projeto.
// Coleções (clips, assets, folders) são comparadas item a item por referência — o estado é
// imutável, então só o que mudou entra no patch. Os demais campos entram inteiros se mudaram.

import type { Project } from '../../core/types';

const COLLECTIONS = ['clips', 'assets', 'folders'] as const;
type CollectionKey = (typeof COLLECTIONS)[number];
type FieldKey = Exclude<keyof Project, CollectionKey | 'updatedAt'>;

export interface ProjectPatch {
  collections: Partial<Record<CollectionKey, Record<string, [unknown, unknown]>>>;
  fields: Partial<Record<FieldKey, [unknown, unknown]>>;
}

export function diffProjects(before: Project, after: Project): ProjectPatch {
  const patch: ProjectPatch = { collections: {}, fields: {} };
  for (const key of COLLECTIONS) {
    const a = before[key] as Record<string, unknown>;
    const b = after[key] as Record<string, unknown>;
    if (a === b) continue;
    const changes: Record<string, [unknown, unknown]> = {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[id] !== b[id]) changes[id] = [a[id], b[id]];
    }
    if (Object.keys(changes).length) patch.collections[key] = changes;
  }
  for (const key of Object.keys(after) as (keyof Project)[]) {
    if ((COLLECTIONS as readonly string[]).includes(key) || key === 'updatedAt') continue;
    if (before[key] !== after[key]) patch.fields[key as FieldKey] = [before[key], after[key]];
  }
  return patch;
}

export function isEmptyPatch(p: ProjectPatch) {
  return Object.keys(p.collections).length === 0 && Object.keys(p.fields).length === 0;
}

/** Aplica o patch para frente (redo) ou para trás (undo). */
export function applyPatch(p: Project, patch: ProjectPatch, dir: 'forward' | 'backward'): Project {
  const pick = (pair: [unknown, unknown]) => (dir === 'forward' ? pair[1] : pair[0]);
  const next = { ...p } as Record<string, unknown>;
  for (const [key, changes] of Object.entries(patch.collections)) {
    const coll = { ...(next[key] as Record<string, unknown>) };
    for (const [id, pair] of Object.entries(changes!)) {
      const v = pick(pair);
      if (v === undefined) delete coll[id];
      else coll[id] = v;
    }
    next[key] = coll;
  }
  for (const [key, pair] of Object.entries(patch.fields)) next[key] = pick(pair!);
  return next as unknown as Project;
}

/** Ids criados por um patch numa coleção (útil para selecionar o que foi colado/dividido). */
export function createdIds(patch: ProjectPatch, key: CollectionKey): string[] {
  return Object.entries(patch.collections[key] ?? {})
    .filter(([, [a, b]]) => a === undefined && b !== undefined)
    .map(([id]) => id);
}
