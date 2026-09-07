/* publish-modular — dépose le bundle ES dans public/, à côté du monolithe.
 *
 * `vite.migrated.config.js` écrit dans `dist-migrated/`, qui n'est pas servi :
 * Firebase Hosting publie `public/` (cf. firebase.json, `hosting.public`). Sans
 * cette copie, le sélecteur d'entrée de index.html demanderait `app.modular.js`
 * et recevrait un 404 — c'est-à-dire un écran blanc pour tout utilisateur dont
 * le drapeau MODULAR_FRONTEND est actif.
 *
 * Le bundle est COMMITÉ comme l'est déjà `public/app.js` : la RÈGLE 3 de
 * CLAUDE.md interdit du code non tracké en production, et l'hébergement publie
 * le répertoire tel qu'il est sur disque.
 *
 * On ne peut pas faire pointer vite directement sur `public/` : il vide son
 * `outDir` avant d'écrire, ce qui effacerait tout le frontend legacy.
 */
const fs = require('fs');
const p = require('path');

const ROOT = p.resolve(__dirname, '../..');
const SRC = p.join(ROOT, 'dist-migrated/app.modular.js');
const DST = p.join(ROOT, 'public/app.modular.js');

if (!fs.existsSync(SRC)) {
  console.error('🛑 dist-migrated/app.modular.js absent — lance `npm run migrate:build` d\'abord.');
  process.exit(1);
}

fs.copyFileSync(SRC, DST);

// Les chunks du chargement différé. Le point d'entrée les importe par chemin
// RELATIF (`./chunks/X.js`) : ils doivent donc garder la même disposition sous
// public/ que sous dist-migrated/, sinon chaque ouverture d'onglet part en 404.
// Le répertoire est vidé d'abord — un chunk supprimé d'un build à l'autre
// resterait sinon indéfiniment dans public/, puis serait déployé.
const SRC_CHUNKS = p.join(ROOT, 'dist-migrated/chunks');
const DST_CHUNKS = p.join(ROOT, 'public/chunks');
fs.rmSync(DST_CHUNKS, { recursive: true, force: true });
let nb = 0, octets = 0;
if (fs.existsSync(SRC_CHUNKS)) {
  fs.mkdirSync(DST_CHUNKS, { recursive: true });
  for (const nom of fs.readdirSync(SRC_CHUNKS)) {
    fs.copyFileSync(p.join(SRC_CHUNKS, nom), p.join(DST_CHUNKS, nom));
    nb++; octets += fs.statSync(p.join(DST_CHUNKS, nom)).size;
  }
}

const ko = (fs.statSync(DST).size / 1024).toFixed(0);
console.log(`[publish-modular] public/app.modular.js — ${ko} Ko`);
console.log(`[publish-modular] public/chunks/ — ${nb} chunks, ${(octets / 1024).toFixed(0)} Ko`);
