# Spec — Segmentation Chef de Ferme par Culture

**Statut : GATED — en attente GO Omar**
**Auteur : Claude Sonnet 4.6 — 2026-07-14**

---

## Contexte

Le périmètre de compétence des chefs de ferme change :
- Chef de ferme F1 → **Chef Framboise** (Hamid AGOURAM)
- Chef de ferme F5 → **Chef Myrtille** (Bouchra HABCHANE)

L'accès passe d'une segmentation par **ferme** à une segmentation par **culture**. F5 contient deux cultures (Framboise S9/S10 et Myrtille S8) — le chef Myrtille ne doit voir que les données Myrtille de F5.

---

## État actuel — Comment fonctionne le filtrage ferme

### Chaîne complète

1. **Firebase Auth** → `users/{uid}.profileId` = `"chef_f1"` ou `"chef_f5"`
2. **`PROFILES` array** (`app.jsx:383`) → `profile.farm = 'F1'` ou `'F5'`
3. **`farmFilter`** (`app.jsx:67757`) = `profile.farm` → passé en prop à tous les onglets
4. **Onglets** filtrent les lignes : `r.ferme === farmFilter`
5. **Gating serveur** : `functions/lib/valorisation/accessControl.js:35` — `CHEF_PROFILE_FERME = { chef_f1: 'F1', chef_f5: 'F5' }` → `pointageService.js` applique `filterMirrorRowsByFerme(rows, 'F5')`

### Parcelles par culture dans F5

**Framboise F5** (secteurs S9, S10, S13) :
- C1-S10-MOTTE, C2-S10-CB — Yazmin, S10
- C1-S9-REY, C2-S9-REY — Reyna, S9
- C1-S13-MOW, C2-S13-MOW — Yazmin, S13

**Myrtille F5** (secteurs S8) :
- C1-S8-COR, C2-S8-COR — Corina, S8
- C2-S8-BRZ, C2-NP-BRZ — Breeze, S8/S8-2
- C2-S8-CAS, C2-NP-CAS — Cascade, S8/S8-1

**F1** : Framboise uniquement (pas de changement de comportement pour chef_f1).

### Champ `Culture` dans les données SQL

`BR_Pointage` a un champ `Culture` (ex. `"Myrtille"`, `"Framboise"`). Ce champ est :
- Dans le mirror Firestore `sql_mirror_pointage/{date}.rows` sous la clé `Culture`
- Résolvable via `resolveVariete(parcelle, refParcelle)` dans `pointageService.js:534` si le champ SQL est vide

---

## Plan d'implémentation

### Phase 1 — Frontend (app.jsx)

**A. Ajouter `cultureFilter` dans PROFILES** (`app.jsx:383`) :
```js
{ id: 'chef_f1', label: 'Chef Framboise', farm: 'F1', /* pas de cultureFilter */ },
{ id: 'chef_f5', label: 'Chef Myrtille',  farm: 'F5', cultureFilter: 'Myrtille' },
```

**B. Dériver `cultureFilter` global** (juste après la dérivation de `farmFilter` ~l.67759) :
```js
const cultureFilter = profile?.cultureFilter || null;
```

**C. Passer `cultureFilter` en prop** aux composants onglets qui filtrent les données :
- DashboardTab, PointageTab, RecolteTab, HorsRecolteTab, QuinzaineTab, CoutRecolteTab, CampagneTab, PrimesTab, CampagneAnalytiqueTab

**D. Dans chaque composant, appliquer le filtre après `farmFilter`** :
```js
// Helper à créer dans le composant ou dans un util :
function matchCulture(row, cultureFilter) {
    if (!cultureFilter) return true;
    const c = (row.culture || row.Culture || '').trim();
    if (c) return c.toLowerCase() === cultureFilter.toLowerCase();
    // Fallback via variété
    const v = (row.variete || row.Variete || '').toLowerCase();
    const myrtilleVarietes = ['corina', 'breeze', 'cascade'];
    const framboise = ['yazmin', 'maravilla', 'reyna', 'adelita'];
    if (cultureFilter === 'Myrtille') return myrtilleVarietes.some(n => v.includes(n));
    if (cultureFilter === 'Framboise') return framboise.some(n => v.includes(n));
    return true;
}
```

**E. RecolteTab** (`app.jsx:7092`) a déjà un `cultureFilter` local avec boutons Framboise/Myrtille. Pour `chef_f5`, initialiser et verrouiller ce filtre local à `'Myrtille'` :
```js
const [localCultureFilter, setLocalCultureFilter] = useState(propCultureFilter || null);
// Masquer les boutons si propCultureFilter est forcé
```

**F. `FARM_NAMES`** (`app.jsx:447`) — mettre à jour l'affichage :
```js
'F5': 'Myrtille Laaouamra',
```

**G. FarmBanner / labels chef** — Afficher "Chef Myrtille" ou "Chef Framboise" (déjà dans `profile.label`).

### Phase 2 — Backend (gating serveur)

**A. `functions/lib/valorisation/accessControl.js`**

Ajouter après `CHEF_PROFILE_FERME` :
```js
const CHEF_PROFILE_CULTURE = {
    chef_f5: 'Myrtille',   // chef_f5 ne voit QUE Myrtille dans F5
    // chef_f1: null → pas de filtre culture sur F1 (tout est Framboise)
};
```

Mettre à jour `resolvePerimetre()` pour exposer `culture_filtre` :
```js
const cultureFiltre = CHEF_PROFILE_CULTURE[profileId] || null;
return { autorise: true, role: profileId, perimetre_ferme: ferme, ferme_filtre: ferme || '__none__', culture_filtre: cultureFiltre };
```

**B. `functions/src/modules/rh/pointageService.js`**

Ajouter la fonction `filterMirrorRowsByCulture()` (~l.97) :
```js
function filterMirrorRowsByCulture(rows, cultureFilter) {
    if (!cultureFilter) return rows || [];
    const MYRTILLE_VARIETES = ['corina', 'breeze', 'cascade'];
    const FRAMBOISE_VARIETES = ['yazmin', 'maravilla', 'reyna', 'adelita'];
    return (rows || []).filter(function(r) {
        const rawCulture = (r.Culture || r.culture || '').trim();
        if (rawCulture) return rawCulture.toLowerCase() === cultureFilter.toLowerCase();
        // Fallback : résoudre via resolveVariete()
        const resolved = resolveVariete(r.Parcelle_Culturale || r.parcelle || '', r.Ref_parcelle || r.refParcelle || '');
        return resolved.culture === cultureFilter;
    });
}
```

Appliquer ce filtre dans chaque handler après `filterMirrorRowsByFerme` :
- Handler `quinzaine`, `quinzaine-analytique`, `journalier`, `par-jour`, `detail`, etc.
- Récupérer `cultureFilter` depuis `resolvePerimetre(profileId).culture_filtre`

**C. `functions/lib/pointageValidation/stateMachine.js` (l.24)**

**Option retenue (v1) : pas de changement**. La validation reste au niveau ferme. Le chef Myrtille valide les pointages F5 entiers (équipes Framboise et Myrtille), mais ses vues de données sont filtrées par culture. Acceptable car les équipes sont généralement affectées à une culture unique par jour.

Si Omar demande une validation par culture (v2), créer des documents `${date}_F5_Myrtille` — chantier séparé.

---

## Risques & edge cases

| Risque | Probabilité | Mitigation |
|--------|-------------|------------|
| Champ `Culture` NULL dans BR_Pointage | Moyen | Fallback via `resolveVariete()` + variété |
| Ouvrier travaille sur les 2 cultures le même jour | Faible | Filtre sur **lignes** individuelles, pas sur ouvrier |
| Agrégats parFerme dans les snapshots incluent Framboise F5 | Certain | Ajouter des agrégats parCulture dans les snapshots Firestore |
| RecolteTab a déjà un cultureFilter local | Certain | Synchroniser le filtre local avec le prop external |

---

## Critères de validation

1. Chef Myrtille (`chef_f5`) : le dashboard n'affiche que les données des parcelles S8 (Corina, Breeze, Cascade). Yazmin S10 et Reyna S9 n'apparaissent pas.
2. Chef Framboise (`chef_f1`) : aucun changement visible.
3. Gating serveur : `pointage-rh` avec token `chef_f5` ne retourne que les lignes `ferme=F5 AND culture=Myrtille`.
4. RH/DG/admin : voient toutes les données (`cultureFilter null`).
5. Labels UI : "Chef F5" → "Chef Myrtille", "Chef F1" → "Chef Framboise".
6. Validation pointage : `chef_f5` peut valider le document `${date}_F5` (toute la ferme).

---

## Fichiers à modifier

| Fichier | Section | Nature |
|---------|---------|--------|
| `public/app.jsx` | `PROFILES` (l.383), `farmFilter` derivation (~l.67757), tous les onglets | Frontend filtre + labels |
| `functions/lib/valorisation/accessControl.js` | `CHEF_PROFILE_FERME` (l.35), `resolvePerimetre()` | Gating serveur |
| `functions/src/modules/rh/pointageService.js` | `filterMirrorRowsByFerme` (l.97), handlers pointage | Filtre culture backend |
| `functions/lib/pointageValidation/stateMachine.js` | `CHEF_FERME_BY_PROFILE` (l.24) | Pas de changement (v1) |

---

*Ce spec est autosuffisant. Sur GO Omar → lire ce fichier + implémenter sans re-analyse.*
