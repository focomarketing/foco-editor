import React, { useRef, useState } from 'react';
import { useTimeline } from '../store/TimelineContext';
import { Scissors, Layout, Trash2 } from 'lucide-react';

export function Timeline() {
  const { state, dispatch } = useTimeline();
  const timelineRef = useRef<HTMLDivElement>(null);
  const [draggingClip, setDraggingClip] = useState<{ id: string, initialX: number, initialStartAt: number } | null>(null);

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    
    // x coordinate maps to time based on zoomLevel
    const newTime = x / state.zoomLevel;
    dispatch({ type: 'SET_PLAYHEAD', payload: newTime });
  };

  const handleClipMouseDown = (e: React.MouseEvent, clipId: string, startAt: number) => {
    e.stopPropagation();
    setDraggingClip({ id: clipId, initialX: e.clientX, initialStartAt: startAt });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingClip) {
      const deltaX = e.clientX - draggingClip.initialX;
      const deltaTime = deltaX / state.zoomLevel;
      let newStartAt = draggingClip.initialStartAt + deltaTime;
      if (newStartAt < 0) newStartAt = 0;
      
      dispatch({ type: 'MOVE_CLIP', payload: { clipId: draggingClip.id, newStartAt } });
    }
  };

  const handleMouseUp = () => {
    if (draggingClip) {
      setDraggingClip(null);
    }
  };

  const formatTimecode = (seconds: number) => {
    const d = new Date(seconds * 1000);
    return d.toISOString().substring(11, 22).replace('.', ':');
  };

  return (
    <footer className="timeline-section" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      <div className="timeline-toolbar">
        <div className="tools-left">
          <button className="btn btn-icon" onClick={() => {
            // Very naive split for selected clip or first clip under playhead
            const clipToSplit = state.clips.find(c => state.playheadPosition >= c.startAt && state.playheadPosition <= c.startAt + c.duration);
            if(clipToSplit) {
               dispatch({ type: 'SPLIT_CLIP', payload: { clipId: clipToSplit.id, splitAt: state.playheadPosition } });
            }
          }}><Scissors size={16} /></button>
          <button className="btn btn-icon"><Layout size={16} /></button>
          <button className="btn btn-icon"><Trash2 size={16} /></button>
        </div>
        <div className="timecode-display" style={{ fontFamily: 'monospace', fontSize: 14 }}>
           {formatTimecode(state.playheadPosition)} / {formatTimecode(state.duration)}
        </div>
        <div className="zoom-slider">
          <span>-</span>
          <input 
            type="range" 
            min="1" 
            max="100" 
            value={state.zoomLevel} 
            onChange={(e) => dispatch({ type: 'SET_ZOOM', payload: Number(e.target.value) })}
          />
          <span>+</span>
        </div>
      </div>
      
      <div className="timeline-tracks" ref={timelineRef} onClick={handleTimelineClick}>
        {/* Playhead marker */}
        <div 
          className="playhead" 
          style={{ 
            left: `${80 + state.playheadPosition * state.zoomLevel}px`,
            transition: state.isPlaying ? 'none' : 'left 0.1s ease-out'
          }}
        ></div>

        {state.tracks.map(track => (
          <div key={track.id} className={`track ${track.type}-track`}>
            <div className="track-header">{track.name}</div>
            <div className="track-content">
              {state.clips.filter(c => c.trackId === track.id).map(clip => (
                <div 
                  key={clip.id} 
                  className={`clip ${clip.type}-clip`}
                  onMouseDown={(e) => handleClipMouseDown(e, clip.id, clip.startAt)}
                  style={{ 
                    width: `${clip.duration * state.zoomLevel}px`, 
                    left: `${clip.startAt * state.zoomLevel}px`,
                    cursor: draggingClip?.id === clip.id ? 'grabbing' : 'grab'
                  }}
                >
                  {clip.type === 'video' && <span className="clip-name">{clip.name}</span>}
                  {clip.type === 'audio' && <div className="waveform"></div>}
                  {clip.type === 'text' && <span className="clip-name">T: {clip.name}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </footer>
  );
}
