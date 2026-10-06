import { createContext, useContext, useReducer } from 'react';
import type { ReactNode, Dispatch } from 'react';
import type { TimelineState, TimelineAction, Clip } from '../types/timeline';

const generateId = () => Math.random().toString(36).substring(2, 9);

const initialState: TimelineState = {
  tracks: [
    { id: 'v2', type: 'video', name: 'V2', locked: false, hidden: false }, // Graphics/Text track
    { id: 'v1', type: 'video', name: 'V1', locked: false, hidden: false }, // Main video track
    { id: 'a1', type: 'audio', name: 'A1', locked: false, hidden: false },
  ],
  clips: [
    {
      id: 'clip1',
      type: 'video',
      name: 'TAKE_01.mp4',
      trackId: 'v1',
      startAt: 0,
      duration: 10,
      fileUrl: '',
      volume: 1,
      opacity: 1,
      scale: 1,
      position: { x: 0, y: 0 }
    },
    {
      id: 'clip2',
      type: 'video',
      name: 'TAKE_02.mp4',
      trackId: 'v1',
      startAt: 12,
      duration: 8,
      fileUrl: '',
      volume: 1,
      opacity: 1,
      scale: 1,
      position: { x: 0, y: 0 }
    },
    {
      id: 'text1',
      type: 'text',
      name: 'A MAIOR MENTIRA',
      trackId: 'v2',
      startAt: 2,
      duration: 5,
      content: 'A MAIOR MENTIRA',
      fontFamily: 'Montserrat, sans-serif',
      fontSize: 72,
      color: '#ffffff',
      position: { x: 400, y: 250 }, // Center-ish
      animationType: 'fade_scale'
    }
  ],
  playheadPosition: 0,
  zoomLevel: 10,
  isPlaying: false,
  duration: 60,
};

function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case 'SET_PLAYHEAD':
      return { ...state, playheadPosition: Math.max(0, action.payload) };
    case 'TOGGLE_PLAYBACK':
      return { ...state, isPlaying: !state.isPlaying };
    case 'SET_ZOOM':
      return { ...state, zoomLevel: Math.max(1, action.payload) };
    case 'ADD_CLIP':
      return { ...state, clips: [...state.clips, action.payload] };
    case 'MOVE_CLIP':
      return {
        ...state,
        clips: state.clips.map(c => 
          c.id === action.payload.clipId 
            ? { ...c, startAt: action.payload.newStartAt, trackId: action.payload.newTrackId || c.trackId }
            : c
        )
      };
    case 'UPDATE_CLIP':
      return {
        ...state,
        clips: state.clips.map(c => 
          c.id === action.payload.clipId 
            ? { ...c, ...action.payload.updates } as Clip
            : c
        )
      };
    case 'DELETE_CLIP':
      return { ...state, clips: state.clips.filter(c => c.id !== action.payload) };
    case 'SPLIT_CLIP': {
      const clipToSplit = state.clips.find(c => c.id === action.payload.clipId);
      if (!clipToSplit) return state;

      if (action.payload.splitAt <= clipToSplit.startAt || action.payload.splitAt >= (clipToSplit.startAt + clipToSplit.duration)) {
         return state;
      }

      const durationPart1 = action.payload.splitAt - clipToSplit.startAt;
      const durationPart2 = clipToSplit.duration - durationPart1;

      const clip1 = { ...clipToSplit, duration: durationPart1 };
      const clip2 = { 
        ...clipToSplit, 
        id: generateId(), 
        startAt: action.payload.splitAt, 
        duration: durationPart2,
        sourceStart: (clipToSplit.sourceStart || 0) + durationPart1 
      } as Clip;

      return {
        ...state,
        clips: [...state.clips.filter(c => c.id !== clipToSplit.id), clip1, clip2]
      };
    }
    default:
      return state;
  }
}

const TimelineContext = createContext<{
  state: TimelineState;
  dispatch: Dispatch<TimelineAction>;
} | undefined>(undefined);

export function TimelineProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(timelineReducer, initialState);

  return (
    <TimelineContext.Provider value={{ state, dispatch }}>
      {children}
    </TimelineContext.Provider>
  );
}

export function useTimeline() {
  const context = useContext(TimelineContext);
  if (context === undefined) {
    throw new Error('useTimeline must be used within a TimelineProvider');
  }
  return context;
}
