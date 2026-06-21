# Backlog Smart Berry

Un item par bloc. L'architecte les traite dans l'ordre, de haut en bas.
Coche [x] quand APPROUVÉ. Repriorisé par Omar le 2026-06-08.

---

## [ ] BUG (non-gated) — Jour férié rattaché à la mauvaise quinzaine (frontière 15/16)
Signalé par le DG (2026-06-13). Prime Jour Férié : le 1er Moharram (2026-06-16)
apparaît dans la **Quinzaine 23 (1–15 juin)** alors qu'il appartient à la Q24 (16–30).
Cause : `pointageService.js` (~l.290-308) dérive la quinzaine du férié via
`dateToPeriode[date]` puis, si absente (férié futur sans pointage), via une recherche
« nearby » ±3 jours qui **traverse la frontière de quinzaine** et retombe sur des dates
Q23. Fix : rattacher le férié à la quinzaine qui le **contient au calendrier**
(jours 1–15 = 1re quinzaine du mois, 16–fin = 2e), jamais à une voisine. Un férié dont
la quinzaine n'a pas encore de données n'est crédité à personne (n'apparaît nulle part)
jusqu'à l'arrivée du pointage de cette quinzaine. Non-gated (deploy functions gated).

---

## [x] 2. URGENT — Bug menu « Historique Irrigation » dupliqué
Corrigé : `baseNavItems.push()` mutait une constante NAV_ITEMS partagée à chaque
re-render → ~12 doublons. Fix = copie fraîche (spread). QA APPROUVÉ, 224/224.
Rejoué sur main courant → **PR #69** (branche `fix/menu-irrigation-dup-v2`), build OK.
Preview : https://berrygood-farms-dashboard--menu-irrigation-v2-4toodw2d.web.app
✅ DÉPLOYÉ PROD 2026-06-08 (#69, merge 60b0732). Validé par Omar.
Gated : non (deploy gated).

## [ ] ITEM (PRIORITÉ HAUTE) — Workflow validation Pointage du jour par équipe
Priorité : haute

### Affichage par équipe (vue initiale — HEADER CLIQUABLE)
- Chaque équipe affichée comme un HEADER COLLAPSÉ par défaut :
  - Nom de l'équipe + nombre d'ouvriers + prime transport
  - Checkbox / badge de validation (✅ validé / ⬜ non validé)
- Au CLIC sur le header → expand/collapse la liste des ouvriers
- Les ouvriers ne sont PAS affichés par défaut — seulement au clic

### Détail équipe (expanded)
- Liste des ouvriers : matricule, nom, tâche, parcelle, heures
- Deux boutons à droite du header :
  - 🟢 "Valider le pointage de cette équipe"
  - 🔴 "Ne pas valider" (avec champ motif optionnel)
- Une fois validée → ✅ sur le header, boutons grisés

### Pointage Divers (sous les équipes)
- Section "Pointage Divers" SOUS les équipes (même onglet)
- Saisie des entrées diverses ici
- L'onglet "Pointage Divers" existant = historique (consultation)
- Bouton de validation pour le divers aussi

### Soumission globale
- Quand TOUTES les équipes + divers sont validés → bouton
  "Soumettre la validation du pointage du jour" actif
- Soumission → pointage figé (lecture seule, plus de modif)
- Workflow : validation RH → DG (à définir)

Gated : oui — valider le workflow de soumission et le circuit
de déverrouillage avant d'implémenter.

## [x] ITEM (PRIORITÉ HAUTE) — Formule Paie unifiée + fiche ouvrier enrichie
✅ LIVRÉ PROD (batch 3) — paieUtils.js + popup Pointage (app.jsx:6408) + breakdown Paie (#78).
Objectif : utiliser le modèle Paie complet (extraire `calculerPaieOuvrier`
app.jsx:22551 en helper pur réutilisable, ex. public/lib/paieUtils.js) partout
dans l'app, pas seulement dans l'onglet Paie.
État actuel : la popup ouvrier du Pointage (app.jsx:6308-6310) utilise une formule
SIMPLIFIÉE = `r.cout` (Cout brut BEE ONE) + prime récolte. N'utilise ni SMAG daté,
ni ancienneté, ni déclaré/non-déclaré, ni prime de fonction, ni CNSS, ni transport.

### 1. Unifier la formule
Partout où un coût ouvrier/jour est affiché (Pointage du jour, Coût Récolte,
Quinzaine, popup ouvrier), utiliser le helper Paie :
SMAG daté + ancienneté + déclaré/non-déclaré + prime de fonction + transport.
Remplacer les formules simplifiées existantes.

### 2. Fiche ouvrier enrichie (popup au clic)
Afficher le détail du calcul dans la popup ouvrier :
- Statut : 🟢 Déclaré / 🔴 Non déclaré
- SMAG de base : XX DH/jour
- Ancienneté : XX jours → palier X% → +XX DH
- Prime de fonction : XX DH/jour (si applicable)
- Prime transport : XX DH (équipe)
- CNSS : XX DH (charge patronale)
- **Total Salaire Brut Estimé : XXX DH**
Calcul transparent : chaque composante visible, pas juste le total.

### 3. Indicateur déclaré/non-déclaré
Badge visible (🟢/🔴 ou icône CNSS) sur chaque ligne ouvrier dans le Pointage
et dans la fiche popup.

Gated : non.

## [ ] ITEM — Propager le coût main d'œuvre unifié (paieUtils) partout
Objectif : après la popup Pointage, remplacer les formules simplifiées
par paieUtils (SMAG daté + ancienneté + déclaré + prime + transport)
dans : Coût Récolte, Quinzaine, Dashboard, et tout écran affichant
un coût ouvrier/jour.
Dépendance : après l'item "Formule Paie unifiée + fiche ouvrier" (✅ fait).
⚠️ Blast radius ÉLEVÉ : `r.cout` (brut BEE ONE) est sommé dans Quinzaine, Coût Récolte,
Dashboard, Pointage (~30 points). Repasser à computeWorkerPaie demande de replumber la
donnée par ouvrier-jour (declare, ancienneté, baremes, date, primeFonction, transport, HS)
dans chaque agrégation — non disponible par ligne aujourd'hui. + décision brut vs coût
employeur (charges patronales) par écran. → nécessite un mini-doc de design AVANT code.
Gated : non, mais à NE PAS lancer sans plan de design validé (risque sur tous les chiffres €).

## [x] ITEM — Fusionner Équipe BG et BGF (Pointage classement)
✅ LIVRÉ PROD (batch 3) — mapping BG→BGF dans la dérivation préfixe (app.jsx).
Pointage du jour : « Équipe BG » (1 ouvrier) et « BGF » (8) = même équipe affichée 2×.
Diagnostic : le classement (#76) dérive un préfixe 2 lettres via transportConfig ; les
matricules « BG… » → préfixe « BG » → fallback « Équipe BG », distinct du catch-all « BGF ».
Correction : fusionner en une seule équipe, nom survivant **BGF** (mapper « BG » → BGF dans
la dérivation). Vérifier cohérence onglet Équipes. Non-gated, screenshots clean avant deploy.

## [x] ITEM — Notifications : bouton « Tout ignorer » + tous profils
✅ LIVRÉ PROD (batch 3) — bouton « Tout ignorer » + localStorage notif_dismissed + tous profils.
Popup notifications (cloche). Non-gated.
### 1. Bouton « Tout ignorer »
3e bouton dans le popup (entre « Voir tout » et « Plus tard », ou remplace « Plus tard »).
Action : marque toutes les notifs affichées comme lues/dismissées pour cet user (badge → 0,
ne réapparaissent pas au prochain chargement). Stockage : flag `dismissed:true`/`readAt`
par notif (ou par user, ex. `notif_dismissals/{userId}`), filtré par userId. NE PAS supprimer
en base (traçabilité). Le badge cloche = uniquement les non-dismissées.
### 2. Notifications tous profils
Afficher pour TOUS les profils (RH, Chef F1/F5/Avo/BAHIA, Caporal, Achats, Qualité,
Magasinier, Finance, DG) — pas seulement Chef F1. Adapter le filtre : chaque profil voit
les notifs qui le concernent.
### UI
Style actuel (fond orange, icônes alertes). 3 boutons : « → Voir tout » | « Tout ignorer » |
« Plus tard ». « Tout ignorer » en secondaire/discret.
Gated : non (deploy preview autonome ; screenshots clean avant deploy prod).

## [ ] ITEM (PRIO HAUTE — 🔒 BLOQUÉ) — Nettoyage catalogue articles + validation import
🔒 BLOQUÉ : attend `Articles.txt` nettoyé dans le répertoire racine (fourni par Omar).
Tant qu'il n'est pas là → ne rien faire, passer aux autres items.

Contexte : catalogue ~198 articles avec doublons (RHIZO BOR/RHIO BORE, GREENTON/
GREEN TON, SULFATE D'AMMONIAQUE/SULFATE AMUNIUM) + fautes (NITRETE, SULFIRIQUE,
CALCUIM…). Articles.txt nettoyé = catalogue de référence.

### Phase 1 — Attendre le fichier (BLOQUÉ, attente Omar)
### Phase 2 — MAJ Firestore (prio HAUTE, dès réception du fichier)
1. Lire Articles.txt = référence. 2. Comparer aux articles Firestore (collection articles).
3. Rapport preview (ZÉRO write) : à RENOMMER (ancien→nouveau), à SUPPRIMER (doublons
   absorbés), bons impactés par chaque renommage/suppression (réception/sortie/commande :
   compter+lister), orphelins (Firestore mais absent du fichier). 4. Attendre GO Omar.
5. Exécuter : renommer, supprimer, propager dans les bons. Anti-TOCTOU (FieldValue.increment,
   pattern PR #59).
### Phase 3 — Validation articles à l'import CANEVA Excel (prio MOYENNE, feature)
Avant écriture : match exact catalogue → OK ; sinon fuzzy (Levenshtein/trigram) → suggestion
de mapping à confirmer ; aucun match → "Article inconnu" rouge, ligne bloquée. UI : écran de
réconciliation (colonne Excel | Match suggéré | Accepter/Corriger/Créer nouveau). Règle :
AUCUN nouvel article créé silencieusement par import — match existant ou création explicite.

Gated : oui (GO Omar avant exécution Phase 2 ; cadrage seuil fuzzy + UI Phase 3).

## [~] ITEM — Perf onglet Paie sur Safari/mobile (>120s de chargement)
🔄 PASS 1 LIVRÉ PROD 2026-06-09 (PR #83) — cache frontend `public/lib/paieDataCache.js`
(TTL 5min, IIFE) sur ouvriers_registry/import_meta/sql_mirror_pointage ; barèmes laissés en
live ; invalidation sur chaque écriture + Rafraîchir. Ouvertures répétées quasi-instantanées,
VALEURS inchangées (QA). Limite : cold-open WebKit toujours borderline ~120s (variance).
⏳ PASS 2 (backend, GATED) RESTANT : CF de pré-agrégation de l'ancienneté (jours pointés
distincts/matricule) pour éviter de rapatrier tout sql_mirror_pointage au cold-open. À cadrer.
Le tab Paie charge en >120s sur WebKit/Safari (détecté par la QA Playwright). Cause :
lectures Firestore lourdes côté CLIENT (`ouvriers_registry` complet + `sql_mirror_pointage`
plage + paie_baremes) à chaque ouverture. Pré-existant (#77/#78), pas une régression.
Pistes : déplacer le calcul d'ancienneté/registre côté Cloud Function (pré-agrégé),
paginer/limiter la période chargée par défaut, cache Firestore. Idem popup Paie du Pointage
(même source). Gated : non.

## [ ] ITEM (PRIO HAUTE — gated) — Vérification programme engrais (théorique vs réel)
Comparer fertilisation théorique (prescrite) vs consommation réelle, détecter écarts, alerter hebdo. 3 phases.
### Phase 1 — Comparaison via BEE ONE (gated)
/api/fertigation (SQL fertigation) déjà branché ; sous-onglet « Programme Ferti » affiche le théorique.
1. Lire programme théorique (engrais, doses kg/L/ha, parcelles, semaines).
2. Lire conso réelle BEE ONE (SQL fertigation : engrais consommés, qtés, parcelles, dates).
3. Tableau comparatif : Engrais|Parcelle|Semaine|Dose théo|Dose réelle|Écart% — couleurs vert<10%, orange 10-25%, rouge>25%.
4. Vue : nouveau sous-onglet Agronomie « Suivi Programme » (ou dans « Programme Ferti »).
⚠️ GATED : montrer à Omar le schéma des données BEE ONE fertigation (colonnes, grain) avant de coder.
### Phase 2 — Notifications hebdo (lundi)
Calcul écarts semaine N-1 → WhatsApp Chef de Ferme + DG (résumé écarts >25%) + alerte dans le panneau Notifications (celui amélioré avec « Tout ignorer »). Réutilise l'infra alerte 0-ligne pointage.
### Phase 3 — Migration vers bons Smart Berry (sprint futur)
Remplacer la source conso réelle BEE ONE par les bons de sortie/consommation Firestore (type sortie, catégorie engrais). Même logique/UI. Dépend du module stock mature + catalogue nettoyé (item en attente).
Gated : oui — schéma données BEE ONE à valider avant dev Phase 1.

## [ ] ITEM (PRIORITÉ HAUTE) — Notifications WhatsApp déploiement par profil
Objectif : après chaque deploy prod, envoyer un WhatsApp aux utilisateurs
concernés avec le résumé des nouveautés (ciblé par profil).
### Principe
- L'architecte rédige un message de release après chaque deploy.
- Envoi via l'API WhatsApp existante (whatsappAdmin / sendWhatsAppMessage).
- Ciblé : chaque user reçoit uniquement les nouveautés qui le concernent.
### Destinataires par profil
- Chef de ferme (F1/F5/Avo) → Pointage, Récolte, Agronomie
- Magasinier → Stock, Sorties, Réceptions
- Resp. Achats → Catalogue, BDC, Factures
- Resp. RH → Paie, Pointage, Équipes
- DG (Omar) → tout
### Template WhatsApp
Template Meta : "Bonjour {{1}}, Smart Berry a été mis à jour. Nouveautés : {{2}}"
Ou session 24h si le user a écrit récemment.
### Intégration pipeline
Ajouter une étape CLAUDE.md : après deploy prod + smoke Playwright →
l'architecte envoie les notifs WhatsApp aux profils concernés.
### Pré-requis
- Vérifier que l'API WhatsApp fonctionne (canal était en panne).
- Lister les numéros par profil.
- Soumettre le template Meta si nécessaire.
Gated : oui — valider numéros de téléphone + contenu du template avec Omar.

## [x] ITEM (PRIORITÉ HAUTE) — Tests E2E visuels automatisés (Playwright)
✅ LIVRÉ (#79) — tests/e2e-visual.js, Chromium+WebKit, 12 écrans, login QA via .env.
Objectif : après chaque deploy preview, le qa-reviewer lance une suite
Playwright qui :
1. Ouvre le preview dans un headless browser
2. Se connecte avec un compte de test dédié (credentials en .env)
3. Navigue sur les écrans clés : Pointage, Sorties Stock, Catalogue
   Achats, Récolte, Coût Récolte, Équipes
4. Vérifie : pas de crash React, éléments clés présents, pas de
   "AUTRE" parasite, pas de tableau vide
5. Prend des screenshots de chaque écran
6. Poste les screenshots dans la conversation pour validation visuelle
7. La suite DOIT tourner sur **Chromium ET WebKit (Safari)** — pas seulement
   Chromium. Les collisions de variables globales (libs public/lib non IIFE)
   crashent Safari/iOS au boot mais PAS Chrome (Chrome tolère et écrase
   silencieusement). Leçon du bug `calculerPaieOuvrier` du 2026-06-08 : le smoke
   Chromium était vert alors que l'app ne chargeait pas sur le téléphone d'Omar.
   → un crash de boot doit être détecté sur WebKit avant tout deploy.
Le qa-reviewer inclut ces screenshots dans son rapport. Omar valide
visuellement depuis le téléphone avant d'approuver le deploy prod.
Pré-requis : créer un compte Firebase Auth de test (profileId: test_qa,
rôle: dg pour accès à tous les écrans).
Gated : oui — valider les écrans à tester et le compte de test.

## [ ] ITEM (PRIORITÉ HAUTE) — Modularisation app.jsx puis migration build vers Vite

### Objectif
Découper progressivement le monolithe public/app.jsx (~3,6 MB) en modules
séparés, puis migrer le build vers Vite pour permettre le lazy loading réel.
Important : le build actuel (Babel → un seul app.js) permet l'extraction en
fichiers séparés mais pas le vrai code splitting avec chunks séparés.

### Phase 1 — Extraction des fichiers (build Babel actuel)
Extraire les 5 plus gros tabs dans public/components/ :
- MagSortieTab.jsx
- MagBCTab.jsx
- PaieTab.jsx
- PointageTab.jsx
- CoutRecolteTab.jsx
Règles : extraction à comportement identique, aucun refactor métier, imports
classiques compatibles Babel, validation visuelle après chaque extraction.
Bénéfices : moins de conflits Git, moins de doublons, meilleure lisibilité.

### Phase 2 — Migration du build vers Vite
Migrer le frontend vers Vite (ou Webpack si contrainte) : React.lazy(),
import() dynamique, chunks séparés, build optimisé.
À valider : structure dossiers, fichier d'entrée, compatibilité backend,
chemin de sortie, assets statiques, variables d'env, déploiement.

### Phase 3 — Code splitting réel par tab/module
React.lazy() + Suspense ; chaque tab protégé par un TabErrorBoundary
→ crash isolé par module, pas de page blanche globale.

### Phase 4 — Migration progressive des autres tabs
1 à 2 tabs par item backlog, progressivement.

### Phase 5 — Réduction finale de app.jsx
app.jsx ne contient que : routeur, layout, imports lazy, navigation,
wrappers Suspense, TabErrorBoundary, logique globale minimale.

Gated : oui — valider avec Omar avant de commencer : structure des dossiers,
stratégie Phase 1 sans changement de build, moment de migration Vite,
pattern TabErrorBoundary, convention de nommage, ordre des tabs à extraire.

## [x] ITEM — Signalement de bug in-app (photo + description)
✅ LIVRÉ PROD 2026-06-09 — Phase A (PR #81) bouton flottant 🐛 + popup (photo/description/contexte
auto) + CF submit-bug + Storage + WhatsApp DG ; Phase B (PR #82) vue admin « Bugs signalés »
(dg/rh) list-bugs/update-bug-status + statuts nouveau/en_cours/resolu. Composants séparés
(BugReportButton.jsx, BugReportsAdmin.jsx) + build-frontend.js étendu (pattern modularisation
Phase 1). Playwright 12/12 Chromium + 12/12 WebKit sur preview. QA approuvée 2 phases.
Objectif : permettre aux utilisateurs de signaler un bug directement
depuis l'application, sans quitter l'écran.

### UX
- Bouton flottant "🐛 Signaler un bug" accessible depuis n'importe
  quel écran (coin bas-droit, discret mais visible)
- Au clic : popup avec :
  - Upload photo / screenshot (depuis galerie ou caméra sur mobile)
  - Champ texte : description du problème
  - Pré-rempli automatiquement : profil utilisateur, écran en cours,
    date/heure, navigateur/device
  - Bouton "Envoyer"

### Backend
- Nouvelle collection Firestore : bug_reports
  - photo_url (stockée dans Firebase Storage)
  - description (texte libre)
  - reporter (userId, name, profileId)
  - screen (l'écran/onglet actif au moment du signalement)
  - device (user-agent, viewport)
  - created_at
  - status : nouveau / en_cours / résolu
- Notification WhatsApp à Omar quand un bug est signalé (photo +
  description + écran + qui a signalé)

### Vue admin (DG / Resp. RH)
- Onglet "Bugs signalés" dans Paramètres ou Dashboard
- Liste des signalements avec photo, description, statut
- Pouvoir marquer "en cours" / "résolu"

Gated : non.

## [x] ITEM — Renommer "Poste Fixe" en "Ouvrier Avocatier" (Pointage)
✅ LIVRÉ PROD (batch 3).
Objectif : dans le Pointage du jour et partout où la tâche "Poste Fixe"
apparaît, renommer en "Ouvrier Avocatier". C'est un renommage de label
uniquement (pas de changement de données).
Gated : non.

## [x] ITEM — Lien Primes (Quinzaine) → tableau Primes avec bonne quinzaine
✅ LIVRÉ PROD (batch 3) — onNavigateToPrimes.
Objectif : quand on clique sur "Primes" depuis l'onglet Quinzaine, ça
doit rediriger vers le tableau des Primes avec la quinzaine correspondante
pré-sélectionnée (pas la quinzaine par défaut). Passer la quinzaine en
paramètre de navigation.
Gated : non.

## [x] ITEM — Coût Récolte : graphe enrichi (variété + Kg/ha + nav temps) [inclut Volume Kg/ha]
✅ LIVRÉ PROD (batch 3) — filtre variété + overlay Kg/ha + nav 7/30/60/90j + fillCalendarGaps.
Onglet Coût Récolte, graphe « Historique DH/Kg » — 4 points (non-gated) :
1. **Filtre par VARIÉTÉ** (Maravilla LC, Maravilla MD, Yasmin, Corina, Cascade, Breeze)
   en plus du filtre par culture (Framboise/Myrtille). Voir le coût par variété.
2. **Courbe Volume Kg/ha superposée** (axe Y secondaire à droite) sur le graphe
   DH/Kg → corréler coût de récolte et stade de production (montée → pic → descente).
   = l'ancien item « Volume Kg/ha ».
3. **Navigation temps étendue** : remplacer 10j/30j par **7j / 30j / 60j / 90j**.
4. **Vérifier les données du graphe 30j** : jours manquants / incohérents — toutes
   les journées avec pointage doivent être représentées.
## [x] 3. Stock — Fusion doublons articles
LIVRÉ (PR #59, mergé main) : suggestion de doublons par nom + preview + audit.
Durcissement auth token ajouté (PR #64). Reste : deploy (gated).

## [x] 4. Stock — Auto-validation des bons SAUF réceptions
LIVRÉ (PR #60, mergé main) + durcissement auth rôle depuis le token Firebase.
Reste : deploy (gated).
Objectif : auto-valider tous les bons à la création, SAUF les bons de réception
(avec ou sans BDC) qui doivent être validés ET valorisés par le Responsable Achats
avant tout impact stock.
Règle :
- Sorties, transferts, autres mouvements → statut « validé » automatique à la création.
- Réceptions AVEC BDC → statut « en_attente » ; validation + valorisation par
  Resp Achats requise avant impact stock.
- Réceptions SANS BDC (réception libre) → idem : statut « en_attente », validation +
  valorisation Resp Achats requise.
Critères d'acceptation :
- Création d'une sortie/transfert/autre → impacte le stock immédiatement (validé).
- Création d'une réception (avec ou sans BDC) → n'impacte PAS le stock tant que le
  Resp Achats n'a pas validé + valorisé.
- Workflow de validation/valorisation réception réservé au rôle Resp Achats.
Gated : non.

## [x] 5. Stock — Modif/suppression bons + import Excel
- Parties 1&2 LIVRÉES (PR #61) : édition/suppression de bons par le créateur réel
  (uid token), jamais importés, seulement non validés ; soft-delete tracé ; auth token.
- Partie 3 (import Excel réceptions) = **réutiliser l'import CANEVA existant** (il
  importe déjà les réceptions avec écrasement par source). Réceptions importées →
  validé/impacté direct (prix Excel = source de vérité provisoire). Pas de nouveau code.
Reste : deploy functions (gated).

## Roadmap Stock — valorisation (ajoutée 2026-06-08)
### [ ] ÉTAPE 1 — Chaîne BDC → Bon de réception → Facture (prix exact)
Brancher la chaîne pour avoir le PRIX EXACT sur chaque réception (le BDC donne le
prix commandé, la facture le prix réel). Le CANEVA reste l'import temporaire en
attendant. S'appuie sur la valorisation Achats déjà livrée (item #4).
### [ ] ÉTAPE 2 — Stock en Coût Moyen Pondéré (CMP)
Une fois la chaîne BDC→réception→facture en place (prix réel), calculer le CMP par
article et valoriser le stock dessus. Item futur, après ÉTAPE 1.

## [x] 6. Stock — Articles manquants dans BC (Bon de Consommation)
LIVRÉ (PR #62). Datalist Bon de Consommation = catalogue complet (au lieu de stock>0)
+ ajout d'article inline (gated achats/dg). Reste : deploy (preview testable).

## [x] 7. Stock — Pré-remplir unité depuis catalogue
LIVRÉ (PR #62). Unité pré-remplie depuis le catalogue à la sélection d'un article
(BC + bonus BDC/DA). Reste : deploy (preview testable).

## [ ] 9. Refonte notifications WhatsApp BDC virement
À cadrer avec Omar (détails, critères d'acceptation).

## [ ] 10. Module Paie Partie 3
À cadrer avec Omar (détails, critères d'acceptation).

## [x] 11. Météo Hier (Agronomie)
LIVRÉ (PR #63, mergé main) : bloc « Hier » via Open-Meteo (past_days=1).
Reste : deploy (gated, frontend).
Plan existant : docs/plan-meteo-hier.md (sur branche docs/plan-meteo-hier,
pas encore mergée sur main).
Objectif : afficher les données météo de la veille dans l'onglet Agronomie.
Fetch on-demand Open-Meteo (past_days=1, gratuit, sans clé), helper
fetchOpenMeteoHourly + cache 30min, adaptation MeteoPrevisionExterieure pour
day === 'yesterday'. 1 seul fichier (~55 lignes dans app.jsx), zéro backend,
zéro Firestore.
Gated : non.

## [ ] 12. Campagne → CPC Sprint 1 (kg + intrants DH)
Plan existant : docs/plan-campagne-cpc-sprint1.md
Prérequis : socle « notion de campagne » (cf. section en attente plus bas).
Objectif : dénominateur kg (local + exporté depuis bons de production avec
TYPE CA), valorisation intrants DH, affectation "Non classifié".
Corrections à intégrer au plan : ECRT = écart/rebut pas local ; export depuis
bons de production pas liquidations ; réconciliation Engrais ≈ 773 519 /
Pesticides ≈ 456 610 DH.
Bug connu : ECRT→Marché Local dans le code (à corriger).
Note : `Pointage_ParcelleCulturale.id_campagne` existe nativement dans BEE ONE.
Gated : oui — question en suspens : comment distinguer LOCAL de ÉCART dans les
bons de production (par client local ? colonne TYPE CA ? codes EXP/ECRT/DÉC/ENC ?).
Demander à Omar avant d'implémenter.

## [ ] 13. Paie Espèces anti-fraude (Sprint 0 + Sprint 1)
Objectif : traçabilité paie espèces avec photo webcam + double validation
RH/Achats (PIN) + PV signé + anomalies (écart caisse, hash photos).
Workflow 5 étapes : ouverture quinzaine → paiement 4 yeux → clôture journée →
validation finance → espace audit.
Décisions validées : rôles RH+Achats, photo webcam visage, PV papier+scan,
quinzaine 1-15/16-fin, non réclamés report+alerte, collection paie_lignes
+ caisse paie_especes.
Gated : oui — 4 décisions en suspens :
1. Module pointages absent → Sprint 0 ou démarrer sur Excel ?
2. Webcam HS → blocage strict ou fallback documenté ?
3. pHash → bloquant ou alerting a posteriori ?
4. PIN RH → nb chiffres, rotation, stockage ?
Demander à Omar avant d'implémenter.

## [x] 14. Phenology fixes (dette Sprint 2)
LIVRÉ (PR #66, mergé main) : QA APPROUVÉ, 255 tests verts (+2 nouveaux). Reste :
deploy functions (gated). Note : git worktree prune (housekeeping) encore à faire.
Objectif : 3 corrections mineures post-Sprint 2 :
1. chore(bdc) clean undefined push dans stockManagement history
2. chore(phenology) add location field au schéma seedPilotPlots.js
3. fix(phenology) defensive check plot.location (dériver de station.location)
+ git worktree prune (housekeeping)
Gated : non.

## [ ] 15. Phenology Sprint 3 frontend
Objectif : sous-onglet "Phénologie" dans l'app avec KPIs + badge
FarmRoad/Open-Meteo. Cadrage à faire puis implémentation.
Note : capteurs FarmRoad offline depuis le 16/05, mode fallback Open-Meteo actif.
Vérifier statut capteurs avant de cadrer.
Gated : oui — cadrage à valider avec Omar.

---

## Dette / suivi technique (à prioriser plus tard)
- [x] `rebuildBalances` ne comptait pas les statuts → CORRIGÉ (PR #74, QA OK 2 tours,
  308 tests). Helper pur `isImpactApplied` : réception impactante seulement validée
  (valide_chef) ; sortie/transfert/consommation impactants en valide_chef ET valide_mag
  (import CANEVA) ; rejete/deleted exclus. Prêt pour le déploiement groupé `functions`.
- Durcissement auth stock : le rôle (`achats`/`chef`) vient du body client sur les
  actions stock impactantes (#3 fusion, #4 validation réception). Pattern repo actuel.
  Option : dériver le rôle du token Firebase. Décision Omar.

## En attente de ta validation / terminés (hors file active)

### [x] Validation automatique des fournisseurs (Achats)
LIVRÉ PROD (PR #55). Workflow manuel retiré, validation auto si 6 champs valides.

### [🔄] Mapping transport → Coût Récolte / Paie (référentiel + BGF prime 0)
Preview prêt (PR #56, branche feat/transport-cout-propagation). Inclut : module
transportUtils + tests, fix crash __api, numérique→BGF écran Équipes, bannière RH
+ cloche backend (gated deploy) pour équipes non configurées. Attente validation +
merge + deploy prod.

### [ ] Test réel RH transport (manuel — action Omar)
Vérifier sur un vrai compte RH : 0→X déclenche WhatsApp DG, popup ouvriers,
effectifs cohérents. Checklist : docs/checklist-item3-test-rh-transport.md.

### [ ] Socle « notion de campagne » (prérequis de l'item 11)
Module pur campaignUtils (campagne = 1er juil → 30 juin), sélecteur global dans
les menus, filtrage par plage de dates (zéro migration). Sous-sujet différé :
coûts de plantation inter-campagnes. Gated : design à valider avec Omar.

## [x] ITEM — Lieu destination en dropdown contextuel (Sortie)
LIVRÉ (PR #72) : QA APPROUVÉ, 255 tests, build OK. Frontend-only MagSortieTab :
retour_fournisseur→dropdown fournisseurs, prêt→dropdown magasins/stations,
rebut→champ libre+motif. Reset à la bascule de type.
Preview : https://berrygood-farms-dashboard--sortie-destination-tleokiji.web.app
✅ DÉPLOYÉ PROD 2026-06-08 (#72, hosting).
Objectif : pour « Retour fournisseur », le lieu de destination = dropdown des
fournisseurs. Pour « Transfert »(=Prêt), dropdown des magasins/fermes. Champ libre
seulement pour « Autre/Décharge »(=Rebut).
Gated : non (deploy gated).

## [x] ITEM — Contrôle stock avant sortie (StockMovementGuard)
LIVRÉ (PR #70) : QA APPROUVÉ, 268 tests verts, build OK. Helper pur
`functions/lib/stock/stockGuard.js` + glue backend `create-movement` + UX frontend
(MagSortieTab/MagTransfertTab). Sortie/transfert bloqués si stock insuffisant ;
réception + consommation exemptées.
✅ DÉPLOYÉ PROD 2026-06-08 (functions:stockManagement). Garde actif.
❓ Suivi : inclure la consommation (BC déplète aussi le stock) ? helper déjà
configurable via `guardedTypes`.
Objectif : bloquer la création d'une sortie si le stock disponible de l'article
au lieu de départ est insuffisant (stock < quantité demandée). Message clair :
« Stock insuffisant : X disponible, Y demandé ». Même règle pour les transferts.
Exception : les réceptions ne sont pas concernées (entrée, pas sortie).
Gated : non (deploy functions gated).

## [x] ITEM — Suivi croissance framboise (points de contrôle)
LIVRÉ (PR #71) : QA APPROUVÉ, 279 tests (24 nouveaux), build OK. Onglet Agronomie
« Suivi Croissance » : parcelles = source pointage (PARCELLES_CULTURALES framboise),
points de contrôle configurables/parcelle, graphe multi-courbes, saisie réservée
profil `agronomie` (rôle token), consultation ouverte. Collections growth_measurements
+ growth_plot_config (write CF only). Helper pur public/lib/growthUtils.js.
Preview (affichage seul) : https://berrygood-farms-dashboard--croissance-framboise-iifjmvop.web.app
✅ DÉPLOYÉ PROD 2026-06-08 (functions:growthTracking + rules + hosting).
Objectif : système de suivi de la croissance des cannes de framboise,
similaire à l'ancien système FarmRoad.
Saisie :
- 4 à 5 points de contrôle physiques par parcelle (emplacements fixes)
- À chaque relevé : date + point de contrôle + longueur de canne (cm)
- Saisie depuis l'app (mobile-friendly, terrain)
Affichage :
- Graphe d'évolution : longueur (cm) en Y, date en X
- Une courbe par point de contrôle (ou moyenne parcelle)
- Filtres : par parcelle, par variété (Maravilla / Yasmin)
Données : nouvelle collection Firestore (ex. growth_measurements) avec
plotId, checkpointId, date, length_cm, createdBy.
Gated : non.


## [ ] ITEM (PRIORITÉ HAUTE) — Sécurisation du pointage validé (verrouillage post-validation)
Objectif : une fois le pointage d'une journée VALIDÉ (RH puis chef de ferme,
cf. workflow validation par équipe), figer définitivement les données de cette
journée. Le nombre d'ouvriers et toute donnée relative au pointage du jour validé
ne doivent PLUS changer, quelle que soit la source :
- Si BEE ONE (BR_Pointage) renvoie une info différente pour un jour déjà validé,
  le sync NE DOIT PAS écraser les données validées (cf. mécanisme `manualOverride`
  existant dans sqlSyncService — à étendre en `locked`/`validated`).
- Aucune modification manuelle du RH n'est possible après validation.

Seul le **Directeur Général (DG)** peut effectuer une modification manuelle après
le verrouillage (override autorisé DG uniquement, tracé dans l'historique).

À cadrer :
- État de verrouillage par jour×ferme (ex. `pointage_validation/{date}_{ferme}.locked`)
  posé au moment de la double validation RH + chef de ferme.
- Le sync (sqlToFirestoreSync / sqlSyncTrigger) respecte ce verrou : merge/skip
  des jours verrouillés au lieu d'écraser (comme `manualOverride` aujourd'hui).
- UI : griser/bloquer l'édition RH sur un jour verrouillé ; bouton override visible
  uniquement pour le profil DG, avec saisie d'un motif + trace `history[]`.
- Définir précisément le périmètre « données du pointage » figées (nb ouvriers,
  heures, primes transport, divers, etc.).

Gated : oui — valider le périmètre exact des données figées + le circuit d'override DG
avant implémentation.

## [ ] ITEM (PRIORITÉ HAUTE) — Validation des heures supplémentaires à J+1
Objectif : valider les heures supplémentaires (HS) de la veille au moment de
valider le pointage du jour. Autrement dit, la validation du pointage du jour J
valide les HS de J-1 (validation HS à J+1).

Flexibilité RH (le but = pointer facilement les HS des ouvriers) :
- Pouvoir choisir de **NE PAS appliquer les HS** — au niveau **équipe** OU au niveau
  **ouvrier** (exclusion sélective).
- Pouvoir **spécifier en BULK une heure d'entrée ou de sortie manquante** pour les
  ouvriers dont le pointage entrée/sortie est incomplet (saisie groupée plutôt
  qu'un par un).

Lien : s'appuie sur le module **Heures Supplémentaires** existant (HS calculées
depuis le pointage entrée/sortie BEE ONE `prod_presence`, seuil 8h30, exclut
récolte + gardiens) et s'intègre au **workflow de validation du pointage par équipe**.

À cadrer :
- Où s'insère la validation HS de J-1 dans l'écran de validation du jour J.
- Stockage de l'état « HS validées / exclues » par jour×équipe×ouvrier.
- UI de saisie bulk des entrées/sorties manquantes (sélection multiple + heure
  appliquée à tous).
- Articulation avec la sécurisation du pointage validé (item ci-dessus) : une fois
  les HS validées, mêmes règles de verrouillage.

Gated : oui — workflow de validation HS + UI bulk à valider avec Omar avant dev.

## [ ] ITEM (PRIORITÉ HAUTE) — Validation de la quinzaine (assistant multi-écrans)
Objectif : un parcours de validation de la quinzaine en plusieurs écrans, chaque
partie étant validée avant d'arriver à la soumission finale aux chefs de ferme.

Écrans (navigation séquentielle, validation à chaque étape) :
1. **Récap jours pointés** : tableau des jours pointés **par équipe × par jour**.
   Au clic sur un jour → afficher les **ouvriers** de ce jour.
2. **Détail calcul main-d'œuvre** : séparer selon le statut de l'ouvrier —
   **SMAG net** (non déclaré) vs **SMAG brut** (déclaré). (Réutilise le modèle
   `computePayslip` unifié.)
3. **Ancienneté + Prime Fixe (prime de fonction)** : afficher et **valider**.
4. **Primes de récolte** : afficher et **valider**.
5. **Heures supplémentaires** : afficher et **valider** (cf. item validation HS J+1).

Principe :
- Navigation **écran par écran** avant la **validation finale pour soumission aux
  chefs de ferme**.
- **Chacun valide sa partie** (rôles à définir : RH par étape, puis chef de ferme
  en validation finale ; circuit exact à cadrer).

À cadrer (gated) :
- Découpage des rôles/validations par écran (qui valide quoi).
- État de validation par étape × quinzaine (stockage + verrouillage progressif).
- Articulation avec : sécurisation du pointage validé, validation HS J+1, et le
  modèle de paie unifié (popup / PaieTab).

Gated : oui — circuit de validation par étape + rôles à valider avec Omar avant dev.

---

## ITEM (idée DG, à cadrer) — QR stock : étiquettes + scan inventaire/sortie

Étiqueter les produits du stock avec un **QR code** (encodant le code article,
voire un id lot/emplacement) pour accélérer et fiabiliser :
1. **Inventaire physique** : scan article → pré-remplit la ligne de comptage.
2. **Bon de sortie / consommation** : scan article(s) → construit le bon
   (article + qté + parcelle/destination), validé via le flux existant
   (`create-movement`, garde `lib/stock/movementGuard`).

Faisabilité élevée — l'infra existe :
- Capture caméra déjà en place (`scan-bon-apport` / `scan-facture` / `scan-bl`).
  Manque : **décodage QR** (lib CDN type `html5-qrcode`/`jsQR`, pattern
  `<script>` comme XLSX/jsPDF).
- Référentiel article : `articles_catalog` / `mapping_articles`.
- Génération des étiquettes imprimables : générateur code article → QR + libellé
  (réutilise jsPDF/XLSX).

Périmètre : nouveau composant scan isolé (règle modularisation) + générateur
d'étiquettes + branchement léger sur écrans magasinier (Inventaire + Sortie).
Pas de refonte backend (endpoints stock existants). Risque faible, valeur
opérationnelle élevée.

À cadrer APRÈS le sprint caisse (+ fix pipeline liquidations). Gated : oui.

---

## CADRAGE — Module Paie bout-en-bout (À TRAITER APRÈS clôture marché local — NE PAS démarrer)

Objectif DG : chaîner **calcul SB → bordereau → émargement → payé/impayé tracé →
rapprochement Caisse Paie**. Base = audit cartographie paie (pointage fiable BEE ONE,
calcul SB éphémère côté front, taux global `app_settings/paie_baremes`, référentiel
`ouvriers_registry` matricule-keyé 1636, caisse_paie 100% import Excel, émargement
inexistant).

### Décisions DG actées
1. **OJRA = aval déclaratif** (fiches paie + CNSS), PAS une source concurrente.
   **SB = source du calcul/paiement.** À explorer plus tard : SB → export vers OJRA ?
2. **Matricule** : hypothèse = tous matriculés sauf historique. À VÉRIFIER au cadrage
   (scan Excel impayés vs `ouvriers_registry` → liste des sans-matricule ; distinguer
   actifs à régulariser vs historique gelable). Ex. signalé : AYOUB CHINGO 8 849 DH.
3. **Méthode caisses (principe DG, vaut pour TOUTES les caisses)** :
   a. Importer TOUTES les alimentations d'abord (vue d'ensemble des entrées).
   b. Passer les dépenses de chaque caisse séparément.
   c. Équilibrer par **TRANSFERTS inter-caisses** à la fin (le solde -23 344 de la
      Caisse Paie = argent pris ailleurs, non tracé comme transfert).

### Vérifié (pré-cadrage)
- **Transfert inter-caisses EXISTE** : action backend `create-transfer`
  (functions/index.js:14414) → paire `transfer_out`/`transfer_in`, comptée dans les
  soldes. Pivot d'équilibrage viable. ⚠️ Confirmer l'UI caisse du transfert au cadrage
  (l'onglet « Transferts » actuel = côté stock).

### Séquence pressentie (4 lots, risque croissant)
1. **Persister le calcul paie** (ouvrier×quinzaine) — l'éphémère devient donnée.
2. **Bordereau** depuis le calcul persisté.
3. **Émargement** (collection payé/impayé : qui/quand/montant).
4. **Rapprochement Caisse Paie** (Σ dépenses paie ↔ Σ bordereaux émargés).

Gated : oui — cadrage complet avec Omar avant tout dev. Ne pas démarrer avant clôture
du sprint marché local.

### GARDE-FOUS DE VALIDATION (décisions DG actées) — DOUBLE FILET

**1. FIGEAGE D'UNE QUINZAINE = BLOQUANT (protège l'argent réel)**
Une quinzaine ne peut être FIGÉE (donc payée) que si les contrôles passent :
- SMAG appliqué **conforme au barème légal de la période**.
- Jours **cohérents** (dimanches / repos / fériés exclus, contrôle **visible**).
- Écart vs barème théorique **sous seuil**.
Si incohérent → **figeage IMPOSSIBLE, pas de forçage**. S'ancre dans le workflow
3 visas (Caporal/Chef → RH → DG) → FIGÉE/immuable.

**2. BARÈME SMAG ÉDITABLE AVEC BORNES + ALERTE**
- La RH peut éditer (nouveau décret) MAIS toute saisie **hors bornes légales connues**
  (ex. 107,22) → **alerte bloquante / à confirmer** (qu'un nouveau « 107,22 » ne puisse
  plus être introduit silencieusement).
- Barème **par date d'effet** : 93 jusqu'au 31/03/2026, 97,44 dès 01/04/2026.

→ Double filet : **barème borné** (erreur à la source) + **figeage bloquant** (rattrape
jours/écarts).

### DIAGNOSTIC INVESTIGATION (read-only, golden file 1Q juin 2026) — pour mémoire
- **Base de calcul saine et unifiée** : `public/lib/paieUtils.js` → `computePayslip`,
  utilisée par tous les écrans bulletin (popup, CoutRecolteTab, PaieTab). `computeWorkerPaie`
  (HS+transport) = **code mort**.
- **SMAG** : entrée parasite `smagHistory` 2026-06-01 = **107,22** (aucun barème légal) →
  SB calcule juin à 107,22 (+13 061 sur 1Q juin). **Jamais payé** (caisse_paie sans juin ;
  paies réelles = Excel @97,44). Correctif = retirer l'entrée.
- **Jours 15 vs 13** : SB compte en plus le **15/06 (lundi, clôture Excel anticipée → SB
  plus complet)** et le **14/06 (dimanche → règle DG à trancher : dimanches payés ?)**.
  Pas un bug « tous les dimanches ».
- **Prime fonction** : registre incomplet (82/128 ouvriers `primeFonctionJournaliere=0`) +
  HS/récolte/conditionnement **fondues** dans la « Prime Fonction Brut » de l'Excel,
  absentes des inputs SB (−11 441).
- **Transport** : non déduit du net en SB (`computePayslip` sans transport) ; modèle cible
  (ponction net + reversement transporteur via caisse paie) à construire ; pas de lien
  ouvrier→transporteur (transport au niveau équipe).
- **Émargement** : inexistant en SB (feuille Excel « ETAT EMARGEMENT »). Cible : espèces
  (non déclarés) = signature ; virements (déclarés) = preuve bancaire.
- **Caisse paie** : 19 dépenses = montant global/quinzaine importé Excel, **0 ventilation**
  net/transport/divers, pas de détail ouvrier. Cible = 4 natures de sortie.
- **Référentiel** : 1636 matricules ; les **non-déclarés (SANS CNSS)** sont massivement
  **absents du registre** (313/356 hors registry) → enrôlement requis (le « sans matricule »
  n'est pas le vrai trou).

### ARBITRAGES DG EN ATTENTE (à trancher à froid avant de cadrer les lots)
Acquis : l'écart 1Q juin n'est **PAS un bug de calcul**. 37/47 des « jours-extra » SB sont des
**présences pointeuses RÉELLES** (`prod_presence`, heure d'entrée) → SB n'invente pas, il lit
BEE ONE. L'écart = **règle dimanche + cutoff + incohérence miroirs**.

1. **RÈGLE DIMANCHE** : les dimanches travaillés (récolte, pointage réel BEE ONE) sont-ils
   **payés** ? Détermine si SB doit les inclure ou exclure du décompte jours.
2. **CUTOFF QUINZAINE** : définir quand une quinzaine est officiellement close (le 15 inclus ?
   règle de date de clôture). SB est plus à jour que l'Excel figé trop tôt.
3. **SOURCE DE VÉRITÉ POINTAGE** : Excel Hamza (manuel) vs BEE ONE (`sql_mirror`) — laquelle
   fait foi en cas de divergence ?
4. 🔴 **FIABILITÉ INTERNE** : 10 jours-extra **incohérents `sql_mirror_pointage` vs
   `prod_presence`** (un miroir dit présent, l'autre non). À investiguer — touche la fiabilité
   du pointage (brique supposée saine). **Réconciliation à intégrer au garde-fou figeage.**

Note : preuve DG « EL HADDAJ 14-15 vides » NON confirmée par le golden `docs/` (mat 5 y a
13 j, absents 3 & 10, et est Gardien 7/7) → reconfirmer quel fichier/ouvrier côté DG.

### DÉCISIONS FINALES — INVESTIGATION CLOSE (les 4 arbitrages ci-dessus = TRANCHÉS)
- **Source pointage autoritaire = `sql_mirror_pointage` (BEE ONE officiel)**, **SNAPSHOT figé au visa** (pas de relecture live). `prod_presence` = **témoin de contrôle**.
- **Édits BEE ONE post-cutoff** : **fenêtre de correction de X jours** (durée à fixer ~2-3j, à valider Hamza) puis figeage. Après figeage : **correction DG tracée uniquement**.
- **Dimanches travaillés = PAYÉS** (1 jour = 1 jour, **sans majoration**).
- **Conséquence 1Q juin** : **SB a le BON décompte** (dimanche 14 + lundi 15 réels, BEE ONE) ; l'Excel Hamza **sous-comptait**. **SB = source unique confirmée.**

### CORRECTIONS À CODER — LOT 1 (gated, au lancement du build)
1. **Retirer l'entrée `smagHistory` 107,22 (2026-06-01)** → SB repasse à 97,44 pour juin+. Backup avant, **no-delete (archiver l'entrée)**.
2. **Compléter `primeFonctionJournaliere`** du registre (82 ouvriers à 0).
3. **Décompte jours** : déjà correct côté SB (dimanches inclus, BEE ONE réel) — **valider que la règle dimanche=payé est explicite** dans le calcul.

### GARDE-FOUS (au figeage) — rappel
Figeage bloquant (SMAG conforme + jours cohérents + écart sous seuil) + barème SMAG borné/alerte + **réconciliation `sql_mirror` ↔ `prod_presence` en contrôle**.

### À FIXER / RESTE BACKLOG
- **PARAMÈTRE** : durée fenêtre de correction — **≥ lag refresh reporting** (plancher 2-3j, valider Hamza).
- **Reste** : audit toutes-quinzaines (après fiabilisation 1Q juin) ; lots transport / émargement / caisse paie ventilée (4 natures) / enrôlement des 313 non-déclarés.

### INVESTIGATION CLOSE & PROUVÉE (read-only, 1Q juin 2026)
**PREUVE A — sources BEE ONE :**
- `sql_mirror_pointage` = base **REPORTING** (`BR_Pointage`, différée), cron horaire conditionnel → **source autoritaire paie**.
- `prod_presence` = base **PRODUCTION** (`Presence`, temps réel) → **témoin de contrôle**.
- **Lag possible ~1j** (refresh reporting nocturne) → fenêtre de correction **≥ délai refresh reporting** avant figeage. Renforce le **snapshot-au-visa**.

**PREUVE B — réconciliation post-correction (simulation, 0 write) :**
- **97** ouvriers sans écart jours → **matchent l'Excel** au centime.
- **31** avec écart → **résidu 5 319 DH, expliqué à 100 % par jours réels** (dim 14 + lun 15). Attendu effet-jours = 5 327 DH. **Écarts inexpliqués >5 DH = 0**.
- **VERDICT : aucun bug de calcul résiduel.** L'Excel **SOUS-PAYAIT ~5 300 DH** (dimanches + jour 15). Le « 4746 » de Hamza = ce sous-paiement, **pas un défaut SB**.
- → Après Lot 1, **SB reproduit l'Excel au centime SAUF les jours réels en plus** (dus aux ouvriers). **Hamza s'aligne sur SB.**
