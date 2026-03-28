/**
 * PFQ Coefficient Regression Analysis
 * Fetches historical expedition data via API,
 * runs OLS + NNLS regression to estimate real defect coefficients.
 */

const https = require("https");

const API_URL = "https://berrygood-farms-dashboard.web.app/api/email-analysis?action=expeditions&limit=500";

const CONDITION_DEFECTS = ["Decay", "Wet Leaky", "Overripe", "Collapsed", "Weak Cells", "Sooty Mold", "Yellow Rust"];
const APPEARANCE_DEFECTS = ["Broken", "Green", "Size", "Skin Damage", "Malformed", "Attached Calyx", "Foreign bodies"];

const EXCEL_COEFS = {
    "Overripe": { val: 700, type: "cond", fr: "Fruit trop mur" },
    "Wet Leaky": { val: 700, type: "cond", fr: "Fruit saignant" },
    "Collapsed": { val: 700, type: "cond", fr: "Fruit mou" },
    "Sooty Mold": { val: 500, type: "cond", fr: "Cladosporium" },
    "Yellow Rust": { val: 500, type: "cond", fr: "Rouille jaune" },
    "Decay": { val: null, type: "cond", fr: "Pourriture?" },
    "Weak Cells": { val: null, type: "cond", fr: "Cellules blanches?" },
    "Broken": { val: 400, type: "app", fr: "Cassé" },
    "Green": { val: 700, type: "app", fr: "Immature" },
    "Size": { val: 400, type: "app", fr: "<3g" },
    "Skin Damage": { val: 400, type: "app", fr: "Dégats ravageurs" },
    "Malformed": { val: 400, type: "app", fr: "Déformation" },
    "Attached Calyx": { val: 400, type: "app", fr: "Avec pédoncule" },
    "Foreign bodies": { val: 100000, type: "app", fr: "Larves drosophile" },
};

// ── Linear Algebra helpers ──
function transpose(M) {
    const r = M.length, c = M[0].length;
    const T = Array.from({ length: c }, () => new Array(r));
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = M[i][j];
    return T;
}
function matMul(A, B) {
    const m = A.length, n = B[0].length, p = B.length;
    const C = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) for (let k = 0; k < p; k++) C[i][j] += A[i][k] * B[k][j];
    return C;
}
function matVec(A, v) { return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0)); }
function invert(matrix) {
    const n = matrix.length;
    const aug = matrix.map((row, i) => { const r = [...row]; for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0); return r; });
    for (let col = 0; col < n; col++) {
        let maxR = col;
        for (let row = col + 1; row < n; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[maxR][col])) maxR = row;
        [aug[col], aug[maxR]] = [aug[maxR], aug[col]];
        const p = aug[col][col]; if (Math.abs(p) < 1e-12) return null;
        for (let j = 0; j < 2 * n; j++) aug[col][j] /= p;
        for (let row = 0; row < n; row++) { if (row === col) continue; const f = aug[row][col]; for (let j = 0; j < 2 * n; j++) aug[row][j] -= f * aug[col][j]; }
    }
    return aug.map(row => row.slice(n));
}

function ols(X, y) {
    const Xt = transpose(X), XtX = matMul(Xt, X), inv = invert(XtX);
    if (!inv) return null;
    const beta = matVec(inv, matVec(Xt, y));
    const yMean = y.reduce((s, v) => s + v, 0) / y.length;
    const yPred = X.map(row => row.reduce((s, x, j) => s + x * beta[j], 0));
    const ssRes = y.reduce((s, yi, i) => s + (yi - yPred[i]) ** 2, 0);
    const ssTot = y.reduce((s, yi) => s + (yi - yMean) ** 2, 0);
    return { beta, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, rmse: Math.sqrt(ssRes / y.length), yPred };
}

function nnls(X, y, maxIter = 1000) {
    const n = X[0].length;
    let beta = new Array(n).fill(0);
    const Xt = transpose(X), XtX = matMul(Xt, X), Xty = matVec(Xt, y);
    for (let iter = 0; iter < maxIter; iter++) {
        let changed = false;
        for (let j = 0; j < n; j++) {
            let num = Xty[j];
            for (let k = 0; k < n; k++) if (k !== j) num -= XtX[j][k] * beta[k];
            const nv = Math.max(0, num / (XtX[j][j] || 1e-12));
            if (Math.abs(nv - beta[j]) > 1e-8) changed = true;
            beta[j] = nv;
        }
        if (!changed) break;
    }
    const yMean = y.reduce((s, v) => s + v, 0) / y.length;
    const yPred = X.map(row => row.reduce((s, x, j) => s + x * beta[j], 0));
    const ssRes = y.reduce((s, yi, i) => s + (yi - yPred[i]) ** 2, 0);
    const ssTot = y.reduce((s, yi) => s + (yi - yMean) ** 2, 0);
    return { beta, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, rmse: Math.sqrt(ssRes / y.length), yPred };
}

function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { timeout: 30000 }, res => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => resolve(JSON.parse(data)));
        }).on("error", reject);
    });
}

async function main() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("   PFQ COEFFICIENT REGRESSION ANALYSIS");
    console.log("   Estimating defect coefficients from historical expeditions");
    console.log("═══════════════════════════════════════════════════════════════\n");

    // 1. Fetch data
    console.log("Fetching expeditions from API...");
    const resp = await fetch(API_URL);
    const allExps = resp.expeditions || [];
    console.log(`Total expeditions: ${allExps.length}\n`);

    // 2. Parse defects - all defects are in conditionDefects array (condition + appearance together)
    //    separated by summary rows "Condition" and "Appearance"
    const parsed = allExps.map(e => {
        const allDef = e.conditionDefects || [];
        const cond = {}, app = {};
        CONDITION_DEFECTS.forEach(n => { cond[n] = { count: 0, percent: 0, points: 0 }; });
        APPEARANCE_DEFECTS.forEach(n => { app[n] = { count: 0, percent: 0, points: 0 }; });

        allDef.forEach(d => {
            if (CONDITION_DEFECTS.includes(d.name)) cond[d.name] = d;
            if (APPEARANCE_DEFECTS.includes(d.name)) app[d.name] = d;
        });

        return {
            id: e.id,
            date: e.date,
            variety: e.variety,
            ranch: e.ranch,
            berryType: e.berryTypeFr || e.berryType,
            totalFruit: e.totalFruitInspected || 0,
            sampleSize: e.sampleSize || 0,
            pfqCondition: e.pfqCondition,
            pfqApparence: e.pfqApparence,
            pfqTotal: e.pfqTotal,
            overallResult: e.overallResult,
            cond, app,
        };
    });

    // 3. Filter valid entries
    const valid = parsed.filter(e =>
        e.pfqCondition != null && e.pfqApparence != null &&
        e.totalFruit > 0 && e.pfqCondition <= 70 && e.pfqApparence <= 20
    );

    // Also filter out entries where pfqCondition > 70 (some have 80 which means different scale)
    const validCond70 = valid.filter(e => e.pfqCondition <= 70);
    const validWith80 = valid.filter(e => true); // keep all for analysis

    console.log(`Valid expeditions (pfqCond <= 70): ${validCond70.length}`);
    console.log(`Expeditions with pfqCond > 70: ${valid.length - validCond70.length}`);

    // Check the actual max values
    const maxCond = Math.max(...valid.map(e => e.pfqCondition));
    const maxApp = Math.max(...valid.map(e => e.pfqApparence));
    console.log(`\nMax pfqCondition observed: ${maxCond}`);
    console.log(`Max pfqApparence observed: ${maxApp}`);

    // Determine the scale
    const COND_MAX = maxCond > 70 ? 80 : 70;
    const APP_MAX = maxApp > 20 ? maxApp : 20;
    console.log(`\nUsing scales: Condition /${COND_MAX}, Apparence /${APP_MAX}`);

    // ── DATA SUMMARY ──
    console.log("\n── DATA SUMMARY ──────────────────────────────────────────────");
    const varieties = [...new Set(valid.map(e => e.variety))].sort();
    const berryTypes = [...new Set(valid.map(e => e.berryType))].sort();
    console.log(`Berry types: ${berryTypes.join(", ")}`);
    console.log(`Varieties: ${varieties.join(", ")}`);
    console.log(`Avg totalFruitInspected: ${Math.round(valid.reduce((s, e) => s + e.totalFruit, 0) / valid.length)}`);
    console.log(`Avg pfqCondition: ${(valid.reduce((s, e) => s + e.pfqCondition, 0) / valid.length).toFixed(2)} / ${COND_MAX}`);
    console.log(`Avg pfqApparence: ${(valid.reduce((s, e) => s + e.pfqApparence, 0) / valid.length).toFixed(2)} / ${APP_MAX}`);

    // ── SAMPLE DATA ──
    console.log("\n── SAMPLE DATA (5 expeditions) ───────────────────────────────");
    valid.slice(0, 5).forEach((e, i) => {
        console.log(`\n  [${i + 1}] ${e.id} | ${e.variety} | ${e.berryType} | ${e.totalFruit} fruits`);
        console.log(`      PFQ: Cond=${e.pfqCondition}/${COND_MAX}  App=${e.pfqApparence}/${APP_MAX}  Total=${e.pfqTotal}`);
        const condDefs = CONDITION_DEFECTS.filter(n => e.cond[n].count > 0);
        const appDefs = APPEARANCE_DEFECTS.filter(n => e.app[n].count > 0);
        if (condDefs.length) console.log(`      Cond defects: ${condDefs.map(n => `${n}=${e.cond[n].count}(${e.cond[n].percent}%,${e.cond[n].points}pts)`).join(", ")}`);
        if (appDefs.length) console.log(`      App defects:  ${appDefs.map(n => `${n}=${e.app[n].count}(${e.app[n].percent}%,${e.app[n].points}pts)`).join(", ")}`);
    });

    // ══════════════════════════════════════════════════════════════
    // APPROACH 1: Direct points/percent ratio per defect
    // (most reliable if individual defect points are available)
    // ══════════════════════════════════════════════════════════════
    console.log("\n\n══════════════════════════════════════════════════════════════");
    console.log("   APPROACH 1: DIRECT RATIO (points / percent) per defect");
    console.log("══════════════════════════════════════════════════════════════\n");

    const analyzeRatios = (defects, data, type) => {
        const results = [];
        defects.forEach(name => {
            const ratios = [];
            data.forEach(e => {
                const d = type === "cond" ? e.cond[name] : e.app[name];
                if (d && d.percent > 0.01 && d.points != null && d.points > 0) {
                    ratios.push({ ratio: d.points / d.percent, points: d.points, percent: d.percent, count: d.count });
                }
            });
            if (ratios.length > 0) {
                ratios.sort((a, b) => a.ratio - b.ratio);
                const avg = ratios.reduce((s, v) => s + v.ratio, 0) / ratios.length;
                const median = ratios[Math.floor(ratios.length / 2)].ratio;
                const std = Math.sqrt(ratios.reduce((s, v) => s + (v.ratio - avg) ** 2, 0) / ratios.length);
                results.push({ name, n: ratios.length, avg, median, std, ratios });
            } else {
                results.push({ name, n: 0, avg: null, median: null, std: null, ratios: [] });
            }
        });
        return results;
    };

    console.log("── CONDITION DEFECTS ──");
    console.log(pad("Defect", 18) + pad("N", 5) + pad("Avg Ratio", 12) + pad("Median", 10) + pad("Std", 10) + pad("Excel", 8) + pad("Mapping", 22));
    console.log("─".repeat(85));
    const condRatios = analyzeRatios(CONDITION_DEFECTS, valid, "cond");
    condRatios.forEach(r => {
        const ex = EXCEL_COEFS[r.name];
        console.log(
            pad(r.name, 18) + pad(r.n, 5) +
            pad(r.avg != null ? r.avg.toFixed(3) : "-", 12) +
            pad(r.median != null ? r.median.toFixed(3) : "-", 10) +
            pad(r.std != null ? r.std.toFixed(3) : "-", 10) +
            pad(ex.val != null ? ex.val : "-", 8) +
            pad(ex.fr, 22)
        );
    });

    console.log("\n── APPEARANCE DEFECTS ──");
    console.log(pad("Defect", 18) + pad("N", 5) + pad("Avg Ratio", 12) + pad("Median", 10) + pad("Std", 10) + pad("Excel", 8) + pad("Mapping", 22));
    console.log("─".repeat(85));
    const appRatios = analyzeRatios(APPEARANCE_DEFECTS, valid, "app");
    appRatios.forEach(r => {
        const ex = EXCEL_COEFS[r.name];
        console.log(
            pad(r.name, 18) + pad(r.n, 5) +
            pad(r.avg != null ? r.avg.toFixed(3) : "-", 12) +
            pad(r.median != null ? r.median.toFixed(3) : "-", 10) +
            pad(r.std != null ? r.std.toFixed(3) : "-", 10) +
            pad(ex.val != null ? ex.val : "-", 8) +
            pad(ex.fr, 22)
        );
    });

    // ══════════════════════════════════════════════════════════════
    // APPROACH 2: OLS + NNLS Regression on total deduction
    // Model: deduction = Σ(percent_i × β_i)
    // ══════════════════════════════════════════════════════════════
    console.log("\n\n══════════════════════════════════════════════════════════════");
    console.log("   APPROACH 2: REGRESSION (deduction ~ percent_i)");
    console.log("══════════════════════════════════════════════════════════════\n");

    // CONDITION regression
    const X_cond = valid.map(e => CONDITION_DEFECTS.map(n => e.cond[n].percent || 0));
    const y_cond = valid.map(e => COND_MAX - e.pfqCondition);

    console.log("── CONDITION (y = " + COND_MAX + " - pfqCondition) ──");
    console.log(`   ${valid.length} observations\n`);

    const olsCond = ols(X_cond, y_cond);
    const nnlsCond = nnls(X_cond, y_cond);

    console.log(pad("Defect", 18) + pad("OLS β", 10) + pad("NNLS β", 10) + pad("Excel/scale", 12) + pad("Mapping", 22));
    console.log("─".repeat(75));
    CONDITION_DEFECTS.forEach((name, i) => {
        const ex = EXCEL_COEFS[name];
        // The Excel coef works as: deduction += (percent/100) * coef * (COND_MAX/100)
        // So the equivalent β in terms of percent is: coef * COND_MAX / 10000
        const exScaled = ex.val != null ? (ex.val * COND_MAX / 10000).toFixed(3) : "-";
        console.log(
            pad(name, 18) +
            pad(olsCond ? olsCond.beta[i].toFixed(4) : "ERR", 10) +
            pad(nnlsCond.beta[i].toFixed(4), 10) +
            pad(exScaled, 12) +
            pad(ex.fr, 22)
        );
    });
    console.log(`\n   OLS  R² = ${olsCond ? olsCond.r2.toFixed(4) : "ERR"},  RMSE = ${olsCond ? olsCond.rmse.toFixed(4) : "ERR"}`);
    console.log(`   NNLS R² = ${nnlsCond.r2.toFixed(4)},  RMSE = ${nnlsCond.rmse.toFixed(4)}`);

    // Convert NNLS β back to "Excel-style" coefficients
    // β_i = coef_i * COND_MAX / 10000  →  coef_i = β_i * 10000 / COND_MAX
    console.log("\n   → Estimated coefficients (Excel-scale):");
    CONDITION_DEFECTS.forEach((name, i) => {
        const coef = nnlsCond.beta[i] * 10000 / COND_MAX;
        const ex = EXCEL_COEFS[name];
        console.log(`     ${pad(ex.fr || name, 25)} = ${Math.round(coef).toString().padStart(8)}  (Excel: ${ex.val != null ? ex.val : "N/A"})`);
    });

    // APPARENCE regression
    console.log("\n── APPARENCE (y = " + APP_MAX + " - pfqApparence) ──");
    console.log(`   ${valid.length} observations\n`);

    const X_app = valid.map(e => APPEARANCE_DEFECTS.map(n => e.app[n].percent || 0));
    const y_app = valid.map(e => APP_MAX - e.pfqApparence);

    const olsApp = ols(X_app, y_app);
    const nnlsApp = nnls(X_app, y_app);

    console.log(pad("Defect", 18) + pad("OLS β", 10) + pad("NNLS β", 10) + pad("Excel/scale", 12) + pad("Mapping", 22));
    console.log("─".repeat(75));
    APPEARANCE_DEFECTS.forEach((name, i) => {
        const ex = EXCEL_COEFS[name];
        const exScaled = ex.val != null ? (ex.val * APP_MAX / 10000).toFixed(3) : "-";
        console.log(
            pad(name, 18) +
            pad(olsApp ? olsApp.beta[i].toFixed(4) : "ERR", 10) +
            pad(nnlsApp.beta[i].toFixed(4), 10) +
            pad(exScaled, 12) +
            pad(ex.fr, 22)
        );
    });
    console.log(`\n   OLS  R² = ${olsApp ? olsApp.r2.toFixed(4) : "ERR"},  RMSE = ${olsApp ? olsApp.rmse.toFixed(4) : "ERR"}`);
    console.log(`   NNLS R² = ${nnlsApp.r2.toFixed(4)},  RMSE = ${nnlsApp.rmse.toFixed(4)}`);

    console.log("\n   → Estimated coefficients (Excel-scale):");
    APPEARANCE_DEFECTS.forEach((name, i) => {
        const coef = nnlsApp.beta[i] * 10000 / APP_MAX;
        const ex = EXCEL_COEFS[name];
        console.log(`     ${pad(ex.fr || name, 25)} = ${Math.round(coef).toString().padStart(8)}  (Excel: ${ex.val != null ? ex.val : "N/A"})`);
    });

    // ══════════════════════════════════════════════════════════════
    // APPROACH 3: Per-defect isolated regression (points ~ percent)
    // Each defect's points should be proportional to its percentage
    // ══════════════════════════════════════════════════════════════
    console.log("\n\n══════════════════════════════════════════════════════════════");
    console.log("   APPROACH 3: PER-DEFECT REGRESSION (points_i ~ percent_i)");
    console.log("══════════════════════════════════════════════════════════════\n");

    const allDefectNames = [...CONDITION_DEFECTS, ...APPEARANCE_DEFECTS];
    console.log(pad("Defect", 18) + pad("N", 5) + pad("β (pts/%)", 10) + pad("R²", 8) + pad("Excel", 8) + pad("Mapping", 22));
    console.log("─".repeat(75));

    allDefectNames.forEach(name => {
        const isCond = CONDITION_DEFECTS.includes(name);
        const xVals = [], yVals = [];
        valid.forEach(e => {
            const d = isCond ? e.cond[name] : e.app[name];
            if (d && (d.percent > 0 || d.points > 0)) {
                xVals.push(d.percent);
                yVals.push(d.points || 0);
            }
        });
        const ex = EXCEL_COEFS[name];
        if (xVals.length >= 3) {
            const X = xVals.map(x => [x]);
            const result = ols(X, yVals);
            if (result) {
                console.log(
                    pad(name, 18) + pad(xVals.length, 5) +
                    pad(result.beta[0].toFixed(4), 10) +
                    pad(result.r2.toFixed(3), 8) +
                    pad(ex.val != null ? ex.val : "-", 8) +
                    pad(ex.fr, 22)
                );
            }
        } else {
            console.log(
                pad(name, 18) + pad(xVals.length, 5) +
                pad("-", 10) + pad("-", 8) +
                pad(ex.val != null ? ex.val : "-", 8) +
                pad(ex.fr, 22)
            );
        }
    });

    // ══════════════════════════════════════════════════════════════
    // FINAL COMPARISON TABLE
    // ══════════════════════════════════════════════════════════════
    console.log("\n\n══════════════════════════════════════════════════════════════");
    console.log("   FINAL: RECOMMENDED vs EXCEL COEFFICIENTS");
    console.log("══════════════════════════════════════════════════════════════\n");

    console.log("── CONDITION (max /" + COND_MAX + ") ──");
    console.log(pad("Défaut (FR)", 25) + pad("Excel", 8) + pad("Estimé", 10) + pad("Ecart", 10) + pad("Confiance", 10));
    console.log("─".repeat(65));
    CONDITION_DEFECTS.forEach((name, i) => {
        const ex = EXCEL_COEFS[name];
        const estimated = Math.round(nnlsCond.beta[i] * 10000 / COND_MAX);
        const cr = condRatios.find(r => r.name === name);
        const conf = cr && cr.n >= 10 ? "Haute" : (cr && cr.n >= 3 ? "Moyenne" : "Faible");
        const ecart = ex.val != null ? `${((estimated - ex.val) / ex.val * 100).toFixed(0)}%` : "N/A";
        console.log(pad(ex.fr, 25) + pad(ex.val != null ? ex.val : "N/A", 8) + pad(estimated, 10) + pad(ecart, 10) + pad(`${conf} (n=${cr ? cr.n : 0})`, 10));
    });

    console.log("\n── APPARENCE (max /" + APP_MAX + ") ──");
    console.log(pad("Défaut (FR)", 25) + pad("Excel", 8) + pad("Estimé", 10) + pad("Ecart", 10) + pad("Confiance", 10));
    console.log("─".repeat(65));
    APPEARANCE_DEFECTS.forEach((name, i) => {
        const ex = EXCEL_COEFS[name];
        const estimated = Math.round(nnlsApp.beta[i] * 10000 / APP_MAX);
        const ar = appRatios.find(r => r.name === name);
        const conf = ar && ar.n >= 10 ? "Haute" : (ar && ar.n >= 3 ? "Moyenne" : "Faible");
        const ecart = ex.val != null ? `${((estimated - ex.val) / ex.val * 100).toFixed(0)}%` : "N/A";
        console.log(pad(ex.fr, 25) + pad(ex.val != null ? ex.val : "N/A", 8) + pad(estimated, 10) + pad(ecart, 10) + pad(`${conf} (n=${ar ? ar.n : 0})`, 10));
    });

    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("   Regression complete.");
    console.log("══════════════════════════════════════════════════════════════\n");
}

function pad(val, width) { return String(val).padEnd(width); }

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
