// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: seedling;

// BGF — Framboise (Small Widget)

const API = 'https://berrygood-farms-dashboard.web.app/api/pointage-rh';
const URL_DASH = 'https://berrygood-farms-dashboard.web.app';
const TEST_DATE = '';

const C = {
  bg: new Color('#0b1118'),
  berry: new Color('#c2185b'),
  berryDim: new Color('#2a1520'),
  white: new Color('#ffffff'),
  t2: new Color('#7a8a9a'),
};

const MYRT = ['corina','cascade','breeze','blue','myrtille'];
function isMyr(v, p) {
  const a = (v||'').toLowerCase(), b = (p||'').toLowerCase();
  return MYRT.some(m => a.includes(m) || b.includes(m));
}

async function getData() {
  try {
    const dp = TEST_DATE ? `&date=${TEST_DATE}` : '';
    const req = new Request(API + '?action=recolte' + dp);
    req.timeoutInterval = 15;
    const d = await req.loadJSON();
    if (!d.success) return null;

    const allWorkers = d.workers || [];
    const logOps = /caporal|chargement|conditionnement/i;

    // Filtrer par framboise (= pas myrtille)
    const frambWorkers = allWorkers.filter(w => !isMyr(w.variete, w.parcelle));
    let kg = 0, nb = 0, nbLog = 0;
    frambWorkers.forEach(w => {
      if (logOps.test(w.operation)) { nbLog++; }
      else { kg += (w.quantite || 0); nb++; }
    });
    const pctLog = nb > 0 ? Math.round(nbLog / nb * 100) : 0;

    // Prefer cueillette totals if available
    let cueilKg = 0;
    (d.cueillette || []).forEach(c => {
      if (!isMyr(c.variete, c.parcelle)) cueilKg += (c.totalKg || 0);
    });
    if (cueilKg > 0) kg = cueilKg;

    if (nb === 0 && kg === 0) return null;
    return { kg: Math.round(kg), nb, pctLog, date: d.date };
  } catch (e) { return null; }
}

async function main() {
  const d = await getData();
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(16, 16, 16, 16);
  w.url = URL_DASH;

  if (!d) {
    const e = w.addText('—');
    e.font = Font.boldSystemFont(20);
    e.textColor = C.white;
  } else {
    // Header
    const h = w.addStack();
    h.layoutHorizontally();
    h.centerAlignContent();
    const lbl = h.addText('BGF');
    lbl.font = Font.boldSystemFont(12);
    lbl.textColor = C.berry;
    h.addSpacer();
    const ic = h.addText('🍓');
    ic.font = Font.systemFont(24);

    w.addSpacer(10);

    // Value
    const vr = w.addStack();
    vr.layoutHorizontally();
    vr.bottomAlignContent();
    const v = vr.addText(d.kg.toLocaleString('fr-FR'));
    v.font = Font.boldSystemFont(36);
    v.textColor = C.white;
    const u = vr.addText(' kg');
    u.font = Font.mediumSystemFont(16);
    u.textColor = C.t2;

    w.addSpacer(2);
    const sub = w.addText('Framboise');
    sub.font = Font.systemFont(11);
    sub.textColor = C.t2;

    w.addSpacer(8);

    // Badge
    const b = w.addStack();
    b.backgroundColor = C.berryDim;
    b.cornerRadius = 10;
    b.setPadding(3, 8, 3, 8);
    b.layoutHorizontally();
    b.centerAlignContent();
    b.spacing = 4;
    const bi = b.addText('👥');
    bi.font = Font.systemFont(9);
    const bt = b.addText(`${d.nb} ouvrières`);
    bt.font = Font.boldSystemFont(10);
    bt.textColor = C.berry;

    w.addSpacer(4);

    // % logistique
    const logRow = w.addStack();
    logRow.layoutHorizontally();
    logRow.centerAlignContent();
    logRow.spacing = 4;
    const logIcon = logRow.addText('📦');
    logIcon.font = Font.systemFont(9);
    const logTxt = logRow.addText(`${d.pctLog}% logistique`);
    logTxt.font = Font.systemFont(10);
    logTxt.textColor = C.t2;
  }

  if (config.runsInWidget) Script.setWidget(w);
  else await w.presentSmall();
  Script.complete();
}

await main();
