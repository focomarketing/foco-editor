import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { TranscriptWord } from '../../core/types';
import { primaryFamily, SYSTEM_FAMILIES } from '../fonts/fonts';
import { allCaptionPresets, autoEmphasis, buildCaptionClips, CAPTION_CATEGORIES, CAPTION_PRESETS, getPreset, setUserCaptionPresets } from './captions';
import { wordAnimOf } from './renderCaption';

const words = (...t: string[]): TranscriptWord[] => t.map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));

describe('banco de estilos de legenda', () => {
  it('ids únicos e categorias conhecidas', () => {
    const ids = CAPTION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CAPTION_PRESETS.length).toBeGreaterThanOrEqual(30);
    for (const p of CAPTION_PRESETS) expect(CAPTION_CATEGORIES).toContain(p.category);
  });

  it('mantém os ids antigos (projetos e fluxos já usam)', () => {
    for (const id of ['minimal', 'podcast', 'bold', 'kinetic', 'cinema', 'social', 'youtube', 'shorts']) expect(getPreset(id).id).toBe(id);
  });

  it('toda fonte usada pelos estilos vem no app (biblioteca embutida ou sistema)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public/fonts/library/manifest.json'), 'utf8')) as { family: string }[];
    const ok = new Set([...manifest.map((f) => f.family), ...SYSTEM_FAMILIES, 'Georgia', 'Segoe UI']);
    for (const p of CAPTION_PRESETS) expect(ok, `${p.id}: ${p.style.fontFamily}`).toContain(primaryFamily(p.style.fontFamily));
  });

  it('"Meus estilos" entram no banco e no getPreset', () => {
    const mine = { ...CAPTION_PRESETS[0], id: 'user-x', label: 'Meu', category: 'Meus estilos', user: true };
    setUserCaptionPresets([mine]);
    expect(getPreset('user-x').label).toBe('Meu');
    expect(allCaptionPresets().at(-1)?.id).toBe('user-x');
    setUserCaptionPresets([]);
    expect(getPreset('user-x').id).toBe('podcast'); // apagado: volta ao padrão
  });

  it('legendas antigas: pop vira animação "pop" da palavra', () => {
    expect(wordAnimOf({ ...getPreset('shorts').style })).toBe('pop');
    expect(wordAnimOf({ ...getPreset('minimal').style })).toBe('none');
    expect(wordAnimOf({ ...getPreset('shorts').style, wordAnim: 'bounce' })).toBe('bounce');
  });
});

describe('destaque automático', () => {
  it('prefere números e palavras de ênfase, uma por bloco curto', () => {
    const out = autoEmphasis(words('isso', 'é', 'muito', 'importante', 'para', 'você'));
    expect(out.filter((w) => w.emphasis).map((w) => w.text)).toEqual(['muito']);
    const num = autoEmphasis(words('ganhei', 'R$', '500', 'hoje'));
    expect(num.filter((w) => w.emphasis).map((w) => w.text)).toEqual(['500']);
  });

  it('blocos sem palavra forte ficam sem destaque e a marcação antiga é limpa', () => {
    const out = autoEmphasis([{ text: 'olá', start: 0, end: 0.3, emphasis: true }, ...words('bom', 'dia', 'gente')]);
    expect(out.some((w) => w.emphasis)).toBe(false);
  });

  it('estilos com cor de ênfase já geram as legendas destacadas', () => {
    const tw = words('você', 'precisa', 'saber', 'isso', 'agora').map((w) => ({ ...w, limit: 10 }));
    const withEmph = buildCaptionClips(tw, 't', 'hormozi').flatMap((c) => c.caption!.words);
    const without = buildCaptionClips(tw, 't', 'minimal').flatMap((c) => c.caption!.words);
    expect(withEmph.some((w) => w.emphasis)).toBe(true);
    expect(without.some((w) => w.emphasis)).toBe(false);
  });
});
