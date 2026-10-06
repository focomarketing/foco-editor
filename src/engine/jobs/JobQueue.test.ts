import { describe, expect, it } from 'vitest';
import { JobQueue } from './JobQueue';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Job Queue', () => {
  it('executa por prioridade e respeita o limite por tipo', async () => {
    const q = new JobQueue();
    const order: string[] = [];
    const gate: (() => void)[] = [];
    const wait = () => new Promise<void>((r) => gate.push(r));
    q.add({ type: 'proxy', label: 'p1', priority: 'low' }, async () => { order.push('p1'); await wait(); });
    q.add({ type: 'proxy', label: 'p2', priority: 'high' }, async () => { order.push('p2'); await wait(); });
    q.add({ type: 'thumbnail', label: 't', priority: 'low' }, async () => { order.push('t'); });
    await tick();
    // só 1 proxy por vez; o de prioridade alta vai primeiro, o thumbnail roda em paralelo
    expect(order).toEqual(['p2', 't']);
    gate.shift()!();
    await tick(); await tick();
    expect(order).toEqual(['p2', 't', 'p1']);
    gate.shift()!();
  });

  it('progresso, conclusão e falha com mensagem real', async () => {
    const q = new JobQueue();
    const ok = q.add({ type: 'waveform', label: 'w' }, async (ctx) => { ctx.progress(0.5); return 42; });
    expect(await ok.done).toBe(42);
    expect(q.jobs[0]).toMatchObject({ status: 'completed', progress: 1 });
    const bad = q.add({ type: 'analyze', label: 'a' }, async () => { throw new Error('codec X não suportado'); });
    await expect(bad.done).rejects.toThrow('codec X');
    expect(q.jobs.at(-1)).toMatchObject({ status: 'failed', error: 'codec X não suportado' });
  });

  it('cancela job em execução e na fila', async () => {
    const q = new JobQueue();
    const running = q.add({ type: 'proxy', label: 'longo' }, (ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))));
    const queued = q.add({ type: 'proxy', label: 'na fila' }, async () => 1);
    await tick();
    q.cancel(queued.id);
    q.cancel(running.id);
    await expect(running.done).rejects.toThrow();
    await expect(queued.done).rejects.toThrow();
    expect(q.jobs.map((j) => j.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('retry reexecuta o mesmo trabalho', async () => {
    const q = new JobQueue();
    let n = 0;
    const j = q.add({ type: 'hash', label: 'h' }, async () => { n++; if (n === 1) throw new Error('falha temporária'); return 'ok'; });
    await expect(j.done).rejects.toThrow();
    expect(await q.retry(j.id)).toBe('ok');
    expect(n).toBe(2);
  });
});
