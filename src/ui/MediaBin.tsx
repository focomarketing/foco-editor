import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  AudioLines, ChevronLeft, Film, Folder as FolderIcon, FolderPlus, Image as ImageIcon, LayoutGrid, List, Pencil, Plus, Search, Shapes, Trash2, Type,
} from 'lucide-react';
import type { Asset, AssetKind } from '../core/types';
import { formatBytes, formatDuration } from '../core/time';
import { actions, media } from '../app/editor';
import { hasTimeLimit } from '../engine/timeline/operations';
import { jobs } from '../engine/jobs/JobQueue';
import { describeAsset } from '../engine/media/probe';
import { useEditor, useMediaVersion } from './hooks';

export const ASSET_MIME = 'application/x-foco-asset';
const ASSETS_MIME = 'application/x-foco-assets';

type SortKey = 'name' | 'date' | 'duration' | 'type';

const KIND_ICON: Record<AssetKind, typeof Film> = { video: Film, audio: AudioLines, image: ImageIcon, svg: Shapes, font: Type };
const KIND_LABEL: Record<AssetKind, string> = { video: 'vídeo', audio: 'áudio', image: 'imagem', svg: 'SVG', font: 'fonte' };

function readPref<T extends string>(key: string, def: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? def;
  } catch {
    return def;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}

/** Media Bin. `only` filtra por tipo (ex.: aba Áudio). */
export function MediaBin({ only, title = 'Mídia' }: { only?: AssetKind[]; title?: string }) {
  const { project } = useEditor();
  useMediaVersion();
  useSyncExternalStore(jobs.subscribe, jobs.getVersion);
  const [over, setOver] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(() => readPref('foco.bin.sort', 'name'));
  const [view, setView] = useState<'list' | 'grid'>(() => readPref('foco.bin.view', 'list'));
  const [selected, setSelected] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null | undefined>(undefined);

  const folder = folderId ? project.folders[folderId] : null;
  const currentFolder = folder ? folder.id : null;
  const q = query.trim().toLowerCase();

  const assets = useMemo(() => {
    let list = Object.values(project.assets).filter((a) => !only || only.includes(a.kind));
    // Busca procura em todas as pastas; sem busca, mostra só a pasta atual.
    list = q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list.filter((a) => (a.folderId ?? null) === currentFolder);
    const by: Record<SortKey, (a: Asset, b: Asset) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }),
      date: (a, b) => b.lastModified - a.lastModified,
      duration: (a, b) => b.duration - a.duration,
      type: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
    };
    return list.sort(by[sort]);
  }, [project.assets, only, q, currentFolder, sort]);

  const folders = q ? [] : Object.values(project.folders).filter((f) => f.parentId === currentFolder).sort((a, b) => a.name.localeCompare(b.name));
  const all = Object.values(project.assets);
  const needsPermission = all.filter((a) => media.get(a.id)?.status === 'needs-permission').length;
  const offline = all.filter((a) => (media.get(a.id)?.status ?? 'offline') === 'offline').length;

  const select = (id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else if (e.shiftKey && selected.length) {
      const ids = assets.map((a) => a.id);
      const a = ids.indexOf(selected.at(-1)!);
      const b = ids.indexOf(id);
      setSelected(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else setSelected([id]);
  };

  const dropOnFolder = (target: string | null) => (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(ASSETS_MIME);
    setDropFolder(undefined);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    actions.moveAssets(JSON.parse(raw) as string[], target);
  };
  const folderDragOver = (target: string | null) => (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(ASSETS_MIME)) {
      e.preventDefault();
      setDropFolder(target);
    }
  };

  return (
    <section className="panel bin-panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="spacer" />
        {!only && (
          <button className="btn icon sm" title="Nova pasta" onClick={() => setRenaming(actions.newFolder(currentFolder))}>
            <FolderPlus size={14} />
          </button>
        )}
        <button className="btn icon sm" title={view === 'list' ? 'Ver em grade' : 'Ver em lista'} onClick={() => {
          const v = view === 'list' ? 'grid' : 'list';
          setView(v);
          writePref('foco.bin.view', v);
        }}>
          {view === 'list' ? <LayoutGrid size={14} /> : <List size={14} />}
        </button>
        <button className="btn sm outline" onClick={() => void actions.importMedia()} title="Importar arquivos (Ctrl+I)">
          <Plus size={14} /> Importar
        </button>
      </div>

      <div className="bin-tools">
        <label className="search">
          <Search size={13} />
          <input value={query} placeholder="Buscar" onChange={(e) => setQuery(e.target.value)} data-testid="bin-search" />
        </label>
        <select value={sort} title="Ordenar" onChange={(e) => {
          setSort(e.target.value as SortKey);
          writePref('foco.bin.sort', e.target.value);
        }}>
          <option value="name">Nome</option>
          <option value="date">Data</option>
          <option value="duration">Duração</option>
          <option value="type">Tipo</option>
        </select>
      </div>

      {folder && !q && (
        <button
          className={`crumb${dropFolder === folder.parentId ? ' drop' : ''}`}
          onClick={() => setFolderId(folder.parentId)}
          onDragOver={folderDragOver(folder.parentId)}
          onDragLeave={() => setDropFolder(undefined)}
          onDrop={dropOnFolder(folder.parentId)}
          title="Voltar (solte aqui para tirar da pasta)"
        >
          <ChevronLeft size={13} /> {folder.name}
        </button>
      )}

      <MediaReconnectBanner needsPermission={needsPermission} offline={offline} />

      <div
        className={`panel-body bin ${view}${over ? ' drop-over' : ''}`}
        tabIndex={0}
        onClick={(e) => e.target === e.currentTarget && setSelected([])}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
            e.preventDefault();
            e.stopPropagation();
            actions.removeAssets(selected);
            setSelected([]);
          } else if (e.key === 'F2' && selected.length === 1) {
            e.preventDefault();
            e.stopPropagation();
            setRenaming(selected[0]);
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            e.stopPropagation();
            setSelected(assets.map((a) => a.id));
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.stopPropagation();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          actions.importDataTransfer(e.dataTransfer);
        }}
      >
        {folders.map((f) => (
          <div
            key={f.id}
            className={`folder${dropFolder === f.id ? ' drop' : ''}`}
            onDoubleClick={() => setFolderId(f.id)}
            onDragOver={folderDragOver(f.id)}
            onDragLeave={() => setDropFolder(undefined)}
            onDrop={dropOnFolder(f.id)}
            title="Duplo clique para abrir · arraste mídias para cá"
          >
            <FolderIcon size={18} />
            {renaming === f.id ? (
              <RenameInput value={f.name} onDone={(v) => { if (v !== null) actions.renameFolder(f.id, v); setRenaming(null); }} />
            ) : (
              <span className="asset-name">{f.name}</span>
            )}
            <span className="asset-meta">{Object.values(project.assets).filter((a) => a.folderId === f.id).length}</span>
            <button className="btn icon sm" title="Renomear" onClick={() => setRenaming(f.id)}><Pencil size={12} /></button>
            <button className="btn icon sm danger" title="Apagar pasta (as mídias sobem um nível)" onClick={() => actions.removeFolder(f.id)}><Trash2 size={12} /></button>
          </div>
        ))}

        {!only && media.pending.map((pd) => (
          <div key={pd.id} className={`asset pending ${pd.status}`} data-testid="pending-import">
            <div className="asset-thumb"><Film size={18} /></div>
            <div className="asset-info">
              <div className="asset-name">{pd.name}</div>
              <div className="asset-meta">
                {pd.status === 'analyzing' ? (
                  <span className="st st-processing">Analisando · {Math.round((jobs.jobs.find((j) => j.id === pd.jobId)?.progress ?? 0) * 100)}% {jobs.jobs.find((j) => j.id === pd.jobId)?.detail ?? ''}</span>
                ) : (
                  <span className="st st-error" title={pd.error}>Erro: {pd.error}</span>
                )}
                {' · '}{formatBytes(pd.size)}
              </div>
              {pd.status === 'error' && (
                <div className="asset-row-actions">
                  <button className="btn sm outline" onClick={() => { media.dismissPending(pd.id); void actions.importItems([pd.item]); }}>Tentar de novo</button>
                  <button className="btn sm" onClick={() => media.dismissPending(pd.id)}>Remover</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {assets.length === 0 && folders.length === 0 && !media.pending.length && (
          <div className="empty">
            {q ? 'Nada encontrado.' : <>Arraste vídeos, áudios, imagens, SVGs ou fontes para cá<br />ou clique em <b>Importar</b>.</>}
          </div>
        )}
        {assets.map((a) => (
          <AssetItem
            key={a.id}
            asset={a}
            selected={selected.includes(a.id)}
            renaming={renaming === a.id}
            onSelect={(e) => select(a.id, e)}
            onRename={() => setRenaming(a.id)}
            onRenameDone={(v) => {
              if (v !== null) actions.renameAsset(a.id, v);
              setRenaming(null);
            }}
            dragIds={selected.includes(a.id) ? selected : [a.id]}
          />
        ))}
      </div>
    </section>
  );
}

function RenameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  return (
    <input
      className="text-input rename"
      autoFocus
      defaultValue={value}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') onDone(null);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function AssetItem(props: {
  asset: Asset;
  selected: boolean;
  renaming: boolean;
  dragIds: string[];
  onSelect: (e: React.MouseEvent) => void;
  onRename: () => void;
  onRenameDone: (v: string | null) => void;
}) {
  const { asset } = props;
  const entry = media.get(asset.id);
  const status = entry?.status ?? 'offline';
  const shown = media.statusOf(asset.id);
  const activeJobs = jobs.forAsset(asset.id).filter((j) => (j.status === 'queued' || j.status === 'processing') && j.type !== 'proxy');
  const proxy = entry?.proxy;
  const Icon = KIND_ICON[asset.kind];
  const placeable = asset.kind !== 'font';
  const details = [
    KIND_LABEL[asset.kind],
    hasTimeLimit(asset) ? formatDuration(asset.duration) : null,
    asset.width ? `${asset.width}×${asset.height}` : null,
    asset.fps ? `${Math.round(asset.fps * 100) / 100} fps` : null,
    formatBytes(asset.size),
  ].filter(Boolean);

  return (
    <div
      className={`asset${props.selected ? ' selected' : ''}`}
      draggable={status === 'ready' && !props.renaming}
      data-asset={asset.name}
      title={`${asset.name}\n${placeable ? 'Duplo clique: adicionar ao fim da trilha · arraste para a timeline ou o preview' : `Fonte "${asset.fontFamily}" — disponível em títulos e legendas`}\nF2: renomear · Delete: remover`}
      onClick={props.onSelect}
      onDragStart={(e) => {
        if (placeable) e.dataTransfer.setData(ASSET_MIME, asset.id);
        e.dataTransfer.setData(ASSETS_MIME, JSON.stringify(props.dragIds));
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      onDoubleClick={() => status === 'ready' && placeable && actions.addAssetToTimeline(asset.id)}
    >
      <div className="asset-thumb" style={entry?.thumbnail ? { backgroundImage: `url(${entry.thumbnail})` } : undefined}>
        {!entry?.thumbnail && (asset.kind === 'font' ? <span className="font-sample" style={{ fontFamily: asset.fontFamily }}>Aa</span> : <Icon size={18} />)}
        {hasTimeLimit(asset) && <span className="dur">{formatDuration(asset.duration)}</span>}
      </div>
      <div className="asset-info">
        {props.renaming ? (
          <RenameInput value={asset.name} onDone={props.onRenameDone} />
        ) : (
          <div className="asset-name">{asset.name}</div>
        )}
        <div className="asset-meta" title={describeAsset(asset)}>
          <span className={`st st-${shown}`} data-testid="asset-status">{STATUS_LABEL[shown]}</span>
          {activeJobs.length > 0 && <span className="muted"> · {activeJobs.map((j) => `${JOB_LABEL[j.type] ?? j.type} ${Math.round(j.progress * 100)}%`).join(', ')}</span>}
          {' · '}
          {details.join(' · ')}
        </div>
        {entry?.warning && <div className="asset-meta"><span className={status === 'ready' ? 'warn' : 'bad'} title={entry.warning}>⚠ {entry.warning}</span></div>}
        {(status === 'offline' || status === 'needs-permission' || status === 'changed') && (
          <div className="asset-row-actions">
            {status === 'offline' && <button className="btn sm outline" onClick={(e) => { e.stopPropagation(); void actions.locateMedia(asset.id); }}>Localizar mídia</button>}
            {status === 'needs-permission' && <button className="btn sm outline" onClick={(e) => { e.stopPropagation(); void actions.reconnectMedia(); }}>Reconectar</button>}
            {status === 'changed' && <button className="btn sm outline" onClick={(e) => { e.stopPropagation(); void actions.reloadChangedMedia(asset.id); }}>Recarregar</button>}
          </div>
        )}
        {asset.kind === 'video' && status === 'ready' && proxy && (
          <div className="proxy-line" data-testid="proxy-line" onClick={(e) => e.stopPropagation()}>
            <span className="muted">Original: pronto · Proxy:</span>{' '}
            {proxy.status === 'none' && <ProxyCreate assetId={asset.id} />}
            {proxy.status === 'queued' && (
              <>
                <span className="st st-processing">na fila ({proxy.resolution})</span>
                <button className="btn sm" onClick={() => actions.cancelProxy(asset.id)}>Cancelar</button>
              </>
            )}
            {proxy.status === 'processing' && (
              <>
                <span className="st st-processing">gerando {proxy.resolution} · {Math.round((proxy.progress ?? 0) * 100)}%</span>
                <button className="btn sm" onClick={() => actions.cancelProxy(asset.id)}>Cancelar</button>
              </>
            )}
            {proxy.status === 'ready' && (
              <>
                <span className="st st-ready">{proxy.resolution} · {formatBytes(proxy.size ?? 0)}</span>
                <button className="btn sm" title="Apagar o proxy (o preview volta a usar o original)" onClick={() => void actions.deleteProxy(asset.id)}>Apagar</button>
              </>
            )}
            {(proxy.status === 'failed' || proxy.status === 'cancelled') && (
              <>
                <span className={`st ${proxy.status === 'failed' ? 'st-error' : ''}`} title={proxy.error}>{proxy.status === 'failed' ? `falhou: ${proxy.error}` : 'cancelado'}</span>
                <button className="btn sm" onClick={() => actions.createProxy(asset.id, proxy.resolution ?? 'auto')}>Tentar de novo</button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="asset-actions">
        <button className="btn icon sm" title="Renomear (F2)" onClick={(e) => { e.stopPropagation(); props.onRename(); }}>
          <Pencil size={12} />
        </button>
        <button className="btn icon sm danger" title="Remover do projeto" onClick={(e) => { e.stopPropagation(); actions.removeAssets([asset.id]); }}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Pronto',
  processing: 'Processando',
  error: 'Erro',
  offline: 'Offline',
  'needs-permission': 'Sem permissão',
  changed: 'Alterado',
};

const JOB_LABEL: Record<string, string> = {
  hash: 'identificando',
  thumbnail: 'thumbnails',
  'preview-thumbs': 'scrubbing',
  waveform: 'waveform',
  transcribe: 'transcrição',
};

function ProxyCreate({ assetId }: { assetId: string }) {
  return (
    <select
      className="proxy-select"
      value=""
      onChange={(e) => e.target.value && actions.createProxy(assetId, e.target.value as 'auto' | '720p' | '1080p')}
      data-testid="create-proxy"
    >
      <option value="">Criar proxy…</option>
      <option value="auto">Automático</option>
      <option value="720p">720p</option>
      <option value="1080p">1080p</option>
    </select>
  );
}

/** Aviso de mídias sem acesso (depois de recarregar a página): reconectar com um clique. */
export function MediaReconnectBanner(props: { needsPermission?: number; offline?: number }) {
  const { project } = useEditor();
  useMediaVersion();
  const all = Object.values(project.assets);
  const needsPermission = props.needsPermission ?? all.filter((a) => media.get(a.id)?.status === 'needs-permission').length;
  const offline = props.offline ?? all.filter((a) => (media.get(a.id)?.status ?? 'offline') === 'offline').length;
  if (!needsPermission && !offline) return null;
  return (
    <div className="banner" data-testid="media-reconnect">
      {needsPermission > 0 && <span>{needsPermission} mídia(s) precisam de permissão para serem lidas novamente.</span>}
      {offline > 0 && <span>{offline} mídia(s) offline — localize os arquivos originais.</span>}
      <div className="row">
        {needsPermission > 0 && <button className="btn sm primary" onClick={() => void actions.reconnectMedia()}>Reconectar</button>}
        <button className="btn sm outline" onClick={() => void actions.relinkMedia()}>Localizar arquivos…</button>
      </div>
    </div>
  );
}
