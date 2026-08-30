/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: achats | Déclaration(s): AchatsFacturesTab */
import { buildFacturesWorkbook } from '../finance/buildFacturesWorkbook.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

function AchatsFacturesTab({ currentProfile, profileData }) {
            const [factures, setFactures] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [bdcList, setBdcList] = useState([]);
            const [selectedBdc, setSelectedBdc] = useState(null);
            const [filterStatus, setFilterStatus] = useState('');
            const [filterCampaign, setFilterCampaign] = useState(''); // '' = toutes les campagnes
            const [detailFacture, setDetailFacture] = useState(null);
            const emptyItem = { article: '', quantite: '', unite: 'kg', prix_unitaire: '', taux_tva: 20 };
            const [form, setForm] = useState({ bdc_id: '', numero_facture: '', date_facture: '', items: [{ ...emptyItem }] });

            const statusLabels = { non_payee: 'Non payée', en_validation: 'En validation', validee_achats: 'Validée Achats', validee_finance: 'Validée Finance', validee_dg: 'Validée DG', payee: 'Payée' };
            const statusClass = (s) => { if (s === 'payee') return 'valide'; if (s === 'non_payee') return 'brouillon'; if (s?.startsWith('validee')) return 'en-attente'; return 'en-attente'; };

            const loadFactures = () => {
                const url = '/api/stock?action=list-factures' + (filterStatus ? '&payment_status=' + filterStatus : '');
                fetch(url).then(r => r.json()).then(json => { if (json.success) setFactures(json.factures || []); })
                    .catch(err => console.warn('Factures error:', err)).finally(() => setLoading(false));
            };
            useEffect(() => { loadFactures(); }, [filterStatus]);
            useEffect(() => { fetch('/api/stock?action=list-bdc').then(r => r.json()).then(json => { if (json.success) setBdcList((json.bdc || []).filter(b => ['valide_dg','envoye'].includes(b.status))); }).catch(() => {}); }, []);

            const selectBdc = (bdcId) => {
                const bdc = bdcList.find(b => b.id === bdcId);
                if (bdc) {
                    setSelectedBdc(bdc);
                    setForm({ ...form, bdc_id: bdcId, items: (bdc.items || []).map(it => ({ article: it.article, quantite: it.quantite || '', unite: it.unite || 'kg', prix_unitaire: it.prix_unitaire || '', taux_tva: it.taux_tva != null && it.taux_tva !== '' ? parseFloat(it.taux_tva) : 20 })) });
                }
            };

            const updateItem = (idx, field, value) => { const items = [...form.items]; items[idx] = { ...items[idx], [field]: value }; setForm({ ...form, items }); };
            const calcTotal = () => { let ht = 0, tva = 0; form.items.forEach(it => { const mht = (parseFloat(it.quantite) || 0) * (parseFloat(it.prix_unitaire) || 0); ht += mht; tva += mht * (it.taux_tva != null && it.taux_tva !== '' ? parseFloat(it.taux_tva) : 20) / 100; }); return { ht: Math.round(ht*100)/100, tva: Math.round(tva*100)/100, ttc: Math.round((ht+tva)*100)/100 }; };

            const handleCreate = () => {
                if (!form.bdc_id) { alert('Sélectionnez un BDC'); return; }
                if (!form.numero_facture.trim()) { alert('Numéro de facture fournisseur requis'); return; }
                const validItems = form.items.filter(i => i.article && i.quantite && i.prix_unitaire);
                if (!validItems.length) { alert('Ajoutez au moins un article complet'); return; }
                fetch('/api/stock?action=create-facture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...form, items: validItems, created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        let msg = 'Facture ' + json.numero + ' créée.';
                        if (json.has_discrepancies) msg += '\n\nATTENTION: Des écarts ont été détectés par rapport au BDC:\n' + json.discrepancies.map(d => '- ' + d.article + ': ' + d.type + ' (BDC: ' + d.bdc_value + ' / Facture: ' + d.facture_value + ')').join('\n');
                        alert(msg); setShowForm(false); loadFactures();
                    } else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            const handleSubmitPayment = (id) => {
                if (!confirm('Soumettre cette facture pour validation de paiement ?')) return;
                fetch('/api/stock?action=validate-facture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision: 'valide', step: 'submit', validated_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => { if (json.success) { loadFactures(); window._refreshNotifications?.(); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur réseau'));
            };

            const printFacture = (fac) => {
                const itemsHtml = (fac.items || []).map((it, i) => '<tr><td>'+(i+1)+'</td><td>'+it.article+'</td><td>'+it.quantite+' '+(it.unite||'')+'</td><td>'+(parseFloat(it.prix_unitaire)||0).toFixed(2)+'</td><td>'+it.taux_tva+'%</td><td>'+(parseFloat(it.montant_ht)||0).toFixed(2)+'</td><td>'+(parseFloat(it.montant_ttc)||0).toFixed(2)+'</td></tr>').join('');
                const discHtml = fac.has_discrepancies ? '<div style="background:#fff3cd;border:1px solid #ffc107;padding:12px;border-radius:8px;margin:16px 0"><strong>Ecarts detectes:</strong><ul style="margin:8px 0">'+(fac.discrepancies||[]).map(d => '<li>'+d.article+': '+d.type+' (BDC: '+d.bdc_value+' / Facture: '+d.facture_value+')</li>').join('')+'</ul></div>' : '';
                const html = '<html><head><title>Facture '+fac.numero+'</title><style>body{font-family:Inter,sans-serif;margin:40px;color:#333}h1{color:#8B2252;font-size:22px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:8px 12px;border:1px solid #ddd;text-align:left;font-size:13px}th{background:#f8f8f8;font-weight:600}.total{text-align:right;font-size:16px;font-weight:700;margin-top:10px}@media print{body{margin:20px}}</style></head><body><div style="display:flex;justify-content:space-between;margin-bottom:30px"><div><h1>FACTURE</h1><p><strong>'+fac.numero+'</strong> (Ref: '+fac.numero_facture+')</p><p>BDC: '+fac.bdc_numero+'</p><p>Date: '+(fac.date_facture||'')+'</p></div><div style="text-align:right"><p><strong>Fournisseur:</strong></p><p>'+(fac.fournisseur?.nom||'')+'</p><p>'+(fac.fournisseur?.ice?'ICE: '+fac.fournisseur.ice:'')+'</p></div></div>'+discHtml+'<table><thead><tr><th>#</th><th>Article</th><th>Quantite</th><th>PU (MAD)</th><th>TVA</th><th>HT</th><th>TTC</th></tr></thead><tbody>'+itemsHtml+'</tbody></table><div class="total"><p>Total HT: '+(fac.total_ht||0).toFixed(2)+' MAD</p><p>TVA: '+(fac.total_tva||0).toFixed(2)+' MAD</p><p style="font-size:18px;color:#8B2252">Total TTC: '+(fac.total_ttc||0).toFixed(2)+' MAD</p></div></body></html>';
                const w = window.open('', '_blank', 'width=900,height=700'); w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500);
            };

            const totals = calcTotal();

            // Campagnes disponibles dérivées des dates des factures chargées (helper pur).
            const FE = window.FactureExportUtils || {};
            const campaigns = (FE.listAvailableCampaigns ? FE.listAvailableCampaigns(factures.map(f => f.date_facture)) : []);
            // Filtre campagne côté client (ET avec le filtre statut déjà appliqué côté serveur).
            const visibleFactures = filterCampaign
                ? factures.filter(f => { const c = campaigns.find(c => String(c.year) === String(filterCampaign)); return c && FE.isWithinPeriod && FE.isWithinPeriod(f.date_facture, c.bounds.start, c.bounds.end); })
                : factures;

            const exportExcel = () => {
                const statusLabel = filterStatus ? (statusLabels[filterStatus] || filterStatus) : 'Toutes';
                const campLabel = filterCampaign ? (campaigns.find(c => String(c.year) === String(filterCampaign)) || {}).label : '';
                const filterLabel = campLabel ? statusLabel + ' / ' + campLabel : statusLabel;
                buildFacturesWorkbook(visibleFactures, { filterLabel });
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                            {['','non_payee','en_validation','validee_achats','validee_finance','validee_dg','payee'].map(s => (
                                <button key={s} className={`chip c-berry ${filterStatus === s ? 'active' : ''}`} onClick={() => setFilterStatus(s)}>
                                    {s ? statusLabels[s] || s : 'Toutes'}
                                </button>
                            ))}
                            <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)} title="Filtrer par campagne agricole (juillet → juin)"
                                style={{padding:'6px 10px',borderRadius:8,border:'1.5px solid var(--berry)',background:'#fff',color:'var(--berry)',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                <option value="">Toutes les campagnes</option>
                                {campaigns.map(c => <option key={c.year} value={c.year}>{c.label}</option>)}
                            </select>
                            <span style={{fontSize:12,color:'var(--gray-400)',fontWeight:600}}>{visibleFactures.length} facture{visibleFactures.length > 1 ? 's' : ''}</span>
                        </div>
                        <div style={{display:'flex',gap:8}}>
                            <button onClick={exportExcel} disabled={!visibleFactures.length} title="Exporter les factures affichées (selon le filtre actif)"
                                style={{padding:'8px 16px',borderRadius:8,fontSize:13,fontWeight:600,cursor:visibleFactures.length?'pointer':'not-allowed',border:'1.5px solid #217346',background:'#fff',color:'#217346',opacity:visibleFactures.length?1:0.5,display:'flex',alignItems:'center',gap:6}}>
                                <i className="fa-solid fa-file-excel"></i>Exporter Excel
                            </button>
                            <button onClick={() => { setSelectedBdc(null); setForm({ bdc_id: '', numero_facture: '', date_facture: '', items: [{ ...emptyItem }] }); setShowForm(true); }}
                                style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouvelle facture
                            </button>
                        </div>
                    </div>

                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>N° Interne</th><th>N° Facture</th><th>BDC</th><th>Fournisseur</th><th>Date</th><th>Total TTC</th><th>Ecarts</th><th>Scan</th><th>Paiement</th><th></th></tr></thead>
                        <tbody>
                            {visibleFactures.map((f) => (
                                <tr key={f.id} onClick={() => setDetailFacture(f)} style={{cursor:'pointer'}} title="Voir le détail de la facture">
                                    <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{f.numero}</td>
                                    <td style={{fontSize:12}}>{f.numero_facture}</td>
                                    <td style={{fontSize:12}}>{f.bdc_numero}</td>
                                    <td style={{fontWeight:600}}>{f.fournisseur?.nom || '—'}</td>
                                    <td style={{fontSize:12}}>{f.date_facture || '—'}</td>
                                    <td style={{fontWeight:700}}>{(f.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                    <td>{f.has_discrepancies ? <span className="status-badge rejete" style={{fontSize:10}}><i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>{(f.discrepancies||[]).length} ecart(s)</span> : <span style={{color:'var(--green)',fontSize:11}}><i className="fa-solid fa-check"></i></span>}</td>
                                    <td onClick={(e) => e.stopPropagation()}>{window.ScanAttachmentButton ? <window.ScanAttachmentButton entityType="invoices" entityId={f.id} scanUrl={f.scan_url} scanPath={f.scan_path} uploadedBy={{ profileId: currentProfile, name: profileData?.name || currentProfile }} onUploaded={() => loadFactures()} compact /> : null}</td>
                                    <td><span className={'status-badge ' + statusClass(f.payment_status)}>{statusLabels[f.payment_status] || f.payment_status}</span></td>
                                    <td style={{whiteSpace:'nowrap'}} onClick={(e) => e.stopPropagation()}>
                                        {f.payment_status === 'non_payee' && <button onClick={() => handleSubmitPayment(f.id)} title="Soumettre paiement" style={{background:'none',border:'none',cursor:'pointer',color:'var(--blue)',fontSize:13,marginRight:4}}><i className="fa-solid fa-paper-plane"></i></button>}
                                        <button onClick={() => printFacture(f)} title="Imprimer" style={{background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:13}}><i className="fa-solid fa-print"></i></button>
                                    </td>
                                </tr>
                            ))}
                            {visibleFactures.length === 0 && <tr><td colSpan="10" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucune facture{filterStatus ? ' avec ce statut' : ''}{filterCampaign ? ' pour cette campagne' : ''}.</td></tr>}
                        </tbody>
                    </table></div>

                    {showForm && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
                            <div className="modal-content" style={{maxWidth:750,maxHeight:'90vh',overflowY:'auto'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-file-invoice-dollar" style={{marginRight:8}}></i>Nouvelle Facture</h3>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>BDC *</label>
                                        <select value={form.bdc_id} onChange={e => selectBdc(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="">-- Selectionner un BDC --</option>
                                            {bdcList.map(b => <option key={b.id} value={b.id}>{b.numero} - {b.fournisseur?.nom || '?'} ({(b.total_ttc||0).toLocaleString()} MAD)</option>)}
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>N° Facture Fournisseur *</label>
                                        <input value={form.numero_facture} onChange={e => setForm({...form, numero_facture: e.target.value})} placeholder="N facture" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date facture</label>
                                        <input type="date" value={form.date_facture} onChange={e => setForm({...form, date_facture: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                </div>
                                {selectedBdc && <div style={{background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.2)',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:12,color:'#2c3e50'}}>
                                    <i className="fa-solid fa-circle-info" style={{marginRight:6,color:'var(--blue)'}}></i>
                                    BDC {selectedBdc.numero} — {selectedBdc.fournisseur?.nom} — {(selectedBdc.total_ttc||0).toLocaleString('fr-FR')} MAD TTC.
                                    Les articles du BDC ont ete pre-remplis. Modifiez si la facture differe.
                                </div>}

                                <h4 style={{fontSize:13,marginBottom:8}}>Articles</h4>
                                <div style={{overflowX:'auto'}}>
                                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                        <thead><tr style={{background:'#f8f8f8'}}><th style={{padding:'6px 8px',textAlign:'left'}}>Article</th><th style={{padding:'6px 8px',width:80}}>Qte</th><th style={{padding:'6px 8px',width:70}}>Unite</th><th style={{padding:'6px 8px',width:90}}>PU (MAD)</th><th style={{padding:'6px 8px',width:70}}>TVA %</th><th style={{padding:'6px 8px',width:100}}>Montant HT</th><th style={{width:30}}></th></tr></thead>
                                        <tbody>
                                            {form.items.map((it, idx) => { const mht = (parseFloat(it.quantite)||0)*(parseFloat(it.prix_unitaire)||0); return (
                                                <tr key={idx}><td><input value={it.article} onChange={e => updateItem(idx,'article',e.target.value)} placeholder="Article" style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                <td><input type="number" value={it.quantite} onChange={e => updateItem(idx,'quantite',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                <td><input value={it.unite} onChange={e => updateItem(idx,'unite',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                <td><input type="number" value={it.prix_unitaire} onChange={e => updateItem(idx,'prix_unitaire',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                <td><select value={it.taux_tva} onChange={e => updateItem(idx,'taux_tva',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}}>{[0,7,10,14,20].map(t => <option key={t} value={t}>{t}%</option>)}</select></td>
                                                <td style={{fontWeight:600,textAlign:'right',padding:'4px 8px'}}>{mht.toFixed(2)}</td>
                                                <td><button onClick={() => { if (form.items.length > 1) setForm({...form, items: form.items.filter((_,i) => i !== idx)}); }} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td></tr>
                                            ); })}
                                        </tbody>
                                    </table>
                                    <button onClick={() => setForm({...form, items: [...form.items, {...emptyItem}]})} style={{marginTop:8,background:'none',border:'1px dashed #ddd',borderRadius:8,padding:'6px 16px',cursor:'pointer',fontSize:12,color:'var(--blue)'}}>+ Ajouter ligne</button>
                                </div>
                                <div style={{textAlign:'right',marginTop:12,fontSize:14}}>
                                    <div>Total HT: <strong>{totals.ht.toLocaleString('fr-FR',{minimumFractionDigits:2})} MAD</strong></div>
                                    <div>TVA: <strong>{totals.tva.toLocaleString('fr-FR',{minimumFractionDigits:2})} MAD</strong></div>
                                    <div style={{fontSize:18,color:'var(--berry)',fontWeight:700}}>TTC: {totals.ttc.toLocaleString('fr-FR',{minimumFractionDigits:2})} MAD</div>
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={() => setShowForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreate} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Creer la facture</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {detailFacture && window.FactureDetailPopup && (
                        <window.FactureDetailPopup facture={detailFacture} statusLabels={statusLabels} onClose={() => setDetailFacture(null)} />
                    )}
                </div>
            );
        }

export { AchatsFacturesTab };
