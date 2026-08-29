/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): CampagneTab */
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { deriveSubFerme } from '../shared/deriveSubFerme.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { CampagneSegmentTable } from './CampagneSegmentTable.jsx';

function CampagneTab({ data, farmFilter, avoSubFilter }) {
            const [moAnalytique, setMoAnalytique] = useState(null);
            const [loading, setLoading] = useState(true);

            React.useEffect(() => {
                cachedFetch('/api/pointage-rh?action=campagne-mo-variete&v=2')
                    .then(json => { if (json.success) setMoAnalytique(json); })
                    .catch(() => {})
                    .finally(() => setLoading(false));
            }, []);

            const campagne = moAnalytique?.campagne;
            const subFermeFilter = avoSubFilter && avoSubFilter !== 'all' ? avoSubFilter : null;
            const matchesFarm = (v) => {
                if (!farmFilter) return true;
                if (farmFilter === 'Avocatier') {
                    if (v.ferme !== 'Avocatier') return false;
                    if (subFermeFilter) {
                        const sub = deriveSubFerme(v.refParcelle || '', v.parcelle || '');
                        return sub === subFermeFilter;
                    }
                    return true;
                }
                return v.ferme === farmFilter;
            };

            return (
                <div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:12}}>
                        <div>
                            <h2 style={{margin:0,fontSize:20,fontWeight:700,color:'var(--berry)'}}>
                                <i className="fa-solid fa-chart-line" style={{marginRight:10}}></i>Campagne — M.O par Variété & Cycle
                            </h2>
                            <div style={{fontSize:12,color:'var(--gray-400)',marginTop:4}}>
                                Cycle 1 (Juil→Déc) et Cycle 2 (Jan→Juin). Reyna affiché en cumul annuel (cycle unique).
                            </div>
                        </div>
                        {campagne && (
                            <span style={{padding:'6px 14px',background:'var(--berry-pale)',color:'var(--berry)',borderRadius:20,fontSize:12,fontWeight:600}}>
                                <i className="fa-solid fa-calendar" style={{marginRight:6}}></i>Campagne {campagne.label}
                            </span>
                        )}
                    </div>

                    {loading || !moAnalytique ? (
                        <Panel title="Chargement..." icon="fa-spinner">
                            <div style={{textAlign:'center',padding:30,color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-spinner fa-spin" style={{marginRight:8}}></i>Chargement données M.O cumulées...
                            </div>
                        </Panel>
                    ) : (
                        <React.Fragment>
                            <CampagneSegmentTable
                                title={`${moAnalytique.cycle1?.label || 'Cycle 1'} — M.O par Variété`}
                                icon="fa-sun"
                                segment={moAnalytique.cycle1}
                                matchesFarm={matchesFarm}
                                showMonoCycleOnly={false}
                            />
                            <CampagneSegmentTable
                                title={`${moAnalytique.cycle2?.label || 'Cycle 2'} — M.O par Variété`}
                                icon="fa-snowflake"
                                segment={moAnalytique.cycle2}
                                matchesFarm={matchesFarm}
                                showMonoCycleOnly={false}
                            />
                            <CampagneSegmentTable
                                title="Variétés Mono-Cycle — Cumul Annuel"
                                icon="fa-infinity"
                                segment={moAnalytique.annuel}
                                matchesFarm={matchesFarm}
                                showMonoCycleOnly={true}
                            />
                        </React.Fragment>
                    )}
                </div>
            );
        }

export { CampagneTab };
