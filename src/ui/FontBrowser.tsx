import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Loader2, Search } from 'lucide-react';
import { availableFonts, primaryFamily } from '../engine/fonts/fonts';
import { downloadedFonts, ensureFamily, googleCatalog, libraryFonts, previewFamily } from '../engine/fonts/library';
import type { GoogleFamily, LibraryFamily } from '../engine/fonts/library';
import { notify } from '../app/notify';
import { useEditor, useMediaVersion } from './hooks';

const CATEGORIES = ['Todas', 'Impacto', 'Moderna', 'Elegante', 'Manuscrita', 'Divertida', 'Tech', 'Google Fonts'] as const;
type Category = (typeof CATEGORIES)[number];

/** Rótulo em português das categorias do Google. */
const GOOGLE_CATEGORY: Record<string, string> = { 'Sans Serif': 'sem serifa', Serif: 'serifa', Display: 'display', Handwriting: 'manuscrita', Monospace: 'mono' };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Row {
  family: string;
  tag: string;
}

/**
 * Navegador de fontes: importadas, biblioteca embutida (por categoria), baixadas do Google,
 * sistema e busca no catálogo do Google Fonts. Cada nome aparece escrito na própria fonte.
 * `value` = família atual (marcada); `onPick` recebe a família escolhida, já carregada.
 */
export function FontBrowser({ value, onPick, autoFocus }: { value?: string; onPick?: (family: string) => void; autoFocus?: boolean }) {
  const { project } = useEditor();
  useMediaVersion();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<Category>('Todas');
  const [library, setLibrary] = useState<LibraryFamily[]>([]);
  const [downloaded, setDownloaded] = useState<LibraryFamily[]>([]);
  const [google, setGoogle] = useState<GoogleFamily[] | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pv, setPv] = useState<Record<string, string>>({});

  useEffect(() => {
    void libraryFonts().then((list) => {
      setLibrary(list);
      for (const f of list) void ensureFamily(f.family); // a lista aparece já em cada fonte
    });
    void downloadedFonts().then((list) => {
      setDownloaded(list);
      for (const f of list) void ensureFamily(f.family);
    });
  }, []);

  const q = norm(query.trim());
  const wantGoogle = cat === 'Google Fonts' || (cat === 'Todas' && q.length >= 2);
  useEffect(() => {
    if (!wantGoogle || google || googleError) return;
    googleCatalog().then(setGoogle, (e: unknown) => setGoogleError(e instanceof Error ? e.message : String(e)));
  }, [wantGoogle, google, googleError]);

  const match = (family: string) => !q || norm(family).includes(q);
  const known = useMemo(() => new Set([...library, ...downloaded].map((f) => f.family.toLowerCase())), [library, downloaded]);

  const sections: { title: string; rows: Row[] }[] = [];
  if (cat === 'Todas') {
    const local = availableFonts(project);
    sections.push({ title: 'Importadas', rows: local.filter((f) => f.source === 'imported' && match(f.family)).map((f) => ({ family: f.family, tag: 'importada' })) });
    sections.push({ title: 'Biblioteca', rows: library.filter((f) => match(f.family)).map((f) => ({ family: f.family, tag: f.category.toLowerCase() })) });
    sections.push({ title: 'Baixadas do Google', rows: downloaded.filter((f) => match(f.family)).map((f) => ({ family: f.family, tag: 'baixada' })) });
    sections.push({ title: 'Sistema', rows: local.filter((f) => f.source === 'system' && match(f.family)).map((f) => ({ family: f.family, tag: 'sistema' })) });
  } else if (cat !== 'Google Fonts') {
    sections.push({ title: cat, rows: library.filter((f) => f.category === cat && match(f.family)).map((f) => ({ family: f.family, tag: f.category.toLowerCase() })) });
  }
  const googleRows: Row[] = wantGoogle && google
    ? google.filter((f) => !known.has(f.family.toLowerCase()) && match(f.family)).slice(0, 40).map((f) => ({ family: f.family, tag: GOOGLE_CATEGORY[f.category] ?? f.category.toLowerCase() }))
    : [];

  // prévia das fontes do Google visíveis (só as letras do nome)
  const googleKey = googleRows.map((r) => r.family).join('|');
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!googleKey) return;
    for (const family of googleKey.split('|')) {
      if (requested.current.has(family)) continue;
      requested.current.add(family);
      void previewFamily(family).then((alias) => alias && setPv((m) => ({ ...m, [family]: alias })));
    }
  }, [googleKey]);

  const pick = async (family: string, fromGoogle: boolean) => {
    if (busy) return;
    setBusy(family);
    try {
      const ok = await ensureFamily(family);
      if (fromGoogle && !ok) throw new Error('não foi possível baixar (sem internet?)');
      if (fromGoogle) setDownloaded(await downloadedFonts());
      onPick?.(family);
    } catch (e) {
      notify(`Fonte ${family}: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const current = value ? primaryFamily(value).toLowerCase() : '';
  const row = (r: Row, fromGoogle = false, previewFont?: string) => (
    <button
      key={`${fromGoogle ? 'g' : 'l'}:${r.family}`}
      className={`font-row${r.family.toLowerCase() === current ? ' on' : ''}`}
      style={{ fontFamily: `"${previewFont ?? r.family}", "Segoe UI", sans-serif` }}
      onClick={() => void pick(r.family, fromGoogle)}
      title={fromGoogle ? `Baixar ${r.family} do Google Fonts${onPick ? ' e usar' : ''}` : r.family}
      data-testid={`font-${r.family}`}
    >
      <span>{r.family}</span>
      <em>
        {busy === r.family ? <Loader2 size={11} className="spin" /> : r.family.toLowerCase() === current ? <Check size={11} /> : fromGoogle ? <Download size={11} /> : null}
        {r.tag}
      </em>
    </button>
  );

  const empty = sections.every((s) => !s.rows.length) && !googleRows.length;
  return (
    <div className="font-browser">
      <div className="font-search">
        <Search size={12} />
        <input
          autoFocus={autoFocus}
          placeholder="Buscar fonte (inclui o Google Fonts)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="font-search"
        />
      </div>
      <div className="font-cats">
        {CATEGORIES.map((c) => (
          <button key={c} className={`font-chip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      <div className="font-list">
        {sections.map((s) => s.rows.length > 0 && (
          <div key={s.title}>
            <div className="font-sec">{s.title}</div>
            {s.rows.map((r) => row(r))}
          </div>
        ))}
        {wantGoogle && (
          <div>
            <div className="font-sec">Google Fonts{google ? ` · ${google.length} famílias` : ''}</div>
            {googleError ? (
              <p className="font-msg">Busca no Google Fonts indisponível: {googleError}. Ela funciona no app instalado, com internet.</p>
            ) : !google ? (
              <p className="font-msg"><Loader2 size={11} className="spin" /> Carregando o catálogo…</p>
            ) : googleRows.length ? (
              googleRows.map((r) => row(r, true, pv[r.family]))
            ) : (
              <p className="font-msg">Nenhuma fonte do Google com esse nome.</p>
            )}
          </div>
        )}
        {empty && !wantGoogle && <p className="font-msg">Nenhuma fonte encontrada. Digite 2 letras ou mais para buscar também no Google Fonts.</p>}
      </div>
    </div>
  );
}
