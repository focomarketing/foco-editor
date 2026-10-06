import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // transformers.js já é um módulo ESM pronto; pré-empacotar faz o dev server
  // recarregar a página na primeira transcrição.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  worker: { format: 'es' },
})
