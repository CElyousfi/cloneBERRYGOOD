/*
 * ParcellesGroupesPanel.jsx — « Groupes de parcelles » (écran Parcelles & Référentiel)
 *
 * Un groupe = N parcelles réelles traitées en une seule application (ex.
 * S13 BREEZE + S14 CASCADE). C'est un RACCOURCI DE SAISIE du Bon de
 * Consommation : à la création du BC, le backend éclate la ligne en N lignes
 * de parcelles RÉELLES, quantités au prorata des Ha (create-bc →
 * functions/lib/parcelleGroupes/split.js). Le groupe n'est jamais persisté
 * comme une parcelle.
 *
 * Règles produit :
 *  - base du prorata = uniquement le `ha` de sb_parcelle_referentiel (saisi
 *    dans le tableau au-dessus) : une parcelle sans Ha SB ne peut pas entrer
 *    dans un groupe ;
 *  - appartenance EXCLUSIVE : une parcelle n'est que dans un seul groupe actif
 *    (contrôlé aussi côté serveur) ;
 *  - les parcelles membres restent sélectionnables individuellement dans le BC.
 *
 * Édition : DG/RH (prop `canEdit` héritée du parent). Lecture : tous.
 * API : /api/pointage-rh?action=sb-groupes-list | sb-groupe-save | sb-groupe-delete
 *       | sb-referentiel-seed-ha (initialisation des Ha manquants depuis BEE ONE,
 *         en deux temps : dry_run:true → récap → dry_run:false ; body `labels` =
 *         les parcelles du tableau affiché, le serveur résout les surfaces)
 *
 * Le parent (ParcellesReferentielTab) fournit rows/sbMap DÉJÀ chargées ainsi
 * que sa palette et ses formatteurs (pas de second fetch du référentiel).
 */

import * as ParcelleGroupUtils from '../shared/lib/parcelleGroupUtils.js';

var useState = React.useState;
var useEffect = React.useEffect;

var PGP_FALLBACK_C = {
  berry: '#c0392b', green: '#1D9E75', blue: '#2563eb', amber: '#EF9F27',
  surface: '#ffffff', surface2: '#f5f4ef', surface3: '#ebeae3',
  border: 'rgba(0,0,0,0.10)', text: '#1c1c1a', textSec: '#5f5e5a', textTer: '#8a8985',
};

function PGP_fmtHaFallback(val) {
  var n = parseFloat(val) || 0;
  if (n === 0) return '—';
  return n.toFixed(2) + ' Ha';
}

/** Ha Smart Berry d'une ligne de parcelle (0 si non saisi — pas de fallback BEE ONE). */
function PGP_haSb(sbMap, label) {
  var e = sbMap && sbMap[(label || '').toUpperCase().trim()];
  return e && parseFloat(e.ha) > 0 ? parseFloat(e.ha) : 0;
}

/**
 * Nom AFFICHÉ d'une parcelle : nom Smart Berry s'il est saisi, sinon libellé
 * BEE ONE. Même règle que la colonne « Parcelle » du tableau au-dessus
 * (`nomDisplay` dans ParcellesReferentielTab) — les deux tableaux doivent
 * montrer le même nom pour la même parcelle.
 *
 * ⚠️ AFFICHAGE UNIQUEMENT. L'identité technique reste le libellé BEE ONE :
 * c'est lui qui part au serveur (`membres`, `labels` du seed), qui indexe
 * `selected` / `ownerByLabel` / `pctByLabel` / la résolution du Ha, et qui est
 * stocké dans `sb_parcelle_groupes.membres` puis rejoint par create-bc. Ne
 * JAMAIS envoyer un `nom_sb` au serveur : le prorata et l'éclatement des BC
 * joignent sur le libellé BEE ONE.
 *
 * SEUL endroit qui décide du nom affiché dans ce panneau — la duplication de
 * cette règle est précisément ce qui avait fait diverger les deux tableaux.
 *
 * @param {Object<string, {nom_sb?:string}>} sbMap référentiel SB indexé par
 *   libellé BEE ONE en MAJUSCULES.
 * @param {string} label libellé BEE ONE.
 * @returns {string}
 */
function PGP_displayName(sbMap, label) {
  var raw = label == null ? '' : String(label);
  var e = sbMap && sbMap[raw.toUpperCase().trim()];
  var nom = e && e.nom_sb != null ? String(e.nom_sb).trim() : '';
  return nom || raw;
}

/**
 * Nom pré-rempli du groupe à partir des parcelles cochées — construit sur les
 * noms AFFICHÉS (c'est ce qu'Omar lit à l'écran), pas sur les libellés BEE ONE.
 *
 * @param {Array<string>} labels libellés BEE ONE cochés.
 * @param {Object<string, {nom_sb?:string}>} [sbMap]
 * @returns {string}
 */
function PGP_suggestLabel(labels, sbMap) {
  return (labels || []).map(function (l) { return PGP_displayName(sbMap, l); }).join(' + ');
}

/**
 * Identité du formulaire de groupe, utilisée comme `key` React : elle DOIT
 * changer dès que la cible du formulaire change, sinon React réutilise
 * l'instance et son état `selected` (initialisé au seul montage).
 *
 * @param {*} formState null (fermé) | 'new' (création) | le groupe édité.
 * @returns {string}
 */
function PGP_formKey(formState) {
  if (!formState) return 'none';
  if (formState === 'new') return 'new';
  return 'edit-' + (formState.id || formState.label || '');
}

var PGP_SEED_RAISONS = {
  deja_sb: 'Ha Smart Berry déjà saisi',
  sans_surface_source: 'aucune surface BEE ONE connue',
};

/**
 * Initialisation des Ha manquants depuis BEE ONE — en DEUX temps :
 * simulation (dry_run: true) → récap → confirmation (dry_run: false).
 *
 * PÉRIMÈTRE = LE TABLEAU DU HAUT : on envoie au serveur les labels des
 * parcelles AFFICHÉES (campagne sélectionnée ET filtre de recherche appliqué
 * — le parent ne sert qu'une seule liste aux deux). Changer de campagne ou de
 * recherche change donc le périmètre et invalide une simulation en cours.
 * On n'envoie QUE des labels : le Ha est résolu côté serveur.
 *
 * Les labels sont FIGÉS à la simulation (`plan.labels`) : c'est ce périmètre-là
 * qui est confirmé, jamais la prop du moment. Si le tableau a bougé entre la
 * simulation et le clic de confirmation, on n'écrit rien.
 *
 * Le backend est idempotent : une parcelle qui a déjà un Ha SB n'est jamais
 * réécrite, un nom SB déjà saisi n'est jamais touché.
 */
function PGP_SeedHaBox(props) {
  var C = props.C;
  var fmtHa = props.fmtHa;
  var labels = props.labels || [];
  var sbMap = props.sbMap || {};   // affichage du nom SB uniquement
  var nbSansHa = props.nbSansHa;
  var onDone = props.onDone;

  var _plan = useState(null);       // null = pas encore simulé
  var plan = _plan[0]; var setPlan = _plan[1];
  var _busy = useState(false);
  var busy = _busy[0]; var setBusy = _busy[1];
  var _err = useState(null);
  var err = _err[0]; var setErr = _err[1];
  var _done = useState(null);       // nb de parcelles réellement écrites
  var done = _done[0]; var setDone = _done[1];

  // Bascule de campagne (ou rechargement des lignes) → la simulation affichée
  // ne correspond plus au tableau : on repart de l'amorce.
  var labelsKey = labels.join('|');
  useEffect(function () {
    setPlan(null);
    setDone(null);
    setErr(null);
  }, [labelsKey]);

  function callSeed(dryRun, sentLabels) {
    setBusy(true);
    setErr(null);
    return fetch('/api/pointage-rh?action=sb-referentiel-seed-ha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: dryRun, labels: sentLabels }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || 'Erreur');
        return d;
      })
      .catch(function (e) { setErr(e.message); return null; })
      .finally(function () { setBusy(false); });
  }

  function handleSimuler() {
    // Périmètre FIGÉ au moment de la simulation : c'est lui, et pas la prop
    // du moment, qui sera confirmé.
    var frozen = labels.slice();
    callSeed(true, frozen).then(function (d) {
      if (d) setPlan({ data: d, labels: frozen });
    });
  }

  function handleConfirmer() {
    if (!plan) return;
    // Garde-fou : si le tableau a bougé entre la simulation et le clic
    // (bascule de campagne, recherche, rechargement), on n'écrit RIEN — on
    // invalide la simulation et on demande de la relancer.
    if (plan.labels.join('|') !== labelsKey) {
      setPlan(null);
      setErr('Le tableau a changé depuis la simulation — relancez-la avant de confirmer.');
      return;
    }
    callSeed(false, plan.labels).then(function (d) {
      if (!d) return;
      setDone((d.a_creer || []).length);
      setPlan(null);
      if (onDone) onDone();
    });
  }

  var boxStyle = {
    background: '#fffbf0', border: '1px solid ' + C.border, borderRadius: 10,
    padding: '12px 14px', marginBottom: 12,
  };

  // Plus aucune parcelle affichée sans Ha (et rien à confirmer) : l'amorce
  // n'a plus lieu d'être. On garde en revanche la boîte montée juste après
  // une initialisation réussie, pour afficher la confirmation.
  if (nbSansHa <= 0 && done == null && !plan) return null;

  if (done != null) {
    return React.createElement('div', {
      style: Object.assign({}, boxStyle, { background: '#f0fdf4', borderColor: '#bbf7d0' }),
    },
      React.createElement('i', { className: 'fa-solid fa-circle-check', style: { marginRight: 8, color: C.green } }),
      React.createElement('span', { style: { fontSize: 12, color: C.text } },
        done + ' parcelle(s) initialisée(s) avec la surface BEE ONE. Les Ha restent modifiables via « Éditer ».')
    );
  }

  if (!plan) {
    return React.createElement('div', { style: { marginBottom: 12 } },
      React.createElement('button', {
        onClick: handleSimuler, disabled: busy,
        title: nbSansHa + ' parcelle(s) affichée(s) sans Ha Smart Berry : inéligibles aux groupes.',
        style: {
          padding: '6px 14px', borderRadius: 8, border: '1px solid ' + C.border,
          background: C.surface, color: C.text, fontSize: 12, fontWeight: 700,
          cursor: busy ? 'wait' : 'pointer',
        },
      },
        React.createElement('i', { className: 'fa-solid fa-wand-magic-sparkles', style: { marginRight: 6, color: C.amber } }),
        busy ? 'Simulation…' : 'Initialiser les Ha manquants depuis BEE ONE'
      ),
      err && React.createElement('div', {
        style: { fontSize: 11, color: '#991b1b', marginTop: 6 },
      }, err)
    );
  }

  var aCreer = plan.data.a_creer || [];
  var ignorees = plan.data.ignorees || [];

  return React.createElement('div', { style: boxStyle },
    React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 } },
      'Simulation — aucune donnée écrite pour l\'instant'
    ),
    React.createElement('div', { style: { fontSize: 12, color: C.textSec, marginBottom: 8 } },
      aCreer.length + ' parcelle(s) sur les ' + (plan.data.total_parcelles || 0) +
      ' du tableau ci-dessus recevront leur surface BEE ONE comme Ha Smart Berry. ' +
      ignorees.length + ' ignorée(s).'
    ),

    aCreer.length > 0 && React.createElement('div', {
      style: {
        maxHeight: 220, overflowY: 'auto', border: '1px solid ' + C.border,
        borderRadius: 8, background: C.surface, marginBottom: 8,
      },
    },
      aCreer.map(function (p, i) {
        return React.createElement('div', {
          key: (p.label || '') + i,
          style: {
            display: 'flex', gap: 12, fontSize: 12, padding: '4px 10px',
            borderBottom: '1px solid ' + C.border, color: C.text,
          },
        },
          React.createElement('span', { style: { flex: 1 } }, PGP_displayName(sbMap, p.label)),
          React.createElement('span', { style: { fontFamily: 'monospace' } }, fmtHa(p.ha))
        );
      })
    ),

    ignorees.length > 0 && React.createElement('details', { style: { marginBottom: 8 } },
      React.createElement('summary', { style: { fontSize: 11, color: C.textTer, cursor: 'pointer' } },
        ignorees.length + ' parcelle(s) ignorée(s)'),
      React.createElement('div', { style: { paddingTop: 4 } },
        ignorees.map(function (p, i) {
          return React.createElement('div', {
            key: (p.label || '') + i,
            style: { fontSize: 11, color: C.textTer, padding: '1px 0' },
          }, PGP_displayName(sbMap, p.label) + ' — ' + (PGP_SEED_RAISONS[p.raison] || p.raison));
        })
      )
    ),

    err && React.createElement('div', {
      style: { fontSize: 11, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px', marginBottom: 8 },
    }, err),

    React.createElement('div', { style: { display: 'flex', gap: 8 } },
      React.createElement('button', {
        onClick: handleConfirmer, disabled: busy || aCreer.length === 0,
        style: {
          padding: '5px 14px', borderRadius: 6, border: 'none',
          background: (busy || aCreer.length === 0) ? C.surface3 : C.green,
          color: (busy || aCreer.length === 0) ? C.textTer : '#fff',
          fontSize: 11, fontWeight: 700,
          cursor: (busy || aCreer.length === 0) ? 'not-allowed' : 'pointer',
        },
      }, busy ? '…' : 'Confirmer l\'initialisation'),
      React.createElement('button', {
        onClick: function () { setPlan(null); setErr(null); },
        style: { padding: '5px 12px', borderRadius: 6, border: '1px solid ' + C.border, background: C.surface, color: C.textSec, fontSize: 11, cursor: 'pointer' },
      }, 'Annuler')
    )
  );
}

function PGP_GroupeForm(props) {
  var rows = props.rows || [];
  var sbMap = props.sbMap || {};
  var groupes = props.groupes || [];
  var editing = props.editing;           // null (création) ou groupe existant
  var C = props.C;
  var fmtHa = props.fmtHa;
  var onCancel = props.onCancel;
  var onSaved = props.onSaved;

  var _sel = useState(editing ? (editing.membres || []).map(function (m) { return m.label; }) : []);
  var selected = _sel[0]; var setSelected = _sel[1];
  var _label = useState(editing ? (editing.label || '') : '');
  var labelVal = _label[0]; var setLabelVal = _label[1];
  var _touched = useState(!!editing); // nom modifié à la main → ne plus auto-remplir
  var labelTouched = _touched[0]; var setLabelTouched = _touched[1];
  var _saving = useState(false);
  var saving = _saving[0]; var setSaving = _saving[1];
  var _err = useState(null);
  var err = _err[0]; var setErr = _err[1];

  // Appartenance exclusive : label → nom du groupe qui le détient déjà
  // (le groupe en cours d'édition ne se bloque pas lui-même).
  var ownerByLabel = {};
  groupes.forEach(function (g) {
    if (editing && g.id === editing.id) return;
    (g.membres || []).forEach(function (m) {
      ownerByLabel[(m.label || '').toUpperCase().trim()] = g.label || g.id;
    });
  });

  function toggle(label) {
    var next = selected.indexOf(label) === -1
      ? selected.concat([label])
      : selected.filter(function (l) { return l !== label; });
    setSelected(next);
    // `next` = libellés BEE ONE (identité) ; le nom proposé est construit sur
    // les noms Smart Berry affichés.
    if (!labelTouched) setLabelVal(PGP_suggestLabel(next, sbMap));
  }

  var membresSel = selected.map(function (l) { return { label: l, ha: PGP_haSb(sbMap, l) }; });
  var totalHa = membresSel.reduce(function (s, m) { return s + m.ha; }, 0);
  var parts = [];
  if (membresSel.length > 0 && totalHa > 0 && ParcelleGroupUtils) {
    try { parts = ParcelleGroupUtils.computeParts(membresSel); } catch (e) { parts = []; }
  }
  var pctByLabel = {};
  parts.forEach(function (p) { pctByLabel[p.label] = p.pct; });

  function handleSave() {
    setSaving(true);
    setErr(null);
    var payload = { label: labelVal.trim(), membres: selected };
    if (editing) payload.id = editing.id;
    fetch('/api/pointage-rh?action=sb-groupe-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || 'Erreur');
        onSaved();
      })
      .catch(function (e) { setErr(e.message); setSaving(false); });
  }

  var canSave = selected.length >= 2 && labelVal.trim() !== '' && !saving;

  return React.createElement('div', {
    style: {
      background: '#fffbf0', border: '1px solid ' + C.border, borderRadius: 10,
      padding: '14px 16px', marginBottom: 14,
    },
  },
    React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 10 } },
      editing ? 'Modifier le groupe' : 'Nouveau groupe de parcelles'
    ),

    React.createElement('div', { style: { marginBottom: 12 } },
      React.createElement('label', { style: { fontSize: 11, fontWeight: 600, color: C.textSec, display: 'block', marginBottom: 4 } }, 'Nom du groupe'),
      React.createElement('input', {
        type: 'text', value: labelVal,
        placeholder: 'S13/S14 BREEZE/CASCADE',
        onChange: function (e) { setLabelTouched(true); setLabelVal(e.target.value); },
        style: {
          border: '1px solid ' + C.border, borderRadius: 6, padding: '5px 8px',
          fontSize: 12, outline: 'none', width: '100%', maxWidth: 380, boxSizing: 'border-box',
        },
      })
    ),

    React.createElement('div', { style: { fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 6 } },
      'Parcelles du groupe (au moins 2)'
    ),
    React.createElement('div', {
      style: {
        maxHeight: 260, overflowY: 'auto', border: '1px solid ' + C.border,
        borderRadius: 8, background: C.surface, marginBottom: 10,
      },
    },
      rows.map(function (r, i) {
        var ha = PGP_haSb(sbMap, r.label);
        var owner = ownerByLabel[(r.label || '').toUpperCase().trim()];
        var disabled = ha <= 0 || !!owner;
        var checked = selected.indexOf(r.label) !== -1;
        var reason = ha <= 0 ? 'Ha SB requis' : (owner ? 'déjà dans ' + owner : '');
        return React.createElement('label', {
          key: (r.label || '') + i,
          style: {
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
            fontSize: 12, borderBottom: '1px solid ' + C.border,
            background: disabled ? C.surface2 : C.surface,
            color: disabled ? C.textTer : C.text,
            cursor: disabled ? 'not-allowed' : 'pointer',
          },
        },
          React.createElement('input', {
            type: 'checkbox', checked: checked, disabled: disabled,
            onChange: function () { if (!disabled) toggle(r.label); },
          }),
          // Affichage = nom SB ; la coche, le Ha et l'envoi restent indexés
          // sur r.label (libellé BEE ONE).
          React.createElement('span', { style: { flex: 1 } }, PGP_displayName(sbMap, r.label)),
          React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 11 } }, ha > 0 ? fmtHa(ha) : '—'),
          checked && pctByLabel[r.label] != null && React.createElement('span', {
            style: { fontSize: 11, fontWeight: 700, color: C.green, minWidth: 48, textAlign: 'right' },
          }, pctByLabel[r.label] + ' %'),
          disabled && React.createElement('span', { style: { fontSize: 10, fontStyle: 'italic' } }, reason)
        );
      })
    ),

    React.createElement('div', { style: { fontSize: 12, color: C.textSec, marginBottom: 10 } },
      selected.length + ' parcelle(s) — total ' + (totalHa > 0 ? fmtHa(totalHa) : '—')
    ),

    err && React.createElement('div', {
      style: { fontSize: 11, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px', marginBottom: 8 },
    }, err),

    React.createElement('div', { style: { display: 'flex', gap: 8 } },
      React.createElement('button', {
        onClick: handleSave, disabled: !canSave,
        title: selected.length < 2 ? 'Sélectionner au moins 2 parcelles' : '',
        style: {
          padding: '5px 14px', borderRadius: 6, border: 'none',
          background: canSave ? C.green : C.surface3,
          color: canSave ? '#fff' : C.textTer,
          fontSize: 11, fontWeight: 700, cursor: canSave ? 'pointer' : 'not-allowed',
        },
      }, saving ? '…' : 'Sauver'),
      React.createElement('button', {
        onClick: onCancel,
        style: { padding: '5px 12px', borderRadius: 6, border: '1px solid ' + C.border, background: C.surface, color: C.textSec, fontSize: 11, cursor: 'pointer' },
      }, 'Annuler')
    )
  );
}

function ParcellesGroupesPanel(props) {
  var rows = props.rows || [];
  var sbMap = props.sbMap || {};
  var canEdit = !!props.canEdit;
  var C = props.C || PGP_FALLBACK_C;
  var fmtHa = props.fmtHa || PGP_fmtHaFallback;
  var onSeeded = props.onSeeded;   // demande au parent de recharger rows/sbMap

  // Périmètre du seed = LE TABLEAU DU HAUT : les parcelles de la campagne
  // affichée, ni plus ni moins. `rows` change quand Omar bascule de campagne,
  // donc le périmètre suit l'affichage.
  var seedLabels = rows.map(function (r) { return r.label; })
    .filter(function (l) { return !!(l && String(l).trim()); });
  // Parcelles affichées inéligibles aux groupes faute de Ha SB (décide de
  // l'affichage de l'amorce).
  var nbSansHa = rows.filter(function (r) { return PGP_haSb(sbMap, r.label) <= 0; }).length;

  var _groupes = useState([]);
  var groupes = _groupes[0]; var setGroupes = _groupes[1];
  var _loading = useState(true);
  var loading = _loading[0]; var setLoading = _loading[1];
  var _err = useState(null);
  var err = _err[0]; var setErr = _err[1];
  var _form = useState(null);   // null = fermé, 'new' = création, objet = édition
  var formState = _form[0]; var setFormState = _form[1];
  var _tick = useState(0);
  var tick = _tick[0]; var setTick = _tick[1];

  useEffect(function () {
    setLoading(true);
    fetch('/api/pointage-rh?action=sb-groupes-list')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || 'Erreur API');
        setGroupes(d.groupes || []);
        setErr(null);
      })
      .catch(function (e) { setErr(e.message); })
      .finally(function () { setLoading(false); });
  }, [tick]);

  function reload() { setFormState(null); setTick(function (t) { return t + 1; }); }

  function handleDelete(g) {
    if (!window.confirm('Supprimer le groupe « ' + g.label + ' » ? Les bons déjà saisis ne sont pas modifiés.')) return;
    fetch('/api/pointage-rh?action=sb-groupe-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: g.id }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || 'Erreur');
        reload();
      })
      .catch(function (e) { setErr(e.message); });
  }

  return React.createElement('div', { style: { marginTop: 28 } },

    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' },
    },
      React.createElement('div', null,
        React.createElement('h3', { style: { fontSize: 15, fontWeight: 800, color: C.text, margin: 0 } },
          React.createElement('i', { className: 'fa-solid fa-object-group', style: { marginRight: 8, color: C.berry } }),
          'Groupes de parcelles'
        ),
        React.createElement('div', { style: { fontSize: 11, color: C.textTer, marginTop: 2 } },
          'Parcelles combinées pour la saisie d\'un Bon de Consommation : la quantité est répartie au prorata des Ha SB.'
        )
      ),
      canEdit && !formState && React.createElement('button', {
        onClick: function () { setFormState('new'); },
        style: { padding: '6px 14px', borderRadius: 8, border: 'none', background: C.berry, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
      },
        React.createElement('i', { className: 'fa-solid fa-plus', style: { marginRight: 6 } }),
        'Nouveau groupe'
      )
    ),

    err && React.createElement('div', {
      style: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', color: '#991b1b', fontSize: 12, marginBottom: 10 },
    }, React.createElement('i', { className: 'fa-solid fa-circle-exclamation', style: { marginRight: 8 } }), err),

    // Amorce : tant qu'il reste des parcelles AFFICHÉES sans Ha SB, on propose
    // de les initialiser avec leur surface BEE ONE (simulation puis
    // confirmation). La boîte se masque elle-même quand il n'y a plus rien à
    // faire, mais reste montée le temps d'afficher la confirmation.
    canEdit && !formState && React.createElement(PGP_SeedHaBox, {
      C: C, fmtHa: fmtHa, nbSansHa: nbSansHa, labels: seedLabels, sbMap: sbMap,
      onDone: function () { if (onSeeded) onSeeded(); reload(); },
    }),

    // `key` OBLIGATOIRE : l'état `selected` du formulaire n'est initialisé
    // qu'au MONTAGE (useState depuis editing.membres). Sans key, cliquer
    // « Éditer » sur un groupe B pendant l'édition d'un groupe A réutilisait
    // l'instance → les membres de A étaient sauvés dans le groupe B
    // (corruption de données). La key change à chaque cible (A → B,
    // édition → nouveau, nouveau → édition) et force le remontage.
    formState && React.createElement(PGP_GroupeForm, {
      key: PGP_formKey(formState),
      rows: rows, sbMap: sbMap, groupes: groupes,
      editing: formState === 'new' ? null : formState,
      C: C, fmtHa: fmtHa,
      onCancel: function () { setFormState(null); },
      onSaved: reload,
    }),

    loading && React.createElement('div', { style: { padding: 16, color: C.textTer, fontSize: 12 } },
      React.createElement('i', { className: 'fa-solid fa-circle-notch fa-spin', style: { marginRight: 8 } }), 'Chargement des groupes…'
    ),

    !loading && groupes.length === 0 && !formState && React.createElement('div', {
      style: { background: C.surface, border: '1px dashed ' + C.border, borderRadius: 12, padding: '18px 16px', textAlign: 'center', color: C.textTer, fontSize: 12 },
    }, 'Aucun groupe. ' + (canEdit ? 'Créez-en un pour saisir une consommation sur plusieurs parcelles à la fois.' : '')),

    !loading && groupes.length > 0 && React.createElement('div', {
      style: { background: C.surface, border: '1px solid ' + C.border, borderRadius: 12, overflow: 'hidden' },
    },
      groupes.map(function (g, gi) {
        var membres = g.membres || [];
        var partByLabel = {};
        (g.parts || []).forEach(function (p) { partByLabel[p.label] = p.pct; });
        return React.createElement('div', {
          key: g.id,
          style: { borderTop: gi === 0 ? 'none' : '1px solid ' + C.border, padding: '10px 14px' },
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            React.createElement('span', { style: { fontWeight: 700, fontSize: 13, color: C.text, flex: 1 } }, g.label),
            React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 12, color: C.textSec } }, fmtHa(g.total_ha)),
            !g.valide && React.createElement('span', {
              style: { fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: '#fef3c7', color: '#92400e' },
              title: 'Un membre n\'a plus de Ha SB : ce groupe est refusé à la saisie tant que le Ha n\'est pas ressaisi.',
            }, 'Ha manquant'),
            canEdit && React.createElement('button', {
              onClick: function () { setFormState(g); },
              style: { padding: '3px 10px', borderRadius: 6, border: '1px solid ' + C.border, background: C.surface, color: C.textSec, fontSize: 11, cursor: 'pointer' },
            }, React.createElement('i', { className: 'fa-solid fa-pen-to-square', style: { marginRight: 4 } }), 'Éditer'),
            canEdit && React.createElement('button', {
              onClick: function () { handleDelete(g); },
              style: { padding: '3px 10px', borderRadius: 6, border: '1px solid ' + C.border, background: C.surface, color: C.berry, fontSize: 11, cursor: 'pointer' },
            }, React.createElement('i', { className: 'fa-solid fa-trash', style: { marginRight: 4 } }), 'Suppr.')
          ),
          React.createElement('div', { style: { marginTop: 6, paddingLeft: 14 } },
            membres.map(function (m, mi) {
              return React.createElement('div', {
                key: (m.label || '') + mi,
                style: { display: 'flex', gap: 12, fontSize: 12, color: C.textSec, padding: '2px 0' },
              },
                // Affichage = nom SB ; `partByLabel` reste indexé sur le
                // libellé BEE ONE renvoyé par le serveur.
                React.createElement('span', { style: { flex: 1 } }, PGP_displayName(sbMap, m.label)),
                React.createElement('span', { style: { fontFamily: 'monospace', minWidth: 70, textAlign: 'right' } }, m.ha > 0 ? fmtHa(m.ha) : '—'),
                React.createElement('span', { style: { minWidth: 60, textAlign: 'right', fontWeight: 600 } },
                  partByLabel[m.label] != null ? partByLabel[m.label] + ' %' : '—')
              );
            })
          )
        );
      })
    )
  );
}

export { ParcellesGroupesPanel };
