// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: clipboard-list;

// =====================================================
//  Berry Good Farms - Widget Pointage du Jour
//  Framboise Kg / Myrtille Kg / Effectif par Ferme
// =====================================================

const API = 'https://berrygood-farms-dashboard.web.app/api/pointage-rh';

const C = {
  bg: new Color('#1a1a2e'),
  card: new Color('#252540'),
  berry: new Color('#8B2252'),
  berryLight: new Color('#c47a9a'),
  green: new Color('#2D8B4E'),
  orange: new Color('#E67E22'),
  red: new Color('#dc3545'),
  white: new Color('#FFFFFF'),
  text: new Color('#e8e8f0'),
  muted: new Color('#8888aa'),
  dimmed: new Color('#555577'),
  blue: new Color('#5b8def'),
};

function formatDate(d) {
  const dt = d ? new Date(d + 'T12:00:00') : new Date();
  const jours = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const mois = ['Jan','Fev','Mar','Avr','Mai','Jun','Jul','Aou','Sep','Oct','Nov','Dec'];
  return `${jours[dt.getDay()]} ${dt.getDate()} ${mois[dt.getMonth()]}`;
}

function addText(stack, text, font, color, align) {
  const t = stack.addText(String(text));
  t.font = font;
  t.textColor = color;
  if (align === 'right') t.rightAlignText();
  if (align === 'center') t.centerAlignText();
  t.lineLimit = 1;
  return t;
}

function addSymbol(stack, name, size, color) {
  const sf = SFSymbol.named(name);
  sf.applyFont(Font.systemFont(size));
  const img = stack.addImage(sf.image);
  img.imageSize = new Size(size + 2, size + 2);
  img.tintColor = color;
  return img;
}

async function fetchData() {
  try {
    const [summaryJson, recolteJson] = await Promise.all([
      new Request(API + '?action=summary').loadJSON(),
      new Request(API + '?action=recolte').loadJSON(),
    ]);

    // Effectif par ferme
    const effectif = summaryJson.effectif || {};
    const fermes = ['F1', 'F5', 'Avocatier'];
    let totR = 0, totHR = 0, totPF = 0;
    const perFerme = {};
    fermes.forEach(f => {
      const e = effectif[f] || { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 };
      perFerme[f] = { ...e, total: e.recolte + e.horsRecolte + e.postesFixes };
      totR += e.recolte;
      totHR += e.horsRecolte;
      totPF += e.postesFixes;
    });

    // Kg par variete depuis cueillette
    const cueillette = recolteJson.cueillette || [];
    let kgFramboise = 0, kgMyrtille = 0;
    cueillette.forEach(c => {
      const v = (c.variete || '').toUpperCase();
      if (v.includes('FRAMBOISE') || v.includes('FRAMB')) {
        kgFramboise += (c.totalKg || 0);
      } else if (v.includes('MYRTILLE') || v.includes('BLUEBERRY') || v.includes('MYRT')) {
        kgMyrtille += (c.totalKg || 0);
      }
    });

    // Fallback: si cueillette vide, deduire depuis workers
    if (kgFramboise === 0 && kgMyrtille === 0) {
      const workers = recolteJson.workers || [];
      workers.forEach(w => {
        const v = (w.variete || '').toUpperCase();
        const kg = w.quantite || 0;
        if (v.includes('FRAMBOISE') || v.includes('FRAMB')) {
          kgFramboise += kg;
        } else if (v.includes('MYRTILLE') || v.includes('BLUEBERRY') || v.includes('MYRT')) {
          kgMyrtille += kg;
        }
      });
    }

    return {
      date: summaryJson.date,
      recolte: totR, horsRecolte: totHR, postesFixes: totPF,
      total: totR + totHR + totPF,
      perFerme,
      kgFramboise: Math.round(kgFramboise),
      kgMyrtille: Math.round(kgMyrtille),
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

function buildWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 16, 12, 16);
  w.url = 'https://berrygood-farms-dashboard.web.app';

  if (!data) {
    addText(w, 'Pas de donnees', Font.mediumSystemFont(14), C.white);
    return w;
  }

  // -- HEADER --
  const header = w.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();
  addSymbol(header, 'leaf.fill', 16, C.berry);
  header.addSpacer(6);
  const titleCol = header.addStack();
  titleCol.layoutVertically();
  addText(titleCol, 'Pointage du Jour', Font.boldSystemFont(16), C.white);
  addText(titleCol, formatDate(data.date), Font.systemFont(10), C.muted);
  header.addSpacer();

  // Badge total
  const badge = header.addStack();
  badge.backgroundColor = C.berry;
  badge.cornerRadius = 12;
  badge.setPadding(6, 12, 6, 12);
  badge.layoutVertically();
  addText(badge, data.total.toString(), Font.boldSystemFont(22), C.white, 'center');
  addText(badge, 'ouvriers', Font.systemFont(8), new Color('#ffffff', 0.7), 'center');

  w.addSpacer(12);

  // -- 3 KPI CARDS: Framboise / Myrtille / (vide) --
  const kpiRow = w.addStack();
  kpiRow.layoutHorizontally();
  kpiRow.spacing = 8;

  const kpis = [
    { label: 'Framboise', val: data.kgFramboise.toLocaleString('fr-FR'), sub: 'kg', symbol: 'leaf.fill', color: C.red },
    { label: 'Myrtille', val: data.kgMyrtille.toLocaleString('fr-FR'), sub: 'kg', symbol: 'circle.fill', color: new Color('#4B0082') },
    { label: '', val: '', sub: '', symbol: null, color: C.dimmed, empty: true },
  ];

  for (const kpi of kpis) {
    const card = kpiRow.addStack();
    card.backgroundColor = C.card;
    card.cornerRadius = 12;
    card.setPadding(10, 0, 10, 0);
    card.layoutVertically();

    if (kpi.empty) {
      card.addSpacer();
      const emptyRow = card.addStack();
      emptyRow.addSpacer();
      addText(emptyRow, '--', Font.boldSystemFont(20), C.dimmed);
      emptyRow.addSpacer();
      card.addSpacer();
      continue;
    }

    // Icon + value
    const valRow = card.addStack();
    valRow.addSpacer();
    valRow.layoutHorizontally();
    valRow.centerAlignContent();
    if (kpi.symbol) addSymbol(valRow, kpi.symbol, 14, kpi.color);
    valRow.addSpacer(4);
    addText(valRow, kpi.val, Font.boldSystemFont(22), kpi.color);
    valRow.addSpacer();

    card.addSpacer(2);

    // Sub (kg)
    const subRow = card.addStack();
    subRow.addSpacer();
    addText(subRow, kpi.sub, Font.boldSystemFont(10), kpi.color);
    subRow.addSpacer();

    card.addSpacer(4);

    // Label
    const lblRow = card.addStack();
    lblRow.addSpacer();
    addText(lblRow, kpi.label, Font.mediumSystemFont(10), C.muted);
    lblRow.addSpacer();
  }

  w.addSpacer(12);

  // -- DETAIL PAR FERME --
  const fermeColors = { 'F1': C.berry, 'F5': C.green, 'Avocatier': C.orange };
  const fermes = ['F1', 'F5', 'Avocatier'];

  // Header row
  const colHeader = w.addStack();
  colHeader.layoutHorizontally();
  colHeader.setPadding(0, 4, 0, 4);
  addText(colHeader, 'Ferme', Font.boldSystemFont(10), C.muted);
  colHeader.addSpacer();
  const rh = colHeader.addStack(); rh.size = new Size(50, 0);
  addText(rh, 'Recolte', Font.boldSystemFont(9), C.berryLight, 'center');
  const hrh = colHeader.addStack(); hrh.size = new Size(55, 0);
  addText(hrh, 'Hors Rec.', Font.boldSystemFont(9), C.blue, 'center');
  const pfh = colHeader.addStack(); pfh.size = new Size(50, 0);
  addText(pfh, 'P. Fixes', Font.boldSystemFont(9), C.orange, 'center');
  const tth = colHeader.addStack(); tth.size = new Size(45, 0);
  addText(tth, 'Total', Font.boldSystemFont(9), C.text, 'right');

  w.addSpacer(6);

  for (const f of fermes) {
    const info = data.perFerme[f];
    if (!info) continue;

    const card = w.addStack();
    card.backgroundColor = C.card;
    card.cornerRadius = 10;
    card.setPadding(8, 12, 8, 12);
    card.layoutHorizontally();
    card.centerAlignContent();

    // Ferme badge
    const fBadge = card.addStack();
    fBadge.backgroundColor = fermeColors[f];
    fBadge.cornerRadius = 6;
    fBadge.setPadding(3, 8, 3, 8);
    addText(fBadge, f, Font.boldSystemFont(11), C.white);

    card.addSpacer();

    // Recolte
    const rc = card.addStack(); rc.size = new Size(50, 0);
    addText(rc, info.recolte.toString(), Font.boldSystemFont(15), C.berry, 'center');

    // Hors Recolte
    const hrc = card.addStack(); hrc.size = new Size(55, 0);
    addText(hrc, info.horsRecolte.toString(), Font.boldSystemFont(15), C.blue, 'center');

    // Postes Fixes
    const pfc = card.addStack(); pfc.size = new Size(50, 0);
    addText(pfc, info.postesFixes.toString(), Font.boldSystemFont(15), C.orange, 'center');

    // Total
    const tc = card.addStack(); tc.size = new Size(45, 0);
    addText(tc, info.total.toString(), Font.boldSystemFont(16), C.white, 'right');

    w.addSpacer(4);
  }

  // -- Barre de repartition --
  w.addSpacer(6);
  const barContainer = w.addStack();
  barContainer.layoutHorizontally();
  barContainer.spacing = 2;
  const barWidth = 310;
  const pR = data.total > 0 ? data.recolte / data.total : 0;
  const pHR = data.total > 0 ? data.horsRecolte / data.total : 0;
  const pPF = data.total > 0 ? data.postesFixes / data.total : 0;

  const bR = barContainer.addStack();
  bR.size = new Size(Math.max(4, Math.round(barWidth * pR)), 8);
  bR.backgroundColor = C.berry;
  bR.cornerRadius = 4;

  const bHR = barContainer.addStack();
  bHR.size = new Size(Math.max(4, Math.round(barWidth * pHR)), 8);
  bHR.backgroundColor = C.blue;
  bHR.cornerRadius = 4;

  const bPF = barContainer.addStack();
  bPF.size = new Size(Math.max(4, Math.round(barWidth * pPF)), 8);
  bPF.backgroundColor = C.orange;
  bPF.cornerRadius = 4;

  w.addSpacer();

  // -- FOOTER --
  const footer = w.addStack();
  footer.layoutHorizontally();
  addText(footer, 'MaJ ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), Font.systemFont(8), C.dimmed);
  footer.addSpacer();
  addSymbol(footer, 'hand.tap.fill', 8, C.dimmed);
  footer.addSpacer(3);
  addText(footer, 'Dashboard RH', Font.systemFont(8), C.dimmed);

  return w;
}

async function main() {
  const data = await fetchData();
  const widget = buildWidget(data);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentLarge();
  }
  Script.complete();
}

await main();
