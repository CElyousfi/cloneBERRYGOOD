// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: chart-bar;

// BGF — Rendement F5 (Large Widget)

const API = 'https://berrygood-farms-dashboard.web.app/api/pointage-rh';
const URL_DASH = 'https://berrygood-farms-dashboard.web.app';
const TEST_DATE = '';
const FERME = 'F5';

const C = {
  bg: new Color('#0b1118'),
  border: new Color('#1e3a2a'),
  accent: new Color('#4a90d9'),
  accentDim: new Color('#1a2a3a'),
  gold: new Color('#FFD700'),
  green: new Color('#3daa5e'),
  white: new Color('#ffffff'),
  t1: new Color('#e8ecf0'),
  t2: new Color('#7a8a9a'),
  t3: new Color('#4a5a6a'),
  barBg: new Color('#162030'),
  barGood: new Color('#3daa5e'),
  barMid: new Color('#E67E22'),
  barLow: new Color('#e74c3c'),
};

const EQ = {
  'MM':'Boucharen','AY':'Chelihat','HT':'El Bachir','HA':'El Hafi',
  'KR':'Farid','NA':'Larache','JA':'Ksr Femme','AZ':'Chahdi',
  'CC':'Sektoui','CA':'Regragi','RE':'Dechira','DD':'DD','NV':'NV'
};

const MYRT = ['corina','cascade','breeze','blue','myrtille'];
function isMyr(v, p) {
  const a = (v||'').toLowerCase(), b = (p||'').toLowerCase();
  return MYRT.some(m => a.includes(m) || b.includes(m));
}

function getEq(m) { if (!m) return 'NV'; return m.toUpperCase().trim().substring(0,2); }

function avgColor(avg) {
  if (avg >= 25) return C.barGood;
  if (avg >= 20) return C.barMid;
  return C.barLow;
}

async function getData() {
  try {
    const dp = TEST_DATE ? `&date=${TEST_DATE}` : '';
    const req = new Request(API + '?action=recolte' + dp);
    req.timeoutInterval = 15;
    const d = await req.loadJSON();
    if (!d.success) return null;

    const skip = /caporal|conditionnement|encadrement|poste|chargement/i;
    const workers = (d.workers||[]).filter(w => !skip.test(w.operation) && w.ferme === FERME);

    if (workers.length === 0) return null;

    // Group by parcelle then equipe
    const byParcelle = {};
    workers.forEach(w => {
      const p = w.parcelle || '—';
      if (!byParcelle[p]) byParcelle[p] = {};
      const eq = getEq(w.matricule);
      if (!byParcelle[p][eq]) byParcelle[p][eq] = { prefix: eq, nom: EQ[eq]||eq, kg: 0, nb: 0, myrt: 0 };
      byParcelle[p][eq].kg += (w.quantite||0);
      byParcelle[p][eq].nb++;
      if (isMyr(w.variete, w.parcelle)) byParcelle[p][eq].myrt++;
    });

    const parcelles = Object.entries(byParcelle).map(([p, eqs]) => {
      const equipes = Object.values(eqs)
        .map(eq => ({ ...eq, avg: eq.nb > 0 ? eq.kg / eq.nb : 0, isMyrtille: eq.myrt > eq.nb / 2 }))
        .sort((a, b) => b.avg - a.avg);
      const totalKg = equipes.reduce((s, e) => s + e.kg, 0);
      const totalNb = equipes.reduce((s, e) => s + e.nb, 0);
      return { parcelle: p, equipes, totalKg, totalNb };
    }).sort((a, b) => b.totalKg - a.totalKg);

    const totalKg = workers.reduce((s, w) => s + (w.quantite||0), 0);

    return { parcelles, totalKg: Math.round(totalKg), nbW: workers.length, date: d.date };
  } catch(e) { return null; }
}

function t(s, text, font, color) {
  const x = s.addText(text); x.font = font; x.textColor = color; x.lineLimit = 1; return x;
}

async function main() {
  const d = await getData();
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(12, 14, 8, 14);
  w.url = URL_DASH;

  if (!d) {
    const h = w.addStack(); h.layoutHorizontally(); h.centerAlignContent(); h.spacing = 6;
    t(h, '🫐', Font.systemFont(16), C.white);
    t(h, `RENDEMENT ${FERME}`, Font.boldSystemFont(15), C.white);
    w.addSpacer(8);
    t(w, 'Pas de récolte', Font.systemFont(14), C.t2);
  } else {
    // Header
    const h = w.addStack(); h.layoutHorizontally(); h.centerAlignContent(); h.spacing = 6;
    t(h, '🫐', Font.systemFont(16), C.white);
    t(h, `RENDEMENT ${FERME}`, Font.boldSystemFont(15), C.white);
    h.addSpacer();
    const badge = h.addStack(); badge.backgroundColor = C.accent; badge.cornerRadius = 10; badge.setPadding(3,10,3,10);
    t(badge, `${d.totalKg} kg`, Font.boldSystemFont(12), C.white);

    w.addSpacer(4);

    // Scale legend
    const sc = w.addStack(); sc.layoutHorizontally();
    sc.addSpacer();
    const scl = sc.addStack(); scl.layoutHorizontally(); scl.spacing = 6;
    t(scl, '●<20', Font.systemFont(9), C.barLow);
    t(scl, '●20-25', Font.systemFont(9), C.barMid);
    t(scl, '●≥25', Font.systemFont(9), C.barGood);
    t(scl, 'kg/ouv.', Font.systemFont(9), C.t3);

    w.addSpacer(4);

    // For each parcelle
    let rowCount = 0;
    const maxRows = 16;

    for (const parc of d.parcelles) {
      if (rowCount >= maxRows) break;

      // Parcelle header
      const ph = w.addStack(); ph.layoutHorizontally(); ph.centerAlignContent(); ph.spacing = 4;
      const pDot = ph.addStack(); pDot.size = new Size(4, 4); pDot.backgroundColor = C.accent; pDot.cornerRadius = 2;
      t(ph, parc.parcelle, Font.systemFont(10), C.t2);
      ph.addSpacer();
      t(ph, `${Math.round(parc.totalKg)} kg · ${parc.totalNb} ouv.`, Font.systemFont(9), C.t3);
      w.addSpacer(2);
      rowCount++;

      // Equipes
      const maxAvg = 35;
      for (let i = 0; i < parc.equipes.length && rowCount < maxRows; i++) {
        const eq = parc.equipes[i];
        const row = w.addStack(); row.layoutHorizontally(); row.centerAlignContent(); row.spacing = 4;

        // Culture icon
        t(row, eq.isMyrtille ? '🫐' : '🍓', Font.systemFont(11), C.white);

        // Rank
        const rkC = i === 0 ? C.gold : i < 3 ? C.accent : C.t3;
        const rk = t(row, `${i+1}`, Font.boldSystemFont(11), rkC);
        rk.size = new Size(12, 0);

        // Name
        const nmBox = row.addStack(); nmBox.size = new Size(70, 15); nmBox.layoutHorizontally();
        t(nmBox, eq.nom, Font.mediumSystemFont(11), C.t1);

        // Bar
        const barW = 115;
        const fillPct = Math.min(eq.avg / maxAvg, 1);
        const fillW = Math.max(3, Math.round(barW * fillPct));
        const emptyW = barW - fillW;

        const barStack = row.addStack();
        barStack.layoutHorizontally();
        barStack.centerAlignContent();
        barStack.size = new Size(barW, 12);

        const barFill = barStack.addStack();
        barFill.size = new Size(fillW, 10);
        barFill.backgroundColor = avgColor(eq.avg);
        barFill.cornerRadius = 3;

        if (emptyW > 0) {
          const barEmpty = barStack.addStack();
          barEmpty.size = new Size(emptyW, 10);
          barEmpty.backgroundColor = C.barBg;
          barEmpty.cornerRadius = 3;
        }

        row.addSpacer();

        // Avg
        t(row, eq.avg.toFixed(1), Font.boldSystemFont(12), avgColor(eq.avg));
        t(row, `(${eq.nb})`, Font.systemFont(9), C.t3);

        w.addSpacer(1);
        rowCount++;
      }
    }
  }

  w.addSpacer();
  const ft = w.addStack(); ft.layoutHorizontally();
  t(ft, `${FERME} · Myrtille/Framboise Laaouamra`, Font.systemFont(9), C.t3);
  ft.addSpacer();
  t(ft, new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}), Font.systemFont(9), C.t3);

  if (config.runsInWidget) Script.setWidget(w);
  else await w.presentLarge();
  Script.complete();
}

await main();
