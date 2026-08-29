/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: achats | Déclaration(s): AchatsRapprochementTab */
import { _apiCache } from '../shared/_apiCache.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ACHATS: RAPPROCHEMENT BONS / VENDOR TAB =====================
        function AchatsRapprochementTab() {
            const [bons, setBons] = useState([]);
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [filterDate, setFilterDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); });
            const [filterFerme, setFilterFerme] = useState('');
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };
            const fermeToRanch = { 'F1': '200742', 'F5': '200876' };
            const [reprocessing, setReprocessing] = useState(false);
            const [reprocessResult, setReprocessResult] = useState(null);
            const [showPfqDqrModal, setShowPfqDqrModal] = useState(false);
            const [modalDate, setModalDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); });
            const [problemOnly, setProblemOnly] = useState(false);
            const [showEcartsSummary, setShowEcartsSummary] = useState(false);
            const [ecartsRangeDays, setEcartsRangeDays] = useState(30);

            // Navigate to next/prev problem day using actual matching algorithm
            const navParseDate = (raw) => { if (!raw) return ''; const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/); if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`; const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : ''; };
            const navNormVar = (v) => (v || '').toLowerCase().replace(/[™®\s-]/g, '').replace(/sol$/, '').replace(/(.)\1+/g, '$1');
            const isDayProblem = (iso) => {
                const dBons = bons.filter(b => {
                    if (b.typeVente === 'Marché Local') return false;
                    if ((b.date || '').slice(0, 10) !== iso) return false;
                    if (filterFerme && (b.blocFerme || b.ferme) !== filterFerme) return false;
                    return true;
                });
                const dExpAll = expeditions.filter(e => {
                    const res = (e.overallResult || '').toUpperCase();
                    if (res === 'REJECT' || res === 'FAIL') return false;
                    if (navParseDate(e.date) !== iso) return false;
                    if (filterFerme && (ranchToFerme[e.ranch] || '') !== filterFerme) return false;
                    return true;
                });
                const hasDqr = dExpAll.some(e => e.source === 'dqr-auto-created');
                const dExp = hasDqr ? dExpAll.filter(e => e.source === 'dqr-auto-created') : dExpAll;
                if (dBons.length === 0 && dExp.length === 0) return false;
                // Run score-based matching (same algorithm as main view)
                const pairs = [];
                dBons.forEach((bon, bIdx) => {
                    const bv = navNormVar(bon.blocVariete || bon.designation || '');
                    const bk = parseFloat(bon.poidsLot) || 0;
                    const bf = bon.blocFerme || bon.ferme || '';
                    dExp.forEach((exp, eIdx) => {
                        const ef = ranchToFerme[exp.ranch] || '';
                        if (bf && ef && bf !== ef) return;
                        let sc = 0;
                        const ev = navNormVar(exp.variety || '');
                        if (bv && ev && (bv.includes(ev) || ev.includes(bv))) sc += 50;
                        const ek = parseFloat(exp.batchWeight) || 0;
                        if (bk > 0 && ek > 0) sc += Math.round(Math.min(bk, ek) / Math.max(bk, ek) * 30);
                        if (bf === ef) sc += 20;
                        if (sc >= 40) pairs.push({ bIdx, eIdx, sc });
                    });
                });
                pairs.sort((a, b) => b.sc - a.sc);
                const usedB = new Set(), usedE = new Set();
                pairs.forEach(p => { if (!usedB.has(p.bIdx) && !usedE.has(p.eIdx)) { usedB.add(p.bIdx); usedE.add(p.eIdx); } });
                // Second pass: try matching remaining bons with J+1 expeditions (like main view)
                const unmatchedBonsList = dBons.filter((_, i) => !usedB.has(i));
                if (unmatchedBonsList.length > 0) {
                    const nextDay = new Date(iso + 'T12:00:00');
                    nextDay.setDate(nextDay.getDate() + 1);
                    const nextISO = nextDay.toISOString().slice(0, 10);
                    const j1ExpAll = expeditions.filter(e => {
                        const res = (e.overallResult || '').toUpperCase();
                        if (res === 'REJECT' || res === 'FAIL') return false;
                        if (navParseDate(e.date) !== nextISO) return false;
                        if (filterFerme && (ranchToFerme[e.ranch] || '') !== filterFerme) return false;
                        return true;
                    });
                    const j1HasDqr = j1ExpAll.some(e => e.source === 'dqr-auto-created');
                    const j1Exp = j1HasDqr ? j1ExpAll.filter(e => e.source === 'dqr-auto-created') : j1ExpAll;
                    const usedJ1 = new Set();
                    unmatchedBonsList.forEach(bon => {
                        const bv = navNormVar(bon.blocVariete || bon.designation || '');
                        const bk = parseFloat(bon.poidsLot) || 0;
                        const bf = bon.blocFerme || bon.ferme || '';
                        let bestIdx = -1, bestSc = 0;
                        j1Exp.forEach((exp, idx) => {
                            if (usedJ1.has(idx)) return;
                            const ef = ranchToFerme[exp.ranch] || '';
                            if (bf && ef && bf !== ef) return;
                            let sc = 0;
                            const ev = navNormVar(exp.variety || '');
                            if (bv && ev && (bv.includes(ev) || ev.includes(bv))) sc += 50;
                            const ek = parseFloat(exp.batchWeight) || 0;
                            if (bk > 0 && ek > 0) sc += Math.round(Math.min(bk, ek) / Math.max(bk, ek) * 30);
                            if (bf === ef) sc += 20;
                            if (sc > bestSc) { bestSc = sc; bestIdx = idx; }
                        });
                        if (bestIdx >= 0 && bestSc >= 40) { usedJ1.add(bestIdx); usedB.add(dBons.indexOf(bon)); }
                    });
                }
                const unmatchedBonsCount = dBons.length - usedB.size;
                if (unmatchedBonsCount > 0) return true;
                return false;
            };
            const navigateDay = (direction) => {
                if (!problemOnly) {
                    const d = new Date(filterDate + 'T12:00:00');
                    d.setDate(d.getDate() + direction);
                    setFilterDate(d.toISOString().slice(0, 10));
                    return;
                }
                const d = new Date(filterDate + 'T12:00:00');
                for (let i = 0; i < 90; i++) {
                    d.setDate(d.getDate() + direction);
                    const iso = d.toISOString().slice(0, 10);
                    if (isDayProblem(iso)) { setFilterDate(iso); return; }
                }
            };

            const reprocessPFQ = async (days) => {
                if (!confirm(`Régénérer les PFQ des ${days} derniers jours ? Les emails PFQ seront re-analysés.`)) return;
                setReprocessing(true);
                setReprocessResult(null);
                try {
                    const token = await firebase.auth().currentUser.getIdToken();
                    const resp = await fetch('/api/email-analysis?action=reprocess-pfq', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ days })
                    });
                    const data = await resp.json();
                    setReprocessResult(data);
                    delete _apiCache['/api/email-analysis?action=expeditions&limit=1000'];
                    localStorage.removeItem('cache_/api/email-analysis?action=expeditions&limit=1000');
                    const expJson = await cachedFetch('/api/email-analysis?action=expeditions&limit=1000');
                    if (expJson?.expeditions) setExpeditions(expJson.expeditions);
                } catch (err) {
                    setReprocessResult({ success: false, error: err.message });
                }
                setReprocessing(false);
            };

            const cleanupDuplicateDqr = async () => {
                setReprocessing(true);
                setReprocessResult(null);
                try {
                    const token = await firebase.auth().currentUser.getIdToken();
                    const dryResp = await fetch('/api/email-analysis?action=cleanup-duplicate-dqr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ apply: false })
                    });
                    const dry = await dryResp.json();
                    if (!dry.success) throw new Error(dry.error || 'Dry-run échoué');
                    if (dry.docsToDelete === 0) {
                        setReprocessResult({ success: true, message: `Aucun doublon détecté (${dry.totalDqrDocs} expéditions DQR examinées).` });
                        setReprocessing(false);
                        return;
                    }
                    const dateBreakdown = Object.entries(dry.summaryByDate || {})
                        .sort((a, b) => a[0].localeCompare(b[0]))
                        .map(([d, n]) => `${d}: ${n}`)
                        .join('\n');
                    const ok = confirm(
                        `Nettoyer ${dry.docsToDelete} expéditions DQR doublons ?\n\n` +
                        `${dry.duplicateGroups} groupes batches concernés sur ${dry.totalDqrDocs} expéditions au total.\n\n` +
                        `Répartition par date:\n${dateBreakdown}\n\n` +
                        `Re-Inspection conservées, Initial supprimées.`
                    );
                    if (!ok) {
                        setReprocessResult({ success: true, message: `Annulé. ${dry.docsToDelete} doublons identifiés (non supprimés).` });
                        setReprocessing(false);
                        return;
                    }
                    const applyResp = await fetch('/api/email-analysis?action=cleanup-duplicate-dqr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ apply: true })
                    });
                    const data = await applyResp.json();
                    setReprocessResult({ success: data.success, message: `${data.deleted || 0} doublons DQR supprimés.` });
                    delete _apiCache['/api/email-analysis?action=expeditions&limit=1000'];
                    localStorage.removeItem('cache_/api/email-analysis?action=expeditions&limit=1000');
                    const expJson = await cachedFetch('/api/email-analysis?action=expeditions&limit=1000');
                    if (expJson?.expeditions) setExpeditions(expJson.expeditions);
                } catch (err) {
                    setReprocessResult({ success: false, error: err.message });
                }
                setReprocessing(false);
            };

            const reprocessDQR = async (days) => {
                if (days > 30 && !confirm('Régénérer TOUS les DQR ? Cette opération peut prendre quelques minutes.')) return;
                setReprocessing(true);
                setReprocessResult(null);
                try {
                    const token = await firebase.auth().currentUser.getIdToken();
                    const resp = await fetch('/api/email-analysis?action=reprocess-dqr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ days })
                    });
                    const data = await resp.json();
                    setReprocessResult(data);
                    // Invalidate cache and reload expeditions
                    delete _apiCache['/api/email-analysis?action=expeditions&limit=1000'];
                    localStorage.removeItem('cache_/api/email-analysis?action=expeditions&limit=1000');
                    const expJson = await cachedFetch('/api/email-analysis?action=expeditions&limit=1000');
                    if (expJson?.expeditions) setExpeditions(expJson.expeditions);
                } catch (err) {
                    setReprocessResult({ success: false, error: err.message });
                }
                setReprocessing(false);
            };

            useEffect(() => {
                setLoading(true);
                Promise.all([
                    loadBonsFromFirestore(),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=1000'),
                ]).then(([bonsData, expJson]) => {
                    setBons(bonsData || []);
                    if (expJson.success && expJson.expeditions) setExpeditions(expJson.expeditions);
                }).catch(() => {}).finally(() => setLoading(false));
            }, []);

            if (loading) return React.createElement('div', {style:{textAlign:'center',padding:60}}, React.createElement('div', {className:'spinner'}), React.createElement('div', {style:{marginTop:12,color:'var(--gray-400)'}}, 'Chargement rapprochement...'));

            // Parse expedition date (MM/DD/YYYY, M/D/YYYY, or ISO YYYY-MM-DD)
            const parseExpDate = (d) => {
                if (!d) return null;
                const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
                const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : null;
            };

            // Filter bons for selected date (export only)
            const dayBons = bons.filter(b => {
                if (b.typeVente === 'Marché Local') return false;
                const bDate = (b.date || '').slice(0, 10);
                if (bDate !== filterDate) return false;
                if (filterFerme && (b.blocFerme || b.ferme) !== filterFerme) return false;
                return true;
            });

            // Filter expeditions for selected date J and J+1 (exclude REJECT)
            // Strategy: include J+1 expeditions for matching, but exclude expeditions
            // dated today (J) that were already matched to yesterday's (J-1) bons
            // Normalize variety for matching
            const normVar = (v) => (v || '').toLowerCase().replace(/[™®\s-]/g, '').replace(/sol$/, '').replace(/(.)\1+/g, '$1');

            // --- Compute which of today's expeditions are already claimed by J-1 bons ---
            const prevDay = new Date(filterDate + 'T12:00:00');
            prevDay.setDate(prevDay.getDate() - 1);
            const prevDateISO = prevDay.toISOString().slice(0, 10);
            const prevBons = bons.filter(b => {
                if (b.typeVente === 'Marché Local') return false;
                return (b.date || '').slice(0, 10) === prevDateISO && (!filterFerme || (b.blocFerme || b.ferme) === filterFerme);
            });
            // Get J-1's same-day expeditions (to see what J-1 already matched)
            const prevDayExp = expeditions.filter(e => {
                const res = (e.overallResult || '').toUpperCase();
                if (res === 'REJECT' || res === 'FAIL') return false;
                return parseExpDate(e.date) === prevDateISO;
            });
            // Run J-1 matching to find which J-1 bons are unmatched
            const prevHasDQR = prevDayExp.some(e => e.source === 'dqr-auto-created');
            const prevDayExpF = prevHasDQR ? prevDayExp.filter(e => e.source === 'dqr-auto-created') : prevDayExp;
            const prevPairs = [];
            prevBons.forEach((bon, bIdx) => {
                const bv = normVar(bon.blocVariete || bon.designation || '');
                const bk = parseFloat(bon.poidsLot) || 0;
                const bf = bon.blocFerme || bon.ferme || '';
                prevDayExpF.forEach((exp, eIdx) => {
                    const ef = ranchToFerme[exp.ranch] || '';
                    if (bf && ef && bf !== ef) return;
                    let sc = 0;
                    const ev = normVar(exp.variety || '');
                    if (bv && ev && (bv.includes(ev) || ev.includes(bv))) sc += 50;
                    const ek = parseFloat(exp.batchWeight) || 0;
                    if (bk > 0 && ek > 0) sc += Math.round(Math.min(bk, ek) / Math.max(bk, ek) * 30);
                    if (bf === ef) sc += 20;
                    if (sc >= 40) prevPairs.push({ bIdx, eIdx, sc });
                });
            });
            prevPairs.sort((a, b) => b.sc - a.sc);
            const prevUsedB = new Set(), prevUsedE = new Set();
            prevPairs.forEach(p => { if (!prevUsedB.has(p.bIdx) && !prevUsedE.has(p.eIdx)) { prevUsedB.add(p.bIdx); prevUsedE.add(p.eIdx); } });
            // J-1 unmatched bons → they claim today's expeditions
            const prevUnmatchedBons = prevBons.filter((_, i) => !prevUsedB.has(i));
            // Find which of today's expeditions are claimed by J-1 unmatched bons
            const claimedByPrevDay = new Set();
            const todayAllExp = expeditions.filter(e => {
                const res = (e.overallResult || '').toUpperCase();
                if (res === 'REJECT' || res === 'FAIL') return false;
                return parseExpDate(e.date) === filterDate;
            });
            const todayHasDQR = todayAllExp.some(e => e.source === 'dqr-auto-created');
            const todayExpPool = todayHasDQR ? todayAllExp.filter(e => e.source === 'dqr-auto-created') : todayAllExp;
            prevUnmatchedBons.forEach(bon => {
                const bv = normVar(bon.blocVariete || bon.designation || '');
                const bk = parseFloat(bon.poidsLot) || 0;
                const bf = bon.blocFerme || bon.ferme || '';
                let bestIdx = -1, bestScore = 0;
                todayExpPool.forEach((exp, idx) => {
                    if (claimedByPrevDay.has(idx)) return;
                    const ef = ranchToFerme[exp.ranch] || '';
                    if (bf && ef && bf !== ef) return;
                    let sc = 0;
                    const ev = normVar(exp.variety || '');
                    if (bv && ev && (bv.includes(ev) || ev.includes(bv))) sc += 50;
                    const ek = parseFloat(exp.batchWeight) || 0;
                    if (bk > 0 && ek > 0) sc += Math.round(Math.min(bk, ek) / Math.max(bk, ek) * 30);
                    if (bf === ef) sc += 20;
                    if (sc > bestScore) { bestScore = sc; bestIdx = idx; }
                });
                if (bestIdx >= 0 && bestScore >= 40) claimedByPrevDay.add(bestIdx);
            });

            // Filter expeditions matching the selected date, excluding those claimed by J-1
            const dayExpAll = todayExpPool.filter((e, idx) => {
                if (claimedByPrevDay.has(idx)) return false;
                const ferme = ranchToFerme[e.ranch] || '';
                if (filterFerme && ferme !== filterFerme) return false;
                return true;
            });

            // Prefer DQR expeditions when available, otherwise use PFQ
            const hasDQR = todayHasDQR;
            const dayExp = dayExpAll;
            const activeSource = hasDQR ? 'DQR' : 'PFQ';

            // Match bons to expeditions — global optimal matching (best pairs first)
            const matched = [];
            const unmatchedBons = [];
            const usedExpIdx = new Set();
            const usedBonIdx = new Set();

            // Compute all possible (bon, exp) pairs with scores
            const allPairs = [];
            dayBons.forEach((bon, bIdx) => {
                const bonVar = normVar(bon.blocVariete || bon.designation || '');
                const bonKg = parseFloat(bon.poidsLot) || 0;
                const bonFerme = bon.blocFerme || bon.ferme || '';
                dayExp.forEach((exp, eIdx) => {
                    const expFerme = ranchToFerme[exp.ranch] || '';
                    if (bonFerme && expFerme && bonFerme !== expFerme) return;
                    let score = 0;
                    const expVar = normVar(exp.variety || '');
                    if (bonVar && expVar && (bonVar.includes(expVar) || expVar.includes(bonVar))) score += 50;
                    const expKg = parseFloat(exp.batchWeight) || 0;
                    if (bonKg > 0 && expKg > 0) {
                        const ratio = Math.min(bonKg, expKg) / Math.max(bonKg, expKg);
                        score += Math.round(ratio * 30);
                    }
                    if (bonFerme === expFerme) score += 20;
                    if (score >= 40) allPairs.push({ bIdx, eIdx, bon, exp, score });
                });
            });
            // Sort by score descending — best matches assigned first
            allPairs.sort((a, b) => b.score - a.score);
            allPairs.forEach(p => {
                if (usedBonIdx.has(p.bIdx) || usedExpIdx.has(p.eIdx)) return;
                usedBonIdx.add(p.bIdx);
                usedExpIdx.add(p.eIdx);
                matched.push({ bon: p.bon, exp: p.exp, score: p.score });
            });
            dayBons.forEach((bon, bIdx) => { if (!usedBonIdx.has(bIdx)) unmatchedBons.push(bon); });

            const unmatchedExp = dayExp.filter((_, idx) => !usedExpIdx.has(idx));

            // === Second pass: match unmatched bons with J+1 expeditions ===
            const nextDay = new Date(filterDate + 'T12:00:00');
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDateISO = nextDay.toISOString().slice(0, 10);
            const j1ExpAll = expeditions.filter(e => {
                const res = (e.overallResult || '').toUpperCase();
                if (res === 'REJECT' || res === 'FAIL') return false;
                return parseExpDate(e.date) === nextDateISO && (!filterFerme || (ranchToFerme[e.ranch] || '') === filterFerme);
            });
            const j1Exp = j1ExpAll.filter(e => hasDQR ? e.source === 'dqr-auto-created' : true);
            const stillUnmatched = [];
            const usedJ1Idx = new Set();
            unmatchedBons.splice(0).forEach(bon => {
                const bonVar = normVar(bon.blocVariete || bon.designation || '');
                const bonKg = parseFloat(bon.poidsLot) || 0;
                const bonFerme = bon.blocFerme || bon.ferme || '';
                let bestIdx = -1, bestScore = 0;
                j1Exp.forEach((exp, idx) => {
                    if (usedJ1Idx.has(idx)) return;
                    const expFerme = ranchToFerme[exp.ranch] || '';
                    if (bonFerme && expFerme && bonFerme !== expFerme) return;
                    let score = 0;
                    const expVar = normVar(exp.variety || '');
                    if (bonVar && expVar && (bonVar.includes(expVar) || expVar.includes(bonVar))) score += 50;
                    const expKg = parseFloat(exp.batchWeight) || 0;
                    if (bonKg > 0 && expKg > 0) {
                        const ratio = Math.min(bonKg, expKg) / Math.max(bonKg, expKg);
                        score += Math.round(ratio * 30);
                    }
                    if (bonFerme === expFerme) score += 20;
                    if (score > bestScore) { bestScore = score; bestIdx = idx; }
                });
                if (bestIdx >= 0 && bestScore >= 40) {
                    usedJ1Idx.add(bestIdx);
                    matched.push({ bon, exp: { ...j1Exp[bestIdx], decalage: true, dateOrigine: nextDateISO }, score: bestScore });
                } else {
                    stillUnmatched.push(bon);
                }
            });
            unmatchedBons.push(...stillUnmatched);

            // Stats (include J+1 matched expeditions in totals)
            const totalBonsKg = dayBons.reduce((s, b) => s + (parseFloat(b.poidsLot) || 0), 0);
            const matchedExpKg = matched.reduce((s, m) => s + (parseFloat(m.exp.batchWeight) || 0), 0);
            const unmatchedExpKg = unmatchedExp.reduce((s, e) => s + (parseFloat(e.batchWeight) || 0), 0);
            const totalExpKg = matchedExpKg + unmatchedExpKg;
            const ecartKg = totalExpKg - totalBonsKg;

            return (
                React.createElement('div', null,
                    React.createElement('div', {style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:12}},
                        React.createElement('h2', {style:{margin:0,fontSize:20,color:'var(--dark)'}},
                            React.createElement('i', {className:'fa-solid fa-code-compare', style:{marginRight:10,color:'var(--berry)'}}),
                            'Rapprochement Bons d\'Apport / Vendor Driscolls'
                        ),
                        React.createElement('div', {style:{display:'flex',gap:8,alignItems:'center'}},
                            React.createElement('button', {onClick:() => navigateDay(-1), style:{padding:'8px 10px',borderRadius:8,border:'1px solid #ddd',background:'white',cursor:'pointer',fontSize:14}}, React.createElement('i', {className:'fa-solid fa-chevron-left'})),
                            React.createElement('input', {type:'date', value:filterDate, onChange:e => setFilterDate(e.target.value), style:{padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}),
                            React.createElement('button', {onClick:() => navigateDay(1), style:{padding:'8px 10px',borderRadius:8,border:'1px solid #ddd',background:'white',cursor:'pointer',fontSize:14}}, React.createElement('i', {className:'fa-solid fa-chevron-right'})),
                            React.createElement('button', {onClick:() => setProblemOnly(!problemOnly), style:{padding:'8px 14px',borderRadius:8,border: problemOnly ? '2px solid #f59e0b' : '1px solid #ddd',background: problemOnly ? '#fef3c7' : 'white',color: problemOnly ? '#b45309' : '#666',cursor:'pointer',fontSize:12,fontWeight:600}},
                                React.createElement('i', {className:'fa-solid fa-triangle-exclamation', style:{marginRight:6}}), 'Jours \u00e0 probl\u00e8mes'
                            ),
                            React.createElement('select', {value:filterFerme, onChange:e => setFilterFerme(e.target.value), style:{padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}},
                                React.createElement('option', {value:''}, 'Toutes fermes'),
                                React.createElement('option', {value:'F1'}, 'F1'),
                                React.createElement('option', {value:'F5'}, 'F5')
                            ),
                            React.createElement('button', {
                                onClick: () => reprocessDQR(10),
                                disabled: reprocessing,
                                style:{padding:'8px 14px',borderRadius:8,border:'1px solid var(--berry)',background:'white',color:'var(--berry)',cursor:reprocessing?'wait':'pointer',fontSize:12,fontWeight:600,opacity:reprocessing?0.6:1}
                            }, reprocessing ? React.createElement('i', {className:'fa-solid fa-spinner fa-spin', style:{marginRight:6}}) : React.createElement('i', {className:'fa-solid fa-rotate', style:{marginRight:6}}), 'Retraiter semaine'),
                            React.createElement('button', {
                                onClick: () => reprocessDQR(365),
                                disabled: reprocessing,
                                style:{padding:'8px 14px',borderRadius:8,border:'1px solid #dc2626',background:'white',color:'#dc2626',cursor:reprocessing?'wait':'pointer',fontSize:12,fontWeight:600,opacity:reprocessing?0.6:1}
                            }, reprocessing ? React.createElement('i', {className:'fa-solid fa-spinner fa-spin', style:{marginRight:6}}) : React.createElement('i', {className:'fa-solid fa-arrows-rotate', style:{marginRight:6}}), 'Régénérer tous les DQR'),
                            React.createElement('button', {
                                onClick: () => reprocessPFQ(10),
                                disabled: reprocessing,
                                style:{padding:'8px 14px',borderRadius:8,border:'1px solid #2563eb',background:'white',color:'#2563eb',cursor:reprocessing?'wait':'pointer',fontSize:12,fontWeight:600,opacity:reprocessing?0.6:1}
                            }, reprocessing ? React.createElement('i', {className:'fa-solid fa-spinner fa-spin', style:{marginRight:6}}) : React.createElement('i', {className:'fa-solid fa-envelope-open', style:{marginRight:6}}), 'Régénérer PFQ'),
                            React.createElement('button', {
                                onClick: () => { setModalDate(filterDate); setShowPfqDqrModal(true); },
                                style:{padding:'8px 14px',borderRadius:8,border:'1px solid #6366f1',background:'white',color:'#6366f1',cursor:'pointer',fontSize:12,fontWeight:600}
                            }, React.createElement('i', {className:'fa-solid fa-columns', style:{marginRight:6}}), 'PFQ vs DQR'),
                            React.createElement('button', {
                                onClick: () => setShowEcartsSummary(true),
                                style:{padding:'8px 14px',borderRadius:8,border:'1px solid #f59e0b',background:'white',color:'#b45309',cursor:'pointer',fontSize:12,fontWeight:600}
                            }, React.createElement('i', {className:'fa-solid fa-chart-line', style:{marginRight:6}}), 'Résumé écarts'),
                            React.createElement('button', {
                                onClick: cleanupDuplicateDqr,
                                disabled: reprocessing,
                                style:{padding:'8px 14px',borderRadius:8,border:'1px solid #7c3aed',background:'white',color:'#7c3aed',cursor:reprocessing?'wait':'pointer',fontSize:12,fontWeight:600,opacity:reprocessing?0.6:1}
                            }, reprocessing ? React.createElement('i', {className:'fa-solid fa-spinner fa-spin', style:{marginRight:6}}) : React.createElement('i', {className:'fa-solid fa-broom', style:{marginRight:6}}), 'Nettoyer doublons DQR'),
                            React.createElement('span', {style:{padding:'4px 12px',borderRadius:20,fontSize:11,fontWeight:700,background:activeSource==='DQR'?'#fef3c7':'#dbeafe',color:activeSource==='DQR'?'#92400e':'#1e40af'}}, 'Source: ', activeSource)
                        )
                    ),
                    // Reprocess result banner
                    reprocessResult && React.createElement('div', {style:{padding:'12px 16px',borderRadius:10,marginBottom:16,fontSize:13,background:reprocessResult.success?'#dcfce7':'#fef2f2',color:reprocessResult.success?'#166534':'#991b1b',border:'1px solid '+(reprocessResult.success?'#bbf7d0':'#fecaca'),display:'flex',justifyContent:'space-between',alignItems:'center'}},
                        React.createElement('span', null,
                            reprocessResult.success
                                ? React.createElement('span', null, React.createElement('i', {className:'fa-solid fa-circle-check', style:{marginRight:8}}), reprocessResult.message, reprocessResult.results ? ' — ' + reprocessResult.results.map(r => r.date + ': ' + r.deleted + ' supp. → ' + r.created + ' créées').join(' | ') : '')
                                : React.createElement('span', null, React.createElement('i', {className:'fa-solid fa-circle-xmark', style:{marginRight:8}}), 'Erreur: ', reprocessResult.error || 'Inconnu')
                        ),
                        React.createElement('button', {onClick:() => setReprocessResult(null), style:{background:'none',border:'none',cursor:'pointer',fontSize:16,color:'inherit'}}, '×')
                    ),
                    // KPIs
                    React.createElement('div', {style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:12,marginBottom:20}},
                        React.createElement('div', {className:'kpi-card'},
                            React.createElement('div', {className:'kpi-label'}, 'Bons d\'Apport'),
                            React.createElement('div', {className:'kpi-value'}, dayBons.length),
                            React.createElement('div', {style:{fontSize:11,color:'#888'}}, totalBonsKg.toFixed(1) + ' kg')
                        ),
                        React.createElement('div', {className:'kpi-card'},
                            React.createElement('div', {className:'kpi-label'}, 'Expéditions Vendor'),
                            React.createElement('div', {className:'kpi-value'}, dayExp.length),
                            React.createElement('div', {style:{fontSize:11,color:'#888'}}, totalExpKg.toFixed(1) + ' kg')
                        ),
                        React.createElement('div', {className:'kpi-card'},
                            React.createElement('div', {className:'kpi-label'}, 'Rapprochés'),
                            React.createElement('div', {className:'kpi-value', style:{color:'var(--green)'}}, matched.length)
                        ),
                        React.createElement('div', {className:'kpi-card'},
                            React.createElement('div', {className:'kpi-label'}, 'Écart Poids'),
                            React.createElement('div', {className:'kpi-value', style:{color: Math.abs(ecartKg) > 50 ? 'var(--red)' : 'var(--green)'}}, (ecartKg >= 0 ? '+' : '') + ecartKg.toFixed(1) + ' kg')
                        ),
                        React.createElement('div', {className:'kpi-card'},
                            React.createElement('div', {className:'kpi-label'}, 'Bons non rapprochés'),
                            React.createElement('div', {className:'kpi-value', style:{color: unmatchedBons.length > 0 ? 'var(--orange)' : 'var(--green)'}}, unmatchedBons.length)
                        ),
                        React.createElement('div', {className:'kpi-card'},
                            React.createElement('div', {className:'kpi-label'}, 'Expéditions non rapprochées'),
                            React.createElement('div', {className:'kpi-value', style:{color: unmatchedExp.length > 0 ? 'var(--orange)' : 'var(--green)'}}, unmatchedExp.length)
                        )
                    ),
                    // Matched table
                    matched.length > 0 && React.createElement('div', {style:{marginBottom:24}},
                        React.createElement('h3', {style:{fontSize:15,color:'var(--dark)',marginBottom:10}},
                            React.createElement('i', {className:'fa-solid fa-circle-check', style:{color:'var(--green)',marginRight:8}}),
                            'Rapprochés (', matched.length, ')'
                        ),
                        React.createElement('div', {style:{overflowX:'auto'}},
                            React.createElement('table', {className:'data-table', style:{fontSize:12}},
                                React.createElement('thead', null,
                                    React.createElement('tr', null,
                                        React.createElement('th', null, 'Bon N°'),
                                        React.createElement('th', null, 'Variété (Bon)'),
                                        React.createElement('th', null, 'Ferme'),
                                        React.createElement('th', null, 'Poids Bon (kg)'),
                                        React.createElement('th', {style:{borderLeft:'2px solid var(--berry)'}}, 'Receipt ID'),
                                        React.createElement('th', null, 'Variété (Vendor)'),
                                        React.createElement('th', null, 'Poids Vendor (kg)'),
                                        React.createElement('th', null, 'Résultat'),
                                        React.createElement('th', null, 'Écart (kg)'),
                                        React.createElement('th', null, 'Score'),
                                        React.createElement('th', null, 'Origine')
                                    )
                                ),
                                React.createElement('tbody', null,
                                    matched.map((m, i) => {
                                        const bonKg = parseFloat(m.bon.poidsLot) || 0;
                                        const expKg = parseFloat(m.exp.batchWeight) || 0;
                                        const ecart = expKg - bonKg;
                                        const src = m.exp.source === 'dqr-auto-created' ? 'DQR' : (m.exp.source === 'email' ? 'PFQ' : (m.exp.source || '-'));
                                        const isDecale = m.exp.decalage === true;
                                        return React.createElement('tr', {key:i},
                                            React.createElement('td', {style:{fontFamily:'monospace',fontWeight:600}}, m.bon.bonApport || m.bon.numeroPiece || '-'),
                                            React.createElement('td', null, m.bon.blocVariete || m.bon.designation || '-'),
                                            React.createElement('td', null, React.createElement('span', {className:'status-badge', style:{background:'var(--berry-pale)',color:'var(--berry)'}}, m.bon.blocFerme || m.bon.ferme || '-')),
                                            React.createElement('td', {style:{textAlign:'right',fontWeight:600}}, bonKg.toFixed(1)),
                                            React.createElement('td', {style:{fontFamily:'monospace',fontSize:11,borderLeft:'2px solid var(--berry)'}}, m.exp.receiptId || '-'),
                                            React.createElement('td', null, m.exp.variety || '-'),
                                            React.createElement('td', {style:{textAlign:'right',fontWeight:600}}, expKg.toFixed(1)),
                                            React.createElement('td', null, React.createElement('span', {className:'status-badge ' + ((m.exp.overallResult || '').toUpperCase() === 'PASS' ? 'active' : 'danger')}, m.exp.overallResult || '-')),
                                            React.createElement('td', {style:{textAlign:'right',fontWeight:600,color: Math.abs(ecart) > 10 ? 'var(--red)' : 'var(--green)'}}, (ecart >= 0 ? '+' : '') + ecart.toFixed(1)),
                                            React.createElement('td', null, React.createElement('span', {style:{padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:700,background: m.score >= 70 ? '#dcfce7' : '#fef9c3',color: m.score >= 70 ? '#166534' : '#854d0e'}}, m.score + '%')),
                                            React.createElement('td', null,
                                                React.createElement('span', {style:{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background: src === 'DQR' ? '#fef3c7' : '#dbeafe',color: src === 'DQR' ? '#92400e' : '#1e40af'}}, src),
                                                isDecale && React.createElement('span', {style:{marginLeft:4,padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:700,background:'#fef3c7',color:'#d97706'}, title:'Expédition décalée de ' + (m.exp.dateOrigine || 'J+1')}, '↩ J+1')
                                            )
                                        );
                                    })
                                )
                            )
                        )
                    ),
                    // Unmatched bons
                    unmatchedBons.length > 0 && React.createElement('div', {style:{marginBottom:24}},
                        React.createElement('h3', {style:{fontSize:15,color:'var(--orange)',marginBottom:10}},
                            React.createElement('i', {className:'fa-solid fa-triangle-exclamation', style:{marginRight:8}}),
                            'Bons d\'Apport non rapprochés (', unmatchedBons.length, ')'
                        ),
                        React.createElement('div', {style:{overflowX:'auto'}},
                            React.createElement('table', {className:'data-table', style:{fontSize:12}},
                                React.createElement('thead', null,
                                    React.createElement('tr', null,
                                        React.createElement('th', null, 'Bon N°'),
                                        React.createElement('th', null, 'Variété'),
                                        React.createElement('th', null, 'Ferme'),
                                        React.createElement('th', null, 'Poids (kg)'),
                                        React.createElement('th', null, 'Date'),
                                        React.createElement('th', null, 'Source')
                                    )
                                ),
                                React.createElement('tbody', null,
                                    unmatchedBons.map((b, i) => React.createElement('tr', {key:i, style:{background:'rgba(245,158,11,0.04)'}},
                                        React.createElement('td', {style:{fontFamily:'monospace',fontWeight:600}}, b.bonApport || b.numeroPiece || '-'),
                                        React.createElement('td', null, b.blocVariete || b.designation || '-'),
                                        React.createElement('td', null, React.createElement('span', {className:'status-badge', style:{background:'var(--berry-pale)',color:'var(--berry)'}}, b.blocFerme || b.ferme || '-')),
                                        React.createElement('td', {style:{textAlign:'right',fontWeight:600}}, (parseFloat(b.poidsLot) || 0).toFixed(1)),
                                        React.createElement('td', null, (b.date || '').slice(0, 10)),
                                        React.createElement('td', null, b.source || '-')
                                    ))
                                )
                            )
                        )
                    ),
                    // Unmatched expeditions
                    unmatchedExp.length > 0 && React.createElement('div', {style:{marginBottom:24}},
                        React.createElement('h3', {style:{fontSize:15,color:'var(--red)',marginBottom:10}},
                            React.createElement('i', {className:'fa-solid fa-circle-xmark', style:{marginRight:8}}),
                            'Expéditions Vendor non rapprochées (', unmatchedExp.length, ')'
                        ),
                        React.createElement('div', {style:{overflowX:'auto'}},
                            React.createElement('table', {className:'data-table', style:{fontSize:12}},
                                React.createElement('thead', null,
                                    React.createElement('tr', null,
                                        React.createElement('th', null, 'Receipt ID'),
                                        React.createElement('th', null, 'Variété'),
                                        React.createElement('th', null, 'Ranch'),
                                        React.createElement('th', null, 'Poids (kg)'),
                                        React.createElement('th', null, 'Colis'),
                                        React.createElement('th', null, 'Résultat'),
                                        React.createElement('th', null, 'PFQ Enriched'),
                                        React.createElement('th', null, 'Origine')
                                    )
                                ),
                                React.createElement('tbody', null,
                                    unmatchedExp.map((e, i) => {
                                        const src = e.source === 'dqr-auto-created' ? 'DQR' : (e.source === 'email' ? 'PFQ' : (e.source || '-'));
                                        const isDecale = e.decalage === true;
                                        const pqEnriched = e.enrichedPqScore || e.pfqTotal || null;
                                        return React.createElement('tr', {key:i, style:{background:'rgba(220,38,38,0.04)'}},
                                            React.createElement('td', {style:{fontFamily:'monospace',fontWeight:600}}, e.receiptId || '-'),
                                            React.createElement('td', null, e.variety || '-'),
                                            React.createElement('td', null, React.createElement('span', {className:'status-badge', style:{background:'var(--berry-pale)',color:'var(--berry)'}}, ranchToFerme[e.ranch] || e.ranch || '-')),
                                            React.createElement('td', {style:{textAlign:'right',fontWeight:600}}, (parseFloat(e.batchWeight) || 0).toFixed(1)),
                                            React.createElement('td', {style:{textAlign:'right'}}, e.batchQuantity || '-'),
                                            React.createElement('td', null, React.createElement('span', {className:'status-badge ' + ((e.overallResult || '').toUpperCase() === 'PASS' ? 'active' : 'danger')}, e.overallResult || '-')),
                                            React.createElement('td', {style:{textAlign:'right',fontWeight:600}}, pqEnriched != null ? pqEnriched.toFixed ? pqEnriched.toFixed(1) : pqEnriched : '-'),
                                            React.createElement('td', null,
                                                React.createElement('span', {style:{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background: src === 'DQR' ? '#fef3c7' : '#dbeafe',color: src === 'DQR' ? '#92400e' : '#1e40af'}}, src),
                                                isDecale && React.createElement('span', {style:{marginLeft:4,padding:'2px 6px',borderRadius:8,fontSize:9,fontWeight:700,background:'#fef3c7',color:'#d97706'}, title:'Décalée de ' + (e.dateOrigine || 'J+1')}, '↩ J+1')
                                            )
                                        );
                                    })
                                )
                            )
                        )
                    ),
                    // Empty state
                    dayBons.length === 0 && dayExp.length === 0 && React.createElement('div', {style:{textAlign:'center',padding:40,color:'var(--gray-400)'}},
                        React.createElement('i', {className:'fa-solid fa-calendar-xmark', style:{fontSize:40,marginBottom:12,display:'block'}}),
                        React.createElement('div', {style:{fontSize:14}}, 'Aucun bon d\'apport ni expédition pour le ', filterDate)
                    ),
                    // ---- PFQ vs DQR comparison modal ----
                    showPfqDqrModal && (() => {
                        const mParseDate = (d) => {
                            if (!d) return null;
                            const iso = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
                            if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
                            const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                            return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : null;
                        };
                        const mPfq = expeditions.filter(e => {
                            const s = (e.source || '');
                            if (s !== 'email') return false;
                            return mParseDate(e.date) === modalDate;
                        });
                        const mDqr = expeditions.filter(e => {
                            if (e.source !== 'dqr-auto-created') return false;
                            return mParseDate(e.date) === modalDate || mParseDate(e.dateISO) === modalDate;
                        });
                        const prevDay = () => { const d = new Date(modalDate + 'T12:00:00'); d.setDate(d.getDate()-1); setModalDate(d.toISOString().slice(0,10)); };
                        const nextDay = () => { const d = new Date(modalDate + 'T12:00:00'); d.setDate(d.getDate()+1); setModalDate(d.toISOString().slice(0,10)); };
                        const expTable = (rows, label) => React.createElement('div', {style:{flex:1,minWidth:300}},
                            React.createElement('h4', {style:{margin:'0 0 8px',fontSize:14,color:label==='PFQ'?'#1e40af':'#92400e'}},
                                React.createElement('span', {style:{padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:700,background:label==='PFQ'?'#dbeafe':'#fef3c7',color:label==='PFQ'?'#1e40af':'#92400e',marginRight:8}}, label),
                                rows.length, ' expédition(s)'
                            ),
                            React.createElement('table', {className:'data-table', style:{fontSize:11,width:'100%'}},
                                React.createElement('thead', null,
                                    React.createElement('tr', null,
                                        React.createElement('th', null, 'Receipt ID'),
                                        React.createElement('th', null, 'Variété'),
                                        React.createElement('th', null, 'Poids (kg)'),
                                        React.createElement('th', null, 'Colis'),
                                        React.createElement('th', null, 'Résultat'),
                                        React.createElement('th', null, 'Ferme')
                                    )
                                ),
                                React.createElement('tbody', null,
                                    rows.length === 0
                                        ? React.createElement('tr', null, React.createElement('td', {colSpan:6,style:{textAlign:'center',padding:20,color:'#999'}}, 'Aucune expédition ', label))
                                        : rows.map((e, i) => React.createElement('tr', {key:i},
                                            React.createElement('td', {style:{fontFamily:'monospace',fontSize:10}}, e.receiptId || '-'),
                                            React.createElement('td', null, e.variety || '-'),
                                            React.createElement('td', {style:{textAlign:'right',fontWeight:600}}, (parseFloat(e.batchWeight) || 0).toFixed(1)),
                                            React.createElement('td', {style:{textAlign:'right'}}, e.batchQuantity || '-'),
                                            React.createElement('td', null, React.createElement('span', {className:'status-badge ' + ((e.overallResult||'').toUpperCase()==='PASS'?'active':'danger')}, e.overallResult || '-')),
                                            React.createElement('td', null, ranchToFerme[e.ranch] || e.ranch || '-')
                                        ))
                                )
                            )
                        );
                        const totalPfqKg = mPfq.reduce((s,e) => s + (parseFloat(e.batchWeight)||0), 0);
                        const totalDqrKg = mDqr.reduce((s,e) => s + (parseFloat(e.batchWeight)||0), 0);
                        const diff = totalDqrKg - totalPfqKg;
                        return React.createElement('div', {style:{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}, onClick:() => setShowPfqDqrModal(false)},
                            React.createElement('div', {style:{background:'white',borderRadius:16,padding:24,maxWidth:1100,width:'95%',maxHeight:'90vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}, onClick:e => e.stopPropagation()},
                                React.createElement('div', {style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}},
                                    React.createElement('h3', {style:{margin:0,fontSize:18,color:'var(--dark)'}},
                                        React.createElement('i', {className:'fa-solid fa-columns', style:{marginRight:10,color:'#6366f1'}}),
                                        'Comparaison PFQ vs DQR'
                                    ),
                                    React.createElement('button', {onClick:() => setShowPfqDqrModal(false), style:{background:'none',border:'none',fontSize:24,cursor:'pointer',color:'#999'}}, '×')
                                ),
                                React.createElement('div', {style:{display:'flex',alignItems:'center',justifyContent:'center',gap:12,marginBottom:20}},
                                    React.createElement('button', {onClick:prevDay, style:{padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',background:'white',cursor:'pointer',fontSize:16}}, React.createElement('i', {className:'fa-solid fa-chevron-left'})),
                                    React.createElement('span', {style:{fontSize:16,fontWeight:700,color:'var(--dark)',minWidth:130,textAlign:'center'}}, modalDate),
                                    React.createElement('button', {onClick:nextDay, style:{padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',background:'white',cursor:'pointer',fontSize:16}}, React.createElement('i', {className:'fa-solid fa-chevron-right'}))
                                ),
                                React.createElement('div', {style:{display:'flex',justifyContent:'center',gap:20,marginBottom:16,fontSize:13}},
                                    React.createElement('span', null, 'PFQ: ', React.createElement('b', null, totalPfqKg.toFixed(1), ' kg')),
                                    React.createElement('span', null, 'DQR: ', React.createElement('b', null, totalDqrKg.toFixed(1), ' kg')),
                                    React.createElement('span', {style:{color:Math.abs(diff)>10?'var(--red)':'var(--green)',fontWeight:700}}, 'Écart: ', (diff>=0?'+':'')+diff.toFixed(1), ' kg')
                                ),
                                React.createElement('div', {style:{display:'flex',gap:16,flexWrap:'wrap'}},
                                    expTable(mPfq, 'PFQ'),
                                    expTable(mDqr, 'DQR')
                                )
                            )
                        );
                    })(),
                    // ---- Écarts summary modal ----
                    showEcartsSummary && (() => {
                        const sParseDate = (d) => {
                            if (!d) return null;
                            const iso = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
                            if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
                            const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                            return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : null;
                        };
                        // Build set of dates in last N days
                        const today = new Date();
                        const dates = [];
                        for (let i = 0; i < ecartsRangeDays; i++) {
                            const d = new Date(today);
                            d.setDate(d.getDate() - i);
                            dates.push(d.toISOString().slice(0, 10));
                        }
                        // Group bons by date
                        const bonsByDate = {};
                        bons.forEach(b => {
                            if (b.typeVente === 'Marché Local') return;
                            if (filterFerme && (b.blocFerme || b.ferme) !== filterFerme) return;
                            const dt = (b.date || '').slice(0, 10);
                            if (!dt) return;
                            (bonsByDate[dt] = bonsByDate[dt] || []).push(b);
                        });
                        // Group expeditions by date
                        const expByDate = {};
                        expeditions.forEach(e => {
                            const res = (e.overallResult || '').toUpperCase();
                            if (res === 'REJECT' || res === 'FAIL') return;
                            if (filterFerme && (ranchToFerme[e.ranch] || '') !== filterFerme) return;
                            const dt = sParseDate(e.date);
                            if (!dt) return;
                            (expByDate[dt] = expByDate[dt] || []).push(e);
                        });
                        // Build summary rows
                        const rows = dates.map(dt => {
                            const bs = bonsByDate[dt] || [];
                            const es = expByDate[dt] || [];
                            const hasDqr = es.some(e => e.source === 'dqr-auto-created');
                            const esF = hasDqr ? es.filter(e => e.source === 'dqr-auto-created') : es;
                            const bonsKg = bs.reduce((s, b) => s + (parseFloat(b.poidsLot) || 0), 0);
                            const expKg = esF.reduce((s, e) => s + (parseFloat(e.batchWeight) || 0), 0);
                            return {
                                date: dt,
                                bonsCount: bs.length,
                                bonsKg,
                                expCount: esF.length,
                                expKg,
                                ecart: expKg - bonsKg,
                                source: hasDqr ? 'DQR' : (es.length > 0 ? 'PFQ' : '-')
                            };
                        }).filter(r => r.bonsCount > 0 || r.expCount > 0);
                        const totalEcart = rows.reduce((s, r) => s + r.ecart, 0);
                        const totalBons = rows.reduce((s, r) => s + r.bonsKg, 0);
                        const totalExp = rows.reduce((s, r) => s + r.expKg, 0);
                        const problemDays = rows.filter(r => Math.abs(r.ecart) > 50).length;
                        const goToDay = (dt) => { setFilterDate(dt); setShowEcartsSummary(false); };
                        return React.createElement('div', {style:{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}, onClick:() => setShowEcartsSummary(false)},
                            React.createElement('div', {style:{background:'white',borderRadius:16,padding:24,maxWidth:900,width:'95%',maxHeight:'90vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}, onClick:e => e.stopPropagation()},
                                React.createElement('div', {style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}},
                                    React.createElement('h3', {style:{margin:0,fontSize:18,color:'var(--dark)'}},
                                        React.createElement('i', {className:'fa-solid fa-chart-line', style:{marginRight:10,color:'#f59e0b'}}),
                                        'Résumé des écarts par jour',
                                        filterFerme ? React.createElement('span', {style:{marginLeft:10,fontSize:12,padding:'2px 10px',borderRadius:12,background:'#fef3c7',color:'#92400e'}}, filterFerme) : null
                                    ),
                                    React.createElement('button', {onClick:() => setShowEcartsSummary(false), style:{background:'none',border:'none',fontSize:24,cursor:'pointer',color:'#999'}}, '×')
                                ),
                                React.createElement('div', {style:{display:'flex',alignItems:'center',gap:12,marginBottom:16}},
                                    React.createElement('label', {style:{fontSize:13,color:'#666'}}, 'Période:'),
                                    [7, 15, 30, 60, 90].map(n => React.createElement('button', {
                                        key: n,
                                        onClick: () => setEcartsRangeDays(n),
                                        style:{padding:'6px 12px',borderRadius:8,border: ecartsRangeDays===n ? '2px solid #f59e0b' : '1px solid #ddd',background: ecartsRangeDays===n ? '#fef3c7' : 'white',color: ecartsRangeDays===n ? '#b45309' : '#666',cursor:'pointer',fontSize:12,fontWeight:600}
                                    }, n + ' j'))
                                ),
                                React.createElement('div', {style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12,marginBottom:20}},
                                    React.createElement('div', {className:'kpi-card'},
                                        React.createElement('div', {className:'kpi-label'}, 'Total Bons'),
                                        React.createElement('div', {className:'kpi-value', style:{fontSize:18}}, totalBons.toFixed(1) + ' kg')
                                    ),
                                    React.createElement('div', {className:'kpi-card'},
                                        React.createElement('div', {className:'kpi-label'}, 'Total Expéditions'),
                                        React.createElement('div', {className:'kpi-value', style:{fontSize:18}}, totalExp.toFixed(1) + ' kg')
                                    ),
                                    React.createElement('div', {className:'kpi-card'},
                                        React.createElement('div', {className:'kpi-label'}, 'Écart total'),
                                        React.createElement('div', {className:'kpi-value', style:{fontSize:18,color: Math.abs(totalEcart) > 100 ? 'var(--red)' : 'var(--green)'}}, (totalEcart >= 0 ? '+' : '') + totalEcart.toFixed(1) + ' kg')
                                    ),
                                    React.createElement('div', {className:'kpi-card'},
                                        React.createElement('div', {className:'kpi-label'}, 'Jours à problème'),
                                        React.createElement('div', {className:'kpi-value', style:{fontSize:18,color: problemDays > 0 ? 'var(--orange)' : 'var(--green)'}}, problemDays + ' / ' + rows.length)
                                    )
                                ),
                                React.createElement('div', {style:{overflowX:'auto'}},
                                    React.createElement('table', {className:'data-table', style:{fontSize:12,width:'100%'}},
                                        React.createElement('thead', null,
                                            React.createElement('tr', null,
                                                React.createElement('th', null, 'Date'),
                                                React.createElement('th', {style:{textAlign:'right'}}, 'Bons'),
                                                React.createElement('th', {style:{textAlign:'right'}}, 'Poids Bons (kg)'),
                                                React.createElement('th', {style:{textAlign:'right'}}, 'Expéditions'),
                                                React.createElement('th', {style:{textAlign:'right'}}, 'Poids Exp. (kg)'),
                                                React.createElement('th', {style:{textAlign:'right'}}, 'Écart (kg)'),
                                                React.createElement('th', null, 'Source'),
                                                React.createElement('th', null, '')
                                            )
                                        ),
                                        React.createElement('tbody', null,
                                            rows.length === 0
                                                ? React.createElement('tr', null, React.createElement('td', {colSpan:8,style:{textAlign:'center',padding:20,color:'#999'}}, 'Aucune donnée sur la période'))
                                                : rows.map(r => {
                                                    const isProblem = Math.abs(r.ecart) > 50;
                                                    return React.createElement('tr', {
                                                        key: r.date,
                                                        onClick: () => goToDay(r.date),
                                                        style:{cursor:'pointer', background: isProblem ? '#fef2f2' : undefined}
                                                    },
                                                        React.createElement('td', {style:{fontWeight:600}}, r.date),
                                                        React.createElement('td', {style:{textAlign:'right'}}, r.bonsCount),
                                                        React.createElement('td', {style:{textAlign:'right'}}, r.bonsKg.toFixed(1)),
                                                        React.createElement('td', {style:{textAlign:'right'}}, r.expCount),
                                                        React.createElement('td', {style:{textAlign:'right'}}, r.expKg.toFixed(1)),
                                                        React.createElement('td', {style:{textAlign:'right',fontWeight:700,color: isProblem ? 'var(--red)' : 'var(--green)'}}, (r.ecart >= 0 ? '+' : '') + r.ecart.toFixed(1)),
                                                        React.createElement('td', null, React.createElement('span', {style:{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:r.source==='DQR'?'#fef3c7':(r.source==='PFQ'?'#dbeafe':'#f3f4f6'),color:r.source==='DQR'?'#92400e':(r.source==='PFQ'?'#1e40af':'#999')}}, r.source)),
                                                        React.createElement('td', {style:{color:'#6366f1'}}, React.createElement('i', {className:'fa-solid fa-arrow-right'}))
                                                    );
                                                })
                                        ),
                                        rows.length > 0 && React.createElement('tfoot', null,
                                            React.createElement('tr', {style:{fontWeight:700,background:'#f9fafb'}},
                                                React.createElement('td', null, 'TOTAL'),
                                                React.createElement('td', {style:{textAlign:'right'}}, rows.reduce((s,r) => s + r.bonsCount, 0)),
                                                React.createElement('td', {style:{textAlign:'right'}}, totalBons.toFixed(1)),
                                                React.createElement('td', {style:{textAlign:'right'}}, rows.reduce((s,r) => s + r.expCount, 0)),
                                                React.createElement('td', {style:{textAlign:'right'}}, totalExp.toFixed(1)),
                                                React.createElement('td', {style:{textAlign:'right',color: Math.abs(totalEcart) > 100 ? 'var(--red)' : 'var(--green)'}}, (totalEcart >= 0 ? '+' : '') + totalEcart.toFixed(1)),
                                                React.createElement('td', {colSpan:2}, '')
                                            )
                                        )
                                    )
                                ),
                                React.createElement('div', {style:{marginTop:12,fontSize:11,color:'#888',fontStyle:'italic'}},
                                    React.createElement('i', {className:'fa-solid fa-info-circle', style:{marginRight:6}}),
                                    'Cliquez sur une ligne pour ouvrir le détail du jour. Les jours avec |écart| > 50 kg sont marqués en rouge.'
                                )
                            )
                        );
                    })()
                )
            );
        }

export { AchatsRapprochementTab };
