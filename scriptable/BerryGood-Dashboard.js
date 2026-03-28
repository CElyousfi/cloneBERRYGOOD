// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: seedling;

// ================================================
//  Berry Good Farms — Dashboard Widget (Large)
//  KPI: Framboise + Myrtille | Pointage | Équipes
// ================================================

const API = 'https://berrygood-farms-dashboard.web.app/api/pointage-rh';
const DASHBOARD_URL = 'https://berrygood-farms-dashboard.web.app';

// TEST: fixe à hier. Supprimer pour utiliser aujourd'hui.
const TEST_DATE = '';

// Colors
const C = {
  bg: new Color('#0b1118'),
  card: new Color('#111d2b'),
  border: new Color('#1e3a2a'),
  accent: new Color('#3daa5e'),
  accentDim: new Color('#1a3028'),
  berry: new Color('#c2185b'),
  berryDim: new Color('#2a1520'),
  purple: new Color('#7b1fa2'),
  purpleDim: new Color('#1a1530'),
  red: new Color('#e74c3c'),
  orange: new Color('#E67E22'),
  blue: new Color('#4a90d9'),
  gold: new Color('#FFD700'),
  white: new Color('#ffffff'),
  t1: new Color('#e8ecf0'),
  t2: new Color('#7a8a9a'),
  t3: new Color('#4a5a6a'),
  barBg: new Color('#162030'),
};

const EQ = {
  'MM':'Boucharen','AY':'Chelihat','HT':'El Bachir','HA':'El Hafi',
  'KR':'Farid','NA':'Larache','JA':'Ksr Femme','AZ':'Chahdi',
  'CC':'Sektoui','CA':'Regragi','RE':'Dechira','NV':'NV'
};

const FERME_C = { 'F1': C.accent, 'F5': C.blue, 'Avocatier': C.orange };

// Myrtille varieties
const MYRTILLE_VARS = ['corina','cascade','breeze','blue','myrtille'];

function isMyrtille(variete, parcelle) {
  const v = (variete || '').toLowerCase();
  const p = (parcelle || '').toLowerCase();
  return MYRTILLE_VARS.some(m => v.includes(m) || p.includes(m));
}

function getEq(m) { if (!m) return 'NV'; return m.toUpperCase().trim().substring(0,2); }
function fmtDate(d) {
  const dt = d ? new Date(d+'T12:00:00') : new Date();
  return ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][dt.getDay()] + ' ' + dt.getDate() + ' ' + ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][dt.getMonth()];
}

// ── Fetch ──
async function fetchData() {
  try {
    const dp = TEST_DATE ? `&date=${TEST_DATE}` : '';
    const [sum, rec] = await Promise.all([
      new Request(API + '?action=summary' + dp).loadJSON(),
      new Request(API + '?action=recolte' + dp).loadJSON(),
    ]);

    const eff = sum.effectif || {};
    let totR=0, totHR=0, totPF=0;
    const pf = {};
    ['F1','F5','Avocatier'].forEach(f => {
      const e = eff[f] || {recolte:0,horsRecolte:0,postesFixes:0};
      pf[f] = e;
      totR += e.recolte; totHR += e.horsRecolte; totPF += e.postesFixes;
    });

    const skip = /caporal|conditionnement|encadrement|poste|chargement/i;
    const workers = (rec.workers||[]).filter(w => !skip.test(w.operation)).sort((a,b) => (b.quantite||0)-(a.quantite||0));

    // Récolte par culture
    let kgFramboise = 0, kgMyrtille = 0, nbFramboise = 0, nbMyrtille = 0;
    workers.forEach(w => {
      if (isMyrtille(w.variete, w.parcelle)) {
        kgMyrtille += (w.quantite||0); nbMyrtille++;
      } else {
        kgFramboise += (w.quantite||0); nbFramboise++;
      }
    });

    // Also use cueillette for more accurate kg
    let cueilFramb = 0, cueilMyrt = 0;
    (rec.cueillette||[]).forEach(c => {
      if (isMyrtille(c.variete, c.parcelle)) cueilMyrt += (c.totalKg||0);
      else cueilFramb += (c.totalKg||0);
    });
    // Prefer cueillette totals if available
    if (cueilFramb > 0 || cueilMyrt > 0) {
      kgFramboise = cueilFramb;
      kgMyrtille = cueilMyrt;
    }

    const byFerme = {};
    workers.forEach(w => {
      const f = w.ferme||'?';
      if (!byFerme[f]) byFerme[f] = {kg:0,nb:0};
      byFerme[f].kg += (w.quantite||0); byFerme[f].nb++;
    });

    const byEq = {};
    workers.forEach(w => {
      const eq = getEq(w.matricule);
      if (!byEq[eq]) byEq[eq] = {prefix:eq, nom:EQ[eq]||eq, kg:0, nb:0};
      byEq[eq].kg += (w.quantite||0); byEq[eq].nb++;
    });

    if (totR + totHR + totPF === 0 && workers.length === 0) return null;
    return {
      date: sum.date || rec.date,
      pt: {r:totR, hr:totHR, pf:totPF, total:totR+totHR+totPF},
      pj: sum.pointageJour || [],
      pf, byFerme,
      eqs: Object.values(byEq).sort((a,b) => b.kg-a.kg),
      totalKg: rec.totalKgCueillette || Math.round(workers.reduce((s,w) => s+(w.quantite||0), 0)),
      kgFramboise: Math.round(kgFramboise),
      kgMyrtille: Math.round(kgMyrtille),
      nbFramboise, nbMyrtille,
      nbW: workers.length,
    };
  } catch(e) { console.error(e); return null; }
}

// ── Helpers ──
function t(s, text, font, color) {
  const x = s.addText(text); x.font = font; x.textColor = color; x.lineLimit = 1; return x;
}

function card(parent) {
  const c = parent.addStack();
  c.backgroundColor = C.card;
  c.cornerRadius = 14;
  c.borderWidth = 1;
  c.borderColor = C.border;
  c.setPadding(12,14,12,14);
  c.layoutVertically();
  return c;
}

// ── Widget ──
function build(d) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14,14,10,14);
  w.url = DASHBOARD_URL;

  if (!d) { t(w,'Pas de données',Font.mediumSystemFont(14),C.white); return w; }

  // ━━━ TOP: 2 KPI — Framboise + Myrtille ━━━
  const top = w.addStack();
  top.layoutHorizontally();
  top.spacing = 8;

  // KPI 1: Framboise
  const k1 = card(top); k1.size = new Size(0,0);
  const k1h = k1.addStack(); k1h.layoutHorizontally(); k1h.centerAlignContent();
  t(k1h,'BGF',Font.boldSystemFont(12),C.berry);
  k1h.addSpacer();
  t(k1h,'🍓',Font.systemFont(24),C.white);
  k1.addSpacer(8);
  const k1v = k1.addStack(); k1v.layoutHorizontally(); k1v.bottomAlignContent();
  const fStr = d.kgFramboise >= 1000 ? (d.kgFramboise/1000).toFixed(1) : `${d.kgFramboise}`;
  t(k1v, fStr, Font.boldSystemFont(34), C.white);
  t(k1v, d.kgFramboise >= 1000 ? ' T' : ' kg', Font.mediumSystemFont(16), C.t2);
  k1.addSpacer(2);
  t(k1,'Framboise',Font.systemFont(11),C.t2);
  k1.addSpacer(6);
  const fb = k1.addStack(); fb.backgroundColor = C.berryDim; fb.cornerRadius = 10; fb.setPadding(3,8,3,8);
  fb.layoutHorizontally(); fb.centerAlignContent(); fb.spacing = 4;
  t(fb,'👥',Font.systemFont(9),C.berry);
  t(fb,`${d.nbFramboise} ouv.`,Font.boldSystemFont(10),C.berry);

  // KPI 2: Myrtille
  const k2 = card(top); k2.size = new Size(0,0);
  const k2h = k2.addStack(); k2h.layoutHorizontally(); k2h.centerAlignContent();
  t(k2h,'BGF',Font.boldSystemFont(12),C.purple);
  k2h.addSpacer();
  t(k2h,'🫐',Font.systemFont(24),C.white);
  k2.addSpacer(8);
  const k2v = k2.addStack(); k2v.layoutHorizontally(); k2v.bottomAlignContent();
  const mStr = d.kgMyrtille >= 1000 ? (d.kgMyrtille/1000).toFixed(1) : `${d.kgMyrtille || 0}`;
  t(k2v, mStr, Font.boldSystemFont(34), C.white);
  t(k2v, d.kgMyrtille >= 1000 ? ' T' : ' kg', Font.mediumSystemFont(16), C.t2);
  k2.addSpacer(2);
  t(k2,'Myrtille',Font.systemFont(11),C.t2);
  k2.addSpacer(6);
  const mb = k2.addStack(); mb.backgroundColor = C.purpleDim; mb.cornerRadius = 10; mb.setPadding(3,8,3,8);
  mb.layoutHorizontally(); mb.centerAlignContent(); mb.spacing = 4;
  t(mb,'👥',Font.systemFont(9),C.purple);
  t(mb,`${d.nbMyrtille} ouv.`,Font.boldSystemFont(10),C.purple);

  w.addSpacer(8);

  // ━━━ MIDDLE: Pointage par Ferme ━━━
  const mid = card(w);
  const mh = mid.addStack(); mh.layoutHorizontally(); mh.centerAlignContent(); mh.spacing = 6;
  t(mh,'🍇',Font.systemFont(14),C.white);
  t(mh,'BERRY GOOD FARMS',Font.boldSystemFont(13),C.white);
  mh.addSpacer();
  t(mh,fmtDate(d.date),Font.systemFont(10),C.t2);
  mid.addSpacer(10);

  // 3 ferme columns
  const cols = mid.addStack(); cols.layoutHorizontally(); cols.spacing = 0;
  for (const f of ['F1','F5','Avocatier']) {
    const e = d.pf[f] || {};
    const rkg = d.byFerme[f] || {kg:0,nb:0};
    const tot = (e.recolte||0) + (e.horsRecolte||0) + (e.postesFixes||0);
    const pjf = d.pj.find(x => x.ferme === f) || {};

    const col = cols.addStack(); col.layoutVertically(); col.size = new Size(0,0);

    const lb = col.addStack(); lb.layoutHorizontally(); lb.centerAlignContent(); lb.spacing = 4;
    const dot = lb.addStack(); dot.size = new Size(8,8); dot.backgroundColor = FERME_C[f]; dot.cornerRadius = 4;
    t(lb, f === 'Avocatier' ? 'AVOCATIER' : f, Font.mediumSystemFont(11), C.t2);

    col.addSpacer(4);
    t(col, `${tot}`, Font.boldSystemFont(24), C.white);
    t(col, 'ouvriers', Font.systemFont(8), C.t2);
    col.addSpacer(4);

    // Breakdown
    const detail = col.addStack(); detail.layoutHorizontally(); detail.spacing = 3;
    t(detail, `${e.recolte||0}R`, Font.boldSystemFont(8), C.accent);
    t(detail, `${e.horsRecolte||0}HR`, Font.boldSystemFont(8), C.blue);
    t(detail, `${e.postesFixes||0}PF`, Font.boldSystemFont(8), C.orange);

    // Kg récolte
    col.addSpacer(4);
    const kgBadge = col.addStack();
    kgBadge.backgroundColor = C.accentDim;
    kgBadge.cornerRadius = 8;
    kgBadge.setPadding(2,6,2,6);
    t(kgBadge, `${Math.round(rkg.kg).toLocaleString('fr-FR')} kg`, Font.boldSystemFont(9), C.accent);

    // Diff vs veille
    if (pjf.diff !== undefined && pjf.diff !== 0) {
      col.addSpacer(3);
      const dB = col.addStack(); dB.backgroundColor = pjf.diff > 0 ? C.accentDim : new Color('#3a1a1a');
      dB.cornerRadius = 8; dB.setPadding(2,6,2,6);
      t(dB, `${pjf.diff > 0 ? '↑ +' : '↓ '}${Math.round(pjf.diff)}%`, Font.boldSystemFont(8), pjf.diff > 0 ? C.accent : C.red);
    }
  }

  w.addSpacer(8);

  // ━━━ BOTTOM: Récolte par Équipe ━━━
  const bot = card(w);
  const bh = bot.addStack(); bh.layoutHorizontally(); bh.centerAlignContent(); bh.spacing = 6;
  t(bh,'🫐',Font.systemFont(13),C.white);
  t(bh,'RÉCOLTE — PAR ÉQUIPE',Font.boldSystemFont(12),C.white);
  bh.addSpacer();
  t(bh,`${d.totalKg.toLocaleString('fr-FR')} kg`,Font.boldSystemFont(11),C.accent);
  bot.addSpacer(6);

  const topEq = d.eqs.slice(0,7);
  const maxKg = topEq.length > 0 ? topEq[0].kg : 1;

  for (let i = 0; i < topEq.length; i++) {
    const eq = topEq[i];
    const row = bot.addStack(); row.layoutHorizontally(); row.centerAlignContent(); row.spacing = 6;

    const rkC = i===0 ? C.gold : i<3 ? C.accent : C.t3;
    const rk = t(row, `${i+1}`, Font.boldSystemFont(10), rkC);
    rk.size = new Size(14,0);

    const nm = t(row, eq.nom, Font.mediumSystemFont(10), C.t1);
    nm.size = new Size(70,0);

    // Bar
    const bW = 105;
    const barBg = row.addStack(); barBg.size = new Size(bW,12); barBg.backgroundColor = C.barBg; barBg.cornerRadius = 4;
    const fillW = Math.max(4, Math.round(bW * eq.kg / maxKg));
    const barFill = barBg.addStack(); barFill.size = new Size(fillW,12);
    barFill.backgroundColor = i===0 ? C.accent : new Color('#2D8B4E',0.5); barFill.cornerRadius = 4;

    row.addSpacer();
    t(row, `${Math.round(eq.kg)}`, Font.boldSystemFont(11), C.white);
    t(row, ` (${eq.nb})`, Font.systemFont(8), C.t3);
    bot.addSpacer(2);
  }

  // Separator + ferme legend
  bot.addSpacer(4);
  const sep = bot.addStack(); sep.size = new Size(0,1); sep.backgroundColor = C.border; sep.addSpacer();
  bot.addSpacer(6);

  const leg = bot.addStack(); leg.layoutHorizontally(); leg.spacing = 0;
  for (const f of ['F1','F5','Avocatier']) {
    const info = d.byFerme[f]; if (!info) continue;
    const lc = leg.addStack(); lc.layoutVertically(); lc.size = new Size(0,0);
    const ld = lc.addStack(); ld.layoutHorizontally(); ld.centerAlignContent(); ld.spacing = 4;
    const dd = ld.addStack(); dd.size = new Size(6,6); dd.backgroundColor = FERME_C[f]; dd.cornerRadius = 3;
    t(ld, f, Font.mediumSystemFont(9), C.t2);
    t(lc, Math.round(info.kg).toLocaleString('fr-FR'), Font.boldSystemFont(14), C.white);
    t(lc, 'KG', Font.boldSystemFont(8), C.t2);
  }

  w.addSpacer();

  // Footer
  const ft = w.addStack(); ft.layoutHorizontally();
  t(ft, 'MàJ ' + new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}), Font.systemFont(8), C.t3);
  ft.addSpacer();
  t(ft, 'Tap → Dashboard RH', Font.systemFont(8), C.t3);

  return w;
}

async function main() {
  const data = await fetchData();
  const widget = build(data);
  if (config.runsInWidget) { Script.setWidget(widget); }
  else { await widget.presentLarge(); }
  Script.complete();
}

await main();
