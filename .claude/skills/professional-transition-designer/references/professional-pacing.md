# Ritmo profissional

| Formato | Espaço mínimo entre transições | Máx. de cortes com transição | Intensidade base |
|---|---|---|---|
| YouTube longo | 10 s | 15% | 0,40 |
| Entrevista / depoimento | 15 s | 10% | 0,30 |
| Reels / TikTok / Shorts | 1,2 s | 40% | 0,65 |
| Comercial | 2,5 s | 30% | 0,50 |

(valores em `FORMAT_RULES`, `src/video-editor/transitions/director.ts`)

- **Cortes de salto** (mesmo arquivo, trecho seguinte): alternar punch-in e plano aberto esconde o pulo. Não conta no limite de densidade (não é efeito, é enquadramento).
- **Pausa antes do corte**: ≥ 0,6 s com troca de ambiente permite dissolve no YouTube; ≥ 1,5 s marca troca de bloco (chapter transition).
- **Duas fortes seguidas** (nível 3): a segunda vira uma discreta (quick blur / blur transition).
- **Duração**: a recomendada do preset, encurtada para caber em metade de cada clipe; se não couber o mínimo, não há transição.
- **Clipes com menos de 0,4 s**: sem transição.
