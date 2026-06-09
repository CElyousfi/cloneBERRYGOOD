# Spec — Module Dépenses & Règlements, Sprint 1 (GATED, avant tout code)

> Sprint 1 = Fondations : fournisseurs (enrichis) + Factures + analytique 4 niveaux.
> Dépend du **référentiel analytique v1** (cf. docs/referentiel-analytique-v1.md).
> **Aucun code / aucune collection avant validation Omar de ce doc + du référentiel.**

## 0. ⚠️ Conflit détecté à trancher EN PRIORITÉ
Il existe DÉJÀ dans Smart Berry :
- une collection **`invoices`** + actions `create-facture`/`validate-facture` (functions/index.js:5961-6092), **liée aux BDC** (workflow Achats, `bdc_id`, validation multi-étapes, `payment_status`),
- des items de menu **« Factures »** et **« Paiements »** déjà présents dans `NAV_ITEMS_ACHATS` (545-546) et `NAV_ITEMS_FINANCE` (507-508).

Le nouveau module Dépenses propose une collection **`factures`** plus large (toute facture fournisseur, affectation analytique 4 niveaux, pas forcément liée à un BDC).

**Décision Omar requise :**
- (A) Le nouveau module **remplace/absorbe** `invoices` (migration des factures BDC dedans), OU
- (B) **coexiste** : `invoices` = factures issues de BDC (chaîne achats), `factures` = dépenses générales hors-BDC. Risque de doublon/confusion menu.
- Reco : **(A) une seule collection `factures`**, avec un champ optionnel `bdc_id` pour les factures issues d'un BDC → source unique, analytique partout. Migration des `invoices` existantes en Phase ultérieure.

## 1. Schéma Firestore

### `factures/{id}` (nouveau)
```
{
  id, numeroFacture, fournisseurId, fournisseurNom,
  dateFacture, dateReception, designation,
  montantHT, tva (taux %), montantTTC,
  statutValidation: "brouillon" | "validee" | "reglee",
  // Analytique 4 niveaux (OBLIGATOIRE) — réfs du référentiel
  campagne, parcelleCulturale (id réf), ferme, familleAnalytique (code réf),
  // Pièce jointe (Storage)
  pieceJointeUrl, pieceJointeNom, pieceJointeType,
  // Lien optionnel BDC (si issue de la chaîne achats)
  bdc_id (optionnel),
  // Méta
  observations, creePar {uid,profileId,name}, creeAt, modifiePar, modifieAt
}
```

### Index composites (`firestore.indexes.json`)
- `(fournisseurId ASC, dateFacture DESC)`
- `(statutValidation ASC, dateFacture DESC)`
- `(ferme ASC, dateFacture DESC)`
- `(familleAnalytique ASC, dateFacture DESC)`
- `(campagne ASC, dateFacture DESC)`

### Security rules (`firestore.rules`)
```
match /factures/{id} {
  allow read: if request.auth != null;   // factures standard visibles ; confidentielles = Sprint 4
  allow write: if false;                  // écriture via Cloud Function uniquement
}
```

### Storage
`factures/{id}/original.<ext>` dans le bucket `berrygood-farms-photos` (réutilise le pattern `uploadPhoto`/`upload-scan` base64 → bucket).

## 2. Backend — Cloud Function
Nouveau service `exports.depenses` → route `/api/depenses` (firebase.json) — OU réutiliser `stockManagement` (où vivent déjà suppliers/invoices). Reco : **nouveau service `depenses`** (séparation propre, anti-monolithe). Actions :
- `create-facture` (auth, rôle achats/finance) : valide analytique obligatoire + cohérences (cf. §4), upload PJ, add.
- `list-factures` (auth) : filtres fournisseur/statut/période/ferme/famille.
- `update-facture` / `delete-facture` (interdit si `statutValidation==='reglee'`).
- `upload-piece` (base64 → Storage → url).
- Rôle résolu via `resolveCallerRole` (token, pas body).

## 3. Fournisseurs — enrichissement (Sprint 1A)
Collection existante `suppliers` (champs : nom, ice, identifiant_fiscal, adresse, ville, tel, email, contact_nom, categorie, status, active). Écrite **client-direct via CF** `create-supplier`/`update-supplier` (validation auto PR #55 + anti-doublons).
**À ajouter (non-gated, additif)** :
- `type` : Fournisseur | Prestataire | Bénéficiaire | Salarié | Administration | Banque (en plus de `categorie`).
- `statut` : Actif | Inactif (clarifie l'actuel `status`/`active`).
- `code` (optionnel) + alias `raisonSociale`↔`nom`.
- Ajout inline « + Nouveau fournisseur » depuis les formulaires Facture (et futur Règlement).
Gated UNIQUEMENT si suppression/restructuration de données existantes (sinon additif → non-gated).

## 4. Contrôles de cohérence (bloquants/warnings)
- Facture sans affectation analytique (4 niveaux) → **bloqué**.
- Doublon (numeroFacture + fournisseurId) → **warning**.
- montantTTC ≠ montantHT + (HT×tva) → **warning** (calcul auto par défaut).
- Suppression d'une facture `reglee` → **interdit**.

## 5. UI (maquette textuelle)
**Menu** : nouvel item top-level `{ id:'depenses', label:'Dépenses', icon:'fa-receipt' }` dans `NAV_ITEMS_ACHATS` + `NAV_ITEMS_FINANCE` (+ dg). Sous-onglets internes au composant : **Factures** (Sprint 1) | Règlements (Sprint 3, grisé).

**Écran Factures — Liste** : filtres (fournisseur, statut, période, ferme, famille), recherche texte, tri (date/montant/fournisseur), badge statut (brouillon/validée/réglée), clic → détail + PJ affichable.

**Écran Factures — Formulaire** :
- Fournisseur : datalist (recherche) + bouton « + Nouveau ».
- Montants : HT, TVA (taux), TTC (calcul auto HT×(1+tva)), éditable + warning si incohérent.
- **AnalytiqueSelector** (obligatoire) : 4 dropdowns en cascade Campagne → Parcelle culturale → Ferme → Famille analytique (la parcelle pré-remplit culture/variété/système/ferme du référentiel).
- Upload PJ (PDF/JPG/PNG) → preview.
- Observations (texte libre).

## 6. Composants React à créer (`public/components/` — règle modularisation)
- `public/components/DepensesTab.jsx` (conteneur + sous-onglets).
- `public/components/FacturesList.jsx` + `FactureForm.jsx`.
- `public/components/AnalytiqueSelector.jsx` (**réutilisable** : Factures, futur Règlements, CPC) — lit le référentiel.
- `public/lib/referentielUtils.js` (UMD, IIFE — anti-collision globale) : accès référentiel + helpers campagne/famille.
- `public/lib/depensesUtils.js` (UMD, IIFE) : calcul HT/TVA/TTC, validations, dédup — **pur + testé node:test**.
⚠️ React via CDN (pas d'ESM/bundler) : « fichier séparé » = chargé via `<script>` dans index.html, fonctions/composants exposés en global UNIQUE (préfixe), PAS de `import`. Le vrai lazy-loading = après migration Vite (item dédié).

## 7. Intégration avec l'existant (Sprint 1C)
- `<AnalytiqueSelector>` = source unique des dropdowns analytiques (Factures + CPC + futur Règlements). Le CPC (cpcVarietes/cpcCharges aujourd'hui hardcodés) tirera du même référentiel.
- Profils : `achats` (saisie), `finance` (validation/règlement), `dg` (consultation/validation). Factures confidentielles = Sprint 4.
- Tests Playwright : ajouter l'écran Factures (+ création test sous flag E2E_WRITE) à la suite E2E.

## 8. Estimation effort (jours)
| Lot | Effort |
|-----|--------|
| Item zéro (référentiel : décision + seed Firestore après Excel) | 1–1.5 j |
| 1A Fournisseurs enrichis (type/statut + inline) | 0.5 j |
| 1B Factures (CF depenses + collection + rules + index + UI liste/form + AnalytiqueSelector + upload + contrôles) | 3–4 j |
| 1C Intégration CPC + composant partagé | 1 j |
| Tests (helpers purs + Playwright Factures) | 0.5 j |
| **Total Sprint 1** | **~6–7.5 j** |

## Points GATED à valider (Omar) avant de coder
1. **Conflit `invoices` vs `factures`** (§0) : option A (unifier) ou B (coexister) ?
2. **Référentiel analytique v1** validé (cf. doc dédié) + convergence Excel.
3. Schéma `factures` §1 + nouveau service `/api/depenses` (vs réutiliser stockManagement).
4. Menu « Dépenses » top-level + profils (achats/finance/dg).
5. Enrichissement fournisseurs `type`/`statut` (additif, non-gated) : OK ?
