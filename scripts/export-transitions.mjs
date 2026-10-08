// Gera os presets da skill professional-transition-designer a partir da biblioteca do editor
// (fonte única: src/video-editor/transitions/library.ts). Um JSON por preset + índice.
// Uso: node scripts/export-transitions.mjs
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.claude/skills/professional-transition-designer/presets');
const server = await createServer({ root, server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true } });
try {
  const { TRANSITIONS, CATEGORY_LABEL } = await server.ssrLoadModule('/src/video-editor/transitions/library.ts');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const t of TRANSITIONS) fs.writeFileSync(path.join(out, `${t.id}.json`), `${JSON.stringify(t, null, 2)}\n`);
  const index = Object.keys(CATEGORY_LABEL).map((c) => ({ category: c, label: CATEGORY_LABEL[c], presets: TRANSITIONS.filter((t) => t.category === c).map((t) => t.id) }));
  fs.writeFileSync(path.join(out, 'index.json'), `${JSON.stringify({ generatedFrom: 'src/video-editor/transitions/library.ts', total: TRANSITIONS.length, categories: index }, null, 2)}\n`);
  console.log(`${TRANSITIONS.length} presets em ${path.relative(root, out)}`);
} finally {
  await server.close();
}
