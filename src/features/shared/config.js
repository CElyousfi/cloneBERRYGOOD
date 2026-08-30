// @ts-check
/**
 * Extracted feature module
 * Compiled by Vite (src/) as ES modules.
 * // TODO: import from @shared when Step 5 runs
 */
        // ===================== CONFIGURATION =====================
        const PROFILES = [
            { id: 'rh', label: 'Resp. RH', name: 'Responsable RH', icon: 'fa-users-gear', fullName: 'Responsable RH' },
            { id: 'chef_f1', label: 'Chef Framboise', name: 'Hamid AGOURAM', icon: 'fa-seedling', farmLabel: 'Framboise', cultureFilter: 'Framboise', fullName: 'Hamid AGOURAM' },
            { id: 'chef_f5', label: 'Chef Myrtille', name: 'Bouchra HABCHANE', icon: 'fa-seedling', farmLabel: 'Myrtille', cultureFilter: 'Myrtille', fullName: 'Bouchra HABCHANE' },
            { id: 'chef_avo', label: 'Chef Avocatier', name: 'Azzeddine', icon: 'fa-tree', farm: 'Avocatier', fullName: 'Azzeddine' },
            { id: 'chef_bahia', label: 'Chef BAHIA', name: 'Chef BAHIA', icon: 'fa-tree', farm: 'BAHIA', fullName: 'Chef de ferme BAHIA' },
            { id: 'caporal_f1', label: 'Caporal F1', name: 'Caporal F1', icon: 'fa-hard-hat', farm: 'F1', fullName: 'Caporal F1' },
            { id: 'caporal_f5', label: 'Caporal F5', name: 'Caporal F5', icon: 'fa-hard-hat', farm: 'F5', fullName: 'Caporal F5' },
            { id: 'caporal_avo', label: 'Caporal Avo.', name: 'Caporal Avocatier', icon: 'fa-hard-hat', farm: 'Avocatier', fullName: 'Caporal Avocatier' },
            { id: 'achats', label: 'Achats', name: 'Achraf EL INAK', icon: 'fa-cart-shopping', fullName: 'Achraf EL INAK' },
            { id: 'qualite', label: 'Qualité F1', name: 'FatimZahra', icon: 'fa-clipboard-check', farm: 'F1', fullName: 'FatimZahra' },
            { id: 'magasinier', label: 'Magasinier', name: 'Resp. Magasin', icon: 'fa-warehouse', fullName: 'Resp. Magasin' },
            { id: 'finance', label: 'Finance', name: 'Resp. Finance', icon: 'fa-chart-pie', fullName: 'Resp. Finance' },
            { id: 'dg', label: 'DG', name: 'Direction Générale', icon: 'fa-building', fullName: 'Direction Générale' },
            { id: 'audit_interne', label: 'Audit Interne', name: 'Audit Interne', icon: 'fa-magnifying-glass-chart', fullName: 'Audit Interne' },
            { id: 'agronomie', label: 'Agronomie', name: 'Resp. Agronomie', icon: 'fa-seedling', fullName: 'Resp. Technique Agronomie' },
            { id: 'dt', label: 'Dir. Technique', name: 'Directeur Technique', icon: 'fa-helmet-safety', farm: 'F1', fullName: 'Directeur Technique', switchableFarms: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'Avocatier'] },
            { id: 'stationnaire_f1', label: 'Station. F1', name: 'Stationnaire F1', icon: 'fa-faucet-drip', farm: 'F1', fullName: 'Stationnaire Irrigation F1' },
            { id: 'stationnaire_f5', label: 'Station. F5', name: 'Stationnaire F5', icon: 'fa-faucet-drip', farm: 'F5', fullName: 'Stationnaire Irrigation F5' },
            { id: 'stationnaire_avo', label: 'Station. Avo.', name: 'Stationnaire Avocatier', icon: 'fa-faucet-drip', farm: 'F2', fullName: 'Stationnaire Irrigation Avocatier', switchableFarms: ['F2', 'F3', 'F4', 'F6', 'BAHIA'] },
            { id: 'securite', label: 'Sécurité', name: 'BSNL Sécurité', icon: 'fa-shield-halved', farm: 'F1', fullName: 'BSNL Sécurité', switchableFarms: ['F1', 'F5'] },
        ];

        // Profils accessibles dans le sélecteur de profil, selon le profil RÉEL de l'utilisateur.
        // - Audit Interne : accès à tous les profils SAUF le DG.
        // - Le chip "Audit Interne" n'est visible que pour l'admin et l'Audit Interne lui-même
        //   (le profil Finance n'a pas accès au tableau de bord Audit Interne).
        function getVisibleProfiles(userProfile) {
            return PROFILES.filter(p => {
                if (p.id === 'audit_interne') {
                    return userProfile.role === 'admin' || userProfile.profileId === 'audit_interne';
                }
                if (p.id === 'dg') {
                    return userProfile.profileId !== 'audit_interne';
                }
                return true;
            });
        }

        const FARMS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'Avocatier'];
        const AVO_SUB_FARMS = ['Toutes', 'F2', 'F3', 'F4', 'F6', 'BAHIA'];

        // Sociétés émettrices des Bons de Commande, indexées par ferme.
        // BAHIA est une entité juridique distincte de BERRY GOOD FARMS — son entête PDF est spécifique.
        // Toute ferme non listée → BDC_SOCIETE_DEFAULT (BERRY GOOD FARMS).
        // TODO: compléter les infos légales BAHIA (raison sociale exacte, capital, adresse, RC, ICE).
        const BDC_SOCIETE_DEFAULT = {
            nom: 'BERRY GOOD FARMS',
            forme: 'SARL au Capital de 100.000 DH',
            adresse: 'RES AL BOUSTANE 44 IMMEUBLE A — 80000 AGADIR',
            immat: 'RC 38125 — ICE 002106859000069',
            footer: 'Berry Good Farms SARL',
        };
        const BDC_SOCIETES = {
            BAHIA: {
                nom: 'BAHIA AGRICOLE',
                forme: 'SARL au Capital de 100.000 DH',
                adresse: 'LOT EL KÉBIR, DOUAR LAOUAMRAA — KSAR EL KBIR',
                immat: 'RC 449 KSAR EL KBIR — IF 4967185 — ICE 001454414000011',
                footer: 'BAHIA AGRICOLE SARL',
            },
        };
        const getBdcSociete = (ferme) => BDC_SOCIETES[ferme] || BDC_SOCIETE_DEFAULT;

        const FARM_NAMES = {
            'F1': 'Framboise Larache',
            'F2': 'Ferme 2',
            'F3': 'Ferme 3',
            'F4': 'Ferme 4',
            'F5': 'Myrtille/Framboise Laaouamra',
            'F6': 'Ferme 6',
            'BAHIA': 'Bahia',
            'Avocatier': 'Avocatier'
        };

        // Helper partagé : filtre par culture pour les profils chef-culture (ex. chef_f5=Myrtille).
        // Si cultureFilter est null/vide → passthrough (aucun filtre culture).
        // Fallback via variété si le champ Culture est absent de la ligne.
        function matchCulture(row, cf) {
            if (!cf) return true;
            // 1. Champ culture explicite (peuplé par le backend pour toutes les lignes transport/MO)
            var rawC = (row.culture || row.Culture || '').trim();
            if (rawC) return rawC.toLowerCase() === cf.toLowerCase();
            // 2. Variete directe (lignes Récolte — pas de champ culture côté recolte-equipes)
            var MYRTILLE_V = ['corina', 'breeze', 'cascade'];
            var FRAMBOISE_V = ['yazmin', 'maravilla', 'reyna', 'adelita'];
            var v = (row.variete || row.Variete || row.varieteLabel || '').toLowerCase();
            if (v) {
                if (cf === 'Myrtille') return MYRTILLE_V.some(function(n) { return v.includes(n); });
                if (cf === 'Framboise') return FRAMBOISE_V.some(function(n) { return v.includes(n); });
                return true;
            }
            // 3. Fallback : nom de variété dans la parcelle ou secteur (récolte sans variete explicite)
            var p = (row.parcelle || row.Parcelle_Culturale || '').toUpperCase();
            if (MYRTILLE_V.some(function(n) { return p.includes(n.toUpperCase()); })) return cf === 'Myrtille';
            if (FRAMBOISE_V.some(function(n) { return p.includes(n.toUpperCase()); })) return cf === 'Framboise';
            var sM = p.match(/\bS(\d{1,2})\b/);
            if (sM) {
                var sN = parseInt(sM[1], 10);
                if (sN === 8) return cf === 'Myrtille';
                if ([1,2,3,4,5,6,7,9,10,13].indexOf(sN) >= 0) return cf === 'Framboise';
            }
            return true;
        }

        function deriveSubFerme(refParcelle, parcelle) {
            const ref = (refParcelle || '').trim();
            if (/bahia/i.test(ref) || /bahia/i.test(parcelle || '')) return 'BAHIA';
            const m = ref.match(/^(F\d)/i);
            return m ? m[1].toUpperCase() : null;
        }
        // Consommé par public/components/AffectationAnalytiqueTable.jsx (hors scope d'app.jsx).
        window.deriveSubFerme = deriveSubFerme;

        // ===== RÉFÉRENTIEL PARCELLES SMART BERRY =====
        // window.SB_PARCELLE_REF = { 'LABEL BEE ONE UPPERCASE' : { nom_sb, ha, ... } } — valeurs user-saved
        // window.SB_PARCELLE_CAMPAGNE = { 'LABEL BEE ONE UPPERCASE' : sup (number) } — r.sup depuis campagne-list
        // Chargé une fois au démarrage. Mis à jour après chaque save. Voir aussi loadData() dans QuinzaineTab.
        function sbLoad() {
            fetch('/api/pointage-rh?action=sb-referentiel-list')
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    if (!d.success) return;
                    window.SB_PARCELLE_REF = {};
                    (d.parcelles || []).forEach(function(p) {
                        window.SB_PARCELLE_REF[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
                    });
                })
                .catch(function() {});
        }
        sbLoad();

        function sbParcelleHa(labelBeeOne) {
            const key = (labelBeeOne || '').toUpperCase().trim();
            const ref = window.SB_PARCELLE_REF && window.SB_PARCELLE_REF[key];
            if (ref && ref.ha > 0) return ref.ha;
            const campHa = window.SB_PARCELLE_CAMPAGNE && window.SB_PARCELLE_CAMPAGNE[key];
            if (campHa > 0) return campHa;
            return 0;
        }
        // Consommé par public/components/AffectationAnalytiqueTable.jsx (hors scope d'app.jsx).
        window.sbParcelleHa = sbParcelleHa;

        function sbParcelleNom(labelBeeOne) {
            const ref = window.SB_PARCELLE_REF && window.SB_PARCELLE_REF[(labelBeeOne || '').toUpperCase().trim()];
            return (ref && ref.nom_sb) ? ref.nom_sb : (labelBeeOne || '—');
        }
        // Consommé par public/components/CampagneAnalytiqueTab.jsx (hors scope d'app.jsx).
        window.sbParcelleNom = sbParcelleNom;

        // ===== IDENTITÉ OUVRIER — nom affichable =====
        // BEE ONE stocke l'identité COMPLÈTE dans `Nom` (« BELAIDI ISMAIL ») et
        // répète le prénom dans `Prenom` (« ISMAIL »). Concaténer les deux donne
        // « ISMAIL BELAIDI ISMAIL ». Le défaut est resté invisible tant que le
        // registre n'avait aucun prénom ; la synchronisation BEE ONE du
        // 2026-08-21 l'a rendu visible partout d'un coup.
        //
        // Règle : si le nom porte DÉJÀ le prénom (comparaison sur les mots, sans
        // casse ni accents), on rend le nom seul. Sinon on préfixe — certains
        // ouvriers ont un prénom d'état civil absent du nom (TAITI AYOUB /
        // LARBI), et le perdre serait pire que le répéter.
        function nomOuvrier(prenom, nom, secours) {
            const _mots = (s) => String(s || '')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
            const p = String(prenom || '').trim();
            const n = String(nom || '').trim();
            if (!p) return n || String(secours || '').trim();
            if (!n) return p;
            const motsNom = _mots(n);
            const dejaDedans = _mots(p).every(m => motsNom.indexOf(m) >= 0);
            return dejaDedans ? n : (p + ' ' + n);
        }
        // Consommé par les pop-ups Quinzaine et l'écran Paie (hors scope d'app.jsx).
        window.nomOuvrier = nomOuvrier;

        const NAV_ITEMS_RH = [
            { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high' },
            { id: 'quinzaine', label: 'Quinzaine', icon: 'fa-calendar-days' },
            { id: 'campagne', label: 'Campagne', icon: 'fa-chart-line' },
            { id: 'pointage', label: 'Pointage Quotidien', icon: 'fa-clock' },
            { id: 'validation_pointage', label: 'Validation du pointage', icon: 'fa-stamp' },
            { id: 'pointage_divers', label: 'Pointage Divers', icon: 'fa-truck' },
            { id: 'recolte', label: 'Récolte', icon: 'fa-basket-shopping' },
            { id: 'cout_recolte', label: 'Coût Récolte', icon: 'fa-calculator' },
            { id: 'qualite_inspections', label: 'Inspections', icon: 'fa-clipboard-check', chefOnly: true },
            { id: 'productivity_report', label: 'Productivity Driscoll\'s', icon: 'fa-chart-line', chefOnly: true },
            { id: 'hors_recolte', label: 'Hors Récolte', icon: 'fa-trowel' },
            { id: 'hors_recolte_suivi', label: 'Rendement Hors Récolte', icon: 'fa-chart-gantt' },
            { id: 'chef_suivi_caporal', label: 'Suivi Caporal', icon: 'fa-clipboard-list', chefOnly: true },
            { id: 'qualite_production', label: 'Production', icon: 'fa-industry' },
            { id: 'rh_equipes', label: 'Équipes', icon: 'fa-people-group', rhOnly: true },
            { id: 'primes', label: 'Primes', icon: 'fa-award', rhOnly: true },
            { id: 'chef_agronomie', label: 'Agronomie', icon: 'fa-seedling' },
            { id: 'paie', label: 'Paie', icon: 'fa-money-bill-wave', rhOnly: true },
            { id: 'primes_fixes', label: 'Primes Fixes', icon: 'fa-award', rhOnly: true },
            { id: 'parcelles_referentiel', label: 'Parcelles & Référentiel', icon: 'fa-map-location-dot', rhOnly: true },
            { id: 'parametres', label: 'Paramètres', icon: 'fa-sliders', rhOnly: true },
            { id: 'chef_production', label: 'Production', icon: 'fa-industry', chefOnly: true },
            { id: 'chef_tracking', label: 'Suivi Commandes', icon: 'fa-route', chefOnly: true },
            { id: 'chef_da', label: 'Demande d\'Achat', icon: 'fa-file-lines', chefOnly: true },
            { id: 'chef_validations', label: 'Validations BDC', icon: 'fa-check-circle', chefOnly: true },
            { id: 'mag_mouvements', label: 'Validations Stock', icon: 'fa-warehouse', chefOnly: true },
            { id: 'chef_validation_bons', label: 'Valid. Bons Apport', icon: 'fa-clipboard-check', chefOnly: true },
            { id: 'fin_budget', label: 'Budget vs Réel', icon: 'fa-chart-gantt', chefOnly: true },
            { id: 'suivi', label: 'Suivi Modifications', icon: 'fa-clipboard-list', rhOnly: true },
            { id: 'bug_reports', label: 'Bugs signalés', icon: 'fa-bug', rhOnly: true },
        ];

        const NAV_ITEMS_QUALITE = [
            { id: 'qualite_inspections', label: 'Inspections du Jour', icon: 'fa-clipboard-check' },
            { id: 'qualite_pfq_interne', label: 'PFQ Interne', icon: 'fa-clipboard-list' },
            { id: 'qualite_ecarts', label: 'Écarts & Défauts', icon: 'fa-triangle-exclamation' },
            { id: 'qualite_suivi_calibre', label: 'Suivi Calibre', icon: 'fa-ruler-combined' },
            { id: 'qualite_historique', label: 'Historique PFQ', icon: 'fa-chart-line' },
            { id: 'achats_rapprochement', label: 'Rapprochement', icon: 'fa-code-compare' },
            { id: 'caporal_suivi', label: 'Saisie Hors Récolte', icon: 'fa-clipboard-list' },
            { id: 'caporal_historique', label: 'Historique Hors Récolte', icon: 'fa-clock-rotate-left' },
        ];

        const NAV_ITEMS_MAGASINIER = [
            { id: 'mag_dashboard', label: 'Dashboard Stock', icon: 'fa-gauge-high' },
            { id: 'mag_bdc_liste', label: 'Bons de Commande', icon: 'fa-file-contract' },
            { id: 'mag_bdc_reception', label: 'BDC à réceptionner', icon: 'fa-clipboard-check' },
            { id: 'mag_reception', label: 'Bons de Réception', icon: 'fa-truck-ramp-box' },
            { id: 'mag_transfert', label: 'Transferts', icon: 'fa-right-left' },
            { id: 'mag_bc', label: 'Bons Consommation', icon: 'fa-flask' },
            { id: 'mag_sortie', label: 'Sorties de Stock', icon: 'fa-arrow-right-from-bracket' },
            { id: 'mag_stock_intrants', label: 'Soldes Stock', icon: 'fa-warehouse' },
            { id: 'mag_fiche_stock', label: 'Fiche de Stock', icon: 'fa-file-invoice' },
            { id: 'mag_inventaire', label: 'Inventaire', icon: 'fa-clipboard-list' },
            { id: 'mag_mouvements', label: 'Historique', icon: 'fa-clock-rotate-left' },
            { id: 'mag_mapping_conso', label: 'Mapping Parcelles Conso', icon: 'fa-link' },
            { id: 'mag_parcelles_params', label: 'Paramètres Parcelles', icon: 'fa-ruler-combined' },
            { id: 'mag_parc', label: 'Parc Automobile', icon: 'fa-car' },
            { id: 'mag_stock_files', label: 'Soumission Fichier Stock', icon: 'fa-file-arrow-up' },
        ];

        const NAV_ITEMS_CAPORAL = [
            { id: 'pointage', label: 'Pointage Quotidien', icon: 'fa-user-check' },
            { id: 'validation_pointage', label: 'Validation du pointage', icon: 'fa-stamp' },
            { id: 'caporal_suivi', label: 'Suivi du Jour', icon: 'fa-clipboard-list' },
            { id: 'caporal_historique', label: 'Historique Hors Récolte', icon: 'fa-clock-rotate-left' },
        ];

        const NAV_ITEMS_AGRO = [
            { id: 'agro_dashboard', label: 'Dashboard Agronomie', icon: 'fa-gauge-high' },
            { id: 'agro_fertilisation', label: 'Fertilisation NPK', icon: 'fa-flask' },
            { id: 'agro_phyto', label: 'Phytosanitaire', icon: 'fa-bug' },
            { id: 'agro_irrigation', label: 'Programme Fertigation', icon: 'fa-droplet' },
            { id: 'agro_composition', label: 'Composition Fertilisants', icon: 'fa-vials' },
            { id: 'agro_parcelles', label: 'Parcelles', icon: 'fa-map' },
            { id: 'agro_avancement', label: 'Avancement Culture', icon: 'fa-seedling' },
            { id: 'agro_growth', label: 'Suivi Croissance', icon: 'fa-ruler-vertical' },
            { id: 'agro_farmroad', label: 'FarmRoad', icon: 'fa-tower-broadcast' },
            { id: 'agro_forecast', label: 'Forecast Météo Intérieure', icon: 'fa-wand-magic-sparkles' },
            { id: 'agro_harvest', label: 'Prédiction Récolte', icon: 'fa-chart-line' },
            { id: 'qualite_production', label: 'Production', icon: 'fa-industry' },
        ];

        const NAV_ITEMS_FINANCE = [
            { id: 'dashboard', label: 'Dashboard Pointage', icon: 'fa-gauge-high', dgOnly: true },
            { id: 'pointage', label: 'Pointage Quotidien', icon: 'fa-clock', dgOnly: true },
            { id: 'validation_pointage', label: 'Validation du pointage', icon: 'fa-stamp', dgOnly: true },
            { id: 'recolte', label: 'Dashboard Récolte', icon: 'fa-basket-shopping', dgOnly: true },
            { id: 'cout_recolte', label: 'Coût Récolte', icon: 'fa-calculator' },
            { id: 'quinzaine', label: 'Dashboard Quinzaine', icon: 'fa-calendar-days', dgOnly: true },
            { id: 'fin_dashboard', label: 'CPC / Dashboard', icon: 'fa-chart-pie' },
            { id: 'fin_tresorerie', label: 'Trésorerie', icon: 'fa-vault' },
            { id: 'fin_ca', label: 'Chiffre d\'Affaires', icon: 'fa-coins' },
            { id: 'fin_carburant', label: 'Carburant', icon: 'fa-gas-pump' },
            { id: 'fin_plants', label: 'Plants', icon: 'fa-seedling', dgOnly: true },
            { id: 'fin_telecom', label: 'Maroc Télécom', icon: 'fa-phone' },
            { id: 'fin_ojra', label: 'OJRA (Paie)', icon: 'fa-file-invoice-dollar' },
            { id: 'fin_stock', label: 'Gestion de Stock', icon: 'fa-boxes-stacked' },
            { id: 'mag_bdc_reception', label: 'BDC à réceptionner', icon: 'fa-clipboard-check' },
            { id: 'mag_reception', label: 'Bons de Réception', icon: 'fa-truck-ramp-box' },
            { id: 'mag_inventaire', label: 'Inventaire', icon: 'fa-clipboard-list' },
            { id: 'fin_liquidations', label: 'Suivi Liquidations', icon: 'fa-file-invoice-dollar' },
            { id: 'productivity_report', label: 'Productivity Driscoll\'s', icon: 'fa-chart-line' },
            { id: 'qualite_liquidations', label: 'Liquidations Qualité', icon: 'fa-coins' },
            { id: 'qualite_reconciliation', label: 'Réconciliation', icon: 'fa-scale-balanced' },
            { id: 'fin_bdc', label: 'Suivi BDC', icon: 'fa-file-contract' },
            { id: 'fin_factures', label: 'Factures Fournisseurs', icon: 'fa-file-invoice' },
            { id: 'fin_paiements', label: 'Valid. Paiements', icon: 'fa-check-double' },
            { id: 'fin_virements', label: 'Virements', icon: 'fa-money-bill-transfer' },
            { id: 'fin_codes_analytiques', label: 'Codes Analytiques', icon: 'fa-tags' },
            { id: 'fin_delete_articles', label: 'Suppr. Articles', icon: 'fa-trash-can' },
            // Legacy « Marché Local / Situation Clients » (fin_marche_local) retiré du menu
            // (sous-lot 4.4). Remplacé par la vue compte-client read-only de la Gestion de
            // Caisse (CaisseComptesClientsSub). Composant FinanceMarcheLocalTab et statiques
            // conservés (no-delete) mais inatteignables.
            { id: 'dg_validations', label: 'Validations', icon: 'fa-check-double' },
            { id: 'qualite_production', label: 'Production', icon: 'fa-industry' },
            { id: 'fin_budget', label: 'Budget vs Réel', icon: 'fa-chart-gantt' },
            { id: 'caisse', label: 'Gestion de Caisse', icon: 'fa-cash-register' },
            { id: 'dg_adoption', label: 'Adoption', icon: 'fa-users-viewfinder' },
            { id: 'dg_tasks', label: 'Tâches', icon: 'fa-list-check' },
            { id: 'dg_cr_reunions', label: 'CR Réunions', icon: 'fa-file-pen' },
            { id: 'suivi_pointage', label: 'Suivi Pointage', icon: 'fa-clipboard-check' },
            { id: 'pointage_divers', label: 'Pointage Divers', icon: 'fa-truck' },
            { id: 'dqr_daily', label: 'DQR Journalier', icon: 'fa-clipboard-list' },
            { id: 'dg_signature', label: 'Signature & Cachet', icon: 'fa-stamp', dgOnly: true },
            { id: 'dg_parametres', label: 'Paramètres', icon: 'fa-gear', dgOnly: true },
            { id: 'bug_reports', label: 'Bugs signalés', icon: 'fa-bug', dgOnly: true },
        ];

        const NAV_ITEMS_DT = [
            { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high' },
            { id: 'quinzaine', label: 'Quinzaine', icon: 'fa-calendar-days' },
            { id: 'recolte', label: 'Récolte', icon: 'fa-basket-shopping' },
            { id: 'cout_recolte', label: 'Coût Récolte', icon: 'fa-calculator' },
            { id: 'qualite_production', label: 'Production', icon: 'fa-industry' },
            { id: 'qualite_inspections', label: 'Inspections', icon: 'fa-clipboard-check' },
            { id: 'hors_recolte', label: 'Hors Récolte', icon: 'fa-trowel' },
            { id: 'hors_recolte_suivi', label: 'Rendement Hors Récolte', icon: 'fa-chart-gantt' },
            { id: 'chef_agronomie', label: 'Agronomie', icon: 'fa-seedling' },
        ];

        const NAV_ITEMS_ACHATS = [
            { id: 'achats_dashboard', label: 'Dashboard Achats', icon: 'fa-gauge-high' },
            { id: 'achats_da', label: 'Demandes d\'Achat', icon: 'fa-file-pen' },
            { id: 'achats_consultation', label: 'Consultations', icon: 'fa-scale-balanced' },
            { id: 'achats_bdc', label: 'Bons de Commande', icon: 'fa-file-contract' },
            { id: 'achats_receptions_valoriser', label: 'Réceptions à valoriser', icon: 'fa-tags' },
            { id: 'achats_factures', label: 'Factures', icon: 'fa-file-invoice-dollar' },
            { id: 'achats_paiements', label: 'Paiements', icon: 'fa-credit-card' },
            { id: 'achats_fournisseurs', label: 'Fournisseurs', icon: 'fa-building' },
            { id: 'achats_catalogue', label: 'Catalogue Produits', icon: 'fa-boxes-stacked' },
            { id: 'achats_analyses_foliaires', label: 'Analyses Foliaires', icon: 'fa-flask-vial' },
            { id: 'achats_scan_factures', label: 'Scan Factures', icon: 'fa-file-import' },
            { id: 'achats_scan_bl', label: 'Scan BL', icon: 'fa-truck-ramp-box' },
            { id: 'achats_bon_apport', label: 'Bons d\'Apport', icon: 'fa-file-circle-plus' },
            { id: 'achats_rapprochement', label: 'Rapprochement', icon: 'fa-code-compare' },
            { id: 'qualite_expeditions', label: 'Expéditions', icon: 'fa-truck' },
            // Legacy « Marché Local / Situation Clients » (fin_marche_local) retiré du menu
            // (sous-lot 4.4). Remplacé par la vue compte-client read-only de la Gestion de
            // Caisse (CaisseComptesClientsSub). Composant et statiques conservés (no-delete).
            { id: 'qualite_production', label: 'Production', icon: 'fa-industry' },
            { id: 'achats_vente_plastique', label: 'Vente Plastique', icon: 'fa-recycle' },
            { id: 'mag_stock_intrants', label: 'Soldes Stock', icon: 'fa-warehouse' },
            { id: 'mag_inventaire', label: 'Inventaire', icon: 'fa-clipboard-list' },
            { id: 'mag_fiche_stock', label: 'Fiche de Stock', icon: 'fa-file-invoice' },
            { id: 'mag_bdc_reception', label: 'BDC à réceptionner', icon: 'fa-clipboard-check' },
            { id: 'mag_reception', label: 'Bons de Réception', icon: 'fa-truck-ramp-box' },
            { id: 'dqr_daily', label: 'DQR Journalier', icon: 'fa-clipboard-list' },
            { id: 'caisse', label: 'Gestion de Caisse', icon: 'fa-cash-register' },
        ];

        const NAV_ITEMS_CHEF_AVO = [
            { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high' },
            { id: 'quinzaine', label: 'Quinzaine', icon: 'fa-calendar-days' },
            { id: 'campagne', label: 'Campagne', icon: 'fa-chart-line' },
            { id: 'pointage', label: 'Pointage Quotidien', icon: 'fa-clock' },
            { id: 'validation_pointage', label: 'Validation du pointage', icon: 'fa-stamp' },
            { id: 'hors_recolte', label: 'Hors Récolte', icon: 'fa-trowel' },
            { id: 'chef_agronomie', label: 'Agronomie', icon: 'fa-seedling' },
            { id: 'chef_tracking', label: 'Suivi Commandes', icon: 'fa-route' },
            { id: 'chef_da', label: 'Demande d\'Achat', icon: 'fa-file-lines' },
            { id: 'chef_validations', label: 'Validations BDC', icon: 'fa-check-circle' },
            { id: 'mag_mouvements', label: 'Validations Stock', icon: 'fa-warehouse' },
            { id: 'chef_validation_bons', label: 'Valid. Bons Apport', icon: 'fa-clipboard-check' },
            { id: 'fin_budget', label: 'Budget vs Réel', icon: 'fa-chart-gantt' },
        ];

        // Chef de ferme BAHIA — accès restreint : DA + suivi, météo, pointage & quinzaine BAHIA (consultation).
        const NAV_ITEMS_CHEF_BAHIA = [
            { id: 'pointage', label: 'Pointage Quotidien', icon: 'fa-clock' },
            { id: 'validation_pointage', label: 'Validation du pointage', icon: 'fa-stamp' },
            { id: 'quinzaine', label: 'Quinzaine', icon: 'fa-calendar-days' },
            { id: 'station_meteo', label: 'Météo', icon: 'fa-cloud-sun' },
            { id: 'chef_da', label: 'Demande d\'Achat', icon: 'fa-file-lines' },
            { id: 'chef_tracking', label: 'Suivi Commandes', icon: 'fa-route' },
        ];

        const NAV_ITEMS_STATIONNAIRE = [
            { id: 'station_saisie', label: 'Saisie Irrigation', icon: 'fa-pen-to-square' },
            { id: 'station_scan', label: 'Scanner Fiche', icon: 'fa-camera' },
            { id: 'station_analyse', label: 'Analyse', icon: 'fa-chart-line' },
            { id: 'station_intelligence', label: 'Pilotage', icon: 'fa-brain' },
            { id: 'station_historique', label: 'Historique', icon: 'fa-clock-rotate-left' },
            { id: 'station_meteo', label: 'Météo', icon: 'fa-cloud-sun' },
        ];

        const NAV_ITEMS_SECURITE = [
            { id: 'sec_registre', label: 'Registre Entrées/Sorties', icon: 'fa-book' },
            { id: 'sec_scan', label: 'Scan Registre', icon: 'fa-file-image' },
            { id: 'sec_envois_wa', label: 'Registres WhatsApp', icon: 'fa-paper-plane' },
            { id: 'sec_incidents', label: 'Incidents', icon: 'fa-triangle-exclamation' },
            { id: 'sec_tunnels', label: 'Photos Tunnels', icon: 'fa-camera', f5Only: true },
        ];

        const NAV_ITEMS_OTHER = [
            { id: 'coming_soon', label: 'Tableau de bord', icon: 'fa-gauge-high' },
        ];

        const NAV_ITEMS_ASSOCIE = [
            { id: 'dashboard_associe', label: 'Dashboard', icon: 'fa-gauge-high' },
        ];


export {
  p,
  NAV_ITEMS_FINANCE,
  FARMS,
  ref,
  NAV_ITEMS_RH,
  FRAMBOISE_V,
  key,
  sM,
  v,
  m,
  _mots,
  dejaDedans,
  nomOuvrier,
  NAV_ITEMS_CHEF_AVO,
  NAV_ITEMS_OTHER,
  getVisibleProfiles,
  PROFILES,
  NAV_ITEMS_ACHATS,
  NAV_ITEMS_AGRO,
  NAV_ITEMS_SECURITE,
  NAV_ITEMS_QUALITE,
  n,
  NAV_ITEMS_ASSOCIE,
  sbParcelleHa,
  matchCulture,
  rawC,
  motsNom,
  NAV_ITEMS_STATIONNAIRE,
  BDC_SOCIETE_DEFAULT,
  sbLoad,
  sN,
  AVO_SUB_FARMS,
  campHa,
  MYRTILLE_V,
  FARM_NAMES,
  BDC_SOCIETES,
  NAV_ITEMS_MAGASINIER,
  NAV_ITEMS_CHEF_BAHIA,
  getBdcSociete,
  sbParcelleNom,
  NAV_ITEMS_CAPORAL,
  NAV_ITEMS_DT,
  deriveSubFerme
};
