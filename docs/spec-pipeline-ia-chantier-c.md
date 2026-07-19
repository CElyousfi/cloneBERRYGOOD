# Spec — Chantier C : Control plane Firestore + écran "Pipeline IA"

> Statut : spec prête, en attente de GO explicite d'Omar. Autosuffisant — un
> autre archi (ou le même dans une nouvelle session) doit pouvoir implémenter
> directement sans re-analyser. Chantier A (gouvernance) est mergé sur `main`
> (commit `f7629ac`). Chantier B (staging) n'est pas un prérequis de C — C
> peut être implémenté avant B.

## Contexte

Brief "Phase 1 — Pipeline de développement autonome Smart Berry", Chantier C.
Objectif : un control plane minimal en Firestore (3 collections, rien de
plus — pas de scheduler, pas de retries automatiques en Phase 1) + un écran
Smart Berry "Pipeline IA" en lecture seule, responsive mobile, qui sert de
poste de pilotage à Omar depuis son iPhone. Aucune de ces collections
n'existe aujourd'hui (vérifié par grep sur `functions/` et `public/app.jsx` —
zéro référence à `ai_tickets`/`ai_events`/`ai_locks`).

**Pourquoi une spec plutôt qu'une implémentation directe** : ce chantier
crée 3 nouvelles collections Firestore + une nouvelle Cloud Function +
modifie `firestore.rules` (fichier "ressource exclusive" au sens de la
section A3 de CLAUDE.md) + ajoute un écran visible par Omar. Le repo a déjà
une convention pour ce type de travail (section "Workflow GATED révisé
(specs async)" de CLAUDE.md) : produire le spec d'abord, exécuter sur GO.

## Décisions prises (à confirmer ou corriger par Omar avant implémentation)

Le brief ne précise pas tout — voici les choix faits pour rester cohérent
avec les patterns existants du repo, à valider explicitement :

1. **Écriture des 3 collections** : jamais côté client, toujours via une
   nouvelle Cloud Function `exports.aiPipeline` (route `/api/ai-pipeline`),
   même pattern que `caisseManagement`/`bugReports`. Les agents (developer /
   qa-reviewer / futurs scripts `qa:ticket` du Chantier D) ne sont pas des
   utilisateurs Firebase connectés au dashboard — ils appellent la Cloud
   Function avec un **secret admin partagé** (`AI_PIPELINE_SECRET` dans
   `.env`, jamais committé), exactement le pattern déjà utilisé pour
   `bulk-import-transactions` (mentionné dans CLAUDE.md § Cloud Function
   caisse). **À confirmer par Omar** : ce secret est distinct de
   `FIREBASE_TOKEN` et ne doit jamais être exposé aux agents autrement que
   via `.env` local (déjà couvert par le `deny` sur lecture `.env` du
   Chantier A — donc en pratique, seul un humain configure ce secret une
   fois, les agents le consomment via `process.env` côté Cloud Function,
   jamais en le lisant depuis un fichier).
2. **Lecture de l'écran Pipeline IA** : restreinte aux profils `rh` et `dg`
   (même règle que "États d'émargement" restreinte RH/DG, cf. commit
   `f2cf767`). **À confirmer** : si Omar veut l'ouvrir à d'autres profils.
3. **Verrous expirés (`ai_locks`, TTL 4h)** : pas de nettoyage automatique
   en Phase 1 (brief interdit tout scheduler). Un verrou est simplement
   ignoré dans les requêtes de disponibilité dès que `expire_le < now` — il
   reste en base (bruit mineur, nettoyage manuel ou Chantier futur).
4. **Renouvellement de verrou** : action `renew-lock` distincte de
   `acquire-lock`, réservée au `ticket_id` déjà propriétaire (sinon 403).
5. **Rafraîchissement de l'écran** : bouton "Actualiser" manuel + poll
   passif toutes les 30s (`setInterval` côté client uniquement — ce n'est
   pas un scheduler backend, juste un re-fetch UI, cohérent avec
   l'interdiction de scheduler du brief qui vise le backend).

## Schéma Firestore

### `ai_tickets`
```
{
  titre: string,
  statut: 'BACKLOG' | 'DEVELOPING' | 'QA' | 'READY_TO_REVIEW' | 'BLOCKED' | 'NEEDS_HUMAN' | 'MERGED',
  branche: string,              // ex. "sb/SB-042"
  fichiers: string[],           // chemins déclarés du ticket (cf. limite 8 fichiers, CLAUDE.md A3)
  preview_url: string | null,
  qa_resultat: {                // structure libre, reflète le rapport batché du Chantier D
    tests_cibles: string | null,
    unitaires: string | null,
    build: string | null,
    vite_compat: string | null,
    smoke: string | null,
  } | null,
  cree_le: Timestamp,           // serverTimestamp()
  maj_le: Timestamp,            // serverTimestamp(), mis à jour à chaque transition
}
```
Id de doc = l'identifiant du ticket (ex. `SB-042`), pas un ID Firestore auto.

### `ai_events` (append-only, jamais d'update ni delete)
```
{
  ticket_id: string,
  horodatage: Timestamp,        // serverTimestamp()
  type: string,                 // ex. "STATUT_CHANGE", "LOCK_ACQUIRED", "QA_RESULT", "NEEDS_HUMAN"
  detail: string,               // texte libre, court
}
```
Id de doc = auto-généré Firestore (append-only, l'ordre naturel suffit).

### `ai_locks`
```
{
  fichier: string,               // chemin relatif au repo, sert de clé métier
  ticket_id: string,
  acquis_le: Timestamp,
  expire_le: Timestamp,          // acquis_le + 4h, renouvelable via renew-lock
}
```
Id de doc = le chemin du fichier normalisé (remplacer `/` par `__` pour
rester un id Firestore valide), pour permettre un `get()` direct au lieu
d'une query à chaque vérification de dispo.

## `firestore.rules` — bloc à ajouter

Même pattern read-only-client que `bug_reports` (`firestore.rules:221-227`) :
```
match /ai_tickets/{docId} {
  allow read: if request.auth != null;
  allow write: if false;
}
match /ai_events/{docId} {
  allow read: if request.auth != null;
  allow write: if false;
}
match /ai_locks/{docId} {
  allow read: if request.auth != null;
  allow write: if false;
}
```
Toutes les écritures passent par `exports.aiPipeline` (Admin SDK, bypass
rules par design côté serveur).

## `firestore.indexes.json` — entrées à ajouter

Même pattern que `bug_reports` (status + date desc) :
```json
{
  "collectionGroup": "ai_tickets",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "statut", "order": "ASCENDING" },
    { "fieldPath": "maj_le", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "ai_events",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "ticket_id", "order": "ASCENDING" },
    { "fieldPath": "horodatage", "order": "DESCENDING" }
  ]
}
```
`ai_locks` n'a pas besoin d'index composite : lookups par id de doc direct
(chemin normalisé) ou liste complète (collection attendue petite, < 50 docs
en pratique vu la limite de 8 fichiers/ticket).

## Cloud Function — `exports.aiPipeline` (nouveau, `functions/index.js`)

Route `firebase.json` : `{ "source": "/api/ai-pipeline", "function": { "functionId": "aiPipeline", "region": "europe-west1" } }`.

Pattern d'auth à double voie (calqué sur `bulk-import-transactions`) :
- Actions **lecture** (`list-tickets`, `get-ticket`, `list-events`) :
  `requireAuth(req, res)` classique + gate profil `rh`/`dg` (cf. décision 2).
- Actions **écriture** (`create-ticket`, `update-ticket-status`,
  `append-event`, `acquire-lock`, `renew-lock`, `release-lock`) : header
  `x-ai-pipeline-secret` comparé à `process.env.AI_PIPELINE_SECRET` — pas de
  session Firebase (les agents n'en ont pas). 403 si absent/incorrect.

Actions et payloads :

| Action | Méthode | Payload | Effet |
|---|---|---|---|
| `create-ticket` | POST | `{id, titre, branche, fichiers[]}` | Crée `ai_tickets/{id}` statut `BACKLOG`, écrit un event `TICKET_CREATED` |
| `update-ticket-status` | POST | `{id, statut, preview_url?, qa_resultat?}` | Valide `statut` contre l'enum, `update()` + `maj_le`, écrit un event `STATUT_CHANGE` avec `detail` = ancien→nouveau |
| `acquire-lock` | POST | `{fichier, ticket_id}` | Si un lock non expiré existe pour `fichier` avec un `ticket_id` différent → `409 {success:false, error:'locked_by', ticket_id}`. Sinon `set()` avec `expire_le = now + 4h`, event `LOCK_ACQUIRED` |
| `renew-lock` | POST | `{fichier, ticket_id}` | 403 si le lock existant appartient à un autre ticket. Sinon prolonge `expire_le` de 4h |
| `release-lock` | POST | `{fichier, ticket_id}` | `delete()` si `ticket_id` correspond, sinon 403 |
| `append-event` | POST | `{ticket_id, type, detail}` | Ajoute un doc à `ai_events`, jamais d'update |
| `list-tickets` | GET | — | Tous les tickets triés par `statut`, `maj_le` desc |
| `get-ticket` | GET | `?id=` | Ticket + ses 20 derniers events |
| `list-events` | GET | `?ticket_id=` | Events du ticket, triés desc |

Toujours `{success: bool, ...}` ou `{success:false, error:string}`, cohérent
avec la convention CLAUDE.md § Cloud Function caisse.

## Écran "Pipeline IA" (frontend)

Nouveau fichier `public/components/PipelineIATab.jsx` (jamais de gros bloc
direct dans `app.jsx`, cf. règle de modularisation progressive) :
- IIFE classique UMD, expose `window.PipelineIATab` (même convention que
  `BugReportsAdmin.jsx:474`).
- `useEffect` au montage → `fetch('/api/ai-pipeline?action=list-tickets')`
  (même pattern que `BugReportsAdmin.jsx:154-180`, pas de nouvelle
  abstraction de fetch).
- Bouton "Actualiser" + `setInterval` 30s (nettoyé au démontage).
- Liste groupée par statut (7 sections, une par valeur de l'enum), chaque
  carte ticket affiche : titre, branche, dernier event (texte + heure
  relative), lien `preview_url` si présent (`target="_blank"`).
- Responsive mobile : cartes empilées, pas de tableau large (cf. contrainte
  "poste de pilotage iPhone d'Omar" du brief) — réutiliser les patterns CSS
  inline déjà en place (`style={{...}}`, variables `var(--berry)` etc.),
  pas de nouvelle lib CSS.
- Lecture seule stricte : aucune action de mutation dans cet écran (create/
  update/lock restent des actions internes au pipeline, jamais cliquables
  depuis l'UI en Phase 1).

Wiring dans `public/app.jsx` (même pattern que `bug_reports`, cf.
`app.jsx:584`/`:680` pour la nav, `app.jsx:68873` pour le render) :
```jsx
{currentTab === 'pipeline_ia' && window.PipelineIATab &&
  <TabErrorBoundary name="Pipeline IA">
    {React.createElement(window.PipelineIATab, {currentProfile})}
  </TabErrorBoundary>}
```
Nav entry gatée `rhOnly`/`dgOnly` (décision 2). Ajouter le `<script>` tag du
nouveau fichier dans `public/index.html`, à côté de celui de
`BugReportsAdmin.js` (build Babel classique, pas de bundler).

## Risques et edge cases

- **Secret `AI_PIPELINE_SECRET` absent en local** : la Cloud Function doit
  refuser toute action d'écriture avec un message explicite plutôt que de
  fail-open — sinon une CF mal configurée en dev accepterait des écritures
  non authentifiées.
- **Doc id `ai_locks` avec caractères Firestore-invalides** : normaliser
  strictement le chemin (`/` → `__`, refuser tout id résultant vide ou
  `.`/`..`).
- **Event flood** : `ai_events` est append-only et non paginé par défaut
  dans `get-ticket` (20 derniers) — si un ticket génère beaucoup d'events,
  l'écran ne doit afficher que les récents, pas tout l'historique.
- **Statuts invalides envoyés par un agent** : `update-ticket-status` doit
  rejeter toute valeur hors de l'enum des 7 statuts (400), jamais stocker
  une valeur libre.
- **Écran vide au premier chargement** (avant que le Chantier D existe et
  crée des tickets) : état vide géré explicitement ("Aucun ticket pour le
  moment"), pas un écran cassé.

## Fichiers concernés (implémentation, hors scope de cette spec)

- `functions/index.js` : nouveau bloc `exports.aiPipeline` (+ `require`
  d'un éventuel module `functions/lib/aiPipeline/` si la logique dépasse ~150
  lignes — pattern `functions/lib/irrigation/` à dupliquer si pertinent).
- `firestore.rules` : 3 nouveaux blocs `match`.
- `firestore.indexes.json` : 2 nouvelles entrées.
- `firebase.json` : 1 nouvelle route `/api/ai-pipeline`.
- `public/components/PipelineIATab.jsx` (+ build → `.js`).
- `public/index.html` : 1 nouveau `<script>` tag.
- `public/app.jsx` : nav entry + render wiring (2 points d'insertion, pas de
  gros bloc).
- Tests : `functions/lib/aiPipeline/__tests__/*.test.js` (si module dédié)
  ou `tests/unit/aiPipeline*.test.js` — au minimum : validation d'enum
  statut, logique de lock (acquire refusé si détenu par un autre ticket,
  accordé si expiré), normalisation d'id de chemin.

## Vérification (au moment du GO)

1. `npm run qa` vert.
2. Déploiement functions (`scripts/deploy.sh functions`, ask — confirmation
   Omar comme toujours).
3. Preview hosting (channel, pas prod) pour QA visuelle du nouvel écran —
   même flux "Stratégie de deploy et QA visuelle" déjà en place dans
   CLAUDE.md.
4. Smoke manuel : créer un ticket via `create-ticket` (curl + secret),
   vérifier qu'il apparaît dans l'écran, changer son statut, vérifier
   l'event correspondant, tester un lock refusé (2 tickets sur le même
   fichier).
5. Deploy prod hosting uniquement après validation visuelle Omar (règle
   standard du repo, pas une exception pour ce chantier).
