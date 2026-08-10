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
 *
 * Le parent (ParcellesReferentielTab) fournit rows/sbMap DÉJÀ chargées ainsi
 * que sa palette et ses formatteurs (pas de second fetch du référentiel).
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var PGP_FALLBACK_C = {
    berry: '#c0392b',
    green: '#1D9E75',
    blue: '#2563eb',
    amber: '#EF9F27',
    surface: '#ffffff',
    surface2: '#f5f4ef',
    surface3: '#ebeae3',
    border: 'rgba(0,0,0,0.10)',
    text: '#1c1c1a',
    textSec: '#5f5e5a',
    textTer: '#8a8985'
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

  /** Nom pré-rempli du groupe à partir des labels cochés. */
  function PGP_suggestLabel(labels) {
    return (labels || []).join(' + ');
  }
  function PGP_GroupeForm(props) {
    var rows = props.rows || [];
    var sbMap = props.sbMap || {};
    var groupes = props.groupes || [];
    var editing = props.editing; // null (création) ou groupe existant
    var C = props.C;
    var fmtHa = props.fmtHa;
    var onCancel = props.onCancel;
    var onSaved = props.onSaved;
    var _sel = useState(editing ? (editing.membres || []).map(function (m) {
      return m.label;
    }) : []);
    var selected = _sel[0];
    var setSelected = _sel[1];
    var _label = useState(editing ? editing.label || '' : '');
    var labelVal = _label[0];
    var setLabelVal = _label[1];
    var _touched = useState(!!editing); // nom modifié à la main → ne plus auto-remplir
    var labelTouched = _touched[0];
    var setLabelTouched = _touched[1];
    var _saving = useState(false);
    var saving = _saving[0];
    var setSaving = _saving[1];
    var _err = useState(null);
    var err = _err[0];
    var setErr = _err[1];

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
      var next = selected.indexOf(label) === -1 ? selected.concat([label]) : selected.filter(function (l) {
        return l !== label;
      });
      setSelected(next);
      if (!labelTouched) setLabelVal(PGP_suggestLabel(next));
    }
    var membresSel = selected.map(function (l) {
      return {
        label: l,
        ha: PGP_haSb(sbMap, l)
      };
    });
    var totalHa = membresSel.reduce(function (s, m) {
      return s + m.ha;
    }, 0);
    var parts = [];
    if (membresSel.length > 0 && totalHa > 0 && window.ParcelleGroupUtils) {
      try {
        parts = window.ParcelleGroupUtils.computeParts(membresSel);
      } catch (e) {
        parts = [];
      }
    }
    var pctByLabel = {};
    parts.forEach(function (p) {
      pctByLabel[p.label] = p.pct;
    });
    function handleSave() {
      setSaving(true);
      setErr(null);
      var payload = {
        label: labelVal.trim(),
        membres: selected
      };
      if (editing) payload.id = editing.id;
      fetch('/api/pointage-rh?action=sb-groupe-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }).then(function (r) {
        return r.json();
      }).then(function (d) {
        if (!d.success) throw new Error(d.error || 'Erreur');
        onSaved();
      }).catch(function (e) {
        setErr(e.message);
        setSaving(false);
      });
    }
    var canSave = selected.length >= 2 && labelVal.trim() !== '' && !saving;
    return React.createElement('div', {
      style: {
        background: '#fffbf0',
        border: '1px solid ' + C.border,
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 14
      }
    }, React.createElement('div', {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: C.text,
        marginBottom: 10
      }
    }, editing ? 'Modifier le groupe' : 'Nouveau groupe de parcelles'), React.createElement('div', {
      style: {
        marginBottom: 12
      }
    }, React.createElement('label', {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.textSec,
        display: 'block',
        marginBottom: 4
      }
    }, 'Nom du groupe'), React.createElement('input', {
      type: 'text',
      value: labelVal,
      placeholder: 'S13/S14 BREEZE/CASCADE',
      onChange: function (e) {
        setLabelTouched(true);
        setLabelVal(e.target.value);
      },
      style: {
        border: '1px solid ' + C.border,
        borderRadius: 6,
        padding: '5px 8px',
        fontSize: 12,
        outline: 'none',
        width: '100%',
        maxWidth: 380,
        boxSizing: 'border-box'
      }
    })), React.createElement('div', {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.textSec,
        marginBottom: 6
      }
    }, 'Parcelles du groupe (au moins 2)'), React.createElement('div', {
      style: {
        maxHeight: 260,
        overflowY: 'auto',
        border: '1px solid ' + C.border,
        borderRadius: 8,
        background: C.surface,
        marginBottom: 10
      }
    }, rows.map(function (r, i) {
      var ha = PGP_haSb(sbMap, r.label);
      var owner = ownerByLabel[(r.label || '').toUpperCase().trim()];
      var disabled = ha <= 0 || !!owner;
      var checked = selected.indexOf(r.label) !== -1;
      var reason = ha <= 0 ? 'Ha SB requis' : owner ? 'déjà dans ' + owner : '';
      return React.createElement('label', {
        key: (r.label || '') + i,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 10px',
          fontSize: 12,
          borderBottom: '1px solid ' + C.border,
          background: disabled ? C.surface2 : C.surface,
          color: disabled ? C.textTer : C.text,
          cursor: disabled ? 'not-allowed' : 'pointer'
        }
      }, React.createElement('input', {
        type: 'checkbox',
        checked: checked,
        disabled: disabled,
        onChange: function () {
          if (!disabled) toggle(r.label);
        }
      }), React.createElement('span', {
        style: {
          flex: 1
        }
      }, r.label), React.createElement('span', {
        style: {
          fontFamily: 'monospace',
          fontSize: 11
        }
      }, ha > 0 ? fmtHa(ha) : '—'), checked && pctByLabel[r.label] != null && React.createElement('span', {
        style: {
          fontSize: 11,
          fontWeight: 700,
          color: C.green,
          minWidth: 48,
          textAlign: 'right'
        }
      }, pctByLabel[r.label] + ' %'), disabled && React.createElement('span', {
        style: {
          fontSize: 10,
          fontStyle: 'italic'
        }
      }, reason));
    })), React.createElement('div', {
      style: {
        fontSize: 12,
        color: C.textSec,
        marginBottom: 10
      }
    }, selected.length + ' parcelle(s) — total ' + (totalHa > 0 ? fmtHa(totalHa) : '—')), err && React.createElement('div', {
      style: {
        fontSize: 11,
        color: '#991b1b',
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: 6,
        padding: '6px 10px',
        marginBottom: 8
      }
    }, err), React.createElement('div', {
      style: {
        display: 'flex',
        gap: 8
      }
    }, React.createElement('button', {
      onClick: handleSave,
      disabled: !canSave,
      title: selected.length < 2 ? 'Sélectionner au moins 2 parcelles' : '',
      style: {
        padding: '5px 14px',
        borderRadius: 6,
        border: 'none',
        background: canSave ? C.green : C.surface3,
        color: canSave ? '#fff' : C.textTer,
        fontSize: 11,
        fontWeight: 700,
        cursor: canSave ? 'pointer' : 'not-allowed'
      }
    }, saving ? '…' : 'Sauver'), React.createElement('button', {
      onClick: onCancel,
      style: {
        padding: '5px 12px',
        borderRadius: 6,
        border: '1px solid ' + C.border,
        background: C.surface,
        color: C.textSec,
        fontSize: 11,
        cursor: 'pointer'
      }
    }, 'Annuler')));
  }
  function ParcellesGroupesPanel(props) {
    var rows = props.rows || [];
    var sbMap = props.sbMap || {};
    var canEdit = !!props.canEdit;
    var C = props.C || PGP_FALLBACK_C;
    var fmtHa = props.fmtHa || PGP_fmtHaFallback;
    var _groupes = useState([]);
    var groupes = _groupes[0];
    var setGroupes = _groupes[1];
    var _loading = useState(true);
    var loading = _loading[0];
    var setLoading = _loading[1];
    var _err = useState(null);
    var err = _err[0];
    var setErr = _err[1];
    var _form = useState(null); // null = fermé, 'new' = création, objet = édition
    var formState = _form[0];
    var setFormState = _form[1];
    var _tick = useState(0);
    var tick = _tick[0];
    var setTick = _tick[1];
    useEffect(function () {
      setLoading(true);
      fetch('/api/pointage-rh?action=sb-groupes-list').then(function (r) {
        return r.json();
      }).then(function (d) {
        if (!d.success) throw new Error(d.error || 'Erreur API');
        setGroupes(d.groupes || []);
        setErr(null);
      }).catch(function (e) {
        setErr(e.message);
      }).finally(function () {
        setLoading(false);
      });
    }, [tick]);
    function reload() {
      setFormState(null);
      setTick(function (t) {
        return t + 1;
      });
    }
    function handleDelete(g) {
      if (!window.confirm('Supprimer le groupe « ' + g.label + ' » ? Les bons déjà saisis ne sont pas modifiés.')) return;
      fetch('/api/pointage-rh?action=sb-groupe-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: g.id
        })
      }).then(function (r) {
        return r.json();
      }).then(function (d) {
        if (!d.success) throw new Error(d.error || 'Erreur');
        reload();
      }).catch(function (e) {
        setErr(e.message);
      });
    }
    return React.createElement('div', {
      style: {
        marginTop: 28
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 10,
        flexWrap: 'wrap'
      }
    }, React.createElement('div', null, React.createElement('h3', {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: C.text,
        margin: 0
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-object-group',
      style: {
        marginRight: 8,
        color: C.berry
      }
    }), 'Groupes de parcelles'), React.createElement('div', {
      style: {
        fontSize: 11,
        color: C.textTer,
        marginTop: 2
      }
    }, 'Parcelles combinées pour la saisie d\'un Bon de Consommation : la quantité est répartie au prorata des Ha SB.')), canEdit && !formState && React.createElement('button', {
      onClick: function () {
        setFormState('new');
      },
      style: {
        padding: '6px 14px',
        borderRadius: 8,
        border: 'none',
        background: C.berry,
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-plus',
      style: {
        marginRight: 6
      }
    }), 'Nouveau groupe')), err && React.createElement('div', {
      style: {
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: 10,
        padding: '10px 14px',
        color: '#991b1b',
        fontSize: 12,
        marginBottom: 10
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-circle-exclamation',
      style: {
        marginRight: 8
      }
    }), err), formState && React.createElement(PGP_GroupeForm, {
      rows: rows,
      sbMap: sbMap,
      groupes: groupes,
      editing: formState === 'new' ? null : formState,
      C: C,
      fmtHa: fmtHa,
      onCancel: function () {
        setFormState(null);
      },
      onSaved: reload
    }), loading && React.createElement('div', {
      style: {
        padding: 16,
        color: C.textTer,
        fontSize: 12
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-circle-notch fa-spin',
      style: {
        marginRight: 8
      }
    }), 'Chargement des groupes…'), !loading && groupes.length === 0 && !formState && React.createElement('div', {
      style: {
        background: C.surface,
        border: '1px dashed ' + C.border,
        borderRadius: 12,
        padding: '18px 16px',
        textAlign: 'center',
        color: C.textTer,
        fontSize: 12
      }
    }, 'Aucun groupe. ' + (canEdit ? 'Créez-en un pour saisir une consommation sur plusieurs parcelles à la fois.' : '')), !loading && groupes.length > 0 && React.createElement('div', {
      style: {
        background: C.surface,
        border: '1px solid ' + C.border,
        borderRadius: 12,
        overflow: 'hidden'
      }
    }, groupes.map(function (g, gi) {
      var membres = g.membres || [];
      var partByLabel = {};
      (g.parts || []).forEach(function (p) {
        partByLabel[p.label] = p.pct;
      });
      return React.createElement('div', {
        key: g.id,
        style: {
          borderTop: gi === 0 ? 'none' : '1px solid ' + C.border,
          padding: '10px 14px'
        }
      }, React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap'
        }
      }, React.createElement('span', {
        style: {
          fontWeight: 700,
          fontSize: 13,
          color: C.text,
          flex: 1
        }
      }, g.label), React.createElement('span', {
        style: {
          fontFamily: 'monospace',
          fontSize: 12,
          color: C.textSec
        }
      }, fmtHa(g.total_ha)), !g.valide && React.createElement('span', {
        style: {
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: 6,
          background: '#fef3c7',
          color: '#92400e'
        },
        title: 'Un membre n\'a plus de Ha SB : ce groupe est refusé à la saisie tant que le Ha n\'est pas ressaisi.'
      }, 'Ha manquant'), canEdit && React.createElement('button', {
        onClick: function () {
          setFormState(g);
        },
        style: {
          padding: '3px 10px',
          borderRadius: 6,
          border: '1px solid ' + C.border,
          background: C.surface,
          color: C.textSec,
          fontSize: 11,
          cursor: 'pointer'
        }
      }, React.createElement('i', {
        className: 'fa-solid fa-pen-to-square',
        style: {
          marginRight: 4
        }
      }), 'Éditer'), canEdit && React.createElement('button', {
        onClick: function () {
          handleDelete(g);
        },
        style: {
          padding: '3px 10px',
          borderRadius: 6,
          border: '1px solid ' + C.border,
          background: C.surface,
          color: C.berry,
          fontSize: 11,
          cursor: 'pointer'
        }
      }, React.createElement('i', {
        className: 'fa-solid fa-trash',
        style: {
          marginRight: 4
        }
      }), 'Suppr.')), React.createElement('div', {
        style: {
          marginTop: 6,
          paddingLeft: 14
        }
      }, membres.map(function (m, mi) {
        return React.createElement('div', {
          key: (m.label || '') + mi,
          style: {
            display: 'flex',
            gap: 12,
            fontSize: 12,
            color: C.textSec,
            padding: '2px 0'
          }
        }, React.createElement('span', {
          style: {
            flex: 1
          }
        }, m.label), React.createElement('span', {
          style: {
            fontFamily: 'monospace',
            minWidth: 70,
            textAlign: 'right'
          }
        }, m.ha > 0 ? fmtHa(m.ha) : '—'), React.createElement('span', {
          style: {
            minWidth: 60,
            textAlign: 'right',
            fontWeight: 600
          }
        }, partByLabel[m.label] != null ? partByLabel[m.label] + ' %' : '—'));
      })));
    })));
  }
  window.ParcellesGroupesPanel = ParcellesGroupesPanel;
})();
