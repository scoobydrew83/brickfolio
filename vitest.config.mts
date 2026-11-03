import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  // Tests never go online: the full sync would otherwise download the community barcode list.
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**', '.next/**', '.open-next/**'], env: { COMMUNITY_LIST: 'off' } },
});
