/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseTab */
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { CaisseAvancesSub } from './CaisseAvancesSub.jsx';
import { CaisseComptesClientsSub } from './CaisseComptesClientsSub.jsx';
import { CaisseConfigSub } from './CaisseConfigSub.jsx';
import { CaisseDashboardSub } from './CaisseDashboardSub.jsx';
import { CaisseFilteredTypeSub } from './CaisseFilteredTypeSub.jsx';
import { CaisseImportEncaissementsSub } from './CaisseImportEncaissementsSub.jsx';
import { CaisseImportSub } from './CaisseImportSub.jsx';
import { CaisseRapportsSub } from './CaisseRapportsSub.jsx';
import { CaisseRapprochementSub } from './CaisseRapprochementSub.jsx';
import { CaisseTransactionsSub } from './CaisseTransactionsSub.jsx';
import { CaisseTransfertsSub } from './CaisseTransfertsSub.jsx';
import { CaisseValidationSub } from './CaisseValidationSub.jsx';

import { CaisseParametresSub } from './CaisseParametresSub.jsx';
import { CaisseSaisieSub } from './CaisseSaisieSub.jsx';
// ---- CaisseTab Main ----
        function CaisseTab({ currentProfile, profileData, userProfile }) {
            // Hint de sous-onglet initial (ex. remap legacy fin_marche_local →
            // Comptes Clients). Consommé une seule fois puis effacé.
            const initialSubTab = (() => {
                try {
                    const hint = sessionStorage.getItem('caisseInitialSubTab');
                    if (hint) { sessionStorage.removeItem('caisseInitialSubTab'); return hint; }
                } catch(e) {}
                return 'caisse_dashboard';
            })();
            const [subTab, setSubTab] = useState(initialSubTab);
            const [caisses, setCaisses] = useState([]);
            const [dashData, setDashData] = useState(null);
            const [loading, setLoading] = useState(true);
            const [refreshKey, setRefreshKey] = useState(0);

            const isControle = currentProfile === 'dg' || currentProfile === 'finance';
            const isSaisie = currentProfile === 'achats';

            const subTabs = [
                { id: 'caisse_dashboard', label: 'Dashboard', icon: 'fa-gauge-high' },
                { id: 'caisse_transactions', label: 'Transactions', icon: 'fa-list' },
                isSaisie ? { id: 'caisse_saisie', label: 'Nouvelle Saisie', icon: 'fa-plus-circle' } : null,
                { id: 'caisse_alimentations', label: 'Alimentations', icon: 'fa-arrow-down' },
                { id: 'caisse_paie', label: 'Paie', icon: 'fa-money-check-dollar' },
                { id: 'caisse_transport', label: 'Transport', icon: 'fa-truck' },
                { id: 'caisse_transferts', label: 'Transferts', icon: 'fa-right-left' },
                { id: 'caisse_avances', label: 'Avances', icon: 'fa-hand-holding-dollar' },
                isControle ? { id: 'caisse_validation', label: 'Validation', icon: 'fa-check-double' } : null,
                { id: 'caisse_rapports', label: 'Rapports', icon: 'fa-file-pdf' },
                isControle ? { id: 'caisse_rapprochement', label: 'Rapprochement', icon: 'fa-scale-balanced' } : null,
                (isSaisie || isControle) ? { id: 'caisse_import', label: 'Import Excel', icon: 'fa-file-import' } : null,
                (isSaisie || isControle) ? { id: 'caisse_import_encaissements', label: 'Import Encaissements', icon: 'fa-file-invoice-dollar' } : null,
                { id: 'caisse_comptes_clients', label: 'Comptes Clients', icon: 'fa-users' },
                isControle ? { id: 'caisse_config', label: 'Configuration', icon: 'fa-gear' } : null,
                // Distinct de « Configuration » (qui gère les caisses elles-mêmes) :
                // ici on configure les référentiels de SAISIE — fermes et codes
                // analytiques proposés sur un bon. Visible par tous (le service
                // Achats doit pouvoir consulter la liste), éditable DG/Finance.
                { id: 'caisse_parametres', label: 'Paramètres', icon: 'fa-sliders' },
            ].filter(Boolean);

            const loadDashboard = () => {
                setLoading(true);
                cachedFetch('/api/caisse?action=dashboard')
                    .then(json => { if (json.success) { setDashData(json); setCaisses(json.caisses || []); } })
                    .catch(() => {})
                    .finally(() => setLoading(false));
            };

            React.useEffect(() => { loadDashboard(); }, [refreshKey]);

            const refresh = () => setRefreshKey(k => k + 1);

            if (loading && !dashData) return (
                <div style={{display:'flex',justifyContent:'center',alignItems:'center',padding:60}}>
                    <i className="fa-solid fa-spinner fa-spin" style={{fontSize:24,color:'var(--berry)',marginRight:12}}></i>
                    <span style={{color:'var(--gray-600)'}}>Chargement de la caisse...</span>
                </div>
            );

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <h3 style={{margin:0,display:'flex',alignItems:'center',gap:10}}>
                            <i className="fa-solid fa-cash-register" style={{color:'var(--berry)'}}></i>
                            Gestion de Caisse
                        </h3>
                        <button onClick={refresh} style={{padding:'6px 14px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:6}}>
                            <i className="fa-solid fa-arrow-rotate-right"></i> Rafraîchir
                        </button>
                    </div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:20,overflowX:'auto',paddingBottom:4}}>
                        {subTabs.map(st => (
                            <button key={st.id} onClick={() => setSubTab(st.id)}
                                style={{padding:'8px 16px',borderRadius:20,border: subTab===st.id ? '2px solid var(--berry)' : '1px solid var(--gray-200)',
                                    background: subTab===st.id ? 'var(--berry)' : 'white', color: subTab===st.id ? 'white' : 'var(--gray-600)',
                                    fontSize:12,fontWeight:subTab===st.id?600:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6,whiteSpace:'nowrap',transition:'all 0.2s'}}>
                                <i className={`fa-solid ${st.icon}`} style={{fontSize:11}}></i>{st.label}
                                {st.id === 'caisse_validation' && dashData && dashData.pendingCount > 0 && (
                                    <span style={{background:'#E74C3C',color:'white',borderRadius:10,padding:'1px 7px',fontSize:10,fontWeight:700,marginLeft:2}}>{dashData.pendingCount}</span>
                                )}
                            </button>
                        ))}
                    </div>
                    {subTab === 'caisse_dashboard' && <CaisseDashboardSub dashData={dashData} caisses={caisses} isControle={isControle} onNavigate={setSubTab} />}
                    {subTab === 'caisse_transactions' && <CaisseTransactionsSub caisses={caisses} isSaisie={isSaisie} isControle={isControle} onRefresh={refresh} />}
                    {subTab === 'caisse_saisie' && CaisseSaisieSub && <CaisseSaisieSub caisses={caisses} onDone={() => { refresh(); setSubTab('caisse_transactions'); }} onCancel={() => setSubTab('caisse_transactions')} />}
                    {subTab === 'caisse_alimentations' && <CaisseFilteredTypeSub caisses={caisses} typeFilter="alimentation" title="Alimentations" icon="fa-arrow-down" isSaisie={isSaisie} onDone={refresh} />}
                    {subTab === 'caisse_paie' && <CaisseFilteredTypeSub caisses={caisses} typeFilter="paie" title="Paie" icon="fa-money-check-dollar" isSaisie={isSaisie} onDone={refresh} hasEmployee />}
                    {subTab === 'caisse_transport' && <CaisseFilteredTypeSub caisses={caisses} typeFilter="transport" title="Transport" icon="fa-truck" isSaisie={isSaisie} onDone={refresh} hasEmployee />}
                    {subTab === 'caisse_transferts' && <CaisseTransfertsSub caisses={caisses} isSaisie={isSaisie} onDone={refresh} />}
                    {subTab === 'caisse_validation' && <CaisseValidationSub caisses={caisses} onDone={refresh} />}
                    {subTab === 'caisse_avances' && <CaisseAvancesSub caisses={caisses} isControle={isControle} />}
                    {subTab === 'caisse_rapports' && <CaisseRapportsSub caisses={caisses} />}
                    {subTab === 'caisse_rapprochement' && <CaisseRapprochementSub caisses={caisses} />}
                    {subTab === 'caisse_import' && <CaisseImportSub caisses={caisses} onDone={refresh} />}
                    {subTab === 'caisse_import_encaissements' && <CaisseImportEncaissementsSub isControle={isControle} onApplied={refresh} />}
                    {subTab === 'caisse_comptes_clients' && <CaisseComptesClientsSub caisses={caisses} />}
                    {subTab === 'caisse_config' && <CaisseConfigSub caisses={caisses} onDone={refresh} />}
                    {subTab === 'caisse_parametres' && CaisseParametresSub && (
                        <CaisseParametresSub canEdit={isControle || (userProfile && userProfile.role === 'admin')} onSaved={refresh} />
                    )}
                </div>
            );
        }

export { CaisseTab };
