// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: yellow; icon-glyph: clipboard-check;

// BGF — PFQ Inspections du Jour (Medium Widget)

const API = 'https://berrygood-farms-dashboard.web.app/api/email-analysis';
const URL_DASH = 'https://berrygood-farms-dashboard.web.app';

const C = {
  bg: new Color('#0b1118'),
  card: new Color('#111d2b'),
  accent: new Color('#3daa5e'),
  accentDim: new Color('#1a3028'),
  blue: new Color('#4a90d9'),
  orange: new Color('#E67E22'),
  red: new Color('#e74c3c'),
  redDim: new Color('#3a1a1a'),
  gold: new Color('#FFD700'),
  white: new Color('#ffffff'),
  t1: new Color('#e8ecf0'),
  t2: new Color('#7a8a9a'),
  t3: new Color('#4a5a6a'),
  headerBg: new Color('#162030'),
};

const RANCH_MAP = { '200742': 'F1', '200876': 'F5' };

// Parse "MM/DD/YYYY HH:mm GMT" → "YYYY-MM-DD" (same logic as dashboard)
function parseDay(raw) {
  if (!raw) return '';
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  if (raw.length >= 10 && raw[4] === '-') return raw.slice(0, 10);
  return '';
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function fmtDate() {
  const d = new Date();
  return ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][d.getDay()] + ' ' + d.getDate() + ' ' + ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][d.getMonth()];
}

function resultColor(r) {
  if (r === 'PASS') return C.accent;
  if (r === 'REJECT') return C.red;
  return C.orange;
}

function resultBg(r) {
  if (r === 'PASS') return C.accentDim;
  if (r === 'REJECT') return C.redDim;
  return new Color('#3a2a10');
}

function resultLabel(r) {
  if (r === 'PASS') return '✓ Pass';
  if (r === 'REJECT') return '✗ Rejet';
  return '⚠ Fail';
}

function pfqColor(v) {
  if (v == null) return C.t3;
  if (v >= 85) return C.accent;
  if (v >= 70) return C.orange;
  return C.red;
}

async function getData() {
  try {
    // Same call as the dashboard: limit=2000, filter client-side
    const req = new Request(API + '?action=expeditions&limit=2000');
    req.timeoutInterval = 30;
    const d = await req.loadJSON();
    if (!d.success) return null;

    const today = todayISO();
    const exps = (d.expeditions || []).filter(e => {
      if (e.overallResult === 'REJECT') return false;
      return parseDay(e.date || e.createdAt || '') === today;
    });

    if (exps.length === 0) return null;

    let totalKg = 0, nbPass = 0, nbFail = 0, nbReject = 0;
    let sumPfq = 0, countPfq = 0;
    exps.forEach(e => {
      totalKg += (e.batchWeight || 0);
      if (e.overallResult === 'PASS') nbPass++;
      else if (e.overallResult === 'REJECT') nbReject++;
      else nbFail++;
      if (e.pfqTotal != null) { sumPfq += e.pfqTotal; countPfq++; }
    });

    const avgPfq = countPfq > 0 ? sumPfq / countPfq : null;
    return { exps, totalKg: Math.round(totalKg), nbPass, nbFail, nbReject, total: exps.length, avgPfq };
  } catch(e) { return null; }
}

function t(s, text, font, color) {
  const x = s.addText(text); x.font = font; x.textColor = color; x.lineLimit = 1; return x;
}

function cell(row, text, width, font, color) {
  const box = row.addStack(); box.size = new Size(width, 0); box.layoutHorizontally();
  return t(box, text, font, color);
}

async function main() {
/var/folders/wh/ykx68skx2jb9bv49xm5xpmvr0000gn/T/TemporaryItems/NSIRD_screencaptureui_8pqrME/Screenshot 2026-03-24 at 18.40.34.png  const d = await getData();
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(12, 12, 8, 12);
  w.url = URL_DASH;

  if (!d) {
    const h = w.addStack(); h.layoutHorizontally(); h.centerAlignContent(); h.spacing = 6;
    t(h, '📋', Font.systemFont(16), C.white);
    t(h, 'PFQ INSPECTIONS', Font.boldSystemFont(15), C.white);
    w.addSpacer(8);
    t(w, 'Pas d\'inspections aujourd\'hui', Font.systemFont(14), C.t2);
  } else {
    // ── Header ──
    const h = w.addStack(); h.layoutHorizontally(); h.centerAlignContent(); h.spacing = 6;
    t(h, '📋', Font.systemFont(16), C.white);
    t(h, 'PFQ INSPECTIONS', Font.boldSystemFont(15), C.white);
    h.addSpacer();
    t(h, fmtDate(), Font.systemFont(11), C.t2);

    w.addSpacer(6);

    // ── Profil Qualité (summary cards) ──
    const prof = w.addStack(); prof.layoutHorizontally(); prof.spacing = 8;

    // PFQ Moyen
    const pfqCard = prof.addStack(); pfqCard.layoutVertically(); pfqCard.backgroundColor = C.card; pfqCard.cornerRadius = 10; pfqCard.setPadding(8, 12, 8, 12);
    t(pfqCard, 'PFQ MOYEN', Font.boldSystemFont(9), C.t3);
    pfqCard.addSpacer(2);
    const pfqVal = d.avgPfq != null ? d.avgPfq.toFixed(1) : '—';
    t(pfqCard, pfqVal, Font.boldSystemFont(22), pfqColor(d.avgPfq));

    // Total Kg
    const kgCard = prof.addStack(); kgCard.layoutVertically(); kgCard.backgroundColor = C.card; kgCard.cornerRadius = 10; kgCard.setPadding(8, 12, 8, 12);
    t(kgCard, 'POIDS TOTAL', Font.boldSystemFont(9), C.t3);
    kgCard.addSpacer(2);
    const kgRow = kgCard.addStack(); kgRow.layoutHorizontally(); kgRow.bottomAlignContent();
    t(kgRow, `${d.totalKg}`, Font.boldSystemFont(22), C.white);
    t(kgRow, ' kg', Font.systemFont(12), C.t2);

    // Résultats
    const resCard = prof.addStack(); resCard.layoutVertically(); resCard.backgroundColor = C.card; resCard.cornerRadius = 10; resCard.setPadding(8, 12, 8, 12);
    t(resCard, 'RÉSULTATS', Font.boldSystemFont(9), C.t3);
    resCard.addSpacer(2);
    const resRow = resCard.addStack(); resRow.layoutHorizontally(); resRow.spacing = 8;
    const pb = resRow.addStack(); pb.layoutHorizontally(); pb.spacing = 3;
    t(pb, '✓', Font.boldSystemFont(14), C.accent);
    t(pb, `${d.nbPass}`, Font.boldSystemFont(14), C.accent);
    if (d.nbFail > 0) {
      const fb = resRow.addStack(); fb.layoutHorizontally(); fb.spacing = 3;
      t(fb, '⚠', Font.boldSystemFont(14), C.orange);
      t(fb, `${d.nbFail}`, Font.boldSystemFont(14), C.orange);
    }
    if (d.nbReject > 0) {
      const rb = resRow.addStack(); rb.layoutHorizontally(); rb.spacing = 3;
      t(rb, '✗', Font.boldSystemFont(14), C.red);
      t(rb, `${d.nbReject}`, Font.boldSystemFont(14), C.red);
    }

    // Lots count
    const lotCard = prof.addStack(); lotCard.layoutVertically(); lotCard.backgroundColor = C.card; lotCard.cornerRadius = 10; lotCard.setPadding(8, 12, 8, 12);
    t(lotCard, 'LOTS', Font.boldSystemFont(9), C.t3);
    lotCard.addSpacer(2);
    t(lotCard, `${d.total}`, Font.boldSystemFont(22), C.blue);

    w.addSpacer(8);

    // ── Table Header ──
    const thRow = w.addStack(); thRow.layoutHorizontally(); thRow.centerAlignContent(); thRow.spacing = 0;
    thRow.backgroundColor = C.headerBg; thRow.cornerRadius = 6; thRow.setPadding(4, 6, 4, 6);

    const cols = [
      ['', 16],        // icon
      ['FERME', 32],
      ['VARIÉTÉ', 68],
      ['KG', 42],
      ['BRIX', 32],
      ['PFQ', 36],
      ['COND', 34],
      ['APP', 34],
      ['', 52],        // result badge
    ];
    for (const [label, width] of cols) {
      cell(thRow, label, width, Font.boldSystemFont(8), C.t3);
    }

    w.addSpacer(3);

    // ── Table Rows ──
    const maxRows = 3;
    for (let i = 0; i < Math.min(d.exps.length, maxRows); i++) {
      const e = d.exps[i];
      const row = w.addStack(); row.layoutHorizontally(); row.centerAlignContent(); row.spacing = 0;
      row.setPadding(3, 6, 3, 6);

      if (i % 2 === 0) {
        row.backgroundColor = new Color('#0d1520');
        row.cornerRadius = 4;
      }

      // Berry icon
      const icon = (e.berryType || '').includes('BLUE') ? '🫐' : '🍓';
      cell(row, icon, 16, Font.systemFont(10), C.white);

      // Farm
      const farm = RANCH_MAP[e.ranch] || '—';
      cell(row, farm, 32, Font.boldSystemFont(10), C.blue);

      // Variety
      const variety = (e.variety || '—').substring(0, 9);
      cell(row, variety, 68, Font.systemFont(10), C.t1);

      // Weight
      const kg = e.batchWeight ? `${Math.round(e.batchWeight)}` : '—';
      cell(row, kg, 42, Font.mediumSystemFont(10), C.white);

      // Brix
      const brix = e.brix != null ? `${e.brix}` : '—';
      cell(row, brix, 32, Font.systemFont(10), e.brix ? C.red : C.t3);

      // PFQ Total
      const pfq = e.pfqTotal != null ? `${e.pfqTotal.toFixed(1)}` : '—';
      cell(row, pfq, 36, Font.boldSystemFont(10), pfqColor(e.pfqTotal));

      // Condition
      const cond = e.pfqCondition != null ? `${e.pfqCondition.toFixed(1)}` : '—';
      cell(row, cond, 34, Font.systemFont(10), pfqColor(e.pfqCondition));

      // Apparence
      const app = e.pfqApparence != null ? `${e.pfqApparence.toFixed(1)}` : '—';
      cell(row, app, 34, Font.systemFont(10), pfqColor(e.pfqApparence));

      // Result badge
      const rb = row.addStack(); rb.size = new Size(52, 0); rb.layoutHorizontally();
      const badge = rb.addStack(); badge.backgroundColor = resultBg(e.overallResult); badge.cornerRadius = 6; badge.setPadding(1, 5, 1, 5);
      t(badge, resultLabel(e.overallResult), Font.boldSystemFont(8), resultColor(e.overallResult));

      w.addSpacer(1);
    }

    if (d.exps.length > maxRows) {
      w.addSpacer(2);
      t(w, `+ ${d.exps.length - maxRows} autres lots`, Font.systemFont(9), C.t3);
    }
  }

  // Footer
  w.addSpacer();
  const ft = w.addStack(); ft.layoutHorizontally();
  t(ft, 'BGF · Inspections du Jour · Détail par Lot', Font.systemFont(9), C.t3);
  ft.addSpacer();
  t(ft, new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), Font.systemFont(9), C.t3);

  if (config.runsInWidget) Script.setWidget(w);
  else await w.presentMedium();
  Script.complete();
}

await main();
