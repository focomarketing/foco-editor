// Migração de projetos salvos em versões anteriores do formato.

import type { Clip, Project } from './types';
import { DEFAULT_TRANSFORM, PROJECT_VERSION } from './types';

type Loose = Record<string, unknown>;

/** Completa campos que não existiam em versões antigas. Nunca perde dados. */
export function migrateClip(raw: Loose): Clip {
  const c = raw as unknown as Clip;
  return {
    ...c,
    speed: typeof c.speed === 'number' && c.speed > 0 ? c.speed : 1,
    fadeIn: typeof c.fadeIn === 'number' ? c.fadeIn : 0,
    fadeOut: typeof c.fadeOut === 'number' ? c.fadeOut : 0,
    transform: { ...DEFAULT_TRANSFORM, ...(c.transform ?? {}) },
  };
}

export function migrateProject(raw: Loose): Project {
  const version = typeof raw.version === 'number' ? raw.version : 1;
  if (version > PROJECT_VERSION) throw new Error(`Projeto criado numa versão mais nova do editor (formato ${version}).`);
  const clips: Record<string, Clip> = {};
  for (const [id, c] of Object.entries((raw.clips ?? {}) as Record<string, Loose>)) clips[id] = migrateClip(c);
  return {
    ...(raw as unknown as Project),
    version: PROJECT_VERSION,
    clips,
    folders: (raw.folders as Project['folders']) ?? {},
    markers: (raw.markers as Project['markers']) ?? [],
    metadata: (raw.metadata as Project['metadata']) ?? {},
  };
}
