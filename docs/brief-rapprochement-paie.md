# Brief de transition — Rapprochement Excel ↔ Quinzaine ↔ Campagne

> État au 2026-08-22, fin de session. Tout ce qui suit est **mesuré**, pas déduit.
> Auteur : Claude Opus 5. Destinataire : la session qui reprend ce chantier.

---

## 1. L'objectif

Trois calculs doivent donner le même coût de main d'œuvre :

- le **fichier Excel de quinzaine** — celui qui sert à payer, donc la **source de vérité**
  (décision d'Omar, 2026-08-22 : *« c'est ça notre vérité »*) ;
- l'écran **Quinzaine** de Smart Berry ;
- l'écran **Campagne**, qui doit être identique à la Quinzaine.

---

## 2. L'état, en un tableau

Sortie réelle de l'outil de rapprochement, sur les trois quinzaines de la campagne :

| poste | 01–15/07 | 16–31/07 | 01–15/08 |
|---|---|---|---|
| JH fichier / Smart Berry | 1 484 / 1 484 ✅ | 1 465 / 1 465 ✅ | 1 490,5 / **1 465** ⚠️ |
| jours fériés fichier / SB | 0 / 0 | 74 / 73 | 72 / 75 |
| **jour férié — montant** | 0 / 0 | **6 724 / 3 598** | **6 543 / 3 393** |
| transport | 26 325 / 26 445 | 25 800 / 25 820 | 29 318 / 29 330 |
| **TOTAL décaissé** | **187 778 / 187 737** | 187 755 / 183 320 | 199 823 / 195 005 |
| **écart** | **41 DH** ✅ | 4 435 DH | 4 818 DH |

La quinzaine **sans jour férié** est la seule sans écart. C'est le **témoin du
chantier** : toute correction qui fait bouger ces 41 DH est fausse. Un test le fige
(`tests/unit/rapprochementPaie.test.js`).

---

## 3. Les deux bugs ouverts

### 3.1 Le jour férié est valorisé à ~la MOITIÉ du SMAG — **c'est la cause principale**

| quinzaine | fichier | Smart Berry | DH/jour SB | attendu |
|---|---|---|---|---|
| 16–31/07 | 6 724 (74 j) | 3 598 (73 j) | **49,3** | 90,87 |
| 01–15/08 | 6 543 (72 j) | 3 393 (75 j) | **45,2** | 90,87 |

Le **nombre** de journées est presque juste (±3). C'est donc la **valorisation** qui
dérive, et elle relève du calcul Smart Berry — pas d'un arbitrage RH.

**Où chercher** : `coutFeries` dans `public/lib/coutMainOeuvre.js` calcule le coût
marginal par différence — `paieOuvrier(jours + fériés) − paieOuvrier(jours)`. Piste
la plus probable : pour un **non-déclaré**, `computePayslip` (`public/lib/paieUtils.js`)
force `jF: 0` et `feries: 0` dans sa branche — un férié de non-déclaré vaudrait donc
zéro, et les non-déclarés sont la majorité de l'effectif (117 sur 173 en Q01). À
**vérifier avant de coder** : cette piste n'a pas été mesurée.

⚠️ Le fichier, lui, verse bien le férié aux non-déclarés : la feuille `SANS CNSS`
porte des jours fériés (29 sur la quinzaine d'août).

### 3.2 Le champ `jours` de l'instantané est PÉRIMÉ

`rh_cout_quinzaine/Quinzaine 03` porte `jours: 1465` — la valeur de la Quinzaine 02 —
alors que ses montants sont bien ceux d'août. L'instantané mélange donc un nombre de
journées d'une période avec les montants d'une autre.

**Où** : `public/app.jsx`, `_snapshotRef` (~ligne 11 960) :
`jours: totalJournees || totalJourneesDistinct || 0`. `totalJournees` vient de
`apiData.totalJournees` et ne se rafraîchit pas au même rythme que les autres totaux
au changement de période.

**Conséquence** : la colonne « JH Quinz. » du panneau Campagne affiche un chiffre faux,
et tout appariement par JH échoue. Ne pas apparier par JH — apparier par période.

---

## 4. Ce qui est EN PRODUCTION (déployé et vérifié ce jour)

| chantier | état |
|---|---|
| Transport résolu par tarif daté + formats mixtes (`Quinzaine 23` / `01/07/2026`) | ✅ prod, G6 4/4 |
| Clé de registre normalisée (`cleRegistre`) — corrigeait 8 022 DH sur la Q01 | ✅ prod |
| Instantané de la Quinzaine (`rh_cout_quinzaine`) + voyant d'état sur l'écran | ✅ prod |
| Panneau Campagne : coût chargé ↔ coût chargé, ventilation de l'écart par poste | ✅ prod |
| Sous-postes, jours fériés en nombre, populations dans l'instantané | ✅ prod |
| **Lot 3** — « Comparer au fichier de paie » dans l'écran Quinzaine | ✅ prod |

Les 4 instantanés sont enregistrés et portent les sous-postes.

---

## 5. Les outils, et comment les lancer

**Script de rapprochement à trois voies** (lecture seule, aucune écriture) :

```
node scripts/rapprochement-paie.js ~/Desktop/pointage*.xlsx
```

Prérequis : `gcloud auth print-access-token` doit répondre. ⚠️ L'**ADC**
(`gcloud auth application-default`) est une identité DISTINCTE et n'a pas les droits
Firestore ici — c'est le jeton du **CLI** qui fonctionne.

**Modules purs**, tous testés :

| fichier | rôle |
|---|---|
| `public/lib/lecturePaieExcel.js` | extraction du `.xlsx` — prend des **grilles**, pas un fichier. Copie octet pour octet dans `functions/lib/paie/`, test de parité |
| `public/lib/rapprochementPaie.js` | comparaison fichier ↔ instantané, avec la **nature** de chaque écart |
| `functions/lib/paie/coutQuinzaineSnapshot.js` | validation de l'instantané (refuse un sous-total filtré) |
| `public/components/RapprochementPaiePopup.jsx` | l'écran du Lot 3 |

---

## 6. Les pièges du fichier Excel — chacun a produit un résultat FAUX ET PLAUSIBLE

Tous rencontrés aujourd'hui, tous figés par un test dans `tests/unit/lecturePaieExcel.test.js` :

1. **Ligne de TOTAL** en bas de feuille (matricule textuel, montants numériques) →
   double **exactement** chaque somme. 1 484 journées lues 2 968.
2. **Colonnes décalées** : 15 ou 16 jours selon la quinzaine. Lire par index fixe prend
   « Total » pour « Prime ancienneté » → m'a fait conclure que les non-déclarés
   touchaient de l'ancienneté. **Ils n'en touchent pas** (0 cas sur 117 et 123).
3. **La feuille porte ses propres totaux** (`Montant Total` sur TRANSPORT) → les
   recalculer donne 849 475 DH au lieu de 26 325.
4. **Matricules** : le registre est keyé numérique, le pointage sert `CA10563`.
5. **`Prime Fonction Brut`** agrège fonction + heures sup + traitement.
6. **Noms de fichiers en NFD** (macOS) : la quinzaine se lit DANS la feuille, jamais
   dans le nom du fichier.

---

## 7. Ce que j'ai affirmé et qui était FAUX

À lire avant de reprendre une de ces pistes :

- ❌ « Les non-déclarés touchent de l'ancienneté dans le fichier » → **faux**, artefact
  de colonnes décalées.
- ❌ « L'écart vient de la retenue des non-déclarés appliquée d'un seul côté » → **faux**,
  les deux modules l'appliquent, par deux chemins équivalents.
- ❌ « Le pointage compte 39 fériés le 14/08 contre 72 à la paie » → **faux**, j'avais
  compté les matricules distincts d'une seule date au lieu de lire `jourFerieDetail`.
  Le vrai écart de comptage est de ±3 journées.
- ❌ « `rh_config/transport_primes` est vide » → **faux**, c'était un 403.
- ❌ « L'écart de la quinzaine sans férié est de 161 DH » → **41 DH** ; j'avais croisé
  le transport de Smart Berry avec la colonne du fichier.

**La leçon** : quatre diagnostics successifs, tous produits en raisonnant sur le code.
Ce qui a tranché à chaque fois, c'est de lire les données — Firestore ou le fichier de
paie. **Mesurer d'abord.**

---

## 8. La suite, dans l'ordre

1. **Vérifier** la piste du férié des non-déclarés (§3.1) — par la mesure, pas par la
   lecture du code. Puis corriger, avec un test.
2. **Corriger** le `jours` périmé de l'instantané (§3.2).
3. Reprendre le rapprochement : les 4 435 / 4 818 DH doivent tomber à ~1 300 / 1 700
   (le résidu « hors férié » actuel), et les 41 DH de la Q01 ne doivent pas bouger.
4. Identifier ce résidu de ~1 500 DH. Piste non vérifiée : les ouvriers **à cheval sur
   les deux feuilles** (17, 13 et 20 selon la quinzaine), dont une partie des journées
   est déclarée et l'autre non, alors que Smart Berry leur donne un statut unique.

---

## 9. Contraintes de travail (non négociables)

- **Ne jamais lire `.env`** — refusé par la politique de permissions. Les scripts le
  sourcent eux-mêmes.
- **Jamais de `cd … &&`** ni de chaînes `a && b && c` — bloqué par un hook.
- **Force-push interdit**, y compris `--force-with-lease`.
- Tout deploy passe par `scripts/deploy.sh` ; `functions` est **asynchrone** (GitHub
  Actions + WIF) — attendre la fin réelle du run avant la gate G6.
- **GO frais à chaque gate** : une autorisation antérieure ne vaut pas GO permanent.
- Le fichier de paie n'entre **jamais** dans le dépôt (250 personnes nominatives).
