/*
 * CaisseRevueValidation.jsx — Revue DG des bons de caisse, un bon à la fois.
 *
 * L'écran Validation historique empile toutes les cartes : à 40 bons, la DG
 * scrolle et perd le fil. Ici : UN bon en grand, navigation flèche gauche /
 * droite (et touches ← →), compteur de position, et les trois décisions
 * possibles sous la main.
 *
 * N'invente aucune règle métier : appelle les actions existantes
 * validate-transaction / reject-transaction / mark-revoir-batch. C'est la
 * validation UNITAIRE qui est utilisée — elle mouvemente le solde de la caisse
 * de façon atomique.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE (cf. crashes #75/#77). UN seul
 * global exposé : window.CaisseRevueValidation. Identifiants préfixés CRV_.
 *
 * Props :
 *   - transactions  Array   bons au statut 'soumis', dans l'ordre d'affichage
 *   - caisses       Array   pour afficher le nom de la caisse
 *   - onDecision    (id, decision) => Promise  'valide' | 'rejete' | 'a_revoir'
 *   - onQuitter     () => void   retour à la vue liste
 */
(function () {
  const { useState } = React;

  const CRV_FALLBACK_TYPES = {
    alimentation: { label: 'Alimentation', color: 'var(--green)', bg: 'rgba(45,139,78,0.1)', icon: 'fa-arrow-down' },
    depense: { label: 'Dépense', color: 'var(--red)', bg: 'rgba(231,76,60,0.1)', icon: 'fa-arrow-up' },
    sortie: { label: 'Sortie', color: 'var(--orange)', bg: 'rgba(243,156,18,0.1)', icon: 'fa-arrow-right-from-bracket' },
    paie: { label: 'Paie', color: '#9b59b6', bg: 'rgba(155,89,182,0.1)', icon: 'fa-money-check-dollar' },
    transport: { label: 'Transport', color: '#16a085', bg: 'rgba(22,160,133,0.1)', icon: 'fa-truck' },
  };

  function CRV_mad(n) {
    return (Number(n) || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DH';
  }

  /** Une ligne d'information du bon. Rendue même vide, pour signaler ce qui manque. */
  function CRV_Info({ label, valeur, alerte }) {
    const vide = valeur === undefined || valeur === null || valeur === '';
    return (
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gray-400)' }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: vide ? 400 : 600, color: vide ? (alerte ? 'var(--orange)' : 'var(--gray-400)') : 'var(--gray-800)' }}>
          {vide ? (alerte ? 'Non renseigné' : '—') : valeur}
        </div>
      </div>
    );
  }

  function CaisseRevueValidation({ transactions, caisses, onDecision, onQuitter }) {
    const [index, setIndex] = useState(0);
    const [busy, setBusy] = useState(false);
    const [motif, setMotif] = useState('');
    const [demandeRejet, setDemandeRejet] = useState(false);
    const [traites, setTraites] = useState({ valide: 0, rejete: 0, a_revoir: 0, montantValide: 0 });

    const total = transactions.length;
    // Après un traitement, la liste rétrécit : l'index doit rester dans les
    // bornes, sinon on affiche du vide au lieu du bon suivant.
    const pos = Math.min(index, Math.max(0, total - 1));
    const tx = transactions[pos];

    const aller = React.useCallback((delta) => {
      setDemandeRejet(false); setMotif('');
      setIndex((cur) => {
        const n = Math.min(cur, Math.max(0, total - 1)) + delta;
        if (n < 0) return 0;
        if (n > total - 1) return Math.max(0, total - 1);
        return n;
      });
    }, [total]);

    const decider = async (decision) => {
      if (!tx || busy) return;
      if (decision === 'rejete' && !motif.trim()) { setDemandeRejet(true); return; }
      setBusy(true);
      try {
        const ok = await onDecision(tx.id, decision, motif.trim());
        if (ok) {
          setTraites((t) => ({
            ...t,
            [decision]: t[decision] + 1,
            montantValide: decision === 'valide' ? t.montantValide + (Number(tx.montant) || 0) : t.montantValide,
          }));
          setMotif(''); setDemandeRejet(false);
          // On NE bouge pas l'index : le bon suivant prend la place du traité.
          setIndex((cur) => Math.min(cur, Math.max(0, total - 2)));
        }
      } finally {
        setBusy(false);
      }
    };

    // Raccourcis clavier : ← → pour naviguer. Volontairement PAS de raccourci
    // pour valider/rejeter — une décision qui engage le solde ne doit pas
    // partir sur une frappe involontaire.
    React.useEffect(() => {
      const onKey = (e) => {
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); aller(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); aller(1); }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [aller]);

    const TYPES = window.TXN_TYPE_LABELS || CRV_FALLBACK_TYPES;

    if (!tx) {
      return (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className="fa-solid fa-circle-check" style={{ fontSize: 48, color: 'var(--green)', marginBottom: 12 }}></i>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Revue terminée</div>
          <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 6 }}>
            {traites.valide} validé(s) · {traites.a_revoir} à revoir · {traites.rejete} rejeté(s)
          </div>
          {traites.valide > 0 && (
            <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 4 }}>
              Montant validé : <strong>{CRV_mad(traites.montantValide)}</strong>
            </div>
          )}
          <button onClick={onQuitter} style={{ marginTop: 18, padding: '10px 20px', borderRadius: 10, border: '1px solid var(--gray-200)', background: 'white', cursor: 'pointer', fontSize: 13 }}>
            Retour à la liste
          </button>
        </div>
      );
    }

    const tt = TYPES[tx.type] || {};
    const caisseNom = (caisses.find(c => c.id === tx.caisse_id) || {}).nom || tx.caisse_id;
    const sortie = ['depense', 'sortie', 'transfer_out', 'paie', 'transport'].indexOf(tx.type) !== -1;
    const nav = { width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--gray-200)', background: 'white', cursor: 'pointer', fontSize: 16, color: 'var(--berry)' };

    return (
      <div>
        {/* Barre de navigation — POSITION FIXE.
            Les flèches étaient auparavant collées aux flancs de la carte, donc
            centrées sur une hauteur qui varie d'un bon à l'autre (description
            longue, justificatifs ou non) : elles sautaient à chaque bon. Ici
            elles sont dans une barre dont la hauteur ne dépend pas du contenu,
            donc elles ne bougent jamais. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <button onClick={onQuitter} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--gray-200)', background: 'white', cursor: 'pointer', fontSize: 12, color: 'var(--gray-600)' }}>
            <i className="fa-solid fa-list" style={{ marginRight: 6 }}></i>Vue liste
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => aller(-1)} disabled={pos === 0} title="Bon précédent (←)" aria-label="Bon précédent"
              style={{ ...nav, opacity: pos === 0 ? 0.3 : 1, cursor: pos === 0 ? 'default' : 'pointer' }}>
              <i className="fa-solid fa-chevron-left"></i>
            </button>
            <div style={{ fontSize: 13, color: 'var(--gray-600)', whiteSpace: 'nowrap', minWidth: 96, textAlign: 'center' }}>
              <strong style={{ color: 'var(--berry)', fontSize: 15 }}>{pos + 1}</strong> / {total}
            </div>
            <button onClick={() => aller(1)} disabled={pos >= total - 1} title="Bon suivant (→)" aria-label="Bon suivant"
              style={{ ...nav, opacity: pos >= total - 1 ? 0.3 : 1, cursor: pos >= total - 1 ? 'default' : 'pointer' }}>
              <i className="fa-solid fa-chevron-right"></i>
            </button>
          </div>

          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ height: 6, background: 'var(--gray-100)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${total ? ((pos + 1) / total) * 100 : 0}%`, background: 'var(--berry)', transition: 'width 0.2s' }}></div>
            </div>
          </div>
          {(traites.valide + traites.rejete + traites.a_revoir) > 0 && (
            <div style={{ fontSize: 11, color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>
              {traites.valide} validé(s) · {CRV_mad(traites.montantValide)}
            </div>
          )}
        </div>

        <div>
          {/* minHeight : un bon court et un bon avec 3 photos occupent la même
              place, donc les boutons de décision ne sautent pas non plus. */}
          <div style={{ background: 'white', borderRadius: 14, border: '1px solid var(--gray-200)', padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.04)', minHeight: 480, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--gray-400)' }}>{tx.reference}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--gray-800)', marginTop: 2 }}>{tx.description || 'Sans description'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 12, background: tt.bg || '#eee', color: tt.color || '#333', fontSize: 11, fontWeight: 600 }}>
                    <i className={`fa-solid ${tt.icon || ''}`} style={{ marginRight: 4 }}></i>{tt.label || tx.type}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--gray-600)' }}>{caisseNom}</span>
                  <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>· {tx.date}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: sortie ? 'var(--red)' : 'var(--green)', lineHeight: 1.1 }}>
                  {sortie ? '−' : '+'}{CRV_mad(tx.montant)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>Saisi par {(tx.saisie_by && tx.saisie_by.name) || '—'}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 14, padding: '14px 0', borderTop: '1px solid var(--gray-100)', borderBottom: '1px solid var(--gray-100)' }}>
              <CRV_Info label="Code analytique" valeur={tx.code_analytique} alerte />
              <CRV_Info label="Ferme" valeur={tx.ferme} alerte />
              <CRV_Info label="Culture" valeur={tx.culture} />
              <CRV_Info label="Parcelle" valeur={tx.parcelle} alerte />
              <CRV_Info label="Campagne" valeur={tx.campagne} />
              {(tx.type === 'paie' || tx.type === 'transport') && <CRV_Info label="Bénéficiaire" valeur={tx.beneficiaire_nom} />}
            </div>

            {Array.isArray(tx.files) && tx.files.length > 0 ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gray-400)', marginBottom: 6 }}>Justificatifs</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {tx.files.map((f, i) => (
                    <img key={i} src={f.data || f.url} alt="" onClick={() => window.open(f.data || f.url, '_blank')}
                      style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--gray-200)', cursor: 'zoom-in' }} />
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--orange)' }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }}></i>Aucun justificatif joint
              </div>
            )}

            {demandeRejet && (
              <div style={{ marginTop: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>Motif du rejet (obligatoire)</label>
                <input type="text" value={motif} autoFocus onChange={e => setMotif(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && motif.trim()) decider('rejete'); }}
                  placeholder="Ex : montant incohérent avec le justificatif"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--red)', fontSize: 13 }} />
              </div>
            )}

            {/* marginTop:auto — les décisions sont collées au BAS de la carte,
                à hauteur constante grâce au minHeight ci-dessus. */}
            <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 18, flexWrap: 'wrap' }}>
              <button onClick={() => decider('valide')} disabled={busy}
                style={{ padding: '11px 22px', borderRadius: 10, border: 'none', background: 'var(--green)', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: busy ? 0.5 : 1 }}>
                <i className="fa-solid fa-check" style={{ marginRight: 6 }}></i>Valider
              </button>
              <button onClick={() => decider('a_revoir')} disabled={busy}
                style={{ padding: '11px 18px', borderRadius: 10, border: 'none', background: '#F39C12', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: busy ? 0.5 : 1 }}>
                <i className="fa-solid fa-rotate-right" style={{ marginRight: 6 }}></i>À revoir
              </button>
              <button onClick={() => decider('rejete')} disabled={busy}
                style={{ padding: '11px 18px', borderRadius: 10, border: '1px solid var(--red)', background: 'white', color: 'var(--red)', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: busy ? 0.5 : 1 }}>
                <i className="fa-solid fa-xmark" style={{ marginRight: 6 }}></i>Rejeter
              </button>
              <button onClick={() => aller(1)} disabled={busy || pos >= total - 1}
                style={{ marginLeft: 'auto', padding: '11px 18px', borderRadius: 10, border: '1px solid var(--gray-200)', background: 'white', color: 'var(--gray-600)', cursor: 'pointer', fontSize: 13, opacity: (busy || pos >= total - 1) ? 0.4 : 1 }}>
                Passer<i className="fa-solid fa-arrow-right" style={{ marginLeft: 6 }}></i>
              </button>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--gray-400)', marginTop: 12 }}>
          Flèches ← → du clavier pour naviguer d'un bon à l'autre
        </div>
      </div>
    );
  }

  window.CaisseRevueValidation = CaisseRevueValidation;
})();
