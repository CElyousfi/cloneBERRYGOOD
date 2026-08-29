/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinFacturesTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { buildFacturesWorkbook } from './buildFacturesWorkbook.jsx';

// ===================== FINANCE: FACTURES TAB =====================
        function FinFacturesTab({ currentProfile, profileData }) {
            const [factures, setFactures] = useState([]);
            const [loading, setLoading] = useState(true);
            const [detailFacture, setDetailFacture] = useState(null);
            const [filterCampaign, setFilterCampaign] = useState(''); // '' = toutes les campagnes
            const statusLabels = { non_payee: 'Non payée', en_validation: 'En validation', validee_achats: 'Validée Achats', validee_finance: 'Validée Finance', validee_dg: 'Validée DG', payee: 'Payée' };

            const loadFactures = () => {
                fetch('/api/stock?action=list-factures&payment_status=validee_achats').then(r => r.json())
                    .then(json => { if (json.success) setFactures(json.factures || []); })
                    .catch(err => console.warn(err)).finally(() => setLoading(false));
            };
            useEffect(() => { loadFactures(); }, []);

            const handleValidate = (id) => {
                if (!confirm('Valider cette facture (Finance) ?')) return;
                fetch('/api/stock?action=validate-facture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision: 'valide', step: 'finance', validated_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => { if (json.success) { alert('Facture validee'); loadFactures(); window._refreshNotifications?.(); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur reseau'));
            };

            const handleReject = (id) => {
                const reason = prompt('Motif du rejet:');
                if (reason === null) return;
                fetch('/api/stock?action=validate-facture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision: 'rejete', step: 'finance', comment: reason, validated_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => { if (json.success) { alert('Facture rejetee'); loadFactures(); window._refreshNotifications?.(); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur reseau'));
            };

            // Campagnes disponibles dérivées des dates des factures chargées (helper pur).
            const FE = window.FactureExportUtils || {};
            const campaigns = (FE.listAvailableCampaigns ? FE.listAvailableCampaigns(factures.map(f => f.date_facture)) : []);
            const visibleFactures = filterCampaign
                ? factures.filter(f => { const c = campaigns.find(c => String(c.year) === String(filterCampaign)); return c && FE.isWithinPeriod && FE.isWithinPeriod(f.date_facture, c.bounds.start, c.bounds.end); })
                : factures;

            const exportExcel = () => {
                const campLabel = filterCampaign ? (campaigns.find(c => String(c.year) === String(filterCampaign)) || {}).label : '';
                buildFacturesWorkbook(visibleFactures, { filterLabel: campLabel ? 'Validation-Finance / ' + campLabel : 'Validation-Finance' });
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <h3 style={{margin:0}}><i className="fa-solid fa-file-invoice" style={{marginRight:8}}></i>Factures en attente de validation Finance ({visibleFactures.length})</h3>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                            <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)} title="Filtrer par campagne agricole (juillet → juin)"
                                style={{padding:'6px 10px',borderRadius:8,border:'1.5px solid var(--berry)',background:'#fff',color:'var(--berry)',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                <option value="">Toutes les campagnes</option>
                                {campaigns.map(c => <option key={c.year} value={c.year}>{c.label}</option>)}
                            </select>
                            <button onClick={exportExcel} disabled={!visibleFactures.length} title="Exporter les factures affichées"
                                style={{padding:'8px 16px',borderRadius:8,fontSize:13,fontWeight:600,cursor:visibleFactures.length?'pointer':'not-allowed',border:'1.5px solid #217346',background:'#fff',color:'#217346',opacity:visibleFactures.length?1:0.5,display:'flex',alignItems:'center',gap:6}}>
                                <i className="fa-solid fa-file-excel"></i>Exporter Excel
                            </button>
                        </div>
                    </div>
                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>N°</th><th>Facture</th><th>BDC</th><th>Fournisseur</th><th>Total TTC</th><th>Ecarts</th><th>Scan</th><th>Actions</th></tr></thead>
                        <tbody>
                            {visibleFactures.map((f) => (
                                <tr key={f.id} onClick={() => setDetailFacture(f)} style={{cursor:'pointer'}} title="Voir le détail de la facture">
                                    <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{f.numero}</td>
                                    <td style={{fontSize:12}}>{f.numero_facture}</td>
                                    <td style={{fontSize:12}}>{f.bdc_numero}</td>
                                    <td style={{fontWeight:600}}>{f.fournisseur?.nom || '—'}</td>
                                    <td style={{fontWeight:700}}>{(f.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                    <td>{f.has_discrepancies ? <span className="status-badge rejete" style={{fontSize:10}}><i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>{(f.discrepancies||[]).length}</span> : <span style={{color:'var(--green)',fontSize:11}}><i className="fa-solid fa-check"></i> OK</span>}</td>
                                    <td onClick={(e) => e.stopPropagation()}>{window.ScanAttachmentButton ? <window.ScanAttachmentButton entityType="invoices" entityId={f.id} scanUrl={f.scan_url} scanPath={f.scan_path} uploadedBy={{ profileId: currentProfile, name: profileData?.name || currentProfile }} onUploaded={() => loadFactures()} compact /> : null}</td>
                                    <td style={{whiteSpace:'nowrap'}} onClick={(e) => e.stopPropagation()}>
                                        <button onClick={() => handleValidate(f.id)} title="Valider" style={{background:'none',border:'none',cursor:'pointer',color:'var(--green)',fontSize:14,marginRight:8}}><i className="fa-solid fa-circle-check"></i></button>
                                        <button onClick={() => handleReject(f.id)} title="Rejeter" style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:14}}><i className="fa-solid fa-circle-xmark"></i></button>
                                    </td>
                                </tr>
                            ))}
                            {visibleFactures.length === 0 && <tr><td colSpan="8" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucune facture en attente de validation Finance{filterCampaign ? ' pour cette campagne' : ''}.</td></tr>}
                        </tbody>
                    </table></div>

                    {detailFacture && window.FactureDetailPopup && (
                        <window.FactureDetailPopup facture={detailFacture} statusLabels={statusLabels} onClose={() => setDetailFacture(null)} />
                    )}
                </div>
            );
        }

export { FinFacturesTab };
