# Auditoria da arquitetura: FOCO Editor × skills de IA

Data: 07/10/2026 · commit de partida `b21a018` · repositório: `G:\Meu Drive\FOCO MARKETING\FOCO EDITOR`

> **Escopo.** O pedido original citava `D:\FocoLabs\Mobilabs` e comandos `@mobisocial/*`. Esses
> comandos são do **mobilabs-social** (agendador de posts, Express + Next, sem editor de vídeo). O editor
> descrito (fluxo Corte → … → Editor, tela de projetos com 4 cards) é o **FOCO Editor**. Por decisão do
> usuário, a arquitetura de skills é implantada **no FOCO Editor**, adaptando a estrutura sugerida
> (`apps/api/src/modules/video-editor/...`) a módulos no próprio app, porque ele não tem backend.

## 1. Estado inicial (registrado antes de qualquer mudança)

| Comando | Resultado |
|---|---|
| `npm run build` (`tsc -b && vite build`) | ✅ sem erros (≈ 7 min: o projeto está no Google Drive, I/O lento) |
| `npm run lint` (`oxlint`) | ✅ 0 erros, 4 avisos (3 em scripts/protótipo antigo, 1 em `ui/Sidebar.tsx` deps do hook) |
| `npm test` (`vitest run`) | ✅ 9 arquivos, 81 testes |
| e2e (`scripts/e2e*.mjs`, Playwright + Edge) | ✅ `e2e`, `e2e-phase2`, `e2e-cut`, `e2e-flow`, `e2e-phases` (o `e2e-fx` depende da porta 5195 livre) |

## 2. Frontend

- **Stack:** Vite 8 + React 19 + TypeScript 6, sem framework de estado (stores próprias com `useSyncExternalStore`).
  Roda **todo no navegador** (Chrome/Edge): WebCodecs (decodificar/exportar), WebGPU/WebGL2 (cor),
  Web Audio (áudio), File System Access (arquivos), IndexedDB/OPFS (persistência e cache).
- **Camadas** (`src/`):
  - `core/` tipos serializáveis (`types.ts`), tempo, animação, `workflow.ts` (trilhas e fases).
  - `engine/` motores sem React: `timeline/` (operações puras + `EditorStore`), `commands/` (comandos
    nomeados + patch reversível), `media/`, `transcript/` (Whisper local em worker), `analysis/` (silêncio,
    cortes, zoom), `cut/` (smart cut pela onda), `images/` (B-roll: acervos e montagem), `captions/`,
    `motion/` (títulos), `color/`, `audio/`, `ai/` (comandos da IA, validador, provedores), `playback/`,
    `render/` (compositor), `export/`, `project/`, `platform/` (IndexedDB, File System Access), `jobs/`, `cache/`.
  - `app/` composição dos motores e ações (`editor.ts`), IA (`aiEditor.ts`), fluxo (`workflow.ts`,
    `phases.ts`, `smartCut.ts`, `view.ts`).
  - `ui/` componentes React: `App`, `ProjectsHome`, `NewProject`, `PhaseBar`, `Sidebar` (+ painéis de fase),
    `MediaBin`, `Viewer`, `Inspector`, `Timeline`, `AIPanel`/`AIChat`, `CutPanel`, `PhaseRun`, `ExportDialog`.
- **Telas:** `view.ts` alterna Projetos (início) → Novo projeto → Projeto. No projeto: barra de fases no topo
  quando há fluxo; lateral com o painel da fase (ou as ferramentas, na fase Editor).

## 3. Backend

**Não existe.** Não há servidor, endpoints, banco remoto nem filas de servidor. Tudo é local no navegador.
Consequência: o "orquestrador" e as "skills" do pedido são módulos TypeScript no próprio app; chamadas a
serviços externos (Anthropic, Ollama local, Wikimedia, Pexels, Pixabay) são feitas do navegador.

## 4. Projeto, timeline, tracks e clips (`core/types.ts`)

- `Project { id, name, settings{width,height,fps}, assets, tracks[], clips{}, folders, markers, metadata }`.
  `metadata.workflow` guarda trilha, tipo, fases e fase atual.
- `Track { id, kind: 'video'|'audio', name, muted, hidden, locked }`. Vídeos novos entram no topo.
- `Clip { id, assetId, trackId, start, duration, sourceIn, volume, muted, speed, fadeIn, fadeOut, transform,
  crop, blendMode, caption?, title?, keyframes?, color?, audio? }`. Legendas e títulos são clipes sem mídia.
- Timeline em modo *overwrite* (no máximo um clipe por trilha em cada instante), ripple por faixas.

## 5. Comandos, histórico e undo/redo

- `engine/commands/commands.ts`: ~37 comandos nomeados e serializáveis (`ADD_CLIP`, `SPLIT_CLIP`, `TRIM_CLIP`,
  `MOVE_CLIPS`, `DELETE_CLIPS`, `RIPPLE_REMOVE_RANGES`, `SET_TRANSFORM`, `SET_KEYFRAMES`, `SET_COLOR`,
  `SET_AUDIO_FX`, `SET_FADE`, `SET_VOLUME`, `GENERATE_CAPTIONS`, `ADD_TITLE`, `ADD_TRACK`, `UPDATE_TRACK`,
  `IMPORT_ASSETS`, `UPDATE_ASSET`, `SET_SEQUENCE`, …) e `Cmd.batch(label, commands, type)` (um passo de undo).
- `EditorStore.execute(cmd)`: aplica, calcula um **patch reversível** (só o que mudou) e empilha; `undo/redo`
  aplicam o patch (300 passos). `setMeta` grava metadados fora do histórico (fase atual).
- **Mapeamento para o pedido:** o `EditCommand` do pedido (`add_clip`, `trim_clip`…) corresponde aos comandos
  existentes; a `EditOperation` corresponde a um `Cmd.batch`. Decisão: **adaptar, não duplicar** — o contrato
  do pedido vira uma camada de *sugestões* que se converte nos comandos existentes ao aplicar.

## 6. Mídia, upload e armazenamento

- **Importação** (`MediaEngine`): seletor nativo (com handle para reabrir), arrastar e soltar, ou `File`.
  Jobs: validação → hash → metadados → thumbnails → waveform/níveis RMS → proxy. Arquivos nunca são copiados.
- **Persistência:** IndexedDB `foco-editor` v5 (`kv` autosave, `mediaHandles`, `waveforms`, `transcripts`,
  `thumbs`, `cacheIndex`, `backups`, `recents`, `projects` = catálogo da tela inicial), OPFS para cache/proxy,
  arquivo `.foco` (JSON com transcrições) onde o usuário escolher.
- **Filas:** `JobQueue` (prioridades, cancelar, tentar de novo) para mídia e export; `phases.ts` executa uma
  fase por vez.

## 7. Recursos de edição existentes

| Recurso | Onde | Situação |
|---|---|---|
| Imagens / B-roll | clipes de imagem; `engine/images` (fase Imagens) | ✅ acervos + montagem com Ken Burns e dissolve |
| Overlays / gráficos | `motion/titles` (título, lower third, destaque, CTA) | ✅ templates editáveis |
| Efeitos | cor por shader, keyframes (escala, posição, rotação, opacidade), smart zoom, blend, crop | ✅ |
| Transições | — | ❌ não existe (dissolve só por keyframes de opacidade) |
| Música | clipes de áudio em trilhas de áudio, volume, fades, cadeia de voz | ⚠️ sem ducking nem seleção |
| Efeitos sonoros | — | ❌ sem biblioteca |
| Mute / solo | mute por trilha e clipe | ⚠️ sem solo |
| Legendas | `captions/` 8 presets, palavra a palavra, SRT, editáveis no Inspector | ✅ |
| Bloqueio | `Track.locked` | ⚠️ sem bloqueio por clipe |

## 8. Integração com IA

- `app/aiEditor.ts` + `engine/ai/`: chat → LLM (Claude via `@anthropic-ai/sdk` no navegador, ou Ollama
  local) → JSON num schema fixo → **validador** → executor → um `Cmd.batch` `AI_EDIT`. Barra ORIGINAL × IA.
- `askJson` (genérico) para as fases automáticas. Transcrição Whisper local (WebGPU/CPU).
- Fases automáticas (`phases.ts`): Corte e Imagens, com progresso, desfazer e refazer.

## 9. Lacunas frente ao pedido (o que será construído)

1. Presets de projeto no formato pedido (`ProjectTemplate`/`ProjectPreset`) e modos `audio-led`,
   `script-led`, `manual-assisted` — hoje há trilhas sem modo.
2. Contrato `EditCommand`/`EditOperation` com origem, skill, confiança e motivo; estado `preview/applied/reverted`.
3. Orquestrador com registro de skills por etapa, logs e regeneração de uma etapa só.
4. Aprovação item a item (aplicar tudo/selecionados, rejeitar) e baixa confiança nunca aplicada sozinha.
5. Proteção do manual: marca de origem por clipe (`createdBy`), bloqueio por clipe, regenerar só itens da IA.
6. `MediaManifest` (índice semântico das mídias) e montagem audio-led com takes de apoio.
7. Modo script-led (roteiro → blocos → mídias).
8. Asset Hub com `AssetLicense`.
9. Transições, música/efeitos sonoros com ducking e solo (etapas 3 e 5).

## 10. Decisões de adaptação

- Estrutura `apps/api/src/modules/video-editor/*` → **`src/video-editor/*`** (orchestrator, commands, skills,
  media-analysis, assets, validation, history), no navegador.
- Nada do editor atual é reescrito: o orquestrador **produz sugestões** e, ao aplicar, usa os comandos
  existentes via `Cmd.batch` (um passo de undo por operação).
- Validação de cada fase: `tsc -b`, `vitest`, `oxlint` e os e2e do próprio FOCO (não há `doctor`).
