import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Build du frontend — seul build du dépôt.
// Entrée JS (pas HTML) : public/index.html charge le bundle émis.
//
// La sortie est écrite DIRECTEMENT dans public/ (le dossier publié par Firebase
// Hosting, cf. firebase.json). `emptyOutDir: false` : public/ contient aussi
// index.html, sw.js, manifest.json, les JSON statiques… qu'il ne faut pas
// effacer. Les chunks sont vidés à la main avant chaque build : un chunk
// supprimé d'un build à l'autre resterait sinon indéfiniment dans public/,
// puis serait déployé. app.modular.js et chunks/ sont gitignorés : le build
// se relance à chaque deploy (scripts/deploy.sh, scripts/preview.sh, CI).
const OUT_DIR = path.resolve(__dirname, 'public');

/** Vide public/chunks/ avant l'écriture du build. */
function purgeChunks() {
  return {
    name: 'sb-purge-chunks',
    apply: 'build',
    buildStart() {
      fs.rmSync(path.join(OUT_DIR, 'chunks'), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  // Build de DÉMO (DEMO_NO_AUTH=1, cf. scripts/assemble-vercel.cjs) : neutralise
  // les gardes de src/modules/shared/lib/localTestBypass.js à la compilation.
  // Jamais actif sur un `npm run build` ordinaire : la prod garde ses gardes.
  define: { __SB_DEMO_NO_AUTH__: JSON.stringify(process.env.DEMO_NO_AUTH === '1') },
  plugins: [react(), purgeChunks()],
  root: __dirname,
  publicDir: false,
  build: {
    outDir: OUT_DIR,
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/modules/bootstrap.jsx'),
      output: {
        format: 'es',
        entryFileNames: 'app.modular.js',
        // Noms STABLES, sans empreinte : firebase.json sert le JS en
        // `no-cache, no-store, must-revalidate`, le cache-bust est inutile.
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'chunks/[name][extname]',
      },
    },
  },
});
