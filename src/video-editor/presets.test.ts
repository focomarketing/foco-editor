import { describe, expect, it } from 'vitest';
import { PROJECT_PRESETS, autoAssembles, presetById } from './presets';
import { TRACKS, createWorkflow, readWorkflow, trackForTemplate } from '../core/workflow';

describe('presets de projeto', () => {
  it('os quatro cards existem e o avatar segue "em breve"', () => {
    expect(PROJECT_PRESETS.map((p) => p.id)).toEqual(['youtube-long', 'short-form', 'ai-avatar', 'manual']);
    expect(presetById('ai-avatar').available).toBe(false);
    expect(TRACKS.find((t) => t.id === 'avatar')?.available).toBe(false);
    expect(presetById('ai-avatar').enabledSkills).toContain('lip-sync');
  });

  it('YouTube longo: 16:9, ritmo natural, áudio ou roteiro, skills do preset', () => {
    const p = presetById('youtube-long');
    expect(p.aspectRatio).toBe('16:9');
    expect(p.modes).toEqual(['audio-led', 'script-led']);
    expect(p.defaultSettings.pacing).toBe('natural');
    expect(p.enabledSkills).toEqual(expect.arrayContaining(['edit-interview-with-broll', 'edit-script-to-video', 'chapter-generator', 'quality-control']));
    const w = createWorkflow(trackForTemplate('youtube-long').id, 'educativo');
    expect(w.template).toBe('youtube-long');
    expect(w.mode).toBe('audio-led');
    expect(w.defaults.aspect).toBe('16:9');
    expect(w.defaults.musicLevel).toBeLessThan(0.2);
  });

  it('Short-form: 9:16, ritmo rápido, legenda forte, skills de curto', () => {
    const w = createWorkflow('short', 'venda', { mode: 'script-led', script: 'Gancho. Problema. Prova. Chamada.' });
    expect(w.template).toBe('short-form');
    expect(w.mode).toBe('script-led');
    expect(w.script).toMatch(/Gancho/);
    expect(w.defaults).toMatchObject({ aspect: '9:16', cutMode: 'dry', captionPreset: 'shorts', pacing: 'fast' });
    expect(w.enabledSkills).toEqual(expect.arrayContaining(['hook-generator', 'aggressive-cut', 'platform-adapter']));
  });

  it('Manual: manual-assisted, sem montagem automática, direto no editor', () => {
    const w = createWorkflow('manual', null, { mode: 'audio-led' }); // modo inválido é ignorado
    expect(w.mode).toBe('manual-assisted');
    expect(autoAssembles(w.mode!)).toBe(false);
    expect(w.phases).toEqual(['editor']);
  });

  it('roteiro só fica guardado no modo script-led', () => {
    expect(createWorkflow('youtube', 'dark', { mode: 'audio-led', script: 'x'.repeat(40) }).script).toBeUndefined();
  });

  it('projeto antigo (sem preset/modo) é completado ao abrir', () => {
    const legacy = { track: 'youtube', subtype: 'cristao', phases: ['cut', 'editor'], status: {}, current: 'cut', defaults: { aspect: '16:9', cutMode: 'natural', captionPreset: 'cinema' } };
    const w = readWorkflow({ workflow: legacy });
    expect(w?.template).toBe('youtube-long');
    expect(w?.mode).toBe('audio-led');
    expect(w?.enabledSkills?.length).toBeGreaterThan(5);
  });
});
