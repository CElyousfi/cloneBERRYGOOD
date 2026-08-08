/*
 * MagBdcReceptionTab.jsx — Onglet magasinier "BDC à réceptionner" : réception
 * physique (BL) d'un bon de commande validé, ou réception libre (sans BDC).
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE, aucun identifiant top-level qui fuite (cf.
 * crashes #75/#77 — mémoire umd-global-collision-smoke-load). Un seul global
 * exposé : window.MagBdcReceptionTab.
 *
 * Reliquat par article : le plafond de réception (reliquat = commandé − déjà
 * reçu) est calculé via public/lib/bdcReceptionUtils.js (window.BdcReceptionUtils
 * .computeDeliveryData), à partir des BL déjà créés pour ce BDC
 * (/api/stock?action=list-bl&bdc_id=...). La validation serveur (functions/index.js,
 * action create-bl) reste la garde qui fait foi — celle-ci n'est qu'un filet
 * côté UI pour éviter une sur-réception évidente et donner de la visibilité au
 * magasinier (colonnes "Déjà reçu" / "Reliquat", input plafonné et désactivé
 * quand il n'y a plus de reliquat pour la ligne).
 *
 * Props :
 *   - currentProfile : id du profil courant (string)
 *   - profileData    : objet profil (name, userId, …)
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;

  function MagBdcReceptionTab({ currentProfile, profileData }) {
    // Magasins dérivés de la config stock (get-locations) — source unique, plus de hardcode.
    const MAGASINS = window.useStockLocations().magasins;
    const [bdcList, setBdcList] = useState([]);
    const [receptions, setReceptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [bdcQuery, setBdcQuery] = useState('');
    const [selectedBdc, setSelectedBdc] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [showFreeForm, setShowFreeForm] = useState(false);
    const [blForm, setBlForm] = useState({ date_reception: '', numero_bl_fournisseur: '', magasin: 'F1', items: [] });
    const [blFormError, setBlFormError] = useState(null);
    const [freeForm, setFreeForm] = useState({ date: '', ref_bl_fournisseur: '', magasin: 'F1', motif: '', motif_autre: '', fournisseur_nom: '', items: [{ article: '', quantite: '', unite: 'kg' }], scan_file: null, scan_preview: null });
    const UNITES_BR = ['kg', 'L', 'unité', 'carton', 'sac', 'bidon'];
    const MOTIFS_RECEPTION = ['Livraison urgente', 'Don', 'Retour client', 'Échantillon', 'Régularisation stock'];
    const [articles, setArticles] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [blScanFile, setBlScanFile] = useState(null);
    const [blScanPreview, setBlScanPreview] = useState(null);

    const loadData = () => {
        setLoading(true);
        Promise.all([
            fetch('/api/stock?action=list-bdc&status=valide_dg,envoye,virement_lance,virement_signe&limit=500').then(r => r.json()),
            fetch('/api/stock?action=list-movements&type=reception&limit=100').then(r => r.json()),
            window.cachedFetch('/api/stock?action=list-articles').then(json => json.success ? (json.articles || []) : []).catch(() => []),
            window.cachedFetch('/api/stock?action=list-suppliers&status=valide').then(json => json.success ? (json.suppliers || []) : []).catch(() => []),
        ]).then(([bdcJson, movJson, arts, supps]) => {
            if (bdcJson.success) setBdcList((bdcJson.bdc || []).filter(b => ['valide_dg', 'envoye', 'virement_lance', 'virement_signe'].includes(b.status) && b.delivery_status !== 'complet'));
            if (movJson.success) setReceptions(movJson.movements || []);
            setArticles(arts.filter(a => a.active !== false));
            setSuppliers(supps);
        }).catch(err => console.warn('Reception error:', err)).finally(() => setLoading(false));
    };
    useEffect(() => { loadData(); }, []);

    const handleScanFile = (file, setter, previewSetter) => {
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { alert('Fichier trop volumineux (max 10 Mo)'); return; }
        const reader = new FileReader();
        reader.onload = (e) => { setter(e.target.result); previewSetter(file.type.startsWith('image/') ? e.target.result : file.name); };
        reader.readAsDataURL(file);
    };

    const uploadScan = async (base64) => {
        if (!base64) return null;
        const res = await fetch('/api/stock?action=upload-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_base64: base64, filename: 'scan_bl.jpg', contentType: 'image/jpeg' }) });
        const json = await res.json();
        return json.success ? json.url : null;
    };

    const openBdcForBl = (bdc) => {
        if (bdc.delivery_status === 'complet') { alert('Ce BDC est déjà entièrement réceptionné.'); return; }
        setSelectedBdc(bdc);
        setBlForm({ date_reception: new Date().toISOString().split('T')[0], numero_bl_fournisseur: '', magasin: bdc.ferme || 'F1', items: [] });
        setBlFormError(null);
        setBlScanFile(null); setBlScanPreview(null);
        setShowForm(true);
        // Reliquat par article : fetch les BL déjà créés pour ce BDC et calcule reçu/reliquat
        // via l'utilitaire partagé (même logique que AchatsBDCTab / MagBonsCommandeTab).
        fetch('/api/stock?action=list-bl&bdc_id=' + bdc.id).then(r => r.json()).then(json => {
            const resolved = window.BdcReceptionUtils.resolveDeliveryDataOrError(json);
            if (!resolved.ok) {
                // NE JAMAIS retomber sur reliquat = quantité commandée quand la donnée
                // est en fait indisponible (bug BDC-2026-0142) : on bloque la saisie
                // et on affiche l'erreur au magasinier, la garde serveur (create-bl)
                // reste la protection qui fait foi contre la sur-réception.
                setBlFormError(resolved.error);
                setBlForm(prev => ({ ...prev, items: [] }));
                return;
            }
            const delivery = window.BdcReceptionUtils.computeDeliveryData(bdc.items, resolved.data);
            const deliveryByArticle = {};
            delivery.forEach(d => { deliveryByArticle[d.article] = d; });
            const items = (bdc.items || []).map(it => {
                const d = deliveryByArticle[it.article];
                return {
                    article: it.article,
                    quantite_commandee: it.quantite,
                    quantite_deja_recue: d ? d.qLiv : 0,
                    reliquat: d ? d.reste : (parseFloat(it.quantite) || 0),
                    quantite_recue: '', unite: it.unite || 'kg', note: '',
                };
            });
            setBlForm(prev => ({ ...prev, items }));
        }).catch(() => {
            // Filet réseau : ne pas prétendre à un reliquat fiable, bloquer la saisie.
            setBlFormError('Impossible de charger les réceptions déjà faites pour ce BDC — reliquat indisponible. Réessaie ou contacte le support.');
            setBlForm(prev => ({ ...prev, items: [] }));
        });
    };

    const updateBlItem = (idx, field, value) => {
        const items = [...blForm.items];
        // Clampe en temps réel la quantité reçue au reliquat de la ligne : on ne
        // doit pas pouvoir dépasser le reliquat en saisie (bug BDC-2026-0142,
        // max={reliquat} ne bloque que les flèches +/- du input number, pas le
        // clavier/collage). Le filet handleCreateBl reste en place en complément.
        const finalValue = field === 'quantite_recue'
            ? window.BdcReceptionUtils.clampReceivedQty(value, items[idx].reliquat)
            : value;
        items[idx] = { ...items[idx], [field]: finalValue };
        setBlForm({ ...blForm, items });
    };

    const handleCreateBl = async () => {
        if (blFormError) { alert('Réception impossible : ' + blFormError); return; }
        if (!blForm.items.some(i => parseFloat(i.quantite_recue) > 0)) { alert('Saisissez au moins une quantité reçue'); return; }
        const validItems = blForm.items.filter(i => parseFloat(i.quantite_recue) > 0);
        // Filet client : rejette si une quantité saisie dépasse son reliquat. La garde qui fait
        // foi reste la validation serveur (create-bl) — ceci n'évite qu'une soumission évidente.
        const overReliquat = validItems.find(i => parseFloat(i.quantite_recue) > (parseFloat(i.reliquat) || 0) + 0.01);
        if (overReliquat) {
            alert('Quantité reçue supérieure au reliquat pour ' + overReliquat.article + ' (reliquat: ' + overReliquat.reliquat + ')');
            return;
        }
        let scanUrl = null;
        if (blScanFile) { scanUrl = await uploadScan(blScanFile); }
        fetch('/api/stock?action=create-bl', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bdc_id: selectedBdc.id, date_reception: blForm.date_reception,
                numero_bl_fournisseur: blForm.numero_bl_fournisseur, magasin: blForm.magasin, items: validItems,
                scan_url: scanUrl,
                created_by: { profileId: currentProfile, name: profileData?.name || currentProfile, userId: profileData?.userId || '' },
            }),
        }).then(r => r.json()).then(json => {
            if (json.success) { alert('Bon de réception créé. En attente de valorisation Achats.'); setShowForm(false); setSelectedBdc(null); loadData(); }
            else alert('Erreur: ' + (json.error || 'Echec'));
        }).catch(() => alert('Erreur réseau'));
    };

    // Free reception
    const updateFreeItem = (idx, field, value) => {
        const items = [...freeForm.items]; items[idx] = { ...items[idx], [field]: value };
        setFreeForm({ ...freeForm, items });
    };
    const addFreeItem = () => setFreeForm({ ...freeForm, items: [...freeForm.items, { article: '', quantite: '', unite: 'kg' }] });
    const removeFreeItem = (idx) => { if (freeForm.items.length > 1) setFreeForm({ ...freeForm, items: freeForm.items.filter((_, i) => i !== idx) }); };

    const handleCreateFree = async () => {
        const motifFinal = freeForm.motif === 'Autre' ? freeForm.motif_autre.trim() : freeForm.motif;
        if (!motifFinal) { alert('Motif obligatoire pour réception libre'); return; }
        if (!freeForm.magasin) { alert('Magasin requis'); return; }
        const validItems = freeForm.items.filter(i => i.article && i.quantite);
        if (!validItems.length) { alert('Ajoutez au moins un article'); return; }
        let scanUrl = null;
        if (freeForm.scan_file) { scanUrl = await uploadScan(freeForm.scan_file); }
        fetch('/api/stock?action=create-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'reception', date: freeForm.date || new Date().toISOString().split('T')[0],
                lieu_destination: { type: 'magasin', id: freeForm.magasin },
                ferme: freeForm.magasin,
                ref_bl_fournisseur: freeForm.ref_bl_fournisseur,
                reception_libre: true, reception_libre_motif: motifFinal,
                fournisseur_nom: freeForm.fournisseur_nom || null,
                scan_url: scanUrl,
                items: validItems.map(i => ({ article_ref: i.article, article_nom: i.article, quantite: parseFloat(i.quantite), unite: i.unite })),
                created_by: { profileId: currentProfile, name: profileData?.name || currentProfile, userId: profileData?.userId || '' },
            }),
        }).then(r => r.json()).then(json => {
            if (json.success) { alert('Réception libre ' + json.numero + ' créée. En attente de valorisation Achats.'); setShowFreeForm(false); loadData(); }
            else alert('Erreur: ' + (json.error || 'Echec'));
        }).catch(() => alert('Erreur réseau'));
    };

    const statusLabel = (s) => s === 'valide_chef' ? 'Validé' : s === 'en_attente_achats' ? 'À valoriser par Achats' : s === 'valide_mag' ? 'À valider par Achats' : s === 'valide_achats' ? 'À valider par Chef' : s === 'rejete' ? 'Rejeté' : s;
    const statusClass = (s) => s === 'valide_chef' ? 'valide' : s === 'rejete' ? 'rejete' : 'en-attente';

    if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

    return (
        <div className="fade-in">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                <h3 style={{margin:0}}><i className="fa-solid fa-clipboard-check" style={{marginRight:8,color:'var(--berry)'}}></i>BDC à réceptionner</h3>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    <input type="search" placeholder="Rechercher (n°, fournisseur, article…)" value={bdcQuery} onChange={e => setBdcQuery(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12,minWidth:240}} />
                    <button onClick={() => { setFreeForm({ date: new Date().toISOString().split('T')[0], ref_bl_fournisseur: '', magasin: 'F1', motif: '', motif_autre: '', fournisseur_nom: '', items: [{ article: '', quantite: '', unite: 'kg' }], scan_file: null, scan_preview: null }); setShowFreeForm(true); }}
                        style={{background:'var(--blue)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                        <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Réception libre
                    </button>
                </div>
            </div>

            {/* BDC prêts à recevoir */}
            <div className="panel" style={{marginBottom:20}}>
                {(() => {
                    const q = bdcQuery.toLowerCase();
                    const filteredBdc = !q ? bdcList : bdcList.filter(b =>
                        (b.numero||'').toLowerCase().includes(q)
                        || (b.fournisseur?.nom||'').toLowerCase().includes(q)
                        || (b.ferme||'').toLowerCase().includes(q)
                        || (b.items||[]).some(i => (i.article||'').toLowerCase().includes(q))
                    );
                    return (<>
                    <h4 style={{marginTop:0}}>BDC en attente de livraison ({filteredBdc.length})</h4>
                    {filteredBdc.length === 0 ? (
                        <p style={{color:'var(--gray-400)',textAlign:'center',padding:20}}>Aucun BDC validé en attente de livraison.</p>
                    ) : (
                        <div className="table-responsive"><table className="data-table">
                            <thead><tr><th>N° BDC</th><th>Fournisseur</th><th>Ferme</th><th>Articles</th><th>Total TTC</th><th>Livraison</th><th></th></tr></thead>
                            <tbody>
                                {filteredBdc.map((b) => (
                                    <tr key={b.id}>
                                        <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{b.numero}</td>
                                        <td style={{fontWeight:600}}>{b.fournisseur?.nom || '—'}</td>
                                        <td>{b.ferme}</td>
                                        <td style={{textAlign:'center'}}>{b.items?.length || 0}</td>
                                        <td style={{fontWeight:700}}>{(b.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                        <td><span className={'status-badge ' + (b.delivery_status === 'complet' ? 'valide' : b.delivery_status === 'partiel' ? 'en-attente' : 'brouillon')}>{b.delivery_status === 'complet' ? 'Complet' : b.delivery_status === 'partiel' ? 'Partiel' : 'Non livré'}</span></td>
                                        <td>{currentProfile === 'magasinier' && <button onClick={() => openBdcForBl(b)} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-plus" style={{marginRight:4}}></i>Réceptionner</button>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table></div>
                    )}
                    </>);
                })()}
            </div>

            {/* Create BL from BDC Modal */}
            {showForm && selectedBdc && (
                <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); setSelectedBdc(null); } }}>
                    <div className="modal-content" style={{maxWidth:800,maxHeight:'90vh',overflowY:'auto'}}>
                        <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-truck-ramp-box" style={{marginRight:8}}></i>Réception — BDC {selectedBdc.numero}</h3>
                        <div style={{background:'#f8f8f8',borderRadius:8,padding:12,marginBottom:16,fontSize:13}}>
                            <strong>Fournisseur:</strong> {selectedBdc.fournisseur?.nom} — <strong>Ferme:</strong> {selectedBdc.ferme}
                        </div>
                        {blFormError && (
                            <div style={{background:'#fdecea',border:'1px solid var(--red)',color:'var(--red)',borderRadius:8,padding:12,marginBottom:16,fontSize:13}}>
                                <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>{blFormError}
                            </div>
                        )}
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16, opacity: blFormError ? 0.5 : 1, pointerEvents: blFormError ? 'none' : 'auto'}}>
                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date de réception</label>
                                <input type="date" value={blForm.date_reception} onChange={e => setBlForm({...blForm, date_reception: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>N° BL Fournisseur</label>
                                <input value={blForm.numero_bl_fournisseur} onChange={e => setBlForm({...blForm, numero_bl_fournisseur: e.target.value})} placeholder="Réf BL" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Magasin destination</label>
                                <select value={blForm.magasin} onChange={e => setBlForm({...blForm, magasin: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                    {MAGASINS.map(m => <option key={m} value={m}>{m}</option>)}
                                </select></div>
                        </div>
                        <div style={{marginBottom:16}}>
                            <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}><i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>Scanner le BL fournisseur</label>
                            <input type="file" accept="image/*,application/pdf" onChange={e => handleScanFile(e.target.files[0], setBlScanFile, setBlScanPreview)} style={{fontSize:12}} />
                            {blScanPreview && (typeof blScanPreview === 'string' && blScanPreview.startsWith('data:image') ? <img src={blScanPreview} alt="Scan" style={{maxHeight:80,marginTop:6,borderRadius:6}} /> : <span style={{fontSize:11,color:'var(--green)',marginLeft:8}}><i className="fa-solid fa-check"></i> Fichier sélectionné</span>)}
                        </div>
                        {!blFormError && (
                            <React.Fragment>
                                <h4 style={{marginBottom:8}}>Articles à réceptionner</h4>
                                <table className="data-table" style={{fontSize:12}}>
                                    <thead><tr><th>Article</th><th>Qté commandée</th><th>Déjà reçu</th><th>Reliquat</th><th>Qté reçue</th><th>Unité</th><th>Écart</th><th>Note</th></tr></thead>
                                    <tbody>
                                        {blForm.items.map((it, idx) => {
                                            const reliquat = parseFloat(it.reliquat);
                                            const ecart = window.BdcReceptionUtils.computeReceptionEcart(it.quantite_recue, it.reliquat, it.quantite_commandee);
                                            const noReliquat = !isNaN(reliquat) && reliquat <= 0;
                                            return (
                                                <tr key={idx}>
                                                    <td style={{fontWeight:600}}>{it.article}</td>
                                                    <td style={{textAlign:'center'}}>{it.quantite_commandee}</td>
                                                    <td style={{textAlign:'center',color:'var(--gray-400)'}}>{it.quantite_deja_recue ?? 0}</td>
                                                    <td style={{textAlign:'center',fontWeight:700,color: noReliquat ? 'var(--gray-400)' : 'var(--berry)'}}>{isNaN(reliquat) ? it.quantite_commandee : reliquat}</td>
                                                    <td><input type="number" value={it.quantite_recue} max={isNaN(reliquat) ? undefined : reliquat} disabled={noReliquat}
                                                        onChange={e => updateBlItem(idx, 'quantite_recue', e.target.value)}
                                                        style={{width:80,padding:'4px 8px',borderRadius:6,border: ecart < 0 ? '2px solid var(--red)' : ecart > 0 ? '2px solid var(--blue)' : '1px solid #ddd',fontSize:12,textAlign:'right',background: noReliquat ? '#f1f5f9' : '#fff',cursor: noReliquat ? 'not-allowed' : 'text'}} /></td>
                                                    <td>{it.unite}</td>
                                                    <td style={{textAlign:'center',fontWeight:600,color: ecart < 0 ? 'var(--red)' : ecart > 0 ? 'var(--blue)' : 'var(--green)'}}>{it.quantite_recue ? (ecart > 0 ? '+' : '') + ecart : '—'}</td>
                                                    <td><input value={it.note || ''} onChange={e => updateBlItem(idx, 'note', e.target.value)} placeholder="Note..." style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:11}} /></td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </React.Fragment>
                        )}
                        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                            <button onClick={() => { setShowForm(false); setSelectedBdc(null); }} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                            <button onClick={handleCreateBl} disabled={!!blFormError} style={{padding:'8px 16px',borderRadius:8,border:'none',background: blFormError ? 'var(--gray-400)' : 'var(--berry)',color:'#fff',cursor: blFormError ? 'not-allowed' : 'pointer',fontWeight:600,fontSize:13}}>Valider la réception</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Free Reception Modal */}
            {showFreeForm && (
                <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowFreeForm(false); }}>
                    <div className="modal-content" style={{maxWidth:650,maxHeight:'90vh',overflowY:'auto'}}>
                        <h3 style={{marginTop:0,color:'var(--blue)'}}><i className="fa-solid fa-plus-circle" style={{marginRight:8}}></i>Réception Libre (sans BDC)</h3>
                        <div style={{background:'#fff3cd',borderRadius:8,padding:10,marginBottom:16,fontSize:12,color:'#856404'}}>
                            <i className="fa-solid fa-info-circle" style={{marginRight:6}}></i>Réception sans commande préalable. Justification obligatoire.
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date</label>
                                <input type="date" value={freeForm.date} onChange={e => setFreeForm({...freeForm, date: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Magasin destination *</label>
                                <select value={freeForm.magasin} onChange={e => setFreeForm({...freeForm, magasin: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                    {MAGASINS.map(m => <option key={m} value={m}>{m}</option>)}
                                </select></div>
                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Fournisseur</label>
                                <select value={freeForm.fournisseur_nom} onChange={e => setFreeForm({...freeForm, fournisseur_nom: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                    <option value="">-- Sélectionner --</option>
                                    {suppliers.map(s => <option key={s.id} value={s.nom}>{s.nom}{s.ville ? ' ('+s.ville+')' : ''}</option>)}
                                </select></div>
                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Réf BL Fournisseur</label>
                                <input value={freeForm.ref_bl_fournisseur} onChange={e => setFreeForm({...freeForm, ref_bl_fournisseur: e.target.value})} placeholder="Référence" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Motif / Justification *</label>
                                <select value={freeForm.motif} onChange={e => setFreeForm({...freeForm, motif: e.target.value, motif_autre: ''})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                    <option value="">-- Sélectionner --</option>
                                    {MOTIFS_RECEPTION.map(m => <option key={m} value={m}>{m}</option>)}
                                    <option value="Autre">Autre (à préciser)</option>
                                </select></div>
                            {freeForm.motif === 'Autre' && (
                                <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Préciser le motif *</label>
                                    <input value={freeForm.motif_autre} onChange={e => setFreeForm({...freeForm, motif_autre: e.target.value})} placeholder="Précisez..." style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                            )}
                        </div>
                        <div style={{marginBottom:16}}>
                            <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}><i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>Scanner le BL fournisseur</label>
                            <input type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files[0]; if (f) { if (f.size > 10*1024*1024) { alert('Max 10 Mo'); return; } const r = new FileReader(); r.onload = ev => setFreeForm(prev => ({...prev, scan_file: ev.target.result, scan_preview: f.type.startsWith('image/') ? ev.target.result : f.name})); r.readAsDataURL(f); }}} style={{fontSize:12}} />
                            {freeForm.scan_preview && (typeof freeForm.scan_preview === 'string' && freeForm.scan_preview.startsWith('data:image') ? <img src={freeForm.scan_preview} alt="Scan" style={{maxHeight:80,marginTop:6,borderRadius:6}} /> : <span style={{fontSize:11,color:'var(--green)',marginLeft:8}}><i className="fa-solid fa-check"></i> Fichier sélectionné</span>)}
                        </div>
                        <h4 style={{fontSize:13,marginBottom:8}}>Articles reçus</h4>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                            <thead><tr style={{background:'#f8f8f8'}}><th style={{padding:'6px 8px',textAlign:'left'}}>Article</th><th style={{padding:'6px 8px',width:80}}>Qté</th><th style={{padding:'6px 8px',width:70}}>Unité</th><th style={{width:30}}></th></tr></thead>
                            <tbody>
                                {freeForm.items.map((it, idx) => (
                                    <tr key={idx}>
                                        <td><input list="articles-list-free" value={it.article} onChange={e => updateFreeItem(idx, 'article', e.target.value)} placeholder="Article" style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />
                                            <datalist id="articles-list-free">{articles.map(a => <option key={a.reference || a.nom} value={a.nom}>{a.nom}</option>)}</datalist></td>
                                        <td><input type="number" value={it.quantite} onChange={e => updateFreeItem(idx, 'quantite', e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                        <td><select value={it.unite} onChange={e => updateFreeItem(idx, 'unite', e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}}>{UNITES_BR.map(u => <option key={u} value={u}>{u}</option>)}</select></td>
                                        <td><button onClick={() => removeFreeItem(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <button onClick={addFreeItem} style={{marginTop:8,background:'none',border:'1px dashed #ddd',borderRadius:8,padding:'6px 16px',cursor:'pointer',fontSize:12,color:'var(--blue)'}}>+ Ajouter article</button>
                        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                            <button onClick={() => setShowFreeForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                            <button onClick={handleCreateFree} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--blue)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Créer la réception</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
  }

  window.MagBdcReceptionTab = MagBdcReceptionTab;
})();
