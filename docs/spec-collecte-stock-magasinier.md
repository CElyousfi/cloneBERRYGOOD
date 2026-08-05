# Spec — Soumission quotidienne des fichiers Stock (Berry Good + Bahia)

Statut : **QUALIFICATION TERMINÉE — en attente de GO Omar**
Demandé par Omar, 2026-08-05. Remplace l'idée initiale (collecte via WhatsApp
entrant) : Omar a tranché pour une saisie via un nouvel onglet dans
l'interface magasinier, avec notification WhatsApp sortante uniquement (pas
de réception de fichiers WhatsApp).

Gated : **OUI** — nouvelle fonctionnalité (nouvel onglet, nouvelle route
backend, nouveau cron WhatsApp). Ce document est autosuffisant : à
implémenter tel quel sur `GO spec-collecte-stock-magasinier`, sans
re-analyse.

---

## 1. Besoin exprimé (verbatim résumé)

> On ajoute un onglet "Soumission Fichier Stock" dans l'interface magasinier,
> avec une dropbox pour les 2 fichiers stock (Berry Good et Bahia). On
> archive la date/heure de soumission. On envoie une alerte WhatsApp si un
> fichier n'a pas été envoyé à 18h, avec des rappels à 16h, 17h et 18h. On
> affiche un tableau quotidien (lignes = dates, colonnes = les 2 fichiers)
> avec un check ✅ ou une croix ❌ selon la soumission.

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
  sur le compte magasinier avant activation du cron.

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
    submitted_by: null,        // {uid, name, email}
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
    (réutiliser tel quel — mêmes limites que les autres uploads) ; fichier
    rejeté → suppression best-effort de l'objet orphelin (même pattern que
    `functions/index.js:9594-9598`).
- Effet : `db.collection("stock_file_submissions").doc(date).set({ [farm]: {
  submitted: true, submitted_at: now, submitted_by: {uid, name, email},
  file_path: storage_path, file_name }, updated_at: now }, { merge: true })`
  (créer `created_at` seulement si le doc n'existait pas encore — lire avant
  ou utiliser une transaction courte).
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

### 4.2 Storage rules

Vérifier/étendre `storage.rules` pour autoriser l'écriture directe client
sur `stock_files/**` par un utilisateur authentifié avec `profileId ==
"magasinier"` (même principe que les autres chemins d'upload direct déjà
ouverts pour le pattern "unified attachment" — le développeur doit localiser
la règle existante et la dupliquer/étendre, pas la réécrire).

### 4.3 Crons de rappel + alerte

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
   - Formats acceptés : à définir par le développeur selon
     `scanAttachment` (probablement PDF/XLSX/CSV/images — vérifier
     `validateAttachmentMetadata` pour la liste MIME déjà autorisée).
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
- `functions/lib/stockFiles/reminders.js` (nouveau, pure logic + DI, tests
  `node:test` dans `functions/lib/stockFiles/__tests__/`).
- `storage.rules` — règle d'écriture `stock_files/**`.
- `public/app.jsx` — entrée `NAV_ITEMS_MAGASINIER`, import + rendu du nouveau
  composant.
- `public/components/MagStockFilesTab.jsx` (nouveau).
- Tests : `tests/unit/` si logique front extraite en helper pur ; sinon
  smoke Playwright manuel sur le preview.

---

## 9. Plan de déploiement

1. Feature branch dédiée, `developer` implémente selon ce spec.
2. `npm run qa` vert.
3. Deploy functions (backend, non-régressif) → deploy hosting sur preview
   channel.
4. QA visuelle (Playwright + captures) sur le preview : dropzones,
   soumission, tableau historique, déclenchement manuel d'un cron via
   trigger de test si possible.
5. Screenshots + checklist → validation visuelle Omar.
6. Sur "OK deploy" : merge main + deploy prod (functions puis hosting).
7. Laisser tourner les crons 1 jour réel avant de considérer l'item terminé
   — vérifier réception effective des rappels WhatsApp par le magasinier.
