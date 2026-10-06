# FOCO Editor

Editor de vídeo não-linear com IA como copiloto: a IA entende o conteúdo, propõe e aplica a edição, e o
usuário mantém controle total da timeline.

**Status: Fases 1 (editor real), 2 (inteligência) e 3 (edição automática) concluídas.** Nada na interface é
simulado: importação, preview, timeline, salvar, exportar, transcrição, cortes, legendas, AI Editor (chat),
cor, áudio, smart zoom, keyframes e gráficos animados funcionam de verdade.

## Como rodar

Requer **Chrome ou Edge** (WebCodecs + File System Access API).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes unitários das operações de timeline
npm run test:e2e   # teste ponta a ponta no Edge instalado (E2E_BROWSER=chrome para o Chrome)
npm run test:e2e:ai  # Fase 2 com fala real (voz pt-BR do Windows) e Whisper local; E2E_HEADED=1 usa a GPU
npm run test:e2e:fx  # Fase 3 sem LLM: cor, áudio, gráficos, keyframes, comparação, export
npm run test:e2e:chat  # AI Editor com LLM real (Ollama local; ANTHROPIC_API_KEY testa também o Claude)
npm run build
```

> O projeto está dentro do Google Drive, e o `npm install` nessa pasta falha de forma intermitente (EBADF).
> Se acontecer, instale numa pasta local e espelhe com `robocopy <local>\node_modules node_modules /MIR`,
> ou mova o repositório para fora do Drive (recomendado, com Git para versionar).

## O que a Fase 1 entrega

| Área | Como funciona |
|---|---|
| Importação | Botão, Ctrl+I ou arrastar arquivos. Metadados reais do container (duração, fps, resolução, codecs) via Mediabunny. Aviso quando o codec não é decodificável. |
| Media bin | Thumbnail decodificado do próprio vídeo, waveform calculado em streaming (com cache no IndexedDB). |
| Preview | Canvas composto a partir da timeline real: cada clipe tem seu `<video>`/`<audio>` pré-posicionado antes do corte; o relógio segura enquanto a mídia carrega. Opacidade, escala, posição e rotação aparecem no preview. |
| Timeline | Trilhas de vídeo/áudio, arrastar da mídia, mover entre trilhas, aparar pelas alças, dividir, apagar, ripple delete, copiar/colar/recortar/duplicar, seleção por retângulo, snapping, zoom ancorado no cursor, mute/ocultar/travar trilhas. Sobreposição em modo *overwrite*. |
| Undo/redo | Histórico de 300 passos; arrastar ou mexer num slider vira um passo só. |
| Projeto | Arquivo `.foco` (JSON) com Salvar/Salvar como/Abrir/Recentes, autosave no navegador, reconexão de mídia após recarregar (permissão ou "Localizar arquivos"). |
| Export | MP4 H.264 (ou H.265 se a GPU/navegador suportar) + AAC 48 kHz. Presets YouTube 1080p/4K, Shorts/Reels/TikTok, Feed 4:5 e 1:1. Grava em streaming direto no disco, com progresso real e cancelamento. O mesmo compositor do preview gera os quadros. |

## O que a Fase 2 entrega (aba **IA** no painel direito)

| Área | Como funciona |
|---|---|
| Transcrição | Whisper rodando **no próprio computador** (transformers.js + WebGPU, com fallback em CPU/WebAssembly) num Web Worker. Timestamps por palavra. O áudio nunca é enviado; só o modelo é baixado uma vez (base ~206 MB, small ~586 MB, large-v3 turbo ~760 MB). O áudio é cortado em pedaços de até 30 s no ponto mais silencioso, e trechos sem fala são pulados (evita texto inventado). Palavras clicáveis (vão para o ponto na timeline) e corrigíveis com duplo clique. Fica salva no projeto e em cache. |
| Silêncio | Nível RMS do áudio a cada 10 ms (junto com o waveform), limiar adaptativo entre o ruído de fundo e a fala. |
| Cortes automáticos | Níveis **Seguro / Equilibrado / Agressivo**. Detecta pausas (áudio), vícios ("ééé", "hum", "ahn"), gagueira ("eu eu"), frases repetidas/começo falso ("hoje eu quero, hoje eu quero…") e hesitações (som sem fala reconhecida). Cada sugestão aparece na lista e marcada na timeline; o usuário escolhe quais aplicar. Aplicar = um único passo de undo, com ripple em todas as trilhas destravadas (vídeo, áudio e legendas continuam sincronizados) e resumo do que foi feito. |
| Legendas | Presets Minimal, Podcast, Bold, Kinetic, Cinema, Social, YouTube e Shorts. Bloco inteiro, destaque da palavra falada ou uma palavra por vez, com pop, contorno, sombra e fundo. Cada bloco é um clipe editável (texto, estilo, posição). Renderizadas pelo mesmo compositor no preview e no export. Exportação .srt. |

## O que a Fase 3 entrega

| Área | Como funciona |
|---|---|
| AI Editor (chat) | Aba **IA**. Pedido em português → LLM → comandos num schema fixo → **validador** → executor → timeline. A IA nunca mexe no estado diretamente. Dois "cérebros": **local** (Ollama, padrão `qwen3:4b`, nada sai do computador) ou **Claude** (API, chave do usuário; só texto do pedido e da transcrição é enviado, com aviso e consentimento). Cada pedido vira um único passo de undo, com a lista do que foi feito e comandos inválidos descartados. |
| Original vs IA | Depois de uma edição da IA, uma barra no preview alterna **ORIGINAL / EDIÇÃO DA IA**, com **Aceitar** e **Desfazer**. |
| Cor | Shader WebGL2 não destrutivo: exposição, contraste, altas luzes, sombras, temperatura, tint, saturação, vibrance, vinheta. Presets Clean, Cinematic, Warm, Cool, Film, YouTube, Commercial, Social Media. **Cor automática** analisa quadros reais (exposição, balanço de branco pelo "mundo cinza", contraste). "Segurar: original" compara. |
| Áudio | Cadeia Web Audio por clipe — corte de graves, EQ de 3 bandas, redução de ruído (gate/expansor), compressor, normalização pelo nível medido da fala e limitador. Presets Voz, Podcast, YouTube, Cinematic, Social. A mesma cadeia toca no preview e é renderizada no export. |
| Keyframes | Escala, posição, rotação e opacidade com curvas (suave, linear, acelera, desacelera, segura). Ficam presos ao conteúdo (tempo da mídia), então sobrevivem a cortes. Editáveis no Inspector, visíveis como ◆ nos clipes. |
| Smart zoom | Escolhe as frases de destaque (ênfase na voz, palavras fortes, exclamações) e cria zooms 100% → 106–120% → 100% com keyframes reais. |
| Motion graphics | Motor próprio (sem After Effects): Título, Lower third, Destaque e CTA com animação de entrada/saída, editáveis (texto, cores, posição, keyframes). Menu **Gráfico** na timeline ou pelo chat. |

### Atalhos

Espaço play/pause · S dividir · Delete apagar · Shift+Delete ripple · Ctrl+Z / Ctrl+Shift+Z · Ctrl+C/X/V ·
Ctrl+D duplicar · Ctrl+A selecionar tudo · ←/→ quadro (Shift = 1 s) · Home/End · N snapping · +/− zoom ·
Ctrl+S salvar · Ctrl+Shift+S salvar como · Ctrl+O abrir · Ctrl+E exportar · Esc cancela o arraste.

## Arquitetura

```
src/
  core/              tipos do projeto (serializáveis) e utilitários de tempo
  engine/
    timeline/        operações puras (split, trim, move, overwrite, ripple...) + EditorStore (histórico)
    media/           MediaEngine: probe, thumbnails, waveform + nível RMS, relink
    transcript/      TranscriptEngine + worker do Whisper (local)
    analysis/        detecção de silêncio e sugestões de corte (funções puras, testadas)
    captions/        legendas: presets, segmentação, renderização, SRT
    ai/              linguagem de comandos + validador, provedores (Claude / Ollama)
    color/           presets, cor automática, processador WebGL2
    audio/           cadeia de processamento (preview e export)
    motion/          gráficos animados (títulos) e inserção
    playback/        PlaybackEngine: relógio, pool de elementos de mídia, preview
    render/          Compositor compartilhado entre preview e export
    export/          ExportEngine: decodifica (WebCodecs) → compõe → codifica → MP4
    project/         arquivo .foco, autosave, recentes
    platform/        IndexedDB e File System Access (trocável por Electron/Node)
  app/               composição dos engines + comandos do editor
  ui/                React: MediaBin, Viewer, Inspector, Timeline, ExportDialog
  dev/               ganchos usados só pelo teste e2e
```

Os engines não dependem do React. A IA (Fase 2+) vai emitir comandos validados que chamam as mesmas
operações de `engine/timeline/operations.ts`; ela nunca altera o estado diretamente.

`_prototipo_antigo/` guarda o protótipo anterior (respostas simuladas), fora do build, só como referência.

## Núcleo do editor (Fase 1 da especificação de 13 fases)

- **Edit Command Engine:** toda alteração é um comando nomeado e serializável (`ADD_CLIP`, `SPLIT_CLIP`, `MOVE_CLIPS`,
  `TRIM_CLIP`, `DELETE_CLIP`, `SET_TRANSFORM`, `SET_VOLUME`, `SET_SPEED`, `SET_CROP`, `IMPORT_ASSETS`… ~40 tipos).
  O **History Engine** guarda comando + patch reversível (só o que mudou); undo/redo aplicam o patch. A IA emite os
  mesmos comandos (registrados como `AI_EDIT`) e nunca toca no estado.
- **Modelo do projeto (formato 2, com migração do 1):** assets com metadados e pastas, trilhas, clipes que só
  *referenciam* o arquivo (entrada/velocidade/duração), transformações (posição, escala, escala X/Y, rotação,
  opacidade, âncora), crop, velocidade, fades, mudo, blend, markers, metadados. Preparado para legendas com palavras
  (tempo e confiança), keyframes/camadas de motion e fontes (sistema/importadas/biblioteca).
- **Media Bin:** importar (vídeo, áudio, imagem, SVG, fontes), remover, renomear (F2), pastas (arrastar para mover),
  busca, ordenação, grade/lista, seleção múltipla, thumbnails e filmstrip com cache, waveform com cache.
- **Timeline:** Seleção (V) e Razor (C), split (S), trim, mover entre trilhas, snapping, delete/ripple, seleção por
  região/trilha/tudo, markers (M, Shift+M, Alt+M), zoom de horas a quadros (1%–1600%), timecode HH:MM:SS:FF ↔ .mmm.
- **Player:** toca a sequência real (cortes, ordem, velocidade com tom preservado, volume, fades, transformações,
  crop) com J/K/L (incluindo ré). Arrastar mídia para o preview insere no playhead.
- **Render:** o mesmo compositor do preview; MP4 H.264/H.265 + AAC; velocidade no áudio por WSOLA; progresso real,
  cancelamento e "Tentar de novo".
- **Atalhos** num keymap (`foco.keymap` no navegador permite trocar combinações).

Teste do roteiro manual da especificação (20 passos, incluindo tocar o MP4 exportado): `npm run test:e2e:phase1`.

## Fase 2 — Media Engine, performance, cache e proxy

- **Media Engine:** importação vira uma sequência de jobs — validação → hash do conteúdo → duplicata → metadados → thumbnails → thumbnails de scrubbing → waveform → cache. A mídia aparece no bin como "Analisando" e depois "Pronto"; erros mostram o motivo real com "Tentar de novo".
- **Metadados:** duração, resolução, fps medido, codecs (inclusive codec string), bitrate, canais, sample rate, rotação, HDR, espaço de cor, timebase.
- **Formatos:** MP4, MOV, WebM, MKV; MP3, WAV, AAC, M4A, FLAC, OGG/Opus; PNG, JPG, WebP, GIF; SVG; TTF/OTF/WOFF. AVI e formatos de câmera RAW são recusados com mensagem explicando a conversão.
- **Job Queue:** status (na fila / processando / concluído / falhou / cancelado), progresso, prioridade (alta: análise e export; média: o que está na timeline; baixa: o resto), limite por tipo, cancelar e tentar de novo. Painel **Tarefas** no topo.
- **Cache Engine:** OPFS (disco privado do navegador) + índice com id, tamanho, datas, versão e dependência do asset. Limite configurável com remoção do menos usado, "Limpar não usado", "Limpar tudo", invalidação quando o arquivo muda. Proxies em uso nunca são removidos automaticamente.
- **Proxy:** 720p/1080p H.264 com keyframes a cada 0,5 s, gerado por transcodificação real (aceleração por hardware) direto para o disco. Sugestão automática para arquivos pesados conforme o modo de performance; criar/cancelar/apagar no bin; **Proxy ON/OFF** no preview. O export sempre usa o original.
- **Preview:** qualidade Auto/Full/½/¼/⅛; scrub em meia resolução com thumbnails reais do instante enquanto o quadro definitivo decodifica.
- **Timeline:** só os clipes visíveis são desenhados (índice por trilha + busca binária), waveform em pirâmide de resoluções, cada clipe observa só a própria mídia.
- **Hash, duplicatas, offline, relink:** identidade por SHA-256 parcial (início/meio/fim + tamanho); reimportar o mesmo conteúdo pergunta "Usar o existente / Importar mesmo assim / Cancelar"; arquivo apagado → Offline + "Localizar mídia"; relink acha o arquivo pelo conteúdo mesmo renomeado; arquivo alterado fora do editor é detectado ao voltar para a janela e só atualiza com "Recarregar".
- **Autosave e recuperação:** intervalo configurável; ao reabrir depois de fechar sem salvar, "Versão de recuperação disponível — Restaurar / Descartar". **Histórico de versões** (backup a cada salvamento e a cada 10 min) com restaurar.
- **Armazenamento separado:** projeto (.foco onde você escolher + autosave/backups no navegador), mídia (seus arquivos, nunca copiados), cache (OPFS), exports (onde você escolher).
- **Configurações:** modo de performance (Automático por hardware detectado / Alta qualidade / Equilibrado / Performance), qualidade de preview, proxies, autosave, cache e monitor de armazenamento. **Performance Panel** (Ctrl+Shift+P): FPS do preview, quadros perdidos, travadas, memória, tempos de cada processamento.
- **Export como job:** continua em segundo plano, pode ser cancelado no painel de tarefas e vários exports entram em fila.

**Web vs. desktop:** tudo roda no navegador, localmente (WebCodecs com GPU, OPFS, File System Access). Nada é enviado a servidor. Limites do navegador: não há acesso a caminhos de arquivo nem observação contínua de pastas (a checagem acontece ao voltar o foco para a janela) e CPU/GPU por processo não são expostos (medidos de fora nos testes de carga).

Testes: `npm run test:e2e:phase2` (fluxo completo da fase) e `node scripts/load.mjs t1,...,t7` (carga; resultados em `scripts/load-results/`).

## Roadmap (13 fases)

1. **Núcleo do editor** ✅
2. **Mídia, cache, proxy e performance** ✅
3. Texto, fontes e legendas — *parcial:* textos animados, fontes do sistema/importadas, legendas palavra a palavra com 8 estilos. Falta a biblioteca de fontes.
4. Banco de legendas, personalização e animações.
5. Motion Graphics Engine — *parcial:* keyframes e 4 templates de título. Falta formas, máscaras, partículas e grupos.
6. Transições e efeitos.
7. Cor e LUTs — *parcial:* correção de cor por shader, presets e cor automática. Falta LUT .cube.
8. Áudio e voice enhancement — *parcial:* cadeia de voz, gate, compressor e normalização.
9. AI Editing — *parcial:* chat (Ollama/Claude), cortes de pausas e erros, smart zoom.
10. Long → Shorts.
11. Templates e Brand Kit.
12. Lote e automações.
13. Refinamento final.
