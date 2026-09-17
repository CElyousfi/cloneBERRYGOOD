/* Module: agronomie | Déclaration(s): AgroSurveillanceTab */
import { FARMS } from '../shared/FARMS.jsx';
import { FARM_NAMES } from '../shared/FARM_NAMES.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { MapRenderer } from '../technique/MapRenderer.jsx';

function AgroSurveillanceTab({ ferme, currentProfile, profileData }) {
            const [loading, setLoading] = useState(false);
            const [submitting, setSubmitting] = useState(false);
            const [allAnalyses, setAllAnalyses] = useState([]);
            const [observations, setObservations] = useState([]);
            const [selectedFerme, setSelectedFerme] = useState(ferme || FARMS[0]);
            const [varieteInput, setVarieteInput] = useState('');
            const [note, setNote] = useState('');
            const [photos, setPhotos] = useState([]); // [{dataUrl, caption, file, location}]
            const [photoZoom, setPhotoZoom] = useState(null);
            const [photoZoomList, setPhotoZoomList] = useState([]);
            const [photoZoomIdx, setPhotoZoomIdx] = useState(0);
            const [currentLocation, setCurrentLocation] = useState(null);
            const fileRef = React.useRef(null);
            const mapRef = React.useRef(null);
            const mapInstanceRef = React.useRef(null);

            const load = () => {
                setLoading(true);
                fetch('/api/stock?action=list-analyses-foliaires' + (selectedFerme ? '&ferme=' + selectedFerme : ''))
                    .then(r => r.json()).then(j => {
                        if (j.success) {
                            const all = j.analyses || [];
                            setAllAnalyses(all);
                            setObservations(all.filter(a => a.type_analyse === 'observation_terrain').sort((a, b) => (b.created_at || 0) - (a.created_at || 0)));
                        }
                    }).catch(() => {}).finally(() => setLoading(false));
            };
            useEffect(() => { load(); }, [selectedFerme]);

            // Toutes les variétés connues pour cette ferme (analyses labo + observations)
            const knownVarietes = [...new Set(allAnalyses.map(a => a.variete).filter(Boolean))].sort();

            const requestGeolocation = () => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(
                    pos => setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
                    err => console.warn('Géoloc indisponible:', err.message),
                    { enableHighAccuracy: true, timeout: 10000 }
                );
            };

            const haversine = (lat1, lon1, lat2, lon2) => {
                const R = 6371000;
                const dLat = (lat2-lat1) * Math.PI/180;
                const dLon = (lon2-lon1) * Math.PI/180;
                const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
                return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            };

            const handleFileChange = (e) => {
                const files = Array.from(e.target.files || []);
                const remaining = 5 - photos.length;
                requestGeolocation();
                files.slice(0, remaining).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = () => setPhotos(prev => [...prev, { dataUrl: reader.result, caption: '', file, location: currentLocation }]);
                    reader.readAsDataURL(file);
                });
                if (fileRef.current) fileRef.current.value = '';
            };

            const removePhoto = (idx) => setPhotos(prev => prev.filter((_, i) => i !== idx));
            const setCaptionAt = (idx, val) => setPhotos(prev => prev.map((p, i) => i === idx ? { ...p, caption: val } : p));

            const handleSubmit = async () => {
                if (!varieteInput.trim() || varieteInput === '__autre__') return alert('Sélectionne ou saisis une variété');
                if (!photos.length) return alert('Ajoute au moins 1 photo');

                // Témoin check: compare current GPS with previous observations of same variété
                const loc = photos.find(p => p.location)?.location || currentLocation;
                if (loc) {
                    const prevObs = observations.filter(o => o.variete === varieteInput.trim() && o.location);
                    if (prevObs.length > 0) {
                        const avgLat = prevObs.reduce((s, o) => s + o.location.lat, 0) / prevObs.length;
                        const avgLng = prevObs.reduce((s, o) => s + o.location.lng, 0) / prevObs.length;
                        const dist = Math.round(haversine(loc.lat, loc.lng, avgLat, avgLng));
                        if (dist > 15) {
                            const ok = confirm(`Position GPS à ${dist}m du témoin habituel ${varieteInput.trim()} (${selectedFerme}).\n\nContinuer quand même ?`);
                            if (!ok) return;
                        }
                    }
                }

                setSubmitting(true);
                try {
                    const resp = await fetch('/api/stock?action=create-observation-terrain', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ferme: selectedFerme,
                            variete: varieteInput.trim(),
                            culture: null,
                            note,
                            photos: photos.map(p => ({ base64: p.dataUrl, caption: p.caption, location: p.location || currentLocation || null })),
                            created_by: { profileId: currentProfile, name: profileData?.name || currentProfile },
                        }),
                    });
                    const j = await resp.json();
                    if (j.success) {
                        setPhotos([]);
                        setNote('');
                        setVarieteInput('');
                        load();
                    } else {
                        alert('Erreur : ' + (j.error || 'inconnue'));
                    }
                } catch (e) {
                    alert('Erreur réseau : ' + e.message);
                } finally {
                    setSubmitting(false);
                }
            };

            const openZoom = (urls, idx) => {
                setPhotoZoomList(urls);
                setPhotoZoomIdx(idx);
                setPhotoZoom(urls[idx]);
            };

            const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—';

            return (
                <div className="fade-in" style={{maxWidth:800,margin:'0 auto'}}>
                    <div style={{background:'#fff',borderRadius:14,boxShadow:'0 1px 3px rgba(0,0,0,0.04)',overflow:'hidden',marginBottom:20}}>
                        <div style={{background:'linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%)',padding:'20px 24px',color:'#fff'}}>
                            <div style={{fontSize:18,fontWeight:700,display:'flex',alignItems:'center',gap:10}}>
                                <i className="fa-solid fa-camera"/> Surveillance Agro
                            </div>
                            <div style={{fontSize:12,opacity:0.85,marginTop:4}}>Photographiez l'état des plantes et fruits pour enrichir les rapports IA</div>
                        </div>
                        <div style={{padding:'20px 24px'}}>
                            <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
                                <div style={{flex:1,minWidth:140}}>
                                    <label style={{fontSize:11,fontWeight:700,color:'#6b7280',display:'block',marginBottom:4}}>Ferme *</label>
                                    <select value={selectedFerme} onChange={e => setSelectedFerme(e.target.value)} style={{width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #e5e7eb',fontSize:13}}>
                                        {FARMS.map(f => <option key={f} value={f}>{f} — {FARM_NAMES[f] || f}</option>)}
                                    </select>
                                </div>
                                <div style={{flex:1,minWidth:180}}>
                                    <label style={{fontSize:11,fontWeight:700,color:'#6b7280',display:'block',marginBottom:4}}>Variété *</label>
                                    {varieteInput === '__autre__' ? (
                                        <div style={{display:'flex',gap:6}}>
                                            <input autoFocus value="" onChange={e => setVarieteInput(e.target.value)} placeholder="Nom de la variété…" style={{flex:1,padding:'9px 12px',borderRadius:8,border:'1px solid #e5e7eb',fontSize:13,boxSizing:'border-box'}} />
                                            <button onClick={() => setVarieteInput('')} style={{padding:'6px 10px',borderRadius:8,border:'1px solid #e5e7eb',background:'#fff',fontSize:11,cursor:'pointer',color:'#6b7280'}}>Annuler</button>
                                        </div>
                                    ) : knownVarietes.length > 0 ? (
                                        <select value={varieteInput} onChange={e => setVarieteInput(e.target.value)} style={{width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #e5e7eb',fontSize:13}}>
                                            <option value="">— Choisir —</option>
                                            {knownVarietes.map(v => <option key={v} value={v}>{v}</option>)}
                                            <option value="__autre__">+ Autre variété…</option>
                                        </select>
                                    ) : (
                                        <input value={varieteInput} onChange={e => setVarieteInput(e.target.value)} placeholder="Nom de la variété…" style={{width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #e5e7eb',fontSize:13,boxSizing:'border-box'}} />
                                    )}
                                </div>
                            </div>
                            <div style={{marginBottom:16}}>
                                <label style={{fontSize:11,fontWeight:700,color:'#6b7280',display:'block',marginBottom:4}}>Note / observation (optionnel)</label>
                                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Ex : Chlorose sur feuilles basses après pluie" style={{width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #e5e7eb',fontSize:13,boxSizing:'border-box'}} />
                            </div>
                            <label style={{fontSize:11,fontWeight:700,color:'#6b7280',display:'block',marginBottom:8}}>Photos ({photos.length}/5)</label>
                            <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
                                {photos.map((p, i) => (
                                    <div key={i} style={{width:110,flexShrink:0}}>
                                        <div style={{width:110,height:110,borderRadius:10,overflow:'hidden',position:'relative',border:'1px solid #e5e7eb',cursor:'pointer'}} onClick={() => openZoom(photos.map(x => x.dataUrl), i)}>
                                            <img src={p.dataUrl} style={{width:'100%',height:'100%',objectFit:'cover'}} />
                                            <button onClick={(e) => { e.stopPropagation(); removePhoto(i); }} style={{position:'absolute',top:4,right:4,width:22,height:22,borderRadius:'50%',background:'rgba(0,0,0,0.5)',color:'#fff',border:'none',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
                                            <div style={{position:'absolute',bottom:4,left:4,width:18,height:18,borderRadius:'50%',background: (p.location || currentLocation) ? '#16a34a' : '#9ca3af',display:'flex',alignItems:'center',justifyContent:'center',border:'2px solid #fff'}}>
                                                <i className="fa-solid fa-location-dot" style={{fontSize:8,color:'#fff'}}/>
                                            </div>
                                        </div>
                                        <input value={p.caption} onChange={e => setCaptionAt(i, e.target.value)} placeholder="Légende…" style={{width:'100%',marginTop:4,padding:'4px 6px',borderRadius:6,border:'1px solid #e5e7eb',fontSize:10,boxSizing:'border-box'}} />
                                    </div>
                                ))}
                                {photos.length < 5 && (
                                    <div onClick={() => fileRef.current?.click()} style={{width:110,height:110,borderRadius:10,border:'2px dashed #d8b4fe',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',background:'#faf5ff',gap:4}}>
                                        <i className="fa-solid fa-camera" style={{fontSize:24,color:'#8B5CF6'}}/>
                                        <span style={{fontSize:10,color:'#8B5CF6',fontWeight:600}}>Ajouter</span>
                                    </div>
                                )}
                                <input type="file" accept="image/*" multiple ref={fileRef} onChange={handleFileChange} style={{display:'none'}} />
                            </div>
                            <button onClick={handleSubmit} disabled={submitting || !photos.length || !varieteInput.trim()} style={{width:'100%',padding:'12px',background: submitting ? '#d8b4fe' : 'linear-gradient(135deg,#7c3aed,#5b21b6)',color:'#fff',border:'none',borderRadius:10,fontWeight:700,fontSize:13,cursor: submitting ? 'wait' : 'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                                {submitting ? <><i className="fa-solid fa-spinner fa-spin"/>Envoi en cours…</> : <><i className="fa-solid fa-paper-plane"/>Envoyer les photos</>}
                            </button>
                        </div>
                    </div>

                    {/* ========== Leaflet Map ========== */}
                    {(() => {
                        const geoObs = observations.filter(o => o.location && o.location.lat);
                        const filteredGeo = varieteInput ? geoObs.filter(o => o.variete === varieteInput) : geoObs;
                        if (filteredGeo.length === 0 && !currentLocation) return null;
                        return (
                            <div style={{background:'#fff',borderRadius:14,boxShadow:'0 1px 3px rgba(0,0,0,0.04)',overflow:'hidden',marginBottom:20}}>
                                <div style={{padding:'14px 24px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:8}}>
                                    <i className="fa-solid fa-map-location-dot" style={{color:'#8B5CF6'}}/>
                                    <span style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>Carte des observations</span>
                                    {currentLocation && (
                                        <span style={{fontSize:10,color:'#16a34a',marginLeft:'auto',display:'flex',alignItems:'center',gap:4}}>
                                            <i className="fa-solid fa-location-dot"/>GPS actif ({currentLocation.accuracy}m)
                                        </span>
                                    )}
                                </div>
                                <div ref={mapRef} style={{height:320}} />
                                <MapRenderer mapRef={mapRef} mapInstanceRef={mapInstanceRef} observations={filteredGeo} currentLocation={currentLocation} haversine={haversine} />
                            </div>
                        );
                    })()}

                    <div style={{background:'#fff',borderRadius:14,boxShadow:'0 1px 3px rgba(0,0,0,0.04)',overflow:'hidden'}}>
                        <div style={{padding:'16px 24px',borderBottom:'1px solid #f1f5f9'}}>
                            <div style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>Historique des observations — {selectedFerme}</div>
                        </div>
                        {loading ? (
                            <div style={{padding:40,textAlign:'center',color:'#9ca3af'}}><i className="fa-solid fa-spinner fa-spin"/> Chargement…</div>
                        ) : observations.length === 0 ? (
                            <div style={{padding:40,textAlign:'center',color:'#9ca3af',fontSize:13}}>Aucune observation terrain pour cette ferme.</div>
                        ) : (
                            <div>
                                {observations.map(obs => (
                                    <div key={obs.id} style={{padding:'14px 24px',borderBottom:'1px solid #f8f9fa',display:'flex',alignItems:'center',gap:14}}>
                                        <div style={{display:'flex',gap:4,flexShrink:0}}>
                                            {(obs.photo_urls || []).slice(0, 3).map((p, i) => (
                                                <div key={i} style={{width:48,height:48,borderRadius:8,overflow:'hidden',border:'1px solid #e5e7eb',cursor:'pointer'}} onClick={() => openZoom((obs.photo_urls || []).map(x => x.url), i)}>
                                                    <img src={p.url} style={{width:'100%',height:'100%',objectFit:'cover'}} />
                                                </div>
                                            ))}
                                            {(obs.photo_urls || []).length > 3 && (
                                                <div style={{width:48,height:48,borderRadius:8,background:'#f5f3ff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#7c3aed'}}>
                                                    +{obs.photo_urls.length - 3}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{flex:1,minWidth:0}}>
                                            <div style={{fontSize:13,fontWeight:600,color:'#1e293b'}}>{obs.variete || '—'}</div>
                                            <div style={{fontSize:11,color:'#6b7280',marginTop:2}}>
                                                {fmtDate(obs.date_analyse || obs.created_at)} · {(obs.photo_urls || []).length} photo(s){obs.note_demande ? ` · "${obs.note_demande.slice(0, 60)}"` : ''}
                                            </div>
                                        </div>
                                        <div style={{fontSize:10,color:'#9ca3af'}}>{obs.created_by?.name || ''}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {photoZoom && (
                        <div className="modal-overlay" onClick={() => setPhotoZoom(null)} style={{zIndex:9999,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                            <button onClick={(e) => { e.stopPropagation(); setPhotoZoom(null); }} style={{position:'absolute',top:20,right:20,background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',borderRadius:'50%',width:40,height:40,cursor:'pointer',fontSize:20,display:'flex',alignItems:'center',justifyContent:'center',zIndex:10}}>
                                <i className="fa-solid fa-xmark"/>
                            </button>
                            {photoZoomList.length > 1 && photoZoomIdx > 0 && (
                                <button onClick={(e) => { e.stopPropagation(); const ni = photoZoomIdx - 1; setPhotoZoomIdx(ni); setPhotoZoom(photoZoomList[ni]); }} style={{position:'absolute',left:20,top:'50%',transform:'translateY(-50%)',background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',borderRadius:'50%',width:44,height:44,cursor:'pointer',fontSize:20,zIndex:10}}>
                                    <i className="fa-solid fa-chevron-left"/>
                                </button>
                            )}
                            {photoZoomList.length > 1 && photoZoomIdx < photoZoomList.length - 1 && (
                                <button onClick={(e) => { e.stopPropagation(); const ni = photoZoomIdx + 1; setPhotoZoomIdx(ni); setPhotoZoom(photoZoomList[ni]); }} style={{position:'absolute',right:20,top:'50%',transform:'translateY(-50%)',background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',borderRadius:'50%',width:44,height:44,cursor:'pointer',fontSize:20,zIndex:10}}>
                                    <i className="fa-solid fa-chevron-right"/>
                                </button>
                            )}
                            <img src={photoZoom} onClick={e => e.stopPropagation()} style={{maxWidth:'90vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} />
                            <div style={{position:'absolute',bottom:20,color:'#fff',fontSize:12,opacity:0.7}}>{photoZoomIdx + 1} / {photoZoomList.length}</div>
                        </div>
                    )}
                </div>
            );
        }

export { AgroSurveillanceTab };
