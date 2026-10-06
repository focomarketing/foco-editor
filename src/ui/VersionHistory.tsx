import { useEffect, useState } from 'react';
import { projectFile, restoreVersion, store } from '../app/editor';
import type { BackupRecord } from '../engine/project/ProjectEngine';

const REASON: Record<BackupRecord['reason'], string> = { manual: 'Salvamento', auto: 'Backup automático', 'before-restore': 'Antes de restaurar/descartar' };

export function VersionHistory({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<BackupRecord[] | null>(null);
  const projectId = store.getState().project.id;
  const load = () => void projectFile.backups(projectId).then(setList);
  useEffect(load, [projectId]);

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide-dialog" role="dialog" aria-label="Histórico de versões">
        <div className="dialog-head">Histórico de versões</div>
        <div className="dialog-body">
          {list === null && <span className="muted">Lendo…</span>}
          {list?.length === 0 && <span className="muted">Ainda não há versões deste projeto. Elas são criadas ao salvar e a cada 10 min de edição.</span>}
          <div className="versions">
            {list?.map((b) => (
              <div key={b.id} className="version-row" data-testid="version-row">
                <div>
                  <b>{new Date(b.savedAt).toLocaleString('pt-BR')}</b>
                  <div className="muted">{REASON[b.reason]} · {b.clipCount} clipe(s) · “{b.projectName}”</div>
                </div>
                <button
                  className="btn sm outline"
                  onClick={async () => {
                    if (!confirm('Restaurar esta versão? A versão atual será guardada no histórico antes.')) return;
                    await restoreVersion(b.id);
                    onClose();
                  }}
                >
                  Restaurar
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="dialog-foot">
          <button
            className="btn outline"
            onClick={async () => {
              await projectFile.backup(store.getState().project, 'manual');
              load();
            }}
          >
            Criar backup agora
          </button>
          <button className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
