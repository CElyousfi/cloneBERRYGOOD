# Spec — Écran « Paramètres Parcelles » (assignation campagne + surface BEE ONE)

> **Statut : GATED — en attente GO Omar.** Qualifié par l'archi 2026-07-09. Décision DG :
> un écran de paramètres parcelles où on **assigne la campagne** ; la **superficie arrive de BEE ONE**
> (authoritative — ni saisie DG, ni dérivation tunnels). Self-suffisant : contexte, données, écran,
> sécurité, dépendances, décisions.

---

## 1. Contexte & décision

Investigation surfaces (2026-07-09) : la surface **en Ha par parcelle n'existe PAS dans SB natif**
- `stock_movements` (conso native SB) : pas de surface.
- `parcelles_consommation` / `parcelles-config` / `parcelle_irrigation_meta` : pas de surface Ha
  (`parcelles-config` a `nbTunnels`, pas des Ha).
- Seule surface en Ha = `SURFACES_HA` (const [index.js:828](../functions/index.js#L828)), keyée par
  **label 2025/2026**, non campagne-aware → ne couvre pas les nouvelles parcelles 0040-0043/0038.
- Legacy `BR_Consommation.Parcelle_sup` : gelé avril 2026, abandonné.

**Décision DG :** la surface authoritative vient de **BEE ONE** (`ParcelleCulturale.Superficie`,
campagne-aware via `id_campagne`). SB expose un **écran de paramètres parcelles** pour :
1. **Assigner / confirmer la campagne** de chaque parcelle (action SB).
2. **Afficher** ferme, culture, variété, **surface (Ha) sourcée BEE ONE** (lecture seule).

Ceci **remplace** l'option « référentiel DG-saisie des surfaces » (abandonnée) : la seule saisie SB
est l'**assignation de campagne** ; la surface est en lecture seule depuis BEE ONE.

---

## 2. Source de données — étendre le référentiel existant

Le référentiel `parcelle_ferme_referentiel` (déployé 2026-07-09, campagne-aware, clé `${campagne}__${ref}`)
est le socle. On l'**enrichit** au sync BEE ONE avec les champs BEE ONE authoritative :
```
parcelle_ferme_referentiel/${campagne}__${ref}
{
  campagne, ref_parcelle, labels[], ferme,           // existant
  variete_dominante, culture,                        // existant (best-effort)
  surface_ha: <number|null>,   // NOUVEAU — de ParcelleCulturale.Superficie (BEE ONE)
  surface_source: "beeone" | "absente",              // NOUVEAU
  campagne_assignee: "2026-2027" | null,             // NOUVEAU — override/confirmation SB (défaut = dérivée)
  campagne_assignee_by: {uid,name}, campagne_assignee_at,  // audit de l'assignation
  statut: "active" | "inactive",                     // dérivé (a du pointage sur la campagne ?)
  source, confidence, first_seen, updated_at         // existant
}
```
- **Surface** : peuplée par le pull BEE ONE (voir §3). Jamais éditée côté SB (authoritative BEE ONE).
- **campagne_assignee** : le SEUL champ éditable via l'écran. Par défaut = campagne dérivée
  (`campagneOf`/`id_campagne` BEE ONE) ; l'assignation SB permet de **confirmer** ou **corriger** (ex.
  parcelle mal datée en BEE ONE). `source:'manual'` protège l'assignation d'un écrasement au sync.

---

## 3. Pipeline surface BEE ONE (dépend du retour serveur)

1. **PRÉ-REQUIS — confirmer le schéma** : `ParcelleCulturale.Superficie` existe-t-il ? (unité Ha ?
   peuplé ?). → sondage **`bdpIntrospect` section 12** (déjà PRÉPARÉ sur la branche
   `feat/bdp-sondage-surfaces`, read-only : colonnes ParcelleCulturale + Parcelle, peuplement
   Superficie, surfaces par (Ref, id_campagne)). À déployer + lancer au retour serveur (GO deploy).
2. **Si Superficie présent** → étendre `referentielSync` (le job qui peuple `parcelle_ferme_referentiel`
   dans `runFullSync`) pour lire `pc.Superficie` par (Ref, id_campagne) et l'écrire dans `surface_ha`.
   Campagne-aware, self-healing (comme le reste du référentiel).
3. **Si Superficie absent/vide en BEE ONE** → `surface_ha:null`, `surface_source:"absente"`, badge
   « surface manquante » à l'écran + alerte DG (réutiliser le canal template general_alert du référentiel).
   Fallback éventuel `SURFACES_HA` par label pour les parcelles historiques (avocat), à décider (§7).

---

## 4. Écran « Paramètres Parcelles »

- **Emplacement** : nouvel onglet dans la zone RH/Agro ou Magasin (à câbler ; composant séparé
  `public/components/ParcellesParamsTab.jsx` — règle modularisation, PAS dans app.jsx).
- **Sélecteur de campagne** en tête (réutiliser `QuinzaineCampagneSelect` ou une variante campagne-only).
- **Table**, une ligne par parcelle de la campagne :

| Ref | Label | Ferme | Culture | Variété | **Surface (Ha)** | **Campagne** | Statut | Actif |
|-----|-------|-------|---------|---------|------------------|--------------|--------|-------|
| 0041 | F5 YAZMIN MT | F5 | framboise | Yazmin | 1.9 *(BEE ONE)* | [2026-2027 ▼] | active | ✅ |
| 0044 | … | ? | … | … | ⚠️ manquante | [à assigner ▼] | … | … |

- **Surface** : lecture seule, badge source « BEE ONE » ou « ⚠️ manquante ».
- **Campagne** : dropdown éditable (assignation/correction) — seule action d'écriture. Sauvegarde via
  une CF gatée (rôle DG/admin) → écrit `campagne_assignee` (+ audit) dans `parcelle_ferme_referentiel`,
  `source:'manual'`.
- **Parcelle inconnue / sans surface** : mise en évidence (c'est aussi l'outil de détection de dérive
  référentiel — cf. alerte parcelle inconnue déjà en place).

---

## 5. ⚠️ Cloisonnement (hérité, non négociable)

- **Lecture** : un chef ne voit que **ses** parcelles (sa ferme, via `deriveFerme`/`_fermeFilter` Étape 0) ;
  DG/RH voient toutes. Même mécanisme que les écrans pointage/paie.
- **Écriture (assignation campagne)** : réservée **DG/admin** (ou RH selon décision §7). Un chef ne
  réassigne pas de campagne. CF gatée `resolvePerimetre` + rôle.
- Collection `parcelle_ferme_referentiel` déjà `read:false` client (write CF-only) — inchangé.

---

## 6. Dépendances / séquencement
1. **Retour serveur BEE ONE** (`105.145.33.128`, down depuis 2026-07-09 01:05) — bloque le pull surface.
2. **Confirmer `ParcelleCulturale.Superficie`** (bdpIntrospect §12, prêt) — make-or-break du pull surface.
3. **Étendre `referentielSync`** (surface_ha) — dev, après confirmation schéma.
4. **Écran + CF d'assignation campagne** — dev, indépendant du serveur (peut se construire en parallèle,
   la surface s'affiche « manquante » tant que le pull n'a pas tourné → dégradé gracieux).

L'écran et l'assignation campagne sont **développables maintenant** (ne dépendent pas du serveur) ;
seule la colonne **surface** attend le pull BEE ONE.

---

## 7. Décisions — TRANCHÉES par Omar (2026-07-09)
1. **Rôle d'écriture** assignation campagne : ✅ **DG + admin** (pas chef, pas RH).
2. **Surface absente de BEE ONE** : ✅ afficher « **manquante** », **PAS** de fallback `SURFACES_HA`.
3. **campagne_assignee vs dérivée** : ✅ la dérivée BEE ONE fait foi par défaut ; assignation SB =
   override explicite audité ; parcelle non assignée non bloquée.
4. **Emplacement onglet** : ✅ **Magasin / Mapping** (à côté de `MagMappingConsoTab`, où vit déjà le
   référentiel `parcelles_consommation`). Déplaçable si besoin.

### 7bis. FENÊTRE COSTING campagne 26/27 (précision DG)
La campagne 26/27 n'a PAS un cut-off strict au 1er juillet côté **costing** : des parcelles **plantées
avril-mai 2026** appartiennent à 26/27 et ont du costing à récupérer. → Le **pull surface/costing BEE ONE
remonte jusqu'à ~avril 2026** (pas 2026-07-01) pour ces parcelles. La campagne d'une parcelle vient de
BEE ONE (`id_campagne`), PAS d'un filtre de date rigide. La requête bdpIntrospect §12 et le pull surface
doivent filtrer par **`id_campagne=3`**, pas par `DATE >= '2026-07-01'`, pour capter les plantations
pré-juillet.

---

## 8. Hors périmètre
- Le calcul JH/coût par Ha (écran budget) **consomme** ce référentiel (surface_ha) mais est un lot séparé.
- Le mapping opérations → canevas GB01-GB11 (Étape 1 budget) est un lot séparé (attend le fichier CapIn).
- Dérivation Ha via `parcelles-config.nbTunnels` : écartée (décision DG = surface de BEE ONE).

## 9. Fichiers concernés (implémentation)
- `functions/lib/pointage/referentielSync.js` : + lecture `pc.Superficie` → `surface_ha`.
- `functions/bdpIntrospectService.js` : section 12 (déjà prête, branche `feat/bdp-sondage-surfaces`).
- Nouvelle CF (dans un service parcelles ou `index.js`) : `assign-campagne-parcelle` (gatée DG/admin).
- `public/components/ParcellesParamsTab.jsx` (nouveau) + câblage onglet + build.
- `firestore.rules` : `parcelle_ferme_referentiel` reste `read:false` (write CF-only) — inchangé.

## 10. Résumé exécutif
Écran SB « Paramètres Parcelles » = UI sur le référentiel `parcelle_ferme_referentiel` (campagne-aware).
**Surface = BEE ONE** (`ParcelleCulturale.Superficie`, lecture seule, pull au sync). **Seule saisie SB =
assignation/correction de campagne** (gatée DG). Cloisonnement chef hérité. Dépend du retour serveur pour
la surface (le reste se construit maintenant, surface « manquante » en dégradé gracieux).
