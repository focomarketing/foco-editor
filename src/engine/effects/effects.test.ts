import { describe, expect, it } from 'vitest';
import type { EffectType } from '../../core/types';
import { isGraphic } from '../../core/types';
import { createProject } from '../timeline/operations';
import { Cmd } from '../commands/commands';
import { activeEffects, EFFECT_CATEGORIES, EFFECTS, makeEffect } from './effects';

describe('biblioteca de efeitos', () => {
  it('cada efeito tem categoria conhecida e intensidade padrão válida', () => {
    for (const [k, d] of Object.entries(EFFECTS)) {
      expect(EFFECT_CATEGORIES, k).toContain(d.category);
      expect(d.amount).toBeGreaterThan(0);
      expect(d.amount).toBeLessThanOrEqual(1);
    }
    for (const c of EFFECT_CATEGORIES) expect(Object.values(EFFECTS).some((d) => d.category === c)).toBe(true);
  });

  it('makeEffect traz os padrões (cores e ritmo quando o efeito usa) e ids únicos', () => {
    const a = makeEffect('duotone');
    const b = makeEffect('duotone');
    expect(a.id).not.toBe(b.id);
    expect(a.color && a.color2).toBeTruthy();
    expect(makeEffect('glitch').speed).toBe(1);
    expect(makeEffect('blur').color).toBeUndefined();
  });

  it('efeitos desligados ou zerados não entram na pilha ativa', () => {
    const list = (['blur', 'bw', 'vhs'] as EffectType[]).map(makeEffect);
    list[1].enabled = false;
    list[2].amount = 0;
    expect(activeEffects(list).map((e) => e.type)).toEqual(['blur']);
    expect(activeEffects(undefined)).toEqual([]);
  });
});

describe('comandos de efeito', () => {
  it('camada de efeito: trilha "Efeitos", sem mídia, conta como gráfico', () => {
    const p = Cmd.addAdjustment({ effects: [makeEffect('vhs')], at: 2, duration: 3 }).execute(createProject());
    const clip = Object.values(p.clips).find((c) => c.adjustment)!;
    expect(clip.start).toBe(2);
    expect(clip.effects?.[0].type).toBe('vhs');
    expect(p.tracks.find((t) => t.id === clip.trackId)?.name).toBe('Efeitos');
    expect(isGraphic(clip)).toBe(true);
  });

  it('duas camadas no mesmo trecho não se apagam (Efeitos 2)', () => {
    let p = Cmd.addAdjustment({ effects: [makeEffect('bw')], at: 0, duration: 3 }).execute(createProject());
    p = Cmd.addAdjustment({ effects: [makeEffect('grain')], at: 1, duration: 3 }).execute(p);
    const names = Object.values(p.clips).map((c) => p.tracks.find((t) => t.id === c.trackId)!.name).sort();
    expect(names).toEqual(['Efeitos', 'Efeitos 2']);
  });

  it('setEffects troca a pilha e remove com undefined', () => {
    const p0 = Cmd.addAdjustment({ effects: [makeEffect('bw')], at: 0, duration: 3 }).execute(createProject());
    const id = Object.keys(p0.clips)[0];
    const fx = [makeEffect('glow'), makeEffect('vignette')];
    const p1 = Cmd.setEffects({ [id]: fx }).execute(p0);
    expect(p1.clips[id].effects?.map((e) => e.type)).toEqual(['glow', 'vignette']);
    expect(Cmd.setEffects({ [id]: undefined }).execute(p1).clips[id].effects).toBeUndefined();
  });
});
