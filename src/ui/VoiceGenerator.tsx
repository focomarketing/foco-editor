import { useEffect, useState } from 'react';
import { Play, Square, Sparkles, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { actions, media, playback, store } from '../app/editor';
import { Cmd } from '../engine/commands/commands';
import { notify } from '../app/notify';
import type { TimelineWord } from '../engine/captions/captions';
import { snapToFrame } from '../core/time';
import { useEditor } from './hooks';

const VOICES = [
  { id: 'pt-BR-FranciscaNeural', name: 'Francisca', gender: 'Feminina', badge: 'Expressiva', desc: 'Natural e envolvente para vídeos e aulas' },
  { id: 'pt-BR-AntonioNeural', name: 'Antônio', gender: 'Masculina', badge: 'Locutor', desc: 'Voz grave e firme para anúncios e chamadas' },
  { id: 'pt-BR-ThalitaMultilingualNeural', name: 'Thalita', gender: 'Feminina', badge: 'Moderna', desc: 'Dinâmica para Reels, TikTok e podcasts' },
];

export function VoiceGenerator() {
  const { project } = useEditor();
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('pt-BR-FranciscaNeural');
  const [rate, setRate] = useState('+0%');
  const [autoCaptions, setAutoCaptions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const checkServer = async () => {
    try {
      const res = await fetch('http://127.0.0.1:5050/health', { signal: AbortSignal.timeout(1500) });
      setServerOnline(res.ok);
    } catch {
      setServerOnline(false);
    }
  };

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5050/health', { signal: AbortSignal.timeout(1500) });
        if (active) setServerOnline(res.ok);
      } catch {
        if (active) setServerOnline(false);
      }
    };
    void run();
    const interval = setInterval(run, 8000);
    return () => {
      active = false;
      clearInterval(interval);
      if (previewAudio) previewAudio.pause();
    };
  }, [previewAudio]);

  const handlePreview = async () => {
    if (!text.trim()) {
      notify('Digite o texto a ser narrado.', 'error');
      return;
    }
    if (previewAudio) {
      previewAudio.pause();
      setPreviewAudio(null);
      setIsPlaying(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:5050/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, rate }),
      });
      if (!res.ok) throw new Error('Falha ao gerar voz');
      const data = await res.json();
      const audioRes = await fetch(`http://127.0.0.1:5050${data.audio_url}`);
      const blob = await audioRes.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        setIsPlaying(false);
        setPreviewAudio(null);
      };
      await audio.play();
      setPreviewAudio(audio);
      setIsPlaying(true);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao conectar ao servidor de voz', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleInsert = async () => {
    if (!text.trim()) {
      notify('Digite o texto a ser narrado.', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:5050/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, rate }),
      });
      if (!res.ok) throw new Error('Falha ao gerar narração no servidor');
      const data = await res.json();

      const audioRes = await fetch(`http://127.0.0.1:5050${data.audio_url}`);
      const blob = await audioRes.blob();
      const file = new File([blob], data.filename, { type: 'audio/mpeg' });

      const { assets, errors } = await media.importFiles([{ file, path: data.file_path }]);
      if (errors.length) throw new Error(errors[0].message);
      if (!assets.length) throw new Error('Não foi possível registrar o áudio');

      const asset = assets[0];
      store.execute(Cmd.importAssets([asset]));

      const playhead = snapToFrame(playback.time, project.settings.fps);
      actions.addAssetToTimeline(asset.id, undefined, playhead);

      if (autoCaptions && data.sentences && data.sentences.length > 0) {
        const words: TimelineWord[] = data.sentences.map((s: { text: string; start: number; end: number }) => ({
          text: s.text,
          start: playhead + s.start,
          end: playhead + s.end,
          confidence: 1.0,
          limit: playhead + s.end,
        }));
        store.execute(Cmd.generateCaptions(words, 'classic'));
      }

      notify(`Narração gerada e adicionada na timeline! (${data.duration}s)`, 'success');
      setText('');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao inserir narração', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="voice-gen-container" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Status do servidor */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        borderRadius: '6px',
        fontSize: '11px',
        backgroundColor: serverOnline ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        border: `1px solid ${serverOnline ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
        color: serverOnline ? '#10b981' : '#ef4444'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {serverOnline ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          <span>{serverOnline ? 'Servidor de Voz Local Ativo (:5050)' : 'Servidor de Voz Desconectado'}</span>
        </div>
        <button
          onClick={checkServer}
          className="btn sm outline"
          style={{ padding: '2px 6px', fontSize: '10px', height: 'auto' }}
          title="Verificar conexão"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      {!serverOnline && serverOnline !== null && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted, #888)', lineHeight: 1.4 }}>
          Para ligar o servidor, inicie o arquivo: <br />
          <code style={{ fontSize: '10px', background: 'rgba(255,255,255,0.06)', padding: '2px 4px', borderRadius: '3px' }}>
            D:\GITHUB\foco-voice\start.bat
          </code>
        </div>
      )}

      {/* Seleção de vozes */}
      <div>
        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted, #aaa)', display: 'block', marginBottom: '6px' }}>
          Escolha a Voz em Português (PT-BR)
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {VOICES.map((v) => {
            const selected = voice === v.id;
            return (
              <div
                key={v.id}
                onClick={() => setVoice(v.id)}
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${selected ? 'var(--accent, #6366f1)' : 'rgba(255,255,255,0.08)'}`,
                  background: selected ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <span style={{ fontWeight: selected ? 600 : 500, fontSize: '12px', color: selected ? '#fff' : 'inherit' }}>
                    {v.name} ({v.gender})
                  </span>
                  <span style={{
                    fontSize: '10px',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    background: selected ? 'var(--accent, #6366f1)' : 'rgba(255,255,255,0.1)',
                    color: '#fff'
                  }}>
                    {v.badge}
                  </span>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted, #777)' }}>
                  {v.desc}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Opções de velocidade */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted, #aaa)' }}>Velocidade da fala:</span>
        <select
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          style={{
            fontSize: '11px',
            padding: '3px 8px',
            borderRadius: '4px',
            background: 'var(--bg-light, #222)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)'
          }}
        >
          <option value="-15%">Lenta (-15%)</option>
          <option value="+0%">Normal</option>
          <option value="+10%">Rápida (+10%)</option>
          <option value="+20%">Dinâmica (+20%)</option>
        </select>
      </div>

      {/* Caixa de texto */}
      <div>
        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted, #aaa)', display: 'block', marginBottom: '4px' }}>
          Texto para Narração
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Digite ou cole aqui o texto que a IA vai narrar..."
          rows={4}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px',
            borderRadius: '6px',
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#fff',
            fontSize: '12px',
            resize: 'vertical',
            fontFamily: 'inherit'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted, #666)', marginTop: '2px' }}>
          <span>{text.length} caracteres</span>
          <span>{text ? `~${Math.round(text.split(/\s+/).length / 2.5)}s estimados` : ''}</span>
        </div>
      </div>

      {/* Checkbox de legendas */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px' }}>
        <input
          type="checkbox"
          checked={autoCaptions}
          onChange={(e) => setAutoCaptions(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <span>Gerar legendas automáticas na timeline</span>
      </label>

      {/* Botões de Ação */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
        <button
          className="btn sm outline"
          onClick={handlePreview}
          disabled={loading || !text.trim() || !serverOnline}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
        >
          {loading ? (
            <Loader2 size={13} className="spin" />
          ) : isPlaying ? (
            <>
              <Square size={13} /> Parar
            </>
          ) : (
            <>
              <Play size={13} /> Ouvir Prévia
            </>
          )}
        </button>

        <button
          className="btn sm primary"
          onClick={handleInsert}
          disabled={loading || !text.trim() || !serverOnline}
          style={{ flex: 1.4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
        >
          {loading ? (
            <>
              <Loader2 size={13} className="spin" /> Gerando...
            </>
          ) : (
            <>
              <Sparkles size={13} /> Inserir na Timeline
            </>
          )}
        </button>
      </div>
    </div>
  );
}
