# Spec — Référentiel Parcelles Smart Berry (noms + surfaces éditables)

**Statut : GATED — attente GO Omar**
**Impacte : tous les tableaux Ha/coût de l'application**

---

## Contexte

Les parcelles BEE ONE arrivent dans Smart Berry avec des labels bruts (ex : "S2.S3.S5.S6.S7 maravilla logn can F1") et des surfaces parfois nulles ou incorrectes. Le user veut :

1. Attribuer un **nom Smart Berry** court et normalisé à chaque parcelle BEE ONE.
2. Saisir/corriger la **surface en Ha** par parcelle.
3. Ces valeurs doivent remplacer les labels BEE ONE et les Ha dans **tous les tableaux** : Affectation Analytique, Quinzaine MO, Campagne, etc.

---

## Source de vérité actuelle

| Donnée | Source actuelle | Problème |
|---|---|---|
| Labels parcelles | `Parcelle_Culturale` (BEE ONE, brut) | Noms longs, incohérents, doublon cycle1/cycle2 |
| Ha parcelles | `PARCELLES_CULTURALES` (static frontend) | Manuel, pas synchronisé BEE ONE |
| Ha avocatier | Constante `_avocatHaByFerme` | Figé dans le code |

---

## Solution proposée

### 1. Firestore collection `sb_parcelle_referentiel`

Clé du doc = `label_BEE_ONE` (Parcelle_Culturale normalisé, uppercase trim).

Champs :
```json
{
  "label_bee_one": "S2.S3.S5.S6.S7 maravilla logn can F1",
  "ref_bee_one": "0043",
  "nom_sb": "Maravilla Long Cane F1",
  "ha": 5.0,
  "culture": "Framboise",
  "variete": "Maravilla",
  "ferme": "F1",
  "campagne": "2026/2027",
  "updated_by": { "uid": "...", "name": "..." },
  "updated_at": "<serverTimestamp>"
}
```

### 2. Backend : nouvelles actions sur `/api/pointage-rh`

**GET `action=sb-referentiel-list`** : retourne tous les docs de `sb_parcelle_referentiel`.
**POST `action=sb-referentiel-save`** (DG/RH only) : upsert un doc par label_bee_one.

### 3. Frontend : chargement au démarrage

Dans `app.jsx`, au chargement (ou au premier accès à un tab qui en a besoin) :
```javascript
fetch('/api/pointage-rh?action=sb-referentiel-list')
  .then(r => r.json())
  .then(d => { window.SB_PARCELLE_REF = {}; d.parcelles.forEach(p => { window.SB_PARCELLE_REF[p.label_bee_one.toUpperCase()] = p; }); });
```

### 4. Helpers d'accès (dans `caisseUtils.js` ou nouveau `parcelleUtils.js`)

```javascript
function sbParcelleNom(labelBeeOne) {
  const ref = window.SB_PARCELLE_REF && window.SB_PARCELLE_REF[(labelBeeOne || '').toUpperCase().trim()];
  return (ref && ref.nom_sb) || labelBeeOne || '—';
}

function sbParcelleHa(labelBeeOne) {
  const ref = window.SB_PARCELLE_REF && window.SB_PARCELLE_REF[(labelBeeOne || '').toUpperCase().trim()];
  return (ref && ref.ha) || 0;
}
```

### 5. Propagation dans les tableaux concernés

| Tableau | Usage actuel | Après migration |
|---|---|---|
| Affectation Analytique (`_getAnalytiqueRowInfo`) | `_pcInfoMap` lookup PARCELLES_CULTURALES | `sbParcelleHa(r.parcelle)` en priorité |
| Quinzaine MO popup (header parcelle) | `prettyParcelle(pStr)` | `sbParcelleNom(pStr)` |
| Campagne analytique | lookup PARCELLES_CULTURALES | `sbParcelleHa` |
| Parcelles & Référentiel tab | labels bruts BEE ONE | `sbParcelleNom` |

### 6. UI d'édition dans `ParcellesReferentielTab`

- Bouton "Éditer" par ligne (RH/DG uniquement)
- Inline edit : champs `nom_sb` + `ha`
- Save → POST `sb-referentiel-save` → refresh local state
- Indicateur visuel : badge "Personnalisé" si nom_sb ou ha défini

---

## Fichiers concernés

**Backend** :
- `functions/pointageService.js` : ajouter actions `sb-referentiel-list` + `sb-referentiel-save`

**Frontend** :
- `public/app.jsx` : loader `SB_PARCELLE_REF` au démarrage + helpers
- `public/components/ParcellesReferentielTab.jsx` : colonnes "Nom SB" + "Ha SB" éditables
- `public/app.jsx` (Affectation Analytique) : remplacer `_pcInfoMap` lookup par `sbParcelleHa`
- `public/app.jsx` (QuinzaineTab) : remplacer `prettyParcelle` par `sbParcelleNom`

**Firestore** :
- Nouvelle collection `sb_parcelle_referentiel` (pas de migration, création ex-nihilo)

---

## Risques / edge cases

- Un label BEE ONE peut changer entre campagnes (même parcelle, label différent) → la clé est le label exact, pas la ref numérique. Si la ref est stable, migrer la clé vers `${ref_bee_one}`.
- Ha = 0 dans le référentiel → interprété comme "non renseigné", pas comme "0 Ha".
- Accès concurrent RH × DG : pas de conflit critique (dernier save gagne, champ `updated_at` tracé).
- Rôle : lecture ouverte à tous les profils authentifiés, écriture DG + RH uniquement.

---

## Validation croisée

Avec les données actuelles (demo) :
- "S2.S3.S5.S6.S7 maravilla logn can F1" → nom_sb = "Maravilla Long Cane F1", ha = 5.0
- "S1.S4 Maravilla green can F1" → nom_sb = "Maravilla Green Cane F1", ha = 4.0
- Affectation Analytique : Maravilla Long Cane F1 → JH/Ha = (ex: 120 JH) / 5.0 = 24.0 JH/Ha ✓

---

*Spec prêt — GO Omar requis pour implémentation.*
