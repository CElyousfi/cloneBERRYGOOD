---
description: Identifier les tests à lancer en priorité pour un changement Smart Berry
---

# /qa-targeted — Tests ciblés pour un changement

**Changement :** $ARGUMENTS

## Processus

### Étape 1 — Pré-requis

Réutiliser la sortie de `/load-context` et `/impact-analysis` si disponible dans la session.

Sinon, lire `docs/ai/module-graph.json` (Read tool) et identifier le domaine depuis la description.

### Étape 2 — Cartographier les tests existants

Depuis `domains.<domaine>.tests` :
- `tests.unit` → tests unitaires frontend (`tests/unit/`)
- `tests.backend` → tests backend (`functions/lib/.../__tests__/`)

Pour chaque lib ou module mentionné dans `/load-context`, vérifier si un test existe :
```
ls tests/unit/<module>.test.js 2>/dev/null
ls functions/lib/<module>/__tests__/ 2>/dev/null
```

### Étape 3 — Prioriser selon le risque

Appliquer la logique suivante :

**Niveau 1 — Obligatoire (toujours lancer) :**
- `npm run qa` — gate complète (tests + build + fingerprint DIL)
- Tests unitaires du module directement modifié

**Niveau 2 — Recommandé (si temps disponible) :**
- Tests unitaires des modules du même domaine
- Tests des modules couplés par gitCoupling

**Niveau 3 — Manuel (pas de test automatique) :**
- Vérification visuelle des tabs frontend impactés
- Vérification des collections Firestore via console Firebase si une structure a changé

### Étape 4 — Détecter les zones sans test

Pour chaque fichier primaire impacté, signaler si aucun test unitaire ne le couvre :
```
grep -rn "<nom_du_composant_ou_lib>" tests/unit/ 2>/dev/null | head -3
```

Si aucun résultat → signaler la zone non testée comme **risque résiduel**.

### Étape 5 — Sortie structurée

---
## Tests ciblés — `<description courte>`

### Commande principale
```bash
npm run qa
```
> Lance tests unitaires frontend + backend + build + fingerprint DIL.
> Doit être 100 % vert avant tout commit/merge.

### Tests unitaires à lancer en priorité
```bash
# Tests du domaine <domaine> — modules directement concernés
node --test tests/unit/<module1>.test.js tests/unit/<module2>.test.js

# OU si plusieurs modules du même domaine :
node --test tests/unit/<pattern>*.test.js
```

### Tests backend (si CF ou module lib/ modifié)
```bash
cd functions && node --test lib/<module>/__tests__/*.test.js
```

### Zones sans couverture automatique

| Fichier / Zone | Couverture | Risque |
|----------------|------------|--------|
| `<fichier>` | ❌ Aucun test unitaire | 🔴 Vérifier manuellement |
| `<tab>` | ❌ Test UI impossible (pas de RTL sans bundler) | 🟡 Smoke visuel recommandé |
| `<CF>` | ❌ Pas de test d'intégration | 🟡 Tester via preview channel |

### Checklist vérification manuelle
Pour les zones sans test automatique, vérifier visuellement :
- [ ] Ouvrir le tab `<TabName>` — pas de crash React, pas de NaN
- [ ] Effectuer l'action principale (ex. charger les données, soumettre un formulaire)
- [ ] Vérifier les données en console Firebase si une collection Firestore est touchée
- [ ] Sur mobile (Safari iOS) si le changement touche un composant fréquemment utilisé

### Remarque
Le graphe DIL couvre ~58% des fichiers. Des régressions peuvent apparaître dans des
tabs non classifiés (137 fichiers dans `unclassified`). Si un smoke général est possible
(Playwright ou navigation manuelle), l'étendre aux tabs adjacents du domaine concerné.
---
