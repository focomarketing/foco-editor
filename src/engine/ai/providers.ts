// "Cérebros" do AI Editor: Claude pela API (chave), Claude pela conta da pessoa (Claude Code
// desta máquina, via API local do editor) ou Ollama local. Todos devolvem JSON no schema pedido;
// a validação dos comandos acontece depois, no validador — nunca confiamos no modelo.

import Anthropic from '@anthropic-ai/sdk';
import { RESPONSE_SCHEMA } from './commands';

export type ProviderId = 'claude' | 'claude-code' | 'ollama';

export interface AISettings {
  provider: ProviderId;
  claudeKey: string;
  claudeModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  /** O usuário aceitou enviar texto (pedido + transcrição) para a API da Anthropic. */
  cloudConsent: boolean;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'ollama',
  claudeKey: '',
  claudeModel: 'claude-opus-5-5',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen3:4b',
  cloudConsent: false,
};

/** Há um modelo de linguagem configurado para as etapas automáticas? */
export const llmAvailable = (s: AISettings) => s.provider === 'ollama' || s.provider === 'claude-code' || (s.provider === 'claude' && !!s.claudeKey && s.cloudConsent);

// --- Minha conta Claude (Claude Code desta máquina) --------------------------------------------

const CLAUDE_LOCAL = '/__foco/local/claude';
const LOCAL_HEADERS = { 'Content-Type': 'application/json', 'X-Foco-Local': '1' };

export interface ClaudeCodeStatus {
  available: boolean;
  path: string | null;
  loggedIn: boolean;
}

/** O Claude Code está instalado e logado neste computador? */
export async function claudeCodeStatus(): Promise<ClaudeCodeStatus> {
  try {
    const res = await fetch(`${CLAUDE_LOCAL}/status`, { headers: LOCAL_HEADERS });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as ClaudeCodeStatus;
  } catch {
    return { available: false, path: null, loggedIn: false };
  }
}

/** Pergunta estruturada pela conta da pessoa (o editor roda o Claude Code isolado, sem ferramentas). */
export async function askClaudeCode(
  s: AISettings,
  system: string,
  user: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
  effort: 'low' | 'medium' | 'high' = 'medium',
  /** Imagens (JPEG/PNG em base64) que o Claude abre com Read: os quadros do vídeo. */
  images: { name: string; base64: string }[] = [],
): Promise<{ data: unknown; model: string }> {
  let res: Response;
  try {
    res = await fetch(`${CLAUDE_LOCAL}/ask`, { method: 'POST', headers: LOCAL_HEADERS, signal, body: JSON.stringify({ system, user, schema, model: s.claudeModel, effort, images }) });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new Error('Não consegui falar com o Claude Code deste computador (o editor está rodando pelo app ou pelo npm run dev?).');
  }
  const body = (await res.json().catch(() => ({}))) as { data?: unknown; model?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Claude Code respondeu ${res.status}`);
  return { data: body.data, model: body.model ?? s.claudeModel };
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface PlanResult {
  reply: string;
  commands: unknown;
  model: string;
}

function parseJson(text: string): { reply: string; commands: unknown } {
  // Modelos locais às vezes cercam o JSON com texto/markdown.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('o modelo não devolveu JSON');
  const data = JSON.parse(text.slice(start, end + 1)) as { reply?: unknown; commands?: unknown };
  return { reply: typeof data.reply === 'string' ? data.reply : '', commands: data.commands ?? [] };
}

export async function planWithClaude(s: AISettings, system: string, history: ChatTurn[], signal?: AbortSignal): Promise<PlanResult> {
  if (!s.claudeKey) throw new Error('Informe a chave da API Anthropic nas configurações da IA.');
  const client = new Anthropic({ apiKey: s.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    const response = await client.beta.messages.create(
      {
        model: s.claudeModel,
        max_tokens: 8000,
        system,
        messages: history.map((t) => ({ role: t.role, content: t.content })),
        output_config: { effort: 'low', format: { type: 'json_schema', schema: RESPONSE_SCHEMA as unknown as Record<string, unknown> } },
        // Se um classificador de segurança recusar por engano, a API tenta outro modelo na mesma chamada.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') throw new Error('O modelo recusou o pedido.');
    if (response.stop_reason === 'max_tokens') throw new Error('Resposta cortada (limite de tokens).');
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return { ...parseJson(text), model: response.model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Chave da API Anthropic inválida.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Limite de uso da API atingido; tente em instantes.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Sem conexão com a API da Anthropic.');
    throw e;
  }
}

/** Chat do AI Editor pela conta da pessoa: o histórico vai como texto numa pergunta só. */
export async function planWithClaudeCode(s: AISettings, system: string, history: ChatTurn[], signal?: AbortSignal): Promise<PlanResult> {
  const user = history.map((t) => `${t.role === 'user' ? 'PESSOA' : 'VOCÊ (resposta anterior)'}:\n${t.content}`).join('\n\n');
  const r = await askClaudeCode(s, system, user, RESPONSE_SCHEMA as unknown as Record<string, unknown>, signal, 'low');
  const data = (r.data ?? {}) as { reply?: unknown; commands?: unknown };
  return { reply: typeof data.reply === 'string' ? data.reply : '', commands: data.commands ?? [], model: r.model };
}

export async function planWithOllama(s: AISettings, system: string, history: ChatTurn[], signal?: AbortSignal): Promise<PlanResult> {
  let res: Response;
  try {
    res = await fetch(`${s.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: s.ollamaModel,
        stream: false,
        think: false,
        format: RESPONSE_SCHEMA,
        options: { temperature: 0.2, num_ctx: 16384 },
        messages: [{ role: 'system', content: system }, ...history],
      }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new Error(`Ollama não está respondendo em ${s.ollamaUrl}. Abra o Ollama e tente de novo.`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404) throw new Error(`Modelo "${s.ollamaModel}" não instalado no Ollama (rode: ollama pull ${s.ollamaModel}).`);
    throw new Error(`Ollama respondeu ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content?: string }; model?: string };
  return { ...parseJson(data.message?.content ?? ''), model: data.model ?? s.ollamaModel };
}

/**
 * Pergunta estruturada genérica (usada pelas fases automáticas): devolve o JSON do schema.
 * O chamador valida o resultado; o modelo nunca é confiável sozinho.
 */
export async function askJson(s: AISettings, system: string, user: string, schema: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (s.provider === 'claude-code') return (await askClaudeCode(s, system, user, schema, signal)).data;
  if (s.provider === 'claude') {
    if (!s.claudeKey) throw new Error('Informe a chave da API Anthropic nas configurações da IA.');
    if (!s.cloudConsent) throw new Error('Autorize o envio do texto para a API da Anthropic nas configurações da IA.');
    const client = new Anthropic({ apiKey: s.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    try {
      const response = await client.beta.messages.create(
        {
          model: s.claudeModel,
          max_tokens: 16000,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal },
      );
      if (response.stop_reason === 'refusal') throw new Error('O modelo recusou o pedido.');
      if (response.stop_reason === 'max_tokens') throw new Error('Resposta cortada (limite de tokens).');
      const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Chave da API Anthropic inválida.');
      if (e instanceof Anthropic.RateLimitError) throw new Error('Limite de uso da API atingido; tente em instantes.');
      if (e instanceof Anthropic.APIConnectionError) throw new Error('Sem conexão com a API da Anthropic.');
      throw e;
    }
  }
  let res: Response;
  try {
    res = await fetch(`${s.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // modelo local lento ou parado não pode travar a fase: 5 min e cai para o plano local
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(300_000)]),
      body: JSON.stringify({ model: s.ollamaModel, stream: false, think: false, format: schema, options: { temperature: 0.2, num_ctx: 32768 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new Error('O modelo local demorou demais (5 min).');
    throw new Error(`Ollama não está respondendo em ${s.ollamaUrl}.`);
  }
  if (!res.ok) throw new Error(`Ollama respondeu ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const text = data.message?.content ?? '';
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

/**
 * Pergunta estruturada com imagens (quadros de vídeo). Só o Claude enxerga imagens aqui;
 * com o Ollama local a chamada falha e quem chama usa outra estratégia (ex.: nome do arquivo).
 */
export async function askJsonVision(s: AISettings, system: string, user: string, images: { base64: string; mediaType: 'image/jpeg' | 'image/png' }[], schema: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (s.provider !== 'claude' || !s.claudeKey || !s.cloudConsent) throw new Error('Análise de imagem precisa do Claude configurado (chave e autorização).');
  const client = new Anthropic({ apiKey: s.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const response = await client.beta.messages.create(
    {
      model: s.claudeModel,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: [...images.map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.mediaType, data: im.base64 } })), { type: 'text' as const, text: user }] }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    },
    { signal },
  );
  if (response.stop_reason === 'refusal') throw new Error('O modelo recusou o pedido.');
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

/** Modelos instalados no Ollama (para o seletor nas configurações). */
export async function listOllamaModels(url: string): Promise<string[]> {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`);
  if (!res.ok) throw new Error(`Ollama respondeu ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}
