# Integração com o FOCO Editor

## Fluxo

```
VÍDEO → extract_frames.mjs → autocolor.py auto (análise → decisão → simulação → validação)
      → decision.json → Cmd.setColor no editor → preview → export → autocolor.py validate → entrega
```

## O motor de cor

`src/engine/color/color.ts` — shader WebGL2 (`FRAG`) aplicado por clipe no preview e no export. Parâmetros
(`ColorSettings`, `src/core/types.ts`):

| Campo | Faixa | Efeito no shader |
|---|---|---|
| `exposure` | −2..2 EV | multiplica em linear (`2^exposure`) |
| `temperature` | −1..1 | R ×(1+0,12t), B ×(1−0,12t) em linear |
| `tint` | −1..1 | G ×(1−0,08t) em linear (positivo = menos verde) |
| `shadows` / `highlights` | −1..1 | soma ±0,22 ponderada por máscara de sombra/luz |
| `contrast` | −1..1 | `(c−0,5)(1+contrast)+0,5` |
| `saturation` / `vibrance` | −1..1 | mistura com a luminância; vibrance pesa mais nos pouco saturados |
| `vignette` | 0..1 | escurece bordas |

`scripts/foco_color.py → apply_grade()` reproduz exatamente essa matemática, por isso a simulação da skill
corresponde ao que o editor exporta. **Se o shader mudar, atualize `apply_grade()`.**

Não existem no motor (a decisão traz `unsupported: null`): whites, blacks, curvas, HSL por cor, LUT, sharpen,
noise reduction, máscara de pele/sujeito. Não imite esses controles com parâmetros globais fortes.

## Aplicar a decisão

Com o editor aberto em modo dev (`npm run dev`), `window.__foco` expõe `store`, `Cmd` e `actions`
(`src/dev/testHooks.ts`). Aplique **os mesmos valores** a todos os clipes do plano de câmera (consistência);
B-roll e gráficos ficam de fora:

```js
const d = /* conteúdo de decision.json */;
const f = window.__foco, p = f.store.getState().project;
const cameraAssetIds = new Set([/* id(s) do vídeo da câmera */]);
const values = {};
for (const c of Object.values(p.clips))
  if (cameraAssetIds.has(c.assetId) && !c.title && !c.caption)
    values[c.id] = { preset: `pvx:${d.profile}`, ...d.adjustments };
f.store.execute(f.Cmd.setColor(values, `Cor: ${d.profile}`)); // um passo de undo
```

Sem modo dev: informe os valores do AI COLOR REPORT para o usuário digitar no Inspector (aba Cor) e use
"Copiar/colar atributos" entre clipes.

**Reset AI Treatment**: `Cmd.setColor({ [id]: undefined, ... })` nos mesmos clipes.

## Divergência conhecida no editor

O botão **Cor automática** atual (`autoColorFromStats` em `color.ts`) leva a luminância média a 0,45 e aplica o
balanço de branco "mundo cinza" com força total. Isso contraria esta skill em cenários com luz colorida
intencional (ex.: fundo verde), escuros intencionais ou pele já correta. Quando o usuário pedir "cor automática",
use o fluxo desta skill em vez desse botão. Mudar o botão é uma alteração de produto: proponha, não faça sem pedido.

## Verificação do export

O export é a verdade final. Extraia do MP4 exportado os mesmos tempos usados na análise e valide:

```
node scripts/extract_frames.mjs export.mp4 70.29,210.86,351.43 frames exp
python scripts/autocolor.py validate --original frames/cam-70.29.png --edited frames/exp-70.29.png --decision color/decision.json
```
Saída 1 (OVER-GRADED) bloqueia a entrega.
