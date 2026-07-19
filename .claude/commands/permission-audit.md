---
description: Auditer la politique de permissions Claude Code (règles inutiles/dangereuses, Bash vs outils natifs, propositions de simplification)
---

Audite la politique de permissions du projet et l'usage réel des outils, puis
produis un rapport. **Aucune modification** — audit lecture seule.

## Étapes

1. Lancer le script versionné (lecture seule, sortie agrégée et masquée) :
   `node scripts/permission-audit.js`
   Il analyse les transcripts du projet Smart Berry uniquement (statistiques
   d'usage des outils, commandes Bash normalisées — aucune donnée brute).
   **Le script n'analyse pas les trois settings.json** : cette partie reste
   manuelle, cf. étape 2.

2. Compléter par une relecture manuelle avec l'outil Read de :
   - `.claude/settings.json` (politique canonique)
   - `.claude/settings.local.json`
   - `~/.claude/settings.json` (global)
   en cherchant ce que le script ne détecte pas : règles trop spécifiques
   devenues inutiles, wildcards trop larges (`X:*` couvrant des variantes
   destructives), incohérences avec `docs/ai/PERMISSIONS.md`.

3. Rapporter, dans cet ordre :
   - **Règles dangereuses** : toute règle allow touchant deploy / push /
     credentials / merge / checkout / prod → à déplacer en ask ou deny.
   - **Règles inutiles** : one-offs (« Always allow » résiduels avec chemins,
     URLs ou tokens spécifiques), doublons inter-scopes, règles malformées.
   - **Bash vs natif** : compteurs de `grep`/`cat`/`find`/`sed -n`/`head`/`tail`
     remplaçables par Grep/Read/Glob, et de commandes composées `cd … && …`
     (règle : CLAUDE.md § Discipline outils).
   - **Propositions de simplification** : liste concrète de règles à supprimer,
     fusionner ou déplacer, avec le scope cible (projet vs global).

4. Contraintes :
   - Ne restituer AUCUNE donnée brute des transcripts (uniquement les
     statistiques et préfixes normalisés produits par le script).
   - Ne modifier aucun fichier : les changements proposés sont appliqués dans
     un chantier séparé, validé par Omar (cf. `docs/ai/PERMISSIONS.md`).
