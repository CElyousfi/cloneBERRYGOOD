/*
 * PointageValidationPanel.jsx — panneau de validation du Pointage du jour
 * PAR ÉQUIPE / PAR FERME.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.PointageValidationPanel) afin d'éviter toute collision top-level avec
 * app.jsx (cf. crashes #75/#77). Aucune const/function top-level qui fuite.
 *
 * Circuit (validé par Omar) :
 *   RH valide/rejette chaque équipe + le Pointage Divers de la ferme
 *   → RH soumet la ferme à SON Chef → Chef valide → FIGÉ (lecture seule)
 *   → DG déverrouille.
 *
 * Props :
 *   - date            : 'YYYY-MM-DD' (jour affiché)
 *   - currentProfile  : id du profil courant (string), ex. 'rh' | 'chef_f1' | 'dg'
 *   - equipesParFerme : { <ferme>: { equipes: [ { prefix, nom, coutTransport,
 *                         ouvriers: [{matricule,nom,operation,parcelle,heures,cout}] } ],
 *                         diversCount: number } }
 *
 * Données serveur : /api/pointage-validation (token Bearer injecté par le wrapper
 * window.fetch d'app.jsx). Le contrôle de rôle réel est SERVEUR ; les gates client
 * ici sont cosmétiques.
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;

  var CHEF_FERME = { chef_f1: 'F1', chef_f5: 'F5', chef_avo: 'Avocatier', chef_bahia: 'BAHIA' };

  function profileIdOf(p) {
    if (!p) return null;
    if (typeof p === 'string') return p;
    return p.id || null;
  }

  function statusBadge(status) {
    if (status === 'valide') return { txt: '✅ Validé', color: '#137333', bg: '#e6f4ea' };
    if (status === 'rejete') return { txt: '🚫 Rejeté', color: '#b3261e', bg: '#fce8e6' };
    return { txt: '⬜ Non validé', color: '#5f6368', bg: '#f1f3f4' };
  }

  function fmtMoney(n) {
    var v = Math.round(n || 0);
    try { return v.toLocaleString('fr-FR'); } catch (e) { return String(v); }
  }

  // -------- composant principal --------
  function PointageValidationPanel(props) {
    var date = props.date;
    var profileId = profileIdOf(props.currentProfile);
    var equipesParFerme = props.equipesParFerme || {};

    var st = useState(null);
    var validation = st[0];
    var setValidation = st[1];
    var lst = useState(false);
    var loading = lst[0];
    var setLoading = lst[1];
    var est = useState(null);
    var err = est[0];
    var setErr = est[1];
    var bst = useState(null); // action en cours (clé)
    var busy = bst[0];
    var setBusy = bst[1];
    var xst = useState({}); // équipes dépliées : `${ferme}|${prefix}` → bool
    var expanded = xst[0];
    var setExpanded = xst[1];
    var mst = useState({}); // motifs en cours de saisie : `${ferme}|${prefix}` → string
    var motifs = mst[0];
    var setMotifs = mst[1];

    var isRH = profileId === 'rh';
    var isDG = profileId === 'dg';
    var chefFerme = CHEF_FERME[profileId] || null;

    var refetch = useCallback(function () {
      if (!date) return;
      setLoading(true);
      setErr(null);
      window.fetch('/api/pointage-validation?action=get-validations&date=' + encodeURIComponent(date))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.success) setValidation(j.validation || { date: date, fermes: {} });
          else setErr((j && j.error) || 'Erreur de chargement');
        })
        .catch(function (e) { setErr(e.message); })
        .finally(function () { setLoading(false); });
    }, [date]);

    useEffect(function () { refetch(); }, [refetch]);

    function fermeState(ferme) {
      var f = validation && validation.fermes && validation.fermes[ferme];
      return f || { equipes: {}, divers: { status: 'na' }, submitState: 'brouillon', locked: false };
    }

    function post(action, body, key) {
      setBusy(key || action);
      setErr(null);
      return window.fetch('/api/pointage-validation?action=' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (res) {
        if (res.j && res.j.success) { refetch(); }
        else { setErr((res.j && res.j.error) || 'Erreur'); }
        return res;
      }).catch(function (e) { setErr(e.message); })
        .finally(function () { setBusy(null); });
    }

    function toggleExpand(ferme, prefix) {
      var k = ferme + '|' + prefix;
      setExpanded(function (prev) { var n = {}; for (var x in prev) n[x] = prev[x]; n[k] = !prev[k]; return n; });
    }
    function setMotif(ferme, prefix, val) {
      var k = ferme + '|' + prefix;
      setMotifs(function (prev) { var n = {}; for (var x in prev) n[x] = prev[x]; n[k] = val; return n; });
    }

    if (!date) return null;

    var fermes = Object.keys(equipesParFerme);
    if (!fermes.length) {
      return React.createElement('div', { style: { fontSize: 12, color: '#9aa0a6', fontStyle: 'italic', padding: '8px 0' } },
        'Aucun pointage à valider pour ce jour.');
    }

    return React.createElement('div', { style: { marginTop: 12 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
        React.createElement('i', { className: 'fa-solid fa-clipboard-check', style: { color: 'var(--berry)' } }),
        React.createElement('span', { style: { fontWeight: 700, fontSize: 14 } }, 'Validation du pointage'),
        loading && React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 11, color: '#9aa0a6' } })
      ),
      err && React.createElement('div', { style: { background: '#fce8e6', color: '#b3261e', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 10 } }, err),
      fermes.map(function (ferme) {
        return renderFerme(ferme);
      })
    );

    function renderFerme(ferme) {
      var fdata = equipesParFerme[ferme] || { equipes: [], diversCount: 0 };
      var fstate = fermeState(ferme);
      var submitState = fstate.submitState || 'brouillon';
      var locked = fstate.locked === true || submitState === 'valide';
      var canRHEdit = isRH && submitState === 'brouillon' && !locked;
      var equipesList = fdata.equipes || [];

      // bandeau d'état ferme
      var stateLabel, stateColor, stateBg;
      if (submitState === 'valide' || locked) { stateLabel = 'Validé — figé'; stateColor = '#137333'; stateBg = '#e6f4ea'; }
      else if (submitState === 'soumis') { stateLabel = 'En attente validation Chef'; stateColor = '#b06000'; stateBg = '#fef3e0'; }
      else { stateLabel = 'Brouillon'; stateColor = '#5f6368'; stateBg = '#f1f3f4'; }

      // submit autorisé ?
      var equipeIds = equipesList.map(function (e) { return e.prefix; });
      var allAddressed = equipeIds.length > 0 && equipeIds.every(function (id) {
        var e = fstate.equipes && fstate.equipes[id];
        return e && (e.status === 'valide' || e.status === 'rejete');
      });
      var diversStatus = (fstate.divers && fstate.divers.status) || 'na';
      var diversAddressed = diversStatus === 'valide' || diversStatus === 'rejete' || diversStatus === 'na';
      var canSubmit = canRHEdit && allAddressed && diversAddressed;

      return React.createElement('div', { key: ferme, style: { border: '1px solid var(--gray-100)', borderRadius: 12, marginBottom: 12, overflow: 'hidden' } },
        // header ferme
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fafafa', borderBottom: '1px solid var(--gray-100)' } },
          React.createElement('span', { style: { fontWeight: 700, fontSize: 14 } }, ferme),
          React.createElement('span', { style: { background: stateBg, color: stateColor, padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700 } }, stateLabel),
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('span', { style: { fontSize: 11, color: '#9aa0a6' } }, equipesList.length + ' équipe' + (equipesList.length > 1 ? 's' : ''))
        ),
        React.createElement('div', { style: { padding: '10px 14px' } },
          equipesList.length === 0
            ? React.createElement('div', { style: { fontSize: 12, color: '#9aa0a6', fontStyle: 'italic' } }, 'Aucune équipe ce jour.')
            : equipesList.map(function (eq) { return renderEquipe(ferme, eq, fstate, canRHEdit); }),
          renderDivers(ferme, fdata, fstate, canRHEdit),
          renderActions(ferme, fstate, submitState, locked, canSubmit, equipeIds)
        )
      );
    }

    function renderEquipe(ferme, eq, fstate, canRHEdit) {
      var prefix = eq.prefix;
      var k = ferme + '|' + prefix;
      var isOpen = !!expanded[k];
      var eqVal = (fstate.equipes && fstate.equipes[prefix]) || null;
      var badge = statusBadge(eqVal && eqVal.status);
      var ouvriers = eq.ouvriers || [];
      var motifVal = motifs[k] || '';

      return React.createElement('div', { key: prefix, style: { border: '1px solid var(--gray-100)', borderRadius: 10, marginBottom: 8, overflow: 'hidden' } },
        // header collapsible
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', background: '#fff' },
          onClick: function () { toggleExpand(ferme, prefix); }
        },
          React.createElement('i', { className: 'fa-solid fa-chevron-' + (isOpen ? 'down' : 'right'), style: { fontSize: 10, color: '#9aa0a6', width: 12 } }),
          React.createElement('span', { style: { fontWeight: 600, fontSize: 13, flex: 1 } }, eq.nom || prefix),
          React.createElement('span', { style: { background: 'rgba(52,152,219,0.1)', color: 'var(--blue)', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 } }, ouvriers.length + ' ouv.'),
          (eq.coutTransport != null) && React.createElement('span', { style: { fontSize: 11, color: '#9aa0a6' } }, 'Transport ' + fmtMoney(eq.coutTransport) + ' DH'),
          React.createElement('span', { style: { background: badge.bg, color: badge.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 } }, badge.txt)
        ),
        // liste ouvriers (masquée par défaut)
        isOpen && React.createElement('div', { style: { borderTop: '1px solid var(--gray-100)', background: '#fafafa' } },
          React.createElement('div', { style: { overflowX: 'auto' } },
            React.createElement('table', { className: 'data-table', style: { fontSize: 12, margin: 0 } },
              React.createElement('thead', null,
                React.createElement('tr', { style: { background: 'var(--gray-50)' } },
                  React.createElement('th', { style: { padding: '6px 10px' } }, 'Matricule'),
                  React.createElement('th', { style: { padding: '6px 10px' } }, 'Nom'),
                  React.createElement('th', { style: { padding: '6px 10px' } }, 'Tâche'),
                  React.createElement('th', { style: { padding: '6px 10px' } }, 'Parcelle'),
                  React.createElement('th', { style: { padding: '6px 10px', textAlign: 'center' } }, 'Heures')
                )
              ),
              React.createElement('tbody', null,
                ouvriers.length === 0
                  ? React.createElement('tr', null, React.createElement('td', { colSpan: 5, style: { padding: '8px 10px', color: '#9aa0a6', fontStyle: 'italic' } }, 'Aucun ouvrier.'))
                  : ouvriers.map(function (r, i) {
                    return React.createElement('tr', { key: i },
                      React.createElement('td', { style: { fontFamily: 'monospace', fontSize: 10, padding: '6px 10px', color: '#9aa0a6' } }, r.matricule),
                      React.createElement('td', { style: { fontWeight: 600, padding: '6px 10px' } }, r.nom),
                      React.createElement('td', { style: { fontSize: 11, color: '#5f6368', padding: '6px 10px' } }, r.operation),
                      React.createElement('td', { style: { fontSize: 10, color: '#9aa0a6', padding: '6px 10px' } }, r.parcelle),
                      React.createElement('td', { style: { textAlign: 'center', padding: '6px 10px' } }, (r.heures != null ? r.heures + 'h' : '—'))
                    );
                  })
              )
            )
          )
        ),
        // actions RH (valider / ne pas valider)
        canRHEdit && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--gray-100)', flexWrap: 'wrap' } },
          React.createElement('input', {
            type: 'text', placeholder: 'Motif (optionnel)', value: motifVal,
            onChange: function (e) { setMotif(ferme, prefix, e.target.value); },
            style: { flex: 1, minWidth: 120, padding: '6px 10px', border: '1px solid var(--gray-200)', borderRadius: 8, fontSize: 12 }
          }),
          React.createElement('button', {
            disabled: !!busy,
            onClick: function () { post('validate-equipe', { date: date, ferme: ferme, equipeId: prefix, status: 'valide', motif: motifVal }, k + '|v'); },
            style: { padding: '6px 14px', background: '#137333', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }
          }, '🟢 Valider'),
          React.createElement('button', {
            disabled: !!busy,
            onClick: function () { post('validate-equipe', { date: date, ferme: ferme, equipeId: prefix, status: 'rejete', motif: motifVal }, k + '|r'); },
            style: { padding: '6px 14px', background: '#b3261e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }
          }, '🔴 Ne pas valider')
        ),
        // motif affiché si déjà adressé
        eqVal && eqVal.motif && React.createElement('div', { style: { padding: '4px 12px', fontSize: 11, color: '#5f6368', borderTop: '1px dashed var(--gray-100)' } },
          'Motif : ' + eqVal.motif)
      );
    }

    function renderDivers(ferme, fdata, fstate, canRHEdit) {
      var diversStatus = (fstate.divers && fstate.divers.status) || 'na';
      var badge = diversStatus === 'na' ? { txt: '— Aucun', color: '#5f6368', bg: '#f1f3f4' } : statusBadge(diversStatus);
      var count = fdata.diversCount || 0;
      var k = ferme + '|__divers__';
      var motifVal = motifs[k] || '';

      return React.createElement('div', { style: { border: '1px solid var(--gray-100)', borderRadius: 10, marginBottom: 8, padding: '8px 12px', background: '#fff' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: { fontWeight: 600, fontSize: 13, flex: 1 } }, 'Pointage Divers'),
          count > 0 && React.createElement('span', { style: { fontSize: 11, color: '#9aa0a6' } }, count + ' entrée' + (count > 1 ? 's' : '')),
          React.createElement('span', { style: { background: badge.bg, color: badge.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 } }, badge.txt)
        ),
        canRHEdit && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
          React.createElement('input', {
            type: 'text', placeholder: 'Motif (optionnel)', value: motifVal,
            onChange: function (e) { setMotif(ferme, '__divers__', e.target.value); },
            style: { flex: 1, minWidth: 120, padding: '6px 10px', border: '1px solid var(--gray-200)', borderRadius: 8, fontSize: 12 }
          }),
          React.createElement('button', {
            disabled: !!busy,
            onClick: function () { post('validate-divers', { date: date, ferme: ferme, status: 'valide', motif: motifVal }, k + '|v'); },
            style: { padding: '6px 14px', background: '#137333', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }
          }, '🟢 Valider'),
          React.createElement('button', {
            disabled: !!busy,
            onClick: function () { post('validate-divers', { date: date, ferme: ferme, status: 'rejete', motif: motifVal }, k + '|r'); },
            style: { padding: '6px 14px', background: '#b3261e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }
          }, '🔴 Ne pas valider')
        )
      );
    }

    function renderActions(ferme, fstate, submitState, locked, canSubmit, equipeIds) {
      var rows = [];
      // RH : soumettre la ferme
      if (isRH && submitState === 'brouillon' && !locked) {
        rows.push(React.createElement('button', {
          key: 'submit', disabled: !canSubmit || !!busy,
          onClick: function () { post('submit-ferme', { date: date, ferme: ferme, equipesDuJour: equipeIds }, ferme + '|submit'); },
          style: { padding: '10px 16px', background: canSubmit ? 'var(--berry)' : 'var(--gray-200)', color: canSubmit ? '#fff' : '#9aa0a6', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: (canSubmit && !busy) ? 'pointer' : 'default' }
        }, '📤 Soumettre le pointage du jour — ' + ferme));
      }
      // RH : info en attente
      if (isRH && submitState === 'soumis') {
        rows.push(React.createElement('div', { key: 'wait', style: { fontSize: 12, color: '#b06000', fontWeight: 600 } },
          '⏳ Soumis — en attente de validation du Chef.'));
      }
      // Chef de LA ferme : valider
      if (chefFerme === ferme && submitState === 'soumis') {
        rows.push(React.createElement('button', {
          key: 'chef', disabled: !!busy,
          onClick: function () { post('chef-validate-ferme', { date: date, ferme: ferme }, ferme + '|chef'); },
          style: { padding: '10px 16px', background: '#137333', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }
        }, '✅ Valider le pointage de la ferme'));
      }
      // Chef de LA ferme : déjà validé
      if (chefFerme === ferme && (submitState === 'valide' || locked)) {
        rows.push(React.createElement('div', { key: 'cdone', style: { fontSize: 12, color: '#137333', fontWeight: 600 } },
          '✅ Pointage validé et figé.'));
      }
      // DG : déverrouiller
      if (isDG && (submitState === 'valide' || locked)) {
        rows.push(React.createElement('button', {
          key: 'unlock', disabled: !!busy,
          onClick: function () { if (window.confirm('Déverrouiller le pointage de ' + ferme + ' ? La saisie RH sera rouverte.')) { post('unlock-ferme', { date: date, ferme: ferme }, ferme + '|unlock'); } },
          style: { padding: '10px 16px', background: '#b06000', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }
        }, '🔓 Déverrouiller'));
      }
      if (!rows.length) return null;
      return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' } }, rows);
    }
  }

  window.PointageValidationPanel = PointageValidationPanel;
})();
