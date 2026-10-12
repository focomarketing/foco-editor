// Pilha de efeitos de um clipe (vídeo/imagem) ou de uma camada de efeito, no Inspector.

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { Clip, EffectSpec, EffectType } from '../core/types';
import { EFFECT_CATEGORIES, EFFECTS, makeEffect } from '../engine/effects/effects';
import { Range } from './InspectorFx';
import { commit, live } from './clipEdit';
import { LutSelect } from './LutSelect';

const RHYTHM: EffectType[] = ['glitch', 'shake', 'zoomPulse', 'flash', 'lightLeak'];
const COLORS: EffectType[] = ['duotone', 'lightLeak'];

export function EffectsSection({ clip }: { clip: Clip }) {
  const list = clip.effects ?? [];
  const [adding, setAdding] = useState(false);
  const set = (fn: (l: EffectSpec[]) => EffectSpec[], label: string) =>
    commit(clip.id, label, (c) => {
      const next = fn(c.effects ?? []);
      return { effects: next.length || c.adjustment ? next : undefined };
    });
  const patch = (id: string, p: Partial<EffectSpec>, label: string) => set((l) => l.map((e) => (e.id === id ? { ...e, ...p } : e)), label);
  const livePatch = (id: string, p: Partial<EffectSpec>) => live(clip.id, (c) => ({ effects: (c.effects ?? []).map((e) => (e.id === id ? { ...e, ...p } : e)) }));
  const move = (id: string, dir: -1 | 1) =>
    set((l) => {
      const i = l.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }, 'Ordem dos efeitos');

  return (
    <div>
      <div className="row-between">
        <h4 style={{ margin: 0 }}>Efeitos{list.length ? ` (${list.length})` : ''}</h4>
        <button className="btn sm outline" onClick={() => setAdding((a) => !a)} data-testid="fx-add"><Plus size={12} /> Efeito</button>
      </div>
      {adding && (
        <div className="fx-add">
          {EFFECT_CATEGORIES.map((cat) => (
            <div key={cat}>
              <div className="font-sec" style={{ position: 'static', background: 'transparent', border: 0, padding: '4px 0 2px' }}>{cat}</div>
              <div className="el-add" style={{ marginTop: 0 }}>
                {(Object.keys(EFFECTS) as EffectType[]).filter((k) => EFFECTS[k].category === cat).map((k) => (
                  <button
                    key={k}
                    className="font-chip"
                    title={EFFECTS[k].hint}
                    onClick={() => {
                      set((l) => [...l, makeEffect(k)], `Efeito ${EFFECTS[k].label}`);
                      setAdding(false);
                    }}
                    data-testid={`fx-add-${k}`}
                  >
                    {EFFECTS[k].label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {!list.length && !adding && <p className="note">Sem efeitos. Use "+ Efeito" ou a aba Efeitos.</p>}
      {list.map((e, i) => {
        const d = EFFECTS[e.type];
        const on = e.enabled !== false;
        return (
          <div key={e.id} className={`fx-item${on ? '' : ' off'}`} data-testid={`fx-item-${e.type}`}>
            <div className="fx-head">
              <label className="check" title={on ? 'Desligar' : 'Ligar'}>
                <input type="checkbox" checked={on} onChange={(ev) => patch(e.id, { enabled: ev.target.checked ? undefined : false }, ev.target.checked ? 'Ligar efeito' : 'Desligar efeito')} />
                <b>{d.label}</b>
              </label>
              <span className="el-tools">
                <button className="btn icon sm" title="Antes (aplica primeiro)" disabled={i === 0} onClick={() => move(e.id, -1)}><ArrowUp size={11} /></button>
                <button className="btn icon sm" title="Depois" disabled={i === list.length - 1} onClick={() => move(e.id, 1)}><ArrowDown size={11} /></button>
                <button className="btn icon sm danger" title="Remover efeito" onClick={() => set((l) => l.filter((x) => x.id !== e.id), `Remover ${d.label}`)} data-testid={`fx-remove-${e.type}`}><Trash2 size={11} /></button>
              </span>
            </div>
            <Range label="Intensidade" value={e.amount} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onLive={(v) => livePatch(e.id, { amount: v })} />
            {e.type === 'look' && <LutSelect value={e.lut} allowNone={false} onChange={(lut) => lut && patch(e.id, { lut }, 'Look do efeito')} />}
            {RHYTHM.includes(e.type) && <Range label="Ritmo" value={e.speed ?? 1} min={0.25} max={4} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onLive={(v) => livePatch(e.id, { speed: v })} />}
            {COLORS.includes(e.type) && (
              <div className="field wide">
                <label>Cores</label>
                <span className="colors">
                  <input type="color" value={e.color ?? '#000000'} title={e.type === 'duotone' ? 'Sombras' : 'Luz 1'} onChange={(ev) => patch(e.id, { color: ev.target.value }, 'Cor do efeito')} />
                  <input type="color" value={e.color2 ?? '#ffffff'} title={e.type === 'duotone' ? 'Luzes' : 'Luz 2'} onChange={(ev) => patch(e.id, { color2: ev.target.value }, 'Cor do efeito')} />
                </span>
              </div>
            )}
          </div>
        );
      })}
      {clip.adjustment && <p className="note">Camada de efeito: vale para tudo que está nas trilhas de baixo neste trecho. A opacidade (e seus keyframes) dosa a intensidade.</p>}
    </div>
  );
}
