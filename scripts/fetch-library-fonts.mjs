// Monta a biblioteca de fontes embutida no app: baixa do Google Fonts (licença livre) as famílias
// abaixo para public/fonts/library/ e gera manifest.json. Rodar de novo só quando a lista mudar:
//   node scripts/fetch-library-fonts.mjs
// Os arquivos ficam versionados no Git: o app não precisa de internet para usar a biblioteca.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadFamily, fetchCatalog, safeDirName } from '../local-server/googleFonts.mjs';

/** Categoria (como aparece no seletor) → famílias. Escolhidas para vídeo: leitura em tela pequena e português. */
const LIBRARY = {
  Impacto: ['Anton', 'Bebas Neue', 'Oswald', 'Archivo Black', 'League Gothic', 'Bowlby One', 'Russo One', 'Alfa Slab One', 'Passion One', 'Fjalla One', 'Barlow Condensed', 'Big Shoulders', 'Teko'],
  Moderna: ['Montserrat', 'Poppins', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Nunito', 'Raleway', 'Work Sans', 'DM Sans', 'Manrope', 'Outfit', 'Rubik', 'Kanit', 'Lexend', 'Barlow'],
  Elegante: ['Playfair Display', 'Cormorant Garamond', 'Lora', 'Merriweather', 'DM Serif Display', 'Abril Fatface', 'Cinzel', 'Libre Baskerville'],
  Manuscrita: ['Pacifico', 'Dancing Script', 'Caveat', 'Satisfy', 'Great Vibes', 'Permanent Marker', 'Kaushan Script', 'Lobster', 'Sacramento', 'Shadows Into Light'],
  Divertida: ['Bangers', 'Luckiest Guy', 'Titan One', 'Fredoka', 'Baloo 2', 'Chewy', 'Righteous', 'Bungee'],
  Tech: ['Orbitron', 'JetBrains Mono', 'Space Mono', 'Space Grotesk', 'Press Start 2P'],
};

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'fonts', 'library');

const catalog = await fetchCatalog();
fs.rmSync(OUT, { recursive: true, force: true });
const manifest = [];
let bytes = 0;
for (const [category, families] of Object.entries(LIBRARY)) {
  for (const family of families) {
    const entry = catalog.find((f) => f.family === family);
    if (!entry) {
      console.warn(`! ${family}: não está no catálogo, pulando`);
      continue;
    }
    // só os pesos que vídeo usa (texto normal até o extra-negrito)
    const used = entry.wght ? entry : { ...entry, weights: entry.weights.filter((w) => w >= 400) };
    if (!used.wght && !used.weights.length) used.weights = entry.weights;
    const dir = path.join(OUT, safeDirName(family));
    const m = await downloadFamily(used, dir);
    fs.rmSync(path.join(dir, 'faces.json'));
    const size = m.faces.reduce((s, f) => s + fs.statSync(path.join(dir, f.file)).size, 0);
    bytes += size;
    manifest.push({ family, category, faces: m.faces.map((f) => ({ weight: f.weight, url: `fonts/library/${safeDirName(family)}/${f.file}` })) });
    console.log(`✓ ${family} (${m.faces.length} arquivo${m.faces.length > 1 ? 's' : ''}, ${Math.round(size / 1024)} KB)`);
  }
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`\n${manifest.length} famílias, ${(bytes / 1024 / 1024).toFixed(1)} MB em ${path.relative(ROOT, OUT)}`);
