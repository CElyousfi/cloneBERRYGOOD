/* Module: agronomie | Déclaration(s): AgroParcellesTab */
import { useState } from '../shared/reactHooks.jsx';
import { displayCulture } from './displayCulture.jsx';

function AgroParcellesTab({ data, getAlias, updateAlias, parcAliases, parcFermes, updateFerme }) {
            const agro = data.agroData;
            const parc = agro.parcelles;
            const totalHa = parc.reduce((s,p) => s + p.sup, 0);
            const [editing, setEditing] = useState(null);
            const [editValue, setEditValue] = useState('');
            const [sqlParcelles, setSqlParcelles] = useState(null);
            const [sqlStatus, setSqlStatus] = useState('idle');
            const fermeOptions = ['F1','F2','F3','F4','F5','F6','BAHIA'];

            // Fetch parcelles depuis Firestore cache
            React.useEffect(() => {
                setSqlStatus('loading');
                fetch('/api/parcelles')
                    .then(r => r.json())
                    .then(json => {
                        if (json.success && json.parcelles && json.parcelles.length > 0) {
                            setSqlParcelles(json.parcelles);
                            setSqlStatus('ok');
                        } else { setSqlStatus('error'); }
                    })
                    .catch(() => { setSqlStatus('error'); });
            }, []);

            const startEdit = (parcName) => {
                setEditing(parcName);
                setEditValue(getAlias(parcName));
            };
            const saveEdit = (parcName) => {
                updateAlias(parcName, editValue);
                setEditing(null);
            };
            const cancelEdit = () => { setEditing(null); };

            const aliasCount = Object.keys(parcAliases || {}).length;

            return (
                <div className="fade-in">
                    {/* Info barre */}
                    <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
                        {sqlStatus === 'ok' && <span style={{background:'#d4edda',color:'#155724',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}><i className="fa-solid fa-database" style={{marginRight:4}}></i>Firestore Cache — {sqlParcelles ? sqlParcelles.length : 0} parcelles</span>}
                        {sqlStatus === 'loading' && <span style={{background:'#fff3cd',color:'#856404',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}><i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i>Chargement SQL...</span>}
                        {sqlStatus === 'error' && <span style={{background:'#f8d7da',color:'#721c24',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}><i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>API non connectée — données locales</span>}
                        {aliasCount > 0 && <span style={{background:'#E3F2FD',color:'#1565C0',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}><i className="fa-solid fa-pen" style={{marginRight:4}}></i>{aliasCount} parcelle(s) renommée(s)</span>}
                        <div style={{marginLeft:'auto',fontSize:12,color:'var(--gray-400)'}}>
                            {parc.length} parcelles — {totalHa.toFixed(1)} Ha
                        </div>
                    </div>

                    {/* Tableau SQL */}
                    {sqlStatus === 'ok' && sqlParcelles && (
                        <div className="panel" style={{marginBottom:16}}>
                            <h3><i className="fa-solid fa-database"></i> Parcelles — BR_Consommation</h3>
                            <div style={{fontSize:11,color:'var(--gray-400)',marginBottom:12}}>
                                <i className="fa-solid fa-pen" style={{marginRight:4}}></i>Cliquez sur l'icone <i className="fa-solid fa-pen-to-square"></i> pour renommer une parcelle. Le nouveau nom sera utilisé dans tous les onglets.
                            </div>
                            <div className="table-responsive"><table>
                                <thead><tr>
                                    <th style={{minWidth:200}}>Nom SQL</th>
                                    <th style={{minWidth:200}}>Nom affiché</th>
                                    <th>Culture</th><th>Ferme</th><th>Sup (Ha)</th><th>Nb Produits</th><th>Engrais (kg)</th><th>Pesticides (kg)</th><th>Début</th><th>Fin</th>
                                </tr></thead>
                                <tbody>
                                    {sqlParcelles.map((sp, i) => {
                                        const origName = sp.Parcelle_Physique;
                                        const isEditing = editing === origName;
                                        const alias = getAlias(origName);
                                        const isRenamed = alias !== origName;
                                        return (
                                            <tr key={i} style={isRenamed ? {background:'#E3F2FD'} : {}}>
                                                <td style={{fontSize:11,color:'#999',fontFamily:'monospace'}}>{origName}</td>
                                                <td>
                                                    {isEditing ? (
                                                        <div style={{display:'flex',gap:4,alignItems:'center'}}>
                                                            <input value={editValue} onChange={e => setEditValue(e.target.value)}
                                                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(origName); if (e.key === 'Escape') cancelEdit(); }}
                                                                autoFocus
                                                                style={{flex:1,padding:'4px 8px',borderRadius:6,border:'2px solid #1565C0',fontSize:12,fontWeight:600}} />
                                                            <button onClick={() => saveEdit(origName)} style={{background:'#2D8B4E',color:'#fff',border:'none',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:11,fontWeight:700}}>
                                                                <i className="fa-solid fa-check"></i>
                                                            </button>
                                                            <button onClick={cancelEdit} style={{background:'#eee',color:'#666',border:'none',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:11}}>
                                                                <i className="fa-solid fa-xmark"></i>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                                                            <strong style={{fontSize:12,color: isRenamed ? '#1565C0' : '#333'}}>{alias}</strong>
                                                            <button onClick={() => startEdit(origName)} title="Renommer"
                                                                style={{background:'none',border:'none',cursor:'pointer',color:'#999',fontSize:11,padding:'2px 4px',borderRadius:4,transition:'color 0.2s'}}
                                                                onMouseEnter={e => e.target.style.color='#1565C0'} onMouseLeave={e => e.target.style.color='#999'}>
                                                                <i className="fa-solid fa-pen-to-square"></i>
                                                            </button>
                                                            {isRenamed && <button onClick={() => { updateAlias(origName, origName); }} title="Réinitialiser"
                                                                style={{background:'none',border:'none',cursor:'pointer',color:'#E74C3C',fontSize:10,padding:'2px 4px'}}>
                                                                <i className="fa-solid fa-rotate-left"></i>
                                                            </button>}
                                                        </div>
                                                    )}
                                                </td>
                                                <td>{displayCulture(sp.Culture)}</td>
                                                <td>
                                                    <select value={parcFermes[origName] || ''} onChange={e => updateFerme(origName, e.target.value)}
                                                        style={{padding:'3px 6px',borderRadius:6,border:'1px solid #ddd',fontSize:11,fontWeight:600,background: parcFermes[origName] ? '#E3F2FD' : '#fff',color: parcFermes[origName] ? '#1565C0' : '#666',cursor:'pointer'}}>
                                                        <option value="">{sp.Ferme}</option>
                                                        {fermeOptions.map(f => <option key={f} value={f}>{f}</option>)}
                                                    </select>
                                                </td>
                                                <td style={{textAlign:'center',fontWeight:600}}>{sp.Sup || '—'}</td>
                                                <td style={{textAlign:'center'}}>{sp.NbProduits}</td>
                                                <td style={{fontWeight:600}}>{Math.round(sp.TotalEngrais || 0).toLocaleString()}</td>
                                                <td>{(sp.TotalPesticides || 0).toFixed(1)}</td>
                                                <td style={{fontSize:11}}>{sp.Debut ? new Date(sp.Debut).toLocaleDateString('fr-FR') : '—'}</td>
                                                <td style={{fontSize:11}}>{sp.Fin ? new Date(sp.Fin).toLocaleDateString('fr-FR') : '—'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table></div>
                        </div>
                    )}

                </div>
            );
        }

export { AgroParcellesTab };
