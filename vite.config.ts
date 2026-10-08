import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { localFiles } from './local-files.ts'

// https://vite.dev/config/
export default defineConfig({
  // localFiles: o editor roda no PC da pessoa; mídia sem vínculo é lida/gravada no disco
  plugins: [react(), localFiles()],
  // transformers.js já é um módulo ESM pronto; pré-empacotar faz o dev server
  // recarregar a página na primeira transcrição.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  worker: { format: 'es' },
})
