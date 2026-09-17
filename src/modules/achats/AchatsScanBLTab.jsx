/* Module: achats | Déclaration(s): AchatsScanBLTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ACHATS: SCAN BL TAB =====================
        function AchatsScanBLTab({ currentProfile, profileData }) {
            const [scanFile, setScanFile] = useState(null);
            const [scanPreview, setScanPreview] = useState(null);
            const [scanBase64, setScanBase64] = useState(null);
            const [analysisResult, setAnalysisResult] = useState(null);
            const [analysisLoading, setAnalysisLoading] = useState(false);
            const [matchedBdc, setMatchedBdc] = useState(null);
            const [scanId, setScanId] = useState(null);
            const [scanUrl, setScanUrl] = useState(null);
            const [showCreateForm, setShowCreateForm] = useState(false);
            const [bdcList, setBdcList] = useState([]);
            const [selectedBdcId, setSelectedBdcId] = useState('');
            const [selectedBdc, setSelectedBdc] = useState(null);
            const [form, setForm] = useState({ date_reception: '', numero_bl_fournisseur: '', items: [] });
            const [creating, setCreating] = useState(false);
            const [history, setHistory] = useState([]);
            const [historyLoading, setHistoryLoading] = useState(true);
            const [tab, setTab] = useState('scan');

            useEffect(() => {
                fetch('/api/stock?action=list-bdc').then(r => r.json()).then(json => {
                    if (json.success) setBdcList((json.bdc || []).filter(b => ['valide_dg','envoye'].includes(b.status)));
                }).catch(() => {});
            }, []);

            const loadHistory = () => {
                setHistoryLoading(true);
                fetch('/api/stock?action=list-scan-history&type=bl&limit=50').then(r => r.json())
                    .then(json => { if (json.success) setHistory(json.scans || []); })
                    .catch(() => {}).finally(() => setHistoryLoading(false));
            };
            useEffect(() => { if (tab === 'history') loadHistory(); }, [tab]);

            const handleFileSelect = (file) => {
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) { alert('Fichier trop volumineux (max 10 MB)'); return; }
                const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
                if (!validTypes.includes(file.type)) { alert('Format non supporté. Utilisez PDF, JPEG, PNG ou WebP.'); return; }
                setScanFile(file);
                setAnalysisResult(null); setMatchedBdc(null); setScanId(null); setShowCreateForm(false);
                const reader = new FileReader();
                reader.onload = (e) => {
                    setScanBase64(e.target.result);
                    if (file.type.startsWith('image/')) setScanPreview(e.target.result);
                    else setScanPreview(null);
                };
                reader.readAsDataURL(file);
            };

            const handleAnalyze = () => {
                if (!scanBase64) return;
                setAnalysisLoading(true); setAnalysisResult(null); setMatchedBdc(null);
                fetch('/api/stock?action=scan-bl', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scan_base64: scanBase64, filename: scanFile?.name || 'scan.pdf', created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        setAnalysisResult(json.analysis);
                        setMatchedBdc(json.matched_bdc);
                        setScanId(json.scan_id);
                        setScanUrl(json.scan_url);
                        // Pre-populate form
                        setForm({
                            date_reception: json.analysis.date_reception || '',
                            numero_bl_fournisseur: json.analysis.numero_bl_fournisseur || '',
                            items: (json.analysis.items || []).map(it => ({
                                article: it.article || '', quantite_recue: it.quantite_recue || '', unite: it.unite || '', note: '',
                            })),
                        });
                        if (json.matched_bdc?.id) {
                            setSelectedBdcId(json.matched_bdc.id);
                            setSelectedBdc(json.matched_bdc);
                        }
                    } else { alert('Erreur: ' + (json.error || 'Echec analyse')); }
                }).catch(() => alert('Erreur réseau'))
                .finally(() => setAnalysisLoading(false));
            };

            const selectBdcManual = (bdcId) => {
                setSelectedBdcId(bdcId);
                const bdc = bdcList.find(b => b.id === bdcId);
                setSelectedBdc(bdc || null);
                // Merge BDC items with scanned items
                if (bdc && form.items.length > 0) {
                    const updatedItems = form.items.map(it => {
                        const bdcItem = (bdc.items || []).find(bi => bi.article && it.article && bi.article.toLowerCase().includes(it.article.toLowerCase()));
                        return { ...it, quantite_commandee: bdcItem ? (parseFloat(bdcItem.quantite) || 0) : 0 };
                    });
                    setForm({ ...form, items: updatedItems });
                }
            };

            const updateItem = (idx, field, value) => { const items = [...form.items]; items[idx] = { ...items[idx], [field]: value }; setForm({ ...form, items }); };

            const handleCreateBL = () => {
                if (!selectedBdcId) { alert('Sélectionnez un BDC'); return; }
                const validItems = form.items.filter(i => i.article && i.quantite_recue);
                if (!validItems.length) { alert('Ajoutez au moins un article avec quantité reçue'); return; }
                // Enrich items with quantite_commandee from BDC
                const bdcData = selectedBdc || bdcList.find(b => b.id === selectedBdcId);
                const enrichedItems = validItems.map(it => {
                    const bdcItem = (bdcData?.items || []).find(bi => bi.article && it.article && bi.article.toLowerCase().includes(it.article.toLowerCase()));
                    return { article: it.article, quantite_commandee: bdcItem ? (parseFloat(bdcItem.quantite) || 0) : 0, quantite_recue: parseFloat(it.quantite_recue) || 0, unite: it.unite || '', note: it.note || '' };
                });
                setCreating(true);
                fetch('/api/stock?action=create-bl', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bdc_id: selectedBdcId, date_reception: form.date_reception, numero_bl_fournisseur: form.numero_bl_fournisseur, items: enrichedItems, scan_url: scanUrl, scan_id: scanId, created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        alert('BL ' + json.numero + ' créé depuis le scan ! Statut livraison: ' + (json.delivery_status || ''));
                        setScanFile(null); setScanPreview(null); setScanBase64(null); setAnalysisResult(null); setMatchedBdc(null); setShowCreateForm(false); setScanId(null);
                    } else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau')).finally(() => setCreating(false));
            };

            return (
                <div className="fade-in">
                    <div style={{display:'flex',gap:8,marginBottom:16}}>
                        <button className={`chip c-berry ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>
                            <i className="fa-solid fa-truck-ramp-box" style={{marginRight:4}}></i>Nouveau scan
                        </button>
                        <button className={`chip c-berry ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
                            <i className="fa-solid fa-clock-rotate-left" style={{marginRight:4}}></i>Historique
                        </button>
                    </div>

                    {tab === 'scan' && (
                        <div>
                            {/* Upload Zone */}
                            <div
                                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--berry)'; }}
                                onDragLeave={e => { e.currentTarget.style.borderColor = '#ddd'; }}
                                onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#ddd'; handleFileSelect(e.dataTransfer.files[0]); }}
                                style={{border:'2px dashed #ddd',borderRadius:12,padding:40,textAlign:'center',marginBottom:16,background:'#fafafa',cursor:'pointer',transition:'border-color 0.2s'}}
                                onClick={() => document.getElementById('scan-bl-input').click()}
                            >
                                <input id="scan-bl-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{display:'none'}} onChange={e => handleFileSelect(e.target.files[0])} />
                                {!scanFile ? (
                                    <div>
                                        <i className="fa-solid fa-cloud-arrow-up" style={{fontSize:48,color:'var(--gray-300)',marginBottom:12,display:'block'}}></i>
                                        <p style={{color:'var(--gray-400)',margin:0,fontSize:14}}>Glissez-déposez un bon de livraison (PDF, JPEG, PNG) ou cliquez pour parcourir</p>
                                        <p style={{color:'var(--gray-300)',margin:'4px 0 0',fontSize:11}}>Max 10 MB</p>
                                    </div>
                                ) : (
                                    <div>
                                        <i className="fa-solid fa-file-check" style={{fontSize:36,color:'var(--green)',marginBottom:8,display:'block'}}></i>
                                        <p style={{fontWeight:600,margin:0}}>{scanFile.name}</p>
                                        <p style={{color:'var(--gray-400)',margin:'4px 0 0',fontSize:12}}>{(scanFile.size / 1024).toFixed(0)} KB — {scanFile.type}</p>
                                    </div>
                                )}
                            </div>

                            {scanPreview && <div style={{textAlign:'center',marginBottom:16}}><img src={scanPreview} alt="Preview" style={{maxWidth:400,maxHeight:300,borderRadius:8,border:'1px solid #eee'}} /></div>}

                            {scanFile && !analysisResult && (
                                <div style={{textAlign:'center',marginBottom:16}}>
                                    <button onClick={handleAnalyze} disabled={analysisLoading}
                                        style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',cursor:analysisLoading?'wait':'pointer',fontWeight:600,fontSize:14,opacity:analysisLoading?0.7:1}}>
                                        {analysisLoading ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:8}}></i>Analyse en cours...</> : <><i className="fa-solid fa-wand-magic-sparkles" style={{marginRight:8}}></i>Analyser avec l'IA</>}
                                    </button>
                                </div>
                            )}

                            {/* Analysis Result */}
                            {analysisResult && (
                                <div style={{marginBottom:16}}>
                                    <div style={{background:'rgba(39,174,96,0.08)',border:'1px solid rgba(39,174,96,0.3)',borderRadius:10,padding:16,marginBottom:16}}>
                                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                                            <i className="fa-solid fa-circle-check" style={{color:'var(--green)',fontSize:20}}></i>
                                            <strong style={{color:'var(--green)',fontSize:15}}>Bon de livraison analysé</strong>
                                        </div>
                                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,fontSize:13}}>
                                            <div><span style={{color:'var(--gray-400)',fontSize:11}}>Fournisseur</span><br/><strong>{analysisResult.fournisseur_nom || '—'}</strong></div>
                                            <div><span style={{color:'var(--gray-400)',fontSize:11}}>N° BL Fournisseur</span><br/><strong>{analysisResult.numero_bl_fournisseur || '—'}</strong></div>
                                            <div><span style={{color:'var(--gray-400)',fontSize:11}}>Date réception</span><br/><strong>{analysisResult.date_reception || '—'}</strong></div>
                                        </div>
                                        {(analysisResult.items || []).length > 0 && (
                                            <div style={{marginTop:12,overflowX:'auto'}}>
                                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                    <thead><tr style={{background:'rgba(39,174,96,0.06)'}}><th style={{padding:'4px 8px',textAlign:'left'}}>Article</th><th style={{padding:'4px 8px'}}>Qté reçue</th><th style={{padding:'4px 8px'}}>Unité</th></tr></thead>
                                                    <tbody>{(analysisResult.items || []).map((it, i) => (
                                                        <tr key={i}><td style={{padding:'4px 8px'}}>{it.article}</td><td style={{padding:'4px 8px',textAlign:'center'}}>{it.quantite_recue}</td><td style={{padding:'4px 8px',textAlign:'center'}}>{it.unite || ''}</td></tr>
                                                    ))}</tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>

                                    {matchedBdc && (
                                        <div style={{background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.2)',borderRadius:10,padding:12,marginBottom:16,fontSize:13}}>
                                            <i className="fa-solid fa-link" style={{marginRight:6,color:'var(--blue)'}}></i>
                                            <strong>BDC suggéré:</strong> {matchedBdc.numero} — {matchedBdc.fournisseur_nom}
                                            <span style={{marginLeft:8,fontSize:11,color: matchedBdc.confidence === 'high' ? 'var(--green)' : 'var(--orange)'}}>
                                                ({matchedBdc.confidence === 'high' ? 'Correspondance forte' : 'Correspondance moyenne'})
                                            </span>
                                        </div>
                                    )}

                                    <div style={{textAlign:'center'}}>
                                        <button onClick={() => setShowCreateForm(true)} style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',cursor:'pointer',fontWeight:600,fontSize:14}}>
                                            <i className="fa-solid fa-truck-ramp-box" style={{marginRight:8}}></i>Créer le BL
                                        </button>
                                        <button onClick={() => { setScanFile(null); setScanPreview(null); setScanBase64(null); setAnalysisResult(null); setMatchedBdc(null); }}
                                            style={{marginLeft:12,background:'#fff',color:'var(--gray-500)',border:'1px solid #ddd',borderRadius:8,padding:'10px 24px',cursor:'pointer',fontSize:14}}>
                                            <i className="fa-solid fa-rotate" style={{marginRight:6}}></i>Nouveau scan
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Create BL Form */}
                            {showCreateForm && analysisResult && (
                                <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowCreateForm(false); }}>
                                    <div className="modal-content" style={{maxWidth:750,maxHeight:'90vh',overflowY:'auto'}}>
                                        <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-truck-ramp-box" style={{marginRight:8}}></i>Créer BL depuis scan</h3>
                                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>BDC *</label>
                                                <select value={selectedBdcId} onChange={e => selectBdcManual(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                                    <option value="">-- Sélectionner un BDC --</option>
                                                    {bdcList.map(b => <option key={b.id} value={b.id}>{b.numero} - {b.fournisseur?.nom || '?'}</option>)}
                                                </select></div>
                                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>N° BL Fournisseur</label>
                                                <input value={form.numero_bl_fournisseur} onChange={e => setForm({...form, numero_bl_fournisseur: e.target.value})} placeholder="N° BL" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date réception</label>
                                                <input type="date" value={form.date_reception} onChange={e => setForm({...form, date_reception: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                        </div>

                                        {scanUrl && <div style={{background:'rgba(139,34,82,0.05)',border:'1px solid rgba(139,34,82,0.15)',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:12}}>
                                            <i className="fa-solid fa-paperclip" style={{marginRight:6,color:'var(--berry)'}}></i>
                                            Scan attaché: <a href={scanUrl} target="_blank" rel="noopener noreferrer" style={{color:'var(--berry)'}}>{scanFile?.name || 'Voir le scan'}</a>
                                        </div>}

                                        <h4 style={{fontSize:13,marginBottom:8}}>Articles (pré-remplis par l'IA)</h4>
                                        <div style={{overflowX:'auto'}}>
                                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                <thead><tr style={{background:'#f8f8f8'}}><th style={{padding:'6px 8px',textAlign:'left'}}>Article</th><th style={{padding:'6px 8px',width:100}}>Qté commandée</th><th style={{padding:'6px 8px',width:100}}>Qté reçue</th><th style={{padding:'6px 8px',width:70}}>Unité</th><th style={{padding:'6px 8px',width:80}}>Ecart</th><th style={{padding:'6px 8px'}}>Note</th><th style={{width:30}}></th></tr></thead>
                                                <tbody>{form.items.map((it, idx) => {
                                                    const ecart = (parseFloat(it.quantite_recue)||0) - (parseFloat(it.quantite_commandee)||0);
                                                    return (
                                                    <tr key={idx}><td><input value={it.article} onChange={e => updateItem(idx,'article',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                    <td><input type="number" value={it.quantite_commandee || ''} onChange={e => updateItem(idx,'quantite_commandee',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12,background:'#f8f8f8'}} /></td>
                                                    <td><input type="number" value={it.quantite_recue} onChange={e => updateItem(idx,'quantite_recue',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                    <td><input value={it.unite} onChange={e => updateItem(idx,'unite',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                    <td style={{textAlign:'center',fontWeight:600,color: ecart < 0 ? 'var(--red)' : ecart > 0 ? 'var(--orange)' : 'var(--green)'}}>{ecart !== 0 ? (ecart > 0 ? '+' : '') + ecart : '='}</td>
                                                    <td><input value={it.note || ''} onChange={e => updateItem(idx,'note',e.target.value)} placeholder="Note" style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                    <td><button onClick={() => { if (form.items.length > 1) setForm({...form, items: form.items.filter((_,i) => i !== idx)}); }} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td></tr>
                                                ); })}</tbody>
                                            </table>
                                            <button onClick={() => setForm({...form, items: [...form.items, {article:'',quantite_commandee:'',quantite_recue:'',unite:'kg',note:''}]})} style={{marginTop:8,background:'none',border:'1px dashed #ddd',borderRadius:8,padding:'6px 16px',cursor:'pointer',fontSize:12,color:'var(--blue)'}}>+ Ajouter ligne</button>
                                        </div>
                                        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                            <button onClick={() => setShowCreateForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                            <button onClick={handleCreateBL} disabled={creating} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:creating?'wait':'pointer',fontWeight:600,fontSize:13,opacity:creating?0.7:1}}>
                                                {creating ? 'Création...' : 'Créer le BL'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'history' && (
                        <div>
                            {historyLoading ? (
                                <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24,color:'var(--berry)'}}></i></div>
                            ) : history.length === 0 ? (
                                <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}>Aucun scan de BL enregistré.</div>
                            ) : (
                                <div className="table-responsive"><table className="data-table">
                                    <thead><tr><th>Date</th><th>Fichier</th><th>Fournisseur</th><th>N° BL</th><th>BDC matché</th><th>BL créé</th></tr></thead>
                                    <tbody>{history.map(s => (
                                        <tr key={s.id}>
                                            <td style={{fontSize:12}}>{new Date(s.created_at).toLocaleDateString('fr-FR')} {new Date(s.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</td>
                                            <td style={{fontSize:12}}><a href={s.scan_url} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)'}}>{s.scan_filename || 'scan'}</a></td>
                                            <td style={{fontWeight:600}}>{s.analysis?.fournisseur_nom || '—'}</td>
                                            <td style={{fontSize:12}}>{s.analysis?.numero_bl_fournisseur || '—'}</td>
                                            <td style={{fontSize:12}}>{s.matched_bdc_numero || '—'}</td>
                                            <td style={{fontSize:12,fontWeight:600,color:'var(--berry)'}}>{s.bl_numero || '—'}</td>
                                        </tr>
                                    ))}</tbody>
                                </table></div>
                            )}
                        </div>
                    )}
                </div>
            );
        }

export { AchatsScanBLTab };
