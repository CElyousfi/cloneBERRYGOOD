/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinanceMarcheLocalTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== FINANCE MARCHE LOCAL TAB (Situation Clients + Encaissements) =====================
        function FinanceMarcheLocalTab({ data, userProfile }) {
            const [bons, setBons] = useState([]);
            const [encaissements, setEncaissements] = useState([]);
            const [recapExcel, setRecapExcel] = useState([]);
            const [loading, setLoading] = useState(true);
            const [view, setView] = useState('situation'); // 'situation', 'encaissements', 'prix'
            const [clientDetail, setClientDetail] = useState(null);
            const [showCoherenceInfo, setShowCoherenceInfo] = useState(false);
            const [showEncForm, setShowEncForm] = useState(false);
            const [newEnc, setNewEnc] = useState({ date: new Date().toISOString().split('T')[0], client: '', montant: '', reference: '' });
            const [savingEnc, setSavingEnc] = useState(false);

            React.useEffect(() => {
                const loadAll = async () => {
                    setLoading(true);
                    let allBons = [], allEnc = [], recap = [];
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
                    try {
                        const resp = await fetch('/encaissements_local.json?t=' + Date.now(), { cache: 'no-store' });
                        if (resp.ok) allEnc = await resp.json();
                    } catch(e) {}
                    try {
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const db = firebase.firestore();
                            const snap = await db.collection('encaissements_local').orderBy('date', 'desc').limit(200).get();
                            snap.forEach(doc => allEnc.push({ id: doc.id, ...doc.data(), source: 'firestore' }));
                        }
                    } catch(e) {}
                    try {
                        const resp = await fetch('/recap_solde_clients.json?t=' + Date.now(), { cache: 'no-store' });
                        if (resp.ok) recap = await resp.json();
                    } catch(e) {}
                    setBons(allBons);
                    setEncaissements(allEnc);
                    setRecapExcel(recap);
                    setLoading(false);
                };
                loadAll();
            }, []);

            const situation = React.useMemo(() => {
                const clients = {};
                bons.forEach(b => {
                    const c = (b.client || '').trim();
                    if (!c) return;
                    if (!clients[c]) clients[c] = { client: c, ca: 0, nbBons: 0, totalKg: 0, enc: 0 };
                    clients[c].ca += parseFloat(b.totalDH) || 0;
                    clients[c].nbBons++;
                    clients[c].totalKg += parseFloat(b.poidsLot) || 0;
                });
                encaissements.forEach(e => {
                    const c = (e.client || '').trim();
                    if (!c) return;
                    if (!clients[c]) clients[c] = { client: c, ca: 0, nbBons: 0, totalKg: 0, enc: 0 };
                    clients[c].enc += parseFloat(e.montant) || 0;
                });
                return Object.values(clients).map(c => {
                    c.solde = c.ca - c.enc;
                    const recap = recapExcel.find(r => r.client.trim() === c.client.trim());
                    c.recapCA = recap ? recap.caCumule : null;
                    c.recapEnc = recap ? recap.encaissementsCumule : null;
                    c.recapSolde = recap ? recap.solde : null;
                    c.categorie = recap ? recap.categorie : '';
                    c.coherent = recap ? (Math.abs(c.ca - recap.caCumule) < 1 && Math.abs(c.enc - recap.encaissementsCumule) < 1) : null;
                    return c;
                }).sort((a, b) => b.ca - a.ca);
            }, [bons, encaissements, recapExcel]);

            const allClients = [...new Set([...bons.map(b => b.client), ...encaissements.map(e => e.client)].filter(Boolean))].sort();
            const totalCA = situation.reduce((s, c) => s + c.ca, 0);
            const totalEnc = situation.reduce((s, c) => s + c.enc, 0);
            const totalSolde = totalCA - totalEnc;

            // Price dashboard: group by client+designation, show latest price + history
            const prixDashboard = React.useMemo(() => {
                const groups = {};
                const sorted = [...bons].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                sorted.forEach(b => {
                    const key = (b.client || '') + '||' + (b.designation || '');
                    if (!groups[key]) groups[key] = { client: b.client, designation: b.designation || '-', variete: b.variete || b.blocVariete || '', history: [] };
                    groups[key].history.push({ date: b.date, prix: parseFloat(b.prixDH) || 0, kg: parseFloat(b.poidsLot) || 0, status: b.status });
                });
                return Object.values(groups).map(g => {
                    const h = g.history;
                    const last = h[h.length - 1];
                    const prev = h.length >= 2 ? h[h.length - 2] : null;
                    return { ...g, lastPrix: last.prix, lastDate: last.date, prevPrix: prev ? prev.prix : null, trend: prev ? (last.prix > prev.prix ? 'up' : last.prix < prev.prix ? 'down' : 'stable') : 'new', nbVentes: h.length, totalKg: h.reduce((s, x) => s + x.kg, 0) };
                }).sort((a, b) => (a.client || '').localeCompare(b.client || '') || (a.designation || '').localeCompare(b.designation || ''));
            }, [bons]);

            const pendingDGCount = bons.filter(b => b.status === 'en_attente_prix_dg').length;

            const handleSaveEnc = async () => {
                const { date, client, montant, reference } = newEnc;
                if (!client || !montant) { alert('Client et Montant requis'); return; }
                setSavingEnc(true);
                const encData = {
                    date, client, montant: parseFloat(montant) || 0,
                    reference, source: 'manual',
                    createdAt: new Date().toISOString(),
                };
                try {
                    if (typeof firebase !== 'undefined' && firebase.firestore) {
                        const db = firebase.firestore();
                        const docRef = await db.collection('encaissements_local').add(encData);
                        encData.id = docRef.id;
                    }
                } catch(e) { console.error('Save enc:', e); }
                setEncaissements(prev => [encData, ...prev]);
                setNewEnc({ date: new Date().toISOString().split('T')[0], client: '', montant: '', reference: '' });
                setSavingEnc(false);
                setShowEncForm(false);
            };

            const exportExcel = () => {
                const wb = XLSX.utils.book_new();
                // Sheet 1: Situation par Client
                const sitRows = [['Client', 'Catégorie', 'Bons', 'Kg', 'CA Cumulé (DH)', 'Encaissements (DH)', 'Solde (DH)', 'Cohérence Excel']];
                situation.forEach(c => {
                    sitRows.push([c.client, c.categorie || '', c.nbBons, Math.round(c.totalKg), Math.round(c.ca), Math.round(c.enc), Math.round(c.solde), c.coherent === null ? '—' : c.coherent ? 'OK' : 'Écart']);
                });
                sitRows.push(['TOTAL', '', situation.reduce((s,c) => s + c.nbBons, 0), Math.round(situation.reduce((s,c) => s + c.totalKg, 0)), Math.round(totalCA), Math.round(totalEnc), Math.round(totalSolde), '']);
                const ws1 = XLSX.utils.aoa_to_sheet(sitRows);
                ws1['!cols'] = [{wch:22},{wch:18},{wch:8},{wch:10},{wch:16},{wch:18},{wch:14},{wch:16}];
                XLSX.utils.book_append_sheet(wb, ws1, 'Situation Clients');
                // Sheet 2: Détail Bons
                const bonRows = [['Client', 'Date', 'N° Bon', 'Désignation', 'Kg', 'Prix DH', 'Total DH', 'Ferme', 'Semaine']];
                [...bons].sort((a,b) => (a.client||'').localeCompare(b.client||'') || (b.date||'').localeCompare(a.date||'')).forEach(b => {
                    bonRows.push([b.client, b.date, b.bonApport || '', b.designation || b.blocLabel || '', b.poidsLot || '', b.prixDH || '', b.totalDH ? Math.round(b.totalDH) : '', b.ferme || '', b.semaine || '']);
                });
                const ws2 = XLSX.utils.aoa_to_sheet(bonRows);
                ws2['!cols'] = [{wch:22},{wch:12},{wch:10},{wch:20},{wch:8},{wch:10},{wch:12},{wch:8},{wch:14}];
                XLSX.utils.book_append_sheet(wb, ws2, 'Bons Apport');
                // Sheet 3: Encaissements
                const encRows = [['Client', 'Date', 'Montant DH', 'Référence', 'Semaine', 'Ferme']];
                [...encaissements].sort((a,b) => (a.client||'').localeCompare(b.client||'') || (b.date||'').localeCompare(a.date||'')).forEach(e => {
                    encRows.push([e.client, e.date, e.montant || 0, e.reference || e.bonNum || '', e.semaine || '', e.ferme || '']);
                });
                const ws3 = XLSX.utils.aoa_to_sheet(encRows);
                ws3['!cols'] = [{wch:22},{wch:12},{wch:14},{wch:14},{wch:14},{wch:8}];
                XLSX.utils.book_append_sheet(wb, ws3, 'Encaissements');
                XLSX.writeFile(wb, 'Marche_Local_' + new Date().toISOString().slice(0,10) + '.xlsx');
            };

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement Marché Local...</div></div>;

            return (
                <div className="fade-in">
                    <div style={{display:'flex', gap:6, marginBottom:16, flexWrap:'wrap', alignItems:'center'}}>
                        {[
                            {v:'situation', l:'Situation Clients', icon:'fa-users'},
                            {v:'prix', l:'Suivi Prix', icon:'fa-chart-line', badge: pendingDGCount},
                            {v:'encaissements', l:'Encaissements', icon:'fa-money-bill-wave'},
                        ].map(tab => (
                            <button key={tab.v} className={`chip c-berry ${view === tab.v ? 'active' : ''}`} onClick={() => setView(tab.v)} style={{padding:'7px 16px',fontSize:12,position:'relative'}}>
                                <i className={`fa-solid ${tab.icon}`} style={{fontSize:11}}></i> {tab.l}
                                {tab.badge > 0 && <span style={{position:'absolute',top:-4,right:-4,background:'var(--red)',color:'#fff',borderRadius:'50%',width:16,height:16,fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{tab.badge}</span>}
                            </button>
                        ))}
                        <button onClick={exportExcel} style={{marginLeft:'auto', padding:'8px 16px', borderRadius:22, fontSize:12, fontWeight:600, cursor:'pointer', border:'1.5px solid #217346', background:'#fff', color:'#217346', display:'flex', alignItems:'center', gap:6, transition:'all 0.2s'}}
                            onMouseEnter={e => { e.currentTarget.style.background='#217346'; e.currentTarget.style.color='#fff'; }}
                            onMouseLeave={e => { e.currentTarget.style.background='#fff'; e.currentTarget.style.color='#217346'; }}>
                            <i className="fa-solid fa-file-excel" style={{fontSize:13}}></i> Exporter Excel
                        </button>
                    </div>

                    {view === 'situation' && (
                        <div>
                            <div className="kpi-grid" style={{marginBottom:20}}>
                                <KPICard icon="fa-coins" iconClass="berry" value={`${Math.round(totalCA).toLocaleString()} DH`} label="CA Cumulé" />
                                <KPICard icon="fa-money-bill-transfer" iconClass="green" value={`${Math.round(totalEnc).toLocaleString()} DH`} label="Encaissements" />
                                <KPICard icon="fa-scale-balanced" iconClass={totalSolde > 0 ? 'orange' : 'blue'} value={`${Math.round(totalSolde).toLocaleString()} DH`} label="Solde Global" />
                                <KPICard icon="fa-users" iconClass="blue" value={situation.length} label="Clients actifs" />
                            </div>

                                <Panel title="Situation par Client" icon="fa-users">
                                    <div style={{overflowX:'auto'}}>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Client</th>
                                                <th>Catégorie</th>
                                                <th>Bons</th>
                                                <th>Kg</th>
                                                <th>CA Cumulé (DH)</th>
                                                <th>Encaissements (DH)</th>
                                                <th>Solde (DH)</th>
                                                <th style={{cursor:'pointer'}} onClick={() => setShowCoherenceInfo(true)}>Cohérence Excel <i className="fa-solid fa-circle-info" style={{color:'var(--gray-400)', fontSize:10, marginLeft:2}}></i></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {situation.map((c, i) => (
                                                <tr key={i} onClick={() => setClientDetail(c.client)} style={{background: c.solde > 100 ? '#fff5f5' : c.solde < -100 ? '#f0fff4' : '', cursor:'pointer', transition:'background 0.15s'}}>
                                                    <td style={{fontWeight:700}}>{c.client}</td>
                                                    <td style={{fontSize:11, color:'var(--gray-500)'}}>{c.categorie || '-'}</td>
                                                    <td>{c.nbBons}</td>
                                                    <td>{Math.round(c.totalKg).toLocaleString()}</td>
                                                    <td style={{fontWeight:600}}>{Math.round(c.ca).toLocaleString()}</td>
                                                    <td style={{fontWeight:600, color:'#27ae60'}}>{Math.round(c.enc).toLocaleString()}</td>
                                                    <td style={{fontWeight:700, color: c.solde > 0 ? '#e74c3c' : c.solde < 0 ? '#27ae60' : 'var(--gray-600)'}}>
                                                        {Math.round(c.solde).toLocaleString()}
                                                    </td>
                                                    <td style={{textAlign:'center'}}>
                                                        {c.coherent === null ? <span style={{color:'var(--gray-300)'}}>—</span>
                                                         : c.coherent ? <i className="fa-solid fa-circle-check" style={{color:'#27ae60'}}></i>
                                                         : <span title={`Excel CA: ${c.recapCA}, Enc: ${c.recapEnc}`}><i className="fa-solid fa-triangle-exclamation" style={{color:'#e67e22'}}></i></span>}
                                                    </td>
                                                </tr>
                                            ))}
                                            <tr style={{background:'var(--gray-50)', fontWeight:700}}>
                                                <td>TOTAL</td>
                                                <td></td>
                                                <td>{situation.reduce((s,c) => s + c.nbBons, 0)}</td>
                                                <td>{Math.round(situation.reduce((s,c) => s + c.totalKg, 0)).toLocaleString()}</td>
                                                <td>{Math.round(totalCA).toLocaleString()}</td>
                                                <td style={{color:'#27ae60'}}>{Math.round(totalEnc).toLocaleString()}</td>
                                                <td style={{color: totalSolde > 0 ? '#e74c3c' : '#27ae60'}}>{Math.round(totalSolde).toLocaleString()}</td>
                                                <td></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                    </div>
                                </Panel>

                            {/* Popup Détail Client */}
                            {clientDetail && (() => {
                                const clientBons = bons.filter(b => b.client === clientDetail).sort((a,b) => (b.date||'').localeCompare(a.date||''));
                                const clientEnc = encaissements.filter(e => e.client === clientDetail).sort((a,b) => (b.date||'').localeCompare(a.date||''));
                                const clientInfo = situation.find(s => s.client === clientDetail);
                                return (
                                    <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:16}} onClick={() => setClientDetail(null)}>
                                        <div style={{background:'#fff', borderRadius:16, width:'95%', maxWidth:700, maxHeight:'85vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                            <div style={{padding:'16px 20px', borderBottom:'1px solid var(--gray-100)', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, background:'#fff', borderRadius:'16px 16px 0 0', zIndex:1}}>
                                                <div>
                                                    <h3 style={{margin:0, fontSize:16, fontWeight:700}}><i className="fa-solid fa-user" style={{color:'var(--berry)', marginRight:8}}></i>{clientDetail}</h3>
                                                    {clientInfo && <span style={{fontSize:11, color:'var(--gray-500)'}}>{clientInfo.categorie || ''} — Solde: <b style={{color: clientInfo.solde > 0 ? '#e74c3c' : '#27ae60'}}>{Math.round(clientInfo.solde).toLocaleString()} DH</b></span>}
                                                </div>
                                                <button onClick={() => setClientDetail(null)} style={{background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--gray-400)', padding:4}}>
                                                    <i className="fa-solid fa-xmark"></i>
                                                </button>
                                            </div>
                                            <div style={{padding:'16px 20px'}}>
                                                <h4 style={{margin:'0 0 8px', fontSize:13, color:'var(--berry)', display:'flex', alignItems:'center', gap:6}}>
                                                    <i className="fa-solid fa-file-invoice"></i> Bons d'Apport ({clientBons.length})
                                                    {clientInfo && <span style={{marginLeft:'auto', fontSize:12, fontWeight:600, color:'var(--gray-600)'}}>CA: {Math.round(clientInfo.ca).toLocaleString()} DH — {Math.round(clientInfo.totalKg).toLocaleString()} Kg</span>}
                                                </h4>
                                                <div style={{overflowX:'auto', marginBottom:16}}>
                                                <table className="data-table" style={{fontSize:12}}>
                                                    <thead><tr><th>Date</th><th>N° Bon</th><th>Désignation</th><th>Kg</th><th>Prix DH</th><th>Total DH</th></tr></thead>
                                                    <tbody>
                                                        {clientBons.map((b, i) => (
                                                            <tr key={i}>
                                                                <td>{b.date}</td>
                                                                <td>{b.bonApport || '-'}</td>
                                                                <td>{b.designation || b.blocLabel || '-'}</td>
                                                                <td>{b.poidsLot}</td>
                                                                <td style={{fontWeight:600}}>{b.prixDH || '-'}</td>
                                                                <td style={{fontWeight:600, color:'var(--berry)'}}>{b.totalDH ? Math.round(b.totalDH).toLocaleString() : '-'}</td>
                                                            </tr>
                                                        ))}
                                                        {clientBons.length === 0 && <tr><td colSpan={6} style={{textAlign:'center', color:'var(--gray-400)', padding:12}}>Aucun bon</td></tr>}
                                                    </tbody>
                                                </table>
                                                </div>
                                                <h4 style={{margin:'0 0 8px', fontSize:13, color:'#27ae60', display:'flex', alignItems:'center', gap:6}}>
                                                    <i className="fa-solid fa-money-bill-transfer"></i> Encaissements ({clientEnc.length})
                                                    {clientInfo && <span style={{marginLeft:'auto', fontSize:12, fontWeight:600, color:'var(--gray-600)'}}>Total: {Math.round(clientInfo.enc).toLocaleString()} DH</span>}
                                                </h4>
                                                <div style={{overflowX:'auto'}}>
                                                <table className="data-table" style={{fontSize:12}}>
                                                    <thead><tr><th>Date</th><th>Montant DH</th><th>Référence</th></tr></thead>
                                                    <tbody>
                                                        {clientEnc.map((e, i) => (
                                                            <tr key={i}>
                                                                <td>{e.date}</td>
                                                                <td style={{fontWeight:700, color:'#27ae60'}}>{Math.round(e.montant).toLocaleString()} DH</td>
                                                                <td>{e.reference || e.bonNum || '-'}</td>
                                                            </tr>
                                                        ))}
                                                        {clientEnc.length === 0 && <tr><td colSpan={3} style={{textAlign:'center', color:'var(--gray-400)', padding:12}}>Aucun encaissement</td></tr>}
                                                    </tbody>
                                                </table>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Popup Explication Cohérence Excel */}
                            {showCoherenceInfo && (
                                <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:16}} onClick={() => setShowCoherenceInfo(false)}>
                                    <div style={{background:'#fff', borderRadius:16, width:'95%', maxWidth:480, boxShadow:'0 20px 60px rgba(0,0,0,0.3)', overflow:'hidden'}} onClick={e => e.stopPropagation()}>
                                        <div style={{padding:'16px 20px', borderBottom:'1px solid var(--gray-100)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                            <h3 style={{margin:0, fontSize:15, fontWeight:700}}><i className="fa-solid fa-circle-info" style={{color:'var(--blue)', marginRight:8}}></i>Cohérence Excel</h3>
                                            <button onClick={() => setShowCoherenceInfo(false)} style={{background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--gray-400)', padding:4}}>
                                                <i className="fa-solid fa-xmark"></i>
                                            </button>
                                        </div>
                                        <div style={{padding:'16px 20px', fontSize:13, lineHeight:1.7, color:'var(--gray-700)'}}>
                                            <p style={{margin:'0 0 12px'}}>Cette colonne compare les totaux calculés automatiquement par le système avec les données du fichier Excel de référence <b>(recap_solde_clients)</b>.</p>
                                            <div style={{display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'#f0fff4', borderRadius:10, marginBottom:8}}>
                                                <i className="fa-solid fa-circle-check" style={{color:'#27ae60', fontSize:16}}></i>
                                                <div><b style={{color:'#27ae60'}}>Cohérent</b> — Le CA et les encaissements du système correspondent au fichier Excel (écart &lt; 1 DH).</div>
                                            </div>
                                            <div style={{display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'#fef9e7', borderRadius:10, marginBottom:8}}>
                                                <i className="fa-solid fa-triangle-exclamation" style={{color:'#e67e22', fontSize:16}}></i>
                                                <div><b style={{color:'#e67e22'}}>Écart détecté</b> — Les montants du système diffèrent de l'Excel. Survolez l'icône pour voir les valeurs Excel.</div>
                                            </div>
                                            <div style={{display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--gray-50)', borderRadius:10}}>
                                                <span style={{color:'var(--gray-300)', fontSize:16, fontWeight:700}}>—</span>
                                                <div><b style={{color:'var(--gray-500)'}}>Pas de données</b> — Ce client n'existe pas dans le fichier Excel de référence.</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ===== SUIVI PRIX ===== */}
                    {view === 'prix' && (
                        <div>
                            {pendingDGCount > 0 && (
                                <div style={{padding:'12px 16px',background:'rgba(255,193,7,0.1)',border:'1px solid rgba(255,193,7,0.3)',borderRadius:10,marginBottom:16,fontSize:12,display:'flex',alignItems:'center',gap:10}}>
                                    <i className="fa-solid fa-shield-halved" style={{fontSize:16,color:'#f39c12'}}></i>
                                    <div><strong>{pendingDGCount} bon(s)</strong> en attente de validation DG (baisse de prix détectée)</div>
                                </div>
                            )}
                            <Panel title={`Suivi Prix par Client & Désignation (${prixDashboard.length})`} icon="fa-chart-line">
                                <div style={{overflowX:'auto'}}>
                                <table className="data-table" style={{fontSize:12}}>
                                    <thead>
                                        <tr>
                                            <th>Client</th>
                                            <th>Désignation</th>
                                            <th>Variété</th>
                                            <th style={{textAlign:'center'}}>Ventes</th>
                                            <th style={{textAlign:'right'}}>Total Kg</th>
                                            <th style={{textAlign:'right'}}>Dernier Prix</th>
                                            <th style={{textAlign:'right'}}>Prix Préc.</th>
                                            <th style={{textAlign:'center'}}>Tendance</th>
                                            <th>Dernière Vente</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {prixDashboard.map((g, i) => (
                                            <tr key={i}>
                                                <td style={{fontWeight:600}}>{g.client}</td>
                                                <td>{g.designation}</td>
                                                <td style={{fontSize:11,color:'var(--gray-500)'}}>{g.variete || '-'}</td>
                                                <td style={{textAlign:'center'}}>{g.nbVentes}</td>
                                                <td style={{textAlign:'right'}}>{Math.round(g.totalKg).toLocaleString()}</td>
                                                <td style={{textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{g.lastPrix} DH</td>
                                                <td style={{textAlign:'right',color:'var(--gray-400)'}}>{g.prevPrix !== null ? g.prevPrix + ' DH' : '-'}</td>
                                                <td style={{textAlign:'center'}}>
                                                    {g.trend === 'up' ? <span style={{color:'var(--green)',fontWeight:600}}><i className="fa-solid fa-arrow-trend-up"></i></span>
                                                     : g.trend === 'down' ? <span style={{color:'var(--red)',fontWeight:600}}><i className="fa-solid fa-arrow-trend-down"></i></span>
                                                     : g.trend === 'stable' ? <span style={{color:'var(--gray-400)'}}><i className="fa-solid fa-minus"></i></span>
                                                     : <span style={{color:'var(--blue)',fontSize:10,fontWeight:600}}>Nouveau</span>}
                                                </td>
                                                <td style={{fontSize:11}}>{g.lastDate}</td>
                                            </tr>
                                        ))}
                                        {prixDashboard.length === 0 && <tr><td colSpan="9" style={{textAlign:'center',color:'var(--gray-400)',padding:20}}>Aucune donnée</td></tr>}
                                    </tbody>
                                </table>
                                </div>
                            </Panel>
                        </div>
                    )}

                    {view === 'encaissements' && (
                        <div>
                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                                <span></span>
                                <button onClick={() => setShowEncForm(!showEncForm)} style={{padding:'8px 18px', borderRadius:20, background:'#27ae60', color:'#fff', border:'none', fontWeight:700, fontSize:12, cursor:'pointer'}}>
                                    <i className="fa-solid fa-plus"></i> Nouvel Encaissement
                                </button>
                            </div>
                            {showEncForm && (
                                <Panel title="Nouvel Encaissement" icon="fa-money-bill-wave">
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12, maxWidth:600}}>
                                        <div>
                                            <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Client</label>
                                            <select value={newEnc.client} onChange={e => setNewEnc({...newEnc, client: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}}>
                                                <option value="">— Client —</option>
                                                {allClients.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Montant (DH)</label>
                                            <input type="number" value={newEnc.montant} onChange={e => setNewEnc({...newEnc, montant: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                        </div>
                                        <div>
                                            <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Date</label>
                                            <input type="date" value={newEnc.date} onChange={e => setNewEnc({...newEnc, date: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                        </div>
                                    </div>
                                    <div style={{marginBottom:12, maxWidth:400}}>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Référence / Note</label>
                                        <input type="text" value={newEnc.reference} onChange={e => setNewEnc({...newEnc, reference: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                    <button onClick={handleSaveEnc} disabled={savingEnc} style={{padding:'8px 22px', borderRadius:20, background:'#27ae60', color:'#fff', border:'none', fontWeight:700, fontSize:13, cursor:'pointer'}}>
                                        {savingEnc ? 'Enregistrement...' : 'Enregistrer'}
                                    </button>
                                </Panel>
                            )}
                            <Panel title={`Encaissements (${encaissements.length})`} icon="fa-money-bill-wave">
                                <div style={{overflowX:'auto'}}>
                                <table className="data-table">
                                    <thead><tr><th>Date</th><th>Client</th><th>Montant (DH)</th><th>Référence</th><th>Source</th></tr></thead>
                                    <tbody>
                                        {encaissements.sort((a,b) => (b.date||'').localeCompare(a.date||'')).map((e, i) => (
                                            <tr key={i}>
                                                <td style={{whiteSpace:'nowrap'}}>{e.date}</td>
                                                <td style={{fontWeight:600}}>{e.client}</td>
                                                <td style={{fontWeight:700, color:'#27ae60'}}>{Math.round(e.montant).toLocaleString()} DH</td>
                                                <td>{e.reference || e.bonNum || '-'}</td>
                                                <td style={{fontSize:10, color:'var(--gray-400)'}}>{e.source === 'firestore' || e.source === 'manual' ? 'Saisie' : 'Excel'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            </Panel>
                        </div>
                    )}
                </div>
            );
        }

export { FinanceMarcheLocalTab };
