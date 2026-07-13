---
description: Analyser l'impact probable d'un changement sur les domaines Smart Berry
---

# /impact-analysis — Impact d'un changement

**Changement proposé :** $ARGUMENTS

## Processus

### Étape 1 — Pré-requis

Exécuter `/load-context` sur la description du changement (réutiliser la sortie si déjà disponible dans la session).

Si `/load-context` a retourné une demande de clarification (T3 — aucun domaine détecté) : attendre la réponse de l'utilisateur avant de continuer l'analyse d'impact.

Lire `docs/ai/module-graph.json` (Read tool) si non déjà chargé.

### Étape 2 — Identifier les fichiers primaires touchés

Depuis la sortie de `/load-context`, extraire :
- Les fichiers frontend (tabs, composants, libs) du domaine principal
- Les Cloud Functions et modules backend concernés
- Les collections Firestore impliquées

Compléter par grep ciblé si le changement mentionne un fichier ou une fonction spécifique :
```
grep -n "<terme_du_changement>" public/lib/*.js public/components/*.jsx
```

### Étape 3 — Cartographier l'impact cross-domaine

Pour chaque fichier primaire, vérifier dans `domains.<domaine>.gitCoupling` les fichiers co-commités fréquemment (signal probabiliste — ne garantit pas une dépendance réelle).

Vérifier les notes cross-domaine connues (depuis `/load-context`) :
- **paie** → toujours vérifier `functions/lib/auth/` (paieAccess, registryAccess)
- **referentiel** → vérifier `functions/pointageService.js` si `/api/pointage-rh` est appelée
- **stock** → vérifier `stockMovementGuard` si mutation de mouvement
- **caisse** → vérifier `caisseUtils.js` (source de vérité des calculs)

Pour les changements backend (CF ou module lib) : identifier toutes les routes `/api/<x>` qui exposent cette CF, puis chercher les composants frontend qui appellent cette route :
```
grep -rn "/api/<route>" public/components/ public/lib/
```

### Étape 4 — Évaluer les risques

Classer chaque fichier/domaine impacté en :

| Niveau | Critère |
|--------|---------|
| 🔴 **Critique** | Fichier dans le heatmap top-10 (≥ 3 commits/90j) OU CF exposée à plusieurs domaines OU collection Firestore partagée |
| 🟠 **Élevé** | Fichier couplé par gitCoupling (≥ 3 co-commits) OU lib partagée entre plusieurs tabs |
| 🟡 **Moyen** | Fichier dans le même domaine, non couplé, avec tests existants |
| 🟢 **Faible** | Fichier isolé, domaine unique, pas dans le heatmap, avec tests |

### Étape 5 — Identifier les limites du graphe

Signaler explicitement si :
- Des collections Firestore utilisées par les CFs concernées ne sont pas dans le graphe (protégées implicitement par CF, non déclarées dans `firestore.rules`)
- Des tabs dans `unclassified` pourraient utiliser les routes ou données concernées
- Le changement touche un fichier racine `functions/*.js` non listé dans le domaine (vérifier `domains.<domaine>.backend.services`)

### Étape 6 — Sortie structurée

---
## Impact probable — `<description courte du changement>`

> ⚠️ Périmètre **probable** basé sur le graphe DIL (couverture ~58%). Des dépendances non capturées peuvent exister dans les 137 fichiers non classifiés.

### Fichiers primaires
| Fichier | Domaine | Risque | Raison |
|---------|---------|--------|--------|
| `<fichier>` | `<domaine>` | 🔴/🟠/🟡/🟢 | `<raison>` |

### Domaines secondaires potentiellement impactés
| Domaine | Fichiers concernés | Signal |
|---------|--------------------|--------|
| `<domaine>` | `<fichiers>` | gitCoupling / note cross-domaine / grep route |

### Collections Firestore exposées
- `<collections>` — accès via `<CF>`
- ⚠️ Collections potentiellement non listées : vérifier `db.collection()` dans `<CF>.js`

### Couplage git (probabiliste, 90 jours)
- Si `<fichier A>` change, vérifier aussi `<fichier B>` (co-commités N fois)

### Limites détectées
- `<ce que le graphe ne couvre pas pour ce changement>`

### Recommandation
- Tests à lancer en priorité : voir `/qa-targeted <description du changement>`
- Fichiers à lire avant de coder : `<liste priorisée>`
- Risques à valider manuellement : `<liste>`
---
