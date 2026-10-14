// O Diretor pela conta Claude da pessoa (Claude Code desta máquina, sem chave de API).
// O Claude Code não recebe as ferramentas do editor diretamente: a cada passo, a conversa vai
// como texto, as ferramentas como catálogo, e a resposta volta em JSON estruturado
// ({ message, tool_calls }), que aqui vira uma mensagem no formato da API (tool_use). Assim o
// ciclo do Diretor (runDirector) roda igual, só trocando quem responde. Os quadros (view_frames)
// vão como imagens que o Claude abre com a ferramenta Read.

import type Anthropic from '@anthropic-ai/sdk';
import { askClaudeCode } from '../../engine/ai/providers';
import type { AISettings } from '../../engine/ai/providers';
import type { CreateMessage } from './agent';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type Tool = Anthropic.Beta.Messages.BetaTool;

/** Resultados antigos de ferramenta encolhem (a conversa é reenviada a cada passo). */
const OLD_RESULT_CHARS = 1800;
const RECENT_MESSAGES = 6;

const PROTOCOL = `
COMO AGIR NESTE AMBIENTE
Você trabalha em passos. A cada passo, responda o JSON:
- "message": o que você está fazendo ou concluiu, em português, curto (a pessoa lê);
- "tool_calls": as ferramentas do editor a chamar AGORA, cada uma com "name" e "input_json" (o objeto de entrada como texto JSON, seguindo o input_schema da ferramenta).
Os resultados voltam no próximo passo, no HISTÓRICO. Chame várias ferramentas no mesmo passo quando forem independentes. Para entregar, chame "finish". Se não chamar nenhuma ferramenta, o trabalho termina.
Quando um resultado trouxer uma IMAGEM (arquivo), abra-a com a ferramenta Read antes de decidir: são os quadros do vídeo.`;

function catalog(tools: Tool[]): string {
  return ['FERRAMENTAS DO EDITOR', ...tools.map((t) => `## ${t.name}\n${t.description ?? ''}\ninput_schema: ${JSON.stringify(t.input_schema)}`)].join('\n\n');
}

const systemText = (s: Params['system']) => (typeof s === 'string' ? s : (s ?? []).map((b) => b.text).join('\n'));

interface ImageOut {
  name: string;
  base64: string;
}

/** Conversa em texto; imagens só dos resultados do último passo (as antigas já foram vistas). */
export function serialize(messages: Params['messages']): { text: string; images: ImageOut[] } {
  const names = new Map<string, string>();
  const images: ImageOut[] = [];
  const lines: string[] = ['=== HISTÓRICO ==='];
  messages.forEach((m, i) => {
    const recent = i >= messages.length - RECENT_MESSAGES;
    const last = i === messages.length - 1;
    if (typeof m.content === 'string') {
      lines.push(`[${m.role === 'user' ? 'PESSOA' : 'VOCÊ'}]\n${m.content}`);
      return;
    }
    for (const b of m.content) {
      if (b.type === 'text' && b.text.trim()) lines.push(`[${m.role === 'user' ? 'PESSOA' : 'VOCÊ'}]\n${b.text}`);
      else if (b.type === 'tool_use') {
        names.set(b.id, b.name);
        lines.push(`[VOCÊ CHAMOU ${b.name}] ${JSON.stringify(b.input)}`);
      } else if (b.type === 'tool_result') {
        const name = names.get(b.tool_use_id) ?? 'ferramenta';
        const parts: string[] = [];
        const content = typeof b.content === 'string' ? [{ type: 'text' as const, text: b.content }] : (b.content ?? []);
        for (const c of content) {
          if (c.type === 'text') parts.push(c.text);
          else if (c.type === 'image' && c.source.type === 'base64') {
            if (last) {
              const file = `quadros-${images.length + 1}.${c.source.media_type === 'image/png' ? 'png' : 'jpg'}`;
              images.push({ name: file, base64: c.source.data });
              parts.push(`(IMAGEM: abra o arquivo ${file} com Read)`);
            } else parts.push('(imagem vista num passo anterior)');
          }
        }
        let text = parts.join('\n');
        if (!recent && text.length > OLD_RESULT_CHARS) text = `${text.slice(0, OLD_RESULT_CHARS)}\n… (resultado antigo encurtado)`;
        lines.push(`[RESULTADO ${name}${b.is_error ? ' · ERRO' : ''}]\n${text}`);
      }
    }
  });
  lines.push('=== FIM DO HISTÓRICO ===', 'Qual o próximo passo? Responda o JSON.');
  return { text: lines.join('\n\n'), images };
}

const stepSchema = (tools: Tool[]) => ({
  type: 'object',
  additionalProperties: false,
  required: ['message', 'tool_calls'],
  properties: {
    message: { type: 'string' },
    tool_calls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'input_json'],
        properties: { name: { type: 'string', enum: tools.map((t) => t.name) }, input_json: { type: 'string' } },
      },
    },
  },
});

let seq = 0;

/** Chamada ao modelo do Diretor pela conta da pessoa (mesmo contrato da API). */
export function claudeCodeCreate(s: AISettings): CreateMessage {
  return async (params, signal) => {
    const tools = (params.tools ?? []) as Tool[];
    const system = `${systemText(params.system)}\n${PROTOCOL}\n\n${catalog(tools)}`;
    const { text, images } = serialize(params.messages);
    const r = await askClaudeCode(s, system, text, stepSchema(tools), signal, 'medium', images);
    const data = (r.data ?? {}) as { message?: string; tool_calls?: { name: string; input_json: string }[] };
    const content: Message['content'] = [];
    if (data.message?.trim()) content.push({ type: 'text', text: data.message, citations: null });
    for (const call of data.tool_calls ?? []) {
      let input: unknown = {};
      try {
        input = JSON.parse(call.input_json || '{}');
      } catch {
        input = { __erro: `input_json inválido: ${String(call.input_json).slice(0, 200)}` };
      }
      content.push({ type: 'tool_use', id: `cc_${Date.now().toString(36)}_${seq++}`, name: call.name, input });
    }
    const uses = content.some((b) => b.type === 'tool_use');
    return {
      id: `msg_cc_${seq++}`,
      type: 'message',
      role: 'assistant',
      model: r.model,
      content,
      stop_reason: uses ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      container: null,
      context_management: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as unknown as Message;
  };
}
