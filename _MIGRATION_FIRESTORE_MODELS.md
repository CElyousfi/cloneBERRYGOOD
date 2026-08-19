# Modèles de données Firestore — préparation migration JavaScript → TypeScript

> Document généré par analyse statique du code (2026-08-19). Il décrit **ce que le
> code écrit aujourd'hui**, déduit des chemins d'écriture réels — pas un schéma
> déclaré, qui n'existe pas.

---

## Sommaire

- [§0 — Méthodologie et conventions de typage](#0--méthodologie-et-conventions-de-typage)
- [§1 — Résumé des règles d'accès et d'authentification](#1--résumé-des-règles-daccès-et-dauthentification)
- [§2 — Types partagés](#2--types-partagés)
- [§3 — Interfaces par domaine](#3--interfaces-par-domaine)
- [§4 — Catalogue des collections secondaires](#4--catalogue-des-collections-secondaires)
- [§5 — Notes, edge cases et pièges de migration](#5--notes-edge-cases-et-pièges-de-migration)
- [§6 — Annexe : observations de sécurité (hors périmètre)](#6--annexe--observations-de-sécurité-hors-périmètre)

---

## §0 — Méthodologie et conventions de typage

### Comment ces schémas ont été déduits

Le projet n'a **aucun schéma de base déclaré** :

- pas de TypeScript (`typescript` est présent en `devDependency` uniquement, pour
  `npm run typecheck`) ;
- **aucune bibliothèque de validation** — pas de Zod, Yup, Joi, Ajv, io-ts
  (vérifié dans `package.json` : dependencies = `dotenv`, `playwright`, `xlsx`) ;
- pas de PropTypes ;
- le seul typage existant est du **JSDoc + `// @ts-check`** sur ~28 fichiers
  `public/lib/*.js`, tous des **modules purs** qui ne touchent jamais Firestore.

Les interfaces ci-dessous ont donc été reconstruites en croisant quatre sources :

| Source | Ce qu'elle donne |
|---|---|
| Chemins d'écriture (`.add()`, `.set()`, `.update()`, `batch.set()`, `t.set()`) | Noms de champs, valeurs par défaut, optionalité réelle |
| Chemins de lecture / rendu (`tx.montant`, `b.poidsLot \|\| b.quantiteKg`) | Champs legacy, alias, tolérance aux `undefined` |
| `useState({...})` d'initialisation de formulaire, constantes `STATUS_LABELS` | Unions de statuts, valeurs par défaut UI |
| `firestore.rules` + `firestore.indexes.json` | Existence de collections, champs indexés, cardinalité des requêtes |

### Périmètre observé

- **~150 collections** distinctes référencées dans le code.
- **~60** seulement sont déclarées dans `firestore.rules` ; les ~90 autres sont
  **CF-only par `deny` implicite** (la règle par défaut `match /{document=**}` refuse
  tout, `firestore.rules:6-8`).
- **29 collections** seulement sont touchées **directement** par le navigateur. Tout
  le reste transite par ~150 endpoints HTTP `fetch('/api/<service>?action=...')`.
- SDK client : **`firebase-compat` v10.14.1** (API *namespaced* :
  `db.collection('x').doc('y').set()`), chargé depuis gstatic dans
  `public/index.html:26-29`. **Zéro** usage de l'API modulaire (`collection(db, …)`,
  `addDoc`, `setDoc`) et **zéro** `httpsCallable`.
- **Aucun `collectionGroup`** dans tout le projet. 7 sous-collections seulement.

### Conventions de typage retenues

**1. Timestamps — union assumée.** Un document *écrit* et un document *lu* n'ont pas
la même forme sur les champs de date, parce que `serverTimestamp()` est un
`FieldValue` sentinelle à l'écriture et devient un `Timestamp` à la lecture :

```ts
import type { Timestamp, FieldValue } from 'firebase/firestore';

/** Champ horodaté écrit via serverTimestamp() : FieldValue en écriture, Timestamp en lecture. */
export type FirestoreTimestamp = Timestamp | FieldValue;
```

Ce projet complique le problème : **trois représentations de date coexistent** selon
le domaine (voir [§5.1](#51--trois-représentations-de-date-coexistent)). D'où un
second alias, utilisé pour les collections qui ne passent pas par `serverTimestamp()` :

```ts
/** Toute forme de date rencontrée en base : Timestamp, epoch ms, ou string ISO. */
export type FirestoreDateLike = Timestamp | FieldValue | number | string;
```

**2. Jamais `any`.** Les données réellement non structurées (payload de backup,
lignes de miroir SQL brutes, tables extraites d'e-mails) sont typées `unknown`,
`Record<string, unknown>` ou `unknown[]`.

**3. `?` = optionalité observée**, c'est-à-dire un champ que certains chemins
d'écriture n'écrivent pas — pas une supposition. Quand un champ est écrit avec une
valeur par défaut explicite (`description: description || ""`), il est **requis**
et non optionnel.

**4. `| null` vs `?`.** Distingués strictement : `| null` signifie que le code écrit
littéralement `null` (fréquent ici — `validatedByChef: null`), `?` signifie que la
clé est absente du document.

**5. Annotations de provenance.** Chaque champ dont l'écriture est le fait d'un seul
chemin de code porte un commentaire `// écrit par <fichier:ligne>`.

### Avertissement

Firestore n'impose rien. Ces interfaces décrivent la forme produite par le code
**actuel**. Les documents historiques présents en base peuvent diverger — notamment
sur les collections qui ont changé de convention en cours de route
(`pfq_interne`, `expeditions`, `bons_marche_local`). Toute lecture typée devrait
donc passer par un *converter* défensif plutôt que par un cast direct.

---

## §1 — Résumé des règles d'accès et d'authentification

### 1.1 — Le fait structurant

**Aucune règle Firestore ne teste un rôle.** `firestore.rules` (344 lignes) ne
contient aucune fonction helper, aucun `get(/databases/.../users/$(uid))`, aucun
test de `profileId`. Les règles se limitent à trois patrons : *authentifié ou non*,
et *écriture autorisée ou non*.

Tout le contrôle d'accès métier — rôles, cloisonnement par ferme, projection de
champs — vit **exclusivement dans les Cloud Functions**. Une interface TypeScript
ne doit donc jamais laisser croire qu'un document est protégé par sa collection.

### 1.2 — Les quatre niveaux d'accès

Défaut : **deny-all** (`firestore.rules:6-8`). **Aucune collection n'est lisible
publiquement** — pas une seule règle n'accorde `read` sans `request.auth != null`.

#### Niveau A — CF-only strict (`read: false, write: false`)

Ni lecture ni écriture client. Accès uniquement par Admin SDK.

| Collection | Ligne | Motif documenté |
|---|---|---|
| `ouvriers_registry` | 281 | Étape 1 sécu paie — lecture via `/api/registry` avec projection de champs |
| `sql_mirror_pointage_workers` | 37 | Étape 4 sécu paie — données nominatives |
| `quinzaine_archive` | 63 | Étape 4 sécu paie |
| `parcelle_ferme_referentiel` | 46 | Alimente le cloisonnement ferme (fail-closed) |
| `parcelle_ferme_referentiel_meta` | 50 | idem |
| `sb_campagne_budget_jh` | 339 | Lecture client court-circuiterait le filtre ferme |
| `whatsapp_sessions` | 211 | État conversationnel privé |
| `connection_logs` | 107 | Journal d'audit |

#### Niveau B — Lecture authentifiée / écriture Cloud Functions (`read: auth != null; write: false`)

Le patron majoritaire (~37 collections) :

`users` (lecture restreinte à `uid == userId`, l.11), `sql_mirror_pointage`,
`sql_mirror_consommation`, `sql_mirror_cueillette`, `sql_mirror_pointage_meta`,
`prod_tracabilite_recolte`, `cpc_snapshots`, `api_cache`, `validations`,
`pointage_validations_equipe`, `stock_requests`, `budgets`, `sql_sync_status`,
`expeditions`, `liquidations`, `liquidation_forecasts`, `productivity_reports`,
`notifications`, `netafim_parcelles_bahia`, `security_envois_registre`,
`security_incidents`, `stock_movements`, `bug_reports`, `stock_balances`,
`consumption_costs_by_variety`, `caisse_definitions`, `caisse_transactions`,
`whatsapp_logs`, `whatsapp_messages`, `config`, `fonctions`, `growth_measurements`,
`growth_plot_config`, `parcelles_consommation`, `mapping_campagne`,
`parcelles_culturales_charge`, `sb_parcelle_groupes`.

#### Niveau C — Lecture ET écriture par tout compte authentifié (`read, write: auth != null`)

La surface la plus permissive : **aucun contrôle de rôle en base**, n'importe quel
compte connecté peut écrire.

`evolution_requests` (148), `tasks` (153), `app_settings` (158),
`bons_apport_saisie` (163), `pfq_interne` (168), `scan_corrections` (171),
`clients_marche_local` (174), `irrigation_readings` (179), `security_mouvements` (191),
`security_scan_registre` (194), `security_tunnel_photos` (197), `rh_config` (273),
`tresorerie_items` (296).

#### Niveau D — Non déclarées ⇒ CF-only implicite (~90 collections)

`purchase_orders`, `emails`, `invoices`, `delivery_notes`, `articles_catalog`,
`suppliers`, `alerts`, `analyses_foliaires`, `meteo_outdoor`, `pointage_validations`,
`sb_parcelle_referentiel`, `transport_config_changes`, `replication_probe`, etc.

> Plusieurs de ces collections possèdent pourtant un **index composite** dans
> `firestore.indexes.json` (`purchase_orders`, `alerts`, `analyses_foliaires`,
> `meteo_outdoor`, `transport_config_changes`) : les index servent les requêtes
> Admin SDK, pas des requêtes client.

### 1.3 — Le modèle de rôles (indispensable pour typer `users` et les champs `*_by`)

Stocké dans **`users/{uid}`** (uid = UID Firebase Auth). Il n'y a pas de collection
`profiles`. **Aucun custom claim n'est utilisé** — pas un seul `setCustomUserClaims`
dans le repo ; chaque décision de rôle coûte une lecture Firestore.

Deux axes **distincts et indépendants** :

- **`role`** — rôle *système* : `'admin' | 'user'` (défaut `'user'`). Seul `admin`
  passe les gates `/api/auth?action=list|create|…` et `/api/backup`, et obtient
  `perimetre_ferme: 'all'`.
- **`profileId`** — rôle *fonctionnel*, source de vérité serveur, résolu par
  `resolveCallerRole()` (`functions/lib/auth/resolveRole.js:12-21`) qui lit
  `users/{uid}.profileId` — jamais le body client. 20 valeurs, cataloguées dans
  `public/app.jsx:413-434`.

Périmètre effectif, calculé par `resolvePerimetre()`
(`functions/lib/valorisation/accessControl.js:102-152`) :

| Groupe | Profils | Périmètre |
|---|---|---|
| Accès total | `dg`, `finance`, `rh` (+ `role: 'admin'`) | `'all'`, `?ferme=` accepté comme filtre |
| Chefs cloisonnés | `chef_f1` (Framboise), `chef_f5` (Myrtille), `chef_avo`, `chef_bahia` | Ferme **imposée serveur**, `?ferme=` ignoré |
| Tous les autres | `achats`, `magasinier`, `qualite`, `caporal_*`, `agronomie`, `dt`, `stationnaire_*`, `securite`, `audit_interne` | **Refusés** (fail-closed) |

Les profils refusés par `resolvePerimetre` conservent l'accès aux ~30 endpoints qui
ne vérifient que l'authentification.

> **Backdoor documentée** : `resolveRole.js:36` renvoie
> `{profileId:'dg', role:'admin'}` pour `uid === 'admin-cli'`, identité fabriquée par
> le chemin admin-secret de `/api/stock` (`functions/index.js:6691-6693`).

### 1.4 — Patrons d'authentification par endpoint

| Patron | Endpoints |
|---|---|
| `requireAuth` seul (auth, pas de rôle) | ~30 : `/api/dashboard`, `/api/parcelles`, `/api/meteoblue`, `/api/tasks`, `/api/notifications`, `/api/alerts`, `/api/bug-reports`… |
| `requireAuth` + rôle serveur | `/api/primes`, `/api/registry`, `/api/fonctions`, `/api/rh`, `/api/pointage-rh`, `/api/pointage-validation`, `/api/growth` (writes → `agronomie`), `/api/backup` (→ `role:'admin'`) |
| Secret admin (contourne Firebase Auth) | `/api/bdp-introspect`, `/api/sync-pointage-bdp-test`, `/api/stock` (partiel), `/api/caisse` (partiel), `netafimSyncOnce` |
| Clé partagée dédiée | `/api/sentinel-recipients` (`x-sentinel-key`, seul comparé en `timingSafeEqual`), `/api/ojra` |
| **Aucune auth** | `/api/health` (mode par défaut), POST `/api/whatsapp-webhook`, et 3 `onRequest` de `functions/sqlSyncService.js` |

Le middleware unique est `functions/middleware/requireAuth.js` :
`verifyAuth(req)` (l.18-26) lit `Authorization: Bearer <idToken>` et appelle
`admin.auth().verifyIdToken()` ; `requireAuth(req, res)` (l.28-35) répond `401` sinon.

### 1.5 — Storage (`storage.rules`, bucket `photos`)

| Préfixe | Règle |
|---|---|
| `data/**` | `read, write` si authentifié (overwrite et delete inclus) |
| `scans/**`, `stock_files/**` | `read` + `create` si authentifié ; `update`/`delete` refusés |
| `bdc_pdfs/**`, `bdc_avis_virement/**` | `read, write` si authentifié |
| `bug_reports/**` | `read` si authentifié ; `write: false` (CF only) |

Pas de `match /{allPaths=**}` ⇒ deny par défaut hors de ces six préfixes. Aucune
vérification de taille ni de MIME dans les règles (choix documenté : enforcement
déporté en Cloud Function à cause des uploads *resumable*).

---

## §2 — Types partagés

Ces types reviennent dans presque toutes les collections. Les factoriser est le
premier gain concret de la migration.

```ts
import type { Timestamp, FieldValue } from 'firebase/firestore';

/** Champ horodaté écrit via serverTimestamp(). */
export type FirestoreTimestamp = Timestamp | FieldValue;

/** Toute forme de date rencontrée en base. Voir §5.1. */
export type FirestoreDateLike = Timestamp | FieldValue | number | string;

/** Date métier sérialisée 'YYYY-MM-DD' (jamais un Timestamp). */
export type DateString = string;

/** Rôle système. */
export type UserRole = 'admin' | 'user';

/** Rôle fonctionnel — catalogue complet, public/app.jsx:413-434. */
export type ProfileId =
  | 'rh' | 'dg' | 'finance' | 'achats' | 'qualite' | 'magasinier'
  | 'agronomie' | 'dt' | 'audit_interne' | 'securite'
  | 'chef_f1' | 'chef_f5' | 'chef_avo' | 'chef_bahia'
  | 'caporal_f1' | 'caporal_f5' | 'caporal_avo'
  | 'stationnaire_f1' | 'stationnaire_f5' | 'stationnaire_avo';

/** Fermes déclarées côté UI (public/app.jsx:452). */
export type Ferme = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'BAHIA' | 'Avocatier';

/** Fermes du workflow de validation pointage (functions/index.js:5249). */
export type FermeValidation = 'F1' | 'F5' | 'Avocatier' | 'BAHIA';

/**
 * Référence à un acteur. TOUJOURS un objet, jamais un userId string — voir §5.3.
 * La forme exacte varie selon le producteur : le backend pose {uid, profileId,
 * name, email}, le frontend n'écrit souvent que {profileId, name}.
 */
export interface ActorRef {
  uid?: string;
  /** Certains chemins backend écrivent `userId` au lieu de `uid`. */
  userId?: string;
  profileId?: ProfileId | string;
  name?: string;
  email?: string;
}

/** Entrée du journal `history[]`, présent sur caisse, BDC, factures, analyses. */
export interface HistoryEntry {
  action: string;
  by: ActorRef;
  /** epoch ms — Date.now(), jamais un Timestamp. */
  at: number;
  comment?: string;
  [extra: string]: unknown;
}

/** Visa de validation du workflow pointage. */
export interface ValidationVisa {
  validatedBy: ActorRef | string;
  /** epoch ms. */
  validatedAt: number;
  comment: string;
}

/** Ligne d'article — BDC, factures, bons de livraison, mouvements de stock. */
export interface LineItem {
  article: string;
  quantite: number;
  unite: string;
  prix_unitaire: number;
  taux_tva: number;
  montant_ht: number;
  montant_tva: number;
  montant_ttc: number;
  note?: string;
  categorie?: string;
}

/** Lieu de stock (magasin, ferme, parcelle…). */
export interface StockLocation {
  type: string;
  id: string;
}
```

### Unions de statut

Extraites des constantes UI et des whitelists backend. **`soumis` ne doit jamais
être renommé** : le libellé « Saisi » est purement cosmétique (`STATUS_LABELS`,
`public/app.jsx:58466`) et le workflow `submit-transaction`/`validate-transaction`
dépend du code `soumis`.

```ts
/** caisse_transactions.status — libellés UI : Brouillon | Saisi | À revoir | Validé | Rejeté */
export type CaisseStatus = 'brouillon' | 'soumis' | 'a_revoir' | 'valide' | 'rejete';

/** caisse_transactions.type. 'encaissement' et 'vente' sont écrits UNIQUEMENT par
 *  l'action apply-encaissements (functions/index.js:14880), jamais par create-transaction. */
export type CaisseTxType =
  | 'alimentation' | 'depense' | 'sortie' | 'paie' | 'transport'
  | 'transfer_out' | 'transfer_in'
  | 'encaissement' | 'vente';

/** pfq_interne.status (public/app.jsx:52768). */
export type PfqStatus =
  | 'soumis' | 'valide_qualite' | 'rejete_qualite'
  | 'valide' | 'rejete_chef' | 'import_excel' | 'app_created';

export type BdcStatus =
  | 'brouillon' | 'en_attente_dg' | 'valide_chef' | 'valide' | 'rejete';

export type StockMovementType = 'reception' | 'sortie' | 'transfert' | 'consommation';

export type StockMovementStatus = 'en_attente_achats' | 'valide_chef' | 'valide' | 'rejete';

export type DeliveryStatus = 'non_livre' | 'partiel' | 'livre';

export type InvoiceStatus = 'non_facture' | 'partiel' | 'complet';

export type MarcheLocalStatus = 'en_attente_prix_dg' | 'valide' | 'rejete_dg';
```

---

## §3 — Interfaces par domaine

Chaque collection porte un en-tête normalisé :
**Doc ID** · **Niveau d'accès** (A/B/C/D de [§1.2](#12--les-quatre-niveaux-daccès)) · **Écrit par**.

### 3.1 — Auth & configuration

#### `users`
`Doc ID : UID Firebase Auth` · `Accès : B (lecture limitée à son propre doc)` · `Écrit par : functions/index.js:11849 (create), :11763 (migration UID), :11790 (lastLoggedAt)`

```ts
export interface User {
  email: string;
  displayName: string;
  profileId: ProfileId | '';
  role: UserRole;
  disabled: boolean;
  /** epoch ms. */
  createdAt: number;
  updatedAt: number;
  /** UID de l'admin créateur. */
  createdBy: string;
  whatsappEnabled: boolean;
  /** Écrit seulement si fourni à la création (functions/index.js:11847). */
  whatsappPhone?: string;
  /** Écrit seulement si fourni (functions/index.js:11848). */
  ferme?: Ferme;
  /** Ajouté par l'update de login, absent tant que l'user ne s'est pas connecté. */
  lastLoggedAt?: number;
}
```

#### `connection_logs`
`Doc ID : auto` · `Accès : A` · `Écrit par : functions/index.js:11781`

```ts
export interface ConnectionLog {
  uid: string;
  email: string;
  profileId: ProfileId | string;
  displayName: string;
  role: UserRole;
  timestampMs: number;
}
```

#### `config`
`Doc ID : slug fixe` · `Accès : B` · `Écrit par : functions/index.js:6671, :16350, :16504 ; emailService.js:1768, :1786`

Collection de documents singleton hétérogènes. **Contient des secrets partagés**
(voir [§6](#6--annexe--observations-de-sécurité-hors-périmètre)).

```ts
export interface ConfigWhatsapp {
  webhook_verify_token: string;
  [key: string]: unknown;
}

export interface ConfigSentinel {
  shared_key: string;
  [key: string]: unknown;
}

/** config/email_fetch, config/email_smtp, et les curseurs Netafim/irrigation. */
export type ConfigDoc = Record<string, unknown>;
```

Documents connus : `config/whatsapp`, `config/sentinel`, `config/email_fetch`,
`config/email_smtp`, plus les curseurs de synchro Netafim
(`functions/lib/netafim/dataAccess.js:12`, `functions/lib/netafim/config.js:22`).

#### `app_settings`
`Doc ID : slug fixe` · `Accès : C (écriture client libre)` · `Écrit par : public/app.jsx (6 docs) + functions/backupService.js:219, scripts/seedJoursFeries.js:55`

Six documents singleton, typés séparément parce qu'ils n'ont **rien** en commun.

```ts
/** app_settings/pfq_import_meta — public/app.jsx:14894, :17412 */
export interface AppSettingsPfqImportMeta {
  lastImportTime: FirestoreDateLike;
  lastImportCount: number;
  lastImportBy: string;
}

/** app_settings/paie_baremes — public/app.jsx:25913 (merge) */
export interface AppSettingsPaieBaremes {
  smagBrutJournalier: number;
  smagNetJournalier: number;
  smagHistory: Array<{ dateFrom: DateString; [k: string]: unknown }>;
  updatedAt: FirestoreDateLike;
  [bareme: string]: unknown;
}

/** app_settings/paie_import_meta — public/app.jsx:26395, :26438 (merge) */
export interface AppSettingsPaieImportMeta {
  lastDeclaresImportAt: FirestoreDateLike;
  lastDeclaresImportCount: number;
  lastDeclaresImportFile: string;
}

/** app_settings/deduction_montants — public/app.jsx:37450 */
export interface AppSettingsDeductionMontants {
  fruitAdvance: { framboise: number; myrtille: number };
  [k: string]: unknown;
}

/** app_settings/confection_types — public/app.jsx:52723 */
export interface AppSettingsConfectionTypes {
  types: Array<{
    id: string;
    label: string;
    poidsParColis: number;
    composition: unknown[];
  }>;
  updatedAt: FirestoreDateLike;
}

/** app_settings/dg_parametres — public/app.jsx:65330 */
export interface AppSettingsDgParametres {
  hideCycle1Profiles: string[];
  updatedAt: FirestoreDateLike;
  updatedBy: string;
}

/** app_settings/jours_feries, /heures_sup, /backup_status — écrits par des jobs serveur. */
export type AppSettingsGeneric = Record<string, unknown>;
```

#### `rh_config/transport_primes`
`Doc ID : 'transport_primes'` · `Accès : C` · `Écrit par : public/app.jsx:25435 (set, merge:false)`

```ts
export interface RhConfigTransportPrimes {
  equipes: Array<{
    prefix: string;
    equipe: string;
    caporal: string;
    ferme: Ferme;
    history: unknown[];
  }>;
  updatedAt: FirestoreDateLike;
  /** e-mail de l'utilisateur. */
  updatedBy: string;
}
```

---

### 3.2 — Achats / Bons de commande

#### `purchase_orders`
`Doc ID : auto` · `Accès : D` · `Écrit par : functions/index.js:6841 (add), :6881/:6911/:7037/:7114/:7143/:7156/:7200/:7482/:7609 (update)`

La collection la plus référencée du backend (58 occurrences, 5 fichiers).

```ts
export interface PurchaseOrder {
  /** Format 'BDC-…', généré par getNextNumber(). */
  numero: string;
  status: BdcStatus;
  purchase_request_id: string | null;
  consultation_id: string | null;
  supplier_id: string | null;
  fournisseur: {
    nom: string;
    ice?: string;
    adresse?: string;
    ville?: string;
    tel?: string;
    email?: string;
  };
  ferme: Ferme | string;
  /** '' par défaut. */
  date_livraison_prevue: DateString | '';
  code_analytique: string;
  /** Défaut 'virement_bancaire'. */
  mode_paiement: string;
  items: LineItem[];
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  delivery_status: DeliveryStatus;
  /** Mis à jour par functions/index.js:7609. */
  invoice_status: InvoiceStatus;
  created_by: ActorRef;
  validated_by_chef: ActorRef | null;
  validated_by_dg: ActorRef | null;
  history: HistoryEntry[];
  /** epoch ms — Date.now(), PAS un Timestamp. Voir §5.1. */
  created_at: number;
  updated_at: number;
}
```

#### `invoices`
`Doc ID : auto` · `Accès : D` · `Écrit par : functions/index.js:7598 ; functions/emailService.js:963`

```ts
export interface Invoice {
  /** 'FAC-…' */
  numero: string;
  numero_facture: string;
  bdc_id: string;
  bdc_numero: string;
  fournisseur: PurchaseOrder['fournisseur'];
  date_facture: DateString;
  date_saisie: DateString;
  items: LineItem[];
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  discrepancies: unknown[];
  has_discrepancies: boolean;
  payment_status: 'non_payee' | string;
  ferme: Ferme | string;
  created_by: ActorRef;
  scan_url: string | null;
  scan_id: string | null;
  history: HistoryEntry[];
  created_at: number;
  updated_at: number;
}
```

#### `delivery_notes`
`Doc ID : auto` · `Accès : D` · `Écrit par : functions/index.js:7439`

```ts
export interface DeliveryNote {
  /** 'BL-…' */
  numero: string;
  bdc_id: string;
  bdc_numero: string;
  fournisseur_nom: string;
  date_reception: DateString;
  numero_bl_fournisseur: string;
  items: Array<{
    article: string;
    quantite_commandee: number;
    quantite_recue: number;
    unite: string;
    ecart: number;
    note: string;
  }>;
  scan_url: string | null;
  scan_id: string | null;
  created_by: ActorRef;
  created_at: number;
  /** NOTE : cette collection n'a PAS de champ updated_at. */
}
```

#### `articles_catalog`
`Doc ID : reference` (ou `base64(nom|categorie)` tronqué à 50 à l'import, `functions/index.js:8199`) · `Accès : D` · `Écrit par : functions/index.js:8412 (set), :8398 (update), :8213/:8258 (batch)`

```ts
export interface ArticleCatalog {
  reference: string;
  nom: string;
  /** Défaut 'U'. */
  unite: string;
  prix_ht: number;
  /** Défaut 20. */
  taux_tva: number;
  prix_ttc: number;
  categorie: string;
  sous_categorie: string;
  type: string;
  reference_technique: string;
  multi_ferme: boolean;
  active: boolean;
  invisible: boolean;
  /** Posé à 0 uniquement par le batch d'import (functions/index.js:8261). */
  nb_achats?: number;
  created_at: number;
  updated_at: number;
  created_by: ActorRef;
  /** Posé par l'update (whitelist de champs, functions/index.js:8398). */
  updated_by?: ActorRef;
}
```

#### `suppliers`, `purchase_requests`, `bdc_change_requests`

```ts
/** Doc ID : auto · Accès D · functions/index.js:6727 (add), :6760 (update) */
export interface Supplier {
  nom: string;
  ice?: string;
  adresse?: string;
  ville?: string;
  tel?: string;
  email?: string;
  created_at?: number;
  updated_at?: number;
  [extra: string]: unknown;
}

/** Doc ID : auto · Accès D · functions/index.js:7291 (add), :7309/:7364 (update) */
export interface PurchaseRequest {
  numero?: string;
  status: string;
  ferme: Ferme | string;
  items: LineItem[];
  created_by: ActorRef;
  created_at: number;
  updated_at: number;
  [extra: string]: unknown;
}

/** Doc ID : auto · Accès D · functions/index.js:7108 (add), :7153/:7157 (update) */
export interface BdcChangeRequest {
  bdc_id: string;
  status: string;
  created_by: ActorRef;
  created_at: number;
  [extra: string]: unknown;
}
```

---

### 3.3 — Stock

#### `stock_movements`
`Doc ID : auto` · `Accès : B` · `Écrit par : functions/index.js:10675 (add), :7786 (consommation), :7461`

```ts
export interface StockMovement {
  /** 'BR-…' (réception) ou 'BS-…' (sortie). */
  numero: string;
  type: StockMovementType;
  /** Défaut : date du jour. */
  date: DateString;
  lieu_source: StockLocation | null;
  lieu_destination: StockLocation | null;
  ferme: Ferme | '';
  items: Array<{
    article_ref: string;
    article_nom: string;
    quantite: number;
    /** Défaut 'kg'. */
    unite: string;
    prix_unitaire?: number;
  }>;
  ref_bl_fournisseur: string;
  bdc_id: string | null;
  bl_id: string | null;
  reception_libre: boolean;
  reception_libre_motif: string;
  /** Absent de la variante consommation (functions/index.js:7780). */
  single_validation: boolean;
  ref_bon_physique: string;
  sortie_type: string | null;
  scan_url: string | null;
  fournisseur_nom: string | null;
  beneficiaire: string | null;
  motif_rebut: string | null;
  justificatif_url: string | null;
  /** 'en_attente_achats' si réception, sinon 'valide_chef'. */
  status: StockMovementStatus;
  validations: {
    magasinier: { by: string; name: string; at: number };
    [role: string]: { by: string; name: string; at: number };
  };
  rejection: unknown | null;
  created_by: ActorRef;
  created_at: number;
  updated_at: number;
  /** Présents uniquement sur la variante consommation (functions/index.js:7786). */
  bc_id?: string;
  bc_numero?: string;
}
```

#### `stock_balances`
`Doc ID : ${lieu_type}_${lieu_id}_${article_ref}` (espaces → `_`) · `Accès : B` · `Écrit par : functions/index.js:10156 (transaction, merge:true)`

```ts
export interface StockBalance {
  lieu_type: string;
  lieu_id: string;
  article_ref: string;
  article_nom: string;
  /** Défaut 'kg'. */
  unite: string;
  balance: number;
  updated_at: number;
}
```

> Le doc ID est reconstruit à la lecture (`functions/index.js:10623`) — il est donc
> **porteur de sens** et candidat à un template literal type (voir §5.6).

---

### 3.4 — Caisse & Trésorerie

#### `caisse_transactions`
`Doc ID : auto` · `Accès : B` · `Écrit par : functions/index.js:14871 (add), :14985/:15003/:15060 (update), :15112/:15122/:15285 (batch)`

Collection cœur du Sprint 3. **Snake_case ASCII strict** : ne jamais renommer ces
champs, ils sont consommés par toute la stack.

```ts
export interface CaisseTransaction {
  caisse_id: string;
  type: CaisseTxType;
  /** Toujours > 0 (validé serveur, functions/index.js:14846). */
  montant: number;
  /** Généré 'REF-<année>-<base36>' si non fourni. */
  reference: string;
  description: string;
  code_analytique: string;
  matricule: string;
  beneficiaire_nom: string;
  date: DateString;
  /** 'soumis' si submit=true à la création, sinon 'brouillon'. */
  status: CaisseStatus;
  /** Tronqué à 3 éléments maximum (functions/index.js:14861). */
  files: unknown[];
  saisie_by: ActorRef;
  /** serverTimestamp() — lu via `data.created_at?.toMillis?.() || data.created_at`. */
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
  history: HistoryEntry[];

  /** Écrits seulement si submit=true (functions/index.js:14866-14867). */
  soumis_par?: ActorRef;
  soumis_at?: FirestoreTimestamp;

  /** Posés par le workflow de contrôle. */
  valide_par?: ActorRef;
  valide_at?: FirestoreTimestamp;
  rejete_par?: ActorRef;
  rejete_at?: FirestoreTimestamp;

  /** Champs lus dans le rendu mais écrits par des chemins secondaires. */
  regularisations?: unknown[];
  anomalies_acceptees_par?: ActorRef;
  anomalies_acceptees_at?: FirestoreDateLike;
  quantite?: number;
  produit?: string;
  object?: string;
  lieu?: string;
  heure?: string;
  /** Clé d'idempotence, écrite par apply-encaissements uniquement. */
  idempotency_key?: string;
}
```

#### `caisse_definitions`
`Doc ID : slug (ex. 'caisse_paie', 'compte_client_<id>')` · `Accès : B` · `Écrit par : functions/index.js:14796 (add), :14812 (update)`

```ts
export interface CaisseDefinition {
  nom: string;
  description: string;
  solde_initial: number;
  solde_actuel: number;
  /** 'MAD'. */
  devise: string;
  is_default: boolean;
  active: boolean;
  created_by: ActorRef;
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
}
```

> Les comptes clients Marché Local sont des `caisse_definitions` dont l'ID commence
> par `compte_client_` (`functions/index.js:14896`) — convention implicite, non typée.
> IDs connus par ailleurs : `caisse_paie`, `caisse_depenses`,
> `caisse_marche_local_f1`, `caisse_marche_local_f5` (`public/app.jsx:58445`).

#### `tresorerie_items`
`Doc ID : auto` · `Accès : C (écriture client libre)` · `Écrit par : public/app.jsx:37079, suppression logique :37086`

```ts
export interface TresorerieItem {
  type: 'loyer' | 'echeance' | 'paie' | 'engagement' | string;
  libelle: string;
  beneficiaire: string;
  montant: number;
  recurrence: 'unique' | 'mensuelle';
  dateEcheance: DateString;
  jourDuMois: number;
  dateFin: DateString | '';
  /** Suppression logique : passe à false, le doc n'est jamais supprimé. */
  actif: boolean;
  createdAt?: FirestoreDateLike;
  createdBy?: ActorRef | string;
  updatedAt: FirestoreDateLike;
  updatedBy: ActorRef | string;
}
```

#### `encaissements_local`
`Doc ID : auto` · `Accès : D` · `Écrit par : public/app.jsx:19667`

```ts
export interface EncaissementLocal {
  date: DateString;
  client: string;
  montant: number;
  reference: string;
  source: 'manual' | 'canevas';
  /** string ISO — new Date().toISOString(), PAS un serverTimestamp. */
  createdAt: string;
}
```

Le module pur `public/lib/encaissementsCanevas.js` déclare le typedef le plus proche
d'un schéma formel du projet (l.37) pour la variante importée :

```ts
export interface EncaissementCanevas {
  type: 'encaissement';
  source: 'canevas';
  caisse_id: string;
  client_id: string;
  montant: number;
  date: DateString;
  mode: string;
  reference: string;
  reference_norm: string;
  motif: string;
  idempotency_key: string;
  version: number;
}
```

---

### 3.5 — RH / Paie / Pointage

Domaine le plus verrouillé du projet : la plupart des collections sont en niveau A
(CF-only strict) au titre des « Étapes sécu paie ».

#### `ouvriers_registry`
`Doc ID : matricule` · `Accès : A (CF-only strict)` · `Écrit par : functions/index.js:15905/:15932/:15976 (batch merge), :15873 (update)`

Lecture exclusivement via `/api/registry`, qui applique une **projection de champs**
selon le rôle (`functions/lib/auth/registryAccess.js:32-42` — whitelist `CHEF_FIELDS`
pour les chefs, document complet pour `dg`/`finance`/`rh`).

```ts
export interface OuvrierRegistry {
  matricule: string;
  nom?: string;
  declare?: boolean;
  /** Baseline d'ancienneté. */
  dateEmbauche?: DateString;
  anciennete?: number;
  fonction?: string;
  primeFonction?: number;
  ferme?: Ferme;
  updatedAt?: FirestoreDateLike;
  updatedBy?: ActorRef | string;
  [extra: string]: unknown;
}
```

#### `fonctions`
`Doc ID : id de fonction` · `Accès : B` · `Lu par : public/components/PrimesFixesTab.jsx:326`

```ts
export interface Fonction {
  /** Fallback sur doc.id si absent. */
  fonction_id?: string;
  libelle: string;
  ordre: number;
  /** Prime de référence. */
  prime?: number;
}
```

#### `pointage_validations`
`Doc ID : ${date}_${ferme}` — la ferme peut valoir `DIVERS` · `Accès : D` · `Écrit par : functions/index.js:5689, :5752, :5793`

```ts
export interface PointageValidation {
  date: DateString;
  ferme: FermeValidation | 'DIVERS';
  visaRH: ValidationVisa | null;
  visaCaporal: ValidationVisa | null;
  visaChef: ValidationVisa | null;
  /** Verrou d'écriture, lu côté client (public/app.jsx:17474). */
  locked: boolean;
  workerCount: number;
  snapshotId: string;
  rejected: boolean;
  rejectedBy: ActorRef | null;
  rejectedAt: number | null;
  rejectionComment: string | null;
  rejectionRole: string | null;
  /** Branche caporal uniquement (functions/index.js:5719). */
  pieceJointeUrl?: string;
}
```

#### `pointage_snapshots`
`Doc ID : ${date}_${ferme}` · `Accès : D` · `Écrit par : functions/index.js:5700`

Copie figée de `pointage_divers` au moment du visa, plus :

```ts
export interface PointageSnapshot extends PointageDivers {
  snapshotAt: number;
  snapshotBy: ActorRef;
}
```

#### `pointage_divers` et `pointage_divers_config`
`Doc ID : YYYY-MM-DD` / `auto` · `Accès : D` · `Écrit par : public/app.jsx:17505 et functions/index.js:6268 / public/app.jsx:17459 et functions/index.js:6112`

```ts
export interface PointageDiversEntry {
  configId: string;
  beneficiaire: string;
  matricule: string;
  fonction: string;
  tache: string;
  quantite: number;
  prixUnitaire: number;
  unite: string;
  montant: number;
  commentaire: string;
}

export interface PointageDivers {
  date: DateString;
  entries: PointageDiversEntry[];
  totalMontant: number;
  createdBy: ActorRef;
  updatedAt: FirestoreDateLike;
}

export interface PointageDiversConfig {
  beneficiaire: string;
  matricule: string;
  fonction: string;
  tache: string;
  prixUnitaire: number;
  /** Ex. 'VOYAGES'. */
  unite: string;
  active: boolean;
  createdAt: FirestoreDateLike;
  updatedAt: FirestoreDateLike;
}
```

#### `pointage_validations_equipe`
`Doc ID : YYYY-MM-DD` · `Accès : B` · `Écrit par : functions/index.js:5289`

Validation du pointage du jour **par équipe et par ferme**.

```ts
export interface PointageValidationEquipe {
  date: DateString;
  /** Clé = identifiant d'équipe ou de ferme. */
  [equipeOuFerme: string]: unknown;
}
```

#### `quinzaine_archive`
`Doc ID : label brut de quinzaine` (`functions/pointageService.js:67`) · `Accès : A` · `Écrit par : sqlSyncService.js, pointageService.js`

```ts
export interface QuinzaineArchive {
  /** Résumé persisté d'une quinzaine close. Forme dépendante du producteur. */
  [field: string]: unknown;
}
```

---

### 3.6 — Miroirs SQL & synchronisation

Toutes les collections `sql_mirror_*` partagent la même enveloppe
`{ rows, rowCount, syncedAt }` — seul le type de `rows[]` change. C'est le meilleur
candidat du projet à un **type générique**.

```ts
/** Enveloppe commune des miroirs SQL. */
export interface SqlMirrorDoc<TRow> {
  rows: TRow[];
  rowCount: number;
  syncedAt: FirestoreTimestamp;
}
```

#### `sql_mirror_pointage`
`Doc ID : YYYY-MM-DD` · `Accès : B` · `Écrit par : functions/sqlSyncService.js:778, :785 (batch)`

```ts
/** Schéma de ligne — functions/sqlSyncService.js:690-709. PascalCase_Underscore. */
export interface SqlPointageRow {
  Personnel_Matricule: string;
  Personnel_Nom: string;
  Operation_Famille: string;
  Operation: string;
  Operation_Groupe: string;
  Nombre_Jr: number;
  Nombre_Hr: number;
  Quantite_unite: number;
  Cout: number;
  Parcelle_Culturale: string;
  Ref_parcelle: string;
  Variete: string;
  Culture: string;
  Periode_paie: string;
  DateStr: DateString;
  /** Heures supplémentaires, 0 par défaut. */
  HS_25: number;
  HS_50: number;
  HS_100: number;
  HS_NM: number;
}

export interface SqlMirrorPointage extends SqlMirrorDoc<SqlPointageRow> {
  /** Présent UNIQUEMENT sur les dates patchées à la main (sqlSyncService.js:780). */
  manualOverride?: boolean;
}
```

#### `sql_mirror_consommation` (Doc ID `YYYY-MM`), `sql_mirror_cueillette` (`YYYY-MM-DD`)

```ts
/** functions/sqlSyncService.js:594 */
export interface SqlConsommationRow {
  Parcelle_Culturale: string;
  Parcelle_Physique: string;
  Culture: string;
  Ferme: string;
  Article: string;
  Article_Categorie: string;
  Quantite: number;
  Article_unite: string;
  Date: DateString;
  Parcelle_sup: number | null;
}
export type SqlMirrorConsommation = SqlMirrorDoc<SqlConsommationRow>;

/** functions/sqlSyncService.js:638 */
export interface SqlCueilletteRow {
  DateStr: DateString;
  Variete: string;
  Poids_total_kg: number;
  Nbre_Caisse: number;
  Operation_Famille: string;
  Parcelle_Culturale: string;
  Reference_Technique: string;
}
export type SqlMirrorCueillette = SqlMirrorDoc<SqlCueilletteRow>;
```

#### `sql_mirror_pointage_workers`
`Doc ID : matricule` · `Accès : A` · `Écrit par : functions/sqlSyncService.js:815, :983`

```ts
export interface SqlMirrorPointageWorkers extends SqlMirrorDoc<SqlPointageRow> {
  nom: string;
}
```

#### `sql_mirror_pointage_meta/config`
`Doc ID : 'config'` · `Accès : B` · `Écrit par : functions/sqlSyncService.js:798, :925`

```ts
export interface SqlMirrorPointageMetaConfig {
  periodes: string[];
  allPeriodes: string[];
  periodeMap: Record<string, string[]>;
  periodeCampagne: Record<string, string>;
  availableDates: DateString[];
  syncedAt: FirestoreTimestamp;
}
```

Second document connu : `sql_mirror_pointage_meta/br_parcelle_sup`
(`functions/pointageService.js:188`).

#### `prod_tracabilite_recolte`
`Doc ID : YYYY-MM-DD` (+ doc spécial `_status`, `functions/pointageService.js:2737`) · `Accès : B` · `Écrit par : functions/prodSyncService.js:112, :123`

Synchronisé toutes les 15 min depuis le SQL de production. Écouté en temps réel par
l'onglet Récolte (`public/app.jsx:7366`, listener *ping-only* avec debounce 2 s).

```ts
export interface ProdTracabiliteRecolte {
  rows?: unknown[];
  rowCount?: number;
  syncedAt?: FirestoreTimestamp;
  [field: string]: unknown;
}
```

---

### 3.7 — Production & Qualité

#### `pfq_interne`
`Doc ID : auto` (ou ID d'import pour le batch) · `Accès : C (lecture ET écriture client)` · `Écrit par : public/app.jsx:52855, :52917 (add), :55682/:55696/:55871/:55885 (transitions), :14885/:17387 (batch import)`

La collection la plus écrite depuis le navigateur (25 références). Bons d'apport /
PFQ, Export et Marché Local confondus.

```ts
export interface PfqInterne {
  source: 'scan_ocr' | 'manual_entry' | 'import_excel';
  /** Alias legacy : lu comme `b.bonApport || b.numeroPiece`. Voir §5.9. */
  bonApport: string;
  numeroPiece?: string;
  /** Alias legacy : lu comme `b.blocFerme || b.ferme`. */
  blocFerme: Ferme | string;
  ferme?: Ferme | string;
  produit: string;
  bloc: string;
  date: DateString;
  designation: string;
  /** Alias legacy : lu comme `b.variete || b.blocVariete`. */
  blocVariete: string;
  variete?: string;
  blocLabel: string;
  typeVente: 'Export' | 'Marché Local';
  client: string;
  typeUnite: string;
  nombreColis: number;
  qteParUnite: string | number;
  /** Alias legacy : lu comme `b.poidsLot || b.quantiteKg`. */
  poidsLot: number;
  quantiteKg?: number;
  /** null pour un bon Export (public/app.jsx:52902). */
  prixDH: number | null;
  totalDH: number | null;
  /** dataURL base64 stockée DANS le document — voir §5.8. */
  scanPhoto: string | null;
  status: PfqStatus;
  motifRejet: string;
  createdBy: { profileId: ProfileId | string; name: string };
  /** serverTimestamp(). Absent des updates d'édition (public/app.jsx:52915). */
  createdAt?: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  validatedByQualite: ActorRef | null;
  validatedByChef: ActorRef | null;
  validatedAtQualite: FirestoreTimestamp | null;
  validatedAtChef: FirestoreTimestamp | null;
  pfqGlobal: number | null;
  barquettes: unknown[];
  totalFruits: number;
  semaine: string;
  confection: string;
  controleur: string;
}
```

#### `bons_marche_local`
`Doc ID : auto` · `Accès : D` · `Écrit par : public/app.jsx:19398 (add), :49691 (update DG)`

```ts
export interface BonMarcheLocal {
  date: DateString;
  client: string;
  ferme: Ferme | string;
  designation: string;
  variete: string;
  poidsLot: number;
  prixDH: number;
  totalDH: number;
  typeVente: 'Marché Local';
  sousType: 'ECRT Vrac' | string;
  status: MarcheLocalStatus;
  source: 'manual';
  createdBy: ActorRef | string;
  /** string ISO — PAS un serverTimestamp (public/app.jsx:19396). */
  createdAt: string;
}
```

#### `marche_local_prix_validations`
`Doc ID : auto` · `Accès : D` · `Écrit par : public/app.jsx:19403, :49683`

```ts
export interface MarcheLocalPrixValidation {
  bonId: string;
  client: string;
  designation: string;
  date: DateString;
  ferme: Ferme | string;
  quantiteKg: number;
  newPrix: number;
  previousPrix: number;
  totalDH: number;
  status: 'en_attente' | 'valide_dg' | 'rejete_dg';
  requestedBy: ActorRef | string;
  requestedAt: FirestoreDateLike;
  resolvedBy: ActorRef | string | null;
  resolvedAt: FirestoreDateLike | null;
  comment: string;
}
```

> L'écriture de la validation (`:49683`) et la mise à jour du statut du bon
> (`:49691`) ne sont **ni en batch ni en transaction** — voir §5.10.

#### `clients_marche_local`
`Doc ID : auto` · `Accès : C` · `Écrit par : public/app.jsx:52604`

```ts
export interface ClientMarcheLocal {
  nom: string;
  /** epoch ms — Date.now(). */
  createdAt: number;
  createdBy: { profileId: ProfileId | string; name: string };
  /** Jamais écrit par le client ; filtré côté code (public/app.jsx:44-60). */
  archived?: boolean;
}
```

#### `expeditions`
`Doc ID : receiptId`, ou `${receiptId}__${batchSlug}`, ou suffixe `__2`/`__3` en cas de collision · `Accès : B` · `Écrit par : functions/emailService.js:2221, :1970 (merge), :3080, :4089, :4259, :4360`

```ts
export interface Expedition {
  receiptId: string;
  batchNumber: string | null;
  berryType: string | null;
  berryTypeFr: string | null;
  variety: string | null;
  itemDescription: string | null;
  batchWeight: number;
  batchQuantity: number;
  totalFruitInspected: number;
  brix: number | null;
  pfqBrix: number;
  brixFromDQR: number;
  enrichedPqScore: number;
  initialPq: number;
  reInspectionPq: number;
  pqScore: number;
  pfqTotal: number;
  pfqCondition: number;
  pfqApparence: number;
  overallResult: string;
  inspectionType: string | null;
  ranch: string | null;
  ranchName: string | null;
  /** 'DQR reçu'. */
  status: string;
  source: 'dqr-auto-created' | string;
  dateISO: DateString;
  date: DateString;
  /** string ISO — convention camelCase + ISO propre à ce domaine. Voir §5.1 et §5.2. */
  createdAt: string;
  updatedAt: string;
}
```

#### `ventes_plastique`, `scan_corrections`

```ts
/** Doc ID : auto · Accès D · public/app.jsx:54341 */
export interface VentePlastique {
  date: DateString;
  typePlastique: string;
  quantiteKg: number;
  acheteur: string;
  prixKg: number;
  totalDH: number;
  notes: string;
  createdAt?: FirestoreDateLike;
  createdBy?: { profileId: ProfileId | string; name: string };
  updatedAt: FirestoreDateLike;
  updatedBy: { profileId: ProfileId | string; name: string };
}

/** Doc ID : auto · Accès C · public/app.jsx:53236 — auto-apprentissage OCR */
export interface ScanCorrection {
  corrections: {
    variete?: { from: string; to: string };
    ferme?: { from: string; to: string };
    confection?: { from: string; to: string };
  };
  originalVariete: string;
  correctedVariete: string;
  correctedFerme: string;
  correctedConfection: string;
  timestamp: FirestoreDateLike;
}
```

---

### 3.8 — Agronomie & Irrigation

#### `analyses_foliaires`
`Doc ID : auto`, ou `${ferme}_${VARIETE}` par l'autre voie (`functions/index.js:9151`) · `Accès : D` · `Écrit par : functions/index.js:9194, :9280, :9379 ; functions/emailService.js:2600`

```ts
export interface AnalyseFoliaire {
  /** 'AF-…' */
  numero: string;
  ferme: Ferme | string;
  parcelle: string | null;
  /** Inférée à partir de la parcelle. */
  culture: string | null;
  type_analyse: 'foliaire' | string;
  variete: string | null;
  phenologie: string | null;
  source: 'manual' | string;
  statut: 'demandee' | string;
  /** epoch ms. */
  date_demande: number;
  date_prelevement: DateString | null;
  date_resultat: DateString | null;
  bdc_id: string | null;
  photo_parcelle_url: string | null;
  scan_resultat_url: string | null;
  note_demande: string;
  recommandations_ia: unknown[];
  history: HistoryEntry[];
  created_by: ActorRef;
  created_at: number;
  updated_at: number;
}
```

#### `irrigation_readings`
`Doc ID : auto` · `Accès : C` · `Écrit par : public/app.jsx:30192 (saisie), :31186 (import OCR), :30750 (update) ; functions/lib/netafim/dataAccess.js:34 (batch)`

```ts
export interface IrrigationPoint {
  label: string;
  ec: number;
  ph: number;
  volume: number;
}

export interface IrrigationReading {
  date: DateString;
  ferme: Ferme | string;
  parcelle: string;
  heure: string;
  duree: number | string;
  points: IrrigationPoint[];
  drainage: IrrigationPoint[];
  createdBy: ActorRef | string;
  /** epoch ms. */
  createdAt: number;
  updatedAt: number;
  /** Voie import OCR uniquement (public/app.jsx:31186). */
  parcelleLabel?: string;
  source?: 'scan_ocr';
  scanPhoto?: string | null;
}
```

#### `growth_measurements` / `growth_plot_config`
`Accès : B (écriture CF, rôle `agronomie` requis — functions/index.js:1147-1155)`

```ts
export interface GrowthMeasurement {
  parcelle?: string;
  date?: DateString;
  checkpoints?: unknown[];
  [field: string]: unknown;
}

export interface GrowthPlotConfig {
  [field: string]: unknown;
}
```

#### `netafim_parcelles_bahia`
`Doc ID : id de parcelle` · `Accès : B (écriture cron)` · `functions/lib/netafim/parcelles.js:14`

```ts
export interface NetafimParcelleBahia {
  id: string;
  label: string;
  [extra: string]: unknown;
}
```

---

### 3.9 — Référentiels parcelle / ferme

#### `parcelle_ferme_referentiel` et `..._meta`
`Accès : A (CF-only strict, dans les deux sens)` · `functions/lib/pointage/referentielSync.js:29-30 ; functions/pointageService.js:4731, :4799`

Alimente le cloisonnement ferme *fail-closed*. Une lecture client directe
court-circuiterait le filtre — d'où le `read: false`.

```ts
export interface ParcelleFermeReferentiel {
  parcelle?: string;
  ferme?: Ferme | string;
  culture?: string;
  [field: string]: unknown;
}

/** Doc ID : 'state' */
export interface ParcelleFermeReferentielMeta {
  [field: string]: unknown;
}
```

#### `sb_parcelle_referentiel`
`Accès : D (non déclaré ⇒ CF-only)` · `functions/pointageService.js:4207 et 9 autres sites`

```ts
export interface SbParcelleReferentiel {
  /** Culture Smart Berry ; prioritaire sur la culture BEE ONE. */
  culture_sb?: string;
  nom_sb?: string;
  ferme?: Ferme | string;
  [field: string]: unknown;
}
```

> Règle métier : la culture d'une parcelle se lit dans `culture_sb` **si défini**,
> sinon par normalisation du libellé BEE ONE — **jamais** depuis `nom_sb`.

#### `sb_parcelle_groupes`
`Accès : B (écriture via pointageRH?action=sb-groupe-save, gate DG/RH/admin)`

```ts
export interface SbParcelleGroupe {
  nom?: string;
  parcelles?: string[];
  /** Un groupe ne mélange jamais deux cultures. */
  culture?: string;
  [field: string]: unknown;
}
```

#### `sb_campagne_budget_jh`
`Accès : A (CF-only strict)` · `functions/pointageService.js`

Budget JH/Ha par **parcelle × famille d'opération**, campagne dans la clé.

```ts
export interface SbCampagneBudgetJh {
  campagne?: string;
  parcelle?: string;
  famille?: string;
  jh_ha?: number;
  [field: string]: unknown;
}
```

#### `parcelles_consommation`, `mapping_campagne`, `parcelles_culturales_charge`
`Accès : B` · `functions/index.js:1256-1258, batch.set :1289 et :1301` · Lus en temps réel par `public/components/MagMappingConsoTab.jsx:197, :212`

```ts
export interface ParcelleConsommation {
  id?: string;
  libelle?: string;
  [field: string]: unknown;
}

export interface MappingCampagne {
  campagne: string;
  /** Clé de jointure vers parcelles_consommation. */
  parcelle_conso_id: string;
  [field: string]: unknown;
}

export interface ParcelleCulturaleCharge {
  [field: string]: unknown;
}
```

---

### 3.10 — E-mail & intégrations

#### `emails`
`Doc ID : messageId sanitisé` (`[^a-zA-Z0-9_-]` → `_`, tronqué à 200) ; fallbacks `uid-<uid>`, `bulk-<uid>-<n>`, `${baseId}_att${i}` · `Accès : D` · `Écrit par : functions/emailService.js:1564, :1735-1829, :2902, :3393-4006`

```ts
export interface EmailDoc {
  messageId: string;
  uid: number;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  /** string ISO. */
  date: string;
  receivedAt: string;
  /** Tronqué à 50 000 caractères. */
  textBody: string;
  /** Tronqué à 100 000 caractères. */
  htmlBody: string;
  hasAttachments: boolean;
  attachments: Array<{ filename: string; contentType: string; size: number }>;

  /** Pièces jointes décodées, présentes selon le type d'e-mail détecté. */
  xlsxBase64?: string | null;
  pdfBase64?: string | null;
  liqSummaryPdfBase64?: string | null;
  gssPdfBase64?: string | null;
  timacInvoicePdfBase64?: string | null;
  agqPdfAttachments?: Array<{ filename: string; size: number; contentBase64: string }> | null;

  /** Drapeaux de classification. */
  isDailyQualityReport: boolean;
  isLiquidation: boolean;
  isWeeklyQualityReport: boolean;
  isAgqAnalysis: boolean;
  isDriscolsReport: boolean;
  isTimacInvoice: boolean;

  status: 'pending' | 'analyzing' | 'analyzed' | 'error';
  analysisError: string | null;
  extractedTablesRaw: unknown[];

  /** Conditionnels (functions/emailService.js:1746-1748, :1719, :1813). */
  isBulkWrapper?: boolean;
  bulkExtractedCount?: number;
  bulkParentUid?: number;
  retryCount?: number;
}
```

#### `email_extractions`
`Doc ID : identique au doc `emails`` · `Accès : D` · `Écrit par : functions/emailService.js:2732`

```ts
export interface EmailExtraction {
  emailId: string;
  /** string ISO. */
  analyzedAt: string;
  category: 'order' | 'invoice' | 'report' | 'notification' | string;
  summary: string;
  structuredData: {
    tables?: Array<{
      tableIndex: number;
      headers: unknown[];
      rowCount: number;
      /** Tronqué à 100 lignes. */
      rows: string[];
    }>;
    [field: string]: unknown;
  };
  confidence: 'high' | 'medium' | 'low';
  expeditionId: string | null;
}
```

---

### 3.11 — WhatsApp, notifications & suivi

#### `alerts`
`Doc ID : auto` · `Accès : D` · `Écrit par : functions/emailService.js:2298, :4958 ; functions/notificationDispatcher.js:235 ; update functions/index.js:14511`

Le champ `profiles` est indexé en `array-contains` + `createdAt`
(`firestore.indexes.json:84-91`) : c'est le mécanisme de diffusion par rôle.

```ts
export interface Alert {
  /** Profils destinataires. Une alerte avec profiles: [] n'atteint personne. */
  profiles: Array<ProfileId | string>;
  createdAt: FirestoreDateLike;
  title?: string;
  message?: string;
  read?: boolean;
  [field: string]: unknown;
}
```

#### `bug_reports`
`Doc ID : auto` · `Accès : B (écriture via /api/bug-reports uniquement)` · Le frontend n'y accède **jamais** directement (`public/components/BugReportButton.jsx:119`)

```ts
export interface BugReport {
  status: 'new' | 'qualified' | 'resolved' | string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  /** Le triage IA distingue un bug d'une demande d'évolution. */
  type?: 'bug' | 'feature_request';
  description?: string;
  reporter?: ActorRef | string;
  createdAt?: FirestoreDateLike;
  [field: string]: unknown;
}
```

#### `evolution_requests`
`Doc ID : auto` · `Accès : C` · `Écrit par : public/app.jsx:65493, updates :65522/:65528/:65542/:65570`

```ts
export interface EvolutionRequest {
  profileId: ProfileId | string;
  text: string;
  priority: 'normale' | 'haute' | 'basse' | string;
  done: boolean;
  createdAt: FirestoreTimestamp;
  createdBy: ActorRef | string;
  deliveredAt: FirestoreDateLike | null;
  remarqueDG?: string;
}
```

#### `whatsapp_sessions`, `whatsapp_logs`, `whatsapp_messages`

```ts
/** Doc ID : numéro de téléphone · Accès A (privé, server-only) */
export interface WhatsappSession {
  /** État conversationnel du bot. Forme variable selon le bot
   *  (chefBdcBot, dgBot, magasinierBot, securityBot). */
  [field: string]: unknown;
}

/** Doc ID : auto · Accès B */
export interface WhatsappLog {
  to?: string;
  template?: string;
  status?: string;
  error?: string;
  createdAt?: FirestoreDateLike;
  [field: string]: unknown;
}
```

> Rappel métier : toute notification **proactive** doit passer par
> `sendTemplateMessage` (ex. `general_alert`). Un message free-form est droppé
> silencieusement par Meta hors de la fenêtre de 24 h.

#### `tasks`
`Doc ID : auto` · `Accès : C` · `Écrit par : functions/index.js:13056 (add), :13079/:13097 (update), :13212 (batch)`

```ts
export interface Task {
  titre?: string;
  status?: string;
  assigneA?: ActorRef | string;
  ferme?: Ferme | string;
  createdAt?: FirestoreDateLike;
  [field: string]: unknown;
}
```

---

### 3.12 — Sécurité (agents terrain)

Cinq collections. Les trois premières sont en **niveau C** (écriture client directe),
les deux dernières sont écrites par le webhook WhatsApp.

```ts
/** Doc ID : auto · Accès C · public/app.jsx:33204 */
export interface SecurityMouvement {
  date: DateString;
  ferme: Ferme | string;
  type: 'entree' | 'sortie' | string;
  nom: string;
  cin: string;
  heure: string;
  vehicule: string;
  motif: string;
  observations: string;
  geo: unknown;
  createdBy: ActorRef | string;
  /** epoch ms. */
  createdAt: number;
}

/** Doc ID : auto · Accès C · public/app.jsx:33447 (batch.set) */
export interface SecurityScanRegistre {
  date: DateString;
  ferme: Ferme | string;
  page: number;
  /** dataURL base64 stockée DANS le document — voir §5.8. */
  photo: string;
  fileName: string;
  geo: unknown;
  createdBy: ActorRef | string;
  createdAt: number;
}

/** Doc ID : auto · Accès C · public/app.jsx:33654 (delete-then-add pour l'unicité) */
export interface SecurityTunnelPhoto {
  date: DateString;
  ferme: Ferme | string;
  tunnel: string;
  /** dataURL base64. */
  photo: string;
  geo: unknown;
  createdBy: ActorRef | string;
  createdAt: number;
}

/** Doc ID : auto · Accès B · écrit par le webhook (functions/securityBot.js) */
export interface SecurityEnvoiRegistre {
  ferme?: Ferme | string;
  date?: DateString;
  [field: string]: unknown;
}

/** Doc ID : auto · Accès B · écrit par le webhook */
export interface SecurityIncident {
  ferme?: Ferme | string;
  date?: DateString;
  description?: string;
  [field: string]: unknown;
}
```

---

## §4 — Catalogue des collections secondaires

Collections à faible trafic (caches, journaux, snapshots, configurations
ponctuelles, tables d'import). Elles sont typées de façon compacte : leur contenu
est soit un enregistrement opaque produit par un seul job, soit une structure
purement dérivée. **Les typer finement n'apporterait rien à la migration** —
en revanche, elles doivent exister dans le catalogue pour qu'on sache qu'elles
sont là.

### Achats / fournisseurs
| Collection | Accès | Doc ID | Nature |
|---|---|---|---|
| `bdc_mirror` | D | miroir de `purchase_orders` | `functions/bdcMirrorService.js:27`, batch.set l.155 |
| `consultations` | D | auto | Consultations fournisseurs |
| `demandes_virement` | D | auto | Demandes de virement liées aux BDC |
| `invoice_scans`, `bl_scans` | D | auto | Scans rattachés |
| `supplier_imports` | D | auto | Journal d'import fournisseurs |
| `article_delete_requests`, `article_merges`, `mapping_articles` | D | auto | Gouvernance du catalogue articles |

### Stock
| Collection | Accès | Doc ID | Nature |
|---|---|---|---|
| `stock_requests` | B | auto | Demandes de sortie |
| `stock_config` | D | `counters`, `locations` | Compteurs de numérotation + lieux |
| `stock_caneva_imports` | D | auto | `functions/index.js:10243` |
| `stock_file_submissions` | D | auto | `functions/lib/stockFiles/recordSubmission.js:22` |
| `consumption_vouchers` | D | auto | Bons de consommation |
| `consumption_costs_by_variety` | B | auto | Coûts conso par variété (import script) |

### Caisse / budget
| Collection | Accès | Doc ID | Nature |
|---|---|---|---|
| `caisse_rapprochements` | D | `${caisse_id}_${periode.docId}` | Sprint 3 — rapprochement |
| `caisse_backups` | D | auto | Sauvegardes de caisse |
| `budgets` | B | auto | Budgets (lecture client) |
| `budget_entries`, `budget_imports` | D | `${season}_${ferme}_${category}` | `functions/index.js:12568, :12654` |
| `budget_curves` | D | `${season}_${ferme}_${variete}` | `functions/index.js:12593, :12727` |
| `budget_seasons` | D | auto | Référentiel de campagnes |
| `cpc_snapshots` | B | slug (ex. `fuel`) | Snapshots du tableau CPC |

### RH / paie
| Collection | Accès | Doc ID | Nature |
|---|---|---|---|
| `ojra_payroll` | D | `${periodKey}__${matricule\|nom}` (≤200) | `functions/index.js:13970`, batch l.14030 |
| `ojra_period_totals` | D | auto | Totaux par période |
| `transport_config`, `transport_config_changes` | D | auto | Config transport + journal (indexé sur `status`) |
| `referentiel_taches` | D | auto | Référentiel des tâches |
| `normes-productivite` | D | `tache` (avec `_`) | `functions/index.js:12368`, batch l.12467 |
| `normes-historique` | D | auto | Historique des normes |

### Synchronisation / sondes
| Collection | Accès | Doc ID | Nature |
|---|---|---|---|
| `sql_sync_status` | B | slug | État de la synchro |
| `replication_probe`, `replication_probe_analysis`, `replication_probe_state` | D | auto | Sonde de fraîcheur (`functions/sqlSyncService.js`) |
| `sql_mirror_pointage_bdp_test` | D | date | Bascule BDR → BDP (`functions/pointageBdpSync.js:250`) |
| `prod_presence` | D | `YYYY-MM-DD` | Présence de production |
| `api_cache` | B | clé de cache | `functions/middleware/cache.js:53` |
| `api_metadata` | D | `ojra`, `telecom` | Curseurs d'import |
| `_health` | D | — | Sonde de santé |

### Agronomie / météo / prévision
| Collection | Accès | Doc ID | Nature |
|---|---|---|---|
| `avancement_culture` | D | nom de parcelle (`/` → `_SLASH_`) | `functions/index.js:1046, :1061` |
| `parcelles-config` | D | `${ferme}_${parcelle}` | `functions/index.js:12256, :12491` |
| `parcelle_irrigation_meta` | D | auto | `functions/lib/irrigation/parcelleMeta.js:126` |
| `irrigation_intelligence_snapshots` | D | auto | `functions/lib/irrigation/dataAccess.js:8` |
| `config_analytique`, `config_irrigation` | D | slug | Configurations de domaine |
| `phenology_references` | D | auto | `functions/lib/phenology/referenceLoader.js:24` |
| `gdd_tracking` | D | auto | Cumuls de degrés-jours |
| `variete_contextes` | D | auto | Contexte par variété |
| `plots` | D | plotId | Parent de la sous-collection `phenology_daily` |
| `meteo_outdoor` | D | `${date}_${ferme}` | Indexé sur la ferme |
| `meteo_history`, `meteoblue_cache` | D | `${lat}_${lon}_${pkg}` | Cache Meteoblue |
| `farmroad_cache`, `farmroad_stations`, `farmroad_history` | D | `${lat}_${lon}_${pkg}` | Cache Farmroad |
| `weather_forecast` | D | — | Sous-collection de `farms/larache` |
| `harvest_predictions`, `forecast_model`, `forecast_accuracy`, `climat_models`, `indoor_forecasts` | D | auto | Modèles de prévision |

### Qualité / production
| Collection | Accès | Doc ID | Nature |
|---|---|---|---|
| `liquidations` | B | auto | `functions/emailService.js:2444, :4802` |
| `liquidation_forecasts` | B | auto | Prix prévisionnels Driscoll's |
| `weekly_quality_reports` | D | auto | Rapports qualité hebdo |
| `productivity_reports` | B | auto | Classement F1 (172) / F5 (195) — filtrage UI-side |
| `ecarts_pesages`, `ecarts_config`, `ecarts_data` | D | auto / date | Écarts de pesée |
| `bons_apport`, `bons_apport_saisie` | D / C | auto | Bons d'apport (indexé ferme+status+createdAt) |
| `pfq_interne` | C | auto | Voir §3.7 |
| `suivi-hors-recolte`, `-demandes`, `-cumul` | D | `YYYY-MM-DD` | Voir sous-collections §5.7 |
| `plant_invoices`, `plants_allocation_config` | D | auto / invoiceId | Factures de plants |

### Divers
| Collection | Accès | Doc ID | Nature |
|---|---|---|---|
| `validations` | B | auto | Validations génériques |
| `notifications` | B | auto | Notifications in-app |
| `admin_alerts` | D | auto | Alertes techniques |
| `farm_todos`, `meeting_crs` | D | auto | Todos ferme, comptes rendus |
| `email_config` | D | `settings`, `variety_mapping` | Config e-mail |
| `serre_data` | D | — | Sous-collection de `farms/larache` |
| `fuel_transactions` | D | `${carte}_${ticket}_${date}` | `functions/index.js:13282`, batch l.13631 |
| `telecom_bills` | D | `${ligne}_${periode}` | `functions/index.js:13708`, batch l.13883 |

```ts
/** Forme générique des collections du §4 non détaillées ci-dessus. */
export type OpaqueDoc = Record<string, unknown>;
```

---

## §5 — Notes, edge cases et pièges de migration

### 5.1 — Trois représentations de date coexistent

C'est **le principal piège** de cette migration. Le même concept (« date de
création ») est stocké de trois façons incompatibles selon le domaine :

| Forme | Collections | Exemple |
|---|---|---|
| `serverTimestamp()` → `Timestamp` | `caisse_transactions`, `caisse_definitions`, `pfq_interne`, `evolution_requests`, `sql_mirror_*` | `functions/index.js:14862` |
| `number` epoch ms (`Date.now()`) | `purchase_orders`, `invoices`, `delivery_notes`, `stock_movements`, `stock_balances`, `users`, `analyses_foliaires`, `irrigation_readings`, `security_*`, `clients_marche_local` | `functions/index.js:10671` |
| `string` ISO | `expeditions`, `emails`, `bons_marche_local`, `encaissements_local`, `email_extractions` | `public/app.jsx:19396` |

Le code lit **déjà** défensivement et devra continuer :

```js
// functions/index.js:14834
created_at: data.created_at?.toMillis?.() || data.created_at
```

```js
// public/app.jsx:55668-55670 — le tri gère Timestamp ET string ISO
```

**Recommandation** : plutôt qu'un type unique, exposer un helper et le typer
strictement :

```ts
export function toMillis(v: FirestoreDateLike | null | undefined): number | null;
```

Ne **pas** normaliser les données en base pendant la migration TS : ce serait une
migration Firestore (action *gated*), pas un changement de typage.

### 5.2 — Quatre conventions de nommage cohabitent

| Convention | Domaine | Exemple |
|---|---|---|
| `snake_case` | Achats, stock, caisse | `code_analytique`, `bdc_id`, `created_at` |
| `camelCase` | E-mails, expéditions, pointage, frontend | `receivedAt`, `bonApport`, `poidsLot` |
| `PascalCase_Underscore` | Miroirs SQL (repris tels quels de BEE ONE) | `Personnel_Matricule`, `Nombre_Jr`, `HS_25` |
| `kebab-case` | **Noms de collection** | `normes-productivite`, `parcelles-config`, `suivi-hors-recolte` |

Les interfaces doivent refléter la convention **réelle** de chaque collection.
Uniformiser serait une migration de données, pas un typage.

### 5.3 — Les champs `*_by` sont des objets, jamais des strings

`saisie_by`, `soumis_par`, `valide_par`, `rejete_par`, `created_by`, `createdBy`,
`validated_by_chef`… contiennent `{uid, profileId, name, email}` — **pas** un userId.
Le piège est aggravé par deux variantes :

- le backend écrit parfois `userId` au lieu de `uid`
  (`functions/index.js:10667` : `{ by: movCreatedBy.userId || "", … }`) ;
- le frontend écrit souvent un objet réduit `{profileId, name}`
  (`public/app.jsx:52847`).

D'où `ActorRef` avec `uid?` **et** `userId?`, tous deux optionnels.

### 5.4 — `soumis` ne doit jamais être renommé

Le code DB est `soumis`, le libellé affiché est « Saisi » (`STATUS_LABELS`,
`public/app.jsx:58466`). Le workflow `submit-transaction` / `validate-transaction`
dépend du code. Le renommer casserait la stack entière.

### 5.5 — Deux écritures ne sont pas typables

1. `functions/backupService.js:95` et `:161` écrivent sur
   `db.collection(collectionName)` où `collectionName` provient d'une liste de
   sauvegarde — cette fonction touche **potentiellement toutes** les collections.
2. `functions/index.js:9699`, `:9751`, `:9884` — endpoint générique d'inspection,
   la collection vient de la requête HTTP.

Ces deux chemins doivent rester typés `Record<string, unknown>`. Ne pas essayer de
les contraindre : la contrainte serait fausse.

### 5.6 — Les doc IDs sont porteurs de sens

Aucune convention unique. Les schémas observés méritent des *template literal types* :

| Schéma | Collections |
|---|---|
| `YYYY-MM-DD` | `pointage_divers`, `prod_presence`, `prod_tracabilite_recolte`, `sql_mirror_pointage`, `sql_mirror_cueillette`, `pointage_validations_equipe` |
| `YYYY-MM` | `sql_mirror_consommation` |
| `${date}_${ferme}` | `pointage_validations`, `pointage_snapshots` (ferme peut valoir `DIVERS`) |
| `${lieu_type}_${lieu_id}_${article_ref}` | `stock_balances` |
| `${season}_${ferme}_${category}` | `budget_entries`, `budget_imports` |
| `${season}_${ferme}_${variete}` | `budget_curves` |
| `${lat}_${lon}_${pkg}` | `meteoblue_cache`, `farmroad_cache` |
| `${ferme}_${parcelle}` | `parcelles-config` |
| matricule | `ouvriers_registry`, `sql_mirror_pointage_workers` |
| UID Firebase Auth | `users` |
| `reference` article | `articles_catalog` |
| nom de parcelle, `/` → `_SLASH_` | `avancement_culture` |

Exemple :

```ts
export type PointageValidationId = `${DateString}_${FermeValidation | 'DIVERS'}`;
```

### 5.7 — Sous-collections : 7 seulement, dont 4 sous un parent codé en dur

**Aucun `collectionGroup` dans tout le projet** — les sous-collections ne sont donc
jamais interrogées transversalement.

| Chemin | Site |
|---|---|
| `farms/larache/serre_data/{…}` | `functions/index.js:3772` |
| `farms/larache/harvest_predictions/{…}` | `functions/index.js:4576, :5027` |
| `farms/larache/weather_forecast/{…}` | `functions/index.js:4655` |
| `farms/larache/ecarts_data/{YYYY-MM-DD}` | `functions/index.js:11967` |
| `plots/{plotId}/phenology_daily/{YYYY-MM-DD}` | `functions/index.js:16726, :16742` |
| `suivi-hors-recolte/{date}/saisies/{ferme_parcelle_tache_caporal}` | `functions/index.js:11971, :12008` |
| `suivi-hors-recolte/{date}/rendements/{ferme_tache}` | `functions/index.js:12036, :12284` |

> `farms/larache` est **codé en dur** : un unique document parent porte quatre
> sous-collections. Ce n'est pas un modèle multi-ferme, malgré le nom.
>
> Conséquence règles : aucune de ces sous-collections n'est déclarée dans
> `firestore.rules` (les `match` y sont tous de premier niveau) ⇒ toutes en niveau D.

### 5.8 — Des images base64 sont stockées dans les documents

`security_scan_registre.photo`, `security_tunnel_photos.photo` et
`pfq_interne.scanPhoto` contiennent des **dataURL base64**, alors que
`firebase-storage-compat.js` est chargé (`public/index.html:29`) et que
`storage.rules` prévoit déjà les préfixes `scans/**` et `stock_files/**`.

Risque : la limite Firestore est de **1 Mo par document**. Une photo de téléphone
non redimensionnée dépasse ce seuil une fois encodée en base64 (+33 %). À typer
`string` pour l'instant, mais c'est une dette à signaler.

### 5.9 — Champs legacy à double lecture

Le rendu lit systématiquement deux noms pour le même concept, signe d'une
renommage historique non migré :

```js
b.bonApport || b.numeroPiece
b.blocFerme || b.ferme
b.poidsLot  || b.quantiteKg
b.variete   || b.blocVariete
```

Les deux champs sont donc modélisés, l'ancien en `?` avec un commentaire
« alias legacy ». Ne pas en supprimer un sans vérifier la base.

### 5.10 — Écritures couplées non atomiques

Deux séquences modifient deux documents sans batch ni transaction :

- `public/app.jsx:49683` → `:49691` — validation du prix puis statut du bon ;
- `public/app.jsx:33652` → `:33654` — `delete` puis `add` d'une photo de tunnel
  (pour garantir l'unicité tunnel × date).

Une interruption entre les deux laisse la base incohérente. Hors périmètre du
typage, mais à connaître avant de refactorer ces chemins.

### 5.11 — Lectures de collection entière sans filtre

`pfq_interne.get()` (`public/app.jsx:82`, `:96`), `bons_marche_local.get()`
(`:34019`, `:35037`), `clients_marche_local.get()` (`:49`),
`tresorerie_items.onSnapshot()` (`:36938`), `plants_allocation_config.get()`
(`:35444`) — aucun `where`, aucun `limit`. Compensé par un cache mémoire ad hoc de
2 min et un compteur serveur (`app_settings/pfq_import_meta.lastImportCount`).

### 5.12 — 35 collections ont une règle `read` sans lecteur

`firestore.rules` ouvre la lecture à ~37 collections dont **~35 ne sont jamais lues
directement par le client** — l'accès passe par l'API. Cas emblématique :
`bug_reports` est lisible en `read: auth != null` alors que le frontend passe
exclusivement par `/api/bug-reports`.

Ce sont des permissions accordées sans usage. À retirer, ou à conserver
sciemment — mais pas par défaut.

### 5.13 — Les index composites révèlent des collections absentes des règles

`firestore.indexes.json` (30 index) indexe `purchase_orders`, `alerts`,
`transport_config_changes`, `analyses_foliaires` et `meteo_outdoor` — **aucune**
n'est déclarée dans `firestore.rules`. Utile pour la déduction de schéma : l'index
confirme les champs de filtrage (`status`, `ferme`, `createdAt`, `profileId`) et,
pour `alerts`, que `profiles` est bien un tableau interrogé en `array-contains`.

### 5.14 — Le frontend ne « parle » pas vraiment à Firestore

29 collections en accès direct contre ~150 endpoints `fetch('/api/…')`. La majorité
du modèle de données ne transite **jamais** par le SDK client : elle arrive en JSON
via les Cloud Functions, souvent déjà transformée (`created_at` converti en ms par
`functions/index.js:14834`, projection de champs par
`functions/lib/auth/registryAccess.js`).

**Conséquence pour la migration** : les interfaces ci-dessous décrivent la forme
**en base**. Le frontend, lui, reçoit fréquemment une forme *dérivée*. Il faudra
probablement deux familles de types — `XxxDoc` (base) et `XxxDTO` (réponse API) —
plutôt que de forcer les deux dans une seule interface.

---

## §6 — Annexe : observations de sécurité (hors périmètre)

Relevées pendant l'analyse des règles d'accès (étape 4 de la demande). **Aucune
n'est traitée ici** — ce document ne modifie rien. Elles sont consignées parce que
les ignorer après les avoir vues serait pire que de les écrire.

1. **`sqlSyncTrigger` sans authentification** — `functions/sqlSyncService.js:1528`
   déclenche une synchronisation SQL complète, `Access-Control-Allow-Origin: *`.
   Deux autres `onRequest` du même fichier (`probeRawData:1440`,
   `probeAnalysisReport:1500`) sont également ouverts. Non exposés dans les
   `rewrites` de `firebase.json`, mais joignables sur l'URL `cloudfunctions.net`.
2. **Bypass d'authentification sur `/api/stock`** — `functions/index.js:6691` :
   `req.body.secret === ADMIN_SECRET` court-circuite Firebase Auth et fabrique
   `{uid:"admin-cli"}`, ce qui donne un périmètre `dg`/`admin` global via
   `functions/lib/auth/resolveRole.js:36`. Comparaison `===` non *constant-time* ;
   si `ADMIN_SECRET` est absent de l'environnement, `undefined === undefined` est
   vrai pour une requête sans champ `secret`.
3. **Webhook WhatsApp sans vérification de signature** — POST
   `/api/whatsapp-webhook` (`functions/index.js:16565-16576`) ne contrôle pas
   `X-Hub-Signature-256` ; le corps est publié tel quel sur Pub/Sub.
4. **Secrets lisibles par tout compte authentifié** — la collection `config` est en
   `read: auth != null` (`firestore.rules:266`) et contient
   `config/whatsapp.webhook_verify_token` (`functions/index.js:16555`) et
   `config/sentinel.shared_key` (`functions/index.js:1482`).
5. **Écriture libre sur des données sensibles** — `app_settings` (barèmes de paie),
   `rh_config` (primes de transport) et `tresorerie_items` (données Finance/DG) sont
   en `read, write: if request.auth != null` : n'importe quel compte connecté peut
   les modifier. Le filtrage par profil est purement UI.
6. **`storage.rules` — `data/**` en écriture libre** : lecture, écrasement et
   suppression ouverts à tout compte authentifié, alors que le commentaire du
   fichier annonce « RH/Achats uniquement » (`storage.rules:4`).
7. **Aucun custom claim** : chaque décision de rôle coûte une lecture
   `users/{uid}`, et la sécurité repose intégralement sur les Cloud Functions —
   jamais sur les Security Rules.

---

## Fichier compagnon

Les mêmes interfaces, compilables et importables : [`src/types/firestore.d.ts`](src/types/firestore.d.ts).
