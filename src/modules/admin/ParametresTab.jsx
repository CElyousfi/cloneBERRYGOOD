/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: admin | Déclaration(s): ParametresTab */
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { BaremesPaiePanel } from './BaremesPaiePanel.jsx';
import { JoursFeriesConfigPanel } from './JoursFeriesConfigPanel.jsx';
import { SousTraitantsConfigPanel } from './SousTraitantsConfigPanel.jsx';

function ParametresTab({ data }) {
            const [parcelles, setParcelles] = useState(() => {
                const copy = {};
                Object.keys(data.parcelleConfig).forEach(f => { copy[f] = data.parcelleConfig[f].map(p => ({...p})); });
                return copy;
            });
            const [normes, setNormes] = useState(() => data.normesProductivite.map(n => ({...n})));
            // data.normesProductivite arrive par fetch async (AuthenticatedApp.jsx) —
            // au premier rendu il est encore vide, donc `normes` se resynchronise
            // dès que la vraie liste arrive. Ne touche plus après un premier
            // remplissage non-vide : ne pas écraser une édition en cours de saisie
            // (ces édits ne sont de toute façon pas encore persistés, cf. TODO plus bas).
            const [normesSynced, setNormesSynced] = useState(false);
            useEffect(() => {
                if (normesSynced) return;
                if (data.normesProductivite && data.normesProductivite.length > 0) {
                    setNormes(data.normesProductivite.map(n => ({...n})));
                    setNormesSynced(true);
                }
            }, [data.normesProductivite, normesSynced]);
            const [editingCell, setEditingCell] = useState(null); // {farm, idx, field}
            const [editVal, setEditVal] = useState('');
            const [showAddTache, setShowAddTache] = useState(false);
            const [newTache, setNewTache] = useState('');
            const [newNorme, setNewNorme] = useState('');

            const startEdit = (farm, idx, field, currentVal) => { setEditingCell({farm, idx, field}); setEditVal(String(currentVal)); };
            const saveEdit = () => {
                if (!editingCell) return;
                const {farm, idx, field} = editingCell;
                setParcelles(prev => {
                    const copy = {...prev};
                    copy[farm] = [...copy[farm]];
                    copy[farm][idx] = {...copy[farm][idx], [field]: field === 'nbTunnels' ? parseInt(editVal)||0 : field === 'superficie' ? parseFloat(editVal)||0 : editVal};
                    return copy;
                });
                setEditingCell(null);
            };
            const isEditing = (farm, idx, field) => editingCell && editingCell.farm===farm && editingCell.idx===idx && editingCell.field===field;

            const editableCell = (farm, idx, field, val, opts={}) => {
                if (isEditing(farm, idx, field)) {
                    return <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key==='Enter' && saveEdit()}
                        style={{width: opts.width||'100%', padding:'4px 6px', borderRadius:6, border:'2px solid var(--berry)', fontSize:11, textAlign: opts.align||'left', fontWeight:600, background:'rgba(139,34,82,0.05)'}} />;
                }
                return <span onClick={() => startEdit(farm, idx, field, val)} style={{cursor:'pointer', borderBottom:'1px dashed var(--gray-300)', ...opts.style}}
                    title="Cliquez pour modifier">{val}</span>;
            };

            const handleAddTache = () => {
                if (newTache.trim() && newNorme) {
                    setNormes([...normes, { tache: newTache.trim(), normeTunnelsParJourParOuvrier: parseFloat(newNorme)||1, unite: 'tunnels/jour/ouvrier' }]);
                    setNewTache(''); setNewNorme(''); setShowAddTache(false);
                }
            };

            const [editingNormeIdx, setEditingNormeIdx] = useState(null);
            const [normeEditVal, setNormeEditVal] = useState('');

            // Avocatier config state
            const [avoConfig, setAvoConfig] = useState(() => {
                const copy = {};
                Object.keys(data.avocatierConfig).forEach(f => { copy[f] = data.avocatierConfig[f].map(p => ({...p})); });
                return copy;
            });
            const [editingAvoCell, setEditingAvoCell] = useState(null);
            const [avoEditVal, setAvoEditVal] = useState('');
            const startAvoEdit = (farm, idx, field, val) => { setEditingAvoCell({farm, idx, field}); setAvoEditVal(String(val)); };
            const saveAvoEdit = () => {
                if (!editingAvoCell) return;
                const {farm, idx, field} = editingAvoCell;
                setAvoConfig(prev => {
                    const copy = {...prev};
                    copy[farm] = [...copy[farm]];
                    copy[farm][idx] = {...copy[farm][idx], [field]: field === 'nbLignes' ? parseInt(avoEditVal)||0 : avoEditVal};
                    return copy;
                });
                setEditingAvoCell(null);
            };
            const isAvoEditing = (farm, idx, field) => editingAvoCell && editingAvoCell.farm===farm && editingAvoCell.idx===idx && editingAvoCell.field===field;
            const avoEditableCell = (farm, idx, field, val, opts={}) => {
                if (isAvoEditing(farm, idx, field)) {
                    return <input autoFocus value={avoEditVal} onChange={e => setAvoEditVal(e.target.value)} onBlur={saveAvoEdit} onKeyDown={e => e.key==='Enter' && saveAvoEdit()}
                        style={{width: opts.width||'100%', padding:'4px 6px', borderRadius:6, border:'2px solid var(--orange)', fontSize:11, textAlign: opts.align||'left', fontWeight:600, background:'rgba(230,126,34,0.05)'}} />;
                }
                return <span onClick={() => startAvoEdit(farm, idx, field, val)} style={{cursor:'pointer', borderBottom:'1px dashed var(--gray-300)', ...opts.style}}
                    title="Cliquez pour modifier">{val}</span>;
            };

            // Primes config state - par culture
            const [primesFramboise, setPrimesFramboise] = useState(() => (data.primesConfig.framboise?.tranches || []).map(t => ({...t})));
            const [primesMyrtille, setPrimesMyrtille] = useState(() => (data.primesConfig.myrtille?.tranches || []).map(t => ({...t})));
            const [primeCaporal, setPrimeCaporal] = useState(() => ({...data.primesConfig.primeCaporal}));
            const [editingPrimeIdx, setEditingPrimeIdx] = useState(null);
            const [primeEditField, setPrimeEditField] = useState(null);
            const [primeEditVal, setPrimeEditVal] = useState('');
            const [primeEditCulture, setPrimeEditCulture] = useState('framboise');

            return (
                <div className="fade-in">
                    <Panel title="Configuration Parcelles par Ferme" icon="fa-leaf">
                        <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:12}}><i className="fa-solid fa-pen" style={{marginRight:4}}></i> Cliquez sur une cellule pour la modifier</div>
                        {['F1', 'F5'].map(farm => (
                            <div key={farm} style={{marginBottom:24}}>
                                <h3 style={{fontSize:14, fontWeight:700, marginBottom:12, color:'var(--berry)'}}>
                                    <i className={`fa-solid ${farm==='F1'?'fa-seedling':'fa-leaf'}`} style={{marginRight:6}}></i>
                                    {farm === 'F1' ? 'Ferme 172 (F1)' : 'Ferme 195 (F5)'}
                                    <span style={{fontSize:11, fontWeight:400, color:'var(--gray-400)', marginLeft:8}}>
                                        {parcelles[farm].reduce((s,p) => s+p.nbTunnels, 0)} tunnels | {parcelles[farm].reduce((s,p) => s+p.superficie, 0).toFixed(1)} ha
                                    </span>
                                </h3>
                                <table className="data-table" style={{fontSize:11}}>
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nom Parcelle</th>
                                            <th>Culture</th>
                                            <th>Variété</th>
                                            <th style={{textAlign:'right'}}>Superficie (ha)</th>
                                            <th style={{textAlign:'right'}}>Nb Tunnels</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {parcelles[farm].map((p, i) => (
                                            <tr key={i}>
                                                <td style={{color:'var(--gray-400)', fontSize:10}}>{p.id}</td>
                                                <td style={{fontWeight:600}}>{editableCell(farm, i, 'nom', p.nom)}</td>
                                                <td>{editableCell(farm, i, 'culture', p.culture)}</td>
                                                <td>{editableCell(farm, i, 'variete', p.variete)}</td>
                                                <td style={{textAlign:'right'}}>{editableCell(farm, i, 'superficie', p.superficie, {align:'right', width:'60px'})}</td>
                                                <td style={{textAlign:'right', fontWeight:700, color:'var(--berry)'}}>{editableCell(farm, i, 'nbTunnels', p.nbTunnels, {align:'right', width:'50px', style:{fontWeight:700, color:'var(--berry)'}})}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ))}
                    </Panel>

                    <Panel title="Configuration Avocatier (Lignes)" icon="fa-tree">
                        <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:12}}><i className="fa-solid fa-pen" style={{marginRight:4}}></i> Cliquez sur une cellule pour la modifier</div>
                        {Object.keys(avoConfig).map(farm => (
                            <div key={farm} style={{marginBottom:20}}>
                                <h3 style={{fontSize:14, fontWeight:700, marginBottom:10, color:'var(--orange)'}}>
                                    <i className="fa-solid fa-tree" style={{marginRight:6}}></i>
                                    Parcelle {farm}
                                    <span style={{fontSize:11, fontWeight:400, color:'var(--gray-400)', marginLeft:8}}>
                                        {avoConfig[farm].reduce((s,p) => s+p.nbLignes, 0)} lignes
                                    </span>
                                </h3>
                                <table className="data-table" style={{fontSize:11}}>
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nom</th>
                                            <th>Culture</th>
                                            <th>Variété</th>
                                            <th style={{textAlign:'right'}}>Nb Lignes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {avoConfig[farm].map((p, i) => (
                                            <tr key={i}>
                                                <td style={{color:'var(--gray-400)', fontSize:10}}>{p.id}</td>
                                                <td style={{fontWeight:600}}>{avoEditableCell(farm, i, 'nom', p.nom)}</td>
                                                <td>{avoEditableCell(farm, i, 'culture', p.culture)}</td>
                                                <td>{avoEditableCell(farm, i, 'variete', p.variete)}</td>
                                                <td style={{textAlign:'right', fontWeight:700, color:'var(--orange)'}}>{avoEditableCell(farm, i, 'nbLignes', p.nbLignes, {align:'right', width:'50px', style:{fontWeight:700, color:'var(--orange)'}})}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ))}
                    </Panel>

                    <Panel title="Normes de Productivité" icon="fa-gear">
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8}}>
                            <div style={{fontSize:11, color:'var(--gray-400)'}}><i className="fa-solid fa-pen" style={{marginRight:4}}></i> Cliquez sur une norme pour la modifier</div>
                            {data.normesProductiviteSource === 'hardcoded' && (
                                <div title="Aucune norme n'est enregistrée dans Firestore (collection normes-productivite) : ces valeurs sont le repli codé en dur côté serveur, pas une configuration validée." style={{fontSize:10.5, fontWeight:700, color:'var(--orange)', background:'rgba(245,158,11,0.12)', border:'1px solid var(--orange)', borderRadius:6, padding:'3px 8px', display:'flex', alignItems:'center', gap:5}}>
                                    <i className="fa-solid fa-triangle-exclamation"></i> Valeurs par défaut (non configurées)
                                </div>
                            )}
                            <button onClick={() => setShowAddTache(true)} style={{padding:'6px 14px', background:'var(--green)', color:'white', border:'none', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6}}>
                                <i className="fa-solid fa-plus"></i> Nouvelle Tâche
                            </button>
                        </div>
                        <table className="data-table" style={{fontSize:11}}>
                            <thead>
                                <tr>
                                    <th>Tâche</th>
                                    <th style={{textAlign:'center', width:180}}>Norme (tunnels/jour/ouvrier)</th>
                                    <th>Unité</th>
                                    <th style={{width:40}}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {normes.map((n, i) => (
                                    <tr key={i}>
                                        <td style={{fontWeight:600}}><i className="fa-solid fa-wrench" style={{marginRight:6, color:'var(--gray-300)', fontSize:10}}></i>{n.tache}</td>
                                        <td style={{textAlign:'center'}}>
                                            {editingNormeIdx === i ? (
                                                <input autoFocus type="number" step="0.5" min="0.5" value={normeEditVal}
                                                    onChange={e => setNormeEditVal(e.target.value)}
                                                    onBlur={() => { setNormes(prev => { const c=[...prev]; c[i]={...c[i], normeTunnelsParJourParOuvrier: parseFloat(normeEditVal)||1}; return c; }); setEditingNormeIdx(null); }}
                                                    onKeyDown={e => { if(e.key==='Enter') e.target.blur(); }}
                                                    style={{width:60, padding:'4px 6px', borderRadius:6, border:'2px solid var(--berry)', fontSize:12, textAlign:'center', fontWeight:700}}/>
                                            ) : (
                                                <span onClick={() => { setEditingNormeIdx(i); setNormeEditVal(String(n.normeTunnelsParJourParOuvrier)); }}
                                                    style={{fontWeight:700, color:'var(--berry)', cursor:'pointer', borderBottom:'1px dashed var(--gray-300)', padding:'2px 8px'}}
                                                    title="Cliquez pour modifier">{n.normeTunnelsParJourParOuvrier}</span>
                                            )}
                                        </td>
                                        <td style={{color:'var(--gray-600)', fontSize:10}}>{n.unite}</td>
                                        <td>
                                            <button onClick={() => setNormes(normes.filter((_,j) => j!==i))} style={{background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:12, opacity:0.5}} title="Supprimer">
                                                <i className="fa-solid fa-trash"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {showAddTache && (
                            <div style={{marginTop:12, padding:16, background:'var(--green-pale)', borderRadius:10, border:'1px solid var(--green)'}}>
                                <div style={{fontSize:13, fontWeight:600, marginBottom:10}}>
                                    <i className="fa-solid fa-plus-circle" style={{marginRight:6, color:'var(--green)'}}></i>Ajouter une nouvelle tâche
                                </div>
                                <div style={{display:'flex', gap:10, alignItems:'flex-end'}}>
                                    <div style={{flex:1}}>
                                        <label style={{fontSize:10, fontWeight:600, display:'block', marginBottom:4}}>Nom de la tâche</label>
                                        <input type="text" value={newTache} onChange={e => setNewTache(e.target.value)} placeholder="Ex: Taille de formation"
                                            style={{width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12}}/>
                                    </div>
                                    <div style={{width:120}}>
                                        <label style={{fontSize:10, fontWeight:600, display:'block', marginBottom:4}}>Norme</label>
                                        <input type="number" step="0.5" min="0.5" value={newNorme} onChange={e => setNewNorme(e.target.value)} placeholder="Ex: 4"
                                            style={{width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12, textAlign:'center'}}/>
                                    </div>
                                    <button onClick={handleAddTache} style={{padding:'8px 16px', background:'var(--green)', color:'white', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap'}}>
                                        <i className="fa-solid fa-check" style={{marginRight:4}}></i> Ajouter
                                    </button>
                                    <button onClick={() => {setShowAddTache(false); setNewTache(''); setNewNorme('');}} style={{padding:'8px 12px', background:'var(--gray-200)', color:'var(--gray-600)', border:'none', borderRadius:8, fontSize:12, cursor:'pointer'}}>
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        )}
                    </Panel>

                    <SousTraitantsConfigPanel />

                    <JoursFeriesConfigPanel />

                    <Panel title="Barèmes des Primes de Récolte" icon="fa-coins">
                        <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:16}}>
                            <i className="fa-solid fa-info-circle" style={{marginRight:4}}></i> Deux barèmes différents selon la culture. Les primes sont calculées automatiquement en fonction de la variété de l'ouvrier.
                        </div>

                        {/* Framboise */}
                        <div style={{marginBottom:20}}>
                            <h4 style={{fontSize:13, fontWeight:700, color:'var(--berry)', marginBottom:8, display:'flex', alignItems:'center', gap:8}}>
                                <span style={{fontSize:16}}>🍓</span> Framboise
                                <span style={{fontSize:10, fontWeight:400, color:'var(--gray-400)'}}>(Maravilla, Reyna, Yazmin...)</span>
                            </h4>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th style={{width:80}}>Seuil (Kg)</th>
                                        <th style={{width:80}}>Prime (DH)</th>
                                        <th style={{width:100}}>Bonus/Kg</th>
                                        <th style={{width:100}}>Base Bonus</th>
                                        <th>Description</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {primesFramboise.map((tranche, i) => (
                                        <tr key={i}>
                                            <td style={{fontWeight:600}}>{tranche.seuil} Kg</td>
                                            <td style={{fontWeight:700, color:'var(--gold)'}}>{tranche.prime} DH</td>
                                            <td style={{color: tranche.bonusParKg ? 'var(--blue)' : 'var(--gray-300)'}}>{tranche.bonusParKg ? tranche.bonusParKg + ' DH/Kg' : '-'}</td>
                                            <td style={{color: tranche.bonusBase ? 'var(--orange)' : 'var(--gray-300)'}}>{tranche.bonusBase ? '>' + tranche.bonusBase + ' Kg' : '-'}</td>
                                            <td style={{color:'var(--gray-600)'}}>{tranche.label}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div style={{marginTop:8, padding:'8px 12px', background:'rgba(139,34,82,0.04)', borderRadius:8, fontSize:11, color:'var(--gray-600)'}}>
                                <b>Exemple :</b> 35 Kg → 60 DH + (35-30) × 3 = <b>75 DH</b> | 45 Kg → 100 DH + (45-40) × 4 = <b>120 DH</b>
                            </div>
                        </div>

                        {/* Myrtille */}
                        <div style={{marginBottom:20}}>
                            <h4 style={{fontSize:13, fontWeight:700, color:'#5B6ABF', marginBottom:8, display:'flex', alignItems:'center', gap:8}}>
                                <span style={{fontSize:16}}>🫐</span> Myrtille
                                <span style={{fontSize:10, fontWeight:400, color:'var(--gray-400)'}}>(Corina, Corrina...)</span>
                            </h4>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th style={{width:80}}>Seuil (Kg)</th>
                                        <th style={{width:120}}>Prime</th>
                                        <th>Description</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {primesMyrtille.map((tranche, i) => (
                                        <tr key={i}>
                                            <td style={{fontWeight:600}}>{tranche.seuil} Kg</td>
                                            <td style={{fontWeight:700, color:'#5B6ABF'}}>{tranche.bonusParKg} DH/Kg au-delà de {tranche.bonusBase} Kg</td>
                                            <td style={{color:'var(--gray-600)'}}>{tranche.label}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div style={{marginTop:8, padding:'8px 12px', background:'rgba(91,106,191,0.04)', borderRadius:8, fontSize:11, color:'var(--gray-600)'}}>
                                <b>Exemple :</b> 35 Kg → (35-30) × 2 = <b>10 DH</b> | 50 Kg → (50-30) × 2 = <b>40 DH</b> | ≤30 Kg → <b>0 DH</b>
                            </div>
                        </div>

                        {/* Prime Caporal */}
                        <div style={{padding:'12px 16px', background:'rgba(230,126,34,0.05)', borderRadius:10, border:'1px solid rgba(230,126,34,0.15)'}}>
                            <h4 style={{fontSize:12, fontWeight:700, color:'var(--orange)', marginBottom:6, display:'flex', alignItems:'center', gap:6}}>
                                <i className="fa-solid fa-user-tie"></i> Prime Caporal (Chef d'équipe)
                            </h4>
                            <div style={{fontSize:11, color:'var(--gray-600)', display:'flex', gap:24, flexWrap:'wrap'}}>
                                <div>Moyenne équipe ≥ 25 Kg/j → <b style={{color:'var(--orange)'}}>{primeCaporal.base} DH</b></div>
                                <div>Moyenne équipe ≥ 30 Kg/j → <b style={{color:'var(--orange)'}}>{primeCaporal.base + primeCaporal.bonusSiEquipeSup30} DH</b> (+{primeCaporal.bonusSiEquipeSup30} DH bonus)</div>
                            </div>
                        </div>

                        {/* Poids par Caisse */}
                        <div style={{padding:'12px 16px', background:'rgba(142,68,173,0.05)', borderRadius:10, border:'1px solid rgba(142,68,173,0.15)'}}>
                            <h4 style={{fontSize:12, fontWeight:700, color:'#8e44ad', marginBottom:6, display:'flex', alignItems:'center', gap:6}}>
                                <i className="fa-solid fa-weight-hanging"></i> Poids par Caisse (extrait automatiquement de BEE ONE)
                            </h4>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead><tr><th>Opération</th><th style={{textAlign:'right'}}>Kg / Caisse</th></tr></thead>
                                <tbody>
                                    <tr><td>Récolte Caisse 1.5 KG</td><td style={{textAlign:'right', fontWeight:700, color:'#8e44ad'}}>1.5 kg</td></tr>
                                    <tr><td>Récolte Caisse 2.4 kg</td><td style={{textAlign:'right', fontWeight:700, color:'#8e44ad'}}>2.4 kg</td></tr>
                                </tbody>
                            </table>
                            <div style={{marginTop:8, padding:'8px 12px', background:'rgba(142,68,173,0.04)', borderRadius:8, fontSize:11, color:'var(--gray-600)'}}>
                                Le poids par caisse est extrait du nom de l'opération dans BEE ONE (ex: "Récolte Caisse 2.4 kg"). Si aucun poids n'est détecté, le défaut est 1.5 kg.
                            </div>
                        </div>
                    </Panel>

                    {/* ===== Blocs Qualité Driscoll's ===== */}
                    <Panel title="Blocs Qualité Driscoll's" icon="fa-cubes">
                        <p style={{fontSize:'11px', color:'var(--gray-400)', marginBottom:'10px'}}>
                            <i className="fa-solid fa-pen"></i> Cliquez sur une valeur pour la modifier. Les blocs sont utilisés dans le Dashboard Qualité pour le calcul Kg/Ha.
                        </p>
                        {(() => {
                            const [blocsConf, setBlocsConf] = useState(() => {
                                try { const s = localStorage.getItem('blocIdsConfig'); return s ? JSON.parse(s) : data.blocIds.map(b => ({...b})); } catch(e) { return data.blocIds.map(b => ({...b})); }
                            });
                            const [editBlocCell, setEditBlocCell] = useState(null);
                            const [blocEditVal, setBlocEditVal] = useState('');
                            const [showAddBloc, setShowAddBloc] = useState(false);
                            const [newBloc, setNewBloc] = useState({label:'', parcelle:'', variete:'', ferme:'F1', ranch:'200742', blockId:'', ha:0});

                            const saveBlocsToStorage = (updated) => { localStorage.setItem('blocIdsConfig', JSON.stringify(updated)); };

                            const startBlocEdit = (idx, field, val) => { setEditBlocCell({idx, field}); setBlocEditVal(String(val)); };
                            const saveBlocEdit = () => {
                                if (!editBlocCell) return;
                                const {idx, field} = editBlocCell;
                                setBlocsConf(prev => {
                                    const copy = prev.map(b => ({...b}));
                                    copy[idx][field] = field === 'ha' ? parseFloat(blocEditVal) || 0 : blocEditVal;
                                    saveBlocsToStorage(copy);
                                    return copy;
                                });
                                setEditBlocCell(null);
                            };
                            const isBlocEditing = (idx, field) => editBlocCell && editBlocCell.idx === idx && editBlocCell.field === field;

                            const blocCell = (idx, field, val, opts={}) => {
                                if (isBlocEditing(idx, field)) {
                                    return <input autoFocus value={blocEditVal} onChange={e => setBlocEditVal(e.target.value)}
                                        onBlur={saveBlocEdit} onKeyDown={e => e.key === 'Enter' && saveBlocEdit()}
                                        type={opts.type || 'text'}
                                        style={{width: opts.width || '100%', padding:'4px 6px', borderRadius:6, border:'2px solid var(--berry)', fontSize:11, textAlign: opts.align || 'left', fontWeight:600}} />;
                                }
                                return <span onClick={() => startBlocEdit(idx, field, val)}
                                    style={{cursor:'pointer', borderBottom:'1px dashed var(--gray-300)', ...opts.style}}
                                    title="Cliquez pour modifier">{val}</span>;
                            };

                            const addBloc = () => {
                                if (!newBloc.label.trim()) return;
                                const id = 'BLOC-' + newBloc.parcelle + '-' + newBloc.variete.replace(/\s+/g,'').substring(0,3).toUpperCase();
                                const ranchName = newBloc.ranch === '200742' ? 'R-Berry Good Farms SARL' : 'Berry Good Farms SARL 3';
                                const bloc = { ...newBloc, id, ranchName, treatment: '', treatmentWeek: '' };
                                setBlocsConf(prev => {
                                    const updated = [...prev, bloc];
                                    saveBlocsToStorage(updated);
                                    return updated;
                                });
                                setNewBloc({label:'', parcelle:'', variete:'', ferme:'F1', ranch:'200742', blockId:'', ha:0});
                                setShowAddBloc(false);
                            };

                            const removeBloc = (idx) => {
                                setBlocsConf(prev => {
                                    const updated = prev.filter((_, i) => i !== idx);
                                    saveBlocsToStorage(updated);
                                    return updated;
                                });
                            };

                            return (
                                <div>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Label</th>
                                                <th>Parcelle</th>
                                                <th>Variété</th>
                                                <th>Ferme</th>
                                                <th>Block ID</th>
                                                <th>Ha</th>
                                                <th>Ranch</th>
                                                <th></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {blocsConf.map((b, i) => (
                                                <tr key={i}>
                                                    <td style={{fontWeight:600, color:'var(--berry)'}}>{blocCell(i, 'label', b.label)}</td>
                                                    <td>{blocCell(i, 'parcelle', b.parcelle, {width:'50px'})}</td>
                                                    <td>{blocCell(i, 'variete', b.variete)}</td>
                                                    <td>{blocCell(i, 'ferme', b.ferme, {width:'40px'})}</td>
                                                    <td style={{fontSize:10}}>{blocCell(i, 'blockId', b.blockId, {width:'80px'})}</td>
                                                    <td style={{fontWeight:700, color:'var(--green)'}}>{blocCell(i, 'ha', b.ha, {width:'50px', type:'number', align:'center'})}</td>
                                                    <td style={{fontSize:10, color:'var(--gray-400)'}}>{b.ranch === '200742' ? 'F1' : 'F5'} ({b.ranch})</td>
                                                    <td><button onClick={() => removeBloc(i)} style={{background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:12}} title="Supprimer"><i className="fa-solid fa-trash"></i></button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {showAddBloc ? (
                                        <div style={{marginTop:12, padding:12, background:'var(--gray-100)', borderRadius:8, display:'grid', gridTemplateColumns:'1fr 80px 1fr 60px 100px 60px 100px auto', gap:8, alignItems:'center', fontSize:11}}>
                                            <input placeholder="Label" value={newBloc.label} onChange={e => setNewBloc({...newBloc, label: e.target.value})} style={{padding:'6px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}} />
                                            <input placeholder="Parc." value={newBloc.parcelle} onChange={e => setNewBloc({...newBloc, parcelle: e.target.value})} style={{padding:'6px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}} />
                                            <input placeholder="Variété" value={newBloc.variete} onChange={e => setNewBloc({...newBloc, variete: e.target.value})} style={{padding:'6px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}} />
                                            <select value={newBloc.ferme} onChange={e => setNewBloc({...newBloc, ferme: e.target.value, ranch: e.target.value === 'F1' ? '200742' : '200876'})} style={{padding:'6px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}}>
                                                <option value="F1">F1</option><option value="F5">F5</option>
                                            </select>
                                            <input placeholder="Block ID" value={newBloc.blockId} onChange={e => setNewBloc({...newBloc, blockId: e.target.value})} style={{padding:'6px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}} />
                                            <input placeholder="Ha" type="number" step="0.1" value={newBloc.ha || ''} onChange={e => setNewBloc({...newBloc, ha: parseFloat(e.target.value) || 0})} style={{padding:'6px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11, textAlign:'center'}} />
                                            <button className="btn-primary" onClick={addBloc} style={{padding:'6px 12px', fontSize:11}}>Ajouter</button>
                                            <button onClick={() => setShowAddBloc(false)} style={{background:'none', border:'none', color:'var(--gray-400)', cursor:'pointer'}}>✕</button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setShowAddBloc(true)} style={{marginTop:10, padding:'8px 16px', background:'var(--berry-pale)', color:'var(--berry)', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer'}}>
                                            <i className="fa-solid fa-plus"></i> Ajouter un bloc
                                        </button>
                                    )}
                                </div>
                            );
                        })()}
                    </Panel>

                    {/* Configuration Pénalités PFQ Interne */}
                    <Panel title="Pénalités PFQ Interne" icon="fa-vial">
                        <p style={{fontSize:'11px', color:'var(--gray-400)', marginBottom:'10px'}}>
                            <i className="fa-solid fa-pen"></i> Configurez les pénalités appliquées au calcul du PFQ Interne. Modifiez les valeurs puis cliquez Sauvegarder.
                        </p>
                        {(() => {
                            const defaultPFQConfig = {
                                conditionMax: 70,
                                apparenceMax: 20,
                                conditionMin: 60,
                                apparenceMin: 10,
                                defautsCondition: [
                                    { key: 'overripe', label: 'Fruit trop mûr (Overripe)', enabled: true, penalty: 700 },
                                    { key: 'wetLeaky', label: 'Fruit saignant (Wet Leaky)', enabled: true, penalty: 700 },
                                    { key: 'collapsed', label: 'Fruit mou (Collapsed)', enabled: true, penalty: 700 },
                                    { key: 'sootyMold', label: 'Cladosporium (Sooty Mold)', enabled: true, penalty: 500 },
                                    { key: 'yellowRust', label: 'Rouille jaune (Yellow Rust)', enabled: true, penalty: 500 },
                                ],
                                defautsApparence: [
                                    { key: 'size', label: 'Calibre < 3g (Size)', enabled: true, penalty: 400 },
                                    { key: 'pestDamage', label: 'Dégâts ravageurs (Pest Damage)', enabled: true, penalty: 400 },
                                    { key: 'windHeat', label: 'Dégâts vent/chaleur (Wind/Heat)', enabled: true, penalty: 400 },
                                    { key: 'whiteCells', label: 'Cellules blanches/sèches', enabled: true, penalty: 400 },
                                    { key: 'green', label: 'Immature (Green)', enabled: true, penalty: 700 },
                                    { key: 'broken', label: 'Cassé (Broken)', enabled: true, penalty: 400 },
                                    { key: 'malformed', label: 'Déformation (Malformed)', enabled: true, penalty: 400 },
                                    { key: 'windDamage', label: 'Dégâts du vent (Wind Damage)', enabled: true, penalty: 400 },
                                    { key: 'attachedCalyx', label: 'Avec pédoncule (Attached Calyx)', enabled: true, penalty: 400 },
                                    { key: 'decay', label: 'Pourriture (Decay)', enabled: true, penalty: 100000 },
                                    { key: 'drosophila', label: 'Larves drosophile (Fruit Fly)', enabled: true, penalty: 100000 },
                                ],
                            };
                            const [pfqConf, setPfqConf] = useState(() => {
                                try { const s = localStorage.getItem('pfqPenaltyConfig'); return s ? JSON.parse(s) : {...defaultPFQConfig}; } catch(e) { return {...defaultPFQConfig}; }
                            });
                            const [pfqSaved, setPfqSaved] = useState(false);

                            const savePfqConfig = () => {
                                localStorage.setItem('pfqPenaltyConfig', JSON.stringify(pfqConf));
                                setPfqSaved(true);
                                setTimeout(() => setPfqSaved(false), 2000);
                            };
                            const resetPfqConfig = () => {
                                setPfqConf({...defaultPFQConfig});
                                localStorage.removeItem('pfqPenaltyConfig');
                            };

                            const inputSt = { width:80, padding:'6px 8px', border:'1.5px solid var(--gray-200)', borderRadius:6, fontSize:13, textAlign:'center', fontWeight:700 };

                            return (
                                <div>
                                    {/* Scores Max / Min */}
                                    <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:16,marginBottom:20}}>
                                        <div style={{padding:14,background:'var(--berry-pale)',borderRadius:10,border:'1px solid rgba(139,34,82,0.2)'}}>
                                            <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600,marginBottom:6}}>PFQ Condition Max / Min</div>
                                            <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                                <input type="number" value={pfqConf.conditionMax} onChange={e => setPfqConf(p => ({...p, conditionMax: parseInt(e.target.value)||0}))} style={{...inputSt,color:'var(--berry)'}} />
                                                <span style={{fontSize:11,color:'var(--gray-400)'}}>/</span>
                                                <input type="number" value={pfqConf.conditionMin != null ? pfqConf.conditionMin : 60} onChange={e => setPfqConf(p => ({...p, conditionMin: parseInt(e.target.value)||0}))} style={{...inputSt,color:'var(--red)'}} />
                                            </div>
                                            <div style={{fontSize:9,color:'var(--gray-400)',marginTop:4}}>Max: /70 — Min: 60 (rejet)</div>
                                        </div>
                                        <div style={{padding:14,background:'var(--blue-pale)',borderRadius:10,border:'1px solid rgba(52,152,219,0.2)'}}>
                                            <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600,marginBottom:6}}>PFQ Apparence Max / Min</div>
                                            <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                                <input type="number" value={pfqConf.apparenceMax} onChange={e => setPfqConf(p => ({...p, apparenceMax: parseInt(e.target.value)||0}))} style={{...inputSt,color:'var(--blue)'}} />
                                                <span style={{fontSize:11,color:'var(--gray-400)'}}>/</span>
                                                <input type="number" value={pfqConf.apparenceMin != null ? pfqConf.apparenceMin : 10} onChange={e => setPfqConf(p => ({...p, apparenceMin: parseInt(e.target.value)||0}))} style={{...inputSt,color:'var(--orange)'}} />
                                            </div>
                                            <div style={{fontSize:9,color:'var(--gray-400)',marginTop:4}}>Max: /20 — Min: 10 (rejet)</div>
                                        </div>
                                    </div>

                                    {/* Formule */}
                                    <div style={{padding:12,background:'var(--gray-50)',borderRadius:8,marginBottom:16,fontSize:11,color:'var(--gray-600)',lineHeight:1.6}}>
                                        <strong>Formule Excel Driscoll's:</strong><br/>
                                        PFQ = ((100 - Σ(fraction_i × pénalité_i)) / 100) × Max<br/>
                                        Chaque défaut a sa propre pénalité (modifiable ci-dessous).<br/>
                                        <span style={{color:'var(--red)',fontWeight:700}}>Rejet si</span>: Condition &lt; <span style={{fontWeight:700}}>{pfqConf.conditionMin || 60}</span> ou Apparence &lt; <span style={{fontWeight:700}}>{pfqConf.apparenceMin || 10}</span>
                                    </div>

                                    {/* Défauts avec pénalités individuelles */}
                                    <div style={{marginBottom:16}}>
                                        <div style={{fontSize:12,fontWeight:700,color:'var(--red)',marginBottom:8}}><i className="fa-solid fa-heart-pulse" style={{marginRight:6}}></i>Défauts Condition</div>
                                        {(pfqConf.defautsCondition || defaultPFQConfig.defautsCondition).map((d, i) => (
                                            <div key={d.key} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid var(--gray-100)'}}>
                                                <input type="checkbox" checked={d.enabled !== false}
                                                    onChange={e => setPfqConf(p => {
                                                        const updated = {...p, defautsCondition: [...(p.defautsCondition || defaultPFQConfig.defautsCondition)]};
                                                        updated.defautsCondition[i] = {...updated.defautsCondition[i], enabled: e.target.checked};
                                                        return updated;
                                                    })} />
                                                <input value={d.label} onChange={e => setPfqConf(p => {
                                                    const updated = {...p, defautsCondition: [...(p.defautsCondition || defaultPFQConfig.defautsCondition)]};
                                                    updated.defautsCondition[i] = {...updated.defautsCondition[i], label: e.target.value};
                                                    return updated;
                                                })} style={{flex:1,padding:'4px 8px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12}} />
                                                <input type="number" value={d.penalty || 700} onChange={e => setPfqConf(p => {
                                                    const updated = {...p, defautsCondition: [...(p.defautsCondition || defaultPFQConfig.defautsCondition)]};
                                                    updated.defautsCondition[i] = {...updated.defautsCondition[i], penalty: parseInt(e.target.value)||0};
                                                    return updated;
                                                })} style={{width:70,padding:'4px 6px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12,textAlign:'center',fontWeight:700,color:'var(--red)'}} />
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{marginBottom:16}}>
                                        <div style={{fontSize:12,fontWeight:700,color:'var(--orange)',marginBottom:8}}><i className="fa-solid fa-eye" style={{marginRight:6}}></i>Défauts Apparence</div>
                                        {(pfqConf.defautsApparence || defaultPFQConfig.defautsApparence).map((d, i) => (
                                            <div key={d.key} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid var(--gray-100)'}}>
                                                <input type="checkbox" checked={d.enabled !== false}
                                                    onChange={e => setPfqConf(p => {
                                                        const updated = {...p, defautsApparence: [...(p.defautsApparence || defaultPFQConfig.defautsApparence)]};
                                                        updated.defautsApparence[i] = {...updated.defautsApparence[i], enabled: e.target.checked};
                                                        return updated;
                                                    })} />
                                                <input value={d.label} onChange={e => setPfqConf(p => {
                                                    const updated = {...p, defautsApparence: [...(p.defautsApparence || defaultPFQConfig.defautsApparence)]};
                                                    updated.defautsApparence[i] = {...updated.defautsApparence[i], label: e.target.value};
                                                    return updated;
                                                })} style={{flex:1,padding:'4px 8px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12}} />
                                                <input type="number" value={d.penalty || 400} onChange={e => setPfqConf(p => {
                                                    const updated = {...p, defautsApparence: [...(p.defautsApparence || defaultPFQConfig.defautsApparence)]};
                                                    updated.defautsApparence[i] = {...updated.defautsApparence[i], penalty: parseInt(e.target.value)||0};
                                                    return updated;
                                                })} style={{width:70,padding:'4px 6px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12,textAlign:'center',fontWeight:700,color: (d.penalty||400) >= 100000 ? 'var(--red)' : 'var(--orange)'}} />
                                            </div>
                                        ))}
                                    </div>

                                    {/* Confections */}
                                    {(() => {
                                        const [confList, setConfList] = useState(() => {
                                            try { const s = localStorage.getItem('confectionTypes'); return s ? JSON.parse(s) : []; } catch(e) { return []; }
                                        });
                                        const [newConf, setNewConf] = useState('');
                                        const [confSaved, setConfSaved] = useState(false);
                                        return (
                                            <div style={{marginBottom:16,padding:14,background:'var(--gray-50)',borderRadius:10}}>
                                                <div style={{fontSize:12,fontWeight:700,color:'var(--berry)',marginBottom:8}}><i className="fa-solid fa-box" style={{marginRight:6}}></i>Types de Confection (dropdown PFQ)</div>
                                                <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:8}}>Prérempli depuis les expéditions Driscoll's. Ajoutez/supprimez manuellement.</div>
                                                <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
                                                    {confList.map((c, i) => (
                                                        <span key={i} style={{padding:'4px 10px',background:'#fff',border:'1px solid var(--gray-200)',borderRadius:20,fontSize:11,display:'flex',alignItems:'center',gap:6}}>
                                                            {c}
                                                            <i className="fa-solid fa-xmark" style={{cursor:'pointer',color:'var(--red)',fontSize:10}} onClick={() => {
                                                                const updated = confList.filter((_,j) => j !== i);
                                                                setConfList(updated);
                                                                localStorage.setItem('confectionTypes', JSON.stringify(updated));
                                                            }}></i>
                                                        </span>
                                                    ))}
                                                </div>
                                                <div style={{display:'flex',gap:8}}>
                                                    <input placeholder="Nouvelle confection..." value={newConf} onChange={e => setNewConf(e.target.value)}
                                                        style={{flex:1,padding:'6px 10px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12}}
                                                        onKeyDown={e => { if (e.key === 'Enter' && newConf.trim()) { const updated = [...confList, newConf.trim()]; setConfList(updated); localStorage.setItem('confectionTypes', JSON.stringify(updated)); setNewConf(''); }}} />
                                                    <button onClick={() => { if (newConf.trim()) { const updated = [...confList, newConf.trim()]; setConfList(updated); localStorage.setItem('confectionTypes', JSON.stringify(updated)); setNewConf(''); }}}
                                                        style={{padding:'6px 14px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:6,fontSize:12,cursor:'pointer',fontWeight:600}}>
                                                        <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Boutons */}
                                    <div style={{display:'flex',gap:10,alignItems:'center'}}>
                                        <button onClick={savePfqConfig} style={{padding:'10px 24px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,fontSize:13,fontWeight:700,cursor:'pointer'}}>
                                            <i className="fa-solid fa-save" style={{marginRight:6}}></i>Sauvegarder PFQ
                                        </button>
                                        <button onClick={resetPfqConfig} style={{padding:'10px 24px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                            <i className="fa-solid fa-rotate-right" style={{marginRight:6}}></i>Réinitialiser (Excel)
                                        </button>
                                        {pfqSaved && <span style={{fontSize:12,color:'var(--green)',fontWeight:600}}><i className="fa-solid fa-check-circle" style={{marginRight:4}}></i>Sauvegardé !</span>}
                                    </div>
                                </div>
                            );
                        })()}
                    </Panel>

                    <BaremesPaiePanel />
                </div>
            );
        }

export { ParametresTab };
