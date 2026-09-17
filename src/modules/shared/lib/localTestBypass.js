/**
 * localTestBypass.js — Local-only auth & API bypass for UI testing.
 *
 * Activation:
 *   http://localhost:<port>/?testui=1
 *
 * Refuses to do anything unless:
 *   - window.location.hostname === 'localhost' OR '127.0.0.1'
 *   - URL search params contain testui=1
 *   (or the DEMO build: `DEMO_NO_AUTH=1 npm run build:vercel` defines
 *   __SB_DEMO_NO_AUTH__ at compile time — cf. vite.config.js — and both guards
 *   are neutralised: the demo runs without login on the preview domain.)
 *
 * What it does:
 *   1. Monkey-patches firebaseAuth.onAuthStateChanged to immediately fire
 *      with a fake "Test DG" user → bypasses LoginScreen.
 *   2. Intercepts window.fetch on '/api/auth?action=me' and '/api/caisse?action=...'
 *      to return canned mock responses (~30 sample transactions with varied
 *      anomaly cases — Sprint 1 + Sprint 2 — across 4 caisses).
 *   3. Write-side actions (validate, mark-revoir, reassign, accept) return a
 *      synthetic success WITHOUT changing the mock data, so the UI flow can
 *      be walked end-to-end without any real backend.
 *
 * Why this file is safe to commit:
 *   - First instruction is a hostname + query-string guard. On prod, nothing happens.
 *   - All mocks are local in this file. Zero impact on real Firestore.
 *   - Imported FIRST by src/modules/bootstrap.jsx (side-effect module), so the
 *     patches are applied before the app captures window.fetch and reads
 *     firebaseAuth.
 */

/** Build de démo (DEMO_NO_AUTH=1) : gardes neutralisées à la compilation. */
var DEMO = typeof __SB_DEMO_NO_AUTH__ !== 'undefined' && !!__SB_DEMO_NO_AUTH__;

function installLocalTestBypass() {
  // ---- Guard: hostname + query string ----
  if (typeof window === 'undefined') return;
  var host = (window.location && window.location.hostname) || '';
  var isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  if (!isLocalHost && !DEMO) return;
  var params;
  try { params = new URLSearchParams(window.location.search); }
  catch (_) { return; }
  if (params.get('testui') !== '1' && !DEMO) return;

  console.warn('[testui] LOCAL-ONLY UI BYPASS ACTIVE — auth mocked, /api/* intercepted, write-side actions are no-ops.');

  // ---- Visible badge ----
  function showBadge() {
    var b = document.createElement('div');
    b.id = 'testui-badge';
    b.textContent = DEMO
      ? 'DÉMO — sans authentification · données fictives · non contractuel'
      : 'TESTUI — Auth bypass actif (no backend)';
    b.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:99999;padding:4px 10px;border-radius:6px;background:#92400E;color:#fff;font:600 11px/1.2 Inter,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.2);pointer-events:none;';
    if (document.body) document.body.appendChild(b);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(b); });
  }
  showBadge();
  // [DÉMO] onglet d'accueil lisible : 'dashboard' tombe en ErrorBoundary sans
  // données Firestore. On pré-remplit localStorage avant le boot de l'app.
  if (DEMO) { try { if (!localStorage.getItem('lastTab')) localStorage.setItem('lastTab', 'pointage'); } catch (e) {} }

  // ---- Fake Firebase user ----
  var FAKE_USER = {
    uid: 'testui-uid',
    email: 'testui@local.dev',
    displayName: 'Test DG (Local)',
    emailVerified: true,
    getIdToken: function () { return Promise.resolve('testui-fake-token'); },
    getIdTokenResult: function () { return Promise.resolve({ token: 'testui-fake-token', claims: {} }); },
  };

  var FAKE_USER_PROFILE = {
    uid: 'testui-uid',
    email: 'testui@local.dev',
    name: 'Test DG (Local)',
    fullName: 'Test DG (Local)',
    profileId: 'dg',
    role: 'admin',
  };

  // ---- Patch firebaseAuth as soon as it exists ----
  function patchAuth() {
    var fa = window.firebaseAuth;
    if (!fa) { setTimeout(patchAuth, 30); return; }
    // Stub currentUser
    try { Object.defineProperty(fa, 'currentUser', { configurable: true, get: function () { return FAKE_USER; } }); }
    catch (_) { fa.currentUser = FAKE_USER; }
    // Intercept onAuthStateChanged
    fa.onAuthStateChanged = function (cb) {
      setTimeout(function () { try { cb(FAKE_USER); } catch (e) { console.error('[testui] auth cb error', e); } }, 0);
      return function () {};
    };
    fa.signOut = function () {
      console.warn('[testui] signOut() ignored (bypass mode)');
      return Promise.resolve();
    };
  }
  patchAuth();

  // ---- Mock dataset ----
  var DEFAULT_CAISSES = [
    { id: 'caisse_depenses',          nom: 'Caisse Dépenses',          description: 'Dépenses courantes',  solde_initial: 0, solde_actuel:  17363.43, devise: 'MAD', is_default: true,  active: true },
    { id: 'caisse_paie',              nom: 'Caisse Paie',              description: 'Paie ouvriers',       solde_initial: 0, solde_actuel: -23344.54, devise: 'MAD', is_default: true,  active: true },
    { id: 'caisse_marche_local_f1',   nom: 'Caisse Marché Local F1',   description: 'Marché local F1',     solde_initial: 0, solde_actuel:      0,    devise: 'MAD', is_default: true,  active: true },
    { id: 'caisse_marche_local_f5',   nom: 'Caisse Marché Local F5',   description: 'Marché local F5',     solde_initial: 0, solde_actuel:      0,    devise: 'MAD', is_default: true,  active: true },
    { id: 'caisse_depenses_bahia',    nom: 'Caisse Dépenses Bahia',    description: 'Ferme Bahia',         solde_initial: 0, solde_actuel: -205138.96, devise: 'MAD', is_default: false, active: true },
  ];

  // 30 sample transactions — mix of statuses, types, anomalies (S1 + S2)
  function buildSampleTransactions() {
    var s = [];
    var iso = function (y, m, d) {
      return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
    };
    function add(tx) { s.push(Object.assign({ id: 'testui-tx-' + s.length, reference: 'REF-' + (1000 + s.length), saisie_by: { uid: 'achraf-uid', name: 'Achraf', email: 'achraf@local' }, files: [] }, tx)); }

    // --- Sample baseline (clean transactions) ---
    add({ caisse_id: 'caisse_depenses', type: 'depense',     montant: 442,   date: iso(2026, 5, 12), description: '40L GASOIL voiture 19461-B-33',  code_analytique: 'BGF - BGF',                status: 'valide',   fournisseur: 'TOTAL AL BOUSTANE' });
    add({ caisse_id: 'caisse_depenses', type: 'depense',     montant: 165,   date: iso(2026, 5, 12), description: '9 kg graisse pour station',      code_analytique: 'FRAMBOISE - Ferme 01',     status: 'valide',   fournisseur: 'Droguerie LAOUAMRA' });
    add({ caisse_id: 'caisse_depenses', type: 'alimentation', montant: 50000, date: iso(2026, 5, 11), description: 'Alimentation virement banque',   code_analytique: 'BGF - BGF',                status: 'valide',   fournisseur: 'Virement BMCE' });
    add({ caisse_id: 'caisse_depenses', type: 'depense',     montant: 1200,  date: iso(2026, 5, 11), description: 'Achat pièces réparation tracteur', code_analytique: 'FRAMBOISE - Ferme 05',    status: 'soumis',   fournisseur: 'Atelier Mehdi' });
    add({ caisse_id: 'caisse_paie',     type: 'alimentation', montant: 170000, date: iso(2026, 5, 10), description: 'Alimentation virement banque',  code_analytique: 'Salaires - Paie',          status: 'valide',   fournisseur: 'Virement BMCE' });
    add({ caisse_id: 'caisse_paie',     type: 'depense',     montant: 168676, date: iso(2026, 5, 10), description: 'Paiement salaires 1Q05/2026',   code_analytique: 'Salaires - Paie',          status: 'valide',   fournisseur: 'Ouvriers BGF' });

    // --- Sprint 1 anomalies ---
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 75000, date: iso(2026, 5, 10), description: 'Achat 12 tonnes engrais NPK',     code_analytique: 'FRAMBOISE - Ferme 01', status: 'soumis', fournisseur: 'SOPREM' }); // MONTANT_INHABITUEL (>50k)
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 250, date: iso(2055, 8, 14), description: 'Réparation pompe',                code_analytique: 'FRAMBOISE - Ferme 05', status: 'soumis', fournisseur: 'Atelier' }); // DATE_ABERRANTE
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 90,  date: iso(2026, 5, 9),  description: 'X',                               code_analytique: 'BGF - BGF',          status: 'brouillon', fournisseur: 'TOTAL' }); // DESCRIPTION_COURTE + ANALYTIQUE_VIDE
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 600, date: iso(2026, 5, 9),  description: 'Avance Achraf',                  code_analytique: '',                   status: 'soumis',    fournisseur: 'Achraf' }); // ANALYTIQUE_VIDE

    // --- Sprint 2 — DOUBLON_PROBABLE (paire) ---
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 500, date: iso(2026, 5, 8), description: 'Achat gasoil tracteur',  code_analytique: 'FRAMBOISE - Ferme 01', status: 'soumis', fournisseur: 'TOTAL' });
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 500, date: iso(2026, 5, 8), description: 'Achat gasoll tracteur',  code_analytique: 'FRAMBOISE - Ferme 01', status: 'soumis', fournisseur: 'TOTAL' }); // doublon (1 typo)

    // --- Sprint 2 — DOUBLON cluster de 3 ---
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 200, date: iso(2026, 5, 7), description: 'Achat divers droguerie', code_analytique: 'BGF - BGF', status: 'soumis', fournisseur: 'Droguerie' });
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 200, date: iso(2026, 5, 7), description: 'Achat divers droguerie', code_analytique: 'BGF - BGF', status: 'soumis', fournisseur: 'Droguerie' });
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 200, date: iso(2026, 5, 8), description: 'Achat divers droguerie', code_analytique: 'BGF - BGF', status: 'soumis', fournisseur: 'Droguerie' });

    // --- Sprint 2 — MONTANT_ATYPIQUE (montant >> 3× moyenne sur même analytique) ---
    // baseline pour analytique "Petites fournitures"
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 100, date: iso(2026, 4, 28), description: 'Papier toilette',     code_analytique: 'Petites fournitures', status: 'valide', fournisseur: 'Droguerie' });
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 120, date: iso(2026, 4, 29), description: 'Stylos bureau',       code_analytique: 'Petites fournitures', status: 'valide', fournisseur: 'Librairie AYA' });
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant:  80, date: iso(2026, 5, 1),  description: 'Cahiers reportage',   code_analytique: 'Petites fournitures', status: 'valide', fournisseur: 'Librairie AYA' });
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 1500, date: iso(2026, 5, 6), description: 'Lot fournitures bureau et matériel', code_analytique: 'Petites fournitures', status: 'soumis', fournisseur: 'Bureau Pro' }); // atypique (>>3× moyenne 100)

    // --- Sprint 2 — DESCRIPTION_GENERIQUE ---
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 300, date: iso(2026, 5, 5), description: 'avance',             code_analytique: 'FRAMBOISE - Ferme 05', status: 'soumis', fournisseur: 'Achraf' });
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 450, date: iso(2026, 5, 5), description: 'frais',              code_analytique: 'FRAMBOISE - Ferme 05', status: 'soumis', fournisseur: '?' });

    // --- Sprint 2 — BENEFICIAIRE_IMPRECIS ---
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 200, date: iso(2026, 5, 4), description: 'AVANCE Sur OK',           code_analytique: 'FRAMBOISE - Ferme 05', status: 'soumis', fournisseur: '?' }); // pas de token >3 chars capitalisé
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 350, date: iso(2026, 5, 4), description: 'PAIEMENT pour quelqu un', code_analytique: 'FRAMBOISE - Ferme 05', status: 'soumis', fournisseur: '?' });

    // --- Sprint 2 — INCOHERENCE_CAISSE_ANALYTIQUE (caisse Bahia + analytique non-Bahia) ---
    add({ caisse_id: 'caisse_depenses_bahia', type: 'depense', montant: 600, date: iso(2026, 5, 3), description: 'Achat ficelle B6',          code_analytique: 'Exploitation Ferme - Gasoil', status: 'soumis', fournisseur: 'Sté oum jihad' });
    add({ caisse_id: 'caisse_depenses_bahia', type: 'depense', montant: 1200, date: iso(2026, 5, 3), description: 'Pesticides B7',            code_analytique: 'Phytosanitaire',              status: 'soumis', fournisseur: 'Agriphyto' });
    // celle-ci est OK (analytique BAHIA)
    add({ caisse_id: 'caisse_depenses_bahia', type: 'depense', montant: 800, date: iso(2026, 5, 2), description: 'Achat gasoil tracteur B7', code_analytique: 'BAHIA - Exploitation B7',     status: 'valide', fournisseur: 'TOTAL' });

    // --- Anomalies déjà acceptées (badge ℹ au lieu de 🚩) ---
    add({
      caisse_id: 'caisse_depenses', type: 'depense', montant: 65000, date: iso(2026, 5, 2),
      description: 'Achat pesticides 5L SCORE + RADIANT',
      code_analytique: 'Phytosanitaire', status: 'valide', fournisseur: 'Agriphyto',
      anomalies_acceptees_par: { uid: 'dg-uid', name: 'Direction Générale' },
      anomalies_acceptees_at: Date.now() - 86400000,
    }); // MONTANT_INHABITUEL acceptée

    // --- Quelques rejets et a_revoir pour tester les couleurs de statut ---
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 1500, date: iso(2026, 5, 1), description: 'Réparation atelier mécanique', code_analytique: 'FRAMBOISE - Ferme 01', status: 'a_revoir', fournisseur: 'Atelier Mehdi' });
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 2000, date: iso(2026, 4, 30), description: 'Frais notaire (à justifier)',  code_analytique: 'BGF - BGF',          status: 'rejete',   fournisseur: 'Notaire' });
    add({ caisse_id: 'caisse_depenses', type: 'depense', montant: 500,  date: iso(2026, 4, 29), description: 'Test brouillon',               code_analytique: 'BGF - BGF',          status: 'brouillon', fournisseur: 'TEST' });

    return s;
  }

  var MOCK_TRANSACTIONS = buildSampleTransactions();

  // ---- Mock dashboard summary ----
  function buildDashboard() {
    var pending = MOCK_TRANSACTIONS.filter(function (t) { return t.status === 'soumis'; }).length;
    var alim = MOCK_TRANSACTIONS
      .filter(function (t) { return t.status === 'valide' && t.type === 'alimentation'; })
      .reduce(function (s, t) { return s + (t.montant || 0); }, 0);
    var dep = MOCK_TRANSACTIONS
      .filter(function (t) { return t.status === 'valide' && (t.type === 'depense' || t.type === 'sortie'); })
      .reduce(function (s, t) { return s + (t.montant || 0); }, 0);
    return {
      success: true,
      caisses: DEFAULT_CAISSES,
      pendingCount: pending,
      weekAlimentations: alim,
      weekDepenses: dep,
      recentTx: MOCK_TRANSACTIONS.slice(0, 10),
    };
  }

  // ---- Fetch interception ----
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function applyFilters(list, qp) {
    var caisseId = qp.get('caisse_id');
    var status = qp.get('status');
    var dateFrom = qp.get('date_from');
    var dateTo = qp.get('date_to');
    var out = list.slice();
    if (caisseId) out = out.filter(function (t) { return t.caisse_id === caisseId; });
    if (status)   out = out.filter(function (t) { return t.status === status; });
    if (dateFrom) out = out.filter(function (t) { return t.date >= dateFrom; });
    if (dateTo)   out = out.filter(function (t) { return t.date <= dateTo; });
    return out;
  }

  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    if (!/^\/api\//.test(url)) return origFetch ? origFetch(input, init) : Promise.reject(new Error('no fetch'));

    var u;
    try { u = new URL(url, window.location.origin); } catch (_) { u = null; }
    if (!u) return jsonResponse({ success: false, error: 'testui: bad url' }, 400);
    var path = u.pathname;
    var qp = u.searchParams;
    var action = qp.get('action') || '';
    var method = (init && init.method) || 'GET';

    // /api/auth?action=me — return mock profile
    if (path === '/api/auth' && action === 'me') {
      return Promise.resolve(jsonResponse({ success: true, user: FAKE_USER_PROFILE }));
    }

    // /api/caisse
    if (path === '/api/caisse') {
      // Read-side
      if (action === 'dashboard') return Promise.resolve(jsonResponse(buildDashboard()));
      if (action === 'list-caisses') return Promise.resolve(jsonResponse({ success: true, caisses: DEFAULT_CAISSES }));
      if (action === 'list-transactions') {
        var limit = parseInt(qp.get('limit') || '500', 10);
        var filtered = applyFilters(MOCK_TRANSACTIONS, qp);
        filtered.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
        return Promise.resolve(jsonResponse({ success: true, transactions: filtered.slice(0, limit) }));
      }
      if (action === 'weekly-report') return Promise.resolve(jsonResponse({ success: true, weekStart: qp.get('week_start'), weekEnd: qp.get('week_start'), report: [] }));

      // Write-side: synthetic OK without mutating data
      var writeActions = [
        'validate-transactions-batch', 'mark-revoir-batch', 'reassign-analytique-batch',
        'accept-anomalies-batch',
        'create-transaction', 'update-transaction', 'submit-transaction', 'delete-transaction',
        'validate-transaction', 'reject-transaction', 'create-transfer',
        'create-caisse', 'update-caisse', 'seed-defaults',
        'import-excel-file', 'bulk-import-transactions',
      ];
      if (writeActions.indexOf(action) !== -1 && method === 'POST') {
        console.warn('[testui] POST /api/caisse?action=' + action + ' — no-op (bypass)');
        var ids = (init && init.body) ? (function () { try { return JSON.parse(init.body).ids || []; } catch (_) { return []; } })() : [];
        return Promise.resolve(jsonResponse({ success: true, count: ids.length, updated: ids.length, skipped: 0, errors: [], note: 'testui-bypass-noop' }));
      }
    }

    // Any other /api/* — return synthetic empty success
    if (DEMO) {
      // [DÉMO] route non mockée : succès avec des tableaux/objets vides BIEN
      // FORMÉS, sinon l'app enregistre un objet sans ses tableaux puis lit
      // .length dessus → ErrorBoundary sur 5 écrans. `data` reste un OBJET :
      // sur un tableau, `.entries` résout vers Array.prototype.entries.
      return Promise.resolve(jsonResponse({ success: true, _testui: true, note: 'unmocked-api-route',
        rows: [], workers: [], cueillette: [], periodes: [], equipes: [],
        items: [], list: [], transactions: [], caisses: [], data: {},
        anomalies: [], cartes: [], lignes: [], factures: [],
        summary: { totalQuinzaine: 0, totalToday: 0, total: 0 },
        byFerme: {}, parFerme: [], totaux: {}, stats: {}, mapping: {},
        prixMoyenLitre: 0, totalLitres: 0, totalCout: 0, nbCartes: 0,
        coutMoyenLigne: 0, nbLignes: 0, consommationMoyenne: 0,
        varieties: [], history: [], alerts: [], correlationTable: [],
        prediction: { today: { kg: 0, isActual: false }, tomorrow: { kg: 0 }, j2: { kg: 0 } } }));
    }
    return Promise.resolve(jsonResponse({ success: true, _testui: true, note: 'unmocked-api-route' }));
  };

  // Patch cachedFetch too if it exists in window (historique : posé après ce script)
  // Strategy: replace its cache early so it doesn't memoize 503s. We override _apiCache
  // by setting an opener.
  Object.defineProperty(window, '_testuiActive', { value: true, configurable: false, writable: false });
}

installLocalTestBypass();

export { installLocalTestBypass };
