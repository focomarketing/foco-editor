---
name: professional-transition-designer
description: Diretor de montagem de transições do FOCO Editor. Use para escolher, criar, ajustar ou revisar transições entre clipes (YouTube, Reels, TikTok, Shorts, comerciais, entrevistas). Prioriza corte seco e só usa transição com motivo editorial (movimento, ritmo, batida, mudança de cena, identidade visual), sempre com preset parametrizado, preview, confiança e motivo.
---

# professional-transition-designer

Regra central: **uma transição só existe quando melhora o ritmo, a continuidade ou a compreensão do vídeo.** Na dúvida, corte seco.

## Onde está no editor

| Parte | Arquivo |
|---|---|
| Biblioteca (53 modelos, fonte única) | `src/video-editor/transitions/library.ts` |
| Motor que desenha (preview e export) | `src/engine/render/transitions.ts` + `transitionDraw.ts` |
| Análise do corte (movimento, cor, batida, energia) | `src/video-editor/transitions/analysis.ts` |
| Diretor (matriz de decisão) | `src/video-editor/transitions/director.ts` |
| Skill (fase Transições) | `src/video-editor/skills/transitions.ts` |
| Ajuste manual (biblioteca + Inspector) | `src/ui/TransitionsPanel.tsx`, `src/app/transitions.ts` |
| Validação (duração, sobreposição, manual protegido) | `src/video-editor/validation/validate.ts` → `validateTransition` |

`presets/` é gerado da biblioteca: `node scripts/export-transitions.mjs`. Não edite os JSON à mão.

## Fluxo

1. **ANALISAR** cada corte (pares de clipes colados na mesma faixa): movimento de câmera dos dois lados (deslocamento global entre quadros), cor dominante, mudança visual, corte de salto (mesmo arquivo), pausa da fala antes do corte, corte dentro de palavra, palavras importantes perto, batida da música (±0,15 s), energia do áudio, legenda na tela.
2. **DECIDIR** pela matriz: tipo de conteúdo → ritmo → movimento → energia do áudio → plataforma → transição (ver `references/`).
3. **VALIDAR**: duração entre mínimo e máximo do preset, no máximo metade de cada clipe, sem invadir a transição do clipe anterior, nunca substituir transição escolhida pelo usuário.
4. **PREVIEW**: as sugestões entram como EditOperation em revisão; o player mostra antes de aplicar.
5. **APLICAR** (um passo de undo) só o que tem confiança ≥ 0,6; o resto fica para a pessoa marcar.

## Tipos de decisão

corte seco · corte por ação · match cut · por movimento · por objeto · por máscara · sincronizada com áudio · estilizada · nenhuma transição recomendada.

## Regras de qualidade (recusar ou reduzir)

- movimentos incompatíveis → sem whip;
- transição cobriria palavra importante → reduz intensidade (em depoimento: recusa);
- corte cai dentro de uma sílaba/palavra → recusa (o efeito chamaria atenção para o erro);
- transição recente demais (espaço mínimo por formato) ou limite de densidade do formato → corte seco;
- duas transições fortes seguidas → troca por uma discreta;
- a mudança visual já funciona no corte seco (planos parecidos = match cut);
- legenda na tela → reduz flash/luz/glitch;
- produto ou apresentador perderia clareza → preferir corte seco ou máscara limpa.

## Formatos

- **YouTube longo**: cortes secos; punch-in alternado nos cortes de salto; dissolve só em pausa com troca de ambiente; chapter transition em pausa longa. Máx. ~15% dos cortes, espaço ≥ 10 s.
- **Reels/TikTok/Shorts**: batida manda; beat zoom, whip, flash, impact, velocity; alterna forte e discreto. Máx. ~40% dos cortes, espaço ≥ 1,2 s.
- **Comercial**: limpo e de marca: light sweep, product reveal, máscaras, push; nada de glitch sem motivo. Máx. ~30%.
- **Entrevista/depoimento**: corte invisível, punch-in, dissolve limpo entre respostas; nada que distraia da fala. Máx. ~10%, espaço ≥ 15 s.

## Comando gerado

Ver `schemas/transition-command.json`. Exemplo:

```json
{
  "type": "add_transition",
  "transitionId": "beat-zoom",
  "clipBeforeId": "c-001",
  "clipAfterId": "c-002",
  "start": 12.3,
  "duration": 0.2,
  "intensity": 0.65,
  "createdBy": "ai",
  "skill": "professional-transition-designer",
  "confidence": 0.85,
  "reason": "corte de salto na batida: zoom no tempo da música"
}
```

No editor isso é um `EditCommand` com `payload: { clipId, clipBeforeId, transitionId, transition: { type, duration, intensity, easing, offset?, params? }, prevTransition }`, reversível (desfazer devolve a anterior).

## Licença e originalidade

Todos os modelos são implementações originais (canvas 2D, parametrizadas). A coluna `reference` registra só a técnica de montagem que inspira o modelo; nenhum preset, arquivo ou efeito comercial foi copiado.
