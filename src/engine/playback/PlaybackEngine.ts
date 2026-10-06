// Playback Engine: relógio da timeline + preview real.
// Cada clipe ativo (ou prestes a entrar) ganha um <video>/<audio> próprio já posicionado
// no ponto de entrada, para que os cortes troquem sem engasgo. O relógio segura quando
// alguma mídia ativa está carregando, em vez de deixar áudio e imagem se desencontrarem.

import type { Clip, Project } from '../../core/types';
import { clamp, EPS } from '../../core/time';
import { fadeGain, speedOf, toSource } from '../../core/clipTime';
import type { EditorStore } from '../timeline/EditorStore';
import { clipEnd, isStill, projectDuration } from '../timeline/operations';
import type { MediaEngine } from '../media/MediaEngine';
import { composite, graphicLayer, mediaTransform, visualLayersAt } from '../render/Compositor';
import type { DrawLayer } from '../render/Compositor';
import { buildChain, prepareContext } from '../audio/audioFx';
import type { Chain } from '../audio/audioFx';
import { metrics } from '../diagnostics/metrics';

const PRELOAD_AHEAD = 2; // segundos
const DRIFT_PLAYING = 0.25;
/** Fração da resolução da sequência por qualidade de preview. */
const QUALITY_FACTOR = { full: 1, '1/2': 0.5, '1/4': 0.25, '1/8': 0.125 } as const;
export type PreviewQualityId = 'auto' | keyof typeof QUALITY_FACTOR;

export interface PlaybackSnapshot {
  time: number;
  playing: boolean;
  /** Velocidade/direção do transporte (J/K/L): 1 normal, 2/4/8 rápido, negativo = ré. */
  rate: number;
}


export class PlaybackEngine {
  private snap: PlaybackSnapshot = { time: 0, playing: false, rate: 1 };
  private listeners = new Set<() => void>();
  private pool = new Map<string, HTMLMediaElement>();
  private audioCtx: AudioContext | null = null;
  routes = new Map<HTMLMediaElement, { source: MediaElementAudioSourceNode; chain: Chain; key: string }>();
  private gateReady = false;
  private clockOrigin = 0;
  private clockBase = 0;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dirty = true;
  private raf = 0;
  private lastProject: Project | null = null;
  private lastMediaVersion = -1;
  /** Mostra o original sem correção de cor (comparação). */
  compareOriginal = false;

  private store: EditorStore;
  private media: MediaEngine;

  constructor(store: EditorStore, media: MediaEngine) {
    this.store = store;
    this.media = media;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snap;

  get time() {
    return this.snap.time;
  }

  private setSnap(time: number, playing: boolean, rate = this.snap.rate) {
    if (time === this.snap.time && playing === this.snap.playing && rate === this.snap.rate) return;
    this.snap = { time, playing, rate };
    for (const l of this.listeners) l();
  }

  attachCanvas(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') ?? null;
    this.dirty = true;
    if (canvas && !this.raf) this.raf = requestAnimationFrame(this.tick);
    if (!canvas && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  // --- transporte -----------------------------------------------------------

  /**
   * Volume e processamento de áudio do clipe. Clipes com efeitos passam pela cadeia da
   * Web Audio (a mesma do export); os demais usam o volume do próprio elemento.
   */
  private route(el: HTMLMediaElement, c: Clip, muted: boolean, t: number) {
    const existing = this.routes.get(el);
    const gain = muted ? 0 : c.volume * fadeGain(c, t);
    if (!c.audio && !existing) {
      el.muted = muted;
      el.volume = clamp(gain, 0, 1);
      return;
    }
    const fx = this.compareOriginal ? undefined : c.audio;
    const key = JSON.stringify([fx, this.gateReady]);
    if (existing?.key === key) {
      (existing.chain.input as GainNode).gain.value = gain;
      return;
    }
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ latencyHint: 'playback' });
      void prepareContext(this.audioCtx).then(() => {
        this.gateReady = true;
      });
    }
    const ctx = this.audioCtx;
    const source = existing?.source ?? ctx.createMediaElementSource(el);
    if (existing) {
      source.disconnect();
      existing.chain.output.disconnect();
    }
    el.muted = false;
    el.volume = 1;
    const chain = buildChain(ctx, fx, gain);
    source.connect(chain.input);
    chain.output.connect(ctx.destination);
    this.routes.set(el, { source, chain, key });
  }

  private unroute(el: HTMLMediaElement) {
    const r = this.routes.get(el);
    if (!r) return;
    r.source.disconnect();
    r.chain.output.disconnect();
    this.routes.delete(el);
  }

  play(rate = 1) {
    void this.audioCtx?.resume();
    const p = this.project();
    const duration = projectDuration(p);
    if (duration <= 0) return;
    let t = this.snap.time;
    if (rate > 0 && t >= duration - EPS) t = 0;
    if (rate < 0 && t <= EPS) return;
    this.clockBase = t;
    this.clockOrigin = performance.now();
    this.setSnap(t, true, rate);
    this.sync(p, t, true);
  }

  /** Shuttle estilo J/K/L: cada toque na mesma direção dobra a velocidade (até 8x). */
  shuttle(dir: -1 | 0 | 1) {
    if (dir === 0) {
      this.pause();
      return;
    }
    const cur = this.snap.playing ? this.snap.rate : 0;
    const next = Math.sign(cur) === dir ? Math.max(-8, Math.min(8, cur * 2)) : dir;
    this.play(next);
  }

  pause() {
    for (const el of this.pool.values()) el.pause();
    this.setSnap(this.snap.time, false, 1);
    this.dirty = true;
  }

  toggle() {
    if (this.snap.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const time = Math.max(0, t);
    this.clockBase = time;
    this.clockOrigin = performance.now();
    this.setSnap(time, this.snap.playing);
    this.dirty = true;
  }

  /** Projeto que o player mostra: o da timeline ou, durante a comparação, o original. */
  private previewProject: Project | null = null;

  project(): Project {
    return this.previewProject ?? this.store.getState().project;
  }

  /** Toca outro projeto (ex.: o original antes da edição da IA) sem mexer na timeline. */
  setPreviewProject(p: Project | null) {
    this.previewProject = p;
    this.dirty = true;
    for (const l of this.listeners) l();
  }

  get previewingOther() {
    return this.previewProject !== null;
  }

  /** Ligações com preferências (o engine não depende da camada de app). */
  config: { quality: () => PreviewQualityId } = { quality: () => 'auto' };
  scrubbing = false;

  /** Arraste do playhead: preview rápido; ao soltar, qualidade normal. */
  setScrubbing(on: boolean) {
    this.scrubbing = on;
    this.dirty = true;
  }

  setCompareOriginal(on: boolean) {
    this.compareOriginal = on;
    this.dirty = true;
  }

  /** Força redesenho (ex.: projeto de comparação mudou). */
  invalidate() {
    this.dirty = true;
  }

  stepFrames(n: number) {
    const fps = this.project().settings.fps;
    if (this.snap.playing) this.pause();
    const frame = Math.round(this.snap.time * fps) + n;
    this.seek(Math.max(0, frame / fps));
  }

  // --- laço -----------------------------------------------------------------

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const p = this.project();
    if (p !== this.lastProject) {
      this.lastProject = p;
      this.dirty = true;
    }
    const mv = this.media.getVersion();
    if (mv !== this.lastMediaVersion) {
      this.lastMediaVersion = mv;
      this.dirty = true;
    }

    let t = this.snap.time;
    if (this.snap.playing) {
      const now = performance.now();
      const rate = this.snap.rate;
      if (rate > 0 && this.activeStalled(p, t)) {
        this.clockBase = t;
        this.clockOrigin = now;
      } else {
        t = this.clockBase + ((now - this.clockOrigin) / 1000) * rate;
      }
      const end = projectDuration(p);
      if (t >= end || t <= 0) {
        t = Math.min(end, Math.max(0, t));
        this.setSnap(t, false, 1);
        for (const el of this.pool.values()) el.pause();
      } else {
        this.setSnap(t, true);
      }
      this.dirty = true;
    }

    this.sync(p, t, this.snap.playing);
    if (this.dirty) this.draw(p, t);
  };

  private activeStalled(p: Project, t: number) {
    for (const [clipId, el] of this.pool) {
      const c = p.clips[clipId];
      if (!c || t < c.start - EPS || t >= clipEnd(c)) continue;
      if (el.error) continue;
      if (el.seeking || el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return true;
    }
    return false;
  }

  /** Cria/posiciona/descarta os elementos de mídia conforme o tempo atual. */
  private sync(p: Project, t: number, playing: boolean) {
    const mutedTracks = new Set(p.tracks.filter((tr) => tr.muted).map((tr) => tr.id));
    const wanted = new Set<string>();

    for (const c of Object.values(p.clips)) {
      const asset = p.assets[c.assetId];
      if (!asset || (asset.kind !== 'video' && asset.kind !== 'audio')) continue;
      const end = clipEnd(c);
      if (t >= end - EPS || t < c.start - PRELOAD_AHEAD) continue;
      const url = this.media.previewUrl(c.assetId);
      if (!url) continue;
      wanted.add(c.id);

      const el = this.elementFor(c, url, asset.kind === 'audio');
      const active = t >= c.start - EPS;
      const expected = active ? toSource(c, t) : c.sourceIn;
      // Ré (J) e shuttle acima de 2x: o elemento fica parado e é posicionado quadro a quadro.
      const forward = playing && this.snap.rate > 0 && this.snap.rate <= 2;
      const rate = this.snap.rate * speedOf(c);

      this.route(el, c, mutedTracks.has(c.trackId) || !!c.muted || (playing && !forward), t);
      if (forward && el.playbackRate !== rate) el.playbackRate = rate;

      if (active && forward) {
        if (el.paused) {
          if (Math.abs(el.currentTime - expected) > 0.04) el.currentTime = expected;
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - expected) > DRIFT_PLAYING * Math.max(1, rate)) {
          el.currentTime = expected;
        }
      } else {
        if (!el.paused) el.pause();
        const tolerance = 0.5 / p.settings.fps;
        if (Math.abs(el.currentTime - expected) > tolerance) el.currentTime = expected;
      }
    }

    for (const [clipId, el] of this.pool) {
      if (wanted.has(clipId)) continue;
      el.pause();
      this.unroute(el);
      el.removeAttribute('src');
      el.load();
      this.pool.delete(clipId);
    }
  }

  private elementFor(c: Clip, url: string, audioOnly: boolean): HTMLMediaElement {
    let el = this.pool.get(c.id);
    if (el && el.dataset.src === url) return el;
    el?.pause();
    el = audioOnly ? new Audio() : document.createElement('video');
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    el.preload = 'auto';
    el.dataset.src = url;
    el.src = url;
    const markDirty = () => (this.dirty = true);
    el.addEventListener('seeked', markDirty);
    el.addEventListener('loadeddata', markDirty);
    el.addEventListener('error', () => {
      this.media.reportWarning(c.assetId, 'o navegador não consegue reproduzir este arquivo no preview');
      this.dirty = true;
    });
    this.pool.set(c.id, el);
    return el;
  }

  private draw(p: Project, t: number) {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;

    const { width, height } = p.settings;
    const q = this.config.quality();
    let scale: number;
    if (q === 'auto') {
      // Só o necessário para a área visível na tela (em pixels reais).
      const dpr = window.devicePixelRatio || 1;
      const fit = Math.min(canvas.clientWidth / width, canvas.clientHeight / height) * dpr;
      scale = Math.min(1, fit > 0 ? fit : 0.5);
    } else {
      scale = QUALITY_FACTOR[q];
    }
    // Scrub: prioriza velocidade (metade da resolução); ao soltar, redesenha na qualidade normal.
    if (this.scrubbing) scale = Math.max(0.125, scale * 0.5);
    const W = Math.max(2, Math.round(width * scale));
    const H = Math.max(2, Math.round(height * scale));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }

    const layers: DrawLayer[] = [];
    let waiting = false;
    let provisional = false;
    for (const active of visualLayersAt(p, t)) {
      const { clip, asset } = active;
      if (!asset) {
        const g = graphicLayer(active);
        if (g) layers.push(g);
        continue;
      }
      const transform = mediaTransform(active);
      if (isStill(asset)) {
        const img = this.media.get(asset.id)?.image;
        if (img) layers.push({ kind: 'media', source: img, width: img.width, height: img.height, transform, color: clip.color, crop: clip.crop, blendMode: clip.blendMode });
        continue;
      }
      const el = this.pool.get(clip.id);
      if (!(el instanceof HTMLVideoElement) || el.error) continue;
      if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || el.seeking) {
        // Durante scrub/seek: mostra na hora a thumbnail real daquele instante (baixa
        // resolução); o quadro definitivo substitui assim que a decodificação termina.
        const thumb = this.scrubbing || !this.snap.playing ? this.media.previewThumb(asset.id, active.sourceTime) : null;
        if (thumb) {
          layers.push({ kind: 'media', source: thumb, width: thumb.width, height: thumb.height, transform, color: clip.color, crop: clip.crop, blendMode: clip.blendMode });
          provisional = true;
        } else {
          waiting = true;
        }
        continue;
      }
      layers.push({ kind: 'media', source: el, width: el.videoWidth || asset.width, height: el.videoHeight || asset.height, transform, color: clip.color, crop: clip.crop, blendMode: clip.blendMode });
    }
    // Enquanto um quadro carrega, mantém o anterior em vez de piscar preto.
    if (waiting) {
      this.dirty = true;
      return;
    }
    composite(ctx, W, H, layers, { bypassColor: this.compareOriginal });
    metrics.frameDrawn();
    this.dirty = this.snap.playing || provisional;
  }

  dispose() {
    this.attachCanvas(null);
    for (const el of this.pool.values()) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.pool.clear();
  }
}
