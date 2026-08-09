# Deploy PROD des functions via Workload Identity Federation (fin du `FIREBASE_TOKEN`)

> Runbook autosuffisant. Objectif : le deploy prod des Cloud Functions ne s'exécute plus que
> dans GitHub Actions, authentifié par OIDC → Workload Identity Federation → impersonation du
> service account `sb-deployer`. **Aucune clé de service account, aucun token, ni en local ni
> sur le VPS.** La gate Omar n'est PAS une approbation de run (indisponible, cf. §5.1) : c'est
> la **branch protection sur `main`** (PR obligatoire + CI `test` verte) doublée de la
> **deployment branch policy** qui n'autorise à déployer que depuis `main`. Détail complet et
> limites assumées : §5.3 « Modèle de sécurité ».

**Périmètre.** Functions prod uniquement. Le deploy **hosting** reste sur `FIREBASE_TOKEN`
dans ce ticket — sa bascule est un follow-up noté au backlog. Le token ne peut donc pas encore
quitter `.env` racine (cf. §7).

Fichiers concernés : [`.github/workflows/deploy-prod.yml`](../.github/workflows/deploy-prod.yml),
[`scripts/deploy.sh`](../scripts/deploy.sh).

---

## 1. Valeurs à récupérer (read-only)

Trois commandes de lecture seule. Elles ne modifient rien.

```bash
# (a) pools existants — sert seulement à calquer le nommage d'un montage déjà en place
gcloud iam workload-identity-pools list --location=global --project=<PROJET_EXISTANT>

# (b) provider existant : issuer, mapping d'attributs, condition
gcloud iam workload-identity-pools providers list --location=global \
  --workload-identity-pool=<POOL_EXISTANT> --project=<PROJET_EXISTANT> \
  --format='yaml(name,oidc.issuerUri,attributeMapping,attributeCondition)'

# (c) numéro du projet prod — indispensable pour le principalSet du §3
gcloud projects describe berrygood-farms-dashboard --format='value(projectNumber)'
```

> **Décision : créer un pool DÉDIÉ dans le projet prod**, plutôt que réutiliser un pool
> d'un autre projet. Un pool externe qui ouvre la prod crée une relation de confiance
> inutile. Seul le nommage est calqué.

Variables à substituer dans tout ce document :

| Variable | Valeur | Provenance |
|---|---|---|
| `PROD_PROJECT` | `berrygood-farms-dashboard` | constante du repo (`.firebaserc`) |
| `PROD_NUM` | numéro du projet prod | commande (c) ci-dessus |
| `POOL` | ex. `github-pool` | à choisir (calqué sur l'existant) |
| `PROVIDER` | ex. `github-provider` | à choisir (calqué sur l'existant) |

```bash
export PROD_PROJECT=berrygood-farms-dashboard
export PROD_NUM=<numéro projet prod>
export POOL=github-pool
export PROVIDER=github-provider
```

---

## 2. Commandes à exécuter par Omar — création du montage

Ces commandes touchent l'IAM de prod : **elles ne sont exécutées que par Omar**, jamais par un
agent.

### 2.1 Service account déployeur

```bash
gcloud iam service-accounts create sb-deployer \
  --display-name="Deployer CI functions prod" --project=$PROD_PROJECT
```

### 2.2 Pool + provider OIDC, verrouillés sur le repo

```bash
gcloud iam workload-identity-pools create $POOL \
  --location=global --project=$PROD_PROJECT

gcloud iam workload-identity-pools providers create-oidc $PROVIDER \
  --location=global --workload-identity-pool=$POOL --project=$PROD_PROJECT \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment" \
  --attribute-condition="assertion.repository=='omaaouni/BERRYGOOD'"
```

`attribute-condition` verrouille le repo **au niveau du provider** : aucun autre dépôt ne peut
obtenir de jeton, quelle que soit la suite de la configuration.
Le mapping `attribute.environment` est **indispensable** au binding du §2.3 — sans lui, le
principalSet ci-dessous ne matcherait jamais.

> ⚠️ **`assertion.repository` porte le nom COMPLET `<owner>/<repo>`.** Tout changement de
> propriétaire (transfert vers une organisation) ou de nom du repo casse la condition, et
> l'authentification échoue **avant même** le deploy — avec un message d'auth peu parlant.
> Mettre à jour le provider sans le recréer :
>
> ```bash
> gcloud iam workload-identity-pools providers update-oidc $PROVIDER \
>   --location=global --workload-identity-pool=$POOL --project=$PROD_PROJECT \
>   --attribute-condition="assertion.repository=='<nouveau_owner>/<nouveau_repo>'"
> ```

### 2.3 Impersonation, restreinte à l'environment `production`

```bash
gcloud iam service-accounts add-iam-policy-binding \
  sb-deployer@$PROD_PROJECT.iam.gserviceaccount.com --project=$PROD_PROJECT \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROD_NUM/locations/global/workloadIdentityPools/$POOL/attribute.environment/production"
```

**Double verrou — c'est le cœur du dispositif :**

| Verrou | Où | Ce qu'il filtre |
|---|---|---|
| `attribute-condition` du provider | GCP, niveau provider | le **repo** : seul `omaaouni/BERRYGOOD` peut échanger un jeton |
| `principalSet` du binding | GCP, niveau SA | l'**environment** : seul un job déclarant `environment: production` peut impersonner `sb-deployer` |

Conséquence directe : un job qui ne déclare pas `environment: production` n'obtient **aucun
jeton**. Et comme l'environment `production` porte une deployment branch policy limitée à
`main` (§5.1), un workflow lancé depuis une autre branche ne peut pas s'y rattacher, donc ne
peut pas déployer. La restriction de branche n'est pas qu'une convention GitHub : côté GCP,
elle conditionne l'émission même du jeton.

---

## 3. Rôles IAM — jeu minimal, chacun justifié

Établi en lisant le chemin d'exécution réel de `firebase deploy --only functions` **gen1** dans
firebase-tools 15.6.0.

| Rôle (sur le projet prod) | Pourquoi |
|---|---|
| `roles/cloudfunctions.admin` | list/create/update + `functions.setIamPolicy` sur toute nouvelle function HTTPS (`fabricator.js:211`), que `cloudfunctions.developer` n'a pas |
| `roles/cloudscheduler.admin` | ~10 `.pubsub.schedule()` → get/create/update de jobs Scheduler (`fabricator.js:661-666`) |
| `roles/serviceusage.serviceUsageConsumer` | 5 `services.get` en préflight (`prepare.js:55-58,368`), dont un **sans try/catch** → sinon échec dur |
| `roles/firebase.viewer` | `GET adminSdkConfig` (`functionsConfig.js:104`), appelé sans garde |
| `roles/browser` | `projects.get` pour `needProjectNumber` (`prepare.js:44`) |
| `roles/secretmanager.viewer` | lecture de la version des secrets `ADMIN_SECRET` / `ANTHROPIC_API_KEY_TRIAGE` (`validate.js:227-236`) |
| `roles/artifactregistry.reader` | lecture de la politique de rétention `gcf-artifacts` (échec ⇒ warning seulement) |
| `roles/iam.serviceAccountUser` **scopé sur le SA runtime** `berrygood-farms-dashboard@appspot.gserviceaccount.com`, jamais au projet | `iam.serviceAccounts.actAs`, testé en `checkIam.js:35` |

Le dernier se pose **sur le SA runtime**, pas sur le projet :

```bash
gcloud iam service-accounts add-iam-policy-binding \
  berrygood-farms-dashboard@appspot.gserviceaccount.com --project=$PROD_PROJECT \
  --role=roles/iam.serviceAccountUser \
  --member="serviceAccount:sb-deployer@$PROD_PROJECT.iam.gserviceaccount.com"
```

Les autres se posent sur le projet, sur le même modèle :

```bash
for ROLE in roles/cloudfunctions.admin roles/cloudscheduler.admin \
            roles/serviceusage.serviceUsageConsumer roles/firebase.viewer \
            roles/browser roles/secretmanager.viewer roles/artifactregistry.reader; do
  gcloud projects add-iam-policy-binding $PROD_PROJECT \
    --role="$ROLE" \
    --member="serviceAccount:sb-deployer@$PROD_PROJECT.iam.gserviceaccount.com"
done
```

### Rôles explicitement NON accordés

Souvent donnés à tort dans les tutoriels ; vérifiés inutiles ici :

| Rôle refusé | Raison |
|---|---|
| `roles/storage.admin` | l'upload de source gen1 se fait sur une **URL signée non authentifiée** (`gcp/storage.js:56`) |
| `roles/cloudbuild.builds.editor` | `gcp/cloudbuild.js` n'est jamais chargé par ce chemin de deploy |
| `roles/artifactregistry.writer` | aucun push d'image côté client |
| `roles/resourcemanager.projectIamAdmin` | voir le piège asymétrique ci-dessous |
| `roles/secretmanager.admin` | idem — la lecture de version (`viewer`) suffit |

### ⚠️ Piège asymétrique de `ensureServiceAgentRoles` (contre-intuitif)

`ensureServiceAgentRoles` ne lit la policy du projet que si une function **événementielle**
est ajoutée (`checkIam.js:139-160`). Or :

- si la **lecture** de la policy échoue → simple warning, le deploy continue ;
- si la lecture **réussit** mais qu'une **écriture** manque → **échec dur**
  (`checkIam.js:186-189`).

**Donner la lecture sans l'écriture est donc pire que ne rien donner.** C'est pourquoi
`resourcemanager.projectIamAdmin` n'est PAS accordé : sans droit de lecture, on retombe sur le
warning inoffensif.

Le projet n'a aujourd'hui **aucun trigger événementiel déployé**. Le premier
`.firestore.document()` / `.pubsub.topic()` ajouté déclenchera ce chemin : à ce moment-là,
**pré-provisionner les bindings des service agents à la main** plutôt qu'élargir `sb-deployer`.

---

## 4. Prérequis one-shot (à faire par Omar avant le premier run)

Ils **remplacent le `--force` qu'on refuse** : `--force` neutraliserait ces deux prompts, mais
il ferait aussi passer silencieusement la **suppression de functions** (`prompts.js:52`), ce qui
est inacceptable en CI. On traite donc les deux causes en amont, une fois pour toutes.

```bash
# 1. Activer les 6 API une fois pour toutes → serviceUsageConsumer (lecture) suffit ensuite
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  runtimeconfig.googleapis.com \
  --project=$PROD_PROJECT

# 2. Politique de rétention Artifact Registry — sinon le job échoue APRÈS un deploy
#    pourtant réussi (prompts.js:182-187)
firebase functions:artifacts:setpolicy --project=$PROD_PROJECT
```

---

## 5. Configuration GitHub

> ⛔ **FAIT ÉTABLI — les required reviewers sont HORS DE PORTÉE ici, ne pas réessayer.**
> Sur un repo **privé**, la deployment protection rule « required reviewers » est réservée au
> plan **Enterprise**. L'org est en plan **Team** : l'API répond, définitivement,
> `422 ... billing plan supports the required reviewers protection rule`. **Il n'existe donc
> aucune approbation de run, aucun écran de revue de déploiement, aucune pause.** Toute
> documentation ou tout message qui en promet une envoie chercher une UI inexistante. La gate
> humaine est ailleurs — cf. §5.3.

> ✅ **Fait observé : un transfert de repo CONSERVE l'environment (§5.1) et les variables
> (§5.2).** Après le transfert, l'environment `production` et les variables `WIF_PROVIDER` /
> `WIF_SERVICE_ACCOUNT` étaient toujours présents et fonctionnels. (Ce document affirmait
> l'inverse : c'était faux.) Ce qui casse au transfert, c'est l'`attribute-condition` du
> provider GCP, qui contient le nom complet `<owner>/<repo>` — cf. §2.2. Vérifier quand même
> après coup, ça ne coûte rien :
> `gh api repos/<owner>/<repo>/environments/production` et
> `gh api repos/<owner>/<repo>/actions/variables`.

### 5.1 Environment `production` (claim OIDC + politique de branche)

Repo → **Settings → Environments** → nom exact : `production`.

L'environment sert à deux choses, et **pas** à faire valider un run :

1. **Émettre la claim OIDC `environment`** exigée par le binding GCP du §2.3. Le nom
   `production` doit être **exactement** celui-là : il est repris tel quel dans le
   principalSet (`attribute.environment/production`).
2. **Porter la deployment branch policy** : seul `main` est autorisé à déployer sur cet
   environment.

Effet réel d'un run : il **démarre immédiatement**, la claim `environment` est émise, GCP
délivre le jeton — et si la ref n'est pas `main`, le rattachement à l'environment est refusé,
donc pas de jeton, donc pas de deploy.

#### Commandes réellement appliquées (pour rejeu / audit)

Branch protection sur `main` — **PR obligatoire + status check `test` vert** :

```bash
gh api -X PUT repos/{owner}/{repo}/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["test"] },
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "enforce_admins": false,
  "restrictions": null
}
JSON
```

> Le contexte `test` n'a **pas été deviné** : il a été **découvert** sur un commit réel via
> `gh api repos/{owner}/{repo}/commits/main/check-runs --jq '.check_runs[].name'`. Un nom de
> contexte inventé serait accepté par l'API et bloquerait ensuite **tous** les merges (un
> check jamais rapporté reste éternellement « en attente »).

Deployment branch policy — seul `main` déploie :

```bash
gh api -X PUT repos/{owner}/{repo}/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'

gh api -X POST repos/{owner}/{repo}/environments/production/deployment-branch-policies \
  -f name=main
```

> `protected_branches: false` + `custom_branch_policies: true` = liste blanche explicite de
> noms de branches. C'est plus strict que `protected_branches: true`, qui autoriserait
> **toute** branche protégée (aujourd'hui `main` seule, mais une protection ajoutée demain sur
> une autre branche l'ouvrirait silencieusement au deploy).

### 5.2 Variables de repo

Repo → **Settings → Secrets and variables → Actions → onglet `Variables`**.
Ce sont bien des **variables**, pas des secrets : ce sont des identifiants d'infrastructure
publics, pas des credentials. Les mettre en secrets ne masquerait rien d'utile et rendrait le
débogage des erreurs d'auth beaucoup plus pénible.

| Variable | Valeur |
|---|---|
| `WIF_PROVIDER` | `projects/$PROD_NUM/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER` |
| `WIF_SERVICE_ACCOUNT` | `sb-deployer@berrygood-farms-dashboard.iam.gserviceaccount.com` |

### 5.3 Modèle de sécurité — ce qui protège, et ce que ça ne protège pas

**Ce qui protège**

| Verrou | Effet concret |
|---|---|
| Branch protection sur `main` | Aucun commit n'entre dans `main` sans passer par une PR dont le status check `test` est vert (`strict: true` : la PR doit en plus être à jour avec `main`) |
| Deployment branch policy `production` → `main` | Un run déclenché depuis une autre ref ne se rattache pas à l'environment → aucune claim → aucun jeton GCP → aucun deploy |
| Prompt de permission local | `scripts/deploy.sh:*` et `npm run deploy:*` sont en `ask` dans `.claude/settings.json` : le déclenchement d'un deploy demande une confirmation humaine |
| Hook `scripts/bash-discipline-gate.js` | Refuse **tout** déclenchement direct de workflow par l'agent — `gh workflow run` comme `gh api …/actions/workflows/…/dispatches`. Le seul chemin restant est `scripts/deploy.sh`, qui est gaté. ⚠️ C'est le hook, et non la règle `ask`, qui fait ce travail : le matching `ask` est un **préfixe**, donc `GH_REPO=x gh workflow run`, un double espace ou `gh workflow --repo X run` y échapperaient. Un deny de hook, lui, tient même en `bypassPermissions`. La **lecture** des runs (`gh run list/watch/view`) reste libre |
| `dry_run: true` par défaut | Un dispatch sans input explicite **simule** et ne déploie rien |

**Ce que ça ne protège PAS** — assumé, pas oublié (dépôt à un seul développeur) :

- `dry_run: true` protège du **déclenchement accidentel**, pas d'un acteur délibéré : il suffit
  de passer `-f dry_run=false`. Ce n'est pas une autorisation, c'est un cran de sûreté.
- Avec `required_approving_review_count: 0`, la branch protection **n'empêche pas
  l'auto-merge** de sa propre PR. Elle impose le *passage* par une PR et une CI verte, pas
  qu'un tiers ait relu.
- `enforce_admins: false` laisse un **admin contourner** la protection (push direct sur `main`,
  merge malgré un check rouge).

**Ce que le dispositif garantit réellement**, formulé sans complaisance : *le code déployé est
forcément passé par une PR avec CI verte*. Pas : *un humain a validé ce déploiement-là*.

> **Pourquoi `approvals: 0` et `enforce_admins: false`.** Ce sont des choix liés au fait
> qu'Omar développe **seul** : GitHub interdit d'approuver sa propre PR (avec `approvals: 1`,
> plus aucun merge ne serait possible), et `enforce_admins: true` ferait d'un tiers un point de
> passage obligé pour tout hotfix. **À revoir dès qu'un second compte obtient l'accès write**
> sur le repo : à ce moment-là, `approvals: 1` et `enforce_admins: true` deviennent tenables et
> transforment la garantie « CI verte » en « quelqu'un d'autre a relu ».

---

## 6. Test de bout en bout, avec preuve

À jouer dans cet ordre, du moins risqué au plus engageant.

> ⚠️ **Aucun de ces runs n'attend quoi que ce soit : ils démarrent et s'exécutent
> immédiatement.** Il n'y a pas d'approbation à donner (§5.1). La seule protection contre un
> déploiement involontaire, c'est **`dry_run=true`, la valeur par défaut** : un dispatch sans
> input explicite simule. À l'inverse, `-f dry_run=false` déploie la prod, tout de suite, sans
> confirmation ultérieure. Relire l'input avant de valider la commande — c'est le dernier
> moment où on peut se raviser.

### Étape 1 — Dry-run complet

```bash
gh workflow run deploy-prod.yml --ref main -f dry_run=true -f only=functions
gh run watch
```

Valide : l'auth WIF, la résolution des rôles IAM, le chargement des ~55 endpoints, la validité
des secrets référencés.

**Preuve attendue** dans le log : `Loaded environment variables from` **ABSENT** (confirme
`usedDotenv=false`, donc que le CI ne rejoue aucun `.env`), et sortie `--dry-run` sans erreur.

> ⚠️ **Ce qu'un dry-run vert ne prouve PAS.** `checkHttpIam` et l'upload de la source sont
> exécutés en phase `deploy`, sautée par `deploy/index.js:110-114`. Un dry-run vert ne garantit
> donc ni le droit `functions.setIamPolicy`, ni l'upload. D'où l'étape 2.

### Étape 2 — Deploy réel d'UNE SEULE function

Choisir une function HTTP en lecture seule, sans effet de bord — `health` est le candidat
naturel (voir `docs/ai/deploy-verify-targets.txt`).

**Avant** le deploy, capturer les clés d'env vars :

```bash
gcloud functions describe health \
  --region europe-west1 --project berrygood-farms-dashboard --format=json \
  | jq -r '(.environmentVariables // .serviceConfig.environmentVariables // {}) | keys | sort | join("\n")' > /tmp/envkeys-avant.txt

gcloud functions describe health \
  --region europe-west1 --project berrygood-farms-dashboard \
  --format='value(updateTime)'
```

Puis :

```bash
gh workflow run deploy-prod.yml --ref main -f dry_run=false -f only=functions:health
gh run watch
```

### Étape 3 — Preuve d'intégrité des variables d'environnement (le point qui compte)

```bash
gcloud functions describe health \
  --region europe-west1 --project berrygood-farms-dashboard --format=json \
  | jq -r '(.environmentVariables // .serviceConfig.environmentVariables // {}) | keys | sort | join("\n")' > /tmp/envkeys-apres.txt

diff /tmp/envkeys-avant.txt /tmp/envkeys-apres.txt && echo "✓ clés identiques"

gcloud functions describe health \
  --region europe-west1 --project berrygood-farms-dashboard \
  --format='value(updateTime)'
```

Critères : les deux listes de clés sont **identiques**, et `updateTime` a **avancé** (le deploy
a bien eu lieu). C'est la vérification directe du mécanisme `inferDetailsFromExisting`
(`prepare.js:214-226`) : sans `.env` sur le runner, firebase-tools réinjecte les env vars
**déjà déployées**.

> On ne compare **que les clés**, jamais les valeurs : `scripts/verify-deploy.js:12-14` rappelle
> qu'un `describe` non filtré expose API keys et mots de passe DB en clair — y compris dans un
> historique de terminal ou un log CI.

### Étape 4 — Deploy complet

```bash
gh workflow run deploy-prod.yml --ref main -f dry_run=false -f only=functions
gh run watch

# après la fin réelle du run, depuis un checkout main propre :
node scripts/verify-deploy.js
BASE_URL="https://berrygood-farms-dashboard.web.app" node tests/smoke-test.js
```

### Contrôle négatif (facultatif mais recommandé)

Un run déclenché depuis une branche ≠ `main` doit échouer **dès la première étape**
(garde-fou RÈGLE 1), sans jamais atteindre l'auth. Vérifiable en relisant le log d'échec :
rien n'est déployé.

---

## 7. Étapes de retrait

1. ✅ **Fait** — aucun repli `--token` ne subsiste sur le chemin functions de
   `scripts/deploy.sh` (à revérifier après toute modification du script).
2. ✅ **Fait** — `CLAUDE.md` §« Deploy non-interactif » mise à jour.

### 3. `functions/.env` — 🔴 **RÉSERVÉ À OMAR. UN AGENT NE L'EXÉCUTE JAMAIS.**

> **La condition bloquante est la SAUVEGARDE, pas la suppression.** Tant que la sauvegarde
> hors du repo n'est pas faite et vérifiée, la suppression ne doit pas avoir lieu. Une version
> antérieure de ce document présentait l'inverse — suppression « non optionnelle », sauvegarde
> reléguée en note. Lu littéralement par un agent, ça détruisait des données.

**Pourquoi ce fichier ne se supprime pas à la légère.** Les ~25 variables (`SQL_*`, `IMAP_*`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FARMROAD_API_KEY`, `*_IMPORT_KEY`…) n'existent
aujourd'hui qu'à **deux** endroits : ce fichier, et la configuration des functions déjà
déployées. `gcloud functions describe` permet de les relire, mais si des functions sont
supprimées et recréées, ou le projet reconstruit, **les valeurs sont perdues définitivement**.
`functions/.env` est donc, en l'état, la seule copie complète — et le supprimer sans sauvegarde
échangerait un risque réversible (écrasement : on redéploie) contre un risque irréversible.

**Le risque d'écrasement, lui, est réel mais aujourd'hui atténué.** Un `firebase deploy --only
functions` lancé localement rejouerait ce fichier (`usedDotenv=true` → il redevient
autoritaire) et écraserait les variables de prod avec des valeurs périmées. Mais y arriver
suppose désormais de contourner **deux** garde-fous : `scripts/deploy.sh functions` n'a plus de
chemin local (il délègue au CI, qui n'a pas de `.env`), et `firebase deploy` en direct est en
`deny` dans `.claude/settings.json` **et** refusé par la règle `firebase-direct` du hook
`scripts/bash-discipline-gate.js`. Ce n'est donc plus une urgence — c'est une dette à solder
proprement.

**Procédure, quand Omar la mène :**
1. Sauvegarder `functions/.env` **hors du repo** — gestionnaire de mots de passe ou coffre
   chiffré, jamais un dossier local en clair.
2. **Vérifier la sauvegarde** (rouvrir l'entrée, confirmer que les ~25 clés y sont).
3. Seulement alors, supprimer le fichier du poste.

**La voie propre reste la migration Secret Manager.** Elle rend le retrait légitime sans
dépendre d'une sauvegarde manuelle : les functions référencent un secret par son nom,
`describe` n'affiche que la référence, la valeur ne transite jamais, et la source de vérité
devient GCP. Modèle déjà en place pour `ADMIN_SECRET` et `ANTHROPIC_API_KEY_TRIAGE`. Ticket
dédié au backlog. ⚠️ `METEOBLUE_API_KEY` est **en dur dans le code** (`functions/index.js`) :
elle exige un changement de code, pas une simple bascule.

### 4. `FIREBASE_TOKEN` (racine) — reste en place

Tant que le **hosting** n'est pas migré vers WIF (follow-up au backlog). Le jour de cette
bascule : retirer la ligne de `.env` **et révoquer le token** (`firebase logout --token <token>`).

---

## 8. Caveat — toute NOUVELLE function créée après la bascule

Le mécanisme qui protège les env vars (`inferDetailsFromExisting`) recopie les variables de la
version **déjà déployée**. Une function **créée** après la bascule n'a pas de version
antérieure (pas de `haveE`) : elle naît donc **sans aucune variable d'environnement**.

**Elle se déploiera sans la moindre erreur, et échouera au RUNTIME, pas au deploy.** C'est un
échec silencieux au moment du deploy — d'où ce paragraphe.

Marche à suivre pour toute nouvelle function consommant des env vars :

```bash
# APRÈS le premier deploy de la function, AVANT sa première exécution réelle
gcloud functions deploy <nouvelleFonction> \
  --region europe-west1 --project berrygood-farms-dashboard \
  --update-env-vars KEY1=valeur1,KEY2=valeur2
```

(ou via la console GCP). Vérifier ensuite avec le `jq ... | keys` de l'**Étape 3 du §6**
(preuve d'intégrité des variables).

> Ce caveat deviendra **caduc** quand les ~14 variables restantes seront migrées vers Secret
> Manager via `runWith({ secrets })`, sur le modèle de `ADMIN_SECRET` et
> `ANTHROPIC_API_KEY_TRIAGE` : les secrets sont déclarés **dans le code**, donc reconstruits à
> chaque deploy sans dépendre de l'état déployé. Item au backlog.
