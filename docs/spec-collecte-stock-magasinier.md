# Spec — Soumission quotidienne des fichiers Stock (Berry Good + Bahia)

Statut : **QUALIFICATION TERMINÉE — en attente de GO Omar**
Demandé par Omar, 2026-08-05, complété le même jour : **deux canaux de
soumission en parallèle** — onglet dans l'interface magasinier (dropzones)
ET soumission entrante par WhatsApp au bot Smart Berry. Les deux canaux
écrivent dans le même modèle de données et alimentent le même tableau de
suivi.

Gated : **OUI** — nouvelle fonctionnalité (nouvel onglet, nouvelle route
backend, nouveau bot WhatsApp entrant, nouveau cron WhatsApp). Ce document
est autosuffisant : à implémenter tel quel sur
`GO spec-collecte-stock-magasinier`, sans re-analyse.

---

## 1. Besoin exprimé (verbatim résumé)

> On ajoute un onglet "Soumission Fichier Stock" dans l'interface magasinier,
> avec une dropbox pour les 2 fichiers stock (Berry Good et Bahia). On
> archive la date/heure de soumission. On envoie une alerte WhatsApp si un
> fichier n'a pas été envoyé à 18h, avec des rappels à 16h, 17h et 18h. On
> affiche un tableau quotidien (lignes = dates, colonnes = les 2 fichiers)
> avec un check ✅ ou une croix ❌ selon la soumission.
>
> On donne aussi l'option de soumission par WhatsApp au bot Smart Berry —
> le magasinier peut envoyer un fichier directement en message WhatsApp, en
> plus (pas à la place) de l'onglet dans l'app.

Pas de traitement du contenu des fichiers pour l'instant (pas de parsing,
pas d'import stock) — uniquement dépôt + archivage + suivi. "On verra
comment le traiter" ensuite (item futur, hors scope ici).

---

## 2. Décisions de conception (assumptions à valider en implémentation)

Le rôle `magasinier` (`public/app.jsx:421`) est un profil **unique, global**
(pas de `switchableFarms`, pas de multi-comptes par ferme). Donc :

- **Un seul magasinier soumet les 2 fichiers** depuis le même onglet — pas de
  distinction de compte par ferme.
- **Destinataires des rappels 16h/17h/18h** : le(s) compte(s) `users` avec
  `profileId === "magasinier"` et `whatsappEnabled === true` (via
  `whatsappService.resolveRecipientsForProfile("magasinier", null)`).
- **Alerte d'escalade à 18h si toujours manquant** : envoyée EN PLUS aux
  destinataires `profileId === "dg"` (Omar), même pattern que
  `checkPresenceSyncHealth` (`functions/index.js:353-374`).
- Si aucun compte `users` n'a `profileId: "magasinier"` + `whatsappPhone`
  renseigné aujourd'hui, les rappels ne partiront à personne silencieusement
  → **prévoir un log d'erreur explicite** (`console.error`) à chaque run cron
  si `recipients.length === 0`, pour ne pas répéter le piège "sonde qui
  n'alerte pas" déjà rencontré (cf. mémoire `pipeline-pointage-bdr-panne-silencieuse`).
  Si c'est le cas, Omar devra renseigner `whatsappPhone` + `whatsappEnabled`
  sur le compte magasinier avant activation du cron **et** avant que le canal
  WhatsApp entrant fonctionne (même prérequis pour les deux canaux — sans
  compte `users` matché, `whatsappProcessor.js` ne route nulle part, cf.
  `whatsappProcessor.js:85-93`).
- **Désambiguïsation ferme côté WhatsApp** : un seul numéro magasinier envoie
  les 2 fichiers dans la même conversation, donc le fichier seul ne dit pas
  pour quelle ferme il est. Stratégie à 2 niveaux :
  1. Si la légende (caption) du document contient un mot-clé sans ambiguïté
     (`"BG"`, `"BERRY GOOD"`, `"BAHIA"`, insensible à la casse/accents) →
     ferme déduite directement, pas de question.
  2. Sinon → le bot répond avec des **boutons interactifs**
     (`sendInteractiveButtons`, cf. `whatsappService.js:124-284`) "Berry
     Good" / "Bahia" et attend la réponse avant d'enregistrer, exactement
     comme le flux confirmation du registre visiteurs
     (`securityBot.js:250-315`). État intermédiaire tenu dans
     `whatsapp_sessions/{phone}` (même collection, même pattern que
     `securityBot.js:8,30,37,46`) — évite de mélanger deux uploads si le
     magasinier envoie les 2 fichiers coup sur coup avant de répondre au
     premier bouton.

---

## 3. Modèle de données

Nouvelle collection Firestore **`stock_file_submissions`**, un document par
jour, id = date `YYYY-MM-DD` (Africa/Casablanca) — même pattern que
`pointage_validations_equipe` (`functions/index.js:5108-5143`).

```js
// stock_file_submissions/{YYYY-MM-DD}
{
  berry_good: {
    submitted: false,
    submitted_at: null,        // serverTimestamp() une fois soumis
    submitted_by: null,        // {uid, name, email, source: "app"|"whatsapp"}
    file_path: null,           // chemin Storage
    file_name: null,           // nom original saisi par l'utilisateur
  },
  bahia: {
    submitted: false,
    submitted_at: null,
    submitted_by: null,
    file_path: null,
    file_name: null,
  },
  reminders_sent: { "16h": false, "17h": false, "18h": false },
  missing_alert_sent_at: null,  // set si escalade DG envoyée à 18h
  created_at: <serverTimestamp au 1er write du jour>,
  updated_at: <serverTimestamp>,
}
```

Clés `berry_good` / `bahia` choisies en snake_case ASCII, cohérent avec la
convention Firestore du projet (cf. CLAUDE.md § Firestore).

Storage : fichiers dans `stock_files/{YYYY-MM-DD}/{berry_good|bahia}_{timestamp}.{ext}`
(bucket par défaut du projet, même bucket que les autres uploads directs).

---

## 4. Backend (Cloud Functions — `functions/index.js` + nouveau module `functions/lib/stockFiles/`)

### 4.1 Upload — réutiliser le pattern "client-direct upload" existant

Comme `upload-attachment` (`functions/index.js:9572-9618`), mais adapté :
pas d'entité pré-existante à cibler, on upsert directement le doc du jour.

Nouvelle route sur l'API `/api/stock` (même app Express que les autres
actions stock) :

**`POST /api/stock?action=stock-file-submit`**
- Auth Firebase requise. Rôle : `magasinier` (ou `dg`/`admin` en secours,
  cf. `resolveCallerRole`, pattern `functions/index.js:5119-5121` — jamais
  de rôle lu depuis le body client).
- Body : `{ date: "YYYY-MM-DD", farm: "berry_good"|"bahia", storage_path, filename }`
  — `date` optionnel, défaut = aujourd'hui Casablanca côté serveur (ne pas
  faire confiance à l'horloge client).
- Validations :
  - `farm` ∈ `["berry_good", "bahia"]` sinon 400.
  - Objet existe dans le bucket (`bucket.file(storage_path).exists()`) sinon 400.
  - Métadonnées (taille/MIME) via `scanAttachment.validateAttachmentMetadata`
    — **MISE À JOUR (2026-08-05, confirmé par Omar)** : les fichiers stock
    réels sont des classeurs Excel (.xlsx/.xls) ou CSV, PAS
    PDF/image. `ALLOWED_ATTACHMENT_MIME` (PDF/JPEG/PNG/WEBP/HEIC) ne doit
    **PAS** être élargi globalement (il est partagé avec les scans
    BDC/factures/BL, qui doivent rester PDF/image uniquement). Ajouter un
    2e paramètre optionnel `allowedMime` à `validateAttachmentMetadata(meta,
    allowedMime)` (défaut = `ALLOWED_ATTACHMENT_MIME`, rétrocompatible pour
    tous les appelants existants) et définir dans
    `functions/lib/stockFiles/` une constante dédiée `STOCK_FILE_ALLOWED_MIME`
    couvrant : `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
    (xlsx), `application/vnd.ms-excel` (xls, et parfois csv sous Windows),
    `text/csv`, `application/csv` — en gardant aussi PDF/JPEG/PNG/WEBP/HEIC
    (un magasinier peut occasionnellement envoyer une photo du relevé
    papier). Passer `STOCK_FILE_ALLOWED_MIME` explicitement à
    `validateAttachmentMetadata` aux 2 points d'appel (`stock-file-submit`
    ET `magasinierBot.js`). Fichier rejeté → suppression best-effort de
    l'objet orphelin (même pattern que `functions/index.js:9594-9598`).
  - Message d'erreur à adapter en conséquence (ne plus dire "PDF ou image
    uniquement" — lister les formats réellement acceptés).
- Effet : appelle la logique partagée `stockFiles.recordSubmission({ date,
  farm, storagePath, filename, submittedBy })` (voir § 4.4 — même fonction
  utilisée par le canal WhatsApp, pour ne jamais dupliquer l'écriture
  Firestore entre les 2 canaux). Écrit `db.collection("stock_file_submissions").doc(date).set({ [farm]: {
  submitted: true, submitted_at: now, submitted_by, file_path: storage_path,
  file_name }, updated_at: now }, { merge: true })` (créer `created_at`
  seulement si le doc n'existait pas encore — lire avant ou utiliser une
  transaction courte).
- Réponse : `{ success: true, submitted_at }`.

**`GET /api/stock?action=stock-file-history&days=30`**
- Auth requise (tout profil autorisé à voir l'onglet magasinier + `dg`).
- Retourne les N derniers jours (défaut 30, max raisonnable 90) :
  `[{ date, berry_good: {submitted, submitted_at}, bahia: {submitted, submitted_at} }, …]`
  triés du plus récent au plus ancien. Jours sans document = `submitted:
  false` pour les deux fermes (ne pas exclure — nécessaire pour les croix ❌
  du tableau).

Pas besoin d'un `get-attachment-url` dédié dans ce spec (pas de lecture du
fichier prévue pour l'instant — juste dépôt + suivi). À ajouter plus tard si
besoin de consultation/téléchargement.

### 4.2 Logique d'écriture partagée (les 2 canaux convergent ici)

Nouveau module `functions/lib/stockFiles/recordSubmission.js` (pure logic +
DI, `node:test`) exportant `recordSubmission(db, { date, farm, storagePath,
filename, submittedBy })` → fait exactement l'upsert Firestore décrit en
§ 4.1. Utilisé par :
- la route HTTP `stock-file-submit` (canal onglet app),
- le handler WhatsApp `magasinierBot.js` (canal WhatsApp, § 4.4).

Objectif : **une seule source de vérité pour l'écriture**, aucune divergence
possible entre ce que voit le tableau historique selon le canal utilisé.

### 4.3 Storage rules

Vérifier/étendre `storage.rules` pour autoriser l'écriture directe client
sur `stock_files/**` par un utilisateur authentifié avec `profileId ==
"magasinier"` (même principe que les autres chemins d'upload direct déjà
ouverts pour le pattern "unified attachment" — le développeur doit localiser
la règle existante et la dupliquer/étendre, pas la réécrire).

### 4.4 Crons de rappel + alerte

Trois exports séparés (même style que le trio
`syncPresenceEntree`/`syncPresenceSortie`/`checkPresenceSyncHealth`,
`functions/index.js:342-374`), nouveau fichier `functions/lib/stockFiles/reminders.js`
avec la logique pure (testable en `node:test`), exports fins dans
`functions/index.js` :

```js
exports.stockFileReminder16h = functions.region("europe-west1").pubsub
  .schedule("0 16 * * *").timeZone("Africa/Casablanca")
  .onRun(() => stockFileReminders.sendReminder("16h"));

exports.stockFileReminder17h = functions.region("europe-west1").pubsub
  .schedule("0 17 * * *").timeZone("Africa/Casablanca")
  .onRun(() => stockFileReminders.sendReminder("17h"));

exports.stockFileReminder18h = functions.region("europe-west1").pubsub
  .schedule("0 18 * * *").timeZone("Africa/Casablanca")
  .onRun(() => stockFileReminders.sendReminder("18h", { escalateToDg: true }));
```

Logique `sendReminder(slot, { escalateToDg = false } = {})` :
1. Lire (ou créer si absent) `stock_file_submissions/{today}`.
2. Pour chaque ferme non `submitted` : envoyer `general_alert` aux
   destinataires `magasinier` (message ex. `"Rappel {slot} : fichier stock
   {Berry Good|Bahia} pas encore reçu aujourd'hui."`).
3. Marquer `reminders_sent.{slot} = true` dans le doc (évite double envoi si
   le cron est rejoué manuellement).
4. Si `escalateToDg` et qu'au moins une ferme est toujours `submitted:
   false` après le rappel : envoyer `general_alert` aux destinataires `dg`
   (message listant la/les ferme(s) manquante(s)) et poser
   `missing_alert_sent_at = now`.
5. Si `recipients.length === 0` à n'importe quelle étape → `console.error`
   explicite (cf. § 2) — ne jamais échouer silencieusement.
6. Try/catch global autour de tout `onRun`, log erreur, `return null` (ne
   jamais laisser une Cloud Function planter sans log, pattern
   `dailyProductionDigest` `functions/index.js:166-174`).

Utiliser `whatsappService.sendTemplateMessage(phone, "general_alert",
[whatsappService.toSingleLine(msg)])` — jamais `sendTextMessage` (règle
mémoire `whatsapp-proactif-doit-etre-template`).

### 4.5 Canal WhatsApp entrant (nouveau bot `magasinier`)

Nouveau handler `functions/magasinierBot.js`, sur le modèle de
`securityBot.js` (télécharger → uploader Storage → confirmer par boutons →
écrire Firestore) :

1. **Routage** : ajouter le cas `profileId === "magasinier"` dans le
   dispatch de `whatsappProcessor.js:126-144` (aujourd'hui seuls `dg` et
   `securite` sont routés) → `magasinierBot.handleMessage(matchedUser, msg)`.
2. **Réception d'un document** (`msg.type === "document"` ou `"image"`) :
   - `whatsappService.downloadMedia(mediaId)` → `{buffer, mimeType, sha256}`
     (`whatsappService.js:375-400`).
   - Valider taille/MIME avec **la même fonction** que le canal app
     (`scanAttachment.validateAttachmentMetadata`) — pas de règles
     dupliquées entre canaux. Rejet → réponse WhatsApp expliquant le
     problème (ex. "Format non supporté, envoyez un PDF/Excel/image.").
   - Déterminer `date` = aujourd'hui Casablanca (serveur, pas l'horodatage
     du message).
   - Déterminer `farm` via la stratégie § 2 (caption ou boutons).
     - Si boutons nécessaires : uploader le fichier vers un chemin
       **temporaire** Storage (`stock_files/_pending/{phone}_{ts}.{ext}`),
       stocker la référence dans `whatsapp_sessions/{phone}` (état
       `awaiting_farm_choice`, `pending_path`, `pending_filename`), envoyer
       `sendInteractiveButtons` avec les 2 choix.
     - Si caption sans ambiguïté : uploader directement vers le chemin final
       `stock_files/{date}/{farm}_{ts}.{ext}` et enregistrer tout de suite.
3. **Réponse au bouton** (message interactif entrant, type `button_reply`) :
   - Lire la session `whatsapp_sessions/{phone}`, si `state ===
     "awaiting_farm_choice"` : déplacer/renommer l'objet Storage du chemin
     temporaire vers le chemin final `stock_files/{date}/{farm}_{ts}.{ext}`
     (`bucket.file(pendingPath).move(finalPath)`), appeler
     `stockFiles.recordSubmission(db, { date, farm, storagePath: finalPath,
     filename, submittedBy: {uid: matchedUser.uid, name: matchedUser.displayName,
     source: "whatsapp"} })`, nettoyer la session, répondre par un message de
     confirmation ("✅ Fichier {Berry Good|Bahia} reçu pour aujourd'hui.").
   - Si aucune session en attente (bouton orphelin/rejoué) : répondre "Rien
     à confirmer, envoyez d'abord un fichier."
4. **Idempotence** : la dédup par `msg.id` déjà en place
   (`whatsappProcessor.js:60-65, 99`) couvre les envois dupliqués côté Meta.
   Une re-soumission volontaire (2e fichier le même jour pour la même
   ferme) écrase simplement le doc (`merge: true`, § 4.2), comme pour le
   canal app.
5. **Erreurs** : tout échec (téléchargement média, upload Storage, écriture
   Firestore) → réponse WhatsApp d'erreur générique au magasinier +
   `console.error` détaillé côté serveur. Ne jamais laisser un fichier
   "disparaître" sans réponse visible dans la conversation.

Champ `submitted_by.source: "app" | "whatsapp"` ajouté au modèle § 3 (mineur,
pas de champ obligatoire pour le canal app existant — `source: "app"` par
défaut) pour que le tableau historique puisse, si besoin plus tard,
distinguer l'origine d'une soumission.

---

## 5. Frontend

### 5.1 Nouvel onglet

`public/app.jsx:598-613` (`NAV_ITEMS_MAGASINIER`) : ajouter
`{ id: 'mag_stock_files', label: 'Soumission Fichier Stock', icon:
'fa-file-arrow-up' }`.

Composant dans un **fichier séparé** (règle "Modularisation progressive" du
CLAUDE.md — interdiction d'ajouter un gros bloc dans `app.jsx`) :
`public/components/MagStockFilesTab.jsx`. `app.jsx` ne fait que l'import +
le rendu conditionnel sur `activeTab === 'mag_stock_files'` (chercher le
routeur de tabs magasinier, même zone que `NAV_ITEMS_MAGASINIER` /
`mag_dashboard` par défaut à `app.jsx:68640` et `68791`).

### 5.2 Contenu de l'onglet

1. **Deux dropzones** (une "Berry Good", une "Bahia") :
   - Drag & drop + fallback `<input type="file">`.
   - Formats acceptés : XLSX/XLS/CSV en priorité (fichiers stock réels,
     confirmé Omar 2026-08-05) + PDF/JPEG/PNG/WEBP/HEIC en secours (photo
     du relevé papier) — cf. `STOCK_FILE_ALLOWED_MIME` § 4.1. `accept=
     ".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp,.heic"` sur l'`<input
     type="file">`, message d'erreur si rejet aligné sur la liste réelle.
   - Flux : upload direct vers Storage (chemin `stock_files/{date}/{farm}_{ts}.{ext}`)
     → `POST /api/stock?action=stock-file-submit`.
   - État visuel après soumission du jour : dropzone remplacée par un
     résumé "✅ Envoyé à HH:MM par {nom}" + bouton pour re-soumettre
     (écrase le fichier du jour — pas de historique multi-versions dans ce
     spec).
2. **Tableau historique** sous les dropzones :
   - Lignes = dates (30 derniers jours par défaut, via
     `GET /api/stock?action=stock-file-history&days=30`).
   - Colonnes = `Date | Berry Good | Bahia`.
   - Cellule = ✅ (vert) si `submitted`, ❌ (rouge) sinon — **sauf le jour
     courant avant 18h** : afficher "⏳ en attente" plutôt qu'une croix
     (une croix avant l'heure limite serait trompeuse).

---

## 6. Sécurité / permissions

- Écriture (`stock-file-submit`) : `profileId ∈ {"magasinier", "dg"}`
  uniquement, résolu **serveur** via `resolveCallerRole`/équivalent — jamais
  depuis le body (cf. commentaire `functions/index.js:5119-5121`).
- Lecture (`stock-file-history`) : tout utilisateur authentifié avec un
  profil ayant accès à l'onglet (`magasinier`, `dg` a minima).
- Storage rules : écriture restreinte au chemin `stock_files/{date}/**` pour
  un uid dont le profil Firestore est `magasinier` (ou `dg`), lecture selon
  besoin futur (pas de lecture prévue dans ce spec V1).
- Canal WhatsApp : aucune auth Firebase (par nature) — la légitimité vient
  du numéro expéditeur déjà résolu en `matchedUser` par
  `whatsappProcessor.js:85-93` (lookup `users.whatsappPhone`). Un numéro non
  matché à un compte `profileId: "magasinier"` n'atteint jamais
  `magasinierBot.js` (le dispatch § 4.5 ne route que les profils connus) —
  pas de vérification supplémentaire nécessaire au-delà de ce lookup déjà en
  place pour tous les bots existants.

---

## 7. Hors scope (explicitement, "on verra ensuite")

- Parsing/traitement du contenu des fichiers stock (pas d'import
  `stockCaneva`, pas de rapprochement).
- Historique multi-versions par jour (une re-soumission écrase la
  précédente).
- Consultation/téléchargement du fichier déposé (pas de `get-attachment-url`
  dans ce spec).

---

## 8. Fichiers à toucher (implémentation)

- `functions/index.js` — 2 nouvelles routes `/api/stock` (`stock-file-submit`,
  `stock-file-history`) + 3 nouveaux exports cron.
- `functions/lib/stockFiles/recordSubmission.js` (nouveau, pure logic + DI,
  tests `node:test`) — écriture partagée par les 2 canaux.
- `functions/lib/stockFiles/reminders.js` (nouveau, pure logic + DI, tests
  `node:test` dans `functions/lib/stockFiles/__tests__/`).
- `functions/magasinierBot.js` (nouveau) — handler WhatsApp entrant, sur le
  modèle de `securityBot.js`.
- `functions/whatsappProcessor.js` — ajouter le routage `profileId ===
  "magasinier"` dans le dispatch (`:126-144`).
- `storage.rules` — règle d'écriture `stock_files/**` (y compris
  `stock_files/_pending/**` pour le flux WhatsApp en attente de choix de
  ferme).
- `public/app.jsx` — entrée `NAV_ITEMS_MAGASINIER`, import + rendu du nouveau
  composant.
- `public/components/MagStockFilesTab.jsx` (nouveau).
- Tests : `tests/unit/` si logique front extraite en helper pur ; sinon
  smoke Playwright manuel sur le preview. Test manuel réel du bot WhatsApp
  (envoi d'un fichier depuis le numéro magasinier) avant de considérer le
  canal WhatsApp fonctionnel.

---

## 9. Plan de déploiement

1. Feature branch dédiée, `developer` implémente selon ce spec.
2. `npm run qa` vert.
3. Deploy functions (backend, non-régressif) → deploy hosting sur preview
   channel.
4. QA visuelle (Playwright + captures) sur le preview : dropzones,
   soumission, tableau historique, déclenchement manuel d'un cron via
   trigger de test si possible. **Plus un test manuel réel du canal
   WhatsApp** (le backend étant déjà en prod à cette étape — cf. séquence
   deploy CLAUDE.md § "Stratégie de deploy" : functions d'abord) : envoyer
   un fichier test depuis le numéro magasinier, vérifier la question de
   ferme (boutons), vérifier l'écriture dans `stock_file_submissions` et le
   reflet dans le tableau du preview.
5. Screenshots + checklist → validation visuelle Omar.
6. Sur "OK deploy" : merge main + deploy prod (functions puis hosting).
7. Laisser tourner les crons 1 jour réel avant de considérer l'item terminé
   — vérifier réception effective des rappels WhatsApp par le magasinier,
   et confirmer qu'au moins une soumission par chaque canal (app + WhatsApp)
   a été testée en conditions réelles.
