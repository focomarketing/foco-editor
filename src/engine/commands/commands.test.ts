import { describe, expect, it } from 'vitest';
import type { Asset, Project } from '../../core/types';
import { EditorStore } from '../timeline/EditorStore';
import { clipsOnTrack, createClip, createProject, sourceRangesToTimeline } from '../timeline/operations';
import { Cmd, commandFromJSON, toJSON } from './commands';
import { createdIds } from './patch';
import { serialize, deserialize } from '../project/ProjectEngine';
import { migrateProject } from '../../core/migrate';

function asset(id: string, duration: number): Asset {
  return {
    id, name: `${id}.mp4`, kind: 'video', mimeType: 'video/mp4', size: 1, lastModified: 0, duration,
    width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true,
    videoCodec: 'avc', audioCodec: 'aac', videoDecodable: true, audioDecodable: true,
  };
}

function setup() {
  const store = new EditorStore(createProject());
  const v1 = store.getState().project.tracks[1].id;
  store.execute(Cmd.importAssets([asset('a', 10), asset('b', 4)]));
  return { store, v1, p: () => store.getState().project };
}

/** Cópia profunda sem o carimbo de data (comparação independe da ordem das chaves). */
const snapshot = (p: Project) => JSON.parse(JSON.stringify({ ...p, updatedAt: 0 }));

describe('Edit Command Engine + histórico', () => {
  it('cada comando faz, desfaz e refaz', () => {
    const { store, v1, p } = setup();
    const clip = createClip(p().assets.a, v1, 0);
    const steps = [
      Cmd.addClip(clip),
      Cmd.splitClips([clip.id], 4),
      Cmd.moveClips([{ id: clip.id, start: 1, trackId: v1 }]),
      Cmd.trimClip(clip.id, 'start', 2),
      Cmd.setTransform({ [clip.id]: { x: 0.25, scaleX: 1.5 } }),
      Cmd.setVolume({ [clip.id]: 0.4 }),
      Cmd.setFades({ [clip.id]: { fadeIn: 0.5, fadeOut: 0.5 } }),
      Cmd.setCrop({ [clip.id]: { left: 0.1, top: 0, right: 0.1, bottom: 0 } }),
      Cmd.setSpeed([clip.id], 2),
      Cmd.deleteClips([clip.id]),
    ];
    for (const c of steps) {
      const before = snapshot(p());
      expect(store.execute(c)).not.toBeNull();
      const after = snapshot(p());
      store.undo();
      expect(snapshot(p())).toEqual(before);
      store.redo();
      expect(snapshot(p())).toEqual(after);
    }
  });

  it('várias operações desfeitas voltam exatamente ao início', () => {
    const { store, v1, p } = setup();
    const clip = createClip(p().assets.a, v1, 0);
    store.execute(Cmd.addClip(clip));
    store.execute(Cmd.splitClips([clip.id], 5));
    store.execute(Cmd.deleteClips([clip.id], true));
    store.execute(Cmd.addTrack('video'));
    store.execute(Cmd.renameProject('Outro nome'));
    while (store.getState().canUndo) store.undo();
    expect(p().name).toBe('Projeto sem título');
    expect(p().tracks).toHaveLength(4);
    expect(Object.keys(p().clips)).toHaveLength(0);
    expect(Object.keys(p().assets)).toHaveLength(0); // até a importação foi desfeita
  });

  it('o patch guarda só o que mudou', () => {
    const { store, v1, p } = setup();
    const a = createClip(p().assets.a, v1, 0);
    const b = createClip(p().assets.b, v1, 20);
    store.execute(Cmd.addClip(a));
    store.execute(Cmd.addClip(b));
    const patch = store.execute(Cmd.setVolume({ [b.id]: 0.5 }))!;
    expect(Object.keys(patch.collections.clips!)).toEqual([b.id]);
    expect(patch.fields).toEqual({});
  });

  it('gesto (arrastar) vira um único passo', () => {
    const { store, v1, p } = setup();
    const clip = createClip(p().assets.a, v1, 0);
    store.execute(Cmd.addClip(clip));
    const n = store.history.length;
    store.beginGesture();
    for (const x of [1, 2, 3, 4]) store.preview(Cmd.moveClips([{ id: clip.id, start: x, trackId: v1 }]));
    store.endGesture();
    expect(store.history.length).toBe(n + 1);
    expect(store.history.at(-1)!.command.type).toBe('MOVE_CLIPS');
    expect(p().clips[clip.id].start).toBe(4);
    store.undo();
    expect(p().clips[clip.id].start).toBe(0);
  });

  it('novo comando depois de undo descarta o redo', () => {
    const { store, v1, p } = setup();
    store.execute(Cmd.addClip(createClip(p().assets.a, v1, 0)));
    store.undo();
    expect(store.getState().canRedo).toBe(true);
    store.execute(Cmd.addTrack('audio'));
    expect(store.getState().canRedo).toBe(false);
  });

  it('comando serializado reconstrói o mesmo efeito (base para a IA)', () => {
    const { store, v1, p } = setup();
    const clip = createClip(p().assets.a, v1, 0);
    store.execute(Cmd.addClip(clip));
    const json = JSON.parse(JSON.stringify(toJSON(Cmd.batch('IA', [Cmd.splitClips([clip.id], 3), Cmd.setVolume({ [clip.id]: 0.2 })], 'AI_EDIT'))));
    const rebuilt = commandFromJSON(json);
    store.execute(rebuilt);
    expect(clipsOnTrack(p(), v1)).toHaveLength(2);
    expect(p().clips[clip.id].volume).toBe(0.2);
    expect(store.history.at(-1)!.command.type).toBe('AI_EDIT');
    store.undo();
    expect(clipsOnTrack(p(), v1)).toHaveLength(1);
  });

  it('createdIds aponta o que foi colado', () => {
    const { store, v1, p } = setup();
    const clip = createClip(p().assets.b, v1, 0);
    store.execute(Cmd.addClip(clip));
    const patch = store.execute(Cmd.pasteClips([p().clips[clip.id]], 10))!;
    const ids = createdIds(patch, 'clips');
    expect(ids).toHaveLength(1);
    expect(p().clips[ids[0]].start).toBe(10);
  });
});

describe('velocidade', () => {
  it('2x encurta, empurra os seguintes e mantém o trecho de mídia', () => {
    const { store, v1, p } = setup();
    const a = createClip(p().assets.a, v1, 0); // 0..10
    const b = createClip(p().assets.b, v1, 10); // 10..14
    store.execute(Cmd.addClip(a));
    store.execute(Cmd.addClip(b));
    store.execute(Cmd.setSpeed([a.id], 2));
    expect(p().clips[a.id]).toMatchObject({ duration: 5, speed: 2, sourceIn: 0 });
    expect(p().clips[b.id].start).toBe(5);
  });

  it('split e mapeamento de mídia respeitam a velocidade', () => {
    const { store, v1, p } = setup();
    const a = createClip(p().assets.a, v1, 0);
    store.execute(Cmd.addClip(a));
    store.execute(Cmd.setSpeed([a.id], 2)); // 10 s de mídia em 5 s
    const patch = store.execute(Cmd.splitClips([a.id], 2))!;
    const right = p().clips[createdIds(patch, 'clips')[0]];
    expect(right).toMatchObject({ start: 2, duration: 3, sourceIn: 4 });
    expect(sourceRangesToTimeline(p(), 'a', [[6, 8]])).toEqual([[3, 4]]);
  });
});

describe('projeto: salvar, abrir e migrar', () => {
  it('serializar e abrir devolve a mesma edição', () => {
    const { store, v1, p } = setup();
    const a = createClip(p().assets.a, v1, 1);
    store.execute(Cmd.addClip(a));
    store.execute(Cmd.splitClips([a.id], 4));
    store.execute(Cmd.addMarker({ id: 'm1', time: 2, label: 'Gancho', color: '#ffd400' }));
    store.execute(Cmd.addFolder({ id: 'f1', name: 'Takes', parentId: null }));
    store.execute(Cmd.moveAssets(['a'], 'f1'));
    const loaded = deserialize(serialize(p(), []));
    expect(JSON.stringify(loaded.project)).toBe(JSON.stringify(p()));
  });

  it('projeto do formato 1 abre com os campos novos preenchidos', () => {
    const v1Project = {
      version: 1, id: 'p', name: 'Antigo', createdAt: 0, updatedAt: 0, settings: { width: 1920, height: 1080, fps: 30 },
      assets: {}, tracks: [], clips: { c: { id: 'c', assetId: 'a', trackId: 't', start: 0, duration: 2, sourceIn: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } } },
    };
    const p = migrateProject(v1Project);
    expect(p.version).toBe(2);
    expect(p.clips.c).toMatchObject({ speed: 1, fadeIn: 0, fadeOut: 0, transform: { scaleX: 1, anchorX: 0.5 } });
    expect(p.markers).toEqual([]);
    expect(p.folders).toEqual({});
  });

  it('rejeita arquivo que não é projeto', () => {
    expect(() => deserialize('{"a":1}')).toThrow();
    expect(() => deserialize('não é json')).toThrow();
  });
});
