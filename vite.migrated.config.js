import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Build de la migration non-régression.
// Entrée JS (pas HTML) : index.migrated.html charge le bundle émis.
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'dist-migrated'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/modules/bootstrap.jsx'),
      output: { entryFileNames: 'app.modular.js', format: 'es' },
    },
  },
});
