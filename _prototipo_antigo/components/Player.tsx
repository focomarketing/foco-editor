import { useEffect, useRef } from 'react';
import { useTimeline } from '../store/TimelineContext';
import { Play, Pause } from 'lucide-react';
import type { TextClip, SubtitleClip } from '../types/timeline';

export function Player() {
  const { state, dispatch } = useTimeline();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const width = 800;
  const height = 450;

  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      if (state.isPlaying) {
        const delta = (currentTime - lastTime) / 1000;
        let nextPosition = state.playheadPosition + delta;
        
        if (nextPosition >= state.duration) {
          nextPosition = 0;
          dispatch({ type: 'TOGGLE_PLAYBACK' });
        }
        
        dispatch({ type: 'SET_PLAYHEAD', payload: nextPosition });
      }
      lastTime = currentTime;
      animationFrameId = requestAnimationFrame(loop);
    };

    if (state.isPlaying) {
      animationFrameId = requestAnimationFrame(loop);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [state.isPlaying, state.playheadPosition, state.duration, dispatch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const activeClips = state.clips.filter(
      c => c.type !== 'audio' && state.playheadPosition >= c.startAt && state.playheadPosition <= c.startAt + c.duration
    );

    activeClips.forEach(clip => {
      if (clip.type === 'video') {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);
        
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.font = '24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`Playing: ${clip.name}`, width/2, height/2);
      }
      
      if (clip.type === 'text') {
        const textClip = clip as TextClip;
        const clipLocalTime = state.playheadPosition - textClip.startAt;
        
        let opacity = 1;
        let scale = 1;

        if (textClip.animationType === 'fade_scale') {
          if (clipLocalTime < 0.5) {
            const progress = clipLocalTime / 0.5;
            opacity = progress;
            scale = 0.8 + (progress * 0.2);
          }
          else if (clipLocalTime > textClip.duration - 0.5) {
            const timeOut = clipLocalTime - (textClip.duration - 0.5);
            const progress = 1 - (timeOut / 0.5);
            opacity = Math.max(0, progress);
            scale = 1.0 + ((1 - progress) * 0.1);
          }
        }

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(textClip.position.x, textClip.position.y);
        ctx.scale(scale, scale);
        
        ctx.font = `800 ${textClip.fontSize}px ${textClip.fontFamily}`;
        ctx.fillStyle = textClip.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        
        ctx.fillText(textClip.content, 0, 0);
        ctx.restore();
      }

      // KINETIC TYPOGRAPHY ENGINE (Word-by-Word)
      if (clip.type === 'subtitle') {
        const subClip = clip as SubtitleClip;
        const clipLocalTime = state.playheadPosition - subClip.startAt;

        ctx.save();
        ctx.translate(subClip.position.x, subClip.position.y);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Shadow for all subtitles
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        let totalWidth = 0;
        const wordMetrics: any[] = [];
        
        // Preset: Podcast (Yellow highlight on active word, white for others)
        // Preset: Kinetic (Words bounce in, non-active words disappear)

        // Pre-calculate total width for centering if we render line-by-line
        ctx.font = `800 ${subClip.fontSize}px ${subClip.fontFamily}`;
        
        subClip.words.forEach((w) => {
          const metrics = ctx.measureText(w.word + ' ');
          wordMetrics.push({ word: w.word, width: metrics.width, start: w.start, end: w.end, emphasized: w.isEmphasized });
          totalWidth += metrics.width;
        });

        let currentX = -totalWidth / 2; // Start from left to keep centered

        wordMetrics.forEach((w) => {
          const isActive = clipLocalTime >= w.start && clipLocalTime <= w.end;
          const hasPassed = clipLocalTime > w.end;
          const isFuture = clipLocalTime < w.start;

          ctx.save();
          
          if (subClip.preset === 'podcast') {
             if (isActive) {
               ctx.fillStyle = '#f59e0b';
               const activeTime = clipLocalTime - w.start;
               if(activeTime < 0.1) {
                  const scale = 1.0 + Math.sin((activeTime / 0.1) * Math.PI) * 0.15;
                  ctx.translate(currentX + w.width/2, 0);
                  ctx.scale(scale, scale);
                  ctx.translate(-(currentX + w.width/2), 0);
               }
             } else {
               ctx.fillStyle = isFuture ? 'rgba(255,255,255,0.4)' : '#ffffff';
             }
             ctx.fillText(w.word, currentX + w.width/2, 0);
          } 
          else if (subClip.preset === 'kinetic') {
             // Only show active or just passed word, highly dynamic
             if (isActive || (hasPassed && clipLocalTime < w.end + 0.2)) {
               ctx.fillStyle = w.emphasized ? '#ef4444' : '#ffffff'; // red if emphasized
               
               let scale = 1;
               let yOffset = 0;
               
               if (isActive) {
                  // Bounce in
                  const activeTime = clipLocalTime - w.start;
                  if (activeTime < 0.15) {
                    scale = 0.5 + (activeTime / 0.15) * 0.6; // overshoots to 1.1
                    yOffset = 20 - (activeTime / 0.15) * 20; // flies in from bottom
                  } else {
                    scale = 1.0;
                    yOffset = 0;
                  }
               } else if (hasPassed) {
                  // Fade out quickly
                  ctx.globalAlpha = Math.max(0, 1 - ((clipLocalTime - w.end) / 0.2));
               }

               ctx.translate(0, yOffset);
               ctx.translate(currentX + w.width/2, 0);
               ctx.scale(scale, scale);
               ctx.translate(-(currentX + w.width/2), 0);
               
               ctx.fillText(w.word, currentX + w.width/2, 0);
             }
          }

          ctx.restore();
          currentX += w.width;
        });
        
        ctx.restore();
      }
    });

  }, [state.playheadPosition, state.clips, width, height]);

  return (
    <section className="player-section">
      <div className="player-container">
        
        <div className="video-placeholder" style={{ position: 'relative', padding: 0, overflow: 'hidden' }}>
          <canvas 
            ref={canvasRef} 
            width={width} 
            height={height} 
            style={{ 
              width: '100%', 
              height: '100%',
              display: 'block',
              backgroundColor: '#000'
            }} 
          />
        </div>

        <div className="player-controls">
          <button className="btn btn-icon" onClick={() => dispatch({ type: 'TOGGLE_PLAYBACK' })}>
            {state.isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
        </div>

      </div>
    </section>
  );
}
