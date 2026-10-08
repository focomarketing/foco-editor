// MEDIA ENGINE: ingestão (validação → hash → metadados → thumbnails → waveform → cache),
// status de cada mídia, proxies, referências aos arquivos e preparação para preview.
// Todo trabalho pesado vira um job na fila (prioridade, progresso, cancelamento, retry).
// Os arquivos são lidos sob demanda — um vídeo de horas nunca entra inteiro na memória.

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { Asset } from '../../core/types';
import { idb, safe } from '../platform/idb';
import { hasReadPermission, requestReadPermission } from '../platform/fs';
import { metrics } from '../diagnostics/metrics';
import { jobs } from '../jobs/JobQueue';
import type { JobPriority } from '../jobs/JobQueue';
import { cache } from '../cache/CacheEngine';
import { mediaHash } from './hash';
import { probe, rasterizeSvg, registerFont, fontFamilyFor } from './probe';
import { makeAssetThumbnail, makeSprites, makeWaveform, waveformFromBlob, waveformMipmaps, waveformToBlob, WAVEFORM_RATE } from './generators';
import type { SpriteResult } from './generators';
import { autoResolution, buildProxy, proxyKey } from './proxy';
import type { ProxyResolution, ProxyState } from './proxy';

export { WAVEFORM_RATE, probe };
export type { ProxyState, ProxyResolution };

export type MediaStatus = 'ready' | 'error' | 'offline' | 'needs-permission' | 'changed';

export interface Filmstrip {
  url: string;
  frames: number;
  frameW: number;
  frameH: number;
}

export interface PreviewThumbs {
  info: SpriteResult['info'];
  sheets: (Blob | null)[];
}

export interface MediaEntry {
  status: MediaStatus;
  file?: File;
  handle?: FileSystemFileHandle;
  /** Hash do conteúdo (para mídias antigas sem hash no projeto, calculado ao abrir). */
  hash?: string;
  url?: string;
  thumbnail?: string;
  filmstrip?: Filmstrip;
  previewThumbs?: PreviewThumbs;
  image?: ImageBitmap;
  /** Picos 0..1 (WAVEFORM_RATE por segundo) e pirâmide de resoluções para a timeline. */
  waveform?: Float32Array;
  waveMips?: Float32Array[];
  /** Nível RMS (dBFS), WAVEFORM_RATE por segundo. */
  levels?: Float32Array;
  waveformProgress?: number;
  /** Problema que impede preview/export ou exige atenção. */
  warning?: string;
  proxy: ProxyState;
}

export interface PendingImport {
  id: string;
  name: string;
  size: number;
  status: 'analyzing' | 'error';
  error?: string;
  jobId?: string;
  item: ImportItem;
}

export interface ImportItem {
  file: File;
  handle?: FileSystemFileHandle;
  /** Caminho do arquivo no PC (quando conhecido): reaberto pelo servidor local. */
  path?: string;
}

export type DuplicateChoice = 'existing' | 'import' | 'cancel';
type Mode = 'quality' | 'balanced' | 'performance';

/** Ligações com a camada de aplicação (o engine não conhece a UI nem o projeto). */
export interface MediaConfig {
  useProxies: () => boolean;
  mode: () => Mode;
  /** Asset está na timeline? (sobe a prioridade dos jobs dele) */
  inUse: (assetId: string) => boolean;
  /** Asset do projeto com este hash (detecção de duplicatas). */
  findByHash: (hash: string) => Asset | null;
  onDuplicate: (file: File, existing: Asset) => Promise<DuplicateChoice>;
}

export class MediaEngine {
  private entries = new Map<string, MediaEntry>();
  private assets = new Map<string, Asset>();
  private inputs = new Map<string, Input>();
  private listeners = new Set<() => void>();
  private version = 0;
  private waveDone = new Map<string, Promise<void>>();
  private thumbCache = new Map<string, ImageBitmap | Promise<ImageBitmap | null>>();
  pending: PendingImport[] = [];
  config: MediaConfig = {
    useProxies: () => true,
    mode: () => 'balanced',
    inUse: () => false,
    findByHash: () => null,
    onDuplicate: async () => 'import',
  };

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  get(assetId: string): MediaEntry | undefined {
    return this.entries.get(assetId);
  }

  /** Status para a UI: inclui "processing" quando há jobs ativos da mídia. */
  statusOf(assetId: string): MediaStatus | 'processing' | 'offline' {
    const e = this.entries.get(assetId);
    if (!e) return 'offline';
    if (e.status === 'ready' && jobs.forAsset(assetId).some((j) => j.status === 'queued' || j.status === 'processing')) return 'processing';
    return e.status;
  }

  private patch(assetId: string, patch: Partial<MediaEntry>) {
    const cur = this.entries.get(assetId) ?? { status: 'offline' as MediaStatus, proxy: { status: 'none' as const } };
    this.entries.set(assetId, { ...cur, ...patch });
    this.emit();
  }

  private hashOf(assetId: string) {
    return this.assets.get(assetId)?.hash ?? this.entries.get(assetId)?.hash;
  }

  private priority(assetId: string, base: JobPriority = 'low'): JobPriority {
    return this.config.inUse(assetId) ? 'medium' : base;
  }

  /** O asset entrou na timeline: sobe a prioridade dos jobs dele que ainda esperam. */
  prioritize(assetId: string) {
    for (const j of jobs.forAsset(assetId)) if (j.status === 'queued' && j.priority === 'low') jobs.setPriority(j.id, 'medium');
  }

  /** Input do Mediabunny para o ORIGINAL (decodificação via WebCodecs), criado sob demanda. */
  getInput(assetId: string): Input | null {
    const entry = this.entries.get(assetId);
    if (!entry?.file) return null;
    let input = this.inputs.get(assetId);
    if (!input) {
      input = new Input({ source: new BlobSource(entry.file), formats: ALL_FORMATS });
      this.inputs.set(assetId, input);
    }
    return input;
  }

  /** URL usada pelo preview: o proxy quando existe e está ligado; senão o original. */
  previewUrl(assetId: string): string | undefined {
    const e = this.entries.get(assetId);
    if (!e) return undefined;
    if (this.config.useProxies() && e.proxy.status === 'ready' && e.proxy.url) return e.proxy.url;
    return e.url;
  }

  // --- ingestão ---------------------------------------------------------------

  /**
   * Importa arquivos: cada um vira um job de análise (validação → hash → duplicata →
   * metadados). Resolve com os assets prontos para entrar no projeto.
   */
  async importFiles(items: ImportItem[]): Promise<{ assets: Asset[]; errors: { name: string; message: string }[]; skipped: Asset[] }> {
    const assets: Asset[] = [];
    const skipped: Asset[] = [];
    const errors: { name: string; message: string }[] = [];
    const seenHashes = new Map<string, Asset>();
    await Promise.all(
      items.map(async (item) => {
        const r = await this.analyze(item, seenHashes).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
        if ('error' in r) errors.push({ name: item.file.name, message: r.error });
        else if (r.skipped) skipped.push(r.skipped);
        else if (r.asset) assets.push(r.asset);
      }),
    );
    return { assets, errors, skipped };
  }

  private async analyze(item: ImportItem, seen: Map<string, Asset>): Promise<{ asset?: Asset; skipped?: Asset }> {
    const pend: PendingImport = { id: `imp${Math.random().toString(36).slice(2, 8)}`, name: item.file.name, size: item.file.size, status: 'analyzing', item };
    this.pending = [...this.pending, pend];
    this.emit();
    const job = jobs.add({ type: 'analyze', label: `Analisar ${item.file.name}`, priority: 'high' }, async (ctx) => {
      ctx.progress(0.1, 'identificando o arquivo');
      const hash = await mediaHash(item.file);
      const existing = this.config.findByHash(hash) ?? seen.get(hash) ?? null;
      if (existing) {
        const choice = await this.config.onDuplicate(item.file, existing);
        if (choice === 'cancel') throw new DOMException('cancelado', 'AbortError');
        if (choice === 'existing') return { skipped: existing };
      }
      ctx.progress(0.4, 'lendo metadados');
      const asset = await metrics.time('import', item.file.name, () => probe(item.file, hash));
      seen.set(hash, asset);
      return { asset };
    });
    pend.jobId = job.id;
    try {
      const r = await job.done;
      this.pending = this.pending.filter((p) => p.id !== pend.id);
      this.emit();
      if (r.asset) {
        this.attach(r.asset, item.file, item.handle);
        if (item.handle) await safe(idb.set('mediaHandles', r.asset.id, item.handle));
        // caminho no PC conhecido: ao reabrir, relê direto do disco
        else if (item.path) await safe(idb.set('kv', `mediaPath:${r.asset.id}`, item.path));
        // sem vínculo (imagem baixada pela IA, arquivo escolhido sem acesso ao disco): grava
        // na pasta de mídia do FOCO no PC; sem o servidor local, uma cópia no navegador
        else {
          const saved = await safe(saveToDisk(r.asset.id, item.file));
          if (saved) await safe(idb.set('kv', `mediaPath:${r.asset.id}`, saved));
          else await safe(keepCopy(r.asset.id, item.file));
        }
      }
      return r;
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === 'AbortError';
      this.pending = cancelled
        ? this.pending.filter((p) => p.id !== pend.id)
        : this.pending.map((p) => (p.id === pend.id ? { ...p, status: 'error' as const, error: e instanceof Error ? e.message : String(e) } : p));
      this.emit();
      if (cancelled) return {};
      throw e;
    }
  }

  /** Remove um import que falhou da lista. */
  dismissPending(id: string) {
    this.pending = this.pending.filter((p) => p.id !== id);
    this.emit();
  }

  /** Liga o arquivo ao asset e agenda thumbnails, waveform e proxy (se já existir no cache). */
  attach(asset: Asset, file: File, handle?: FileSystemFileHandle) {
    // Religando: cancela os jobs que ainda usam o arquivo anterior antes de fechá-lo
    // (eles são reagendados logo abaixo com o arquivo novo).
    this.releaseRuntime(asset.id, true);
    this.assets.set(asset.id, asset);
    const warnings: string[] = [];
    if (asset.hasVideo && !asset.videoDecodable) warnings.push(`O codec de vídeo ${asset.videoCodec ?? 'desconhecido'} não pode ser decodificado neste navegador`);
    if (asset.hasAudio && !asset.audioDecodable) warnings.push(`O codec de áudio ${asset.audioCodec ?? 'desconhecido'} não pode ser decodificado`);
    const prev = this.entries.get(asset.id);
    this.entries.set(asset.id, {
      status: 'ready',
      file,
      handle: handle ?? prev?.handle,
      hash: asset.hash ?? prev?.hash,
      url: URL.createObjectURL(file),
      warning: warnings.length ? `${warnings.join('; ')}.` : undefined,
      proxy: { status: 'none' },
    });
    this.emit();

    if (asset.kind === 'image') {
      createImageBitmap(file)
        .then((image) => this.patch(asset.id, { image, thumbnail: this.entries.get(asset.id)?.url }))
        .catch((e) => this.patch(asset.id, { status: 'error', warning: `Imagem ilegível: ${e}` }));
      return;
    }
    if (asset.kind === 'svg') {
      rasterizeSvg(file)
        .then(({ bitmap }) => this.patch(asset.id, { image: bitmap, thumbnail: this.entries.get(asset.id)?.url }))
        .catch((e) => this.patch(asset.id, { status: 'error', warning: `SVG ilegível: ${e}` }));
      return;
    }
    if (asset.kind === 'font') {
      registerFont(file, asset.fontFamily ?? fontFamilyFor(asset.name)).catch((e) => this.patch(asset.id, { status: 'error', warning: `Fonte ilegível: ${e}` }));
      return;
    }
    void this.scheduleDerived(asset, file);
  }

  private async scheduleDerived(asset: Asset, file: File) {
    // whenLevels() precisa esperar desde já (o hash ainda pode estar sendo calculado).
    let waveSettled: () => void = () => {};
    if (asset.hasAudio && asset.audioDecodable) this.waveDone.set(asset.id, new Promise<void>((r) => (waveSettled = r)));
    let hash = this.hashOf(asset.id);
    if (!hash) {
      hash = await jobs.add({ type: 'hash', label: `Identificar ${asset.name}`, assetId: asset.id, priority: 'high' }, () => mediaHash(file)).done.catch(() => undefined);
      if (!hash || !this.entries.has(asset.id)) return waveSettled();
      this.patch(asset.id, { hash });
    }
    const h = hash;
    if (asset.hasVideo && asset.videoDecodable) {
      jobs.add({ type: 'thumbnail', label: `Thumbnails · ${asset.name}`, assetId: asset.id, priority: this.priority(asset.id, 'medium') }, (ctx) =>
        metrics.time('thumbnail', asset.name, () => this.thumbnails(asset, h, ctx.signal), asset.duration),
      ).done.catch(() => {});
      jobs.add({ type: 'preview-thumbs', label: `Thumbnails de scrubbing · ${asset.name}`, assetId: asset.id, priority: this.priority(asset.id) }, (ctx) =>
        metrics.time('preview-thumbs', asset.name, () => this.previewThumbs(asset, h, ctx.signal, ctx.progress), asset.duration),
      ).done.catch(() => {});
      void this.loadExistingProxy(asset, h);
    }
    if (asset.hasAudio && asset.audioDecodable) {
      const job = jobs.add({ type: 'waveform', label: `Waveform · ${asset.name}`, assetId: asset.id, priority: this.priority(asset.id, 'medium') }, (ctx) =>
        metrics.time('waveform', asset.name, () => this.waveform(asset, h, ctx.signal, ctx.progress), asset.duration),
      );
      void job.done.catch(() => {}).finally(waveSettled);
    }
  }

  private async thumbnails(asset: Asset, hash: string, signal: AbortSignal) {
    const hit = await cache.get('thumbnail', hash);
    let thumb: Blob | null = hit?.file ?? null;
    const track = await this.getInput(asset.id)?.getPrimaryVideoTrack();
    if (!track) return;
    if (!thumb) {
      thumb = await makeAssetThumbnail(track, asset.duration);
      if (thumb) await cache.put('thumbnail', hash, thumb, { assetHash: hash });
    }
    if (thumb && this.entries.has(asset.id)) this.patch(asset.id, { thumbnail: URL.createObjectURL(thumb) });
    // Filmstrip da timeline: 12 quadros espalhados.
    const key = `${hash}|12`;
    let strip = await cache.get('filmstrip', key);
    if (!strip) {
      const s = await makeSprites(track, asset.duration, { frames: 12, frameH: 54, cols: 12, rows: 1, keyAligned: false }, signal, () => {});
      await cache.put('filmstrip', key, s.blobs[0], { assetHash: hash }, s.info);
      strip = await cache.get('filmstrip', key);
    }
    if (strip && this.entries.has(asset.id)) {
      const info = strip.entry.info as SpriteResult['info'];
      this.patch(asset.id, { filmstrip: { url: URL.createObjectURL(strip.file), frames: info.frames, frameW: info.frameW, frameH: info.frameH } });
    }
  }

  /** Thumbnails de scrubbing/navegação: 1 a cada ~N s (máx. 600), em folhas de 100. */
  private async previewThumbs(asset: Asset, hash: string, signal: AbortSignal, progress: (p: number) => void) {
    const frames = Math.min(600, Math.max(10, Math.round(asset.duration / 2)));
    const first = await cache.get('preview-thumbs', `${hash}|0`);
    if (first) {
      const info = first.entry.info as SpriteResult['info'];
      const sheets: (Blob | null)[] = [first.file];
      for (let i = 1; i < Math.ceil(info.frames / info.perSheet); i++) sheets.push((await cache.get('preview-thumbs', `${hash}|${i}`))?.file ?? null);
      if (sheets.every(Boolean)) {
        this.patch(asset.id, { previewThumbs: { info, sheets } });
        return;
      }
    }
    const track = await this.getInput(asset.id)?.getPrimaryVideoTrack();
    if (!track) return;
    const s = await makeSprites(track, asset.duration, { frames, frameH: 90, cols: 10, rows: 10, keyAligned: true }, signal, progress);
    for (const [i, b] of s.blobs.entries()) await cache.put('preview-thumbs', `${hash}|${i}`, b, { assetHash: hash }, i === 0 ? s.info : undefined);
    if (this.entries.has(asset.id)) this.patch(asset.id, { previewThumbs: { info: s.info, sheets: s.blobs } });
  }

  /**
   * Thumbnail de scrubbing para um tempo da mídia, já recortada da folha. Síncrono: devolve
   * o que já estiver pronto e prepara o resto em segundo plano (avisa com emit).
   */
  previewThumb(assetId: string, sourceTime: number): ImageBitmap | null {
    const pt = this.entries.get(assetId)?.previewThumbs;
    if (!pt) return null;
    const { info } = pt;
    const idx = Math.min(info.frames - 1, Math.max(0, Math.floor(sourceTime / info.interval)));
    const key = `${assetId}|${idx}`;
    const hit = this.thumbCache.get(key);
    if (hit instanceof ImageBitmap) return hit;
    if (!hit) {
      const sheet = pt.sheets[Math.floor(idx / info.perSheet)];
      if (!sheet) return null;
      const k = idx % info.perSheet;
      const job = createImageBitmap(sheet, (k % info.cols) * info.frameW, Math.floor(k / info.cols) * info.frameH, info.frameW, info.frameH)
        .then((bmp) => {
          this.thumbCache.set(key, bmp);
          if (this.thumbCache.size > 120) {
            const [oldKey, old] = this.thumbCache.entries().next().value as [string, ImageBitmap | Promise<ImageBitmap | null>];
            if (old instanceof ImageBitmap) old.close();
            this.thumbCache.delete(oldKey);
          }
          this.emit();
          return bmp;
        })
        .catch(() => null);
      this.thumbCache.set(key, job);
    }
    return null;
  }

  private async waveform(asset: Asset, hash: string, signal: AbortSignal, progress: (p: number) => void) {
    const hit = await cache.get('waveform', hash);
    if (hit) {
      const d = await waveformFromBlob(hit.file);
      this.patch(asset.id, { waveform: d.peaks, waveMips: waveformMipmaps(d.peaks), levels: d.levels, waveformProgress: undefined });
      return;
    }
    const track = await this.getInput(asset.id)?.getPrimaryAudioTrack();
    if (!track) return;
    this.patch(asset.id, { waveformProgress: 0 });
    const d = await makeWaveform(
      track,
      asset.duration,
      signal,
      (p) => {
        progress(p);
        this.patch(asset.id, { waveformProgress: p });
      },
      (part) => this.patch(asset.id, { waveform: part.peaks, waveMips: undefined }),
    );
    await cache.put('waveform', hash, waveformToBlob(d), { assetHash: hash });
    if (this.entries.has(asset.id)) this.patch(asset.id, { waveform: d.peaks, waveMips: waveformMipmaps(d.peaks), levels: d.levels, waveformProgress: undefined });
  }

  /** Espera o waveform/níveis ficarem prontos (ou falharem). */
  async whenLevels(assetId: string): Promise<Float32Array | null> {
    await this.waveDone.get(assetId);
    return this.entries.get(assetId)?.levels ?? null;
  }

  // --- proxies ------------------------------------------------------------------

  private async loadExistingProxy(asset: Asset, hash: string) {
    for (const res of ['720p', '1080p'] as const) {
      const hit = await cache.get('proxy', proxyKey(hash, res));
      if (hit && this.entries.has(asset.id)) {
        this.patch(asset.id, { proxy: { status: 'ready', resolution: res, url: URL.createObjectURL(hit.file), size: hit.entry.size } });
        return;
      }
    }
  }

  /** Cria (ou recria) o proxy de um vídeo como job cancelável. */
  createProxy(assetId: string, res: ProxyResolution | 'auto'): Promise<void> {
    const asset = this.assets.get(assetId);
    const hash = this.hashOf(assetId);
    if (!asset || !hash || asset.kind !== 'video') return Promise.reject(new Error('Proxy só existe para vídeos prontos.'));
    const cur = this.entries.get(assetId)?.proxy;
    if (cur && (cur.status === 'queued' || cur.status === 'processing')) return Promise.resolve();
    const resolution = res === 'auto' ? autoResolution(asset, this.config.mode()) : res;
    const job = jobs.add({ type: 'proxy', label: `Proxy ${resolution} · ${asset.name}`, assetId, priority: this.priority(assetId, 'low') === 'medium' ? 'medium' : 'low' }, async (ctx) => {
      this.patch(assetId, { proxy: { status: 'processing', resolution, progress: 0, jobId: job.id } });
      const input = this.getInput(assetId);
      if (!input) throw new Error('O arquivo original não está disponível (mídia offline).');
      const est = await navigator.storage.estimate();
      const needed = (asset.duration * (resolution === '720p' ? 3.6e6 : 8.2e6)) / 8;
      if (est.quota !== undefined && est.usage !== undefined && est.quota - est.usage < needed * 1.1) {
        throw new Error(`O armazenamento disponível é insuficiente para criar o proxy (precisa de ~${(needed / 1e9).toFixed(1)} GB, há ${((est.quota - est.usage) / 1e9).toFixed(1)} GB livres para o editor).`);
      }
      if (ctx.signal.aborted) throw new DOMException('cancelado', 'AbortError');
      const w = await cache.openWritable('proxy', proxyKey(hash, resolution), { assetHash: hash }, { resolution });
      try {
        const t0 = performance.now();
        await buildProxy(input, asset, resolution, w.writable, ctx.signal, (p) => {
          ctx.progress(p);
          this.patch(assetId, { proxy: { status: 'processing', resolution, progress: p, jobId: job.id } });
        });
        w.markClosed();
        const entry = await w.commit();
        metrics.record('proxy', asset.name, performance.now() - t0, asset.duration);
        const hit = await cache.get('proxy', proxyKey(hash, resolution));
        if (!hit) throw new Error('O proxy foi gerado mas não pôde ser lido do cache.');
        this.patch(assetId, { proxy: { status: 'ready', resolution, url: URL.createObjectURL(hit.file), size: entry.size } });
      } catch (e) {
        await w.abort();
        if (e instanceof DOMException && e.name !== 'AbortError') {
          // Falhas de escrita no meio do caminho quase sempre são falta de espaço.
          const now = await navigator.storage.estimate();
          const free = (now.quota ?? 0) - (now.usage ?? 0);
          if (e.name === 'QuotaExceededError' || free < needed) {
            throw new Error(`Espaço em disco insuficiente para terminar o proxy (precisa de ~${(needed / 1e9).toFixed(1)} GB). Libere espaço ou limpe o cache em Configurações.`);
          }
          throw new Error(`Falha ao gravar o proxy no disco (${e.name}: ${e.message}).`);
        }
        throw e;
      }
    });
    this.patch(assetId, { proxy: { status: 'queued', resolution, jobId: job.id } });
    return job.done.then(
      () => undefined,
      (e: unknown) => {
        const cancelled = e instanceof Error && e.name === 'AbortError';
        this.patch(assetId, { proxy: { status: cancelled ? 'cancelled' : 'failed', resolution, error: cancelled ? undefined : e instanceof Error ? e.message : String(e), jobId: job.id } });
        if (!cancelled) throw e;
      },
    );
  }

  cancelProxy(assetId: string) {
    const id = this.entries.get(assetId)?.proxy.jobId;
    if (id) jobs.cancel(id);
  }

  async deleteProxy(assetId: string) {
    const e = this.entries.get(assetId);
    const hash = this.hashOf(assetId);
    if (!e || !hash || !e.proxy.resolution) return;
    if (e.proxy.url) URL.revokeObjectURL(e.proxy.url);
    await cache.remove(await cache.idFor('proxy', proxyKey(hash, e.proxy.resolution)));
    this.patch(assetId, { proxy: { status: 'none' } });
  }

  /** Ids de cache usados pelas mídias abertas (protegidos da limpeza automática). */
  async protectedCacheIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const [id, e] of this.entries) {
      const hash = this.hashOf(id);
      if (hash && e.proxy.status === 'ready' && e.proxy.resolution) ids.add(await cache.idFor('proxy', proxyKey(hash, e.proxy.resolution)));
    }
    return ids;
  }

  activeHashes(): Set<string> {
    const s = new Set<string>();
    for (const id of this.entries.keys()) {
      const h = this.hashOf(id);
      if (h) s.add(h);
    }
    return s;
  }

  // --- avisos, liberação ----------------------------------------------------------

  reportWarning(assetId: string, warning: string) {
    const entry = this.entries.get(assetId);
    if (entry && entry.warning !== warning) this.patch(assetId, { warning });
  }

  private releaseRuntime(assetId: string, cancelJobs: boolean) {
    const e = this.entries.get(assetId);
    if (cancelJobs) for (const j of jobs.forAsset(assetId)) jobs.cancel(j.id);
    if (e?.url) URL.revokeObjectURL(e.url);
    if (e?.thumbnail && e.thumbnail !== e.url) URL.revokeObjectURL(e.thumbnail);
    if (e?.filmstrip) URL.revokeObjectURL(e.filmstrip.url);
    if (e?.proxy.url) URL.revokeObjectURL(e.proxy.url);
    e?.image?.close();
    for (const [k, v] of this.thumbCache) {
      if (!k.startsWith(`${assetId}|`)) continue;
      if (v instanceof ImageBitmap) v.close();
      this.thumbCache.delete(k);
    }
    this.inputs.get(assetId)?.dispose();
    this.inputs.delete(assetId);
  }

  release(assetId: string) {
    this.releaseRuntime(assetId, true);
    this.entries.delete(assetId);
    this.assets.delete(assetId);
    void safe(idb.del('mediaHandles', assetId));
    void safe(dropCopy(assetId));
    this.emit();
  }

  releaseAll() {
    for (const id of [...this.entries.keys()]) this.releaseRuntime(id, true);
    this.entries.clear();
    this.assets.clear();
    this.pending = [];
    this.emit();
  }

  // --- abrir projeto, offline, relink, alterações ---------------------------------

  /** Religa as mídias de um projeto aberto. Sem clique do usuário só funciona se a permissão já existir. */
  async restore(assets: Asset[]) {
    for (const asset of assets) {
      this.assets.set(asset.id, asset);
      const handle = await safe(idb.get<FileSystemFileHandle>('mediaHandles', asset.id));
      if (!handle) {
        const copy = (await safe(loadFromDisk(asset.id))) ?? (await safe(loadCopy(asset.id)));
        if (copy) this.attach(asset, copy);
        else this.patch(asset.id, { status: 'offline', warning: 'Mídia original não vinculada neste navegador. Use "Localizar mídia".' });
        continue;
      }
      try {
        if (await hasReadPermission(handle)) await this.attachFromHandle(asset, handle);
        else this.patch(asset.id, { status: 'needs-permission', handle });
      } catch {
        this.patch(asset.id, { status: 'offline', warning: 'O arquivo original não foi encontrado.' });
      }
    }
  }

  /** Pede permissão para todas as mídias pendentes (chamar num clique). */
  async reconnect(assets: Asset[]) {
    for (const asset of assets) {
      if (this.entries.get(asset.id)?.status !== 'needs-permission') continue;
      const handle = await safe(idb.get<FileSystemFileHandle>('mediaHandles', asset.id));
      if (!handle) continue;
      try {
        if (await requestReadPermission(handle)) await this.attachFromHandle(asset, handle);
      } catch {
        this.patch(asset.id, { status: 'offline', warning: 'O arquivo original não foi encontrado.' });
      }
    }
  }

  private async attachFromHandle(asset: Asset, handle: FileSystemFileHandle) {
    const file = await handle.getFile();
    if (file.size !== asset.size || (asset.lastModified && file.lastModified !== asset.lastModified)) {
      this.patch(asset.id, { status: 'changed', handle, file, warning: 'O arquivo foi alterado fora do editor (tamanho ou data diferentes). Recarregue para usar a versão nova.' });
      return;
    }
    this.attach(asset, file, handle);
  }

  /**
   * Verifica se arquivos ligados por handle sumiram ou mudaram (ao voltar o foco para a
   * janela). Não atualiza nada sozinho: só marca e avisa.
   */
  async checkForChanges(): Promise<{ missing: Asset[]; changed: Asset[] }> {
    const missing: Asset[] = [];
    const changed: Asset[] = [];
    for (const [id, e] of this.entries) {
      const asset = this.assets.get(id);
      if (!asset || !e.handle || e.status !== 'ready') continue;
      try {
        const f = await e.handle.getFile();
        if (f.size !== asset.size || f.lastModified !== asset.lastModified) {
          this.patch(id, { status: 'changed', warning: 'O arquivo foi alterado fora do editor (tamanho ou data diferentes). Recarregue para usar a versão nova.' });
          changed.push(asset);
        }
      } catch {
        this.patch(id, { status: 'offline', warning: 'O arquivo original não foi encontrado (movido, renomeado ou apagado).' });
        missing.push(asset);
      }
    }
    return { missing, changed };
  }

  /** Reanalisa um arquivo alterado; devolve os metadados novos (o projeto decide aplicar). */
  async reanalyze(assetId: string): Promise<Asset | null> {
    const e = this.entries.get(assetId);
    const old = this.assets.get(assetId);
    if (!e?.handle || !old) return null;
    const file = await e.handle.getFile();
    const hash = await mediaHash(file);
    const fresh = await probe(file, hash);
    if (old.hash && old.hash !== hash) await cache.invalidateAsset(old.hash);
    const updated: Asset = { ...fresh, id: old.id, name: old.name, folderId: old.folderId };
    this.attach(updated, file, e.handle);
    return updated;
  }

  /**
   * Relink: casa arquivos escolhidos com mídias offline. Prioridade: hash do conteúdo;
   * sem hash, nome + tamanho + duração.
   */
  async relink(assets: Asset[], items: ImportItem[]): Promise<number> {
    let linked = 0;
    const hashes = await Promise.all(items.map((it) => mediaHash(it.file)));
    for (const asset of assets) {
      const st = this.entries.get(asset.id)?.status;
      if (st === 'ready') continue;
      let idx = asset.hash ? hashes.findIndex((h) => h === asset.hash) : -1;
      if (idx < 0) idx = items.findIndex((it) => it.file.name === asset.name && it.file.size === asset.size);
      if (idx < 0) continue;
      const match = items[idx];
      this.attach(asset, match.file, match.handle);
      if (match.handle) await safe(idb.set('mediaHandles', asset.id, match.handle));
      linked++;
    }
    return linked;
  }

  /**
   * Relink manual de UMA mídia com um arquivo escolhido. Confere hash; se não bater,
   * confere duração/resolução e devolve a diferença para o usuário decidir.
   */
  async verifyReplacement(asset: Asset, file: File): Promise<{ match: 'same' | 'compatible' | 'different'; detail: string; fresh?: Asset }> {
    const hash = await mediaHash(file);
    if (asset.hash && hash === asset.hash) return { match: 'same', detail: 'Mesmo conteúdo do original.' };
    const fresh = await probe(file, hash);
    const sameShape = Math.abs(fresh.duration - asset.duration) < 0.1 && fresh.width === asset.width && fresh.height === asset.height;
    return {
      match: sameShape ? 'compatible' : 'different',
      detail: sameShape
        ? 'O conteúdo não é idêntico, mas duração e resolução batem.'
        : `Arquivo diferente do original: ${fresh.duration.toFixed(1)} s ${fresh.width}×${fresh.height} (original: ${asset.duration.toFixed(1)} s ${asset.width}×${asset.height}).`,
      fresh,
    };
  }

  async linkFile(asset: Asset, file: File, handle?: FileSystemFileHandle) {
    this.attach(asset, file, handle);
    if (handle) await safe(idb.set('mediaHandles', asset.id, handle));
  }
}

export const media = new MediaEngine();

// --- arquivos no PC pelo servidor local (o editor roda na máquina da pessoa) -------------------

const LOCAL = '/__foco/local';
let localOk: Promise<boolean> | null = null;
const hasLocalFiles = () => (localOk ??= fetch(`${LOCAL}/ping`).then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('json')).catch(() => false));

/** Grava na pasta de mídia do FOCO no PC e devolve o caminho (null sem o servidor local). */
async function saveToDisk(assetId: string, file: File): Promise<string | null> {
  if (!(await hasLocalFiles())) return null;
  const res = await fetch(`${LOCAL}/save?name=${encodeURIComponent(`${assetId}-${file.name}`)}`, { method: 'POST', body: file });
  if (!res.ok) return null;
  return ((await res.json()) as { path?: string }).path ?? null;
}

/** Relê do disco a mídia com caminho conhecido (com o nome e a data originais). */
async function loadFromDisk(assetId: string): Promise<File | null> {
  const p = await idb.get<string>('kv', `mediaPath:${assetId}`);
  if (!p || !(await hasLocalFiles())) return null;
  const res = await fetch(`${LOCAL}/file?p=${encodeURIComponent(p)}`);
  if (!res.ok) return null;
  const blob = await res.blob();
  const name = (p.split(/[\\/]/).pop() ?? 'midia').replace(new RegExp(`^${assetId}-`), '');
  return new File([blob], name, { type: blob.type, lastModified: Number(res.headers.get('X-Last-Modified-Ms')) || Date.now() });
}

// --- cópias no navegador (OPFS) das mídias sem arquivo no disco -------------------------------

const COPY_MAX = 300 * 1024 * 1024;

async function copiesDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('media', { create: true });
}

async function keepCopy(assetId: string, file: File) {
  if (file.size > COPY_MAX) return;
  const fh = await (await copiesDir()).getFileHandle(assetId, { create: true });
  const w = await fh.createWritable();
  await w.write(file);
  await w.close();
  await idb.set('kv', `mediaCopy:${assetId}`, { name: file.name, type: file.type, lastModified: file.lastModified });
}

async function loadCopy(assetId: string): Promise<File | null> {
  const meta = await idb.get<{ name: string; type: string; lastModified: number }>('kv', `mediaCopy:${assetId}`);
  if (!meta) return null;
  const blob = await (await (await copiesDir()).getFileHandle(assetId)).getFile();
  return new File([blob], meta.name, { type: meta.type, lastModified: meta.lastModified });
}

async function dropCopy(assetId: string) {
  await idb.del('kv', `mediaCopy:${assetId}`);
  await (await copiesDir()).removeEntry(assetId).catch(() => {});
}
