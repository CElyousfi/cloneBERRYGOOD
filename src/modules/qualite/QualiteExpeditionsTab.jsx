/* Module: qualite | Déclaration(s): QualiteExpeditionsTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== QUALITE EXPEDITIONS TAB =====================
        function QualiteExpeditionsTab({ data, applyVarietyMapping, varietyMapping, saveVarietyMapping, userProfile, currentProfile }) {
            const canSeeFinancials = ['finance', 'dg'].includes(currentProfile);
            const [showModal, setShowModal] = useState(false);
            const [showVarietySettings, setShowVarietySettings] = useState(false);
            const [filterStatus, setFilterStatus] = useState('');
            const [selectedFerme, setSelectedFerme] = useState('');
            const [selectedVariete, setSelectedVariete] = useState('');
            const [expeditionList, setExpeditionList] = useState(data.expeditions);
            const [firebaseExpeditions, setFirebaseExpeditions] = useState([]);
            const [loadingFb, setLoadingFb] = useState(true);
            const [selectedExp, setSelectedExp] = useState(null);
            const [formData, setFormData] = useState({ ferme: 'F1', parcelle: '', variete: '', conditionnement: '', colis: '', bonApport: '' });

            // Fetch expeditions from Firebase API
            React.useEffect(() => {
                cachedFetch('/api/email-analysis?action=expeditions&limit=2000')
                    .then(json => {
                        if (json.success && json.expeditions) {
                            setFirebaseExpeditions(json.expeditions);
                        }
                    })
                    .catch(err => console.warn('Could not load Firebase expeditions:', err))
                    .finally(() => setLoadingFb(false));
            }, []);

            const parcelleVarieteMap = {
                '172': 'Maravilla',
                '195': 'Reyna',
                'P1-Hass': 'Hass',
            };

            const parcelles = {
                'F1': ['172-R-01', '172-R-02', '172-R-03'],
                'F5': ['195-R-01', '195-R-02', '195-R-03'],
                'Avocatier': ['P1-Hass', 'P2-Hass B', 'P3-Fuerte']
            };

            const handleParcelleChange = (parcelle) => {
                const prefix = parcelle.substring(0, 3);
                const variete = parcelleVarieteMap[prefix] || 'Adelita';
                setFormData(prev => ({ ...prev, parcelle, variete }));
            };

            const handleSubmit = () => {
                if (!formData.colis || !formData.bonApport) {
                    alert('Veuillez remplir tous les champs');
                    return;
                }
                const newExp = {
                    id: `EXP-000${6578 + expeditionList.length}`,
                    date: new Date().toLocaleDateString('fr-FR'),
                    ferme: formData.ferme,
                    parcelle: formData.parcelle,
                    variete: formData.variete,
                    conditionnement: formData.conditionnement,
                    colis: parseInt(formData.colis),
                    poids: parseInt(formData.colis) * 1.5,
                    bonApport: formData.bonApport,
                    receiptId: null,
                    status: 'En cours de livraison',
                    pqScore: null,
                    ppFruit: null,
                    netPayable: null
                };
                setExpeditionList([newExp, ...expeditionList]);
                setShowModal(false);
                setFormData({ ferme: 'F1', parcelle: '', variete: '', conditionnement: '', colis: '', bonApport: '' });
            };

            // Ranch ID → Ferme mapping
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };

            // Merge: Firebase expeditions (from email) + local hardcoded ones
            const allExpeditions = React.useMemo(() => {
                const fbMapped = firebaseExpeditions.map(fb => ({
                    id: fb.id,
                    date: fb.date || fb.receivedDate || '',
                    ferme: ranchToFerme[fb.ranch] || fb.ranch || '-',
                    ranchName: fb.ranchName || '',
                    variete: applyVarietyMapping(fb.batchNumber, fb.variety),
                    originalVariety: fb.variety || '-',
                    item: fb.itemDescription || fb.item || '-',
                    colis: fb.batchQuantity || 0,
                    poids: fb.batchWeight || 0,
                    receiptId: fb.receiptId || '-',
                    batchNumber: fb.batchNumber || '-',
                    license: fb.license || '-',
                    inspectedDate: fb.inspectedDate || '',
                    status: fb.status || 'PFQ Reçu. Attente Brix',
                    pqScore: fb.pqScore || null,
                    pfqCondition: fb.pfqCondition != null ? fb.pfqCondition : null,
                    pfqApparence: fb.pfqApparence != null ? fb.pfqApparence : null,
                    pfqBrix: fb.pfqBrix != null ? fb.pfqBrix : null,
                    pfqTotal: fb.pfqBrix != null ? (fb.pfqCondition || 0) + (fb.pfqApparence || 0) + (fb.pfqBrix || 0) : (fb.pfqTotal != null ? fb.pfqTotal : null),
                    brix: fb.brix || null,
                    overallResult: fb.overallResult || null,
                    berryType: fb.berryTypeFr || fb.berryType || null,
                    conditionDefects: fb.conditionDefects || [],
                    appearanceDefects: fb.appearanceDefects || [],
                    totalDefectPoints: fb.totalDefectPoints || 0,
                    sampleSize: fb.sampleSize || null,
                    avgFruitsPerPunnet: fb.avgFruitsPerPunnet || null,
                    avgPunnetWeight: fb.avgPunnetWeight || null,
                    totalFruitInspected: fb.totalFruitInspected || null,
                    gsNet: fb.gsNet || null,
                    ppFruit: fb.ppFruit || null,
                    pricePerKg: fb.pricePerKg || null,
                    liquidationNumber: fb.liquidationNumber || null,
                    liquidationWeek: fb.liquidationWeek || null,
                    source: 'firebase',
                }));
                return [...fbMapped, ...expeditionList];
            }, [firebaseExpeditions, expeditionList]);

            // Ferme/Variété pill filters
            const ranchToFermeMap = { '200742': 'F1', '200876': 'F5' };
            const uniqueFermes = [...new Set(allExpeditions.map(e => e.ferme).filter(f => f && f !== '-'))].sort();
            const fermeFiltered = selectedFerme ? allExpeditions.filter(e => e.ferme === selectedFerme) : allExpeditions;
            const uniqueVarietes = [...new Set(fermeFiltered.map(e => e.variete).filter(v => v && v !== '-'))].sort();
            const activeVariete = selectedVariete || 'Toutes';

            let filtered = activeVariete !== 'Toutes' ? fermeFiltered.filter(e => e.variete === activeVariete) : fermeFiltered;
            if (filterStatus) filtered = filtered.filter(e => e.status === filterStatus);
            filtered = [...filtered].sort((a, b) => {
                const parseD = (d) => { const m = (d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/); return m ? new Date(m[3], m[1]-1, m[2], m[4], m[5]).getTime() : 0; };
                return parseD(b.date) - parseD(a.date);
            });

            const statCounts = {
                total: filtered.length,
                enCours: filtered.filter(e => e.status === 'En cours de livraison').length,
                pfqRecu: filtered.filter(e => e.status === 'PFQ Reçu. Attente Brix' || e.status === 'PFQ reçu').length,
                liquidee: filtered.filter(e => e.status === 'Liquidée').length
            };

            const fbFiltered = filtered.filter(e => e.source === 'firebase');
            const fbCount = fbFiltered.length;
            const passCount = fbFiltered.filter(e => e.overallResult === 'PASS').length;
            const failCount = fbFiltered.filter(e => e.overallResult === 'FAIL' || e.overallResult === 'REJECT').length;

            return (
                <div className="fade-in">
                    <div className="kpi-grid">
                        <KPICard icon="fa-truck" iconClass="berry" value={statCounts.total} label="Total Expéditions" />
                        <KPICard icon="fa-clipboard-check" iconClass="orange" value={statCounts.pfqRecu} label="Attente Brix" />
                        <KPICard icon="fa-coins" iconClass="silver" value={statCounts.liquidee} label="Liquidées" />
                        <KPICard icon="fa-weight-scale" iconClass="green" value={`${Math.round(filtered.filter(e => e.overallResult !== 'REJECT').reduce((s,e) => s + (e.poids || 0), 0))} kg`} label="Production (hors rejet)" />
                        {failCount > 0 && <KPICard icon="fa-ban" iconClass="red" value={`${failCount} (${Math.round(filtered.filter(e => e.overallResult === 'REJECT' || e.overallResult === 'FAIL').reduce((s,e) => s + (e.poids || 0), 0))} kg)`} label="Fail / Reject" />}
                    </div>

                    {fbCount > 0 && (
                        <div style={{background:'var(--blue-pale)', border:'1px solid rgba(52,152,219,0.2)', borderRadius:10, padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
                            <i className="fa-solid fa-envelope-open-text" style={{color:'var(--blue)', fontSize:16}}></i>
                            <span style={{fontSize:13, fontWeight:600, color:'var(--blue)'}}>{fbCount} rapport(s) qualité Driscoll's reçu(s) par email</span>
                            <span style={{fontSize:12, color:'var(--green)', fontWeight:600}}><i className="fa-solid fa-check-circle"></i> {passCount} PASS</span>
                            {failCount > 0 && <span style={{fontSize:12, color:'var(--red)', fontWeight:600}}><i className="fa-solid fa-times-circle"></i> {failCount} FAIL/REJECT</span>}
                        </div>
                    )}

                    {loadingFb && (
                        <div style={{textAlign:'center', padding:12, color:'var(--gray-400)', fontSize:12}}>
                            <i className="fa-solid fa-spinner fa-spin"></i> Chargement des rapports qualité...
                        </div>
                    )}

                    <div style={{display:'flex', gap:16, marginBottom:16, flexWrap:'wrap', alignItems:'center'}}>
                        <div className="chip-group">
                            <span className="chip-group-label">Ferme:</span>
                            {['Toutes', ...uniqueFermes].map(f => (
                                <button key={f} className={`chip c-blue ${(f === 'Toutes' ? !selectedFerme : selectedFerme === f) ? 'active' : ''}`}
                                    onClick={() => { setSelectedFerme(f === 'Toutes' ? '' : f); setSelectedVariete(''); }}>
                                    {f}
                                </button>
                            ))}
                        </div>
                        <div className="chip-group">
                            <span className="chip-group-label">Variété:</span>
                            {['Toutes', ...uniqueVarietes].map(v => (
                                <button key={v} className={`chip c-berry ${(v === 'Toutes' ? activeVariete === 'Toutes' : selectedVariete === v) ? 'active' : ''}`}
                                    onClick={() => setSelectedVariete(v === 'Toutes' ? '' : v)}>
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Variety mapping settings modal */}
                    {showVarietySettings && (() => {
                        // Extract unique batch codes from all expeditions
                        const batchCodes = {};
                        const codeToFerme = (code) => { const prefix = code.split('-')[0]; return prefix === '172' ? 'F1' : prefix === '195' ? 'F5' : '-'; };
                        allExpeditions.forEach(e => {
                            const bn = e.batchNumber || '';
                            if (!bn.includes('-')) return;
                            const parts = bn.split('-');
                            const code = parts[0].slice(-3) + '-' + parts[1].slice(0, 4);
                            if (!batchCodes[code]) batchCodes[code] = { code, originalVariety: e.originalVariety || e.variete, count: 0, examples: [], ferme: codeToFerme(code) };
                            batchCodes[code].count++;
                            if (batchCodes[code].examples.length < 2) batchCodes[code].examples.push(bn);
                        });
                        const codes = Object.values(batchCodes).sort((a, b) => a.code.localeCompare(b.code));

                        return (
                            <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', justifyContent:'center', alignItems:'center'}}
                                onClick={(e) => { if (e.target === e.currentTarget) setShowVarietySettings(false); }}>
                                <div style={{background:'#fff', borderRadius:16, padding:24, width:'90%', maxWidth:720, maxHeight:'80vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                                        <h3 style={{margin:0, fontSize:16}}><i className="fa-solid fa-tags" style={{marginRight:8, color:'var(--berry)'}}></i>Paramétrage des Variétés</h3>
                                        <button onClick={() => setShowVarietySettings(false)} style={{background:'none', border:'none', fontSize:18, cursor:'pointer', color:'var(--gray-400)'}}><i className="fa-solid fa-times"></i></button>
                                    </div>
                                    <p style={{fontSize:12, color:'var(--gray-500)', marginBottom:16}}>
                                        Associez un nom de variété à chaque code batch. Le code est extrait des 3 caractères avant et 4 après le tiret du Batch Number.
                                        Le nom sera appliqué à tous les onglets Qualité.
                                    </p>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr>
                                                <th>Code Batch</th>
                                                <th>Ferme</th>
                                                <th>Exemple</th>
                                                <th>Nb</th>
                                                <th>Nom Variété</th>
                                                <th>Superficie (ha)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {codes.map(c => (
                                                <tr key={c.code}>
                                                    <td style={{fontWeight:700, fontFamily:'monospace'}}>{c.code}</td>
                                                    <td><span className={`status-badge ${c.ferme==='F1'?'berry':'green'}`} style={{fontSize:10}}>{c.ferme}</span></td>
                                                    <td style={{fontSize:10, color:'var(--gray-400)'}}>{c.examples[0]}</td>
                                                    <td>{c.count}</td>
                                                    <td>
                                                        <input type="text"
                                                            defaultValue={varietyMapping[c.code] || c.originalVariety}
                                                            onBlur={(e) => {
                                                                const val = e.target.value.trim();
                                                                if (val && val !== c.originalVariety) {
                                                                    saveVarietyMapping({ ...varietyMapping, [c.code]: val });
                                                                } else if (!val || val === c.originalVariety) {
                                                                    const next = { ...varietyMapping };
                                                                    delete next[c.code];
                                                                    saveVarietyMapping(next);
                                                                }
                                                            }}
                                                            style={{width:'100%', padding:'4px 8px', borderRadius:6, border:'1.5px solid var(--gray-200)', fontSize:12, fontWeight:500}}
                                                        />
                                                    </td>
                                                    <td>
                                                        <input type="number" step="0.01" min="0"
                                                            defaultValue={varietyMapping[c.code + '_ha'] || ''}
                                                            placeholder="ha"
                                                            onBlur={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                const next = { ...varietyMapping };
                                                                if (!isNaN(val) && val > 0) {
                                                                    next[c.code + '_ha'] = val;
                                                                } else {
                                                                    delete next[c.code + '_ha'];
                                                                }
                                                                saveVarietyMapping(next);
                                                            }}
                                                            style={{width:70, padding:'4px 8px', borderRadius:6, border:'1.5px solid var(--gray-200)', fontSize:12, textAlign:'right'}}
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                            {codes.length === 0 && (
                                                <tr><td colSpan="6" style={{textAlign:'center', padding:16, color:'var(--gray-400)'}}>Aucun code batch trouvé</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                    <Panel title="Expéditions" icon="fa-truck" actions={
                        <button onClick={() => setShowVarietySettings(true)}
                            style={{background:'none', border:'1.5px solid var(--gray-200)', borderRadius:8, padding:'4px 12px', fontSize:11, cursor:'pointer', color:'var(--gray-500)', display:'flex', alignItems:'center', gap:6}}>
                            <i className="fa-solid fa-tags"></i> Variétés
                        </button>
                    }>
                        <div style={{overflowX:'auto'}}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Statut</th>
                                    <th>Date</th>
                                    <th>Receipt ID</th>
                                    <th>Batch Number</th>
                                    <th>Variété</th>
                                    <th>Item</th>
                                    <th>Ferme</th>
                                    <th>Colis</th>
                                    <th>Poids (kg)</th>
                                    <th>PFQ Total</th>
                                    <th>Condition</th>
                                    <th>Apparence</th>
                                    <th>Brix (Pts)</th>
                                    <th>Brix</th>
                                    {canSeeFinancials && <th>PP Fruit</th>}
                                    {canSeeFinancials && <th>GS Net</th>}
                                    <th>Résultat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((exp, i) => (
                                    <tr key={i} onClick={() => exp.source === 'firebase' ? setSelectedExp(exp) : null}
                                        style={{cursor: exp.source === 'firebase' ? 'pointer' : 'default', ...(exp.overallResult === 'REJECT' ? {background:'rgba(229,57,53,0.06)'} : {})}}
                                        onMouseOver={e => { if(exp.source === 'firebase') e.currentTarget.style.background= exp.overallResult === 'REJECT' ? 'rgba(229,57,53,0.12)' : 'rgba(139,34,82,0.04)'; }}
                                        onMouseOut={e => e.currentTarget.style.background= exp.overallResult === 'REJECT' ? 'rgba(229,57,53,0.06)' : ''}>
                                        <td>
                                            <span className={`status-badge ${exp.status === 'Liquidée' ? '' : exp.status === 'PFQ Brix reçu' ? 'active' : (exp.status === 'PFQ Reçu. Attente Brix' || exp.status === 'PFQ reçu') ? 'warning' : exp.status === 'Saisie manuelle' ? 'blue' : 'danger'}`} style={exp.status === 'Rejeté' || exp.overallResult === 'REJECT' ? {background:'#e53935',color:'#fff',fontWeight:700} : exp.status === 'Liquidée' ? {background:'linear-gradient(135deg, #9e9e9e, #bdbdbd)',color:'#fff',fontWeight:700} : exp.status === 'Annulée (doublon)' ? {background:'#757575',color:'#fff',fontWeight:700,textDecoration:'line-through'} : exp.status === 'Saisie manuelle' ? {background:'#e3f2fd',color:'#1565c0',fontWeight:700} : {}}>
                                                {exp.status === 'Rejeté' ? '✕ REJETÉ' : exp.status}
                                            </span>
                                        </td>
                                        <td>{exp.date}</td>
                                        <td style={{fontSize:11}}>{exp.receiptId || '-'}</td>
                                        <td style={{fontSize:11}}>{exp.batchNumber || '-'}</td>
                                        <td><strong>{exp.variete}</strong></td>
                                        <td>{exp.item || '-'}</td>
                                        <td><span style={{padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600, background:'var(--berry-pale)', color:'var(--berry)'}}>{exp.ferme}</span></td>
                                        <td><strong>{exp.colis}</strong></td>
                                        <td>{exp.poids}</td>
                                        <td style={{fontWeight:700}}>{exp.pfqTotal != null ? Math.round(exp.pfqTotal * 100) / 100 : '-'}</td>
                                        <td>{exp.pfqCondition != null ? exp.pfqCondition : '-'}</td>
                                        <td>{exp.pfqApparence != null ? exp.pfqApparence : '-'}</td>
                                        <td>{exp.pfqBrix != null ? Math.round(exp.pfqBrix * 100) / 100 : '-'}</td>
                                        <td>{exp.brix || '-'}</td>
                                        {canSeeFinancials && <td style={{fontWeight:600, color: exp.ppFruit ? 'var(--gray-800)' : 'var(--gray-300)'}}>{exp.ppFruit ? exp.ppFruit.toFixed(2) : '-'}</td>}
                                        {canSeeFinancials && <td style={{fontWeight:700, color: exp.gsNet ? 'var(--green)' : 'var(--gray-300)'}}>{exp.gsNet ? Math.round(exp.gsNet).toLocaleString() : '-'}</td>}
                                        <td>
                                            {exp.overallResult ? (
                                                <span style={{padding:'2px 8px', borderRadius:12, fontSize:11, fontWeight:700, display:'inline-block', whiteSpace:'nowrap',
                                                    background: exp.overallResult === 'PASS' ? 'var(--green-pale)' : (exp.overallResult === 'REJECT' ? '#e53935' : 'var(--red-pale)'),
                                                    color: exp.overallResult === 'PASS' ? 'var(--green)' : (exp.overallResult === 'REJECT' ? '#fff' : 'var(--red)')}}>
                                                    {exp.overallResult === 'REJECT' ? '✕ REJECT' : exp.overallResult}
                                                </span>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && !loadingFb && (
                                    <tr><td colSpan={canSeeFinancials ? 16 : 14} style={{textAlign:'center', padding:24, color:'var(--gray-400)', fontSize:13}}>
                                        <i className="fa-solid fa-inbox" style={{fontSize:24, display:'block', marginBottom:8}}></i>
                                        Aucune expédition. Les rapports qualité Driscoll's reçus par email apparaîtront ici automatiquement.
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                        </div>
                    </Panel>

                    {/* Rapport Inspection Qualité — style Driscoll's */}
                    {selectedExp && selectedExp.source === 'firebase' && (() => {
                        const _dfr3 = {'Decay':'Pourriture','Decay Mold':'Pourriture','Decay/Mold':'Pourriture','Wet Leaky':'Fruit saignant','Wet/Leaky':'Fruit saignant','Overripe':'Fruit trop mûr','Soft':'Fruit mou','Collapsed':'Fruit mou','Shriveled':'Fruit desséché','Weak Cells':'Cellules blanches','Sooty Mold':'Cladosporium','Yellow Rust':'Rouille jaune','Reversion':'Réversion','Insect/SWD':'Insecte/Drosophile','Wet/Bruising':'Meurtrissure humide','Dry Bruising':'Meurtrissure sèche','Mildew':'Mildiou','Green':'Immature','Size':'Calibre < 3g','Skin Damage':'Dégâts ravageurs','Broken':'Cassé','Malformed':'Déformation','Attached Calyx':'Avec pédoncule','Foreign Bodies':'Corps étrangers','Foreign bodies':'Corps étrangers','Bloom':'Bloom (pruine)','Stem Blossom':'Résidu floral','Condition':'Condition','Appearance':'Apparence'};
                        const trD3 = (n) => _dfr3[n] || n;
                        const _bfr3 = {'BLUE':'Myrtille','RASP':'Framboise','STRAW':'Fraise','BLACK':'Mûre'};
                        const berryFr3 = (t) => { if (!t) return '-'; for (const [k,v] of Object.entries(_bfr3)) if (t.toUpperCase().includes(k)) return v; return t; };
                        return (
                        <div className="modal-overlay" onClick={() => setSelectedExp(null)}>
                            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{maxWidth:720, maxHeight:'90vh', overflow:'auto', padding:0, borderRadius:12}}>
                                <div style={{background:'linear-gradient(135deg, #2d0a31 0%, #8B2252 100%)', padding:'20px 24px', color:'#fff', borderRadius:'12px 12px 0 0'}}>
                                    <div style={{fontSize:11, opacity:0.7, letterSpacing:1, marginBottom:4}}>DRISCOLL'S</div>
                                    <div style={{fontSize:20, fontWeight:300, fontStyle:'italic', marginBottom:12}}>Rapport d'Inspection Qualité</div>
                                    <div style={{display:'flex', alignItems:'center', gap:12}}>
                                        <span style={{padding:'4px 16px', borderRadius:6, fontSize:14, fontWeight:700,
                                            background: selectedExp.overallResult === 'PASS' ? '#4caf50' : '#e53935',
                                            color:'#fff'}}>
                                            {selectedExp.overallResult === 'PASS' ? '\u2714 CONFORME' : '\u2718 NON CONFORME'}
                                        </span>
                                        <span style={{fontSize:12, opacity:0.8}}>Inspection Initiale</span>
                                    </div>
                                </div>

                                <div style={{padding:'20px 24px'}}>
                                    {/* Info grid — 2 columns like the report */}
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:0, marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr'}}>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Fruit</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{berryFr3(selectedExp.berryType)}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Variété</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.variete}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Article</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.item || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12}}>Ferme</div>
                                            <div style={{padding:'8px 12px', fontSize:12}}>{selectedExp.ferme}{selectedExp.ranchName ? ` — ${selectedExp.ranchName}` : ''}</div>
                                        </div>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr', borderLeft:'1px solid #e0e0e0'}}>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Reçu</div>
                                            <div style={{padding:'8px 12px', fontSize:12, fontWeight:600, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.receiptId || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>N° Lot</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.batchNumber || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Licence</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.license || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Réception</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.date || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12}}>Inspecté</div>
                                            <div style={{padding:'8px 12px', fontSize:12}}>{selectedExp.inspectedDate || '-'}</div>
                                        </div>
                                    </div>

                                    {/* Tableau défauts */}
                                    {selectedExp.conditionDefects && selectedExp.conditionDefects.length > 0 && (
                                        <div style={{marginBottom:20}}>
                                            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                                                <thead>
                                                    <tr style={{background:'#f5f5f5'}}>
                                                        <th style={{padding:'8px 12px', textAlign:'left', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Attribut / Défaut</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Nb Fruits</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>%</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Points</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedExp.conditionDefects.map((d, j) => {
                                                        const isSummary = d.name === 'Condition' || d.name === 'Appearance';
                                                        return (
                                                            <tr key={j} style={{background: isSummary ? (d.name === 'Condition' ? '#e8f5e9' : '#fce4ec') : 'transparent'}}>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', fontWeight: isSummary ? 700 : 400}}>{trD3(d.name)}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.count || 0}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.percent != null ? d.percent.toFixed(1) + '%' : '0.0%'}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.points || ''}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {/* Saveur & Score PFQ */}
                                    <div style={{marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                        <div style={{background:'linear-gradient(135deg, #ce93d8, #ba68c8)', padding:'8px 16px', textAlign:'center', color:'#fff', fontWeight:700, fontSize:13}}>Saveur & Score PFQ</div>
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:0}}>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Degrés Brix</div>
                                                <div style={{fontSize:20, fontWeight:700, color:'#9C27B0'}}>{selectedExp.brixFromDQR != null ? selectedExp.brixFromDQR : (selectedExp.brix || '-')}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Points Brix</div>
                                                <div style={{fontSize:20, fontWeight:700, color: selectedExp.pfqBrix != null ? '#9C27B0' : '#ccc'}}>{selectedExp.pfqBrix != null ? selectedExp.pfqBrix.toFixed(1) : 'En attente'}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Condition + Apparence</div>
                                                <div style={{fontSize:20, fontWeight:700, color:'var(--dark)'}}>{((selectedExp.pfqCondition || 0) + (selectedExp.pfqApparence || 0)).toFixed(1)}</div>
                                                <div style={{fontSize:9, color:'#aaa'}}>{selectedExp.pfqCondition || 0} + {selectedExp.pfqApparence || 0}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', background: selectedExp.pfqBrix != null ? 'rgba(76,175,80,0.08)' : 'rgba(255,152,0,0.06)'}}>
                                                <div style={{fontSize:10, color:'#888'}}>PFQ Total</div>
                                                {(() => {
                                                    const total = selectedExp.pfqBrix != null
                                                        ? (selectedExp.pfqCondition || 0) + (selectedExp.pfqApparence || 0) + (selectedExp.pfqBrix || 0)
                                                        : (selectedExp.pfqTotal || null);
                                                    return <div style={{fontSize:20, fontWeight:700, color: total != null ? (total >= 70 ? '#4caf50' : '#e53935') : '#ccc'}}>{total != null ? total.toFixed(1) : '-'}</div>;
                                                })()}
                                                <div style={{fontSize:9, color: selectedExp.pfqBrix != null ? '#4caf50' : '#ff9800'}}>{selectedExp.pfqBrix != null ? 'Brix inclus' : 'Brix en attente'}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Batch details table */}
                                    <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:16}}>
                                        <thead>
                                            <tr style={{background:'#f5f5f5'}}>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Poids Lot (kg)</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Qté Lot</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Échantillon</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Moy. Fruits/Barq.</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Poids Moy. Barq.</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Total Fruits Insp.</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.poids || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.colis || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.sampleSize || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.avgFruitsPerPunnet || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.avgPunnetWeight || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.totalFruitInspected || '-'}</td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    {/* Bon d'Apport — Photo upload */}
                                    <div style={{marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                        <div style={{background:'linear-gradient(135deg, #1565c0, #1976d2)', padding:'10px 16px', color:'#fff', fontWeight:700, fontSize:13, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                            <span><i className="fa-solid fa-file-image" style={{marginRight:8}}></i>Bon d'Apport</span>
                                            <label style={{cursor:'pointer', background:'rgba(255,255,255,0.2)', padding:'4px 12px', borderRadius:6, fontSize:11}}>
                                                <i className="fa-solid fa-camera" style={{marginRight:4}}></i>Ajouter photo
                                                <input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={(e) => {
                                                    const file = e.target.files[0];
                                                    if (!file || !selectedExp.id) return;
                                                    const reader = new FileReader();
                                                    reader.onload = () => {
                                                        fetch('/api/email-analysis?action=upload-expedition-photo', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ expeditionId: selectedExp.id, image: reader.result, filename: file.name })
                                                        })
                                                        .then(r => r.json())
                                                        .then(json => {
                                                            if (json.success) {
                                                                alert('Photo uploadée !');
                                                                // Refresh expedition data
                                                                const updatedPhotos = [...(selectedExp.bonApportPhotos || []), { url: json.url, uploadedAt: new Date().toISOString(), filename: file.name }];
                                                                setSelectedExp(prev => ({...prev, bonApportPhotos: updatedPhotos}));
                                                            } else {
                                                                alert('Erreur: ' + (json.error || 'Upload échoué'));
                                                            }
                                                        })
                                                        .catch(err => alert('Erreur upload: ' + err.message));
                                                    };
                                                    reader.readAsDataURL(file);
                                                    e.target.value = '';
                                                }} />
                                            </label>
                                        </div>
                                        {selectedExp.bonApportPhotos && selectedExp.bonApportPhotos.length > 0 ? (
                                            <div style={{display:'flex', flexWrap:'wrap', gap:8, padding:12}}>
                                                {selectedExp.bonApportPhotos.map((photo, idx) => (
                                                    <a key={idx} href={photo.url} target="_blank" rel="noopener noreferrer" style={{display:'block', width:120, height:90, borderRadius:6, overflow:'hidden', border:'1px solid #e0e0e0'}}>
                                                        <img src={photo.url} alt={`Bon d'apport ${idx+1}`} style={{width:'100%', height:'100%', objectFit:'cover'}} />
                                                    </a>
                                                ))}
                                            </div>
                                        ) : (
                                            <div style={{padding:'16px', textAlign:'center', color:'#999', fontSize:12}}>
                                                <i className="fa-solid fa-image" style={{fontSize:24, display:'block', marginBottom:6, opacity:0.3}}></i>
                                                Aucune photo. Cliquez sur "Ajouter photo" pour scanner le bon d'apport.
                                            </div>
                                        )}
                                    </div>

                                    {/* Duplicate management */}
                                    {!selectedExp.manualImport && (
                                        <div style={{marginBottom:16, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                                            {!selectedExp.duplicateFlag ? (
                                                <button style={{background:'#fff3e0', color:'#e65100', border:'1px solid #ffcc80', padding:'6px 14px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer'}}
                                                    onClick={() => {
                                                        const reason = prompt('Raison du signalement doublon :');
                                                        if (!reason) return;
                                                        fetch('/api/email-analysis?action=update-expedition', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                expeditionId: selectedExp.id,
                                                                updates: {
                                                                    duplicateFlag: true,
                                                                    duplicateRequestedBy: 'Qualité',
                                                                    duplicateRequestedAt: new Date().toISOString(),
                                                                    duplicateReason: reason,
                                                                }
                                                            })
                                                        }).then(r => r.json()).then(json => {
                                                            if (json.success) {
                                                                setSelectedExp(prev => ({...prev, duplicateFlag: true, duplicateReason: reason, duplicateRequestedBy: 'Qualité', duplicateRequestedAt: new Date().toISOString()}));
                                                            }
                                                        });
                                                    }}>
                                                    <i className="fa-solid fa-copy" style={{marginRight:4}}></i>Signaler doublon
                                                </button>
                                            ) : (
                                                <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                                                    <span style={{background:'#fff3e0', color:'#e65100', padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:700}}>
                                                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>
                                                        Doublon signalé par {selectedExp.duplicateRequestedBy || 'Qualité'}
                                                    </span>
                                                    <span style={{fontSize:10, color:'#999'}}>{selectedExp.duplicateReason}</span>
                                                    {!selectedExp.duplicateCancelled && (
                                                        <button style={{background:'#e53935', color:'#fff', border:'none', padding:'6px 14px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer'}}
                                                            onClick={() => {
                                                                if (!confirm('Valider l\'annulation de cette expédition (doublon) ? Action DG.')) return;
                                                                fetch('/api/email-analysis?action=update-expedition', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({
                                                                        expeditionId: selectedExp.id,
                                                                        updates: {
                                                                            duplicateCancelled: true,
                                                                            duplicateValidatedBy: 'DG',
                                                                            duplicateValidatedAt: new Date().toISOString(),
                                                                            status: 'Annulée (doublon)',
                                                                        }
                                                                    })
                                                                }).then(r => r.json()).then(json => {
                                                                    if (json.success) {
                                                                        setSelectedExp(prev => ({...prev, duplicateCancelled: true, duplicateValidatedBy: 'DG', status: 'Annulée (doublon)'}));
                                                                    }
                                                                });
                                                            }}>
                                                            <i className="fa-solid fa-check" style={{marginRight:4}}></i>Valider annulation (DG)
                                                        </button>
                                                    )}
                                                    {selectedExp.duplicateCancelled && (
                                                        <span style={{background:'#e53935', color:'#fff', padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:700}}>
                                                            <i className="fa-solid fa-ban" style={{marginRight:4}}></i>Annulée — validé par {selectedExp.duplicateValidatedBy || 'DG'}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Liquidation section — confidentiel: Finance/DG/Admin uniquement */}
                                    {selectedExp.status === 'Liquidée' && canSeeFinancials && (
                                        <div style={{marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                            <div style={{background:'linear-gradient(135deg, #2e7d32, #43a047)', padding:'10px 16px', color:'#fff', fontWeight:700, fontSize:13, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                                <span><i className="fa-solid fa-coins" style={{marginRight:8}}></i>Liquidation{selectedExp.liquidationWeek ? ` — W${selectedExp.liquidationWeek}` : ''}</span>
                                                {selectedExp.liquidationNumber && <span style={{fontSize:11, opacity:0.8}}>{selectedExp.liquidationNumber}</span>}
                                            </div>
                                            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:0}}>
                                                <div style={{padding:'12px 16px', textAlign:'center', borderRight:'1px solid #e0e0e0', borderBottom:'1px solid #e0e0e0'}}>
                                                    <div style={{fontSize:10, color:'#888', marginBottom:2}}>PP Fruit (DH/kg)</div>
                                                    <div style={{fontSize:18, fontWeight:700, color:'var(--gray-800)'}}>{selectedExp.ppFruit ? selectedExp.ppFruit.toFixed(2) : '-'}</div>
                                                </div>
                                                <div style={{padding:'12px 16px', textAlign:'center', borderRight:'1px solid #e0e0e0', borderBottom:'1px solid #e0e0e0'}}>
                                                    <div style={{fontSize:10, color:'#888', marginBottom:2}}>GS Net (DH)</div>
                                                    <div style={{fontSize:18, fontWeight:700, color:'var(--green)'}}>{selectedExp.gsNet ? Math.round(selectedExp.gsNet).toLocaleString() : '-'}</div>
                                                </div>
                                                <div style={{padding:'12px 16px', textAlign:'center', borderBottom:'1px solid #e0e0e0'}}>
                                                    <div style={{fontSize:10, color:'#888', marginBottom:2}}>Prix/kg (DH)</div>
                                                    <div style={{fontSize:18, fontWeight:700, color:'var(--berry)'}}>{selectedExp.pricePerKg ? selectedExp.pricePerKg.toFixed(2) : (selectedExp.gsNet && selectedExp.poids ? (selectedExp.gsNet / selectedExp.poids).toFixed(2) : '-')}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{textAlign:'right'}}>
                                        <button className="btn-secondary" onClick={() => setSelectedExp(null)}>Fermer</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );})()}

                    <button className="fab-btn" onClick={() => setShowModal(true)} title="Nouvelle Expédition">
                        <i className="fa-solid fa-plus"></i>
                    </button>

                    {showModal && (
                        <div className="modal-overlay" onClick={() => setShowModal(false)}>
                            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                                <h2>Nouvelle Expédition</h2>
                                <div className="form-group">
                                    <label>Ferme</label>
                                    <select value={formData.ferme} onChange={(e) => { setFormData(prev => ({...prev, ferme: e.target.value, parcelle: '', variete: ''})); }}>
                                        <option value="F1">F1</option>
                                        <option value="F5">F5</option>
                                        <option value="Avocatier">Avocatier</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Parcelle</label>
                                    <select value={formData.parcelle} onChange={(e) => handleParcelleChange(e.target.value)}>
                                        <option value="">Sélectionner...</option>
                                        {(parcelles[formData.ferme] || []).map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Variété</label>
                                    <input type="text" value={formData.variete} readOnly />
                                </div>
                                <div className="form-group">
                                    <label>Conditionnement</label>
                                    <select value={formData.conditionnement} onChange={(e) => setFormData(prev => ({...prev, conditionnement: e.target.value}))}>
                                        <option value="">Sélectionner...</option>
                                        <option value="12x125g">12x125g</option>
                                        <option value="6x170g">6x170g</option>
                                        <option value="12x170g">12x170g</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>N° Colis</label>
                                    <input type="number" value={formData.colis} onChange={(e) => setFormData(prev => ({...prev, colis: e.target.value}))} />
                                </div>
                                <div className="form-group">
                                    <label>N° Bon d'Apport</label>
                                    <input type="text" value={formData.bonApport} onChange={(e) => setFormData(prev => ({...prev, bonApport: e.target.value}))} />
                                </div>
                                <div className="form-actions">
                                    <button className="btn-primary" onClick={handleSubmit}>Soumettre</button>
                                    <button className="btn-secondary" onClick={() => setShowModal(false)}>Annuler</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { QualiteExpeditionsTab };
