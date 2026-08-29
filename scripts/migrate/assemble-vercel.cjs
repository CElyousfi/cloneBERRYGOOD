/* Assemble dist-vercel/ : site statique déployable (frontend migré).
   - tout public/ (lib, components, assets, JSON, sw.js, manifest…) SAUF le monolithe
   - app.modular.js  : bundle ES issu de src/modules/
   - index.html      : copie conforme de public/index.html, <script app.js> -> module ES
   - legacy.html     : le monolithe d'origine, pour comparaison côte à côte
*/
const fs=require('fs'),p=require('path');
const ROOT=p.resolve(__dirname,'../..');
const OUT=p.join(ROOT,'dist-vercel');
const PUB=p.join(ROOT,'public');
const BUNDLE=p.join(ROOT,'dist-migrated/app.modular.js');

if(!fs.existsSync(BUNDLE)){ console.error('🛑 dist-migrated/app.modular.js absent — lance `npm run migrate:build` d\'abord.'); process.exit(1); }

fs.rmSync(OUT,{recursive:true,force:true});
fs.mkdirSync(OUT,{recursive:true});

// 1. copier public/ sauf app.jsx (source 5,6 Mo, inutile en ligne)
let copied=0,bytes=0;
(function walk(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const e of fs.readdirSync(src,{withFileTypes:true})){
    if(e.name==='app.jsx') continue;                 // source du monolithe : non déployée
    const s=p.join(src,e.name), d=p.join(dst,e.name);
    if(e.isDirectory()) walk(s,d);
    else { fs.copyFileSync(s,d); copied++; bytes+=fs.statSync(s).size; }
  }
})(PUB,OUT);

// 2. bundle migré
fs.copyFileSync(BUNDLE,p.join(OUT,'app.modular.js'));

// 3. index.html migré + legacy.html d'origine
const legacy=fs.readFileSync(p.join(PUB,'index.html'),'utf8');
fs.writeFileSync(p.join(OUT,'legacy.html'),legacy);
const anchor='<script defer src="app.js?v=mt4mnskr"></script>';
if(!legacy.includes(anchor)){ console.error('🛑 ancre <script app.js> introuvable dans public/index.html'); process.exit(1); }
const migrated=legacy.replace(anchor,
  '    <!-- MIGRATION : monolithe app.js remplacé par le point d\'entrée modulaire ES.\n'+
  '         Tous les <script> UMD/lib au-dessus sont conservés à l\'identique. -->\n'+
  '    <script type="module" src="/app.modular.js"></script>');
fs.writeFileSync(p.join(OUT,'index.html'),migrated);

const size=d=>{let t=0;(function w(x){for(const e of fs.readdirSync(x,{withFileTypes:true})){const f=p.join(x,e.name);e.isDirectory()?w(f):t+=fs.statSync(f).size;}})(d);return t;};
console.log('dist-vercel/ assemblé');
console.log('  fichiers copiés depuis public/ :',copied);
console.log('  index.html   -> app.modular.js (migré)');
console.log('  legacy.html  -> app.js (monolithe, pour comparaison)');
console.log('  taille totale:',(size(OUT)/1048576).toFixed(1),'Mo');
