---
description: Vérifier l'état du graphe DIL (fraîcheur, couverture, santé)
---

# /dil-status — État du Developer Intelligence Layer

## Processus

### 1. Lire le graphe

Lire `docs/ai/module-graph.json` (Read tool).

Si absent → afficher immédiatement :
```
🔴 BROKEN — docs/ai/module-graph.json introuvable.
Action : node scripts/generate-module-graph.js
```
et arrêter.

Extraire :
- `_meta.sourceFingerprint`
- `_meta.generatorVersion`
- `_meta.healthScore` (total + subScores)
- `_meta.stats`
- `_meta.heatmap` (top 5)

### 2. Vérifier la fraîcheur (fingerprint)

Exécuter : `node scripts/generate-module-graph.js --fingerprint-only`

Comparer la sortie avec `_meta.sourceFingerprint`.

- **Match** → graphe frais.
- **Mismatch** → graphe STALE (les sources ont changé depuis la dernière génération).
- **Commande en erreur** → mentionner que la vérification de fraîcheur a échoué ; noter le risque.

### 3. Calculer le statut

Appliquer les règles suivantes dans l'ordre (première règle qui match gagne) :

| Condition | Statut |
|-----------|--------|
| `module-graph.json` absent | 🔴 **BROKEN** |
| Fingerprint mismatch | 🟡 **STALE** |
| `healthScore.total` < 40 OU domaines manquants (< 8 sur 10) | 🟠 **DEGRADED** |
| `healthScore.total` ≥ 40 ET fingerprint OK | 🟢 **HEALTHY** |

> Note : un score HEALTHY n'est pas un score parfait. Le graphe actuel couvre
> ~58% des fichiers ; un score HEALTHY signifie que la couverture est suffisante
> pour être utile, pas qu'elle est exhaustive.

### 4. Afficher le rapport

Format attendu :

---
## DIL Status : <HEALTHY|STALE|DEGRADED|BROKEN>

**Graphe** : `docs/ai/module-graph.json` — version scanner `<generatorVersion>`
**Fingerprint** : `<sha256:...>` — <✅ frais | ⚠️ STALE — régénérer>
**HealthScore** : `<total>/100`

### Sous-scores
| Dimension | Score | Détail |
|-----------|-------|--------|
| Classification | `<score>`/40 | `<detail>` |
| Couverture tests | `<score>`/30 | `<detail>` |
| Complétude domaines | `<score>`/30 | `<detail>` |

### Statistiques
| Métrique | Valeur |
|----------|--------|
| Tabs React (app.jsx) | `<tabFunctions>` |
| Composants extraits | `<extractedComponents>` |
| Libs helpers | `<libHelpers>` |
| Cloud Functions | `<cloudFunctions>` |
| Modules backend (lib/) | - |
| Services racine (functions/*.js) | - (voir note) |
| Collections Firestore | `<firestoreCollections>` |
| Fichiers non classifiés | `<unclassifiedFiles>` |

### Heatmap (fichiers les plus modifiés, 90 jours)
`<top 5 du heatmap avec nb commits>`

### Limites structurelles connues
- Collections protégées implicitement par CF (non dans `firestore.rules`) : non détectables statiquement.
- Tabs non nommés dans app.jsx (137 non classifiés) : graphe couvre ~58% des fichiers.
- Services racine `functions/*.js` : scannés depuis v1.0.1, classifiés par nom de fichier.

### Action recommandée
- **HEALTHY** : aucune action. Le graphe est utilisable pour `/load-context` et `/impact-analysis`.
- **STALE** : régénérer avant de travailler : `node scripts/generate-module-graph.js && git add docs/ai/module-graph.json`
- **DEGRADED** : utilisable avec précaution — vérifier les domaines à faible couverture avant de s'y fier.
- **BROKEN** : `node scripts/generate-module-graph.js` (première génération ou graphe supprimé).
---
