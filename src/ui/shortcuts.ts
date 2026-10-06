// Atalhos de teclado: um KEYMAP (combinação -> id de ação) e um registro de ações.
// Customizar = trocar o keymap (persistido em 'foco.keymap'); as ações não mudam.

import { useEffect, useRef } from 'react';
import { actions, playback, store } from '../app/editor';
import { prefsStore } from '../app/prefs';
import { projectDuration } from '../engine/timeline/operations';

export type ActionId =
  | 'play' | 'shuttleBack' | 'shuttleStop' | 'shuttleForward'
  | 'split' | 'delete' | 'rippleDelete' | 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'duplicate' | 'selectAll' | 'deselect'
  | 'save' | 'saveAs' | 'open' | 'import' | 'export'
  | 'frameBack' | 'frameForward' | 'secondBack' | 'secondForward' | 'home' | 'end'
  | 'togglePerf' | 'toggleSnap' | 'zoomIn' | 'zoomOut' | 'toolSelect' | 'toolRazor' | 'addMarker' | 'nextMarker' | 'prevMarker';

/** Combinação normalizada: modificadores em ordem fixa + tecla (ex.: "ctrl+shift+z", "space"). */
export const DEFAULT_KEYMAP: Record<string, ActionId> = {
  space: 'play',
  j: 'shuttleBack',
  k: 'shuttleStop',
  l: 'shuttleForward',
  s: 'split',
  delete: 'delete',
  backspace: 'delete',
  'shift+delete': 'rippleDelete',
  'shift+backspace': 'rippleDelete',
  'ctrl+z': 'undo',
  'ctrl+shift+z': 'redo',
  'ctrl+y': 'redo',
  'ctrl+c': 'copy',
  'ctrl+x': 'cut',
  'ctrl+v': 'paste',
  'ctrl+d': 'duplicate',
  'ctrl+a': 'selectAll',
  escape: 'deselect',
  'ctrl+s': 'save',
  'ctrl+shift+s': 'saveAs',
  'ctrl+o': 'open',
  'ctrl+i': 'import',
  'ctrl+e': 'export',
  arrowleft: 'frameBack',
  arrowright: 'frameForward',
  'shift+arrowleft': 'secondBack',
  'shift+arrowright': 'secondForward',
  home: 'home',
  end: 'end',
  n: 'toggleSnap',
  'ctrl+shift+p': 'togglePerf',
  '+': 'zoomIn',
  '=': 'zoomIn',
  '-': 'zoomOut',
  v: 'toolSelect',
  c: 'toolRazor',
  m: 'addMarker',
  'shift+m': 'nextMarker',
  'alt+m': 'prevMarker',
};

export function loadKeymap(): Record<string, ActionId> {
  try {
    return { ...DEFAULT_KEYMAP, ...(JSON.parse(localStorage.getItem('foco.keymap') ?? '{}') as Record<string, ActionId>) };
  } catch {
    return DEFAULT_KEYMAP;
  }
}

export function comboOf(e: KeyboardEvent): string {
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
  const mods = [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey && key.length > 1 ? 'shift' : e.shiftKey && /[a-z]/.test(key) ? 'shift' : '']
    .filter(Boolean)
    .join('+');
  return mods ? `${mods}+${key}` : key;
}

function typingTarget(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return type !== 'range' && type !== 'checkbox' && type !== 'button';
  }
  return false;
}

export function useShortcuts(opts: { openExport: () => void; exporting: boolean }) {
  const ref = useRef(opts);
  useEffect(() => {
    ref.current = opts;
  });

  useEffect(() => {
    const keymap = loadKeymap();
    const fps = () => store.getState().project.settings.fps;
    const run: Record<ActionId, () => void> = {
      play: () => {
        (document.activeElement as HTMLElement | null)?.blur?.(); // espaço não "clica" o botão focado
        playback.toggle();
      },
      shuttleBack: () => playback.shuttle(-1),
      shuttleStop: () => playback.shuttle(0),
      shuttleForward: () => playback.shuttle(1),
      split: () => actions.split(),
      delete: () => actions.deleteSelection(false),
      rippleDelete: () => actions.deleteSelection(true),
      undo: () => store.undo(),
      redo: () => store.redo(),
      copy: () => actions.copy(),
      cut: () => actions.cut(),
      paste: () => actions.paste(),
      duplicate: () => actions.duplicate(),
      selectAll: () => actions.selectAll(),
      deselect: () => store.select([]),
      save: () => void actions.save(false),
      saveAs: () => void actions.save(true),
      open: () => void actions.openProject(),
      import: () => void actions.importMedia(),
      export: () => projectDuration(store.getState().project) > 0 && ref.current.openExport(),
      frameBack: () => playback.stepFrames(-1),
      frameForward: () => playback.stepFrames(1),
      secondBack: () => playback.stepFrames(-fps()),
      secondForward: () => playback.stepFrames(fps()),
      home: () => playback.seek(0),
      end: () => playback.seek(projectDuration(store.getState().project)),
      togglePerf: () => prefsStore.set({ showPerformancePanel: !prefsStore.get().showPerformancePanel }),
      toggleSnap: () => store.setSnapping(!store.getState().snapping),
      zoomIn: () => store.setZoom(store.getState().zoom * 1.5),
      zoomOut: () => store.setZoom(store.getState().zoom / 1.5),
      toolSelect: () => prefsStore.set({ tool: 'select' }),
      toolRazor: () => prefsStore.set({ tool: 'razor' }),
      addMarker: () => actions.addMarker(),
      nextMarker: () => actions.jumpMarker(1),
      prevMarker: () => actions.jumpMarker(-1),
    };

    const onKey = (e: KeyboardEvent) => {
      if (ref.current.exporting || typingTarget(e)) return;
      const action = keymap[comboOf(e)];
      if (!action) return;
      if (action === 'play' && e.repeat) return;
      e.preventDefault();
      run[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
