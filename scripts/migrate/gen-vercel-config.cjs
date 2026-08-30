/* Génère vercel.json depuis firebase.json :
   - les 55 rewrites /api/* sont proxifiés vers les Cloud Functions Firebase
     (même backend que la prod — Vercel n'héberge que le frontend statique). */
const fs=require('fs'),p=require('path');
const ROOT=p.resolve(__dirname,'../..');
const PROJECT='berrygood-farms-dashboard';
const fb=JSON.parse(fs.readFileSync(p.join(ROOT,'firebase.json'),'utf8'));
let h=fb.hosting; if(Array.isArray(h)) h=h[0];

const rewrites=[];
for(const r of (h.rewrites||[])){
  if(!r.function) continue;
  const fn = typeof r.function==='string' ? r.function : r.function.functionId;
  const region = (typeof r.function==='object' && r.function.region) || 'us-central1';
  rewrites.push({ source:r.source, destination:`https://${region}-${PROJECT}.cloudfunctions.net/${fn}` });
}
const skipped=(h.rewrites||[]).filter(r=>!r.function);

// Pas de fallback SPA : l'application ne fait aucun routage par URL
// (unique usage de l'History API dans app.jsx : un replaceState qui retire les
// query params). index.html est servi à la racine, les onglets sont gérés en
// mémoire + localStorage. Un catch-all regex ici n'apporterait rien et
// constitue un risque d'échec de parsing côté Vercel.

const cfg={
  $schema:'https://openapi.vercel.sh/vercel.json',
  // MODE DÉMO : déploiement sans écran de connexion, pour revue d'équipe.
  // Pour REMETTRE LE LOGIN : remplacer par 'npm run build:vercel' et redéployer.
  buildCommand:'npm run build:vercel:demo',
  outputDirectory:'dist-vercel',
  framework:null,
  // playwright n'est utile qu'aux tests locaux : on évite le téléchargement
  // des navigateurs (~300 Mo) pendant l'install Vercel.
  installCommand:'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund',
  rewrites,
  headers:[
    { source:'/app.modular.js', headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}] },
    { source:'/sw.js',          headers:[{key:'Cache-Control',value:'no-cache'}] },
    { source:'/app-version.txt',headers:[{key:'Cache-Control',value:'no-cache'}] }
  ]
};
fs.writeFileSync(p.join(ROOT,'vercel.json'),JSON.stringify(cfg,null,2)+'\n');
console.log('vercel.json écrit —',rewrites.filter(r=>r.destination.startsWith('https://')).length,'proxys /api/* (pas de fallback SPA : aucun routage URL)');
console.log('rewrites non-fonction ignorés :',skipped.length, skipped.map(r=>r.source).slice(0,5).join(', '));
const regions=[...new Set(rewrites.filter(r=>r.destination.startsWith('https://')).map(r=>r.destination.split('//')[1].split('-'+PROJECT)[0]))];
console.log('régions détectées :',regions.join(', '));
