# Sincronia com a música

- **Batidas** vêm dos níveis RMS da faixa de música (100 por segundo): subidas bruscas de energia acima da média local (média + 1,5 desvio), separadas por pelo menos 0,25 s (`detectBeats`).
- Um corte está **na batida** se há batida a até 0,15 s dele.
- Na batida, a janela da transição é deslocada (`offset`) para centrar na batida, sem deixar de conter o corte (|offset| ≤ duração/2).
- **Energia** no corte (0..1, de -50 a -6 dBFS):
  - acima de 0,7 → família de impacto (impact cut, shake sincronizado, beat zoom);
  - abaixo → família de cena (flash, quick blur, zoom clean, RGB split, snap), em rodízio para não repetir.
- Sem música, curtos só ganham transição em troca de cena com energia alta; o resto é corte seco (é mais forte).
- Comerciais na batida ganham confiança maior (0,75) do que fora dela (0,64).
- `soundEffect` nos presets é o nome do efeito sonoro sugerido; a fase Música e efeitos é quem coloca o som.
