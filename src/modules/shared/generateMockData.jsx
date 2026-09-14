/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): generateMockData */
import { parcelleConfig } from '../agronomie/parcelleConfig.jsx';
import { meteoFermes } from '../technique/meteoFermes.jsx';
import { FARMS } from './FARMS.jsx';

/**
 * Chantier "production readiness" (docs/DATA_SOURCES.md), Phase 3a — drapeau
 * D'INSPECTION UNIQUEMENT, pas un flag produit. Quand actif, generateMockData
 * calcule tout normalement (rien de la logique interne ne change) mais son
 * retour est vidé clé par clé — [] pour un tableau, {} pour un objet, 0 pour
 * un nombre, '' pour une chaîne, null reste null. Sert à distinguer, écran par
 * écran, ce qui a une vraie source Firestore (l'écran affiche un état vide
 * propre) de ce qui n'affichait qu'une valeur fabriquée (l'écran se vide aussi
 * silencieusement — c'est le signal recherché).
 * Activation : `?emptyMockData=1` dans l'URL, ou `localStorage.sb_flag_empty_mock_data = '1'`.
 */
function isEmptyMockDataFlagActive() {
    if (typeof window === 'undefined') return false;
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('emptyMockData') === '1') return true;
        return !!(window.localStorage && window.localStorage.getItem('sb_flag_empty_mock_data') === '1');
    } catch (_) {
        return false;
    }
}

/** Vide UNE valeur en gardant son type de base. Pas de récursion : chaque clé
 * du retour de generateMockData est déjà un domaine complet (tableau, objet,
 * nombre...) — la vider à ce niveau suffit à vider l'écran qui la consomme. */
function emptyLike(v) {
    if (v === null || v === undefined) return v;
    if (Array.isArray(v)) return [];
    if (typeof v === 'function') return v;
    if (typeof v === 'number') return 0;
    if (typeof v === 'string') return '';
    if (typeof v === 'boolean') return false;
    if (typeof v === 'object') return {};
    return v;
}

// ===================== MOCK DATA =====================
        function generateMockData(farm) {
            const operations = ['Taille', 'Palissage', 'Désherbage', 'Fertigation', 'Traitement phyto', 'Tuteurage', 'Paillage', 'Irrigation'];
            const parcelles_f1 = ['P1-Myrtille A', 'P2-Myrtille B', 'P3-Framboise', 'P4-Myrtille C', 'P5-Framboise B'];
            const parcelles_f5 = ['P1-Myrtille', 'P2-Framboise A', 'P3-Framboise B', 'P4-Myrtille D'];
            const parcelles_avo = ['P1-Hass', 'P2-Hass B', 'P3-Fuerte'];

            const parcellesMap = { F1: parcelles_f1, F5: parcelles_f5, Avocatier: parcelles_avo };

            const names = ['Ahmed B.','Fatima Z.','Youssef M.','Khadija L.','Mohamed A.','Aicha H.','Hassan R.','Rachida S.','Omar K.','Zineb D.','Said T.','Nadia E.','Ibrahim F.','Samira G.','Khalid N.','Amina P.','Mustapha Q.','Laila V.','Driss W.','Hanane X.'];

            const effectif = {
                F1: { horsRecolte: 42 + Math.floor(Math.random()*10), recolte: 95 + Math.floor(Math.random()*20), postesFixes: 12 },
                F5: { horsRecolte: 35 + Math.floor(Math.random()*8), recolte: 70 + Math.floor(Math.random()*15), postesFixes: 10 },
                Avocatier: { horsRecolte: 18 + Math.floor(Math.random()*5), recolte: 35 + Math.floor(Math.random()*10), postesFixes: 6 }
            };

            const parcelleDetail = (parcellesMap[farm] || parcelles_f1).map(parcelle => ({
                parcelle,
                effectif: 10 + Math.floor(Math.random() * 25),
                recolte: 5 + Math.floor(Math.random() * 15),
                horsRecolte: 3 + Math.floor(Math.random() * 8),
                status: Math.random() > 0.2 ? 'active' : 'warning'
            }));

            const topOps = operations.slice(0, 5).map(op => ({
                operation: op,
                effectif: 5 + Math.floor(Math.random() * 20),
                parcelle: (parcellesMap[farm] || parcelles_f1)[Math.floor(Math.random() * (parcellesMap[farm] || parcelles_f1).length)]
            })).sort((a, b) => b.effectif - a.effectif);

            // Ouvriers avec matricule (premiers 2 chiffres = code équipe)
            const ouvriersMatricule = [];
            const equipePrefixes = ['01','02','03','04','05','06','07','08'];
            const prenomsH = ['Hassan','Ahmed','Mohamed','Youssef','Omar','Abdellah','Khalid','Rachid','Brahim','Said','Hamid','Mustapha','Aziz','Driss','Nabil','Adil','Jawad','Fouad','Karim','Amine'];
            const prenomsF = ['Fatima','Khadija','Aicha','Amina','Zineb','Naima','Halima','Latifa','Samira','Malika','Habiba','Nadia','Souad','Houda','Ilham','Salma','Meryem','Jamila','Rachida','Loubna'];
            const noms = ['El Idrissi','Boujemaa','Ait Lahcen','Ouazzani','El Fassi','Benali','Moujahid','El Amrani','Tazi','Berrada','El Alaoui','Chakir','El Moukhtar','Hajji','Zeroual','El Mansouri','Bennani','El Ghali','Kadiri','Rachidi'];
            equipePrefixes.forEach((prefix, eqIdx) => {
                const nbOuv = 6 + Math.floor(Math.random() * 10);
                for (let j = 0; j < nbOuv; j++) {
                    const isMale = Math.random() > 0.45;
                    const prenoms = isMale ? prenomsH : prenomsF;
                    ouvriersMatricule.push({
                        matricule: prefix + String(100 + Math.floor(Math.random() * 900)).slice(0,3),
                        prenom: prenoms[Math.floor(Math.random() * prenoms.length)],
                        nom: noms[Math.floor(Math.random() * noms.length)],
                        ferme: eqIdx < 4 ? 'F1' : (eqIdx < 7 ? 'F5' : 'Avocatier'),
                        equipePrefix: prefix
                    });
                }
            });

            // Configuration des primes de récolte
            const primesConfig = {
                framboise: {
                    tranches: [
                        { seuil: 20, prime: 20, label: 'Au-delà de 20 Kg' },
                        { seuil: 25, prime: 40, label: 'Au-delà de 25 Kg' },
                        { seuil: 30, prime: 60, label: 'Entre 30 et 40 Kg', bonusParKg: 3, bonusBase: 30 },
                        { seuil: 40, prime: 90, label: 'Au-delà de 40 Kg', bonusParKg: 4, bonusBase: 40 },
                    ],
                },
                myrtille: {
                    tranches: [
                        { seuil: 30, prime: 0, label: 'Corina: au-delà de 30 Kg', bonusParKg: 2.5, bonusBase: 30 },
                        { seuil: 25, prime: 0, label: 'Breeze/Cascade: au-delà de 25 Kg', bonusParKg: 2.5, bonusBase: 25 },
                    ],
                },
                primeCaporal: { base: 50, bonusSiEquipeSup30: 30 },
                primeChargement: { coutParJour: 10 },
                joursFeries: [
                    // Fixes
                    { date: '2025-01-01', label: 'Nouvel An', type: 'fixe' },
                    { date: '2025-01-11', label: "Manifeste de l'Indépendance", type: 'fixe' },
                    { date: '2025-01-14', label: 'Nouvel An Amazigh', type: 'fixe' },
                    { date: '2025-05-01', label: 'Fête du Travail', type: 'fixe' },
                    { date: '2025-07-30', label: 'Fête du Trône', type: 'fixe' },
                    { date: '2025-08-14', label: 'Oued Ed-Dahab', type: 'fixe' },
                    { date: '2025-08-20', label: 'Révolution du Roi et du Peuple', type: 'fixe' },
                    { date: '2025-08-21', label: 'Fête de la Jeunesse', type: 'fixe' },
                    { date: '2025-11-06', label: 'Marche Verte', type: 'fixe' },
                    { date: '2025-11-18', label: "Fête de l'Indépendance", type: 'fixe' },
                    // Islamiques 2025
                    { date: '2025-03-30', label: 'Aïd Al Fitr', type: 'islamique' },
                    { date: '2025-03-31', label: 'Aïd Al Fitr (2e jour)', type: 'islamique' },
                    { date: '2025-06-06', label: 'Aïd Al Adha', type: 'islamique' },
                    { date: '2025-06-07', label: 'Aïd Al Adha (2e jour)', type: 'islamique' },
                    { date: '2025-06-27', label: '1er Moharram', type: 'islamique' },
                    { date: '2025-09-05', label: 'Aïd Al Mawlid', type: 'islamique' },
                    { date: '2026-01-01', label: 'Nouvel An', type: 'fixe' },
                    { date: '2026-01-11', label: "Manifeste de l'Indépendance", type: 'fixe' },
                    { date: '2026-01-14', label: 'Nouvel An Amazigh', type: 'fixe' },
                    { date: '2026-05-01', label: 'Fête du Travail', type: 'fixe' },
                    { date: '2026-07-30', label: 'Fête du Trône', type: 'fixe' },
                    { date: '2026-08-14', label: 'Oued Ed-Dahab', type: 'fixe' },
                    { date: '2026-08-20', label: 'Révolution du Roi et du Peuple', type: 'fixe' },
                    { date: '2026-08-21', label: 'Fête de la Jeunesse', type: 'fixe' },
                    { date: '2026-11-06', label: 'Marche Verte', type: 'fixe' },
                    { date: '2026-11-18', label: "Fête de l'Indépendance", type: 'fixe' },
                    // Islamiques 2026 (à confirmer)
                    { date: '2026-03-30', label: 'Aïd Al Fitr', type: 'islamique' },
                    { date: '2026-06-06', label: 'Aïd Al Adha', type: 'islamique' },
                    { date: '2026-06-26', label: '1er Moharram', type: 'islamique' },
                    { date: '2026-09-04', label: 'Aïd Al Mawlid', type: 'islamique' },
                ]
            };

            // Detect if a variety is myrtille — based on parcelleConfig mapping
            const myrtilleVarietes = ['corina', 'corrina', 'cascade', 'breeze', 'myrtille', 'blue'];
            const isMyrtille = (variete) => {
                if (!variete) return false;
                const vl = variete.toLowerCase().trim();
                return myrtilleVarietes.some(m => vl.includes(m));
            };
            // Myrtille prime thresholds: Breeze=25kg, Cascade=25kg (before 2026-04-25) / 30kg (from 2026-04-25), Corina=30kg
            const cascadeSeuil30Date = '2026-04-25';
            const getMyrtilleSeuil = (variete, date) => {
                const vl = (variete || '').toLowerCase().trim();
                if (vl.includes('breeze')) return 25;
                if (vl.includes('cascade')) return date >= cascadeSeuil30Date ? 30 : 25;
                return 30; // Corina / default
            };

            // Helper function to calculate prime based on kilos, culture and date
            const calcPrime = (kg, variete, date) => {
                const k = kg || 0;
                if (isMyrtille(variete)) {
                    const seuil = getMyrtilleSeuil(variete, date);
                    return k > seuil ? Math.round((k - seuil) * 2.5 * 10) / 10 : 0;
                }
                // Framboise (default)
                if (k < 20) return 0;
                if (k < 25) return 20;
                if (k < 30) return 40;
                if (k < 40) return Math.round((60 + (k - 30) * 3) * 10) / 10;
                return Math.round((90 + (k - 40) * 4) * 10) / 10;
            };

            const recolteData = names.slice(0, 12 + Math.floor(Math.random()*6)).map((name, i) => {
                const kilos = Math.round((40 - i * 1.8 + Math.random() * 8) * 10) / 10;
                const matricule = ouvriersMatricule[Math.floor(Math.random() * ouvriersMatricule.length)];
                const equipeCode = matricule ? matricule.equipePrefix : equipePrefixes[Math.floor(Math.random() * equipePrefixes.length)];
                return {
                    rank: i + 1,
                    nom: name,
                    matricule: matricule ? matricule.matricule : `${equipeCode}${100 + Math.floor(Math.random() * 900)}`,
                    equipeCode,
                    equipe: `Eq-${equipeCode}`,
                    kilos,
                    prime: calcPrime(kilos),
                    parcelle: (parcellesMap[farm] || parcelles_f1)[Math.floor(Math.random() * (parcellesMap[farm] || parcelles_f1).length)]
                };
            }).sort((a, b) => b.kilos - a.kilos).map((r, i) => ({ ...r, rank: i + 1 }));

            // Generate recolteParJour - quinzaine 01/03 to 09/03 (today) chronological
            const quinzaineJours = ['01/03','02/03','03/03','04/03','05/03','06/03','07/03','08/03','09/03'];
            const recolteParJour = quinzaineJours.map((jour, dayIndex) =>
                names.slice(0, 8 + Math.floor(Math.random() * 6)).map((name, i) => {
                    const kilos = Math.round((35 - i * 1.5 + Math.random() * 10 + dayIndex * 0.3) * 10) / 10;
                    const matricule = ouvriersMatricule[Math.floor(Math.random() * ouvriersMatricule.length)];
                    const equipeCode = matricule ? matricule.equipePrefix : equipePrefixes[Math.floor(Math.random() * equipePrefixes.length)];
                    return {
                        nom: name,
                        matricule: matricule ? matricule.matricule : `${equipeCode}${100 + Math.floor(Math.random() * 900)}`,
                        equipeCode,
                        kilos,
                        prime: calcPrime(kilos)
                    };
                })
            );

            const horsRecolteDetail = operations.map(op => ({
                operation: op,
                effectif: 3 + Math.floor(Math.random() * 15),
                avancement: Math.floor(Math.random() * 100),
                parcelle: (parcellesMap[farm] || parcelles_f1)[Math.floor(Math.random() * (parcellesMap[farm] || parcelles_f1).length)],
                objectif: 80 + Math.floor(Math.random() * 20),
                status: Math.random() > 0.3 ? 'active' : (Math.random() > 0.5 ? 'warning' : 'danger')
            }));

            const pointageJour = FARMS.map(f => {
                const eff = effectif[f] || { horsRecolte: 10 + Math.floor(Math.random()*5), recolte: 20 + Math.floor(Math.random()*10), postesFixes: 4 };
                const total = eff.horsRecolte + eff.recolte + eff.postesFixes;
                const veille = total + Math.floor(Math.random() * 20 - 10);
                return {
                    ferme: f,
                    total,
                    horsRecolte: eff.horsRecolte,
                    recolte: eff.recolte,
                    postesFixes: eff.postesFixes,
                    veille,
                    diff: Math.round(((total - veille) / veille) * 100 * 10) / 10,
                    cumulQuinzaine: total * (7 + Math.floor(Math.random() * 5))
                };
            });

            const quinzaineData = {
                periode: '01/03/2026 - 15/03/2026',
                totalJournees: 2850 + Math.floor(Math.random() * 200),
                coutEstime: 285000 + Math.floor(Math.random() * 30000),
                prevision: 3200,
                tauxRemplissage: 85 + Math.floor(Math.random() * 10),
                parFerme: FARMS.map(f => ({
                    ferme: f,
                    journees: 600 + Math.floor(Math.random() * 400),
                    cout: 80000 + Math.floor(Math.random() * 40000),
                    recolte: 300 + Math.floor(Math.random() * 200),
                    horsRecolte: 200 + Math.floor(Math.random() * 150)
                })),
                parParcelle: parcelleDetail.map(p => ({
                    parcelle: p.parcelle,
                    journees: 50 + Math.floor(Math.random() * 150),
                    cout: 8000 + Math.floor(Math.random() * 15000)
                }))
            };

            const weeklyTrend = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map((d, i) => ({
                jour: d,
                F1: 100 + Math.floor(Math.random() * 40),
                F5: 80 + Math.floor(Math.random() * 30),
                Avocatier: 40 + Math.floor(Math.random() * 20),
            }));

            // Horaires par équipe (entrée/sortie QR)
            const equipes = ['Eq-1','Eq-2','Eq-3','Eq-4','Eq-5','Eq-6'].map((eq, i) => {
                const hEntree = 6 + Math.floor(Math.random() * 2);
                const mEntree = Math.floor(Math.random() * 60);
                const hSortie = 14 + Math.floor(Math.random() * 3);
                const mSortie = Math.floor(Math.random() * 60);
                const totalMin = (hSortie * 60 + mSortie) - (hEntree * 60 + mEntree) - 30;
                const ferme = FARMS[i % 3];
                return {
                    equipe: eq,
                    ferme,
                    effectif: 8 + Math.floor(Math.random() * 12),
                    entree: `${String(hEntree).padStart(2,'0')}:${String(mEntree).padStart(2,'0')}`,
                    sortie: `${String(hSortie).padStart(2,'0')}:${String(mSortie).padStart(2,'0')}`,
                    pause: 30,
                    tempsNet: `${Math.floor(totalMin / 60)}h${String(totalMin % 60).padStart(2,'0')}`,
                    tempsNetMin: totalMin
                };
            });

            // Suivi modifications pointage (quinzaine)
            const joursSemaine = ['01/03','02/03','03/03','04/03','05/03','06/03','07/03','08/03'];
            const suiviModifs = [];
            joursSemaine.forEach(jour => {
                // Bulk PDA uploads
                const nbPDA = 2 + Math.floor(Math.random() * 3);
                for (let k = 0; k < nbPDA; k++) {
                    suiviModifs.push({
                        date: jour,
                        heure: `${6 + Math.floor(Math.random() * 12)}:${String(Math.floor(Math.random() * 60)).padStart(2,'0')}`,
                        type: 'PDA',
                        source: `PDA-${1 + Math.floor(Math.random() * 5)}`,
                        ferme: FARMS[Math.floor(Math.random() * 3)],
                        nbLignes: 15 + Math.floor(Math.random() * 80),
                        description: 'Synchronisation PDA'
                    });
                }
                // Modifications manuelles RH
                const nbManuel = Math.floor(Math.random() * 4);
                for (let k = 0; k < nbManuel; k++) {
                    const actions = ['Ajout ouvrier manquant','Correction heures','Suppression doublon','Changement équipe','Ajout absence justifiée','Correction ferme'];
                    suiviModifs.push({
                        date: jour,
                        heure: `${8 + Math.floor(Math.random() * 9)}:${String(Math.floor(Math.random() * 60)).padStart(2,'0')}`,
                        type: 'RH',
                        source: 'Resp. RH',
                        ferme: FARMS[Math.floor(Math.random() * 3)],
                        nbLignes: 1 + Math.floor(Math.random() * 5),
                        description: actions[Math.floor(Math.random() * actions.length)]
                    });
                }
            });
            suiviModifs.sort((a, b) => {
                if (a.date !== b.date) return a.date > b.date ? -1 : 1;
                return a.heure > b.heure ? -1 : 1;
            });

            // ===== QUALITE DATA (Driscoll's Inspection Reports) =====
            const varietes = ['Maravilla', 'Maravilla Long Cane', 'Reyna', 'Adelita', 'Kwanza'];

            // Bloc IDs - parcelle + variété grouping
            const defaultBlocIds = [
                { id: 'BLOC-172-MAR', label: 'Maravilla Green Cane', parcelle: '172', variete: 'Maravilla', ferme: 'F1', ranch: '200742', ranchName: 'R-Berry Good Farms SARL', blockId: '172-R3011', ha: 4.0, treatment: 'Prune coldstored', treatmentWeek: 'Wk 51' },
                { id: 'BLOC-195-REY', label: 'Reyna', parcelle: '195', variete: 'Reyna', ferme: 'F5', ranch: '200876', ranchName: 'Berry Good Farms SARL 3', blockId: '195-R509', ha: 3.0, treatment: 'Planting', treatmentWeek: 'Wk 30' },
                { id: 'BLOC-195-YAZ', label: 'Yazmin', parcelle: '195', variete: 'Yazmin', ferme: 'F5', ranch: '200876', ranchName: 'Berry Good Farms SARL 3', blockId: '195-R071', ha: 1.9, treatment: 'Planting', treatmentWeek: 'Wk 19' },
                { id: 'BLOC-195-YAZ2', label: 'Yazmin Cut Back', parcelle: '195', variete: 'Yazmin', ferme: 'F5', ranch: '200876', ranchName: 'Berry Good Farms SARL 3', blockId: '195-R007', ha: 1.9, treatment: 'Cut Back', treatmentWeek: 'Wk 52' },
            ];
            const blocIds = (() => { try { const s = localStorage.getItem('blocIdsConfig'); return s ? JSON.parse(s) : defaultBlocIds; } catch(e) { return defaultBlocIds; } })();

            const qualiteInspections = [];

            // Today's real inspection data from Driscoll's reports (PJ screenshots)
            const todayBatches = [
                {
                    receiptId: 'RID-001296224', batchNumber: '195067195-R50903', variete: 'Reyna', blocId: 'BLOC-195-REY',
                    qty: 30, weight: 45, brix: 8.4, pqScore: 82, result: 'Pass',
                    condPct: 1.5, appPct: 3.8, fruitInspected: 130, sampleSize: 4,
                    avgFruitPerPunnet: 32.5, avgPunnetWeight: 151.5,
                    item: '170090 RASP Conv Drisc 12x125', warehouse: 'MA MOU', license: '105531790',
                    received: '03/08/2026 15:45', inspected: '03/08/2026 15:47',
                    conditionDetail: [
                        { defect: 'Decay', count: 0, pct: 0 },
                        { defect: 'Wet Leaky', count: 2, pct: 1.5 },
                        { defect: 'Overripe', count: 0, pct: 0 },
                        { defect: 'Collapsed', count: 0, pct: 0 },
                        { defect: 'Weak Cells', count: 0, pct: 0 },
                        { defect: 'Sooty Mold', count: 0, pct: 0 },
                        { defect: 'Yellow Rust', count: 0, pct: 0 },
                    ],
                    conditionPoints: 65,
                    appearanceDetail: [
                        { defect: 'Broken', count: 0, pct: 0, points: 10 },
                        { defect: 'Green', count: 5, pct: 3.8, points: 7 },
                        { defect: 'Size', count: 0, pct: 0 },
                        { defect: 'Skin Damage', count: 0, pct: 0 },
                        { defect: 'Malformed', count: 0, pct: 0 },
                        { defect: 'Attached Calyx', count: 0, pct: 0 },
                        { defect: 'Foreign Bodies', count: 0, pct: 0 },
                    ],
                    appearancePoints: 17,
                },
                {
                    receiptId: 'RID-620372', batchNumber: '172067172-R0102', variete: 'Maravilla', blocId: 'BLOC-172-MAR',
                    qty: 239, weight: 358.5, brix: 8.6, pqScore: 78, result: 'Pass',
                    condPct: 2.2, appPct: 2.5, fruitInspected: 357.5, sampleSize: 11,
                    avgFruitPerPunnet: 32.5, avgPunnetWeight: 151.5,
                    item: '170090 RASP Conv Drisc 12x125', warehouse: 'MA MOU', license: '105531784',
                    received: '03/08/2026 15:44', inspected: '03/08/2026 15:46',
                    conditionDetail: [
                        { defect: 'Decay', count: 0, pct: 0 },
                        { defect: 'Wet Leaky', count: 8, pct: 2.2 },
                        { defect: 'Overripe', count: 0, pct: 0 },
                        { defect: 'Collapsed', count: 0, pct: 0 },
                        { defect: 'Weak Cells', count: 0, pct: 0 },
                        { defect: 'Sooty Mold', count: 0, pct: 0 },
                        { defect: 'Yellow Rust', count: 0, pct: 0 },
                    ],
                    conditionPoints: 60,
                    appearanceDetail: [
                        { defect: 'Broken', count: 0, pct: 0, points: 10 },
                        { defect: 'Green', count: 9, pct: 2.5, points: 8 },
                        { defect: 'Size', count: 0, pct: 0 },
                        { defect: 'Skin Damage', count: 0, pct: 0 },
                        { defect: 'Malformed', count: 0, pct: 0 },
                        { defect: 'Attached Calyx', count: 0, pct: 0 },
                        { defect: 'Foreign Bodies', count: 0, pct: 0 },
                    ],
                    appearancePoints: 18,
                },
                {
                    receiptId: 'RID-620067', batchNumber: '172067172-R0103', variete: 'Maravilla', blocId: 'BLOC-172-MAR',
                    qty: 164, weight: 246, brix: 8.6, pqScore: 82.1, result: 'Pass',
                    condPct: 2.64, appPct: 3.52, fruitInspected: 228, sampleSize: 7,
                    avgFruitPerPunnet: 32.5, avgPunnetWeight: 151.5,
                    item: '170090 RASP Conv Drisc 12x125', warehouse: 'MA MOU', license: '105531786',
                    received: '03/08/2026 14:30', inspected: '03/08/2026 14:32',
                    conditionDetail: [
                        { defect: 'Decay', count: 0, pct: 0 },
                        { defect: 'Wet Leaky', count: 6, pct: 2.64 },
                        { defect: 'Overripe', count: 0, pct: 0 },
                        { defect: 'Collapsed', count: 0, pct: 0 },
                        { defect: 'Weak Cells', count: 0, pct: 0 },
                        { defect: 'Sooty Mold', count: 0, pct: 0 },
                        { defect: 'Yellow Rust', count: 0, pct: 0 },
                    ],
                    conditionPoints: 58,
                    appearanceDetail: [
                        { defect: 'Broken', count: 0, pct: 0, points: 10 },
                        { defect: 'Green', count: 8, pct: 3.52, points: 6 },
                        { defect: 'Size', count: 0, pct: 0 },
                        { defect: 'Skin Damage', count: 0, pct: 0 },
                        { defect: 'Malformed', count: 0, pct: 0 },
                        { defect: 'Attached Calyx', count: 0, pct: 0 },
                        { defect: 'Foreign Bodies', count: 0, pct: 0 },
                    ],
                    appearancePoints: 16,
                },
                {
                    receiptId: 'RID-619966', batchNumber: '172067172-R0104', variete: 'Maravilla', blocId: 'BLOC-172-MAR',
                    qty: 326, weight: 489, brix: 8.6, pqScore: 85.1, result: 'Pass',
                    condPct: 2.46, appPct: 0, fruitInspected: 448, sampleSize: 14,
                    avgFruitPerPunnet: 32, avgPunnetWeight: 151.5,
                    item: '170090 RASP Conv Drisc 12x125', warehouse: 'MA MOU', license: '105531787',
                    received: '03/08/2026 13:20', inspected: '03/08/2026 13:22',
                    conditionDetail: [
                        { defect: 'Decay', count: 1, pct: 0.22 },
                        { defect: 'Wet Leaky', count: 10, pct: 2.24 },
                        { defect: 'Overripe', count: 0, pct: 0 },
                        { defect: 'Collapsed', count: 0, pct: 0 },
                        { defect: 'Weak Cells', count: 0, pct: 0 },
                        { defect: 'Sooty Mold', count: 0, pct: 0 },
                        { defect: 'Yellow Rust', count: 0, pct: 0 },
                    ],
                    conditionPoints: 58,
                    appearanceDetail: [
                        { defect: 'Broken', count: 0, pct: 0, points: 10 },
                        { defect: 'Green', count: 0, pct: 0, points: 10 },
                        { defect: 'Size', count: 0, pct: 0 },
                        { defect: 'Skin Damage', count: 0, pct: 0 },
                        { defect: 'Malformed', count: 0, pct: 0 },
                        { defect: 'Attached Calyx', count: 0, pct: 0 },
                        { defect: 'Foreign Bodies', count: 0, pct: 0 },
                    ],
                    appearancePoints: 20,
                },
                {
                    receiptId: 'RID-001295840', batchNumber: '195067195-R50901', variete: 'Reyna', blocId: 'BLOC-195-REY',
                    qty: 42, weight: 63, brix: 8.6, pqScore: 80.3, result: 'Pass',
                    condPct: 1.56, appPct: 9.38, fruitInspected: 128, sampleSize: 4,
                    avgFruitPerPunnet: 32.5, avgPunnetWeight: 151.5,
                    item: '170090 RASP Conv Drisc 12x125', warehouse: 'MA MOU', license: '105531788',
                    received: '03/08/2026 12:00', inspected: '03/08/2026 12:02',
                    conditionDetail: [
                        { defect: 'Decay', count: 0, pct: 0 },
                        { defect: 'Wet Leaky', count: 2, pct: 1.56 },
                        { defect: 'Overripe', count: 0, pct: 0 },
                        { defect: 'Collapsed', count: 0, pct: 0 },
                        { defect: 'Weak Cells', count: 0, pct: 0 },
                        { defect: 'Sooty Mold', count: 0, pct: 0 },
                        { defect: 'Yellow Rust', count: 0, pct: 0 },
                    ],
                    conditionPoints: 65,
                    appearanceDetail: [
                        { defect: 'Broken', count: 0, pct: 0, points: 10 },
                        { defect: 'Green', count: 12, pct: 9.38, points: 2 },
                        { defect: 'Size', count: 0, pct: 0 },
                        { defect: 'Skin Damage', count: 0, pct: 0 },
                        { defect: 'Malformed', count: 0, pct: 0 },
                        { defect: 'Attached Calyx', count: 0, pct: 0 },
                        { defect: 'Foreign Bodies', count: 0, pct: 0 },
                    ],
                    appearancePoints: 12,
                },
            ];

            // Add brixReceived and conditionPoints/appearancePoints if not already present
            todayBatches.forEach((b, idx) => {
                if (!b.brixReceived) {
                    b.brixReceived = idx % 3 !== 0; // Some lots don't have brix yet
                }
                if (!b.conditionPoints) {
                    b.conditionPoints = Math.round(70 - b.condPct * 2);
                }
                if (!b.appearancePoints) {
                    b.appearancePoints = Math.round(20 - b.appPct * 0.5);
                }
            });

            todayBatches.forEach(b => {
                qualiteInspections.push({ ...b, date: '08/03/2026', type: 'Initial Inspection' });
            });

            // Historique 14 jours par variété
            const qualiteHistorique = {};
            varietes.forEach(v => {
                const jours = [];
                for (let d = 1; d <= 14; d++) {
                    const dateStr = `${String(d).padStart(2, '0')}/03/2026`;
                    jours.push({
                        date: dateStr,
                        conditionPct: 1 + Math.random() * 4,
                        apparencePct: 1 + Math.random() * 6,
                        pqScore: 70 + Math.random() * 20,
                        passRate: 60 + Math.random() * 40,
                        nbBatches: 2 + Math.floor(Math.random() * 6)
                    });
                }
                qualiteHistorique[v] = jours;
            });

            // Brix par variété (lendemain)
            const qualiteBrix = varietes.map(v => ({
                variete: v,
                ranchAvg: 7.5 + Math.random() * 2,
                poolAvg: 7.5 + Math.random() * 2,
                brixPFQ: Math.round((7 + Math.random() * 3) / 8 * 10), // PFQ score out of 10
                historique: Array.from({length: 14}, (_, d) => ({
                    date: `${String(d + 1).padStart(2, '0')}/03/2026`,
                    brix: 7 + Math.random() * 3
                }))
            }));

            // PFQ Historical data per Bloc (7 days of data per bloc)
            const pfqHistory = {};
            blocIds.forEach(bloc => {
                const daysData = [];
                for (let d = 1; d <= 7; d++) {
                    const dateStr = `${String(8 - d).padStart(2, '0')}/03/2026`;
                    daysData.push({
                        date: dateStr,
                        conditionPoints: 60 + Math.random() * 10,
                        appearancePoints: 16 + Math.random() * 4,
                        brixPFQ: 8 + Math.random() * 2,
                        totalPFQ: 0 // Will be calculated
                    });
                }
                daysData.forEach(d => {
                    d.totalPFQ = Math.round((d.conditionPoints + d.appearancePoints + d.brixPFQ) * 10) / 10;
                });
                pfqHistory[bloc.id] = daysData;
            });

            // Weekly ranking data (multiple weeks history)
            const weeklyRanking = {
                currentWeek: 'WK9-2026',
                ranches: [
                    { rank: 1, ranchId: '201474', name: 'Ranch 201474', pqWeightedAvg: 95.69, percentile: 97 },
                    { rank: 2, ranchId: '201549', name: 'Ranch 201549', pqWeightedAvg: 95.58, percentile: 95 },
                    { rank: 3, ranchId: '201073', name: 'Ranch 201073', pqWeightedAvg: 95.35, percentile: 93 },
                    { rank: 4, ranchId: '201529', name: 'Ranch 201529', pqWeightedAvg: 95.29, percentile: 91 },
                    { rank: 5, ranchId: '200705', name: 'Ranch 200705', pqWeightedAvg: 95.15, percentile: 89 },
                    { rank: 6, ranchId: '200828', name: 'Ranch 200828', pqWeightedAvg: 94.98, percentile: 87 },
                    { rank: 7, ranchId: '201314', name: 'Ranch 201314', pqWeightedAvg: 94.92, percentile: 85 },
                    { rank: 8, ranchId: '201725', name: 'Ranch 201725', pqWeightedAvg: 94.91, percentile: 83 },
                    { rank: 9, ranchId: '201069', name: 'Ranch 201069', pqWeightedAvg: 94.36, percentile: 81 },
                    { rank: 10, ranchId: '201805', name: 'Ranch 201805', pqWeightedAvg: 94.30, percentile: 79 },
                    { rank: 11, ranchId: '201477', name: 'Ranch 201477', pqWeightedAvg: 94.08, percentile: 77 },
                    { rank: 12, ranchId: '201045', name: 'Ranch 201045', pqWeightedAvg: 94.05, percentile: 75 },
                    { rank: 13, ranchId: '201053', name: 'Ranch 201053', pqWeightedAvg: 94.03, percentile: 73 },
                    { rank: 14, ranchId: '200876', name: 'Ferme 195 (F5) - Ranch 200876', pqWeightedAvg: 94.03, percentile: 73, ourFarm: true, ferme: 'F5' },
                    { rank: 15, ranchId: '200559', name: 'Ranch 200559', pqWeightedAvg: 93.67, percentile: 71 },
                    { rank: 16, ranchId: '201198', name: 'Ranch 201198', pqWeightedAvg: 93.41, percentile: 69 },
                    { rank: 17, ranchId: '201654', name: 'Ranch 201654', pqWeightedAvg: 93.28, percentile: 67 },
                    { rank: 18, ranchId: '200742', name: 'Ferme 172 (F1) - Ranch 200742', pqWeightedAvg: null, percentile: null, ourFarm: true, ferme: 'F1', status: 'No production this week' },
                    { rank: 19, ranchId: '201834', name: 'Ranch 201834', pqWeightedAvg: 92.95, percentile: 55 },
                    { rank: 20, ranchId: '201042', name: 'Ranch 201042', pqWeightedAvg: 92.84, percentile: 53 },
                ],
                totalRanches: 38,
                history: [
                    { week: 'WK9', f1Rank: null, f1Score: null, f5Rank: 14, f5Score: 94.03, highest: 95.69, lowest: 88.12, avg: 93.41 },
                    { week: 'WK8', f1Rank: null, f1Score: null, f5Rank: 13, f5Score: 94.08, highest: 95.82, lowest: 87.95, avg: 93.28 },
                    { week: 'WK7', f1Rank: 18, f1Score: 93.45, f5Rank: 15, f5Score: 93.22, highest: 96.01, lowest: 88.50, avg: 93.55 },
                    { week: 'WK6', f1Rank: 12, f1Score: 94.12, f5Rank: 10, f5Score: 94.55, highest: 95.90, lowest: 87.30, avg: 93.10 },
                    { week: 'WK5', f1Rank: 15, f1Score: 93.78, f5Rank: 8, f5Score: 94.80, highest: 96.15, lowest: 88.22, avg: 93.65 },
                    { week: 'WK4', f1Rank: 10, f1Score: 94.30, f5Rank: 12, f5Score: 94.10, highest: 95.75, lowest: 87.88, avg: 93.20 },
                    { week: 'WK3', f1Rank: 8, f1Score: 94.60, f5Rank: 11, f5Score: 94.20, highest: 96.30, lowest: 88.10, avg: 93.48 },
                    { week: 'WK2', f1Rank: 14, f1Score: 93.90, f5Rank: 16, f5Score: 93.10, highest: 95.95, lowest: 87.50, avg: 93.05 },
                ]
            };

            // Expeditions data — loaded from Firebase (no demo data)
            const expeditions = [];

            // Stock Emballages
            const stockEmballages = [
                { ref: 'EMB-001', designation: 'Barquette 125g Driscoll\'s', unite: 'unité', stockInitial: 50000, entrees: 20000, sorties: 18500, stockActuel: 51500, seuilAlerte: 10000 },
                { ref: 'EMB-002', designation: 'Barquette 170g Driscoll\'s', unite: 'unité', stockInitial: 30000, entrees: 10000, sorties: 12000, stockActuel: 28000, seuilAlerte: 8000 },
                { ref: 'EMB-003', designation: 'Carton 12x125g', unite: 'unité', stockInitial: 5000, entrees: 2000, sorties: 1800, stockActuel: 5200, seuilAlerte: 1000 },
                { ref: 'EMB-004', designation: 'Carton 6x170g', unite: 'unité', stockInitial: 3000, entrees: 1500, sorties: 1200, stockActuel: 3300, seuilAlerte: 800 },
                { ref: 'EMB-005', designation: 'Film étirable palette', unite: 'rouleau', stockInitial: 200, entrees: 50, sorties: 80, stockActuel: 170, seuilAlerte: 30 },
                { ref: 'EMB-006', designation: 'Étiquette Driscoll\'s', unite: 'rouleau', stockInitial: 500, entrees: 200, sorties: 250, stockActuel: 450, seuilAlerte: 100 },
            ];

            // Stock Intrants
            const stockIntrants = [
                { ref: 'FRT-001', designation: 'NPK 15-15-15', categorie: 'Fertilisant', unite: 'kg', stock: 2500, seuilAlerte: 500, dernierAchat: '25/02/2026', fournisseur: 'OCP' },
                { ref: 'FRT-002', designation: 'Sulfate de potasse', categorie: 'Fertilisant', unite: 'kg', stock: 1200, seuilAlerte: 300, dernierAchat: '01/03/2026', fournisseur: 'OCP' },
                { ref: 'PST-001', designation: 'Topas (Penconazole)', categorie: 'Pesticide', unite: 'L', stock: 45, seuilAlerte: 10, dernierAchat: '17/02/2026', fournisseur: 'Syngenta' },
                { ref: 'PST-002', designation: 'Switch (Fludioxonil)', categorie: 'Pesticide', unite: 'kg', stock: 20, seuilAlerte: 5, dernierAchat: '20/02/2026', fournisseur: 'Syngenta' },
                { ref: 'PST-003', designation: 'Vertimec (Abamectine)', categorie: 'Pesticide', unite: 'L', stock: 30, seuilAlerte: 8, dernierAchat: '10/02/2026', fournisseur: 'Syngenta' },
                { ref: 'FRT-003', designation: 'Acide phosphorique', categorie: 'Fertilisant', unite: 'L', stock: 800, seuilAlerte: 200, dernierAchat: '28/02/2026', fournisseur: 'OCP' },
            ];

            // Parc Automobile
            const parcAuto = [
                { immat: '95-08-B-40', type: 'Camion frigorifique', marque: 'Isuzu NQR', affectation: 'Livraison Driscoll\'s', kmActuel: 87450, kmProchVidange: 90000, kmRestant: 2550, carteTotal: 'CT-4521', consoMoy: 18.5 },
                { immat: '12-A-3456', type: 'Pick-up', marque: 'Toyota Hilux', affectation: 'Chef F1', kmActuel: 124800, kmProchVidange: 125000, kmRestant: 200, carteTotal: 'CT-4522', consoMoy: 12.3 },
                { immat: '45-B-7890', type: 'Pick-up', marque: 'Mitsubishi L200', affectation: 'Chef F5', kmActuel: 95200, kmProchVidange: 100000, kmRestant: 4800, carteTotal: 'CT-4523', consoMoy: 13.1 },
                { immat: '78-C-1234', type: 'Utilitaire', marque: 'Renault Kangoo', affectation: 'Magasinier', kmActuel: 67300, kmProchVidange: 70000, kmRestant: 2700, carteTotal: 'CT-4524', consoMoy: 8.5 },
                { immat: '33-D-5678', type: 'Tracteur', marque: 'Massey Ferguson', affectation: 'Ferme Avocatier', kmActuel: 3200, kmProchVidange: 5000, kmRestant: 1800, carteTotal: null, consoMoy: 15.0 },
            ];

            // Finance data - CPC Campagne 2025-2026 Arrêté au 31/12/2025
            const cpcVarietes = [
                { code: 'AVOCAT', label: 'Avocat', ferme: 'Avocatier', ha: 30.7, caExport: 0, caLocal: 0, kgExport: 0, kgLocal: 0 },
                { code: 'S1S4_MAR_MD', label: 'S1/S4 Maravilla MD', ferme: 'F1', ha: 4.2, caExport: 0, caLocal: 105, kgExport: 0, kgLocal: 12 },
                { code: 'S3S7_MAR_MT', label: 'S3/S7 Maravilla MT', ferme: 'F1', ha: 5.2, caExport: 1277830, caLocal: 34383, kgExport: 19006, kgLocal: 2616 },
                { code: 'S2S5_YAZ_MD', label: 'S2/S5 Yazmin MD', ferme: 'F1', ha: 2.0, caExport: 436049, caLocal: 47658, kgExport: 6602, kgLocal: 2552 },
                { code: 'S10_YAZ_MT', label: 'S10 Yazmin MT', ferme: 'F5', ha: 1.9, caExport: 1314285, caLocal: 9365, kgExport: 19748, kgLocal: 682 },
                { code: 'S13_YAZ_MD', label: 'S13 Yazmin MD', ferme: 'F5', ha: 2.8, caExport: 772891, caLocal: 30505, kgExport: 11666, kgLocal: 1918 },
                { code: 'S9_REYNA', label: 'S9 Reyna', ferme: 'F5', ha: 3.0, caExport: 136555, caLocal: 2586, kgExport: 2430, kgLocal: 188 },
                { code: 'CORINA', label: 'Corina S8', ferme: 'F5', ha: 2.5, caExport: 0, caLocal: 17864, kgExport: 0, kgLocal: 233 },
                { code: 'CASCADE', label: 'Cascade S8-1', ferme: 'F1', ha: 1.5, caExport: 0, caLocal: 0, kgExport: 0, kgLocal: 0 },
                { code: 'BREEZE', label: 'Breeze S8-2', ferme: 'F1', ha: 1.0, caExport: 0, caLocal: 0, kgExport: 0, kgLocal: 0 },
            ];
            const totalHa = 54.8;
            const totalCAExport = 3937610;
            const totalCALocal = 142466;
            const totalCA = 4080076;
            const totalKgExport = 59451;

            // CPC charges par poste (réel arrêté au 31/12/2025)
            const cpcCharges = [
                { poste: 'Plants', total: 411026, icon: 'fa-seedling', color: 'var(--green)',
                  parMois: [{m:'Jul',v:0},{m:'Aoû',v:0},{m:'Sep',v:157632},{m:'Oct',v:0},{m:'Nov',v:53233},{m:'Déc',v:200161}],
                  detail: [{desc:'Maravilla TP 45cc (21 888 plants)', montant:157632},{desc:'Yazmin TP 45cc (22 640 plants)', montant:163052},{desc:'Reyna TP 45cc (27 796 plants)', montant:200162},{desc:'Cascade TP 45cc (414 plants)', montant:2982}],
                  fournisseur: "Driscoll's Du Maroc SARL", ferme: 'F1 + F5' },
                { poste: 'Loyer Terrains', total: 670750, icon: 'fa-land-mine-on', color: '#8B6914',
                  parMois: [{m:'Jul',v:55896},{m:'Aoû',v:55896},{m:'Sep',v:55896},{m:'Oct',v:55896},{m:'Nov',v:55896},{m:'Déc',v:55896},{m:'Jan',v:55896},{m:'Fév',v:55896},{m:'Mar',v:55896},{m:'Avr',v:55896},{m:'Mai',v:55896},{m:'Jui',v:55894}],
                  detail: [{desc:'Ferme 172 (F1) - 5.7 Ha', montant:399000},{desc:'Ferme 195 (F5) - 3.1 Ha', montant:216750},{desc:'Terrain Avocatier - 0.8 Ha', montant:55000}],
                  fournisseur: 'Propriétaires fonciers', ferme: 'Toutes' },
                { poste: 'Engrais', total: 773519, icon: 'fa-flask', color: '#27AE60',
                  parMois: [{m:'Jul',v:85000},{m:'Aoû',v:142000},{m:'Sep',v:168000},{m:'Oct',v:135000},{m:'Nov',v:128519},{m:'Déc',v:115000}],
                  detail: [{desc:'NPK 12-12-17 + 2MgO', montant:245000},{desc:'Sulfate de potassium', montant:178000},{desc:'Acide phosphorique', montant:125000},{desc:'Oligoéléments (Fer, Zinc, Bore)', montant:98519},{desc:'Calcium liquide', montant:72000},{desc:'Acides humiques', montant:55000}],
                  fournisseur: 'TIMAC AGRO / CHARAF', ferme: 'F1 + F5' },
                { poste: 'Pesticides', total: 456610, icon: 'fa-spray-can-sparkles', color: '#E67E22',
                  parMois: [{m:'Jul',v:52000},{m:'Aoû',v:78000},{m:'Sep',v:95000},{m:'Oct',v:89610},{m:'Nov',v:82000},{m:'Déc',v:60000}],
                  detail: [{desc:'Fongicides (Botrytis, Mildiou)', montant:185000},{desc:'Insecticides (Drosophila, Pucerons)', montant:142000},{desc:'Acaricides', montant:68610},{desc:'Produits biologiques', montant:61000}],
                  fournisseur: 'BASF / SYNGENTA / Koppert', ferme: 'F1 + F5' },
                { poste: 'Eau ORMVAL', total: 165000, icon: 'fa-droplet', color: '#3498DB',
                  parMois: [{m:'Jul',v:32000},{m:'Aoû',v:35000},{m:'Sep',v:30000},{m:'Oct',v:25000},{m:'Nov',v:22000},{m:'Déc',v:21000}],
                  detail: [{desc:'Redevance irrigation F1', montant:94000},{desc:'Redevance irrigation F5', montant:51000},{desc:'Redevance avocatier', montant:20000}],
                  fournisseur: 'ORMVAL Loukkos', ferme: 'Toutes' },
                { poste: 'Électricité', total: 110924, icon: 'fa-bolt', color: '#F1C40F',
                  parMois: [{m:'Jul',v:16500},{m:'Aoû',v:19800},{m:'Sep',v:21000},{m:'Oct',v:19624},{m:'Nov',v:18000},{m:'Déc',v:16000}],
                  detail: [{desc:'Pompage irrigation F1', montant:48000},{desc:'Pompage irrigation F5', montant:32000},{desc:'Station de conditionnement', montant:18924},{desc:'Chambres froides', montant:12000}],
                  fournisseur: 'AMENDIS', ferme: 'Toutes' },
                { poste: 'Gasoil & Gaz', total: 165902, icon: 'fa-gas-pump', color: '#95A5A6',
                  parMois: [{m:'Jul',v:22000},{m:'Aoû',v:25000},{m:'Sep',v:30000},{m:'Oct',v:32000},{m:'Nov',v:30902},{m:'Déc',v:26000}],
                  detail: [{desc:'Gasoil véhicules (4 cartes TOTAL)', montant:98000},{desc:'Gasoil tracteurs', montant:42000},{desc:'Gaz butane (réfectoire)', montant:15902},{desc:'Péages autoroute', montant:10000}],
                  fournisseur: 'TOTAL Energies / Afriquia', ferme: 'Toutes' },
                { poste: 'Autres Intrants', total: 163174, icon: 'fa-box', color: '#9B59B6',
                  parMois: [{m:'Jul',v:18000},{m:'Aoû',v:22000},{m:'Sep',v:35000},{m:'Oct',v:32174},{m:'Nov',v:30000},{m:'Déc',v:26000}],
                  detail: [{desc:'Substrat coco / perlite', montant:65000},{desc:'Film plastique tunnels', montant:42000},{desc:'Tuteurs et ficelles', montant:28174},{desc:'Matériel divers exploitation', montant:28000}],
                  fournisseur: 'Divers fournisseurs', ferme: 'F1 + F5' },
                { poste: 'M.O Récolte', total: 433244, icon: 'fa-people-carry-box', color: '#E74C3C',
                  parMois: [{m:'Jul',v:0},{m:'Aoû',v:0},{m:'Sep',v:45000},{m:'Oct',v:125000},{m:'Nov',v:148244},{m:'Déc',v:115000}],
                  detail: [{desc:'Récolteuses F1 (~35 ouvrières)', montant:285000},{desc:'Récolteuses F5 (~18 ouvrières)', montant:148244}],
                  fournisseur: 'Main d\'oeuvre saisonnière', ferme: 'F1 + F5' },
                { poste: 'M.O Hors Récolte', total: 2274124, icon: 'fa-users', color: '#C0392B',
                  parMois: [{m:'Jul',v:365000},{m:'Aoû',v:372000},{m:'Sep',v:385000},{m:'Oct',v:392000},{m:'Nov',v:388124},{m:'Déc',v:372000}],
                  detail: [{desc:'Ouvriers permanents F1 (28 pers)', montant:1120000},{desc:'Ouvriers permanents F5 (15 pers)', montant:600000},{desc:'Ouvriers avocatier (5 pers)', montant:200000},{desc:'Heures supplémentaires', montant:185124},{desc:'Primes et indemnités', montant:169000}],
                  fournisseur: 'Personnel permanent', ferme: 'Toutes' },
                { poste: 'Transport & Divers', total: 878684, icon: 'fa-truck', color: '#7F8C8D',
                  parMois: [{m:'Jul',v:95000},{m:'Aoû',v:110000},{m:'Sep',v:155000},{m:'Oct',v:185684},{m:'Nov',v:178000},{m:'Déc',v:155000}],
                  detail: [{desc:'Transport frigorifique Larache→Agadir', montant:425000},{desc:'Transport local (station)', montant:185000},{desc:'Frais douane et transit', montant:142684},{desc:'Fournitures bureau et consommables', montant:76000},{desc:'Entretien et réparations', montant:50000}],
                  fournisseur: 'Transporteurs / Transitaires', ferme: 'Toutes' },
                { poste: 'STC Ouvriers', total: 137764, icon: 'fa-money-check', color: '#2C3E50',
                  parMois: [{m:'Jul',v:0},{m:'Aoû',v:0},{m:'Sep',v:0},{m:'Oct',v:0},{m:'Nov',v:68882},{m:'Déc',v:68882}],
                  detail: [{desc:'STC fin de saison ouvriers F1', montant:82000},{desc:'STC fin de saison ouvriers F5', montant:42764},{desc:'STC avocatier', montant:13000}],
                  fournisseur: 'Provision sociale', ferme: 'Toutes' },
                { poste: 'Encadrement', total: 389387, icon: 'fa-user-tie', color: '#8E44AD',
                  parMois: [{m:'Jul',v:64898},{m:'Aoû',v:64898},{m:'Sep',v:64898},{m:'Oct',v:64898},{m:'Nov',v:64898},{m:'Déc',v:64898}],
                  detail: [{desc:'DG - Omar MAAOUNI', montant:0},{desc:'Chef F1 - Hamid AGOURAM', montant:96000},{desc:'Chef F5 - Ali BOUZID', montant:84000},{desc:'Resp. Qualité - FatimZahra', montant:78000},{desc:'Resp. Achats - Bouchra HABCHANE', montant:72000},{desc:'Magasinier', montant:59387}],
                  fournisseur: 'Cadres permanents', ferme: 'Toutes' },
                { poste: 'CNSS', total: 377489, icon: 'fa-shield-halved', color: '#16A085',
                  parMois: [{m:'Jul',v:58000},{m:'Aoû',v:59000},{m:'Sep',v:62000},{m:'Oct',v:68000},{m:'Nov',v:67489},{m:'Déc',v:63000}],
                  detail: [{desc:'Cotisations patronales (26.6%)', montant:285000},{desc:'Cotisations salariales (6.74%)', montant:72000},{desc:'AMO patronale', montant:20489}],
                  fournisseur: 'CNSS', ferme: 'Toutes' },
                { poste: 'IR', total: 46357, icon: 'fa-receipt', color: '#D35400',
                  parMois: [{m:'Jul',v:7726},{m:'Aoû',v:7726},{m:'Sep',v:7726},{m:'Oct',v:7726},{m:'Nov',v:7726},{m:'Déc',v:7726}],
                  detail: [{desc:'IR Cadres', montant:38000},{desc:'IR Ouvriers permanents', montant:8357}],
                  fournisseur: 'DGI', ferme: 'Toutes' },
                { poste: 'Frais Généraux', total: 561612, icon: 'fa-building', color: '#34495E',
                  parMois: [{m:'Jul',v:85000},{m:'Aoû',v:88000},{m:'Sep',v:95000},{m:'Oct',v:102000},{m:'Nov',v:98612},{m:'Déc',v:93000}],
                  detail: [{desc:'Honoraires comptable / juridique', montant:145000},{desc:'Assurances (AT, RC, Multirisque)', montant:125000},{desc:'Télécom et internet', montant:48000},{desc:'Fournitures et consommables', montant:82612},{desc:'Frais bancaires', montant:65000},{desc:'Location bureaux / stockage', montant:56000},{desc:'Divers et imprévus', montant:40000}],
                  fournisseur: 'Divers prestataires', ferme: 'Toutes' },
                { poste: 'Amortissement & Frais Financiers', total: 1669000, icon: 'fa-chart-line', color: '#5D6D7E',
                  parMois: [{m:'Jul',v:139083},{m:'Aoû',v:139083},{m:'Sep',v:139083},{m:'Oct',v:139083},{m:'Nov',v:139083},{m:'Déc',v:139083},{m:'Jan',v:139083},{m:'Fév',v:139083},{m:'Mar',v:139083},{m:'Avr',v:139083},{m:'Mai',v:139083},{m:'Jui',v:139087}],
                  detail: [
                    {desc:'AVOCAT - 30.7 Ha', montant:935005},
                    {desc:'S3/S7 Maravilla MT F1 - 5.2 Ha', montant:158372},
                    {desc:'S1/S4 Maravilla MD F1 - 4.2 Ha', montant:127916},
                    {desc:'S2/S5 Yazmin MD F1 - 2.0 Ha', montant:60912},
                    {desc:'Cascade S8-1 F1 - 1.5 Ha', montant:45684},
                    {desc:'Breeze S8-2 F1 - 1.0 Ha', montant:30456},
                    {desc:'S10 Yazmin MT F5 - 1.9 Ha', montant:57867},
                    {desc:'S13 Yazmin MD F5 - 2.8 Ha', montant:85277},
                    {desc:'S9 Reyna F5 - 3.0 Ha', montant:91368},
                    {desc:'Corina S8 F5 - 2.5 Ha', montant:76140},
                  ],
                  fournisseur: 'Banques / Comptabilité', ferme: 'Toutes' },
            ];
            const totalChargesGlobales = 9684565;
            const cfDea = 1669000;

            // EBE par variété Framboise
            const ebeParVariete = [
                { variete: 'S3/S7 Maravilla MT', ebe: -697497, ebeHa: -134134, pctCA: -55 },
                { variete: 'S2/S5 Yazmin MD', ebe: -78840, ebeHa: -39420, pctCA: -18 },
                { variete: 'S10 Yazmin MT', ebe: 342085, ebeHa: 180045, pctCA: 26 },
                { variete: 'S13 Yazmin MD', ebe: 181179, ebeHa: 64707, pctCA: 23 },
                { variete: 'S9 Reyna', ebe: -585601, ebeHa: -195200, pctCA: -429 },
            ];
            const ebeFramboise = -1423086;
            const resultatAvantImpot = -1671304;

            // Résultat par mois
            const resultatParMois = [
                { mois: 'Sep', resultat: -2966983 },
                { mois: 'Oct', resultat: -2213018 },
                { mois: 'Nov', resultat: -1498417 },
                { mois: 'Déc', resultat: -1671304 },
            ];

            // CA Detail par variété
            const caDetail = cpcVarietes.filter(v => v.caExport + v.caLocal > 0).map(v => ({
                variete: v.label,
                ferme: v.ferme,
                culture: v.code === 'AVOCAT' ? 'Avocat' : 'Framboise',
                kg: v.kgExport + v.kgLocal,
                ca: v.caExport + v.caLocal,
                prixMoyen: (v.kgExport + v.kgLocal) > 0 ? Math.round((v.caExport + v.caLocal) / (v.kgExport + v.kgLocal) * 100) / 100 : 0,
                ha: v.ha,
                caHa: Math.round((v.caExport + v.caLocal) / v.ha),
                pctCA: Math.round((v.caExport + v.caLocal) / totalCA * 100 * 10) / 10
            })).sort((a, b) => b.ca - a.ca);

            const cpcData = {
                campagne: '2025-2026 (Jul-Jun)',
                arrete: '31/12/2025',
                mois: ['Jul','Aoû','Sep','Oct','Nov','Déc'],
            };

            const carburant = null; // Loaded from API in FinCarburantTab

            const finStock = {
                stockTheorique: [
                    { categorie: 'Emballages', valeur: 850000, nbRefs: 6 },
                    { categorie: 'Fertilisants', valeur: 320000, nbRefs: 3 },
                    { categorie: 'Pesticides', valeur: 180000, nbRefs: 3 },
                    { categorie: 'Pièces détachées', valeur: 95000, nbRefs: 12 },
                ],
                derniereReconciliation: '28/02/2026',
                ecart: -12500,
                caisse: { solde: 45000, dernierMvt: '07/03/2026', respAchat: 'Achraf EL INAK' }
            };

            // Liquidations data (based on real Driscoll's data)
            const liquidations = {
                // Historical liquidations already received
                historique: [
                    { semaine: 'S36-2025', qteKg: 9, prixMoyen: 58.85, montantBrut: 529.67, prelevPlants: 0, prelevPret: 0, montantNet: 529.67, dateEncaissement: '06/10/2025', status: 'Encaissée' },
                    { semaine: 'S37-2025', qteKg: 336, prixMoyen: 68.23, montantBrut: 22926.38, prelevPlants: 0, prelevPret: 0, montantNet: 22926.38, dateEncaissement: '07/10/2025', status: 'Encaissée' },
                    { semaine: 'S38-2025', qteKg: 388.5, prixMoyen: 71.95, montantBrut: 27950.95, prelevPlants: 0, prelevPret: 0, montantNet: 27950.95, dateEncaissement: '16/10/2025', status: 'Encaissée' },
                    { semaine: 'S39-2025', qteKg: 1245, prixMoyen: 71.29, montantBrut: 88760.07, prelevPlants: 0, prelevPret: 0, montantNet: 88760.07, dateEncaissement: '24/10/2025', status: 'Encaissée' },
                    { semaine: 'S40-2025', qteKg: 1908, prixMoyen: 77.38, montantBrut: 147641.75, prelevPlants: 7999.24, prelevPret: 0, montantNet: 139642.51, dateEncaissement: '30/10/2025', status: 'Encaissée' },
                    { semaine: 'S41-2025', qteKg: 4581, prixMoyen: 68.98, montantBrut: 316004.48, prelevPlants: 19979.17, prelevPret: 32236.90, montantNet: 263788.41, dateEncaissement: '11/11/2025', status: 'Encaissée' },
                    { semaine: 'S42-2025', qteKg: 5952, prixMoyen: 60.21, montantBrut: 358379.35, prelevPlants: 24051.88, prelevPret: 41377.18, montantNet: 292950.29, dateEncaissement: '14/11/2025', status: 'Encaissée' },
                    { semaine: 'S43-2025', qteKg: 6492, prixMoyen: 57.60, montantBrut: 373923.94, prelevPlants: 24971.38, prelevPret: 44271.50, montantNet: 304681.06, dateEncaissement: '20/11/2025', status: 'Encaissée' },
                    { semaine: 'S44-2025', qteKg: 6364.5, prixMoyen: 60.55, montantBrut: 385361.42, prelevPlants: 23503.38, prelevPret: 35318.25, montantNet: 326539.79, dateEncaissement: '28/11/2025', status: 'Encaissée' },
                    { semaine: 'S45-2025', qteKg: 5416.5, prixMoyen: 70.13, montantBrut: 379843.11, prelevPlants: 22483.86, prelevPret: 27895.37, montantNet: 329463.88, dateEncaissement: '05/12/2025', status: 'Encaissée' },
                    { semaine: 'S46-2025', qteKg: 5410.5, prixMoyen: 79.00, montantBrut: 427456.35, prelevPlants: 25035.02, prelevPret: 21914.42, montantNet: 380506.91, dateEncaissement: '11/12/2025', status: 'Encaissée' },
                    { semaine: 'S47-2025', qteKg: 5823, prixMoyen: 71.32, montantBrut: 415278.32, prelevPlants: 27281.90, prelevPret: 16785.02, montantNet: 371211.40, dateEncaissement: '19/12/2025', status: 'Encaissée' },
                    { semaine: 'S48-2025', qteKg: 4863, prixMoyen: 69.87, montantBrut: 339786.65, prelevPlants: 19759.67, prelevPret: 13767.08, montantNet: 306259.90, dateEncaissement: '25/12/2025', status: 'Encaissée' },
                    { semaine: 'S49-2025', qteKg: 3958.5, prixMoyen: 65.05, montantBrut: 257512.85, prelevPlants: 16377.27, prelevPret: 11208.88, montantNet: 221179.16, dateEncaissement: '31/12/2025', status: 'Encaissée' },
                    { semaine: 'S50-2025', qteKg: 2649, prixMoyen: 63.33, montantBrut: 167754.84, prelevPlants: 9786.45, prelevPret: 10068.46, montantNet: 147899.93, dateEncaissement: '09/01/2026', status: 'Encaissée' },
                    { semaine: 'S51-2025', qteKg: 1491, prixMoyen: 57.73, montantBrut: 86077.28, prelevPlants: 5095.26, prelevPret: 12245.62, montantNet: 68736.40, dateEncaissement: '16/01/2026', status: 'Encaissée' },
                    { semaine: 'S52-2025', qteKg: 1551, prixMoyen: 54.37, montantBrut: 84326.89, prelevPlants: 5373.87, prelevPret: 13816.20, montantNet: 65136.82, dateEncaissement: '23/01/2026', status: 'Encaissée' },
                    { semaine: 'S53-2025', qteKg: 1003.5, prixMoyen: 49.61, montantBrut: 49785.66, prelevPlants: 2880.30, prelevPret: 16832.37, montantNet: 30072.99, dateEncaissement: '30/01/2026', status: 'Encaissée' },
                    { semaine: 'S01-2026', qteKg: 480, prixMoyen: 44.11, montantBrut: 21173.91, prelevPlants: 1377.72, prelevPret: 0, montantNet: 19796.19, dateEncaissement: '30/01/2026', status: 'Encaissée' },
                    { semaine: 'S02-2026', qteKg: 1581, prixMoyen: 41.59, montantBrut: 65749.14, prelevPlants: 4674.44, prelevPret: 12338.14, montantNet: 48736.56, dateEncaissement: '06/02/2026', status: 'Encaissée' },
                    { semaine: 'S03-2026', qteKg: 1846.4, prixMoyen: 54.55, montantBrut: 100724.63, prelevPlants: 0, prelevPret: 0, montantNet: 100724.63, dateEncaissement: '13/02/2026', status: 'Encaissée' },
                    { semaine: 'S04-2026', qteKg: 1989, prixMoyen: 59.98, montantBrut: 119292.06, prelevPlants: 0, prelevPret: 0, montantNet: 119292.06, dateEncaissement: '20/02/2026', status: 'Encaissée' },
                    { semaine: 'S05-2026', qteKg: 981, prixMoyen: 55.00, montantBrut: 53955, prelevPlants: 0, prelevPret: 0, montantNet: 53955, dateEncaissement: '20/02/2026', status: 'Encaissée' },
                    { semaine: 'S06-2026', qteKg: 597, prixMoyen: 55.00, montantBrut: 32835, prelevPlants: 0, prelevPret: 0, montantNet: 32835, dateEncaissement: '24/02/2026', status: 'Encaissée' },
                    { semaine: 'S07-2026', qteKg: 391.5, prixMoyen: 55.00, montantBrut: 21532.5, prelevPlants: 0, prelevPret: 0, montantNet: 21532.5, dateEncaissement: '26/02/2026', status: 'Encaissée' },
                ],
                // Future/pending liquidations (4-week delay from expedition)
                aVenir: [
                    { semaine: 'S08-2026', qteKg: 958.5, prixEstime: 55.00, montantEstime: 52717.5, dateEstimee: '06/03/2026', status: 'En attente' },
                    { semaine: 'S09-2026', qteKg: 355.5, prixEstime: 55.00, montantEstime: 19552.5, dateEstimee: '13/03/2026', status: 'En attente' },
                    { semaine: 'S10-2026', qteKg: 0, prixEstime: 55.00, montantEstime: 0, dateEstimee: '20/03/2026', status: 'Prévision' },
                    { semaine: 'S11-2026', qteKg: 0, prixEstime: 55.00, montantEstime: 0, dateEstimee: '27/03/2026', status: 'Prévision' },
                    { semaine: 'S12-2026', qteKg: 0, prixEstime: 55.00, montantEstime: 0, dateEstimee: '03/04/2026', status: 'Prévision' },
                ],
                // Deduction plans
                deductions: {
                    plants: {
                        designation: 'Plants Framboise',
                        totalFacture: 895583.44,
                        totalPreleve: 240630.81,
                        resteADeduire: 654952.63,
                        factures: [
                            { date: '12/05/2025', ref: 'INV17095087', montant: 157631.97, variete: 'Maravilla TP 45cc', qte: 21888, commande: 'SO17141415', packing: 'PS-000134240', echeance: '10/08/2025', livraison: '08/05/2025' },
                            { date: '12/05/2025', ref: 'INV17095087', montant: 163051.73, variete: 'Yazmin TP 45cc', qte: 22640, commande: 'SO17141415', packing: 'PS-000134240', echeance: '10/08/2025', livraison: '08/05/2025' },
                            { date: '12/05/2025', ref: 'INV17096027', montant: 242025.44, variete: 'Maravilla TP 45cc', qte: 33612, commande: 'SO17141417', packing: 'PS-000134242', echeance: '10/08/2025', livraison: '08/05/2025' },
                            { date: '12/05/2025', ref: 'INV17096027', montant: 1491.15, variete: 'Corina TP 45cc', qte: 207, commande: 'SO17141417', packing: 'PS-000134242', echeance: '10/08/2025', livraison: '08/05/2025' },
                            { date: '18/05/2025', ref: 'INV17096337', montant: 128239.07, variete: 'Yazmin TP 45cc', qte: 17804, commande: 'SO17141418', packing: 'PS-000134243', echeance: '16/08/2025', livraison: '14/05/2025' },
                            { date: '28/07/2025', ref: 'INV17098437', montant: 200161.78, variete: 'Reyna TP 45cc', qte: 27796, commande: 'SO17141421', packing: 'PS-000134246', echeance: '26/10/2025', livraison: '22/07/2025' },
                            { date: '25/08/2025', ref: 'INV17098619', montant: 2982.30, variete: 'Cascade TP 45cc', qte: 414, commande: 'SO17141422', packing: 'PS-000134247', echeance: '23/11/2025', livraison: '19/08/2025' },
                        ],
                        prelevements: [
                            { semaine: 'S40', montant: 7999.24 },
                            { semaine: 'S41', montant: 19979.17 },
                            { semaine: 'S42', montant: 24051.88 },
                            { semaine: 'S43', montant: 24971.38 },
                            { semaine: 'S44', montant: 23503.38 },
                            { semaine: 'S45', montant: 22483.86 },
                            { semaine: 'S46', montant: 25035.02 },
                            { semaine: 'S47', montant: 27281.90 },
                            { semaine: 'S48', montant: 19759.67 },
                            { semaine: 'S49', montant: 16377.27 },
                            { semaine: 'S50', montant: 9786.45 },
                            { semaine: 'S51', montant: 5095.26 },
                            { semaine: 'S52', montant: 5373.87 },
                            { semaine: 'S53', montant: 2880.30 },
                            { semaine: 'S01', montant: 1377.72 },
                            { semaine: 'S02', montant: 4674.44 },
                        ]
                    },
                    cropAdvance: {
                        designation: 'Prêt Driscoll\'s (Crop Advance)',
                        totalMontant: 1200000,
                        totalPreleve: 310075.42,
                        resteADeduire: 889924.58,
                        prelevements: [
                            { semaine: 'S41', montant: 32236.90 },
                            { semaine: 'S42', montant: 41377.18 },
                            { semaine: 'S43', montant: 44271.50 },
                            { semaine: 'S44', montant: 35318.25 },
                            { semaine: 'S45', montant: 27895.37 },
                            { semaine: 'S46', montant: 21914.42 },
                            { semaine: 'S47', montant: 16785.02 },
                            { semaine: 'S48', montant: 13767.08 },
                            { semaine: 'S49', montant: 11208.88 },
                            { semaine: 'S50', montant: 10068.46 },
                            { semaine: 'S51', montant: 12245.62 },
                            { semaine: 'S52', montant: 13816.20 },
                            { semaine: 'S53', montant: 16832.37 },
                            { semaine: 'S02', montant: 12338.14 },
                        ]
                    },
                    fruitAdvance: {
                        designation: 'Fruit Advance',
                        totalMontant: 0,
                        totalPreleve: 0,
                        resteADeduire: 0,
                        prelevements: []
                    }
                },
                // Planning deductions (planned vs real)
                planning: [
                    { semaine: 'S03', planPlants: 8874.32, planPret: 17235.94, reelPlants: null, reelPret: null },
                    { semaine: 'S04', planPlants: 12093.13, planPret: 19856.60, reelPlants: null, reelPret: null },
                    { semaine: 'S05', planPlants: 13895.12, planPret: 20889.35, reelPlants: null, reelPret: null },
                    { semaine: 'S06', planPlants: 13396.55, planPret: 16857.94, reelPlants: null, reelPret: null },
                    { semaine: 'S07', planPlants: 9992.96, planPret: 14863.06, reelPlants: null, reelPret: null },
                    { semaine: 'S08', planPlants: 7757.80, planPret: 17206.58, reelPlants: null, reelPret: null },
                    { semaine: 'S09', planPlants: 9069.86, planPret: 19470.07, reelPlants: null, reelPret: null },
                    { semaine: 'S10', planPlants: 11869.10, planPret: 20592.08, reelPlants: null, reelPret: null },
                ],
                // Totals
                totalKg: 68621.9,
                totalBrut: 4416832.20,
                totalNet: 3857378.45,
                totalEncaisse: 3779186.71,
                enCours: 78191.74
            };

            const normesProductivite = [
                { tache: 'Désherbage', normeTunnelsParJourParOuvrier: 4, unite: 'tunnels/jour/ouvrier' },
                { tache: 'Nettoyage', normeTunnelsParJourParOuvrier: 5, unite: 'tunnels/jour/ouvrier' },
                { tache: 'Aération', normeTunnelsParJourParOuvrier: 8, unite: 'tunnels/jour/ouvrier' },
                { tache: 'Désherbage à sape', normeTunnelsParJourParOuvrier: 3, unite: 'tunnels/jour/ouvrier' },
                { tache: 'Nivellement des pots', normeTunnelsParJourParOuvrier: 2, unite: 'tunnels/jour/ouvrier' },
                { tache: 'Nivellement des sol', normeTunnelsParJourParOuvrier: 3, unite: 'tunnels/jour/ouvrier' },
                { tache: 'Palissage', normeTunnelsParJourParOuvrier: 2, unite: 'tunnels/jour/ouvrier' },
                { tache: 'Feuille du sol', normeTunnelsParJourParOuvrier: 3, unite: 'tunnels/jour/ouvrier' },
                { tache: 'Palissage Pots', normeTunnelsParJourParOuvrier: 5, unite: 'tunnels/jour/ouvrier' },
                { tache: 'Ramassage Ficelle', normeTunnelsParJourParOuvrier: 6, unite: 'tunnels/jour/ouvrier' },
            ];

            const avocatierConfig = {
                F2: [{ id: 'AVO-F2', nom: 'F2', culture: 'Avocat', variete: 'Hass', nbLignes: 20 }],
                F3: [{ id: 'AVO-F3', nom: 'F3', culture: 'Avocat', variete: 'Hass', nbLignes: 25 }],
                F4: [{ id: 'AVO-F4', nom: 'F4', culture: 'Avocat', variete: 'Hass', nbLignes: 18 }],
                F5: [{ id: 'AVO-F5', nom: 'F5', culture: 'Avocat', variete: 'Hass', nbLignes: 22 }],
                F6: [{ id: 'AVO-F6', nom: 'F6', culture: 'Avocat', variete: 'Hass', nbLignes: 15 }],
                BAHIA: [{ id: 'AVO-BAHIA', nom: 'BAHIA', culture: 'Avocat', variete: 'Bacon', nbLignes: 30 }],
            };

            // Hors récolte suivi par tunnel (from handwritten doc - F5 01/03/2026)
            const horsRecolteParTunnel = {
                F5: [
                    { parcelle: 'Corina', variete: 'Corina', nbTunnels: 64, tache: 'Désherbage', nbOuvriers: 8, dejaRealise: 0, realiseAujourdhui: 27, totalRealise: 27, restant: 37, date: '01/03/2026' },
                    { parcelle: 'Corina', variete: 'Corina', nbTunnels: 64, tache: 'Nettoyage', nbOuvriers: 14, dejaRealise: 8, realiseAujourdhui: 42, totalRealise: 50, restant: 14, date: '01/03/2026' },
                    { parcelle: 'Corina', variete: 'Corina', nbTunnels: 64, tache: 'Aération', nbOuvriers: 4, dejaRealise: 0, realiseAujourdhui: 0, totalRealise: 0, restant: 64, date: '01/03/2026' },
                    { parcelle: 'Cascade', variete: 'Cascade', nbTunnels: 34, tache: 'Désherbage', nbOuvriers: 5, dejaRealise: 17, realiseAujourdhui: 17, totalRealise: 34, restant: 0, date: '01/03/2026' },
                    { parcelle: 'Cascade', variete: 'Cascade', nbTunnels: 34, tache: 'Nettoyage', nbOuvriers: 1, dejaRealise: 0, realiseAujourdhui: 3, totalRealise: 3, restant: 31, date: '01/03/2026' },
                    { parcelle: 'Breeze', variete: 'Breeze', nbTunnels: 16, tache: 'Aération', nbOuvriers: 2, dejaRealise: 0, realiseAujourdhui: 0, totalRealise: 0, restant: 16, date: '01/03/2026' },
                    { parcelle: 'Reina S9', variete: 'Reyna', nbTunnels: 66, tache: 'Désherbage à sape', nbOuvriers: 2, dejaRealise: 0, realiseAujourdhui: 0, totalRealise: 0, restant: 66, date: '01/03/2026' },
                    { parcelle: 'Reina S9', variete: 'Reyna', nbTunnels: 66, tache: 'Ramassage Ficelle', nbOuvriers: 8, dejaRealise: 0, realiseAujourdhui: 0, totalRealise: 0, restant: 66, date: '01/03/2026' },
                    { parcelle: 'Reina S9', variete: 'Reyna', nbTunnels: 66, tache: 'Aération', nbOuvriers: 4, dejaRealise: 0, realiseAujourdhui: 0, totalRealise: 0, restant: 66, date: '01/03/2026' },
                ],
                F1: [
                    { parcelle: 'Maravilla Green Cane', variete: 'Maravilla', nbTunnels: 72, tache: 'Palissage', nbOuvriers: 19, dejaRealise: 0, realiseAujourdhui: 6, totalRealise: 6, restant: 37, date: '01/03/2026' },
                    { parcelle: 'Yazmin Cut Back', variete: 'Yazmin', nbTunnels: 43, tache: 'Feuille du sol', nbOuvriers: 21, dejaRealise: 41, realiseAujourdhui: 20, totalRealise: 61, restant: 18, date: '01/03/2026' },
                    { parcelle: 'Yazmin Cut Back', variete: 'Yazmin', nbTunnels: 43, tache: 'Palissage Pots', nbOuvriers: 2, dejaRealise: 11, realiseAujourdhui: 20, totalRealise: 31, restant: 12, date: '01/03/2026' },
                ]
            };

            const meteoData = { fermes: meteoFermes };

            // ---- AGRONOMIE DATA — DONNÉES RÉELLES Make.com (BR_Consommation) au 09/03/2026 ----
            const agroRealParcelles = [
                { parcelle: "Avocat AVOCAT F6 AVOCAT", culture: "Avocat", ferme: "F6", sup: 10, N: 64.8, P2O5: 60.2, K2O: 18.3, CaO: 45.6, MgO: 17.8, engrais: 774.4, pest: 32 },
                { parcelle: "AVOCAT F5", culture: "Avocat", ferme: "F5", sup: 1, N: 9.1, P2O5: 7.0, K2O: 3.1, CaO: 5.5, MgO: 3.3, engrais: 77.7, pest: 0 },
                { parcelle: "BREEZE MYRTILLE S8-2", culture: "Myrtille", ferme: "S8", sup: 1, N: 60.7, P2O5: 104.0, K2O: 93.1, CaO: 3.0, MgO: 18.6, engrais: 775, pest: 30.4 },
                { parcelle: "CASCADE MYRTILLE S8-1", culture: "Myrtille", ferme: "S8", sup: 1.5, N: 79.8, P2O5: 123.9, K2O: 166.1, CaO: 5.1, MgO: 24.5, engrais: 1134.6, pest: 35.1 },
                { parcelle: "EL BAHIA", culture: "Autre", ferme: "Autre", sup: 1, N: 0, P2O5: 0, K2O: 0, CaO: 0, MgO: 0, engrais: 0, pest: 20 },
                { parcelle: "F2 - HAAS", culture: "Avocat", ferme: "F2", sup: 4.86, N: 78.5, P2O5: 29.6, K2O: 36.2, CaO: 64.4, MgO: 38.6, engrais: 1068.4, pest: 0 },
                { parcelle: "F3 -HAAS", culture: "Avocat", ferme: "F3", sup: 1, N: 69.1, P2O5: 41.6, K2O: 38.8, CaO: 51.6, MgO: 39.3, engrais: 921, pest: 0 },
                { parcelle: "F4 -HAAS", culture: "Avocat", ferme: "F4", sup: 4.64, N: 39.7, P2O5: 31.8, K2O: 32.0, CaO: 31.3, MgO: 11.4, engrais: 452.5, pest: 0 },
                { parcelle: "F5 CORINA", culture: "Myrtille", ferme: "F5", sup: 2.5, N: 142.1, P2O5: 95.4, K2O: 271.9, CaO: 72.5, MgO: 78.0, engrais: 1850, pest: 62.9 },
                { parcelle: "F6-HAAS", culture: "Avocat", ferme: "F6", sup: 9.13, N: 426.2, P2O5: 127.4, K2O: 39.4, CaO: 9300.9, MgO: 661.7, engrais: 33801.9, pest: 26 },
                { parcelle: "Parcelle avocat AVOCAT", culture: "Avocat", ferme: "Autre", sup: 25, N: 298.7, P2O5: 120.6, K2O: 181.8, CaO: 271.2, MgO: 145.4, engrais: 4512.3, pest: 30 },
                { parcelle: "S1.S4 Maravilla green can F1", culture: "Framboise Maravilla", ferme: "F1", sup: 4, N: 115.7, P2O5: 119.2, K2O: 117.3, CaO: 76.4, MgO: 20.9, engrais: 1475.2, pest: 11 },
                { parcelle: "S1/S4 Maravilla mow down F1", culture: "Framboise Maravilla", ferme: "F1", sup: 2.1, N: 171.4, P2O5: 216.6, K2O: 348.5, CaO: 93.1, MgO: 33.0, engrais: 2503.6, pest: 11.4 },
                { parcelle: "S10 - YAZMIN MOTTE F5", culture: "Framboise Yazmin", ferme: "F5", sup: 1.9, N: 182.8, P2O5: 255.7, K2O: 306.0, CaO: 87.1, MgO: 65.3, engrais: 2538, pest: 39.3 },
                { parcelle: "S10 YAZMIN cut back F5", culture: "Framboise Yazmin", ferme: "F5", sup: 1.9, N: 6.1, P2O5: 1.2, K2O: 9.3, CaO: 1.2, MgO: 1.2, engrais: 107.4, pest: 9.7 },
                { parcelle: "S13 - YAZMIN MOW DOWN F5", culture: "Framboise Yazmin", ferme: "F5", sup: 2.8, N: 141.1, P2O5: 181.8, K2O: 206.4, CaO: 55.7, MgO: 39.9, engrais: 2139.4, pest: 37.5 },
                { parcelle: "S2 -YAZMIN MOW DOWN F1", culture: "Framboise Yazmin", ferme: "F1", sup: 1.5, N: 153.1, P2O5: 168.4, K2O: 201.8, CaO: 79.3, MgO: 82.3, engrais: 2133.9, pest: 12.7 },
                { parcelle: "S2.S3.S5.S6.S7 maravilla logn can F1", culture: "Framboise Maravilla", ferme: "F1", sup: 5, N: 45.2, P2O5: 19.2, K2O: 13.6, CaO: 50.1, MgO: 6.2, engrais: 415.8, pest: 47.5 },
                { parcelle: "S3 - MARAVILLA MOTTE F1", culture: "Framboise Maravilla", ferme: "F1", sup: 0.6, N: 278.9, P2O5: 309.9, K2O: 558.7, CaO: 145.6, MgO: 139.5, engrais: 4103.3, pest: 34.5 },
                { parcelle: "S5 -YAZMIN MOW DOWN F1", culture: "Framboise Yazmin", ferme: "F1", sup: 1.3, N: 73.4, P2O5: 94.0, K2O: 111.4, CaO: 31.2, MgO: 44.2, engrais: 1054.6, pest: 5.5 },
                { parcelle: "S7 -MARAVILLA MOTTE F1", culture: "Framboise Maravilla", ferme: "F1", sup: 2, N: 155.6, P2O5: 214.3, K2O: 342.4, CaO: 56.5, MgO: 71.0, engrais: 2367, pest: 22.2 },
                { parcelle: "S9 - REYNA F5", culture: "Framboise Reyna", ferme: "F5", sup: 3, N: 175.8, P2O5: 167.8, K2O: 219.7, CaO: 81.3, MgO: 66.3, engrais: 2256.4, pest: 49.5 },
            ];
            const agroRealCultures = [
                { culture: "Avocat", sup: 55.63, N_Ha: 17.7, P_Ha: 7.5, K_Ha: 6.3, CaO_Ha: 175.6, MgO_Ha: 16.5, Ca_K: 27.95, Eng_Ha: 747.9, Pest_Ha: 1.6 },
                { culture: "Framboise Maravilla", sup: 13.7, N_Ha: 56.0, P_Ha: 64.2, K_Ha: 100.8, CaO_Ha: 30.8, MgO_Ha: 19.8, Ca_K: 0.31, Eng_Ha: 793.1, Pest_Ha: 9.2 },
                { culture: "Framboise Reyna", sup: 3, N_Ha: 58.6, P_Ha: 55.9, K_Ha: 73.2, CaO_Ha: 27.1, MgO_Ha: 22.1, Ca_K: 0.37, Eng_Ha: 752.1, Pest_Ha: 16.5 },
                { culture: "Framboise Yazmin", sup: 9.4, N_Ha: 59.2, P_Ha: 74.6, K_Ha: 88.8, CaO_Ha: 27.1, MgO_Ha: 24.8, Ca_K: 0.30, Eng_Ha: 848.2, Pest_Ha: 11.1 },
                { culture: "Myrtille", sup: 5.0, N_Ha: 56.5, P_Ha: 64.7, K_Ha: 106.2, CaO_Ha: 16.1, MgO_Ha: 24.2, Ca_K: 0.15, Eng_Ha: 751.9, Pest_Ha: 25.7 },
            ];
            const agroRealPesticides = [
                { article: "BARBARIAN", qty: 125.0, type: "Herbicide" },
                { article: "OPAL (L)", qty: 46.8, type: "Fongicide" },
                { article: "SWITCH", qty: 42.7, type: "Fongicide" },
                { article: "TOPAS", qty: 40.9, type: "Fongicide" },
                { article: "VERTIMEC", qty: 39.7, type: "Acaricide" },
                { article: "KALIGREEN", qty: 32.2, type: "Fongicide" },
                { article: "MILBEKNOCK", qty: 30.3, type: "Acaricide" },
                { article: "RADIANT 120 SC", qty: 27.3, type: "Insecticide" },
                { article: "KELPAK", qty: 26.5, type: "Biostimulant" },
                { article: "masamite", qty: 20.4, type: "Acaricide" },
                { article: "APOLLO 50 SC", qty: 18.8, type: "Acaricide" },
                { article: "SCORE", qty: 18.1, type: "Fongicide" },
                { article: "CARGO", qty: 15.0, type: "Fongicide" },
                { article: "ACRAMITE 480 SC", qty: 9.3, type: "Acaricide" },
                { article: "PRIORI TOP", qty: 8.2, type: "Fongicide" },
                { article: "ORTIVA", qty: 5.7, type: "Fongicide" },
                { article: "Movento", qty: 3.9, type: "Insecticide" },
                { article: "VERIMARK", qty: 1.6, type: "Insecticide" },
                { article: "UNIFORM", qty: 1.5, type: "Insecticide" },
                { article: "ALIETTE FLASH", qty: 1.0, type: "Fongicide" },
                { article: "DECIS EXPERT", qty: 0.5, type: "Insecticide" },
            ];
            const agroRealTopEngrais = [
                { article: "HUMOCAL", qty: 30700, type: "Amendement calcaire" },
                { article: "Nitrate de Calcium", qty: 5679, type: "Calcium + Azote" },
                { article: "Acide Phosphorique", qty: 4690, type: "Phosphore" },
                { article: "Nitrate de Potasse", qty: 4689, type: "Potassium + Azote" },
                { article: "Solupotasse", qty: 2922, type: "Potassium" },
                { article: "Acide Nitrique", qty: 2838, type: "Azote" },
                { article: "Sulfate de Magnesie", qty: 2063, type: "Magnésium" },
                { article: "Nitrate de Magnesie", qty: 1944, type: "Magnésium + Azote" },
                { article: "KSC III", qty: 1633, type: "Complexe NPK" },
                { article: "BIO ACTYL", qty: 1500, type: "Biostimulant" },
                { article: "Ammonitrate", qty: 1361, type: "Azote" },
                { article: "MAP", qty: 842, type: "N + Phosphore" },
            ];
            // ---- PROGRAMME FERTIGATION — Vrais produits commerciaux Berry Good ----
            // TOUS les produits = noms commerciaux tels que dans la base SQL BR_Consommation
            // isSimple: true = matière active de base (apparaît en vue matières actives)
            // isSimple: false = produit composé (décomposé en vue matières actives)
            // decomposition: pour les composés, donne la répartition en % de matières actives de base (clés = keys des produits simples)
            const fertigationProducts = [
                // ---- Matières actives de base (produits simples) ----
                // composition: NPK % issus du catalogue TIMAC / onglet Composition Fertilisants
                { name: "Ammonitrate", key: "ammonitrate", color: "#F5A623", unit: "Kg", isSimple: true, composition: { N:33.5, P:0, K:0, CaO:0, MgO:0 } },
                { name: "Nitrate de Calcium", key: "nitCa", color: "#43A047", unit: "Kg", isSimple: true, composition: { N:15.5, P:0, K:0, CaO:26, MgO:0 } },
                { name: "Nitrate de Potasse", key: "nitPot", color: "#1E88E5", unit: "Kg", isSimple: true, composition: { N:13, P:0, K:46, CaO:0, MgO:0 } },
                { name: "Nitrate de Magnesie", key: "nitMg", color: "#7E57C2", unit: "Kg", isSimple: true, composition: { N:11, P:0, K:0, CaO:0, MgO:16 } },
                { name: "Acide Phosphorique", key: "acPhos", color: "#E53935", unit: "L", isSimple: true, composition: { N:0, P:54, K:0, CaO:0, MgO:0 } },
                { name: "Acide Nitrique", key: "acNit", color: "#FB8C00", unit: "L", isSimple: true, composition: { N:13, P:0, K:0, CaO:0, MgO:0 } },
                { name: "Sulfate de Magnesie", key: "sulMg", color: "#26A69A", unit: "Kg", isSimple: true, composition: { N:0, P:0, K:0, CaO:0, MgO:16 } },
                { name: "MAP", key: "map", color: "#8D6E63", unit: "Kg", isSimple: true, composition: { N:12, P:61, K:0, CaO:0, MgO:0 } },
                { name: "Solupotasse", key: "solupotasse", color: "#5C6BC0", unit: "Kg", isSimple: true, composition: { N:0, P:0, K:50, CaO:0, MgO:0 } },
                // ---- Produits composés — compositions issues du catalogue TIMAC AGRO ----
                { name: "KSC III", key: "ksc3", color: "#D81B60", unit: "Kg", isSimple: false, composition: { N:15, P:5, K:35, CaO:0, MgO:0 } },
                { name: "HUMOCAL", key: "humocal", color: "#795548", unit: "Kg", isSimple: false, composition: { N:0, P:0, K:0, CaO:0, MgO:0 } },
                { name: "BIO ACTYL", key: "bioactyl", color: "#66BB6A", unit: "L", isSimple: false, composition: { N:3, P:0, K:5, CaO:0, MgO:0 } },
            ];
            // (computeNutrients et computeActiveView déplacés au niveau global)
            // ---- PROGRAMME FERTIGATION — Données vides (remplies par l'API Cloud Functions) ----
            // Le dashboard démarre avec des programmes vides par parcelle.
            // Le composant AgroIrrigationTab appelle /api/fertigation pour charger les vraies données SQL.
            // Mapping: l'API retourne des noms d'articles (ex: "Nitrate de Calcium", "KSC III")
            // qu'on mappe vers les keys de fertigationProducts via articleToKey
            const articleToKey = {};
            fertigationProducts.forEach(p => {
                articleToKey[p.name] = p.key;
                articleToKey[p.name.toUpperCase()] = p.key;
                articleToKey[p.name.toLowerCase()] = p.key;
            });
            // Aliases courants pour matcher les noms SQL
            articleToKey["Nitrate de Calcium"] = "nitCa";
            articleToKey["NITRATE DE CALCIUM"] = "nitCa";
            articleToKey["Nitrate de Potasse"] = "nitPot";
            articleToKey["NITRATE DE POTASSE"] = "nitPot";
            articleToKey["Nitrate de Magnesie"] = "nitMg";
            articleToKey["NITRATE DE MAGNESIE"] = "nitMg";
            articleToKey["Acide Phosphorique"] = "acPhos";
            articleToKey["ACIDE PHOSPHORIQUE"] = "acPhos";
            articleToKey["Acide Nitrique"] = "acNit";
            articleToKey["ACIDE NITRIQUE"] = "acNit";
            articleToKey["Sulfate de Magnesie"] = "sulMg";
            articleToKey["SULFATE DE MAGNESIE"] = "sulMg";
            articleToKey["Ammonitrate"] = "ammonitrate";
            articleToKey["AMMONITRATE"] = "ammonitrate";
            articleToKey["MAP"] = "map";
            articleToKey["Solupotasse"] = "solupotasse";
            articleToKey["SOLUPOTASSE"] = "solupotasse";
            articleToKey["KSC III"] = "ksc3";
            articleToKey["HUMOCAL"] = "humocal";
            articleToKey["BIO ACTYL"] = "bioactyl";

            // Programmes vides — seront peuplés par l'API
            const fertigationPrograms = {};
            agroRealParcelles.forEach(p => {
                fertigationPrograms[p.parcelle] = { culture: p.culture, ferme: p.ferme, weeks: {} };
            });
            const agroData = { parcelles: agroRealParcelles, cultures: agroRealCultures, pesticides: agroRealPesticides, topEngrais: agroRealTopEngrais, campagne: '2025/2026', dateExtraction: '09/03/2026', fertigationProducts, fertigationPrograms, articleToKey };

            // Transport config par équipe
            const transportConfig = [
                { prefix: 'MM', equipe: 'Boucharen', caporal: 'El Mghitni Moustapha', coutParOuvrier: 30 },
                { prefix: 'AY', equipe: 'Chelihat', caporal: 'Taiti Ayoub', coutParOuvrier: 30 },
                { prefix: 'HT', equipe: 'El Bachir', caporal: 'El Seghire Bachir', coutParOuvrier: 30 },
                { prefix: 'HA', equipe: 'El Hafi', caporal: 'El Hafi Mustapha', coutParOuvrier: 30 },
                { prefix: 'KR', equipe: 'Farid', caporal: 'El Koumiry Farid', coutParOuvrier: 35 },
                { prefix: 'NA', equipe: 'Larache', caporal: 'Larache Ayoube', coutParOuvrier: 30 },
                { prefix: 'JA', equipe: 'Ksr Femme', caporal: 'Belhadi Ahmed 2', coutParOuvrier: 30 },
                { prefix: 'AZ', equipe: 'Chahdi', caporal: 'Chahdi Bouslham', coutParOuvrier: 30 },
                { prefix: 'CC', equipe: 'Zeouada', caporal: 'Sekitoui Ahmed', coutParOuvrier: 25 },
                { prefix: 'CA', equipe: 'Ragragui', caporal: 'Ragragui Brahim', coutParOuvrier: 30 },
                { prefix: 'RE', equipe: 'Dechira', caporal: 'El Aydi Ayoub', coutParOuvrier: 30 },
                { prefix: 'NV', equipe: 'NV', caporal: 'El Aydi Ayoub', coutParOuvrier: 30 },
            ];

            // Helper : ordonne les libellés de quinzaine. Gère plusieurs formats :
            //   1) "DD/MM/YYYY - DD/MM/YYYY" ou "DD/MM/YYYY" → timestamp date début
            //   2) "Quinzaine NN" ou "QNN" / "QzN" → numéro de quinzaine (ordinal, pas date absolue)
            //   3) Fallback : premier nombre trouvé, sinon 0
            // L'unité de retour n'est PAS comparable entre formats — mais en pratique
            // toutes les quinzaines d'une même session viennent du même format API.
            const quinzaineOrder = (periodeStr) => {
                if (!periodeStr) return 0;
                const s = String(periodeStr);
                const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`).getTime();
                const n = s.match(/\d+/);
                return n ? parseInt(n[0], 10) : 0;
            };

            // Helper : récupère le coût transport effectif pour une équipe à une quinzaine donnée
            // history = [{ effectiveFrom: "DD/MM/YYYY - DD/MM/YYYY", coutParOuvrier, ... }]
            // Si periode non fourni → renvoie le tarif courant (le plus récent de l'historique, ou seed)
            const getCoutTransport = (prefix, periode) => {
                const team = transportConfig.find(t => t.prefix === prefix);
                if (!team) return 0;
                const hist = team.history || [];
                if (hist.length === 0) return team.coutParOuvrier || 0;
                const targetTs = periode ? quinzaineOrder(periode) : Number.MAX_SAFE_INTEGER;
                const sorted = [...hist]
                    .filter(h => quinzaineOrder(h.effectiveFrom) <= targetTs)
                    .sort((a, b) => quinzaineOrder(b.effectiveFrom) - quinzaineOrder(a.effectiveFrom));
                return sorted[0] ? sorted[0].coutParOuvrier : (team.coutParOuvrier || 0);
            };

            // Build variete → culture lookup from parcelleConfig
            const varieteCultureMap = {};
            Object.values(parcelleConfig).flat().forEach(p => {
                if (p.variete && p.culture) {
                    varieteCultureMap[p.variete.toLowerCase()] = p.culture;
                    varieteCultureMap[p.nom.toLowerCase()] = p.culture;
                }
            });
            const getCultureForVariete = (v) => {
                if (!v) return 'Framboise';
                const vl = v.toLowerCase().trim();
                // Direct match from parcelleConfig
                for (const [key, culture] of Object.entries(varieteCultureMap)) {
                    if (vl.includes(key) || key.includes(vl)) return culture;
                }
                return 'Framboise';
            };

            const result = { effectif, topOps, recolteData, recolteParJour, horsRecolteDetail, pointageJour, quinzaineData, weeklyTrend, parcellesMap, parcelleDetail, equipes, suiviModifs, qualiteInspections, blocIds, qualiteHistorique, qualiteBrix, pfqHistory, weeklyRanking, expeditions, stockEmballages, stockIntrants, parcAuto, cpcData, cpcVarietes, cpcCharges, totalHa, totalCA, totalCAExport, totalCALocal, totalKgExport, totalChargesGlobales, cfDea, ebeParVariete, ebeFramboise, resultatAvantImpot, resultatParMois, caDetail, carburant, finStock, liquidations, parcelleConfig, normesProductivite, horsRecolteParTunnel, ouvriersMatricule, primesConfig, meteoData, agroData, transportConfig, avocatierConfig, varieteCultureMap, getCultureForVariete, getCoutTransport, quinzaineOrder };

            if (isEmptyMockDataFlagActive()) {
                const emptied = {};
                Object.keys(result).forEach(k => { emptied[k] = emptyLike(result[k]); });
                return emptied;
            }
            return result;
        }

export { generateMockData };
