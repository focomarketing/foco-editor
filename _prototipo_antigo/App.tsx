import { useState } from 'react';
import './App.css';
import { Undo, Redo, Download, Upload } from 'lucide-react';
import { Timeline } from './components/Timeline';
import { Player } from './components/Player';
import { AIEditorPanel } from './components/AIEditorPanel';

function App() {
  const [showAIPanel, setShowAIPanel] = useState(true);

  return (
    <div className="editor-container">
      {/* HEADER */}
      <header className="editor-header">
        <div className="logo">FOCO AI EDITOR</div>
        <div className="header-actions">
          <button className="btn btn-secondary">
            <Undo size={16} /> Undo
          </button>
          <button className="btn btn-secondary">
            <Redo size={16} /> Redo
          </button>
          <button className="btn btn-primary">
            <Download size={16} /> Export
          </button>
          <button className="btn btn-ai" onClick={() => setShowAIPanel(!showAIPanel)}>
            ✨ AI EDITOR
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <main className="editor-workspace" style={{ display: 'flex', flexDirection: 'row' }}>
        {/* MEDIA BIN */}
        <aside className="media-bin">
          <div className="panel-header">
            <h3>Media Bin</h3>
            <button className="btn btn-icon"><Upload size={16} /></button>
          </div>
          <div className="media-grid">
            <div className="media-item import-placeholder">
              <span>+ Import Media</span>
            </div>
            {/* Dummy media items */}
            <div className="media-item video" draggable onDragStart={(e) => {
               e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'video', name: 'TAKE_01.mp4' }));
            }}>
              <div className="thumbnail"></div>
              <span>TAKE_01.mp4</span>
            </div>
          </div>
        </aside>

        {/* PLAYER */}
        <Player />

        {/* AI PANEL */}
        {showAIPanel && <AIEditorPanel />}
      </main>

      {/* TIMELINE */}
      <Timeline />
    </div>
  );
}

export default App;
