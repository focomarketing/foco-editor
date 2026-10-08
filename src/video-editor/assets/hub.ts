// Asset Hub: uma camada única para buscar, pré-visualizar e importar mídia externa com a
// licença registrada. Busca controlada (nunca baixa bibliotecas inteiras): só o item escolhido.

import { downloadImage, searchImages } from '../../engine/images/sources';
import type { ImageCandidate, SourceKeys } from '../../engine/images/sources';
import type { AssetLicenseRef } from '../commands/types';

export interface AssetLicense {
  provider: string;
  licenseName: string;
  sourceUrl: string;
  author?: string;
  attributionRequired: boolean;
  /** Pode ser redistribuído sozinho (ex.: vender/compartilhar o arquivo)? */
  standaloneRedistribution: boolean;
}

export type AssetKind = 'image' | 'video' | 'music' | 'sfx' | 'animation';

export interface AssetProvider {
  id: string;
  label: string;
  kinds: AssetKind[];
  /** Precisa de chave do usuário? */
  needsKey: boolean;
  /** Já integrado (busca funcionando) ou só declarado para o futuro. */
  ready: boolean;
  site: string;
}

export const PROVIDERS: AssetProvider[] = [
  { id: 'wikimedia', label: 'Wikimedia Commons (domínio público / CC0)', kinds: ['image'], needsKey: false, ready: true, site: 'https://commons.wikimedia.org' },
  { id: 'pexels', label: 'Pexels', kinds: ['image', 'video'], needsKey: true, ready: true, site: 'https://www.pexels.com/api/' },
  { id: 'pixabay', label: 'Pixabay', kinds: ['image', 'video', 'music'], needsKey: true, ready: true, site: 'https://pixabay.com/api/docs/' },
  { id: 'freesound', label: 'Freesound (efeitos)', kinds: ['sfx'], needsKey: true, ready: false, site: 'https://freesound.org/docs/api/' },
  { id: 'mixkit', label: 'Mixkit', kinds: ['video', 'music', 'sfx'], needsKey: false, ready: false, site: 'https://mixkit.co' },
  { id: 'lottiefiles', label: 'LottieFiles (animações)', kinds: ['animation'], needsKey: true, ready: false, site: 'https://lottiefiles.com' },
  { id: 'library', label: 'Biblioteca própria', kinds: ['image', 'video', 'music', 'sfx', 'animation'], needsKey: false, ready: false, site: '' },
];

/** Licença completa a partir de um candidato de busca. */
export function licenseOf(c: ImageCandidate): AssetLicense {
  switch (c.source) {
    case 'wikimedia':
      return { provider: 'wikimedia', licenseName: c.license, sourceUrl: c.page, author: c.author, attributionRequired: !/public domain|cc0/i.test(c.license), standaloneRedistribution: /public domain|cc0/i.test(c.license) };
    case 'pexels':
      return { provider: 'pexels', licenseName: 'Pexels License', sourceUrl: c.page, author: c.author, attributionRequired: false, standaloneRedistribution: false };
    case 'pixabay':
      return { provider: 'pixabay', licenseName: 'Pixabay Content License', sourceUrl: c.page, author: c.author, attributionRequired: false, standaloneRedistribution: false };
  }
}

export const toRef = (l: AssetLicense): AssetLicenseRef => ({ provider: l.provider, licenseName: l.licenseName, sourceUrl: l.sourceUrl, author: l.author });

// --- chaves (guardadas só no navegador) ------------------------------------------------------

const KEYS = 'foco.imageKeys';
export function providerKeys(): SourceKeys {
  try {
    return JSON.parse(localStorage.getItem(KEYS) || '{}') as SourceKeys;
  } catch {
    return {};
  }
}
export function saveProviderKeys(k: SourceKeys) {
  try {
    localStorage.setItem(KEYS, JSON.stringify(k));
  } catch {
    /* só nesta sessão */
  }
}

let seq = 0;

/** Busca a primeira imagem boa para as consultas (na ordem) e baixa só ela. */
export async function findImage(queries: string[], opts: { vertical: boolean; preferArchive: boolean; exclude?: Set<string>; signal?: AbortSignal }): Promise<{ file: File; license: AssetLicenseRef } | null> {
  const keys = providerKeys();
  const preferArchive = opts.preferArchive || (!keys.pexels && !keys.pixabay);
  for (const q of queries) {
    const cands = await searchImages(q, { keys, vertical: opts.vertical, preferArchive, signal: opts.signal });
    for (const c of cands) {
      const lic = licenseOf(c);
      if (opts.exclude?.has(lic.sourceUrl)) continue;
      try {
        const file = await downloadImage(c, opts.signal);
        // nome único (o app acha o asset pelo nome depois de importar)
        const named = new File([file], `${Date.now().toString(36)}${(seq++).toString(36)}-${file.name}`, { type: file.type, lastModified: file.lastModified });
        return { file: named, license: toRef(lic) };
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
      }
    }
  }
  return null;
}
