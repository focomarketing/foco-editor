import { useEffect, useState, useSyncExternalStore } from 'react';
import { formatBytes } from '../core/time';
import { prefsStore } from '../app/prefs';
import type { AutoProxy, PerformanceMode, PreviewQuality } from '../app/prefs';
import { media, store } from '../app/editor';
import { notify } from '../app/notify';
import { cache, CACHE_LABEL, requestPersistentStorage, storageEstimate } from '../engine/cache/CacheEngine';
import type { CacheKind } from '../engine/cache/CacheEngine';
import { detectHardware } from '../engine/diagnostics/hardware';
import type { HardwareInfo } from '../engine/diagnostics/hardware';
import { idb, safe } from '../engine/platform/idb';
import { usePrefs } from './hooks';

const SIZES = [2, 5, 10, 20, 50, 100].map((g) => g * 1024 ** 3);

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const prefs = usePrefs();
  useSyncExternalStore(cache.subscribe, cache.getVersion);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof cache.usage>> | null>(null);
  const [est, setEst] = useState<Awaited<ReturnType<typeof storageEstimate>> | null>(null);
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [projectsBytes, setProjectsBytes] = useState<number | null>(null);

  const refresh = () => {
    void cache.usage().then(setUsage);
    void storageEstimate().then(setEst);
    void (async () => {
      const backups = (await safe(idb.all<{ project: unknown }>('backups'))) ?? [];
      const auto = await safe(idb.get('kv', 'autosave'));
      setProjectsBytes(new Blob([JSON.stringify(backups), JSON.stringify(auto ?? '')]).size);
    })();
  };
  useEffect(() => {
    refresh();
    void detectHardware().then(setHw);
  }, []);

  const set = prefsStore.set;
  const modeLabel = { quality: 'Alta qualidade', balanced: 'Equilibrado', performance: 'Performance' };

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide-dialog" role="dialog" aria-label="Configurações">
        <div className="dialog-head">Configurações</div>
        <div className="dialog-body settings">
          <section>
            <h4>Performance</h4>
            <div className="field">
              <label>Modo</label>
              <select value={prefs.performanceMode} onChange={(e) => set({ performanceMode: e.target.value as PerformanceMode })}>
                <option value="auto">Automático ({modeLabel[prefs.resolvedMode]})</option>
                <option value="quality">Alta qualidade</option>
                <option value="balanced">Equilibrado</option>
                <option value="performance">Performance</option>
              </select>
            </div>
            <p className="note">
              Performance: proxy sugerido para qualquer vídeo acima de 1080p30, preview em meia resolução. Equilibrado: proxy para 1440p+, 60 fps ou
              bitrate alto. Alta qualidade: proxy só para 4K60 / bitrate muito alto.
            </p>
            {hw && (
              <p className="note">
                Detectado: {hw.cores} núcleos{hw.memoryGB ? ` · ~${hw.memoryGB} GB+ RAM` : ''} · {hw.gpu ?? 'GPU desconhecida'} · encoder H.264 por hardware:{' '}
                {hw.hwEncodeH264 ? 'sim' : 'não'} · H.265: {hw.hwEncodeHEVC ? 'sim' : 'não'} · decodificação 4K por hardware: {hw.hwDecode4K ? 'sim' : 'não'}.
              </p>
            )}
          </section>

          <section>
            <h4>Preview e proxies</h4>
            <div className="field">
              <label>Qualidade do preview</label>
              <select value={prefs.previewQuality} onChange={(e) => set({ previewQuality: e.target.value as PreviewQuality })}>
                <option value="auto">Automática (tamanho da tela)</option>
                <option value="full">Full</option>
                <option value="1/2">1/2</option>
                <option value="1/4">1/4</option>
                <option value="1/8">1/8</option>
              </select>
            </div>
            <label className="check">
              <input type="checkbox" checked={prefs.useProxies} onChange={(e) => set({ useProxies: e.target.checked })} /> Usar proxies no preview (o export sempre usa o
              original)
            </label>
            <div className="field">
              <label>Vídeos pesados</label>
              <select value={prefs.autoProxy} onChange={(e) => set({ autoProxy: e.target.value as AutoProxy })}>
                <option value="ask">Perguntar se quero criar proxy</option>
                <option value="always">Criar proxy automaticamente</option>
                <option value="never">Nunca criar sozinho</option>
              </select>
            </div>
          </section>

          <section>
            <h4>Autosave e recuperação</h4>
            <div className="field">
              <label>Autosave</label>
              <select value={prefs.autosaveInterval} onChange={(e) => set({ autosaveInterval: Number(e.target.value) })}>
                <option value={0}>Logo após cada edição</option>
                <option value={15}>A cada 15 s</option>
                <option value={30}>A cada 30 s</option>
                <option value={60}>A cada 1 min</option>
                <option value={300}>A cada 5 min</option>
              </select>
            </div>
            <p className="note">Se o navegador fechar sem salvar, o editor oferece a versão de recuperação ao abrir. Backups automáticos a cada 10 min de edição e a cada salvamento (Arquivo → Histórico de versões).</p>
          </section>

          <section>
            <h4>Armazenamento e cache</h4>
            <p className="note">
              Local do cache: armazenamento privado do navegador neste computador (OPFS). Mídias continuam nos seus arquivos originais; projetos (.foco) e exports
              ficam onde você escolher.
            </p>
            {usage && (
              <table className="storage-table">
                <tbody>
                  {(Object.keys(usage.byKind) as CacheKind[]).map((k) => (
                    <tr key={k}>
                      <td>{CACHE_LABEL[k]}</td>
                      <td>{usage.byKind[k].count}</td>
                      <td>{formatBytes(usage.byKind[k].bytes)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Cache total</td>
                    <td />
                    <td data-testid="cache-total">{formatBytes(usage.total)}</td>
                  </tr>
                  {projectsBytes !== null && (
                    <tr>
                      <td>Projetos (autosave + backups)</td>
                      <td />
                      <td>{formatBytes(projectsBytes)}</td>
                    </tr>
                  )}
                  {est && (
                    <tr>
                      <td>Disponível para o editor</td>
                      <td />
                      <td>{formatBytes(Math.max(0, est.quota - est.usage))}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            <div className="field">
              <label>Tamanho máximo</label>
              <select value={SIZES.includes(cache.maxBytes) ? cache.maxBytes : SIZES[2]} onChange={(e) => (cache.maxBytes = Number(e.target.value))}>
                {SIZES.map((b) => (
                  <option key={b} value={b}>{formatBytes(b)}</option>
                ))}
              </select>
            </div>
            <div className="row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                className="btn sm outline"
                onClick={async () => {
                  const keep = new Set([...media.activeHashes(), ...Object.values(store.getState().project.assets).map((a) => a.hash ?? '')]);
                  const freed = await cache.clearUnused(keep);
                  notify(`Cache não usado removido: ${formatBytes(freed)}.`, 'success');
                  refresh();
                }}
              >
                Limpar cache não usado
              </button>
              <button
                className="btn sm outline danger"
                onClick={async () => {
                  if (!confirm('Apagar todo o cache? Thumbnails, waveforms e proxies serão gerados de novo quando necessário (proxies em uso são mantidos).')) return;
                  const freed = await cache.clearAll();
                  notify(`Cache apagado: ${formatBytes(freed)}.`, 'success');
                  refresh();
                }}
              >
                Limpar todo o cache
              </button>
              {est && !est.persisted && (
                <button className="btn sm" onClick={async () => notify((await requestPersistentStorage()) ? 'O navegador não vai apagar o cache sozinho.' : 'O navegador recusou o armazenamento persistente.')}>
                  Proteger contra limpeza do navegador
                </button>
              )}
            </div>
          </section>
          <section>
            <label className="check">
              <input type="checkbox" checked={prefs.showPerformancePanel} onChange={(e) => set({ showPerformancePanel: e.target.checked })} /> Mostrar Performance Panel
              (Ctrl+Shift+P)
            </label>
          </section>
        </div>
        <div className="dialog-foot">
          <button className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
