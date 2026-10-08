// O Diretor de edição: Claude com as ferramentas do FOCO, em ciclo (entender → planejar →
// montar → ver quadros/medir → corrigir → verificar) até entregar para aprovação. Loop manual
// de tool use: cada resposta volta inteira para o histórico (thinking incluído), as ferramentas
// rodam no rascunho e o custo é somado pelo `usage`. Limites de gasto e de turnos.

import Anthropic from '@anthropic-ai/sdk';
import type { AISettings } from '../../engine/ai/providers';
import { readWorkflow } from '../../core/workflow';
import { formatFor, FORMAT_RULES } from '../transitions/director';
import { methodFor, methodText } from './methods';
import { DIRECTOR_TOOLS } from './tools';
import type { DirectorTools } from './tools';
import type { Draft } from './draft';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type Message = Anthropic.Beta.Messages.BetaMessage;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** Chamada ao modelo (injetável: os testes usam um roteiro). */
export type CreateMessage = (params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, signal: AbortSignal) => Promise<Message>;

export type DirectorEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; text: string; isError: boolean; image?: string }
  | { type: 'cost'; usd: number; turns: number };

export type StopReason = 'finished' | 'end_turn' | 'budget' | 'turns' | 'refusal' | 'cancelled' | 'error';

export interface DirectorRun {
  conversation: MessageParam[];
  costUsd: number;
  turns: number;
  stopped: StopReason;
  message?: string;
}

/** US$ por milhão de tokens (entrada, saída). Cache: escrita 1,25×, leitura 0,1× da entrada. */
const PRICE: [string, number, number][] = [
  ['claude-fable-5', 10, 50],
  ['claude-mythos', 10, 50],
  ['claude-opus-5-5', 4, 20],
  ['claude-opus', 5, 25],
  ['claude-sonnet', 2, 10],
  ['claude-haiku-5', 0.1, 0.5],
  ['claude-haiku', 1, 5],
];

export function costOf(model: string, u: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): number {
  const [, inP, outP] = PRICE.find(([k]) => model.startsWith(k)) ?? ['', 5, 25];
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  return (input * inP + (u.output_tokens ?? 0) * outP) / 1e6;
}

export function directorSystem(draft: Draft): string {
  const p = draft.project;
  const wf = readWorkflow(p.metadata);
  const vertical = p.settings.height > p.settings.width;
  const format = formatFor(wf?.template, wf?.subtype, vertical);
  const rules = FORMAT_RULES[format];
  return [
    'Você é o Diretor de edição do FOCO Editor: um editor de vídeo profissional sênior. Você edita um RASCUNHO do projeto usando as ferramentas; a pessoa só vê o resultado quando você entregar (finish), e então aprova ou pede ajustes.',
    '',
    'COMO TRABALHAR',
    '1. Entenda: project_overview, read_transcript (e audio_report). Se não houver fala transcrita, rode run_skill cut (que transcreve).',
    '2. Planeje: set_plan com a estrutura (gancho, blocos, fechamento) e a duração alvo, seguindo o método editorial abaixo e o briefing.',
    '3. Monte: use as skills especializadas (run_skill) como ponto de partida e escolha com critério o que aceitar (accept_suggestions); complete com edit_timeline. Não aceite tudo às cegas.',
    '4. Confira: view_frames nos momentos importantes (gancho, cada B-roll, títulos, fechamento) e verify. Corrija o que estiver errado (edit_timeline / undo_last) e confira de novo.',
    '5. Entregue com finish só quando verify não tiver erros (ou explique o que ficou e por quê).',
    '',
    'REGRAS',
    '- Nunca invente fatos, números ou falas: títulos e destaques usam palavras ditas no vídeo.',
    '- Preserve o sentido: não corte frases pela metade, não junte ideias que mudam o significado.',
    '- Menos é mais: corte seco por padrão; cada efeito, título ou transição precisa de motivo editorial (escreva no reason).',
    '- Escolhas manuais da pessoa (clipes "usuário", transições escolhidas por ela) ficam como estão.',
    '- Seja eficiente: poucas chamadas bem pensadas; agrupe edições numa mesma chamada de edit_timeline.',
    '- Escreva para a pessoa em português do Brasil, direto e sem jargão.',
    '',
    `FORMATO: ${format} · ${p.settings.width}×${p.settings.height} · transição no máximo em ~${Math.round(rules.maxShare * 100)}% dos cortes, espaço mínimo ${rules.minSpacing} s entre elas.`,
    '',
    methodText(methodFor(wf?.template, wf?.subtype, vertical)),
  ].join('\n');
}

/** Breakpoint de cache móvel: só a última mensagem marca o fim do prefixo cacheado. */
function withRollingCache(messages: MessageParam[]): MessageParam[] {
  return messages.map((m, i) => {
    if (typeof m.content === 'string') return i === messages.length - 1 ? { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] } : m;
    const blocks = m.content.map((b) => {
      if (!('cache_control' in b) || !b.cache_control) return b;
      const { cache_control: _cc, ...rest } = b as typeof b & { cache_control?: unknown };
      void _cc;
      return rest as typeof b;
    });
    if (i === messages.length - 1 && blocks.length) {
      const last = blocks[blocks.length - 1];
      if (last.type === 'text' || last.type === 'tool_result' || last.type === 'image') blocks[blocks.length - 1] = { ...last, cache_control: { type: 'ephemeral' } } as typeof last;
    }
    return { ...m, content: blocks };
  });
}

export function defaultCreate(s: AISettings): CreateMessage {
  const client = new Anthropic({ apiKey: s.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  return (params, signal) => client.beta.messages.create(params, { signal });
}

export interface RunOptions {
  settings: AISettings;
  draft: Draft;
  tools: DirectorTools;
  /** Mensagem nova da pessoa (briefing ou pedido de ajuste). */
  userText: string;
  /** Conversa anterior (pedir ajuste continua a mesma). */
  conversation?: MessageParam[];
  budgetUsd: number;
  maxTurns: number;
  signal: AbortSignal;
  onEvent(e: DirectorEvent): void;
  create?: CreateMessage;
  /** Custo já gasto nesta sessão (ajustes somam ao total). */
  spentUsd?: number;
}

export async function runDirector(o: RunOptions): Promise<DirectorRun> {
  const create = o.create ?? defaultCreate(o.settings);
  const conversation: MessageParam[] = [...(o.conversation ?? [])];
  // a conversa sempre termina numa mensagem da pessoa: o pedido entra junto do último resultado de ferramenta
  const last = conversation[conversation.length - 1];
  if (last && last.role === 'user' && Array.isArray(last.content)) conversation[conversation.length - 1] = { ...last, content: [...last.content, { type: 'text', text: o.userText }] };
  else conversation.push({ role: 'user', content: o.userText });

  const system = directorSystem(o.draft);
  let cost = o.spentUsd ?? 0;
  let turns = 0;
  const done = (stopped: StopReason, message?: string): DirectorRun => ({ conversation, costUsd: cost, turns, stopped, message });

  try {
    while (true) {
      if (o.signal.aborted) return done('cancelled');
      if (turns >= o.maxTurns) return done('turns', `Parei no limite de ${o.maxTurns} passos.`);
      if (cost >= o.budgetUsd) return done('budget', `Parei no limite de gasto (US$ ${o.budgetUsd.toFixed(2)}).`);
      turns++;
      const response = await create(
        {
          model: o.settings.claudeModel,
          max_tokens: 16000,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          tools: DIRECTOR_TOOLS,
          messages: withRollingCache(conversation),
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: 'medium' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
        o.signal,
      );
      cost += costOf(response.model, response.usage);
      o.onEvent({ type: 'cost', usd: cost, turns });
      // a resposta volta inteira (thinking incluído) para o próximo turno
      conversation.push({ role: 'assistant', content: response.content as MessageParam['content'] });
      for (const b of response.content) {
        if (b.type === 'thinking' && b.thinking) o.onEvent({ type: 'thinking', text: b.thinking });
        if (b.type === 'text' && b.text.trim()) o.onEvent({ type: 'text', text: b.text });
      }
      if (response.stop_reason === 'refusal') return done('refusal', 'O modelo recusou continuar este pedido.');
      const uses = response.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason === 'max_tokens' && uses.length) return done('error', 'Resposta cortada no meio de uma ação (limite de tokens).');
      if (!uses.length) {
        if (response.stop_reason === 'pause_turn') continue;
        return done('end_turn');
      }
      const results: ToolResult[] = [];
      let finished = false;
      for (const u of uses) {
        o.onEvent({ type: 'tool', name: u.name, input: u.input });
        const input = u.input && typeof u.input === 'object' ? (u.input as Record<string, unknown>) : {};
        const r = await o.tools.run(u.name, input);
        const text = typeof r.content === 'string' ? r.content : r.content?.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n') ?? '';
        o.onEvent({ type: 'tool_result', name: u.name, text, isError: !!r.isError, image: r.image });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
        if (u.name === 'finish' && !r.isError) finished = true;
      }
      // todos os resultados numa mensagem só
      conversation.push({ role: 'user', content: results });
      if (finished) return done('finished');
    }
  } catch (e) {
    if ((e instanceof DOMException && e.name === 'AbortError') || o.signal.aborted) return done('cancelled');
    if (e instanceof Anthropic.AuthenticationError) return done('error', 'Chave da API Anthropic inválida.');
    if (e instanceof Anthropic.RateLimitError) return done('error', 'Limite de uso da API atingido; tente em instantes.');
    if (e instanceof Anthropic.APIConnectionError) return done('error', 'Sem conexão com a API da Anthropic.');
    return done('error', e instanceof Error ? e.message : String(e));
  }
}
