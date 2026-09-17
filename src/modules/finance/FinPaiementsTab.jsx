/* Module: finance | Déclaration(s): FinPaiementsTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== FINANCE: PAIEMENTS TAB =====================
        function FinPaiementsTab({ currentProfile, profileData }) {
            const [factures, setFactures] = useState([]);
            const [loading, setLoading] = useState(true);

            const statusLabels = { non_payee: 'Non payee', en_validation: 'En validation', validee_achats: 'Validee Achats', validee_finance: 'Validee Finance', validee_dg: 'Validee DG', payee: 'Payee' };

            const loadFactures = () => {
                fetch('/api/stock?action=list-factures').then(r => r.json())
                    .then(json => { if (json.success) setFactures(json.factures || []); })
                    .catch(err => console.warn(err)).finally(() => setLoading(false));
            };
            useEffect(() => { loadFactures(); }, []);

            const handleValidate = (id, step) => {
                if (!confirm('Valider cette etape ?')) return;
                fetch('/api/stock?action=validate-facture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision: 'valide', step, validated_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => { if (json.success) loadFactures(); else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur reseau'));
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            const pending = factures.filter(f => f.payment_status === 'validee_achats');
            const all = factures.filter(f => f.payment_status !== 'non_payee');

            return (
                <div className="fade-in">
                    <h3 style={{margin:'0 0 16px'}}><i className="fa-solid fa-check-double" style={{marginRight:8}}></i>Validation Paiements ({pending.length} en attente)</h3>
                    {pending.length > 0 && <div style={{marginBottom:24}}>
                        <h4 style={{fontSize:13,margin:'0 0 8px',color:'var(--berry)'}}>En attente de validation Finance</h4>
                        <div className="table-responsive"><table className="data-table">
                            <thead><tr><th>N°</th><th>Facture</th><th>Fournisseur</th><th>Total TTC</th><th>Action</th></tr></thead>
                            <tbody>
                                {pending.map((f) => (
                                    <tr key={f.id}>
                                        <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{f.numero}</td>
                                        <td style={{fontSize:12}}>{f.numero_facture}</td>
                                        <td style={{fontWeight:600}}>{f.fournisseur?.nom || '—'}</td>
                                        <td style={{fontWeight:700}}>{(f.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                        <td><button onClick={() => handleValidate(f.id, 'finance')} style={{background:'var(--green)',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,fontWeight:600}}>Valider Finance</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table></div>
                    </div>}
                    <h4 style={{fontSize:13,margin:'0 0 8px'}}>Toutes les factures en workflow</h4>
                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>N°</th><th>Facture</th><th>Fournisseur</th><th>Total TTC</th><th>Statut</th></tr></thead>
                        <tbody>
                            {all.map((f) => (
                                <tr key={f.id}>
                                    <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{f.numero}</td>
                                    <td style={{fontSize:12}}>{f.numero_facture}</td>
                                    <td style={{fontWeight:600}}>{f.fournisseur?.nom || '—'}</td>
                                    <td style={{fontWeight:700}}>{(f.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                    <td><span className={'status-badge ' + (f.payment_status === 'payee' ? 'valide' : 'en-attente')}>{statusLabels[f.payment_status] || f.payment_status}</span></td>
                                </tr>
                            ))}
                            {all.length === 0 && <tr><td colSpan="5" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucune facture soumise.</td></tr>}
                        </tbody>
                    </table></div>
                </div>
            );
        }

export { FinPaiementsTab };
