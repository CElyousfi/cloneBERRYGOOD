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
      output: {
        format: 'es',
        entryFileNames: 'app.modular.js',
        // Noms STABLES, sans empreinte. Deux raisons : les chunks sont commités
        // comme le reste de public/ (RÈGLE 3 de CLAUDE.md — rien d'untracked en
        // production), et une empreinte ferait réécrire 112 fichiers à chaque
        // build. L'absence de cache-bust est sans effet ici : firebase.json sert
        // le JS en `no-cache, no-store, must-revalidate`.
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'chunks/[name][extname]',
      },
    },
  },
});
