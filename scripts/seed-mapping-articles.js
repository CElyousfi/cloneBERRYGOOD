/**
 * seed-mapping-articles.js — Seed collection mapping_articles (TIMAC code_article -> article stock).
 * GATED. Cibles = clés stock EXISTANTES (jamais de renommage). Typos -> champ alias.
 * Usage (depuis functions/, ADC) : node ../scripts/seed-mapping-articles.js [--apply]
 */
'use strict';
const { db } = require('../functions/config/firebase');
const fs = require('fs');
const { parseTimacInvoicePdf } = require('../functions/emailService');
function canon(a){return (a==null?'':String(a)).toUpperCase().trim().replace(/\s+/g,' ').replace(/\s*\((L|KG|G|ML|UNITE|U)\)\s*$/,'');}
// décision : code -> {stock (clé EXISTANTE ou null), statut, alias?}
const D = {
  '0025':{s:'SOLUPOTASSE',st:'mappe'},'0035':{s:'ECOVIGOR',st:'mappe'},'0039':{s:'EUROFIT MAX',st:'mappe'},
  '0057':{s:'KALEO L',st:'mappe'},'0061':{s:'VITAL',st:'mappe'},'0063':{s:'ALPHA',st:'mappe'},
  '0081':{s:'MAGICAL',st:'mappe'},'0084':{s:'OPAL',st:'mappe'},'0103':{s:'GOLD BMO',st:'mappe'},
  '0116':{s:'BIOACTYL SUPERBE',st:'mappe'},'0119':{s:'HUMOCAL',st:'mappe'},'0133':{s:'RHIZO AMINE',st:'mappe'},
  '0139':{s:'RHIZO HUMUS',st:'mappe'},'0140':{s:'RHIZO HUMUS',st:'mappe'},'0167':{s:'DEPTIL PA5',st:'mappe'},
  '0239':{s:'ORIS',st:'mappe'},'0340':{s:'SULFATE DE MAGNESIE',st:'mappe'},'0344':{s:'ACIDE PHOSPHORIQUE',st:'mappe'},
  '0352':{s:'RHIZO MN ZN',st:'mappe'},'0454':{s:'AMMONITRATE',st:'mappe'},'0465':{s:'ACIDE NITRIQUE',st:'mappe'},
  '0046':{s:'GZ',st:'mappe'},'0260':{s:'URÉE 46%',st:'mappe'},
  // a_valider (cible suggérée, magasinier confirme ; alias = nom correct sur clé typo)
  '0020':{s:null,st:'a_valider'},'0021':{s:'NITRETE DE POTASSE',st:'a_valider',alias:'NITRATE DE POTASSE'},
  '0427':{s:'NITRETE DE POTASSE',st:'a_valider',alias:'NITRATE DE POTASSE'},
  '0085':{s:'KSC MIX',st:'a_valider'},'0088':{s:'KSC 1',st:'a_valider'},'0091':{s:'KSC 2',st:'a_valider'},
  '0094':{s:'KSC 3',st:'a_valider'},'0097':{s:null,st:'a_valider'},'0100':{s:'SULFACIDE',st:'a_valider'},
  '0101':{s:'KSC 7',st:'a_valider'},'0134':{s:'RHIZO BOR',st:'a_valider',alias:'RHIZO BORE'},
  '0137':{s:'RHIZO CAL',st:'a_valider'},'0265':{s:"SULFATE D'AMMONIAQUE",st:'a_valider'},
  '0399':{s:'MAP (GK)',st:'a_valider'},'0407':{s:'MAP (GK)',st:'a_valider'},
  '0535':{s:'ACIDE SULFRIQUE',st:'a_valider',alias:'ACIDE SULFURIQUE'},
  // hors_campagne
  '0033':{s:null,st:'hors_campagne'},'0072':{s:null,st:'hors_campagne'},'0218':{s:null,st:'hors_campagne'},
  '0316':{s:null,st:'hors_campagne'},'0422':{s:null,st:'hors_campagne'},'0327':{s:null,st:'hors_campagne'},
  '0353':{s:null,st:'hors_campagne'},'0482':{s:null,st:'hors_campagne'},
};
(async()=>{
  const apply=process.argv.includes('--apply');
  const dir='/Users/omarmaaouni/Desktop/berrygood-dashboard/docs/FACTURES/TIMAC';
  const desig={}; // code -> designation
  for(const f of fs.readdirSync(dir).filter(f=>/\.pdf$/i.test(f))){let r;try{r=await parseTimacInvoicePdf(fs.readFileSync(dir+'/'+f));}catch(e){continue;}(r.lignes||[]).forEach(l=>{if(l.code_article&&!desig[l.code_article])desig[l.code_article]=l.designation;});}
  // stock keys existantes
  const bal=await db.collection('stock_balances').get();const stock=new Set();bal.forEach(d=>{const b=d.data();stock.add(canon(b.article_ref||b.article_nom));});
  const rows=[];let bad=0;
  Object.keys(D).sort().forEach(code=>{const d=D[code];let stk=d.s,st=d.st;
    if(stk&&!stock.has(canon(stk))){st='a_mapper';bad++;}  // cible inexistante -> a_mapper
    rows.push({code,designation:desig[code]||'?',article_stock:stk,statut:st,alias:d.alias||null});});
  const cnt={};rows.forEach(r=>cnt[r.statut]=(cnt[r.statut]||0)+1);
  console.log(`mapping_articles: ${rows.length} codes | ${JSON.stringify(cnt)} | cibles inexistantes corrigées->a_mapper: ${bad}`);
  rows.filter(r=>r.statut==='mappe').forEach(r=>console.log(`  ${r.code} ${r.designation.slice(0,30).padEnd(30)} -> ${r.article_stock} [mappe]`));
  if(!apply){console.log("\n(DRY-RUN — relancer avec --apply pour écrire)");process.exit(0);}
  const batch=db.batch();
  rows.forEach(r=>batch.set(db.collection('mapping_articles').doc('timac_'+r.code),{fournisseur:'TIMAC',code_fournisseur:r.code,designation_fournisseur:r.designation,article_stock:r.article_stock,alias:r.alias,statut:r.statut,source:'code_timac',updated_at:Date.now()}));
  await batch.commit();
  console.log("\n✅ SEED ÉCRIT : "+rows.length+" docs mapping_articles");
  process.exit(0);
})();
