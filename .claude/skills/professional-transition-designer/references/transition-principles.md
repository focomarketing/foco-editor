# Princípios de transição

1. **Corte seco é o padrão.** O público não vê um corte bem colocado; vê um efeito mal colocado.
2. **Toda transição precisa de um motivo**, e o motivo vai escrito no `reason`:
   - **continuidade**: o movimento ou a forma continuam (match cut, corte por movimento, whip na mesma direção);
   - **ritmo**: a música pede (batida, drop);
   - **compreensão**: mudou o tempo, o lugar ou o capítulo (dissolve, dip, chapter);
   - **identidade**: o acabamento da marca (branded wipe, light sweep, máscara de forma).
3. **Invisível > visível.** Em fala, prefira o que esconde o corte (punch-in, micro-dissolve) ao que mostra o corte.
4. **Consistência.** Um vídeo usa uma "família" de transições. Alternar forte e discreto; nunca duas fortes seguidas.
5. **A fala manda.** Nada cobre palavra importante, nada corta no meio de sílaba, nada atrapalha a legenda.
6. **Tudo é editável.** Toda transição é preset + parâmetros no clipe que entra; mudar ou tirar é um comando desfazível; a escolha manual nunca é sobrescrita pela IA.

## Como o motor desenha (sem destruir os clipes)

- `center`: metade antes e metade depois do corte, um quadro de cada vez (zoom, whip com espelho nas bordas, giro, desfoque, flash, tremida, RGB, glitch, luz).
- `in`: depois do corte, com o **último quadro** do clipe anterior por baixo (dissolve, push, máscara, cartão). Equivale ao "freeze handle" dos editores quando não há material sobrando.
- `hold`: o clipe que entra inteiro (punch-in).

Nas bordas da janela todo efeito vale zero: entrar e sair da transição não dá salto.
