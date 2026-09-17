/*
 * MagBdcReceptionTab.jsx — Onglet magasinier "BDC à réceptionner" : réception
 * physique (BL) d'un bon de commande validé.
 *
 * La "réception libre" (sans BDC) a été retirée de cet onglet sur décision
 * d'Omar (2026-08 : « elle n'a pas de sens ») — elle faisait doublon avec le
 * bon d'entrée de l'onglet "Bons de Réception" (même action create-movement,
 * même payload reception_libre). Le chemin SERVEUR reste en place : les
 * réceptions libres déjà en base doivent rester lisibles dans l'Historique.
 *
 * Reliquat par article : le plafond de réception (reliquat = commandé − déjà
 * reçu) est calculé via shared/lib/bdcReceptionUtils.js (BdcReceptionUtils
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

import * as BdcReceptionUtils from '../shared/lib/bdcReceptionUtils.js';
import * as StockDestinations from '../shared/lib/stockDestinations.js';
import { useStockLocations } from '../shared/lib/useStockLocations.js';

var useState = React.useState;
var useEffect = React.useEffect;

function MagBdcReceptionTab({ currentProfile, profileData }) {
  // Magasins dérivés de la config stock (get-locations) — source unique, plus de hardcode.
  const MAGASINS = useStockLocations().magasins;
  // La destination d'une réception sur BDC est IMPOSÉE par la ferme du BDC
  // (décision produit) : resolveBdcDestination tranche « imposé » vs « libre »
  // (BDC mutualisé `ferme: 'Toutes'` ou sans ferme).
  // Pas de fallback si lib/stockDestinations.js manque : un échec visible vaut
  // mieux qu'une réception BAHIA imputée silencieusement à F1.
  const resolveBdcDest = StockDestinations.resolveBdcDestination;
  const resolveReceptionDest = StockDestinations.resolveReceptionDestination;
  const [bdcList, setBdcList] = useState([]);
  const [receptions, setReceptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bdcQuery, setBdcQuery] = useState('');
  const [selectedBdc, setSelectedBdc] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [blForm, setBlForm] = useState({ date_reception: '', numero_bl_fournisseur: '', magasin: MAGASINS[0] || '', items: [] });
  const [blFormError, setBlFormError] = useState(null);
  const [blScanFile, setBlScanFile] = useState(null);
  const [blScanPreview, setBlScanPreview] = useState(null);

  const loadData = () => {
      setLoading(true);
      // list-articles / list-suppliers ne sont plus chargés : ils n'alimentaient que
      // le formulaire de réception libre, retiré de cet onglet.
      Promise.all([
          fetch('/api/stock?action=list-bdc&status=valide_dg,envoye,virement_lance,virement_signe&limit=500').then(r => r.json()),
          fetch('/api/stock?action=list-movements&type=reception&limit=100').then(r => r.json()),
      ]).then(([bdcJson, movJson]) => {
          if (bdcJson.success) setBdcList((bdcJson.bdc || []).filter(b => ['valide_dg', 'envoye', 'virement_lance', 'virement_signe'].includes(b.status) && b.delivery_status !== 'complet'));
          if (movJson.success) setReceptions(movJson.movements || []);
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
      setBlForm({ date_reception: new Date().toISOString().split('T')[0], numero_bl_fournisseur: '', magasin: resolveBdcDest(MAGASINS, bdc.ferme).magasin, items: [] });
      setBlFormError(null);
      setBlScanFile(null); setBlScanPreview(null);
      setShowForm(true);
      // Reliquat par article : fetch les BL déjà créés pour ce BDC et calcule reçu/reliquat
      // via l'utilitaire partagé (même logique que AchatsBDCTab / MagBonsCommandeTab).
      fetch('/api/stock?action=list-bl&bdc_id=' + bdc.id).then(r => r.json()).then(json => {
          const resolved = BdcReceptionUtils.resolveDeliveryDataOrError(json);
          if (!resolved.ok) {
              // NE JAMAIS retomber sur reliquat = quantité commandée quand la donnée
              // est en fait indisponible (bug BDC-2026-0142) : on bloque la saisie
              // et on affiche l'erreur au magasinier, la garde serveur (create-bl)
              // reste la protection qui fait foi contre la sur-réception.
              setBlFormError(resolved.error);
              setBlForm(prev => ({ ...prev, items: [] }));
              return;
          }
          const delivery = BdcReceptionUtils.computeDeliveryData(bdc.items, resolved.data);
          const deliveryByArticle = {};
          delivery.forEach(d => { deliveryByArticle[d.article] = d; });
          const items = (bdc.items || []).map(it => {
              const d = deliveryByArticle[it.article];
              return {
                  article: it.article,
                  quantite_commandee: it.quantite,
                  quantite_deja_recue: d ? d.qLiv : 0,
                  reliquat: d ? d.reste : (parseFloat(it.quantite) || 0),
                  quantite_recue: '', unite: it.unite || '', note: '',
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
          ? BdcReceptionUtils.clampReceivedQty(value, items[idx].reliquat)
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
      // Destination recalculée à la soumission : quand elle est imposée, c'est
      // la ferme du BDC qui part au serveur, jamais un reliquat de state (la
      // config stock peut être arrivée après l'ouverture du formulaire).
      const destAtSubmit = resolveBdcDest(MAGASINS, selectedBdc.ferme);
      const magasinFinal = destAtSubmit.locked ? destAtSubmit.magasin : blForm.magasin;
      fetch('/api/stock?action=create-bl', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              bdc_id: selectedBdc.id, date_reception: blForm.date_reception,
              numero_bl_fournisseur: blForm.numero_bl_fournisseur, magasin: magasinFinal, items: validItems,
              scan_url: scanUrl,
              created_by: { profileId: currentProfile, name: profileData?.name || currentProfile, userId: profileData?.userId || '' },
          }),
      }).then(r => r.json()).then(json => {
          if (json.success) { alert(BdcReceptionUtils.buildReceptionCreatedMessage(json.reception_numero, json.valorisation)); setShowForm(false); setSelectedBdc(null); loadData(); }
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
                          {(() => {
                              // Destination IMPOSÉE uniquement pour une ferme à stock non
                              // mutualisé (BAHIA, entité juridique distincte) : champ en
                              // lecture seule — pas un select désactivé, qui laisserait
                              // croire à un choix. Partout ailleurs (F1..F6, Avocatier,
                              // BDC mutualisé), le choix reste libre.
                              const bdcDest = resolveBdcDest(MAGASINS, selectedBdc.ferme);
                              if (bdcDest.locked) {
                                  return (
                          <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Magasin destination</label>
                              <div style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',background:'#f8fafc',fontSize:13,display:'flex',alignItems:'center',gap:8}}>
                                  <i className="fa-solid fa-lock" style={{fontSize:11,color:'var(--gray-400)'}}></i>
                                  <span style={{fontWeight:700,color:'var(--berry)'}}>{bdcDest.magasin}</span>
                                  <span style={{fontSize:11,color:'var(--gray-400)'}}>imposé par le BDC</span>
                              </div>
                              {bdcDest.note && (
                                  <div style={{marginTop:4,fontSize:11,color:'var(--gray-400)',lineHeight:1.4}}>
                                      <i className="fa-solid fa-circle-info" style={{marginRight:4}}></i>{bdcDest.note}
                                  </div>
                              )}
                          </div>
                                  );
                              }
                              // Choix libre. Les options passent par resolveReceptionDestination
                              // pour que blForm.magasin corresponde toujours à une <option>
                              // rendue, y compris après la bascule fallback → vraie config de
                              // useStockLocations, et pour que la ferme du BDC reste proposée.
                              // fermePreselection vaut '' sur un BDC mutualisé : pas d'option
                              // « Toutes (hors config stock) » fabriquée à partir du fourre-tout.
                              const dest = resolveReceptionDest(MAGASINS, bdcDest.fermePreselection, blForm.magasin);
                              const showWarning = !!dest.warning;
                              return (
                          <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Magasin destination</label>
                              <select value={blForm.magasin} onChange={e => setBlForm({...blForm, magasin: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid ' + (showWarning ? '#b45309' : '#ddd'),fontSize:13}}>
                                  {dest.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                              {showWarning && (
                                  <div style={{marginTop:4,fontSize:11,color:'#b45309',lineHeight:1.4}}>
                                      <i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>{dest.warning}
                                  </div>
                              )}
                          </div>
                              );
                          })()}
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
                                          const ecart = BdcReceptionUtils.computeReceptionEcart(it.quantite_recue, it.reliquat, it.quantite_commandee);
                                          const noReliquat = !isNaN(reliquat) && reliquat <= 0;
                                          return (
                                              <tr key={idx}>
                                                  <td style={{fontWeight:600}}>{it.article}</td>
                                                  <td style={{textAlign:'center'}}>{it.quantite_commandee}</td>
                                                  <td style={{textAlign:'center',color:'var(--gray-400)'}}>{it.quantite_deja_recue ?? 0}</td>
                                                  <td style={{textAlign:'center',fontWeight:700,color: noReliquat ? 'var(--gray-400)' : 'var(--berry)'}}>{isNaN(reliquat) ? it.quantite_commandee : reliquat}</td>
                                                  <td><input type="number" value={it.quantite_recue} min="0" max={isNaN(reliquat) ? undefined : reliquat} disabled={noReliquat}
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
      </div>
  );
}

export { MagBdcReceptionTab };
