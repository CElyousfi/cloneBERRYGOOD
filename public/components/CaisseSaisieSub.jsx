/*
 * CaisseSaisieSub.jsx — Formulaire de bon de caisse (Gestion de Caisse).
 *
 * BIMODAL :
 *   - création  (editTx absent)  → POST /api/caisse?action=create-transaction
 *   - édition   (editTx fourni)  → POST /api/caisse?action=update-transaction
 *
 * Extrait de public/app.jsx à comportement IDENTIQUE en mode création (règle de
 * modularisation progressive, CLAUDE.md) ; le mode édition est l'ajout.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. crashes #75/#77 — mémoire umd-global-collision-smoke-load). UN seul
 * global exposé : window.CaisseSaisieSub. Identifiants internes préfixés CSAI_.
 *
 * Dépendances lues sur window (elles vivaient dans le scope d'app.jsx) :
 *   - window.TXN_TYPE_LABELS  (libellés/couleurs des types de transaction)
 *
 * Props :
 *   - caisses        Array<{id, nom}>   caisses actives
 *   - onDone         () => void         succès (le parent recharge + ferme)
 *   - onCancel       () => void         annulation (mode édition uniquement)
 *   - defaultType    string             type pré-sélectionné (création)
 *   - defaultCaisseId string            caisse pré-sélectionnée (création)
 *   - editTx         Object|null        transaction à modifier ; active le mode édition
 */
(function () {
  const { useState } = React;

  // Repli local si app.js n'a pas encore posé le global (ordre de <script>).
  const CSAI_FALLBACK_TYPES = {
    alimentation: { label: 'Alimentation', icon: 'fa-arrow-down', color: 'var(--green)', bg: 'rgba(45,139,78,0.1)' },
    depense: { label: 'Dépense', icon: 'fa-arrow-up', color: 'var(--red)', bg: 'rgba(231,76,60,0.1)' },
    sortie: { label: 'Sortie', icon: 'fa-arrow-right-from-bracket', color: 'var(--orange)', bg: 'rgba(243,156,18,0.1)' },
    paie: { label: 'Paie', icon: 'fa-money-check-dollar', color: '#9b59b6', bg: 'rgba(155,89,182,0.1)' },
    transport: { label: 'Transport', icon: 'fa-truck', color: '#16a085', bg: 'rgba(22,160,133,0.1)' },
  };

  function CSAI_types() {
    return window.TXN_TYPE_LABELS || CSAI_FALLBACK_TYPES;
  }

  function CaisseSaisieSub({ caisses, onDone, onCancel, defaultType, defaultCaisseId, editTx }) {
    const CSAI_isEdit = !!(editTx && editTx.id);
    const CSAI_wasValide = CSAI_isEdit && editTx.status === 'valide';

    const [form, setForm] = useState(() => (CSAI_isEdit ? {
      caisse_id: editTx.caisse_id || '',
      type: editTx.type || 'depense',
      montant: editTx.montant === undefined || editTx.montant === null ? '' : String(editTx.montant),
      reference: editTx.reference || '',
      description: editTx.description || '',
      code_analytique: editTx.code_analytique || '',
      date: editTx.date || new Date().toISOString().slice(0, 10),
      files: Array.isArray(editTx.files) ? editTx.files.slice(0, 3) : [],
      matricule: editTx.matricule || '',
      beneficiaire_nom: editTx.beneficiaire_nom || '',
    } : {
      caisse_id: defaultCaisseId || (caisses[0] && caisses[0].id) || '',
      type: defaultType || 'depense',
      montant: '', reference: '', description: '', code_analytique: '',
      date: new Date().toISOString().slice(0, 10),
      files: [], matricule: '', beneficiaire_nom: '',
    }));
    const [saving, setSaving] = useState(false);
    const [codesAnalytiques, setCodesAnalytiques] = useState([]);

    React.useEffect(() => {
      fetch('/api/stock?action=list-codes-analytiques').then(r => r.json()).then(json => {
        if (json.success && json.codes) setCodesAnalytiques(json.codes);
      }).catch(() => {});
    }, []);

    const handleFile = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxW = 1200;
          let w = img.width, h = img.height;
          if (w > maxW) { h = h * maxW / w; w = maxW; }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL('image/jpeg', 0.7);
          setForm(f => ({ ...f, files: [...f.files, { name: file.name, data: compressed }].slice(0, 3) }));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };

    const removeFile = (idx) => setForm(f => ({ ...f, files: f.files.filter((_, i) => i !== idx) }));

    // ---- Création (comportement d'origine, inchangé) ----
    const submit = (asBrouillon) => {
      if (!form.caisse_id || !form.type || !form.montant || !form.date) return alert('Veuillez remplir les champs obligatoires');
      if (parseFloat(form.montant) <= 0) return alert('Le montant doit être positif');
      setSaving(true);
      fetch('/api/caisse?action=create-transaction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, montant: parseFloat(form.montant), submit: !asBrouillon }),
      }).then(r => r.json()).then(json => {
        if (json.success) { alert(asBrouillon ? 'Brouillon enregistré' : 'Transaction soumise pour validation'); onDone(); }
        else alert('Erreur: ' + (json.error || 'Inconnue'));
      }).catch(err => alert('Erreur: ' + err.message)).finally(() => setSaving(false));
    };

    // ---- Édition ----
    const submitEdit = () => {
      if (!form.caisse_id || !form.type || !form.montant || !form.date) return alert('Veuillez remplir les champs obligatoires');
      if (parseFloat(form.montant) <= 0) return alert('Le montant doit être positif');
      if (CSAI_wasValide && !window.confirm(
        'Ce bon est VALIDÉ.\n\nL\'enregistrer le remettra au statut « Saisi » : le solde de la caisse sera réajusté et le bon devra être re-validé par la DG.\n\nContinuer ?'
      )) return;
      setSaving(true);
      // 'reference' volontairement absente du payload : identifiant métier gelé.
      fetch('/api/caisse?action=update-transaction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editTx.id,
          caisse_id: form.caisse_id,
          type: form.type,
          montant: parseFloat(form.montant),
          description: form.description,
          code_analytique: form.code_analytique,
          date: form.date,
          matricule: form.matricule,
          beneficiaire_nom: form.beneficiaire_nom,
          files: form.files,
        }),
      }).then(r => r.json()).then(json => {
        if (!json.success) return alert('Erreur: ' + (json.error || 'Inconnue'));
        if (!json.changes || json.changes.length === 0) alert('Aucune modification à enregistrer');
        else if (json.devalidated) alert('Modifications enregistrées — le bon repasse en « Saisi » et doit être re-validé par la DG.');
        else alert('Modifications enregistrées');
        onDone();
      }).catch(err => alert('Erreur: ' + err.message)).finally(() => setSaving(false));
    };

    const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--gray-200)', fontSize: 13, fontFamily: 'Inter, sans-serif' };
    const TYPES = CSAI_types();

    return (
      <div style={{ maxWidth: 640 }}>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid var(--gray-200)', padding: 24 }}>
          <h4 style={{ margin: '0 0 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className={`fa-solid ${CSAI_isEdit ? 'fa-pen-to-square' : 'fa-plus-circle'}`} style={{ color: 'var(--berry)' }}></i>
            {CSAI_isEdit ? `Modifier la transaction — ${editTx.reference || ''}` : 'Nouvelle Transaction'}
          </h4>

          {CSAI_wasValide && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: '#FEF3C7', border: '1px solid #FDE68A', fontSize: 12, color: '#92400E' }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ marginTop: 2 }}></i>
              <span>Ce bon est <strong>validé</strong>. L'enregistrer le remettra au statut « Saisi » : le solde de la caisse sera réajusté et le bon devra être <strong>re-validé par la DG</strong>.</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Caisse *</label>
              <select value={form.caisse_id} onChange={e => setForm({ ...form, caisse_id: e.target.value })} style={inputStyle}>
                {caisses.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Type *</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['alimentation', 'depense', 'sortie', 'paie', 'transport'].map(t => {
                  const tt = TYPES[t] || {};
                  return (
                    <button key={t} onClick={() => setForm({ ...form, type: t })}
                      style={{
                        flex: '1 0 calc(33% - 6px)', padding: '8px 6px', borderRadius: 8, border: form.type === t ? `2px solid ${tt.color}` : '1px solid var(--gray-200)',
                        background: form.type === t ? tt.bg : 'white', color: form.type === t ? tt.color : 'var(--gray-600)',
                        fontSize: 11, fontWeight: form.type === t ? 700 : 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
                      }}>
                      <i className={`fa-solid ${tt.icon}`}></i>{tt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Montant (DH) *</label>
              <input type="number" step="0.01" min="0" value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} style={inputStyle} placeholder="0.00" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Date *</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Référence</label>
              {CSAI_isEdit ? (
                <input type="text" value={form.reference} readOnly disabled title="La référence d'un bon ne se modifie pas"
                  style={{ ...inputStyle, background: 'var(--gray-100)', color: 'var(--gray-600)', fontFamily: 'monospace', cursor: 'not-allowed' }} />
              ) : (
                <input type="text" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} style={inputStyle} placeholder="Auto-générée si vide" />
              )}
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Code Analytique</label>
              <select value={form.code_analytique} onChange={e => setForm({ ...form, code_analytique: e.target.value })} style={inputStyle}>
                <option value="">— Aucun —</option>
                {codesAnalytiques.map(c => <option key={c} value={c}>{c}</option>)}
                {form.code_analytique && codesAnalytiques.indexOf(form.code_analytique) === -1 && (
                  <option value={form.code_analytique}>{form.code_analytique}</option>
                )}
              </select>
            </div>
            {(form.type === 'paie' || form.type === 'transport') && (
              <>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Matricule</label>
                  <input type="text" value={form.matricule} onChange={e => setForm({ ...form, matricule: e.target.value })} style={inputStyle} placeholder="Ex: 02123" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Bénéficiaire (Nom)</label>
                  <input type="text" value={form.beneficiaire_nom} onChange={e => setForm({ ...form, beneficiaire_nom: e.target.value })} style={inputStyle} placeholder="Nom de l'employé" />
                </div>
              </>
            )}
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} placeholder="Description de la transaction..." />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'block' }}>Pièces jointes (max 3)</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {form.files.map((f, i) => (
                  <div key={i} style={{ position: 'relative', width: 70, height: 70 }}>
                    <img src={f.data || f.url} alt="" style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--gray-200)' }} />
                    <button onClick={() => removeFile(i)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--red)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                ))}
              </div>
              {form.files.length < 3 && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px dashed var(--gray-200)', cursor: 'pointer', fontSize: 12, color: 'var(--gray-600)' }}>
                  <i className="fa-solid fa-camera"></i>Ajouter une photo
                  <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
                </label>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            {CSAI_isEdit ? (
              <>
                <button onClick={() => onCancel && onCancel()} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--gray-200)', background: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 500, opacity: saving ? 0.5 : 1 }}>
                  Annuler
                </button>
                <button onClick={submitEdit} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--berry)', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.5 : 1 }}>
                  {saving ? <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 6 }}></i> : <i className="fa-solid fa-floppy-disk" style={{ marginRight: 6 }}></i>}
                  Enregistrer les modifications
                </button>
              </>
            ) : (
              <>
                <button onClick={() => submit(true)} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--gray-200)', background: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 500, opacity: saving ? 0.5 : 1 }}>
                  <i className="fa-solid fa-floppy-disk" style={{ marginRight: 6 }}></i>Enregistrer brouillon
                </button>
                <button onClick={() => submit(false)} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--berry)', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.5 : 1 }}>
                  {saving ? <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 6 }}></i> : <i className="fa-solid fa-paper-plane" style={{ marginRight: 6 }}></i>}
                  Soumettre pour validation
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  window.CaisseSaisieSub = CaisseSaisieSub;
})();
