// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: chart-bar;

// BGF — Récolte par Équipe (Medium Widget)

const API = 'https://berrygood-farms-dashboard.web.app/api/pointage-rh';
const URL_DASH = 'https://berrygood-farms-dashboard.web.app';
const TEST_DATE = '';

const C = {
  bg: new Color('#0b1118'),
  card: new Color('#111d2b'),
  border: new Color('#1e3a2a'),
  accent: new Color('#3daa5e'),
  accentDim: new Color('#2D8B4E', 0.5),
  blue: new Color('#4a90d9'),
  orange: new Color('#E67E22'),
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
const FC = { 'F1': C.accent, 'F5': C.blue, 'Avocatier': C.orange };

function getEq(m) { if (!m) return 'NV'; return m.toUpperCase().trim().substring(0,2); }

async function getData() {
  try {
    const dp = TEST_DATE ? `&date=${TEST_DATE}` : '';
    const req = new Request(API + '?action=recolte' + dp);
    req.timeoutInterval = 15;
    const d = await req.loadJSON();
    if (!d.success) return null;

    const skip = /caporal|conditionnement|encadrement|poste|chargement/i;
    const workers = (d.workers||[]).filter(w => !skip.test(w.operation)).sort((a,b) => (b.quantite||0)-(a.quantite||0));

    const byEq = {};
    workers.forEach(w => {
      const eq = getEq(w.matricule);
      if (!byEq[eq]) byEq[eq] = {prefix:eq, nom:EQ[eq]||eq, kg:0, nb:0};
      byEq[eq].kg += (w.quantite||0); byEq[eq].nb++;
    });

    const byFerme = {};
    workers.forEach(w => {
      const f = w.ferme||'?';
      if (!byFerme[f]) byFerme[f] = {kg:0,nb:0};
      byFerme[f].kg += (w.quantite||0); byFerme[f].nb++;
    });

    const totalKg = d.totalKgCueillette || Math.round(workers.reduce((s,w) => s+(w.quantite||0), 0));

    if (workers.length === 0) return null;
    return {
      eqs: Object.values(byEq).sort((a,b) => b.kg-a.kg),
      byFerme, totalKg, nbW: workers.length, date: d.date,
    };
  } catch(e) { return null; }
}

function t(s, text, font, color) {
  const x = s.addText(text); x.font = font; x.textColor = color; x.lineLimit = 1; return x;
}

async function main() {
  const d = await getData();
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14,16,12,16);
  w.url = URL_DASH;

  if (!d) { t(w,'Pas de données',Font.mediumSystemFont(14),C.white); }
  else {
    // Header
    const h = w.addStack(); h.layoutHorizontally(); h.centerAlignContent(); h.spacing = 6;
    t(h,'🫐',Font.systemFont(14),C.white);
    t(h,'RÉCOLTE — PAR ÉQUIPE',Font.boldSystemFont(12),C.white);
    h.addSpacer();
    t(h,`${d.totalKg.toLocaleString('fr-FR')} kg`,Font.boldSystemFont(12),C.accent);

    w.addSpacer(8);

    // Bar chart: top 5 equipes
    const topEq = d.eqs.slice(0, 5);
    const maxKg = topEq.length > 0 ? topEq[0].kg : 1;

    for (let i = 0; i < topEq.length; i++) {
      const eq = topEq[i];
      const row = w.addStack(); row.layoutHorizontally(); row.centerAlignContent(); row.spacing = 6;

      // Rank
      const rkC = i===0 ? C.gold : i<3 ? C.accent : C.t3;
      const rk = t(row, `${i+1}`, Font.boldSystemFont(11), rkC);
      rk.size = new Size(14,0);

      // Name
      const nm = t(row, eq.nom, Font.mediumSystemFont(11), C.t1);
      nm.size = new Size(75,0);

      // Bar
      const bW = 130;
      const barBg = row.addStack(); barBg.size = new Size(bW,14); barBg.backgroundColor = C.barBg; barBg.cornerRadius = 4;
      const fillW = Math.max(4, Math.round(bW * eq.kg / maxKg));
      const barFill = barBg.addStack(); barFill.size = new Size(fillW,14);
      barFill.backgroundColor = i===0 ? C.accent : C.accentDim; barFill.cornerRadius = 4;

      row.addSpacer();

      // KG
      t(row, `${Math.round(eq.kg)}`, Font.boldSystemFont(12), C.white);

      w.addSpacer(3);
    }

    w.addSpacer(6);

    // Separator
    const sep = w.addStack(); sep.size = new Size(0,1); sep.backgroundColor = C.border; sep.addSpacer();
    w.addSpacer(6);

    // Ferme legend
    const leg = w.addStack(); leg.layoutHorizontally(); leg.spacing = 0;
    for (const f of ['F1','F5','Avocatier']) {
      const info = d.byFerme[f]; if (!info) continue;
      const lc = leg.addStack(); lc.layoutVertically(); lc.size = new Size(0,0);
      const ld = lc.addStack(); ld.layoutHorizontally(); ld.centerAlignContent(); ld.spacing = 4;
      const dd = ld.addStack(); dd.size = new Size(6,6); dd.backgroundColor = FC[f]; dd.cornerRadius = 3;
      t(ld, f, Font.mediumSystemFont(9), C.t2);
      t(lc, Math.round(info.kg).toLocaleString('fr-FR'), Font.boldSystemFont(15), C.white);
      t(lc, 'KG', Font.boldSystemFont(8), C.t2);
    }
  }

  if (config.runsInWidget) Script.setWidget(w);
  else await w.presentMedium();
  Script.complete();
}

await main();
