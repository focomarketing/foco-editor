import { describe, expect, it } from 'vitest';
import type { Asset, CaptionStyle, Clip, Project, TitleData } from '../../core/types';
import { createProject } from '../timeline/operations';
import { projectFamilies } from './library';
// @ts-expect-error módulo .mjs do servidor local (sem tipos)
import { cssUrl, parseLatinFaces } from '../../../local-server/googleFonts.mjs';

const clip = (id: string, extra: Partial<Clip>): Clip =>
  ({ id, assetId: '', trackId: 't', start: 0, duration: 1, sourceIn: 0, volume: 1, speed: 1, fadeIn: 0, fadeOut: 0, transform: {}, ...extra }) as Clip;

function project(clips: Clip[], fontAsset?: Partial<Asset>): Project {
  const p = createProject();
  return {
    ...p,
    clips: Object.fromEntries(clips.map((c) => [c.id, c])),
    assets: fontAsset ? { f: { id: 'f', kind: 'font', ...fontAsset } as Asset } : p.assets,
  };
}

describe('projectFamilies', () => {
  it('lista as famílias de legendas e gráficos, sem repetir', () => {
    const p = project([
      clip('a', { caption: { words: [], style: { fontFamily: '"Montserrat", "Segoe UI", Arial, sans-serif' } as CaptionStyle } }),
      clip('b', { title: { fontFamily: '"Anton", "Segoe UI", Arial, sans-serif' } as TitleData }),
      clip('c', { title: { fontFamily: 'montserrat, sans-serif' } as TitleData }),
    ]);
    expect(projectFamilies(p)).toEqual(['Montserrat', 'Anton']);
  });

  it('ignora fontes do sistema, importadas e genéricas', () => {
    const p = project(
      [
        clip('a', { title: { fontFamily: '"Arial Black", "Segoe UI Black", sans-serif' } as TitleData }),
        clip('b', { title: { fontFamily: '"Minha Fonte", sans-serif' } as TitleData }),
        clip('c', { title: { fontFamily: 'serif' } as TitleData }),
      ],
      { fontFamily: 'Minha Fonte' },
    );
    expect(projectFamilies(p)).toEqual([]);
  });
});

describe('Google Fonts (servidor local)', () => {
  it('pede a faixa de pesos de fontes variáveis e os pesos de fontes estáticas', () => {
    expect(cssUrl({ family: 'Open Sans', wght: [300, 800], weights: [] })).toContain('family=Open+Sans:wght@300..800');
    expect(cssUrl({ family: 'Poppins', wght: null, weights: [400, 700, 900] })).toContain('family=Poppins:wght@400;700;900');
  });

  it('pega só o subconjunto latin, estilo normal, sem arquivos repetidos', () => {
    const css = `
/* latin-ext */
@font-face { font-family: 'X'; font-style: normal; font-weight: 400; src: url(https://g/ext.woff2) format('woff2'); }
/* latin */
@font-face { font-family: 'X'; font-style: normal; font-weight: 100 900; src: url(https://g/var.woff2) format('woff2'); }
/* latin */
@font-face { font-family: 'X'; font-style: normal; font-weight: 100 900; src: url(https://g/var.woff2) format('woff2'); }
/* latin */
@font-face { font-family: 'X'; font-style: italic; font-weight: 400; src: url(https://g/it.woff2) format('woff2'); }`;
    expect(parseLatinFaces(css)).toEqual([{ weight: '100 900', url: 'https://g/var.woff2' }]);
  });
});
