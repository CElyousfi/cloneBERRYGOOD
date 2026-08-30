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

// 2bis. MODE DÉMO (DEMO_NO_AUTH=1) — uniquement dans la sortie de build.
// public/lib/local-test-bypass.js n'est JAMAIS modifié : l'hébergement Firebase
// de production ne peut pas embarquer ce contournement par accident.
if (process.env.DEMO_NO_AUTH === '1') {
  const f = p.join(OUT,'lib/local-test-bypass.js');
  let t = fs.readFileSync(f,'utf8');
  const guardHost = "  if (!isLocalHost) return;";
  const guardParam = "  if (params.get('testui') !== '1') return;";
  if (!t.includes(guardHost) || !t.includes(guardParam)) {
    console.error('🛑 MODE DÉMO : gardes introuvables dans local-test-bypass.js — build interrompu.');
    process.exit(1);
  }
  t = t.replace(guardHost,
    "  // [BUILD DÉMO] garde hôte neutralisée : contournement actif sur le domaine de préversion.\n"+
    "  void isLocalHost;");
  t = t.replace(guardParam,
    "  // [BUILD DÉMO] ?testui=1 non requis : la démo s'active à l'ouverture de la page.\n"+
    "  void params;");
  // Onglet d'accueil de la démo : 'dashboard' tombe en ErrorBoundary sans données
  // Firestore (comportement identique dans le monolithe d'origine). On ouvre sur
  // 'pointage', qui s'affiche correctement. Aucune modification du code applicatif :
  // on se contente de pré-remplir localStorage avant le boot de l'app.
  t = t.replace("  showBadge();",
    "  showBadge();\n"+
    "  // [BUILD DÉMO] onglet d'accueil lisible\n"+
    "  try { if (!localStorage.getItem('lastTab')) localStorage.setItem('lastTab', 'pointage'); } catch (e) {}");

  t = t.replace("b.textContent = 'TESTUI — Auth bypass actif (no backend)';",
    "b.textContent = 'DÉMO — sans authentification · données fictives · non contractuel';");
  fs.writeFileSync(f,t);
  console.log('  ⚠️  MODE DÉMO ACTIF : aucune authentification, aucune donnée réelle (Firestore refuse les lectures non authentifiées).');
} else {
  console.log('  mode normal : écran de connexion actif (DEMO_NO_AUTH non défini)');
}

// 3. index.html migré + legacy.html d'origine
const legacy=fs.readFileSync(p.join(PUB,'index.html'),'utf8');
const anchor='<script defer src="app.js?v=mt4mnskr"></script>';
if(!legacy.includes(anchor)){ console.error('🛑 ancre <script app.js> introuvable dans public/index.html'); process.exit(1); }

// legacy.html — interface d'origine, monolithe app.js, aucun changement
fs.writeFileSync(p.join(OUT,'legacy.html'),legacy);

// new.html — application migrée (modules ES) + thème v2 (présentation uniquement)
const THEME=p.resolve(__dirname,'../../design/theme-v2.css');
if(!fs.existsSync(THEME)){ console.error('🛑 design/theme-v2.css introuvable'); process.exit(1); }
fs.copyFileSync(THEME,p.join(OUT,'theme-v2.css'));
let modern=legacy.replace(anchor,
  '    <!-- Monolithe app.js remplacé par le point d\'entrée modulaire ES.\n'+
  '         Les <script> UMD/lib au-dessus sont conservés à l\'identique. -->\n'+
  '    <script type="module" src="/app.modular.js"></script>');
// Le thème doit gagner la cascade : index.html contient un SECOND bloc <style>
// situé dans le <body>, après </head>. Un <link> en fin de <head> serait donc
// écrasé. On l'injecte en fin de <body>, après tous les styles d'origine.
if(modern.indexOf('</body>')<0){ console.error('🛑 </body> introuvable'); process.exit(1); }
modern=modern.replace('</body>',
  '    <link rel="stylesheet" href="/theme-v2.css">\n'+
  '    <div id="v2-ribbon"><span class="dot"></span>Nouvelle interface</div>\n</body>');
fs.writeFileSync(p.join(OUT,'new.html'),modern);

// index.html — page d'accueil : choix entre les deux versions
const LANDING=p.resolve(__dirname,'../../design/landing.html');
if(!fs.existsSync(LANDING)){ console.error('🛑 design/landing.html introuvable'); process.exit(1); }
fs.copyFileSync(LANDING,p.join(OUT,'index.html'));

const size=d=>{let t=0;(function w(x){for(const e of fs.readdirSync(x,{withFileTypes:true})){const f=p.join(x,e.name);e.isDirectory()?w(f):t+=fs.statSync(f).size;}})(d);return t;};
console.log('dist-vercel/ assemblé');
console.log('  fichiers copiés depuis public/ :',copied);
console.log('  index.html   -> page d\'accueil (choix de version)');
console.log('  legacy.html  -> interface d\'origine (app.js)');
console.log('  new.html     -> app migrée + thème v2 (theme-v2.css)');
console.log('  taille totale:',(size(OUT)/1048576).toFixed(1),'Mo');
