# Spec — Archivage d'une quinzaine à sa validation (GATED)

> Statut : **spec, non implémenté — en attente d'un « GO spec-archive-quinzaine »**.
> Demande d'Omar, 2026-08-20 : « faire pointer les quinzaines après leur validation sur
> une table Firebase pour éviter de redemander la mise à jour de BEE ONE ».
> Auteur : Claude Opus 5.

**Fini quand** : une quinzaine validée se relit intégralement depuis Firestore — coûts,
primes, transport, fériés, analytique — sans qu'aucune requête ne reparte vers le miroir
BEE ONE, et ses chiffres ne bougent plus jamais, quoi qu'il arrive en amont.

---

## 1. Pourquoi

### 1.1 On relit le miroir BEE ONE en permanence

Chaque consultation d'une quinzaine, même vieille de six mois, relit les documents
journaliers de `sql_mirror_pointage` et recalcule tout. C'est lent, et c'est
proportionnel au nombre de jours consultés.

C'est aussi ce qui a imposé le plafond `periodes.slice(0, 2)` de l'action `transport`
(`functions/src/modules/rh/pointageService.js`) — un commentaire du code chiffre 6 quinzaines à
~12 000 lignes et ~10 s de réponse. Ce plafond a produit le bug du 2026-08-20 : les blocs
Transport / Autres primes / Jours fériés vides sur Q1 et Q2, avec des KPI justes au-dessus.
Le correctif livré (`?periode=`) charge « les 2 récentes + celle demandée » : il traite le
symptôme, pas la cause.

### 1.2 Un chiffre validé peut encore bouger

Aujourd'hui, rien ne fige une quinzaine. Si BEE ONE corrige un pointage d'avril en
novembre, la quinzaine d'avril change **rétroactivement**, y compris après paiement.
Personne n'en est averti et aucune trace ne subsiste de ce qui avait été validé.

C'est le vrai enjeu : **la paie versée doit rester opposable**.

### 1.3 La collection existe déjà, mais orpheline

`quinzaine_archive` est **lue** à quatre endroits de `functions/src/modules/rh/pointageService.js`
(actions `quinzaine`, `quinzaine-analytique`, `quinzaine-alertes`, `quinzaine-repos`) et
listée par `rebuildPointageMetaFromMirror` (`functions/src/modules/rh/sqlSyncService.js`) pour composer
`allPeriodes`.

**Rien ne l'écrit dans le code.** Les documents présents viennent d'un import manuel ou
d'un script disparu. Le chemin de lecture est donc déjà là et fonctionne — il ne manque que
l'écriture, et un contrat clair sur ce qu'on fige.

---

## 2. Ce qui déclenche l'archivage

**La validation de la quinzaine**, et elle seule. Pas un cron, pas une date : un archivage
temporel figerait des quinzaines encore en cours de correction.

Point d'accroche à confirmer à l'implémentation : le workflow de validation du pointage
(`functions/index.js`, actions `quinzaine-status` / `validate-*`). L'archivage doit être
**la dernière étape** de la validation, et son échec doit faire échouer la validation —
une quinzaine marquée validée mais non archivée est le pire des deux mondes.

**Ré-archivage** : autorisé uniquement par une action explicite et tracée
(`quinzaine-archive-refaire`), réservée DG/RH, qui écrit une nouvelle version sans écraser
la précédente (cf. §4).

---

## 3. Ce qu'on fige, et ce qu'on ne fige pas

### 3.1 Figé — les FAITS de la quinzaine

| donnée | source | pourquoi la figer |
|---|---|---|
| lignes de pointage agrégées (matricule × jour × opération × parcelle) | `sql_mirror_pointage` | c'est le fait métier ; il ne doit plus bouger |
| journées et heures sup par ouvrier | idem | base de la paie versée |
| `Cout` BEE ONE | idem | témoin du rapprochement |
| primes de terrain (transport, récolte, traitement, conditionnement, chargement, fériés) | `computeChargCond`, `computeRecolteEquipesPayload` | calculées sur des faits datés |
| agrégats analytiques (parcelle × famille) | `quinzaine-analytique` | ce que l'écran affiche |

### 3.2 NON figé — ce qui dépend d'un barème

Le **salaire** et les **charges** ne sont pas figés : ils sont recalculés à la lecture, par
le modèle Smart Berry (`paieUtils`), à partir des journées archivées.

Raison : un barème corrigé rétroactivement (SMAG revalorisé, palier d'ancienneté ajusté)
doit se propager. Figer le salaire obligerait à ré-archiver toutes les quinzaines à chaque
correction de barème — et à choisir, quinzaine par quinzaine, laquelle refaire.

⚠️ **Conséquence assumée** : un changement de barème modifie l'historique affiché. Si Omar
veut au contraire une paie strictement opposable, il faut figer AUSSI le salaire, et alors
prévoir le ré-archivage explicite. **Ce point doit être tranché avant l'implémentation** —
il est plus facile à décider maintenant qu'à rattraper après.

---

## 4. Forme du document

`quinzaine_archive/{label}` — clé = libellé brut, sans suffixe de campagne (le
`archiveDocRef` actuel fait déjà ce découpage, cf. `splitCompositeLabel`).

```
{
  version: 2,                        // 1 = documents historiques, forme inconnue
  campagne: "2026/2027",
  periode: "Quinzaine 03",
  dates: ["2026-08-01", …],
  archivedAt: <timestamp>,
  archivedBy: { uid, profileId, name },
  source: "validation" | "refait",
  // Les faits
  rows: [ … ],                       // agrégé, cf. §3.1
  primes: { transport: […], recolte: […], chargCond: […], feries: […] },
  analytique: [ … ],
  // Le résumé déjà consommé par l'action `quinzaine`
  summary: { parFerme, parJour, parCulture, totalJournees, totalCout },
}
```

**Versions** : un ré-archivage écrit `quinzaine_archive/{label}/versions/{archivedAt}` avec
l'ancien contenu AVANT d'écraser le document principal. On peut ainsi répondre à « qu'est-ce
qui avait été validé le jour du paiement ? », qui est toute la valeur de l'archive.

**Taille** : une quinzaine ≈ 12 000 lignes brutes. Après agrégation par
(matricule, jour, opération, parcelle), compter quelques milliers de lignes. À vérifier
contre la limite Firestore de **1 Mio par document** ; si elle est approchée, découper en
sous-collection `rows/{jour}` plutôt que de tronquer — une archive tronquée est pire
qu'une archive absente.

---

## 5. Lecture

Ordre de résolution, à appliquer partout où une quinzaine est lue :

1. `quinzaine_archive/{label}` existe → **on lit l'archive, point**. Aucune requête miroir.
2. Sinon → chemin actuel (miroir, puis repli SQL).

Les actions concernées lisent déjà l'archive en premier pour `quinzaine`,
`quinzaine-analytique`, `quinzaine-alertes` et `quinzaine-repos` : il s'agit d'étendre le
même réflexe à `transport`, `heures-sup` et `recolte-equipes`, aujourd'hui bornées à
`slice(0, 2)`.

Une fois cela fait, **le plafond des deux quinzaines peut sauter** : les anciennes ne
coûtent plus qu'une lecture de document.

---

## 6. Ce qu'il faut décider avant de coder

| question | pourquoi elle bloque |
|---|---|
| **Fige-t-on le salaire, ou seulement les journées ?** (§3.2) | détermine si un barème corrigé réécrit l'historique — irréversible dans un sens comme dans l'autre |
| **Que fait-on si BEE ONE corrige un pointage déjà archivé ?** | trois options : ignorer (l'archive fait foi), alerter sans toucher, ou ré-archiver automatiquement. La deuxième est la seule qui ne perde rien |
| **Qui peut ré-archiver ?** | DG/RH seulement, ou aussi le chef de ferme sur son périmètre |

---

## 7. Vérification

1. Archiver une quinzaine de test, puis **couper l'accès au miroir** (variable
   `USE_FIRESTORE_MIRROR=false` en local) : l'écran doit s'afficher intégralement.
2. Modifier une ligne du miroir sur une quinzaine archivée : l'écran ne doit **pas** bouger.
3. Ré-archiver : la version précédente doit rester lisible dans la sous-collection.
4. Mesurer le temps de réponse d'une quinzaine archivée contre une non archivée — c'est le
   gain attendu, il doit se voir.
5. `npm run qa` vert, et le test de non-régression de l'écran Quinzaine inchangé.
