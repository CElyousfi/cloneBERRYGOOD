/* lazyGlobalComponent — charge à la demande un composant legacy publié sur `window`.
 *
 * `public/components/*.js` sont des scripts CLASSIQUES : ils s'exécutent dans le
 * scope global et se publient en `window.MagBCTab`. Ils ne peuvent donc pas être
 * importés par le graphe ES, et index.html les chargeait tous au démarrage —
 * 767 Ko d'onglets téléchargés, parsés et exécutés à chaque ouverture de
 * l'application, alors qu'un utilisateur en ouvre un ou deux.
 *
 * Ce module leur donne le même traitement que les onglets modulaires : la balise
 * <script> n'est injectée qu'au premier rendu de l'onglet. C'est la contrepartie
 * de `React.lazy` pour du code qui n'est pas un module.
 *
 */

/** Une promesse par source : deux onglets qui partagent une dépendance ne la chargent qu'une fois. */
const __enCours = new Map();

/** Reprend le `?v=` des balises de la page — même cache-bust que le reste du frontend. */
function versionQuery() {
  try {
    const tag = document.querySelector('script[src*="lib/authResilience.js"]');
    const q = String(tag && tag.getAttribute('src') || '').split('?')[1];
    return q ? '?' + q : '';
  } catch (e) { return ''; }
}

function chargerScript(src) {
  if (__enCours.has(src)) return __enCours.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + versionQuery();
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('lazyGlobalComponent : script introuvable — ' + src));
    document.head.appendChild(s);
  });
  __enCours.set(src, p);
  return p;
}

/**
 * @param {string} globalName nom publié sur window par le dernier script
 * @param {string[]} sources chemins des scripts, DÉPENDANCES D'ABORD
 * @returns {any} composant utilisable derrière un <Suspense>
 */
function lazyGlobalComponent(globalName, sources) {
  return React.lazy(async () => {
    // En série, pas en parallèle : ces scripts se lisent entre eux au moment de
    // s'exécuter (CampagneAnalytiqueTab appelle window.CampagneBudgetTab), et
    // des <script> injectés dynamiquement ne garantissent pas l'ordre.
    for (const src of sources) await chargerScript(src);
    const C = window[globalName];
    if (!C) throw new Error('lazyGlobalComponent : window.' + globalName + ' absent après chargement');
    return { default: C };
  });
}

export { lazyGlobalComponent };
