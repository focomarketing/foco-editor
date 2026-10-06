// "Cérebros" do AI Editor. Os dois devolvem JSON no mesmo schema (RESPONSE_SCHEMA);
// a validação dos comandos acontece depois, no validador — nunca confiamos no modelo.

import Anthropic from '@anthropic-ai/sdk';
import { RESPONSE_SCHEMA } from './commands';

export type ProviderId = 'claude' | 'ollama';

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

/** Modelos instalados no Ollama (para o seletor nas configurações). */
export async function listOllamaModels(url: string): Promise<string[]> {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`);
  if (!res.ok) throw new Error(`Ollama respondeu ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}
