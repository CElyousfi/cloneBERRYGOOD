/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): AuthenticatedApp */
/* ─── ONGLETS EN CHARGEMENT DIFFÉRÉ ───────────────────────────────────────
   Les 112 onglets sont chargés à la demande, pas au boot. `renderTab` ne rend
   que l'onglet courant (`if (currentTab !== tabId) return null`) : les 111 autres
   n'ont aucune raison d'être dans le bundle d'entrée. Chacun devient un chunk que
   Vite émet séparément et que le navigateur ne va chercher qu'à l'ouverture.

   `React.lazy` attend un export DEFAULT ; les modules exposent un export nommé,
   d'où le `.then(m => ({ default: m.X }))`. React est une globale (UMD via CDN,
   cf. index.html) et ces scripts s'exécutent avant le module : `React.lazy` est
   donc défini au moment où ces constantes sont évaluées.

   Le repli de `Suspense` et la frontière d'erreur vivent tous deux dans
   `renderTab` — un onglet qui tarde affiche un message, un onglet qui casse
   n'emporte pas l'application (règle 5 de CLAUDE.md). */
const AchatsAnalysesFoliairesTab = React.lazy(() => import('../achats/AchatsAnalysesFoliairesTab.jsx').then(m => ({ default: m.AchatsAnalysesFoliairesTab })));
const AchatsBDCTab = React.lazy(() => import('../achats/AchatsBDCTab.jsx').then(m => ({ default: m.AchatsBDCTab })));
const AchatsBonApportTab = React.lazy(() => import('../achats/AchatsBonApportTab.jsx').then(m => ({ default: m.AchatsBonApportTab })));
const AchatsCatalogueTab = React.lazy(() => import('../achats/AchatsCatalogueTab.jsx').then(m => ({ default: m.AchatsCatalogueTab })));
const AchatsConsultationTab = React.lazy(() => import('../achats/AchatsConsultationTab.jsx').then(m => ({ default: m.AchatsConsultationTab })));
const AchatsDATab = React.lazy(() => import('../achats/AchatsDATab.jsx').then(m => ({ default: m.AchatsDATab })));
const AchatsDashboardTab = React.lazy(() => import('../achats/AchatsDashboardTab.jsx').then(m => ({ default: m.AchatsDashboardTab })));
const AchatsFacturesTab = React.lazy(() => import('../achats/AchatsFacturesTab.jsx').then(m => ({ default: m.AchatsFacturesTab })));
const AchatsFournisseursTab = React.lazy(() => import('../achats/AchatsFournisseursTab.jsx').then(m => ({ default: m.AchatsFournisseursTab })));
const AchatsPaiementsTab = React.lazy(() => import('../achats/AchatsPaiementsTab.jsx').then(m => ({ default: m.AchatsPaiementsTab })));
const AchatsRapprochementTab = React.lazy(() => import('../achats/AchatsRapprochementTab.jsx').then(m => ({ default: m.AchatsRapprochementTab })));
const AchatsReceptionsValoriserTab = React.lazy(() => import('../achats/AchatsReceptionsValoriserTab.jsx').then(m => ({ default: m.AchatsReceptionsValoriserTab })));
const AchatsScanBLTab = React.lazy(() => import('../achats/AchatsScanBLTab.jsx').then(m => ({ default: m.AchatsScanBLTab })));
const AchatsScanFacturesTab = React.lazy(() => import('../achats/AchatsScanFacturesTab.jsx').then(m => ({ default: m.AchatsScanFacturesTab })));
const AchatsVentePlastiqueTab = React.lazy(() => import('../achats/AchatsVentePlastiqueTab.jsx').then(m => ({ default: m.AchatsVentePlastiqueTab })));
// Rendu conditionnellement comme un onglet, mais hors de `renderTab` : il
// echappait donc au chargement differe des 112 autres. Meme traitement ici.
const AdminConsoleTab = React.lazy(() => import('../admin/AdminConsoleTab.jsx').then(m => ({ default: m.AdminConsoleTab })));
const DGAdoptionTab = React.lazy(() => import('../admin/DGAdoptionTab.jsx').then(m => ({ default: m.DGAdoptionTab })));
const DGMeetingCRTab = React.lazy(() => import('../admin/DGMeetingCRTab.jsx').then(m => ({ default: m.DGMeetingCRTab })));
const DGParametresTab = React.lazy(() => import('../admin/DGParametresTab.jsx').then(m => ({ default: m.DGParametresTab })));
const DGSignatureTab = React.lazy(() => import('../admin/DGSignatureTab.jsx').then(m => ({ default: m.DGSignatureTab })));
const DGTasksTab = React.lazy(() => import('../admin/DGTasksTab.jsx').then(m => ({ default: m.DGTasksTab })));
const DGValidationsTab = React.lazy(() => import('../admin/DGValidationsTab.jsx').then(m => ({ default: m.DGValidationsTab })));
const ParametresTab = React.lazy(() => import('../admin/ParametresTab.jsx').then(m => ({ default: m.ParametresTab })));
import { TutorialMenu } from '../admin/TutorialMenu.jsx';
import { getTutorials } from '../admin/getTutorials.jsx';
import { useTutorialEngine } from '../admin/useTutorialEngine.jsx';
const AgroAvancementTab = React.lazy(() => import('../agronomie/AgroAvancementTab.jsx').then(m => ({ default: m.AgroAvancementTab })));
const AgroCompositionTab = React.lazy(() => import('../agronomie/AgroCompositionTab.jsx').then(m => ({ default: m.AgroCompositionTab })));
const AgroDashboardTab = React.lazy(() => import('../agronomie/AgroDashboardTab.jsx').then(m => ({ default: m.AgroDashboardTab })));
const AgroFarmroadTab = React.lazy(() => import('../agronomie/AgroFarmroadTab.jsx').then(m => ({ default: m.AgroFarmroadTab })));
const AgroFertilisationTab = React.lazy(() => import('../agronomie/AgroFertilisationTab.jsx').then(m => ({ default: m.AgroFertilisationTab })));
const AgroForecastTab = React.lazy(() => import('../agronomie/AgroForecastTab.jsx').then(m => ({ default: m.AgroForecastTab })));
const AgroGrowthTab = React.lazy(() => import('../agronomie/AgroGrowthTab.jsx').then(m => ({ default: m.AgroGrowthTab })));
const AgroHarvestPredictionTab = React.lazy(() => import('../agronomie/AgroHarvestPredictionTab.jsx').then(m => ({ default: m.AgroHarvestPredictionTab })));
const AgroIrrigationTab = React.lazy(() => import('../agronomie/AgroIrrigationTab.jsx').then(m => ({ default: m.AgroIrrigationTab })));
const AgroParcellesTab = React.lazy(() => import('../agronomie/AgroParcellesTab.jsx').then(m => ({ default: m.AgroParcellesTab })));
const AgroPhytoTab = React.lazy(() => import('../agronomie/AgroPhytoTab.jsx').then(m => ({ default: m.AgroPhytoTab })));
// Rendu conditionnellement comme un onglet, mais hors de `renderTab` : il
// echappait donc au chargement differe des 112 autres. Meme traitement ici.
const EvolutionTab = React.lazy(() => import('../agronomie/EvolutionTab.jsx').then(m => ({ default: m.EvolutionTab })));
const PlanificationTab = React.lazy(() => import('../agronomie/PlanificationTab.jsx').then(m => ({ default: m.PlanificationTab })));
const ProductivityReportTab = React.lazy(() => import('../agronomie/ProductivityReportTab.jsx').then(m => ({ default: m.ProductivityReportTab })));
import { __savedTab } from '../bootstrap.jsx';
const CaisseTab = React.lazy(() => import('../caisse/CaisseTab.jsx').then(m => ({ default: m.CaisseTab })));
const BudgetVsReelTab = React.lazy(() => import('../finance/BudgetVsReelTab.jsx').then(m => ({ default: m.BudgetVsReelTab })));
const FinBDCTab = React.lazy(() => import('../finance/FinBDCTab.jsx').then(m => ({ default: m.FinBDCTab })));
const FinCATab = React.lazy(() => import('../finance/FinCATab.jsx').then(m => ({ default: m.FinCATab })));
const FinCarburantTab = React.lazy(() => import('../finance/FinCarburantTab.jsx').then(m => ({ default: m.FinCarburantTab })));
const FinCodesAnalytiquesTab = React.lazy(() => import('../finance/FinCodesAnalytiquesTab.jsx').then(m => ({ default: m.FinCodesAnalytiquesTab })));
const FinDashboardTab = React.lazy(() => import('../finance/FinDashboardTab.jsx').then(m => ({ default: m.FinDashboardTab })));
const FinDeleteArticlesTab = React.lazy(() => import('../finance/FinDeleteArticlesTab.jsx').then(m => ({ default: m.FinDeleteArticlesTab })));
const FinFacturesTab = React.lazy(() => import('../finance/FinFacturesTab.jsx').then(m => ({ default: m.FinFacturesTab })));
const FinLiquidationsTab = React.lazy(() => import('../finance/FinLiquidationsTab.jsx').then(m => ({ default: m.FinLiquidationsTab })));
const FinOjraTab = React.lazy(() => import('../finance/FinOjraTab.jsx').then(m => ({ default: m.FinOjraTab })));
const FinPaiementsTab = React.lazy(() => import('../finance/FinPaiementsTab.jsx').then(m => ({ default: m.FinPaiementsTab })));
const FinPlantsTab = React.lazy(() => import('../finance/FinPlantsTab.jsx').then(m => ({ default: m.FinPlantsTab })));
const FinStockTab = React.lazy(() => import('../finance/FinStockTab.jsx').then(m => ({ default: m.FinStockTab })));
const FinTelecomTab = React.lazy(() => import('../finance/FinTelecomTab.jsx').then(m => ({ default: m.FinTelecomTab })));
const FinTresorerieTab = React.lazy(() => import('../finance/FinTresorerieTab.jsx').then(m => ({ default: m.FinTresorerieTab })));
const FinVirementsTab = React.lazy(() => import('../finance/FinVirementsTab.jsx').then(m => ({ default: m.FinVirementsTab })));
const FinanceMarcheLocalTab = React.lazy(() => import('../finance/FinanceMarcheLocalTab.jsx').then(m => ({ default: m.FinanceMarcheLocalTab })));
const MagDashboardStockTab = React.lazy(() => import('../magasin/MagDashboardStockTab.jsx').then(m => ({ default: m.MagDashboardStockTab })));
const MagFicheStockTab = React.lazy(() => import('../magasin/MagFicheStockTab.jsx').then(m => ({ default: m.MagFicheStockTab })));
const MagInventaireTab = React.lazy(() => import('../magasin/MagInventaireTab.jsx').then(m => ({ default: m.MagInventaireTab })));
const MagMouvementsTab = React.lazy(() => import('../magasin/MagMouvementsTab.jsx').then(m => ({ default: m.MagMouvementsTab })));
const MagParcTab = React.lazy(() => import('../magasin/MagParcTab.jsx').then(m => ({ default: m.MagParcTab })));
const MagReceptionTab = React.lazy(() => import('../magasin/MagReceptionTab.jsx').then(m => ({ default: m.MagReceptionTab })));
const MagSortieTab = React.lazy(() => import('../magasin/MagSortieTab.jsx').then(m => ({ default: m.MagSortieTab })));
const MagStockIntrantsTab = React.lazy(() => import('../magasin/MagStockIntrantsTab.jsx').then(m => ({ default: m.MagStockIntrantsTab })));
const MagTransfertTab = React.lazy(() => import('../magasin/MagTransfertTab.jsx').then(m => ({ default: m.MagTransfertTab })));
const ChefAgronomieTab = React.lazy(() => import('../qualite/ChefAgronomieTab.jsx').then(m => ({ default: m.ChefAgronomieTab })));
const ChefDATab = React.lazy(() => import('../qualite/ChefDATab.jsx').then(m => ({ default: m.ChefDATab })));
const ChefTrackingTab = React.lazy(() => import('../qualite/ChefTrackingTab.jsx').then(m => ({ default: m.ChefTrackingTab })));
const ChefValidationBonsTab = React.lazy(() => import('../qualite/ChefValidationBonsTab.jsx').then(m => ({ default: m.ChefValidationBonsTab })));
const ChefValidationsTab = React.lazy(() => import('../qualite/ChefValidationsTab.jsx').then(m => ({ default: m.ChefValidationsTab })));
const DQRDailyTab = React.lazy(() => import('../qualite/DQRDailyTab.jsx').then(m => ({ default: m.DQRDailyTab })));
const QualiteBonsApportTab = React.lazy(() => import('../qualite/QualiteBonsApportTab.jsx').then(m => ({ default: m.QualiteBonsApportTab })));
const QualiteBrixTab = React.lazy(() => import('../qualite/QualiteBrixTab.jsx').then(m => ({ default: m.QualiteBrixTab })));
const QualiteDashboardTab = React.lazy(() => import('../qualite/QualiteDashboardTab.jsx').then(m => ({ default: m.QualiteDashboardTab })));
const QualiteEcartsTab = React.lazy(() => import('../qualite/QualiteEcartsTab.jsx').then(m => ({ default: m.QualiteEcartsTab })));
const QualiteExpeditionsTab = React.lazy(() => import('../qualite/QualiteExpeditionsTab.jsx').then(m => ({ default: m.QualiteExpeditionsTab })));
const QualiteHistoriqueTab = React.lazy(() => import('../qualite/QualiteHistoriqueTab.jsx').then(m => ({ default: m.QualiteHistoriqueTab })));
const QualiteInspectionsTab = React.lazy(() => import('../qualite/QualiteInspectionsTab.jsx').then(m => ({ default: m.QualiteInspectionsTab })));
const QualiteLiquidationsTab = React.lazy(() => import('../qualite/QualiteLiquidationsTab.jsx').then(m => ({ default: m.QualiteLiquidationsTab })));
const QualiteMarcheLocalTab = React.lazy(() => import('../qualite/QualiteMarcheLocalTab.jsx').then(m => ({ default: m.QualiteMarcheLocalTab })));
const QualitePFQInterneTab = React.lazy(() => import('../qualite/QualitePFQInterneTab.jsx').then(m => ({ default: m.QualitePFQInterneTab })));
const QualiteProductionTab = React.lazy(() => import('../qualite/QualiteProductionTab.jsx').then(m => ({ default: m.QualiteProductionTab })));
const QualiteReconciliationTab = React.lazy(() => import('../qualite/QualiteReconciliationTab.jsx').then(m => ({ default: m.QualiteReconciliationTab })));
const QualiteSuiviCalibreTab = React.lazy(() => import('../qualite/QualiteSuiviCalibreTab.jsx').then(m => ({ default: m.QualiteSuiviCalibreTab })));
const QualiteValidationBonsTab = React.lazy(() => import('../qualite/QualiteValidationBonsTab.jsx').then(m => ({ default: m.QualiteValidationBonsTab })));
const CaporalHistoriqueTab = React.lazy(() => import('../recolte/CaporalHistoriqueTab.jsx').then(m => ({ default: m.CaporalHistoriqueTab })));
const CaporalSaisieTab = React.lazy(() => import('../recolte/CaporalSaisieTab.jsx').then(m => ({ default: m.CaporalSaisieTab })));
const CaporalSuiviTab = React.lazy(() => import('../recolte/CaporalSuiviTab.jsx').then(m => ({ default: m.CaporalSuiviTab })));
const CoutRecolteTab = React.lazy(() => import('../recolte/CoutRecolteTab.jsx').then(m => ({ default: m.CoutRecolteTab })));
const HorsRecolteSuiviTab = React.lazy(() => import('../recolte/HorsRecolteSuiviTab.jsx').then(m => ({ default: m.HorsRecolteSuiviTab })));
const HorsRecolteTab = React.lazy(() => import('../recolte/HorsRecolteTab.jsx').then(m => ({ default: m.HorsRecolteTab })));
const PrimesTab = React.lazy(() => import('../recolte/PrimesTab.jsx').then(m => ({ default: m.PrimesTab })));
const RecolteTab = React.lazy(() => import('../recolte/RecolteTab.jsx').then(m => ({ default: m.RecolteTab })));
const EquipesTab = React.lazy(() => import('../rh/EquipesTab.jsx').then(m => ({ default: m.EquipesTab })));
const PaieTab = React.lazy(() => import('../rh/PaieTab.jsx').then(m => ({ default: m.PaieTab })));
const PointageDiversTab = React.lazy(() => import('../rh/PointageDiversTab.jsx').then(m => ({ default: m.PointageDiversTab })));
const PointageTab = React.lazy(() => import('../rh/PointageTab.jsx').then(m => ({ default: m.PointageTab })));
const PointageValidationViewWrapper = React.lazy(() => import('../rh/PointageValidationViewWrapper.jsx').then(m => ({ default: m.PointageValidationViewWrapper })));
const QuinzaineTab = React.lazy(() => import('../rh/QuinzaineTab.jsx').then(m => ({ default: m.QuinzaineTab })));
const SuiviPointageTab = React.lazy(() => import('../rh/SuiviPointageTab.jsx').then(m => ({ default: m.SuiviPointageTab })));
const SuiviTab = React.lazy(() => import('../rh/SuiviTab.jsx').then(m => ({ default: m.SuiviTab })));
const SecurityEnvoisWATab = React.lazy(() => import('../securite/SecurityEnvoisWATab.jsx').then(m => ({ default: m.SecurityEnvoisWATab })));
const SecurityIncidentsTab = React.lazy(() => import('../securite/SecurityIncidentsTab.jsx').then(m => ({ default: m.SecurityIncidentsTab })));
const SecurityRegistreTab = React.lazy(() => import('../securite/SecurityRegistreTab.jsx').then(m => ({ default: m.SecurityRegistreTab })));
const SecurityScanRegistreTab = React.lazy(() => import('../securite/SecurityScanRegistreTab.jsx').then(m => ({ default: m.SecurityScanRegistreTab })));
const SecurityTunnelsTab = React.lazy(() => import('../securite/SecurityTunnelsTab.jsx').then(m => ({ default: m.SecurityTunnelsTab })));
const IrrigationIntelligenceTab = React.lazy(() => import('../technique/IrrigationIntelligenceTab.jsx').then(m => ({ default: m.IrrigationIntelligenceTab })));
const MeteoTab = React.lazy(() => import('../technique/MeteoTab.jsx').then(m => ({ default: m.MeteoTab })));
const StationnaireAnalyseTab = React.lazy(() => import('../technique/StationnaireAnalyseTab.jsx').then(m => ({ default: m.StationnaireAnalyseTab })));
const StationnaireHistoriqueTab = React.lazy(() => import('../technique/StationnaireHistoriqueTab.jsx').then(m => ({ default: m.StationnaireHistoriqueTab })));
const StationnaireImportScanTab = React.lazy(() => import('../technique/StationnaireImportScanTab.jsx').then(m => ({ default: m.StationnaireImportScanTab })));
const StationnaireIrrigationTab = React.lazy(() => import('../technique/StationnaireIrrigationTab.jsx').then(m => ({ default: m.StationnaireIrrigationTab })));
import { fetchMeteoblueData } from '../technique/fetchMeteoblueData.jsx';
import { transformMeteoblueData } from '../technique/transformMeteoblueData.jsx';
import { AVO_SUB_FARMS } from './AVO_SUB_FARMS.jsx';
const ComingSoonTab = React.lazy(() => import('./ComingSoonTab.jsx').then(m => ({ default: m.ComingSoonTab })));
const DashboardAssocieTab = React.lazy(() => import('./DashboardAssocieTab.jsx').then(m => ({ default: m.DashboardAssocieTab })));
const DashboardTab = React.lazy(() => import('./DashboardTab.jsx').then(m => ({ default: m.DashboardTab })));
import { FARMS } from './FARMS.jsx';
import { FARM_NAMES } from './FARM_NAMES.jsx';
import { InstallGuide } from './InstallGuide.jsx';
import { MesTachesWidget } from './MesTachesWidget.jsx';
import { NAV_ITEMS_ACHATS } from './NAV_ITEMS_ACHATS.jsx';
import { NAV_ITEMS_AGRO } from './NAV_ITEMS_AGRO.jsx';
import { NAV_ITEMS_ASSOCIE } from './NAV_ITEMS_ASSOCIE.jsx';
import { NAV_ITEMS_CAPORAL } from './NAV_ITEMS_CAPORAL.jsx';
import { NAV_ITEMS_CHEF_AVO } from './NAV_ITEMS_CHEF_AVO.jsx';
import { NAV_ITEMS_CHEF_BAHIA } from './NAV_ITEMS_CHEF_BAHIA.jsx';
import { NAV_ITEMS_DT } from './NAV_ITEMS_DT.jsx';
import { NAV_ITEMS_FINANCE } from './NAV_ITEMS_FINANCE.jsx';
import { NAV_ITEMS_MAGASINIER } from './NAV_ITEMS_MAGASINIER.jsx';
import { NAV_ITEMS_OTHER } from './NAV_ITEMS_OTHER.jsx';
import { NAV_ITEMS_QUALITE } from './NAV_ITEMS_QUALITE.jsx';
import { NAV_ITEMS_RH } from './NAV_ITEMS_RH.jsx';
import { NAV_ITEMS_SECURITE } from './NAV_ITEMS_SECURITE.jsx';
import { NAV_ITEMS_STATIONNAIRE } from './NAV_ITEMS_STATIONNAIRE.jsx';
import { PROFILES } from './PROFILES.jsx';
import { TabErrorBoundary } from './TabErrorBoundary.jsx';
import { cachedFetch } from './cachedFetch.jsx';
import { generateMockData } from './generateMockData.jsx';
import { adaptNormesProductivite } from '../agronomie/normesProductiviteAdapter.jsx';
import { computeCADetail } from '../finance/computeCADetail.jsx';
import { loadBonsFromFirestore } from './loadBonsFromFirestore.jsx';
import { getVisibleProfiles } from './getVisibleProfiles.jsx';
import { invalidateCache } from './invalidateCache.jsx';
import { useEffect, useMemo, useRef, useState } from './reactHooks.jsx';
import { lazyGlobalComponent } from './lazyGlobalComponent.jsx';

/* ─── ONGLETS LEGACY EN CHARGEMENT DIFFÉRÉ ───────────────────────────────
   Ces onglets vivent encore dans public/components/ comme scripts classiques
   publiés sur `window`. index.html les chargeait tous au démarrage — 767 Ko
   pour des écrans qu'un utilisateur ouvre rarement. Ils sont désormais tirés
   au premier rendu, comme les onglets modulaires.

   L'ordre des sources compte : les dépendances d'abord. CampagneAnalytiqueTab
   lit window.CampagneBudgetTab pendant son exécution, MagBCTab lit ses trois
   dialogues. Les charger en parallèle laisserait passer un undefined. */
const CampagneAnalytiqueTabLazy = lazyGlobalComponent('CampagneAnalytiqueTab', ['components/CampagneBudgetTab.js', 'components/PivotAnalytiqueGrid.js', 'components/CampagneAnalytiqueTab.js']);
const MagBCTabLazy = lazyGlobalComponent('MagBCTab', ['components/BCDoublonDialog.js', 'components/ArticleConversionFields.js', 'components/MagBCScanModal.js', 'components/MagBCTab.js']);
const ParcellesReferentielTabLazy = lazyGlobalComponent('ParcellesReferentielTab', ['components/ParcellesGroupesPanel.js', 'components/ParcellesReferentielTab.js']);
const PrimesFixesTabLazy = lazyGlobalComponent('PrimesFixesTab', ['components/PrimesFixesTab.js']);
const ConsoValoriseeTabLazy = lazyGlobalComponent('ConsoValoriseeTab', ['components/ConsoValoriseeTab.js']);
const MagBdcReceptionTabLazy = lazyGlobalComponent('MagBdcReceptionTab', ['components/MagBdcReceptionTab.js']);
const MagBonsCommandeTabLazy = lazyGlobalComponent('MagBonsCommandeTab', ['components/MagBonsCommandeTab.js']);
const MagMappingConsoTabLazy = lazyGlobalComponent('MagMappingConsoTab', ['components/MagMappingConsoTab.js']);
const MagStockFilesTabLazy = lazyGlobalComponent('MagStockFilesTab', ['components/MagStockFilesTab.js']);
const ParcellesParamsTabLazy = lazyGlobalComponent('ParcellesParamsTab', ['components/ParcellesParamsTab.js']);

// Main authenticated app — all hooks are safe here since this only mounts when auth is confirmed
        function AuthenticatedApp({ authUser, userProfile }) {
            const isFullAccess = userProfile.role === 'admin' || userProfile.role === 'finance' || userProfile.profileId === 'audit_interne';
            const visibleProfiles = getVisibleProfiles(userProfile);

            const [currentProfile, setCurrentProfile] = useState(() => {
                if (!isFullAccess) return userProfile.profileId;
                const saved = localStorage.getItem('lastProfile');
                if (saved && visibleProfiles.some(p => p.id === saved)) return saved;
                return userProfile.profileId;
            });
            const [currentTab, setCurrentTab] = useState(__savedTab);
            const [primesInitialPeriode, setPrimesInitialPeriode] = useState(null);
            const [sidebarOpen, setSidebarOpen] = useState(false);
            const [showMoreMenu, setShowMoreMenu] = useState(false);
            const [showMobileProfileMenu, setShowMobileProfileMenu] = useState(false);
            const [dtStationMode, setDtStationMode] = useState(false);
            const [dtFarm, setDtFarm] = useState(() => localStorage.getItem('dtFarm') || 'F1');
            const [avoFarm, setAvoFarm] = useState(() => localStorage.getItem('avoFarm') || 'Toutes');
            const [agroApiData, setAgroApiData] = useState(null);
            const [agroApiStatus, setAgroApiStatus] = useState('idle');
            const [weeklyQRData, setWeeklyQRData] = useState(null);
            // Primes transport persistées (Firestore: rh_config/transport_primes)
            // Shape: [{ prefix, equipe, caporal, ferme, history: [{ effectiveFrom, coutParOuvrier, updatedAt, updatedBy }] }]
            const [transportPrimesOverride, setTransportPrimesOverride] = useState(null);
            React.useEffect(() => {
                try {
                    firebase.firestore().collection('rh_config').doc('transport_primes').get()
                        .then(snap => { if (snap.exists) setTransportPrimesOverride(snap.data().equipes || []); })
                        .catch(e => console.warn('[transport_primes] load failed', e));
                } catch (e) { console.warn('[transport_primes] init failed', e); }
            }, []);
            const [weeklyBerryFilter, setWeeklyBerryFilter] = useState('framboise');
            const [refreshKey, setRefreshKey] = useState(0);
            const [pullDist, setPullDist] = useState(0);
            const pullRef = useRef(null);
            const pullStartY = useRef(null);
            const [notifPopup, setNotifPopup] = useState(false);
            const [notifData, setNotifData] = useState(null);
            const [notifCount, setNotifCount] = useState(0);
            const notifFetchedRef = useRef(null);
            // Dismissed notifications — persistance par user (localStorage, scopé uid+profil).
            // NOTE: stockage local-only car il n'existe pas de collection Firestore writable par
            // l'user pour les dismissals (cf. firestore.rules : `notifications` est read-only client).
            // Une persistance Firestore cross-device nécessiterait une nouvelle règle
            // `notif_dismissals/{uid}` ou une Cloud Function = deploy GATED (à arbitrer par l'archi).
            const notifDismissStorageKey = (profileId) => 'notif_dismissed_' + (authUser && authUser.uid ? authUser.uid : 'anon') + '_' + (profileId || '');
            const readNotifDismissed = (profileId) => {
                try {
                    const raw = localStorage.getItem(notifDismissStorageKey(profileId));
                    if (!raw) return new Set();
                    const arr = JSON.parse(raw);
                    return new Set(Array.isArray(arr) ? arr : []);
                } catch(e) { return new Set(); }
            };
            // Clé de dismissal : `key:count` → si le compteur change (nouveau travail), la notif revient.
            const notifDismissId = (item) => (item.key || item.label || '') + ':' + (item.count || 0);
            const notifDismissedRef = useRef(new Set());

            // Install guide state
            const [showInstallGuide, setShowInstallGuide] = useState(false);

            // Tutorial state
            const [showTutorialMenu, setShowTutorialMenu] = useState(false);
            const { startTutorial } = useTutorialEngine(setCurrentTab, setSidebarOpen);

            // Alias parcelles — persisté en localStorage
            const [parcAliases, setParcAliases] = useState(() => {
                try { return JSON.parse(localStorage.getItem('parcAliases') || '{}'); } catch(e) { return {}; }
            });
            const updateAlias = (original, alias) => {
                setParcAliases(prev => {
                    const next = { ...prev };
                    if (alias && alias.trim() && alias.trim() !== original) {
                        next[original] = alias.trim();
                    } else {
                        delete next[original];
                    }
                    localStorage.setItem('parcAliases', JSON.stringify(next));
                    return next;
                });
            };
            const getAlias = (original) => parcAliases[original] || original;

            // Ferme assignments — persisté en localStorage
            const [parcFermes, setParcFermes] = useState(() => {
                try { return JSON.parse(localStorage.getItem('parcFermes') || '{}'); } catch(e) { return {}; }
            });
            const updateFerme = (parcName, ferme) => {
                setParcFermes(prev => {
                    const next = { ...prev };
                    if (ferme) { next[parcName] = ferme; } else { delete next[parcName]; }
                    localStorage.setItem('parcFermes', JSON.stringify(next));
                    return next;
                });
            };
            const getFerme = (parcName, defaultFerme) => parcFermes[parcName] || defaultFerme;

            // Variety mapping: batch code → display name (shared across all Qualité tabs)
            const [varietyMapping, setVarietyMapping] = useState({});
            React.useEffect(() => {
                cachedFetch('/api/email-analysis?action=variety-mapping')
                    .then(json => { if (json.success && json.mapping) setVarietyMapping(json.mapping); })
                    .catch(() => {});
            }, []);
            const applyVarietyMapping = (batchNumber, originalVariety) => {
                if (!batchNumber || !batchNumber.includes('-')) return originalVariety || '-';
                const parts = batchNumber.split('-');
                const code = parts[0].slice(-3) + '-' + parts[1].slice(0, 4);
                // Fallback: try legacy 3-char code if no 4-char match
                const legacyCode = parts[0].slice(-3) + '-' + parts[1].slice(0, 3);
                return varietyMapping[code] || varietyMapping[legacyCode] || originalVariety || '-';
            };
            const saveVarietyMapping = (newMapping) => {
                setVarietyMapping(newMapping);
                fetch('/api/email-analysis?action=variety-mapping', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mapping: newMapping })
                }).then(() => invalidateCache()).catch(() => {});
            };

            // Charger les données agro depuis l'API SQL au montage
            React.useEffect(() => {
                setAgroApiStatus('loading');
                cachedFetch('/api/agro-summary')
                    .then(json => {
                        if (json.success && json.parcelles && json.parcelles.length > 0) {
                            setAgroApiData(json);
                            setAgroApiStatus('ok');
                        } else {
                            setAgroApiStatus('error');
                        }
                    })
                    .catch(() => { setAgroApiStatus('error'); });
            }, []);

            // CA (totalCA/totalCAExport/totalCALocal/totalKgExport) — mêmes 3
            // sources et même calcul (computeCADetail.jsx) que FinCATab.jsx, pour que
            // le Dashboard n'affiche jamais un chiffre différent de l'onglet Finance.
            // Voir docs/DATA_SOURCES.md. null tant que non chargé -> mock encore
            // affiché le temps du 1er fetch (domaine argent : mieux vaut le seed
            // hardcodé une fraction de seconde qu'un flash à 0 DH trompeur).
            const [caRawData, setCaRawData] = useState(null);
            React.useEffect(() => {
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                    (async () => {
                        const allBons = [];
                        try {
                            const prodBons = await loadBonsFromFirestore();
                            prodBons.filter(b => b.typeVente === 'Marché Local').forEach(b => allBons.push(b));
                        } catch (e) { /* voir FinCATab.jsx : même repli silencieux */ }
                        try {
                            if (typeof firebase !== 'undefined' && firebase.firestore) {
                                const snap = await firebase.firestore().collection('bons_marche_local').get();
                                snap.forEach(d => allBons.push({ id: d.id, ...d.data(), source: 'firestore' }));
                            }
                        } catch (e) { /* idem */ }
                        return allBons;
                    })(),
                ]).then(([liqJson, expJson, bons]) => {
                    if (liqJson && liqJson.success) {
                        setCaRawData({
                            liquidations: (liqJson.liquidations || []).filter(l => l.rows && l.rows.length > 0),
                            expeditions: (expJson && expJson.success) ? (expJson.expeditions || []) : [],
                            marcheLocalBons: bons,
                        });
                    }
                }).catch(() => {});
            }, []);

            // Jours fériés Maroc (Firestore: app_settings/jours_feries, via
            // /api/pointage-validation?action=jours-feries — source unique déjà
            // utilisée ailleurs, ex. JourFerieSub.jsx qui la préfère déjà à
            // data.primesConfig.joursFeries quand disponible). Voir
            // docs/DATA_SOURCES.md. null tant que non chargé -> mock encore
            // présent le temps du 1er fetch, jamais d'écran vide sur ce champ
            // précis (calendrier RH, faible risque à afficher les fériés
            // hardcodés une fraction de seconde avant le vrai calendrier).
            const [joursFeriesData, setJoursFeriesData] = useState(null);
            React.useEffect(() => {
                cachedFetch('/api/pointage-validation?action=jours-feries')
                    .then(json => { if (json && json.success && Array.isArray(json.holidays) && json.holidays.length > 0) setJoursFeriesData(json.holidays); })
                    .catch(() => {});
            }, []);

            // Normes de productivité hors-récolte (Firestore: normes-productivite,
            // via /api/hors-recolte-suivi?action=get-normes — repli hardcoded CÔTÉ
            // SERVEUR si la collection est vide, avec source:'hardcoded' explicite ;
            // voir docs/DATA_SOURCES.md). null tant que non chargé -> état vide, pas
            // de nombre fabriqué côté front.
            const [normesApiData, setNormesApiData] = useState(null);
            React.useEffect(() => {
                cachedFetch('/api/hors-recolte-suivi?action=get-normes')
                    .then(json => { if (json && json.success) setNormesApiData(json); })
                    .catch(() => {});
            }, []);

            // Fetch Weekly Quality Reports from Firebase
            React.useEffect(() => {
                cachedFetch('/api/email-analysis?action=weekly-quality-reports')
                    .then(json => { if (json.success && json.reports) setWeeklyQRData(json.reports); })
                    .catch(() => {});
            }, []);

            const profile = PROFILES.find(p => p.id === currentProfile);
            const farmFilter = (currentProfile === 'dt' || currentProfile === 'securite' || currentProfile === 'stationnaire_avo')
                ? (profile?.switchableFarms && !profile.switchableFarms.includes(dtFarm) ? profile.switchableFarms[0] : dtFarm)
                : (profile?.farm || null);
            const cultureFilter = (profile && profile.cultureFilter) || null;
            const farmLabel = (profile && profile.farmLabel) || cultureFilter || farmFilter;
            const avoSubFilter = (currentProfile === 'chef_avo' || currentProfile === 'caporal_avo') && avoFarm !== 'Toutes' ? avoFarm : null;

            // DG Settings — hide Cycle 1 per profile
            const [dgSettings, setDgSettings] = useState({ hideCycle1Profiles: [] });
            React.useEffect(() => {
                const loadDgSettings = async () => {
                    try {
                        const db = firebase.firestore();
                        const doc = await db.collection('app_settings').doc('dg_parametres').get();
                        if (doc.exists) setDgSettings(doc.data());
                    } catch(e) {}
                };
                loadDgSettings();
            }, []);
            const hideCycle1 = (dgSettings.hideCycle1Profiles || []).includes(currentProfile);

            // ===== NOTIFICATION SYSTEM =====
            const METEO_PROFILES = ['rh', 'chef_f1', 'chef_f5', 'chef_avo', 'caporal_f1', 'caporal_f5', 'caporal_avo', 'dg', 'qualite', 'agronomie', 'dt', 'stationnaire_f1', 'stationnaire_f5', 'stationnaire_avo'];
            const meteoCacheRef = useRef({ data: null, ts: 0 });

            const fetchNotifications = React.useCallback(async (profileId, showPopup) => {
                const p = PROFILES.find(x => x.id === profileId);
                const ferme = p?.farm || '';
                const url = '/api/notifications?profile=' + profileId + (ferme ? '&ferme=' + ferme : '');
                try {
                    // Fetch backend notifications
                    const resp = await fetch(url);
                    const json = await resp.json();
                    if (!json.success) return;
                    const categories = json.categories || { validations: [], taches: [], alertes: [] };

                    // Inject weather alerts client-side for eligible profiles
                    if (METEO_PROFILES.includes(profileId)) {
                        try {
                            const now = Date.now();
                            let meteoResult = meteoCacheRef.current;
                            if (!meteoResult.data || (now - meteoResult.ts) > 10 * 60 * 1000) {
                                const fermeKey = ferme || 'F1';
                                const apiData = await fetchMeteoblueData(fermeKey);
                                if (apiData) {
                                    const parsed = transformMeteoblueData(apiData, fermeKey);
                                    meteoCacheRef.current = { data: parsed, ts: now };
                                    meteoResult = meteoCacheRef.current;
                                }
                            }
                            if (meteoResult.data && meteoResult.data.alertes && meteoResult.data.alertes.length > 0) {
                                if (!categories.meteo) categories.meteo = [];
                                meteoResult.data.alertes.forEach(a => {
                                    categories.meteo.push({
                                        key: 'meteo_' + a.type, label: a.titre, count: 1, icon: a.icon,
                                        color: a.color.startsWith('var(') ? (a.color === 'var(--red)' ? '#e74c3c' : a.color === 'var(--orange)' ? '#f39c12' : a.color === 'var(--blue)' ? '#3498db' : '#6c757d') : a.color,
                                        tab: 'dashboard', details: [{ text: a.message, urgent: a.niveau === 'danger' }]
                                    });
                                });
                            }
                        } catch(e) { console.warn('Meteo notification error:', e); }
                    }

                    // Filtrer les notifs marquées "ignorées" par cet user (badge ne compte que les non-dismissées).
                    const dismissed = readNotifDismissed(profileId);
                    notifDismissedRef.current = dismissed;
                    Object.keys(categories).forEach(catKey => {
                        if (Array.isArray(categories[catKey])) {
                            categories[catKey] = categories[catKey].filter(item => !dismissed.has(notifDismissId(item)));
                        }
                    });

                    // Flatten all items for backward compatibility
                    const allItems = [...(categories.validations || []), ...(categories.taches || []), ...(categories.meteo || []), ...(categories.alertes || [])];
                    const totalCount = allItems.reduce((s, i) => s + i.count, 0);

                    setNotifData({ categories, items: allItems, profileId, profileLabel: p?.label || profileId });
                    setNotifCount(totalCount);
                    if (showPopup && allItems.length > 0) setNotifPopup(true);
                } catch(e) { console.warn('Notification fetch error:', e); }
            }, []);

            // Fetch notifications on profile switch + auto-refresh every 60s
            React.useEffect(() => {
                // Fetch immédiat au changement de profil — SANS pop-up.
                //
                // La pop-up s'ouvrait toute seule ici, en overlay plein écran
                // (position fixed, inset 0, zIndex 9999). Elle capte donc TOUS
                // les clics de la page. Au retour d'une autre fenêtre, l'effet
                // rejouait et elle se réaffichait : l'application paraissait
                // GELÉE, et il fallait recharger pour s'en sortir. Diagnostic
                // confirmé par Omar (2026-08-20), qui a demandé sa désactivation.
                //
                // Rien n'est perdu : le badge de la cloche continue de compter
                // les notifications, et un clic dessus ouvre la même pop-up. La
                // différence est qu'elle s'ouvre désormais à la demande, jamais
                // par surprise par-dessus ce qu'on est en train de lire.
                const t = setTimeout(() => fetchNotifications(currentProfile, false), 500);
                // Polling toutes les 60s (sans popup, juste badge)
                const interval = setInterval(() => {
                    fetchNotifications(currentProfile, false);
                }, 60000);
                // Expose pour que les tabs enfants puissent rafraîchir après une action
                window._refreshNotifications = () => fetchNotifications(currentProfile, false);
                return () => { clearTimeout(t); clearInterval(interval); delete window._refreshNotifications; };
            }, [currentProfile, fetchNotifications]);

            // Notification Popup Component
            const SECTION_CONFIG = [
                { key: 'validations', label: 'Validations', icon: 'fa-check-circle', color: '#e67e22' },
                { key: 'taches', label: 'Tâches', icon: 'fa-list-check', color: '#3498db' },
                { key: 'meteo', label: 'Météo', icon: 'fa-cloud-sun', color: '#8e44ad' },
                { key: 'alertes', label: 'Alertes', icon: 'fa-triangle-exclamation', color: '#e74c3c' },
            ];

            const NotificationPopup = () => {
                if (!notifPopup || !notifData || notifData.items.length === 0) return null;
                const profileColors = {
                    achats: ['#8B2252', '#b83280'],
                    dg: ['#1e3a5f', '#1d4ed8'],
                    finance: ['#0d6efd', '#198754'],
                    chef_f1: ['#e67e22', '#f39c12'], chef_f5: ['#e67e22', '#f39c12'], chef_avo: ['#e67e22', '#f39c12'],
                    rh: ['#2c3e50', '#34495e'],
                    caporal_f1: ['#16a085', '#1abc9c'], caporal_f5: ['#16a085', '#1abc9c'], caporal_avo: ['#16a085', '#1abc9c'],
                    qualite: ['#8e44ad', '#9b59b6'],
                    magasinier: ['#d35400', '#e67e22'],
                    agronomie: ['#27ae60', '#2ecc71'],
                    dt: ['#2c3e50', '#1a5276'],
                };
                const [c1, c2] = profileColors[notifData.profileId] || ['#6c757d', '#495057'];
                const cats = notifData.categories || {};
                const firstTab = notifData.items[0]?.tab;

                // « Tout ignorer » : marque toutes les notifs affichées comme dismissées pour cet user.
                // Persistance localStorage (cf. note notifDismissStorageKey) — pas de suppression en base.
                const dismissAllNotifs = () => {
                    const profileId = notifData.profileId;
                    const dismissed = readNotifDismissed(profileId);
                    (notifData.items || []).forEach(item => { dismissed.add(notifDismissId(item)); });
                    try { localStorage.setItem(notifDismissStorageKey(profileId), JSON.stringify([...dismissed])); } catch(e) {}
                    notifDismissedRef.current = dismissed;
                    setNotifData({ ...notifData, categories: { validations: [], taches: [], meteo: [], alertes: [] }, items: [] });
                    setNotifCount(0);
                    setNotifPopup(false);
                };

                const renderItem = (item, idx) => (
                    <div key={idx} onClick={() => { setCurrentTab(item.tab); localStorage.setItem('lastTab', item.tab); setNotifPopup(false); }}
                        style={{display:'flex', alignItems:'center', gap:12, padding:'10px 12px', borderRadius:10, border:'1px solid #f0f0f0', background:'#fafafa', cursor:'pointer', transition:'all 0.15s'}}
                        onMouseEnter={e => { e.currentTarget.style.background = '#f0f4ff'; e.currentTarget.style.borderColor = item.color + '44'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#fafafa'; e.currentTarget.style.borderColor = '#f0f0f0'; }}>
                        <div style={{width:34, height:34, borderRadius:8, background: item.color + '18', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                            <i className={'fa-solid ' + item.icon} style={{color: item.color, fontSize:14}}></i>
                        </div>
                        <div style={{flex:1, minWidth:0}}>
                            <div style={{fontSize:12.5, fontWeight:700, color:'#1a1a2e'}}>{item.label}</div>
                            {item.details && item.details.length > 0 && (
                                <div style={{marginTop:3}}>
                                    {item.details.map((d, di) => (
                                        <div key={di} style={{fontSize:10.5, color: d.urgent ? '#e74c3c' : '#666', fontWeight: d.urgent ? 600 : 400, lineHeight:1.4}}>
                                            {d.urgent && <i className="fa-solid fa-exclamation-circle" style={{marginRight:3, fontSize:8}}></i>}
                                            {d.text}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div style={{background: item.color, color:'#fff', borderRadius:20, minWidth:26, height:26, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:12, flexShrink:0}}>
                            {item.count}
                        </div>
                    </div>
                );

                return (
                    <div style={{position:'fixed', inset:0, background:'rgba(10,20,40,0.6)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:16, animation:'fadeIn 0.2s ease'}} onClick={e => { if (e.target === e.currentTarget) setNotifPopup(false); }}>
                        <div style={{background:'#fff', borderRadius:16, width:'92%', maxWidth:420, overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,0.3)', animation:'slideUp 0.3s ease'}}>
                            {/* Header */}
                            <div style={{background:`linear-gradient(135deg, ${c1}, ${c2})`, padding:'18px 20px', display:'flex', alignItems:'center', gap:14}}>
                                <div style={{width:42, height:42, borderRadius:'50%', background:'rgba(255,255,255,0.2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                                    <i className="fa-solid fa-bell" style={{color:'#fff', fontSize:18}}></i>
                                </div>
                                <div>
                                    <div style={{fontSize:15, fontWeight:800, color:'#fff'}}>Notifications</div>
                                    <div style={{fontSize:11, color:'rgba(255,255,255,0.7)', marginTop:2}}>Profil {notifData.profileLabel} — {notifCount} action{notifCount > 1 ? 's' : ''} en attente</div>
                                </div>
                            </div>
                            {/* Body — sections by category */}
                            <div style={{padding:'12px 16px', display:'flex', flexDirection:'column', gap:8, maxHeight:'55vh', overflowY:'auto'}}>
                                {SECTION_CONFIG.map(sec => {
                                    const items = cats[sec.key] || [];
                                    if (items.length === 0) return null;
                                    const sectionCount = items.reduce((s, i) => s + i.count, 0);
                                    return (
                                        <div key={sec.key}>
                                            <div style={{display:'flex', alignItems:'center', gap:8, padding:'6px 4px 4px', marginBottom:4}}>
                                                <i className={'fa-solid ' + sec.icon} style={{fontSize:12, color: sec.color}}></i>
                                                <span style={{fontSize:11.5, fontWeight:700, color:'#444', textTransform:'uppercase', letterSpacing:0.5}}>{sec.label}</span>
                                                <span style={{fontSize:10, fontWeight:700, color:'#fff', background: sec.color, borderRadius:10, padding:'1px 7px', marginLeft:'auto'}}>{sectionCount}</span>
                                            </div>
                                            <div style={{display:'flex', flexDirection:'column', gap:6}}>
                                                {items.map((item, idx) => renderItem(item, sec.key + '_' + idx))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Footer */}
                            <div style={{padding:'0 16px 14px', display:'flex', gap:8}}>
                                <button onClick={() => { if (firstTab) { setCurrentTab(firstTab); localStorage.setItem('lastTab', firstTab); } setNotifPopup(false); }}
                                    style={{flex:1, padding:'10px', borderRadius:10, border:'none', background:`linear-gradient(135deg, ${c1}, ${c2})`, color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer'}}>
                                    <i className="fa-solid fa-arrow-right" style={{marginRight:6}}></i>Voir tout
                                </button>
                                <button onClick={dismissAllNotifs} title="Marquer toutes les notifications comme lues"
                                    style={{padding:'10px 12px', borderRadius:10, border:'1.5px solid #eee', background:'#fafafa', color:'#999', fontWeight:600, fontSize:12.5, cursor:'pointer', whiteSpace:'nowrap'}}>
                                    <i className="fa-solid fa-check-double" style={{marginRight:6}}></i>Tout ignorer
                                </button>
                                <button onClick={() => setNotifPopup(false)}
                                    style={{flex:1, padding:'10px', borderRadius:10, border:'1.5px solid #ddd', background:'#fff', color:'#666', fontWeight:600, fontSize:13, cursor:'pointer'}}>
                                    Plus tard
                                </button>
                            </div>
                        </div>
                    </div>
                );
            };

            const data = useMemo(() => {
                const mockData = generateMockData(farmFilter || 'F1');

                // Override transportConfig depuis Firestore (rh_config/transport_primes)
                // Pour chaque équipe Firestore : merge sur le seed (par prefix), ajout si nouveau.
                if (transportPrimesOverride && Array.isArray(transportPrimesOverride)) {
                    const seedByPrefix = {};
                    (mockData.transportConfig || []).forEach(t => { seedByPrefix[t.prefix] = t; });
                    transportPrimesOverride.forEach(fs => {
                        if (!fs || !fs.prefix) return;
                        const existing = seedByPrefix[fs.prefix];
                        if (existing) {
                            existing.history = fs.history || [];
                            if (fs.equipe) existing.equipe = fs.equipe;
                            if (fs.caporal) existing.caporal = fs.caporal;
                            if (fs.ferme) existing.ferme = fs.ferme;
                        } else {
                            mockData.transportConfig.push({
                                prefix: fs.prefix,
                                equipe: fs.equipe || fs.prefix,
                                caporal: fs.caporal || '',
                                ferme: fs.ferme || '',
                                coutParOuvrier: (fs.history && fs.history.length > 0)
                                    ? fs.history[fs.history.length - 1].coutParOuvrier
                                    : 30,
                                history: fs.history || [],
                            });
                        }
                    });
                }

                // Si les données API sont disponibles, remplacer les données agro hardcodées
                if (agroApiData) {
                    mockData.agroData = {
                        ...mockData.agroData,
                        parcelles: agroApiData.parcelles,
                        cultures: agroApiData.cultures,
                        pesticides: agroApiData.pesticides,
                        topEngrais: agroApiData.topEngrais,
                        campagne: agroApiData.campagne,
                        dateExtraction: agroApiData.dateExtraction,
                    };
                    // Recréer les programmes fertigation vides pour les nouvelles parcelles
                    const fertigationPrograms = {};
                    agroApiData.parcelles.forEach(p => {
                        fertigationPrograms[p.parcelle] = { culture: p.culture, ferme: p.ferme, weeks: {} };
                    });
                    mockData.agroData.fertigationPrograms = fertigationPrograms;
                }
                mockData.agroApiStatus = agroApiStatus;

                // Override normesProductivite depuis /api/hors-recolte-suivi?action=get-normes
                // (voir docs/DATA_SOURCES.md). Pas de fetch résolu -> tableau vide, jamais le
                // seed generateMockData (retiré de generateMockData.jsx pour ce domaine).
                const { normesProductivite, source: normesProductiviteSource } = adaptNormesProductivite(normesApiData);
                mockData.normesProductivite = normesProductivite;
                mockData.normesProductiviteSource = normesProductiviteSource;

                // Override totalCA/totalCAExport/totalCALocal/totalKgExport depuis
                // computeCADetail (voir docs/DATA_SOURCES.md). cpcVarietes/ebe*/
                // resultat*/cfDea restent hardcoded : pas de méthodologie comptable
                // confirmée pour ces lignes-là (charges par variété, amortissement...).
                if (caRawData) {
                    const ca = computeCADetail(caRawData);
                    mockData.totalCA = ca.totalCA;
                    mockData.totalCAExport = ca.totalExport;
                    mockData.totalCALocal = ca.totalLocal;
                    mockData.totalKgExport = ca.totalKgExport;
                    mockData.caDetail = ca.caDetail;
                }

                // Override primesConfig.joursFeries depuis app_settings/jours_feries
                // (voir docs/DATA_SOURCES.md) — le reste de primesConfig (tranches,
                // primeCaporal, primeChargement) n'a pas de source confirmée, reste
                // tel quel pour l'instant.
                if (joursFeriesData) {
                    mockData.primesConfig = { ...mockData.primesConfig, joursFeries: joursFeriesData };
                }

                // Override weeklyRanking with real Weekly Quality Report data
                const filteredWQR = (weeklyQRData || []).filter(r => r.berry === weeklyBerryFilter);
                if (filteredWQR.length > 0) {
                    // Sort by week desc
                    const sorted = [...filteredWQR].sort((a, b) => {
                        if (a.year !== b.year) return b.year - a.year;
                        return b.week - a.week;
                    });
                    const latest = sorted[0];
                    const latestRanches = (latest.ourRanches || []);
                    const f1 = latestRanches.find(r => r.ranchId === '200742');
                    const f5 = latestRanches.find(r => r.ranchId === '200876');

                    // Build history from all weeks
                    const history = sorted.map(report => {
                        const rf1 = (report.ourRanches || []).find(r => r.ranchId === '200742');
                        const rf5 = (report.ourRanches || []).find(r => r.ranchId === '200876');
                        return {
                            week: `WK${report.week}`,
                            f1Rank: rf1 ? rf1.rank : null,
                            f1Score: rf1 ? rf1.pqWeightedAvg : null,
                            f5Rank: rf5 ? rf5.rank : null,
                            f5Score: rf5 ? rf5.pqWeightedAvg : null,
                            highest: report.pqSummary?.max || null,
                            lowest: report.pqSummary?.min || null,
                            avg: report.pqSummary?.avg || null,
                        };
                    });

                    mockData.weeklyRanking = {
                        currentWeek: `WK${latest.week}-${latest.year}`,
                        ranches: [
                            ...(f5 ? [{
                                rank: f5.rank, ranchId: '200876', name: 'Ferme 195 (F5) - Ranch 200876',
                                pqWeightedAvg: f5.pqWeightedAvg, ourFarm: true, ferme: 'F5',
                                passWeight: f5.passWeight, failWeight: f5.failWeight, totalWeight: f5.totalWeight,
                                passBrix: f5.passBrix, failBrix: f5.failBrix, defects: f5.defects,
                            }] : []),
                            ...(f1 ? [{
                                rank: f1.rank, ranchId: '200742', name: 'Ferme 172 (F1) - Ranch 200742',
                                pqWeightedAvg: f1.pqWeightedAvg, ourFarm: true, ferme: 'F1',
                                passWeight: f1.passWeight, failWeight: f1.failWeight, totalWeight: f1.totalWeight,
                                passBrix: f1.passBrix, failBrix: f1.failBrix, defects: f1.defects,
                            }] : []),
                        ],
                        totalRanches: latest.allRanchCount || f5?.totalRanches || f1?.totalRanches || 0,
                        history,
                        pwResults: latest.pwResults,
                        brixSummary: latest.brixSummary,
                        pqSummary: latest.pqSummary,
                        totalVolume: latest.totalVolume,
                        berry: latest.berry,
                        weeklyQRReports: sorted,
                    };
                }

                return mockData;
            }, [farmFilter, agroApiData, agroApiStatus, weeklyQRData, weeklyBerryFilter, transportPrimesOverride, normesApiData, joursFeriesData, caRawData]);
            const isChef = currentProfile.startsWith('chef_');

            const isDGUser = userProfile.profileId === 'dg';
            const dgOnlyFilter = n => !n.dgOnly && n.id !== 'dg_adoption' && n.id !== 'dg_validations' && n.id !== 'dg_tasks' && n.id !== 'dg_cr_reunions' && n.id !== 'dg_parametres' && n.id !== 'dg_signature';

            const baseNavItems = [ ...(
                currentProfile === 'chef_bahia'
                ? NAV_ITEMS_CHEF_BAHIA
                : (currentProfile === 'chef_avo'
                ? NAV_ITEMS_CHEF_AVO
                : (isChef
                ? NAV_ITEMS_RH.filter(n => !n.rhOnly && !n.chefOnly).concat(NAV_ITEMS_RH.filter(n => n.chefOnly))
                : (currentProfile === 'dt' ? (dtStationMode ? NAV_ITEMS_STATIONNAIRE : NAV_ITEMS_DT)
                : (currentProfile === 'rh' ? NAV_ITEMS_RH.filter(n => !n.chefOnly)
                : (currentProfile.startsWith('caporal_') ? NAV_ITEMS_CAPORAL
                : (currentProfile === 'qualite' ? NAV_ITEMS_QUALITE
                : (currentProfile === 'achats' ? NAV_ITEMS_ACHATS
                : (currentProfile === 'magasinier' ? NAV_ITEMS_MAGASINIER
                : (currentProfile === 'dg' ? (isDGUser ? NAV_ITEMS_FINANCE : NAV_ITEMS_FINANCE.filter(dgOnlyFilter))
                : (currentProfile === 'finance' || currentProfile === 'audit_interne' ? NAV_ITEMS_FINANCE.filter(n => dgOnlyFilter(n) || n.id === 'dg_tasks')
                : (currentProfile === 'agronomie' ? NAV_ITEMS_AGRO
                : (currentProfile.startsWith('stationnaire_') ? NAV_ITEMS_STATIONNAIRE
                : (currentProfile === 'securite' ? NAV_ITEMS_SECURITE.filter(n => !n.f5Only || farmFilter === 'F5')
                : (currentProfile === 'associe_lazrak' ? NAV_ITEMS_ASSOCIE
                : NAV_ITEMS_OTHER))))))))))))))
            ) ];

            // Add Historique Irrigation for Chef de Ferme and DT
            if (isChef && (currentProfile === 'chef_f1' || currentProfile === 'chef_f5') || currentProfile === 'dt') {
                baseNavItems.push({ id: 'station_historique', label: 'Historique Irrigation', icon: 'fa-clock-rotate-left' });
            }

            // Onglet « Engrais & Pesticides » (conso/Ha valorisée PMP) — visible
            // UNIQUEMENT pour DG, Finance et Chef de Ferme. La vraie barrière est
            // backend (action conso-valorisee : 403 + filtre ferme imposé). Le
            // masquage nav est un confort côté client.
            if (currentProfile === 'dg' || currentProfile === 'finance' || isChef) {
                baseNavItems.push({ id: 'agro_conso_valorisee', label: 'Engrais & Pesticides', icon: 'fa-coins' });
            }

            // Add Evolution tab for all users
            const withEvolution = [...baseNavItems, { id: 'evolution', label: 'Évolutions', icon: 'fa-rocket' }];

            // Add admin tab for admin users
            const navItems = userProfile.role === 'admin'
                ? [...withEvolution, { id: 'admin_users', label: 'Utilisateurs', icon: 'fa-user-shield' }]
                : withEvolution;

            // Au chargement, vérifier que le tab sauvegardé appartient au profil restauré
            useEffect(() => {
                if (!navItems.some(n => n.id === currentTab)) {
                    const fallback = navItems[0] ? navItems[0].id : 'dashboard';
                    setCurrentTab(fallback);
                    try { localStorage.setItem('lastTab', fallback); } catch(e) {}
                }
            }, [currentProfile, dtStationMode]); // eslint-disable-line react-hooks/exhaustive-deps

            // Mémoire d'onglet par profil — sauvegarde lastTab_{profileId} à chaque changement
            useEffect(() => {
                try { localStorage.setItem('lastTab_' + currentProfile, currentTab); } catch(e) {}
            }, [currentTab, currentProfile]);

            // Réinitialise le pull-to-refresh au retour de tab (iOS Safari : touchcancel
            // ne suffit pas quand l'user switche d'app en plein touch).
            useEffect(() => {
                const onVisible = () => {
                    if (document.visibilityState === 'visible') {
                        setPullDist(0);
                        pullStartY.current = null;
                    }
                };
                document.addEventListener('visibilitychange', onVisible);
                return () => document.removeEventListener('visibilitychange', onVisible);
            }, []);

            // Helper : enveloppe chaque onglet dans un TabErrorBoundary
            const renderTab = (tabId, Component, props, label) => {
                if (currentTab !== tabId) return null;
                if (!Component) return null;
                // Ordre volontaire : la frontière d'erreur ENVELOPPE le Suspense.
                // Un chunk qui échoue à se charger rejette pendant le rendu — c'est
                // l'ErrorBoundary qui doit l'attraper, pas le Suspense, sinon
                // l'onglet resterait bloqué sur son message de chargement.
                return (
                    <TabErrorBoundary name={label || tabId} key={tabId + '-eb'}>
                        <React.Suspense fallback={<div style={{padding:'32px',textAlign:'center',color:'var(--muted, #888)'}}>Chargement du module…</div>}>
                            <Component key={refreshKey} {...props} />
                        </React.Suspense>
                    </TabErrorBoundary>
                );
            };

            return (
                <div style={{height: '100vh', display: 'flex', flexDirection: 'column'}}>
                    {/* Profile Switcher Bar — only for admin/finance */}
                    {isFullAccess && (
                    <div className="profile-bar">
                        <button className="scroll-btn" onClick={() => { const t = document.querySelector('.chips-track'); if (t) t.scrollLeft -= 160; }}>
                            <i className="fa-solid fa-chevron-left"></i>
                        </button>
                        <div className="chips-track">
                            <span className="label">Profil:</span>
                            {visibleProfiles.map(p => (
                                <button
                                    key={p.id}
                                    className={`profile-chip ${currentProfile === p.id ? 'active' : ''}`}
                                    onClick={() => {
                                        // Sauvegarder l'onglet courant pour le profil qu'on quitte
                                        try { localStorage.setItem('lastTab_' + currentProfile, currentTab); } catch(e) {}
                                        setCurrentProfile(p.id);
                                        try { localStorage.setItem('lastProfile', p.id); } catch(e) {}
                                        // Profils à onglet de démarrage forcé ; sinon restaurer le dernier
                                        // onglet utilisé sur ce profil (lastTab_{p.id}), ou garder le courant.
                                        const savedTabForProfile = (() => { try { return localStorage.getItem('lastTab_' + p.id); } catch(e) { return null; } })();
                                        const tab = p.id === 'qualite' ? 'qualite_dashboard'
                                            : p.id === 'magasinier' ? 'mag_dashboard'
                                            : p.id.startsWith('caporal_') ? 'caporal_suivi'
                                            : p.id === 'finance' || p.id === 'dg' || p.id === 'audit_interne' ? 'fin_dashboard'
                                            : p.id === 'agronomie' ? 'agro_dashboard'
                                            : p.id === 'achats' ? 'achats_dashboard'
                                            : p.id === 'chef_bahia' ? 'pointage'
                                            : (savedTabForProfile || currentTab);
                                        setCurrentTab(tab);
                                        try { localStorage.setItem('lastTab', tab); } catch(e) {}
                                    }}
                                >
                                    <i className={`fa-solid ${p.icon}`}></i>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <button className="scroll-btn" onClick={() => { const t = document.querySelector('.chips-track'); if (t) t.scrollLeft += 160; }}>
                            <i className="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                    )}

                    {/* Main Layout */}
                    <div className="app-layout">
                        {/* Sidebar */}
                        <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
                            <div className="sidebar-header">
                                <img src="https://www.berrygood.ma/logo.png" alt="BerryGood" />
                                <div className="app-name">
                                    Berry<span>Good</span>
                                </div>
                            </div>

                            <div className="sidebar-nav">
                                {currentProfile === 'dt' && (
                                    <div style={{display:'flex',margin:'0 12px 8px',borderRadius:10,overflow:'hidden',border:'1px solid var(--gray-200)',background:'var(--gray-100)'}}>
                                        <button onClick={() => { setDtStationMode(false); setCurrentTab('dashboard'); localStorage.setItem('lastTab','dashboard'); }} style={{flex:1,padding:'8px 6px',border:'none',borderRadius:dtStationMode ? 0 : 10,background:!dtStationMode ? 'var(--berry)' : 'transparent',color:!dtStationMode ? '#fff' : 'var(--gray-500)',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:5,transition:'all 0.2s'}}>
                                            <i className="fa-solid fa-helmet-safety" style={{fontSize:12}}></i> Dir. Technique
                                        </button>
                                        <button onClick={() => { setDtStationMode(true); setCurrentTab('station_saisie'); localStorage.setItem('lastTab','station_saisie'); }} style={{flex:1,padding:'8px 6px',border:'none',borderRadius:dtStationMode ? 10 : 0,background:dtStationMode ? '#0ea5e9' : 'transparent',color:dtStationMode ? '#fff' : 'var(--gray-500)',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:5,transition:'all 0.2s'}}>
                                            <i className="fa-solid fa-faucet-drip" style={{fontSize:12}}></i> Stationnaire
                                        </button>
                                    </div>
                                )}
                                <div className="nav-section-title">Menu Principal</div>
                                {navItems.map(item => (
                                    <div
                                        key={item.id}
                                        data-tour={`nav-${item.id.replace(/_/g, '-')}`}
                                        className={`nav-item ${currentTab === item.id ? 'active' : ''}`}
                                        onClick={() => { setCurrentTab(item.id); localStorage.setItem('lastTab', item.id); setSidebarOpen(false); }}
                                    >
                                        <i className={`fa-solid ${item.icon}`}></i>
                                        {item.label}
                                        {farmFilter && item.id === 'dashboard' && (
                                            <span className="farm-tag">
                                                <i className={`fa-solid ${farmFilter === 'Avocatier' ? 'fa-tree' : 'fa-leaf'}`}></i>
                                                {farmFilter}
                                            </span>
                                        )}
                                        {hideCycle1 && (item.id === 'chef_production' || item.id === 'qualite_production') && (
                                            <span style={{marginLeft:6, padding:'2px 8px', borderRadius:10, background:'rgba(225,112,85,0.12)', color:'#e17055', fontSize:10, fontWeight:700, whiteSpace:'nowrap'}}>
                                                C2 seul
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="sidebar-footer" style={{flexDirection:'column',alignItems:'stretch',gap:8}}>
                                {/* Guide interactif button */}
                                {getTutorials(currentProfile).length > 0 && (
                                    <button className="guide-btn" onClick={() => { setShowTutorialMenu(true); setSidebarOpen(false); }}>
                                        <i className="fa-solid fa-graduation-cap"></i> Guide interactif
                                    </button>
                                )}
                                {/* Install app button */}
                                {!window.matchMedia('(display-mode: standalone)').matches && !window.navigator.standalone && (
                                    <button className="install-btn" onClick={() => { setShowInstallGuide(true); setSidebarOpen(false); }}>
                                        <i className="fa-solid fa-download"></i> Installer l'application
                                    </button>
                                )}
                                <div style={{display:'flex',alignItems:'center',gap:10}}>
                                    <div className="user-avatar">{(userProfile.displayName || userProfile.email || 'U').charAt(0).toUpperCase()}</div>
                                    <div className="user-info">
                                        <div className="name">{userProfile.displayName || userProfile.email}</div>
                                        <div className="role">{profile?.label || currentProfile}</div>
                                    </div>
                                </div>
                                <button onClick={() => firebaseAuth.signOut()}
                                    style={{width:'100%',padding:'8px',background:'rgba(220,53,69,0.1)',color:'#dc3545',border:'none',borderRadius:8,fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                                    <i className="fa-solid fa-right-from-bracket"></i> Déconnexion
                                </button>
                            </div>
                        </div>

                        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>

                        {/* Content Area */}
                        <div className="content-area">
                            {/* Header */}
                            <div className="content-header">
                                <div>
                                    <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>
                                        <i className="fa-solid fa-bars"></i>
                                    </button>
                                    <h1>
                                        {navItems.find(n => n.id === currentTab)?.label}
                                        <span>{farmLabel ? ` - ${farmLabel}` : (farmFilter ? ` - ${FARM_NAMES[farmFilter]}` : '')}</span>
                                    </h1>
                                </div>
                                <div className="header-actions">
                                    {/* Guide button mobile */}
                                    {getTutorials(currentProfile).length > 0 && (
                                        <button onClick={() => setShowTutorialMenu(true)}
                                            style={{background:'var(--berry-pale)',color:'var(--berry)',border:'none',borderRadius:8,width:36,height:36,cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}
                                            title="Guide interactif">
                                            <i className="fa-solid fa-graduation-cap"></i>
                                        </button>
                                    )}
                                    {/* DT Farm Switcher — all farms */}
                                    {(currentProfile === 'dt' || currentProfile === 'securite' || currentProfile === 'stationnaire_avo') && (
                                        <div data-tour="dt-farm-switcher" style={{display:'flex',gap:4,background:'var(--gray-100)',borderRadius:20,padding:3,overflowX:'auto',maxWidth:420,WebkitOverflowScrolling:'touch'}}>
                                            {(profile?.switchableFarms || FARMS).map(f => (
                                                <button key={f} onClick={() => { setDtFarm(f); localStorage.setItem('dtFarm', f); }}
                                                    style={{padding:'5px 10px',borderRadius:18,border:'none',fontSize:11,fontWeight:700,cursor:'pointer',transition:'all 0.2s',whiteSpace:'nowrap',flexShrink:0,
                                                        background: dtFarm === f ? 'var(--berry)' : 'transparent',
                                                        color: dtFarm === f ? '#fff' : 'var(--gray-600)'}}>
                                                    <i className={`fa-solid ${f === 'Avocatier' ? 'fa-tree' : 'fa-seedling'}`} style={{marginRight:4}}></i>{f}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {/* Mobile profile switcher */}
                                    {isFullAccess && (
                                        <div className="mobile-profile-switcher" style={{position:'relative',flexShrink:0,order:-1}}>
                                            <button onClick={() => setShowMobileProfileMenu(v => !v)}
                                                style={{display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:20, border:'1.5px solid var(--berry)', background:'var(--berry-pale)', color:'var(--berry)', fontSize:12, fontWeight:600, cursor:'pointer'}}>
                                                <i className={`fa-solid ${profile?.icon || 'fa-user'}`}></i>
                                                {profile?.label || 'Profil'}
                                                <i className="fa-solid fa-chevron-down" style={{fontSize:9, marginLeft:2}}></i>
                                            </button>
                                            {showMobileProfileMenu && (
                                                <>
                                                <div onClick={() => setShowMobileProfileMenu(false)} style={{position:'fixed', inset:0, zIndex:999}}></div>
                                                <div style={{position:'absolute', top:'calc(100% + 6px)', right:0, background:'white', borderRadius:12, boxShadow:'0 8px 30px rgba(0,0,0,0.18)', border:'1px solid var(--gray-200)', zIndex:1000, minWidth:220, maxHeight:'70vh', overflowY:'auto', padding:6}}>
                                                    {visibleProfiles.map(p => (
                                                        <button key={p.id} onClick={() => {
                                                            setCurrentProfile(p.id);
                                                            localStorage.setItem('lastProfile', p.id);
                                                            const tab = p.id === 'qualite' ? 'qualite_dashboard'
                                                                : p.id === 'magasinier' ? 'mag_dashboard'
                                                                : p.id.startsWith('caporal_') ? 'caporal_suivi'
                                                                : p.id === 'finance' || p.id === 'dg' || p.id === 'audit_interne' ? 'fin_dashboard'
                                                                : p.id === 'agronomie' ? 'agro_dashboard'
                                                                : p.id === 'achats' ? 'achats_dashboard'
                                                                : p.id.startsWith('stationnaire_') ? 'station_saisie'
                                                                : p.id === 'chef_bahia' ? 'pointage'
                                                                : 'dashboard';
                                                            setCurrentTab(tab);
                                                            localStorage.setItem('lastTab', tab);
                                                            setShowMobileProfileMenu(false);
                                                        }}
                                                        style={{display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 14px', border:'none', borderRadius:8, background: currentProfile === p.id ? 'var(--berry-pale)' : 'transparent', color: currentProfile === p.id ? 'var(--berry)' : 'var(--dark)', fontSize:13, fontWeight: currentProfile === p.id ? 700 : 500, cursor:'pointer', textAlign:'left'}}>
                                                            <i className={`fa-solid ${p.icon}`} style={{width:18, textAlign:'center', fontSize:13, color: currentProfile === p.id ? 'var(--berry)' : 'var(--gray-400)'}}></i>
                                                            <div>
                                                                <div>{p.label}</div>
                                                                <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:400}}>{p.fullName}</div>
                                                            </div>
                                                            {currentProfile === p.id && <i className="fa-solid fa-check" style={{marginLeft:'auto', fontSize:11}}></i>}
                                                        </button>
                                                    ))}
                                                </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                    {/* Avo Sub-Farm Switcher */}
                                    {(currentProfile === 'chef_avo' || currentProfile === 'caporal_avo') && (
                                        <div style={{display:'flex',gap:4,background:'var(--gray-100)',borderRadius:20,padding:3,overflowX:'auto',maxWidth:240,minWidth:0,flexShrink:1,WebkitOverflowScrolling:'touch'}}>
                                            {AVO_SUB_FARMS.map(f => (
                                                <button key={f} onClick={() => { setAvoFarm(f); localStorage.setItem('avoFarm', f); }}
                                                    style={{padding:'5px 10px',borderRadius:18,border:'none',fontSize:11,fontWeight:700,cursor:'pointer',transition:'all 0.2s',whiteSpace:'nowrap',flexShrink:0,
                                                        background: avoFarm === f ? '#D4A847' : 'transparent',
                                                        color: avoFarm === f ? '#fff' : 'var(--gray-600)'}}>
                                                    <i className="fa-solid fa-tree" style={{marginRight:4}}></i>{f}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {(() => {
                                        const sqlTabs = ['agro_irrigation', 'agro_parcelles', 'dashboard', 'pointage', 'validation_pointage', 'recolte', 'cout_recolte', 'hors_recolte', 'quinzaine', 'primes', 'rh_equipes', 'paie', 'evolution'];
                                        const firebaseTabs = ['qualite_expeditions', 'qualite_liquidations', 'qualite_historique', 'qualite_brix', 'qualite_inspections', 'qualite_production', 'chef_production', 'qualite_dashboard', 'qualite_ecarts', 'qualite_pfq_interne', 'qualite_suivi_calibre', 'qualite_bons_apport', 'fin_carburant', 'fin_liquidations'];
                                        const webScrapeTabs = ['fin_telecom'];
                                        const firestoreTabs = ['dg_validations', 'dg_adoption', 'dg_tasks', 'dg_cr_reunions', 'dg_parametres', 'dg_signature', 'caporal_suivi', 'caporal_saisie', 'caporal_tunnels', 'caporal_historique', 'hors_recolte_suivi', 'chef_suivi_caporal', 'achats_dashboard', 'achats_da', 'achats_bdc', 'achats_receptions_valoriser', 'achats_factures', 'achats_paiements', 'achats_fournisseurs', 'achats_catalogue', 'achats_analyses_foliaires', 'achats_scan_factures', 'achats_scan_bl', 'achats_bon_apport', 'achats_rapprochement', 'achats_consultation', 'achats_vente_plastique', 'fin_dashboard', 'fin_ca', 'fin_stock', 'fin_bdc', 'fin_factures', 'fin_paiements', 'fin_virements', 'fin_codes_analytiques', 'fin_delete_articles', 'fin_marche_local', 'fin_budget', 'mag_dashboard', 'mag_bdc_reception', 'mag_reception', 'mag_transfert', 'mag_sortie', 'mag_stock_intrants', 'mag_inventaire', 'mag_fiche_stock', 'mag_mouvements', 'mag_mapping_conso', 'mag_parcelles_params', 'suivi_pointage', 'pointage_divers', 'dqr_daily', 'qualite_validation_bons', 'chef_validation_bons', 'qualite_reconciliation', 'qualite_marche_local', 'sec_registre', 'sec_scan', 'sec_envois_wa', 'sec_incidents', 'sec_tunnels', 'station_saisie', 'station_historique', 'station_scan', 'station_analyse', 'station_intelligence', 'agro_phyto', 'agro_harvest', 'agro_farmroad', 'agro_avancement', 'agro_growth', 'chef_da', 'chef_tracking', 'chef_validations', 'mag_bc', 'mag_bc_engrais', 'mag_bc_phyto', 'agro_conso_valorisee'];
                                        if (sqlTabs.includes(currentTab)) {
                                            return React.createElement('div', { className:'refresh-indicator', style:{background:'#d4edda', padding:'4px 12px', borderRadius:12} },
                                                React.createElement('i', { className:'fa-solid fa-database', style:{color:'#155724', marginRight:6, fontSize:11} }),
                                                React.createElement('span', { style:{color:'#155724', fontSize:11, fontWeight:600} }, 'Firestore Cache')
                                            );
                                        } else if (firebaseTabs.includes(currentTab)) {
                                            return React.createElement('div', { className:'refresh-indicator', style:{background:'#d4edda', padding:'4px 12px', borderRadius:12} },
                                                React.createElement('i', { className:'fa-solid fa-envelope', style:{color:'#155724', marginRight:6, fontSize:11} }),
                                                React.createElement('span', { style:{color:'#155724', fontSize:11, fontWeight:600} }, 'Email IMAP')
                                            );
                                        } else if (firestoreTabs.includes(currentTab)) {
                                            return React.createElement('div', { className:'refresh-indicator', style:{background:'#d4edda', padding:'4px 12px', borderRadius:12} },
                                                React.createElement('i', { className:'fa-solid fa-database', style:{color:'#155724', marginRight:6, fontSize:11} }),
                                                React.createElement('span', { style:{color:'#155724', fontSize:11, fontWeight:600} }, 'Firestore')
                                            );
                                        } else if (webScrapeTabs.includes(currentTab)) {
                                            return React.createElement('div', { className:'refresh-indicator', style:{background:'#d4edda', padding:'4px 12px', borderRadius:12} },
                                                React.createElement('i', { className:'fa-solid fa-globe', style:{color:'#155724', marginRight:6, fontSize:11} }),
                                                React.createElement('span', { style:{color:'#155724', fontSize:11, fontWeight:600} }, 'Live (Site Web)')
                                            );
                                        } else {
                                            return React.createElement('div', { className:'refresh-indicator', style:{background:'#fff3cd', padding:'4px 12px', borderRadius:12} },
                                                React.createElement('i', { className:'fa-solid fa-flask', style:{color:'#856404', marginRight:6, fontSize:11} }),
                                                React.createElement('span', { style:{color:'#856404', fontSize:11, fontWeight:600} }, 'Données de démonstration')
                                            );
                                        }
                                    })()}
                                    {/* Notification Bell */}
                                    <div style={{position:'relative', cursor:'pointer'}} onClick={() => { if (notifData && notifData.items.length > 0) setNotifPopup(true); else fetchNotifications(currentProfile, true); }}>
                                        <button className="header-btn" style={{position:'relative', padding:'6px 10px', minWidth:'unset'}}>
                                            <i className="fa-solid fa-bell" style={{fontSize:15}}></i>
                                        </button>
                                        {notifCount > 0 && (
                                            <div style={{position:'absolute', top:-2, right:-2, background:'#e74c3c', color:'#fff', borderRadius:'50%', width:20, height:20, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, border:'2px solid #fff', animation:'track-pulse 2s infinite'}}>
                                                {notifCount > 99 ? '99+' : notifCount}
                                            </div>
                                        )}
                                    </div>
                                    <button className="header-btn refresh-btn" onClick={() => { invalidateCache(); if (window.PaieDataCache) window.PaieDataCache.invalidate(); setRefreshKey(k => k + 1); }}>
                                        <i className="fa-solid fa-arrow-rotate-right"></i>
                                        Rafraîchir
                                    </button>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="content-scroll" ref={pullRef}
                                onTouchStart={e => { if (pullRef.current && pullRef.current.scrollTop === 0) pullStartY.current = e.touches[0].clientY; else pullStartY.current = null; }}
                                onTouchMove={e => { if (pullStartY.current !== null) { const dy = e.touches[0].clientY - pullStartY.current; setPullDist(dy > 0 ? Math.min(dy, 120) : 0); }}}
                                onTouchEnd={() => { if (pullDist > 60) { if (window.PaieDataCache) window.PaieDataCache.invalidate(); setRefreshKey(k => k + 1); } setPullDist(0); pullStartY.current = null; }}
                                onTouchCancel={() => { setPullDist(0); pullStartY.current = null; }}>
                                {pullDist > 0 && (
                                    <div style={{display:'flex', justifyContent:'center', alignItems:'center', height: pullDist * 0.5, overflow:'hidden', transition: pullDist > 60 ? 'none' : 'height 0.2s'}}>
                                        <i className={`fa-solid fa-arrow-rotate-right${pullDist > 60 ? ' fa-spin' : ''}`} style={{fontSize:18, color: pullDist > 60 ? 'var(--berry)' : 'var(--gray-400)', transform:`rotate(${pullDist * 3}deg)`, transition:'color 0.2s'}}></i>
                                    </div>
                                )}
                                <MesTachesWidget currentProfile={currentProfile} />
                                {renderTab('dashboard', DashboardTab, { data, farmFilter, avoSubFilter, currentProfile, cultureFilter, onNavigateMeteo: () => { setCurrentTab('chef_agronomie'); localStorage.setItem('lastTab', 'chef_agronomie'); } }, 'Dashboard')}
                                {renderTab('pointage', PointageTab, { data, farmFilter, avoSubFilter, currentProfile }, 'Pointage')}
                                {/* Validation du pointage : nouveau workflow par équipe/ferme (PointageValidationView, composant séparé). Scoping ferme selon profil. */}
                                {renderTab('validation_pointage', PointageValidationViewWrapper, { data, avoSubFilter, currentProfile }, 'Validation du pointage')}
                                {renderTab('pointage_divers', PointageDiversTab, { currentProfile }, 'Pointage Divers')}
                                {renderTab('recolte', RecolteTab, { data, farmFilter, avoSubFilter, currentProfile, cultureFilter }, 'Récolte')}
                                {renderTab('cout_recolte', CoutRecolteTab, { data, farmFilter, avoSubFilter, currentProfile }, 'Coût Récolte')}

                                {renderTab('hors_recolte', HorsRecolteTab, { data, farmFilter, avoSubFilter }, 'Hors Récolte')}
                                {renderTab('hors_recolte_suivi', HorsRecolteSuiviTab, { data, farmFilter, avoSubFilter }, 'Suivi Hors Récolte')}
                                {renderTab('quinzaine', QuinzaineTab, { data, farmFilter, farmLabel, avoSubFilter, cultureFilter, currentProfile, onNavigateToPrimes: (periode) => { setPrimesInitialPeriode(periode || ''); setCurrentTab('primes'); localStorage.setItem('lastTab', 'primes'); } }, 'Quinzaine')}
                                {/* userRole : requis par le sous-onglet Budget (CampagneBudgetTab) pour
                                    n'ouvrir la saisie qu'aux profils DG/RH — même source que
                                    'parcelles_referentiel' ci-dessous. Le backend refuse de toute façon. */}
                                {renderTab('campagne', CampagneAnalytiqueTabLazy, { data, farmFilter, avoSubFilter, userRole: currentProfile }, 'Campagne')}
                                {renderTab('rh_equipes', EquipesTab, { data }, 'Équipes')}
                                {renderTab('primes', PrimesTab, { data, farmFilter, avoSubFilter, initialPeriode: primesInitialPeriode, onInitialPeriodeConsumed: () => setPrimesInitialPeriode(null) }, 'Primes')}
                                {renderTab('paie', PaieTab, { data, currentProfile }, 'Paie')}
                                {renderTab('primes_fixes', PrimesFixesTabLazy, {}, 'Primes Fixes')}
                                {renderTab('parcelles_referentiel', ParcellesReferentielTabLazy, { userRole: currentProfile }, 'Parcelles & Référentiel')}
                                {renderTab('parametres', ParametresTab, { data }, 'Paramètres')}
                                {renderTab('planification', PlanificationTab, { data }, 'Planification')}
                                {renderTab('suivi', SuiviTab, { data }, 'Suivi')}
                                {renderTab('qualite_pfq_interne', QualitePFQInterneTab, { data, userProfile }, 'Qualité PFQ')}
                                {renderTab('qualite_bons_apport', QualiteBonsApportTab, { data, userProfile }, 'Bons Apport')}
                                {renderTab('qualite_dashboard', QualiteDashboardTab, { data, weeklyBerryFilter, setWeeklyBerryFilter }, 'Qualité Dashboard')}
                                {renderTab('qualite_inspections', QualiteInspectionsTab, { data, applyVarietyMapping, farmFilter: currentProfile === 'qualite' ? '' : farmFilter }, 'Inspections')}
                                {renderTab('qualite_ecarts', QualiteEcartsTab, { data }, 'Écarts')}
                                {renderTab('qualite_suivi_calibre', QualiteSuiviCalibreTab, { data }, 'Suivi Calibre')}
                                {renderTab('qualite_historique', QualiteHistoriqueTab, { data, applyVarietyMapping }, 'Historique Qualité')}
                                {renderTab('qualite_brix', QualiteBrixTab, { data, applyVarietyMapping }, 'Brix')}
                                {renderTab('qualite_expeditions', QualiteExpeditionsTab, { data, applyVarietyMapping, varietyMapping, saveVarietyMapping, userProfile, currentProfile }, 'Expéditions')}
                                {renderTab('qualite_liquidations', QualiteLiquidationsTab, { data, applyVarietyMapping }, 'Liquidations Qualité')}
                                {renderTab('dashboard_associe', DashboardAssocieTab, { data, applyVarietyMapping, userProfile }, 'Dashboard Associé')}
                                {renderTab('qualite_reconciliation', QualiteReconciliationTab, { data, applyVarietyMapping }, 'Réconciliation')}
                                {renderTab('qualite_production', QualiteProductionTab, { data, applyVarietyMapping, hideCycle1, userProfile }, 'Production Qualité')}
                                {renderTab('chef_production', QualiteProductionTab, { data, applyVarietyMapping, forceFerme: farmFilter, hideCycle1, userProfile }, 'Production Chef')}
                                {renderTab('chef_suivi_caporal', CaporalSuiviTab, { data, farmFilter, avoSubFilter, readOnly: true }, 'Suivi Caporal')}
                                {renderTab('qualite_marche_local', QualiteMarcheLocalTab, { data, userProfile: PROFILES.find(p => p.id === currentProfile) }, 'Marché Local')}
                                {renderTab('mag_dashboard', MagDashboardStockTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Stock Dashboard')}
                                {renderTab('mag_parc', MagParcTab, { data }, 'Parc')}
                                {renderTab('mag_bdc_liste', MagBonsCommandeTabLazy, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Bons de Commande')}
                                {renderTab('mag_bdc_reception', MagBdcReceptionTabLazy, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'BDC à réceptionner')}
                                {renderTab('mag_reception', MagReceptionTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile), setCurrentTab }, 'Bons de Réception')}
                                {renderTab('mag_transfert', MagTransfertTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Transfert')}
                                {renderTab('mag_sortie', MagSortieTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Sortie')}
                                {renderTab('mag_stock_intrants', MagStockIntrantsTab, {}, 'Stock Intrants')}
                                {renderTab('mag_fiche_stock', MagFicheStockTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Fiche de Stock')}
                                {renderTab('mag_inventaire', MagInventaireTab, { currentProfile }, 'Inventaire')}
                                {renderTab('mag_mouvements', MagMouvementsTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Mouvements')}
                                {renderTab('mag_mapping_conso', MagMappingConsoTabLazy, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile), authUser }, 'Mapping Parcelles Conso')}
                                {renderTab('mag_parcelles_params', ParcellesParamsTabLazy, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile), authUser }, 'Paramètres Parcelles')}
                                {renderTab('mag_stock_files', MagStockFilesTabLazy, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Soumission Fichier Stock')}
                                {renderTab('caporal_suivi', CaporalSuiviTab, { data, farmFilter, avoSubFilter, onNavigateMeteo: () => { setCurrentTab('chef_agronomie'); localStorage.setItem('lastTab', 'chef_agronomie'); } }, 'Suivi Caporal')}
                                {renderTab('caporal_saisie', CaporalSaisieTab, { data, farmFilter, avoSubFilter }, 'Saisie Caporal')}
                                {renderTab('caporal_tunnels', HorsRecolteSuiviTab, { data, farmFilter, avoSubFilter }, 'Tunnels')}
                                {renderTab('caporal_historique', CaporalHistoriqueTab, { data, farmFilter, avoSubFilter }, 'Historique Caporal')}
                                {renderTab('station_saisie', StationnaireIrrigationTab, { farmFilter, currentProfile }, 'Saisie Irrigation')}
                                {renderTab('station_historique', StationnaireHistoriqueTab, { farmFilter, currentProfile, userProfile }, 'Historique Irrigation')}
                                {renderTab('station_scan', StationnaireImportScanTab, { farmFilter, currentProfile }, 'Scanner Fiche')}
                                {renderTab('station_analyse', StationnaireAnalyseTab, { farmFilter, currentProfile }, 'Analyse Irrigation')}
                                {renderTab('station_intelligence', IrrigationIntelligenceTab, { farmFilter, currentProfile, userProfile }, 'Pilotage Irrigation')}
                                {renderTab('station_meteo', MeteoTab, { data, farmFilter }, 'Météo')}
                                {renderTab('sec_registre', SecurityRegistreTab, { farmFilter, currentProfile }, 'Registre Sécurité')}
                                {renderTab('sec_scan', SecurityScanRegistreTab, { farmFilter, currentProfile }, 'Scan Registre')}
                                {renderTab('sec_envois_wa', SecurityEnvoisWATab, { farmFilter, currentProfile }, 'Registres WhatsApp')}
                                {renderTab('sec_incidents', SecurityIncidentsTab, { farmFilter, currentProfile }, 'Incidents')}
                                {renderTab('sec_tunnels', SecurityTunnelsTab, { farmFilter, currentProfile }, 'Photos Tunnels')}
                                {renderTab('fin_dashboard', FinDashboardTab, { data, farmFilter, onNavigateMeteo: () => { setCurrentTab('chef_agronomie'); localStorage.setItem('lastTab', 'chef_agronomie'); } }, 'Finance Dashboard')}
                                {renderTab('fin_tresorerie', FinTresorerieTab, { data, currentProfile }, 'Trésorerie')}
                                {renderTab('fin_ca', FinCATab, { data }, 'Chiffre Affaires')}
                                {renderTab('fin_carburant', FinCarburantTab, { data }, 'Carburant')}
                                {renderTab('fin_plants', FinPlantsTab, { data, currentProfile }, 'Plants')}
                                {renderTab('fin_telecom', FinTelecomTab, { data }, 'Maroc Télécom')}
                                {renderTab('fin_ojra', FinOjraTab, { data }, 'OJRA Paie')}
                                {renderTab('fin_stock', FinStockTab, { data }, 'Stock Finance')}
                                {renderTab('fin_liquidations', FinLiquidationsTab, { data, currentProfile }, 'Liquidations')}
                                {renderTab('productivity_report', ProductivityReportTab, { data, currentProfile, userProfile: PROFILES.find(p => p.id === currentProfile) }, 'Productivity Driscoll\'s')}
                                {renderTab('fin_marche_local', FinanceMarcheLocalTab, { data, userProfile: PROFILES.find(p => p.id === currentProfile) }, 'Marché Local Finance')}
                                {renderTab('dg_validations', DGValidationsTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Validations DG')}
                                {renderTab('achats_dashboard', AchatsDashboardTab, { currentProfile, onNavigate: (tab, filter) => { if (filter) localStorage.setItem('achats_' + tab.replace('achats_','') + '_filter', filter); setCurrentTab(tab); localStorage.setItem('lastTab', tab); } }, 'Achats Dashboard')}
                                {renderTab('achats_da', AchatsDATab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile), onNavigate: (tab, bdcId) => { if (bdcId) sessionStorage.setItem('openBdcId', bdcId); setCurrentTab(tab); localStorage.setItem('lastTab', tab); } }, 'Demandes Achat')}
                                {renderTab('achats_bdc', AchatsBDCTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Bons de Commande')}
                                {renderTab('achats_receptions_valoriser', AchatsReceptionsValoriserTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Réceptions à valoriser')}
                                {renderTab('achats_fournisseurs', AchatsFournisseursTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Fournisseurs')}
                                {renderTab('achats_catalogue', AchatsCatalogueTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Catalogue')}
                                {renderTab('achats_analyses_foliaires', AchatsAnalysesFoliairesTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Analyses Foliaires')}
                                {renderTab('achats_consultation', AchatsConsultationTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Consultation')}
                                {renderTab('fin_codes_analytiques', FinCodesAnalytiquesTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Codes Analytiques')}
                                {renderTab('fin_delete_articles', FinDeleteArticlesTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Suppression Articles')}
                                {renderTab('fin_virements', FinVirementsTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Virements')}
                                {renderTab('fin_bdc', FinBDCTab, { currentProfile }, 'BDC Finance')}
                                {renderTab('achats_factures', AchatsFacturesTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Factures Achats')}
                                {renderTab('achats_paiements', AchatsPaiementsTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Paiements Achats')}
                                {renderTab('achats_scan_factures', AchatsScanFacturesTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Scan Factures')}
                                {renderTab('achats_scan_bl', AchatsScanBLTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Scan BL')}
                                {renderTab('achats_bon_apport', AchatsBonApportTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Bon Apport Achats')}
                                {renderTab('achats_rapprochement', AchatsRapprochementTab, {}, 'Rapprochement')}
                                {renderTab('achats_vente_plastique', AchatsVentePlastiqueTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Vente Plastique')}
                                {renderTab('fin_factures', FinFacturesTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Factures Finance')}
                                {renderTab('fin_paiements', FinPaiementsTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Paiements Finance')}
                                {renderTab('mag_bc', MagBCTabLazy, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Bons Consommation')}
                                {renderTab('mag_bc_engrais', MagBCTabLazy, { type: 'engrais', currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'BC Engrais')}
                                {renderTab('mag_bc_phyto', MagBCTabLazy, { type: 'pesticide', currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'BC Phyto')}
                                {renderTab('chef_agronomie', ChefAgronomieTab, { data, farmFilter: avoSubFilter || farmFilter, getAlias, getFerme, currentProfile, profileData: PROFILES.find(p => p.id === currentProfile), userProfile }, 'Agronomie Chef')}
                                {renderTab('chef_tracking', ChefTrackingTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Suivi Commandes')}
                                {renderTab('chef_da', ChefDATab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'DA Chef')}
                                {renderTab('chef_validations', ChefValidationsTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Validations Chef')}
                                {renderTab('chef_validation_bons', ChefValidationBonsTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Validation Bons Chef')}
                                {renderTab('qualite_validation_bons', QualiteValidationBonsTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Validation Bons Qualité')}
                                {renderTab('dqr_daily', DQRDailyTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'DQR Journalier')}
                                {renderTab('fin_budget', BudgetVsReelTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Budget vs Réel')}
                                {renderTab('dg_adoption', DGAdoptionTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Adoption')}
                                {renderTab('dg_tasks', DGTasksTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Tâches DG')}
                                {renderTab('dg_cr_reunions', DGMeetingCRTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'CR Réunions')}
                                {renderTab('dg_signature', DGSignatureTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Signature')}
                                {renderTab('dg_parametres', DGParametresTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Paramètres DG')}
                                {renderTab('suivi_pointage', SuiviPointageTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile) }, 'Suivi Pointage')}
                                {renderTab('agro_dashboard', AgroDashboardTab, { data, getAlias }, 'Agro Dashboard')}
                                {renderTab('agro_fertilisation', AgroFertilisationTab, { data, getAlias, getFerme }, 'Fertilisation')}
                                {renderTab('agro_phyto', AgroPhytoTab, { data, getAlias, getFerme }, 'Phyto')}
                                {/* Seul onglet rendu hors de `renderTab` : il lui faut donc son
                                    propre Suspense, sinon le composant différé lèverait au rendu.
                                    La garde `&& Composant` d'origine testait la présence du global ;
                                    elle n'a plus de sens sur un composant différé, dont l'absence
                                    éventuelle se manifeste au chargement et tombe dans la frontière
                                    d'erreur ci-dessous. */}
                                {currentTab === 'agro_conso_valorisee' && <TabErrorBoundary name="Engrais & Pesticides" key="conso-valorisee-eb"><React.Suspense fallback={<div style={{padding:'32px',textAlign:'center',color:'var(--muted, #888)'}}>Chargement du module…</div>}>{React.createElement(ConsoValoriseeTabLazy, { getAlias, currentProfile, fermesDispo: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'Avocatier'] })}</React.Suspense></TabErrorBoundary>}
                                {renderTab('agro_irrigation', AgroIrrigationTab, { data, getAlias, getFerme }, 'Irrigation')}
                                {renderTab('agro_composition', AgroCompositionTab, { data }, 'Composition')}
                                {renderTab('agro_parcelles', AgroParcellesTab, { data, getAlias, updateAlias, parcAliases, parcFermes, updateFerme }, 'Parcelles')}
                                {renderTab('agro_avancement', AgroAvancementTab, { data, getAlias, getFerme }, 'Avancement')}
                                {renderTab('agro_growth', AgroGrowthTab, { currentProfile, userProfile }, 'Suivi Croissance')}
                                {renderTab('agro_farmroad', AgroFarmroadTab, { data }, 'FarmRoad')}
                                {renderTab('agro_forecast', AgroForecastTab, {}, 'Forecast Météo')}
                                {renderTab('agro_harvest', AgroHarvestPredictionTab, {}, 'Prédiction Récolte')}
                                {renderTab('caisse', CaisseTab, { currentProfile, profileData: PROFILES.find(p => p.id === currentProfile), userProfile }, 'Gestion de Caisse')}
                                {renderTab('coming_soon', ComingSoonTab, {}, 'Bientôt Disponible')}
                                {currentTab === 'bug_reports' && window.BugReportsAdmin && <TabErrorBoundary name="Bugs signalés" key="bug-reports-eb">{React.createElement(window.BugReportsAdmin, { currentProfile })}</TabErrorBoundary>}
                                {currentTab === 'evolution' && <TabErrorBoundary name="Évolutions" key="evolution-eb"><React.Suspense fallback={<div style={{padding:'32px',textAlign:'center',color:'var(--muted, #888)'}}>Chargement du module…</div>}><EvolutionTab key={refreshKey + '-' + currentProfile} currentProfile={currentProfile} profileData={PROFILES.find(p => p.id === currentProfile)} userProfile={userProfile} isDG={userProfile.profileId === 'dg' || currentProfile === 'dg'} /></React.Suspense></TabErrorBoundary>}
                                {currentTab === 'admin_users' && userProfile.role === 'admin' && <TabErrorBoundary name="Admin" key="admin-eb"><React.Suspense fallback={<div style={{padding:'32px',textAlign:'center',color:'var(--muted, #888)'}}>Chargement du module…</div>}><AdminConsoleTab key={refreshKey} authUser={authUser} userProfile={userProfile} /></React.Suspense></TabErrorBoundary>}
                            </div>
                        </div>
                    </div>

                    {/* Bottom Navigation — mobile only (hidden via CSS on desktop) */}
                    {(() => {
                        const mobileNavItems = navItems.slice(0, 4);
                        const moreNavItems = navItems.slice(4);
                        const isMoreActive = moreNavItems.some(n => n.id === currentTab);
                        const shortLabel = (label) => label.length > 8 ? label.substring(0, 7) + '.' : label;
                        return (
                            <React.Fragment>
                                <div className="bottom-nav">
                                    <div className="bottom-nav-inner">
                                        {mobileNavItems.map(item => (
                                            <button key={item.id}
                                                className={`bnav-item ${currentTab === item.id ? 'active' : ''}`}
                                                onClick={() => { setCurrentTab(item.id); localStorage.setItem('lastTab', item.id); setShowMoreMenu(false); }}>
                                                <i className={`fa-solid ${item.icon}`}></i>
                                                <span>{shortLabel(item.label)}</span>
                                            </button>
                                        ))}
                                        {moreNavItems.length > 0 && (
                                            <button className={`bnav-item ${isMoreActive || showMoreMenu ? 'active' : ''}`}
                                                onClick={() => setShowMoreMenu(!showMoreMenu)}>
                                                <i className="fa-solid fa-ellipsis"></i>
                                                <span>Plus</span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* More Menu Overlay + Panel */}
                                <div className={`more-menu-overlay ${showMoreMenu ? 'open' : ''}`} onClick={() => setShowMoreMenu(false)}></div>
                                <div className={`more-menu-panel ${showMoreMenu ? 'open' : ''}`}>
                                    <div className="more-menu-handle"></div>
                                    {moreNavItems.map(item => (
                                        <button key={item.id}
                                            className={`more-menu-item ${currentTab === item.id ? 'active' : ''}`}
                                            onClick={() => { setCurrentTab(item.id); localStorage.setItem('lastTab', item.id); setShowMoreMenu(false); }}>
                                            <i className={`fa-solid ${item.icon}`}></i>
                                            {item.label}
                                        </button>
                                    ))}
                                    <div className="more-menu-sep"></div>
                                    {!window.matchMedia('(display-mode: standalone)').matches && !window.navigator.standalone && (
                                        <button className="more-menu-item" style={{color:'var(--green)',fontWeight:600}}
                                            onClick={() => { setShowInstallGuide(true); setShowMoreMenu(false); }}>
                                            <i className="fa-solid fa-download"></i>
                                            Installer l'application
                                        </button>
                                    )}
                                    <div className="more-menu-user">
                                        <div className="more-menu-user-avatar">
                                            {(userProfile.displayName || userProfile.email || 'U').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="more-menu-user-info">
                                            <div className="more-menu-user-name">{userProfile.displayName || userProfile.email}</div>
                                            <div className="more-menu-user-role">{profile?.label || currentProfile}</div>
                                        </div>
                                    </div>
                                    <button className="more-menu-logout" onClick={() => firebaseAuth.signOut()}>
                                        <i className="fa-solid fa-right-from-bracket"></i>
                                        Déconnexion
                                    </button>
                                </div>
                            </React.Fragment>
                        );
                    })()}
                    <NotificationPopup />

                    {/* Tutorial Menu Modal */}
                    {showTutorialMenu && (
                        <TutorialMenu
                            currentProfile={currentProfile}
                            onStart={(tut) => startTutorial(tut, currentProfile)}
                            onClose={() => setShowTutorialMenu(false)}
                        />
                    )}

                    {/* Install Guide Modal */}
                    {showInstallGuide && (
                        <InstallGuide onClose={() => setShowInstallGuide(false)} />
                    )}

                    {/* Signalement de bug in-app — composant séparé (window.BugReportButton) */}
                    {window.BugReportButton && React.createElement(window.BugReportButton, {
                        currentProfile: profile || currentProfile,
                        currentScreen: currentTab,
                    })}
                </div>
            );
        }

export { AuthenticatedApp };
