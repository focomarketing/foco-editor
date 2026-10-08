import { describe, expect, it } from 'vitest';
import { TRACKS, completePhase, createWorkflow, goToPhase, readWorkflow, workflowLabel } from './workflow';

describe('workflow', () => {
  it('trilha + tipo definem formato, ritmo de corte e legenda', () => {
    const w = createWorkflow('youtube', 'cristao');
    expect(w.defaults).toEqual({ aspect: '16:9', cutMode: 'natural', captionPreset: 'cinema' });
    expect(w.current).toBe('cut');
    expect(w.phases.at(-1)).toBe('editor');
    const s = createWorkflow('short', 'venda');
    expect(s.defaults.aspect).toBe('9:16');
    expect(s.defaults.cutMode).toBe('dry');
  });
  it('manual vai direto para o editor', () => {
    const w = createWorkflow('manual', null);
    expect(w.phases).toEqual(['editor']);
    expect(w.current).toBe('editor');
  });
  it('concluir e pular avançam; a última fase é o editor', () => {
    let w = createWorkflow('youtube', 'educativo');
    w = completePhase(w, 'done');
    expect(w.current).toBe('images');
    expect(w.status.cut).toBe('done');
    w = completePhase(w, 'skipped');
    expect(w.current).toBe('transitions');
    for (let i = 0; i < 10; i++) w = completePhase(w, 'skipped');
    expect(w.current).toBe('editor');
  });
  it('voltar a uma fase não apaga o status das outras', () => {
    let w = completePhase(createWorkflow('youtube', 'dark'));
    w = goToPhase(w, 'cut');
    expect(w.current).toBe('cut');
    expect(w.status.cut).toBe('done');
    expect(goToPhase(w, 'xyz' as never).current).toBe('cut');
  });
  it('readWorkflow tolera projetos antigos', () => {
    expect(readWorkflow({})).toBeNull();
    expect(readWorkflow(undefined)).toBeNull();
    expect(readWorkflow({ workflow: createWorkflow('short', 'react') })?.track).toBe('short');
  });
  it('rótulos e trilhas', () => {
    expect(workflowLabel(createWorkflow('youtube', 'podcast'))).toBe('Vídeo longo · Podcast / conversa');
    expect(workflowLabel(null)).toBe('Edição manual');
    expect(TRACKS.find((t) => t.id === 'avatar')?.available).toBe(false);
  });
});
