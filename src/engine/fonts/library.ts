// Biblioteca de fontes: a seleção embutida no app (public/fonts/library, gerada por
// scripts/fetch-library-fonts.mjs) + o catálogo inteiro do Google Fonts, baixado sob demanda
// pela API local e guardado em Documentos\FOCO Editor\Fontes (funciona offline depois).
//
// O projeto só guarda o nome da família (font-family). Ao abrir um projeto ou exportar,
// `ensureProjectFonts` carrega as famílias usadas: preview e export desenham com a fonte certa.

import type { Project } from '../../core/types';
import { primaryFamily, SYSTEM_FAMILIES } from './fonts';

export interface FontFaceRef {
  /** '400' ou faixa de fonte variável ('100 900'). */
  weight: string;
  url: string;
}

export interface LibraryFamily {
  family: string;
  /** Impacto, Moderna, Elegante, Manuscrita, Divertida, Tech. */
  category: string;
  faces: FontFaceRef[];
}

export interface GoogleFamily {
  family: string;
  /** Categoria do Google (Sans Serif, Serif, Display, Handwriting, Monospace). */
  category: string;
  popularity: number;
}

const LOCAL = '/__foco/local/fonts';

let manifest: Promise<LibraryFamily[]> | null = null;
/** Seleção embutida no app. */
export function libraryFonts(): Promise<LibraryFamily[]> {
  return (manifest ??= fetch(`${import.meta.env.BASE_URL}fonts/library/manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<LibraryFamily[]>) : []))
    .then((list) => list.map((f) => ({ ...f, faces: f.faces.map((x) => ({ ...x, url: import.meta.env.BASE_URL + x.url })) })))
    .catch(() => []));
}

let catalog: Promise<GoogleFamily[]> | null = null;
/** Catálogo do Google Fonts (só com a API local: app instalado ou `npm run dev`). */
export function googleCatalog(): Promise<GoogleFamily[]> {
  catalog ??= fetch(`${LOCAL}/catalog`).then(async (r) => {
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'catálogo indisponível');
    return r.json() as Promise<GoogleFamily[]>;
  });
  catalog.catch(() => (catalog = null)); // sem internet agora: tenta de novo na próxima abertura
  return catalog;
}

/** Fontes do Google já baixadas neste PC. */
export async function downloadedFonts(): Promise<LibraryFamily[]> {
  const r = await fetch(`${LOCAL}/downloaded`).catch(() => null);
  if (!r?.ok || !(r.headers.get('content-type') ?? '').includes('json')) return [];
  return ((await r.json()) as { family: string; category: string; faces: FontFaceRef[] }[]).map((f) => ({ ...f, category: 'Baixadas' }));
}

async function loadFaces(family: string, faces: FontFaceRef[]) {
  await Promise.all(
    faces.map(async (f) => {
      const face = new FontFace(family, `url("${f.url}") format("woff2")`, { weight: f.weight, style: 'normal', display: 'block' });
      await face.load();
      document.fonts.add(face);
    }),
  );
}

const loaded = new Map<string, Promise<boolean>>();
const key = (family: string) => family.toLowerCase();
const SYSTEM = new Set(SYSTEM_FAMILIES.map(key));
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

/** A família já está carregada (ou sendo carregada) por esta biblioteca? */
export const isLoaded = (family: string) => loaded.has(key(family));

/**
 * Garante a família no navegador: seleção embutida → já baixada → Google Fonts (baixa e guarda).
 * Devolve true se carregou algo novo. Fontes do sistema e importadas não passam por aqui.
 */
export function ensureFamily(family: string): Promise<boolean> {
  const k = key(family);
  if (SYSTEM.has(k) || GENERIC.has(k)) return Promise.resolve(false);
  let p = loaded.get(k);
  if (!p) {
    p = (async () => {
      const lib = (await libraryFonts()).find((f) => key(f.family) === k);
      if (lib) {
        await loadFaces(lib.family, lib.faces);
        return true;
      }
      const r = await fetch(`${LOCAL}/family?name=${encodeURIComponent(family)}`).catch(() => null);
      if (!r?.ok || !(r.headers.get('content-type') ?? '').includes('json')) return false;
      const m = (await r.json()) as { family: string; faces: FontFaceRef[] };
      await loadFaces(m.family, m.faces);
      return true;
    })().catch((e) => {
      console.warn(`[fontes] ${family}:`, e);
      loaded.delete(k); // falhou (ex.: sem internet): tenta de novo no próximo pedido
      return false;
    });
    loaded.set(k, p);
  }
  return p;
}

/** Famílias usadas pelo projeto (legendas, gráficos e textos de elementos), sem as do sistema e as importadas. */
export function projectFamilies(p: Project): string[] {
  const imported = new Set(Object.values(p.assets).filter((a) => a.kind === 'font' && a.fontFamily).map((a) => key(a.fontFamily!)));
  const out = new Map<string, string>();
  for (const c of Object.values(p.clips)) {
    for (const css of [c.caption?.style.fontFamily, c.title?.fontFamily, ...(c.element?.layers.map((l) => l.fontFamily) ?? [])]) {
      if (!css) continue;
      const fam = primaryFamily(css);
      const k = key(fam);
      if (fam && !out.has(k) && !imported.has(k) && !SYSTEM.has(k) && !GENERIC.has(k)) out.set(k, fam);
    }
  }
  return [...out.values()];
}


/** Carrega as fontes da biblioteca usadas pelo projeto. Devolve true se alguma nova entrou. */
export async function ensureProjectFonts(p: Project): Promise<boolean> {
  const results = await Promise.all(projectFamilies(p).map(ensureFamily));
  return results.some(Boolean);
}

// --- prévia do catálogo do Google ------------------------------------------------------------------

const previews = new Map<string, Promise<string | null>>();

/**
 * Prévia leve de uma fonte do Google (só as letras do nome, direto do Google) sob um nome
 * próprio — nunca registra a família verdadeira com um subconjunto incompleto de letras.
 * Devolve o font-family da prévia (null se falhar).
 */
export function previewFamily(family: string): Promise<string | null> {
  let p = previews.get(family);
  if (!p) {
    const alias = `__foco_pv_${family}`;
    p = fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}&text=${encodeURIComponent(family)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(async (css) => {
        const url = /src:\s*url\(([^)]+)\)/.exec(css)?.[1];
        if (!url) return null;
        const face = new FontFace(alias, `url("${url}")`);
        await face.load();
        document.fonts.add(face);
        return alias;
      })
      .catch(() => null);
    previews.set(family, p);
  }
  return p;
}
