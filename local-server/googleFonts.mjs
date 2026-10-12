// Google Fonts sem chave de API: catálogo (fonts.google.com/metadata/fonts) e download dos
// arquivos .woff2 (subconjunto "latin", que cobre o português). Usado pela API local
// (fontes baixadas pela pessoa, guardadas no PC) e por scripts/fetch-library-fonts.mjs
// (biblioteca embutida no app). Todas as fontes do Google Fonts são de licença livre (OFL/Apache).

import fs from 'node:fs';
import path from 'node:path';

// Com um navegador moderno no User-Agent o Google entrega .woff2 (e fontes variáveis).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const CATALOG_URL = 'https://fonts.google.com/metadata/fonts';

/** Catálogo compacto: só famílias com o subconjunto latin, mais populares primeiro. */
export async function fetchCatalog() {
  const res = await fetch(CATALOG_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Google Fonts respondeu ${res.status}`);
  // a resposta às vezes vem com o prefixo anti-JSON-hijacking ")]}'"
  const raw = JSON.parse((await res.text()).replace(/^\)\]\}'\s*/, ''));
  return raw.familyMetadataList
    .filter((f) => f.subsets?.includes('latin'))
    .map((f) => {
      const axis = (f.axes ?? []).find((a) => a.tag === 'wght');
      return {
        family: f.family,
        category: f.category,
        popularity: f.popularity ?? 9999,
        weights: Object.keys(f.fonts ?? {}).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b),
        wght: axis ? [axis.min, axis.max] : null,
      };
    })
    .filter((f) => f.weights.length || f.wght)
    .sort((a, b) => a.popularity - b.popularity);
}

/** URL do CSS do Google para a família inteira (variável numa faixa, ou os pesos estáticos). */
export function cssUrl(entry) {
  const fam = entry.family.replace(/ /g, '+');
  const axis = entry.wght ? `${entry.wght[0]}..${entry.wght[1]}` : entry.weights.join(';');
  return `https://fonts.googleapis.com/css2?family=${fam}:wght@${axis}&display=swap`;
}

/** Blocos @font-face do subconjunto latin, estilo normal: [{ weight: '400' | '100 900', url }]. */
export function parseLatinFaces(css) {
  const faces = [];
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    if (m[1] !== 'latin') continue;
    const body = m[2];
    const style = /font-style:\s*(\w+)/.exec(body)?.[1] ?? 'normal';
    const weight = /font-weight:\s*([\d ]+);/.exec(body)?.[1]?.trim() ?? '400';
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1];
    if (style === 'normal' && url) faces.push({ weight, url });
  }
  // fonte variável: o Google repete o mesmo arquivo para cada peso pedido
  const seen = new Set();
  return faces.filter((f) => (seen.has(f.url) ? false : (seen.add(f.url), true)));
}

export const safeDirName = (family) => family.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-');

/**
 * Baixa a família para `dir` (ex.: Fontes/Montserrat/) e grava faces.json.
 * Devolve { family, category, faces: [{ weight, file }] } com `file` relativo a `dir`.
 */
export async function downloadFamily(entry, dir) {
  const css = await fetch(cssUrl(entry), { headers: { 'User-Agent': UA } });
  if (!css.ok) throw new Error(`"${entry.family}" não foi encontrada no Google Fonts (${css.status})`);
  const faces = parseLatinFaces(await css.text());
  if (!faces.length) throw new Error(`"${entry.family}" não tem arquivos para o alfabeto latino`);
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const f of faces) {
    const res = await fetch(f.url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`falha ao baixar ${entry.family} ${f.weight} (${res.status})`);
    const file = `${safeDirName(entry.family)}-${f.weight.replace(' ', '-')}.woff2`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
    out.push({ weight: f.weight, file });
  }
  const manifest = { family: entry.family, category: entry.category, faces: out };
  fs.writeFileSync(path.join(dir, 'faces.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
