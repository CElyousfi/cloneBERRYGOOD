/* Module: qualite | Déclaration(s): QualiteMarcheLocalTab */
import { Panel } from '../shared/Panel.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== QUALITE MARCHE LOCAL TAB (Bons + Nouveau Bon only) =====================
        function QualiteMarcheLocalTab({ data, userProfile }) {
            const [bons, setBons] = useState([]);
            const [loading, setLoading] = useState(true);
            const [view, setView] = useState('bons'); // 'bons', 'nouveau'
            const [selectedClient, setSelectedClient] = useState('');
            // Nouveau bon form
            const [newBon, setNewBon] = useState({ date: new Date().toISOString().split('T')[0], client: '', ferme: 'F5', designation: '', variete: '', quantiteKg: '', prixDH: '' });
            const [savingBon, setSavingBon] = useState(false);

            // Load bons only
            React.useEffect(() => {
                const loadAll = async () => {
                    setLoading(true);
                    let allBons = [];
                    try {
                        const prodBons = await loadBonsFromFirestore();
                        allBons = prodBons.filter(b => b.typeVente === 'Marché Local');
                    } catch(e) {}
                    try {
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const db = firebase.firestore();
                            const snap = await db.collection('bons_marche_local').orderBy('createdAt', 'desc').limit(500).get();
                            snap.forEach(doc => allBons.push({ id: doc.id, ...doc.data(), source: 'firestore' }));
                        }
                    } catch(e) {}
                    setBons(allBons);
                    setLoading(false);
                };
                loadAll();
            }, []);

            const allClients = [...new Set(bons.map(b => b.client).filter(Boolean))].sort();
            const filteredBons = selectedClient ? bons.filter(b => b.client === selectedClient) : bons;

            // Save new bon
            const handleSaveBon = async () => {
                const { date, client, ferme, designation, variete, quantiteKg, prixDH } = newBon;
                if (!client || !quantiteKg || !prixDH) { alert('Client, Quantité et Prix sont requis'); return; }
                setSavingBon(true);
                const kg = parseFloat(quantiteKg) || 0;
                const prix = parseFloat(prixDH) || 0;
                const total = Math.round(kg * prix * 100) / 100;

                // Check price decrease vs last bon for same client+designation
                const prevBons = bons.filter(b => b.client === client && (b.designation || '') === designation).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                const prevPrix = prevBons.length > 0 ? (parseFloat(prevBons[0].prixDH) || 0) : 0;
                const needsDGValidation = prevPrix > 0 && prix < prevPrix;

                const bonData = {
                    date, client, ferme, designation, variete,
                    poidsLot: kg, prixDH: prix, totalDH: total,
                    typeVente: 'Marché Local',
                    sousType: 'ECRT Vrac',
                    status: needsDGValidation ? 'en_attente_prix_dg' : 'valide',
                    source: 'manual',
                    createdBy: userProfile?.name || 'Qualité',
                    createdAt: new Date().toISOString(),
                };

                try {
                    if (typeof firebase !== 'undefined' && firebase.firestore) {
                        const db = firebase.firestore();
                        const docRef = await db.collection('bons_marche_local').add(bonData);
                        bonData.id = docRef.id;

                        // Create DG validation request if price decreased
                        if (needsDGValidation) {
                            await db.collection('marche_local_prix_validations').add({
                                bonId: docRef.id,
                                client, designation, date, ferme,
                                quantiteKg: kg,
                                newPrix: prix,
                                previousPrix: prevPrix,
                                totalDH: total,
                                status: 'en_attente',
                                requestedBy: userProfile?.name || 'Qualité',
                                requestedAt: new Date().toISOString(),
                                resolvedBy: null, resolvedAt: null, comment: '',
                            });
                            alert(`Prix en baisse (${prevPrix} → ${prix} DH). Demande de validation envoyée au DG.`);
                        }
                    }
                } catch(e) { console.error('Save bon:', e); }
                setBons(prev => [bonData, ...prev]);
                setNewBon({ date: new Date().toISOString().split('T')[0], client: '', ferme: 'F5', designation: '', variete: '', quantiteKg: '', prixDH: '' });
                setSavingBon(false);
                if (!needsDGValidation) setView('bons');
            };


            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement Marché Local...</div></div>;

            return (
                <div className="fade-in">
                    {/* Sub-nav */}
                    <div className="chip-group" style={{marginBottom:16}}>
                        {[
                            {v:'bons', l:'Liste Bons', icon:'fa-list'},
                            {v:'nouveau', l:'Nouveau Bon', icon:'fa-plus-circle'},
                        ].map(tab => (
                            <button key={tab.v} className={`chip c-berry ${view === tab.v ? 'active' : ''}`} onClick={() => setView(tab.v)} style={{padding:'7px 16px',fontSize:12}}>
                                <i className={`fa-solid ${tab.icon}`} style={{fontSize:11}}></i> {tab.l}
                            </button>
                        ))}
                    </div>

                    {/* ===== LISTE BONS ===== */}
                    {view === 'bons' && (
                        <div>
                            <div className="chip-group" style={{marginBottom:12}}>
                                <span className="chip-group-label">Client:</span>
                                {['Tous', ...allClients].map(c => (
                                    <button key={c} className={`chip c-berry ${(c === 'Tous' ? !selectedClient : selectedClient === c) ? 'active' : ''}`}
                                        onClick={() => setSelectedClient(c === 'Tous' ? '' : c)}>{c}</button>
                                ))}
                            </div>
                            <Panel title={`Bons Marché Local (${filteredBons.length})`} icon="fa-list">
                                <div style={{overflowX:'auto'}}>
                                <table className="data-table">
                                    <thead>
                                        <tr><th>Date</th><th>N° Bon</th><th>Client</th><th>Désignation</th><th>Kg</th><th>Prix (DH/kg)</th><th>Total (DH)</th><th>Statut</th></tr>
                                    </thead>
                                    <tbody>
                                        {filteredBons.sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 200).map((b, i) => (
                                            <tr key={i}>
                                                <td style={{whiteSpace:'nowrap'}}>{b.date}</td>
                                                <td>{b.bonApport || '-'}</td>
                                                <td style={{fontWeight:600}}>{b.client}</td>
                                                <td>{b.designation || b.blocLabel || '-'}</td>
                                                <td>{b.poidsLot}</td>
                                                <td style={{fontWeight:600, color:'var(--berry)'}}>{b.prixDH || '-'}</td>
                                                <td style={{fontWeight:700}}>{b.totalDH ? Math.round(b.totalDH).toLocaleString() : '-'}</td>
                                                <td>{b.status === 'en_attente_prix_dg' ? <span style={{background:'#fff3cd', color:'#856404', padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:600}}>En attente DG</span>
                                                   : b.status === 'rejete_dg' ? <span style={{background:'#f8d7da', color:'#721c24', padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:600}}>Rejeté</span>
                                                   : <span style={{background:'#d4edda', color:'#155724', padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:600}}>Validé</span>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            </Panel>
                        </div>
                    )}

                    {/* ===== NOUVEAU BON ===== */}
                    {view === 'nouveau' && (
                        <Panel title="Nouveau Bon Marché Local" icon="fa-plus-circle">
                            <div style={{maxWidth:600}}>
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16}}>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Date</label>
                                        <input type="date" value={newBon.date} onChange={e => setNewBon({...newBon, date: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Client</label>
                                        <select value={newBon.client} onChange={e => setNewBon({...newBon, client: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}}>
                                            <option value="">— Sélectionner —</option>
                                            {allClients.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Ferme</label>
                                        <select value={newBon.ferme} onChange={e => setNewBon({...newBon, ferme: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}}>
                                            <option value="F1">F1</option>
                                            <option value="F5">F5</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Variété</label>
                                        <input type="text" placeholder="Yazmin, Maravilla..." value={newBon.variete} onChange={e => setNewBon({...newBon, variete: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                    <div style={{gridColumn:'span 2'}}>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Désignation</label>
                                        <input type="text" placeholder="S10 YAZMIN MOTTE F5..." value={newBon.designation} onChange={e => setNewBon({...newBon, designation: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Quantité (kg)</label>
                                        <input type="number" step="0.1" value={newBon.quantiteKg} onChange={e => setNewBon({...newBon, quantiteKg: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Prix (DH/kg)</label>
                                        <input type="number" step="0.5" value={newBon.prixDH} onChange={e => setNewBon({...newBon, prixDH: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                </div>
                                {newBon.quantiteKg && newBon.prixDH && (
                                    <div style={{padding:12, background:'var(--gray-50)', borderRadius:10, marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                        <span style={{fontSize:13, fontWeight:600}}>Total:</span>
                                        <span style={{fontSize:20, fontWeight:800, color:'var(--berry)'}}>{(parseFloat(newBon.quantiteKg) * parseFloat(newBon.prixDH)).toFixed(2)} DH</span>
                                    </div>
                                )}
                                {(() => {
                                    if (newBon.client && newBon.designation && newBon.prixDH) {
                                        const prev = bons.filter(b => b.client === newBon.client && (b.designation || '') === newBon.designation).sort((a,b) => (b.date||'').localeCompare(a.date||''));
                                        if (prev.length > 0) {
                                            const prevPrix = parseFloat(prev[0].prixDH) || 0;
                                            const newPrix = parseFloat(newBon.prixDH) || 0;
                                            if (prevPrix > 0 && newPrix < prevPrix) {
                                                return <div style={{padding:10, background:'#fff3cd', borderRadius:8, marginBottom:12, fontSize:12, color:'#856404', border:'1px solid #ffc107'}}>
                                                    <i className="fa-solid fa-triangle-exclamation"></i> <strong>Baisse de prix détectée :</strong> {prevPrix} DH → {newPrix} DH. Ce bon nécessitera la validation du DG.
                                                </div>;
                                            }
                                        }
                                    }
                                    return null;
                                })()}
                                <button onClick={handleSaveBon} disabled={savingBon} style={{padding:'10px 28px', borderRadius:22, background:'var(--berry)', color:'#fff', border:'none', fontWeight:700, fontSize:14, cursor:'pointer', opacity: savingBon ? 0.6 : 1}}>
                                    {savingBon ? 'Enregistrement...' : 'Enregistrer le Bon'}
                                </button>
                            </div>
                        </Panel>
                    )}

                </div>
            );
        }

export { QualiteMarcheLocalTab };
