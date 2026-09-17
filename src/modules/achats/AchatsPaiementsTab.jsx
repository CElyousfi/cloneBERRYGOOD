/* Module: achats | Déclaration(s): AchatsPaiementsTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ACHATS: PAIEMENTS TAB =====================
        function AchatsPaiementsTab({ currentProfile, profileData }) {
            const [factures, setFactures] = useState([]);
            const [loading, setLoading] = useState(true);
            const [virementsSent, setVirementsSent] = useState({});

            const statusLabels = { non_payee: 'Non payee', en_validation: 'En validation', validee_achats: 'Validee Achats', validee_finance: 'Validee Finance', validee_dg: 'Validee DG', payee: 'Payee' };
            const statusClass = (s) => { if (s === 'payee') return 'valide'; if (s === 'non_payee') return 'brouillon'; return 'en-attente'; };
            const steps = ['non_payee', 'en_validation', 'validee_achats', 'validee_finance', 'validee_dg', 'payee'];

            const loadFactures = () => {
                fetch('/api/stock?action=list-factures').then(r => r.json())
                    .then(json => { if (json.success) setFactures(json.factures || []); })
                    .catch(err => console.warn(err)).finally(() => setLoading(false));
            };
            useEffect(() => { loadFactures(); }, []);

            const handleValidateStep = (id, step) => {
                const label = step === 'achats' ? 'Valider (Achats)' : step === 'pay' ? 'Marquer comme payee' : 'Valider';
                if (!confirm(label + ' ?')) return;
                fetch('/api/stock?action=validate-facture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision: 'valide', step, validated_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => { if (json.success) { loadFactures(); window._refreshNotifications?.(); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur reseau'));
            };

            const handleCreateVirement = (f) => {
                const motif = prompt('Motif du virement (optionnel):', 'Paiement ' + (f.numero_facture || f.numero));
                if (motif === null) return;
                fetch('/api/stock?action=create-demande-virement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        facture_id: f.id, bdc_id: f.bdc_id || null,
                        fournisseur: { nom: f.fournisseur?.nom || '', ice: f.fournisseur?.ice || '', rib: '' },
                        montant_ttc: f.total_ttc, motif,
                        created_by: { profileId: currentProfile, name: profileData?.name || currentProfile },
                    }),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        setVirementsSent(prev => ({ ...prev, [f.id]: json.numero }));
                        alert('Demande de virement ' + json.numero + ' créée. En attente d\'approbation Finance.');
                    } else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur reseau'));
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            const pipeline = {};
            steps.forEach(s => { pipeline[s] = factures.filter(f => f.payment_status === s); });

            return (
                <div className="fade-in">
                    <h3 style={{margin:'0 0 16px'}}><i className="fa-solid fa-credit-card" style={{marginRight:8}}></i>Pipeline Paiements</h3>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:12,marginBottom:24}}>
                        {steps.map(s => (
                            <div key={s} style={{background:'#fff',border:'1px solid #eee',borderRadius:12,padding:16,textAlign:'center'}}>
                                <div style={{fontSize:28,fontWeight:800,color: s === 'payee' ? 'var(--green)' : s === 'non_payee' ? 'var(--gray-400)' : 'var(--berry)'}}>{pipeline[s].length}</div>
                                <div style={{fontSize:11,fontWeight:600,color:'#666'}}>{statusLabels[s]}</div>
                                <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>{pipeline[s].reduce((sum, f) => sum + (f.total_ttc || 0), 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</div>
                            </div>
                        ))}
                    </div>
                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>N°</th><th>Facture</th><th>Fournisseur</th><th>Total TTC</th><th>Statut</th><th>Paiement</th><th>Action</th></tr></thead>
                        <tbody>
                            {factures.filter(f => f.payment_status !== 'payee').map((f) => (
                                <tr key={f.id}>
                                    <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{f.numero}</td>
                                    <td style={{fontSize:12}}>{f.numero_facture}</td>
                                    <td style={{fontWeight:600}}>{f.fournisseur?.nom || '—'}</td>
                                    <td style={{fontWeight:700}}>{(f.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                    <td><span className={'status-badge ' + statusClass(f.payment_status)}>{statusLabels[f.payment_status] || f.payment_status}</span></td>
                                    <td>
                                        {f.mode_paiement === 'caisse' && <span className="status-badge en-attente" style={{fontSize:10}}><i className="fa-solid fa-cash-register" style={{marginRight:4}}></i>Caisse</span>}
                                        {(!f.mode_paiement || f.mode_paiement === 'virement_bancaire') && <span className="status-badge valide" style={{fontSize:10}}><i className="fa-solid fa-building-columns" style={{marginRight:4}}></i>Virement</span>}
                                    </td>
                                    <td style={{whiteSpace:'nowrap'}}>
                                        {f.payment_status === 'en_validation' && <button onClick={() => handleValidateStep(f.id, 'achats')} style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,fontWeight:600}}>Valider Achats</button>}
                                        {f.payment_status === 'validee_dg' && (!f.mode_paiement || f.mode_paiement === 'virement_bancaire') && !virementsSent[f.id] && (
                                            <button onClick={() => handleCreateVirement(f)} style={{background:'#1a73e8',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,fontWeight:600,marginRight:6}}>
                                                <i className="fa-solid fa-paper-plane" style={{marginRight:4}}></i>Demande virement
                                            </button>
                                        )}
                                        {virementsSent[f.id] && <span style={{fontSize:11,color:'var(--green)',fontWeight:600}}><i className="fa-solid fa-check" style={{marginRight:4}}></i>{virementsSent[f.id]}</span>}
                                        {f.payment_status === 'validee_dg' && f.mode_paiement === 'caisse' && <span style={{fontSize:11,color:'#888'}}>→ Traité par Caisse</span>}
                                        {f.payment_status === 'validee_dg' && (!f.mode_paiement || f.mode_paiement === 'virement_bancaire') && <button onClick={() => handleValidateStep(f.id, 'pay')} style={{background:'var(--green)',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,fontWeight:600,marginTop:4}}>Marquer payee</button>}
                                    </td>
                                </tr>
                            ))}
                            {factures.filter(f => f.payment_status !== 'payee').length === 0 && <tr><td colSpan="7" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucune facture en attente de paiement.</td></tr>}
                        </tbody>
                    </table></div>
                </div>
            );
        }

export { AchatsPaiementsTab };
