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

  // Correctif démo : le bypass renvoyait `success: true` pour TOUTE route /api/*
  // non mockée, charge utile vide. L'app enregistre alors un objet sans ses
  // tableaux (ex. nouveauxData.workers) puis lit .length dessus -> ErrorBoundary.
  // Les gardes applicatives testent `if (x.success)` : renvoyer `false` les fait
  // court-circuiter proprement, comportement attendu hors backend.
  // Correctif du HARNAIS de démonstration — aucun code applicatif modifié.
  var unmocked = "{ success: true, _testui: true, note: 'unmocked-api-route' }";
  if (t.indexOf(unmocked) < 0) {
    console.error('🛑 MODE DÉMO : motif de route non mockée introuvable — build interrompu.');
    process.exit(1);
  }
  // Le bypass renvoyait `success: true` avec une charge utile VIDE. L'app
  // enregistre alors un objet sans ses tableaux (ex. nouveauxData.workers) puis
  // lit .length dessus -> ErrorBoundary sur 5 écrans.
  // Renvoyer `success: false` supprimait le plantage mais affichait
  // « Erreur chargement ». On renvoie donc un succès avec des tableaux vides
  // BIEN FORMÉS : les écrans se rendent proprement, sans données.
  // Correctif du HARNAIS de démonstration — aucun code applicatif modifié.
  t = t.replace(unmocked,
    "{ success: true, _testui: true, note: 'unmocked-api-route', " +
    // tableaux vides bien formés
    "rows: [], workers: [], cueillette: [], periodes: [], equipes: [], " +
    // `data` doit rester un OBJET : le code fait `res.data?.entries || []`,
    // et sur un tableau `.entries` résout vers Array.prototype.entries (une
    // fonction, donc truthy) — le repli `|| []` ne jouerait jamais.
    "items: [], list: [], transactions: [], caisses: [], data: {}, " +
    "anomalies: [], cartes: [], lignes: [], factures: [], " +
    // objets attendus par certains écrans (Object.entries, accès imbriqués)
    "summary: { totalQuinzaine: 0, totalToday: 0, total: 0 }, " +
    "byFerme: {}, parFerme: [], totaux: {}, stats: {}, mapping: {}, " +
    // scalaires attendus (.toFixed / .toLocaleString) — zéro = absence de donnée
    "prixMoyenLitre: 0, totalLitres: 0, totalCout: 0, nbCartes: 0, " +
    "coutMoyenLigne: 0, nbLignes: 0, consommationMoyenne: 0, " +
    // /api/harvest-prediction : objet `prediction` déstructuré puis lu en profondeur
    "varieties: [], history: [], alerts: [], correlationTable: [], " +
    "prediction: { today: { kg: 0, isActual: false }, tomorrow: { kg: 0 }, j2: { kg: 0 } } }");

  t = t.replace("b.textContent = 'TESTUI — Auth bypass actif (no backend)';",
    "b.textContent = 'DÉMO — sans authentification · données fictives · non contractuel';");
  fs.writeFileSync(f,t);
  console.log('  ⚠️  MODE DÉMO ACTIF : aucune authentification, aucune donnée réelle (Firestore refuse les lectures non authentifiées).');
} else {
  console.log('  mode normal : écran de connexion actif (DEMO_NO_AUTH non défini)');
}

const size=d=>{let t=0;(function w(x){for(const e of fs.readdirSync(x,{withFileTypes:true})){const f=p.join(x,e.name);e.isDirectory()?w(f):t+=fs.statSync(f).size;}})(d);return t;};
console.log('dist-vercel/ assemblé');
console.log('  fichiers copiés depuis public/ :',copied);
console.log('  taille totale:',(size(OUT)/1048576).toFixed(1),'Mo');
