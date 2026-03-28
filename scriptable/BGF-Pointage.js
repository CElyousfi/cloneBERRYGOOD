// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: users;

// BGF — Pointage du Jour (Medium Widget)

const API = 'https://berrygood-farms-dashboard.web.app/api/pointage-rh';
const URL_DASH = 'https://berrygood-farms-dashboard.web.app';
const TEST_DATE = '';

const C = {
  bg: new Color('#0b1118'),
  card: new Color('#111d2b'),
  border: new Color('#1e3a2a'),
  accent: new Color('#3daa5e'),
  accentDim: new Color('#1a3028'),
  blue: new Color('#4a90d9'),
  orange: new Color('#E67E22'),
  red: new Color('#e74c3c'),
  white: new Color('#ffffff'),
  t2: new Color('#7a8a9a'),
  t3: new Color('#4a5a6a'),
};

const FC = { 'F1': C.accent, 'F5': C.blue, 'Avocatier': C.orange };

function fmtDate(d) {
  const dt = d ? new Date(d+'T12:00:00') : new Date();
  return ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][dt.getDay()] + ' ' + dt.getDate() + ' ' + ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][dt.getMonth()];
}

async function getData() {
  try {
    const dp = TEST_DATE ? `&date=${TEST_DATE}` : '';
    const req = new Request(API + '?action=summary' + dp);
    req.timeoutInterval = 15;
    const d = await req.loadJSON();
    if (!d.success) return null;
    const totalOuv = (d.pointageJour || []).reduce((s, x) => s + (x.total || 0), 0);
    if (totalOuv === 0) return null;
    return d;
  } catch(e) { return null; }
}

function t(s, text, font, color) {
  const x = s.addText(text); x.font = font; x.textColor = color; x.lineLimit = 1; return x;
}

async function main() {
  const d = await getData();
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14,16,14,16);
  w.url = URL_DASH;

  if (!d) { t(w,'Pas de données',Font.mediumSystemFont(14),C.white); }
  else {
    // Header
    const h = w.addStack(); h.layoutHorizontally(); h.centerAlignContent(); h.spacing = 6;
    t(h,'🍇',Font.systemFont(14),C.white);
    t(h,'BERRY GOOD FARMS',Font.boldSystemFont(13),C.white);
    h.addSpacer();
    t(h,fmtDate(d.date),Font.systemFont(10),C.t2);

    w.addSpacer(4);

    // Total badge (bulle)
    const pj = d.pointageJour || [];
    const totalOuv = pj.reduce((s,x) => s + (x.total||0), 0);
    const badgeRow = w.addStack(); badgeRow.layoutHorizontally();
    badgeRow.addSpacer();
    const badge = badgeRow.addStack();
    badge.backgroundColor = C.accent;
    badge.cornerRadius = 18;
    badge.setPadding(6,14,6,14);
    badge.layoutVertically();
    const bVal = badge.addText(`${totalOuv}`); bVal.font = Font.boldSystemFont(20); bVal.textColor = C.white; bVal.centerAlignText();
    const bLbl = badge.addText('ouvriers'); bLbl.font = Font.systemFont(8); bLbl.textColor = new Color('#ffffff', 0.8); bLbl.centerAlignText();

    w.addSpacer(10);

    // 3 ferme columns
    const cols = w.addStack(); cols.layoutHorizontally(); cols.spacing = 0;

    for (const f of ['F1','F5','Avocatier']) {
      const pjf = pj.find(x => x.ferme === f) || {};
      const eff = (d.effectif||{})[f] || {};
      const tot = pjf.total || 0;
      const r = eff.recolte || 0;
      const hr = eff.horsRecolte || 0;
      const pf = eff.postesFixes || 0;

      const col = cols.addStack(); col.layoutVertically(); col.size = new Size(0,0);

      // Dot + label
      const lb = col.addStack(); lb.layoutHorizontally(); lb.centerAlignContent(); lb.spacing = 4;
      const dot = lb.addStack(); dot.size = new Size(8,8); dot.backgroundColor = FC[f]; dot.cornerRadius = 4;
      t(lb, f === 'Avocatier' ? 'AVOCATIER' : f, Font.mediumSystemFont(11), C.t2);

      col.addSpacer(4);

      // Big number
      t(col, `${tot}`, Font.boldSystemFont(28), C.white);
      t(col, 'ouvriers', Font.systemFont(8), C.t2);

      col.addSpacer(6);

      // R / HR / PF
      const det = col.addStack(); det.layoutHorizontally(); det.spacing = 3;
      t(det, `${r}R`, Font.boldSystemFont(9), C.accent);
      t(det, `${hr}HR`, Font.boldSystemFont(9), C.blue);
      t(det, `${pf}PF`, Font.boldSystemFont(9), C.orange);

      // Diff vs veille
      if (pjf.diff !== undefined && pjf.diff !== 0) {
        col.addSpacer(4);
        const dB = col.addStack();
        dB.backgroundColor = pjf.diff > 0 ? C.accentDim : new Color('#3a1a1a');
        dB.cornerRadius = 8; dB.setPadding(2,6,2,6);
        t(dB, `${pjf.diff > 0 ? '↑ +' : '↓ '}${Math.round(pjf.diff)}%`, Font.boldSystemFont(9), pjf.diff > 0 ? C.accent : C.red);
      }
    }

    w.addSpacer(8);

    // Total bar
    const eff = d.effectif || {};
    let totR=0, totHR=0, totPF=0;
    ['F1','F5','Avocatier'].forEach(f => {
      const e = eff[f]||{}; totR += e.recolte||0; totHR += e.horsRecolte||0; totPF += e.postesFixes||0;
    });
    const total = totR + totHR + totPF;

    const bar = w.addStack(); bar.layoutHorizontally(); bar.spacing = 0;
    bar.cornerRadius = 4;

    if (total > 0) {
      const bW = 310;
      const rW = Math.max(2, Math.round(bW * totR / total));
      const hrW = Math.max(2, Math.round(bW * totHR / total));
      const pfW = bW - rW - hrW;

      const b1 = bar.addStack(); b1.size = new Size(rW, 8); b1.backgroundColor = C.accent; b1.cornerRadius = 2;
      bar.addSpacer(1);
      const b2 = bar.addStack(); b2.size = new Size(hrW, 8); b2.backgroundColor = C.blue; b2.cornerRadius = 2;
      bar.addSpacer(1);
      const b3 = bar.addStack(); b3.size = new Size(pfW, 8); b3.backgroundColor = C.orange; b3.cornerRadius = 2;
    }

    w.addSpacer(4);

    // Legend
    const leg = w.addStack(); leg.layoutHorizontally(); leg.spacing = 12;
    for (const [label, val, color] of [['Récolte',totR,C.accent],['Hors Récolte',totHR,C.blue],['Postes Fixes',totPF,C.orange]]) {
      const lc = leg.addStack(); lc.layoutHorizontally(); lc.centerAlignContent(); lc.spacing = 4;
      const ld = lc.addStack(); ld.size = new Size(6,6); ld.backgroundColor = color; ld.cornerRadius = 3;
      t(lc, `${label} ${val}`, Font.systemFont(9), C.t2);
    }
  }

  if (config.runsInWidget) Script.setWidget(w);
  else await w.presentMedium();
  Script.complete();
}

await main();
