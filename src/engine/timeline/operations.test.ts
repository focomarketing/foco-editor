import { describe, expect, it } from 'vitest';
import type { Asset, Project } from '../../core/types';
import {
  addClip,
  clipEnd,
  clipsOnTrack,
  createClip,
  createProject,
  deleteClips,
  findSnap,
  mergeRanges,
  moveClips,
  pasteClips,
  rippleRemoveRanges,
  sourceRangesToTimeline,
  splitClips,
  trimBounds,
  trimClip,
  updateTrack,
} from './operations';

function asset(id: string, duration: number, kind: Asset['kind'] = 'video'): Asset {
  return {
    id, name: id, kind, mimeType: 'video/mp4', size: 1, lastModified: 0, duration,
    width: 1920, height: 1080, fps: 30, hasVideo: kind !== 'audio', hasAudio: true,
    videoCodec: 'avc', audioCodec: 'aac', videoDecodable: true, audioDecodable: true,
  };
}

function setup(): { p: Project; v1: string; v2: string } {
  let p = createProject();
  p = { ...p, assets: { a: asset('a', 10), b: asset('b', 4), img: asset('img', 0, 'image') } };
  const v2 = p.tracks[0].id;
  const v1 = p.tracks[1].id;
  return { p, v1, v2 };
}

const ids = (p: Project, track: string) => clipsOnTrack(p, track).map((c) => [c.start, c.duration, c.sourceIn]);

describe('overwrite', () => {
  it('cobre o meio de um clipe e divide em dois', () => {
    const { p, v1 } = setup();
    const a = createClip(p.assets.a, v1, 0);
    let q = addClip(p, a);
    const b = { ...createClip(p.assets.b, v1, 3) };
    q = addClip(q, b);
    expect(ids(q, v1)).toEqual([
      [0, 3, 0],
      [3, 4, 0],
      [7, 3, 7],
    ]);
  });

  it('remove clipe totalmente coberto e corta a cabeça do seguinte', () => {
    const { p, v1 } = setup();
    let q = addClip(p, { ...createClip(p.assets.b, v1, 0), duration: 2 });
    q = addClip(q, { ...createClip(p.assets.b, v1, 2) }); // 2..6
    q = addClip(q, createClip(p.assets.b, v1, 0)); // 0..4 cobre o primeiro e metade do segundo
    expect(ids(q, v1)).toEqual([
      [0, 4, 0],
      [4, 2, 2],
    ]);
  });
});

describe('split', () => {
  it('divide no tempo e ajusta sourceIn', () => {
    const { p, v1 } = setup();
    const c = createClip(p.assets.a, v1, 2);
    const { project, created } = splitClips(addClip(p, c), [c.id], 5);
    expect(created).toHaveLength(1);
    expect(project.clips[c.id].duration).toBe(3);
    expect(project.clips[created[0]]).toMatchObject({ start: 5, duration: 7, sourceIn: 3 });
  });

  it('ignora corte fora do clipe', () => {
    const { p, v1 } = setup();
    const c = createClip(p.assets.a, v1, 2);
    const { created } = splitClips(addClip(p, c), [c.id], 2);
    expect(created).toHaveLength(0);
  });
});

describe('trim', () => {
  it('não estica além da mídia nem antes do sourceIn 0', () => {
    const { p, v1 } = setup();
    const c = createClip(p.assets.a, v1, 2);
    let q = addClip(p, c);
    q = trimClip(q, c.id, 'end', 50);
    expect(clipEnd(q.clips[c.id])).toBe(12);
    q = trimClip(q, c.id, 'start', 0);
    expect(q.clips[c.id].start).toBe(2);
    q = trimClip(q, c.id, 'start', 4);
    expect(q.clips[c.id]).toMatchObject({ start: 4, duration: 8, sourceIn: 2 });
    q = trimClip(q, c.id, 'start', 3);
    expect(q.clips[c.id]).toMatchObject({ start: 3, duration: 9, sourceIn: 1 });
  });

  it('para no vizinho', () => {
    const { p, v1 } = setup();
    const a = { ...createClip(p.assets.a, v1, 0), duration: 3 };
    const b = createClip(p.assets.b, v1, 5);
    const q = addClip(addClip(p, a), b);
    expect(trimBounds(q, a.id, 'end')[1]).toBe(5);
    expect(trimBounds(q, b.id, 'start')[0]).toBe(5); // b tem sourceIn 0, não pode recuar
  });

  it('imagem pode esticar livremente', () => {
    const { p, v1 } = setup();
    const c = createClip(p.assets.img, v1, 0);
    const q = trimClip(addClip(p, c), c.id, 'end', 30);
    expect(q.clips[c.id].duration).toBe(30);
  });
});

describe('move', () => {
  it('move para outra trilha sobrescrevendo', () => {
    const { p, v1, v2 } = setup();
    const a = createClip(p.assets.a, v2, 0);
    const b = createClip(p.assets.b, v1, 0);
    let q = addClip(addClip(p, a), b);
    q = moveClips(q, [{ id: b.id, start: 2, trackId: v2 }]);
    expect(ids(q, v2)).toEqual([
      [0, 2, 0],
      [2, 4, 0],
      [6, 4, 6],
    ]);
    expect(ids(q, v1)).toEqual([]);
  });

  it('clamp em zero', () => {
    const { p, v1 } = setup();
    const a = createClip(p.assets.a, v1, 1);
    const q = moveClips(addClip(p, a), [{ id: a.id, start: -5, trackId: v1 }]);
    expect(q.clips[a.id].start).toBe(0);
  });
});

describe('delete', () => {
  it('ripple fecha o buraco só na mesma trilha', () => {
    const { p, v1, v2 } = setup();
    const a = createClip(p.assets.b, v1, 0); // 0..4
    const b = createClip(p.assets.b, v1, 4); // 4..8
    const c = createClip(p.assets.b, v1, 10); // 10..14
    const other = createClip(p.assets.b, v2, 10);
    let q = [a, b, c, other].reduce(addClip, p);
    q = deleteClips(q, [b.id], true);
    expect(ids(q, v1).map((x) => x[0])).toEqual([0, 6]);
    expect(q.clips[other.id].start).toBe(10);
  });

  it('lift mantém posições', () => {
    const { p, v1 } = setup();
    const a = createClip(p.assets.b, v1, 0);
    const b = createClip(p.assets.b, v1, 4);
    const q = deleteClips(addClip(addClip(p, a), b), [a.id]);
    expect(q.clips[b.id].start).toBe(4);
    expect(q.clips[a.id]).toBeUndefined();
  });
});

describe('paste', () => {
  it('cola mantendo espaçamento', () => {
    const { p, v1 } = setup();
    const a = createClip(p.assets.b, v1, 0);
    const b = createClip(p.assets.b, v1, 6);
    const q0 = addClip(addClip(p, a), b);
    const { project, created } = pasteClips(q0, [q0.clips[a.id], q0.clips[b.id]], 20);
    expect(created.map((id) => project.clips[id].start)).toEqual([20, 26]);
  });
});

describe('cortes por intervalo', () => {
  it('ripple remove em todas as trilhas destravadas e mantém a sincronia', () => {
    const { p, v1, v2 } = setup();
    const main = createClip(p.assets.a, v1, 0); // 0..10
    const over = { ...createClip(p.assets.b, v2, 6) }; // 6..10
    let q = addClip(addClip(p, main), over);
    q = rippleRemoveRanges(q, [[2, 3], [5, 5.5]]);
    expect(ids(q, v1)).toEqual([
      [0, 2, 0],
      [2, 2, 3],
      [4, 4.5, 5.5],
    ]);
    // o clipe de cima andou 1.5s para a esquerda, como o material de baixo
    expect(ids(q, v2)).toEqual([[4.5, 4, 0]]);
  });

  it('trilha travada não se mexe', () => {
    const { p, v1, v2 } = setup();
    let q = addClip(addClip(p, createClip(p.assets.a, v1, 0)), createClip(p.assets.b, v2, 6));
    q = updateTrack(q, v2, { locked: true });
    q = rippleRemoveRanges(q, [[1, 2]]);
    expect(ids(q, v2)[0][0]).toBe(6);
  });

  it('mapeia tempo da mídia para a timeline', () => {
    const { p, v1 } = setup();
    const c = { ...createClip(p.assets.a, v1, 10), sourceIn: 2, duration: 5 }; // fonte 2..7 em 10..15
    const q = addClip(p, c);
    expect(sourceRangesToTimeline(q, 'a', [[0, 3], [6, 9]])).toEqual([
      [10, 11],
      [14, 15],
    ]);
  });

  it('mergeRanges une sobreposições', () => {
    expect(mergeRanges([[3, 4], [0, 1], [0.5, 2]])).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });
});

describe('snap', () => {
  it('encontra o ponto mais próximo dentro do limiar', () => {
    expect(findSnap(4.95, [0, 5, 10], 0.1)).toBe(5);
    expect(findSnap(4.5, [0, 5, 10], 0.1)).toBeNull();
  });
});
