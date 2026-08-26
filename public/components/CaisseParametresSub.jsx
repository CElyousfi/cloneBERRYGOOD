/*
 * CaisseParametresSub.jsx — Paramètres de la Gestion de Caisse.
 *
 * Configure les deux listes qui alimentent les menus déroulants du bon de
 * caisse : les FERMES et les CODES ANALYTIQUES. Ce qui est enregistré ici est
 * exactement ce qui est proposé à la saisie — c'est la seule source.
 *
 * Volontairement séparé de `config_analytique` (écran Finance) : ce dernier est
 * le plan analytique des ACHATS, avec ferme / catégorie d'achat / nature CPC
 * par code. Ici, une simple liste de natures de dépense propre à la caisse.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. crashes #75/#77 — mémoire umd-global-collision-smoke-load). UN seul
 * global exposé : window.CaisseParametresSub. Identifiants internes préfixés CPAR_.
 *
 * Props :
 *   - canEdit  bool        DG/Finance : peut enregistrer. Sinon lecture seule.
 *   - onSaved  () => void  appelé après un enregistrement réussi
 */
(function () {
  const { useState } = React;

  const CPAR_MAX_LEN = 60;

  /** Une liste éditable : ajout, suppression, réordonnancement. */
  function CPAR_ListeEditable({ titre, icone, aide, items, onChange, canEdit, placeholder }) {
    const [nouveau, setNouveau] = useState('');

    const ajouter = () => {
      const v = nouveau.trim();
      if (!v) return;
      if (v.length > CPAR_MAX_LEN) return alert(`Maximum ${CPAR_MAX_LEN} caractères.`);
      if (items.some(x => x.toLowerCase() === v.toLowerCase())) {
        setNouveau('');
        return alert(`« ${v} » est déjà dans la liste.`);
      }
      onChange([...items, v]);
      setNouveau('');
    };

    const supprimer = (i) => {
      if (items.length === 1) return alert('La liste ne peut pas être vide.');
      if (!window.confirm(`Retirer « ${items[i]} » ?\n\nLes bons déjà enregistrés avec cette valeur la conservent ; elle ne sera simplement plus proposée à la saisie.`)) return;
      onChange(items.filter((_, k) => k !== i));
    };

    const deplacer = (i, delta) => {
      const j = i + delta;
      if (j < 0 || j >= items.length) return;
      const copie = items.slice();
      const tmp = copie[i]; copie[i] = copie[j]; copie[j] = tmp;
      onChange(copie);
    };

    const btn = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: '2px 5px', fontSize: 12 };

    return (
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid var(--gray-200)', padding: 20, flex: '1 1 340px', minWidth: 300 }}>
        <h4 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <i className={`fa-solid ${icone}`} style={{ color: 'var(--berry)' }}></i>{titre}
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500, color: 'var(--gray-400)' }}>{items.length}</span>
        </h4>
        <div style={{ fontSize: 11.5, color: 'var(--gray-600)', marginBottom: 12 }}>{aide}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {items.map((item, i) => (
            <div key={item + i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--gray-100)', borderRadius: 8, fontSize: 12.5 }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</span>
              {canEdit && (
                <>
                  <button onClick={() => deplacer(i, -1)} disabled={i === 0} title="Monter"
                    style={{ ...btn, opacity: i === 0 ? 0.25 : 1 }}><i className="fa-solid fa-chevron-up"></i></button>
                  <button onClick={() => deplacer(i, 1)} disabled={i === items.length - 1} title="Descendre"
                    style={{ ...btn, opacity: i === items.length - 1 ? 0.25 : 1 }}><i className="fa-solid fa-chevron-down"></i></button>
                  <button onClick={() => supprimer(i)} title="Retirer"
                    style={{ ...btn, color: 'var(--red)' }}><i className="fa-solid fa-xmark"></i></button>
                </>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" value={nouveau} onChange={e => setNouveau(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ajouter(); } }}
              placeholder={placeholder} maxLength={CPAR_MAX_LEN}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--gray-200)', fontSize: 12.5 }} />
            <button onClick={ajouter} disabled={!nouveau.trim()}
              style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--berry)', color: 'white', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, opacity: nouveau.trim() ? 1 : 0.4 }}>
              <i className="fa-solid fa-plus"></i>
            </button>
          </div>
        )}
      </div>
    );
  }

  function CaisseParametresSub({ canEdit, onSaved }) {
    const [fermes, setFermes] = useState([]);
    const [codes, setCodes] = useState([]);
    const [initial, setInitial] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [seeded, setSeeded] = useState(true);
    const [erreur, setErreur] = useState(null);
    const [toast, setToast] = useState(null);
    // Parcelles FIGÉES dans les paramètres : c'est ce qui rend la saisie d'un
    // bon instantanée. Rafraîchies à la demande depuis le référentiel de
    // campagne (requête lente, donc jamais au moment de saisir).
    const [parcelles, setParcelles] = useState([]);
    const [parcellesMajAt, setParcellesMajAt] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const charger = React.useCallback(() => {
      setLoading(true);
      setErreur(null);
      fetch('/api/caisse?action=caisse-parametres-get')
        .then(r => r.json())
        .then(j => {
          // Ne JAMAIS retomber silencieusement sur deux listes vides : c'est
          // indiscernable d'un « il n'y a rien à configurer ». Le cas typique
          // est un backend pas encore déployé (l'action n'existe pas encore).
          if (!j || !j.success) {
            setErreur((j && j.error) || "Les paramètres n'ont pas pu être chargés.");
            return;
          }
          setFermes(j.fermes || []);
          setCodes(j.codes_analytiques || []);
          setParcelles(j.parcelles || []);
          setParcellesMajAt(j.parcelles_maj_at || null);
          setSeeded(!!j.seeded);
          setInitial(JSON.stringify({ f: j.fermes || [], c: j.codes_analytiques || [] }));
        })
        .catch(err => setErreur('Erreur réseau : ' + err.message))
        .finally(() => setLoading(false));
    }, []);

    React.useEffect(() => { charger(); }, [charger]);

    const modifie = initial !== null && initial !== JSON.stringify({ f: fermes, c: codes });

    const enregistrer = () => {
      setSaving(true);
      fetch('/api/caisse?action=caisse-parametres-save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fermes, codes_analytiques: codes }),
      })
        .then(r => r.json())
        .then(j => {
          if (!j.success) { setToast({ msg: 'Erreur : ' + (j.error || 'inconnue'), kind: 'error' }); return; }
          setFermes(j.fermes); setCodes(j.codes_analytiques); setSeeded(true);
          setInitial(JSON.stringify({ f: j.fermes, c: j.codes_analytiques }));
          setToast({ msg: 'Paramètres enregistrés', kind: 'success' });
          if (onSaved) onSaved();
        })
        .catch(err => setToast({ msg: 'Erreur réseau : ' + err.message, kind: 'error' }))
        .finally(() => { setSaving(false); setTimeout(() => setToast(null), 2600); });
    };

    /**
     * Rafraîchit la liste des parcelles depuis le référentiel de campagne.
     * C'est LE seul endroit où la requête lente est faite : la culture est
     * résolue ici une fois pour toutes (référentiel Smart Berry prioritaire),
     * puis figée, pour que le formulaire de saisie n'ait plus rien à calculer.
     */
    const rafraichirParcelles = async () => {
      if (!window.confirm('Recharger la liste des parcelles depuis la campagne ?\n\nCela peut prendre quelques secondes. La liste actuelle sera remplacée.')) return;
      setRefreshing(true);
      try {
        const [ref, sb] = await Promise.all([
          fetch('/api/pointage-rh?action=parcelles-campagne-list').then(r => r.json()),
          fetch('/api/pointage-rh?action=sb-referentiel-list').then(r => r.json()).catch(() => ({ success: false })),
        ]);
        if (!ref || !ref.success) throw new Error((ref && ref.error) || 'Référentiel de campagne indisponible');

        const sbMap = {};
        if (sb && sb.success) (sb.parcelles || []).forEach(p => { sbMap[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p; });

        const CU = window.CultureUtils;
        const campagneOf = (d) => (window.CampagneUtils && window.CampagneUtils.campagneOf ? window.CampagneUtils.campagneOf(d) : '');
        const campCourante = campagneOf(new Date().toISOString().slice(0, 10));
        const anneePrec = parseInt(String(campCourante).slice(0, 4), 10) - 1;
        const campPrecedente = Number.isFinite(anneePrec) ? `${anneePrec}-${anneePrec + 1}` : '';

        const construire = (liste, campagne) => (liste || []).map(p => {
          const e = sbMap[(p.label || '').toUpperCase().trim()];
          return {
            label: p.label,
            nom: (e && e.nom_sb) ? e.nom_sb : p.label,
            culture: CU ? CU.resolveCulture({ label: p.label, culture: p.culture }, sbMap) : (p.culture || ''),
            ferme: p.ferme || '',
            campagne,
          };
        });

        const nouvelles = [
          ...construire(ref.campagne_courante, campCourante),
          ...construire(ref.campagne_precedente, campPrecedente),
        ];
        if (nouvelles.length === 0) throw new Error('Le référentiel de campagne est vide.');

        const r = await fetch('/api/caisse?action=caisse-parametres-save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fermes, codes_analytiques: codes, parcelles: nouvelles }),
        }).then(x => x.json());
        if (!r.success) throw new Error(r.error || 'Enregistrement refusé');

        setParcelles(r.parcelles || []);
        setParcellesMajAt(r.parcelles_maj_at || Date.now());
        setSeeded(true);
        setToast({ msg: `${(r.parcelles || []).length} parcelles enregistrées`, kind: 'success' });
        if (onSaved) onSaved();
      } catch (err) {
        setToast({ msg: 'Rafraîchissement impossible : ' + err.message, kind: 'error' });
      } finally {
        setRefreshing(false);
        setTimeout(() => setToast(null), 3200);
      }
    };

    if (loading) return <div style={{ padding: 30, textAlign: 'center', color: 'var(--gray-400)' }}><i className="fa-solid fa-spinner fa-spin"></i> Chargement…</div>;

    if (erreur) return (
      <div style={{ padding: '16px 18px', borderRadius: 12, background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', fontSize: 13, maxWidth: 700 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 8 }}></i>
          Paramètres indisponibles
        </div>
        <div style={{ marginBottom: 10 }}>{erreur}</div>
        <div style={{ fontSize: 12, color: '#7F1D1D' }}>
          Si l'écran vient d'être livré, le backend n'est peut-être pas encore déployé.
          Le bon de caisse continue de fonctionner avec les listes par défaut.
        </div>
        <button onClick={charger} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#991B1B', color: 'white', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
          <i className="fa-solid fa-arrow-rotate-right" style={{ marginRight: 6 }}></i>Réessayer
        </button>
      </div>
    );

    return (
      <div>
        {!seeded && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: '#E8F0FE', border: '1px solid #C3D9F7', fontSize: 12, color: '#1A56DB' }}>
            <i className="fa-solid fa-circle-info" style={{ marginTop: 2 }}></i>
            <span>Listes par défaut proposées — <strong>rien n'est encore enregistré</strong>. Ajustez-les puis cliquez sur Enregistrer pour les figer.</span>
          </div>
        )}
        {!canEdit && (
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'var(--gray-100)', fontSize: 12, color: 'var(--gray-600)' }}>
            <i className="fa-solid fa-lock" style={{ marginRight: 6 }}></i>
            Lecture seule — seuls la DG et la Finance peuvent modifier ces listes.
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <CPAR_ListeEditable
            titre="Fermes" icone="fa-warehouse" canEdit={canEdit}
            aide="Proposées dans le champ Ferme d'un bon de caisse. GENERAL = dépense non rattachée à une ferme."
            placeholder="Ajouter une ferme…"
            items={fermes} onChange={setFermes} />
          <CPAR_ListeEditable
            titre="Codes analytiques" icone="fa-tags" canEdit={canEdit}
            aide="Proposés dans le champ Code Analytique d'un bon de caisse. L'ordre de la liste est l'ordre d'affichage."
            placeholder="Ajouter un code analytique…"
            items={codes} onChange={setCodes} />

          {/* Parcelles — liste FIGÉE, non éditable à la main : elle vient du
              référentiel de campagne. C'est ce figeage qui rend la saisie d'un
              bon instantanée (l'agrégation source met plusieurs secondes). */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid var(--gray-200)', padding: 20, flex: '1 1 340px', minWidth: 300 }}>
            <h4 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <i className="fa-solid fa-map-location-dot" style={{ color: 'var(--berry)' }}></i>Parcelles
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500, color: 'var(--gray-400)' }}>{parcelles.length}</span>
            </h4>
            <div style={{ fontSize: 11.5, color: 'var(--gray-600)', marginBottom: 12 }}>
              Figées depuis le référentiel de campagne pour que la saisie d'un bon soit instantanée.
              Rafraîchir quand les parcelles de la campagne changent.
            </div>

            {parcelles.length === 0 ? (
              <div style={{ padding: '12px 14px', borderRadius: 8, background: '#FEF3C7', border: '1px solid #FDE68A', fontSize: 12, color: '#92400E', marginBottom: 12 }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }}></i>
                Aucune parcelle enregistrée — le champ Parcelle d'un bon ne proposera que GENERAL.
                Lancez un premier rafraîchissement.
              </div>
            ) : (
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 12 }}>
                {parcelles.map((p, i) => (
                  <div key={p.label + i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--gray-100)', borderRadius: 8, fontSize: 12 }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.label}>{p.nom || p.label}</span>
                    {p.culture && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'white', color: 'var(--gray-600)', border: '1px solid var(--gray-200)' }}>{p.culture}</span>}
                    {p.ferme && <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>{p.ferme}</span>}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {canEdit && (
                <button onClick={rafraichirParcelles} disabled={refreshing}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--berry)', background: 'white', color: 'var(--berry)', cursor: refreshing ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, opacity: refreshing ? 0.5 : 1 }}>
                  <i className={`fa-solid ${refreshing ? 'fa-spinner fa-spin' : 'fa-arrow-rotate-right'}`} style={{ marginRight: 6 }}></i>
                  {refreshing ? 'Rafraîchissement…' : 'Rafraîchir depuis la campagne'}
                </button>
              )}
              <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                {parcellesMajAt ? `Dernière mise à jour : ${new Date(parcellesMajAt).toLocaleString('fr-FR')}` : 'Jamais rafraîchie'}
              </span>
            </div>
          </div>
        </div>

        {canEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
            <button onClick={enregistrer} disabled={saving || !modifie}
              style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: 'var(--berry)', color: 'white', cursor: modifie ? 'pointer' : 'default', fontSize: 13, fontWeight: 600, opacity: (saving || !modifie) ? 0.45 : 1 }}>
              {saving ? <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 6 }}></i> : <i className="fa-solid fa-floppy-disk" style={{ marginRight: 6 }}></i>}
              Enregistrer
            </button>
            {modifie && (
              <button onClick={charger} disabled={saving}
                style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--gray-200)', background: 'white', cursor: 'pointer', fontSize: 13, color: 'var(--gray-600)' }}>
                Annuler les modifications
              </button>
            )}
            {modifie && <span style={{ fontSize: 12, color: 'var(--orange)' }}><i className="fa-solid fa-circle-exclamation" style={{ marginRight: 5 }}></i>Modifications non enregistrées</span>}
          </div>
        )}

        {toast && (
          <div style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 1000, padding: '10px 16px', borderRadius: 8, background: toast.kind === 'error' ? '#E74C3C' : '#1A7A3F', color: 'white', fontSize: 12.5, fontWeight: 600, boxShadow: '0 4px 14px rgba(0,0,0,0.18)' }}>
            <i className={`fa-solid ${toast.kind === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'}`} style={{ marginRight: 6 }}></i>
            {toast.msg}
          </div>
        )}
      </div>
    );
  }

  window.CaisseParametresSub = CaisseParametresSub;
})();
