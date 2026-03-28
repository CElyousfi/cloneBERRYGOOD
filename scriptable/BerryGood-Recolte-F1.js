// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: seedling;

// =====================================================
//  Berry Good Farms - Recolte F1 (Framboise Larache)
//  Rendement moyen par Equipe - Ferme F1
// =====================================================

const FERME = 'F1';
const FERME_LABEL = 'F1 - Framboise Larache';
const FERME_COLOR_HEX = '#8B2252';

const API = 'https://berrygood-farms-dashboard.web.app/api/pointage-rh';

const C = {
  bg: new Color('#1a1a2e'),
  card: new Color('#252540'),
  berry: new Color('#8B2252'),
  green: new Color('#2D8B4E'),
  greenLight: new Color('#5abb7a'),
  orange: new Color('#E67E22'),
  gold: new Color('#FFD700'),
  white: new Color('#FFFFFF'),
  text: new Color('#e8e8f0'),
  muted: new Color('#8888aa'),
  dimmed: new Color('#555577'),
  accent: new Color(FERME_COLOR_HEX),
};

const EQ_NAMES = {
  'MM':'Boucharen','AY':'Chelihat','HT':'El Bachir','HA':'El Hafi',
  'KR':'Farid','NA':'Larache','JA':'Ksr Femme','AZ':'Chahdi',
  'CC':'Sektoui','CA':'Regragi','RE':'Dechira','NV':'NV'
};

function getEqPrefix(mat) {
  if (!mat) return 'NV';
  const p = mat.toUpperCase().trim().substring(0, 2);
  if (EQ_NAMES[p]) return p;
  if (mat.toUpperCase().startsWith('HA')) return 'HA';
  return p;
}

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

function progressBar(parent, pct, color, width) {
  const bg = parent.addStack();
  bg.size = new Size(width, 5);
  bg.backgroundColor = C.dimmed;
  bg.cornerRadius = 3;
  const fill = bg.addStack();
  fill.size = new Size(Math.max(2, Math.round(width * Math.min(pct, 1))), 5);
  fill.backgroundColor = color;
  fill.cornerRadius = 3;
}

async function fetchData() {
  try {
    const json = await new Request(API + '?action=recolte').loadJSON();
    if (!json.success) return null;

    const logOps = /caporal|conditionnement|encadrement|poste|chargement/i;
    const workers = (json.workers || [])
      .filter(w => !logOps.test(w.operation) && w.ferme === FERME)
      .sort((a, b) => (b.quantite || 0) - (a.quantite || 0));

    // Total kg depuis cueillette pour cette ferme
    const cueillette = (json.cueillette || []).filter(c => c.ferme === FERME);
    const totalKgCueillette = cueillette.reduce((s, c) => s + (c.totalKg || 0), 0);
    const totalKg = totalKgCueillette > 0 ? Math.round(totalKgCueillette) : Math.round(workers.reduce((s, w) => s + (w.quantite || 0), 0));

    // Par equipe
    const byEq = {};
    workers.forEach(w => {
      const eq = getEqPrefix(w.matricule);
      if (!byEq[eq]) byEq[eq] = { prefix: eq, nom: EQ_NAMES[eq] || eq, kg: 0, nb: 0 };
      byEq[eq].kg += (w.quantite || 0);
      byEq[eq].nb++;
    });

    const equipes = Object.values(byEq).map(eq => ({
      ...eq,
      avg: eq.nb > 0 ? Math.round(eq.kg / eq.nb * 10) / 10 : 0,
      totalKg: Math.round(eq.kg),
    })).sort((a, b) => b.avg - a.avg);

    return { date: json.date, totalKg, nbWorkers: workers.length, equipes };
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
  addSymbol(header, 'leaf.fill', 16, C.accent);
  header.addSpacer(6);
  const titleCol = header.addStack();
  titleCol.layoutVertically();
  addText(titleCol, 'Recolte ' + FERME, Font.boldSystemFont(16), C.white);
  const subTitle = titleCol.addStack();
  subTitle.layoutHorizontally();
  subTitle.spacing = 6;
  addText(subTitle, formatDate(data.date), Font.systemFont(10), C.muted);
  addText(subTitle, FERME_LABEL, Font.systemFont(9), C.accent);
  header.addSpacer();

  // Badge
  const badge = header.addStack();
  badge.backgroundColor = C.accent;
  badge.cornerRadius = 12;
  badge.setPadding(6, 14, 6, 14);
  badge.layoutVertically();
  addText(badge, data.totalKg.toLocaleString('fr-FR'), Font.boldSystemFont(20), C.white, 'center');
  addText(badge, 'kg', Font.systemFont(8), new Color('#ffffff', 0.7), 'center');

  w.addSpacer(6);

  // Sub-stats
  const subRow = w.addStack();
  subRow.layoutHorizontally();
  subRow.spacing = 20;
  subRow.setPadding(0, 4, 0, 4);

  const avgGlobal = data.nbWorkers > 0 ? Math.round(data.totalKg / data.nbWorkers * 10) / 10 : 0;

  const stats = [
    { label: 'Ouvriers', val: data.nbWorkers.toString(), symbol: 'person.2.fill' },
    { label: 'Moy. Globale', val: avgGlobal + ' kg', symbol: 'chart.bar.fill' },
    { label: 'Equipes', val: data.equipes.length.toString(), symbol: 'person.3.fill' },
  ];
  for (const s of stats) {
    const sCol = subRow.addStack();
    sCol.layoutHorizontally();
    sCol.centerAlignContent();
    sCol.spacing = 4;
    addSymbol(sCol, s.symbol, 11, C.muted);
    const sInfo = sCol.addStack();
    sInfo.layoutVertically();
    addText(sInfo, s.val, Font.boldSystemFont(13), C.white);
    addText(sInfo, s.label, Font.systemFont(8), C.muted);
  }

  w.addSpacer(10);

  // -- TABLEAU EQUIPES --
  const colHead = w.addStack();
  colHead.layoutHorizontally();
  colHead.setPadding(0, 12, 4, 12);

  const ch1 = colHead.addStack(); ch1.size = new Size(24, 0);
  addText(ch1, '#', Font.boldSystemFont(9), C.dimmed);
  const ch2 = colHead.addStack(); ch2.size = new Size(75, 0);
  addText(ch2, 'Equipe', Font.boldSystemFont(9), C.dimmed);
  colHead.addSpacer();
  const ch3 = colHead.addStack(); ch3.size = new Size(40, 0);
  addText(ch3, 'Ouv.', Font.boldSystemFont(9), C.dimmed, 'center');
  const ch4 = colHead.addStack(); ch4.size = new Size(65, 0);
  addText(ch4, 'Moy/Ouv', Font.boldSystemFont(9), C.dimmed, 'center');
  const ch5 = colHead.addStack(); ch5.size = new Size(65, 0);
  addText(ch5, 'Total Kg', Font.boldSystemFont(9), C.dimmed, 'right');

  w.addSpacer(2);

  const maxAvg = data.equipes.length > 0 ? data.equipes[0].avg : 1;

  for (let i = 0; i < Math.min(data.equipes.length, 10); i++) {
    const eq = data.equipes[i];
    const rank = i + 1;

    const row = w.addStack();
    row.backgroundColor = C.card;
    row.cornerRadius = 8;
    row.setPadding(7, 12, 7, 12);
    row.layoutHorizontally();
    row.centerAlignContent();

    // Rank
    const rk = row.addStack(); rk.size = new Size(24, 0);
    if (rank <= 3) {
      const rankColors = [C.gold, new Color('#C0C0C0'), new Color('#CD7F32')];
      const rkBg = rk.addStack();
      rkBg.size = new Size(18, 18);
      rkBg.backgroundColor = rankColors[rank - 1];
      rkBg.cornerRadius = 9;
      addText(rkBg, ' ' + rank.toString(), Font.boldSystemFont(11), C.bg);
    } else {
      addText(rk, rank.toString(), Font.boldSystemFont(12), C.dimmed);
    }

    // Equipe nom
    const eqCol = row.addStack();
    eqCol.layoutVertically();
    eqCol.size = new Size(75, 0);
    addText(eqCol, eq.nom, Font.boldSystemFont(11), C.white);
    progressBar(eqCol, eq.avg / maxAvg, rank === 1 ? C.gold : rank <= 3 ? C.greenLight : C.green, 65);

    row.addSpacer();

    // Nb ouvriers
    const nbCol = row.addStack(); nbCol.size = new Size(40, 0);
    addText(nbCol, eq.nb.toString(), Font.mediumSystemFont(12), C.muted, 'center');

    // Moy/ouvrier
    const avgCol = row.addStack(); avgCol.size = new Size(65, 0);
    const avgColor = eq.avg >= 20 ? C.green : eq.avg >= 10 ? C.orange : C.accent;
    addText(avgCol, eq.avg + ' kg', Font.boldSystemFont(13), avgColor, 'center');

    // Total kg
    const totCol = row.addStack(); totCol.size = new Size(65, 0);
    addText(totCol, Math.round(eq.totalKg).toLocaleString('fr-FR'), Font.boldSystemFont(13), C.white, 'right');

    w.addSpacer(3);
  }

  w.addSpacer();

  // -- FOOTER --
  const footer = w.addStack();
  footer.layoutHorizontally();
  addText(footer, 'MaJ ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), Font.systemFont(8), C.dimmed);
  footer.addSpacer();
  addSymbol(footer, 'arrow.left.arrow.right', 8, C.dimmed);
  footer.addSpacer(3);
  addText(footer, 'Slider pour F5', Font.systemFont(8), C.dimmed);

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
