export type MediaType = 'video' | 'audio' | 'image' | 'text' | 'subtitle' | 'shape';

export interface BaseClip {
  id: string;
  type: MediaType;
  name: string;
  startAt: number;     // position on timeline in seconds
  duration: number;    // duration on timeline in seconds
  sourceStart?: number; // trim start for video/audio
  trackId: string;
}

// Added audio settings generic type
export interface AudioSettings {
  volume: number;           // 0.0 to 1.0+
  normalization: boolean;   
  noiseReduction: number;   
  compressor: boolean;      
  eqPreset?: 'flat' | 'podcast' | 'vocal_boost' | 'cinematic';
}

export interface VideoClip extends BaseClip {
  type: 'video';
  fileUrl: string;
  volume: number;
  opacity: number;
  scale: number;
  position: { x: number; y: number };
  audioSettings?: AudioSettings;
}

export interface AudioClip extends BaseClip {
  type: 'audio';
  fileUrl: string;
  volume: number;
  audioSettings?: AudioSettings;
}

export interface TextClip extends BaseClip {
  type: 'text';
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  position: { x: number; y: number };
  animationType?: 'fade_scale' | 'typewriter' | 'none';
}

export interface WordTiming {
  word: string;
  start: number; // relative to clip start
  end: number;   // relative to clip start
  highlightColor?: string;
  isEmphasized?: boolean; // trigger bounce/zoom on this word
}

export interface SubtitleClip extends BaseClip {
  type: 'subtitle';
  words: WordTiming[];
  fontFamily: string;
  fontSize: number;
  color: string;
  position: { x: number; y: number };
  preset: 'minimal' | 'podcast' | 'bold' | 'kinetic' | 'cinema';
}

export type Clip = VideoClip | AudioClip | TextClip | SubtitleClip;

export interface Track {
  id: string;
  type: 'video' | 'audio';
  name: string;
  locked: boolean;
  hidden: boolean;
  volume?: number;
}

export interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  playheadPosition: number; // in seconds
  zoomLevel: number;        // pixels per second
  isPlaying: boolean;
  duration: number;         // total composition duration in seconds
}

export type TimelineAction =
  | { type: 'SET_PLAYHEAD'; payload: number }
  | { type: 'TOGGLE_PLAYBACK' }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'ADD_CLIP'; payload: Clip }
  | { type: 'UPDATE_CLIP'; payload: { clipId: string, updates: Partial<Clip> } } // Added update clip action
  | { type: 'MOVE_CLIP'; payload: { clipId: string; newStartAt: number; newTrackId?: string } }
  | { type: 'TRIM_CLIP'; payload: { clipId: string; newStartAt: number; newDuration: number; newSourceStart?: number } }
  | { type: 'DELETE_CLIP'; payload: string }
  | { type: 'SPLIT_CLIP'; payload: { clipId: string; splitAt: number } };
