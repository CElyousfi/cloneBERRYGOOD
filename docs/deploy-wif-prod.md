# Deploy PROD des functions via Workload Identity Federation (fin du `FIREBASE_TOKEN`)

> Runbook autosuffisant. Objectif : le deploy prod des Cloud Functions ne s'exécute plus que
> dans GitHub Actions, authentifié par OIDC → Workload Identity Federation → impersonation du
> service account `sb-deployer`. **Aucune clé de service account, aucun token, ni en local ni
> sur le VPS.** La gate Omar devient l'approbation du run GitHub (environment `production`).

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

Conséquence directe : un job qui ne déclare pas `environment: production` — donc qui n'est pas
passé par la revue d'Omar — n'obtient **aucun jeton**. La gate humaine n'est pas seulement une
convention GitHub, elle est appliquée côté GCP.

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

> ⚠️ **Prérequis de plan.** Les protection rules d'environment (dont les **required
> reviewers**) ne sont disponibles, sur un repo **privé**, qu'avec GitHub **Pro / Team /
> Enterprise**. En plan Free, l'API répond `422 ... billing plan supports the required
> reviewers protection rule`. Sans cette règle, l'environment fonctionne quand même pour
> l'authentification (la claim OIDC est émise, le binding GCP matche) mais **la gate humaine
> n'existe pas** : le run se déploie sans attendre personne. Pire, si l'environment n'existe
> pas du tout, GitHub le crée automatiquement **sans protection** au premier run — un
> déploiement qui a l'air gaté et ne l'est pas. Vérifier explicitement :
> `gh api repos/<owner>/<repo>/environments/production --jq '.protection_rules'` doit être
> **non vide**.

> ⚠️ **Un transfert de repo ne transporte ni les variables (§5.2) ni l'environment (§5.1).**
> Code, issues et PR suivent ; la config Actions non. À recréer intégralement, sous peine
> d'échec à l'auth (variables vides) ou de perte silencieuse de la gate (environment sans
> required reviewer). C'est l'autre moitié du piège du §2.2.

### 5.1 Environment `production` (= la gate Omar)

Repo → **Settings → Environments → New environment** → nom exact : `production`.

- Cocher **Required reviewers** → ajouter **Omar**.
- Le nom `production` doit être **exactement** celui-là : il est repris tel quel dans le
  principalSet du §2.3 (`attribute.environment/production`).

Effet : tout run de `deploy-prod.yml` se met en pause avant le job `deploy` et attend
l'approbation d'Omar.

### 5.2 Variables de repo

Repo → **Settings → Secrets and variables → Actions → onglet `Variables`**.
Ce sont bien des **variables**, pas des secrets : ce sont des identifiants d'infrastructure
publics, pas des credentials. Les mettre en secrets ne masquerait rien d'utile et rendrait le
débogage des erreurs d'auth beaucoup plus pénible.

| Variable | Valeur |
|---|---|
| `WIF_PROVIDER` | `projects/$PROD_NUM/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER` |
| `WIF_SERVICE_ACCOUNT` | `sb-deployer@berrygood-farms-dashboard.iam.gserviceaccount.com` |

---

## 6. Test de bout en bout, avec preuve

À jouer dans cet ordre, du moins risqué au plus engageant. Chaque run doit être approuvé par
Omar sur l'environment `production`.

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

## 7. Étapes de retrait — OBLIGATOIRES après le premier deploy WIF réussi

Rien n'est retiré tant que l'étape 6.4 n'est pas verte. Une fois qu'elle l'est, ces étapes ne
sont **pas optionnelles**.

1. **Vérifier qu'aucun repli `--token` ne subsiste sur le chemin functions** de
   `scripts/deploy.sh` (déjà fait par ce ticket — à revérifier après toute modification du
   script).

2. **Supprimer `functions/.env` du poste local.** ⬅️ **Le point critique.**
   Tant que ce fichier existe, un `firebase deploy --only functions` lancé localement le
   rejouerait (`usedDotenv=true` → il redevient **autoritaire**) et **écraserait les variables
   d'environnement de prod avec des valeurs périmées**. Le fichier dérive de la prod dès que le
   CI est en service : il devient un piège, pas une sauvegarde.
   → Omar : sauvegarde **hors du repo** (gestionnaire de mots de passe / coffre), **puis
   suppression**.

3. **`FIREBASE_TOKEN` reste dans `.env` racine** tant que le **hosting** n'est pas migré vers
   WIF (follow-up au backlog). Le jour de cette bascule : retirer la ligne de `.env` **et
   révoquer le token** (`firebase logout --token <token>`).

4. `CLAUDE.md` §« Token CI (deploy non-interactif) » — **déjà mis à jour par ce ticket**, elle
   imposait exactement l'inverse de la nouvelle règle.

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

(ou via la console GCP). Vérifier ensuite avec le `jq ... | keys` du §6.3.

> Ce caveat deviendra **caduc** quand les ~14 variables restantes seront migrées vers Secret
> Manager via `runWith({ secrets })`, sur le modèle de `ADMIN_SECRET` et
> `ANTHROPIC_API_KEY_TRIAGE` : les secrets sont déclarés **dans le code**, donc reconstruits à
> chaque deploy sans dépendre de l'état déployé. Item au backlog.
