# Transições por formato

Pesquisa de referência (out/2026): em curtos dominam speed ramp/velocity, transições na batida, glitch/RGB controlados e zooms; no YouTube, corte seco, J-cut/L-cut e dissolves discretos; em entrevistas, cortes invisíveis e B-roll sobre a fala. (Fontes conceituais: guias públicos do CapCut, Splice e VEED sobre tendências de 2026; nada foi copiado, só a técnica.)

## Matriz de recomendação

```
Tipo de conteúdo → Ritmo → Movimento dos clipes → Energia do áudio → Plataforma → Transição
```

| Situação | YouTube | Shorts/Reels/TikTok | Comercial | Entrevista |
|---|---|---|---|---|
| Corte dentro de palavra | nenhuma | nenhuma | nenhuma | nenhuma |
| Corte de salto | punch-in alternado | beat zoom (batida) / punch-in alternado | seamless cut | punch-in alternado |
| Movimento compatível | corte por movimento (seco) | whip na direção | whip suave | seco |
| Planos parecidos | match cut (seco) | match cut | seco | seco |
| Troca de cena em pausa ≥ 0,6 s | cross dissolve | — | — | clean dissolve (≥ 0,8 s) |
| Troca de cena em pausa ≥ 1,5 s | chapter transition | — | — | clean dissolve |
| Troca de cena no meio da fala | seco | rodízio de cena se energia > 0,5 | rodízio de marca | seco |
| Corte na batida | — | impacto (energia > 0,7) ou cena | rodízio de marca (+confiança) | — |
| B-roll trocando | B-roll bridge | — | — | — |

## Famílias por plataforma (biblioteca)

- **Clean** (12): corte seco inteligente, match cut, corte por ação, corte por movimento, whip pan suave, push slide, zoom clean, rack focus, blur transition, seamless cut, speed ramp cut, masked reveal.
- **Reels/TikTok/Shorts** (16): beat zoom, punch zoom, whip, shake controlado, snap, spin, flash cut, velocity, object wipe, hand cover, camera shake sincronizado, impact cut, frame skip, digital swipe, quick blur, RGB split sutil.
- **YouTube** (10): clean cut, dip to black, dip to white, cross dissolve, chapter transition, B-roll bridge, animated wipe, subtle push, focus transition, cinematic dissolve.
- **Comerciais** (10): product reveal, light sweep, light leak, shape mask, liquid mask, parallax, 3D card, match color, branded wipe, CTA reveal.
- **Entrevistas** (5): corte invisível, punch-in, punch-out, clean dissolve, corte motivado.

## Ainda não implementados (precisam de outra parte do editor)

- **J-cut / L-cut**: são transições de áudio (o som de um plano entra antes/sai depois da imagem). Ficam para a fase Música e efeitos, que mexe no áudio separado do vídeo.
- **Object morph, product rotation, logo wipe com a logo real, seamless object wipe com rastreio de objeto e lower-third transition**: precisam de rastreio de objeto ou de arquivos da marca. O object wipe e o hand cover atuais simulam com uma faixa escura.
- **Ambient sound bridge, reaction cut e angle switch**: dependem de multicâmera e da fase de áudio.
