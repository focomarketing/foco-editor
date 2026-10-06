# Exemplos (casos reais, gerados pelos scripts da skill)

Todos usam o mesmo talking head real: fundo verde intenso, rosto bem exposto, camisa escura. Cada pasta tem
`compare.jpg` (ORIGINAL | EDITADO) e o relatório/validação.

| Pasta | O que mostra | Veredito |
|---|---|---|
| `over-graded/` | O tratamento "cinematográfico" que motivou a skill: 38% mais escuro, pretos esmagados de 14% → 35%, saturação da pele −73%. | **OVER-GRADED** · naturalidade 13/100 |
| `natural/` | Mesmo original com `professional-natural`: só reduz o verde neon (−8% saturação); exposição, pele e sombras intactas. Mudança média 3%. | **NATURAL** · 84/100 |
| `good/` | Rosto subexposto (−1 EV): a skill detecta "rosto subexposto" e sobe +0,6 EV (limite do perfil). | **GOOD** |
| `under-graded/` | O mesmo subexposto corrigido só 15%: o problema medido continua. | **UNDER-GRADED** |
| `cinematic/` | `talking-head-cinematic`: a 100% esmagava pretos; a skill reduziu a intensidade sozinha até passar. | **NATURAL** (reduzido) |

Regenerar: ver `tests/test_color.py` (mesmos cenários, como teste automático).
