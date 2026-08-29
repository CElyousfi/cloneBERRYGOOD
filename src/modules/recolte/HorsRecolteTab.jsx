/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: recolte | Déclaration(s): HorsRecolteTab */
import { FAMILLE_ICONS } from '../shared/FAMILLE_ICONS.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';

function HorsRecolteTab({ data, farmFilter, avoSubFilter }) {
            const [fermeFilter, setFermeFilter] = useState('');
            const [operations, setOperations] = useState([]);
            // Effectifs DISTINCTS calculés côté backend (le payload operations[].effectif est
            // par op×parcelle, donc non sommable sans double-comptage des ouvriers multi-parcelles).
            const [effDistinct, setEffDistinct] = useState({ global: 0, parFamille: {}, parFerme: {}, familleParFerme: {} });
            const [loading, setLoading] = useState(true);

            React.useEffect(() => {
                cachedFetch('/api/pointage-rh?action=hors-recolte').then(json => {
                    if (json.success) {
                        setOperations(json.operations || []);
                        setEffDistinct({
                            global: json.effectifDistinct || 0,
                            parFamille: json.effectifParFamille || {},
                            parFerme: json.effectifDistinctParFerme || {},
                            familleParFerme: json.effectifFamilleParFerme || {},
                        });
                    }
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            }, []);

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🫐</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement hors récolte...</div></div>;

            const activeFerme = farmFilter || fermeFilter;
            let filtered = activeFerme ? operations.filter(o => o.ferme === activeFerme) : operations;
            // Effectif = matricules DISTINCTS (backend). Selon le filtre ferme actif, on prend
            // le distinct global ou le distinct de la ferme. heures/coût restent des sommes.
            const totalEffectif = activeFerme ? (effDistinct.parFerme[activeFerme] || 0) : effDistinct.global;
            const totalHeures = filtered.reduce((s, o) => s + (o.heures || 0), 0);
            const totalCout = filtered.reduce((s, o) => s + (o.cout || 0), 0);
            // Effectif distinct par famille (selon le filtre ferme actif)
            const familleEffectif = (key) => activeFerme
                ? ((effDistinct.familleParFerme[activeFerme] || {})[key] || 0)
                : (effDistinct.parFamille[key] || 0);

            // Group by groupe -> famille -> ops (3 niveaux : groupe, famille, opérations)
            const byGroupe = {};
            filtered.forEach(o => {
                const gKey = o.groupe || 'Hors récolte';
                const fKey = o.famille || o.operationFamille || 'Autre';
                if (!byGroupe[gKey]) byGroupe[gKey] = { groupe: gKey, familles: {}, heures: 0, cout: 0 };
                if (!byGroupe[gKey].familles[fKey]) byGroupe[gKey].familles[fKey] = { famille: fKey, effectif: 0, heures: 0, cout: 0, ops: [] };
                byGroupe[gKey].familles[fKey].effectif = familleEffectif(fKey);
                byGroupe[gKey].familles[fKey].heures += o.heures || 0;
                byGroupe[gKey].familles[fKey].cout += o.cout || 0;
                byGroupe[gKey].familles[fKey].ops.push(o);
                byGroupe[gKey].heures += o.heures || 0;
                byGroupe[gKey].cout += o.cout || 0;
            });
            const groupes = Object.values(byGroupe).sort((a, b) => b.cout - a.cout);

            return (
                <div className="fade-in">
                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center'}}>
                        <span style={{background:'#d4edda',color:'#155724',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-database" style={{marginRight:4}}></i>Firestore — Hors Récolte
                        </span>
                    </div>

                    {!farmFilter && (
                    <div className="filters-bar">
                        <label style={{fontSize: 12, fontWeight: 500}}>Filtrer par ferme:</label>
                        <div className="chip-group">
                            <span className="chip-group-label">Ferme:</span>
                            <button className={`chip c-green ${fermeFilter === '' ? 'active' : ''}`} onClick={() => setFermeFilter('')}>Toutes</button>
                            <button className={`chip c-green ${fermeFilter === 'F1' ? 'active' : ''}`} onClick={() => setFermeFilter('F1')}>F1</button>
                            <button className={`chip c-green ${fermeFilter === 'F5' ? 'active' : ''}`} onClick={() => setFermeFilter('F5')}>F5</button>
                            <button className={`chip c-green ${fermeFilter === 'Avocatier' ? 'active' : ''}`} onClick={() => setFermeFilter('Avocatier')}>Avocatier</button>
                        </div>
                    </div>
                    )}

                    <div className="kpi-grid">
                        <KPICard icon="fa-trowel" iconClass="berry" value={filtered.length} label="Opérations en Cours" />
                        <KPICard icon="fa-users" iconClass="blue" value={totalEffectif} label="Effectif Hors Récolte" />
                        <KPICard icon="fa-clock" iconClass="green" value={Math.round(totalHeures)} label="Total Heures" />
                        <KPICard icon="fa-coins" iconClass="orange" value={Math.round(totalCout).toLocaleString('fr-FR')} label="Coût Total (DH)" />
                    </div>

                    <Panel title="Opérations par Groupe et Famille" icon="fa-layer-group">
                        {groupes.map((grp, gi) => (
                            <div key={gi} style={{marginBottom:20}}>
                                <div style={{background:'var(--gray-50,#f8f9fa)',borderRadius:8,padding:'8px 12px',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                                    <i className="fa-solid fa-folder-open" style={{color:'var(--berry)',fontSize:13}}></i>
                                    <strong style={{fontSize:13,color:'var(--berry-dark,#6d1a3e)'}}>{grp.groupe}</strong>
                                    <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:'auto'}}>{Math.round(grp.heures)}h — {Math.round(grp.cout).toLocaleString('fr-FR')} DH</span>
                                </div>
                                {Object.values(grp.familles).sort((a, b) => b.effectif - a.effectif).map((fam, fi) => (
                                    <div key={fi} style={{marginBottom:16,marginLeft:16}}>
                                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                                            {FAMILLE_ICONS[fam.famille] && <i className={`fa-solid ${FAMILLE_ICONS[fam.famille]}`} style={{color:'var(--berry)',fontSize:13}}></i>}
                                            <strong style={{fontSize:13,color:'var(--berry)'}}>{fam.famille}</strong>
                                            <span style={{fontSize:11,color:'var(--gray-400)'}}>{fam.effectif} ouvriers — {Math.round(fam.heures)}h — {Math.round(fam.cout).toLocaleString('fr-FR')} DH</span>
                                        </div>
                                        <table className="data-table">
                                            <thead><tr>
                                                <th>Opération</th>
                                                <th>Parcelle</th>
                                                <th>Ferme</th>
                                                <th>Effectif</th>
                                                <th>Heures</th>
                                                <th>Coût (DH)</th>
                                            </tr></thead>
                                            <tbody>
                                                {fam.ops.sort((a, b) => b.effectif - a.effectif).map((o, i) => (
                                                    <tr key={i}>
                                                        <td style={{fontWeight:500}}>{o.operation}</td>
                                                        <td style={{fontSize:11,color:'var(--gray-400)',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.parcelle}</td>
                                                        <td><span className="status-badge" style={{background: o.ferme==='F1' ? 'var(--berry-pale)' : (o.ferme==='F5' ? 'var(--green-pale)' : 'var(--orange-pale)'), color: o.ferme==='F1' ? 'var(--berry)' : (o.ferme==='F5' ? 'var(--green)' : 'var(--orange)'), fontSize:10}}>{o.ferme}</span></td>
                                                        <td><strong>{o.effectif}</strong></td>
                                                        <td>{Math.round(o.heures || 0)}h</td>
                                                        <td>{Math.round(o.cout || 0).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </Panel>
                </div>
            );
        }

export { HorsRecolteTab };
