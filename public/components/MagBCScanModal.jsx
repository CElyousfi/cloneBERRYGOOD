/*
 * MagBCScanModal.jsx — Modale « Scanner des bons de consommation » du tab
 * magasinier. Dépôt multi-photos → analyse IA (POST /api/stock?action=scan-bc)
 * → revue bon par bon (navigation réelle ‹ ›) → enregistrement d'un vrai BC
 * via l'action create-bc existante, un bon à la fois.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. crashes #75/#77 — mémoire umd-global-collision-smoke-load).
 * UN SEUL global exposé : window.MagBCScanModal
 *
 * Dépendances lues sur window :
 *   - window.ImageDownscale (public/lib/imageDownscale.js) — compression avant
 *     envoi. Absent → on tombe sur un FileReader brut (dégradé, pas bloquant).
 * AUCUN référentiel n'est rechargé ici : tout vient des props du parent
 * (MagBCTab), qui les a déjà chargés.
 *
 * Props :
 *   - type              : '' | 'engrais' | 'pesticide'
 *   - catalogueArticles : [{ id, nom, unite }]
 *   - getStock          : (article) => number
 *   - catalogUnit       : (article) => string|null
 *   - refForCampagne    : [{ label, ref, culture, ferme }] (sélecteur conso)
 *   - parcelles         : [{ Parcelle_Physique, Culture, Ferme }]
 *   - parcelleGroupes   : [{ id, label, membres: [{ label, ha }] }]
 *   - parcelleNom       : (label) => string
 *   - parcelleCulture   : (label, fallback) => string
 *   - metaForParcelle   : (label) => { culture, ferme }
 *   - useConsoSelector  : bool — même bascule de select que la saisie manuelle
 *   - MAGASINS, STATIONS: string[]
 *   - currentProfile, profileData
 *   - onClose()         : fermeture (bouton ✕ uniquement, jamais au clic fond)
 *   - onCreated()       : au moins un bon a été créé → le parent recharge
 */
(function () {
  'use strict';

  var _r = window.React;
  if (!_r) return;
  var React = _r;
  var useState = _r.useState;
  var useEffect = _r.useEffect;
  var useRef = _r.useRef;

  var BCSCAN_UNITES = ['kg', 'L', 'unité', 'carton', 'sac', 'bidon'];
  var BCSCAN_ORANGE = '#e65100';

  // ---- Analyse IA : parallélisme et reprise --------------------------------
  // L'analyse d'UN bon coûte ~7 s côté modèle (claude-opus-5, mesuré sur les
  // photos réelles). En file strictement séquentielle, un lot de 5 bons prenait
  // ~35 s. Le seul levier côté client est la concurrence : 3 analyses en vol
  // ramènent le même lot à ~14 s.
  // Pourquoi 3 et pas plus : au-delà, le compte déclenche des 429 (limite de
  // débit du fournisseur) plus vite qu'on ne gagne de temps, et chaque image
  // envoyée est déjà lourde (~2000 px de côté). 3 est le compromis mesuré.
  var BCSCAN_MAX_PARALLEL = 3;
  // Nombre TOTAL de tentatives par image (1 essai + 2 reprises).
  var BCSCAN_MAX_ATTEMPTS = 3;
  // Attente avant reprise : 1 s, puis 2 s (doublement), + un aléa pour éviter
  // que les 3 requêtes en vol rejouent exactement en même temps.
  var BCSCAN_RETRY_BASE_MS = 1000;
  var BCSCAN_RETRY_JITTER_MS = 400;
  // Plafond de respect d'un `retry-after` serveur : au-delà, on préfère rendre
  // la main au magasinier (vignette en erreur + bouton « Réessayer »).
  var BCSCAN_RETRY_MAX_MS = 30000;

  /**
   * Codes HTTP considérés comme TRANSITOIRES (méritent une reprise). Tout le
   * reste est un refus DÉFINITIF : le réessayer ne ferait que perdre du temps.
   *
   * Les refus métier de scan-bc arrivent avec leur PROPRE code, pas en 200 :
   * 400 pour un PDF / une image trop lourde / un scan_base64 manquant, 403
   * pour un rôle non autorisé (cf. functions/index.js, action scan-bc). Ils
   * portent tous un corps `{success:false, error}` dont le message est affiché
   * tel quel sur la vignette. La classification se fait donc bien par STATUT —
   * ni 400 ni 403 n'est dans la liste transitoire — et le corps `success:false`
   * n'est qu'un second filet pour un refus qui remonterait en 200.
   */
  function bcscanIsTransientStatus(status) {
    return status === 408 || status === 429 || (status >= 500 && status < 600);
  }

  /** Erreur transitoire, reconnaissable par la boucle de reprise. */
  function bcscanTransient(message, retryAfterMs) {
    var e = new Error(message);
    e.bcscanTransient = true;
    e.bcscanRetryAfterMs = retryAfterMs || 0;
    return e;
  }

  /** Lit l'en-tête `retry-after` (secondes ou date HTTP). 0 si absent/illisible. */
  function bcscanRetryAfterMs(resp) {
    var h = null;
    try {
      if (resp && resp.headers && typeof resp.headers.get === 'function') h = resp.headers.get('retry-after');
    } catch (e) { h = null; }
    if (!h) return 0;
    var secs = parseFloat(h);
    if (secs > 0) return Math.min(secs * 1000, BCSCAN_RETRY_MAX_MS);
    var at = Date.parse(h);
    if (at) {
      var delta = at - Date.now();
      return delta > 0 ? Math.min(delta, BCSCAN_RETRY_MAX_MS) : 0;
    }
    return 0;
  }

  function MagBCScanModal({
    type, catalogueArticles, getStock, catalogUnit, refForCampagne, parcelles,
    parcelleGroupes, parcelleNom, parcelleCulture, metaForParcelle,
    useConsoSelector, MAGASINS, STATIONS, currentProfile, profileData,
    onClose, onCreated,
  }) {
    const articles = catalogueArticles || [];
    const groupes = parcelleGroupes || [];
    const refParcelles = refForCampagne || [];
    const allParcelles = parcelles || [];
    const magasins = (MAGASINS && MAGASINS.length) ? MAGASINS : ['F1'];
    const stations = (STATIONS && STATIONS.length) ? STATIONS : ['Station F1'];
    const nomOf = parcelleNom || ((l) => l || '');
    const cultureOf = parcelleCulture || ((l, fb) => fb || '');
    const metaOf = metaForParcelle || (() => ({ culture: '', ferme: '' }));
    const stockOf = getStock || (() => 0);
    const unitOf = catalogUnit || (() => null);

    const today = new Date().toISOString().split('T')[0];
    const [lotLieu, setLotLieu] = useState({ type: 'magasin', id: magasins[0] });
    const [queue, setQueue] = useState([]);
    const [currentIdx, setCurrentIdx] = useState(0);
    const [processing, setProcessing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [createdCount, setCreatedCount] = useState(0);
    // Progression du lot en cours d'analyse — sans elle, la concurrence est
    // invisible et l'attente paraît identique au mode séquentiel.
    // NOTE : ce useState est volontairement le DERNIER (les tests unitaires
    // adressent les états par index positionnel).
    const [analyse, setAnalyse] = useState({ done: 0, total: 0 });

    // Miroir de la file lisible depuis la boucle d'analyse asynchrone : l'état
    // React n'y serait visible qu'au rendu suivant.
    const queueRef = useRef(queue);
    queueRef.current = queue;
    const processingRef = useRef(false);
    const lotLieuRef = useRef(lotLieu);
    lotLieuRef.current = lotLieu;

    // ---- Référentiels : helpers de résolution -------------------------------
    const knownArticle = (nom) => {
      const v = (nom || '').trim().toLowerCase();
      return !!v && articles.some(a => (a.nom || '').trim().toLowerCase() === v);
    };
    // Une parcelle n'est « connue » que si le <select> la propose RÉELLEMENT
    // dans le mode courant. En mode conso (magasinier), le select ne liste que
    // refForCampagne : accepter en plus `parcelles` laisserait passer une
    // parcelle hors campagne courante — garde-fou satisfait alors que le select
    // s'affiche VIDE (valeur invisible et non révisable). Même règle que pour
    // les articles hors catalogue : hors liste affichable = non résolu.
    // Options du select, sous forme d'objets : le nom affiché (nom_sb) et la
    // culture aident le rapprochement à départager les variétés.
    const selectableParcelleRefs = () => (useConsoSelector
      ? refParcelles.map(p => ({ label: p.label, nom: nomOf(p.label), culture: p.culture || '' }))
      : allParcelles.map(p => ({ label: p.Parcelle_Physique, nom: nomOf(p.Parcelle_Physique), culture: p.Culture || '' })));
    const selectableParcelles = () => selectableParcelleRefs().map(o => o.label);
    const knownParcelle = (label) => {
      const v = (label || '').trim();
      if (!v) return false;
      return selectableParcelles().some(l => l === v);
    };
    // Valeur unique parmi les membres d'un groupe, sinon '' (même prudence que
    // la saisie manuelle : un groupe à cheval sur 2 cultures ne se devine pas).
    const uniqueMemberMeta = (groupe, field) => {
      const vals = [...new Set((groupe.membres || []).map(m => metaOf(m.label)[field]).filter(Boolean))];
      return vals.length === 1 ? vals[0] : '';
    };
    // Reproduit selectParcelleForItem de MagBCTab : pose parcelle, parcelle_ref,
    // culture, ferme, groupe_id.
    const resolveParcelle = (val) => {
      if (!val) return { parcelle: '', parcelle_ref: '', culture: '', ferme: '', groupe_id: '' };
      if (String(val).startsWith('GRP::')) {
        const g = groupes.find(x => x.id === String(val).slice(5));
        return {
          parcelle: g ? g.label : '', parcelle_ref: '', groupe_id: g ? g.id : '',
          culture: g ? uniqueMemberMeta(g, 'culture') : '', ferme: g ? uniqueMemberMeta(g, 'ferme') : '',
        };
      }
      const ref = refParcelles.find(p => p.label === val);
      if (ref) return { parcelle: val, parcelle_ref: ref.ref || '', culture: cultureOf(val, ref.culture), ferme: ref.ferme || '', groupe_id: '' };
      const parc = allParcelles.find(p => p.Parcelle_Physique === val);
      return { parcelle: val, parcelle_ref: '', culture: cultureOf(val, parc && parc.Culture), ferme: (parc && parc.Ferme) || '', groupe_id: '' };
    };

    // ---- Construction d'un bon à partir de la réponse scan-bc ---------------
    const isIsoDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
    const buildFromResponse = (json, prevHeader) => {
      const a = json.analysis || {};
      const header = {
        ...prevHeader,
        date: isIsoDate(a.date) ? a.date : (prevHeader.date || today),
        ref_bon_physique: a.numero_bon || '',
        motif: a.motif || '',
        remarques: a.remarques || '',
      };
      // Le rapprochement PARCELLE est fait ICI, contre les options réellement
      // proposées par le select (le serveur, qui matche contre
      // sb_parcelle_referentiel, ne peut pas savoir laquelle est affichée et ne
      // produisait que des propositions non sélectionnables). Les champs
      // `parcelle` / `parcelle_status` de la réponse sont donc ignorés.
      const options = selectableParcelleRefs();
      const matcher = window.BcScanMatch;
      const items = (json.items || []).map(raw => {
        const proposedArticle = knownArticle(raw.article) ? raw.article : '';
        // Lib absente → aucune proposition, jamais de crash.
        const match = matcher ? matcher.matchParcelle(raw.parcelle_lue, options) : null;
        // Règle produit n°1 : même proposée par le matcher, une parcelle doit
        // être dans la liste sélectionnable pour être posée.
        const parcelleVal = (match && match.label && knownParcelle(match.label)) ? match.label : '';
        const parcelleStatus = parcelleVal ? (match.status || 'probable') : 'unmatched';
        const candidats = ((match && match.candidats) || []).filter(knownParcelle);
        const resolved = resolveParcelle(parcelleVal);
        const unite = (raw.unite || '').trim().toLowerCase() || unitOf(proposedArticle) || 'kg';
        return {
          article_lu: raw.article_lu || '',
          pile: raw.pile || '',
          article: proposedArticle,
          // Proposition initiale de l'IA : sert à détecter une correction
          // utilisateur (→ apprentissage d'alias après enregistrement).
          article_initial: proposedArticle,
          article_status: raw.article_status || (proposedArticle ? 'probable' : 'unmatched'),
          article_score: raw.article_score,
          // Additif côté backend : peut être absent, on ne bloque jamais dessus.
          article_alias_count: raw.article_alias_count,
          parcelle_lue: raw.parcelle_lue || '',
          parcelle_status: parcelleStatus,
          parcelle_candidats: candidats,
          quantite: raw.quantite != null ? String(raw.quantite) : '',
          unite,
          // Ligne jugée RAYÉE sur le papier par l'IA. Additif backend : absent →
          // false → la ligne se comporte exactement comme avant. Elle est
          // AFFICHÉE (grisée) et non enregistrée par défaut ; `reintegre` est le
          // choix explicite du magasinier de la reprendre.
          barre: raw.barre === true,
          reintegre: false,
          ...resolved,
        };
      });
      return { header, items: items.length ? items : [emptyLine()] };
    };

    const emptyLine = () => ({
      article_lu: '', pile: '', article: '', article_initial: '', article_status: 'unmatched', article_alias_count: undefined,
      parcelle_lue: '', parcelle_status: 'unmatched', parcelle_candidats: [],
      quantite: '', unite: 'kg', parcelle: '', parcelle_ref: '', culture: '', ferme: '', groupe_id: '',
      barre: false, reintegre: false,
    });

    /**
     * Une ligne barrée non réintégrée est VISIBLE mais hors du bon : elle n'est
     * ni enregistrée, ni soumise au garde-fou (elle ne doit pas bloquer le
     * bouton). Réintégrée, elle redevient une ligne comme les autres.
     */
    const ligneExclue = (it) => !!it.barre && !it.reintegre;

    // ---- Dépôt de fichiers ---------------------------------------------------
    const handleFiles = (files) => {
      const valid = Array.from(files || []).filter(f => f.type && f.type.startsWith('image/'));
      if (!valid.length) { alert('Veuillez déposer des images (JPG, PNG)'); return; }
      const base = Date.now();
      const entries = valid.map((f, i) => ({
        id: 'bcscan_' + base + '_' + i,
        file: f,
        preview: URL.createObjectURL(f),
        status: 'pending',
        scan_url: '',
        error: '',
        header: {
          date: today, ref_bon_physique: '', motif: '', remarques: '',
          lieu_source_type: lotLieuRef.current.type, lieu_source_id: lotLieuRef.current.id,
        },
        items: [],
      }));
      setQueue(prev => prev.concat(entries));
    };

    // ---- Analyse concurrente (plafond BCSCAN_MAX_PARALLEL) -------------------
    // Jusqu'à 3 images en vol simultanément, jamais plus. Chaque « worker » tire
    // la prochaine image `pending` de la file et la RÉSERVE de façon synchrone
    // (mutation de queueRef AVANT le premier await) : deux workers ne peuvent
    // pas prendre la même photo.
    //
    // INVARIANT CRITIQUE (le piège de la parallélisation) : toutes les mises à
    // jour passent par setQueue(prev => …) et ciblent l'entrée par son `id`.
    // Jamais de réécriture d'une copie figée de la file — sinon un worker qui
    // termine écraserait les corrections saisies par le magasinier sur un autre
    // bon, ou le résultat d'un worker plus rapide.
    // L'ORDRE d'affichage reste celui du dépôt : on ne réordonne jamais la
    // file, seul le contenu de chaque entrée est patché sur place.
    const toBase64 = (file) => (window.ImageDownscale
      ? window.ImageDownscale.downscaleToDataUrl(file, { maxSide: 2000, quality: 0.8 })
      : new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = (e) => resolve(e.target.result);
        rd.onerror = reject;
        rd.readAsDataURL(file);
      }));

    /** Un aller-retour réseau. Lève une erreur marquée transitoire ou non. */
    const scanOnce = async (base64, filename) => {
      let resp;
      try {
        resp = await fetch('/api/stock?action=scan-bc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scan_base64: base64, filename, type: type || 'engrais' }),
        });
      } catch (netErr) {
        // Coupure réseau / timeout : transitoire par nature.
        throw bcscanTransient((netErr && netErr.message) || 'Erreur réseau', 0);
      }
      const status = (resp && typeof resp.status === 'number') ? resp.status : 200;
      if (bcscanIsTransientStatus(status)) {
        throw bcscanTransient(
          status === 429 ? 'Service saturé (429) — reprise automatique' : 'Erreur serveur (' + status + ')',
          bcscanRetryAfterMs(resp),
        );
      }
      let json = null;
      try { json = await resp.json(); } catch (e) { json = null; }
      // Réponse illisible (proxy, coupure en cours de corps) : transitoire.
      if (!json) throw bcscanTransient('Réponse illisible du serveur', 0);
      // Refus explicite du backend ({success:false, error}) : DÉFINITIF, on ne
      // réessaie pas — un PDF restera un PDF au 3e essai.
      if (!json.success) throw new Error(json.error || 'Analyse impossible');
      return json;
    };

    /** scanOnce + reprises à attente croissante sur erreur transitoire. */
    const scanWithRetry = async (base64, filename) => {
      let attempt = 0;
      for (;;) {
        try {
          return await scanOnce(base64, filename);
        } catch (e) {
          attempt += 1;
          if (!e || !e.bcscanTransient || attempt >= BCSCAN_MAX_ATTEMPTS) throw e;
          const backoff = BCSCAN_RETRY_BASE_MS * Math.pow(2, attempt - 1);
          const jitter = Math.floor(Math.random() * BCSCAN_RETRY_JITTER_MS);
          const wait = Math.max(e.bcscanRetryAfterMs || 0, backoff) + jitter;
          await new Promise(r => setTimeout(r, wait));
        }
      }
    };

    useEffect(() => {
      if (processingRef.current) return;
      if (!queue.some(q => q.status === 'pending')) return;
      processingRef.current = true;
      setProcessing(true);

      // Décompte du lot tenu ENTIÈREMENT dans cette closure, jamais relu depuis
      // queueRef : ce miroir n'est resynchronisé qu'au rendu, donc le lire ici
      // ferait dépendre un compteur affiché de l'ordonnancement de React (et
      // deviendrait faux le jour où l'app passera en createRoot, qui batche les
      // setState issus d'une continuation de promesse).
      // - `total` est FIGÉ au démarrage sur le nombre de photos en attente ;
      // - il ne monte que si des photos ajoutées en cours de lot sont
      //   réellement réservées par un worker (`claimed`), jamais autrement.
      const lot = { done: 0, total: queue.filter(q => q.status === 'pending').length, claimed: new Set() };
      setAnalyse({ done: 0, total: lot.total });
      const claim = (id) => { lot.claimed.add(id); };
      const bumpProgress = () => {
        lot.done += 1;
        setAnalyse({ done: lot.done, total: Math.max(lot.total, lot.claimed.size) });
      };

      const runOne = async (item) => {
        const id = item.id;
        try {
          const base64 = await toBase64(item.file);
          const json = await scanWithRetry(base64, item.file.name);
          setQueue(prev => prev.map(q => {
            if (q.id !== id) return q;
            const built = buildFromResponse(json, q.header);
            return { ...q, status: 'done', scan_url: json.scan_url || '', error: '', header: built.header, items: built.items };
          }));
        } catch (e) {
          // Jamais de plantage silencieux : la vignette porte le message et le
          // bouton « Réessayer » remet l'entrée en `pending`.
          const msg = (e && e.message) || 'Erreur réseau';
          setQueue(prev => prev.map(q => (q.id === id ? { ...q, status: 'error', error: msg } : q)));
        }
      };

      const worker = async () => {
        for (;;) {
          const next = queueRef.current.find(q => q.status === 'pending');
          if (!next) break;
          const id = next.id;
          const markProcessing = (q) => (q.id === id ? { ...q, status: 'processing' } : q);
          // Réservation SYNCHRONE : aucun await entre le find et cette ligne.
          queueRef.current = queueRef.current.map(markProcessing);
          claim(id);
          setQueue(prev => prev.map(markProcessing));
          await runOne(next);
          bumpProgress();
        }
      };

      (async () => {
        const workers = [];
        for (let i = 0; i < BCSCAN_MAX_PARALLEL; i++) workers.push(worker());
        // Une image en erreur ne doit pas emporter le lot : runOne ne rejette
        // jamais, mais on reste défensif.
        await Promise.all(workers.map(p => p.catch(() => {})));
        processingRef.current = false;
        setProcessing(false);
        setAnalyse({ done: 0, total: 0 });
        // Un fichier déposé pendant le dernier await ne doit pas rester bloqué.
        if (queueRef.current.some(q => q.status === 'pending')) setQueue(prev => prev.slice());
      })();
    }, [queue]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---- Édition -------------------------------------------------------------
    const current = queue[currentIdx] || null;
    const readOnly = !!current && current.status === 'saved';

    const patchCurrent = (patch) => {
      if (!current || readOnly) return;
      const id = current.id;
      setQueue(prev => prev.map(q => (q.id === id ? { ...q, ...patch } : q)));
    };
    const patchHeader = (field, value) => {
      if (!current || readOnly) return;
      const id = current.id;
      setQueue(prev => prev.map(q => (q.id === id ? { ...q, header: { ...q.header, [field]: value } } : q)));
    };
    const patchItem = (idx, patch) => {
      if (!current || readOnly) return;
      const id = current.id;
      setQueue(prev => prev.map(q => {
        if (q.id !== id) return q;
        const items = q.items.slice();
        items[idx] = { ...items[idx], ...patch };
        return { ...q, items };
      }));
    };
    const addLine = () => {
      if (!current || readOnly) return;
      const id = current.id;
      setQueue(prev => prev.map(q => (q.id === id ? { ...q, items: q.items.concat([emptyLine()]) } : q)));
    };
    const removeLine = (idx) => {
      if (!current || readOnly) return;
      const id = current.id;
      setQueue(prev => prev.map(q => (q.id === id ? { ...q, items: q.items.filter((_, i) => i !== idx) } : q)));
    };
    const changeArticle = (idx, val) => {
      const u = unitOf(val);
      patchItem(idx, u ? { article: val, unite: u } : { article: val });
    };
    const changeParcelle = (idx, val) => patchItem(idx, resolveParcelle(val));

    // Lieu de départ du lot : appliqué à tous les bons non encore enregistrés.
    const changeLotLieu = (nextLieu) => {
      setLotLieu(nextLieu);
      setQueue(prev => prev.map(q => (q.status === 'saved'
        ? q
        : { ...q, header: { ...q.header, lieu_source_type: nextLieu.type, lieu_source_id: nextLieu.id } })));
    };

    // ---- Garde-fou d'enregistrement -----------------------------------------
    // Une ligne « active » = l'IA a lu quelque chose ou l'utilisateur a saisi
    // quelque chose. Aucune parcelle en texte libre n'est acceptée.
    // Une ligne barrée non réintégrée est hors bon : elle ne compte pas.
    const isActiveLine = (it) => !ligneExclue(it) && !!((it.article_lu || '').trim() || (it.article || '').trim()
      || String(it.quantite || '').trim() || (it.parcelle || '').trim());
    const activeLines = current ? current.items.filter(isActiveLine) : [];
    const missingArticle = activeLines.filter(it => !knownArticle(it.article)).length;
    const missingParcelle = activeLines.filter(it => !it.groupe_id && !knownParcelle(it.parcelle)).length;
    const missingQte = activeLines.filter(it => !(parseFloat(it.quantite) > 0)).length;
    const blockers = [];
    if (!activeLines.length) blockers.push('aucune ligne à enregistrer');
    if (missingArticle) blockers.push(missingArticle + ' ligne' + (missingArticle > 1 ? 's' : '') + ' sans article du catalogue');
    if (missingParcelle) blockers.push(missingParcelle + ' ligne' + (missingParcelle > 1 ? 's' : '') + ' sans parcelle');
    if (missingQte) blockers.push(missingQte + ' ligne' + (missingQte > 1 ? 's' : '') + ' sans quantité');
    const canSave = !!current && current.status === 'done' && blockers.length === 0 && !saving;

    // ---- Enregistrement ------------------------------------------------------
    const saveAlias = (libelleLu, articleNom) => fetch('/api/stock?action=save-bc-scan-alias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        libelle_lu: libelleLu,
        article_nom: articleNom,
        created_by: { profileId: currentProfile, name: (profileData && profileData.name) || currentProfile },
      }),
    }).catch(() => {});

    const gotoNextUnsaved = (savedId) => {
      const list = queueRef.current;
      const after = list.findIndex((q, i) => i > currentIdx && q.status !== 'saved' && q.id !== savedId);
      if (after >= 0) { setCurrentIdx(after); return; }
      const any = list.findIndex(q => q.status !== 'saved' && q.id !== savedId);
      if (any >= 0) setCurrentIdx(any);
    };

    const handleSave = async () => {
      if (!canSave || !current) return;
      const entry = current;
      const validItems = entry.items.filter(it => !ligneExclue(it) && it.article && parseFloat(it.quantite) > 0);
      for (const it of validItems) {
        const dispo = stockOf(it.article);
        if (parseFloat(it.quantite) > dispo) {
          if (!confirm('Stock insuffisant pour ' + it.article + ' (dispo: ' + dispo + '). Continuer quand meme ?')) return;
        }
      }
      setSaving(true);
      try {
        const by = { profileId: currentProfile, name: (profileData && profileData.name) || currentProfile };
        const resp = await fetch('/api/stock?action=create-bc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: type || 'engrais',
            date: entry.header.date,
            lieu_source: { type: entry.header.lieu_source_type, id: entry.header.lieu_source_id },
            items: validItems.map(i => ({
              article: i.article, quantite: i.quantite, unite: i.unite, parcelle: i.parcelle,
              parcelle_ref: i.parcelle_ref || '', culture: i.culture, ferme: i.ferme, groupe_id: i.groupe_id || '',
            })),
            scan_url: entry.scan_url || null,
            ref_bon_physique: entry.header.ref_bon_physique || '',
            // Motif lu sur le bon papier : champ OPTIONNEL côté create-bc
            // (chaîne vide acceptée), persisté depuis l'arbitrage de l'architecte.
            motif: entry.header.motif || '',
            authorized_by: by,
            created_by: by,
          }),
        });
        const json = await resp.json();
        if (!json || !json.success) { alert('Erreur: ' + ((json && json.error) || 'Echec')); setSaving(false); return; }
        // Apprentissage des alias : best effort, ne bloque jamais.
        validItems
          .filter(i => (i.article_lu || '').trim() && i.article && i.article !== i.article_initial)
          .forEach(i => { saveAlias(i.article_lu, i.article); });
        const savedId = entry.id;
        setQueue(prev => prev.map(q => (q.id === savedId ? { ...q, status: 'saved', numero: json.numero || '' } : q)));
        const nbSaved = createdCount + 1;
        setCreatedCount(nbSaved);
        const remaining = queueRef.current.filter(q => q.id !== savedId && q.status !== 'saved').length;
        if (remaining === 0) { if (onCreated) onCreated(); } else { gotoNextUnsaved(savedId); }
      } catch (e) {
        alert('Erreur reseau');
      }
      setSaving(false);
    };

    // ---- Fermeture (bouton ✕ uniquement) ------------------------------------
    const handleClose = () => {
      if (processing) { if (!confirm('Une analyse est en cours. Fermer quand même ?')) return; }
      const pendingCount = queue.filter(q => q.status !== 'saved').length;
      if (pendingCount > 0 && queue.length > 0) {
        if (!confirm(pendingCount + ' bon(s) non enregistré(s) seront perdus. Fermer ?')) return;
      }
      // Les aperçus sont des blob: — non révoqués, ils retiennent chaque photo
      // du lot en mémoire jusqu'au rechargement de la page.
      queue.forEach(q => { try { URL.revokeObjectURL(q.preview); } catch (e) {} });
      if (createdCount > 0 && onCreated) onCreated();
      if (onClose) onClose();
    };

    const zoom = (src) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:10002;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px;';
      overlay.onclick = () => overlay.remove();
      const img = document.createElement('img');
      img.src = src;
      img.style.cssText = 'max-width:95vw;max-height:95vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);';
      overlay.appendChild(img);
      document.body.appendChild(overlay);
    };

    // ---- Rendu ---------------------------------------------------------------
    const fStyle = { width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 };
    const labelStyle = { fontSize: 10, color: '#888', fontWeight: 600, marginBottom: 2 };
    const allSaved = queue.length > 0 && queue.every(q => q.status === 'saved');

    // Un ALIAS n'a PAS le même niveau de confiance qu'un match exact du
    // catalogue : il peut venir d'UNE seule mauvaise sélection du magasinier
    // (ligne du dessus/dessous dans le select), et il n'existe aucun écran de
    // revue des alias. Il s'affiche donc en orange « mémorisé — à vérifier »,
    // jamais en vert « Reconnu ». `aliasCount` (article_alias_count, additif
    // côté backend) est purement informatif : absent → on n'affiche rien.
    const statusDot = (status, aliasCount) => {
      if (status === 'exact') return <span title="Reconnu au référentiel" style={{ color: '#2e7d32', marginLeft: 4 }}>✅</span>;
      if (status === 'alias') {
        const n = Number(aliasCount);
        const suffixe = n > 0 ? ' (mémorisé ' + n + ' fois)' : '';
        return <span title={'Correction mémorisée lors d\'un scan précédent — vérifiez que l\'article est le bon' + suffixe}
          style={{ color: '#e65100', marginLeft: 4, fontSize: 10, fontWeight: 700 }}>⚠️ mémorisé — à vérifier</span>;
      }
      if (status === 'probable') return <span title="À vérifier" style={{ color: '#e65100', marginLeft: 4 }}>⚠️</span>;
      return <span title="À choisir" style={{ color: '#dc2626', marginLeft: 4, fontSize: 10, fontWeight: 700 }}>❌ à choisir</span>;
    };

    return (
      <div className="modal-overlay" style={{ zIndex: 9999 }}>
        {/* Pas de fermeture au clic sur le fond : un clic hors de la fenêtre
            perdrait tout le lot en cours de revue (cf. caa39fe / b5d2ff1). */}
        <div className="modal-content" style={{ maxWidth: 1100, width: '96vw', maxHeight: '92vh', overflow: 'auto', padding: 0, borderRadius: 16 }}>
          <div style={{ background: 'linear-gradient(135deg, #bf360c 0%, ' + BCSCAN_ORANGE + ' 100%)', padding: '20px 24px', color: '#fff', borderRadius: '16px 16px 0 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}><i className="fa-solid fa-camera" style={{ marginRight: 8 }}></i>Scanner des Bons de Consommation</div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>Déposez les photos des bons papier — l'IA extrait les lignes, vous corrigez et enregistrez bon par bon</div>
              </div>
              <button onClick={handleClose} title="Fermer" style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: 16 }}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            {/* En-tête de lot : lieu de départ commun */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16, padding: '12px 14px', background: '#fafafa', borderRadius: 10, border: '1px solid #eee' }}>
              <div>
                <div style={labelStyle}>Lieu de départ du lot *</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={lotLieu.type} onChange={e => changeLotLieu({ type: e.target.value, id: e.target.value === 'magasin' ? magasins[0] : stations[0] })} style={{ ...fStyle, width: 'auto' }}>
                    <option value="magasin">Magasin</option><option value="station">Station</option>
                  </select>
                  <select value={lotLieu.id} onChange={e => changeLotLieu({ type: lotLieu.type, id: e.target.value })} style={{ ...fStyle, width: 'auto' }}>
                    {(lotLieu.type === 'magasin' ? magasins : stations).map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#888', flex: 1, minWidth: 200 }}>
                Appliqué à tous les bons du lot — modifiable ensuite bon par bon.
              </div>
              {queue.length > 0 && (
                <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*'; inp.onchange = (e) => handleFiles(e.target.files); inp.click(); }}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid ' + BCSCAN_ORANGE, background: '#fff', color: BCSCAN_ORANGE, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                  <i className="fa-solid fa-plus" style={{ marginRight: 6 }}></i>Ajouter des photos
                </button>
              )}
            </div>

            {/* Zone de dépôt */}
            {queue.length === 0 && (
              <div
                onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*'; inp.onchange = (e) => handleFiles(e.target.files); inp.click(); }}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = BCSCAN_ORANGE; e.currentTarget.style.background = 'rgba(230,81,0,0.06)'; }}
                onDragLeave={(e) => { e.currentTarget.style.borderColor = '#ffccbc'; e.currentTarget.style.background = '#fff8f5'; }}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#ffccbc'; e.currentTarget.style.background = '#fff8f5'; handleFiles(e.dataTransfer.files); }}
                style={{ border: '2.5px dashed #ffccbc', borderRadius: 14, padding: '36px 24px', textAlign: 'center', cursor: 'pointer', background: '#fff8f5' }}
              >
                <i className="fa-solid fa-images" style={{ fontSize: 40, color: '#ff8a65', marginBottom: 12 }}></i>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#bf360c', marginBottom: 4 }}>Glissez vos photos de bons ici</div>
                <div style={{ fontSize: 13, color: '#888' }}>ou <span style={{ color: BCSCAN_ORANGE, fontWeight: 600, textDecoration: 'underline' }}>cliquez pour sélectionner</span> — plusieurs images à la fois</div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>JPG, PNG — les images sont réduites avant envoi</div>
              </div>
            )}

            {queue.length > 0 && (
              <div>
                {/* Bande de vignettes + navigation */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                  <button onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))} disabled={currentIdx <= 0}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: currentIdx <= 0 ? 'not-allowed' : 'pointer', fontSize: 12, opacity: currentIdx <= 0 ? 0.5 : 1 }}>‹ Précédent</button>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Bon {currentIdx + 1} / {queue.length}</span>
                  <button onClick={() => setCurrentIdx(Math.min(queue.length - 1, currentIdx + 1))} disabled={currentIdx >= queue.length - 1}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: currentIdx >= queue.length - 1 ? 'not-allowed' : 'pointer', fontSize: 12, opacity: currentIdx >= queue.length - 1 ? 0.5 : 1 }}>Suivant ›</button>
                  {processing && (
                    <span style={{ fontSize: 12, color: BCSCAN_ORANGE }}>
                      <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 4 }}></i>
                      {analyse.total > 0
                        ? 'Analyse ' + analyse.done + '/' + analyse.total + ' — jusqu\'à ' + BCSCAN_MAX_PARALLEL + ' en parallèle'
                        : 'Analyse en cours…'}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: '#888', marginLeft: 'auto' }}>{createdCount} bon(s) enregistré(s)</span>
                </div>

                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
                  {queue.map((q, i) => (
                    <div key={q.id} onClick={() => setCurrentIdx(i)} title={q.file.name}
                      style={{ position: 'relative', flex: '0 0 auto', cursor: 'pointer', border: (i === currentIdx ? '3px solid ' + BCSCAN_ORANGE : '2px solid #eee'), borderRadius: 8, padding: 2, background: '#fff' }}>
                      <img src={q.preview} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 5, display: 'block', opacity: q.status === 'saved' ? 0.55 : 1 }} />
                      <span style={{ position: 'absolute', bottom: 2, right: 2, fontSize: 11 }}>
                        {q.status === 'pending' && <span title="En attente" style={{ color: '#888' }}>⏳</span>}
                        {q.status === 'processing' && <i className="fa-solid fa-spinner fa-spin" style={{ color: BCSCAN_ORANGE }}></i>}
                        {q.status === 'done' && <span title="Analysé" style={{ color: '#2e7d32' }}>●</span>}
                        {q.status === 'saved' && <span title="Enregistré" style={{ color: '#2e7d32' }}>✅</span>}
                        {q.status === 'error' && <span title={q.error} style={{ color: '#dc2626' }}>❌</span>}
                      </span>
                    </div>
                  ))}
                </div>

                {allSaved && (
                  <div style={{ padding: '14px 16px', background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 10, marginBottom: 12, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>
                    <i className="fa-solid fa-circle-check" style={{ marginRight: 8 }}></i>
                    Lot terminé — {createdCount} bon(s) de consommation créé(s) :
                    {' ' + queue.map(q => q.numero).filter(Boolean).join(', ')}
                  </div>
                )}

                {/* Écran du bon courant */}
                {current && (
                  <div style={{ border: '2px solid ' + (current.status === 'saved' ? '#4caf50' : current.status === 'error' ? '#e57373' : '#e0e0e0'), borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ background: current.status === 'saved' ? '#e8f5e9' : '#fafafa', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>{current.file.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: current.status === 'saved' ? '#2e7d32' : current.status === 'error' ? '#dc2626' : '#888' }}>
                        {current.status === 'pending' && 'En attente d\'analyse'}
                        {current.status === 'processing' && 'Analyse…'}
                        {current.status === 'done' && 'Analysé — à vérifier'}
                        {current.status === 'saved' && ('Enregistré' + (current.numero ? ' — ' + current.numero : ''))}
                        {current.status === 'error' && ('Erreur : ' + (current.error || ''))}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
                      <div style={{ flex: '0 0 32%', minWidth: 220, background: '#f5f5f5', borderRight: '1px solid #e0e0e0', padding: 8, position: 'relative', cursor: 'zoom-in', textAlign: 'center' }}
                        onClick={() => zoom(current.preview)}>
                        <img src={current.preview} alt="" style={{ maxWidth: '100%', maxHeight: 380, objectFit: 'contain', borderRadius: 6 }} />
                        <div style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 11 }}>
                          <i className="fa-solid fa-expand" style={{ marginRight: 4 }}></i>Agrandir
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 320, padding: 14 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
                          <div><div style={labelStyle}>Date</div>
                            <input type="date" value={current.header.date || ''} disabled={readOnly} onChange={e => patchHeader('date', e.target.value)} style={fStyle} /></div>
                          <div><div style={labelStyle}>N° du bon papier</div>
                            <input value={current.header.ref_bon_physique || ''} disabled={readOnly} onChange={e => patchHeader('ref_bon_physique', e.target.value)} placeholder="N° lu sur le bon" style={fStyle} /></div>
                          <div><div style={labelStyle}>Motif</div>
                            <input value={current.header.motif || ''} disabled={readOnly} onChange={e => patchHeader('motif', e.target.value)} style={fStyle} /></div>
                          <div><div style={labelStyle}>Lieu de départ</div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <select value={current.header.lieu_source_type} disabled={readOnly} onChange={e => patchCurrent({ header: { ...current.header, lieu_source_type: e.target.value, lieu_source_id: e.target.value === 'magasin' ? magasins[0] : stations[0] } })} style={{ ...fStyle, width: 'auto', fontSize: 11 }}>
                                <option value="magasin">Magasin</option><option value="station">Station</option>
                              </select>
                              <select value={current.header.lieu_source_id} disabled={readOnly} onChange={e => patchHeader('lieu_source_id', e.target.value)} style={{ ...fStyle, flex: 1, fontSize: 11 }}>
                                {(current.header.lieu_source_type === 'magasin' ? magasins : stations).map(l => <option key={l} value={l}>{l}</option>)}
                              </select>
                            </div></div>
                        </div>
                        {current.header.remarques ? <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}><i className="fa-solid fa-note-sticky" style={{ marginRight: 4 }}></i>{current.header.remarques}</div> : null}

                        {current.status === 'processing' && <div style={{ padding: 24, textAlign: 'center', color: BCSCAN_ORANGE, fontSize: 13 }}><i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 6 }}></i>Lecture du bon par l'IA…</div>}
                        {current.status === 'pending' && <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 13 }}>En attente d'analyse…</div>}
                        {current.status === 'error' && (
                          <div style={{ padding: 16, textAlign: 'center' }}>
                            <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{current.error || 'Analyse impossible'}</div>
                            <button onClick={() => patchCurrent({ status: 'pending', error: '' })} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid ' + BCSCAN_ORANGE, background: '#fff', color: BCSCAN_ORANGE, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                              <i className="fa-solid fa-rotate-right" style={{ marginRight: 6 }}></i>Réessayer
                            </button>
                          </div>
                        )}

                        {(current.status === 'done' || current.status === 'saved') && (
                          <div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead><tr style={{ background: '#f8f8f8' }}>
                                <th style={{ padding: '6px 6px', textAlign: 'left' }}>Libellé lu</th>
                                <th style={{ padding: '6px 6px', textAlign: 'left', minWidth: 150 }}>Article *</th>
                                <th style={{ padding: '6px 6px', textAlign: 'left', minWidth: 140 }}>Parcelle dest. *</th>
                                <th style={{ padding: '6px 6px', width: 66 }}>Qté</th>
                                <th style={{ padding: '6px 6px', width: 74 }}>Unité</th>
                                <th style={{ padding: '6px 6px', width: 56 }}>Stock</th>
                                <th style={{ width: 26 }}></th>
                              </tr></thead>
                              <tbody>
                                {current.items.map((it, idx) => {
                                  const dispo = stockOf(it.article);
                                  const insuffisant = it.article && it.quantite && parseFloat(it.quantite) > dispo;
                                  const exclue = ligneExclue(it);
                                  const artUnknown = !exclue && !knownArticle(it.article);
                                  const parcUnknown = !exclue && !it.groupe_id && !knownParcelle(it.parcelle);
                                  return (
                                    <tr key={idx} style={{ borderBottom: '1px solid #f2f2f2', background: exclue ? '#fafafa' : undefined, opacity: exclue ? 0.6 : 1 }}>
                                      <td style={{ padding: '4px 6px', color: '#888', fontSize: 11, maxWidth: 150 }}>
                                        <div style={{ fontWeight: 600, textDecoration: exclue ? 'line-through' : 'none' }}>{it.article_lu || '—'}</div>
                                        {/* Une ligne rayée sur le papier n'est JAMAIS supprimée en silence :
                                            elle reste visible avec sa quantité lue, et le magasinier décide. */}
                                        {it.barre ? (
                                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#b45309', fontWeight: 700, marginTop: 2, cursor: readOnly ? 'default' : 'pointer' }}>
                                            <input type="checkbox" checked={!!it.reintegre} disabled={readOnly}
                                              onChange={e => patchItem(idx, { reintegre: e.target.checked })} style={{ margin: 0 }} />
                                            {it.reintegre ? 'barrée sur le papier — réintégrée' : 'barrée sur le papier — exclue'}
                                          </label>
                                        ) : null}
                                        {it.pile ? <div style={{ fontSize: 9, color: '#aaa' }}>pile : {it.pile}</div> : null}
                                        {it.parcelle_lue ? <div style={{ fontSize: 9, color: '#aaa' }}>parc. lue : {it.parcelle_lue}</div> : null}
                                      </td>
                                      <td style={{ padding: '4px 6px' }}>
                                        <select value={it.article} disabled={readOnly} onChange={e => changeArticle(idx, e.target.value)}
                                          style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: artUnknown ? '2px solid #dc2626' : '1px solid #ddd', fontSize: 11 }}>
                                          <option value="">-- Article --</option>
                                          {articles.map(a => <option key={a.id || a.nom} value={a.nom}>{a.nom}</option>)}
                                        </select>
                                        {/* Pas de pastille « à choisir » sur une ligne hors bon. */}
                                        <div style={{ fontSize: 10, marginTop: 2 }}>{exclue ? null : statusDot(artUnknown ? 'unmatched' : it.article_status, it.article_alias_count)}</div>
                                      </td>
                                      <td style={{ padding: '4px 6px' }}>
                                        <select value={it.groupe_id ? ('GRP::' + it.groupe_id) : it.parcelle} disabled={readOnly} onChange={e => changeParcelle(idx, e.target.value)}
                                          style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: parcUnknown ? '2px solid #dc2626' : '1px solid #ddd', fontSize: 11 }}>
                                          <option value="">-- Parcelle --</option>
                                          {/* Candidats du rapprochement serveur remontés EN TÊTE (cas
                                              « M.T.L S-13-14 » : 2 parcelles plausibles). Purement
                                              ergonomique — la liste complète reste dessous, et un
                                              candidat non sélectionnable n'est pas proposé. */}
                                          {(() => {
                                            const cands = (it.parcelle_candidats || [])
                                              .map(c => (typeof c === 'string' ? c : (c && (c.label || c.parcelle)) || ''))
                                              .filter(l => l && knownParcelle(l));
                                            const uniq = [...new Set(cands)];
                                            if (!uniq.length) return null;
                                            return (
                                              <optgroup label="Suggestions du scan">
                                                {uniq.map(l => <option key={'cand-' + l} value={l}>{nomOf(l)}</option>)}
                                              </optgroup>
                                            );
                                          })()}
                                          {groupes.length > 0 && (
                                            <optgroup label="Groupes">
                                              {groupes.map(g => <option key={'grp-' + g.id} value={'GRP::' + g.id}>{g.label} ({(g.membres || []).length} parcelles)</option>)}
                                            </optgroup>
                                          )}
                                          {useConsoSelector ? (
                                            <optgroup label="Mes parcelles">
                                              {refParcelles.map(p => <option key={'ref-' + p.label} value={p.label}>{nomOf(p.label)}</option>)}
                                            </optgroup>
                                          ) : (
                                            allParcelles.map(p => <option key={p.Parcelle_Physique} value={p.Parcelle_Physique}>{nomOf(p.Parcelle_Physique)} — {cultureOf(p.Parcelle_Physique, p.Culture) || '?'}</option>)
                                          )}
                                        </select>
                                        {it.ferme ? <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>{it.ferme} — {it.culture}</div> : null}
                                        <div style={{ fontSize: 10 }}>{exclue ? null : statusDot(parcUnknown ? 'unmatched' : it.parcelle_status)}</div>
                                      </td>
                                      <td style={{ padding: '4px 6px' }}>
                                        <input type="number" value={it.quantite} disabled={readOnly} onChange={e => patchItem(idx, { quantite: e.target.value })}
                                          style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: insuffisant ? '2px solid #e74c3c' : '1px solid #ddd', fontSize: 12 }} />
                                      </td>
                                      <td style={{ padding: '4px 6px' }}>
                                        <select value={it.unite} disabled={readOnly} onChange={e => patchItem(idx, { unite: e.target.value })} style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: '1px solid #ddd', fontSize: 11 }}>
                                          {[...new Set(BCSCAN_UNITES.concat(it.unite ? [it.unite] : []))].map(u => <option key={u} value={u}>{u}</option>)}
                                        </select>
                                      </td>
                                      <td style={{ padding: '4px 6px', textAlign: 'center', fontSize: 11, color: insuffisant ? '#e74c3c' : 'var(--green)', fontWeight: 600 }}>{it.article ? dispo : '—'}</td>
                                      <td style={{ padding: '4px 2px' }}>
                                        {!readOnly && <button onClick={() => removeLine(idx)} title="Supprimer la ligne" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c', fontSize: 12 }}><i className="fa-solid fa-trash"></i></button>}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {!readOnly && (
                              <button onClick={addLine} style={{ marginTop: 8, background: 'none', border: '1px dashed #ddd', borderRadius: 8, padding: '5px 14px', cursor: 'pointer', fontSize: 12, color: 'var(--blue)' }}>+ Ajouter une ligne</button>
                            )}

                            {(() => {
                              const nbExclues = current.items.filter(ligneExclue).length;
                              if (!nbExclues) return null;
                              return (
                                <div style={{ marginTop: 10, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11, color: '#b45309', fontWeight: 600 }}>
                                  <i className="fa-solid fa-eye-slash" style={{ marginRight: 6 }}></i>
                                  {nbExclues} ligne{nbExclues > 1 ? 's' : ''} barrée{nbExclues > 1 ? 's' : ''} sur le papier, non enregistrée{nbExclues > 1 ? 's' : ''} — cochez la case pour la reprendre.
                                </div>
                              );
                            })()}

                            {!readOnly && blockers.length > 0 && (
                              <div style={{ marginTop: 10, padding: '8px 12px', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 8, fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
                                <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }}></i>
                                Impossible d'enregistrer : {blockers.join(', ')}.
                              </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                              {readOnly ? (
                                <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 600 }}><i className="fa-solid fa-circle-check" style={{ marginRight: 6 }}></i>Bon enregistré{current.numero ? ' — ' + current.numero : ''}</span>
                              ) : (
                                <button onClick={handleSave} disabled={!canSave}
                                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: canSave ? 'var(--berry)' : '#bbb', color: '#fff', cursor: canSave ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 13 }}>
                                  <i className={saving ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-check'} style={{ marginRight: 6 }}></i>
                                  {saving ? 'Enregistrement…' : 'Enregistrer ce bon'}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  window.MagBCScanModal = MagBCScanModal;
})();
