const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

function getISOWeek(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

async function check() {
  const liqSnap = await db.collection('liquidations').get();
  const w6Liqs = liqSnap.docs.filter(d => d.data().week === 6 || d.data().week === '6');

  const allLiqRids = new Set();
  w6Liqs.forEach(d => {
    (d.data().rows || []).forEach(r => {
      if (r.receiptId) allLiqRids.add(r.receiptId);
    });
  });
  console.log('=== Liquidation W6 receipt IDs ===');
  console.log([...allLiqRids].join(', '));

  const expSnap = await db.collection('expeditions').get();
  const allExps = expSnap.docs.map(d => ({id: d.id, ...d.data()}));

  console.log('\n=== Matching each W6 liq RID to expeditions ===');
  const ridsToCheck = [...allLiqRids, 'RID-001286050', 'RID-001286988'];
  for (const rid of ridsToCheck) {
    const exp = allExps.find(e => e.receiptId === rid);
    if (exp) {
      console.log(`${rid} -> date: ${exp.date}, ISOweek: ${getISOWeek(exp.date)}, status: ${exp.status}, result: ${exp.overallResult}`);
    } else {
      console.log(`${rid} -> NOT FOUND in expeditions`);
    }
  }

  console.log('\n=== Total expeditions ===', allExps.length);

  // Check normalize matching
  const normalize = (rid) => {
    if (!rid) return '';
    let s = String(rid).trim().toUpperCase();
    const m2 = s.match(/^RID-0*(\d+)$/);
    return m2 ? m2[1] : s;
  };

  console.log('\n=== Normalized comparison ===');
  for (const rid of allLiqRids) {
    const norm = normalize(rid);
    const matchExp = allExps.find(e => normalize(e.receiptId) === norm);
    console.log(`Liq: ${rid} (norm: ${norm}) -> Exp match: ${matchExp ? matchExp.receiptId + ' (week ' + getISOWeek(matchExp.date) + ')' : 'NONE'}`);
  }
}

check().then(() => process.exit(0));
