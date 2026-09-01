/*
 * MagBCTab.jsx — Onglet magasinier "Bons de Consommation" (engrais / phyto /
 * tous) : liste filtrable + tri + export Excel, création d'un bon (articles,
 * parcelle ou groupe de parcelles, scan), création d'article au catalogue et
 * pop-up de détail d'un bon.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. crashes #75/#77 — mémoire umd-global-collision-smoke-load). Trois
 * globaux exposés, et rien d'autre :
 *   window.MagBCTab, window.MagBCEngraisTab, window.MagBCPhytoTab
 *
 * Extrait de public/app.jsx à comportement IDENTIQUE (règle de modularisation
 * progressive, CLAUDE.md). Dépendances qui étaient dans le scope d'app.jsx et
 * qui sont désormais lues sur window :
 *   - window.useStockLocations()  (public/lib/useStockLocations.js)
 *   - window.cachedFetch()        (défini dans app.jsx, exposé sur window)
 * Déjà globales avant l'extraction : window.CampagneUtils,
 * window.ParcelleGroupUtils, XLSX (CDN SheetJS), React (CDN).
 *
 * Props (MagBCTab) :
 *   - type          : '' | 'engrais' | 'pesticide'
 *   - label, icon   : surcharges d'affichage (déduites de type si absentes)
 *   - currentProfile: id du profil courant (string)
 *   - profileData   : objet profil (name, …)
 */
(function () {
  'use strict';

  var _r = window.React;
  if (!_r) return;
  var React = _r;
  var useState = _r.useState;
  var useEffect = _r.useEffect;

  // ===================== MAGASINIER: BONS CONSOMMATION ENGRAIS TAB =====================
  function MagBCEngraisTab({
    currentProfile,
    profileData
  }) {
    return /*#__PURE__*/React.createElement(MagBCTab, {
      type: "engrais",
      label: "Engrais",
      icon: "fa-flask",
      currentProfile: currentProfile,
      profileData: profileData
    });
  }

  // ===================== MAGASINIER: BONS CONSOMMATION PHYTO TAB =====================
  function MagBCPhytoTab({
    currentProfile,
    profileData
  }) {
    return /*#__PURE__*/React.createElement(MagBCTab, {
      type: "pesticide",
      label: "Phytosanitaire",
      icon: "fa-bug",
      currentProfile: currentProfile,
      profileData: profileData
    });
  }

  // ===================== MAGASINIER: BONS CONSOMMATION (shared) =====================
  function MagBCTab({
    type: typeProp,
    label: labelProp,
    icon: iconProp,
    currentProfile,
    profileData
  }) {
    const type = typeProp || '';
    const label = labelProp || (type === 'engrais' ? 'Engrais' : type === 'pesticide' ? 'Phytosanitaire' : 'Tous');
    const icon = iconProp || 'fa-flask';

    // ---- Brouillon persistant de saisie -------------------------------
    // Le bon en cours de saisie ne doit JAMAIS disparaître : l'état local
    // était perdu à chaque remount du tab (retour de fenêtre / sortie du
    // plein écran, pull-to-refresh, rechargement mobile). On sauvegarde le
    // brouillon dans localStorage à chaque frappe et on le restaure au
    // montage. Effacé à la création du bon et à « Annuler ».
    const BC_DRAFT_KEY = 'bcDraft_v1_' + (type || 'tous');
    const BC_DRAFT_TTL_MS = 24 * 3600 * 1000;
    const clearBcDraft = () => {
      try {
        window.localStorage.removeItem(BC_DRAFT_KEY);
      } catch (e) {}
    };
    // Un brouillon n'est restauré que s'il contient vraiment quelque chose :
    // un formulaire vierge ne doit pas rouvrir la fenêtre tout seul.
    const bcDraftHasContent = f => !!(f && Array.isArray(f.items) && f.items.some(it => (it.article || '').trim() || String(it.quantite || '').trim() || (it.parcelle || '').trim()));
    const readBcDraft = () => {
      try {
        const raw = window.localStorage.getItem(BC_DRAFT_KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (!d || !d.form || !Array.isArray(d.form.items)) return null;
        if (!d.savedAt || Date.now() - d.savedAt > BC_DRAFT_TTL_MS) {
          clearBcDraft();
          return null;
        }
        if (!bcDraftHasContent(d.form)) {
          clearBcDraft();
          return null;
        }
        return d;
      } catch (e) {
        return null;
      }
    };
    // Lu une seule fois, au premier rendu (useState paresseux plus bas).
    const bcDraftRef = _r.useRef(undefined);
    if (bcDraftRef.current === undefined) bcDraftRef.current = readBcDraft();
    const bcDraft0 = bcDraftRef.current;
    // -------------------------------------------------------------------

    const [bcs, setBcs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(!!bcDraft0);
    // Modale « Scanner des bons » (composant séparé, window.MagBCScanModal)
    const [showScan, setShowScan] = useState(false);
    const [stocks, setStocks] = useState([]);
    const [catalogueArticles, setCatalogueArticles] = useState([]);
    const [showCreateArticle, setShowCreateArticle] = useState(false);
    const [newArticle, setNewArticle] = useState({
      reference: '',
      nom: '',
      unite: 'kg',
      categorie: 'autre',
      taux_tva: 20
    });
    const [creatingArt, setCreatingArt] = useState(false);
    const [createArticleLineIdx, setCreateArticleLineIdx] = useState(null);
    const canCreateArticle = currentProfile === 'achats' || currentProfile === 'dg';
    const [parcelles, setParcelles] = useState([]);
    const [refParcelles, setRefParcelles] = useState({
      courante: [],
      precedente: []
    });
    // Référentiel Smart Berry (sb_parcelle_referentiel), clé = label BEE ONE
    // en MAJUSCULES. Source de vérité pour le NOM et la CULTURE affichés :
    // une parcelle renommée côté RH doit apparaître sous son nom SB partout.
    const [sbRefMap, setSbRefMap] = useState(() => window.SB_PARCELLE_REF || {});
    // Groupes de parcelles = raccourci de saisie (parcelle combinée). Le
    // backend éclate la ligne en N parcelles RÉELLES au prorata des Ha.
    const [parcelleGroupes, setParcelleGroupes] = useState([]);
    const FARMS = ['F1', 'F5'];
    // Magasins dérivés de la config stock (get-locations) — source unique, plus de hardcode.
    const MAGASINS = window.useStockLocations().magasins;
    const STATIONS = ['Station F1', 'Station F2', 'Station F3', 'Station F4', 'Station F5', 'Station F6'];
    const emptyItem = {
      article: '',
      quantite: '',
      unite: 'kg',
      parcelle: '',
      parcelle_ref: '',
      culture: '',
      ferme: '',
      groupe_id: ''
    };
    const [form, setForm] = useState(() => bcDraft0 && bcDraft0.form || {
      date: new Date().toISOString().split('T')[0],
      lieu_source_type: 'magasin',
      lieu_source_id: 'F1',
      items: [{
        ...emptyItem
      }]
    });
    const [scanFileBC, setScanFileBC] = useState(null);
    const [scanPreviewBC, setScanPreviewBC] = useState(null);
    // Campagne (année fiscale Juillet→Juin) : '2025-2026', etc.
    // Source unique : window.CampagneUtils (lib/campagneUtils.js). Fallback
    // défensif si le lib n'est pas encore chargé (renvoie '' comme l'ancien helper).
    const bcCampagneOf = dateStr => window.CampagneUtils ? window.CampagneUtils.campagneOf(dateStr) || '' : (() => {
      const m = (dateStr || '').match(/^(\d{4})-(\d{2})/);
      if (!m) return '';
      const y = +m[1],
        mo = +m[2];
      const start = mo >= 7 ? y : y - 1;
      return start + '-' + (start + 1);
    })();
    const [bcCampagne, setBcCampagne] = useState(() => bcDraft0 && bcDraft0.bcCampagne || bcCampagneOf(new Date().toISOString().slice(0, 10)));
    // Culture : filtre GLOBAL au bon (pas une donnée du bon). '' = toutes.
    // Jamais envoyé au backend — même convention que bcCampagne.
    const [bcCulture, setBcCulture] = useState(() => bcDraft0 && bcDraft0.bcCulture || '');
    const [query, setQuery] = useState('');
    const [filterSource, setFilterSource] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [sortField, setSortField] = useState('date');
    const [sortDir, setSortDir] = useState('desc');
    const [detailBc, setDetailBc] = useState(null);
    // --- Modification de la DATE d'un bon (magasinier) ------------------
    // Périmètre volontairement étroit : la date, et rien d'autre. Le
    // backend (action `update-bc-date`) met à jour le bon ET les
    // stock_movements liés dans la MÊME transaction.
    const [editDateBc, setEditDateBc] = useState(null);
    const [editDateValue, setEditDateValue] = useState('');
    const [editDateSaving, setEditDateSaving] = useState(false);
    const [editDateError, setEditDateError] = useState('');
    // --- Doublon refusé par create-bc (409) -----------------------------
    // NOUVEAUX useState AJOUTÉS EN FIN DE LISTE, jamais intercalés : les
    // tests de rendu indexent les hooks par ordre de déclaration.
    const [doublonBc, setDoublonBc] = useState(null);
    // --- Suppression d'un bon (magasinier / achats / dg) ----------------
    const [deleteBc, setDeleteBc] = useState(null);
    const [deleteMotif, setDeleteMotif] = useState('');
    const [deleteSaving, setDeleteSaving] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    // Seconde étape de confirmation du magasinier (retaper le numéro).
    // ENCORE EN FIN DE LISTE : cf. l'avertissement plus haut, les tests
    // de rendu indexent les hooks par position.
    const [deleteConfirmBc, setDeleteConfirmBc] = useState(null);
    const [deleteNumeroSaisi, setDeleteNumeroSaisi] = useState('');
    // --- Conversion d'unité d'un article (magasinier / achats / dg) -----
    // ENCORE ET TOUJOURS EN FIN DE LISTE : cf. l'avertissement plus haut,
    // les tests de rendu indexent les hooks par position.
    const [conversionArticle, setConversionArticle] = useState(null);
    const [conversionForm, setConversionForm] = useState({
      unite_consommation: '',
      stock_par_unite_consommation: ''
    });
    const [conversionSaving, setConversionSaving] = useState(false);
    const [conversionError, setConversionError] = useState('');
    const isImportBC = bc => bc._isImport || (bc.numero || '').startsWith('IMP-') || bc.created_by?.userId === 'import_caneva';
    const loadBcs = () => {
      Promise.all([fetch('/api/stock?action=list-bc&type=' + type).then(r => r.json()).catch(() => ({
        success: false
      })), fetch('/api/stock?action=list-movements&type=consommation&limit=3000').then(r => r.json()).catch(() => ({
        success: false
      }))]).then(([bcJson, movJson]) => {
        const list = bcJson.success ? bcJson.bcs || [] : [];
        const movs = movJson.success ? movJson.movements || [] : [];
        // Append movements without bc_id (imports / direct mouvements) as virtual BC rows
        const extras = movs.filter(m => !m.bc_id).map(m => ({
          id: 'mov_' + m.id,
          numero: m.numero,
          date: m.date,
          ferme: m.ferme,
          lieu_source: m.lieu_source || null,
          items: (m.items || []).map(i => ({
            article: i.article_nom || i.article_ref,
            quantite: i.quantite,
            unite: i.unite,
            parcelle: m.lieu_destination?.id || '',
            ferme: m.ferme
          })),
          created_by: m.created_by || {},
          _isImport: (m.numero || '').startsWith('IMP-') || m.created_by?.userId === 'import_caneva'
        }));
        setBcs([...list, ...extras]);
      }).finally(() => setLoading(false));
    };
    useEffect(() => {
      loadBcs();
    }, []);
    // Sauvegarde du brouillon à chaque modification pendant la saisie.
    // (Le scan joint n'est pas sérialisable : il est à re-joindre après un
    // retour de fenêtre — le reste du bon est intact.)
    useEffect(() => {
      if (!showForm || !bcDraftHasContent(form)) return;
      try {
        window.localStorage.setItem(BC_DRAFT_KEY, JSON.stringify({
          form,
          bcCampagne,
          bcCulture,
          savedAt: Date.now()
        }));
      } catch (e) {}
    }, [showForm, form, bcCampagne, bcCulture]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
      window.cachedFetch('/api/stock?action=stock-levels').then(json => {
        if (json.success) setStocks(json.stocks || []);
      }).catch(() => {});
    }, []);
    // ⚠️ LISTE COMPLÈTE, DOUBLONS COMPRIS. Elle était dédoublonnée par nom
    // ici même, ce qui rendait le front AVEUGLE aux ~105 paires de fiches
    // jumelles du catalogue : deux fiches « Acide Nitrique » en désaccord
    // sur la conversion faisaient afficher « = 6.6 KG déduits » pendant
    // que le serveur, lui, voyait l'ambiguïté et déduisait 5 L d'un stock
    // en kilos. Le dédoublonnage ne sert qu'à l'AFFICHAGE de la liste de
    // suggestions (catalogueArticlesAffichage), jamais à décider.
    useEffect(() => {
      fetch('/api/stock?action=list-articles').then(r => r.json()).then(j => {
        if (j.success) {
          setCatalogueArticles(j.articles || []);
        }
      }).catch(() => {});
    }, []);
    useEffect(() => {
      window.cachedFetch('/api/parcelles').then(json => {
        if (json.success) setParcelles(json.parcelles || []);
      }).catch(() => {});
    }, []);
    useEffect(() => {
      fetch('/api/pointage-rh?action=parcelles-campagne-list').then(r => r.json()).then(j => {
        if (j.success) setRefParcelles({
          courante: j.campagne_courante || [],
          precedente: j.campagne_precedente || []
        });
      }).catch(() => {});
    }, []);
    useEffect(() => {
      // Référentiel SB : chargé ici (et pas seulement via window.SB_PARCELLE_REF
      // posé au boot d'app.jsx) pour garantir un re-rendu quand il arrive.
      fetch('/api/pointage-rh?action=sb-referentiel-list').then(r => r.json()).then(j => {
        if (!j.success) return;
        const map = {};
        (j.parcelles || []).forEach(p => {
          map[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
        });
        window.SB_PARCELLE_REF = map;
        setSbRefMap(map);
      }).catch(() => {});
    }, []);
    useEffect(() => {
      // Groupes de parcelles (lecture ouverte à tout profil authentifié).
      // `valide: false` = un membre n'a plus de Ha SB → groupe non
      // proposé à la saisie (le backend le refuserait de toute façon).
      fetch('/api/pointage-rh?action=sb-groupes-list').then(r => r.json()).then(j => {
        if (j.success) setParcelleGroupes((j.groupes || []).filter(g => g.valide));
      }).catch(() => {});
    }, []);
    const catalogUnit = article => {
      const a = catalogueArticles.find(x => (x.nom || '').toLowerCase() === (article || '').toLowerCase());
      return a && a.unite ? (a.unite || '').toLowerCase() : null;
    };
    // Liste d'AFFICHAGE uniquement : une seule entrée par nom dans les
    // suggestions, sinon le magasinier voit la même ligne deux fois.
    // ⚠️ Ne JAMAIS s'en servir pour décider quoi que ce soit (conversion,
    // fiches à corriger) : c'est précisément ce dédoublonnage, appliqué
    // trop tôt, qui masquait les fiches jumelles au front.
    const catalogueArticlesAffichage = (() => {
      const seen = new Set();
      return catalogueArticles.filter(a => {
        if (seen.has(a.nom)) return false;
        seen.add(a.nom);
        return true;
      });
    })();
    // --- CONVERSION D'UNITÉ (lib/uniteConsoUtils) ----------------------
    // Un article peut être stocké au KG et dosé au L (acide nitrique :
    // 1 L = 1,32 KG). L'unité n'est donc plus un choix libre, et la
    // quantité réellement déduite du stock est montrée à la saisie.
    // Lib absente (script non chargé) → tout retombe sur le comportement
    // d'avant, aucun écran ne casse.
    const UCU = window.UniteConsoUtils;
    const uniteIndex = UCU ? UCU.indexerArticles(catalogueArticles) : null;
    /** Fiche de conversion d'un article, ou null (inconnu / doublons en désaccord). */
    const ficheConversion = nom => UCU && uniteIndex ? UCU.trouverArticle(uniteIndex, nom) : null;
    /** Unités que le magasinier a le droit de choisir pour cette ligne. */
    const unitesPourArticle = nom => UCU ? UCU.unitesSaisissables(ficheConversion(nom)) : [];
    /**
     * Unité EFFECTIVE d'une ligne : celle qui est affichée ET envoyée.
     * Un brouillon restauré (ou un bon scanné) peut porter « kg » quand
     * la fiche écrit « KG » : sans ce rapprochement, le <select>
     * afficherait la première option pendant que l'état en garde une
     * autre — l'écran et l'envoi diraient deux choses différentes.
     *
     * ⚠️ Une unité qui ne correspond à AUCUNE unité permise est gardée
     * TELLE QUELLE, jamais remplacée en douce par l'unité de stock : la
     * ligne serait déduite d'une quantité que personne n'a saisie. Elle
     * reste proposée dans le sélecteur et la ligne est signalée comme
     * non convertible — c'est exactement le cas que le filet doit
     * attraper.
     */
    const uniteEffective = it => {
      const permises = unitesPourArticle(it.article);
      if (!permises.length) return it.unite;
      const match = permises.filter(u => UCU.normaliserUnite(u) === UCU.normaliserUnite(it.unite))[0];
      return match || it.unite;
    };
    /** Options du sélecteur d'unité d'une ligne (cf. uniteEffective). */
    const optionsUnite = it => {
      const permises = unitesPourArticle(it.article);
      if (!permises.length) {
        // Article inconnu du catalogue : on ne sait rien de lui, la
        // liste générique reste (sinon la ligne est insaisissable).
        return [...new Set(['kg', 'L', 'unité', 'carton', 'sac', 'bidon', ...(it.unite ? [it.unite] : [])])];
      }
      const eff = uniteEffective(it);
      return permises.indexOf(eff) >= 0 ? permises : [...permises, eff];
    };
    /** Verdict de conversion d'une ligne (null si la lib n'est pas chargée). */
    const verdictLigne = it => UCU ? UCU.convertirQuantite({
      article: it.article,
      quantite: it.quantite,
      unite: uniteEffective(it)
    }, ficheConversion(it.article)) : null;
    const suggestRef = nom => 'ART-' + (nom || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    const openCreateArticle = (lineIdx, prefillNom) => {
      const nom = (prefillNom || '').trim();
      setNewArticle({
        reference: nom ? suggestRef(nom) : '',
        nom,
        unite: 'kg',
        categorie: 'autre',
        taux_tva: 20
      });
      setCreateArticleLineIdx(typeof lineIdx === 'number' ? lineIdx : null);
      setShowCreateArticle(true);
    };
    // Le magasinier n'a pas le droit de créer une fiche (canCreateArticle
    // = achats | dg). Depuis le refus fail-closed du résolveur d'identité,
    // le laisser sans issue reviendrait à bloquer sa saisie sans recours :
    // il peut donc DEMANDER la création, et le DG crée l'article depuis
    // son écran Catalogue. Le serveur dédoublonne les demandes.
    const [demandeArticleEnCours, setDemandeArticleEnCours] = useState('');
    const [demandesEnvoyees, setDemandesEnvoyees] = useState([]);
    const demanderCreationArticle = async nom => {
      const libelle = (nom || '').trim();
      if (!libelle || demandeArticleEnCours) return;
      setDemandeArticleEnCours(libelle);
      try {
        const r = await fetch('/api/stock?action=request-article-creation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            libelle,
            origine: 'bon_consommation'
          })
        });
        const j = await r.json();
        if (j.success) {
          setDemandesEnvoyees(prev => prev.includes(libelle) ? prev : [...prev, libelle]);
          alert(j.message || 'Demande de création envoyée au DG pour « ' + libelle + ' ».');
        } else {
          alert(j.error || 'La demande de création n\'a pas pu être envoyée.');
        }
      } catch (e) {
        alert('La demande de création n\'a pas pu être envoyée : ' + e.message);
      } finally {
        setDemandeArticleEnCours('');
      }
    };
    const handleCreateArticle = async () => {
      if (!newArticle.nom.trim() || !newArticle.reference.trim()) return alert('Le nom et la référence sont requis');
      setCreatingArt(true);
      try {
        const r = await fetch('/api/stock?action=create-article', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...newArticle,
            created_by: {
              profileId: currentProfile,
              name: profileData?.name || currentProfile
            }
          })
        });
        const j = await r.json();
        if (j.success) {
          const listR = await fetch('/api/stock?action=list-articles');
          const listJ = await listR.json();
          // Liste COMPLÈTE (cf. le chargement initial) : dédoublonner ici
          // rendrait à nouveau le front aveugle aux fiches jumelles.
          if (listJ.success) {
            setCatalogueArticles(listJ.articles || []);
          }
          if (createArticleLineIdx != null) {
            const li = createArticleLineIdx;
            const items = [...form.items];
            items[li] = {
              ...items[li],
              article: newArticle.nom,
              unite: (newArticle.unite || 'kg').toLowerCase()
            };
            setForm({
              ...form,
              items
            });
          }
          setShowCreateArticle(false);
          setCreateArticleLineIdx(null);
          setNewArticle({
            reference: '',
            nom: '',
            unite: 'kg',
            categorie: 'autre',
            taux_tva: 20
          });
        } else {
          alert(j.error || 'Erreur lors de la création');
        }
      } catch (e) {
        alert('Erreur réseau');
      }
      setCreatingArt(false);
    };

    // --- Renseigner la conversion d'unité d'un article ------------------
    // Le magasinier n'a PAS accès à Stock › Articles, et c'est pourtant
    // lui qui sait qu'un fût de 25 L d'acide nitrique pèse 33 kg. Le
    // serveur (`update-article`) ne lui ouvre que ces DEUX champs et
    // décide sur le contenu réel d'`updates` : ce bouton n'est donc pas
    // la sécurité, juste le chemin.
    const canSetConversion = currentProfile === 'magasinier' || currentProfile === 'achats' || currentProfile === 'dg';
    /**
     * TOUTES les fiches actives portant ce nom. Le catalogue porte ~105
     * paires de jumelles : n'en corriger qu'une laisse les deux fiches en
     * désaccord, donc l'article ambigu, donc TOUJOURS pas converti — la
     * réparation paraîtrait sans effet. Lit la liste COMPLÈTE, jamais la
     * liste d'affichage (dédoublonnée).
     */
    const fichesDuNom = nom => {
      const cible = UCU ? UCU.canonNom(nom) : (nom || '').trim().toLowerCase();
      return catalogueArticles.filter(a => (UCU ? UCU.canonNom(a.nom) : (a.nom || '').trim().toLowerCase()) === cible);
    };
    const openConversion = nom => {
      const fiches = fichesDuNom(nom);
      // Pré-remplissage depuis la PREMIÈRE fiche : quand les jumelles se
      // contredisent, il faut bien en proposer une. L'enregistrement
      // écrit ensuite la MÊME valeur sur toutes, ce qui lève le désaccord.
      const f = fiches[0] || {};
      setConversionArticle({
        nom: nom,
        unite_stock: (f.unite || '').trim(),
        ids: fiches.map(a => a.id).filter(Boolean)
      });
      setConversionForm({
        unite_consommation: (f.unite_consommation || '').trim(),
        stock_par_unite_consommation: f.stock_par_unite_consommation === null || f.stock_par_unite_consommation === undefined ? '' : String(f.stock_par_unite_consommation)
      });
      setConversionError('');
    };
    const saveConversion = async () => {
      if (!conversionArticle) return;
      const uc = (conversionForm.unite_consommation || '').trim();
      const facteur = UCU ? UCU.lireFacteur(conversionForm.stock_par_unite_consommation) : null;
      // Une unité de consommation sans facteur ne convertit rien : on
      // refuse ICI plutôt que d'écrire une fiche qui laisserait croire
      // à une conversion inexistante.
      if (uc && UCU && UCU.normaliserUnite(uc) !== UCU.normaliserUnite(conversionArticle.unite_stock) && facteur === null) {
        setConversionError('Indiquez combien vaut 1 ' + uc + ' en ' + (conversionArticle.unite_stock || 'unité de stock') + ' (nombre supérieur à 0).');
        return;
      }
      if (!conversionArticle.ids.length) {
        setConversionError('Aucune fiche catalogue pour « ' + conversionArticle.nom + ' ».');
        return;
      }
      setConversionSaving(true);
      setConversionError('');
      try {
        // Les DEUX champs, et rien d'autre : y joindre un champ de plus
        // ferait refuser TOUTE la requête au magasinier (garde serveur).
        // Toutes les fiches homonymes sont mises à jour — n'en corriger
        // qu'une laisserait la conversion ambiguë, donc inopérante.
        const updates = {
          unite_consommation: uc,
          stock_par_unite_consommation: uc ? facteur : null
        };
        for (const id of conversionArticle.ids) {
          const r = await fetch('/api/stock?action=update-article', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              id,
              updates,
              updated_by: {
                profileId: currentProfile,
                name: profileData?.name || currentProfile
              }
            })
          });
          const j = await r.json();
          if (!j.success) {
            setConversionError(j.error || 'Échec de l\'enregistrement');
            setConversionSaving(false);
            return;
          }
        }
        const listJ = await fetch('/api/stock?action=list-articles').then(r => r.json());
        if (listJ.success) {
          setCatalogueArticles(listJ.articles || []);
        }
        setConversionArticle(null);
      } catch (e) {
        setConversionError('Erreur réseau');
      }
      setConversionSaving(false);
    };
    const filteredParcelles = parcelles;
    const bcCampagneToday = bcCampagneOf(new Date().toISOString().slice(0, 10));
    const campagnePrecedente = (() => {
      const y = parseInt(bcCampagneToday.slice(0, 4), 10) - 1;
      return y + '-' + (y + 1);
    })();
    const useConsoSelector = currentProfile === 'magasinier' && (refParcelles.courante.length > 0 || refParcelles.precedente.length > 0);
    const bcCampagnesDispo = [...(refParcelles.courante.length > 0 ? [bcCampagneToday] : []), ...(refParcelles.precedente.length > 0 ? [campagnePrecedente] : [])];
    if (!bcCampagnesDispo.length) bcCampagnesDispo.push(bcCampagneToday);
    const refForCampagne = bcCampagne === bcCampagneToday ? refParcelles.courante : refParcelles.precedente;
    const sbMap = sbRefMap;
    // Nom affiché d'une parcelle = nom_sb du référentiel RH s'il existe,
    // sinon le libellé BEE ONE. La VALEUR envoyée au backend reste toujours
    // le libellé BEE ONE (clé de jointure stock / analytique).
    const sbEntryOf = label => sbMap[(label || '').toUpperCase().trim()];
    const parcelleNom = label => {
      const e = sbEntryOf(label);
      return e && e.nom_sb ? e.nom_sb : label || '';
    };
    // Culture affichée = culture_sb du référentiel si définie, sinon la culture BEE ONE.
    const parcelleCulture = (label, fallback) => {
      const e = sbEntryOf(label);
      return e && e.culture_sb ? e.culture_sb : fallback || '';
    };
    // Culture/ferme d'un libellé de parcelle, quelle que soit la source du select.
    const metaForParcelle = label => {
      const ref = refForCampagne.find(p => p.label === label);
      if (ref) return {
        culture: parcelleCulture(label, ref.culture),
        ferme: ref.ferme || ''
      };
      const parc = parcelles.find(p => p.Parcelle_Physique === label);
      return {
        culture: parcelleCulture(label, parc?.Culture),
        ferme: parc?.Ferme || ''
      };
    };
    // Valeur unique parmi les membres d'un groupe, sinon '' (groupe à cheval
    // sur deux cultures/fermes → on ne devine pas).
    const uniqueMemberMeta = (groupe, field) => {
      const vals = [...new Set((groupe.membres || []).map(m => metaForParcelle(m.label)[field]).filter(Boolean))];
      return vals.length === 1 ? vals[0] : '';
    };
    // --- Filtre Culture (global au bon) -------------------------------
    // Référentiel Smart Berry lu AU RENDU : sbLoad() est asynchrone au boot
    // d'app.jsx, un useState initial figerait un objet vide.
    // Défensif : lib absente → on ne filtre rien (comportement actuel).
    const cultureOk = (parcelle, filtre) => {
      const CU = window.CultureUtils;
      if (!CU || !filtre) return true;
      return CU.matchesCulture(parcelle, filtre, sbMap);
    };
    // Un membre de groupe n'a qu'un `label` : on lui rattache la culture
    // connue du référentiel de saisie avant de résoudre.
    const groupeOk = (groupe, filtre) => {
      if (!filtre || !window.CultureUtils) return true;
      // Groupe à cheval sur deux cultures : proposé si AU MOINS un membre
      // matche (même prudence que uniqueMemberMeta : on ne devine pas).
      return (groupe.membres || []).some(m => cultureOk({
        label: m.label,
        culture: metaForParcelle(m.label).culture
      }, filtre));
    };
    const refForCampagneCulture = refForCampagne.filter(p => cultureOk(p, bcCulture));
    const filteredParcellesCulture = filteredParcelles.filter(p => cultureOk(p, bcCulture));
    const parcelleGroupesCulture = parcelleGroupes.filter(g => groupeOk(g, bcCulture));
    const aucuneParcellePourCulture = !!bcCulture && parcelleGroupesCulture.length === 0 && (useConsoSelector ? refForCampagneCulture.length : filteredParcellesCulture.length) === 0;
    // Changement de culture : les lignes dont la destination sort de la
    // liste filtrée perdent leur parcelle (article/qté/unité intacts).
    const changeBcCulture = val => {
      setBcCulture(val);
      // '' = plus de filtre (rien ne devient invalide) ; lib absente = pas de filtre du tout.
      if (!val || !window.CultureUtils) return;
      const items = form.items.map(it => {
        if (!it.parcelle && !it.groupe_id) return it;
        let keep;
        if (it.groupe_id) {
          const g = parcelleGroupes.find(x => x.id === it.groupe_id);
          keep = !!g && groupeOk(g, val);
        } else {
          const src = useConsoSelector ? refForCampagne.find(p => p.label === it.parcelle) : filteredParcelles.find(p => p.Parcelle_Physique === it.parcelle);
          keep = !!src && cultureOk(src, val);
        }
        return keep ? it : {
          ...it,
          parcelle: '',
          parcelle_ref: '',
          culture: '',
          ferme: '',
          groupe_id: ''
        };
      });
      setForm({
        ...form,
        items
      });
    };
    const selectParcelleForItem = (idx, val) => {
      const items = [...form.items];
      if ((val || '').startsWith('GRP::')) {
        // Parcelle combinée : on ne pose que le libellé du groupe +
        // groupe_id. L'éclatement en parcelles réelles est fait par le
        // backend (create-bc), au prorata des Ha du référentiel SB.
        const g = parcelleGroupes.find(x => x.id === val.slice(5));
        items[idx] = {
          ...items[idx],
          parcelle: g ? g.label : '',
          parcelle_ref: '',
          groupe_id: g ? g.id : '',
          culture: g ? uniqueMemberMeta(g, 'culture') : '',
          ferme: g ? uniqueMemberMeta(g, 'ferme') : ''
        };
        setForm({
          ...form,
          items
        });
        return;
      }
      const ref = refForCampagne.find(p => p.label === val);
      if (ref) {
        items[idx] = {
          ...items[idx],
          parcelle: val,
          parcelle_ref: ref.ref || '',
          culture: parcelleCulture(val, ref.culture),
          ferme: ref.ferme || '',
          groupe_id: ''
        };
      } else {
        const parc = parcelles.find(p => p.Parcelle_Physique === val);
        items[idx] = {
          ...items[idx],
          parcelle: val,
          parcelle_ref: '',
          culture: parcelleCulture(val, parc?.Culture),
          ferme: parc?.Ferme || '',
          groupe_id: ''
        };
      }
      setForm({
        ...form,
        items
      });
    };
    const updateItem = (idx, field, value) => {
      const items = [...form.items];
      items[idx] = {
        ...items[idx],
        [field]: value
      };
      setForm({
        ...form,
        items
      });
    };
    const addItem = () => setForm({
      ...form,
      items: [...form.items, {
        ...emptyItem
      }]
    });
    const removeItem = idx => {
      if (form.items.length > 1) setForm({
        ...form,
        items: form.items.filter((_, i) => i !== idx)
      });
    };
    const getStock = article => {
      const s = stocks.find(x => x.article === article);
      return s ? s.stock : 0;
    };
    const uploadScanBC = async base64 => {
      if (!base64) return null;
      const res = await fetch('/api/stock?action=upload-scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file_base64: base64,
          filename: 'scan_bc.jpg',
          contentType: 'image/jpeg'
        })
      });
      const json = await res.json();
      return json.success ? json.url : null;
    };
    const handleCreate = async () => {
      const validItems = form.items.filter(i => i.article && i.quantite);
      if (!validItems.length) {
        alert('Ajoutez au moins un article');
        return;
      }
      for (const it of validItems) {
        if (!it.parcelle) {
          alert('Parcelle requise pour l\'article ' + it.article);
          return;
        }
      }
      for (const it of validItems) {
        const dispo = getStock(it.article);
        if (parseFloat(it.quantite) > dispo) {
          if (!confirm('Stock insuffisant pour ' + it.article + ' (dispo: ' + dispo + '). Continuer quand meme ?')) return;
        }
      }
      let scanUrl = null;
      if (scanFileBC) {
        scanUrl = await uploadScanBC(scanFileBC);
      }
      // `type` envoyé tel quel, vide compris : le défaut est posé
      // côté serveur (create-bc). Un repli muet ici a produit
      // 48 bons /48 en « engrais » et un onglet Pesticides vide ;
      // la classification vient désormais de l'article, pas du bon.
      return postBc(validItems, scanUrl, false);
    };

    /**
     * Envoi effectif de `create-bc`. `force` n'est PAS un détail de
     * signature : c'est l'échappatoire du magasinier face à la garde
     * anti-doublon. Un refus 409 ouvre la fenêtre de doublon au lieu
     * d'un `alert` brut — sinon le magasinier est dans une impasse,
     * bloqué par un message qui ne nomme même pas le bon fautif.
     */
    const postBc = (validItems, scanUrl, force) => {
      const by = {
        profileId: currentProfile,
        name: profileData?.name || currentProfile
      };
      // `uniteEffective` : on envoie l'unité RÉELLEMENT affichée dans le
      // sélecteur. Envoyer `i.unite` brut ferait diverger l'écran de
      // l'envoi sur un brouillon restauré (« kg » affiché « KG »), et la
      // conversion serveur ne s'appliquerait pas au même intitulé.
      const payload = {
        type: type || '',
        date: form.date,
        lieu_source: {
          type: form.lieu_source_type,
          id: form.lieu_source_id
        },
        items: validItems.map(i => ({
          article: i.article,
          quantite: i.quantite,
          unite: uniteEffective(i),
          parcelle: i.parcelle,
          parcelle_ref: i.parcelle_ref || '',
          culture: i.culture,
          ferme: i.ferme,
          groupe_id: i.groupe_id || ''
        })),
        scan_url: scanUrl,
        authorized_by: by,
        created_by: by
      };
      // Drapeau envoyé UNIQUEMENT sur forçage explicite : présent à
      // chaque appel, il neutraliserait la garde en permanence.
      if (force) payload.force_doublon = true;
      return fetch('/api/stock?action=create-bc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }).then(r => r.json()).then(json => {
        if (json.success) {
          setDoublonBc(null);
          // Le serveur renvoie les lignes qu'il n'a PAS su convertir :
          // le bon est créé (on ne bloque pas), mais le magasinier doit
          // l'apprendre tout de suite, article et unités nommés.
          const nonConv = json.lignes_non_convertibles || [];
          const avis = nonConv.length ? '\n\nAttention — ' + nonConv.length + ' ligne(s) déduites sans conversion :\n' + nonConv.map(l => '• ' + l.article + ' : ' + l.quantite + ' ' + (l.unite_saisie || '?') + ' retirés d\'un stock tenu en ' + (l.unite_stock || '?')).join('\n') + '\nRenseignez la conversion sur la fiche de ces articles.' : '';
          alert('Bon de consommation ' + json.numero + ' cree' + avis);
          clearBcDraft();
          setShowForm(false);
          loadBcs();
          return;
        }
        if (json.doublon) {
          // On mémorise de quoi REJOUER l'envoi tel quel : re-dériver
          // les items au moment du forçage risquerait d'envoyer autre
          // chose que ce que le serveur a jugé doublon.
          setDoublonBc({
            ...json.doublon,
            message: json.error || '',
            items: validItems,
            scan_url: scanUrl
          });
          return;
        }
        setDoublonBc(null);
        alert('Erreur: ' + (json.error || 'Echec'));
      }).catch(() => alert('Erreur reseau'));
    };
    const forcerCreationDoublon = () => {
      if (!doublonBc) return;
      return postBc(doublonBc.items || [], doublonBc.scan_url || null, true);
    };

    // --- Suppression d'un bon de consommation ---------------------------
    // Ouverte à `magasinier`, `achats` et `dg` : le serveur (delete-bc)
    // refuse les autres, un bouton visible pour eux ne mènerait qu'à un
    // 403. Supprimer un bon ANNULE l'impact stock de ses mouvements :
    // les quantités reviennent en stock. Le motif est exigé ICI aussi,
    // pour ne pas envoyer une requête qui échouera de toute façon.
    const canDeleteBc = currentProfile === 'magasinier' || currentProfile === 'achats' || currentProfile === 'dg';
    // Le magasinier supprime SON PROPRE bon, dans le flux de saisie et
    // souvent sur mobile : c'est le seul profil chez qui le geste risque
    // d'être machinal. Une seconde étape lui est donc imposée — et à lui
    // seul, `achats`/`dg` gardant le parcours d'origine.
    //
    // ⚠️ PROTECTION D'INTERFACE, PAS DE SÉCURITÉ. Le serveur ne sait rien
    // de cette étape et ne doit jamais en dépendre : il valide le rôle
    // (résolu depuis le jeton) et le motif, un point c'est tout. Aucun
    // drapeau « double_confirmation » n'est envoyé — il serait usurpable
    // et ne donnerait qu'une fausse impression de sûreté.
    const deleteDoubleConfirm = currentProfile === 'magasinier';
    const openDeleteBc = bc => {
      setDeleteBc(bc);
      setDeleteMotif('');
      setDeleteError('');
      setDeleteConfirmBc(null);
      setDeleteNumeroSaisi('');
    };
    const closeDeleteBc = () => {
      setDeleteBc(null);
      setDeleteError('');
      setDeleteConfirmBc(null);
      setDeleteNumeroSaisi('');
    };
    const closeDeleteConfirm = () => {
      setDeleteConfirmBc(null);
      setDeleteNumeroSaisi('');
      setDeleteError('');
    };
    const deleteMotifValide = (deleteMotif || '').trim().length >= 3;
    // Numéro attendu à la seconde étape. Comparaison STRICTE : ni trim,
    // ni casse ignorée. Un « bc-0001 » ou un « BC-0001 » collé avec une
    // espace passeraient distraitement, ce qui viderait le geste de son
    // sens. Un bon sans numéro ne peut PAS être confirmé (chaîne vide
    // == chaîne vide serait vrai, et le bouton s'activerait tout seul).
    const deleteNumeroAttendu = deleteConfirmBc && deleteConfirmBc.numero || '';
    const deleteNumeroOk = deleteNumeroAttendu !== '' && deleteNumeroSaisi === deleteNumeroAttendu;
    const deleteLignes = deleteConfirmBc && (deleteConfirmBc.items || []).length || 0;
    /**
     * Première étape validée. Pour `achats`/`dg` c'est l'envoi direct ;
     * pour le magasinier, cela n'ouvre QUE la seconde fenêtre — aucune
     * requête n'est émise à ce stade.
     */
    const nextDeleteStep = () => {
      if (!deleteBc) return;
      if (!deleteMotifValide) {
        setDeleteError('Motif obligatoire (3 caractères minimum)');
        return;
      }
      if (!deleteDoubleConfirm) return submitDeleteBc();
      setDeleteError('');
      setDeleteNumeroSaisi('');
      setDeleteConfirmBc(deleteBc);
    };
    const submitDeleteBc = async () => {
      if (!deleteBc) return;
      if (!deleteMotifValide) {
        setDeleteError('Motif obligatoire (3 caractères minimum)');
        return;
      }
      setDeleteSaving(true);
      setDeleteError('');
      try {
        const r = await fetch('/api/stock?action=delete-bc', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            bc_id: deleteBc.id,
            motif: deleteMotif.trim()
          })
        });
        const j = await r.json();
        if (!j.success) {
          // Message serveur affiché TEL QUEL (403, bon introuvable,
          // déjà supprimé…) — jamais reformulé côté client.
          setDeleteError(j.error || 'Échec de la suppression');
          setDeleteSaving(false);
          return;
        }
        setDeleteConfirmBc(null);
        setDeleteNumeroSaisi('');
        setDeleteBc(null);
        setDetailBc(null);
        loadBcs();
      } catch (e) {
        setDeleteError('Erreur réseau');
      }
      setDeleteSaving(false);
    };

    // --- Modification de la date d'un bon existant ----------------------
    // Réservé au magasinier (même conditionnement que « Nouveau bon »).
    // Exclus : les lignes VIRTUELLES issues de mouvements sans bc_id
    // (id 'mov_…' : aucun document consumption_vouchers à modifier) et
    // les bons importés (convention repo : un import ne s'édite pas).
    const canEditBcDate = currentProfile === 'magasinier';
    const isEditableBc = bc => !!bc && !String(bc.id || '').startsWith('mov_') && !isImportBC(bc);
    const openEditDate = bc => {
      setEditDateBc(bc);
      setEditDateValue(bc.date || '');
      setEditDateError('');
    };
    const closeEditDate = () => {
      setEditDateBc(null);
      setEditDateError('');
    };
    // Avertissement AVANT validation : un basculement de campagne
    // (année fiscale Juillet→Juin) fausserait les analyses sans que
    // personne ne le voie. bcCampagneOf est la source unique.
    const editDateCampagne = (() => {
      const from = bcCampagneOf(editDateBc && editDateBc.date);
      const to = bcCampagneOf(editDateValue);
      return {
        from,
        to,
        changed: !!from && !!to && from !== to
      };
    })();
    const submitEditDate = async () => {
      if (!editDateBc || !editDateValue) {
        setEditDateError('Choisissez une date');
        return;
      }
      setEditDateSaving(true);
      setEditDateError('');
      try {
        const r = await fetch('/api/stock?action=update-bc-date', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            bc_id: editDateBc.id,
            date: editDateValue
          })
        });
        const j = await r.json();
        if (!j.success) {
          // Erreur serveur affichée TELLE QUELLE (date future, bon
          // introuvable, 403…) — jamais reformulée côté client.
          setEditDateError(j.error || 'Échec de la modification');
          setEditDateSaving(false);
          return;
        }
        setEditDateBc(null);
        setDetailBc(null);
        loadBcs();
      } catch (e) {
        setEditDateError('Erreur réseau');
      }
      setEditDateSaving(false);
    };
    if (loading) return React.createElement('div', {
      className: 'fade-in',
      style: {
        textAlign: 'center',
        padding: 60
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-spinner fa-spin',
      style: {
        fontSize: 32,
        color: 'var(--berry)'
      }
    }));
    const matchesBC = bc => {
      if (dateFrom && bc.date && bc.date < dateFrom) return false;
      if (dateTo && bc.date && bc.date > dateTo) return false;
      if (filterSource === 'import' && !isImportBC(bc)) return false;
      if (filterSource === 'saisie' && isImportBC(bc)) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (bc.numero || '').toLowerCase().includes(q) || (bc.items || []).some(i => (i.article || '').toLowerCase().includes(q) || (i.parcelle || '').toLowerCase().includes(q) || parcelleNom(i.parcelle).toLowerCase().includes(q)) || (bc.ferme || '').toLowerCase().includes(q);
    };
    const sortValueBC = (bc, field) => {
      if (field === 'numero') return bc.numero || '';
      if (field === 'date') return bc.date || '';
      if (field === 'parcelles') return [...new Set((bc.items || []).map(i => parcelleNom(i.parcelle)).filter(Boolean))].join(',');
      if (field === 'fermes') return [...new Set((bc.items || []).map(i => i.ferme).filter(Boolean))].join(',') || bc.ferme || '';
      if (field === 'cree_par') return bc.created_by?.name || '';
      return '';
    };
    const filteredBcs = bcs.filter(matchesBC).slice().sort((a, b) => {
      const va = sortValueBC(a, sortField),
        vb = sortValueBC(b, sortField);
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      // Tie-break par numéro pour garder les lignes d'un même bon groupées
      const na = a.numero || '',
        nb = b.numero || '';
      if (na < nb) return sortDir === 'asc' ? -1 : 1;
      if (na > nb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    const lieuSourceOf = bc => bc.lieu_source && bc.lieu_source.id || bc.lieu_source_id || '—';
    const toggleSort = field => {
      if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');else {
        setSortField(field);
        setSortDir('asc');
      }
    };
    const sortArrow = field => sortField === field ? sortDir === 'asc' ? ' ▲' : ' ▼' : '';
    const sortThStyle = {
      cursor: 'pointer',
      userSelect: 'none'
    };
    const exportBcExcel = () => {
      if (!filteredBcs.length) {
        alert('Aucun bon à exporter');
        return;
      }
      const aoa = [['N° Bon', 'Date', 'Lieu départ', 'Ferme', 'Parcelle', 'Article', 'Quantité', 'Unité', 'Culture', 'Créé par']];
      filteredBcs.forEach(bc => {
        const lieuDepart = bc.lieu_source?.id || bc.lieu_source_id || '—';
        const creePar = bc.created_by?.name || '';
        const items = bc.items || [];
        if (!items.length) {
          aoa.push([bc.numero || '', bc.date || '', lieuDepart, bc.ferme || '', '', '', '', '', '', creePar]);
        } else {
          items.forEach(i => {
            aoa.push([bc.numero || '', bc.date || '', lieuDepart, i.ferme || bc.ferme || '', parcelleNom(i.parcelle) || '', i.article || '', i.quantite != null ? i.quantite : '', i.unite || '', i.culture || '', creePar]);
          });
        }
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Bons de Consommation');
      XLSX.writeFile(wb, 'Bons_Consommation_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "fade-in"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        flexWrap: 'wrap',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        margin: 0
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: 'fa-solid ' + icon,
      style: {
        marginRight: 8
      }
    }), "Bons de Consommation ", label, " (", filteredBcs.length, ")"), /*#__PURE__*/React.createElement("button", {
      onClick: exportBcExcel,
      title: "Exporter la liste filtr\xE9e en Excel",
      style: {
        background: '#1d6f42',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '7px 14px',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 12
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-file-excel",
      style: {
        marginRight: 6
      }
    }), "Export Excel")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "search",
      placeholder: "Rechercher (n\xB0, article, parcelle\u2026)",
      value: query,
      onChange: e => setQuery(e.target.value),
      style: {
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 12,
        minWidth: 240
      }
    }), /*#__PURE__*/React.createElement("input", {
      type: "date",
      value: dateFrom,
      onChange: e => setDateFrom(e.target.value),
      title: "Date d\xE9but",
      style: {
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 12
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: 'var(--gray-400)'
      }
    }, "\u2192"), /*#__PURE__*/React.createElement("input", {
      type: "date",
      value: dateTo,
      onChange: e => setDateTo(e.target.value),
      title: "Date fin",
      style: {
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 12
      }
    }), /*#__PURE__*/React.createElement("select", {
      value: filterSource,
      onChange: e => setFilterSource(e.target.value),
      title: "Source",
      style: {
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 12
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "Toutes sources"), /*#__PURE__*/React.createElement("option", {
      value: "saisie"
    }, "Saisie"), /*#__PURE__*/React.createElement("option", {
      value: "import"
    }, "Import")), currentProfile === 'magasinier' && /*#__PURE__*/React.createElement("button", {
      onClick: () => setShowScan(true),
      title: "D\xE9poser des photos de bons papier",
      style: {
        background: '#e65100',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '8px 16px',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-camera",
      style: {
        marginRight: 6
      }
    }), "Scanner des bons"), currentProfile === 'magasinier' && /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        clearBcDraft();
        setForm({
          date: new Date().toISOString().split('T')[0],
          lieu_source_type: 'magasin',
          lieu_source_id: 'F1',
          items: [{
            ...emptyItem
          }]
        });
        setBcCulture('');
        setShowForm(true);
      },
      style: {
        background: 'var(--berry)',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '8px 16px',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-plus",
      style: {
        marginRight: 6
      }
    }), "Nouveau bon"))), /*#__PURE__*/React.createElement("div", {
      className: "table-responsive"
    }, /*#__PURE__*/React.createElement("table", {
      className: "data-table"
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
      style: sortThStyle,
      onClick: () => toggleSort('numero')
    }, "N\xB0 bon", sortArrow('numero')), /*#__PURE__*/React.createElement("th", {
      style: sortThStyle,
      onClick: () => toggleSort('date')
    }, "Date", sortArrow('date')), /*#__PURE__*/React.createElement("th", null, "Lieu (d\xE9part)"), /*#__PURE__*/React.createElement("th", {
      style: sortThStyle,
      onClick: () => toggleSort('parcelles')
    }, "Parcelle/Destination", sortArrow('parcelles')), /*#__PURE__*/React.createElement("th", null, "Article"), /*#__PURE__*/React.createElement("th", null, "Unit\xE9"), /*#__PURE__*/React.createElement("th", {
      style: {
        textAlign: 'right'
      }
    }, "Quantit\xE9"))), /*#__PURE__*/React.createElement("tbody", null, filteredBcs.map(bc => {
      const lieuDepart = lieuSourceOf(bc);
      const items = bc.items && bc.items.length ? bc.items : [null];
      return items.map((item, itemIndex) => {
        const isFirst = itemIndex === 0;
        const rowStyle = {
          cursor: 'pointer',
          borderTop: isFirst ? '2px solid #e0e0e0' : '1px solid #f3f3f3'
        };
        return /*#__PURE__*/React.createElement("tr", {
          key: bc.id + '_' + itemIndex,
          onClick: () => setDetailBc(bc),
          style: rowStyle,
          onMouseEnter: e => {
            e.currentTarget.style.background = 'rgba(139,34,82,0.04)';
          },
          onMouseLeave: e => {
            e.currentTarget.style.background = '';
          }
        }, /*#__PURE__*/React.createElement("td", {
          style: {
            fontWeight: 700,
            color: 'var(--berry)',
            fontSize: 12
          }
        }, isFirst ? bc.numero : ''), /*#__PURE__*/React.createElement("td", {
          style: {
            fontSize: 12
          }
        }, isFirst ? bc.date || '—' : '', isFirst && canEditBcDate && isEditableBc(bc) && /*#__PURE__*/React.createElement("button", {
          onClick: e => {
            e.stopPropagation();
            openEditDate(bc);
          },
          title: "Modifier la date du bon",
          style: {
            marginLeft: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--berry)',
            fontSize: 11,
            padding: 0
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-pen"
        })), isFirst && canDeleteBc && isEditableBc(bc) && /*#__PURE__*/React.createElement("button", {
          onClick: e => {
            e.stopPropagation();
            openDeleteBc(bc);
          },
          title: "Supprimer le bon",
          style: {
            marginLeft: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#e74c3c',
            fontSize: 11,
            padding: 0
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-trash"
        }))), /*#__PURE__*/React.createElement("td", {
          style: {
            fontSize: 12
          }
        }, isFirst ? lieuDepart : ''), /*#__PURE__*/React.createElement("td", {
          style: {
            fontWeight: 600,
            fontSize: 12
          }
        }, parcelleNom(item ? item.parcelle || bc.parcelle : bc.parcelle) || '—'), /*#__PURE__*/React.createElement("td", {
          style: {
            fontSize: 12
          }
        }, item ? item.article || '—' : '—'), /*#__PURE__*/React.createElement("td", {
          style: {
            fontSize: 12
          }
        }, item ? item.unite || '—' : '—'), /*#__PURE__*/React.createElement("td", {
          style: {
            fontSize: 12,
            textAlign: 'right'
          }
        }, item && item.quantite != null ? item.quantite : '—'));
      });
    }), filteredBcs.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      colSpan: "7",
      style: {
        textAlign: 'center',
        color: 'var(--gray-400)',
        padding: 40
      }
    }, "Aucun bon de consommation ", label.toLowerCase(), "."))))), showScan && window.MagBCScanModal && React.createElement(window.MagBCScanModal, {
      // La modale de scan reçoit la liste d'AFFICHAGE (une entrée par
      // nom), comme avant ce ticket : son appariement se fait par nom.
      type,
      catalogueArticles: catalogueArticlesAffichage,
      getStock,
      catalogUnit,
      refForCampagne,
      parcelles,
      parcelleGroupes,
      parcelleNom,
      parcelleCulture,
      metaForParcelle,
      useConsoSelector,
      MAGASINS,
      STATIONS,
      currentProfile,
      profileData,
      // La campagne sélectionnée pilote DÉJÀ refForCampagne : elle
      // sert aussi de clé aux alias de parcelle mémorisés, pour
      // qu'un alias appris sur une campagne ne soit jamais
      // appliqué à la suivante (les parcelles changent).
      campagne: bcCampagne,
      onClose: () => setShowScan(false),
      onCreated: loadBcs
    }), showForm && /*#__PURE__*/React.createElement("div", {
      className: "modal-overlay"
    }, /*#__PURE__*/React.createElement("div", {
      className: "modal-content",
      style: {
        maxWidth: 800,
        maxHeight: '90vh',
        overflowY: 'auto'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: 'var(--berry)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: 'fa-solid ' + icon,
      style: {
        marginRight: 8
      }
    }), "Nouveau Bon de Consommation ", label), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        marginBottom: 16
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Lieu de d\xE9part *"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("select", {
      value: form.lieu_source_type,
      onChange: e => setForm({
        ...form,
        lieu_source_type: e.target.value,
        lieu_source_id: e.target.value === 'magasin' ? MAGASINS[0] : STATIONS[0]
      }),
      style: {
        padding: '8px 8px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 12
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: "magasin"
    }, "Magasin"), /*#__PURE__*/React.createElement("option", {
      value: "station"
    }, "Station")), /*#__PURE__*/React.createElement("select", {
      value: form.lieu_source_id,
      onChange: e => setForm({
        ...form,
        lieu_source_id: e.target.value
      }),
      style: {
        flex: 1,
        padding: '8px 8px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 12
      }
    }, (form.lieu_source_type === 'magasin' ? MAGASINS : STATIONS).map(l => /*#__PURE__*/React.createElement("option", {
      key: l,
      value: l
    }, l))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Date"), /*#__PURE__*/React.createElement("input", {
      type: "date",
      value: form.date,
      onChange: e => setForm({
        ...form,
        date: e.target.value
      }),
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    })), useConsoSelector && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Campagne"), /*#__PURE__*/React.createElement("select", {
      value: bcCampagne,
      onChange: e => setBcCampagne(e.target.value),
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    }, bcCampagnesDispo.map(c => /*#__PURE__*/React.createElement("option", {
      key: 'camp-' + c,
      value: c
    }, c)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Culture"), /*#__PURE__*/React.createElement("select", {
      value: bcCulture,
      onChange: e => changeBcCulture(e.target.value),
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "Toutes les cultures"), (window.CultureUtils && window.CultureUtils.CULTURES || []).map(c => /*#__PURE__*/React.createElement("option", {
      key: 'cult-' + c,
      value: c
    }, c))), aucuneParcellePourCulture && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: '#888',
        marginTop: 4
      }
    }, "Aucune parcelle pour cette culture"))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 16
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-paperclip",
      style: {
        marginRight: 4
      }
    }), "Scanner le bon de consommation"), /*#__PURE__*/React.createElement("input", {
      type: "file",
      accept: "image/*,application/pdf",
      onChange: e => {
        const f = e.target.files[0];
        if (f) {
          if (f.size > 10 * 1024 * 1024) {
            alert('Max 10 Mo');
            return;
          }
          const r = new FileReader();
          r.onload = ev => {
            setScanFileBC(ev.target.result);
            setScanPreviewBC(f.type.startsWith('image/') ? ev.target.result : f.name);
          };
          r.readAsDataURL(f);
        }
      },
      style: {
        fontSize: 12
      }
    }), scanPreviewBC && (typeof scanPreviewBC === 'string' && scanPreviewBC.startsWith('data:image') ? /*#__PURE__*/React.createElement("img", {
      src: scanPreviewBC,
      alt: "Scan",
      style: {
        maxHeight: 80,
        marginTop: 6,
        borderRadius: 6
      }
    }) : /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: 'var(--green)',
        marginLeft: 8
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-check"
    }), " Fichier s\xE9lectionn\xE9"))), /*#__PURE__*/React.createElement("h4", {
      style: {
        fontSize: 13,
        marginBottom: 8
      }
    }, "Articles a consommer"), /*#__PURE__*/React.createElement("table", {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 12
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
      style: {
        background: '#f8f8f8'
      }
    }, /*#__PURE__*/React.createElement("th", {
      style: {
        padding: '6px 8px',
        textAlign: 'left'
      }
    }, "Article"), /*#__PURE__*/React.createElement("th", {
      style: {
        padding: '6px 8px',
        textAlign: 'left',
        minWidth: 140
      }
    }, "Parcelle dest. *"), /*#__PURE__*/React.createElement("th", {
      style: {
        padding: '6px 8px',
        width: 70
      }
    }, "Qte"), /*#__PURE__*/React.createElement("th", {
      style: {
        padding: '6px 8px',
        width: 60
      }
    }, "Unite"), /*#__PURE__*/React.createElement("th", {
      style: {
        padding: '6px 8px',
        width: 70
      }
    }, "Stock"), /*#__PURE__*/React.createElement("th", {
      style: {
        width: 30
      }
    }))), /*#__PURE__*/React.createElement("tbody", null, form.items.map((it, idx) => {
      const dispo = getStock(it.article);
      const insuffisant = it.article && it.quantite && parseFloat(it.quantite) > dispo;
      return /*#__PURE__*/React.createElement("tr", {
        key: idx
      }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
        list: 'stock-list-' + type,
        value: it.article,
        onChange: e => {
          const val = e.target.value;
          const items = [...form.items];
          const next = {
            ...items[idx],
            article: val
          }; /* L'unité par défaut est celle du STOCK, écrite comme sur la fiche (« KG », pas « kg ») : c'est la valeur des options du sélecteur juste à côté. */
          const permises = unitesPourArticle(val);
          const u = permises.length ? permises[0] : catalogUnit(val);
          if (u) next.unite = u;
          items[idx] = next;
          setForm({
            ...form,
            items
          });
        },
        placeholder: "Article",
        style: {
          width: '100%',
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid #ddd',
          fontSize: 12
        }
      }), /*#__PURE__*/React.createElement("datalist", {
        id: 'stock-list-' + type
      }, catalogueArticlesAffichage.map(a => /*#__PURE__*/React.createElement("option", {
        key: a.id,
        value: a.nom
      }, a.nom, " (stock: ", getStock(a.nom), ")"))), (() => {
        const v = (it.article || '').trim();
        if (!v || catalogueArticles.some(a => a.nom.toLowerCase() === v.toLowerCase())) return null;
        // Achats/DG créent la fiche eux-mêmes ; le magasinier la DEMANDE.
        if (canCreateArticle) return /*#__PURE__*/React.createElement("button", {
          type: "button",
          onClick: () => openCreateArticle(idx, v),
          title: "Cr\xE9er cet article au catalogue",
          style: {
            marginTop: 3,
            padding: '2px 6px',
            borderRadius: 5,
            border: '1px dashed var(--berry)',
            background: 'var(--berry-pale)',
            color: 'var(--berry)',
            cursor: 'pointer',
            fontSize: 10,
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-plus",
          style: {
            marginRight: 3
          }
        }), "Cr\xE9er \xAB ", v.length > 18 ? v.slice(0, 18) + '…' : v, " \xBB");
        const envoyee = demandesEnvoyees.includes(v);
        return /*#__PURE__*/React.createElement("button", {
          type: "button",
          disabled: envoyee || demandeArticleEnCours === v,
          onClick: () => demanderCreationArticle(v),
          title: envoyee ? 'Demande déjà envoyée au DG' : 'Demander au DG de créer cet article au catalogue',
          style: {
            marginTop: 3,
            padding: '2px 6px',
            borderRadius: 5,
            border: '1px dashed #e67e22',
            background: '#fdf3e7',
            color: '#e67e22',
            cursor: envoyee ? 'default' : 'pointer',
            fontSize: 10,
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: 'fa-solid ' + (envoyee ? 'fa-check' : 'fa-paper-plane'),
          style: {
            marginRight: 3
          }
        }), envoyee ? 'Demande envoyée' : 'Demander la création au DG');
      })()), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("select", {
        value: it.groupe_id ? 'GRP::' + it.groupe_id : it.parcelle,
        onChange: e => selectParcelleForItem(idx, e.target.value),
        style: {
          width: '100%',
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid #ddd',
          fontSize: 11
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "-- Parcelle --"), parcelleGroupesCulture.length > 0 && /*#__PURE__*/React.createElement("optgroup", {
        label: "Groupes"
      }, parcelleGroupesCulture.map(g => /*#__PURE__*/React.createElement("option", {
        key: 'grp-' + g.id,
        value: 'GRP::' + g.id
      }, g.label, " (", (g.membres || []).length, " parcelles)"))), useConsoSelector ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("optgroup", {
        label: "Mes parcelles"
      }, refForCampagneCulture.map(p => /*#__PURE__*/React.createElement("option", {
        key: 'ref-' + p.label,
        value: p.label
      }, parcelleNom(p.label))))) : filteredParcellesCulture.map(p => /*#__PURE__*/React.createElement("option", {
        key: p.Parcelle_Physique,
        value: p.Parcelle_Physique
      }, parcelleNom(p.Parcelle_Physique), " \u2014 ", parcelleCulture(p.Parcelle_Physique, p.Culture) || '?'))), it.ferme && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 10,
          color: '#888',
          marginTop: 2
        }
      }, it.ferme, " \u2014 ", it.culture), it.groupe_id && (() => {
        // Aperçu LECTURE SEULE du split (le calcul qui fait foi est
        // refait côté backend à la création du bon).
        const g = parcelleGroupes.find(x => x.id === it.groupe_id);
        if (!g || !window.ParcelleGroupUtils) return null;
        const apercu = window.ParcelleGroupUtils.formatApercu(it.quantite, g.membres || [], it.unite);
        return /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--green)',
            marginTop: 2,
            fontWeight: 600
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-object-group",
          style: {
            marginRight: 4
          }
        }), apercu || 'Saisir une quantité pour voir la répartition');
      })()), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
        type: "number",
        value: it.quantite,
        onChange: e => updateItem(idx, 'quantite', e.target.value),
        style: {
          width: '100%',
          padding: '4px 8px',
          borderRadius: 6,
          border: insuffisant ? '2px solid #e74c3c' : '1px solid #ddd',
          fontSize: 12
        }
      }), (() => {
        // CE QUI SERA RÉELLEMENT DÉDUIT DU STOCK. Sans cette
        // ligne, le magasinier saisit 5 L et ne voit jamais que
        // 6,6 kg quittent le solde.
        const v = verdictLigne(it);
        if (!v || !v.converti) return null;
        return /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--green)',
            marginTop: 2,
            fontWeight: 600
          }
        }, "= ", v.quantite_stock, " ", v.unite_stock, " d\xE9duits du stock");
      })()), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("select", {
        className: "bc-unite-select",
        value: uniteEffective(it),
        onChange: e => updateItem(idx, 'unite', e.target.value),
        style: {
          width: '100%',
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid #ddd',
          fontSize: 12
        }
      }, optionsUnite(it).map(u => /*#__PURE__*/React.createElement("option", {
        key: u,
        value: u
      }, u))), (() => {
        // LE FILET. Unité différente de celle du stock et aucune
        // conversion exploitable : on ne bloque pas (décision
        // d'Omar), on NOMME l'article et les deux unités, et on
        // propose de renseigner la conversion sur-le-champ.
        const v = verdictLigne(it);
        if (!v || v.convertible || !it.article) return null;
        if (v.motif === UCU.MOTIFS.QUANTITE_INVALIDE) return null;
        // Fiches JUMELLES en désaccord : l'article existe, il est
        // seulement en double. Le dire « absent du catalogue »
        // enverrait le magasinier chercher un problème inexistant —
        // et ici la réparation est possible (renseigner la même
        // conversion sur toutes les fiches du nom).
        const ambigu = UCU.estAmbigu(uniteIndex, it.article);
        const inconnu = v.motif === UCU.MOTIFS.ARTICLE_INCONNU && !ambigu;
        return /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: '#a01d10',
            marginTop: 3,
            fontWeight: 600,
            lineHeight: 1.3
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-triangle-exclamation",
          style: {
            marginRight: 3
          }
        }), ambigu ? 'Plusieurs fiches « ' + it.article + ' » au catalogue, en désaccord sur la conversion : la quantité sera déduite telle quelle.' : inconnu ? 'Article absent du catalogue : la quantité sera déduite telle quelle.' : 'Saisi en ' + v.unite_saisie + ', stock tenu en ' + v.unite_stock + ' — conversion non renseignée. La quantité sera déduite telle quelle.', !inconnu && canSetConversion && /*#__PURE__*/React.createElement("button", {
          type: "button",
          onClick: () => openConversion(it.article),
          style: {
            display: 'block',
            marginTop: 3,
            padding: '2px 6px',
            borderRadius: 5,
            border: '1px dashed var(--berry)',
            background: 'var(--berry-pale)',
            color: 'var(--berry)',
            cursor: 'pointer',
            fontSize: 10,
            fontWeight: 600
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-right-left",
          style: {
            marginRight: 3
          }
        }), "Renseigner la conversion"));
      })()), /*#__PURE__*/React.createElement("td", {
        style: {
          textAlign: 'center',
          fontSize: 11,
          color: insuffisant ? '#e74c3c' : 'var(--green)',
          fontWeight: 600
        }
      }, it.article ? dispo : '—'), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
        onClick: () => removeItem(idx),
        style: {
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#e74c3c',
          fontSize: 13
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-trash"
      }))));
    }))), /*#__PURE__*/React.createElement("button", {
      onClick: addItem,
      style: {
        marginTop: 8,
        background: 'none',
        border: '1px dashed #ddd',
        borderRadius: 8,
        padding: '6px 16px',
        cursor: 'pointer',
        fontSize: 12,
        color: 'var(--blue)'
      }
    }, "+ Ajouter article"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        justifyContent: 'flex-end',
        marginTop: 16
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        clearBcDraft();
        setShowForm(false);
      },
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: '1px solid #ddd',
        background: '#fff',
        cursor: 'pointer',
        fontSize: 13
      }
    }, "Annuler"), /*#__PURE__*/React.createElement("button", {
      onClick: handleCreate,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: 'none',
        background: 'var(--berry)',
        color: '#fff',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13
      }
    }, "Creer le bon")))), conversionArticle && /*#__PURE__*/React.createElement("div", {
      className: "modal-overlay",
      style: {
        zIndex: 10003
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "modal-content",
      style: {
        maxWidth: 480,
        width: '92vw'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: 'var(--berry)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-right-left",
      style: {
        marginRight: 8
      }
    }), "Conversion d'unit\xE9"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--gray-400)',
        marginBottom: 4
      }
    }, "Article ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--berry)'
      }
    }, conversionArticle.nom), " \u2014 stock tenu en ", /*#__PURE__*/React.createElement("strong", null, conversionArticle.unite_stock || '—')), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--gray-400)',
        marginBottom: 8
      }
    }, "Seuls l'unit\xE9 de consommation et sa conversion sont modifi\xE9s. Le prix, la cat\xE9gorie et l'unit\xE9 de stock ne changent pas."), window.ArticleConversionFields && /*#__PURE__*/React.createElement(window.ArticleConversionFields, {
      uniteStock: conversionArticle.unite_stock,
      uniteConsommation: conversionForm.unite_consommation,
      facteur: conversionForm.stock_par_unite_consommation,
      disabled: conversionSaving,
      compact: true,
      onChange: patch => {
        setConversionForm({
          ...conversionForm,
          ...patch
        });
        setConversionError('');
      }
    }), conversionError && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        padding: '8px 10px',
        borderRadius: 8,
        background: '#fdecea',
        border: '1px solid #e74c3c',
        color: '#a01d10',
        fontSize: 12
      }
    }, conversionError), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        justifyContent: 'flex-end',
        marginTop: 16
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setConversionArticle(null),
      disabled: conversionSaving,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: '1px solid #ddd',
        background: '#fff',
        cursor: 'pointer',
        fontSize: 13
      }
    }, "Annuler"), /*#__PURE__*/React.createElement("button", {
      onClick: saveConversion,
      disabled: conversionSaving,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: 'none',
        background: 'var(--berry)',
        color: '#fff',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13
      }
    }, conversionSaving ? 'Enregistrement…' : 'Enregistrer la conversion')))), editDateBc && /*#__PURE__*/React.createElement("div", {
      className: "modal-overlay",
      style: {
        zIndex: 10002
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "modal-content",
      style: {
        maxWidth: 420,
        width: '90vw'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: 'var(--berry)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-calendar-day",
      style: {
        marginRight: 8
      }
    }), "Modifier la date"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--gray-400)',
        marginBottom: 12
      }
    }, "Bon ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--berry)'
      }
    }, editDateBc.numero || ''), " \u2014 date actuelle : ", /*#__PURE__*/React.createElement("strong", null, editDateBc.date || '—')), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--gray-400)',
        marginBottom: 12
      }
    }, "Seule la date est modifi\xE9e. Les articles, quantit\xE9s et parcelles restent inchang\xE9s."), /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Nouvelle date"), /*#__PURE__*/React.createElement("input", {
      type: "date",
      value: editDateValue,
      onChange: e => {
        setEditDateValue(e.target.value);
        setEditDateError('');
      },
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    }), editDateCampagne.changed && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        padding: '8px 10px',
        borderRadius: 8,
        background: '#fff4e5',
        border: '1px solid #ffb74d',
        color: '#8a4b00',
        fontSize: 12,
        fontWeight: 600
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-triangle-exclamation",
      style: {
        marginRight: 6
      }
    }), "Attention : ce bon change de campagne (", editDateCampagne.from, " \u2192 ", editDateCampagne.to, "). Les analyses par campagne en seront modifi\xE9es."), editDateError && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        padding: '8px 10px',
        borderRadius: 8,
        background: '#fdecea',
        border: '1px solid #e74c3c',
        color: '#a01d10',
        fontSize: 12
      }
    }, editDateError), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        justifyContent: 'flex-end',
        marginTop: 16
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: closeEditDate,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: '1px solid #ddd',
        background: '#fff',
        cursor: 'pointer',
        fontSize: 13
      }
    }, "Annuler"), /*#__PURE__*/React.createElement("button", {
      onClick: submitEditDate,
      disabled: editDateSaving || !editDateValue,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: 'none',
        background: 'var(--berry)',
        color: '#fff',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13,
        opacity: editDateSaving || !editDateValue ? 0.6 : 1
      }
    }, editDateSaving ? 'Enregistrement...' : 'Confirmer la date')))), doublonBc && window.BCDoublonDialog && /*#__PURE__*/React.createElement(window.BCDoublonDialog, {
      doublon: doublonBc,
      onCancel: () => setDoublonBc(null),
      onForce: forcerCreationDoublon
    }), deleteBc && /*#__PURE__*/React.createElement("div", {
      className: "modal-overlay",
      style: {
        zIndex: 10002
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "modal-content",
      style: {
        maxWidth: 440,
        width: '90vw'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: '#a01d10'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-trash",
      style: {
        marginRight: 8
      }
    }), "Supprimer le bon"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--gray-400)',
        marginBottom: 12
      }
    }, "Bon ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--berry)'
      }
    }, deleteBc.numero || ''), " \u2014 date : ", /*#__PURE__*/React.createElement("strong", null, deleteBc.date || '—')), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '8px 10px',
        borderRadius: 8,
        background: '#fff4e5',
        border: '1px solid #ffb74d',
        color: '#8a4b00',
        fontSize: 12,
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-triangle-exclamation",
      style: {
        marginRight: 6
      }
    }), "Les quantit\xE9s de ce bon ", /*#__PURE__*/React.createElement("strong", null, "reviennent en stock"), " : la consommation est annul\xE9e, et le bon dispara\xEEt des listes et des analyses."), /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Motif de la suppression *"), /*#__PURE__*/React.createElement("input", {
      value: deleteMotif,
      onChange: e => {
        setDeleteMotif(e.target.value);
        setDeleteError('');
      },
      placeholder: "Ex. : doublon de BC-2026-0032",
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    }), deleteError && !deleteConfirmBc && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        padding: '8px 10px',
        borderRadius: 8,
        background: '#fdecea',
        border: '1px solid #e74c3c',
        color: '#a01d10',
        fontSize: 12
      }
    }, deleteError), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        justifyContent: 'flex-end',
        marginTop: 16
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: closeDeleteBc,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: '1px solid #ddd',
        background: '#fff',
        cursor: 'pointer',
        fontSize: 13
      }
    }, "Annuler"), /*#__PURE__*/React.createElement("button", {
      onClick: nextDeleteStep,
      disabled: deleteSaving || !deleteMotifValide,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: 'none',
        background: '#e74c3c',
        color: '#fff',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13,
        opacity: deleteSaving || !deleteMotifValide ? 0.6 : 1
      }
    }, deleteSaving ? 'Suppression...' : 'Supprimer ce bon')))), deleteConfirmBc && /*#__PURE__*/React.createElement("div", {
      className: "modal-overlay",
      style: {
        zIndex: 10003
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "modal-content",
      style: {
        maxWidth: 460,
        width: '90vw'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: '#a01d10'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-triangle-exclamation",
      style: {
        marginRight: 8
      }
    }), "Confirmer la suppression"), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '10px 12px',
        borderRadius: 8,
        background: '#fdecea',
        border: '1px solid #e74c3c',
        color: '#a01d10',
        fontSize: 12,
        marginBottom: 12
      }
    }, "Le bon ", /*#__PURE__*/React.createElement("strong", null, deleteNumeroAttendu), " va dispara\xEEtre de la liste", deleteLignes > 0 && /*#__PURE__*/React.createElement("span", null, " (", deleteLignes, " ", deleteLignes > 1 ? 'lignes' : 'ligne', ")"), ", et les quantit\xE9s ", /*#__PURE__*/React.createElement("strong", null, "reviennent en stock"), " : la consommation est annul\xE9e."), /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Retapez le num\xE9ro du bon pour confirmer"), /*#__PURE__*/React.createElement("input", {
      value: deleteNumeroSaisi,
      onChange: e => {
        setDeleteNumeroSaisi(e.target.value);
        setDeleteError('');
      },
      placeholder: deleteNumeroAttendu,
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    }), !deleteNumeroOk && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--gray-400)',
        marginTop: 4
      }
    }, "Saisie exacte attendue : ", /*#__PURE__*/React.createElement("strong", null, deleteNumeroAttendu)), deleteError && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        padding: '8px 10px',
        borderRadius: 8,
        background: '#fdecea',
        border: '1px solid #e74c3c',
        color: '#a01d10',
        fontSize: 12
      }
    }, deleteError), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        justifyContent: 'flex-end',
        marginTop: 16
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: closeDeleteConfirm,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: '1px solid #ddd',
        background: '#fff',
        cursor: 'pointer',
        fontSize: 13
      }
    }, "Annuler"), /*#__PURE__*/React.createElement("button", {
      onClick: submitDeleteBc,
      disabled: deleteSaving || !deleteNumeroOk,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: 'none',
        background: '#e74c3c',
        color: '#fff',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13,
        opacity: deleteSaving || !deleteNumeroOk ? 0.6 : 1
      }
    }, deleteSaving ? 'Suppression...' : 'Supprimer définitivement')))), showCreateArticle && /*#__PURE__*/React.createElement("div", {
      className: "modal-overlay",
      style: {
        zIndex: 10001
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "modal-content",
      style: {
        maxWidth: 500,
        width: '90vw'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: 'var(--berry)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-box",
      style: {
        marginRight: 8
      }
    }), "Nouvel Article"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "R\xE9f\xE9rence *"), /*#__PURE__*/React.createElement("input", {
      value: newArticle.reference,
      onChange: e => setNewArticle({
        ...newArticle,
        reference: e.target.value
      }),
      placeholder: "REF-001",
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Nom *"), /*#__PURE__*/React.createElement("input", {
      value: newArticle.nom,
      onChange: e => setNewArticle({
        ...newArticle,
        nom: e.target.value
      }),
      placeholder: "Nom de l'article",
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Unit\xE9"), /*#__PURE__*/React.createElement("select", {
      value: newArticle.unite,
      onChange: e => setNewArticle({
        ...newArticle,
        unite: e.target.value
      }),
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: "kg"
    }, "kg"), /*#__PURE__*/React.createElement("option", {
      value: "L"
    }, "L"), /*#__PURE__*/React.createElement("option", {
      value: "unit\xE9"
    }, "unit\xE9"), /*#__PURE__*/React.createElement("option", {
      value: "carton"
    }, "carton"), /*#__PURE__*/React.createElement("option", {
      value: "sac"
    }, "sac"), /*#__PURE__*/React.createElement("option", {
      value: "bidon"
    }, "bidon"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Cat\xE9gorie"), /*#__PURE__*/React.createElement("select", {
      value: newArticle.categorie,
      onChange: e => setNewArticle({
        ...newArticle,
        categorie: e.target.value
      }),
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: "autre"
    }, "Autre"), /*#__PURE__*/React.createElement("option", {
      value: "engrais"
    }, "Engrais"), /*#__PURE__*/React.createElement("option", {
      value: "phyto"
    }, "Phyto"), /*#__PURE__*/React.createElement("option", {
      value: "emballage"
    }, "Emballage"), /*#__PURE__*/React.createElement("option", {
      value: "materiel"
    }, "Mat\xE9riel"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "TVA %"), /*#__PURE__*/React.createElement("select", {
      value: newArticle.taux_tva,
      onChange: e => setNewArticle({
        ...newArticle,
        taux_tva: parseFloat(e.target.value)
      }),
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: 0
    }, "0%"), /*#__PURE__*/React.createElement("option", {
      value: 7
    }, "7%"), /*#__PURE__*/React.createElement("option", {
      value: 10
    }, "10%"), /*#__PURE__*/React.createElement("option", {
      value: 14
    }, "14%"), /*#__PURE__*/React.createElement("option", {
      value: 20
    }, "20%")))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        justifyContent: 'flex-end'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setShowCreateArticle(false);
        setCreateArticleLineIdx(null);
      },
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: '1px solid #ddd',
        background: '#fff',
        cursor: 'pointer',
        fontSize: 13
      }
    }, "Annuler"), /*#__PURE__*/React.createElement("button", {
      onClick: handleCreateArticle,
      disabled: creatingArt,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: 'none',
        background: 'var(--berry)',
        color: '#fff',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13,
        opacity: creatingArt ? 0.6 : 1
      }
    }, creatingArt ? 'Création...' : 'Créer l\'article')))), detailBc && (() => {
      const bc = detailBc;
      // Fenêtre de plausibilité [2000-01-01, 2100-01-01) en ms : sert à
      // trancher l'unité d'un horodatage numérique SANS deviner. En base,
      // created_at est un nombre de MILLISECONDES (ex. 1787672414121), mais
      // d'autres horodatages du dépôt sont en SECONDES. Hors de la fenêtre
      // dans les deux unités (0, NaN, valeur aberrante) → on n'affiche rien,
      // plutôt qu'une date de 1970, de l'an 58000 ou un « Invalid Date ».
      const TS_MIN_MS = 946684800000; // 2000-01-01T00:00:00Z
      const TS_MAX_MS = 4102444800000; // 2100-01-01T00:00:00Z
      const msFromNumber = n => {
        if (n >= TS_MIN_MS && n < TS_MAX_MS) return n;
        if (n * 1000 >= TS_MIN_MS && n * 1000 < TS_MAX_MS) return n * 1000;
        return null;
      };
      const fmtTs = v => {
        if (!v) return null;
        try {
          if (typeof v === 'string') return v.length > 10 ? new Date(v).toLocaleString('fr-FR') : v;
          if (typeof v === 'number') {
            const ms = msFromNumber(v);
            return ms == null ? null : new Date(ms).toLocaleString('fr-FR');
          }
          if (v.seconds != null) return new Date(v.seconds * 1000).toLocaleString('fr-FR');
          if (v._seconds != null) return new Date(v._seconds * 1000).toLocaleString('fr-FR');
          if (v instanceof Date) return v.toLocaleString('fr-FR');
        } catch (e) {
          return null;
        }
        return null;
      };
      const items = bc.items || [];
      const hasParcelle = items.some(i => i.parcelle);
      const hasCulture = items.some(i => i.culture);
      const scan = bc.scan_url || '';
      const isHttpScan = /^https?:\/\//i.test(scan);
      const isImgScan = isHttpScan && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(scan);
      const isGsScan = /^gs:\/\//i.test(scan);
      const infoRow = (lbl, value) => value == null || value === '' ? null : /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: 8,
          padding: '3px 0'
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          minWidth: 140,
          color: 'var(--gray-400)',
          fontSize: 12
        }
      }, lbl), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          fontWeight: 600,
          color: '#1e293b'
        }
      }, value));
      return /*#__PURE__*/React.createElement("div", {
        onClick: () => setDetailBc(null),
        style: {
          position: 'fixed',
          inset: 0,
          background: 'rgba(15,23,42,0.55)',
          backdropFilter: 'blur(2px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }
      }, /*#__PURE__*/React.createElement("div", {
        onClick: e => e.stopPropagation(),
        style: {
          background: '#fff',
          borderRadius: 12,
          maxWidth: 640,
          width: '100%',
          maxHeight: '85vh',
          overflow: 'auto',
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          gap: 12
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap'
        }
      }, /*#__PURE__*/React.createElement("h3", {
        style: {
          margin: 0,
          color: 'var(--berry)'
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: 'fa-solid ' + icon,
        style: {
          marginRight: 8
        }
      }), "Bon de Consommation ", bc.numero || ''), bc.status && /*#__PURE__*/React.createElement("span", {
        className: "status-badge",
        style: {
          fontSize: 10
        }
      }, bc.status)), /*#__PURE__*/React.createElement("button", {
        onClick: () => setDetailBc(null),
        style: {
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 20,
          color: 'var(--gray-400)',
          lineHeight: 1
        },
        title: "Fermer"
      }, "\u2715")), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: 16
        }
      }, infoRow('Date', bc.date), infoRow('Lieu départ', bc.lieu_source?.id || bc.lieu_source_id), infoRow('Ferme', bc.ferme), infoRow('Type', bc.type), infoRow('Créé par', bc.created_by?.name), infoRow('Saisi le', fmtTs(bc.created_at)), infoRow('Autorisé par', bc.authorized_by?.name)), items.length > 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: 16
        }
      }, /*#__PURE__*/React.createElement("h4", {
        style: {
          fontSize: 13,
          margin: '0 0 8px'
        }
      }, "Articles"), /*#__PURE__*/React.createElement("table", {
        style: {
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12
        }
      }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
        style: {
          background: '#f8f8f8',
          textAlign: 'left'
        }
      }, /*#__PURE__*/React.createElement("th", {
        style: {
          padding: '6px 8px'
        }
      }, "Article"), /*#__PURE__*/React.createElement("th", {
        style: {
          padding: '6px 8px',
          textAlign: 'right'
        }
      }, "Quantit\xE9"), /*#__PURE__*/React.createElement("th", {
        style: {
          padding: '6px 8px'
        }
      }, "Unit\xE9"), hasParcelle && /*#__PURE__*/React.createElement("th", {
        style: {
          padding: '6px 8px'
        }
      }, "Parcelle"), hasCulture && /*#__PURE__*/React.createElement("th", {
        style: {
          padding: '6px 8px'
        }
      }, "Culture"))), /*#__PURE__*/React.createElement("tbody", null, items.map((i, idx) => /*#__PURE__*/React.createElement("tr", {
        key: idx,
        style: {
          borderBottom: '1px solid #f0f0f0'
        }
      }, /*#__PURE__*/React.createElement("td", {
        style: {
          padding: '6px 8px'
        }
      }, i.article || '—'), /*#__PURE__*/React.createElement("td", {
        style: {
          padding: '6px 8px',
          textAlign: 'right'
        }
      }, i.quantite != null ? i.quantite : '—'), /*#__PURE__*/React.createElement("td", {
        style: {
          padding: '6px 8px'
        }
      }, i.unite || '—'), hasParcelle && /*#__PURE__*/React.createElement("td", {
        style: {
          padding: '6px 8px'
        }
      }, parcelleNom(i.parcelle) || '—'), hasCulture && /*#__PURE__*/React.createElement("td", {
        style: {
          padding: '6px 8px'
        }
      }, i.culture || '—')))))), scan && /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: 16
        }
      }, /*#__PURE__*/React.createElement("h4", {
        style: {
          fontSize: 13,
          margin: '0 0 8px'
        }
      }, "Scan du bon"), isImgScan ? /*#__PURE__*/React.createElement("a", {
        href: scan,
        target: "_blank",
        rel: "noopener noreferrer"
      }, /*#__PURE__*/React.createElement("img", {
        src: scan,
        alt: "Scan du bon",
        style: {
          maxWidth: '100%',
          maxHeight: 280,
          borderRadius: 8,
          border: '1px solid #eee',
          cursor: 'zoom-in'
        }
      })) : isHttpScan ? /*#__PURE__*/React.createElement("a", {
        href: scan,
        target: "_blank",
        rel: "noopener noreferrer",
        style: {
          color: 'var(--blue)',
          fontSize: 12
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-paperclip",
        style: {
          marginRight: 6
        }
      }), "Voir le scan") : isGsScan ? /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          color: 'var(--gray-400)'
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-paperclip",
        style: {
          marginRight: 6
        }
      }), "Scan disponible (stockage interne)") : /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          color: 'var(--gray-400)'
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-paperclip",
        style: {
          marginRight: 6
        }
      }), "Scan disponible"))));
    })());
  }
  window.MagBCTab = MagBCTab;
  window.MagBCEngraisTab = MagBCEngraisTab;
  window.MagBCPhytoTab = MagBCPhytoTab;
})();
