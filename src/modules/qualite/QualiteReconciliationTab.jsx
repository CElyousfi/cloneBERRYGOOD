/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: qualite | Déclaration(s): QualiteReconciliationTab */
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== QUALITÉ RÉCONCILIATION TAB =====================
        function QualiteReconciliationTab({ data, applyVarietyMapping }) {
            const [liquidations, setLiquidations] = useState([]);
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedFruit, setSelectedFruit] = useState('');

            const getISOWeek = (dateStr) => {
                if (!dateStr) return null;
                const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                if (!m) return null;
                const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
                d.setHours(0, 0, 0, 0);
                d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
                const week1 = new Date(d.getFullYear(), 0, 4);
                return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
            };
            const getISOYear = (dateStr) => {
                if (!dateStr) return null;
                const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                if (!m) return null;
                const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
                d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
                return d.getFullYear();
            };

            React.useEffect(() => {
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                ]).then(([liqJson, expJson]) => {
                    if (liqJson.success) setLiquidations(liqJson.liquidations.filter(l => l.rows && l.rows.length > 0));
                    if (expJson.success && expJson.expeditions) setExpeditions(expJson.expeditions);
                }).catch(() => {}).finally(() => setLoading(false));
            }, []);

            if (loading) return <div style={{textAlign:'center', padding:60}}><div className="spinner"></div><div style={{marginTop:12, color:'var(--gray-400)'}}>Chargement réconciliation...</div></div>;

            // --- Reconciliation algorithm ---
            const normalizeRid = (rid) => {
                if (!rid) return '';
                let s = String(rid).trim().toUpperCase();
                const m = s.match(/^RID-0*(\d+)$/);
                return m ? m[1] : s;
            };

            // --- Fuzzy matching helpers ---
            const normalizeVariety = (v) => {
                if (!v) return '';
                return String(v).toLowerCase().replace(/[™®\s]/g, '').replace(/sol$/, '');
            };
            const parseDate = (d) => {
                if (!d) return null;
                // Handle MM/DD/YYYY, M/D/YYYY, YYYY-MM-DD, and "MM/DD/YYYY HH:MM GMT"
                const m1 = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                if (m1) return new Date(parseInt(m1[3]), parseInt(m1[1]) - 1, parseInt(m1[2]));
                const m2 = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]));
                return null;
            };
            const daysDiff = (d1, d2) => {
                if (!d1 || !d2) return 999;
                return Math.abs(Math.round((d1 - d2) / 86400000));
            };
            const computeFuzzyScore = (liqRow, expRow) => {
                let score = 0;
                const breakdown = { variety: 0, date: 0, pfq: 0, kg: 0 };
                // Variety (40 pts)
                const lv = normalizeVariety(liqRow.variety || liqRow.varietyCode);
                const ev = normalizeVariety(expRow.variety);
                if (lv && ev && (lv === ev || lv.includes(ev) || ev.includes(lv))) {
                    breakdown.variety = 40;
                }
                score += breakdown.variety;
                // Date proximity (25 pts)
                const dd = daysDiff(parseDate(liqRow.date), parseDate(expRow.date));
                breakdown.date = dd === 0 ? 25 : dd <= 1 ? 20 : dd <= 3 ? 15 : dd <= 7 ? 8 : 0;
                score += breakdown.date;
                // PFQ proximity (20 pts) — liq scale ~0-100, exp scale ~0-90
                const lPfq = liqRow.pfqScore;
                const ePfq = expRow.pfq;
                if (lPfq && ePfq) {
                    const lNorm = lPfq / 100;
                    const eNorm = ePfq / 90;
                    breakdown.pfq = Math.round(20 * (1 - Math.abs(lNorm - eNorm)));
                } else {
                    breakdown.pfq = 5; // neutral when missing
                }
                score += breakdown.pfq;
                // Kg proximity (15 pts)
                const lKg = liqRow.receiptQtyKg || 0;
                const eKg = expRow.kg || 0;
                if (lKg > 0 && eKg > 0) {
                    const ratio = Math.min(lKg, eKg) / Math.max(lKg, eKg);
                    breakdown.kg = Math.round(15 * ratio);
                } else {
                    breakdown.kg = 3; // neutral
                }
                score += breakdown.kg;
                return { score, breakdown };
            };
            const fuzzyMatchUnmatched = (unmatchedLiq, unmatchedExp) => {
                if (!unmatchedLiq.length || !unmatchedExp.length) return [];
                // Build all candidate pairs
                const candidates = [];
                unmatchedLiq.forEach((liq, li) => {
                    unmatchedExp.forEach((exp, ei) => {
                        const { score, breakdown } = computeFuzzyScore(liq.row || liq, exp);
                        if (score >= 55) candidates.push({ li, ei, liq, exp, score, breakdown });
                    });
                });
                // Greedy best-first matching
                candidates.sort((a, b) => b.score - a.score);
                const usedLiq = new Set();
                const usedExp = new Set();
                const matches = [];
                candidates.forEach(c => {
                    if (usedLiq.has(c.li) || usedExp.has(c.ei)) return;
                    usedLiq.add(c.li);
                    usedExp.add(c.ei);
                    matches.push(c);
                });
                return matches;
            };

            // Build GLOBAL set of all liquidation receipt IDs
            // First deduplicate liquidations by week (same logic as liquidation tab)
            const liqDedup = {};
            liquidations.forEach(l => {
                if (!l.week) return;
                const fruit = (l.fruit || l.fruitCode || '').toLowerCase();
                if (selectedFruit === 'framboise' && /myrtille|blue/i.test(fruit)) return;
                if (selectedFruit === 'myrtille' && /framboise|rasp/i.test(fruit)) return;
                const ywMatch = (l.subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                const year = ywMatch ? parseInt(ywMatch[1]) : 2025;
                const key = `${year}-W${l.week}`;
                const hasFruit = l.fruit && l.fruit !== '?';
                if (!liqDedup[key]) {
                    liqDedup[key] = { l, year };
                } else {
                    const ex = liqDedup[key].l;
                    const exHasFruit = ex.fruit && ex.fruit !== '?';
                    if (hasFruit && !exHasFruit) liqDedup[key] = { l, year };
                    else if (hasFruit === exHasFruit && (l.rows || []).length > (ex.rows || []).length) liqDedup[key] = { l, year };
                }
            });
            const allLiqRidsNorm = new Map();
            const liqByWeek = {};
            Object.entries(liqDedup).forEach(([key, { l, year }]) => {
                if (!liqByWeek[key]) liqByWeek[key] = { week: l.week, year, receiptIds: new Set(), receiptIdsNorm: new Set(), rows: [] };
                (l.rows || []).forEach(r => {
                    if (r.receiptId) {
                        liqByWeek[key].receiptIds.add(r.receiptId);
                        const norm = normalizeRid(r.receiptId);
                        liqByWeek[key].receiptIdsNorm.add(norm);
                        allLiqRidsNorm.set(norm, { originalId: r.receiptId, week: l.week, year });
                    }
                    liqByWeek[key].rows.push(r);
                });
            });

            // Build GLOBAL set of all expedition receipt IDs
            const allExpRidsNorm = new Map();
            const expByWeekRec = {};
            expeditions.filter(e => e.overallResult !== 'REJECT' && e.status !== 'Annulée (doublon)').forEach(e => {
                const w = getISOWeek(e.date);
                const y = getISOYear(e.date);
                if (!w || !y) return;
                const key = `${y}-W${w}`;
                if (!expByWeekRec[key]) expByWeekRec[key] = [];
                const pfqCond = e.conditionPoints || 0;
                const pfqApp = e.appearancePoints || 0;
                const pfqTotal = (pfqCond + pfqApp) || null;
                const exp = {
                    receiptId: e.receiptId,
                    receiptIdNorm: normalizeRid(e.receiptId),
                    variety: applyVarietyMapping ? applyVarietyMapping(e.batchNumber, e.variety) : e.variety,
                    kg: e.batchWeight || 0,
                    date: e.date,
                    ferme: e.ranch === '200742' ? 'F1' : e.ranch === '200876' ? 'F5' : e.ranch || '-',
                    status: e.status,
                    id: e.id,
                    pfq: pfqTotal,
                    brix: e.brixValue || null,
                    overallResult: e.overallResult,
                };
                expByWeekRec[key].push(exp);
                allExpRidsNorm.set(exp.receiptIdNorm, { exp, week: w, year: y });
            });

            // Smart bidirectional matching per liquidated week
            const reconciliation = Object.entries(liqByWeek).map(([key, liq]) => {
                const [yearStr, weekStr] = key.split('-W');
                const yr = parseInt(yearStr);
                const wk = parseInt(weekStr);

                // Pool: same week + adjacent weeks expeditions for display
                const adjacentKeys = [
                    key,
                    `${wk === 1 ? yr - 1 : yr}-W${wk === 1 ? 52 : wk - 1}`,
                    `${wk === 52 ? yr + 1 : yr}-W${wk === 52 ? 1 : wk + 1}`,
                ];
                const poolExps = adjacentKeys.flatMap(k => expByWeekRec[k] || []);
                const sameWeekExps = expByWeekRec[key] || [];

                // === LIQ PERSPECTIVE: for each liq receipt ID, find matching expedition GLOBALLY ===
                const liqMatchResults = [...liq.receiptIdsNorm].map(norm => {
                    const expMatch = allExpRidsNorm.get(norm);
                    const orig = [...liq.receiptIds].find(r => normalizeRid(r) === norm);
                    const row = liq.rows.find(r => normalizeRid(r.receiptId) === norm);
                    return { norm, orig: orig || norm, row, matched: !!expMatch, expMatch };
                });
                const liqMatched = liqMatchResults.filter(r => r.matched).length;
                const liqUnmatched = liqMatchResults.filter(r => !r.matched);

                // === EXP PERSPECTIVE: for each same-week expedition, check if in ANY liquidation ===
                const expMatchResults = sameWeekExps.map(e => ({
                    ...e,
                    matchedInThisLiq: liq.receiptIdsNorm.has(e.receiptIdNorm),
                    matchedInAnyLiq: allLiqRidsNorm.has(e.receiptIdNorm),
                }));
                const expNotInAnyLiq = expMatchResults.filter(e => !e.matchedInAnyLiq);

                // === KG TOTALS for matched receipts ===
                // Aggregate liq kg per unique receipt ID (sum grade splits)
                const liqKgByRid = {};
                (liq.rows || []).forEach(r => {
                    if (!r.receiptId) return;
                    const norm = normalizeRid(r.receiptId);
                    if (!liqKgByRid[norm]) liqKgByRid[norm] = 0;
                    liqKgByRid[norm] += (r.receiptQtyKg || 0);
                });

                // === FUZZY MATCHING for unmatched items ===
                const fuzzyMatches = fuzzyMatchUnmatched(liqUnmatched, expNotInAnyLiq);
                const fuzzyMatchedLiqNorms = new Set(fuzzyMatches.map(fm => fm.liq.norm));
                const fuzzyMatchedExpNorms = new Set(fuzzyMatches.map(fm => fm.exp.receiptIdNorm));

                // === SCORE: based on liq coverage (exact + fuzzy) ===
                const totalLiq = liq.receiptIdsNorm.size;
                const totalExp = sameWeekExps.length;
                const matchScore = totalLiq > 0 ? Math.round((liqMatched + fuzzyMatches.length) / totalLiq * 100) : (totalExp > 0 ? 0 : null);

                // Extra in liq = liq RIDs with NO matching expedition (excluding fuzzy matches)
                const extraInLiq = liqUnmatched.filter(u => !fuzzyMatchedLiqNorms.has(u.norm)).map(u => ({
                    receiptId: u.orig,
                    variety: u.row ? u.row.variety : 'Inconnue',
                    kg: liqKgByRid[u.norm] || (u.row ? (u.row.receiptQtyKg || 0) : 0),
                    week: liq.week, year: liq.year,
                }));

                // Missing from liq = same-week expeditions not in ANY liquidation (excluding fuzzy matches)
                const missingFromLiq = expNotInAnyLiq.filter(e => !fuzzyMatchedExpNorms.has(e.receiptIdNorm)).map(e => ({
                    receiptId: e.receiptId, variety: e.variety, kg: e.kg,
                    ferme: e.ferme, date: e.date, id: e.id,
                }));
                let matchedLiqKg = 0, matchedExpKg = 0, totalLiqKg = 0;
                Object.entries(liqKgByRid).forEach(([norm, kg]) => {
                    totalLiqKg += kg;
                    const expMatch = allExpRidsNorm.get(norm);
                    if (expMatch) {
                        matchedLiqKg += kg;
                        matchedExpKg += (expMatch.exp.kg || 0);
                    }
                });
                const totalExpKg = sameWeekExps.reduce((s, e) => s + (e.kg || 0), 0);

                // Add fuzzy-matched kg to totals
                fuzzyMatches.forEach(fm => {
                    const lKg = liqKgByRid[fm.liq.norm] || (fm.liq.row ? fm.liq.row.receiptQtyKg || 0 : 0);
                    matchedLiqKg += lKg;
                    matchedExpKg += (fm.exp.kg || 0);
                });

                return {
                    key, week: liq.week, year: liq.year,
                    totalExp, totalLiq, liqMatched,
                    missingFromLiq, extraInLiq, fuzzyMatches,
                    matchScore, missingKg: missingFromLiq.reduce((s, e) => s + e.kg, 0),
                    sameWeekExps: poolExps, liqRows: liq.rows,
                    liqMatchResults, expMatchResults,
                    matchedLiqKg, matchedExpKg, totalLiqKg, totalExpKg,
                };
            }).filter(r => r.matchScore !== null).sort((a, b) => {
                if (b.year !== a.year) return b.year - a.year;
                return b.week - a.week;
            });

            const totalMissing = reconciliation.reduce((s, r) => s + r.missingFromLiq.length, 0);
            const totalExtra = reconciliation.reduce((s, r) => s + r.extraInLiq.length, 0);
            const totalFuzzy = reconciliation.reduce((s, r) => s + r.fuzzyMatches.length, 0);
            const avgScore = reconciliation.length > 0 ? Math.round(reconciliation.reduce((s, r) => s + (r.matchScore || 0), 0) / reconciliation.length) : 0;
            const grandMatchedLiqKg = reconciliation.reduce((s, r) => s + (r.matchedLiqKg || 0), 0);
            const grandMatchedExpKg = reconciliation.reduce((s, r) => s + (r.matchedExpKg || 0), 0);
            const grandTotalLiqKg = reconciliation.reduce((s, r) => s + (r.totalLiqKg || 0), 0);
            const grandTotalExpKg = reconciliation.reduce((s, r) => s + (r.totalExpKg || 0), 0);
            // True total of ALL expeditions (including weeks without liquidation)
            const allExpKgTotal = Object.values(expByWeekRec).flat().reduce((s, e) => s + (e.kg || 0), 0);
            const expKgHorsRecon = allExpKgTotal - grandTotalExpKg;
            const kgRatio = grandMatchedExpKg > 0 ? (grandMatchedLiqKg / grandMatchedExpKg) : 0;

            // Non-liquidated weeks
            const allExpWeeks = Object.keys(expByWeekRec);
            const allLiqWeeks = new Set(Object.keys(liqByWeek));
            const nonLiquidatedWeeks = allExpWeeks.filter(k => !allLiqWeeks.has(k)).sort((a, b) => {
                const [ya, wa] = a.split('-W').map(Number);
                const [yb, wb] = b.split('-W').map(Number);
                return yb !== ya ? yb - ya : wb - wa;
            });

            return (
                <div>
                    {/* Header stats */}
                    <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:16, marginBottom:16}}>
                        <div style={{background:'var(--card-bg)', borderRadius:12, padding:20, textAlign:'center', boxShadow:'var(--shadow-sm)'}}>
                            <div style={{fontSize:28, fontWeight:700, color:'var(--green)'}}>{avgScore}%</div>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>Score moyen</div>
                        </div>
                        <div style={{background:'var(--card-bg)', borderRadius:12, padding:20, textAlign:'center', boxShadow:'var(--shadow-sm)'}}>
                            <div style={{fontSize:28, fontWeight:700, color:'var(--dark)'}}>{reconciliation.length}</div>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>Semaines liquidées</div>
                        </div>
                        <div style={{background:'var(--card-bg)', borderRadius:12, padding:20, textAlign:'center', boxShadow:'var(--shadow-sm)'}}>
                            <div style={{fontSize:28, fontWeight:700, color: totalFuzzy > 0 ? '#7b1fa2' : '#4caf50'}}>{totalFuzzy}</div>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>Matchs fuzzy</div>
                        </div>
                        <div style={{background:'var(--card-bg)', borderRadius:12, padding:20, textAlign:'center', boxShadow:'var(--shadow-sm)'}}>
                            <div style={{fontSize:28, fontWeight:700, color: totalMissing > 0 ? '#e65100' : '#4caf50'}}>{totalMissing}</div>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>Expéd. non liquidées</div>
                        </div>
                        <div style={{background:'var(--card-bg)', borderRadius:12, padding:20, textAlign:'center', boxShadow:'var(--shadow-sm)'}}>
                            <div style={{fontSize:28, fontWeight:700, color: totalExtra > 0 ? '#1565c0' : '#4caf50'}}>{totalExtra}</div>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>Liq. sans expédition</div>
                        </div>
                    </div>
                    {/* Kg comparison panel */}
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom:24}}>
                        <div style={{background:'linear-gradient(135deg, #e3f2fd, #bbdefb)', borderRadius:12, padding:20, textAlign:'center'}}>
                            <div style={{fontSize:11, fontWeight:600, color:'#1565c0', textTransform:'uppercase', marginBottom:6}}>Liquidation (Receipt Qty)</div>
                            <div style={{fontSize:24, fontWeight:700, color:'#0d47a1'}}>{Math.round(grandMatchedLiqKg).toLocaleString('fr-FR')} kg</div>
                            <div style={{fontSize:11, color:'#1976d2', marginTop:4}}>Total sem. liquidées: {Math.round(grandTotalLiqKg).toLocaleString('fr-FR')} kg</div>
                        </div>
                        <div style={{background:'linear-gradient(135deg, #e8f5e9, #c8e6c9)', borderRadius:12, padding:20, textAlign:'center'}}>
                            <div style={{fontSize:11, fontWeight:600, color:'#2e7d32', textTransform:'uppercase', marginBottom:6}}>Expédition (Batch Weight)</div>
                            <div style={{fontSize:24, fontWeight:700, color:'#1b5e20'}}>{Math.round(grandMatchedExpKg).toLocaleString('fr-FR')} kg</div>
                            <div style={{fontSize:11, color:'#388e3c', marginTop:4}}>Total toutes exp: {Math.round(allExpKgTotal).toLocaleString('fr-FR')} kg</div>
                            {expKgHorsRecon > 0 && <div style={{fontSize:10, color:'#e65100', marginTop:2}}>{Math.round(expKgHorsRecon).toLocaleString('fr-FR')} kg hors réconciliation (sem. sans liquidation)</div>}
                        </div>
                        <div style={{background:'linear-gradient(135deg, #fff3e0, #ffe0b2)', borderRadius:12, padding:20, textAlign:'center'}}>
                            <div style={{fontSize:11, fontWeight:600, color:'#e65100', textTransform:'uppercase', marginBottom:6}}>Écart (matchés)</div>
                            <div style={{fontSize:24, fontWeight:700, color:'#bf360c'}}>{Math.round(grandMatchedLiqKg - grandMatchedExpKg).toLocaleString('fr-FR')} kg</div>
                            <div style={{fontSize:11, color:'#e65100', marginTop:4}}>Ratio Liq/Exp: {kgRatio.toFixed(2)}x</div>
                        </div>
                    </div>

                    {/* Culture filter */}
                    <div className="chip-group" style={{marginBottom:20}}>
                        <span className="chip-group-label">Culture :</span>
                        {['', 'framboise', 'myrtille'].map(f => (
                            <button key={f} className={`chip ${f === 'myrtille' ? 'c-indigo' : 'c-berry'} ${selectedFruit === f ? 'active' : ''}`} onClick={() => setSelectedFruit(f)}>
                                {f === '' ? 'Toutes' : f === 'framboise' ? '🍓 Framboise' : '🫐 Myrtille'}
                            </button>
                        ))}
                    </div>

                    {/* Main reconciliation table */}
                    <Panel title="Réconciliation par semaine" icon="fa-scale-balanced" actions={
                        totalMissing > 0 ? <span style={{background:'#fff3e0', color:'#e65100', padding:'4px 10px', borderRadius:8, fontSize:11, fontWeight:700}}>
                            {totalMissing} expédition{totalMissing > 1 ? 's' : ''} non liquidée{totalMissing > 1 ? 's' : ''}
                        </span> : <span style={{background:'rgba(76,175,80,0.1)', color:'#2e7d32', padding:'4px 10px', borderRadius:8, fontSize:11, fontWeight:700}}>Tout est réconcilié</span>
                    }>
                        <table className="data-table" style={{fontSize:12}}>
                            <thead>
                                <tr>
                                    <th>Semaine</th>
                                    <th>Expéd.</th>
                                    <th>Liq. RIDs</th>
                                    <th>Exact</th>
                                    <th>Fuzzy</th>
                                    <th>Score</th>
                                    <th style={{textAlign:'right'}}>Liq kg</th>
                                    <th style={{textAlign:'right'}}>Exp kg</th>
                                    <th style={{textAlign:'right'}}>Écart kg</th>
                                    <th>Non liquidées</th>
                                    <th>Sans expédition</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reconciliation.map(r => {
                                    const scoreColor = r.matchScore >= 100 ? '#4caf50' : r.matchScore >= 90 ? '#ff9800' : '#e53935';
                                    return (
                                        <React.Fragment key={r.key}>
                                        <tr style={r.missingFromLiq.length > 0 || r.extraInLiq.length > 0 ? {background:'rgba(255,152,0,0.04)'} : {}}>
                                            <td><span style={{fontWeight:700}}>W{r.week}-{String(r.year).slice(-2)}</span></td>
                                            <td>{r.totalExp}</td>
                                            <td>{r.totalLiq}</td>
                                            <td>{r.liqMatched}/{r.totalLiq}</td>
                                            <td>
                                                {r.fuzzyMatches.length > 0 ? (
                                                    <span style={{background:'rgba(156,39,176,0.1)', color:'#7b1fa2', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11}}>
                                                        {r.fuzzyMatches.length} <i className="fa-solid fa-link" style={{fontSize:9}}></i>
                                                    </span>
                                                ) : <span style={{color:'var(--gray-400)', fontSize:11}}>-</span>}
                                            </td>
                                            <td>
                                                <div style={{display:'flex', alignItems:'center', gap:6}}>
                                                    <div style={{width:60, height:8, background:'#e0e0e0', borderRadius:4, overflow:'hidden', display:'flex'}}>
                                                        <div style={{width:`${r.totalLiq > 0 ? Math.min(r.liqMatched / r.totalLiq * 100, 100) : 0}%`, height:'100%', background:'#4caf50'}}></div>
                                                        <div style={{width:`${r.totalLiq > 0 ? Math.min(r.fuzzyMatches.length / r.totalLiq * 100, 100) : 0}%`, height:'100%', background:'#9c27b0'}}></div>
                                                    </div>
                                                    <span style={{fontWeight:700, color:scoreColor, fontSize:12}}>{r.matchScore}%</span>
                                                </div>
                                            </td>
                                            <td style={{textAlign:'right', fontWeight:600, color:'#1565c0'}}>{Math.round(r.matchedLiqKg).toLocaleString('fr-FR')}</td>
                                            <td style={{textAlign:'right', fontWeight:600, color:'#2e7d32'}}>{Math.round(r.matchedExpKg).toLocaleString('fr-FR')}</td>
                                            <td style={{textAlign:'right', fontWeight:700, color: (r.matchedLiqKg - r.matchedExpKg) > 0 ? '#e65100' : '#2e7d32'}}>
                                                {Math.round(r.matchedLiqKg - r.matchedExpKg).toLocaleString('fr-FR')}
                                                {r.matchedExpKg > 0 && <span style={{fontSize:10, fontWeight:400, color:'var(--gray-400)', marginLeft:4}}>({(r.matchedLiqKg / r.matchedExpKg).toFixed(1)}x)</span>}
                                            </td>
                                            <td>
                                                {r.missingFromLiq.length > 0 ? (
                                                    <span style={{background:'#fff3e0', color:'#e65100', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11}}>
                                                        {r.missingFromLiq.length} ({Math.round(r.missingKg)} kg)
                                                    </span>
                                                ) : <span style={{color:'#4caf50', fontWeight:600}}>OK</span>}
                                            </td>
                                            <td>
                                                {r.extraInLiq.length > 0 ? (
                                                    <span style={{background:'rgba(33,150,243,0.1)', color:'#1565c0', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11}}>
                                                        {r.extraInLiq.length}
                                                    </span>
                                                ) : <span style={{color:'#4caf50', fontWeight:600}}>OK</span>}
                                            </td>
                                        </tr>
                                        {/* Detail rows for issues and fuzzy matches */}
                                        {(r.missingFromLiq.length > 0 || r.extraInLiq.length > 0 || r.fuzzyMatches.length > 0) && (
                                            <tr style={{background:'rgba(0,0,0,0.02)'}}>
                                                <td colSpan={11} style={{padding:'8px 16px'}}>
                                                    <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
                                                        {r.fuzzyMatches.map((fm, i) => (
                                                            <span key={'fm'+i} style={{display:'inline-flex', alignItems:'center', gap:4, background:'rgba(156,39,176,0.1)', padding:'3px 8px', borderRadius:6, fontSize:11, color:'#7b1fa2', fontWeight:600}}>
                                                                <i className="fa-solid fa-link" style={{marginRight:2, fontSize:9}}></i>
                                                                {fm.liq.orig} ↔ {fm.exp.receiptId}
                                                                <span style={{fontSize:10, opacity:0.8}}>({fm.liq.row ? fm.liq.row.variety : '?'} / {fm.exp.variety})</span>
                                                                <span style={{background:'#7b1fa2', color:'#fff', borderRadius:4, padding:'1px 5px', fontSize:9, fontWeight:700}}>{fm.score}%</span>
                                                                <span style={{fontSize:9, color:'#9c27b0', opacity:0.7}} title={`Variété:${fm.breakdown.variety} Date:${fm.breakdown.date} PFQ:${fm.breakdown.pfq} Kg:${fm.breakdown.kg}`}>
                                                                    V{fm.breakdown.variety} D{fm.breakdown.date} P{fm.breakdown.pfq} K{fm.breakdown.kg}
                                                                </span>
                                                            </span>
                                                        ))}
                                                        {r.missingFromLiq.map((e, i) => (
                                                            <span key={i} style={{display:'inline-block', background:'rgba(255,152,0,0.12)', padding:'3px 8px', borderRadius:6, fontSize:11, color:'#e65100', fontWeight:600}}>
                                                                <i className="fa-solid fa-triangle-exclamation" style={{marginRight:3, fontSize:9}}></i>
                                                                {e.receiptId} — {e.variety} — {Math.round(e.kg)}kg
                                                            </span>
                                                        ))}
                                                        {r.extraInLiq.map((extra, i) => (
                                                            <span key={'x'+i} style={{display:'inline-flex', alignItems:'center', gap:4, background:'rgba(33,150,243,0.1)', padding:'3px 8px', borderRadius:6, fontSize:11, color:'#1565c0', fontWeight:600}}>
                                                                <i className="fa-solid fa-circle-question" style={{marginRight:3, fontSize:9}}></i>
                                                                {extra.receiptId} — {extra.variety} — {Math.round(extra.kg)}kg
                                                                <button style={{background:'#1976d2', color:'#fff', border:'none', borderRadius:4, padding:'2px 8px', fontSize:10, cursor:'pointer', fontWeight:700, marginLeft:4}}
                                                                    onClick={() => {
                                                                        if (!confirm(`Importer l'expédition ${extra.receiptId} (${extra.variety}, ${Math.round(extra.kg)}kg) ?`)) return;
                                                                        fetch('/api/email-analysis?action=create-manual-expedition', {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ receiptId: extra.receiptId, variety: extra.variety, kg: extra.kg, week: extra.week, year: extra.year, fruit: selectedFruit || 'framboise', source: 'import-liquidation' })
                                                                        }).then(r2 => r2.json()).then(json => {
                                                                            if (json.success) { alert(`Expédition ${extra.receiptId} importée !`); window.location.reload(); }
                                                                            else alert('Erreur: ' + (json.error || 'Echec'));
                                                                        }).catch(err => alert('Erreur: ' + err.message));
                                                                    }}>
                                                                    <i className="fa-solid fa-plus" style={{marginRight:2}}></i>Importer
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div style={{marginTop:8, fontSize:10, color:'var(--gray-400)', fontStyle:'italic'}}>
                            Matching intelligent : comparaison normalisée des Receipt IDs + semaines adjacentes + global. Expéditions REJECT et annulées exclues.
                        </div>
                    </Panel>

                    {/* Non-liquidated weeks overview */}
                    {nonLiquidatedWeeks.length > 0 && (
                        <Panel title={`Semaines non liquidées (${nonLiquidatedWeeks.length})`} icon="fa-hourglass-half">
                            <table className="data-table" style={{fontSize:12}}>
                                <thead>
                                    <tr>
                                        <th>Semaine</th>
                                        <th>Expéditions</th>
                                        <th>Total kg</th>
                                        <th>Variétés</th>
                                        <th>Statut</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {nonLiquidatedWeeks.map(wKey => {
                                        const exps = expByWeekRec[wKey] || [];
                                        const totalKg = exps.reduce((s, e) => s + e.kg, 0);
                                        const varieties = [...new Set(exps.map(e => e.variety))].join(', ');
                                        const [y, w] = wKey.split('-W');
                                        return (
                                            <tr key={wKey}>
                                                <td><span style={{fontWeight:700}}>W{w}-{String(y).slice(-2)}</span></td>
                                                <td>{exps.length}</td>
                                                <td>{Math.round(totalKg).toLocaleString()} kg</td>
                                                <td style={{fontSize:11}}>{varieties}</td>
                                                <td><span style={{background:'#fff3e0', color:'#e65100', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11}}>En attente</span></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </Panel>
                    )}

                    {/* Detailed reconciliation per week */}
                    {reconciliation.length > 0 && (
                        <Panel title="Détail des écarts" icon="fa-magnifying-glass-chart">
                            {reconciliation.map(r => {
                                // Detect likely duplicates in expeditions:
                                // Same variety + same kg appearing 2+ times, but liquidation has only 1 match
                                const expDupMap = {};
                                r.sameWeekExps.forEach(e => {
                                    const dupKey = `${e.variety}_${Math.round(e.kg)}`;
                                    if (!expDupMap[dupKey]) expDupMap[dupKey] = [];
                                    expDupMap[dupKey].push(e);
                                });
                                const likelyDuplicates = new Set();
                                Object.values(expDupMap).forEach(group => {
                                    if (group.length >= 2) {
                                        // Count how many times this RID appears in liquidation
                                        const liqCount = group.filter(e => r.liqMatchResults.some(m => m.norm === e.receiptIdNorm)).length;
                                        // If liquidation has fewer matches than expeditions with same kg+variety, flag extras
                                        if (liqCount < group.length) {
                                            group.slice(liqCount || 1).forEach(e => likelyDuplicates.add(e.id));
                                        }
                                    }
                                });

                                // Aggregate liquidation rows by receiptId (sum kg for same RID)
                                const liqAggregated = {};
                                r.liqRows.filter(row => row.receiptId).forEach(row => {
                                    const norm = normalizeRid(row.receiptId);
                                    if (!liqAggregated[norm]) {
                                        liqAggregated[norm] = { ...row, receiptQtyKg: row.receiptQtyKg || 0, pfqScore: row.pfqScore || null, count: 1 };
                                    } else {
                                        liqAggregated[norm].receiptQtyKg += (row.receiptQtyKg || 0);
                                        if (row.pfqScore && !liqAggregated[norm].pfqScore) liqAggregated[norm].pfqScore = row.pfqScore;
                                        liqAggregated[norm].count++;
                                    }
                                });
                                const liqRowsAgg = Object.values(liqAggregated);

                                return (
                                <div key={r.key} style={{marginBottom:24}}>
                                    <h4 style={{margin:'0 0 8px', fontSize:14, color:'var(--dark)'}}>
                                        <span style={{fontWeight:700}}>W{r.week}-{String(r.year).slice(-2)}</span>
                                        <span style={{fontSize:11, color: r.matchScore >= 100 ? '#4caf50' : r.matchScore >= 90 ? '#ff9800' : '#e53935', marginLeft:8}}>Score: {r.matchScore}%</span>
                                    </h4>
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
                                        {/* Expeditions (same week + adjacent) */}
                                        <div>
                                            <div style={{fontSize:11, fontWeight:700, color:'var(--gray-500)', marginBottom:6}}>Expéditions (W{r.week} ± 1)</div>
                                            <table style={{width:'100%', fontSize:11, borderCollapse:'collapse'}}>
                                                <thead><tr style={{background:'#f5f5f5'}}>
                                                    <th style={{padding:'4px 8px', textAlign:'left'}}>Receipt ID</th>
                                                    <th style={{padding:'4px 8px', textAlign:'left'}}>Variété</th>
                                                    <th style={{padding:'4px 8px', textAlign:'right'}}>Kg</th>
                                                    <th style={{padding:'4px 8px', textAlign:'right'}}>PFQ</th>
                                                    <th style={{padding:'4px 8px', textAlign:'center'}}>Dans Liq</th>
                                                </tr></thead>
                                                <tbody>
                                                    {r.sameWeekExps.map((e, i) => {
                                                        const inThisLiq = r.liqMatchResults.some(m => m.norm === e.receiptIdNorm);
                                                        const inAnyLiq = allLiqRidsNorm.has(e.receiptIdNorm);
                                                        const isDup = likelyDuplicates.has(e.id);
                                                        return (
                                                            <tr key={i} style={{background: isDup ? 'rgba(255,152,0,0.12)' : inThisLiq ? 'rgba(76,175,80,0.05)' : inAnyLiq ? 'rgba(33,150,243,0.05)' : 'rgba(255,152,0,0.05)'}}>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', fontWeight:600}}>
                                                                    {e.receiptId}
                                                                    {isDup && <span style={{color:'#ff9800', fontSize:9, marginLeft:4}} title="Doublon probable: même variété et même poids qu'une autre expédition">DOUBLON?</span>}
                                                                </td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0'}}>{e.variety}</td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'right'}}>{Math.round(e.kg)}</td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'right', color: e.pfq ? (e.pfq >= 70 ? '#4caf50' : '#ff9800') : 'var(--gray-400)'}}>
                                                                    {e.pfq ? e.pfq + '/90' : '-'}
                                                                    {e.brix ? <span style={{fontSize:9, color:'#9C27B0', marginLeft:2}}>B{e.brix}</span> : ''}
                                                                </td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'center'}}>
                                                                    {inThisLiq ? <i className="fa-solid fa-check" style={{color:'#4caf50'}}></i> : inAnyLiq ? <span style={{fontSize:9, color:'#1976d2'}}>autre sem.</span> : <i className="fa-solid fa-xmark" style={{color:'#e53935'}}></i>}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        {/* Liquidation rows (aggregated by receipt ID) */}
                                        <div>
                                            <div style={{fontSize:11, fontWeight:700, color:'var(--gray-500)', marginBottom:6}}>Liquidation (semaine {r.week})</div>
                                            <table style={{width:'100%', fontSize:11, borderCollapse:'collapse'}}>
                                                <thead><tr style={{background:'#f5f5f5'}}>
                                                    <th style={{padding:'4px 8px', textAlign:'left'}}>Receipt ID</th>
                                                    <th style={{padding:'4px 8px', textAlign:'left'}}>Variété</th>
                                                    <th style={{padding:'4px 8px', textAlign:'right'}}>Kg</th>
                                                    <th style={{padding:'4px 8px', textAlign:'right'}}>PFQ</th>
                                                    <th style={{padding:'4px 8px', textAlign:'center'}}>Match</th>
                                                </tr></thead>
                                                <tbody>
                                                    {liqRowsAgg.map((row, i) => {
                                                        const norm = normalizeRid(row.receiptId);
                                                        const isMatched = allExpRidsNorm.has(norm);
                                                        return (
                                                            <tr key={i} style={{background: isMatched ? 'rgba(76,175,80,0.05)' : 'rgba(33,150,243,0.05)'}}>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', fontWeight:600}}>{row.receiptId}</td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0'}}>{row.variety || '-'}</td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'right'}}>{Math.round(row.receiptQtyKg)}</td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'right', color: row.pfqScore ? (row.pfqScore >= 70 ? '#4caf50' : '#ff9800') : 'var(--gray-400)'}}>
                                                                    {row.pfqScore ? row.pfqScore.toFixed(1) : '-'}
                                                                </td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'center'}}>
                                                                    {isMatched ? <i className="fa-solid fa-check" style={{color:'#4caf50'}}></i> : <i className="fa-solid fa-xmark" style={{color:'#1565c0'}}></i>}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                                );
                            })}
                        </Panel>
                    )}
                </div>
            );
        }

export { QualiteReconciliationTab };
