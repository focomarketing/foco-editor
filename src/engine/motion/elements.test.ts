import { describe, expect, it } from 'vitest';
import type { Clip } from '../../core/types';
import { DEFAULT_TRANSFORM, isGraphic, NO_ASSET } from '../../core/types';
import { createProject } from '../timeline/operations';
import { Cmd } from '../commands/commands';
import { drawElement } from './elements';
import { ELEMENT_CATEGORIES, ELEMENT_PRESETS, elementFromPreset, getElementPreset } from './elementLibrary';

/** Canvas falso: registra cada chamada de desenho (método + argumentos arredondados). */
function recorder() {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 10 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      return (...args: unknown[]) => calls.push(`${prop}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(',')})`);
    },
    set(target, prop: string, v) {
      target[prop] = v;
      calls.push(`${prop}=${typeof v === 'number' ? v.toFixed(3) : String(v)}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const clipOf = (presetId: string): Clip => {
  const p = getElementPreset(presetId)!;
  return { id: 'c', assetId: NO_ASSET, trackId: 't', start: 0, duration: p.duration, sourceIn: 0, volume: 0, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM }, element: elementFromPreset(p) };
};
const render = (clip: Clip, t: number) => {
  const r = recorder();
  drawElement(r.ctx, 1920, 1080, clip, t);
  return r.calls;
};

describe('biblioteca de elementos', () => {
  it('ids únicos, categorias conhecidas e ao menos uma camada', () => {
    const ids = ELEMENT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of ELEMENT_PRESETS) {
      expect(ELEMENT_CATEGORIES).toContain(p.category);
      expect(p.layers.length).toBeGreaterThan(0);
    }
    for (const c of ELEMENT_CATEGORIES) expect(ELEMENT_PRESETS.some((p) => p.category === c)).toBe(true);
  });

  it('cada elemento inserido ganha camadas com ids próprios (cópia, não referência)', () => {
    const a = elementFromPreset(getElementPreset('selo-novo')!);
    const b = elementFromPreset(getElementPreset('selo-novo')!);
    expect(a.layers[0].id).not.toBe(b.layers[0].id);
    a.layers[0].fill = '#000000';
    expect(getElementPreset('selo-novo')!.layers[0].fill).not.toBe('#000000');
  });

  it('todos os presets desenham sem erro do começo ao fim', () => {
    for (const p of ELEMENT_PRESETS) {
      const clip = clipOf(p.id);
      for (const t of [0, 0.1, 0.5, p.duration / 2, p.duration - 0.05]) expect(() => render(clip, t)).not.toThrow();
    }
  });
});

describe('desenho determinístico (preview = export)', () => {
  it('partículas: mesmo instante, mesmo quadro; instantes diferentes, quadros diferentes', () => {
    const clip = clipOf('confete');
    expect(render(clip, 1.37)).toEqual(render(clip, 1.37));
    expect(render(clip, 1.37)).not.toEqual(render(clip, 1.6));
  });

  it('semente diferente muda o movimento', () => {
    const a = clipOf('neve');
    const b = structuredClone(a);
    b.element!.layers[0].particles!.seed = 99;
    expect(render(a, 2)).not.toEqual(render(b, 2));
  });

  it('entrada "draw" revela o traço aos poucos', () => {
    const clip = clipOf('circulo');
    const dash = (t: number) => render(clip, t).find((c) => c.startsWith('setLineDash'));
    expect(dash(0.1)).toBeDefined(); // ainda desenhando
    expect(dash(1.5)).toBeUndefined(); // traço completo
  });

  it('camada com atraso não aparece antes da hora', () => {
    const clip = clipOf('xis'); // segunda linha entra 0,2 s depois
    const strokes = (t: number) => render(clip, t).filter((c) => c.startsWith('stroke(')).length;
    expect(strokes(0.1)).toBe(1);
    expect(strokes(0.5)).toBe(2);
  });
});

describe('comandos', () => {
  it('inserir elemento cria a trilha Gráficos e o clipe; é um gráfico (não mídia)', () => {
    const p0 = createProject();
    const p1 = Cmd.addElement({ element: elementFromPreset(getElementPreset('seta')!), at: 1, duration: 3 }).execute(p0);
    const clip = Object.values(p1.clips).find((c) => c.element)!;
    expect(clip.start).toBe(1);
    expect(p1.tracks.find((t) => t.id === clip.trackId)?.name).toBe('Gráficos');
    expect(isGraphic(clip)).toBe(true);
  });

  it('gráfico novo nunca apaga outro: vai para uma trilha livre no trecho', () => {
    const add = (p: ReturnType<typeof createProject>, id: string, at: number) => Cmd.addElement({ element: elementFromPreset(getElementPreset(id)!), at, duration: 3 }).execute(p);
    let p = add(createProject(), 'seta', 0);
    p = add(p, 'confete', 1); // sobrepõe a seta → "Gráficos 2"
    p = add(p, 'estrela', 5); // trecho livre → volta para "Gráficos"
    const track = (preset: string) => p.tracks.find((t) => t.id === Object.values(p.clips).find((c) => c.element?.preset === preset)!.trackId)!.name;
    expect(Object.values(p.clips).filter((c) => c.element)).toHaveLength(3);
    expect([track('seta'), track('confete'), track('estrela')]).toEqual(['Gráficos', 'Gráficos 2', 'Gráficos']);
    const p2 = Cmd.addTitle({ template: 'title', text: 'Oi', at: 0.5, duration: 1 }).execute(p); // títulos também
    expect(Object.values(p2.clips).filter((c) => c.title || c.element)).toHaveLength(4);
  });

  it('máscara entra e sai do clipe', () => {
    const p0 = createProject();
    const p1 = Cmd.addElement({ element: elementFromPreset(getElementPreset('seta')!), at: 0, duration: 3 }).execute(p0);
    const id = Object.keys(p1.clips)[0];
    const mask = { shape: 'ellipse' as const, x: 0.5, y: 0.5, w: 0.5, h: 0.5, radius: 0, feather: 0.1, invert: false };
    const p2 = Cmd.setMask({ [id]: mask }).execute(p1);
    expect(p2.clips[id].mask).toEqual(mask);
    expect(Cmd.setMask({ [id]: undefined }).execute(p2).clips[id].mask).toBeUndefined();
  });
});
