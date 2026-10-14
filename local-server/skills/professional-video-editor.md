---
name: professional-video-editor
description: Colorista profissional para vídeos de pessoa falando (YouTube, Reels, Shorts, TikTok, podcast, aula, opinião, teologia, vendas, talking head) editados no FOCO Editor. Use SEMPRE antes de aplicar ou sugerir qualquer correção de cor — exposição, contraste, sombras, altas luzes, saturação, balanço de branco, LUT/look, "cinematic", cor automática, presets de cor — e para avaliar se um tratamento ficou exagerado (over-graded) ou fraco (under-graded). Analisa o original, corrige só o que está errado, simula com a matemática real do editor, valida contra o original e reduz a intensidade quando piora. Prefere NÃO mudar a mudar agressivamente.
---

# Professional Video Editor — módulo de cor

Você age como um **colorista profissional**, não como um aplicador de filtros.

```
ANALISAR → DECIDIR → EDITAR → VALIDAR → COMPARAR → CORRIGIR
```

Hierarquia, sempre nesta ordem: **1. PRESERVAR · 2. CORRIGIR · 3. MELHORAR · 4. ESTILIZAR.**
Nunca: estilizar → destruir → tentar corrigir.

**Profissional ≠ mais escuro ≠ mais contraste ≠ mais saturação ≠ LUT forte.**
Profissional = exposição correta, pele natural, sombras e altas luzes com detalhe, cor consistente entre shots,
imagem limpa, estética intencional. **Diferença ≠ melhoria.** "No significant color correction required." é uma
resposta correta e desejável.

## Erro real que esta skill existe para evitar

Num ensaio de 14 min (talking head com fundo verde), o tratamento "cinematográfico" aplicado deixou a imagem
38% mais escura, levou os pretos esmagados de 14% para 35% dos pixels e tirou 73% da saturação da pele — o
validador marca **OVER-GRADED, naturalidade 13/100** (`examples/over-graded/`). O original já estava bem
exposto; o único excesso real era o verde neon do fundo. A correção certa (`examples/natural/`) mudou 3%.

## Fluxo obrigatório

Scripts em `scripts/` (Python com `numpy` e `Pillow`; extração de quadros usa o Edge + o próprio editor).

1. **Extrair quadros reais** — só do plano de câmera (não B-roll), espalhados pelo vídeo:
   `node scripts/extract_frames.mjs "<video>" auto <pasta> cam`
   (ou tempos explícitos `12,140,300,...`). Lê HEVC/4K. Use ≥ 4 quadros: a decisão é **uma só para o vídeo
   todo** (mediana das métricas), para não tremer entre clipes.
2. **Rodar o laço completo** com o perfil pedido (padrão `professional-natural`):
   `python scripts/autocolor.py auto --frames <pasta>/cam-*.png --profile professional-natural --out <pasta>/color`
   Ele mede → decide → simula com a matemática exata do shader do editor → valida cada quadro contra o
   original → se algum quadro sair OVER-GRADED, reduz a intensidade (100→75→50→25→0%) até passar.
3. **Olhar os comparativos** `compare-*.png` (ORIGINAL | EDITADO) com a ferramenta de leitura de imagem.
   Os números não substituem o olho: se você vê pele cinza, preto empastado ou verde artificial, reduza
   (`autocolor.py reduce --factor 0.5`) mesmo que o veredito tenha passado.
4. **Aplicar no editor** só a decisão validada (`decision.json → adjustments`), igual para todos os clipes do
   mesmo plano de câmera — ver `references/foco-editor-integration.md`.
5. **Validar o resultado final de verdade**: depois do export, extraia os mesmos tempos do MP4 exportado e rode
   `python scripts/autocolor.py validate --original orig.png --edited export.png --decision decision.json`.
   Código de saída 1 = OVER-GRADED → não entregue; reduza e reexporte.
6. **Reportar ao usuário** o `report.txt` (AI COLOR REPORT + QUALITY SCORE + veredito) e um comparativo.

## Regras de decisão (resumo — completas em `references/color-rules.md`)

- **Analise antes de tocar.** Se um parâmetro já está bom, ele fica em 0. Não precisa mexer em tudo.
- **Correção técnica só com problema medido**: rosto sub/superexposto, altas luzes estouradas, pretos realmente
  esmagados, imagem lavada, dominante de cor **na pele**.
- **Look/estilo vem depois e com intensidade**: padrão 15–35% do look; nunca 100% automático.
- **Sombras e pretos são prioridade**: nunca escurecer por padrão; detalhe em camisa preta, cabelo e móveis
  continua visível. `shadows` nunca negativo nos perfis.
- **Pele manda**: o rosto nunca é sacrificado pelo fundo ou pelo look. Matiz, luz e saturação da pele quase não
  mudam se estavam bons.
- **Balanço de branco**: se a pele está natural, uma dominante no fundo é luz intencional → preservar.
- **Verde**: nunca aumentar. Verde neon dominante → redução global mínima (o motor não tem HSL; a pele não
  pode perder mais de ~8% de saturação).
- **Saturação**: prefira vibrance a saturation para aumentar; reduza com cuidado.
- **Vinheta**: não é automática; só sutil e só em perfis estilizados.
- **Sem confiança, não altera** (fallback = NO CHANGE).
- **LUT**: o FOCO Editor ainda não tem LUT. Não simule LUT com parâmetros globais fortes.

## Perfis (`presets/presets.json`)

| Perfil | Uso | Look a 100% → aplicado |
|---|---|---|
| `professional-natural` (= `talking-head-natural`) | **padrão** de qualquer talking head | quase nada (25%) |
| `talking-head-cinematic` (= `cinematic`) | só quando o usuário pede estilo | contraste/altas luzes/calor (45%), com proteções |
| `podcast-clean` | estúdio, pele em 1º lugar | 20% |
| `youtube-professional` | mais presença, sem cara de filtro | 30% |
| `social-clean` | Reels/Shorts/TikTok | 30% |
| `documentary` | ensaio/doc: levemente dessaturado, altas luzes suaves | 35% |

O usuário escolhe o estilo. Sem pedido explícito, use `professional-natural`. Os valores são **adaptativos**: o
perfil define tolerâncias, look e limites; a correção técnica vem da análise do material.

## Validação (seção 47 do pedido) — falha automática

- ficou significativamente mais escuro sem justificativa (≥ 10% de luminância média);
- pretos perderam detalhe (≥ +3 pp de pixels esmagados ou −15% de textura nas sombras);
- altas luzes estouraram (≥ +1 pp);
- pele mudou demais (luz ±10%, matiz ≥ 6°, saturação ±20%) — exceto quando a mudança corrige a exposição do
  rosto para dentro da faixa;
- verde ficou mais puro (+10%);
- original já estava bom e a mudança média passou de 12%;
- naturalidade < 60/100.

Vereditos: `NO-CHANGE`, `NATURAL` (≤ 8% de mudança), `GOOD`, `UNDER-GRADED` (problema medido < 50% resolvido),
`OVER-GRADED`.

## Controles do usuário

- **Reset AI Treatment**: `autocolor.py reduce --factor 0` (ou remover a cor dos clipes no editor).
- **Reduce AI Intensity**: `reduce --factor 0.75 / 0.5 / 0.25` progressivamente (22% → 15% → 10% → 5% → 0%).
- **Override manual**: qualquer parâmetro do Inspector (Exposição, Contraste, Altas luzes, Sombras, Saturação,
  Vibrance, Temperatura, Tint, Vinheta). Whites, Blacks, Sharpen, Noise Reduction, LUT e HSL ainda não existem
  no motor — a decisão os reporta como `unsupported: null`; diga isso ao usuário em vez de imitar.

## Saída estruturada

`decision.json` segue `schemas/color-decision.schema.json`; a validação segue `schemas/validation.schema.json`.
A IA nunca altera arquivos de mídia diretamente: a decisão vira parâmetros do motor (`Cmd.setColor`).

## Módulos (expansão futura)

Este é o **módulo de cor** e deve permanecer separado. Os demais (cortes, silêncio, erros de fala, legendas,
motion graphics, transições, áudio, smart reframe, B-roll, Long → Shorts) seguirão o mesmo padrão
ANALISAR → DECIDIR → EDITAR → VALIDAR → COMPARAR → CORRIGIR, em arquivos próprios dentro desta skill.

## Arquivos

- `scripts/foco_color.py` — port do shader do editor, métricas, decisão, validação, relatório.
- `scripts/autocolor.py` — CLI: `auto`, `validate`, `simulate`, `reduce`.
- `scripts/extract_frames.mjs` — quadros reais do vídeo (HEVC/4K) via o editor.
- `presets/presets.json` — perfis, tolerâncias, limites de validação, degraus de intensidade.
- `references/color-rules.md` — todas as regras de colorista.
- `references/foco-editor-integration.md` — como aplicar no FOCO Editor, mapeamento e limitações do motor.
- `schemas/` — JSON Schemas da decisão e da validação.
- `examples/` — `natural`, `good`, `cinematic`, `under-graded`, `over-graded` (com comparativo e relatório reais).
# Regras de colorista — talking head

Referência completa da skill. O `SKILL.md` resume; aqui está o raciocínio para casos que os scripts não cobrem.

## 1. Princípio

**Naturalidade + qualidade + preservação.** O tratamento melhora o vídeo sem parecer que um filtro foi aplicado.
"Cinematic" **não** significa pretos esmagados, sombras muito escuras, saturação exagerada, contraste excessivo,
pele escura, verdes exagerados ou altas luzes estouradas.

## 2. Não destruir uma imagem que já está boa

Antes de qualquer ajuste, avalie no ORIGINAL: exposição, contraste, sombras, altas luzes, balanço de branco,
temperatura, saturação, pele, ruído, nitidez, separação do sujeito, aparência geral. Pergunte: **o vídeo
realmente precisa de correção?** Se não, aprimoramento mínimo ou nenhum. Se sim, só os problemas identificados.
Não modifique para "mostrar serviço".

## 3. Intensidade

```
ORIGINAL 0% ─ 10% subtle ─ 20% light ─ 30% professional ─ 50% strong ─ 75% stylized ─ 100% extreme
```
Padrão automático: **15–35%** do look. Nunca começar em 100%. Ao reduzir: 22% → 15% → 10% → 5% → 0%.

## 4. Pipeline correto

```
ORIGINAL → correção técnica → balanço de branco → exposição → contraste → proteção de pele
        → LUT/look → intensidade do look → equilíbrio final → validação
```
Nunca `ORIGINAL → LUT 100% → FINAL`.

## 5. Parâmetro a parâmetro

| Parâmetro | Regra |
|---|---|
| Exposição | Medida no **rosto** (luminância da pele 0,40–0,68 sRGB). Correta → não mexer. Subexposta → recuperar gradualmente (mira dentro da faixa, não a borda). Superexposta → reduzir. Nunca compensar levantando sombras demais (lavado) ou esmagando pretos. |
| Sombras | Prioridade máxima. Não escurecer por padrão. Detalhe em roupas, cabelo, móveis, paredes deve continuar visível. |
| Blacks | Não esmagar. Antes: detalhe presente → depois: detalhe presente. Cenário escuro intencional (muitos pixels escuros já no original) não é defeito. |
| Highlights | Proteger testa, nariz, reflexos, objetos claros. Evitar clipping. Reduzir só se houver estouro. |
| Pele | Natural, consistente, saudável; sem excesso de vermelho/amarelo, sem cinza, sem saturação artificial. Matiz típica 8–40° (HSV). Nunca sacrificar a pele por um look. |
| Balanço de branco | Analisar temperatura e tint antes. Correto → não mexer para "criar clima". Dominante só no fundo com pele natural = luz intencional → preservar. |
| Saturação | Evitar excesso, principalmente em verdes, vermelhos, pele e luzes. Para aumentar, prefira **vibrance**. |
| Verdes | Nunca intensificar. Evitar verde neon, artificial, luminoso demais. Sem HSL no motor: redução global mínima. |
| Contraste | Para separação e profundidade, não para "parecer cinema". Bom no original → pouco ou nada. Curvas suaves, nada de S agressiva. |
| LUT | Nunca primeira etapa. Intensidade 20–35%. Se esmagar sombras, mudar pele, exagerar verdes ou perder detalhe → reduzir; se preciso, **não usar**. (O FOCO Editor ainda não tem LUT.) |
| Nitidez | Sutil. Sem halos, pele artificial, contornos exagerados ou ruído amplificado. (Sem controle no motor ainda.) |
| Ruído | Redução moderada sem pele plástica, preservando cabelo e textura. (Sem controle no motor ainda.) |
| Vinheta | Não automática. Só sutil, quando ajuda a atenção. Nunca pesada por padrão. |

## 6. Talking head

Prioridades: **1 rosto · 2 pele · 3 exposição · 4 olhos · 5 voz · 6 fundo · 7 estética.** O rosto nunca é
sacrificado para melhorar o fundo. Quando houver separação sujeito/fundo (futuro): sujeito com exposição correta e
pele natural; fundo com contraste e saturação controlados e leve redução de distrações — sem cara de recorte.

## 7. Consistência e shot matching

- Um tratamento para o vídeo inteiro (análise temporal = mediana de vários quadros). Nada de quadro claro,
  quadro escuro, quadro claro.
- Vários takes/câmeras: comparar exposição, balanço de branco, contraste, saturação e pele entre eles; cada take
  recebe o ajuste que o aproxima da referência comum, não um look independente.
- B-roll e imagens de arquivo têm tratamento próprio (não são talking head); não apliquem a eles as tolerâncias
  de pele.

## 8. Referência visual (futuro)

Com uma imagem de referência: analisar contraste, temperatura, saturação, tonalidade e estilo e **adaptar**, não
copiar. Preservar pele, exposição, detalhes e a identidade da gravação.

## 9. Validação antes/depois

Comparar ORIGINAL x EDITADO em exposição, pele, detalhe de sombra, detalhe de altas luzes, saturação, contraste e
naturalidade. A pergunta é **"o resultado melhorou a imagem?"**, nunca "está mais diferente?". Pior → reverter
ou reduzir.

## 10. Fallback

Sem confiança suficiente para alterar uma característica, **não altere**: não sabe se está quente ou fria →
preserva; não sabe se o preto é intencional → preserva; não sabe se a saturação é intencional → preserva.

## 11. Estilos

Natural, Professional, Cinematic, Warm, Cool, Film, Documentary, Commercial, Social, Clean — todos sob o mesmo
princípio: **qualidade antes de estilo**. O usuário escolhe o estilo; o padrão é natural.

## 12. Cinematic

Pode usar contraste maior, tonalidade, altas luzes suaves, separação de cor — **sem destruir informação**. O
perfil `talking-head-cinematic` é validado como os outros: se esmagar pretos, a intensidade cai sozinha (foi o que
aconteceu no teste: 100% → 50%).

## 13. Relatório (transparência)

Sempre mostre o AI COLOR REPORT (cada ajuste, LUT, tratamento geral em %, proteções) e o QUALITY SCORE
(exposição, pele, sombras, altas luzes, saturação, contraste, naturalidade) com o veredito. O objetivo do score é
**qualidade profissional natural**, não contraste máximo.
