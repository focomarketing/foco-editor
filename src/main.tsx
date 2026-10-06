import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import { App } from './ui/App';
import { bootEditor, recoverSession } from './app/editor';

async function main() {
  await bootEditor();
  if (import.meta.env.DEV) await import('./dev/testHooks');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // A recuperação pode perguntar ao usuário: roda depois que a interface existe.
  await recoverSession();
}

void main();
