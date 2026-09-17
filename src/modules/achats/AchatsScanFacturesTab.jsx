/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: achats | Déclaration(s): AchatsScanFacturesTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

import * as ScanHistoryDisplay from '../shared/lib/scanHistoryDisplay.js';
// ===================== ACHATS: SCAN FACTURES TAB =====================
        function AchatsScanFacturesTab({ currentProfile, profileData }) {
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
            const [form, setForm] = useState({ numero_facture: '', date_facture: '', items: [] });
            const [creating, setCreating] = useState(false);
            const [history, setHistory] = useState([]);
            const [historyLoading, setHistoryLoading] = useState(true);
            const [tab, setTab] = useState('scan'); // 'scan' or 'history'

            useEffect(() => {
                fetch('/api/stock?action=list-bdc').then(r => r.json()).then(json => {
                    if (json.success) setBdcList((json.bdc || []).filter(b => ['valide_dg','envoye'].includes(b.status)));
                }).catch(() => {});
            }, []);

            const loadHistory = () => {
                setHistoryLoading(true);
                fetch('/api/stock?action=list-scan-history&type=facture&limit=50').then(r => r.json())
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
                fetch('/api/stock?action=scan-facture', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scan_base64: scanBase64, filename: scanFile?.name || 'scan.pdf', ferme: '', created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        setAnalysisResult(json.analysis);
                        setMatchedBdc(json.matched_bdc);
                        setScanId(json.scan_id);
                        setScanUrl(json.scan_url);
                        // Pre-populate form
                        if (json.analysis?.accepted) {
                            setForm({
                                numero_facture: json.analysis.numero_facture || '',
                                date_facture: json.analysis.date_facture || '',
                                items: (json.analysis.items || []).map(it => ({
                                    article: it.article || '', quantite: it.quantite || '', unite: it.unite || 'kg',
                                    prix_unitaire: it.prix_unitaire || '', taux_tva: it.taux_tva != null && it.taux_tva !== '' ? parseFloat(it.taux_tva) : 20,
                                })),
                            });
                            if (json.matched_bdc?.id) { setSelectedBdcId(json.matched_bdc.id); }
                        }
                    } else { alert('Erreur: ' + (json.error || 'Echec analyse')); }
                }).catch(() => alert('Erreur réseau'))
                .finally(() => setAnalysisLoading(false));
            };

            const selectBdcManual = (bdcId) => {
                setSelectedBdcId(bdcId);
                const bdc = bdcList.find(b => b.id === bdcId);
                setSelectedBdc(bdc || null);
            };

            const updateItem = (idx, field, value) => { const items = [...form.items]; items[idx] = { ...items[idx], [field]: value }; setForm({ ...form, items }); };
            const calcTotal = () => { let ht = 0, tva = 0; form.items.forEach(it => { const mht = (parseFloat(it.quantite) || 0) * (parseFloat(it.prix_unitaire) || 0); ht += mht; tva += mht * (it.taux_tva != null && it.taux_tva !== '' ? parseFloat(it.taux_tva) : 20) / 100; }); return { ht: Math.round(ht*100)/100, tva: Math.round(tva*100)/100, ttc: Math.round((ht+tva)*100)/100 }; };

            const handleCreateFacture = () => {
                if (!selectedBdcId) { alert('Sélectionnez un BDC'); return; }
                if (!form.numero_facture.trim()) { alert('Numéro de facture requis'); return; }
                const validItems = form.items.filter(i => i.article && i.quantite && i.prix_unitaire);
                if (!validItems.length) { alert('Ajoutez au moins un article'); return; }
                setCreating(true);
                fetch('/api/stock?action=create-facture', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bdc_id: selectedBdcId, numero_facture: form.numero_facture, date_facture: form.date_facture, items: validItems, scan_url: scanUrl, scan_id: scanId, created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        let msg = 'Facture ' + json.numero + ' créée depuis le scan !';
                        if (json.has_discrepancies) msg += '\n\nEcarts détectés:\n' + json.discrepancies.map(d => '- ' + d.article + ': ' + d.type + ' (BDC: ' + d.bdc_value + ' / Facture: ' + d.facture_value + ')').join('\n');
                        alert(msg);
                        setScanFile(null); setScanPreview(null); setScanBase64(null); setAnalysisResult(null); setMatchedBdc(null); setShowCreateForm(false); setScanId(null);
                    } else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau')).finally(() => setCreating(false));
            };

            const totals = calcTotal();

            return (
                <div className="fade-in">
                    <div style={{display:'flex',gap:8,marginBottom:16}}>
                        <button className={`chip c-berry ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>
                            <i className="fa-solid fa-file-import" style={{marginRight:4}}></i>Nouveau scan
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
                                onClick={() => document.getElementById('scan-facture-input').click()}
                            >
                                <input id="scan-facture-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{display:'none'}} onChange={e => handleFileSelect(e.target.files[0])} />
                                {!scanFile ? (
                                    <div>
                                        <i className="fa-solid fa-cloud-arrow-up" style={{fontSize:48,color:'var(--gray-300)',marginBottom:12,display:'block'}}></i>
                                        <p style={{color:'var(--gray-400)',margin:0,fontSize:14}}>Glissez-déposez une facture (PDF, JPEG, PNG) ou cliquez pour parcourir</p>
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
                                    {analysisResult.accepted ? (
                                        <div>
                                            <div style={{background:'rgba(39,174,96,0.08)',border:'1px solid rgba(39,174,96,0.3)',borderRadius:10,padding:16,marginBottom:16}}>
                                                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                                                    <i className="fa-solid fa-circle-check" style={{color:'var(--green)',fontSize:20}}></i>
                                                    <strong style={{color:'var(--green)',fontSize:15}}>Facture acceptée</strong>
                                                    {analysisResult.confidence && <span style={{marginLeft:'auto',fontSize:11,color:'var(--gray-400)'}}>Confiance: {Math.round(analysisResult.confidence * 100)}%</span>}
                                                </div>
                                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,fontSize:13}}>
                                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Fournisseur</span><br/><strong>{analysisResult.fournisseur?.nom || '—'}</strong>{analysisResult.fournisseur?.ice && <span style={{fontSize:10,color:'var(--gray-400)',display:'block'}}>ICE: {analysisResult.fournisseur.ice}</span>}</div>
                                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>N° Facture</span><br/><strong>{analysisResult.numero_facture || '—'}</strong></div>
                                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Date</span><br/><strong>{analysisResult.date_facture || '—'}</strong></div>
                                                </div>
                                                {(analysisResult.items || []).length > 0 && (
                                                    <div style={{marginTop:12,overflowX:'auto'}}>
                                                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                            <thead><tr style={{background:'rgba(39,174,96,0.06)'}}><th style={{padding:'4px 8px',textAlign:'left'}}>Article</th><th style={{padding:'4px 8px'}}>Qté</th><th style={{padding:'4px 8px'}}>PU</th><th style={{padding:'4px 8px'}}>TVA</th><th style={{padding:'4px 8px'}}>Montant HT</th></tr></thead>
                                                            <tbody>{(analysisResult.items || []).map((it, i) => (
                                                                <tr key={i}><td style={{padding:'4px 8px'}}>{it.article}</td><td style={{padding:'4px 8px',textAlign:'center'}}>{it.quantite} {it.unite || ''}</td><td style={{padding:'4px 8px',textAlign:'right'}}>{(it.prix_unitaire||0).toLocaleString('fr-FR')}</td><td style={{padding:'4px 8px',textAlign:'center'}}>{it.taux_tva||20}%</td><td style={{padding:'4px 8px',textAlign:'right',fontWeight:600}}>{(it.montant_ht||0).toLocaleString('fr-FR',{minimumFractionDigits:2})}</td></tr>
                                                            ))}</tbody>
                                                        </table>
                                                    </div>
                                                )}
                                                <div style={{textAlign:'right',marginTop:8,fontSize:14}}>
                                                    <span>HT: <strong>{(analysisResult.total_ht||0).toLocaleString('fr-FR',{minimumFractionDigits:2})} MAD</strong></span>
                                                    <span style={{margin:'0 12px'}}>TVA: <strong>{(analysisResult.total_tva||0).toLocaleString('fr-FR',{minimumFractionDigits:2})} MAD</strong></span>
                                                    <span style={{fontSize:16,color:'var(--berry)',fontWeight:700}}>TTC: {(analysisResult.total_ttc||0).toLocaleString('fr-FR',{minimumFractionDigits:2})} MAD</span>
                                                </div>
                                            </div>

                                            {/* BDC Match */}
                                            {matchedBdc && (
                                                <div style={{background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.2)',borderRadius:10,padding:12,marginBottom:16,fontSize:13}}>
                                                    <i className="fa-solid fa-link" style={{marginRight:6,color:'var(--blue)'}}></i>
                                                    <strong>BDC suggéré:</strong> {matchedBdc.numero} — {matchedBdc.fournisseur_nom} — {(matchedBdc.total_ttc||0).toLocaleString('fr-FR')} MAD
                                                    <span style={{marginLeft:8,fontSize:11,color: matchedBdc.confidence === 'high' ? 'var(--green)' : matchedBdc.confidence === 'medium' ? 'var(--orange)' : 'var(--red)'}}>
                                                        ({matchedBdc.confidence === 'high' ? 'Correspondance forte' : matchedBdc.confidence === 'medium' ? 'Correspondance moyenne' : 'Correspondance faible'} — écart {matchedBdc.ecart_pct}%)
                                                    </span>
                                                </div>
                                            )}

                                            <div style={{textAlign:'center'}}>
                                                <button onClick={() => setShowCreateForm(true)} style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',cursor:'pointer',fontWeight:600,fontSize:14}}>
                                                    <i className="fa-solid fa-file-circle-plus" style={{marginRight:8}}></i>Créer la facture
                                                </button>
                                                <button onClick={() => { setScanFile(null); setScanPreview(null); setScanBase64(null); setAnalysisResult(null); setMatchedBdc(null); }}
                                                    style={{marginLeft:12,background:'#fff',color:'var(--gray-500)',border:'1px solid #ddd',borderRadius:8,padding:'10px 24px',cursor:'pointer',fontSize:14}}>
                                                    <i className="fa-solid fa-rotate" style={{marginRight:6}}></i>Nouveau scan
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{background:'rgba(231,76,60,0.08)',border:'1px solid rgba(231,76,60,0.3)',borderRadius:10,padding:16}}>
                                            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                                                <i className="fa-solid fa-circle-xmark" style={{color:'var(--red)',fontSize:20}}></i>
                                                <strong style={{color:'var(--red)',fontSize:15}}>Facture rejetée</strong>
                                            </div>
                                            <p style={{margin:0,fontSize:13,color:'#555'}}>{analysisResult.rejection_reason || 'Berry Good Farms non identifié comme client sur cette facture.'}</p>
                                            <button onClick={() => { setScanFile(null); setScanPreview(null); setScanBase64(null); setAnalysisResult(null); }}
                                                style={{marginTop:12,background:'#fff',border:'1px solid #ddd',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontSize:13}}>
                                                <i className="fa-solid fa-rotate" style={{marginRight:6}}></i>Essayer un autre document
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Create Invoice Form */}
                            {showCreateForm && analysisResult?.accepted && (
                                <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowCreateForm(false); }}>
                                    <div className="modal-content" style={{maxWidth:750,maxHeight:'90vh',overflowY:'auto'}}>
                                        <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-file-invoice-dollar" style={{marginRight:8}}></i>Créer facture depuis scan</h3>
                                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>BDC *</label>
                                                <select value={selectedBdcId} onChange={e => selectBdcManual(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                                    <option value="">-- Sélectionner un BDC --</option>
                                                    {bdcList.map(b => <option key={b.id} value={b.id}>{b.numero} - {b.fournisseur?.nom || '?'} ({(b.total_ttc||0).toLocaleString()} MAD)</option>)}
                                                </select></div>
                                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>N° Facture Fournisseur *</label>
                                                <input value={form.numero_facture} onChange={e => setForm({...form, numero_facture: e.target.value})} placeholder="N° facture" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date facture</label>
                                                <input type="date" value={form.date_facture} onChange={e => setForm({...form, date_facture: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                        </div>

                                        {scanUrl && <div style={{background:'rgba(139,34,82,0.05)',border:'1px solid rgba(139,34,82,0.15)',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:12}}>
                                            <i className="fa-solid fa-paperclip" style={{marginRight:6,color:'var(--berry)'}}></i>
                                            Scan attaché: <a href={scanUrl} target="_blank" rel="noopener noreferrer" style={{color:'var(--berry)'}}>{scanFile?.name || 'Voir le scan'}</a>
                                        </div>}

                                        <h4 style={{fontSize:13,marginBottom:8}}>Articles (pré-remplis par l'IA)</h4>
                                        <div style={{overflowX:'auto'}}>
                                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                <thead><tr style={{background:'#f8f8f8'}}><th style={{padding:'6px 8px',textAlign:'left'}}>Article</th><th style={{padding:'6px 8px',width:80}}>Qté</th><th style={{padding:'6px 8px',width:70}}>Unité</th><th style={{padding:'6px 8px',width:90}}>PU (MAD)</th><th style={{padding:'6px 8px',width:70}}>TVA %</th><th style={{padding:'6px 8px',width:100}}>Montant HT</th><th style={{width:30}}></th></tr></thead>
                                                <tbody>{form.items.map((it, idx) => { const mht = (parseFloat(it.quantite)||0)*(parseFloat(it.prix_unitaire)||0); return (
                                                    <tr key={idx}><td><input value={it.article} onChange={e => updateItem(idx,'article',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                    <td><input type="number" value={it.quantite} onChange={e => updateItem(idx,'quantite',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                    <td><input value={it.unite} onChange={e => updateItem(idx,'unite',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                    <td><input type="number" value={it.prix_unitaire} onChange={e => updateItem(idx,'prix_unitaire',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                    <td><select value={it.taux_tva} onChange={e => updateItem(idx,'taux_tva',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}}>{[0,7,10,14,20].map(t => <option key={t} value={t}>{t}%</option>)}</select></td>
                                                    <td style={{fontWeight:600,textAlign:'right',padding:'4px 8px'}}>{mht.toFixed(2)}</td>
                                                    <td><button onClick={() => { if (form.items.length > 1) setForm({...form, items: form.items.filter((_,i) => i !== idx)}); }} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td></tr>
                                                ); })}</tbody>
                                            </table>
                                            <button onClick={() => setForm({...form, items: [...form.items, {article:'',quantite:'',unite:'kg',prix_unitaire:'',taux_tva:20}]})} style={{marginTop:8,background:'none',border:'1px dashed #ddd',borderRadius:8,padding:'6px 16px',cursor:'pointer',fontSize:12,color:'var(--blue)'}}>+ Ajouter ligne</button>
                                        </div>
                                        <div style={{textAlign:'right',marginTop:12,fontSize:14}}>
                                            <div>Total HT: <strong>{totals.ht.toLocaleString('fr-FR',{minimumFractionDigits:2})} MAD</strong></div>
                                            <div>TVA: <strong>{totals.tva.toLocaleString('fr-FR',{minimumFractionDigits:2})} MAD</strong></div>
                                            <div style={{fontSize:18,color:'var(--berry)',fontWeight:700}}>TTC: {totals.ttc.toLocaleString('fr-FR',{minimumFractionDigits:2})} MAD</div>
                                        </div>
                                        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                            <button onClick={() => setShowCreateForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                            <button onClick={handleCreateFacture} disabled={creating} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:creating?'wait':'pointer',fontWeight:600,fontSize:13,opacity:creating?0.7:1}}>
                                                {creating ? 'Création...' : 'Créer la facture'}
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
                                <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}>Aucun scan de facture enregistré.</div>
                            ) : (
                                <div className="table-responsive"><table className="data-table">
                                    <thead><tr><th>Date</th><th>Fichier</th><th>Statut</th><th>Fournisseur</th><th>Montant TTC</th><th>BDC matché</th><th>Facture créée</th></tr></thead>
                                    <tbody>{history.map(s => (
                                        <tr key={s.id}>
                                            <td style={{fontSize:12}}>{new Date(s.created_at).toLocaleDateString('fr-FR')} {new Date(s.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</td>
                                            <td style={{fontSize:12}}><a href={s.scan_url} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)'}}>{s.scan_filename || 'scan'}</a></td>
                                            <td><span className={'status-badge ' + (s.status === 'accepted' ? 'valide' : 'rejete')}>{s.status === 'accepted' ? 'Acceptée' : 'Rejetée'}</span></td>
                                            <td style={{fontWeight:600}}>{ScanHistoryDisplay.scanFournisseurLabel(s)}</td>
                                            <td>{(() => { const ttc = ScanHistoryDisplay.scanTtc(s); return ttc != null ? ttc.toLocaleString('fr-FR',{minimumFractionDigits:2}) + ' MAD' : '—'; })()}</td>
                                            <td style={{fontSize:12}}>{ScanHistoryDisplay.scanBdcMatche(s)}</td>
                                            <td style={{fontSize:12,fontWeight:600,color:'var(--berry)'}}>{s.invoice_numero || '—'}</td>
                                        </tr>
                                    ))}</tbody>
                                </table></div>
                            )}
                        </div>
                    )}
                </div>
            );
        }

export { AchatsScanFacturesTab };
