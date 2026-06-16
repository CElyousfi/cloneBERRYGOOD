# Spec — Réconciliation inventaire physique (comptage ↔ théorique ↔ ajustement)

> **Statut : CADRAGE (2026-06-16, non codé). GATED.** File d'attente : à traiter **APRÈS** (1) les
> 4 BL « factures à retrouver » ✅ et (2) l'**UI factures**. Objectif : permettre à l'équipe de
> **compter physiquement** le stock périodiquement (clôture campagne ou ponctuel), **comparer** au
> stock théorique système, et **ajuster** les écarts de façon tracée et valorisée (lien CPC).

## 0. Principe
Le stock théorique (reconstruit depuis le grand livre + mouvements, cf.
`spec-reconstruction-stock.md`) **dérive** du réel avec le temps (casse, pertes, erreurs de saisie,
vols, évaporation…). Périodiquement on **recompte physiquement**, on mesure l'**écart**, et on pose un
**mouvement d'ajustement** daté qui réaligne le théorique sur le compté. L'écart **manquant** est une
**perte valorisée** (qté × PMP) à comptabiliser au CPC.

## 1. Les 4 briques (besoin)

### 1.1 Saisie de l'inventaire physique
Écran/import où le magasinier entre les **quantités comptées** : `article × magasin × qté_réelle` à
une **date de comptage** donnée.
- **Réutiliser l'existant** : l'import d'**inventaire d'ouverture** (feuille `INVENTAIRE AU 30-06-25`
  du canevas, déjà ingéré) fournit le **même format** (LIEU DE STOCK · NOM ARTICLE · UNITE · QUANTITE).
  → un import « inventaire physique daté » peut **cloner ce pipeline** (même parsing, même
  canonicalisation `canon()`), avec un `type: 'inventaire_physique'` et une `date_comptage`.
- Alternative/complément : **saisie manuelle** article par article (pour un inventaire tournant léger,
  cf. §3). À trancher : import Excel d'abord (volume), saisie manuelle ensuite.

### 1.2 Comparaison théorique vs physique
Pour chaque `article × magasin` à la date de comptage :

| Stock théorique (système) | Stock physique (compté) | Écart (phys − théo) |
|---|---|---|
| dérivé mouvements à la date | saisi §1.1 | + = surplus (gain) · − = manquant (perte) |

- Le théorique se calcule **à la date du comptage** (même moteur que la Fiche de Stock / soldes).
- Sortie : tableau écart par article × magasin, trié par |écart valorisé| décroissant.

### 1.3 Ajustement
Créer un **mouvement d'ajustement d'inventaire** qui aligne le théorique sur le physique :
- `type: 'ajustement_inventaire'` (le type générique `ajustement` existe déjà côté CF — à spécialiser),
  `date = date_comptage`, `qte = écart` (signé), `motif`, `justification`, lien `inventaire_id`.
- **Traçable** : apparaît dans l'historique/mouvements de l'article, jamais silencieux.
- **Idempotent** : un comptage = un lot d'ajustements ; rejouer ne double pas (clé = `inventaire_id`).

### 1.4 Valorisation de l'écart (lien CPC)
- **Manquant** : `perte = |écart| × PMP_courant` (PMP daté campagne, cf. `spec-valorisation-pmp.md`
  §10) → charge à comptabiliser.
- **Surplus** : gain (produit exceptionnel) ou correction d'une sortie erronée — à qualifier.
- Agrégat par campagne → **ligne CPC « pertes/ajustements de stock »**. Le PMP fournit le coût unitaire.

## 2. Schéma cible
```
Comptage physique (import/saisie, daté)
        │  article × magasin × qté_réelle
        ▼
Théorique système (moteur soldes, à la date) ──► ÉCART = phys − théo (par article × magasin)
        │                                              │
        │                                              ├─ valorisation écart × PMP (§10 valo)
        ▼                                              ▼
Mouvement 'ajustement_inventaire' (daté, tracé) ──► perte/gain → CPC (par campagne)
```

## 3. Questions à trancher (Omar, au démarrage de l'item)
1. **Total ou tournant ?** Inventaire **complet** (tous articles, clôture campagne) ou **tournant**
   (par rotation, quelques articles à la fois). → impacte §1.1 (import lourd vs saisie ciblée).
2. **Validation des ajustements.** Magasinier **saisit** ; le DG **valide les gros écarts** ?
   (workflow brouillon → soumis → validé, comme la caisse). Seuil de validation DG à définir.
3. **Seuil d'alerte.** Écart > X % (ou > Y DH valorisés) → **investigation avant ajustement**
   (ne pas ajuster aveuglément un gros manquant). Reste à fixer X/Y.
4. **Périmètre lieux.** Par magasin physique (F1/F2/F5/F6, station) ou consolidé ? (défaut : par magasin).
5. **Fréquence.** Clôture de campagne (annuel) + ponctuel à la demande ? (cohérent modèle campagnes).

## 4. Réutilisations & garde-fous
- **Réutiliser** : pipeline d'import inventaire d'ouverture (§1.1), `canon()` pour le matching article,
  moteur de soldes pour le théorique, hiérarchie PMP (§10) pour la valorisation.
- **Garde-fous** (à l'implémentation, GATED) : backup avant écriture des ajustements ; aperçu chiffré
  écart par article (théo/phys/écart/valorisation) **validé par Omar** avant de poser les mouvements ;
  rapport d'audit des ajustements (qui, quand, justification) ; aucun ajustement silencieux.

## 5. Phases (GATED)
- **P0** : ce cadrage. ✅
- **P1** : import/saisie inventaire physique daté (`type 'inventaire_physique'`, clone du pipeline
  ouverture) + stockage.
- **P2** : écran comparaison théo/phys + écart valorisé (PMP), read-only, aperçu.
- **P3** : génération des mouvements `ajustement_inventaire` (daté, tracé, workflow validation §3.2)
  après validation Omar. Backup + aperçu obligatoires.
- **P4** : agrégat pertes/gains par campagne → alimentation CPC.

## 6. Liens
- Stock théorique / reconstruction : `spec-reconstruction-stock.md`.
- PMP daté campagne (valorisation de l'écart) : `spec-valorisation-pmp.md` §10.
- Frontière campagne : `spec-gestion-campagnes.md`.
- Inventaire d'ouverture (format & pipeline à cloner) : canevas feuille `INVENTAIRE AU 30-06-25`.
