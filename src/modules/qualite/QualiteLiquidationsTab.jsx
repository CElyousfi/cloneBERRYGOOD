/* Module: qualite | Déclaration(s): QualiteLiquidationsTab */
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { invalidateCache } from '../shared/invalidateCache.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== QUALITÉ LIQUIDATIONS TAB =====================
        function QualiteLiquidationsTab({ data, applyVarietyMapping, compactView }) {
            const [liquidations, setLiquidations] = useState([]);
            const [expeditions, setExpeditions] = useState([]);
            const [bonsApport, setBonsApport] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedLiq, setSelectedLiq] = useState(null);
            const [selectedFerme, setSelectedFerme] = useState('');
            const [selectedVariete, setSelectedVariete] = useState('');
            const [selectedFruit, setSelectedFruit] = useState('');
            const [chartVariete, setChartVariete] = useState('');
            const [popupWeek, setPopupWeek] = useState(null); // { week, year }
            const [kpiDetailPopup, setKpiDetailPopup] = useState(null); // 'gsnet' | 'qty' | null
            const [forecastsByFruit, setForecastsByFruit] = useState({ framboise: {}, myrtille: {} }); // { framboise: { week: {minMad,maxMad,avgMad,year,updatedAt} } }
            const [forecastModal, setForecastModal] = useState(null); // { fruitCode, year, step, file, imageB64, mediaType, weeks, loading, error }
            const [privateMode, setPrivateMode] = useState(false); // Masque toutes les valeurs monétaires (CA, GS Net, commissions) pour démos partenaires

            // ISO week number helper
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
                const yr = new Date().getFullYear();
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                    cachedFetch('/api/email-analysis?action=liquidation-forecast-list&year=' + yr),
                ]).then(([liqJson, expJson, fcJson]) => {
                    if (liqJson.success) setLiquidations(liqJson.liquidations.filter(l => l.rows && l.rows.length > 0));
                    if (expJson.success && expJson.expeditions) setExpeditions(expJson.expeditions);
                    if (fcJson && fcJson.success) {
                        const byFruit = { framboise: {}, myrtille: {} };
                        (fcJson.forecasts || []).forEach(f => {
                            const k = f.fruit;
                            if (!byFruit[k]) byFruit[k] = {};
                            Object.entries(f.weeks || {}).forEach(([w, v]) => {
                                byFruit[k][w] = { ...v, year: f.year, updatedAt: f.updatedAt };
                            });
                        });
                        setForecastsByFruit(byFruit);
                    }
                }).catch(() => {}).finally(() => setLoading(false));
                loadBonsFromFirestore().then(bons => setBonsApport(bons)).catch(() => {});
            }, []);

            // Forecast lookup helper: returns avg MAD/kg for (fruit, week) or null
            const getForecastPrice = (fruit, week) => {
                const f = (fruit || '').toLowerCase();
                const w = String(week);
                const entry = forecastsByFruit?.[f]?.[w];
                return entry && Number.isFinite(entry.avgMad) ? entry.avgMad : null;
            };

            // File → base64 helper
            const fileToBase64 = (file) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const openForecastImport = (fruitCode) => {
                setForecastModal({ fruitCode: fruitCode || 'RASP', year: new Date().getFullYear(), step: 'pick', file: null, imageB64: null, mediaType: null, weeks: [], loading: false, error: null });
            };

            const handleForecastFile = async (file) => {
                if (!file) return;
                setForecastModal(m => ({ ...m, file, loading: true, error: null }));
                try {
                    const dataUrl = await fileToBase64(file);
                    const mediaType = file.type || 'image/png';
                    setForecastModal(m => ({ ...m, imageB64: dataUrl, mediaType, loading: false, step: 'ready' }));
                } catch (e) {
                    setForecastModal(m => ({ ...m, loading: false, error: 'Lecture du fichier impossible' }));
                }
            };

            const runForecastExtract = async () => {
                setForecastModal(m => ({ ...m, loading: true, error: null }));
                try {
                    const m0 = forecastModal;
                    const resp = await fetch('/api/email-analysis?action=liquidation-forecast-extract', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fruitCode: m0.fruitCode, imageBase64: m0.imageB64, mediaType: m0.mediaType }),
                    });
                    const j = await resp.json();
                    if (!j.success) throw new Error(j.error || 'Extraction échouée');
                    const yr = (j.weeks && j.weeks[0] && j.weeks[0].year) || m0.year;
                    setForecastModal(m => ({ ...m, loading: false, step: 'review', weeks: j.weeks || [], year: yr }));
                } catch (e) {
                    setForecastModal(m => ({ ...m, loading: false, error: e.message || 'Erreur extraction' }));
                }
            };

            const saveForecast = async () => {
                setForecastModal(m => ({ ...m, loading: true, error: null }));
                try {
                    const m0 = forecastModal;
                    const cleanWeeks = (m0.weeks || [])
                        .map(w => ({ week: parseInt(w.week), minMad: parseFloat(w.minMad), maxMad: parseFloat(w.maxMad) }))
                        .filter(w => Number.isFinite(w.week) && Number.isFinite(w.minMad) && Number.isFinite(w.maxMad));
                    if (cleanWeeks.length === 0) throw new Error('Aucune semaine valide à enregistrer');
                    const resp = await fetch('/api/email-analysis?action=liquidation-forecast-save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fruitCode: m0.fruitCode, year: m0.year, weeks: cleanWeeks, imageBase64: m0.imageB64, mediaType: m0.mediaType }),
                    });
                    const j = await resp.json();
                    if (!j.success) throw new Error(j.error || 'Sauvegarde échouée');
                    // Reload forecasts (bypass cache)
                    try { invalidateCache('/api/email-analysis?action=liquidation-forecast-list'); } catch(_) {}
                    const fcResp = await fetch('/api/email-analysis?action=liquidation-forecast-list&year=' + m0.year);
                    const fcJson = await fcResp.json();
                    if (fcJson && fcJson.success) {
                        const byFruit = { framboise: {}, myrtille: {} };
                        (fcJson.forecasts || []).forEach(f => {
                            const k = f.fruit;
                            if (!byFruit[k]) byFruit[k] = {};
                            Object.entries(f.weeks || {}).forEach(([w, v]) => {
                                byFruit[k][w] = { ...v, year: f.year, updatedAt: f.updatedAt };
                            });
                        });
                        setForecastsByFruit(byFruit);
                    }
                    setForecastModal(null);
                } catch (e) {
                    setForecastModal(m => ({ ...m, loading: false, error: e.message || 'Erreur sauvegarde' }));
                }
            };

            // Sat-Fri week number (calendrier Driscoll's)
            const getWeekNum = (dateStr) => {
                if (!dateStr) return null;
                let d;
                if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                    const parts = dateStr.split('-');
                    d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
                } else {
                    const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                    if (!m) return null;
                    d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]), 12, 0, 0);
                }
                const jan1 = new Date(d.getFullYear(), 0, 1, 12, 0, 0);
                const days = Math.floor((d - jan1) / 86400000);
                const jan1Dow = (jan1.getDay() + 1) % 7;
                return Math.ceil((days + jan1Dow + 1) / 7);
            };
            const getWeekYear = (dateStr) => {
                if (!dateStr) return null;
                if (dateStr.match(/^\d{4}-/)) return parseInt(dateStr.split('-')[0]);
                const m = dateStr.match(/(\d{4})/);
                return m ? parseInt(m[1]) : null;
            };

            // Map liquidation week to year-week key (e.g. "2025-W42")
            const liqYearWeek = (l) => {
                if (!l.rows || l.rows.length === 0 || !l.date) return null;
                // Try to get year from subject "WEEK XX-YYYY"
                const ywMatch = (l.subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                const year = ywMatch ? parseInt(ywMatch[1]) : (l.date ? new Date(l.date).getFullYear() : 2025);
                return `${year}-W${l.week}`;
            };

            // Previously had only liquidations fetch (now merged above):
            // React.useEffect(() => {
            //     fetch('/api/email-analysis?action=liquidations')
            //         .then(r => r.json())
            //         .then(d => { if (d.success) setLiquidations(d.liquidations.filter(l => l.rows && l.rows.length > 0)); })
            //         .catch(() => {})
            //         .finally(() => setLoading(false));
            // }, []);

            // Maravilla LC detection: bons d'apport tagués sur parcelle LAR-01 → receipt → liquidation row
            const normalizeRidLiq = (rid) => {
                if (!rid) return '';
                const s = String(rid).trim().toUpperCase();
                const m = s.match(/^RID-0*(\d+)$/);
                return m ? m[1] : s;
            };
            const lcBatchNumbers = new Set();
            bonsApport.forEach(b => {
                const resolved = normalizeParcelle(b.designation || b.blocLabel || b.blocVariete);
                if (resolved && resolved.variete === 'Maravilla' && resolved.sousVariete === 'Long Cane' && b.bonApport) {
                    lcBatchNumbers.add(String(b.bonApport).trim());
                }
            });
            const lcReceiptIds = new Set();
            expeditions.forEach(e => {
                if (e.batchNumber && lcBatchNumbers.has(String(e.batchNumber).trim()) && e.receiptId) {
                    lcReceiptIds.add(normalizeRidLiq(e.receiptId));
                }
            });

            // Variety display mapping — uses normalizeParcelle for unified naming
            // Maravilla split en GC (Grande Culture, défaut) et LC (Long Cane, parcelle ML-T-LAR-01)
            const liqVarietyMap = (v, receiptId) => {
                const r = normalizeParcelle(v);
                if (!r) return v;
                if (r.variete === 'Maravilla') {
                    if (receiptId && lcReceiptIds.has(normalizeRidLiq(receiptId))) return 'Maravilla LC';
                    return 'Maravilla GC';
                }
                return r.variete;
            };
            const varietyToCulture = (v) => /myrtille|blue|corina|corrina|cascade|breeze/i.test(v) ? 'myrtille' : 'framboise';

            // Extract year from subject "WEEK XX-YYYY"
            const extractYear = (subject, date) => {
                const m = (subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                if (m) return parseInt(m[1]);
                if (date) return new Date(date).getFullYear();
                return 2025;
            };

            // Deduplicate liquidations by (year, week, fruit) — framboise and myrtille coexist on the same week
            const liqByWeekDedup = {};
            liquidations.forEach(l => {
                const w = l.week || '?';
                const year = extractYear(l.subject, l.date);
                const fruitKey = (l.fruit && l.fruit !== '?') ? l.fruit : 'framboise';
                const key = `${year}-W${w}-${fruitKey}`;
                if (!liqByWeekDedup[key]) {
                    liqByWeekDedup[key] = l;
                } else {
                    // Same (year, week, fruit) → keep the one with more rows
                    const existing = liqByWeekDedup[key];
                    if ((l.rows || []).length > (existing.rows || []).length) {
                        liqByWeekDedup[key] = l;
                    }
                }
            });
            const dedupedLiquidations = Object.values(liqByWeekDedup);

            // Flatten all rows with week info (from deduplicated liquidations)
            const allRows = dedupedLiquidations.flatMap(l => {
                const year = extractYear(l.subject, l.date);
                return (l.rows || []).map(r => ({
                    ...r,
                    variety: liqVarietyMap(r.variety, r.receiptId),
                    week: l.week,
                    year,
                    liqId: l.id,
                    subject: l.subject,
                    liqDate: l.date,
                    fruit: l.fruit || 'framboise',
                    fruitCode: l.fruitCode || 'RASP',
                    netPayable: l.netPayable,
                    fruitAdvance: l.fruitAdvance,
                    dedRasp: l.dedRasp,
                    cropAdvance: l.cropAdvance,
                    dexAdjustment: l.dexAdjustment,
                    pkgDeduction: l.pkgDeduction,
                    commissionPct: l.commissionPct,
                    netSalesEurKg: l.netSalesEurKg,
                    commissionEurKg: l.commissionEurKg,
                    rebateEurKg: l.rebateEurKg,
                }));
            });
            const fruits = [...new Set(allRows.map(r => r.fruit).filter(Boolean))].sort();

            // Ferme from variety — uses normalizeParcelle
            const fermeOf = (v) => { const r = normalizeParcelle(v); return r ? r.ferme : ''; };
            const fermes = [...new Set(allRows.map(r => fermeOf(r.variety)).filter(Boolean))].sort();
            // Variétés depuis bonsApport (saisie interne) — pour faire apparaître chips même sans liquidation Driscoll's
            const bonsVarieties = new Set();
            bonsApport.forEach(b => {
                if (b.status === 'rejete_qualite' || b.status === 'rejete_chef') return;
                const resolved = normalizeParcelle(b.designation || b.blocLabel || b.blocVariete);
                if (!resolved) return;
                let v;
                if (resolved.variete === 'Maravilla') {
                    if (resolved.sousVariete === 'Long Cane') v = 'Maravilla LC';
                    else if (resolved.sousVariete === 'Green Cane') v = 'Maravilla GC';
                    else v = 'Maravilla GC';
                } else {
                    v = resolved.sousVariete ? `${resolved.variete} ${resolved.sousVariete}` : resolved.variete;
                }
                bonsVarieties.add(v);
            });
            const varietes = [...new Set([...allRows.map(r => r.variety).filter(Boolean), ...bonsVarieties])].sort();

            let filtered = allRows;
            if (selectedFruit) filtered = filtered.filter(r => r.fruit === selectedFruit);
            if (selectedFerme) filtered = filtered.filter(r => fermeOf(r.variety) === selectedFerme);
            if (selectedVariete) filtered = filtered.filter(r => r.variety === selectedVariete);

            // KPIs — aggregate by unique receipt ID to avoid double-counting grade splits
            const byReceiptId = {};
            filtered.forEach(r => {
                const baseRid = r.receiptId || ('row_' + Math.random());
                const rid = `${r.fruit || 'framboise'}__${baseRid}`;
                if (!byReceiptId[rid]) byReceiptId[rid] = { kg: 0, gsNet: 0 };
                byReceiptId[rid].kg += (r.receiptQtyKg || 0);
                byReceiptId[rid].gsNet += (r.gsNet || 0);
            });
            const totalKg = Object.values(byReceiptId).reduce((s, r) => s + r.kg, 0);
            const totalGsNet = Object.values(byReceiptId).reduce((s, r) => s + r.gsNet, 0);
            const avgPriceKg = totalKg > 0 ? totalGsNet / totalKg : 0;
            const nbLots = Object.keys(byReceiptId).length;

            // === CA Estimation for non-liquidated weeks (used by KPIs) ===
            const extractYearNonLiq = (subject, date) => {
                const m = (subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                if (m) return parseInt(m[1]);
                if (date) return new Date(date).getFullYear();
                return new Date().getFullYear();
            };
            const liquidatedWeeks = new Set();
            liquidations.forEach(l => {
                if (!l.week) return;
                const year = extractYearNonLiq(l.subject, l.date);
                const culture = (l.fruit || 'framboise').toLowerCase();
                liquidatedWeeks.add(`${year}-W${l.week}-${culture}`);
            });
            const prodByWeek = {};
            bonsApport.filter(b => b.status !== 'rejete_qualite' && b.status !== 'rejete_chef').forEach(b => {
                const kg = parseFloat(b.poidsLot) || 0;
                if (kg <= 0) return;
                const rawType = b.typeVente || '';
                const typeVente = (rawType === "Driscoll's" || rawType === 'EXP') ? 'Export'
                    : rawType === 'ECRT' ? 'Marché Local' : rawType || '';
                if (typeVente !== 'Export') return;
                const dateStr = b.date || '';
                const w = getWeekNum(dateStr);
                const y = getWeekYear(dateStr);
                if (!w || !y) return;
                const resolved = normalizeParcelle(b.designation || b.blocLabel || b.blocVariete);
                let variety;
                if (resolved && resolved.variete === 'Maravilla') {
                    if (resolved.sousVariete === 'Long Cane') variety = 'Maravilla LC';
                    else if (resolved.sousVariete === 'Green Cane') variety = 'Maravilla GC';
                    else variety = 'Maravilla GC';
                } else if (resolved) {
                    variety = resolved.sousVariete ? `${resolved.variete} ${resolved.sousVariete}` : resolved.variete;
                } else {
                    variety = b.blocVariete || '?';
                }
                const culture = resolved ? resolved.culture.toLowerCase() : 'framboise';
                const ferme = resolved ? resolved.ferme : '';
                if (selectedFruit && culture !== selectedFruit) return;
                if (selectedFerme && ferme !== selectedFerme) return;
                if (selectedVariete && variety !== selectedVariete) return;
                const key = `${y}-W${w}-${culture}`;
                if (!prodByWeek[key]) prodByWeek[key] = { week: w, year: y, culture, byVariety: {}, totalKg: 0, lots: 0 };
                prodByWeek[key].totalKg += kg;
                prodByWeek[key].lots += 1;
                if (!prodByWeek[key].byVariety[variety]) prodByWeek[key].byVariety[variety] = 0;
                prodByWeek[key].byVariety[variety] += kg;
            });
            const nonLiquidated = Object.entries(prodByWeek)
                .filter(([key]) => !liquidatedWeeks.has(key))
                .map(([key, d]) => ({ key, ...d }))
                .sort((a, b) => { if (b.year !== a.year) return b.year - a.year; return b.week - a.week; });
            const priceHistoryByCulture = {};
            const sortedLiqs = [...liquidations].sort((a, b) => {
                const yearA = extractYearNonLiq(a.subject, a.date);
                const yearB = extractYearNonLiq(b.subject, b.date);
                if (yearA !== yearB) return yearB - yearA;
                return (b.week || 0) - (a.week || 0);
            });
            for (const liq of sortedLiqs) {
                const liqYear = extractYearNonLiq(liq.subject, liq.date);
                const culture = (liq.fruit || 'framboise').toLowerCase();
                let liqTotalGs = 0, liqTotalKg = 0;
                for (const r of (liq.rows || [])) {
                    if (r.receiptQtyKg > 0 && r.gsNet > 0) {
                        liqTotalGs += r.gsNet;
                        liqTotalKg += r.receiptQtyKg;
                    }
                }
                if (liqTotalKg > 0) {
                    if (!priceHistoryByCulture[culture]) priceHistoryByCulture[culture] = [];
                    if (priceHistoryByCulture[culture].length < 2) {
                        const key = liqYear + '-W' + liq.week;
                        const alreadyHas = priceHistoryByCulture[culture].some(p => p.key === key);
                        if (!alreadyHas) {
                            priceHistoryByCulture[culture].push({
                                price: Math.round(liqTotalGs / liqTotalKg * 100) / 100,
                                week: liq.week, year: liqYear, key
                            });
                        }
                    }
                }
            }
            const priceByCulture = {};
            for (const [c, history] of Object.entries(priceHistoryByCulture)) {
                const avgPrice = history.reduce((s, p) => s + p.price, 0) / history.length;
                const weeks = history.map(p => 'W' + p.week + '-' + String(p.year).slice(-2)).join(' + ');
                priceByCulture[c] = {
                    price: Math.round(avgPrice * 100) / 100, weeks,
                    count: history.length,
                    detail: history.map(p => p.price.toFixed(2) + ' DH/kg (W' + p.week + '-' + String(p.year).slice(-2) + ')').join(' | ')
                };
            }
            const getPriceForVariety = (v) => {
                const culture = varietyToCulture(v);
                return priceByCulture[culture] || { price: 0, weeks: '?', count: 0, detail: '-' };
            };
            // Per-week forecast estimation: prefer Driscoll's forecast over historical avg.
            const getEstForWeek = (variety, week) => {
                const culture = varietyToCulture(variety);
                const fc = getForecastPrice(culture, week);
                if (fc != null && fc > 0) {
                    return { price: fc, weeks: 'Forecast Driscoll\'s W' + week, count: 1, detail: fc.toFixed(2) + ' DH/kg (Driscoll\'s)', source: 'forecast' };
                }
                const hist = getPriceForVariety(variety);
                if (hist.price > 0) return { ...hist, source: 'history' };
                return { price: globalAvgPrice, weeks: '?', count: 0, detail: '-', source: 'global' };
            };
            const globalAvgPrice = allRows.length > 0 ? totalGsNet / totalKg : 0;
            let totalEstCA = 0;
            let totalNonLiqKg = 0;
            const totalEstByCulture = {};
            nonLiquidated.forEach(d => {
                Object.entries(d.byVariety).forEach(([v, kg]) => {
                    const est = getEstForWeek(v, d.week);
                    const culture = varietyToCulture(v);
                    if (!totalEstByCulture[culture]) totalEstByCulture[culture] = { kg: 0, ca: 0 };
                    totalEstByCulture[culture].kg += kg;
                    totalEstByCulture[culture].ca += kg * est.price;
                    totalEstCA += kg * est.price;
                    totalNonLiqKg += kg;
                });
            });
            // === End CA Estimation ===

            // Commission % KPI — weighted average across weeks with data
            const commByWeek = {};
            filtered.forEach(r => {
                const key = `${r.year}-W${r.week}`;
                if (!commByWeek[key]) commByWeek[key] = { week: r.week, year: r.year, kg: 0, commPct: r.commissionPct, netSalesEurKg: r.netSalesEurKg, commissionEurKg: r.commissionEurKg, rebateEurKg: r.rebateEurKg };
                commByWeek[key].kg += (r.receiptQtyKg || 0);
            });
            const commWeeks = Object.values(commByWeek).filter(w => w.commPct != null && w.kg > 0);
            const totalCommKg = commWeeks.reduce((s, w) => s + w.kg, 0);
            const avgCommPct = totalCommKg > 0
                ? commWeeks.reduce((s, w) => s + w.commPct * w.kg, 0) / totalCommKg
                : null;

            const weeks = [...new Set(filtered.map(r => r.week).filter(Boolean))].sort((a,b) => a - b);

            // Group by year + week + fruit (same week can have framboise and myrtille)
            const byWeek = {};
            filtered.forEach(r => {
                const w = r.week || '?';
                const y = r.year || 2025;
                const f = r.fruit || 'framboise';
                const key = `${y}-${w}__${f}`;
                if (!byWeek[key]) byWeek[key] = { week: w, year: y, fruit: f, rows: [] };
                byWeek[key].rows.push(r);
            });
            const weekKeys = Object.keys(byWeek).sort((a, b) => {
                const gA = byWeek[a], gB = byWeek[b];
                // Sort by year desc, then week desc, then fruit
                if (gB.year !== gA.year) return gB.year - gA.year;
                const wA = Number(gA.week) || 0, wB = Number(gB.week) || 0;
                if (wB !== wA) return wB - wA;
                return gA.fruit.localeCompare(gB.fruit);
            });

            if (loading) return React.createElement('div', {className:'loading'}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin'}), ' Chargement des liquidations...');

            return (
                <div className="fade-in">
                    {/* Filters */}
                    <div style={{display:'flex', gap:16, flexWrap:'wrap', marginBottom:16, alignItems:'center'}}>
                        <div className="chip-group">
                            <span className="chip-group-label">Culture:</span>
                            <button className={`chip c-purple ${!selectedFruit ? 'active' : ''}`} onClick={() => setSelectedFruit('')}>Toutes</button>
                            <button className={`chip c-berry ${selectedFruit === 'framboise' ? 'active' : ''}`} onClick={() => setSelectedFruit(selectedFruit === 'framboise' ? '' : 'framboise')}>🍓 Framboise</button>
                            <button className={`chip c-indigo ${selectedFruit === 'myrtille' ? 'active' : ''}`} onClick={() => setSelectedFruit(selectedFruit === 'myrtille' ? '' : 'myrtille')}>🫐 Myrtille</button>
                        </div>
                        <div className="chip-group">
                            <span className="chip-group-label">Ferme:</span>
                            <button className={`chip c-green ${!selectedFerme ? 'active' : ''}`} onClick={() => { setSelectedFerme(''); setSelectedVariete(''); }}>Toutes</button>
                            {fermes.map(f => <button key={f} className={`chip c-green ${selectedFerme === f ? 'active' : ''}`} onClick={() => { setSelectedFerme(f); setSelectedVariete(''); }}>{f}</button>)}
                        </div>
                        <div className="chip-group">
                            <span className="chip-group-label">Variété:</span>
                            <button className={`chip c-dark ${!selectedVariete ? 'active' : ''}`} onClick={() => setSelectedVariete('')}>Toutes</button>
                            {varietes.filter(v => !selectedFerme || fermeOf(v) === selectedFerme).map(v => <button key={v} className={`chip c-dark ${selectedVariete === v ? 'active' : ''}`} onClick={() => setSelectedVariete(v)}>{v}</button>)}
                        </div>
                        <div style={{marginLeft:'auto', display:'flex', gap:8}}>
                            <button
                                onClick={() => setPrivateMode(!privateMode)}
                                title={privateMode ? "Mode privé actif — valeurs monétaires masquées. Cliquer pour réafficher." : "Activer le mode privé pour masquer CA / GS Net / Commission (démos partenaires)"}
                                style={{fontSize:12, padding:'6px 12px', borderRadius:6, border:'1px solid ' + (privateMode ? 'var(--berry)' : 'var(--gray-200)'), background: privateMode ? 'var(--berry)' : '#fff', color: privateMode ? '#fff' : 'var(--gray-600)', cursor:'pointer', fontWeight:600}}>
                                <i className={`fa-solid ${privateMode ? 'fa-eye-slash' : 'fa-eye'}`} style={{marginRight:6}}></i>Mode privé {privateMode ? 'ON' : 'OFF'}
                            </button>
                            <button
                                className="btn-secondary"
                                onClick={() => openForecastImport('RASP')}
                                title="Importer un slide Driscoll's de prévision Framboise"
                                style={{fontSize:12, padding:'6px 12px'}}>
                                <i className="fa-solid fa-camera" style={{marginRight:6}}></i>📸 Prévision 🍓
                            </button>
                            <button
                                className="btn-secondary"
                                onClick={() => openForecastImport('BLUE')}
                                title="Importer un slide Driscoll's de prévision Myrtille"
                                style={{fontSize:12, padding:'6px 12px'}}>
                                <i className="fa-solid fa-camera" style={{marginRight:6}}></i>📸 Prévision 🫐
                            </button>
                        </div>
                    </div>

                    {/* KPIs — 3 lignes (Qté / Prix / CA) × 3 colonnes (Liquidé / Prév / Campagne) + Commission */}
                    <style>{`
                        .kpi-grid-compact .kpi-card { padding: 10px 14px; }
                        .kpi-grid-compact .kpi-card .kpi-header { margin-bottom: 4px; }
                        .kpi-grid-compact .kpi-card .kpi-icon { width: 28px; height: 28px; font-size: 12px; border-radius: 8px; }
                        .kpi-grid-compact .kpi-card .kpi-value { font-size: 18px; line-height: 1.2; }
                        .kpi-grid-compact .kpi-card .kpi-label { font-size: 11px; }
                        .kpi-col-prev .kpi-value { color: var(--blue); }
                        .kpi-col-campagne .kpi-value { color: #757575; }
                    `}</style>
                    <div className="kpi-grid kpi-grid-compact" style={{gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10}}>
                        {/* === COLONNE 1 : LIQUIDÉ (couleurs métriques) === */}
                        {!compactView && !privateMode && (
                            <div style={{gridColumn: 1, gridRow: 1, cursor:'pointer'}} onClick={() => setKpiDetailPopup('qty')}>
                                <KPICard icon="fa-weight-scale" iconClass="green" value={`${(totalKg / 1000).toFixed(2)} T`} label="Qté Liquidée ⓘ" />
                            </div>
                        )}
                        <div style={{gridColumn: 1, gridRow: 2}}>
                            <KPICard icon="fa-tags" iconClass="berry" value={avgPriceKg.toFixed(2)} label="Prix Moyen Liquidé (DH/kg)" />
                        </div>
                        {!compactView && !privateMode && (
                            <div style={{gridColumn: 1, gridRow: 3, cursor:'pointer'}} onClick={() => setKpiDetailPopup('gsnet')}>
                                <KPICard icon="fa-money-bill-wave" iconClass="blue" value={`${(totalGsNet / 1000000).toFixed(2)} m DH`} label="CA Liquidé ⓘ" />
                            </div>
                        )}

                        {/* === COLONNE 2 : PRÉVISIONNEL (bleu) === */}
                        {!compactView && !privateMode && totalNonLiqKg > 0 && (
                            <div className="kpi-col-prev" style={{gridColumn: 2, gridRow: 1}}>
                                <KPICard icon="fa-scale-balanced" iconClass="blue" value={`${(totalNonLiqKg / 1000).toFixed(2)} T`} label="Qté Prév" />
                            </div>
                        )}
                        {!compactView && totalNonLiqKg > 0 && (
                            <div className="kpi-col-prev" style={{gridColumn: 2, gridRow: 2}}>
                                <KPICard icon="fa-tag" iconClass="blue" value={(totalEstCA / totalNonLiqKg).toFixed(2)} label="Prix Prév (DH/kg)" />
                            </div>
                        )}
                        {!compactView && !privateMode && (
                            <div className="kpi-col-prev" style={{gridColumn: 2, gridRow: 3}}>
                                <KPICard icon="fa-hourglass-half" iconClass="blue" value={`${(totalEstCA / 1000000).toFixed(2)} m DH`} label="CA Prév" />
                            </div>
                        )}

                        {/* === COLONNE 3 : CAMPAGNE (gris) === */}
                        {!compactView && !privateMode && (totalKg + totalNonLiqKg) > 0 && (
                            <div className="kpi-col-campagne" style={{gridColumn: 3, gridRow: 1}}>
                                <KPICard icon="fa-boxes-stacked" iconClass="silver" value={`${((totalKg + totalNonLiqKg) / 1000).toFixed(2)} T`} label="Qté Campagne" />
                            </div>
                        )}
                        {!compactView && (totalKg + totalNonLiqKg) > 0 && (
                            <div className="kpi-col-campagne" style={{gridColumn: 3, gridRow: 2}}>
                                <KPICard icon="fa-chart-line" iconClass="silver" value={((totalGsNet + totalEstCA) / (totalKg + totalNonLiqKg)).toFixed(2)} label="Prix Moyen Campagne (DH/kg)" />
                            </div>
                        )}
                        {!compactView && !privateMode && (
                            <div className="kpi-col-campagne" style={{gridColumn: 3, gridRow: 3}}>
                                <KPICard icon="fa-calculator" iconClass="silver" value={`${((totalGsNet + totalEstCA) / 1000000).toFixed(2)} m DH`} label="CA Campagne" />
                            </div>
                        )}

                        {/* === COLONNE 4 : COMMISSION === */}
                        <div style={{gridColumn: 4, gridRow: 2, cursor:'pointer'}} onClick={() => setKpiDetailPopup('commission')}>
                            <KPICard icon="fa-percent" iconClass="orange" value={avgCommPct != null ? `${avgCommPct.toFixed(1)}%` : '-'} label="Commission Driscoll's ⓘ" />
                        </div>
                    </div>

                    {/* KPI Detail Popup */}
                    {kpiDetailPopup && (() => {
                        if (kpiDetailPopup === 'commission') {
                            const commChartData = Object.keys(commByWeek)
                                .filter(k => commByWeek[k].commPct != null)
                                .map(k => ({ ...commByWeek[k], key: k }))
                                .sort((a, b) => {
                                    if (a.year !== b.year) return a.year - b.year;
                                    return a.week - b.week;
                                });
                            const cChartW = 700, cChartH = 220, cPadL = 50, cPadR = 20, cPadT = 25, cPadB = 35;
                            const cInnerW = cChartW - cPadL - cPadR, cInnerH = cChartH - cPadT - cPadB;
                            const maxComm = commChartData.length > 0 ? Math.max(...commChartData.map(d => d.commPct), 1) : 50;
                            const cBarW = commChartData.length > 0 ? Math.min(cInnerW / commChartData.length * 0.7, 30) : 20;
                            const cGap = commChartData.length > 0 ? cInnerW / commChartData.length : 20;
                            // Average line Y
                            const avgLineY = avgCommPct != null ? cPadT + cInnerH * (1 - avgCommPct / maxComm) : null;
                            return (
                                <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center'}} onClick={() => setKpiDetailPopup(null)}>
                                    <div style={{background:'#fff', borderRadius:16, padding:24, maxWidth:800, width:'92%', maxHeight:'85vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
                                            <h3 style={{margin:0, fontSize:16}}>Commission Driscoll's par semaine</h3>
                                            <button onClick={() => setKpiDetailPopup(null)} style={{background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#999'}}>×</button>
                                        </div>
                                        {commChartData.length === 0 ? (
                                            <p style={{color:'var(--gray-400)', textAlign:'center', padding:20}}>Aucune donnée de commission disponible. Relancez un refetch des liquidations.</p>
                                        ) : (
                                            <div>
                                                <svg viewBox={`0 0 ${cChartW} ${cChartH}`} style={{width:'100%', maxHeight:240}}>
                                                    {[0, 0.25, 0.5, 0.75, 1].map(p => {
                                                        const y = cPadT + cInnerH * (1 - p);
                                                        return <g key={p}><line x1={cPadL} y1={y} x2={cChartW-cPadR} y2={y} stroke="#f0f0f0" /><text x={cPadL-4} y={y+4} textAnchor="end" fontSize={9} fill="#999">{(maxComm * p).toFixed(0)}%</text></g>;
                                                    })}
                                                    {avgLineY != null && (
                                                        <g>
                                                            <line x1={cPadL} y1={avgLineY} x2={cChartW-cPadR} y2={avgLineY} stroke="var(--orange)" strokeDasharray="6,3" strokeWidth={1.5} />
                                                            <text x={cChartW-cPadR+2} y={avgLineY+3} fontSize={9} fontWeight={700} fill="var(--orange)">moy {avgCommPct.toFixed(1)}%</text>
                                                        </g>
                                                    )}
                                                    {commChartData.map((d, i) => {
                                                        const x = cPadL + i * cGap + cGap / 2;
                                                        const h = Math.max((d.commPct / maxComm) * cInnerH, 0);
                                                        const y = cPadT + cInnerH - h;
                                                        return <g key={i}>
                                                            <rect x={x - cBarW/2} y={y} width={cBarW} height={h} fill="var(--orange)" rx={3} opacity={0.85} />
                                                            <text x={x} y={y - 4} textAnchor="middle" fontSize={8} fontWeight={600} fill="var(--orange)">{d.commPct.toFixed(1)}%</text>
                                                            <text x={x} y={cChartH - 4} textAnchor="middle" fontSize={8} fill="#666">W{d.week}</text>
                                                        </g>;
                                                    })}
                                                </svg>
                                                <table className="data-table" style={{fontSize:11, marginTop:12}}>
                                                    <thead>
                                                        <tr>
                                                            <th>Semaine</th>
                                                            <th style={{textAlign:'right'}}>Kg</th>
                                                            <th style={{textAlign:'right'}}>Net Sales (€/kg)</th>
                                                            <th style={{textAlign:'right'}}>Commission (€/kg)</th>
                                                            <th style={{textAlign:'right'}}>Rebate (€/kg)</th>
                                                            <th style={{textAlign:'right'}}>Commission %</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {commChartData.map((d, i) => (
                                                            <tr key={i}>
                                                                <td style={{fontWeight:700}}>W{d.week}-{String(d.year).slice(-2)}</td>
                                                                <td style={{textAlign:'right'}}>{Math.round(d.kg).toLocaleString('fr-FR')}</td>
                                                                <td style={{textAlign:'right'}}>{d.netSalesEurKg != null ? d.netSalesEurKg.toFixed(2) : '-'}</td>
                                                                <td style={{textAlign:'right', color:'var(--red)'}}>{d.commissionEurKg != null ? d.commissionEurKg.toFixed(2) : '-'}</td>
                                                                <td style={{textAlign:'right', color:'var(--green)'}}>{d.rebateEurKg != null ? d.rebateEurKg.toFixed(2) : '-'}</td>
                                                                <td style={{textAlign:'right', fontWeight:600}}>{d.commPct.toFixed(1)}%</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr style={{fontWeight:700, borderTop:'2px solid var(--dark)'}}>
                                                            <td>MOYENNE</td>
                                                            <td style={{textAlign:'right'}}>{Math.round(totalCommKg).toLocaleString('fr-FR')}</td>
                                                            <td style={{textAlign:'right'}}>{commWeeks.length > 0 ? (commWeeks.reduce((s,w) => s + (w.netSalesEurKg || 0) * w.kg, 0) / totalCommKg).toFixed(2) : '-'}</td>
                                                            <td style={{textAlign:'right', color:'var(--red)'}}>{commWeeks.length > 0 ? (commWeeks.reduce((s,w) => s + (w.commissionEurKg || 0) * w.kg, 0) / totalCommKg).toFixed(2) : '-'}</td>
                                                            <td style={{textAlign:'right', color:'var(--green)'}}>{commWeeks.length > 0 ? (commWeeks.reduce((s,w) => s + (w.rebateEurKg || 0) * w.kg, 0) / totalCommKg).toFixed(2) : '-'}</td>
                                                            <td style={{textAlign:'right', fontWeight:700}}>{avgCommPct != null ? `${avgCommPct.toFixed(1)}%` : '-'}</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        }
                        const isGsNet = kpiDetailPopup === 'gsnet';
                        const title = isGsNet ? 'Détail GS Net par semaine' : 'Détail Quantité par semaine';
                        const byWeekDetail = {};
                        filtered.forEach(r => {
                            const key = `W${r.week}-${String(r.year).slice(-2)}`;
                            if (!byWeekDetail[key]) byWeekDetail[key] = { week: r.week, year: r.year, kg: 0, gsNet: 0, rids: new Set() };
                            byWeekDetail[key].kg += (r.receiptQtyKg || 0);
                            byWeekDetail[key].gsNet += (r.gsNet || 0);
                            byWeekDetail[key].rids.add(r.receiptId || ('row_' + Math.random()));
                        });
                        const detailKeys = Object.keys(byWeekDetail).sort((a, b) => {
                            const da = byWeekDetail[a], db = byWeekDetail[b];
                            if (db.year !== da.year) return db.year - da.year;
                            return db.week - da.week;
                        });
                        const grandTotal = isGsNet ? filtered.reduce((s, r) => s + (r.gsNet || 0), 0) : filtered.reduce((s, r) => s + (r.receiptQtyKg || 0), 0);
                        return (
                            <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center'}} onClick={() => setKpiDetailPopup(null)}>
                                <div style={{background:'#fff', borderRadius:16, padding:24, maxWidth:600, width:'90%', maxHeight:'80vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
                                        <h3 style={{margin:0, fontSize:16}}>{title}</h3>
                                        <button onClick={() => setKpiDetailPopup(null)} style={{background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#999'}}>×</button>
                                    </div>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr>
                                                <th>Semaine</th>
                                                <th style={{textAlign:'right'}}>Lots</th>
                                                <th style={{textAlign:'right'}}>Quantité (kg)</th>
                                                {!privateMode && <th style={{textAlign:'right'}}>GS Net (DH)</th>}
                                                <th style={{textAlign:'right'}}>Prix/kg</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {detailKeys.map(k => {
                                                const d = byWeekDetail[k];
                                                return (
                                                    <tr key={k}>
                                                        <td style={{fontWeight:700}}>{k}</td>
                                                        <td style={{textAlign:'right'}}>{d.rids.size}</td>
                                                        <td style={{textAlign:'right'}}>{Math.round(d.kg).toLocaleString('fr-FR')}</td>
                                                        {!privateMode && <td style={{textAlign:'right', fontWeight:600}}>{Math.round(d.gsNet).toLocaleString('fr-FR')}</td>}
                                                        <td style={{textAlign:'right'}}>{d.kg > 0 ? (d.gsNet / d.kg).toFixed(2) : '-'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{fontWeight:700, borderTop:'2px solid var(--dark)'}}>
                                                <td>TOTAL</td>
                                                <td style={{textAlign:'right'}}>{nbLots}</td>
                                                <td style={{textAlign:'right'}}>{Math.round(totalKg).toLocaleString('fr-FR')}</td>
                                                {!privateMode && <td style={{textAlign:'right'}}>{Math.round(totalGsNet).toLocaleString('fr-FR')}</td>}
                                                <td style={{textAlign:'right'}}>{avgPriceKg.toFixed(2)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                    {!isGsNet && (() => {
                                        const liquidatedKeysSet = new Set(detailKeys);
                                        const pendingRows = [];
                                        Object.values(prodByWeek).forEach(d => {
                                            const k = `W${d.week}-${String(d.year).slice(-2)}`;
                                            if (liquidatedKeysSet.has(k)) return;
                                            const kg = selectedVariete ? (d.byVariety[selectedVariete] || 0) : d.totalKg;
                                            if (kg <= 0) return;
                                            pendingRows.push({ key: k, week: d.week, year: d.year, kg, lots: d.lots });
                                        });
                                        pendingRows.sort((a, b) => { if (b.year !== a.year) return b.year - a.year; return b.week - a.week; });
                                        if (pendingRows.length === 0) return null;
                                        const totPendKg = pendingRows.reduce((s, r) => s + r.kg, 0);
                                        const totPendLots = pendingRows.reduce((s, r) => s + r.lots, 0);
                                        return (
                                            <div style={{marginTop:24}}>
                                                <h4 style={{margin:'0 0 8px 0', fontSize:13, color:'var(--gray-600)'}}>En attente de liquidation Driscoll's</h4>
                                                <table className="data-table" style={{fontSize:12}}>
                                                    <thead>
                                                        <tr>
                                                            <th>Semaine</th>
                                                            <th style={{textAlign:'right'}}>Lots</th>
                                                            <th style={{textAlign:'right'}}>Quantité (kg)</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {pendingRows.map(r => (
                                                            <tr key={r.key}>
                                                                <td style={{fontWeight:700}}>{r.key}</td>
                                                                <td style={{textAlign:'right'}}>{r.lots}</td>
                                                                <td style={{textAlign:'right'}}>{Math.round(r.kg).toLocaleString('fr-FR')}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr style={{fontWeight:700, borderTop:'2px solid var(--dark)'}}>
                                                            <td>TOTAL EN ATTENTE</td>
                                                            <td style={{textAlign:'right'}}>{totPendLots}</td>
                                                            <td style={{textAlign:'right'}}>{Math.round(totPendKg).toLocaleString('fr-FR')}</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        );
                    })()}

                    {liquidations.length === 0 && (
                        <div className="panel" style={{textAlign:'center', padding:40, color:'var(--gray-400)'}}>
                            <i className="fa-solid fa-file-invoice-dollar" style={{fontSize:40, marginBottom:12}}></i>
                            <p>Aucune liquidation reçue. Les liquidations Driscoll's apparaîtront ici automatiquement.</p>
                        </div>
                    )}

                    {/* ===== CHART: Prix moyen par semaine ===== */}
                    {(filtered.length > 0 || Object.keys(prodByWeek).length > 0) && (() => {
                        const chartFiltered = chartVariete ? filtered.filter(r => r.variety === chartVariete) : filtered;
                        const priceByWeek = {};
                        chartFiltered.forEach(r => {
                            const w = r.week || '?';
                            const y = r.year || 2025;
                            const key = `${y}-${w}`;
                            if (!priceByWeek[key]) priceByWeek[key] = { kg: 0, gsNet: 0, week: w, year: y };
                            priceByWeek[key].kg += r.receiptQtyKg || 0;
                            priceByWeek[key].gsNet += r.gsNet || 0;
                        });
                        const rawData = Object.values(priceByWeek)
                            .map(d => ({ week: d.week, year: d.year, sortKey: d.year * 100 + d.week, label: `${d.week}`, price: d.kg > 0 ? Math.round(d.gsNet / d.kg * 100) / 100 : 0, kg: Math.round(d.kg) }))
                            .filter(d => d.price > 0)
                            .sort((a, b) => a.sortKey - b.sortKey);
                        // Pending = bonsApport (saisie interne, Sat-Fri week) sur semaines non encore liquidées.
                        // Source plus fiable que expeditions Driscoll's qui peuvent manquer/arriver tard.
                        const pendingByWeek = {};
                        if (chartVariete || selectedFruit || selectedVariete) {
                            const liquidatedKeys = new Set(Object.keys(priceByWeek));
                            Object.values(prodByWeek).forEach(d => {
                                const eKey = `${d.year}-${d.week}`;
                                if (liquidatedKeys.has(eKey)) return;
                                const kg = chartVariete ? (d.byVariety[chartVariete] || 0) : d.totalKg;
                                if (kg <= 0) return;
                                if (!pendingByWeek[eKey]) pendingByWeek[eKey] = { kg: 0, week: d.week, year: d.year };
                                pendingByWeek[eKey].kg += kg;
                            });
                        }
                        const pendingData = Object.values(pendingByWeek)
                            .map(d => ({ week: d.week, year: d.year, sortKey: d.year * 100 + d.week, label: `${d.week}`, price: 0, kg: Math.round(d.kg), pending: true }))
                            .sort((a, b) => a.sortKey - b.sortKey);

                        // Fill missing weeks between first and last (including pending)
                        const allPoints = [...rawData, ...pendingData].sort((a, b) => a.sortKey - b.sortKey);
                        const chartData = (() => {
                            if (allPoints.length < 2) return allPoints;
                            const filled = [];
                            let y = allPoints[0].year, w = allPoints[0].week;
                            const lastKey = allPoints[allPoints.length - 1].sortKey;
                            const dataMap = {};
                            allPoints.forEach(d => dataMap[d.sortKey] = d);
                            while (y * 100 + w <= lastKey) {
                                const key = y * 100 + w;
                                filled.push(dataMap[key] || { week: w, year: y, sortKey: key, label: `${w}`, price: 0, kg: 0 });
                                w++;
                                if (w > 52) { w = 1; y++; }
                            }
                            return filled;
                        })();
                        // Forecast par fruit : visible si chart filtré par variété, variété globale, OU fruit global
                        const chartFruit = (() => {
                            const v = chartVariete || selectedVariete;
                            if (v) {
                                const resolved = normalizeParcelle(v);
                                if (resolved && resolved.culture) return resolved.culture.toLowerCase();
                            }
                            if (selectedFruit) return selectedFruit.toLowerCase();
                            return null;
                        })();
                        const forecastByWeek = {};
                        if (chartFruit && (chartFruit === 'framboise' || chartFruit === 'myrtille')) {
                            Object.entries(forecastsByFruit[chartFruit] || {}).forEach(([w, v]) => {
                                if (v && Number.isFinite(v.avgMad)) forecastByWeek[String(w)] = v.avgMad;
                            });
                        }
                        const showForecast = Object.keys(forecastByWeek).length > 0;
                        const forecastUpdatedAt = (() => {
                            if (!showForecast) return null;
                            const entries = Object.values(forecastsByFruit[chartFruit] || {});
                            for (const e of entries) { if (e && e.updatedAt) return e.updatedAt; }
                            return null;
                        })();
                        const formatForecastDate = (ua) => {
                            if (!ua) return '';
                            let d = null;
                            if (typeof ua === 'string') d = new Date(ua);
                            else if (typeof ua === 'number') d = new Date(ua);
                            else if (ua._seconds) d = new Date(ua._seconds * 1000);
                            else if (ua.seconds) d = new Date(ua.seconds * 1000);
                            else if (ua.toDate) { try { d = ua.toDate(); } catch {} }
                            if (!d || isNaN(d.getTime())) return '';
                            const dd = String(d.getDate()).padStart(2, '0');
                            const mm = String(d.getMonth() + 1).padStart(2, '0');
                            return `${dd}/${mm}/${d.getFullYear()}`;
                        };
                        // Ajouter les semaines forecastées absentes de chartData pour qu'elles soient visibles
                        if (showForecast && chartData.length > 0) {
                            const presentKeys = new Set(chartData.map(d => d.year * 100 + d.week));
                            const baseYear = chartData[chartData.length - 1].year;
                            Object.keys(forecastByWeek).forEach(wStr => {
                                const w = parseInt(wStr, 10);
                                if (!w) return;
                                const k = baseYear * 100 + w;
                                if (!presentKeys.has(k)) {
                                    chartData.push({ week: w, year: baseYear, sortKey: k, label: `${w}`, price: 0, kg: 0, forecastOnly: true });
                                }
                            });
                            chartData.sort((a, b) => a.sortKey - b.sortKey);
                        }
                        const maxPrice = Math.max(
                            ...chartData.map(d => d.price),
                            ...(showForecast ? Object.values(forecastByWeek) : []),
                            1
                        );
                        const showVolumeLine = !!(chartVariete || selectedFruit || selectedVariete);
                        const maxKg = showVolumeLine ? Math.max(...chartData.map(d => d.kg), 1) : 1;
                        const baseChartW = 700;
                        const chartW = Math.max(baseChartW, 50 + (showVolumeLine ? 55 : 20) + chartData.length * 32);
                        const chartH = showVolumeLine ? 220 : 200, padL = 50, padR = showVolumeLine ? 55 : 20, padT = 20, padB = 30;
                        const needsScroll = chartW > baseChartW + 20;
                        const innerW = chartW - padL - padR, innerH = chartH - padT - padB;
                        const barW = chartData.length > 0 ? Math.min(innerW / chartData.length * 0.7, 30) : 20;
                        const gap = chartData.length > 0 ? innerW / chartData.length : 20;

                        return (
                            <Panel title="Prix Moyen par Semaine (DH/kg)" icon="fa-chart-bar" actions={
                                <div style={{display:'flex', gap:6, alignItems:'center'}}>
                                    <select value={chartVariete} onChange={e => setChartVariete(e.target.value)}
                                        style={{padding:'4px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}}>
                                        <option value="">Toutes variétés</option>
                                        {varietes.map(v => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                </div>
                            }>
                                <div style={{overflowX: needsScroll ? 'auto' : 'visible', width:'100%'}}>
                                <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{width: needsScroll ? `${chartW}px` : '100%', maxHeight: showVolumeLine ? 240 : 220, display:'block'}}>
                                    {[0, 0.25, 0.5, 0.75, 1].map(p => {
                                        const y = padT + innerH * (1 - p);
                                        return <g key={p}><line x1={padL} y1={y} x2={chartW-padR} y2={y} stroke="#f0f0f0" /><text x={padL-4} y={y+4} textAnchor="end" fontSize={9} fill="#999">{Math.round(maxPrice * p)}</text></g>;
                                    })}
                                    {showVolumeLine && [0, 0.25, 0.5, 0.75, 1].map(p => {
                                        const y = padT + innerH * (1 - p);
                                        return <text key={'rax-'+p} x={chartW-padR+4} y={y+4} textAnchor="start" fontSize={9} fill="var(--blue)">{Math.round(maxKg * p).toLocaleString('fr-FR')}</text>;
                                    })}
                                    {showVolumeLine && <text x={chartW-padR+4} y={padT-6} textAnchor="start" fontSize={8} fill="var(--blue)" fontWeight={600}>kg</text>}
                                    {chartData.map((d, i) => {
                                        const x = padL + i * gap + gap / 2;
                                        const realW = showForecast ? barW * 0.5 : barW;
                                        const realX = showForecast ? x - barW/2 : x - barW/2;
                                        const h = d.price > 0 ? Math.max((d.price / maxPrice) * innerH, 0) : 0;
                                        const y = padT + innerH - h;
                                        const fc = showForecast ? forecastByWeek[String(d.week)] : null;
                                        const fcH = fc ? Math.max((fc / maxPrice) * innerH, 0) : 0;
                                        const fcY = padT + innerH - fcH;
                                        const fcW = barW * 0.5;
                                        const fcX = x + 1;
                                        return <g key={i} style={{cursor:'pointer'}} onClick={() => setPopupWeek({ week: d.week, year: d.year })}>
                                            <rect x={x - barW/2 - 4} y={padT} width={barW + 8} height={innerH + padB} fill="transparent" />
                                            {d.price > 0 && <rect x={realX} y={y} width={realW} height={h} fill="var(--berry)" rx={3} opacity={0.85} />}
                                            {d.price > 0 && <text x={showForecast ? realX + realW/2 : x} y={y - 4} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--berry)">{d.price}</text>}
                                            {fc != null && <rect x={fcX} y={fcY} width={fcW} height={fcH} fill="none" stroke="var(--berry)" strokeWidth={1.5} strokeDasharray="3,2" rx={2} opacity={0.75} />}
                                            {fc != null && <text x={fcX + fcW/2} y={fcY - 3} textAnchor="middle" fontSize={8} fontStyle="italic" fill="#888">{Math.round(fc)}</text>}
                                            <text x={x} y={chartH - 4} textAnchor="middle" fontSize={9} fill="#666">{d.label}</text>
                                        </g>;
                                    })}
                                    {showVolumeLine && chartData.length > 1 && (() => {
                                        // Solide jusqu'à la dernière semaine écoulée, pointillée pour la semaine en cours
                                        const today = new Date();
                                        const todayIso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
                                        const currentWeek = getWeekNum(todayIso);
                                        const currentYear = today.getFullYear();
                                        const cmp = (y, w) => y * 100 + w;
                                        const currentKey = cmp(currentYear, currentWeek);
                                        const coords = chartData
                                            .map((d, i) => ({
                                                x: padL + i * gap + gap / 2,
                                                y: padT + innerH - (d.kg / maxKg) * innerH,
                                                key: cmp(d.year, d.week),
                                            }))
                                            .filter(c => c.key <= currentKey);
                                        const past = coords.filter(c => c.key < currentKey);
                                        const currentPt = coords.find(c => c.key === currentKey);
                                        const solidPts = past.map(c => `${c.x},${c.y}`).join(' ');
                                        // Dashed = jonction dernière semaine écoulée → semaine en cours
                                        const dashedPts = currentPt
                                            ? (past.length > 0
                                                ? `${past[past.length-1].x},${past[past.length-1].y} ${currentPt.x},${currentPt.y}`
                                                : `${currentPt.x},${currentPt.y}`)
                                            : '';
                                        return <g>
                                            {solidPts && <polyline points={solidPts} fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
                                            {dashedPts && <polyline points={dashedPts} fill="none" stroke="var(--blue)" strokeWidth={2} strokeDasharray="6,4" strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />}
                                        </g>;
                                    })()}
                                    {showVolumeLine && (() => {
                                        const today = new Date();
                                        const todayIso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
                                        const currentWeek = getWeekNum(todayIso);
                                        const currentYear = today.getFullYear();
                                        const cmp = (y, w) => y * 100 + w;
                                        const currentKey = cmp(currentYear, currentWeek);
                                        return chartData.map((d, i) => {
                                            if (d.kg === 0 && !d.pending) return null;
                                            const dKey = cmp(d.year, d.week);
                                            if (dKey > currentKey) return null; // pas de point pour les semaines futures
                                            const isCurrent = dKey === currentKey;
                                            const x = padL + i * gap + gap / 2;
                                            const y = padT + innerH - (d.kg / maxKg) * innerH;
                                            return <circle key={'vol-'+i} cx={x} cy={y} r={3} fill="var(--blue)" opacity={isCurrent ? 0.6 : 1} />;
                                        });
                                    })()}
                                    {showVolumeLine && <g>
                                        <rect x={padL+8} y={2} width={10} height={10} fill="var(--berry)" rx={2} opacity={0.85} />
                                        <text x={padL+22} y={11} fontSize={9} fill="#666">Prix (DH/kg)</text>
                                        <line x1={padL+100} y1={7} x2={padL+118} y2={7} stroke="var(--blue)" strokeWidth={2} />
                                        <circle cx={padL+109} cy={7} r={3} fill="var(--blue)" />
                                        <text x={padL+122} y={11} fontSize={9} fill="#666">Volume (kg)</text>
                                        <line x1={padL+200} y1={7} x2={padL+218} y2={7} stroke="var(--blue)" strokeWidth={2} strokeDasharray="6,4" opacity={0.6} />
                                        <text x={padL+222} y={11} fontSize={9} fill="#666">En attente</text>
                                        {showForecast && <g>
                                            <rect x={padL+280} y={2} width={10} height={10} fill="none" stroke="var(--berry)" strokeWidth={1.5} strokeDasharray="3,2" rx={2} opacity={0.75} />
                                            <text x={padL+294} y={11} fontSize={9} fill="#666">
                                                Prévision Driscoll's{forecastUpdatedAt ? ` (maj ${formatForecastDate(forecastUpdatedAt)})` : ''}
                                            </text>
                                        </g>}
                                    </g>}
                                </svg>
                                </div>
                            </Panel>
                        );
                    })()}

                    {/* ===== POPUP DÉTAIL LIQUIDATION SEMAINE ===== */}
                    {forecastModal && (() => {
                        const m = forecastModal;
                        const fruitLabel = m.fruitCode === 'RASP' ? '🍓 Framboise (Raspberries)' : '🫐 Myrtille (Blueberries)';
                        const updateWeek = (idx, field, value) => {
                            setForecastModal(prev => {
                                const next = [...(prev.weeks || [])];
                                next[idx] = { ...next[idx], [field]: value };
                                return { ...prev, weeks: next };
                            });
                        };
                        const removeWeek = (idx) => {
                            setForecastModal(prev => {
                                const next = [...(prev.weeks || [])];
                                next.splice(idx, 1);
                                return { ...prev, weeks: next };
                            });
                        };
                        const addWeek = () => {
                            setForecastModal(prev => ({ ...prev, weeks: [...(prev.weeks || []), { week: '', year: prev.year, minMad: '', maxMad: '' }] }));
                        };
                        return (
                            <div className="modal-overlay" onClick={() => !m.loading && setForecastModal(null)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:720, maxHeight:'90vh', overflow:'auto'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:'2px solid var(--berry)'}}>
                                        <div>
                                            <div style={{fontSize:18, fontWeight:700, color:'var(--dark)'}}>Importer prévisions Driscoll's</div>
                                            <div style={{fontSize:12, color:'var(--gray-400)', marginTop:2}}>{fruitLabel} · année {m.year}</div>
                                        </div>
                                        <button onClick={() => !m.loading && setForecastModal(null)} style={{background:'none', border:'none', fontSize:24, cursor:'pointer', color:'#999'}}>×</button>
                                    </div>

                                    {m.error && <div style={{background:'#ffebee', color:'#c62828', padding:10, borderRadius:8, marginBottom:12, fontSize:12}}>{m.error}</div>}

                                    {/* Step 1: file picker */}
                                    {(m.step === 'pick' || m.step === 'ready') && (
                                        <div>
                                            <p style={{fontSize:13, color:'#555', marginBottom:12}}>
                                                Upload le slide Driscoll's correspondant. On extrait la ligne <strong>"2026 Grower return prices"</strong> et on calcule la moyenne (min+max)/2.
                                            </p>
                                            <input
                                                type="file"
                                                accept="image/png,image/jpeg,image/jpg,image/webp"
                                                onChange={(e) => handleForecastFile(e.target.files[0])}
                                                style={{marginBottom:12}}
                                            />
                                            {m.imageB64 && (
                                                <div style={{marginBottom:12}}>
                                                    <img src={m.imageB64} alt="slide" style={{maxWidth:'100%', maxHeight:260, border:'1px solid var(--gray-200)', borderRadius:6}} />
                                                </div>
                                            )}
                                            <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                                                <button className="btn-secondary" onClick={() => setForecastModal(null)} disabled={m.loading}>Annuler</button>
                                                <button className="btn-primary" onClick={runForecastExtract} disabled={!m.imageB64 || m.loading}>
                                                    {m.loading ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Extraction…</> : 'Extraire les prix'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Step 2: review extracted weeks */}
                                    {m.step === 'review' && (
                                        <div>
                                            <p style={{fontSize:13, color:'#555', marginBottom:12}}>
                                                Vérifie et corrige si besoin avant d'enregistrer. La moyenne (avgMad) est recalculée automatiquement côté serveur.
                                            </p>
                                            <table className="data-table" style={{fontSize:12, width:'100%', marginBottom:12}}>
                                                <thead>
                                                    <tr>
                                                        <th>Semaine</th>
                                                        <th>Année</th>
                                                        <th>Min (MAD/kg)</th>
                                                        <th>Max (MAD/kg)</th>
                                                        <th style={{textAlign:'right'}}>Moy.</th>
                                                        <th></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(m.weeks || []).map((w, i) => {
                                                        const mn = parseFloat(w.minMad);
                                                        const mx = parseFloat(w.maxMad);
                                                        const avg = (Number.isFinite(mn) && Number.isFinite(mx)) ? ((mn + mx) / 2).toFixed(2) : '-';
                                                        return (
                                                            <tr key={i}>
                                                                <td><input type="number" value={w.week} onChange={(e) => updateWeek(i, 'week', e.target.value)} style={{width:60}} /></td>
                                                                <td><input type="number" value={w.year || m.year} onChange={(e) => updateWeek(i, 'year', e.target.value)} style={{width:80}} /></td>
                                                                <td><input type="number" step="0.01" value={w.minMad} onChange={(e) => updateWeek(i, 'minMad', e.target.value)} style={{width:90}} /></td>
                                                                <td><input type="number" step="0.01" value={w.maxMad} onChange={(e) => updateWeek(i, 'maxMad', e.target.value)} style={{width:90}} /></td>
                                                                <td style={{textAlign:'right', fontWeight:600, color:'var(--berry)'}}>{avg}</td>
                                                                <td><button onClick={() => removeWeek(i)} style={{background:'none', border:'none', color:'#c62828', cursor:'pointer'}} title="Supprimer">×</button></td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                            <button className="btn-secondary" onClick={addWeek} style={{fontSize:11, padding:'4px 10px', marginBottom:12}}>+ Ajouter une semaine</button>
                                            <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                                                <button className="btn-secondary" onClick={() => setForecastModal(m0 => ({ ...m0, step: 'ready' }))} disabled={m.loading}>← Retour</button>
                                                <button className="btn-primary" onClick={saveForecast} disabled={m.loading || (m.weeks || []).length === 0}>
                                                    {m.loading ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Enregistrement…</> : 'Enregistrer'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    {popupWeek && (() => {
                        const pw = popupWeek;
                        const weekRows = filtered.filter(r => r.week === pw.week && (r.year || 2025) === pw.year);
                        if (weekRows.length === 0) { setPopupWeek(null); return null; }
                        const wKg = weekRows.reduce((s, r) => s + (r.receiptQtyKg || 0), 0);
                        const wGsNet = weekRows.reduce((s, r) => s + (r.gsNet || 0), 0);
                        const wAvgPrice = wKg > 0 ? (wGsNet / wKg).toFixed(2) : '0';
                        // Group by variety
                        const byVar = {};
                        weekRows.forEach(r => {
                            const v = r.variety || '?';
                            if (!byVar[v]) byVar[v] = { kg: 0, gsNet: 0, lots: 0 };
                            byVar[v].kg += r.receiptQtyKg || 0;
                            byVar[v].gsNet += r.gsNet || 0;
                            byVar[v].lots += 1;
                        });
                        return (
                            <div className="modal-overlay" onClick={() => setPopupWeek(null)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:750, maxHeight:'90vh', overflow:'auto'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:'2px solid var(--berry)'}}>
                                        <div>
                                            <div style={{fontSize:18, fontWeight:700, color:'var(--dark)'}}>Liquidation Semaine W{pw.week}-{String(pw.year).slice(-2)}</div>
                                            <div style={{fontSize:12, color:'var(--gray-400)', marginTop:2}}>{weekRows.length} lot{weekRows.length > 1 ? 's' : ''}</div>
                                        </div>
                                        <div style={{display:'flex', gap:16, fontSize:13}}>
                                            <div style={{textAlign:'center'}}><div style={{fontWeight:700, fontSize:18}}>{Math.round(wKg).toLocaleString('fr-FR')}</div><div style={{fontSize:10, color:'var(--gray-400)'}}>kg</div></div>
                                            <div style={{textAlign:'center'}}><div style={{fontWeight:700, fontSize:18, color:'var(--green)'}}>{Math.round(wGsNet).toLocaleString('fr-FR')}</div><div style={{fontSize:10, color:'var(--gray-400)'}}>DH</div></div>
                                            <div style={{textAlign:'center'}}><div style={{fontWeight:700, fontSize:18, color:'var(--berry)'}}>{wAvgPrice}</div><div style={{fontSize:10, color:'var(--gray-400)'}}>DH/kg</div></div>
                                        </div>
                                    </div>

                                    {/* Résumé par variété */}
                                    <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:16}}>
                                        {Object.entries(byVar).sort((a,b) => b[1].kg - a[1].kg).map(([v, d]) => (
                                            <div key={v} style={{flex:'1 1 140px', padding:'10px', background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:11, fontWeight:600, color:'var(--gray-500)'}}>{v}</div>
                                                <div style={{fontSize:16, fontWeight:700}}>{Math.round(d.kg).toLocaleString('fr-FR')} kg</div>
                                                <div style={{fontSize:11, color:'var(--green)'}}>{d.kg > 0 ? (d.gsNet / d.kg).toFixed(2) : '0'} DH/kg</div>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>{d.lots} lots</div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Tableau détail */}
                                    <div style={{overflowX:'auto'}}>
                                        <table className="data-table" style={{fontSize:12}}>
                                            <thead>
                                                <tr>
                                                    <th>Date</th>
                                                    <th>Receipt ID</th>
                                                    <th>Variété</th>
                                                    <th>Colis</th>
                                                    <th>Poids (kg)</th>
                                                    <th>PFQ Score</th>
                                                    <th>PP Fruit</th>
                                                    <th>GS Net</th>
                                                    <th>Prix/kg</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {weekRows.map((r, i) => (
                                                    <tr key={i}>
                                                        <td style={{fontSize:11}}>{r.date || '-'}</td>
                                                        <td style={{fontFamily:'monospace', fontSize:11}}>{r.receiptId || '-'}</td>
                                                        <td style={{fontWeight:500}}>{r.variety || '-'}</td>
                                                        <td>{r.receiptQty || '-'}</td>
                                                        <td style={{fontWeight:600}}>{r.receiptQtyKg ? r.receiptQtyKg.toFixed(1) : '-'}</td>
                                                        <td>{r.pfqScore || '-'}</td>
                                                        <td>{r.ppFruit ? r.ppFruit.toFixed(2) : '-'}</td>
                                                        <td style={{fontWeight:600, color:'var(--green)'}}>{r.gsNet ? Math.round(r.gsNet).toLocaleString('fr-FR') : '-'}</td>
                                                        <td style={{color:'var(--berry)', fontWeight:600}}>{r.pricePerKg || '-'}</td>
                                                    </tr>
                                                ))}
                                                <tr style={{background:'var(--gray-100)', fontWeight:700}}>
                                                    <td colSpan={4}>TOTAL</td>
                                                    <td>{Math.round(wKg).toLocaleString('fr-FR')}</td>
                                                    <td></td>
                                                    <td></td>
                                                    <td style={{color:'var(--green)'}}>{Math.round(wGsNet).toLocaleString('fr-FR')}</td>
                                                    <td style={{color:'var(--berry)'}}>{wAvgPrice}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    <div style={{marginTop:16, textAlign:'center'}}>
                                        <button className="btn-secondary" onClick={() => setPopupWeek(null)}>Fermer</button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {!compactView && (<>
                    {/* ===== SEMAINES NON LIQUIDÉES ===== */}
                    {nonLiquidated.length > 0 && (() => {
                        const allVarsInNonLiq = [...new Set(nonLiquidated.flatMap(d => Object.keys(d.byVariety)))].sort();

                        // Tonnages campagne — Export total, Marché Local, Liquidée
                        let totalExportKg = 0, totalLocalKg = 0, totalLocalCA = 0;
                        bonsApport.filter(b => b.status !== 'rejete_qualite' && b.status !== 'rejete_chef').forEach(b => {
                            const kg = parseFloat(b.poidsLot) || 0;
                            if (kg <= 0) return;
                            const rawType = b.typeVente || '';
                            const typeVente = (rawType === "Driscoll's" || rawType === 'EXP') ? 'Export'
                                : rawType === 'ECRT' ? 'Marché Local' : rawType || '';
                            if (typeVente === 'Export') { totalExportKg += kg; }
                            else if (typeVente === 'Marché Local') {
                                totalLocalKg += kg;
                                const prix = parseFloat(b.prixDH) || 0;
                                totalLocalCA += kg * prix;
                            }
                        });
                        const tonnageLiquidee = totalExportKg - totalNonLiqKg;
                        const tonnageCampagne = totalExportKg + totalLocalKg;

                        return (
                            <Panel title={`Semaines en Attente de Liquidation (${nonLiquidated.length})`} icon="fa-hourglass-half">
                                {/* KPI Tonnages */}
                                {!privateMode && (
                                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:16}}>
                                    <div style={{background:'var(--gray-100)', borderRadius:10, padding:'12px 16px', textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600, textTransform:'uppercase'}}>Tonnage Campagne</div>
                                        <div style={{fontSize:22, fontWeight:700, color:'var(--text)'}}>{(tonnageCampagne / 1000).toFixed(1)} <span style={{fontSize:12}}>T</span></div>
                                    </div>
                                    <div style={{background:'rgba(76,175,80,0.08)', borderRadius:10, padding:'12px 16px', textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'#2e7d32', fontWeight:600, textTransform:'uppercase'}}>Tonnage Liquidée</div>
                                        <div style={{fontSize:22, fontWeight:700, color:'#2e7d32'}}>{(tonnageLiquidee / 1000).toFixed(1)} <span style={{fontSize:12}}>T</span></div>
                                    </div>
                                    <div style={{background:'rgba(255,152,0,0.08)', borderRadius:10, padding:'12px 16px', textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'#e65100', fontWeight:600, textTransform:'uppercase'}}>Tonnage en Cours</div>
                                        <div style={{fontSize:22, fontWeight:700, color:'#e65100'}}>{(totalNonLiqKg / 1000).toFixed(1)} <span style={{fontSize:12}}>T</span></div>
                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>{Math.round(totalNonLiqKg).toLocaleString('fr-FR')} kg</div>
                                    </div>
                                    <div style={{background:'rgba(156,39,176,0.08)', borderRadius:10, padding:'12px 16px', textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'#7b1fa2', fontWeight:600, textTransform:'uppercase'}}>Marché Local</div>
                                        <div style={{fontSize:22, fontWeight:700, color:'#7b1fa2'}}>{(totalLocalKg / 1000).toFixed(1)} <span style={{fontSize:12}}>T</span></div>
                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>CA: {Math.round(totalLocalCA).toLocaleString('fr-FR')} DH</div>
                                    </div>
                                </div>
                                )}
                                {!privateMode && (
                                <div style={{marginBottom:12, display:'flex', gap:8, flexWrap:'wrap'}}>
                                    <span style={{fontSize:11, background:'rgba(76,175,80,0.1)', color:'#2e7d32', padding:'4px 10px', borderRadius:8, fontWeight:600}}>
                                        CA Export estimé: {Math.round(totalEstCA).toLocaleString('fr-FR')} DH
                                    </span>
                                    {Object.entries(totalEstByCulture).sort((a,b) => b[1].ca - a[1].ca).map(([culture, data]) => (
                                        <span key={culture} style={{fontSize:11, background: culture === 'framboise' ? 'rgba(233,30,99,0.08)' : 'rgba(63,81,181,0.08)', color: culture === 'framboise' ? '#c2185b' : '#283593', padding:'4px 10px', borderRadius:8, fontWeight:600}}>
                                            {culture === 'framboise' ? '🍓' : '🫐'} {culture.charAt(0).toUpperCase() + culture.slice(1)}: {Math.round(data.ca).toLocaleString('fr-FR')} DH ({Math.round(data.kg).toLocaleString('fr-FR')} kg)
                                        </span>
                                    ))}
                                </div>
                                )}
                                <div style={{overflowX:'auto'}}>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr>
                                                <th>Semaine</th>
                                                <th>Lots</th>
                                                <th>Total Kg</th>
                                                {allVarsInNonLiq.map(v => <th key={v} style={{textAlign:'right'}}>{v} (kg)</th>)}
                                                <th style={{textAlign:'right'}}>Prév. Driscoll's<br/><span style={{fontSize:9, fontWeight:400, color:'var(--gray-400)'}}>(DH/kg)</span></th>
                                                {!privateMode && <th style={{textAlign:'right'}}>CA Estimé (DH)</th>}
                                                <th style={{fontSize:10, color:'var(--gray-400)'}}>Base prix</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {nonLiquidated.map(d => {
                                                let rowEstCA = 0;
                                                const usedSources = new Set();
                                                const fcDetails = []; // [{ fruit, minMad, maxMad, avgMad }]
                                                Object.entries(d.byVariety).forEach(([v, kg]) => {
                                                    const est = getEstForWeek(v, d.week);
                                                    rowEstCA += kg * est.price;
                                                    usedSources.add(est.weeks || '?');
                                                });
                                                // Forecast row display: one chip per fruit present in this week
                                                const fruitsInRow = new Set(Object.keys(d.byVariety).map(v => varietyToCulture(v)));
                                                fruitsInRow.forEach(fr => {
                                                    const entry = forecastsByFruit?.[fr]?.[String(d.week)];
                                                    if (entry) fcDetails.push({ fruit: fr, ...entry });
                                                });
                                                return (
                                                    <tr key={d.key}>
                                                        <td><span style={{background:'rgba(255,152,0,0.15)', color:'#e65100', padding:'2px 8px', borderRadius:8, fontWeight:700, fontSize:12}}>W{d.week}-{String(d.year).slice(-2)}</span>{d.culture && <span style={{fontSize:10, marginLeft:4}}>{d.culture === 'framboise' ? '🍓' : '🫐'}</span>}</td>
                                                        <td>{d.lots}</td>
                                                        <td style={{fontWeight:600}}>{Math.round(d.totalKg).toLocaleString('fr-FR')}</td>
                                                        {allVarsInNonLiq.map(v => <td key={v} style={{textAlign:'right'}}>{d.byVariety[v] ? Math.round(d.byVariety[v]).toLocaleString('fr-FR') : '-'}</td>)}
                                                        <td style={{textAlign:'right', fontSize:11}}>
                                                            {fcDetails.length === 0 ? <span style={{color:'var(--gray-400)'}}>-</span> : fcDetails.map((f, i) => (
                                                                <div key={i} title={`Min ${f.minMad?.toFixed(2)} – Max ${f.maxMad?.toFixed(2)} DH/kg`} style={{color:'var(--berry)', fontWeight:600}}>
                                                                    {f.fruit === 'framboise' ? '🍓' : '🫐'} {f.avgMad?.toFixed(2)}
                                                                </div>
                                                            ))}
                                                        </td>
                                                        {!privateMode && <td style={{textAlign:'right', fontWeight:600, color:'var(--green)'}}>{Math.round(rowEstCA).toLocaleString('fr-FR')}</td>}
                                                        <td style={{fontSize:10, color:'var(--gray-400)'}}>{[...usedSources].join(', ')}</td>
                                                    </tr>
                                                );
                                            })}
                                            <tr style={{background:'var(--gray-100)', fontWeight:700}}>
                                                <td>TOTAL</td>
                                                <td>{nonLiquidated.reduce((s,d) => s+d.lots, 0)}</td>
                                                <td>{Math.round(totalNonLiqKg).toLocaleString('fr-FR')}</td>
                                                {allVarsInNonLiq.map(v => {
                                                    const vTotal = nonLiquidated.reduce((s, d) => s + (d.byVariety[v] || 0), 0);
                                                    return <td key={v} style={{textAlign:'right'}}>{vTotal > 0 ? Math.round(vTotal).toLocaleString('fr-FR') : '-'}</td>;
                                                })}
                                                <td></td>
                                                {!privateMode && <td style={{textAlign:'right', color:'var(--green)'}}>{Math.round(totalEstCA).toLocaleString('fr-FR')}</td>}
                                                <td></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{marginTop:12, padding:'10px 14px', background:'var(--gray-50)', borderRadius:8, border:'1px solid var(--gray-200)'}}>
                                    <div style={{fontSize:11, fontWeight:600, color:'#555', marginBottom:6}}>
                                        <i className="fa-solid fa-tag" style={{marginRight:6, color:'var(--berry)'}}></i>
                                        Prix utilisés par culture (moyenne des 2 dernières liquidations)
                                    </div>
                                    <div style={{display:'flex', gap:20, flexWrap:'wrap'}}>
                                        {Object.entries(priceByCulture).sort((a,b) => b[1].price - a[1].price).map(([culture, info]) => (
                                            <div key={culture} style={{fontSize:12, color:'#333'}}>
                                                <strong style={{textTransform:'capitalize'}}>{culture}</strong>: <span style={{color:'var(--green)', fontWeight:600}}>{info.price.toFixed(2)} DH/kg</span>
                                                <span style={{fontSize:10, color:'var(--gray-400)', marginLeft:4}}>({info.detail})</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </Panel>
                        );
                    })()}

                    {/* Reconciliation: see QualiteReconciliationTab */}

                    {false && (() => {
                        const normalizeRid = (rid) => {
                            if (!rid) return '';
                            let s = String(rid).trim().toUpperCase();
                            const m = s.match(/^RID-0*(\d+)$/);
                            return m ? m[1] : s;
                        };

                        // 2. Build GLOBAL set of all liquidation receipt IDs (across all weeks)
                        const allLiqRidsNorm = new Map(); // normalizedId -> { originalId, week, year }
                        const liqByWeek = {};
                        liquidations.forEach(l => {
                            if (!l.week) return;
                            const fruit = (l.fruit || l.fruitCode || '').toLowerCase();
                            if (selectedFruit === 'framboise' && /myrtille|blue/i.test(fruit)) return;
                            if (selectedFruit === 'myrtille' && /framboise|rasp/i.test(fruit)) return;
                            const ywMatch = (l.subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                            const year = ywMatch ? parseInt(ywMatch[1]) : 2025;
                            const key = `${year}-W${l.week}`;
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

                        // 3. Build GLOBAL set of all expedition receipt IDs + per-week
                        const allExpRidsNorm = new Map(); // normalizedId -> { exp, week, year }
                        const expByWeekRec = {};
                        expeditions.filter(e => e.overallResult !== 'REJECT').forEach(e => {
                            const w = getISOWeek(e.date);
                            const y = getISOYear(e.date);
                            if (!w || !y) return;
                            const key = `${y}-W${w}`;
                            if (!expByWeekRec[key]) expByWeekRec[key] = [];
                            const exp = {
                                receiptId: e.receiptId,
                                receiptIdNorm: normalizeRid(e.receiptId),
                                variety: applyVarietyMapping ? applyVarietyMapping(e.batchNumber, e.variety) : e.variety,
                                kg: e.batchWeight || 0,
                                date: e.date,
                                ferme: e.ranch === '200742' ? 'F1' : e.ranch === '200876' ? 'F5' : e.ranch || '-',
                            };
                            expByWeekRec[key].push(exp);
                            allExpRidsNorm.set(exp.receiptIdNorm, { exp, week: w, year: y });
                        });

                        // 4. Smart matching: same week first, then ±1 week, then global
                        const reconciliation = Object.entries(liqByWeek).map(([key, liq]) => {
                            // Get expeditions from same week AND adjacent weeks
                            const [yearStr, weekStr] = key.split('-W');
                            const yr = parseInt(yearStr);
                            const wk = parseInt(weekStr);
                            const adjacentKeys = [
                                key,
                                `${wk === 1 ? yr - 1 : yr}-W${wk === 1 ? 52 : wk - 1}`,
                                `${wk === 52 ? yr + 1 : yr}-W${wk === 52 ? 1 : wk + 1}`,
                            ];

                            // Pool of candidate expeditions (same + adjacent weeks)
                            const sameWeekExps = expByWeekRec[key] || [];
                            const adjacentExps = adjacentKeys.slice(1).flatMap(k => expByWeekRec[k] || []);

                            // Step A: exact match within same week (normalized)
                            const matchedSameWeek = sameWeekExps.filter(e => liq.receiptIdsNorm.has(e.receiptIdNorm));
                            const matchedSameWeekNorms = new Set(matchedSameWeek.map(e => e.receiptIdNorm));

                            // Step B: for remaining liq RIDs, check adjacent weeks
                            const unmatchedLiqNorms = [...liq.receiptIdsNorm].filter(n => !matchedSameWeekNorms.has(n));
                            const matchedAdjacentLiq = [];
                            unmatchedLiqNorms.forEach(liqNorm => {
                                const adjExp = adjacentExps.find(e => e.receiptIdNorm === liqNorm);
                                if (adjExp) matchedAdjacentLiq.push({ liqNorm, exp: adjExp });
                            });
                            const matchedAdjacentNorms = new Set(matchedAdjacentLiq.map(m => m.liqNorm));

                            // Step C: for remaining unmatched expedition RIDs, check if they exist in ANY liquidation
                            const unmatchedExps = sameWeekExps.filter(e =>
                                !liq.receiptIdsNorm.has(e.receiptIdNorm)
                            );
                            const trulyMissing = unmatchedExps.filter(e => !allLiqRidsNorm.has(e.receiptIdNorm));
                            const matchedElsewhere = unmatchedExps.filter(e => allLiqRidsNorm.has(e.receiptIdNorm));

                            // Step D: extra in liq = liq RIDs with no matching expedition anywhere (with row data for import)
                            const trulyExtraInLiq = [...liq.receiptIdsNorm]
                                .filter(n => !matchedSameWeekNorms.has(n) && !matchedAdjacentNorms.has(n))
                                .filter(n => !allExpRidsNorm.has(n))
                                .map(n => {
                                    const orig = [...liq.receiptIds].find(r => normalizeRid(r) === n);
                                    const row = liq.rows.find(r => normalizeRid(r.receiptId) === n);
                                    return {
                                        receiptId: orig || n,
                                        variety: row ? row.variety : 'Inconnue',
                                        kg: row ? (row.totalKg || row.batchWeight || 0) : 0,
                                        week: liq.week,
                                        year: liq.year,
                                    };
                                });

                            const totalExp = sameWeekExps.length;
                            const totalLiq = liq.receiptIds.size;
                            const totalMatched = matchedSameWeek.length + matchedElsewhere.length;
                            const matchScore = totalExp > 0 ? Math.round(totalMatched / totalExp * 100) : (totalLiq > 0 ? 0 : null);

                            return {
                                key, week: liq.week, year: liq.year,
                                totalExp, totalLiq,
                                matched: totalMatched,
                                matchedSameWeek: matchedSameWeek.length,
                                matchedElsewhere: matchedElsewhere.length,
                                missingFromLiq: trulyMissing,
                                extraInLiq: trulyExtraInLiq,
                                matchScore,
                                missingKg: trulyMissing.reduce((s, e) => s + e.kg, 0),
                            };
                        }).filter(r => r.matchScore !== null).sort((a, b) => {
                            if (b.year !== a.year) return b.year - a.year;
                            return b.week - a.week;
                        });

                        const hasIssues = reconciliation.some(r => r.missingFromLiq.length > 0 || r.extraInLiq.length > 0);
                        const totalMissing = reconciliation.reduce((s, r) => s + r.missingFromLiq.length, 0);

                        return (
                            <Panel title={`Réconciliation Liquidations / Expéditions`} icon="fa-scale-balanced" actions={
                                totalMissing > 0 ? <span style={{background:'#fff3e0', color:'#e65100', padding:'4px 10px', borderRadius:8, fontSize:11, fontWeight:700}}>
                                    {totalMissing} expédition{totalMissing > 1 ? 's' : ''} non liquidée{totalMissing > 1 ? 's' : ''}
                                </span> : <span style={{background:'rgba(76,175,80,0.1)', color:'#2e7d32', padding:'4px 10px', borderRadius:8, fontSize:11, fontWeight:700}}>Tout est réconcilié</span>
                            }>
                                <table className="data-table" style={{fontSize:12}}>
                                    <thead>
                                        <tr>
                                            <th>Semaine</th>
                                            <th>Expéd.</th>
                                            <th>Liq.</th>
                                            <th>Match</th>
                                            <th>Score</th>
                                            <th>Non liquidées</th>
                                            <th>Détail</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reconciliation.map(r => {
                                            const scoreColor = r.matchScore >= 100 ? '#4caf50' : r.matchScore >= 90 ? '#ff9800' : '#e53935';
                                            return (
                                                <tr key={r.key} style={r.missingFromLiq.length > 0 ? {background:'rgba(255,152,0,0.05)'} : {}}>
                                                    <td><span style={{fontWeight:700}}>W{r.week}-{String(r.year).slice(-2)}</span></td>
                                                    <td>{r.totalExp}</td>
                                                    <td>{r.totalLiq}</td>
                                                    <td>
                                                        {r.matched}/{r.totalExp}
                                                        {r.matchedElsewhere > 0 && <span style={{fontSize:9, color:'#1976d2', marginLeft:3}} title="Matchées dans une autre semaine de liquidation">
                                                            (+{r.matchedElsewhere} autre sem.)
                                                        </span>}
                                                    </td>
                                                    <td>
                                                        <div style={{display:'flex', alignItems:'center', gap:6}}>
                                                            <div style={{width:50, height:6, background:'#e0e0e0', borderRadius:3, overflow:'hidden'}}>
                                                                <div style={{width:`${Math.min(r.matchScore, 100)}%`, height:'100%', background:scoreColor, borderRadius:3}}></div>
                                                            </div>
                                                            <span style={{fontWeight:700, color:scoreColor, fontSize:11}}>{r.matchScore}%</span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {r.missingFromLiq.length > 0 ? (
                                                            <span style={{background:'#fff3e0', color:'#e65100', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11}}>
                                                                {r.missingFromLiq.length} ({Math.round(r.missingKg)} kg)
                                                            </span>
                                                        ) : <span style={{color:'#4caf50', fontWeight:600}}>OK</span>}
                                                        {r.extraInLiq.length > 0 && (
                                                            <span style={{background:'rgba(33,150,243,0.1)', color:'#1565c0', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11, marginLeft:4}} title="Receipt IDs dans la liquidation sans expédition correspondante — cliquer Importer dans le détail">
                                                                +{r.extraInLiq.length} sans expéd.
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td style={{fontSize:10, maxWidth:300, overflow:'hidden', textOverflow:'ellipsis'}}>
                                                        {r.missingFromLiq.length > 0 ? r.missingFromLiq.map((e, i) => (
                                                            <span key={i} style={{display:'inline-block', background:'rgba(255,152,0,0.1)', padding:'1px 6px', borderRadius:4, margin:'1px 2px', fontSize:10}}>
                                                                {e.receiptId} ({e.variety}, {Math.round(e.kg)}kg)
                                                            </span>
                                                        )) : ''}
                                                        {r.extraInLiq.length > 0 ? r.extraInLiq.map((extra, i) => (
                                                            <span key={'x'+i} style={{display:'inline-flex', alignItems:'center', gap:4, background:'rgba(33,150,243,0.08)', padding:'1px 6px', borderRadius:4, margin:'1px 2px', fontSize:10, color:'#1565c0'}}>
                                                                {extra.receiptId} ({extra.variety}, {Math.round(extra.kg)}kg)
                                                                <button style={{background:'#1976d2', color:'#fff', border:'none', borderRadius:3, padding:'1px 5px', fontSize:9, cursor:'pointer', fontWeight:600}}
                                                                    title="Créer cette expédition manuellement"
                                                                    onClick={() => {
                                                                        if (!confirm(`Importer l'expédition ${extra.receiptId} (${extra.variety}, ${Math.round(extra.kg)}kg) ?`)) return;
                                                                        fetch('/api/email-analysis?action=create-manual-expedition', {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({
                                                                                receiptId: extra.receiptId,
                                                                                variety: extra.variety,
                                                                                kg: extra.kg,
                                                                                week: extra.week,
                                                                                year: extra.year,
                                                                                fruit: selectedFruit,
                                                                                source: 'import-liquidation',
                                                                            })
                                                                        }).then(r2 => r2.json()).then(json => {
                                                                            if (json.success) {
                                                                                alert(`Expédition ${extra.receiptId} créée !`);
                                                                                window.location.reload();
                                                                            } else {
                                                                                alert('Erreur: ' + (json.error || 'Echec'));
                                                                            }
                                                                        }).catch(err => alert('Erreur: ' + err.message));
                                                                    }}>
                                                                    <i className="fa-solid fa-plus"></i> Importer
                                                                </button>
                                                            </span>
                                                        )) : ''}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                <div style={{marginTop:8, fontSize:10, color:'var(--gray-400)', fontStyle:'italic'}}>
                                    Matching intelligent : comparaison normalisée des Receipt IDs, recherche dans la même semaine + semaines adjacentes + global. Les expéditions REJECT sont exclues.
                                </div>
                            </Panel>
                        );
                    })()}

                    {/* Liquidations by week */}
                    {weekKeys.map(wKey => {
                        const group = byWeek[wKey];
                        const rows = group.rows;
                        const w = group.week;
                        const wFruit = group.fruit;
                        const wKg = rows.reduce((s, r) => s + (r.receiptQtyKg || 0), 0);
                        const wGsNet = rows.reduce((s, r) => s + (r.gsNet || 0), 0);
                        const wAvgPrice = wKg > 0 ? wGsNet / wKg : 0;
                        const wYear = group.year;
                        const yearShort = String(wYear).slice(-2);
                        const wUniqueLots = new Set(rows.map(r => r.receiptId).filter(Boolean)).size || rows.length;
                        const liq = liquidations.find(l => String(l.week) === String(w) && (l.fruit || 'framboise') === wFruit);
                        const fruitIcon = wFruit === 'myrtille' ? '🫐' : '🫐';
                        const fruitBg = wFruit === 'myrtille' ? 'linear-gradient(135deg, #5C6BC0, #3949AB)' : 'linear-gradient(135deg, #9e9e9e, #bdbdbd)';
                        const fruitLabel = wFruit === 'myrtille' ? 'Myrtille' : 'Framboise';
                        return (
                            <div key={wKey} id={`liq-week-${wYear}-${w}`} className="panel" style={{marginBottom:16}}>
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                                    <div style={{display:'flex', alignItems:'center', gap:12}}>
                                        <span style={{background:fruitBg, color:'#fff', padding:'4px 12px', borderRadius:12, fontWeight:700, fontSize:14}}>{fruitIcon} W{w}-{yearShort}</span>
                                        {fruits.length > 1 && <span style={{fontSize:11, fontWeight:600, color: wFruit === 'myrtille' ? '#5C6BC0' : 'var(--berry)', background: wFruit === 'myrtille' ? 'rgba(92,107,192,0.1)' : 'var(--berry-pale)', padding:'2px 8px', borderRadius:8}}>{fruitLabel}</span>}
                                        <span style={{fontSize:13, color:'var(--gray-500)'}}>{wUniqueLots} lot{wUniqueLots > 1 ? 's' : ''}</span>
                                    </div>
                                    <div style={{display:'flex', gap:16, fontSize:12}}>
                                        <span><strong>{Math.round(wKg)}</strong> kg</span>
                                        <span style={{color:'var(--green)'}}><strong>{Math.round(wGsNet).toLocaleString('fr-FR')}</strong> DH</span>
                                        <span style={{color:'var(--berry)'}}><strong>{wAvgPrice.toFixed(2)}</strong> DH/kg</span>
                                    </div>
                                </div>
                                <div style={{overflowX:'auto'}}>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Receipt ID</th>
                                                <th>Variété</th>
                                                <th>Colis</th>
                                                <th>Poids (kg)</th>
                                                <th>PFQ Score</th>
                                                <th>PP Fruit (DH/kg)</th>
                                                <th>GS Net (DH)</th>
                                                <th>Prix/kg (DH)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((r, i) => (
                                                <tr key={i} style={{cursor:'pointer'}} onClick={() => setSelectedLiq({...liq, highlightRow: r.receiptId})}
                                                    onMouseOver={e => e.currentTarget.style.background='rgba(139,34,82,0.04)'}
                                                    onMouseOut={e => e.currentTarget.style.background=''}>
                                                    <td>{r.date}</td>
                                                    <td style={{fontSize:11, fontFamily:'monospace'}}>{r.receiptId}</td>
                                                    <td><strong>{r.variety || r.varietyCode}</strong></td>
                                                    <td style={{textAlign:'center'}}>{r.receiptQty}</td>
                                                    <td style={{textAlign:'center'}}>{r.receiptQtyKg}</td>
                                                    <td style={{textAlign:'center', fontWeight:600}}>{r.pfqScore}</td>
                                                    <td style={{textAlign:'center'}}>{r.ppFruit ? r.ppFruit.toFixed(2) : '-'}</td>
                                                    <td style={{textAlign:'center', color:'var(--green)', fontWeight:600}}>{r.gsNet ? Math.round(r.gsNet).toLocaleString('fr-FR') : '-'}</td>
                                                    <td style={{textAlign:'center', color:'var(--berry)', fontWeight:600}}>{r.pricePerKg ? r.pricePerKg.toFixed(2) : '-'}</td>
                                                </tr>
                                            ))}
                                            <tr style={{background:'#f5f5f5', fontWeight:700}}>
                                                <td colSpan={3}>Total W{w}</td>
                                                <td style={{textAlign:'center'}}>{rows.reduce((s,r) => s + (r.receiptQty || 0), 0)}</td>
                                                <td style={{textAlign:'center'}}>{Math.round(wKg)}</td>
                                                <td></td>
                                                <td></td>
                                                <td style={{textAlign:'center', color:'var(--green)'}}>{Math.round(wGsNet).toLocaleString('fr-FR')}</td>
                                                <td style={{textAlign:'center', color:'var(--berry)'}}>{wAvgPrice.toFixed(2)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                {/* Deductions summary if available */}
                                {liq && (liq.fruitAdvance || liq.dedRasp || liq.cropAdvance || liq.netPayable) ? (
                                    <div style={{marginTop:12, padding:'10px 14px', background:'#f9f9f9', borderRadius:8, display:'flex', gap:20, flexWrap:'wrap', fontSize:12}}>
                                        {liq.fruitAdvance ? <span>Fruit Advance: <strong style={{color:'var(--red)'}}>{Math.round(liq.fruitAdvance).toLocaleString('fr-FR')} DH</strong></span> : null}
                                        {liq.dedRasp ? <span>DED Rasp: <strong style={{color:'var(--red)'}}>{Math.round(liq.dedRasp).toLocaleString('fr-FR')} DH</strong></span> : null}
                                        {liq.cropAdvance ? <span>Crop Advance: <strong style={{color:'var(--red)'}}>{Math.round(liq.cropAdvance).toLocaleString('fr-FR')} DH</strong></span> : null}
                                        {liq.dexAdjustment ? <span>DEX Ajust.: <strong>{Math.round(liq.dexAdjustment).toLocaleString('fr-FR')} DH</strong></span> : null}
                                        {liq.netPayable ? <span>Net Payable: <strong style={{color:'var(--green)'}}>{Math.round(liq.netPayable).toLocaleString('fr-FR')} DH</strong></span> : null}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}

                    {/* Popup modal — PDF mirror */}
                    {selectedLiq && (() => {
                        const rows = selectedLiq.rows || [];
                        const lTotalKg = rows.reduce((s,r) => s + (r.receiptQtyKg || 0), 0);
                        const lTotalGsNet = rows.reduce((s,r) => s + (r.gsNet || 0), 0);
                        const lTotalColis = rows.reduce((s,r) => s + (r.receiptQty || 0), 0);
                        const lAvgPrice = lTotalKg > 0 ? lTotalGsNet / lTotalKg : 0;
                        const totalDeductions = (selectedLiq.fruitAdvance || 0) + (selectedLiq.dedRasp || 0) + (selectedLiq.cropAdvance || 0) + (selectedLiq.dexAdjustment || 0) + (selectedLiq.pkgDeduction || 0);
                        const netPayable = selectedLiq.netPayable || (lTotalGsNet - totalDeductions);
                        // Group rows by variety
                        const byVar = {};
                        rows.forEach(r => { const v = r.variety || r.varietyCode || '?'; if (!byVar[v]) byVar[v] = {kg:0, gs:0, colis:0}; byVar[v].kg += r.receiptQtyKg || 0; byVar[v].gs += r.gsNet || 0; byVar[v].colis += r.receiptQty || 0; });

                        return (
                            <div className="modal-overlay" onClick={() => setSelectedLiq(null)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:780, maxHeight:'90vh', overflowY:'auto', padding:0}}>
                                    {/* Header Driscoll's */}
                                    <div style={{background:'linear-gradient(135deg, #1a5e1a 0%, #2d8b4e 100%)', padding:'20px 24px', color:'white'}}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                            <div>
                                                <div style={{fontSize:10, textTransform:'uppercase', letterSpacing:2, opacity:0.7}}>Driscoll's Du Maroc SARL</div>
                                                <div style={{fontSize:20, fontWeight:700, marginTop:4}}>Rapport de Liquidation</div>
                                                <div style={{fontSize:12, opacity:0.8, marginTop:2}}>Semaine {selectedLiq.week || '?'} — Raspberries</div>
                                            </div>
                                            <div style={{textAlign:'right'}}>
                                                <div style={{fontSize:28, fontWeight:800, fontFamily:'Georgia, serif'}}>LIQUIDATION</div>
                                                <div style={{fontSize:11, opacity:0.8}}>Only the Finest Berries</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{padding:'20px 24px'}}>
                                        {/* Info Grid */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20}}>
                                            <div style={{padding:12, background:'var(--gray-100)', borderRadius:8}}>
                                                <div style={{fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', marginBottom:6}}>Producteur</div>
                                                <div style={{fontSize:13, fontWeight:600}}>Berry Good Farms SARL</div>
                                                <div style={{fontSize:11, color:'var(--gray-600)'}}>Vendor 200741</div>
                                                <div style={{fontSize:11, color:'var(--gray-600)'}}>ICE: 002106859000069</div>
                                            </div>
                                            <div style={{padding:12, background:'var(--gray-100)', borderRadius:8}}>
                                                <div style={{fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', marginBottom:6}}>Période</div>
                                                <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'3px 12px', fontSize:12}}>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Semaine</span><span style={{fontWeight:600}}>W{selectedLiq.week || '?'}</span>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Lots</span><span>{new Set(rows.map(r => r.receiptId).filter(Boolean)).size || rows.length}</span>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Date email</span><span>{selectedLiq.date ? new Date(selectedLiq.date).toLocaleDateString('fr-FR') : '-'}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Production Summary by Variety */}
                                        <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-boxes-stacked" style={{marginRight:6}}></i>Résumé par Variété
                                        </div>
                                        <table className="data-table" style={{fontSize:12, marginBottom:16}}>
                                            <thead>
                                                <tr>
                                                    <th>Variété</th>
                                                    <th style={{textAlign:'right'}}>Colis</th>
                                                    <th style={{textAlign:'right'}}>Poids (kg)</th>
                                                    <th style={{textAlign:'right'}}>Prix Moy. (DH/kg)</th>
                                                    <th style={{textAlign:'right'}}>GS Net (DH)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {Object.entries(byVar).map(([v, d]) => (
                                                    <tr key={v}>
                                                        <td><strong>{v}</strong></td>
                                                        <td style={{textAlign:'right'}}>{d.colis}</td>
                                                        <td style={{textAlign:'right', fontWeight:600}}>{d.kg}</td>
                                                        <td style={{textAlign:'right'}}>{d.kg > 0 ? (d.gs / d.kg).toFixed(2) : '-'}</td>
                                                        <td style={{textAlign:'right', fontWeight:700, color:'var(--berry)'}}>{Math.round(d.gs).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                ))}
                                                <tr style={{background:'var(--gray-100)', fontWeight:700}}>
                                                    <td>TOTAL</td>
                                                    <td style={{textAlign:'right'}}>{lTotalColis}</td>
                                                    <td style={{textAlign:'right'}}>{lTotalKg}</td>
                                                    <td style={{textAlign:'right'}}>{lAvgPrice.toFixed(2)}</td>
                                                    <td style={{textAlign:'right', color:'var(--berry)'}}>{Math.round(lTotalGsNet).toLocaleString('fr-FR')}</td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Detail per lot */}
                                        <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-list" style={{marginRight:6}}></i>Détail par Lot
                                        </div>
                                        <div style={{overflowX:'auto'}}>
                                            <table className="data-table" style={{fontSize:11, marginBottom:16}}>
                                                <thead>
                                                    <tr>
                                                        <th>Date</th>
                                                        <th>Receipt ID</th>
                                                        <th>Variété</th>
                                                        <th style={{textAlign:'right'}}>Colis</th>
                                                        <th style={{textAlign:'right'}}>kg</th>
                                                        <th style={{textAlign:'right'}}>PFQ Score</th>
                                                        <th style={{textAlign:'right'}}>PP Fruit (DH/kg)</th>
                                                        <th style={{textAlign:'right'}}>GS Net (DH)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rows.map((r, i) => (
                                                        <tr key={i} style={r.receiptId === selectedLiq.highlightRow ? {background:'rgba(139,34,82,0.08)'} : {}}>
                                                            <td>{r.date}</td>
                                                            <td style={{fontFamily:'monospace'}}>{r.receiptId}</td>
                                                            <td><strong>{r.variety || r.varietyCode}</strong></td>
                                                            <td style={{textAlign:'right'}}>{r.receiptQty}</td>
                                                            <td style={{textAlign:'right'}}>{r.receiptQtyKg}</td>
                                                            <td style={{textAlign:'right', fontWeight:600}}>{r.pfqScore}</td>
                                                            <td style={{textAlign:'right'}}>{r.ppFruit ? r.ppFruit.toFixed(2) : '-'}</td>
                                                            <td style={{textAlign:'right', color:'var(--green)', fontWeight:600}}>{r.gsNet ? Math.round(r.gsNet).toLocaleString('fr-FR') : '-'}</td>
                                                        </tr>
                                                    ))}
                                                    <tr style={{background:'var(--gray-100)', fontWeight:700}}>
                                                        <td colSpan={3}>TOTAL</td>
                                                        <td style={{textAlign:'right'}}>{lTotalColis}</td>
                                                        <td style={{textAlign:'right'}}>{lTotalKg}</td>
                                                        <td></td>
                                                        <td></td>
                                                        <td style={{textAlign:'right', color:'var(--green)'}}>{Math.round(lTotalGsNet).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Déductions */}
                                        <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-scissors" style={{marginRight:6}}></i>Déductions
                                        </div>
                                        <table className="data-table" style={{fontSize:12, marginBottom:16}}>
                                            <thead>
                                                <tr><th>Type</th><th style={{textAlign:'right'}}>Montant (DH)</th></tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td>Fruit Advance</td>
                                                    <td style={{textAlign:'right', color: selectedLiq.fruitAdvance ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>{selectedLiq.fruitAdvance ? `-${Math.round(selectedLiq.fruitAdvance).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                                <tr>
                                                    <td>DED Rasp</td>
                                                    <td style={{textAlign:'right', color: selectedLiq.dedRasp ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>{selectedLiq.dedRasp ? `-${Math.round(selectedLiq.dedRasp).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                                <tr>
                                                    <td>Crop Advance</td>
                                                    <td style={{textAlign:'right', color: selectedLiq.cropAdvance ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>{selectedLiq.cropAdvance ? `-${Math.round(selectedLiq.cropAdvance).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                                <tr>
                                                    <td>DEX Ajustement</td>
                                                    <td style={{textAlign:'right', color: selectedLiq.dexAdjustment ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>{selectedLiq.dexAdjustment ? `-${Math.round(selectedLiq.dexAdjustment).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                                <tr>
                                                    <td>Pkg Deduction</td>
                                                    <td style={{textAlign:'right', color: selectedLiq.pkgDeduction ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>{selectedLiq.pkgDeduction ? `-${Math.round(selectedLiq.pkgDeduction).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                                <tr style={{background:'rgba(231,76,60,0.05)'}}>
                                                    <td style={{fontWeight:700}}>Total Déductions</td>
                                                    <td style={{textAlign:'right', fontWeight:700, color:'var(--red)'}}>{totalDeductions > 0 ? `-${Math.round(totalDeductions).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Net Payable */}
                                        <div style={{padding:16, background:'linear-gradient(135deg, #2D8B4E10 0%, #2D8B4E20 100%)', borderRadius:10, border:'2px solid var(--green)', marginBottom:16}}>
                                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                                <div>
                                                    <div style={{fontSize:11, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase'}}>Montant Net Payable</div>
                                                    <div style={{fontSize:11, color:'var(--gray-400)'}}>GS Net total - Déductions</div>
                                                </div>
                                                <div style={{fontSize:28, fontWeight:800, color:'var(--green)'}}>{Math.round(netPayable).toLocaleString('fr-FR')} DH</div>
                                            </div>
                                        </div>

                                        {/* Recap KPIs */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:16}}>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Prix Moyen</div>
                                                <div style={{fontSize:16, fontWeight:700, color:'var(--berry)'}}>{lAvgPrice.toFixed(2)}</div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>DH / kg</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Tonnage</div>
                                                <div style={{fontSize:16, fontWeight:700}}>{lTotalKg}</div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>kg</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>% Retenu</div>
                                                <div style={{fontSize:16, fontWeight:700, color: totalDeductions > 0 ? 'var(--red)' : 'var(--green)'}}>
                                                    {lTotalGsNet > 0 ? (totalDeductions / lTotalGsNet * 100).toFixed(1) : '0'}%
                                                </div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>déductions</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Net / kg</div>
                                                <div style={{fontSize:16, fontWeight:700, color:'var(--green)'}}>
                                                    {lTotalKg > 0 ? (netPayable / lTotalKg).toFixed(2) : '0'}
                                                </div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>DH / kg</div>
                                            </div>
                                        </div>

                                        {/* Footer */}
                                        <div style={{fontSize:10, color:'var(--gray-400)', borderTop:'1px solid var(--gray-200)', paddingTop:10, marginBottom:12}}>
                                            <div>Document généré automatiquement | Berry Good Farms SARL</div>
                                            <div>R.C. 24587 | T.P. 22211020 | IF 04960175 | CNSS 2258053 | ICE 002106859000069</div>
                                        </div>

                                        <button onClick={() => setSelectedLiq(null)} style={{width:'100%', padding:'10px', background:'var(--berry)', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer'}}>
                                            <i className="fa-solid fa-xmark" style={{marginRight:6}}></i> Fermer
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                    </>)}
                </div>
            );
        }

export { QualiteLiquidationsTab };
