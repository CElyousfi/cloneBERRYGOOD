/**
 * featureFlags.js — drapeaux de bascule lus AVANT le boot de l'application.
 *
 * Le seul drapeau porté aujourd'hui est `MODULAR_FRONTEND` : il choisit lequel
 * des deux frontends la page charge — le monolithe `app.js` (défaut) ou le
 * bundle ES `app.modular.js` issu de `src/modules/`. Les deux rendent la même
 * interface ; c'est l'architecture qui diffère.
 *
 * ⚠️ CE CHOIX EST SYNCHRONE. Il se fait pendant l'analyse du document, avant
 * qu'aucun bundle ne soit chargé : impossible d'attendre un aller-retour réseau
 * sans écran blanc. La décision se prend donc sur des sources locales, et la
 * valeur distante ne sert qu'à préparer le PROCHAIN chargement :
 *
 *   1. `?modular=1` / `?modular=0` dans l'URL — la main de l'opérateur, elle
 *      gagne toujours, et elle est mémorisée pour les navigations suivantes.
 *   2. Un boot modulaire précédent qui n'a jamais abouti — repli automatique.
 *   3. La valeur mise en cache par le dernier `refresh()` réussi.
 *   4. Le défaut : le frontend MODULAIRE. La parité de rendu entre les deux est
 *      vérifiée écran par écran dans un navigateur — `npm run migrate:parity`,
 *      20 profils, 350 rendus, 0 écart.
 *
 * LE GARDE-FOU DE BOOT est ce qui rend la bascule réversible. Un drapeau
 * distant ne protège de rien si le bundle plante AVANT d'avoir pu le relire :
 * l'utilisateur boucle alors sur une application morte, et aucune bascule
 * côté serveur ne l'atteint. On marque donc le boot « en cours » avant de
 * charger le bundle modulaire, et la page ne l'efface qu'une fois l'interface
 * réellement rendue. Un marqueur encore présent au chargement suivant vaut
 * constat d'échec : on retombe sur le monolithe sans rien demander à personne.
 *
 * Chargé en <script src="lib/featureFlags.js"> classique : PARTAGE LE SCOPE
 * GLOBAL du navigateur. Tout est wrappé dans une IIFE, aucun identifiant
 * top-level ne fuite (cf. crashes #75/#77, React #200). UN SEUL global exposé :
 *   window.FeatureFlags
 */
// @ts-check
(function () {
  'use strict';

  /** Clé du drapeau en cache, et du marqueur de boot, dans localStorage. */
  var LS_MODULAR = 'sb_flag_modular_frontend';
  var LS_BOOT_PENDING = 'sb_modular_boot_pending';

  /** Document Firestore qui porte les drapeaux (lecture authentifiée). */
  var FLAGS_COLLECTION = 'app_settings';
  var FLAGS_DOC = 'feature_flags';

  /**
   * Décide si le frontend modulaire doit être chargé. FONCTION PURE — c'est
   * elle que les tests couvrent, le reste n'est que de la plomberie de lecture.
   *
   * @param {{param?: string|null, cached?: string|null, bootPending?: string|null}} input
   *   `param`  : valeur brute de `?modular` ('1', '0', ou null si absent)
   *   `cached` : valeur brute en localStorage ('1', '0', ou null)
   *   `bootPending` : marqueur d'un boot modulaire jamais confirmé (ou null)
   * @returns {{modular: boolean, reason: string, clearBootPending: boolean, persist: string|null}}
   *   `persist` : valeur à écrire dans le cache, ou null pour n'y pas toucher
   */
  function decideModularFrontend(input) {
    var i = input || {};

    // 1. L'URL tranche, dans les deux sens. C'est l'échappatoire manuelle :
    //    `?modular=0` ramène au monolithe même si tout le reste dit l'inverse.
    if (i.param === '1') return { modular: true, reason: 'url', clearBootPending: false, persist: null };
    if (i.param === '0') return { modular: false, reason: 'url', clearBootPending: true, persist: null };

    // 2. Un boot modulaire précédent n'a jamais confirmé son rendu.
    //    Le repli est COLLANT : on écrit '0' en cache. Sans ça, le défaut
    //    modulaire reprendrait la main au chargement suivant et l'utilisateur
    //    alternerait indéfiniment entre une application morte et le monolithe.
    //    Un `refresh()` réussi, ou un `?modular=1` explicite, le relance.
    if (i.bootPending) return { modular: false, reason: 'boot-echec', clearBootPending: true, persist: '0' };

    // 3. Dernière valeur distante connue.
    if (i.cached === '1') return { modular: true, reason: 'cache', clearBootPending: false, persist: null };
    if (i.cached === '0') return { modular: false, reason: 'cache', clearBootPending: false, persist: null };

    // 4. Défaut : le modulaire. La parité de rendu avec le monolithe est
    //    vérifiée écran par écran (`npm run migrate:parity`).
    return { modular: true, reason: 'defaut', clearBootPending: false, persist: null };
  }

  /** Lecture tolérante de localStorage — indisponible en navigation privée. */
  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* stockage refusé */ }
  }
  function lsDel(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* stockage refusé */ }
  }

  /** Valeur brute de `?modular` dans l'URL courante, ou null. */
  function urlParam() {
    try {
      var v = new URLSearchParams(window.location.search).get('modular');
      return v === '1' || v === '0' ? v : null;
    } catch (e) { return null; }
  }

  /**
   * Applique la décision pour le chargement en cours : lit les trois sources,
   * persiste un éventuel choix d'URL, et purge le marqueur de boot consommé.
   * @returns {{modular: boolean, reason: string}}
   */
  function resolveModularFrontend() {
    var param = urlParam();
    var d = decideModularFrontend({
      param: param,
      cached: lsGet(LS_MODULAR),
      bootPending: lsGet(LS_BOOT_PENDING),
    });
    // Un choix explicite d'URL devient le choix persistant : sans ça,
    // `?modular=1` serait perdu à la première navigation interne.
    if (param) lsSet(LS_MODULAR, param);
    else if (d.persist) lsSet(LS_MODULAR, d.persist);
    if (d.clearBootPending) lsDel(LS_BOOT_PENDING);
    return { modular: d.modular, reason: d.reason };
  }

  /** Marque un boot modulaire comme non confirmé (avant chargement du bundle). */
  function markBootPending() { lsSet(LS_BOOT_PENDING, String(Date.now())); }

  /** Confirme que l'interface s'est rendue : le boot n'est plus suspect. */
  function markBootOk() { lsDel(LS_BOOT_PENDING); }

  /**
   * Relit les drapeaux depuis Firestore et met le cache à jour pour le PROCHAIN
   * chargement. Ne change rien à la page courante — la bascule ne doit jamais
   * se produire sous les pieds de l'utilisateur.
   *
   * La lecture exige une session authentifiée (cf. firestore.rules,
   * `app_settings` : `allow read: if request.auth != null`), donc cet appel n'a
   * de sens qu'après connexion. Toute erreur est avalée : ne pas joindre
   * Firestore doit laisser l'application intacte, pas la casser.
   *
   * @param {any} firestore instance `firebase.firestore()`
   * @returns {Promise<boolean|null>} la valeur lue, ou null si indisponible
   */
  function refresh(firestore) {
    if (!firestore || typeof firestore.collection !== 'function') {
      return Promise.resolve(null);
    }
    return firestore.collection(FLAGS_COLLECTION).doc(FLAGS_DOC).get()
      .then(function (snap) {
        if (!snap || !snap.exists) return null;
        var data = snap.data() || {};
        if (typeof data.MODULAR_FRONTEND !== 'boolean') return null;
        lsSet(LS_MODULAR, data.MODULAR_FRONTEND ? '1' : '0');
        return data.MODULAR_FRONTEND;
      })
      .catch(function () { return null; });
  }

  var __featureFlagsApi = {
    decideModularFrontend: decideModularFrontend,
    resolveModularFrontend: resolveModularFrontend,
    markBootPending: markBootPending,
    markBootOk: markBootOk,
    refresh: refresh,
    LS_MODULAR: LS_MODULAR,
    LS_BOOT_PENDING: LS_BOOT_PENDING,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __featureFlagsApi;
  if (typeof window !== 'undefined') window.FeatureFlags = __featureFlagsApi;
})();
