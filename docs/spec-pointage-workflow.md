# Spec — Validation du pointage : nouveau workflow + chef de ferme

> **Statut : PROPOSITION (gated).** À valider par Omar **avant** tout code.
> Item backlog : « Brancher la Validation du pointage sur le nouveau workflow + prévoir un endroit au chef de ferme pour valider, scopé à sa ferme. »

---

## 1. Problème

Le menu **« Validation du pointage »** rend aujourd'hui l'**ancien** composant `PointageTab` (`isValidation:true`), qui porte une chaîne de visas par ferme (RH → Caporal → Chef) via `/api/validation?action=validate`. À l'intérieur, il affiche **conditionnellement** le **nouveau** panneau `PointageValidationPanel` (validation par équipe via `/api/pointage-validation`). Résultat : deux workflows coexistent, l'entrée de menu passe par l'ancien, et le **chef de ferme n'a pas d'endroit clair, scopé à sa ferme**, pour valider.

## 2. État technique actuel (constaté)

### Ancien workflow (à débrancher de l'UI principale)
- Composant : `PointageTab` (`public/app.jsx`), prop `isValidation`.
- Backend : `exports.validation` → `/api/validation?action=validate|status|unlock|reject`.
- Modèle : visa par **ferme** (`visaRH`, `visaCaporal`, `visaChef`), pièce jointe caporal obligatoire, snapshot SQL au visa RH.

### Nouveau workflow (cible)
- Composant : `public/components/PointageValidationPanel.jsx` (déjà extrait, IIFE `window.PointageValidationPanel`).
- Backend : `exports.pointageValidation` → `/api/pointage-validation?action=get-validations|validate-equipe|validate-divers|submit-ferme|chef-validate-ferme|unlock-ferme`.
- **State machine par (ferme, jour)** : `brouillon → soumis → valide (figé/locked)`.
- **Rôles** (gating serveur via `resolveCallerRole`, `users/{uid}.profileId`) :
  - **RH / DG** : `validate-equipe` (valide|rejete chaque équipe), `validate-divers`, puis `submit-ferme` (brouillon→soumis). Édition possible tant que `brouillon`.
  - **Chef de SA ferme** : `chef-validate-ferme` (soumis→valide) — gated `chefFerme === ferme`. Mapping `CHEF_FERME = { chef_f1:'F1', chef_f5:'F5', chef_avo:'Avocatier', chef_bahia:'BAHIA' }`.
  - **DG** : `unlock-ferme` (déverrouille un pointage figé).
- Le panneau **sait déjà filtrer par ferme** côté données (`farmFilter` dans le wrapper `app.jsx` ~6438 : `if (farmFilter && ferme !== farmFilter) return;`).
- Nav : `validation_pointage` présent pour RH, DG, **chef_avo**, **chef_bahia**. **À VÉRIFIER/COMPLÉTER pour chef_f1 et chef_f5.**

> **Bon point** : le backend + le panneau supportent DÉJÀ la validation chef par ferme. Le gros du travail est du **câblage UI + scoping**, pas un nouveau moteur.

## 3. Cible fonctionnelle (demande Omar)

1. Le menu **« Validation du pointage »** rend **directement le nouveau workflow** (per-équipe), plus l'ancien `PointageTab` visa-chain.
2. Le **chef de ferme** a un **onglet de validation scopé à SA ferme uniquement** (ses équipes / ses ouvriers), comme l'écran RH mais filtré.
3. Le chef valide (ou rejette) le pointage de sa ferme une fois que le RH l'a soumis.

## 4. Spec détaillée proposée

### 4.1 Câblage du menu
- `renderTab('validation_pointage', …)` : remplacer le rendu `PointageTab(isValidation:true)` par un **composant dédié** `PointageValidationView` qui :
  - construit `equipesParFerme` (logique déjà présente dans le wrapper actuel),
  - rend `PointageValidationPanel` directement,
  - passe `farmFilter` = ferme du profil (voir 4.2).
- L'ancien `PointageTab(isValidation)` et la chaîne `/api/validation?action=validate|reject|unlock` ne sont **plus** atteignables depuis ce menu. (On NE supprime PAS le code backend ancien dans ce lot — on le débranche de l'UI ; suppression = lot ultérieur after vérif qu'aucun autre écran ne l'appelle.)

### 4.2 Scoping par ferme selon le profil
| Profil | Voit | Peut faire |
|---|---|---|
| **RH / DG** | Toutes les fermes (F1, F5, Avocatier, BAHIA) | valide/rejette équipes + divers, soumet la ferme ; DG unlock |
| **chef_f1** | **F1 uniquement** | valide/rejette la ferme soumise (chef-validate-ferme) |
| **chef_f5** | **F5 uniquement** | idem F5 |
| **chef_avo** | **Avocatier uniquement** | idem Avocatier |
| **chef_bahia** | **BAHIA uniquement** | idem BAHIA |

- Implémentation : `farmFilter = CHEF_FERME[currentProfile] || ''` (vide = toutes, pour RH/DG). Le panneau n'affiche alors que la ferme du chef.
- Nav : s'assurer que `validation_pointage` est dans **chef_f1** et **chef_f5** (déjà OK pour avo/bahia).

### 4.3 Vue chef de ferme (lecture + action finale)
- Le chef voit, pour SA ferme et le jour sélectionné : la liste des équipes avec le **statut posé par le RH** (✅ validé / 🚫 rejeté par équipe), le Pointage Divers, et l'état ferme (`soumis` attendu).
- Le chef peut cliquer une équipe pour **voir les ouvriers** (popup, réutilise le système existant).
- Action chef : **bouton « Valider la ferme »** (chef-validate-ferme) visible uniquement si `submitState === 'soumis'` et `chefFerme === ferme`. Optionnel : **« Rejeter / Renvoyer au RH »** (à trancher, cf. §5).
- Après validation chef → `valide`, **figé** (lecture seule), badge « Validé — figé ».

### 4.4 Backend
- **Aucun nouveau endpoint nécessaire a priori** : `validate-equipe`, `validate-divers`, `submit-ferme`, `chef-validate-ferme`, `unlock-ferme` existent et sont déjà gated correctement (rh/dg + chef de sa ferme).
- Vérifier seulement que `chef-validate-ferme` accepte bien les 4 profils chef (incl. `chef_f1`/`chef_f5`/`chef_bahia`) — la fonction `fermeForChefProfile`/`canChefValidate` (`pointageValidationSM`) doit mapper les 4.
- Si on ajoute un « rejet chef » (§5), prévoir une action `chef-reject-ferme` (soumis→brouillon, rouvre la saisie RH) — **gated, à décider**.

## 5. Décisions (TRANCHÉES par Omar 2026-06-12)

1. **Rejet chef → OUI.** Le chef peut *valider* OU *renvoyer au RH avec un motif* (soumis→brouillon, rouvre la saisie RH). → nouvelle action backend **`chef-reject-ferme`** + **deploy functions (gated)**.
2. **Caporal → ABANDONNÉ.** Plus d'étape caporal. Workflow = RH/DG valident équipes + divers → soumettent → Chef de la ferme valide (ou rejette).
3. **Granularité chef → FERME EN BLOC.** Le RH valide/rejette par équipe ; le chef donne UN visa final sur toute la ferme (pas de rejet par équipe côté chef).
4. **Pièce jointe (scan papier) → ABANDONNÉE.** Validation 100 % in-app, aucun scan obligatoire.
5. **Ancien `/api/validation` visa-chain** : débranché de l'UI dans ce lot ; **suppression du code = lot ultérieur** (après audit qu'aucun autre écran ne l'appelle).

## 6. Plan d'implémentation (après validation du spec)
1. **(non-gated)** Nav : ajouter `validation_pointage` à chef_f1/chef_f5 si absent ; câbler le menu sur `PointageValidationView` (nouveau wrapper) ; `farmFilter` selon profil.
2. **(non-gated)** Vue chef scopée : filtrage ferme + boutons d'action conditionnels (déjà 90 % dans le panneau).
3. **(gated si §5.1 rejet chef)** Backend `chef-reject-ferme` + deploy functions.
4. Tests : `node:test` sur la state machine `pointageValidationSM` (transitions + gating par profil chef).
5. QA Playwright : login chef_f1 → ne voit que F1 → valide une ferme soumise ; login RH → voit tout → soumet ; vérifs non-régression Paie/Dashboard.
6. Deploy : **depuis main** (RÈGLE 1), via `scripts/deploy.sh` (hosting ; + functions si §5.1).

## 7. Hors scope de ce lot
- Suppression du code backend `exports.validation` (ancien visa-chain) — lot ultérieur.
- Refonte du Pointage Divers (BUG C matricule tractoriste) — item séparé.
- Notifications WhatsApp sur transitions de validation — à cadrer séparément.

---

**Décision attendue d'Omar** : valider §3/§4, et trancher les 5 points du §5. Ensuite je crée le backlog d'implémentation et je code (developer → QA → deploy depuis main).
