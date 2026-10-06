import { describe, expect, it } from 'vitest';
import { timeStretch } from './timeStretch';

const SR = 48000;
const sine = (freq: number, seconds: number) => Float32Array.from({ length: SR * seconds }, (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / SR));

/** Frequência estimada por cruzamentos de zero (miolo do sinal). */
function freqOf(x: Float32Array) {
  const a = Math.floor(x.length * 0.1);
  const b = Math.floor(x.length * 0.9);
  let n = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n / ((b - a) / SR);
}

describe('time-stretch (WSOLA)', () => {
  it.each([0.5, 1.5, 2])('velocidade %sx muda a duração e mantém o tom', (speed) => {
    const [out] = timeStretch([sine(440, 2)], speed);
    expect(out.length).toBe(Math.round((SR * 2) / speed));
    expect(freqOf(out)).toBeGreaterThan(430);
    expect(freqOf(out)).toBeLessThan(450);
    // sem buracos nem estouro
    const peak = out.slice(2000, -2000).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.4);
    expect(peak).toBeLessThan(0.6);
  });

  it('1x devolve igual', () => {
    const x = sine(220, 1);
    expect(timeStretch([x], 1)[0]).toEqual(x);
  });
});
