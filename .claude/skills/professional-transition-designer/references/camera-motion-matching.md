# Movimento de câmera

- **Medição**: dois quadros de cada lado do corte (0,3 s e 0,04 s antes do fim de A; 0,04 s e 0,3 s depois do início de B), em 64 px de largura e tons de cinza. O deslocamento global é a translação (±6 px) que minimiza a diferença média (`globalShift`).
- **Direção** (`motionDirection`): para onde a imagem anda (esquerda, direita, cima, baixo) ou parada (deslocamento < 2% do quadro).
- **Compatível** (`motionMatches`): os dois planos andam na mesma direção (cosseno > 0,7) e com força parecida (razão < 3).
- Com movimento compatível:
  - curtos → whip na mesma direção do movimento;
  - comercial → whip suave;
  - YouTube e entrevista → corte seco por movimento (o próprio movimento esconde o corte).
- Movimentos incompatíveis nunca recebem whip/push (o olho "bate" na mudança de direção).
- **Mudança visual** (`visualDistance`, 0..1, grade 8x8 de cor): < 0,12 = planos parecidos → match cut seco; > 0,35 = troca de cena.
- Imagens paradas contam como "sem movimento".
