/**
 * Compilacion del panel. `npm run build` lo deja en dist/panel, que es de
 * donde lo sirve el servidor. En desarrollo (`npm run dev:web`) las llamadas
 * a /api se pasan al servidor del radar en el puerto 3000.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/panel', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
