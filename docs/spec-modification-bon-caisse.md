# Spec — Modification d'un bon de caisse après création (GATED)

> **Statut** : spec prête, en attente du GO d'Omar.
> **Demande** : « Gestion de caisse. On a besoin de pouvoir modifier un bon de caisse
> (date, montant, nature de dépense…) après sa création. Cette fonctionnalité n'existe pas. »
> **Date** : 2026-08-26
> **Nature** : nouvelle fonctionnalité + changement de logique métier (solde caisse) → **GATED**.

---

## 1. Contexte — ce qui existe aujourd'hui

### 1.1 Backend : l'action existe mais est bridée

`functions/index.js:15481` — action `update-transaction` (POST `/api/caisse?action=update-transaction`).

Restrictions actuelles :

| Garde | Règle actuelle |
|---|---|
| Rôle | `isSaisie` (profil `achats`) ou `isAdmin` — **DG/Finance ne peut pas** |
| Statut | `brouillon` ou `rejete` uniquement |
| Propriété | `current.saisie_by.uid === authUser.uid` (sauf admin) |
| Champs | `caisse_id, type, montant, reference, description, code_analytique, date, files` |
| Traçabilité | pousse `{ action: 'modification', by, at }` dans `history` — **sans les valeurs avant/après** |
| Solde | aucun impact (un brouillon/rejeté n'a jamais bougé `solde_actuel`) |
| Validation d'entrée | **aucune** : pas de contrôle `montant > 0`, pas de whitelist de `type`, pas de vérif d'existence de la caisse (contrairement à `create-transaction`, `functions/index.js:15319`) |

### 1.2 Frontend : l'action n'est jamais appelée

`grep 'update-transaction' public/app.jsx` → **0 occurrence**. Seule mention dans le repo :
`public/lib/local-test-bypass.js:250` (liste d'actions mockées).

La pop-up « Détail Transaction » (`public/app.jsx:60856`, dans `CaisseTransactionsSub`)
est strictement en lecture seule : référence, date, caisse, type, montant, statut,
description, code analytique, saisi/validé/rejeté par, pièces jointes, historique.
**Aucun bouton d'action.**

Le formulaire de saisie `CaisseSaisieSub` (`public/app.jsx:60911`) est en mode
création uniquement : état initial en dur, appelle `create-transaction`, deux
boutons (« Enregistrer brouillon » / « Soumettre pour validation »).

**Conséquence réelle pour l'utilisateur** : un bon est figé **dès sa création**.
Même un brouillon n'est pas modifiable, faute d'UI. Le seul contournement existant
est le cycle rejet → re-saisie, réservé à DG/Finance et qui perd la référence.

### 1.3 Le point dur : le solde de caisse

`solde_actuel` de `caisse_definitions` n'est mouvementé qu'**à la validation**
(`validate-transaction`, `functions/index.js:15531`) :

```
alimentation | transfer_in                          → delta = +montant
depense | sortie | transfer_out | paie | transport  → delta = -montant
```

Donc modifier `montant`, `type` ou `caisse_id` d'un bon **validé** désynchronise
le solde s'il n'est pas réajusté atomiquement.

⚠️ **Incohérence pré-existante repérée** (hors périmètre, à ne PAS corriger ici) :
`validate-transaction` compte `paie` et `transport` comme sorties, mais les
recalculs de solde de `bulk-import-transactions` (`functions/index.js:15165`) et
de `_computeRapprochementTotals` (`functions/index.js:16005`) ne les comptent pas.
Un recalcul global écraserait donc le solde avec une valeur différente. **C'est
pourquoi cette spec impose un ajustement par delta, jamais un recalcul global.**

### 1.4 Le second verrou : le rapprochement mensuel

`caisse_rapprochements` (`functions/index.js:16099` / `16138`). Un rapprochement
clôturé (`statut === 'cloture'`) fige le solde théorique du mois : `solde_initial`,
`total_recettes`, `total_depenses`, `solde_theorique`, `solde_physique`, `ecart`,
signé par DG/Finance. Modifier après coup un bon validé de ce mois — ou y déplacer
la `date` d'un bon d'un autre mois — invaliderait silencieusement ce document signé.

Périodes : `_periodeBounds(mois, annee)` → `docId` = `${caisse_id}_${docId période}`.
La borne se calcule sur le champ `date` (string `YYYY-MM-DD`).

---

## 2. Décisions produit (validées par Omar le 2026-08-26)

1. **Périmètre statuts** : modifiable jusqu'à **Validé** inclus
   (`brouillon`, `soumis`, `a_revoir`, `rejete`, `valide`).
2. **Modification d'un bon VALIDÉ** : le service **Achats** peut modifier
   **sa propre** saisie validée ; la modification **dévalide** le bon → il
   repasse en `soumis` (affiché « Saisi ») et doit être **re-validé** par DG/Finance.
   Le solde est décrémenté du delta d'origine au moment de la dévalidation.
3. **Mois clôturé** : édition **refusée** si le bon appartient à une période
   dont le rapprochement est `cloture` (ou si la nouvelle date y tomberait).

---

## 3. Règles métier cibles

### 3.1 Matrice des droits

| Statut du bon | `achats` (propriétaire) | `achats` (autre saisie) | `dg` / `finance` | `admin` |
|---|---|---|---|---|
| `brouillon` | ✅ modifie | ❌ | ❌ | ✅ |
| `soumis` (Saisi) | ✅ modifie | ❌ | ✅ modifie | ✅ |
| `a_revoir` | ✅ modifie | ❌ | ✅ modifie | ✅ |
| `rejete` | ✅ modifie | ❌ | ✅ modifie | ✅ |
| `valide` | ✅ modifie → **dévalidation** | ❌ | ✅ modifie → **dévalidation** | ✅ |

Note : `dg`/`finance` gagnent un droit d'édition qu'ils n'avaient pas
(aujourd'hui `update-transaction` est réservé à `isSaisie`/`isAdmin`). C'est
cohérent avec leur rôle de contrôle — ils peuvent déjà rejeter, réassigner un
code analytique en masse (`reassign-analytique-batch`) et clôturer.

### 3.2 Transitions de statut

| Statut avant | Statut après modification | Effet solde |
|---|---|---|
| `brouillon` | `brouillon` (inchangé) | aucun |
| `soumis` | `soumis` (inchangé) | aucun |
| `a_revoir` | `a_revoir` (inchangé) | aucun |
| `rejete` | `rejete` (inchangé) — le bon reste à re-soumettre | aucun |
| `valide` | **`soumis`** | `solde_actuel -= delta_origine` |

`delta_origine` = le delta qui avait été appliqué à la validation, recalculé
depuis les **anciennes** valeurs (`type`, `montant`) et imputé sur l'**ancienne**
`caisse_id`. Le nouveau delta ne sera appliqué qu'à la re-validation, par le
chemin existant `validate-transaction` — **aucune duplication de la logique de solde**.

En cas de dévalidation, on efface `valide_par` / `valide_at`
(`admin.firestore.FieldValue.delete()`) et on repositionne `soumis_par` /
`soumis_at` sur l'auteur de la modification, pour que le bon réapparaisse dans
la file de validation (`CaisseValidationSub`, `public/app.jsx:61326`, qui filtre
sur `status === 'soumis'`).

### 3.3 Champs modifiables

| Champ | Modifiable | Contrainte |
|---|---|---|
| `date` | ✅ | `YYYY-MM-DD` valide ; mois source **et** mois cible non clôturés |
| `montant` | ✅ | nombre fini `> 0` |
| `type` | ✅ | dans `['alimentation','depense','sortie','paie','transport']` |
| `code_analytique` | ✅ | vide autorisé ; libre (aligné sur `create-transaction`) |
| `description` | ✅ | libre, vide autorisé |
| `caisse_id` | ✅ | caisse existante **et** `active === true` |
| `matricule`, `beneficiaire_nom` | ✅ | pertinents si `type ∈ {paie, transport}` |
| `files` | ✅ | max 3 (`slice(0,3)`), comportement actuel conservé |
| `reference` | ❌ **gelé** | identifiant métier imprimé sur le bon papier ; le laisser muter casse la traçabilité et les rapprochements manuels. Retirer de la liste des champs acceptés. |
| `status` | ❌ | jamais piloté par le client — dérivé par la règle 3.2 |
| `saisie_by`, `created_at`, `history` | ❌ | immuables |

⚠️ Le code actuel accepte `reference` : c'est une **restriction** volontaire par
rapport à l'existant. Aucun appelant ne l'utilise (le front n'appelle pas l'action),
donc aucun risque de régression.

⚠️ Types **exclus** : `transfer_in` / `transfer_out` (générés par paire via
`create-transfer`, `functions/index.js:15604`) et `vente` / `encaissement`
(marché local, écrits uniquement par `apply-encaissements`). Un bon de l'un de
ces types est **non modifiable** par cette action → 400 explicite.

### 3.4 Verrou rapprochement

Avant tout write, si `status === 'valide'` **ou** si la `date` change :

1. Calculer la période du bon **avant** modification (`_periodeBounds` sur `current.date`).
2. Calculer la période **après** modification (sur la nouvelle `date`).
3. Pour chacune, lire `caisse_rapprochements/${caisse_id}_${periode.docId}`.
   Si le doc existe et `statut === 'cloture'` → **400** :
   `"Modification impossible : le rapprochement de <Mois AAAA> est clôturé."`
4. Si `caisse_id` change, tester les deux couples (ancienne caisse/ancienne période,
   nouvelle caisse/nouvelle période).

Ce contrôle ne s'applique pas aux statuts `brouillon` / `rejete` / `a_revoir` sans
changement de date : ils ne pèsent pas sur le solde théorique.
(Attention : un bon `soumis` est comptabilisé comme *bloquant* par
`_computeRapprochementTotals` mais n'entre pas dans les totaux ; il n'existe donc
pas de rapprochement clôturé sur un mois qui contient un `soumis` — la clôture
l'aurait refusé. Le contrôle reste néanmoins appliqué en cas de changement de date,
pour éviter de **déplacer** un bon vers un mois déjà clôturé.)

### 3.5 Traçabilité

Aujourd'hui l'historique ne dit pas *ce qui* a changé. La nouvelle entrée :

```js
{
  action: 'modification',
  by: userInfo,
  at: Date.now(),
  changes: [ { field: 'montant', from: 1200, to: 1450 },
             { field: 'date',    from: '2026-08-03', to: '2026-08-05' } ],
  devalidated: true   // présent uniquement si le bon était 'valide'
}
```

Seuls les champs réellement modifiés apparaissent (comparaison stricte après
normalisation ; `files` résumé en `{ from: n, to: m }` pour ne pas stocker les
base64 dans l'historique). L'affichage existant de l'historique
(`public/app.jsx:60894`) doit rendre ces `changes` en clair, par exemple :
`modification par Ahmed le 26/08/2026 — Montant 1 200,00 DH → 1 450,00 DH ; Date 03/08 → 05/08`.

---

## 4. Plan d'implémentation

### Lot 1 — Backend : durcir et étendre `update-transaction`

**Fichier** : `functions/index.js`, bloc `action === "update-transaction"` (≈ ligne 15481).

Réécriture complète du handler :

1. **Rôles** : autoriser `isSaisie || isControle || isAdmin` (au lieu de `isSaisie || isAdmin`).
2. **Lecture + gardes hors transaction** (fail-fast, messages clairs) :
   - doc existe, sinon 404 ;
   - `current.status ∈ ['brouillon','soumis','a_revoir','rejete','valide']`, sinon 400 ;
   - `current.type ∉ ['transfer_in','transfer_out','vente','encaissement']`, sinon 400
     `"Un transfert / un encaissement ne se modifie pas ici."` ;
   - propriété : si `isSaisie && !isControle && !isAdmin` → `current.saisie_by?.uid === authUser.uid`, sinon 403 ;
   - validation des champs entrants (§3.3) : `montant > 0` fini, `type` dans la whitelist,
     `date` au format `YYYY-MM-DD`, `caisse_id` existante et active ;
   - verrou rapprochement (§3.4).
3. **Write** :
   - **Cas non-validé** (`status !== 'valide'`) : simple `doc.update()` — pas besoin de
     `runTransaction`, aucun solde en jeu.
   - **Cas validé** : `db_firestore.runTransaction()` obligatoire —
     `t.get(txRef)` + `t.get(caisseRef)` (relire pour la cohérence, revérifier
     `status === 'valide'` sinon throw), puis
     `t.update(txRef, { ...updates, status: 'soumis', soumis_par: userInfo, soumis_at: now, valide_par: DELETE, valide_at: DELETE, history })`
     et `t.update(caisseRef, { solde_actuel: soldeCourant - deltaOrigine, updated_at: now })`.
   - Extraire le calcul du delta dans un helper pur partagé pour éviter la divergence
     avec `validate-transaction` :
     `functions/lib/caisse/soldeDelta.js` → `computeSoldeDelta({ type, montant })`.
     `validate-transaction` doit être refactorisé pour l'utiliser (**même formule, comportement identique** — vérifié par test).
4. **Réponse** : `{ success: true, status: <nouveau statut>, devalidated: bool, changes: [...] }`
   pour que le front affiche le bon message.

**Nouveau module** : `functions/lib/caisse/soldeDelta.js` (`'use strict'`, `// @ts-check`, JSDoc strict,
pure, exporté en CommonJS) + `functions/lib/caisse/rapprochementLock.js` pour
`periodeDocIdFor(dateStr)` (extraction de la logique `_periodeBounds`, sans I/O).

⚠️ **Ne jamais `require('../public/...')`** depuis `functions/` (piège connu :
Firebase ne déploie que `functions/`).

### Lot 2 — Tests unitaires (bloquants)

`functions/lib/caisse/__tests__/soldeDelta.test.js` (`node:test`) :
- delta `+montant` pour `alimentation`, `transfer_in` ;
- delta `-montant` pour `depense`, `sortie`, `transfer_out`, `paie`, `transport` ;
- delta `0` pour un type inconnu ;
- montant `0` / absent → `0`.

`functions/lib/caisse/__tests__/rapprochementLock.test.js` :
- `periodeDocIdFor('2026-08-05')` → même `docId` que `_periodeBounds(8, 2026)` ;
- bascule de mois (`2026-07-31` vs `2026-08-01`), bascule d'année (`2026-12-31` / `2027-01-01`) ;
- date invalide → `null`.

Ces deux modules sont ramassés automatiquement par `npm run test:all`
(pattern `functions/lib/*/__tests__`).

### Lot 3 — Frontend : rendre `CaisseSaisieSub` bimodal

**Fichier** : `public/app.jsx` (`CaisseSaisieSub`, ≈ ligne 60911).

⚠️ **Règle de modularisation** : le bloc est *touché* → il doit être **extrait**
dans `public/components/CaisseSaisieSub.jsx` **à comportement identique d'abord**
(déplacer → vérifier l'UI identique → puis seulement ajouter le mode édition).
Le composant s'expose en `window.CaisseSaisieSub` (build Babel actuel, pas d'ESM
runtime) — attention aux **collisions de noms globaux** (piège connu : crash React #200).

Nouvelle prop `editTx` (objet transaction, ou `null`) :
- état initial du formulaire hydraté depuis `editTx` quand présent ;
- titre : « Modifier la transaction — `<reference>` » au lieu de « Nouvelle Transaction » ;
- `reference` affichée en **lecture seule** (grisée) ;
- boutons : un seul, « Enregistrer les modifications » → POST `update-transaction`
  avec `{ id: editTx.id, ...form }` ;
- si `editTx.status === 'valide'` : bandeau d'avertissement **avant** la sauvegarde —
  *« Ce bon est validé. L'enregistrer le remettra au statut Saisi et il devra être
  re-validé par la DG. »* + `confirm()` au clic ;
- au succès, message dépendant de `devalidated` :
  « Modifications enregistrées » vs « Modifications enregistrées — le bon repasse en Saisi
  et doit être re-validé ».

### Lot 4 — Frontend : point d'entrée « Modifier »

**Fichier** : `public/app.jsx`, pop-up Détail Transaction (≈ ligne 60856), dans `CaisseTransactionsSub`.

- Ajouter un pied de pop-up avec un bouton **« Modifier »**
  (icône `fa-pen-to-square`), affiché seulement si l'utilisateur courant a le droit
  selon §3.1 **et** que le statut est éditable **et** que le type n'est pas exclu (§3.3).
- Au clic → ouvre `CaisseSaisieSub` en mode édition (modale, ou bascule d'onglet
  vers Saisie avec `editTx` — retenir la **modale** pour ne pas perdre les filtres
  et le tri de la liste).
- Après succès → fermer, `setSelectedTx(null)`, recharger la liste (`load()`),
  et afficher le toast existant (`setToast`).
- Le droit d'édition côté client est **purement cosmétique** : la garde qui compte
  est celle du backend (§4 Lot 1).

### Lot 5 — Definition of done

- `npm run code-index` puis committer les `docs/ai/*` régénérés (touche
  `functions/` **et** `public/app.jsx` → gate d'obsolescence sinon rouge).
- `npm run qa` 100 % vert.
- `npm run typecheck` : aucune **nouvelle** erreur.
- Smoke-load navigateur réel du preview (piège connu : collision UMD → React #200).

---

## 5. Validation croisée — exemple chiffré

Caisse `CAISSE-F1`, `solde_actuel = 10 000,00 DH`.
Bon `REF-2026-XYZ`, `type = depense`, `montant = 1 200,00`, `date = 2026-08-05`, statut `valide`.
→ à la validation, delta appliqué = `-1 200,00`. Solde reflété : `10 000,00`.

**Achats corrige le montant en 1 450,00 DH.**

| Étape | Statut bon | `solde_actuel` |
|---|---|---|
| Avant | `valide` | 10 000,00 |
| `update-transaction` (dévalidation, `solde -= delta_origine = -1200` → `+1200`) | `soumis` | **11 200,00** |
| DG re-valide (`validate-transaction`, delta = `-1450`) | `valide` | **9 750,00** |

Contrôle : `10 000,00 - (1 450,00 - 1 200,00) = 9 750,00` ✅.

**Cas changement de caisse** — même bon déplacé de `CAISSE-F1` vers `CAISSE-F5` :
- dévalidation : `CAISSE-F1.solde_actuel += 1 200,00` (ancienne caisse, ancien montant) ;
- re-validation : `CAISSE-F5.solde_actuel -= 1 450,00` (nouvelle caisse, nouveau montant).
Les deux caisses restent justes parce que la dévalidation utilise **systématiquement**
les valeurs **d'avant** modification.

**Cas changement de type** (`depense` → `alimentation`, 1 200,00) :
- dévalidation : `+1 200,00` (annule le `-1 200,00` d'origine) ;
- re-validation : `+1 200,00`. Solde net : `10 000 + 2 400 = 12 400,00`.
Contrôle : le bon pesait `-1 200`, il pèse désormais `+1 200`, écart `+2 400` ✅.

---

## 6. Risques et edge cases

| # | Risque | Traitement |
|---|---|---|
| R1 | Double-clic / requête concurrente sur un bon validé → double décrément | `runTransaction` + revérification `status === 'valide'` **dans** la transaction ; le 2ᵉ appel throw |
| R2 | Le bon est validé par la DG pendant que Achats édite | Idem R1 : la relecture dans la transaction voit `valide`, la garde de statut tranche ; message d'erreur explicite côté client + rechargement |
| R3 | Recalcul global du solde au lieu du delta | **Interdit** par la spec (§1.3 : les 3 formules de solde du repo divergent sur `paie`/`transport`). Uniquement des ajustements par delta |
| R4 | Dévalidation d'un bon compté dans un rapprochement clôturé | Bloqué en amont (§3.4) |
| R5 | Déplacement de date **vers** un mois clôturé | Bloqué : la période **cible** est testée aussi (§3.4) |
| R6 | Collision de nom global à l'extraction de `CaisseSaisieSub` | Smoke-load navigateur obligatoire avant preview (piège connu) |
| R7 | `files` en base64 gonflent l'`history` | L'historique ne stocke qu'un compte `{from: n, to: m}` |
| R8 | Un bon `paie`/`transport` édité perd `matricule`/`beneficiaire_nom` | Ces champs sont explicitement gérés dans le payload et le formulaire d'édition |
| R9 | Régression sur `validate-transaction` lors du refacto du delta | Helper pur + tests unitaires couvrant les 7 types avant/après |
| R10 | Le front cache « Modifier » mais un appel direct passe | Toutes les gardes sont **backend** ; le front est cosmétique |

---

## 7. Fichiers touchés (récapitulatif)

| Fichier | Nature |
|---|---|
| `functions/index.js` | réécriture du handler `update-transaction` + refacto delta dans `validate-transaction` |
| `functions/lib/caisse/soldeDelta.js` | **nouveau** — helper pur |
| `functions/lib/caisse/rapprochementLock.js` | **nouveau** — helper pur (période → docId) |
| `functions/lib/caisse/__tests__/soldeDelta.test.js` | **nouveau** |
| `functions/lib/caisse/__tests__/rapprochementLock.test.js` | **nouveau** |
| `public/components/CaisseSaisieSub.jsx` | **nouveau** — extraction + mode édition |
| `public/app.jsx` | retrait de `CaisseSaisieSub`, bouton « Modifier » dans la pop-up détail, rendu des `changes` dans l'historique |
| `public/index.html` | `<script>` du nouveau composant |
| `docs/ai/*` | régénérés (`npm run code-index`) |

**8 fichiers hors générés** — exactement à la limite du périmètre par ticket.
Si l'implémentation déborde, découper en deux tickets : **(A)** backend + tests
(Lots 1‑2), **(B)** frontend (Lots 3‑4). Le lot A est livrable et testable seul
(ticket backend pur : pas de preview, preuve = test rouge → vert).

---

## 8. Fini quand

Un bon de caisse validé peut être corrigé (date, montant, type, code analytique,
caisse, description) depuis la pop-up de détail par le service Achats ou la DG,
repasse automatiquement en « Saisi » avec le solde de caisse réajusté du montant
exact, l'historique affichant les valeurs avant → après, et l'édition est refusée
si le rapprochement du mois concerné est clôturé.

---

## 9. Ordre de déploiement

Ticket mixte back + front → **le merge précède le preview** :
`merge main` → `scripts/deploy.sh functions` → attendre la fin réelle du run
(`gh run watch --repo omaaouni/BERRYGOOD`) → `firebase hosting:channel:deploy qa-test`
→ QA visuelle → `scripts/deploy.sh hosting`.
