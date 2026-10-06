// Identificação robusta de arquivos de mídia: SHA-256 de tamanho + início + meio + fim.
// Lê no máximo ~9 MB mesmo de um arquivo de horas (rápido), e muda se o conteúdo mudar
// nessas regiões ou se o tamanho mudar. Arquivos pequenos são lidos inteiros.

const HEAD = 4 * 1024 * 1024;
const MID = 1024 * 1024;
const TAIL = 4 * 1024 * 1024;

export async function mediaHash(file: Blob): Promise<string> {
  const size = file.size;
  const sizeBytes = new TextEncoder().encode(`${size}|`);
  let parts: Blob[];
  if (size <= HEAD + MID + TAIL) parts = [file];
  else {
    const mid = Math.floor(size / 2 - MID / 2);
    parts = [file.slice(0, HEAD), file.slice(mid, mid + MID), file.slice(size - TAIL)];
  }
  const buf = await new Blob([sizeBytes, ...parts]).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
