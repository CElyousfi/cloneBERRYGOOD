/* Assemble dist-vercel/ : site statique déployable.
   - tout public/ (index.html, app.modular.js, chunks/, lib, components, assets, JSON, sw.js, manifest…)
   Pré-requis : `npm run build` (Vite écrit app.modular.js et chunks/ dans public/).
*/
const fs=require('fs'),p=require('path');
const ROOT=p.resolve(__dirname,'..');
const OUT=p.join(ROOT,'dist-vercel');
const PUB=p.join(ROOT,'public');
const BUNDLE=p.join(PUB,'app.modular.js');

if(!fs.existsSync(BUNDLE)){ console.error('🛑 public/app.modular.js absent — lance `npm run build` d\'abord.'); process.exit(1); }

fs.rmSync(OUT,{recursive:true,force:true});
fs.mkdirSync(OUT,{recursive:true});

// 1. copier public/
let copied=0,bytes=0;
(function walk(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const e of fs.readdirSync(src,{withFileTypes:true})){
    const s=p.join(src,e.name), d=p.join(dst,e.name);
    if(e.isDirectory()) walk(s,d);
    else { fs.copyFileSync(s,d); copied++; bytes+=fs.statSync(s).size; }
  }
})(PUB,OUT);

// MODE DÉMO (DEMO_NO_AUTH=1) : géré à la COMPILATION par vite.config.js
// (define __SB_DEMO_NO_AUTH__ lu par src/modules/shared/lib/localTestBypass.js).
// Ce script ne modifie plus aucun fichier : il ne fait que copier public/.
if (process.env.DEMO_NO_AUTH === '1') {
  console.log('  ⚠️  MODE DÉMO ACTIF : aucune authentification, aucune donnée réelle (Firestore refuse les lectures non authentifiées).');
} else {
  console.log('  mode normal : écran de connexion actif (DEMO_NO_AUTH non défini)');
}

const size=d=>{let t=0;(function w(x){for(const e of fs.readdirSync(x,{withFileTypes:true})){const f=p.join(x,e.name);e.isDirectory()?w(f):t+=fs.statSync(f).size;}})(d);return t;};
console.log('dist-vercel/ assemblé');
console.log('  fichiers copiés depuis public/ :',copied);
console.log('  taille totale:',(size(OUT)/1048576).toFixed(1),'Mo');
