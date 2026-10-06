import React, { useState } from 'react';
import { useTimeline } from '../store/TimelineContext';
import { AICommandEngine } from '../engine/AICommandEngine';
import { Sparkles, Send, CheckCircle } from 'lucide-react';

export function AIEditorPanel() {
  const { state, dispatch } = useTimeline();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'ai' | 'user', text: string, summary?: string[] }[]>([
    { role: 'ai', text: 'Olá! Sou o seu AI Editor. Como posso otimizar seu vídeo hoje?' }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userCommand = input;
    setMessages(prev => [...prev, { role: 'user', text: userCommand }]);
    setInput('');
    setIsProcessing(true);

    // Simulate AI thinking and processing time
    setTimeout(() => {
      const response = AICommandEngine.processCommand(userCommand, state);
      
      // Dispatch actions to mutate timeline
      response.actions.forEach(action => {
        dispatch(action);
      });

      // Show AI edit summary
      setMessages(prev => [...prev, { 
        role: 'ai', 
        text: response.message, 
        summary: response.summary 
      }]);
      setIsProcessing(false);

    }, 1500); // 1.5s simulation
  };

  return (
    <aside className="ai-panel" style={{ width: '320px', backgroundColor: 'var(--bg-dark)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ borderBottom: '1px solid var(--border)', padding: '16px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)', fontWeight: 'bold' }}>
          <Sparkles size={16} /> AI EDITOR
        </h3>
      </div>

      <div className="chat-history" style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {messages.map((msg, idx) => (
          <div key={idx} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%' }}>
            <div style={{ 
              backgroundColor: msg.role === 'user' ? 'var(--bg-hover)' : 'rgba(94, 67, 243, 0.1)',
              border: msg.role === 'user' ? '1px solid var(--border)' : '1px solid rgba(94, 67, 243, 0.3)',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '13px',
              lineHeight: '1.4'
            }}>
              {msg.text}
            </div>
            
            {msg.summary && msg.summary.length > 0 && (
              <div style={{ marginTop: '8px', padding: '12px', backgroundColor: 'var(--bg-panel)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase' }}>AI Edit Summary</div>
                <ul style={{ paddingLeft: '16px', margin: 0, fontSize: '12px', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {msg.summary.map((sum, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', listStyle: 'none', marginLeft: '-16px' }}>
                      <CheckCircle size={12} color="var(--audio-clip)" style={{ marginTop: '2px', flexShrink: 0 }} />
                      <span>{sum}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
        {isProcessing && (
          <div style={{ alignSelf: 'flex-start', fontSize: '12px', color: 'var(--text-muted)' }}>
            Processando vídeo...
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ padding: '16px', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px' }}>
        <input 
          type="text" 
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ex: Crie legendas estilo podcast..."
          style={{ flex: 1, padding: '10px 12px', borderRadius: '6px', backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', color: '#fff', fontSize: '13px' }}
          disabled={isProcessing}
        />
        <button type="submit" className="btn btn-primary" disabled={isProcessing} style={{ padding: '10px' }}>
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}
