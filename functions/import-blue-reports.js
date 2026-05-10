// Use firebase-admin with explicit project config
const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

const reports = [
  {
    week: 9, year: 2026, berry: "myrtille", totalVolume: 86535, allRanchCount: 38,
    subject: "Weekly Quality Report — Blueberries WK9",
    pwResults: { pass: 93.79, preInspReject: 6.21, reInspReject: 0, pqMax: 100, pqAvg: 87.81, pqMin: 1.71 },
    brixSummary: [
      {variety:"Breeze",avg:10.80,max:12.20,min:8.90},
      {variety:"Cascade",avg:6.27,max:11.40,min:0},
      {variety:"Corrina",avg:10.75,max:11.40,min:8.60},
      {variety:"Eterna",avg:10.39,max:12.00,min:0},
      {variety:"Regina",avg:10.81,max:11.40,min:10.20},
      {variety:"Rosita",avg:11.80,max:13.20,min:11.10}
    ],
    ourRanches: [{ranchId:"200876",farmName:"F5",pqWeightedAvg:94.03,rank:14,totalRanches:38,batchWeight:2747,brixAvg:11.17}]
  },
  {
    week: 10, year: 2026, berry: "myrtille", totalVolume: 107463, allRanchCount: 40,
    subject: "Weekly Quality Report — Blueberries WK10",
    pwResults: { pass: 95.74, preInspReject: 3.51, reInspReject: 0.76, pqMax: 100, pqAvg: 89.88, pqWeightedAvg: 93.00, pqMin: 1.68 },
    brixSummary: [
      {variety:"Breeze",avg:10.63,max:12.90,min:0},
      {variety:"Cascade",avg:10.86,max:12.30,min:0},
      {variety:"Corrina",avg:10.69,max:13.20,min:0},
      {variety:"Eterna",avg:10.74,max:13.20,min:0},
      {variety:"Regina",avg:11.52,max:12.80,min:0},
      {variety:"Rosita",avg:11.93,max:13.60,min:10.10}
    ],
    ourRanches: [{ranchId:"200876",farmName:"F5",pqWeightedAvg:91.90,rank:37,totalRanches:40,batchWeight:19479,brixAvg:11.14}]
  },
  {
    week: 11, year: 2026, berry: "myrtille", totalVolume: 102785, allRanchCount: 38,
    subject: "Weekly Quality Report — Blueberries WK11",
    pwResults: { pass: 90.81, preInspReject: 1.32, reInspReject: 7.87, pqMax: 100, pqAvg: 79.79, pqWeightedAvg: 76.79, pqMin: 1.68 },
    brixSummary: [
      {variety:"Breeze",avg:11.16,max:14.00,min:0},
      {variety:"Cascade",avg:10.48,max:12.00,min:0},
      {variety:"Corrina",avg:11.17,max:12.60,min:0},
      {variety:"Eterna",avg:12.08,max:13.00,min:0},
      {variety:"Regina",avg:11.40,max:13.00,min:10.20},
      {variety:"Rosita",avg:11.49,max:13.60,min:10.20}
    ],
    ourRanches: [{ranchId:"200876",farmName:"F5",pqWeightedAvg:95.98,rank:12,totalRanches:38,batchWeight:14304,brixAvg:11.32}]
  },
  {
    week: 12, year: 2026, berry: "myrtille", totalVolume: 97298, allRanchCount: 42,
    subject: "Weekly Quality Report — Blueberries WK12",
    pwResults: { pass: 98.12, preInspReject: 1.34, reInspReject: 0.54, pqMax: 100, pqAvg: 92.51, pqMin: 1.68 },
    brixSummary: [
      {variety:"Breeze",avg:12.56,max:14.00,min:11.20},
      {variety:"Cascade",avg:12.94,max:14.40,min:11.30},
      {variety:"Corrina",avg:11.27,max:12.30,min:0},
      {variety:"Eterna",avg:11.23,max:12.80,min:0},
      {variety:"Regina",avg:11.93,max:13.90,min:11.00},
      {variety:"Rosita",avg:10.84,max:12.60,min:0}
    ],
    ourRanches: [{ranchId:"200876",farmName:"F5",pqWeightedAvg:91.23,rank:41,totalRanches:42,batchWeight:8226,brixAvg:11.56}]
  },
  {
    week: 13, year: 2026, berry: "myrtille", totalVolume: 159701, allRanchCount: 40,
    subject: "Weekly Quality Report — Blueberries WK13",
    pwResults: { pass: 95.54, preInspReject: 4.10, reInspReject: 0.78, pqMax: 100, pqAvg: 90.23, pqMin: 1.68 },
    brixSummary: [
      {variety:"Breeze",avg:11.96,max:13.90,min:8.50},
      {variety:"Cascade",avg:10.87,max:13.00,min:0},
      {variety:"Corrina",avg:12.63,max:13.10,min:12.20},
      {variety:"Eterna",avg:11.13,max:13.80,min:0},
      {variety:"Regina",avg:9.98,max:12.60,min:0},
      {variety:"Rosita",avg:11.67,max:13.90,min:0}
    ],
    ourRanches: [{ranchId:"200876",farmName:"F5",pqWeightedAvg:95.14,rank:18,totalRanches:40,batchWeight:20342,brixAvg:11.65}]
  }
];

(async () => {
  const now = new Date().toISOString();
  for (const r of reports) {
    const docId = `WQR-MYRT-W${r.week}-${r.year}`;
    await db.collection("weekly_quality_reports").doc(docId).set({
      emailId: `manual-import-${docId}`,
      week: r.week,
      year: r.year,
      berry: r.berry,
      pwResults: r.pwResults,
      brixSummary: r.brixSummary,
      ourRanches: r.ourRanches,
      allRanchCount: r.allRanchCount,
      totalVolume: r.totalVolume,
      subject: r.subject,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Imported ${docId}`);
  }
  console.log("Done!");
  process.exit(0);
})();
