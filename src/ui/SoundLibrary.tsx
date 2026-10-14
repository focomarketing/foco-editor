// Biblioteca de sons do FOCO: trilhas por clima, efeitos sonoros e ambientes gerados no próprio
// computador (sem licença). Ouvir antes (▶) e pôr na timeline no cursor (+), na faixa certa
// (Música, Efeitos sonoros ou Ambiente).

import { useRef, useState } from 'react';
import { Loader2, Play, Plus, Square } from 'lucide-react';
import { SOUND_LIBRARY, soundFile } from '../engine/audio/soundLibrary';
import type { SoundDef, SoundKind } from '../engine/audio/soundLibrary';
import { actions, playback, store } from '../app/editor';
import { Cmd } from '../engine/commands/commands';
import { notify } from '../app/notify';

const GROUPS: { kind: SoundKind; label: string; track: string }[] = [
  { kind: 'music', label: 'Trilhas', track: 'Música' },
  { kind: 'sfx', label: 'Efeitos sonoros', track: 'Efeitos sonoros' },
  { kind: 'ambience', label: 'Ambientes', track: 'Ambiente' },
];

export function SoundLibrary() {
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(2);
  const player = useRef<HTMLAudioElement | null>(null);

  const preview = async (s: SoundDef) => {
    player.current?.pause();
    if (now === s.id) {
      setNow(null);
      return;
    }
    setBusy(s.id);
    try {
      const file = await soundFile(s.id, { duration: s.kind === 'sfx' ? s.duration : 12 });
      const url = URL.createObjectURL(file);
      const el = new Audio(url);
      player.current = el;
      el.onended = () => {
        URL.revokeObjectURL(url);
        setNow(null);
      };
      await el.play();
      setNow(s.id);
    } catch (e) {
      notify(`Não consegui tocar: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const add = async (s: SoundDef, trackName: string) => {
    setBusy(s.id);
    try {
      const file = await soundFile(s.id, { duration: s.kind === 'sfx' ? s.duration : minutes * 60 });
      await actions.importItems([{ file }]);
      const p = store.getState().project;
      const asset = Object.values(p.assets).find((a) => a.name === file.name);
      if (!asset) throw new Error('o som não entrou na mídia');
      let track = p.tracks.find((t) => t.kind === 'audio' && t.name === trackName && !t.locked);
      if (!track) {
        const id = `t${crypto.randomUUID().slice(0, 8)}`;
        store.execute(Cmd.addTrack('audio', { id, name: trackName }));
        track = store.getState().project.tracks.find((t) => t.id === id);
      }
      actions.addAssetToTimeline(asset.id, track?.id, playback.time);
      // volume de partida: trilha e ambiente baixos sob a voz, efeito a meio
      const clip = Object.values(store.getState().project.clips).find((c) => c.assetId === asset.id);
      if (clip) store.execute(Cmd.setVolume({ [clip.id]: s.kind === 'music' ? 0.15 : s.kind === 'ambience' ? 0.1 : 0.5 }));
      notify(`"${s.label}" na faixa ${trackName}, no cursor. O volume já entra baixo; ajuste no painel do clipe.`, 'success');
    } catch (e) {
      notify(`Não consegui adicionar: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="insp sound-library" data-testid="sound-library">
      <p className="note">Sons gerados aqui no computador: livres para usar, sem licença. ▶ ouve, + põe na timeline no cursor.</p>
      <div className="field">
        <label>Duração das trilhas</label>
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {[1, 2, 3, 5].map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
      </div>
      {GROUPS.map((g) => (
        <div key={g.kind}>
          <h4>{g.label}</h4>
          {SOUND_LIBRARY.filter((s) => s.kind === g.kind).map((s) => (
            <div key={s.id} className="row-between sound-row" title={s.hint}>
              <span>
                <b>{s.label}</b>
                <br />
                <span className="muted">{s.hint}</span>
              </span>
              <span>
                <button className="btn sm" disabled={!!busy && busy !== s.id} onClick={() => void preview(s)} aria-label={`Ouvir ${s.label}`} data-testid={`sound-play-${s.id}`}>
                  {busy === s.id ? <Loader2 size={12} className="spin" /> : now === s.id ? <Square size={12} /> : <Play size={12} />}
                </button>
                <button className="btn sm" disabled={!!busy} onClick={() => void add(s, g.track)} aria-label={`Adicionar ${s.label}`} data-testid={`sound-add-${s.id}`}>
                  <Plus size={12} />
                </button>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
