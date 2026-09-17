/* Module: recolte | Déclaration(s): PrimesTab */
import { DiversQuinzaineSub } from '../rh/DiversQuinzaineSub.jsx';
import { HeuresSupSub } from '../rh/HeuresSupSub.jsx';
import { JourFerieSub } from '../rh/JourFerieSub.jsx';
import { TransportSub } from '../rh/TransportSub.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { ChargementSub } from './ChargementSub.jsx';
import { ConditionnementSub } from './ConditionnementSub.jsx';
import { PrimesRecapSub } from './PrimesRecapSub.jsx';
import { PrimesRecolteTab } from './PrimesRecolteTab.jsx';
import { TraitementSub } from './TraitementSub.jsx';

// ===================== TRANSPORTEUR TAB =====================
        function PrimesTab({ data, farmFilter, avoSubFilter, initialPeriode, onInitialPeriodeConsumed }) {
            const [primeSub, setPrimeSub] = useState('recap');
            // initialPeriode != null => navigation depuis Quinzaine : on pré-sélectionne la quinzaine
            // passée (peut être '' = dernière quinzaine, valeur sentinelle identique au défaut).
            const [sharedPeriode, setSharedPeriode] = useState(initialPeriode != null ? initialPeriode : '');
            // Quinzaine pré-sélectionnée à propager au sous-onglet récap (one-shot).
            const [recapInitialPeriode, setRecapInitialPeriode] = useState(initialPeriode != null ? initialPeriode : '');
            React.useEffect(() => {
                if (initialPeriode != null) {
                    setSharedPeriode(initialPeriode);
                    setRecapInitialPeriode(initialPeriode);
                    setPrimeSub('recap');
                    if (typeof onInitialPeriodeConsumed === 'function') onInitialPeriodeConsumed();
                }
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [initialPeriode]);
            const navigateToDetail = (tabId, periode) => { if (periode) setSharedPeriode(periode); setPrimeSub(tabId); };
            const subTabs = [
                { id: 'recap', label: 'Récapitulatif', icon: 'fa-chart-pie' },
                { id: 'recolte', label: 'Récolte', icon: 'fa-coins' },
                { id: 'transport', label: 'Transport', icon: 'fa-bus' },
                { id: 'traitement', label: 'Traitement', icon: 'fa-spray-can-sparkles' },
                { id: 'conditionnement', label: 'Conditionnement', icon: 'fa-box-open' },
                { id: 'chargement', label: 'Chargement', icon: 'fa-truck-loading' },
                { id: 'jour_ferie', label: 'Jour Férié', icon: 'fa-star' },
                { id: 'heures_sup', label: 'Heures Supp.', icon: 'fa-clock' },
                { id: 'pointage_divers', label: 'Pointage Divers', icon: 'fa-truck' },
            ];
            return (
                <div className="fade-in">
                    <div className="chip-group" style={{marginBottom:20}}>
                        {subTabs.map(st => (
                            <button key={st.id} className={`chip c-berry ${primeSub === st.id ? 'active' : ''}`} onClick={() => setPrimeSub(st.id)} style={{padding:'7px 14px',fontSize:12}}>
                                <i className={`fa-solid ${st.icon}`} style={{marginRight:6}}></i>{st.label}
                            </button>
                        ))}
                    </div>
                    {primeSub === 'recap' && <PrimesRecapSub data={data} onNavigate={navigateToDetail} farmFilter={farmFilter} initialPeriode={recapInitialPeriode} />}
                    {primeSub === 'recolte' && <PrimesRecolteTab data={data} farmFilter={farmFilter} initialPeriode={sharedPeriode} />}
                    {primeSub === 'transport' && <TransportSub data={data} farmFilter={farmFilter} initialPeriode={sharedPeriode} />}
                    {primeSub === 'traitement' && <TraitementSub data={data} farmFilter={farmFilter} initialPeriode={sharedPeriode} />}
                    {primeSub === 'conditionnement' && <ConditionnementSub data={data} farmFilter={farmFilter} initialPeriode={sharedPeriode} />}
                    {primeSub === 'chargement' && <ChargementSub data={data} farmFilter={farmFilter} initialPeriode={sharedPeriode} />}
                    {primeSub === 'jour_ferie' && <JourFerieSub data={data} farmFilter={farmFilter} initialPeriode={sharedPeriode} />}
                    {primeSub === 'heures_sup' && <HeuresSupSub data={data} farmFilter={farmFilter} initialPeriode={sharedPeriode} />}
                    {primeSub === 'pointage_divers' && <DiversQuinzaineSub farmFilter={farmFilter} initialPeriode={sharedPeriode} />}
                </div>
            );
        }

export { PrimesTab };
