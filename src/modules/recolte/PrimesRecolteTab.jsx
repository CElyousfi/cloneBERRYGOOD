/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: recolte | Déclaration(s): PrimesRecolteTab */
import { WorkerLink } from '../rh/WorkerLink.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== PRIMES RECOLTE TAB =====================
        function PrimesRecolteTab({ data, farmFilter, initialPeriode }) {
            const [fermeFilter, setFermeFilter] = useState(farmFilter || '');
            const [cultureFilter, setCultureFilter] = useState('');
            const [varieteFilter, setVarieteFilter] = useState('');
            const [showPrintModal, setShowPrintModal] = useState(false);
            const [printFerme, setPrintFerme] = useState('F1');
            const [printShowNoms, setPrintShowNoms] = useState(true);
            const [rawRows, setRawRows] = useState([]);
            const [periodes, setPeriodes] = useState([]);
            const [periodeCampagne, setPeriodeCampagne] = useState({});
            const [selectedPeriode, setSelectedPeriode] = useState('');
            const [loading, setLoading] = useState(true);
            const [selectedJourIdx, setSelectedJourIdx] = useState(null);
            const [excelCompare, setExcelCompare] = useState(null); // { workers: Map<matricule, {nom, variete, kgParJour: {day: kg}, primeParJour: {day: dh}, totalKg, totalPrime}>, jours: [16..30] }
            const [showCompare, setShowCompare] = useState(false);
            const excelFileRef = React.useRef(null);

            // Parse Excel file for comparison — reads F1+f5 sheets if available, else first sheet
            const handleExcelCompare = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (evt) => {
                    try {
                        const wb = XLSX.read(evt.target.result, { type: 'array' });
                        // Use F1 + f5 sheets if they exist, otherwise fall back to first sheet
                        const targetSheets = ['F1', 'f5', 'F5'].filter(s => wb.Sheets[s]);
                        const sheetsToRead = targetSheets.length > 0 ? targetSheets : [wb.SheetNames[0]];
                        const workers = new Map();
                        let dayNumbers = [];
                        for (const sheetName of sheetsToRead) {
                            const ws = wb.Sheets[sheetName];
                            if (!ws) continue;
                            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                            const header = rows[0];
                            // Auto-detect: find two groups of consecutive day numbers (1-31) in header
                            // First group = kilos, second group = primes
                            const dayGroups = [];
                            let curGroup = null;
                            for (let c = 0; c < header.length; c++) {
                                const d = parseInt(header[c]);
                                if (!isNaN(d) && d >= 1 && d <= 31) {
                                    if (!curGroup) curGroup = { startCol: c, days: [] };
                                    curGroup.days.push(d);
                                } else if (curGroup) {
                                    dayGroups.push(curGroup);
                                    curGroup = null;
                                }
                            }
                            if (curGroup) dayGroups.push(curGroup);
                            const kgStartCol = dayGroups.length > 0 ? dayGroups[0].startCol : 3;
                            const primeStartCol = dayGroups.length > 1 ? dayGroups[1].startCol : kgStartCol + 20;
                            const sheetDays = dayGroups.length > 0 ? dayGroups[0].days : [];
                            if (sheetDays.length > dayNumbers.length) dayNumbers = sheetDays;
                            for (let i = 1; i < rows.length; i++) {
                                const row = rows[i];
                                const mat = (row[0] || '').toString().trim().toUpperCase();
                                if (!mat || mat === '') continue;
                                // Skip total row
                                if (row[1] === '' && row[2] === '') continue;
                                const nom = row[1] || row[21] || '';
                                const variete = (row[2] || row[22] || '').toString().trim();
                                const kgParJour = {};
                                const primeParJour = {};
                                let totalKg = 0, totalPrime = 0;
                                sheetDays.forEach((day, idx) => {
                                    const kg = parseFloat(row[kgStartCol + idx]) || 0;
                                    const prime = parseFloat(row[primeStartCol + idx]) || 0;
                                    kgParJour[day] = kg;
                                    primeParJour[day] = prime;
                                    totalKg += kg;
                                    totalPrime += prime;
                                });
                                // A worker may appear multiple times (different sheets/variétés) — aggregate
                                if (workers.has(mat)) {
                                    const existing = workers.get(mat);
                                    sheetDays.forEach(day => {
                                        existing.kgParJour[day] = (existing.kgParJour[day] || 0) + (kgParJour[day] || 0);
                                        existing.primeParJour[day] = (existing.primeParJour[day] || 0) + (primeParJour[day] || 0);
                                    });
                                    existing.totalKg += totalKg;
                                    existing.totalPrime += totalPrime;
                                    if (variete && !existing.variete.includes(variete)) existing.variete += ', ' + variete;
                                } else {
                                    workers.set(mat, { nom, variete, kgParJour, primeParJour, totalKg: Math.round(totalKg * 10) / 10, totalPrime: Math.round(totalPrime * 10) / 10 });
                                }
                            }
                        }
                        setExcelCompare({ workers, jours: dayNumbers });
                        setShowCompare(true);
                    } catch (err) {
                        alert('Erreur lecture Excel: ' + err.message);
                    }
                    e.target.value = '';
                };
                reader.readAsArrayBuffer(file);
            };

            // Calculate prime from kilos
            const isMyrtille = (v) => /myrtille|blue|corina|corrina|cascade|breeze/i.test(v || '');
            const calcPrime = (kg, variete, date) => {
                const k = kg || 0;
                if (isMyrtille(variete)) {
                    const seuil = /breeze/i.test(variete || '') ? 25 : /cascade/i.test(variete || '') ? ((date || '') >= '2026-04-25' ? 30 : 25) : 30;
                    return k > seuil ? Math.round((k - seuil) * 2.5 * 10) / 10 : 0;
                }
                if (k < 20) return 0;
                if (k < 25) return 20;
                if (k < 30) return 40;
                if (k < 40) return Math.round((60 + (k - 30) * 3) * 10) / 10;
                return Math.round((90 + (k - 40) * 4) * 10) / 10;
            };

            React.useEffect(() => {
                cachedFetch('/api/pointage-rh?action=recolte-equipes').then(json => {
                    if (json.success) {
                        setRawRows(json.rows || []);
                        setPeriodes(json.periodes || []);
                        setPeriodeCampagne(json.periodeCampagne || {});
                        if (json.periodes?.length > 0) setSelectedPeriode(initialPeriode || json.periodes[0]);
                    }
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            }, []);

            // Derive equipeCode from matricule prefix
            const transportEquipes = data.transportConfig || [];
            const getEqPrefix = (mat) => {
                if (!mat) return '';
                const m = mat.toUpperCase().trim();
                const p2 = m.substring(0, 2);
                const known = transportEquipes.map(t => t.prefix);
                if (known.includes(p2)) return p2;
                if (m.startsWith('HAFI') || m.startsWith('HA')) return 'HA';
                if (m.startsWith('DD')) return 'NV';
                return p2;
            };

            // Filter by selected period
            const currentPeriode = selectedPeriode || (periodes[0] || '');
            const periodeRows = rawRows.filter(r => r.periode === currentPeriode);

            // Aggregate kg per worker per day (a worker may have multiple rows per day if multiple parcelles)
            const workerDayMap = {};
            periodeRows.forEach(r => {
                const key = (r.matricule || '') + '|' + (r.jour || '');
                if (!workerDayMap[key]) workerDayMap[key] = { matricule: r.matricule, nom: r.nom, jour: r.jour, kg: 0, variete: r.variete, ferme: r.ferme, culture: isMyrtille(r.variete) ? 'Myrtille' : 'Framboise' };
                workerDayMap[key].kg += (r.kg || 0);
            });
            const workerDayEntries = Object.values(workerDayMap);
            workerDayEntries.forEach(e => {
                e.kg = Math.round(e.kg * 10) / 10;
                e.prime = calcPrime(e.kg, e.variete, e.jour);
                e.equipeCode = getEqPrefix(e.matricule);
            });

            // Build joursLabels from data (sorted chronologically)
            const joursLabels = [...new Set(workerDayEntries.map(e => e.jour))].sort();
            const activeJourIdx = selectedJourIdx !== null && selectedJourIdx < joursLabels.length ? selectedJourIdx : joursLabels.length - 1;

            // Build recolteParJour structure: array of arrays indexed by day
            const recolteParJour = joursLabels.map(jour => workerDayEntries.filter(e => e.jour === jour));

            // Get data for selected day
            const jourData = recolteParJour[activeJourIdx] || [];
            // Filter chain: ferme → culture → variété
            let ouvriersFiltered = fermeFilter ? jourData.filter(o => o.ferme === fermeFilter) : jourData;
            ouvriersFiltered = cultureFilter ? ouvriersFiltered.filter(o => o.culture === cultureFilter) : ouvriersFiltered;
            const availableVarietes = [...new Set(ouvriersFiltered.map(o => o.variete).filter(Boolean))].sort();
            const ouvriersJour = varieteFilter ? ouvriersFiltered.filter(o => o.variete === varieteFilter) : ouvriersFiltered;

            // KPI calculations — exclude workers with 0 kg (pointés en récolte mais sans production)
            const ouvriersAvecKg = ouvriersJour.filter(o => o.kg > 0);
            const totalPrimesJour = ouvriersAvecKg.reduce((s, o) => s + o.prime, 0);
            const moyPrimeOuvrier = ouvriersAvecKg.length > 0 ? Math.round((totalPrimesJour / ouvriersAvecKg.length) * 10) / 10 : 0;
            const nbPrimes = ouvriersAvecKg.filter(o => o.prime > 0).length;
            const meilleurePrime = ouvriersAvecKg.length > 0 ? Math.max(...ouvriersAvecKg.map(o => o.prime)) : 0;

            // Recap quinzaine - for each worker, sum across all days (filtered by ferme/culture/variete)
            const nbJoursQuinzaine = joursLabels.length;
            const recapQuinzaine = {};
            recolteParJour.forEach((jourWorkers, dayIdx) => {
                const filtered = jourWorkers
                    .filter(w => !fermeFilter || w.ferme === fermeFilter)
                    .filter(w => !cultureFilter || w.culture === cultureFilter)
                    .filter(w => !varieteFilter || w.variete === varieteFilter);
                filtered.forEach(worker => {
                    const key = worker.matricule || worker.nom;
                    if (!recapQuinzaine[key]) {
                        recapQuinzaine[key] = {
                            matricule: worker.matricule,
                            nom: worker.nom,
                            equipeCode: worker.equipeCode,
                            ferme: worker.ferme,
                            variete: worker.variete,
                            culture: worker.culture,
                            jours: Array(nbJoursQuinzaine).fill(null),
                            primes: Array(nbJoursQuinzaine).fill(0),
                            totalKg: 0,
                            totalPrime: 0
                        };
                    }
                    recapQuinzaine[key].jours[dayIdx] = worker.kg;
                    recapQuinzaine[key].primes[dayIdx] = worker.prime;
                    recapQuinzaine[key].totalKg = Math.round((recapQuinzaine[key].totalKg + worker.kg) * 10) / 10;
                    recapQuinzaine[key].totalPrime += worker.prime;
                });
            });

            const recapList = Object.values(recapQuinzaine)
                .sort((a, b) => b.totalKg - a.totalKg);

            // Print function
            const handlePrint = () => {
                const ferme = printFerme;
                const showNoms = printShowNoms;
                const fermeLabel = ferme === 'F1' ? 'Ferme 172 (F1)' : 'Ferme 195 (F5)';

                // Build recap for this farm
                const printRecap = {};
                recolteParJour.forEach((jourWorkers, dayIdx) => {
                    jourWorkers.forEach(worker => {
                        if (worker.ferme !== ferme) return;
                        const key = worker.matricule || worker.nom;
                        if (!printRecap[key]) {
                            printRecap[key] = { matricule: worker.matricule, nom: worker.nom, equipeCode: worker.equipeCode, jours: Array(joursLabels.length).fill(null), primes: Array(joursLabels.length).fill(0), totalKg: 0, totalPrime: 0 };
                        }
                        printRecap[key].jours[dayIdx] = worker.kg;
                        printRecap[key].primes[dayIdx] = worker.prime;
                        printRecap[key].totalKg = Math.round((printRecap[key].totalKg + worker.kg) * 10) / 10;
                        printRecap[key].totalPrime += worker.prime;
                    });
                });
                const printList = Object.values(printRecap).sort((a, b) => b.totalKg - a.totalKg);

                const totalPrimesOuvriers = Math.round(printList.reduce((s, r) => s + r.totalPrime, 0));

                const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Primes Quinzaine - ${fermeLabel}</title>
<style>
@page { size: landscape; margin: 10mm; }
body { font-family: Arial, sans-serif; font-size: 10px; color: #333; margin: 0; padding: 10px; }
.header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #8B2252; padding-bottom: 8px; margin-bottom: 12px; }
.header h1 { font-size: 16px; color: #8B2252; margin: 0; }
.header .info { text-align: right; font-size: 10px; color: #666; }
.summary { display: flex; gap: 20px; margin-bottom: 12px; }
.summary-box { border: 1px solid #ddd; border-radius: 6px; padding: 8px 14px; text-align: center; }
.summary-box .val { font-size: 16px; font-weight: 700; color: #8B2252; }
.summary-box .lbl { font-size: 9px; color: #888; }
table { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 14px; }
th { background: #8B2252; color: white; padding: 4px 6px; text-align: left; font-size: 9px; }
td { padding: 3px 6px; border-bottom: 1px solid #eee; }
tr:nth-child(even) { background: #fafafa; }
.section-title { font-size: 12px; font-weight: 700; color: #8B2252; margin: 12px 0 6px; border-left: 3px solid #8B2252; padding-left: 8px; }
.prime-pos { color: #2D8B4E; font-weight: 600; }
.prime-zero { color: #ccc; }
.total-row { background: #f5f0f2 !important; font-weight: 700; }
.footer { margin-top: 10px; text-align: center; font-size: 8px; color: #aaa; border-top: 1px solid #ddd; padding-top: 6px; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="header">
    <h1>Berry Good Farms - Primes de Récolte Quinzaine</h1>
    <div class="info"><strong>${fermeLabel}</strong><br/>Période: ${currentPeriode}<br/>Imprimé le: ${new Date().toLocaleDateString('fr-FR')}</div>
</div>
<div class="summary">
    <div class="summary-box"><div class="val">${printList.length}</div><div class="lbl">Ouvriers</div></div>
    <div class="summary-box"><div class="val">${totalPrimesOuvriers.toLocaleString('fr-FR')} DH</div><div class="lbl">Total Primes Ouvriers</div></div>
</div>
<div class="section-title">Primes Ouvriers - Détail par Jour</div>
<table>
<thead><tr><th>Matricule</th>${showNoms ? '<th>Nom</th>' : ''}<th>Équipe</th>${joursLabels.map(j => '<th style="text-align:center">' + formatJour(j) + '</th>').join('')}<th style="text-align:right">Total Kg</th><th style="text-align:right">Total Prime</th></tr></thead>
<tbody>
${printList.map(r => `<tr><td style="font-family:monospace;font-weight:600">${r.matricule}</td>${showNoms ? '<td>' + r.nom + '</td>' : ''}<td>${r.equipeCode}</td>${r.jours.map((kg, di) => '<td style="text-align:center">' + (kg !== null ? '<div>' + kg + ' kg</div><div class="' + (r.primes[di] > 0 ? 'prime-pos' : 'prime-zero') + '">' + Math.round(r.primes[di]) + ' DH</div>' : '-') + '</td>').join('')}<td style="text-align:right;font-weight:600">${Math.round(r.totalKg * 10) / 10} kg</td><td style="text-align:right;font-weight:700;color:#2D8B4E">${Math.round(r.totalPrime)} DH</td></tr>`).join('')}
<tr class="total-row"><td colspan="${showNoms ? 3 : 2}">TOTAL</td>${joursLabels.map((_, di) => { const dPrime = printList.reduce((s, r) => s + r.primes[di], 0); return '<td style="text-align:center;font-weight:700">' + Math.round(dPrime) + ' DH</td>'; }).join('')}<td style="text-align:right;font-weight:700">${Math.round(printList.reduce((s,r) => s + r.totalKg, 0))} kg</td><td style="text-align:right;font-weight:700;color:#2D8B4E">${totalPrimesOuvriers} DH</td></tr>
</tbody></table>
<div class="footer">Berry Good Farms - Document généré automatiquement - ${currentPeriode}</div>
</body></html>`;

                const printWindow = window.open('', '_blank', 'width=1200,height=800');
                printWindow.document.write(html);
                printWindow.document.close();
                setTimeout(() => printWindow.print(), 500);
                setShowPrintModal(false);
            };

            if (loading) return <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🫐</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement des primes de récolte...</div></div>;

            // Format jour label for display (YYYY-MM-DD -> DD/MM)
            const formatJour = (j) => {
                if (!j) return '';
                if (j.includes('-')) { const p = j.split('-'); return p[2] + '/' + p[1]; }
                return j;
            };

            return (
                <div className="fade-in">
                    {/* Print Modal */}
                    {showPrintModal && (
                        <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center'}}
                            onClick={() => setShowPrintModal(false)}>
                            <div style={{background:'white', borderRadius:16, padding:28, width:420, boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                                    <h3 style={{fontSize:16, fontWeight:700, color:'var(--berry)', margin:0}}>
                                        <i className="fa-solid fa-print" style={{marginRight:8}}></i>Imprimer Primes Quinzaine
                                    </h3>
                                    <button onClick={() => setShowPrintModal(false)} style={{background:'none', border:'none', fontSize:18, cursor:'pointer', color:'var(--gray-400)'}}>&times;</button>
                                </div>

                                <div style={{marginBottom:18}}>
                                    <label style={{fontSize:12, fontWeight:600, display:'block', marginBottom:8, color:'var(--gray-600)'}}>
                                        <i className="fa-solid fa-tractor" style={{marginRight:6}}></i>Sélectionner la ferme
                                    </label>
                                    <div style={{display:'flex', gap:8}}>
                                        <button onClick={() => setPrintFerme('F1')}
                                            style={{flex:1, padding:'12px', borderRadius:10, border: printFerme==='F1' ? '2px solid var(--berry)' : '2px solid var(--gray-200)',
                                            background: printFerme==='F1' ? 'rgba(139,34,82,0.08)' : 'white', cursor:'pointer', fontWeight:600, fontSize:13, color: printFerme==='F1' ? 'var(--berry)' : 'var(--gray-500)'}}>
                                            <i className="fa-solid fa-seedling" style={{marginRight:6}}></i>Ferme F1
                                        </button>
                                        <button onClick={() => setPrintFerme('F5')}
                                            style={{flex:1, padding:'12px', borderRadius:10, border: printFerme==='F5' ? '2px solid var(--blue)' : '2px solid var(--gray-200)',
                                            background: printFerme==='F5' ? 'rgba(52,152,219,0.08)' : 'white', cursor:'pointer', fontWeight:600, fontSize:13, color: printFerme==='F5' ? 'var(--blue)' : 'var(--gray-500)'}}>
                                            <i className="fa-solid fa-leaf" style={{marginRight:6}}></i>Ferme F5
                                        </button>
                                    </div>
                                </div>

                                <div style={{marginBottom:22}}>
                                    <label style={{fontSize:12, fontWeight:600, display:'block', marginBottom:8, color:'var(--gray-600)'}}>
                                        <i className="fa-solid fa-eye" style={{marginRight:6}}></i>Affichage des ouvriers
                                    </label>
                                    <div style={{display:'flex', gap:8}}>
                                        <button onClick={() => setPrintShowNoms(true)}
                                            style={{flex:1, padding:'10px', borderRadius:10, border: printShowNoms ? '2px solid var(--green)' : '2px solid var(--gray-200)',
                                            background: printShowNoms ? 'rgba(45,139,78,0.08)' : 'white', cursor:'pointer', fontSize:12, fontWeight:600, color: printShowNoms ? 'var(--green)' : 'var(--gray-500)'}}>
                                            <i className="fa-solid fa-user" style={{marginRight:6}}></i>Matricule + Nom
                                        </button>
                                        <button onClick={() => setPrintShowNoms(false)}
                                            style={{flex:1, padding:'10px', borderRadius:10, border: !printShowNoms ? '2px solid var(--orange)' : '2px solid var(--gray-200)',
                                            background: !printShowNoms ? 'rgba(230,126,34,0.08)' : 'white', cursor:'pointer', fontSize:12, fontWeight:600, color: !printShowNoms ? 'var(--orange)' : 'var(--gray-500)'}}>
                                            <i className="fa-solid fa-hashtag" style={{marginRight:6}}></i>Matricule uniquement
                                        </button>
                                    </div>
                                </div>

                                <div style={{display:'flex', gap:10}}>
                                    <button onClick={handlePrint}
                                        style={{flex:1, padding:'12px', background:'var(--berry)', color:'white', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, boxShadow:'0 2px 10px rgba(139,34,82,0.3)'}}>
                                        <i className="fa-solid fa-print"></i> Imprimer
                                    </button>
                                    <button onClick={() => setShowPrintModal(false)}
                                        style={{padding:'12px 20px', background:'var(--gray-200)', color:'var(--gray-600)', border:'none', borderRadius:10, fontSize:13, fontWeight:600, cursor:'pointer'}}>
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'#d4edda',color:'#155724',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-database" style={{marginRight:4}}></i>Données live
                        </span>
                        <window.QuinzaineCampagneSelect periodes={periodes} periodeCampagne={periodeCampagne} value={selectedPeriode} onChange={v => { setSelectedPeriode(v); setSelectedJourIdx(null); setCultureFilter(''); setVarieteFilter(''); }} />
                    </div>

                    <div className="filters-bar" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                        {!farmFilter && (
                        <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                            <div className="chip-group">
                                <span className="chip-group-label">Ferme:</span>
                                <button className={`chip c-green ${fermeFilter === '' ? 'active' : ''}`} onClick={() => { setFermeFilter(''); setCultureFilter(''); setVarieteFilter(''); }}>Toutes</button>
                                <button className={`chip c-green ${fermeFilter === 'F1' ? 'active' : ''}`} onClick={() => { setFermeFilter('F1'); setCultureFilter(''); setVarieteFilter(''); }}>F1</button>
                                <button className={`chip c-green ${fermeFilter === 'F5' ? 'active' : ''}`} onClick={() => { setFermeFilter('F5'); setCultureFilter(''); setVarieteFilter(''); }}>F5</button>
                                <button className={`chip c-green ${fermeFilter === 'Avocatier' ? 'active' : ''}`} onClick={() => { setFermeFilter('Avocatier'); setCultureFilter(''); setVarieteFilter(''); }}>Avocatier</button>
                            </div>
                            <div className="chip-group" style={{marginLeft:8}}>
                                <span className="chip-group-label">Culture:</span>
                                <button className={`chip c-blue ${cultureFilter === '' ? 'active' : ''}`} onClick={() => { setCultureFilter(''); setVarieteFilter(''); }}>Toutes</button>
                                <button className={`chip c-blue ${cultureFilter === 'Framboise' ? 'active' : ''}`} onClick={() => { setCultureFilter('Framboise'); setVarieteFilter(''); }}>Framboise</button>
                                <button className={`chip c-blue ${cultureFilter === 'Myrtille' ? 'active' : ''}`} onClick={() => { setCultureFilter('Myrtille'); setVarieteFilter(''); }}>Myrtille</button>
                            </div>
                            {availableVarietes.length > 1 && (
                            <div style={{marginLeft:8,display:'flex',alignItems:'center',gap:6}}>
                                <span style={{fontSize:12,fontWeight:500,color:'var(--gray-600)'}}>Variété:</span>
                                <select value={varieteFilter} onChange={e => setVarieteFilter(e.target.value)} style={{padding:'5px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:11,fontWeight:600,background:'white',color:'var(--gray-700)'}}>
                                    <option value="">Toutes ({availableVarietes.length})</option>
                                    {availableVarietes.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                            </div>
                            )}
                        </div>
                        )}
                        <div style={{display:'flex',gap:8}}>
                            <input type="file" accept=".xlsx,.xls" ref={excelFileRef} onChange={handleExcelCompare} style={{display:'none'}} />
                            {showCompare && <button onClick={() => excelFileRef.current?.click()} style={{padding:'8px 18px', background:'#27ae60', color:'white', border:'none', borderRadius:10, fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, boxShadow:'0 2px 8px rgba(39,174,96,0.3)'}}>
                                <i className="fa-solid fa-file-excel"></i> Recharger Excel
                            </button>}
                            <button onClick={() => showCompare ? setShowCompare(false) : excelFileRef.current?.click()} style={{padding:'8px 18px', background: showCompare ? 'var(--orange)' : '#27ae60', color:'white', border:'none', borderRadius:10, fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, boxShadow: showCompare ? '0 2px 8px rgba(230,126,34,0.3)' : '0 2px 8px rgba(39,174,96,0.3)'}}>
                                <i className={showCompare ? 'fa-solid fa-times' : 'fa-solid fa-file-excel'}></i> {showCompare ? 'Fermer Comparaison' : 'Comparer Excel'}
                            </button>
                            <button onClick={() => setShowPrintModal(true)} style={{padding:'8px 18px', background:'var(--berry)', color:'white', border:'none', borderRadius:10, fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, boxShadow:'0 2px 8px rgba(139,34,82,0.3)'}}>
                                <i className="fa-solid fa-print"></i> Imprimer Quinzaine
                            </button>
                        </div>
                    </div>

                    <div className="chip-group" style={{marginTop:10, marginBottom:20}}>
                        <span className="chip-group-label">Jour:</span>
                        {joursLabels.map((jour, idx) => (
                            <button key={idx} className={`chip c-berry ${activeJourIdx === idx ? 'active' : ''}`} onClick={() => setSelectedJourIdx(idx)}
                                style={{minWidth:44, fontSize:11, padding:'4px 8px'}}>
                                {formatJour(jour)}{idx === joursLabels.length - 1 ? ' ★' : ''}
                            </button>
                        ))}
                    </div>

                    <div className="kpi-grid">
                        <KPICard
                            icon="fa-coins"
                            iconClass="gold"
                            value={Math.round(totalPrimesJour).toLocaleString('fr-FR')}
                            label="Primes du Jour"
                        />
                        <KPICard
                            icon="fa-user-check"
                            iconClass="green"
                            value={Math.round(moyPrimeOuvrier).toLocaleString('fr-FR')}
                            label="Moy Prime/Ouvrier"
                        />
                        <KPICard
                            icon="fa-users"
                            iconClass="blue"
                            value={nbPrimes}
                            label="Nb Primés (>20kg)"
                        />
                        <KPICard
                            icon="fa-trophy"
                            iconClass="orange"
                            value={Math.round(meilleurePrime).toLocaleString('fr-FR')}
                            label="Meilleure Prime"
                        />
                    </div>

                    <Panel title={`Primes Ouvriers - ${formatJour(joursLabels[activeJourIdx])}`} icon="fa-ranking-star">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Matricule</th>
                                    <th>Nom</th>
                                    <th>Équipe</th>
                                    <th>Variété</th>
                                    <th>Kg Récoltés</th>
                                    <th>Prime (DH)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ouvriersJour.sort((a, b) => b.prime - a.prime).map((o, i) => (
                                    <tr key={i}>
                                        <td style={{fontSize: '12px', color: 'var(--gray-400)'}}>{o.matricule}</td>
                                        <td style={{fontWeight: 500}}>{o.nom}</td>
                                        <td>{o.equipeCode}</td>
                                        <td style={{fontSize: 11, color: 'var(--gray-500)'}}>{o.variete || '-'}</td>
                                        <td><strong>{o.kg} kg</strong></td>
                                        <td style={{color: o.prime > 0 ? 'var(--green)' : 'var(--gray-400)', fontWeight: 600}}>
                                            {Math.round(o.prime)} DH
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Panel>

                    <Panel title={`Récap Période — ${currentPeriode}`} icon="fa-calendar">
                        <div style={{overflowX: 'auto'}}>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th style={{position:'sticky', left:0, background:'var(--berry)', zIndex:1}}>Matricule</th>
                                        <th>Nom</th>
                                        <th>Éq.</th>
                                        {joursLabels.map((jour, i) => (
                                            <th key={i} style={{fontSize:10, textAlign:'center', minWidth:50}}>{formatJour(jour)}</th>
                                        ))}
                                        <th style={{textAlign:'right'}}>Total Kg</th>
                                        <th style={{textAlign:'right'}}>Total Prime</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recapList.map((r, i) => (
                                        <tr key={i}>
                                            <td style={{fontSize:10, color:'var(--gray-500)', fontFamily:'monospace', fontWeight:600, position:'sticky', left:0, background:'white', zIndex:1}}>{r.matricule}</td>
                                            <td style={{fontWeight:500, whiteSpace:'nowrap'}}><WorkerLink matricule={r.matricule} nom={r.nom} /></td>
                                            <td style={{fontSize:10}}>{r.equipeCode}</td>
                                            {r.jours.map((kg, dayIdx) => (
                                                <td key={dayIdx} style={{fontSize:11, textAlign:'center', color: kg !== null && kg > 0 ? 'var(--green)' : 'var(--gray-300)'}}>
                                                    {kg !== null && kg > 0 ? Math.round(kg * 10) / 10 : '-'}
                                                </td>
                                            ))}
                                            <td style={{fontWeight:700, textAlign:'right'}}>{r.totalKg} kg</td>
                                            <td style={{color:'var(--gold)', fontWeight:700, textAlign:'right'}}>{Math.round(r.totalPrime)} DH</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Panel>

                    {/* ===== COMPARAISON EXCEL BEE ONE ===== */}
                    {showCompare && excelCompare && (() => {
                        const excelJours = excelCompare.jours; // [16, 17, ..., 30]
                        // Build Firebase data map: matricule -> { kgParJour, primeParJour, totalKg, totalPrime }
                        const fbMap = {};
                        // Determine the month/year from joursLabels (e.g. "2026-04-16")
                        const periodeMonth = joursLabels.length > 0 ? joursLabels[0].substring(0, 8) : '2026-04-'; // "YYYY-MM-"
                        const moisLabel = periodeMonth.substring(5, 7); // "04"
                        workerDayEntries.forEach(e => {
                            const mat = (e.matricule || '').toUpperCase().trim();
                            if (!mat) return;
                            const dayNum = parseInt(e.jour.split('-')[2]);
                            if (!fbMap[mat]) fbMap[mat] = { nom: e.nom, variete: e.variete, kgParJour: {}, primeParJour: {}, totalKg: 0, totalPrime: 0 };
                            fbMap[mat].kgParJour[dayNum] = (fbMap[mat].kgParJour[dayNum] || 0) + (e.kg || 0);
                            fbMap[mat].primeParJour[dayNum] = (fbMap[mat].primeParJour[dayNum] || 0) + (e.prime || 0);
                            fbMap[mat].totalKg += (e.kg || 0);
                            fbMap[mat].totalPrime += (e.prime || 0);
                        });
                        // Merge all matricules
                        const allMats = new Set([...Object.keys(fbMap), ...excelCompare.workers.keys()]);
                        let rows = [];
                        let totFb = 0, totXl = 0, nbEcarts = 0;
                        const totParJourFb = {}, totParJourXl = {};
                        excelJours.forEach(d => { totParJourFb[d] = 0; totParJourXl[d] = 0; });

                        let totPrimeFb = 0, totPrimeXl = 0;
                        allMats.forEach(mat => {
                            const fb = fbMap[mat] || { nom: '', kgParJour: {}, primeParJour: {}, totalKg: 0, totalPrime: 0, variete: '' };
                            const xl = excelCompare.workers.get(mat) || { nom: '', kgParJour: {}, primeParJour: {}, totalKg: 0, totalPrime: 0, variete: '' };
                            const source = fbMap[mat] && excelCompare.workers.has(mat) ? 'both' : (fbMap[mat] ? 'fb_only' : 'xl_only');
                            const jours = excelJours.map(d => {
                                const kgFb = Math.round((fb.kgParJour[d] || 0) * 10) / 10;
                                const kgXl = Math.round((xl.kgParJour[d] || 0) * 10) / 10;
                                // Totaux par jour : uniquement ouvriers présents dans l'Excel
                                if (source !== 'fb_only') {
                                    totParJourFb[d] += kgFb;
                                    totParJourXl[d] += kgXl;
                                }
                                return { day: d, kgFb, kgXl, diff: Math.round((kgFb - kgXl) * 10) / 10 };
                            });
                            const totalFb = Math.round(jours.reduce((s, j) => s + j.kgFb, 0) * 10) / 10;
                            const totalXl = Math.round(jours.reduce((s, j) => s + j.kgXl, 0) * 10) / 10;
                            const totalDiff = Math.round((totalFb - totalXl) * 10) / 10;
                            if (source !== 'fb_only') { totFb += totalFb; totXl += totalXl; }
                            if (Math.abs(totalDiff) > 0.5) nbEcarts++;
                            const nom = fb.nom || xl.nom || '';
                            // Primes
                            const primeFb = Math.round((fb.totalPrime || 0) * 10) / 10;
                            const primeXl = Math.round((xl.totalPrime || 0) * 10) / 10;
                            const primeDiff = Math.round((primeFb - primeXl) * 10) / 10;
                            if (source !== 'fb_only') { totPrimeFb += primeFb; totPrimeXl += primeXl; }
                            rows.push({ mat, nom, variete: xl.variete || fb.variete || '', jours, totalFb, totalXl, totalDiff, primeFb, primeXl, primeDiff, source });
                        });
                        rows.sort((a, b) => Math.abs(b.primeDiff) - Math.abs(a.primeDiff));
                        const totalDiffGlobal = Math.round((totFb - totXl) * 10) / 10;
                        const totalPrimeDiffGlobal = Math.round((totPrimeFb - totPrimeXl) * 10) / 10;
                        const nbEcartsPrime = rows.filter(r => Math.abs(r.primeDiff) > 0.5 && r.source !== 'fb_only').length;

                        return (
                            <Panel title="Comparaison Firebase vs Excel — Kilos & Primes" icon="fa-scale-balanced" style={{border:'2px solid var(--orange)', background:'rgba(230,126,34,0.03)'}}>
                                <div className="kpi-grid" style={{marginBottom:16}}>
                                    <KPICard icon="fa-database" iconClass="blue" value={Math.round(totFb).toLocaleString('fr-FR') + ' kg'} label="Total Kg SmartBerry" />
                                    <KPICard icon="fa-file-excel" iconClass="green" value={Math.round(totXl).toLocaleString('fr-FR') + ' kg'} label="Total Kg Excel" />
                                    <KPICard icon="fa-arrows-left-right" iconClass={totalDiffGlobal > 0 ? 'green' : totalDiffGlobal < 0 ? 'orange' : 'blue'} value={(totalDiffGlobal > 0 ? '+' : '') + totalDiffGlobal.toLocaleString('fr-FR') + ' kg'} label="Écart Kg" />
                                    <KPICard icon="fa-triangle-exclamation" iconClass="orange" value={nbEcarts} label="Ouvriers Écart Kg" />
                                </div>
                                <div className="kpi-grid" style={{marginBottom:16}}>
                                    <KPICard icon="fa-coins" iconClass="blue" value={Math.round(totPrimeFb).toLocaleString('fr-FR') + ' DH'} label="Prime SmartBerry" />
                                    <KPICard icon="fa-coins" iconClass="green" value={Math.round(totPrimeXl).toLocaleString('fr-FR') + ' DH'} label="Prime Excel" />
                                    <KPICard icon="fa-arrows-left-right" iconClass={totalPrimeDiffGlobal > 0 ? 'green' : totalPrimeDiffGlobal < 0 ? 'orange' : 'blue'} value={(totalPrimeDiffGlobal > 0 ? '+' : '') + totalPrimeDiffGlobal.toLocaleString('fr-FR') + ' DH'} label="Écart Prime" />
                                    <KPICard icon="fa-triangle-exclamation" iconClass={nbEcartsPrime > 0 ? 'orange' : 'green'} value={nbEcartsPrime} label="Ouvriers Écart Prime" />
                                </div>

                                {/* Résumé par jour */}
                                <div style={{overflowX:'auto', marginBottom:16}}>
                                    <table className="data-table" style={{fontSize:11}}>
                                        <thead>
                                            <tr>
                                                <th style={{background:'var(--orange)',color:'white'}}>Source</th>
                                                {excelJours.map(d => <th key={d} style={{textAlign:'center', background:'var(--orange)',color:'white', minWidth:55}}>{d}/{moisLabel}</th>)}
                                                <th style={{textAlign:'right', background:'var(--orange)',color:'white'}}>Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td style={{fontWeight:600}}><i className="fa-solid fa-database" style={{marginRight:4,color:'var(--blue)'}}></i>Firebase</td>
                                                {excelJours.map(d => <td key={d} style={{textAlign:'center'}}>{Math.round(totParJourFb[d])}</td>)}
                                                <td style={{textAlign:'right',fontWeight:700}}>{Math.round(totFb)}</td>
                                            </tr>
                                            <tr>
                                                <td style={{fontWeight:600}}><i className="fa-solid fa-file-excel" style={{marginRight:4,color:'#27ae60'}}></i>Excel</td>
                                                {excelJours.map(d => <td key={d} style={{textAlign:'center'}}>{Math.round(totParJourXl[d])}</td>)}
                                                <td style={{textAlign:'right',fontWeight:700}}>{Math.round(totXl)}</td>
                                            </tr>
                                            <tr style={{background:'#fff3e0'}}>
                                                <td style={{fontWeight:700,color:'var(--orange)'}}><i className="fa-solid fa-arrows-left-right" style={{marginRight:4}}></i>Écart</td>
                                                {excelJours.map(d => {
                                                    const diff = Math.round((totParJourFb[d] - totParJourXl[d]) * 10) / 10;
                                                    return <td key={d} style={{textAlign:'center', fontWeight:600, color: diff > 0 ? 'var(--green)' : diff < 0 ? '#e74c3c' : 'var(--gray-400)'}}>{diff > 0 ? '+' : ''}{diff}</td>;
                                                })}
                                                <td style={{textAlign:'right',fontWeight:700,color: totalDiffGlobal > 0 ? 'var(--green)' : totalDiffGlobal < 0 ? '#e74c3c' : 'var(--gray-400)'}}>{totalDiffGlobal > 0 ? '+' : ''}{totalDiffGlobal}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                {/* Légende */}
                                <div style={{display:'flex', gap:16, marginBottom:12, fontSize:10, color:'var(--gray-500)'}}>
                                    <span><span style={{display:'inline-block',width:10,height:10,borderRadius:3,background:'#e8f5e9',marginRight:4}}></span>Firebase &gt; Excel</span>
                                    <span><span style={{display:'inline-block',width:10,height:10,borderRadius:3,background:'#ffebee',marginRight:4}}></span>Firebase &lt; Excel</span>
                                    <span><span style={{display:'inline-block',width:10,height:10,borderRadius:3,background:'#e3f2fd',marginRight:4}}></span>Uniquement Firebase</span>
                                    <span><span style={{display:'inline-block',width:10,height:10,borderRadius:3,background:'#fff3e0',marginRight:4}}></span>Uniquement Excel</span>
                                </div>

                                {/* Détail par ouvrier */}
                                <div style={{overflowX:'auto', maxHeight:600, overflowY:'auto'}}>
                                    <table className="data-table" style={{fontSize:10}}>
                                        <thead>
                                            <tr>
                                                <th style={{position:'sticky',left:0,background:'var(--berry)',zIndex:2,minWidth:80}}>Matricule</th>
                                                <th style={{minWidth:120}}>Nom</th>
                                                <th>Variété</th>
                                                {excelJours.map(d => (
                                                    <th key={d} style={{textAlign:'center', minWidth:80}}>{d}/{moisLabel}</th>
                                                ))}
                                                <th style={{textAlign:'right',minWidth:55}}>Kg SB</th>
                                                <th style={{textAlign:'right',minWidth:55}}>Kg XL</th>
                                                <th style={{textAlign:'right',minWidth:55}}>Écart Kg</th>
                                                <th style={{textAlign:'right',minWidth:55,background:'#fff3e0'}}>Prime SB</th>
                                                <th style={{textAlign:'right',minWidth:55,background:'#fff3e0'}}>Prime XL</th>
                                                <th style={{textAlign:'right',minWidth:55,background:'#fff3e0'}}>Écart Prime</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((r, i) => (
                                                <tr key={i} style={{background: r.source === 'fb_only' ? '#e3f2fd' : r.source === 'xl_only' ? '#fff3e0' : undefined}}>
                                                    <td style={{fontSize:9,fontFamily:'monospace',fontWeight:600,position:'sticky',left:0,background: r.source === 'fb_only' ? '#e3f2fd' : r.source === 'xl_only' ? '#fff3e0' : 'white',zIndex:1}}>{r.mat}</td>
                                                    <td style={{fontWeight:500,whiteSpace:'nowrap',fontSize:10}}>{r.nom}</td>
                                                    <td style={{fontSize:9,color:'var(--gray-400)'}}>{r.variete}</td>
                                                    {r.jours.map((j, ji) => (
                                                        <td key={ji} style={{textAlign:'center', padding:'2px 4px'}}>
                                                            {(j.kgFb > 0 || j.kgXl > 0) ? (
                                                                <div>
                                                                    <div style={{fontSize:9,color:'var(--blue)'}}>{j.kgFb || '-'}</div>
                                                                    <div style={{fontSize:9,color:'#27ae60'}}>{j.kgXl || '-'}</div>
                                                                    {j.diff !== 0 && <div style={{fontSize:9,fontWeight:700,color: j.diff > 0 ? 'var(--green)' : '#e74c3c'}}>{j.diff > 0 ? '+' : ''}{j.diff}</div>}
                                                                </div>
                                                            ) : <span style={{color:'var(--gray-300)'}}>-</span>}
                                                        </td>
                                                    ))}
                                                    <td style={{textAlign:'right',fontWeight:600,fontSize:10}}>{r.totalFb}</td>
                                                    <td style={{textAlign:'right',fontWeight:600,fontSize:10,color:'#27ae60'}}>{r.totalXl}</td>
                                                    <td style={{textAlign:'right',fontWeight:700,fontSize:10,color: r.totalDiff > 0 ? 'var(--green)' : r.totalDiff < 0 ? '#e74c3c' : 'var(--gray-400)'}}>{r.totalDiff > 0 ? '+' : ''}{r.totalDiff}</td>
                                                    <td style={{textAlign:'right',fontWeight:600,fontSize:10,color:'var(--blue)',background:'#fffbf0'}}>{r.primeFb}</td>
                                                    <td style={{textAlign:'right',fontWeight:600,fontSize:10,color:'#27ae60',background:'#fffbf0'}}>{r.primeXl}</td>
                                                    <td style={{textAlign:'right',fontWeight:700,fontSize:10,background:'#fffbf0',color: r.primeDiff > 0 ? 'var(--green)' : r.primeDiff < 0 ? '#e74c3c' : 'var(--gray-400)'}}>{r.primeDiff > 0 ? '+' : ''}{r.primeDiff}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{fontSize:10,color:'var(--gray-400)',marginTop:8,textAlign:'right'}}>
                                    {rows.length} ouvriers — {rows.filter(r=>r.source==='both').length} matchés, {rows.filter(r=>r.source==='fb_only').length} uniquement Firebase, {rows.filter(r=>r.source==='xl_only').length} uniquement Excel
                                </div>
                            </Panel>
                        );
                    })()}
                </div>
            );
        }

export { PrimesRecolteTab };
