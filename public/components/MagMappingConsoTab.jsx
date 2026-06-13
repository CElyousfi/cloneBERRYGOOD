/*
 * MagMappingConsoTab.jsx — Suivi du mapping des parcelles de consommation.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.MagMappingConsoTab) afin d'éviter toute collision top-level avec
 * app.jsx (cf. crashes #75/#77). Aucune const/function top-level qui fuite —
 * tous les identifiants internes sont préfixés MMC_ par prudence.
 *
 * Deux collections Firestore (cf. functions/lib/mappingConso/seed.js) :
 *   parcelles_consommation  (référentiel magasinier STABLE)
 *     { id, libelle, ferme, secteur, variete, stade, famille }
 *   mapping_campagne        (le lien VERSIONNÉ, docId = `${campagne}__${id}`)
 *     { campagne, parcelle_conso_id, cible_parcelle_culturale, statut,
 *       confiance, note, valide_par, valide_le }
 *
 * La saisie des sorties de stock s'attache à parcelle_consommation et n'attend
 * JAMAIS le mapping. Cet écran ne pilote que la réconciliation (couche lecture).
 *
 * Statuts : matched | alias_propose | alias_valide | a_creer | creee
 *           | hors_propose | hors_confirme
 *
 * Accès Firestore : SDK compat v10 namespacé (firebase.firestore()), comme tout
 * le reste du repo. PAS d'import ESM modulaire.
 *
 * Props :
 *   - currentProfile : id du profil courant (string)
 *   - profileData    : objet profil (peut contenir name / userId)
 *   - authUser       : objet auth Firebase ({ uid, ... })
 *
 * GOUVERNANCE ÉCRITURE (T5) : conformément à CLAUDE.md « writes via Cloud
 * Functions only », les écritures NE sont PLUS faites en direct client. Elles
 * passent par l'endpoint Cloud Function /api/mapping-conso (mappingConsoManagement),
 * avec le idToken Firebase en Bearer. Les rules Firestore sur les 3 collections
 * sont en `allow write: if false`. Seules les LECTURES restent en onSnapshot
 * client (rules `allow read: if request.auth != null`).
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useMemo = React.useMemo;
  var useEffect = React.useEffect;

  var MMC_C = {
    textPrimary: '#1c1c1a',
    textSecondary: '#5f5e5a',
    textTertiary: '#8a8985',
    surface: '#ffffff',
    surface2: '#f5f4ef',
    surface3: '#ebeae3',
    border: 'rgba(0,0,0,0.12)',
    borderStrong: 'rgba(0,0,0,0.22)',
    green: '#1D9E75', red: '#E24B4A', amber: '#EF9F27', gray: '#888780'
  };

  var MMC_STATUS = {
    matched:       { label: 'Matched',        bg: '#E1F5EE', fg: '#0F6E56', bar: MMC_C.green, group: 'matched' },
    alias_propose: { label: 'Alias proposé',  bg: '#FAEEDA', fg: '#854F0B', bar: MMC_C.amber, group: 'alias' },
    alias_valide:  { label: 'Alias validé',   bg: '#E1F5EE', fg: '#0F6E56', bar: MMC_C.green, group: 'alias' },
    a_creer:       { label: 'À créer',        bg: '#FCEBEB', fg: '#A32D2D', bar: MMC_C.red,   group: 'creer' },
    creee:         { label: 'Créée',          bg: '#E1F5EE', fg: '#0F6E56', bar: MMC_C.green, group: 'creer' },
    hors_propose:  { label: 'Hors-périm.',    bg: '#F1EFE8', fg: '#5F5E5A', bar: MMC_C.gray,  group: 'hors' },
    hors_confirme: { label: 'Hors-périmètre', bg: '#F1EFE8', fg: '#5F5E5A', bar: MMC_C.gray,  group: 'hors' }
  };

  var MMC_COVERED = ['matched', 'alias_valide', 'creee'];
  var MMC_PENDING = ['alias_propose', 'a_creer', 'hors_propose'];
  function mmcIsCovered(s) { return MMC_COVERED.indexOf(s) !== -1; }
  function mmcIsPending(s) { return MMC_PENDING.indexOf(s) !== -1; }

  // Regroupement avocatier par ferme — info card, AUCUN mapping (cf. seed).
  var MMC_AVOCADO_FARMS = [
    { ferme: 'F2', varietes: 'Haas · Bacon · Zutano' },
    { ferme: 'F3', varietes: 'Haas · Fuerte · Zutano' },
    { ferme: 'F4', varietes: 'Haas · Fuerte · Zutano' },
    { ferme: 'F6', varietes: 'Haas · Bacon · Fuerte · Zutano' }
  ];

  var MMC_FILTERS = [
    { key: 'all', label: 'Tous' },
    { key: 'matched', label: 'Matched' },
    { key: 'alias', label: 'Alias' },
    { key: 'creer', label: 'À créer' },
    { key: 'hors', label: 'Hors-périmètre' }
  ];

  var MMC_CAMPAIGNS = ['2025-2026', '2024-2025'];

  function mmcFmt(n) {
    if (n == null) return '—';
    try { return n.toLocaleString('fr-FR'); } catch (e) { return String(n); }
  }

  // Formate une répartition 1:N pour affichage : 'Cascade 50% · Breeze 50%'.
  function mmcFmtRepartition(rep) {
    if (!Array.isArray(rep) || !rep.length) return '';
    return rep.map(function (p) { return p.cible + ' ' + p.pct + '%'; }).join(' · ');
  }

  var MMC_th = { padding: '8px 6px', fontWeight: 500 };
  var MMC_td = { padding: '9px 6px', verticalAlign: 'top' };
  var MMC_selectStyle = { height: 36, padding: '0 12px', border: '1px solid ' + MMC_C.border, borderRadius: 8, background: MMC_C.surface, fontSize: 14, color: MMC_C.textPrimary, minWidth: 190 };
  var MMC_inputStyle = { height: 30, padding: '0 8px', border: '1px solid ' + MMC_C.borderStrong, borderRadius: 6, fontSize: 12, minWidth: 180 };

  function mmcBtn(variant) {
    var solid = variant === 'solid';
    return {
      fontSize: 12, padding: '5px 11px', borderRadius: 6, cursor: 'pointer',
      border: '1px solid ' + (solid ? MMC_C.green : MMC_C.border),
      background: solid ? MMC_C.green : MMC_C.surface,
      color: solid ? '#fff' : MMC_C.textPrimary, whiteSpace: 'nowrap'
    };
  }

  function mmcChip(active) {
    return {
      fontSize: 13, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
      border: '1px solid ' + (active ? MMC_C.borderStrong : MMC_C.border),
      background: active ? MMC_C.surface3 : MMC_C.surface, color: MMC_C.textPrimary
    };
  }

  function MMC_Kpi(props) {
    return (
      <div style={{ background: MMC_C.surface2, borderRadius: 8, padding: 16 }}>
        <p style={{ fontSize: 13, color: MMC_C.textSecondary, margin: 0 }}>{props.label}</p>
        <p style={{ fontSize: 24, fontWeight: 500, margin: '4px 0 0', color: props.color || MMC_C.textPrimary }}>{props.value}</p>
      </div>
    );
  }

  // Appel mutation via Cloud Function /api/mapping-conso (writes via CF only).
  // Récupère le idToken Firebase et l'envoie en Bearer. Retourne le JSON parsé
  // ou lève une Error (message serveur) à gérer par l'appelant.
  function mmcApi(action, payload) {
    var user = firebase.auth().currentUser;
    if (!user) return Promise.reject(new Error('Non authentifié'));
    return user.getIdToken().then(function (token) {
      return fetch('/api/mapping-conso?action=' + encodeURIComponent(action), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload || {})
      });
    }).then(function (resp) {
      return resp.json().catch(function () { return { success: false, error: 'Réponse serveur invalide' }; });
    }).then(function (json) {
      if (!json || !json.success) { throw new Error((json && json.error) || 'Échec de la requête'); }
      return json;
    });
  }

  function MappingConsoTab(props) {
    var currentProfile = props.currentProfile;
    var profileData = props.profileData || {};
    var authUser = props.authUser || {};

    var campaignState = useState('2025-2026');
    var campaign = campaignState[0];
    var setCampaign = campaignState[1];

    var filterState = useState('all');
    var filter = filterState[0];
    var setFilter = filterState[1];

    var editingState = useState(null);
    var editing = editingState[0];
    var setEditing = editingState[1];

    var draftState = useState('');
    var draftTarget = draftState[0];
    var setDraftTarget = draftState[1];

    // mappingDocs : docs mapping_campagne de la campagne (temps réel).
    var mappingState = useState([]);
    var mappingDocs = mappingState[0];
    var setMappingDocs = mappingState[1];

    // consoById : référentiel parcelles_consommation indexé par id (temps réel).
    var consoState = useState({});
    var consoById = consoState[0];
    var setConsoById = consoState[1];

    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var errState = useState(null);
    var err = errState[0];
    var setErr = errState[1];

    // --- Firestore temps réel : parcelles_consommation (référentiel stable) ---
    useEffect(function () {
      var db = firebase.firestore();
      var unsub = db.collection('parcelles_consommation').onSnapshot(
        function (snap) {
          var map = {};
          snap.forEach(function (d) { map[d.id] = d.data(); });
          setConsoById(map);
        },
        function (e) { setErr((e && e.message) || 'Erreur parcelles_consommation'); }
      );
      return unsub;
    }, []);

    // --- Firestore temps réel : mapping_campagne filtré par campagne ----------
    useEffect(function () {
      setLoading(true);
      var db = firebase.firestore();
      var unsub = db.collection('mapping_campagne')
        .where('campagne', '==', campaign)
        .onSnapshot(
          function (snap) {
            var rows = [];
            snap.forEach(function (d) {
              var data = d.data() || {};
              rows.push({ id: d.id, data: data });
            });
            setMappingDocs(rows);
            setLoading(false);
          },
          function (e) { setErr((e && e.message) || 'Erreur mapping_campagne'); setLoading(false); }
        );
      return unsub;
    }, [campaign]);

    // --- Join mapping_campagne × parcelles_consommation → shape de rendu ------
    // pointages : agrégat dérivé non stocké (cf. ticket). Non disponible côté
    // client en V1 → null (affiché « — »). Ne bloque pas le rendu.
    var rows = useMemo(function () {
      return mappingDocs.map(function (m) {
        var d = m.data;
        var conso = consoById[d.parcelle_conso_id] || {};
        // RÉALIGNEMENT PARCELLE_TO_CPC : une ligne porte SOIT une cible unique
        // (clé du canevas Stock), SOIT une répartition 1:N. Mutuellement excl.
        var rep = Array.isArray(d.repartition) && d.repartition.length ? d.repartition : null;
        return {
          id: m.id,
          parcelle_conso_id: d.parcelle_conso_id,
          libelle: conso.libelle || d.parcelle_conso_id,
          famille: conso.famille || '—',
          pointages: null,
          cible: d.cible_parcelle_culturale || '',
          repartition: rep,
          statut: d.statut,
          note: d.note || null
        };
      }).sort(function (a, b) { return a.libelle.localeCompare(b.libelle); });
    }, [mappingDocs, consoById]);

    var k = useMemo(function () {
      var covered = rows.filter(function (r) { return mmcIsCovered(r.statut); }).length;
      var pending = rows.filter(function (r) { return mmcIsPending(r.statut); }).length;
      var aliasToValidate = rows.filter(function (r) { return r.statut === 'alias_propose'; }).length;
      var toCreate = rows.filter(function (r) { return r.statut === 'a_creer'; }).length;
      var hors = rows.filter(function (r) { return MMC_STATUS[r.statut] && MMC_STATUS[r.statut].group === 'hors'; }).length;
      var total = rows.length;
      var resolvedPct = total ? Math.round(((total - pending) / total) * 100) : 0;
      return { covered: covered, aliasToValidate: aliasToValidate, toCreate: toCreate, hors: hors, total: total, resolvedPct: resolvedPct };
    }, [rows]);

    var segs = useMemo(function () {
      var total = rows.length || 1;
      var coveredN = rows.filter(function (r) { return mmcIsCovered(r.statut); }).length;
      var aliasN = rows.filter(function (r) { return r.statut === 'alias_propose'; }).length;
      var creerN = rows.filter(function (r) { return r.statut === 'a_creer'; }).length;
      var horsN = rows.filter(function (r) { return r.statut === 'hors_propose'; }).length;
      return [
        { c: MMC_C.green, w: (coveredN / total) * 100 },
        { c: MMC_C.amber, w: (aliasN / total) * 100 },
        { c: MMC_C.red, w: (creerN / total) * 100 },
        { c: MMC_C.gray, w: (horsN / total) * 100 }
      ];
    }, [rows]);

    var visible = rows.filter(function (r) {
      return filter === 'all' || (MMC_STATUS[r.statut] && MMC_STATUS[r.statut].group === filter);
    });

    function mmcFail(e) {
      setErr((e && e.message) || 'Échec de la requête');
    }

    // « Valider » un alias (alias_propose → alias_valide) via CF.
    function validateAlias(id) {
      return mmcApi('validate-alias', { docId: id }).catch(mmcFail);
    }

    // « Confirmer périmètre » (hors_propose → hors_confirme) via CF.
    function confirmPerimetre(id) {
      return mmcApi('confirm-perimetre', { docId: id }).catch(mmcFail);
    }

    // « Réaffecter » : maj cible_parcelle_culturale (statut inchangé) via CF.
    function saveTarget(id) {
      mmcApi('reassign', { docId: id, cible_parcelle_culturale: draftTarget }).catch(mmcFail);
      setEditing(null);
    }

    // « Annuler » : remet le statut antérieur via CF (revert).
    function revert(r) {
      return mmcApi('revert', { docId: r.id, statut: r.statut }).catch(mmcFail);
    }

    // « Créer la parcelle » (a_creer → creee) : la CF crée D'ABORD une parcelle
    // culturale côté charge (parcelles_culturales_charge) PUIS bascule le statut
    // + renseigne cible_parcelle_culturale, en runTransaction.
    function creerParcelle(r) {
      return mmcApi('create-parcelle', { docId: r.id }).catch(mmcFail);
    }

    // Empty-state : importe le seed de la campagne via CF (idempotent).
    function seedCampagne() {
      return mmcApi('seed-campagne', { campagne: campaign }).catch(mmcFail);
    }

    function actionsFor(r) {
      if (editing === r.id) {
        return (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={draftTarget}
              onChange={function (e) { setDraftTarget(e.target.value); }}
              style={MMC_inputStyle}
              autoFocus
            />
            <button style={mmcBtn('solid')} onClick={function () { saveTarget(r.id); }}>Enregistrer</button>
            <button style={mmcBtn()} onClick={function () { setEditing(null); }}>Annuler</button>
          </span>
        );
      }
      // V1 : l'édition fine des % d'une répartition 1:N n'est pas exposée.
      // Pour ces lignes, « Réaffecter » est en lecture seule (texte) : la
      // répartition vient du seed (50/50) et se valide via les boutons de statut.
      var reassign = r.repartition
        ? <span style={{ fontSize: 11, color: MMC_C.textTertiary }} title="Édition des % non disponible en V1">Répartition figée</span>
        : <button style={mmcBtn()} onClick={function () { setEditing(r.id); setDraftTarget(r.cible || ''); }}>Réaffecter</button>;
      switch (r.statut) {
        case 'alias_propose':
          return <span style={{ display: 'inline-flex', gap: 6 }}><button style={mmcBtn('solid')} onClick={function () { validateAlias(r.id); }}>Valider</button>{reassign}</span>;
        case 'a_creer':
          return <span style={{ display: 'inline-flex', gap: 6 }}><button style={mmcBtn('solid')} onClick={function () { creerParcelle(r); }}>Créer la parcelle</button>{reassign}</span>;
        case 'hors_propose':
          return <span style={{ display: 'inline-flex', gap: 6 }}><button style={mmcBtn('solid')} onClick={function () { confirmPerimetre(r.id); }}>Confirmer périmètre</button>{reassign}</span>;
        case 'alias_valide':
        case 'creee':
        case 'hors_confirme':
          return <button style={mmcBtn()} onClick={function () { revert(r); }}>Annuler</button>;
        default:
          return <span style={{ color: MMC_C.textTertiary, fontSize: 12 }}>—</span>;
      }
    }

    return (
      <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: MMC_C.textPrimary, maxWidth: 920, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>Mapping parcelles de consommation</p>
            <p style={{ fontSize: 13, color: MMC_C.textSecondary, margin: '2px 0 0' }}>Univers magasinier → référentiel BEE ONE</p>
          </div>
          <select value={campaign} onChange={function (e) { setCampaign(e.target.value); setFilter('all'); setEditing(null); }} style={MMC_selectStyle}>
            {MMC_CAMPAIGNS.map(function (c) {
              return <option key={c} value={c}>{'Campagne ' + c}</option>;
            })}
          </select>
        </div>

        {err ? (
          <div style={{ background: '#FCEBEB', color: '#A32D2D', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{err}</div>
        ) : null}

        {loading ? (
          <div style={{ background: MMC_C.surface2, borderRadius: 12, padding: '48px 24px', textAlign: 'center', color: MMC_C.textSecondary, fontSize: 14 }}>Chargement du mapping…</div>
        ) : rows.length === 0 ? (
          <div style={{ background: MMC_C.surface2, borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>Aucun mapping pour la campagne {campaign}</p>
            <p style={{ fontSize: 13, color: MMC_C.textSecondary, margin: '6px 0 16px' }}>Le mapping se rejoue à chaque campagne. L'import écrit le référentiel + le mapping via la Cloud Function (idempotent).</p>
            <button style={mmcBtn('solid')} onClick={seedCampagne}>Importer les demandes magasinier</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
              <MMC_Kpi label="Parcelles conso" value={k.total} />
              <MMC_Kpi label="Validées" value={k.covered} color={MMC_C.green} />
              <MMC_Kpi label="Alias à valider" value={k.aliasToValidate} color={MMC_C.amber} />
              <MMC_Kpi label="À créer" value={k.toCreate} color={MMC_C.red} />
              <MMC_Kpi label="Hors-périmètre" value={k.hors} color={MMC_C.textSecondary} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: MMC_C.textSecondary }}>Mapping résolu</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{k.resolvedPct}%</span>
            </div>
            <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: MMC_C.surface3, marginBottom: 20 }}>
              {segs.map(function (s, i) { return <div key={i} style={{ width: s.w + '%', background: s.c }} />; })}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {MMC_FILTERS.map(function (f) {
                return <button key={f.key} onClick={function () { setFilter(f.key); }} style={mmcChip(filter === f.key)}>{f.label}</button>;
              })}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: MMC_C.textSecondary, borderBottom: '1px solid ' + MMC_C.borderStrong }}>
                    <th style={MMC_th}>Parcelle de consommation</th>
                    <th style={MMC_th}>Famille</th>
                    <th style={Object.assign({}, MMC_th, { textAlign: 'right' })}>Pointages</th>
                    <th style={MMC_th}>Cible BEE ONE</th>
                    <th style={MMC_th}>Statut</th>
                    <th style={MMC_th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(function (r) {
                    var st = MMC_STATUS[r.statut] || { label: r.statut, bg: MMC_C.surface3, fg: MMC_C.textSecondary };
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid ' + MMC_C.border }}>
                        <td style={MMC_td}>{r.libelle}</td>
                        <td style={Object.assign({}, MMC_td, { color: MMC_C.textSecondary })}>{r.famille}</td>
                        <td style={Object.assign({}, MMC_td, { textAlign: 'right', color: MMC_C.textSecondary, fontVariantNumeric: 'tabular-nums' })}>{mmcFmt(r.pointages)}</td>
                        <td style={Object.assign({}, MMC_td, { color: MMC_C.textSecondary })}>
                          {r.repartition ? mmcFmtRepartition(r.repartition) : (r.cible || '—')}
                          {r.note ? <span style={{ display: 'block', fontSize: 11, color: MMC_C.textTertiary }}>{r.note}</span> : null}
                        </td>
                        <td style={MMC_td}>
                          <span style={{ fontSize: 12, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.label}</span>
                        </td>
                        <td style={Object.assign({}, MMC_td, { whiteSpace: 'nowrap' })}>
                          <span style={{ display: 'inline-flex', gap: 6 }}>{actionsFor(r)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 24, background: MMC_C.surface2, borderRadius: 12, padding: '16px 20px' }}>
              <p style={{ fontSize: 14, fontWeight: 500, margin: '0 0 4px' }}>Avocatier — regroupement par ferme</p>
              <p style={{ fontSize: 13, color: MMC_C.textSecondary, margin: '0 0 12px' }}>Chaque demande « Avocatier Fx » cible toutes les variétés brutes de la ferme. Charges non ventilées par variété.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
                {MMC_AVOCADO_FARMS.map(function (a) {
                  return (
                    <div key={a.ferme} style={{ background: MMC_C.surface, border: '1px solid ' + MMC_C.border, borderRadius: 8, padding: '8px 12px' }}>
                      <span style={{ fontWeight: 500 }}>{a.ferme}</span>{' '}
                      <span style={{ color: MMC_C.textSecondary, fontSize: 12 }}>{a.varietes}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  window.MagMappingConsoTab = MappingConsoTab;
})();
