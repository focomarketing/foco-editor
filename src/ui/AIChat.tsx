import { useEffect, useRef, useState } from 'react';
import { Check, CloudCog, Cpu, Send, Settings2, Square, Trash2, X } from 'lucide-react';
import { cancelAI, clearChat, saveSettings, sendMessage } from '../app/aiEditor';
import { useAI } from './hooks';
import type { ChatMessage } from '../app/aiEditor';
import { listOllamaModels } from '../engine/ai/providers';
import type { AISettings } from '../engine/ai/providers';


const EXAMPLES = [
  'Deixe o vídeo mais dinâmico',
  'Remova as pausas maiores que 1 segundo',
  'Melhore o áudio',
  'Crie legendas estilo podcast',
  'Faça uma versão vertical para Reels',
  'Adicione zoom nos momentos importantes',
  'Crie um título com a frase principal',
];

export function AIChat() {
  const ai = useAI();
  const [text, setText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const s = ai.settings;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [ai.messages.length, ai.busy]);

  const submit = () => {
    if (!text.trim()) return;
    void sendMessage(text);
    setText('');
  };

  return (
    <section className="chat">
      <div className="row-between">
        <h4 style={{ margin: 0 }}>AI Editor</h4>
        <span className="chat-provider" title="Quem interpreta os pedidos">
          {s.provider === 'claude' ? <><CloudCog size={12} /> Claude</> : <><Cpu size={12} /> {s.ollamaModel} · local</>}
          <button className="btn icon sm" title="Configurações da IA" onClick={() => setShowSettings(true)}><Settings2 size={13} /></button>
          {ai.messages.length > 0 && (
            <button className="btn icon sm" title="Limpar conversa" onClick={clearChat}><Trash2 size={12} /></button>
          )}
        </span>
      </div>

      <div className="chat-list" ref={listRef} data-testid="chat-list">
        {ai.messages.length === 0 && (
          <div className="chat-empty">
            Peça uma edição em português. Exemplos:
            {EXAMPLES.map((e) => (
              <button key={e} className="chip-btn" onClick={() => setText(e)}>{e}</button>
            ))}
          </div>
        )}
        {ai.messages.map((m) => <Message key={m.id} m={m} />)}
        {ai.busy && (
          <div className="msg status">
            <span className="spinner" /> {ai.busy}
            <button className="btn icon sm" title="Cancelar" onClick={cancelAI}><Square size={10} /></button>
          </div>
        )}
      </div>

      <div className="chat-input">
        <textarea
          value={text}
          placeholder="Ex.: remova meus erros de fala e crie legendas"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          data-testid="chat-input"
        />
        <button className="btn icon primary" disabled={!!ai.busy || !text.trim()} onClick={submit} title="Enviar (Enter)">
          <Send size={15} />
        </button>
      </div>
      {showSettings && <AISettingsDialog settings={s} onClose={() => setShowSettings(false)} />}
    </section>
  );
}

function Message({ m }: { m: ChatMessage }) {
  return (
    <div className={`msg ${m.role}`}>
      <div>{m.text}</div>
      {m.actions && m.actions.length > 0 && (
        <ul className="msg-actions">
          {m.actions.map((a, i) => (
            <li key={i} className={a.ok ? 'ok' : 'bad'}>
              {a.ok ? <Check size={12} /> : <X size={12} />} <b>{a.label}</b>
              <span>{a.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {m.rejected && m.rejected.length > 0 && (
        <div className="msg-rejected" title={m.rejected.join('\n')}>
          {m.rejected.length} comando(s) inválido(s) descartado(s) pelo validador
        </div>
      )}
      {m.model && <div className="msg-model">{m.model}</div>}
    </div>
  );
}

function AISettingsDialog({ settings, onClose }: { settings: AISettings; onClose: () => void }) {
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<string[] | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  useEffect(() => {
    listOllamaModels(draft.ollamaUrl)
      .then((m) => {
        setModels(m);
        setOllamaError(null);
      })
      .catch(() => setOllamaError('Ollama não encontrado neste endereço.'));
  }, [draft.ollamaUrl]);

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Configurações da IA">
        <div className="dialog-head">Configurações da IA</div>
        <div className="dialog-body">
          <div className="seg">
            <button className={`btn sm${draft.provider === 'ollama' ? ' active' : ''}`} onClick={() => setDraft({ ...draft, provider: 'ollama' })}>
              <Cpu size={13} /> Local (Ollama)
            </button>
            <button className={`btn sm${draft.provider === 'claude' ? ' active' : ''}`} onClick={() => setDraft({ ...draft, provider: 'claude' })}>
              <CloudCog size={13} /> Claude (API)
            </button>
          </div>

          {draft.provider === 'ollama' ? (
            <>
              <div className="field">
                <label>Endereço</label>
                <input className="text-input" value={draft.ollamaUrl} onChange={(e) => setDraft({ ...draft, ollamaUrl: e.target.value })} />
              </div>
              <div className="field">
                <label>Modelo</label>
                {models && models.length ? (
                  <select value={draft.ollamaModel} onChange={(e) => setDraft({ ...draft, ollamaModel: e.target.value })}>
                    {!models.includes(draft.ollamaModel) && <option value={draft.ollamaModel}>{draft.ollamaModel} (não instalado)</option>}
                    {models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input className="text-input" value={draft.ollamaModel} onChange={(e) => setDraft({ ...draft, ollamaModel: e.target.value })} />
                )}
              </div>
              <p className="note">
                {ollamaError ?? (models && !models.length ? 'Nenhum modelo instalado. No terminal: ollama pull qwen3:4b' : 'Roda na sua GPU. Nada sai deste computador.')}
              </p>
            </>
          ) : (
            <>
              <div className="field">
                <label>Chave da API</label>
                <input
                  className="text-input"
                  type="password"
                  placeholder="sk-ant-…"
                  value={draft.claudeKey}
                  onChange={(e) => setDraft({ ...draft, claudeKey: e.target.value.trim() })}
                />
              </div>
              <div className="field">
                <label>Modelo</label>
                <select value={draft.claudeModel} onChange={(e) => setDraft({ ...draft, claudeModel: e.target.value })}>
                  <option value="claude-opus-5-5">Claude Opus 5.5 (padrão)</option>
                  <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (mais barato)</option>
                  <option value="claude-haiku-4-5">Claude Haiku 4.5 (mais rápido)</option>
                </select>
              </div>
              <p className="note">
                Envia só o texto do pedido e da transcrição — nunca o vídeo ou o áudio. A chave fica guardada apenas neste
                navegador. Cobrança por uso na sua conta Anthropic.
              </p>
            </>
          )}
        </div>
        <div className="dialog-foot">
          <button className="btn outline" onClick={onClose}>Cancelar</button>
          <button
            className="btn primary"
            onClick={() => {
              saveSettings(draft);
              onClose();
            }}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
