# TODO Refacto — Dette technique trackée

Ce fichier liste les chantiers de refacto identifiés. Mis à jour à chaque sprint qui révèle un nouveau hotspot. Chaque entrée précise : ce qui pose problème, l'impact, et la piste de solution prévue.

---

## 🟡 Important — à planifier

### 1. `CaisseTransactionsSub` (composant Sprint 1)

**État** : composant de ~1 000 lignes, mélange logique métier + rendering + état local + récupération réseau. Sprint 1 ajoute filtres avancés, totaux, recherche, détection anomalies — la complexité grossit.

**État actuel** : le composant vit dans `src/modules/caisse/CaisseTransactionsSub.jsx` (module ES) ; la **logique pure** est dans `src/modules/shared/lib/caisseUtils.js` (testable, swappable).

**Solution prévue** :
- Découper ses sous-éléments : `<FilterChips>`, `<SearchBar>`, `<TableFooterTotals>`, `<AnomalyBadge>` (cf. spec Sprint 1 originale, abandonnée pour cause de monolithe)
- Couvrir avec React Testing Library

---

### 2. Absence de typage

**État** : JS pur partout, pas de TypeScript, JSDoc strict (`// @ts-check`) seulement dans `functions/lib/` et `src/modules/shared/lib/`. Les contrats entre composants reposent sur la mémoire des devs.

**Solution prévue** :
- Étape intermédiaire avant TS complet : forcer JSDoc strict sur tous les helpers extraits dans `lib/`
- Activer `// @ts-check` dans les nouveaux fichiers
- Décider entre rester en JSDoc strict ou bascule TS complète (le build Vite accepte `.tsx`)

---

### 3. Harnais de test des composants : états adressés par INDEX POSITIONNEL

**État** : faute de React Testing Library, les tests de composants stubent `React.useState` et adressent chaque état par son **rang d'appel** — `load([undefined, queue, 0, true, false, 0, {done,total}])` dans `tests/unit/magBCScanModal.test.js`, `tests/unit/affectationAnalytiqueTable.test.js`, etc.

**Risque (une phrase)** : insérer ou réordonner un `useState` décale silencieusement tous les suivants, si bien que les tests **continuent de passer en vérifiant le mauvais état** — un vert mensonger, pire qu'un échec, puisque rien ne signale la dérive.

**Contournement actuel** : commentaire « ce `useState` est volontairement le DERNIER » dans `MagBCScanModal.jsx`. Discipline humaine, pas un garde-fou.

**Solution prévue** : remplacer le stub positionnel par RTL (`render` + interactions réelles). Palliatif possible avant : stub `useState` acceptant une **clé nommée** (via un `useState` enveloppé maison ou l'ordre déclaré explicitement dans un manifeste vérifié par un test).

---

### 4. Stubs de réponse HTTP incomplets dans les tests front

**État** : les tests fabriquent des objets « Response » minimalistes. Exemple : `scan429()` dans `tests/unit/magBCScanModal.test.js` renvoie `{ status: 429, headers }` **sans méthode `json()`**, parce que le code sous test n'appelle pas `json()` sur un statut transitoire.

**Risque (une phrase)** : ces stubs ne modélisent pas assez fidèlement un `Response` pour **tuer les mutations qu'ils devraient tuer** — un code muté qui lirait le corps avant de classer le statut planterait sur un `TypeError` au lieu d'être correctement diagnostiqué, et un stub trop pauvre peut laisser passer une régression de classification.

**Solution prévue** : une fabrique partagée `fakeResponse({ status, headers, body })` exposant toujours `status`, `ok`, `headers.get()`, `json()` et `text()`, réutilisée par tous les tests front qui stubent `fetch`.

---

## 🟢 Améliorations long terme

- **Lint / format** : `npm run lint` ne vérifie que la syntaxe ; aucun `.eslintrc` ni `.prettierrc` à la racine.
- **Code coverage** : non mesurée (`npm run coverage` existe, non suivie). Pertinent une fois les tests de composants en place.
- **Dépendances** : React, Firebase, XLSX, jsPDF, Leaflet restent chargés par CDN dans `index.html` (globales) ; les faire entrer dans le bundle Vite est possible mais changerait le cache et le poids initial.

---

*Dernière mise à jour : 2026-09-17 — §1 (monolithe `app.jsx`) et §2 (monolithe `functions/index.js`) livrés et retirés.*
