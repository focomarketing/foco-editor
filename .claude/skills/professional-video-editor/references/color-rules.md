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
