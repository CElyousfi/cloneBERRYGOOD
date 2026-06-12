# Spec — Triage IA automatique des bug reports (Niveau 1)

> **Statut : PROPOSITION (gated).** Les parties **§4 (system prompt)** et **§5 (schéma JSON)** sont à valider par Omar **avant** tout code.

---

## 1. Objectif
Qualifier automatiquement les bug reports in-app (collection `bug_reports`, créés via `exports.bugReports`) avec Claude API (Sonnet 4.6). L'architecte traite les bugs sans passer par Omar ; Omar n'est alerté **que sur les critiques** (WhatsApp).

## 2. Déclencheur — fire-and-forget (ne bloque JAMAIS la soumission)
- **Choix : Cloud Function Firestore trigger `onBugReportCreate` = `onDocumentCreated('bug_reports/{id}')`**, séparée de `exports.bugReports`.
  - La soumission HTTP (`exports.bugReports`) écrit le doc avec `status:"new"` et **répond immédiatement** (inchangé). Le triage tourne en async quelques secondes après, via le trigger.
  - Avantage vs « enrichir exports.bugReports après set » : le triage ne peut pas ralentir/faire échouer la réponse à l'utilisateur, et un retry/timeout Claude n'impacte pas la soumission.
- **Si Claude API échoue / timeout / down** : le doc reste `status:"new"` (aucune perte), l'archi le voit dans la vue admin. On log l'erreur (`triage_error`), pas de retry agressif (1 tentative + 1 retry court).

## 3. Entrées envoyées à Claude
Depuis `bug_reports/{id}` (champs déjà capturés) :
- `description` (texte utilisateur)
- `screen` (écran courant, ex. `cout_recolte`), `reporter.profileId` (profil), `userAgent`
- `screenshot` (si présent) → image en **Vision** (base64 ou URL Storage selon stockage actuel — à confirmer au code)
- Contexte doublons : les N derniers bugs `summary`+`module` récents (≤ 20) passés dans le system prompt.

## 4. SYSTEM PROMPT (gated — à valider)

```
Tu es l'assistant de triage des bugs de Smart Berry, l'app de gestion de ferme BerryGood.
Tu reçois un signalement de bug (description utilisateur, écran, profil, et éventuellement une capture d'écran). Tu produis UNIQUEMENT un objet JSON de triage (aucun texte autour).

Modules de l'app (choisis le plus précis) :
- pointage : saisie/validation du pointage, présence, heures
- paie : calcul paie, SMAG, primes, déclarés, ancienneté
- stock : magasin, bons de réception/sortie, articles, BDC
- cout_recolte : coût récolte, DH/kg, indicateurs
- agronomie : irrigation, phénologie, stations, parcelles
- equipes : équipes, primes de transport, effectifs
- quinzaine : dashboard quinzaine, trésorerie paie
- dashboard : dashboard général, KPIs globaux
- autre : si rien ne correspond

Sévérité :
- critical : l'app crash, données fausses en prod affectant une décision (paie/coût), perte de données, blocage total d'un workflow métier
- high : fonctionnalité importante cassée mais contournable, chiffre visiblement faux non bloquant
- medium : bug gênant mais sans impact métier majeur (UI, libellé, cas limite)
- low : cosmétique, confort, suggestion

Détection de doublon : compare au bloc « BUGS RÉCENTS » fourni. isDuplicate=true seulement si c'est manifestement le même problème (même module + même symptôme). Donne alors duplicateOf = la référence.

suggestedAction : 1 phrase de piste technique pour l'architecte (fichier/zone probable, hypothèse de cause). Pas de blabla.
summary : 1 ligne technique factuelle.

Réponds en français. Sois conservateur sur "critical" (réservé au vrai critique).
```

Bloc dynamique ajouté au system prompt :
```
BUGS RÉCENTS (pour détection de doublon) :
- #<id> [<module>] <summary>
- ... (≤ 20)
```

## 5. SCHÉMA JSON de sortie (gated — à valider)
Forcé via **tool use** (StructuredOutput) pour garantir un JSON valide (pas de parsing fragile) :

```json
{
  "severity":       "critical | high | medium | low",
  "module":         "pointage | paie | stock | cout_recolte | agronomie | equipes | quinzaine | dashboard | autre",
  "summary":        "string — résumé technique 1 ligne",
  "suggestedAction":"string — piste de correction pour l'archi",
  "isDuplicate":    true,
  "duplicateOf":    "string|null — réf du bug doublon, sinon null"
}
```
Champs tous requis ; `duplicateOf` = `null` si `isDuplicate=false`.

## 6. Effet sur le doc + alerte
- Update `bug_reports/{id}` : `{ severity, module, summary, suggestedAction, isDuplicate, duplicateOf, status:"qualified", triaged_at, triaged_model:"claude-sonnet-4-6" }`.
- **Si `severity === "critical"`** → WhatsApp immédiat à Omar (même pattern que les alertes existantes, cf. `notifyOmar.js` / endpoint WhatsApp) :
  `🔴 BUG CRITIQUE — [module] : [summary]. Signalé par [reporter]. Réf #[id].`
- **DÉCISION Omar 2026-06-12 : WhatsApp sur `critical` ET `high`.** (medium/low → vue admin seulement.)

## 7. Config Claude API
- **Clé API Anthropic DÉDIÉE** (≠ clé chat claude.ai) créée sur console.anthropic.com, stockée dans **Secret Manager** (Firebase functions secret `ANTHROPIC_API_KEY_TRIAGE`), jamais en clair ni dans le repo.
- Modèle : `claude-sonnet-4-6`. `max_tokens: 500`. `temperature: 0` (triage déterministe).
- Vision : si screenshot présent, l'inclure en image content block ; sinon texte seul.
- Coût estimé : ~$0.003/triage texte, ~$0.01 avec screenshot ; < 50 bugs/mois ≈ **$0.50/mois** max.

## 8. Vue admin (enrichir la Phase B existante — `BugReportsAdmin.js`)
- Afficher `severity` (badge couleur) + `module` + `summary` dans la liste.
- Filtres : severity / module / status.
- Badge compteur sur le menu : « N bugs haute priorité » (status=qualified ET severity in [critical,high]).

## 9. RÈGLE CLAUDE.md (à ajouter en section contraintes)
```
## Règle bug reports automatiques
Au début de chaque session, vérifier Firestore bug_reports où status="qualified"
ET severity in ["critical","high"]. Les traiter AVANT les autres items du backlog.
Quand le fix est déployé : status="resolved" + noter le commit/PR. Les bugs
"medium"/"low" sont traités quand le backlog haute priorité est vide.
```
> NB : cette règle implique que l'archi lise Firestore en début de session. À cadrer : via un script de bootstrap, ou une lecture manuelle. (Pas de mécanisme auto natif côté agent.)

## 10. Plan d'implémentation (après validation §4/§5)
1. Cloud Function `onBugReportCreate` (Firestore onCreate) : lit le doc, construit le contexte (bugs récents), appelle Claude (Sonnet, tool use), update le doc + WhatsApp si critical. Fire-and-forget, gestion d'échec → reste `new`.
2. Secret `ANTHROPIC_API_KEY_TRIAGE` (Secret Manager) + binding à la fonction.
3. Enrichir `BugReportsAdmin.js` (severity/module/summary + filtres + compteur menu).
4. Règle CLAUDE.md.
5. Tests : `node:test` sur le builder de prompt + le parsing/validation du JSON (mock Claude) ; pas d'appel réseau réel en test.
6. Deploy **depuis main** (RÈGLE 1) : functions (`onBugReportCreate`) + hosting (vue admin). **Gated** (deploy functions + secret).

## 11. Points à TRANCHER (Omar)
1. **§4 system prompt** + **§5 schéma JSON** : OK tels quels ou ajustements ?
2. Alerte WhatsApp sur `high` aussi, ou `critical` seulement ?
3. La clé `ANTHROPIC_API_KEY_TRIAGE` : tu la crées sur console.anthropic.com et me la donnes pour la mettre en Secret Manager (je ne la mets jamais dans le repo).
4. Règle CLAUDE.md « lire bug_reports en début de session » : OK comme convention (lecture par l'archi), ou tu veux un mécanisme dédié (script/notification) ?

---
**Décision attendue** : valider §4/§5 (+ §11). Ensuite je code (developer → QA → deploy depuis main, gated).
