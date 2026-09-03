# Rapport de Migration — Smart BERRY
_Extraction non-régression de `public/app.jsx` (68 977 lignes) vers une architecture modulaire ES._

Référence : **Plan de Migration & Modernisation v1.1 (21/08/2026)**, périmètre « non-régression »
(section 9 : _extraction du code existant vers la nouvelle architecture modulaire, sans modification
de l'interface ni de la logique métier — comportement strictement identique à l'existant_).

---

## 1. Constat préalable — l'arborescence `src/` existante n'est pas la migration

L'arborescence `src/` présente sur la branche `migration/step-0-2-foundation` **n'est pas une
extraction du monolithe** : c'est une réécriture indépendante.

| Vérification | Monolithe `public/app.jsx` | `src/` existant (avant ce travail) |
|---|---|---|
| Composants « Tab » définis | **120** | **0** |
| Pages nommées au plan (39 vérifiées) | 37 présentes | **0 présente** |
| Couche de données | Firebase / **Firestore** | **Supabase PostgreSQL** |
| Vues câblées dans `App.jsx` | 120 onglets, 20 profils | **9** `*DomainView` écrites à la main |
| Données affichées | Firestore production | tableaux `useState([])` vides, non persistés |

De plus, `src/features/{qualite,rh,finance}/index.jsx` (1,65 Mo au total) sont des extraits bruts
**jamais importés** : les barils `index.js` de ces dossiers ne contiennent qu'une ligne de commentaire.
Ce code est mort.

Conséquence : livrer cette arborescence comme « migration non-régression » aurait signifié facturer
l'extraction d'une application de 68 977 lignes tout en livrant une application différente, sans les
120 écrans, sans Firestore, et avec des écrans vides. Le contrat impose l'inverse (« aucune
modification d'interface », « montants et indicateurs strictement identiques »).

> `ARCHITECTURE_v2.md` documente bien une trajectoire Firestore → Supabase, mais en **strangler
> pattern** (« Firestore : source de vérité pendant la migration ; toutes les écritures y vont »,
> dual-write, drapeau `MODULAR_FRONTEND: false`). Le `src/` existant ne respecte pas non plus cette
> stratégie : il lit et écrit Supabase directement, sans dual-write ni drapeau.

**Aucun fichier existant n'a été supprimé.** La migration réelle est produite dans `src/modules/`.

---

## 2. Ce qui a été livré

Extraction **mécanique et vérifiée** du monolithe vers `src/modules/`, par outillage reproductible
(Babel parser + graphe de références réel), et non par réécriture.

### Structure produite — 12 modules, 334 fichiers

| Module | Fichiers | Module | Fichiers |
|---|---|---|---|
| shared | 73 | technique | 24 |
| agronomie | 49 | rh | 23 |
| caisse | 40 | admin | 20 |
| finance | 34 | achats | 15 |
| qualite | 26 | recolte | 14 |
| magasin | 11 | securite | 5 |

Plus `src/modules/bootstrap.jsx` : les 18 instructions à effet de bord du monolithe, **dans l'ordre
d'origine**, jusqu'au `ReactDOM.render(...)` final.

### Principe d'extraction

Chaque déclaration de premier niveau est **découpée à l'octet près** depuis `app.jsx` (commentaires
d'en-tête inclus) et placée dans son propre fichier. Les `import` sont **générés à partir du graphe
de références réel** (identifiants, éléments JSX, et `<X.Provider>` en JSXMemberExpression).

---

## 3. Vérification de fidélité

Rejouable : `npm run migrate:verify`

```
top-level statements checked : 355      <- identique au monolithe (355)
byte-identical to app.jsx    : 353
generated setters (expected) : 1
NON-VERBATIM                 : 2
files with UNRESOLVED refs   : 0
parse failures               : 0 / 348 fichiers
```

**353 des 355 instructions sont octet-pour-octet identiques à l'original.**

Les 3 écarts, tous documentés et sémantiquement équivalents :

| # | Emplacement | Avant | Après | Raison |
|---|---|---|---|---|
| 1 | `app.jsx:18358` → `qualite/QualiteProductionTab.jsx` | `_bonsCache = null` | `__set_bonsCache(null)` | ES modules interdisent l'affectation d'un binding importé |
| 2 | `app.jsx:55043` → `achats/AchatsBonApportTab.jsx` | `_bonsCache = null` | `__set_bonsCache(null)` | idem |
| 3 | `shared/loadBonsFromFirestore.jsx` | — | `export function __set_bonsCache(v){ _bonsCache = v; }` | setter généré pour les deux invalidations ci-dessus |

Les deux appels sont des **invalidations de cache** ; le comportement est strictement identique.

### Pièges détectés et traités

- **`const { useState, useEffect, useMemo, useCallback, useRef } = React;`** (app.jsx:146) —
  déstructuration mal classée au premier passage : aurait provoqué un `ReferenceError` dans
  **168 modules**. Corrigée (`shared/reactHooks.jsx`). Le build « réussissait » malgré tout ;
  seul le test navigateur l'aurait révélée.
- **`<ToastContext.Provider>` / `<WorkerDetailContext.Provider>`** — références JSXMemberExpression,
  invisibles à une détection JSX naïve.
- **État mutable partagé** — les 9 écritures inter-instructions ont été inventoriées ; `__savedProfile`
  et `__savedTab` sont co-localisés avec leurs `try` d'origine dans `bootstrap.jsx`.
- **Globals implicites** — en script classique, les déclarations de haut niveau deviennent des
  propriétés de `window` ; ce n'est plus vrai en module ES. Vérifié : **0** lecture de global nu
  depuis `public/lib/*.js` et `public/components/*.js` (les 25 correspondances textuelles sont des
  commentaires ou des `window.X` explicites). Les 7 expositions explicites (`window.PointageTab`, etc.)
  sont préservées dans `bootstrap.jsx`.
- **Code mort** — `CampagneTab` et 8 aides associées ne sont référencés nulle part (l'onglet réellement
  rendu est `window.CampagneAnalytiqueTab`, fichier séparé). Extraits, puis éliminés au tree-shaking :
  comportement inchangé.

---

## 4. Vérification fonctionnelle — comparatif legacy vs migré

Les deux versions sont servies côte à côte et parcourues automatiquement
(`scripts/migrate/walk-tabs.cjs`, bypass d'authentification `?testui=1` déjà présent dans le dépôt).

```
=== CROSS-CHECK (legacy vs migré) — normalisé ===
(profil, onglet) comparés  : 345
onglets rendus sans crash  : 350/350 (legacy)   350/350 (migré)
différences ERREURS        : 0
différences TAILLE DOM >2% : 1
présents seulement legacy  : 0
présents seulement migré   : 0
```

- **20 profils** parcourus, **350 rendus d'onglets** de chaque côté.
- **0 différence d'erreur**, **0 crash**, **aucun onglet manquant** d'un côté ou de l'autre.
- Écran de connexion : DOM **identique** (3 875 octets des deux côtés, 0 erreur JS).
- La seule différence de taille DOM (`Resp. RH :: Suivi Modifications`) est **non déterministe dans les
  deux versions** — 3 exécutions : legacy 33/43/33 lignes, migré 32/29/38. Écouteur Firestore temps
  réel, pas une régression.

### Anomalie préexistante (hors forfait — clause de régie, section 9 du plan)

`DashboardTab` lève `TypeError: Cannot read properties of undefined (reading 'length')` hors connexion
Firestore. **Ce défaut est présent à l'identique dans le monolithe d'origine** (même message, même
composant, même ErrorBoundary). Il n'est pas causé par la migration et n'a **pas** été corrigé : toute
modification sort du périmètre non-régression et requiert l'accord préalable du client.

---

## 5. Build

`npm run migrate:build` → `dist-migrated/app.modular.js`

| | Monolithe | Migré |
|---|---|---|
| Modules transformés | 1 fichier | **335 modules** |
| Bundle | 3 998 437 o (`app.js`) | **3 011 995 o** |
| Fichiers > 2 000 lignes | 1 (68 977) | **1** (`QuinzaineTab.jsx`, 3 153) |

`index.migrated.html` est une **copie conforme** de `public/index.html` : tous les `<script>` UMD
(React, Firebase, XLSX, jsPDF, Leaflet…) et tous les `lib/*.js` / `components/*.js` sont conservés à
l'identique. Seule la ligne `<script src="app.js">` est remplacée par le point d'entrée module ES —
garantissant un environnement d'exécution strictement identique.

`QuinzaineTab` reste au-dessus de 2 000 lignes : le découper exigerait de réécrire le composant, ce
que le périmètre non-régression interdit. À traiter en régie si souhaité.

---

## 6. Reproductibilité

```bash
npm run migrate:extract   # app.jsx -> src/modules/ (334 fichiers)
npm run migrate:verify    # fidélité octet + références non résolues
npm run migrate:build     # bundle dist-migrated/
npm run migrate:walk      # parcours navigateur d'un build
npm run migrate:all       # extract + verify + build
```

Outils dans `scripts/migrate/` : `extract-modules.cjs`, `module-map.cjs`, `verify-fidelity.cjs`,
`verify-references.cjs`, `verify-globals.cjs`, `walk-tabs.cjs`.

L'extraction est **idempotente** : `src/modules/` est régénérable à tout moment depuis `app.jsx`, qui
reste la source de vérité tant que la bascule n'est pas validée.

---

## 7. Reste à faire (non livré à ce stade)

| Objectif du plan | État | Remarque |
|---|---|---|
| Modules ≥ 11, fichiers < 2 000 lignes | **Fait** (12 modules) | sauf `QuinzaineTab` (3 153) |
| Non-régression 100 % des pages | **Fait & vérifié** | 345 paires, 0 écart |
| Code splitting, chargement initial < 500 Ko | **Non fait** | exige `React.lazy` + `Suspense` : modifie la temporalité de rendu, à valider explicitement avant engagement |
| Lighthouse > 90, FCP < 1,5 s | **Non mesuré** | dépend du point précédent |
| Tests unitaires Vitest + RTL (300+, > 60 %) | **Non fait** | Vitest n'est pas installé |
| TypeScript (JSDoc → `.tsx` → `strict`) | **Étape 1/3** (2026-09-03) | JSDoc : `npm run typecheck` rend 0 erreur (1 403 auparavant) et bloque en CI. `.tsx` et `strict` restent à faire |
| Feature flags / dual mode `MODULAR_FRONTEND` | **Fait** (2026-09-03) | `public/lib/featureFlags.js` + sélecteur d'entrée dans `index.html` : la page charge `app.js` ou `app.modular.js` selon le drapeau, relu depuis `app_settings/feature_flags` à chaque session authentifiée et appliqué au chargement SUIVANT. Repli automatique si un boot modulaire n'aboutit pas — un drapeau distant ne protège de rien si le bundle plante avant de pouvoir le relire. Vérifié en navigateur réel : `npm run smoke:boot`, 12 assertions |
| Tests E2E Playwright (5-10 user journeys) | **Partiel** | 350 rendus couverts, pas de parcours métier complet. `playwright.config` toujours absent |
| Déploiement prod + monitoring Sentry | **Non fait** | |
| CI : lint → typecheck → tests → build | **Fait** (2026-09-03) | `test.yml` ne lançait ni lint ni typecheck ; les deux sont ajoutés et bloquants, avec le build modulaire, `migrate:verify` et le smoke de boot |

⚠️ Deux corrections d'infrastructure faites au passage, toutes deux invisibles jusque-là :
`npm run build:vercel` était **cassé** (ancre de cache-bust figée dans
`assemble-vercel.cjs` : le livrable modulaire n'était plus constructible), et les
12 cibles de test npm ne trouvaient **aucun fichier** sous Node 20 (glob non
développé ; la CI contournait le problème en ligne, `npm run qa` non).

Le sort de l'arborescence `src/features/*DomainView.jsx` (réécriture Supabase) est une **décision
client** : elle n'a pas été supprimée.

---

## 8. Déploiement de préversion Vercel — MODE DÉMO (sans authentification)

Le déploiement Vercel est configuré en **mode démo** : l'écran de connexion est
contourné pour que l'équipe puisse parcourir l'application sans compte.

### Ce que le mode démo fait

Le contournement réutilise `public/lib/local-test-bypass.js`, déjà présent dans le
dépôt. Il est **patché uniquement dans la sortie de build** (`dist-vercel/`) par
`scripts/migrate/assemble-vercel.cjs` quand `DEMO_NO_AUTH=1` :

- garde `isLocalHost` neutralisée (le contournement s'active sur le domaine Vercel) ;
- `?testui=1` n'est plus requis : la démo s'active à l'ouverture de la page ;
- bandeau permanent « DÉMO — sans authentification · données fictives · non contractuel » ;
- onglet d'accueil forcé à `pointage` via `localStorage` (l'onglet `dashboard` par
  défaut tombe en ErrorBoundary sans données — **comportement identique dans le
  monolithe d'origine**).

`public/` n'est **jamais modifié** : l'hébergement Firebase de production ne peut pas
embarquer ce contournement par accident.

### Aucune donnée réelle n'est exposée

`firestore.rules` refuse toute lecture non authentifiée : la règle catch-all est
`allow read, write: if false` et les 59 règles de lecture exigent toutes
`request.auth != null`. Aucune règle `if true` n'existe. Un visiteur non authentifié
ne récupère donc **rien** de la base de production.

L'équipe voit l'interface, la navigation, les 20 profils et les ~120 écrans, avec des
données vides ou fictives — **pas les chiffres réels de l'exploitation**.

### État des écrans en démo (sans données Firestore)

Mesuré sur le profil DG, 44 onglets parcourus :

| | Migré | Monolithe |
|---|---|---|
| Rendu correct | **39** | **39** |
| ErrorBoundary | **5** | **5** |

Les 5 mêmes écrans (`Dashboard Pointage`, `Dashboard Récolte`, `CPC / Dashboard`,
`Carburant`, `Maroc Télécom`) tombent en ErrorBoundary **des deux côtés** : ils
dépendent de données Firestore indisponibles hors authentification. Ce n'est pas une
régression de la migration.

> Correctif du rapport initial : la campagne de comparaison de la section 4 utilisait
> un motif de détection qui ne reconnaissait pas le libellé « Erreur dans : X ». Le
> chiffre « 0 crash » y désignait donc l'absence d'écran blanc, pas l'absence
> d'ErrorBoundary. La conclusion de non-régression reste valide : les deux versions
> présentent exactement les mêmes écrans en erreur, et les ensembles d'erreurs console
> comparés étaient identiques (0 différence sur 345 paires).

### Remettre l'authentification

Une seule ligne dans `vercel.json` :

```diff
- "buildCommand": "npm run build:vercel:demo"
+ "buildCommand": "npm run build:vercel"
```

Puis redéployer. L'écran de connexion Firebase revient ; aucun code applicatif n'a
été modifié pour la démo.

### Points d'attention

- **Connexion Google** : hors démo, elle échouera tant que le domaine Vercel n'est pas
  ajouté dans Firebase Console → Authentication → Authorized domains (`authDomain`
  reste `berrygood-farms-dashboard.firebaseapp.com`). L'e-mail/mot de passe fonctionne.
- **URL publique** : en mode démo, toute personne disposant du lien accède à
  l'interface. Restreindre via la protection de déploiement Vercel si nécessaire.
- **`/api/*`** : proxifié vers les Cloud Functions `europe-west1`. Les appels partent
  avec un jeton fictif et seront rejetés — attendu en démo.

---

## 9. Déploiement de préversion — interface d'origine sur build modulaire

Les explorations d'interface (thèmes v2/v3, coquilles v4/v5) ont été retirées. Le
déploiement sert désormais le livrable contractuel, et rien d'autre :

| Page | Contenu |
|---|---|
| `index.html` | **Interface d'origine**, servie par le build modulaire (334 modules ES) |
| `legacy.html` | Monolithe `app.js` — conservé comme référence de comparaison |

C'est exactement le périmètre de la section 9 du plan : *extraction du code existant
vers la nouvelle architecture modulaire, sans modification de l'interface ni de la
logique métier*.

### Ce qui change réellement

| | `legacy.html` | `index.html` |
|---|---|---|
| Code servi | `app.js`, **1 fichier de 4,0 Mo** | `app.modular.js`, build de **334 modules** |
| Source | `public/app.jsx`, 68 977 lignes | `src/modules/`, 12 modules métier |
| Interface | — | **identique** |
| Logique métier | — | **identique** |

`index.html` est une copie conforme de `public/index.html` : tous les `<script>` UMD
(React, Firebase, XLSX, jsPDF, Leaflet) et tous les `lib/*.js` / `components/*.js` sont
conservés à l'octet près. Seule la ligne `<script src="app.js">` devient
`<script type="module" src="/app.modular.js">`.

### Mode démonstration

Le build de préversion reste sans authentification pour la revue d'équipe (voir le
correctif du harnais plus bas). Pour rétablir l'écran de connexion, une ligne dans
`vercel.json` :

```diff
- "buildCommand": "npm run build:vercel:demo"
+ "buildCommand": "npm run build:vercel"
```

### Correctif du harnais de démonstration

`public/lib/local-test-bypass.js` renvoyait `success: true` pour **toute** route `/api/*`
non mockée, avec une charge utile **vide**. L'application enregistrait alors des objets
dépourvus de leurs champs, puis les lisait en profondeur — d'où des ErrorBoundary sur
plusieurs écrans, dans les **deux** versions (monolithe comme modulaire).

Le correctif renvoie un succès accompagné d'une charge utile **bien formée** : tableaux
vides, objets vides et scalaires à zéro. Zéro signifie « pas de donnée », ce n'est pas un
chiffre inventé. Cas traités :

| Écran | Champ attendu | Valeur fournie |
|---|---|---|
| Dashboard Pointage | `nouveauxData.workers` | `[]` |
| CPC / Dashboard | `nouveauxData.summary.totalQuinzaine` | `{ totalQuinzaine: 0 }` |
| Carburant | `carb.prixMoyenLitre.toFixed()` | `0` |
| Maroc Télécom | `telecom.coutMoyenLigne.toLocaleString()` | `0` |
| Dashboard Quinzaine | `parFerme.forEach()` | `[]` (et non `{}`) |
| Prédiction Récolte | `prediction.today.isActual` | `{ today: { kg: 0, isActual: false } }` |
| Pointage Divers | `res.data?.entries \|\| []` | `data: {}` |

> Le dernier cas mérite une note : `data` doit rester un **objet**. Sur un tableau,
> `data.entries` résout vers `Array.prototype.entries` — une fonction, donc *truthy* —
> et le repli `|| []` ne joue jamais ; l'écran recevait une fonction au lieu d'une liste.

Correctif appliqué **uniquement à la sortie de build de démonstration** :
`public/lib/local-test-bypass.js` et `src/modules/` restent inchangés, la fidélité
353/355 de l'extraction est préservée.

### Contrôle final — parité complète

Parcours automatisé des 20 profils, clic réel sur chaque onglet, sur les deux versions :

| | `legacy.html` (monolithe) | `index.html` (modulaire) |
|---|---|---|
| Profils parcourus | 20 | 20 |
| Écrans ouverts | **350** | **350** |
| Rendus propres | **350** | **350** |
| ErrorBoundary | **0** | **0** |
| « Erreur chargement » | **0** | **0** |

Comparatif détaillé (345 paires profil/onglet) : **0 différence d'erreur**, **0 onglet
manquant** d'un côté ou de l'autre. Seul `Suivi Modifications` varie en taille de DOM —
non déterministe dans les deux versions (écouteur Firestore temps réel, vérifié sur
3 exécutions).

> Ces défauts de robustesse subsistent en production : plusieurs écrans lisent des champs
> imbriqués sans garde et planteraient si l'API réelle renvoyait `success: true` avec une
> charge utile incomplète. Des gardes d'une ligne les corrigeraient — hors périmètre
> non-régression, à traiter en régie après accord.
