# Intégration SQL Server → Firestore (le « mirror »)

> État au 2026-09-14. Écrit dans le cadre du chantier production-readiness
> (voir `PRODUCTION_READINESS.md`, Phase 2). Vérifié par lecture directe du
> code, `firebase functions:list` contre le projet live
> `berrygood-farms-dashboard`, et exécution des tests
> `tests/unit/probeStaleness.test.js` / `tests/unit/pullHealth.test.js` /
> `tests/unit/replicationProbe.pullHealth.test.js` (39/39 verts).

## Ce que c'est — et ce que ce n'est PAS

Le SQL Server de la ferme (`BEE_BERRY_GOOD` / bases de reporting) est **la
source de vérité opérationnelle** pour le pointage des ouvriers, la
consommation d'intrants et la cueillette. Firebase/Firestore reste **le seul
backend applicatif** : ce module (`functions/src/modules/rh/sqlSyncService.js`) ne fait que
recopier, heure par heure, des lignes SQL vers des collections Firestore
« miroir » que le reste de l'app lit normalement. Ce n'est ni un second
backend, ni du code legacy — **ne pas le supprimer** (voir l'en-tête ajouté
directement dans `functions/src/modules/rh/sqlSyncService.js`).

Si ce module est retiré : le pointage, la cueillette et la consommation
cessent d'arriver. Les écrans continuent de s'afficher avec les dernières
données synchronisées, **gelées, sans erreur visible** — voir la section
« Que se passe-t-il visuellement si la synchro se fige » plus bas.

## Tables SQL lues → collections Firestore écrites

| Table SQL source | Base | Collection(s) Firestore | Clé du document |
|---|---|---|---|
| `BR_Pointage` (reporting) | pool par défaut (`sqlConfig`) | `sql_mirror_pointage`, `sql_mirror_pointage_meta/config`, `sql_mirror_pointage_workers/{matricule}` | `{YYYY-MM-DD}` / doc unique / `{matricule}` |
| `Pointage` (BDP prod, `BEE_BERRY_GOOD`) | pool prod dédié (`sqlConfigProd`, `poolProd`) | *(pas de mirror direct — sert uniquement à la sonde de staleness, voir plus bas)* | — |
| `BR_Consommation` | pool par défaut | `sql_mirror_consommation` | `{YYYY-MM}` |
| `BR_Cueillette` | pool par défaut | `sql_mirror_cueillette` | `{YYYY-MM-DD}` |
| *(dérivé de `sql_mirror_pointage`, par quinzaine)* | — | `quinzaine_archive` | `{label_quinzaine}` |
| *(reconstruction BDP en mode `live`)* | pool prod | `sql_mirror_pointage_bdp_test` | `{YYYY-MM-DD}` |

**Nuance importante** : la synchro horaire du pointage (`syncPointage`, dans
`sqlSyncService.js`) lit `BR_Pointage` (base de **reporting**), alors que la
**sonde de staleness** (`runReplicationProbe`) lit la table `Pointage` de la
base de **production** `BEE_BERRY_GOOD` directement (bascule documentée en
commentaire dans le code : « la sonde de staleness lit désormais la table
brute `Pointage` de la BDP, pas l'ancienne `BR_Pointage` reporting »). Ce
sont deux connexions SQL différentes (`sqlConfig` vs `sqlConfigProd`), sur
deux tables différentes, pour deux buts différents — la synchro remplit le
mirror, la sonde vérifie que la source elle-même n'est pas figée.

`sql_mirror_pointage_bdp_test` est une collection de **réconciliation
ligne-à-ligne** (compare une reconstruction directe depuis la BDP au mirror
figé) — outillage ops, protégé par `ADMIN_SECRET`, aucun écran ne la lit.

## Planning de synchro (Cloud Scheduler, `Africa/Casablanca`)

Confirmé déployés et actifs sur le projet live via `firebase functions:list` :

| Export | Déclencheur | Cadence | Rôle |
|---|---|---|---|
| `sqlToFirestoreSync` | scheduled | `5 * * * *` (toutes les heures à :05) | La synchro elle-même : SQL → `sql_mirror_*` |
| `replicationProbe` | scheduled | `every 1 hours` | Sonde de fraîcheur + déclenche les alertes staleness/pull-health |
| `probeAnalyzer` | scheduled | `every 12 hours` | Analyse les probes accumulées, recommande un cron optimal |
| `sqlSyncTrigger` | HTTP manuel | — | Relance la synchro à la demande (ops) |
| `probeRawData` | HTTP manuel | — | Consultation des probes brutes (ops) |
| `probeAnalysisReport` | HTTP manuel | — | Rapport d'analyse à la demande (ops) |

Ces six exports sont réexportés vers le barrel `functions/index.js` via
**deux modules différents** — à savoir si vous cherchez d'où ils viennent :
`sqlSyncTrigger`/`sqlToFirestoreSync` par `functions/src/modules/admin/admin.js`,
et les quatre autres (`replicationProbe`, `probeAnalyzer`, `probeRawData`,
`probeAnalysisReport`) par `functions/src/modules/technique/technique.js`.
Vérifié : aucun n'est orphelin, tous les six apparaissent dans
`firebase functions:list` avec le trigger attendu.

Le total de l'app est de 17 fonctions planifiées (`pubsub.schedule`), pas 6 —
le chiffre « 6 » qui circulait au démarrage de ce chantier ne concernait que
ce module SQL. Les 11 autres sont documentées ailleurs (paie, agronomie,
technique, backup, email…) et hors périmètre de ce document.

## `USE_FIRESTORE_MIRROR` — ce que ça bascule

`process.env.USE_FIRESTORE_MIRROR !== "false"` (donc **vrai par défaut**,
même variable non définie). Deux implémentations parallèles existent pour
chaque lecture pointage :

- **`USE_MIRROR = true` (défaut)** : lecture depuis les collections
  Firestore `sql_mirror_*` (`fetchDetailFromMirror`, `fetchSummaryFromMirror`,
  `fetchPostesFixesFromMirror` dans `functions/src/modules/rh/pointageService.part2.js`).
- **`USE_MIRROR = false`** : lecture SQL **directe et synchrone** à chaque
  requête (`fetchDetailFromSQL`, `getPool()`), sans passer par le mirror.
  Existe comme filet de secours / mode debug, mais charge le SQL Server à
  chaque appel API au lieu d'une fois par heure — ne pas activer en
  production sans raison précise.

## Écrans qui dépendent de chaque collection mirror

Tout passe par `/api/pointage-rh` (`pointageV3` → `pointageRH`, voir
`firebase.json:36`) sauf mention contraire.

| Collection | Écrans (consommateurs confirmés) |
|---|---|
| `sql_mirror_pointage` + `_meta` + `_workers` | Dashboard (panneau « Pointage du jour », popup détail ouvrier), RH → Pointage, Quinzaine, Heures Sup, Équipes, Jour Férié, Transport, Suivi Pointage (`/api/validation`), Récolte, Coût Récolte, Hors Récolte, Primes Récolte + Récap, Traitement, Chargement, Conditionnement, Campagne (agronomie), Achats → Bon d'Apport, Finance → Dashboard |
| `sql_mirror_consommation` | **Attention — voir section suivante : figée depuis avril 2026, toujours interrogée par plusieurs endpoints** |
| `sql_mirror_cueillette` | Récolte (`action=recolte`), Dashboard |
| `quinzaine_archive` | Quinzaine (14 appels), Finance → Dashboard |
| `sql_mirror_pointage_bdp_test` | Aucun (outillage ops uniquement, `ADMIN_SECRET`) |

## Constat additionnel : `sql_mirror_consommation` est déjà figée — et personne n'est alerté

Indépendamment de toute panne de synchro, le code documente lui-même que
cette collection **ne contient plus rien depuis avril 2026** (10 mois sans
nouvelle ligne sur la campagne courante — commentaires dans
`functions/lib/consoBons/bonsToConsoRows.js:11-19`,
`functions/src/shared/core.js:18-19`,
`functions/src/modules/rh/pointageService.part1.js:148-149`). Les écrans Campagne/Agronomie
ont été explicitement migrés pour lire `consumption_vouchers` (bons Smart
Berry natifs) à la place — voir commit `e3995e9`.

Mais **6 endpoints continuent d'appeler `getConsommationRows()`** (donc de
lire ce mirror mort) sans qu'aucun d'eux ne le signale : `exports.dashboard`,
`exports.fertigation`, `exports.produits` (aucun appelant frontend — route
morte), `exports.parcelles`, `exports.agroSummary`, `exports.budgetService`.
Ces écrans rendent silencieusement des données vides ou périmées pour toute
période récente. C'est un second cas de « donnée gelée qui ressemble à une
donnée calme », indépendant du pipeline de synchro documenté ci-dessus — à
traiter séparément (soit migrer ces 5 lecteurs restants vers
`consumption_vouchers`, soit les faire disparaître s'ils sont eux-mêmes morts
comme `produits`).

## Que se passe-t-il visuellement si la synchro se fige ?

**Réponse courte : quasiment rien.** Recherche exhaustive sur `src/` et
`public/` (zéro résultat pour `staleness`, `replication_probe`,
`isStale`, `données figées`) :

- **2 écrans** affichent un badge d'horodatage brut : Dashboard
  (« Dernière saisie: HH:MM ») et RH → Pointage (« Dernière synchro SQL:
  HH:MM »). Aucun des deux n'a de code couleur ni de seuil — un utilisateur
  doit comparer mentalement l'heure affichée à l'heure actuelle pour
  remarquer un problème. Le calcul d'âge que le backend fournit déjà
  (`dataAge`, ex. `"3h 12min"`, calculé dans `firestoreDataService.js:196-215`)
  **n'est jamais lu côté frontend**.
- Le badge « Kg maj HH:MM » de l'écran Récolte est un **faux ami** pour ce
  sujet : il vient d'un pipeline totalement différent
  (`prod_tracabilite_recolte` / scan BEE-ONE), pas de `sqlSyncService.js`.
- Un endpoint plus riche existe déjà côté serveur —
  `GET /api/health` (`exports.health`,
  via `getPointageDataFreshness`) — renvoie `pointageDataAgeHours`,
  `pointageDataAgeDays`, `probedAt`. **Rien dans `src/` ne l'appelle.**
- Seule exception : le bot WhatsApp du DG (`dgAgent.js:576-581`) injecte
  l'âge de la donnée dans son propre prompt système à chaque tour — mais
  c'est passif (il faut le demander au bot), pas une alerte proactive.

**Le seul mécanisme proactif réel est l'alerte WhatsApp** (voir
`sqlSyncService.js`, `evaluateAndAlertStaleness` /
`evaluateAndAlertPullHealth`), déclenchée par `replicationProbe` (horaire),
avec débounce 24h, envoyée au DG via un vrai appel à l'API Meta Cloud
(`whatsappService.sendTemplateMessage` → `graph.facebook.com/v21.0/.../messages`,
template `general_alert`). Deux régimes de panne distincts, chacun avec son
propre état de débounce Firestore (`replication_probe_state/pointage` et
`replication_probe_state/pull_health`) :

- **Mode A — source figée** (`evaluateAndAlertStaleness`) : la table SQL
  elle-même est vide ou son `MAX(Periode_Date)` est antérieur au dernier
  jour ouvré attendu (tolère week-ends/fériés).
- **Mode B — panne du pull** (`evaluateAndAlertPullHealth`) : le cron horaire
  lui-même échoue (`consecutiveFailures ≥ 2`) ou le mirror décroche de la
  source fraîche (`mirror_lag > 24h`), lu uniquement depuis Firestore donc
  fonctionne même si SQL est injoignable.

Logique pure testée (39/39, `tests/unit/probeStaleness.test.js`,
`tests/unit/pullHealth.test.js`, `tests/unit/replicationProbe.pullHealth.test.js`),
y compris un test d'intégration qui tente une vraie connexion SQL et vérifie
que l'échec déclenche bien l'alerte.

**Recommandation** (non implémentée dans ce chantier, à trancher séparément) :
faire lire `/api/health` par le badge Dashboard/PointageTab existant et lui
ajouter un état visuel (couleur/icône) au-delà d'un certain seuil d'âge —
l'API et le calcul existent déjà côté serveur, il ne manque que le fil vers
l'écran.

## Vérification de la synchro (comparaison de volumes)

Pas d'accès direct au SQL Server de production depuis cet environnement de
travail (pas d'IP allow-list, pas d'identifiants réseau). Pour comparer les
volumes SQL vs Firestore, lancer manuellement :
```
GET /api/sql-sync-trigger   (exports.sqlSyncTrigger, ADMIN_SECRET requis)
```
et comparer le `result` retourné (compte de lignes par table) aux comptes
Firestore (`sql_mirror_pointage_meta/config.availableDates.length`, etc.). À
faire depuis un poste avec accès réseau au SQL Server — voir
`docs/INTEGRATION_STATUS.md` pour le statut de cette vérification.
