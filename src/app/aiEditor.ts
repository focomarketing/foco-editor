// AI Editor: chat -> LLM (interpretador) -> comandos -> validador -> executor -> timeline.
// Tudo que a IA faz vira UM passo de undo, com resumo do que foi feito e comparação
// ORIGINAL vs EDIÇÃO DA IA. Botões manuais usam o mesmo executor (mesmos comandos).

import type { Asset, Clip, ColorSettings, Project, Transcript } from '../core/types';
import { formatTimecode } from '../core/time';
import { sourceEnd } from '../core/clipTime';
import { actions, media, playback, store, transcripts } from './editor';
import { notify } from './notify';
import type { AICommand, AspectRatio } from '../engine/ai/commands';
import { COMMAND_DOCS, describeCommand, validateCommands } from '../engine/ai/commands';
import type { AISettings, ChatTurn } from '../engine/ai/providers';
import { DEFAULT_AI_SETTINGS, planWithClaude, planWithOllama } from '../engine/ai/providers';
import { CUT_KIND_LABEL, suggestCuts, summarize } from '../engine/analysis/cuts';
import type { CutKind } from '../engine/analysis/cuts';
import { smartZoomKeyframes, sentencesOf } from '../engine/analysis/zoom';
import { getPreset, segmentWords, timelineWords } from '../engine/captions/captions';
import { colorPreset } from '../engine/color/color';
import { analyzeAssetColor } from '../engine/color/analyze';
import { audioFxFromPreset, AUDIO_PRESETS } from '../engine/audio/audioFx';
import { WHISPER_MODELS } from '../engine/transcript/TranscriptEngine';
import { projectDuration, sourceRangesToTimeline } from '../engine/timeline/operations';
import { Cmd } from '../engine/commands/commands';
import type { EditCommand } from '../engine/commands/commands';
import type { Range } from '../engine/timeline/operations';
import { CUT_MODES, DEFAULT_OPTIONS, planSmartCuts } from '../engine/cut/smartCut';
import { timelineSpeech } from './smartCut';

// --- configurações (por navegador) --------------------------------------------------

const SETTINGS_KEY = 'foco.ai.settings';

function loadSettings(): AISettings {
  try {
    return { ...DEFAULT_AI_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<AISettings>) };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

// --- estado -------------------------------------------------------------------------

export interface ActionResult {
  label: string;
  detail: string;
  ok: boolean;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'status';
  text: string;
  actions?: ActionResult[];
  rejected?: string[];
  model?: string;
  /** Resposta da IA no formato do schema (vai no histórico, para o modelo manter o padrão). */
  raw?: string;
}

export interface AISession {
  before: Project;
  after: Project;
  label: string;
  at: number;
}

export interface AIEditorState {
  settings: AISettings;
  messages: ChatMessage[];
  busy: string | null;
  session: AISession | null;
  comparing: boolean;
}

let state: AIEditorState = { settings: loadSettings(), messages: [], busy: null, session: null, comparing: false };
const listeners = new Set<() => void>();
let nextMsg = 1;
let abort: AbortController | null = null;

function set(patch: Partial<AIEditorState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function push(m: Omit<ChatMessage, 'id'>) {
  set({ messages: [...state.messages, { ...m, id: nextMsg++ }] });
}

export const aiStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
};

export function saveSettings(patch: Partial<AISettings>) {
  const settings = { ...state.settings, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* modo privado: vale só nesta sessão */
  }
  set({ settings });
}

// --- contexto enviado ao modelo -----------------------------------------------------

/** Mídia com fala que mais aparece na timeline. */
export function primaryAsset(p: Project): Asset | null {
  const use = new Map<string, number>();
  for (const c of Object.values(p.clips)) {
    const a = p.assets[c.assetId];
    if (a?.hasAudio && a.audioDecodable) use.set(a.id, (use.get(a.id) ?? 0) + c.duration);
  }
  const best = [...use.entries()].sort((x, y) => y[1] - x[1])[0];
  return best ? p.assets[best[0]] : null;
}

const SYSTEM = `Você é o AI Editor do FOCO Editor, um editor de vídeo profissional. O usuário escreve pedidos de edição em linguagem natural e você os traduz em comandos do editor.

Responda SEMPRE com JSON no formato {"reply": string, "commands": [...]}.
- "reply": 1–2 frases em português dizendo o que será feito (ou por que não dá).
- "commands": só comandos da lista abaixo, na ordem em que fazem sentido. Lista vazia se o pedido for só uma pergunta ou não puder ser feito com eles.

${COMMAND_DOCS}

Regras:
- Nunca invente conteúdo. Textos de títulos e destaques devem vir do que é dito na transcrição; não acrescente fatos.
- Use os tempos da transcrição (segundos da timeline) para posicionar gráficos.
- Cortar a fala (pausas, respiros, erros, gaguejadas, repetições, "tirar o que sobra"): smart_cut. Escolha o ritmo pelo tipo de vídeo: natural para reflexão, ensaio, aula, teologia ou quando pedirem para manter as pausas; dynamic para YouTube; dry para Reels, Shorts, TikTok e anúncio.
- "Deixe mais dinâmico": smart_cut dynamic (ou dry se for vídeo curto/vertical) + smart_zoom normal.
- Use remove_silences/remove_mistakes só se o usuário pedir algo bem específico (ex.: "só as pausas maiores que 1 s": remove_silences safe).
- "Versão vertical / para Reels / Shorts / TikTok": set_format 9:16. Para Shorts/Reels prefira legendas "shorts".
- Não repita uma edição que já foi aplicada, a menos que o usuário peça.
- Se o "reply" diz que algo será feito, o comando correspondente TEM que estar em "commands". Se não houver comando para o pedido, diga isso no reply e deixe "commands" vazio.

Exemplos:
Pedido: "melhore o áudio e tire as pausas e os erros" (vídeo de reflexão, 16:9)
{"reply":"Vou limpar a voz e cortar pausas e erros mantendo o ritmo natural da reflexão.","commands":[{"type":"enhance_audio","preset":"voice"},{"type":"smart_cut","mode":"natural"}]}
Pedido: "crie legendas para Reels"
{"reply":"Vou criar legendas no estilo Shorts.","commands":[{"type":"generate_captions","preset":"shorts"}]}
Pedido: "coloque um título com o tema no início" (transcrição: "[0.0–3.1] Hoje vamos falar sobre liderança.")
{"reply":"Vou adicionar o título “Liderança” no começo.","commands":[{"type":"add_title","template":"title","text":"Liderança","subtitle":"","at":0,"duration":3}]}
Pedido: "mude o fundo para uma praia"
{"reply":"Ainda não consigo trocar o fundo do vídeo; posso ajustar cor, cortes, legendas, áudio, zoom e gráficos.","commands":[]}`;

function contextBlock(p: Project, maxWords: number): string {
  const dur = projectDuration(p);
  const asset = primaryAsset(p);
  const t = asset ? transcripts.get(asset.id) : undefined;
  const lines = [
    `Projeto: ${dur.toFixed(1)} s, quadro ${p.settings.width}×${p.settings.height}, ${Object.values(p.clips).filter((c) => !c.caption && !c.title).length} clipe(s) de mídia, ${Object.values(p.clips).filter((c) => c.caption).length} legenda(s), ${Object.values(p.clips).filter((c) => c.title).length} gráfico(s).`,
    asset ? `Mídia principal: ${asset.name}. Transcrição: ${t ? 'disponível' : 'ainda não feita (será feita automaticamente se um comando precisar)'}.` : 'Nenhuma mídia com áudio na timeline.',
  ];
  if (asset && t) {
    const words = timelineWords(p, asset.id, t.words);
    const clipped = words.slice(0, maxWords);
    lines.push('Transcrição (início–fim em segundos da timeline):');
    for (const s of sentencesOf(clipped)) lines.push(`[${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.text}`);
    if (words.length > clipped.length) lines.push(`(… mais ${words.length - clipped.length} palavras não mostradas)`);
  }
  return lines.join('\n');
}

// --- chat ---------------------------------------------------------------------------

export async function sendMessage(text: string) {
  const request = text.trim();
  if (!request || state.busy) return;
  const s = state.settings;
  if (s.provider === 'claude' && !s.cloudConsent) {
    const ok = confirm(
      'O pedido e o texto da transcrição serão enviados para a API da Anthropic (Claude) para interpretar a edição.\n\nO vídeo e o áudio NÃO são enviados — eles continuam neste computador.\n\nPermitir?',
    );
    if (!ok) return;
    saveSettings({ cloudConsent: true });
  }
  push({ role: 'user', text: request });
  // A IA precisa entender o conteúdo: sem transcrição, transcreve antes (local).
  const main = primaryAsset(store.getState().project);
  if (main && !transcripts.get(main.id)) {
    try {
      await ensureTranscript(main);
    } catch (e) {
      push({ role: 'status', text: `Não consegui transcrever: ${e instanceof Error ? e.message : String(e)}` });
    }
    set({ busy: null });
  }
  const p = store.getState().project;
  const history: ChatTurn[] = state.messages
    .filter((m) => m.role !== 'status')
    .slice(-9, -1)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.role === 'assistant' && m.raw ? m.raw : m.text }));
  history.push({ role: 'user', content: `${contextBlock(p, s.provider === 'claude' ? 20000 : 2500)}\n\nPedido: ${request}` });

  abort = new AbortController();
  set({ busy: s.provider === 'claude' ? 'Interpretando com Claude…' : `Interpretando com ${s.ollamaModel} (local)…` });
  try {
    const plan = s.provider === 'claude'
      ? await planWithClaude(s, SYSTEM, history, abort.signal)
      : await planWithOllama(s, SYSTEM, history, abort.signal);
    const { commands, errors } = validateCommands(plan.commands, { duration: projectDuration(p) });
    if (!commands.length) {
      const reply = plan.reply || 'Não encontrei uma edição para fazer com esse pedido.';
      push({ role: 'assistant', text: reply, rejected: errors, model: plan.model, raw: JSON.stringify({ reply, commands: [] }) });
      return;
    }
    const results = await runCommands(commands, request);
    push({ role: 'assistant', text: plan.reply, actions: results, rejected: errors, model: plan.model, raw: JSON.stringify({ reply: plan.reply, commands }) });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') push({ role: 'status', text: 'Cancelado.' });
    else push({ role: 'status', text: `Erro: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    abort = null;
    set({ busy: null });
  }
}

export function cancelAI() {
  abort?.abort();
}

export function clearChat() {
  set({ messages: [] });
}

// --- executor -----------------------------------------------------------------------

const NEEDS_TRANSCRIPT = new Set<AICommand['type']>(['remove_mistakes', 'generate_captions', 'smart_zoom', 'smart_cut']);
const ORDER: AICommand['type'][] = ['set_format', 'auto_color', 'color_preset', 'enhance_audio', 'add_title', 'remove_silences', 'remove_mistakes', 'smart_cut', 'smart_zoom', 'generate_captions'];
const ASPECT_SIZE: Record<AspectRatio, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

async function ensureTranscript(asset: Asset): Promise<Transcript | null> {
  const existing = transcripts.get(asset.id);
  if (existing) return existing;
  set({ busy: `Transcrevendo "${asset.name}" (local)…` });
  let model = WHISPER_MODELS[0].id;
  try {
    model = localStorage.getItem('foco.whisperModel') ?? model;
  } catch {
    /* padrão */
  }
  await actions.transcribe(asset.id, model, 'portuguese');
  return transcripts.get(asset.id) ?? null;
}

/**
 * Executa comandos já validados como UMA edição (um passo de undo).
 * Dados que exigem processamento (transcrição, análise de cor) são preparados antes.
 */
export async function runCommands(commands: AICommand[], label: string): Promise<ActionResult[]> {
  const sorted = [...commands].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  const p0 = store.getState().project;
  const asset = primaryAsset(p0);
  const results: ActionResult[] = [];
  const fail = (c: AICommand, detail: string) => results.push({ label: describeCommand(c), detail, ok: false });

  // Preparação assíncrona
  let transcript: Transcript | null = null;
  if (asset && sorted.some((c) => NEEDS_TRANSCRIPT.has(c.type))) transcript = await ensureTranscript(asset);
  const levels = asset ? (media.get(asset.id)?.levels ?? (await media.whenLevels(asset.id))) : null;
  const colorByAsset = new Map<string, ColorSettings>();
  if (sorted.some((c) => c.type === 'auto_color')) {
    set({ busy: 'Analisando a cor dos quadros…' });
    for (const a of visualAssets(p0)) {
      try {
        colorByAsset.set(a.id, (await analyzeAssetColor(media, a)).settings);
      } catch (e) {
        console.warn('auto color', a.name, e);
      }
    }
  }
  set({ busy: 'Aplicando edição…' });

  // Planeja em sequência (cada comando enxerga o resultado do anterior) e executa tudo
  // como UM comando AI_EDIT no histórico.
  const before = store.getState().project;
  const planned: EditCommand[] = [];
  let p = before;
  for (const c of sorted) {
    const r = planOne(p, c, { asset, transcript, levels, colorByAsset });
    if ('error' in r) {
      fail(c, r.error);
      continue;
    }
    for (const cmd of r.commands) p = cmd.execute(p);
    planned.push(...r.commands);
    results.push({ label: describeCommand(c), detail: r.detail, ok: true });
  }
  const changed = planned.length > 0 && store.execute(Cmd.batch(`IA: ${label.slice(0, 40)}`, planned, 'AI_EDIT'), []) !== null;

  if (changed) {
    set({ session: { before, after: store.getState().project, label, at: Date.now() }, comparing: false });
    playback.setPreviewProject(null);
  }
  return results;
}

function visualAssets(p: Project): Asset[] {
  const ids = new Set(Object.values(p.clips).filter((c) => !c.caption && !c.title).map((c) => c.assetId));
  return [...ids].map((id) => p.assets[id]).filter((a): a is Asset => !!a && a.hasVideo);
}

interface Prepared {
  asset: Asset | null;
  transcript: Transcript | null;
  levels: Float32Array | null;
  colorByAsset: Map<string, ColorSettings>;
}

/** Valores por clipe de mídia que satisfaz o filtro (para comandos SET_*). */
function perClip<T>(p: Project, pred: (c: Clip, a: Asset) => boolean, fn: (c: Clip, a: Asset) => T): Record<string, T> {
  const out: Record<string, T> = {};
  for (const c of Object.values(p.clips)) {
    const a = p.assets[c.assetId];
    if (!a || c.caption || c.title || !pred(c, a)) continue;
    out[c.id] = fn(c, a);
  }
  return out;
}

const fmtS = (s: number) => `${s.toFixed(1).replace('.', ',')} s`;

type Plan = { commands: EditCommand[]; detail: string } | { error: string };

/** Traduz um comando da IA (alto nível) em comandos de edição do Edit Command Engine. */
function planOne(p: Project, c: AICommand, d: Prepared): Plan {
  switch (c.type) {
    case 'set_format': {
      const [width, height] = ASPECT_SIZE[c.aspect];
      return { commands: [Cmd.setSequence({ width, height }, `Formato ${c.aspect}`)], detail: `${width}×${height}` };
    }
    case 'color_preset':
    case 'auto_color': {
      const values = perClip(
        p,
        (_c, a) => a.hasVideo && (c.type === 'color_preset' || d.colorByAsset.has(a.id)),
        (_c, a): ColorSettings => (c.type === 'color_preset' ? { ...colorPreset(c.preset) } : { ...d.colorByAsset.get(a.id)! }),
      );
      const n = Object.keys(values).length;
      if (!n) return { error: 'nenhum clipe de vídeo/imagem para corrigir' };
      const cmd = Cmd.setColor(values, c.type === 'auto_color' ? 'Cor automática' : 'Preset de cor');
      if (c.type === 'auto_color') {
        const s = [...d.colorByAsset.values()][0];
        return { commands: [cmd], detail: `${n} clipe(s) · exposição ${signed(s.exposure)}, temperatura ${signed(s.temperature)}, contraste ${signed(s.contrast)}` };
      }
      return { commands: [cmd], detail: `${n} clipe(s)` };
    }
    case 'enhance_audio': {
      let gain = 0;
      let gate = false;
      const values = perClip(p, (_c, a) => a.hasAudio, (_c, a) => {
        const fx = audioFxFromPreset(c.preset, media.get(a.id)?.levels ?? null);
        gain = fx.gainDb;
        gate = fx.gateDb !== null;
        return fx;
      });
      if (!Object.keys(values).length) return { error: 'nenhum clipe com áudio' };
      const pr = AUDIO_PRESETS.find((x) => x.id === c.preset)!;
      return {
        commands: [Cmd.setAudioFx(values, `Áudio ${pr.label}`)],
        detail: `${pr.label}: EQ de voz, ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB de normalização${gate ? ', redução de ruído (gate)' : ''}, compressor e limitador`,
      };
    }
    case 'add_title':
      return { commands: [Cmd.addTitle(c)], detail: `${c.template} em ${formatTimecode(c.at, p.settings.fps).slice(3)}` };
    case 'remove_silences':
    case 'remove_mistakes': {
      if (!d.asset) return { error: 'nenhuma mídia com fala na timeline' };
      if (c.type === 'remove_mistakes' && !d.transcript) return { error: 'transcrição indisponível' };
      const all = suggestCuts({ levels: d.levels, duration: d.asset.duration, words: d.transcript?.words ?? null, level: c.level });
      const chosen = all.filter((s) => (c.type === 'remove_silences' ? s.kind === 'silence' : s.kind !== 'silence'));
      const ranges = sourceRangesToTimeline(p, d.asset.id, chosen.map((s) => [s.start, s.end] as Range));
      if (!ranges.length) return { commands: [], detail: 'nada para cortar neste nível' };
      const removed = ranges.reduce((acc, [a, b]) => acc + (b - a), 0);
      const counts = summarize(chosen).counts;
      const parts = (Object.entries(counts) as [CutKind, number][]).map(([k, n]) => `${n}× ${CUT_KIND_LABEL[k].toLowerCase()}`);
      return { commands: [Cmd.rippleRemove(ranges, describeCommand(c))], detail: `${parts.join(', ')} · −${fmtS(removed)}` };
    }
    case 'smart_cut': {
      const { words, missing } = timelineSpeech(p);
      if (!words.length) return { error: missing.length ? 'transcrição indisponível' : 'nenhuma fala na timeline' };
      const waves = new Map<string, Float32Array>();
      for (const id of new Set(words.map((w) => w.assetId))) {
        const lv = media.get(id)?.levels;
        if (lv) waves.set(id, lv);
      }
      const { cuts, removed } = planSmartCuts(words, waves, { ...DEFAULT_OPTIONS, mode: c.mode });
      if (!cuts.length) return { commands: [], detail: 'a fala já está limpa neste ritmo' };
      const ranges: Range[] = cuts.map((x) => [x.start, x.end]);
      return { commands: [Cmd.rippleRemove(ranges, describeCommand(c))], detail: `${cuts.length} trechos · −${fmtS(removed)} (${CUT_MODES[c.mode].label.toLowerCase()})` };
    }
    case 'smart_zoom': {
      if (!d.asset || !d.transcript) return { error: 'transcrição indisponível' };
      const { keyframes, moments } = smartZoomKeyframes(d.transcript.words, d.levels, c.intensity);
      if (!moments.length) return { commands: [], detail: 'nenhum momento de destaque encontrado' };
      const values = perClip(p, (_cl, a) => a.id === d.asset!.id && a.hasVideo, (cl) => {
        const inRange = keyframes.filter((k) => k.t >= cl.sourceIn - 1 && k.t <= sourceEnd(cl) + 1);
        return { ...cl.keyframes, scale: inRange.length ? inRange : undefined };
      });
      if (!Object.keys(values).length) return { error: 'a mídia principal não tem imagem (só áudio) — zoom não se aplica' };
      const peak = Math.max(...keyframes.map((k) => k.v));
      return { commands: [Cmd.setKeyframes(values, 'Smart zoom')], detail: `${moments.length} zoom(s) até ${Math.round(peak * 100)}%` };
    }
    case 'generate_captions': {
      if (!d.asset || !d.transcript) return { error: 'transcrição indisponível' };
      const words = timelineWords(p, d.asset.id, d.transcript.words);
      if (!words.length) return { error: 'nenhuma fala transcrita na timeline' };
      const blocks = segmentWords(words, getPreset(c.preset).maxChars, getPreset(c.preset).maxWords).length;
      return { commands: [Cmd.generateCaptions(words, c.preset)], detail: `${blocks} blocos, ${words.length} palavras` };
    }
  }
}

const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}`;

// --- sessão ORIGINAL vs EDIÇÃO DA IA -------------------------------------------------

export function setComparing(on: boolean) {
  const s = state.session;
  if (!s) return;
  playback.setPreviewProject(on ? s.before : null);
  set({ comparing: on });
}

export function acceptSession() {
  playback.setPreviewProject(null);
  set({ session: null, comparing: false });
}

export function rejectSession() {
  const s = state.session;
  if (!s) return;
  playback.setPreviewProject(null);
  if (store.getState().project === s.after) {
    store.undo();
    notify('Edição da IA desfeita.', 'success');
  } else {
    notify('Você já editou depois da IA — use Ctrl+Z para voltar passo a passo.', 'error');
  }
  set({ session: null, comparing: false });
}

/** Quando o usuário edita por conta própria (ou abre outro projeto), a sessão termina. */
let lastProjectId = store.getState().project.id;
store.subscribe(() => {
  const p = store.getState().project;
  if (p.id !== lastProjectId) {
    lastProjectId = p.id;
    resetAIForProject();
    return;
  }
  const s = state.session;
  if (s && p !== s.after && !state.comparing) set({ session: null });
});

/** Ação manual (botões) passando pelo mesmo executor. */
export async function runManual(command: AICommand) {
  if (state.busy) return;
  set({ busy: 'Processando…' });
  try {
    const results = await runCommands([command], describeCommand(command));
    for (const r of results) notify(`${r.label}: ${r.detail}`, r.ok ? 'success' : 'error', 6000);
  } catch (e) {
    notify(`Falhou: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    set({ busy: null });
  }
}

function resetAIForProject() {
  playback.setPreviewProject(null);
  set({ session: null, comparing: false, messages: [] });
}

