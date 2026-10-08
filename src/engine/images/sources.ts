// Fontes de imagem para a fase Imagens. Cada busca devolve candidatos com autor e licença,
// que vão para os metadados do asset (créditos). Só entram licenças livres para uso:
// Wikimedia (domínio público / CC0, sem chave), Pexels e Pixabay (licenças próprias, com chave).

export type ImageSourceId = 'wikimedia' | 'pexels' | 'pixabay';

export interface ImageCandidate {
  source: ImageSourceId;
  url: string; // arquivo para baixar (já redimensionado quando a fonte permite)
  width: number;
  height: number;
  title: string;
  author: string;
  license: string;
  page: string; // página de origem (crédito)
}

export interface SourceKeys {
  pexels?: string;
  pixabay?: string;
}

const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const FREE_LICENSE = /^(public domain|pd|cc0|cc-?zero)/i;

export async function searchWikimedia(query: string, signal?: AbortSignal, limit = 8): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({
    origin: '*',
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(limit * 2),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1920',
    iiextmetadatafilter: 'LicenseShortName|Artist|ObjectName',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal });
  if (!res.ok) throw new Error(`Wikimedia respondeu ${res.status}`);
  const data = (await res.json()) as { query?: { pages?: Record<string, { index: number; title: string; imageinfo?: { thumburl?: string; url: string; thumbwidth?: number; thumbheight?: number; width: number; height: number; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }> } };
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  const out: ImageCandidate[] = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const license = ii.extmetadata?.LicenseShortName?.value ?? '';
    if (!FREE_LICENSE.test(license.trim())) continue;
    out.push({
      source: 'wikimedia',
      url: ii.thumburl ?? ii.url,
      width: ii.thumbwidth ?? ii.width,
      height: ii.thumbheight ?? ii.height,
      title: strip(ii.extmetadata?.ObjectName?.value ?? p.title.replace(/^File:/, '')),
      author: strip(ii.extmetadata?.Artist?.value ?? 'desconhecido'),
      license,
      page: ii.descriptionurl,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchPexels(query: string, key: string, orientation: 'landscape' | 'portrait', signal?: AbortSignal): Promise<ImageCandidate[]> {
  const res = await fetch(`https://api.pexels.com/v1/search?${new URLSearchParams({ query, orientation, per_page: '8' })}`, { headers: { Authorization: key }, signal });
  if (res.status === 401) throw new Error('Chave do Pexels inválida.');
  if (!res.ok) throw new Error(`Pexels respondeu ${res.status}`);
  const data = (await res.json()) as { photos?: { width: number; height: number; url: string; photographer: string; alt: string; src: { large2x: string } }[] };
  return (data.photos ?? []).map((p) => ({ source: 'pexels', url: p.src.large2x, width: p.width, height: p.height, title: p.alt || query, author: p.photographer, license: 'Licença Pexels', page: p.url }));
}

export async function searchPixabay(query: string, key: string, orientation: 'horizontal' | 'vertical', signal?: AbortSignal): Promise<ImageCandidate[]> {
  const res = await fetch(`https://pixabay.com/api/?${new URLSearchParams({ key, q: query, image_type: 'photo', orientation, per_page: '8', safesearch: 'true' })}`, { signal });
  if (res.status === 400 || res.status === 401) throw new Error('Chave do Pixabay inválida.');
  if (!res.ok) throw new Error(`Pixabay respondeu ${res.status}`);
  const data = (await res.json()) as { hits?: { largeImageURL: string; imageWidth: number; imageHeight: number; user: string; tags: string; pageURL: string }[] };
  return (data.hits ?? []).map((h) => ({ source: 'pixabay', url: h.largeImageURL, width: h.imageWidth, height: h.imageHeight, title: h.tags, author: h.user, license: 'Licença Pixabay', page: h.pageURL }));
}

/**
 * Busca nas fontes disponíveis, na ordem de preferência do tipo de vídeo
 * (ex.: estudo cristão/documentário → arte e arquivo antes de banco de fotos).
 */
export async function searchImages(query: string, opts: { keys: SourceKeys; vertical: boolean; preferArchive: boolean; signal?: AbortSignal }): Promise<ImageCandidate[]> {
  const tasks: (() => Promise<ImageCandidate[]>)[] = [];
  const wiki = () => searchWikimedia(query, opts.signal);
  const pexels = opts.keys.pexels ? () => searchPexels(query, opts.keys.pexels!, opts.vertical ? 'portrait' : 'landscape', opts.signal) : null;
  const pixabay = opts.keys.pixabay ? () => searchPixabay(query, opts.keys.pixabay!, opts.vertical ? 'vertical' : 'horizontal', opts.signal) : null;
  if (opts.preferArchive) tasks.push(wiki);
  if (pexels) tasks.push(pexels);
  if (pixabay) tasks.push(pixabay);
  if (!opts.preferArchive) tasks.push(wiki);
  const out: ImageCandidate[] = [];
  for (const t of tasks) {
    try {
      out.push(...(await t()));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      console.warn('[imagens]', e);
    }
    if (out.length >= 6) break;
  }
  // Imagens pequenas demais ficam borradas em tela cheia. Páginas de livro, capas, mapas e
  // diagramas raramente servem de B-roll; só entram se a busca pediu isso.
  const wantsDoc = /\b(book|page|manuscript|map|diagram|chart|scroll|bible)\b/i.test(query);
  const docLike = /\b(page|book|title|cover|frontispiece|map|diagram|chart|logo|coat of arms|text|letter|document|ornament)\b/i;
  return out.filter((c) => Math.max(c.width, c.height) >= 900 && (wantsDoc || !docLike.test(c.title)));
}

export async function downloadImage(c: ImageCandidate, signal?: AbortSignal): Promise<File> {
  const res = await fetch(c.url, { signal });
  if (!res.ok) throw new Error(`não consegui baixar a imagem (${res.status})`);
  const blob = await res.blob();
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
  const safe = c.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 40) || 'imagem';
  return new File([blob], `${safe}.${ext}`, { type: blob.type || 'image/jpeg', lastModified: Date.now() });
}
