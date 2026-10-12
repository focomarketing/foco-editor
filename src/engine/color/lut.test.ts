import { describe, expect, it } from 'vitest';
import { getLut, lookId, LOOKS, lutFromFunction, parseCube, registerLut, sampleLut } from './lut';
import { isNeutral, keepLook, NEUTRAL_COLOR, colorPreset } from './color';

/** .cube de exemplo: tamanho 2, troca vermelho com azul. */
const SWAP_RB = `# comentário
TITLE "Troca R/B"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0 0 0
0 0 1
0 1 0
0 1 1
1 0 0
1 0 1
1 1 0
1 1 1
`;

const near = (a: number[], b: number[], tol = 1e-4) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('parseCube', () => {
  it('lê título, tamanho e tabela 3D na ordem .cube (vermelho varia mais rápido)', () => {
    const lut = parseCube(SWAP_RB);
    expect(lut.title).toBe('Troca R/B');
    expect(lut.size).toBe(2);
    expect(near(sampleLut(lut, [1, 0, 0]), [0, 0, 1])).toBe(true);
    expect(near(sampleLut(lut, [0, 0, 1]), [1, 0, 0])).toBe(true);
    expect(near(sampleLut(lut, [0.5, 0.2, 0.8]), [0.8, 0.2, 0.5])).toBe(true); // interpolação trilinear
  });

  it('respeita DOMAIN_MIN/MAX', () => {
    const lut = parseCube(SWAP_RB.replace('DOMAIN_MAX 1 1 1', 'DOMAIN_MAX 2 2 2'));
    expect(near(sampleLut(lut, [2, 0, 0]), [0, 0, 1])).toBe(true);
    expect(near(sampleLut(lut, [1, 0, 0]), [0, 0, 0.5])).toBe(true);
  });

  it('LUT 1D vira 3D (curva por canal)', () => {
    const lut = parseCube('LUT_1D_SIZE 2\n0 0 0\n0.5 1 1\n'); // vermelho pela metade
    expect(lut.size).toBe(33);
    expect(near(sampleLut(lut, [1, 1, 1]), [0.5, 1, 1], 1e-3)).toBe(true);
    expect(near(sampleLut(lut, [0.5, 0.5, 0.5]), [0.25, 0.5, 0.5], 1e-3)).toBe(true);
  });

  it('erros legíveis para arquivos quebrados', () => {
    expect(() => parseCube('isto não é uma LUT')).toThrow(/LUT_3D_SIZE/);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n')).toThrow(/esperava 8 linhas/);
    expect(() => parseCube('LUT_3D_SIZE 2\n' + '0 x 0\n'.repeat(8))).toThrow(/números inválidos/);
  });
});

describe('looks prontos e registro', () => {
  it('cada look fica dentro de 0..1 e muda a imagem (não é identidade)', () => {
    for (const l of LOOKS) {
      const lut = getLut(lookId(l.id))!;
      expect(lut, l.id).toBeTruthy();
      expect(lut.size).toBe(33);
      expect(Math.min(...lut.data)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...lut.data)).toBeLessThanOrEqual(1);
      const mid = sampleLut(lut, [0.6, 0.45, 0.35]);
      expect(near(mid, [0.6, 0.45, 0.35], 0.01), l.id).toBe(false);
    }
  });

  it('getLut: look gerado uma vez só; LUT importada só depois de registrada', () => {
    expect(getLut(lookId('noir'))).toBe(getLut(lookId('noir')));
    expect(getLut('asset-x')).toBeNull();
    const lut = lutFromFunction(2, (r, g, b) => [r, g, b]);
    registerLut('asset-x', lut);
    expect(getLut('asset-x')).toBe(lut);
    expect(getLut(undefined)).toBeNull();
  });
});

describe('cor do clipe com LUT', () => {
  it('LUT conta como ajuste (não é neutro), a 0% não', () => {
    expect(isNeutral({ ...NEUTRAL_COLOR, lut: lookId('noir') })).toBe(false);
    expect(isNeutral({ ...NEUTRAL_COLOR, lut: lookId('noir'), lutAmount: 0 })).toBe(true);
  });

  it('trocar preset ou voltar ao original mantém o look', () => {
    const prev = { ...colorPreset('warm'), lut: lookId('matte'), lutAmount: 0.6 };
    expect(keepLook({ ...colorPreset('cool') }, prev)).toMatchObject({ preset: 'cool', lut: lookId('matte'), lutAmount: 0.6 });
    expect(keepLook(undefined, prev)).toMatchObject({ preset: 'none', lut: lookId('matte') });
    expect(keepLook(undefined, colorPreset('warm'))).toBeUndefined();
  });
});
