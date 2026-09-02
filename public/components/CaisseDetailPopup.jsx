/*
 * CaisseDetailPopup.jsx — Détail d'une caisse, ouvert depuis sa carte du dashboard.
 *
 * Deux colonnes : ALIMENTATIONS (ce qui entre) et DÉCAISSEMENTS (ce qui sort),
 * chacune avec son total et sa liste de bons, puis le solde final. C'est la
 * lecture dont le caissier a besoin pour rapprocher son tiroir : d'où vient
 * l'argent, où il est parti, ce qu'il doit rester.
 *
 * AUCUN appel réseau : les bons sont déjà chargés par le dashboard, la pop-up
 * s'ouvre donc instantanément.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE (cf. crashes #75/#77). UN seul
 * global exposé : window.CaisseDetailPopup. Identifiants préfixés CDP_.
 *
 * Props :
 *   - caisse        Object  { id, nom, solde_initial, solde_actuel, solde_provisoire, … }
 *   - transactions  Array   TOUS les bons chargés ; le filtrage par caisse est fait ici
 *   - onClose       () => void
 */
(function () {
  const { useState } = React;

  /** Statuts dont l'argent a réellement bougé dans le tiroir. */
  const CDP_STATUTS_EN_CAISSE = ['valide', 'soumis', 'a_revoir'];
  const CDP_TYPES_ENTREE = ['alimentation', 'transfer_in'];
  const CDP_TYPES_SORTIE = ['depense', 'sortie', 'transfer_out', 'paie', 'transport'];

  const CDP_STATUT_LABELS = {
    brouillon: { label: 'Brouillon', color: '#6B7280', bg: '#F3F4F6' },
    soumis: { label: 'Saisi', color: '#1A56DB', bg: '#E8F0FE' },
    a_revoir: { label: 'À revoir', color: '#92400E', bg: '#FEF3C7' },
    valide: { label: 'Validé', color: '#1A7A3F', bg: '#DCF5E7' },
    rejete: { label: 'Rejeté', color: '#991B1B', bg: '#FEE2E2' },
  };

  function CDP_mad(n) {
    return (Number(n) || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DH';
  }

  /** Une colonne : titre, total, liste des bons. */
  function CDP_Colonne({ titre, icone, couleur, bons, total, signe, vide }) {
    return (
      <div style={{ flex: '1 1 320px', minWidth: 280, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 8, borderBottom: `2px solid ${couleur}` }}>
          <i className={`fa-solid ${icone}`} style={{ color: couleur }}></i>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-800)' }}>{titre}</span>
          <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{bons.length}</span>
          <span style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 800, color: couleur }}>
            {signe}{CDP_mad(total)}
          </span>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 8 }}>
          {bons.length === 0 && (
            <div style={{ padding: '18px 4px', fontSize: 12, color: 'var(--gray-400)', textAlign: 'center' }}>{vide}</div>
          )}
          {bons.map((t, i) => {
            const st = CDP_STATUT_LABELS[t.status] || {};
            return (
              <div key={t.id || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 4px', borderBottom: '1px solid var(--gray-100)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--gray-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.description || t.reference}>
                    {t.description || t.reference || '—'}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--gray-400)', marginTop: 1 }}>
                    {t.date}
                    {t.code_analytique ? ` · ${t.code_analytique}` : ''}
                    {t.ferme ? ` · ${t.ferme}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: couleur }}>{signe}{CDP_mad(t.montant)}</div>
                  {t.status !== 'valide' && (
                    <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 8, background: st.bg || '#eee', color: st.color || '#333', fontWeight: 700 }}>
                      {st.label || t.status}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function CaisseDetailPopup({ caisse, transactions, onClose }) {
    // Inclure ou non les bons pas encore validés. Par défaut OUI : c'est ce qui
    // correspond au tiroir. Décocher donne la vision comptable.
    const [inclureEnAttente, setInclureEnAttente] = useState(true);

    if (!caisse) return null;

    const tous = (Array.isArray(transactions) ? transactions : [])
      .filter(t => t && t.caisse_id === caisse.id && CDP_STATUTS_EN_CAISSE.indexOf(t.status) !== -1)
      .filter(t => inclureEnAttente || t.status === 'valide')
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const alimentations = tous.filter(t => CDP_TYPES_ENTREE.indexOf(t.type) !== -1);
    const decaissements = tous.filter(t => CDP_TYPES_SORTIE.indexOf(t.type) !== -1);
    const somme = (l) => Math.round(l.reduce((s, t) => s + (Number(t.montant) || 0), 0) * 100) / 100;
    const totalIn = somme(alimentations);
    const totalOut = somme(decaissements);
    const soldeInitial = Number(caisse.solde_initial) || 0;
    const soldeFinal = Math.round((soldeInitial + totalIn - totalOut) * 100) / 100;
    const nbEnAttente = tous.filter(t => t.status !== 'valide').length;

    const bloc = (label, valeur, couleur) => (
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gray-400)' }}>{label}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: couleur || 'var(--gray-800)' }}>{valeur}</div>
      </div>
    );

    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 860, width: '95%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="fa-solid fa-cash-register" style={{ color: 'var(--berry)' }}></i>
              {caisse.nom || caisse.id}
            </h3>
            <button onClick={onClose} aria-label="Fermer"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--gray-400)' }}>
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--gray-600)', cursor: 'pointer', marginBottom: 14 }}>
            <input type="checkbox" checked={inclureEnAttente} onChange={e => setInclureEnAttente(e.target.checked)} style={{ cursor: 'pointer' }} />
            Inclure les bons saisis non encore validés
            {nbEnAttente > 0 && inclureEnAttente && <span style={{ color: 'var(--orange)', fontWeight: 600 }}>({nbEnAttente})</span>}
          </label>

          {/* Récapitulatif : d'où on part, ce qui entre, ce qui sort, ce qui reste. */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px', background: 'var(--gray-100)', borderRadius: 10, marginBottom: 16 }}>
            {bloc('Solde initial', CDP_mad(soldeInitial))}
            <span style={{ color: 'var(--gray-400)' }}>+</span>
            {bloc('Alimentations', CDP_mad(totalIn), 'var(--green)')}
            <span style={{ color: 'var(--gray-400)' }}>−</span>
            {bloc('Décaissements', CDP_mad(totalOut), 'var(--red)')}
            <span style={{ color: 'var(--gray-400)' }}>=</span>
            <div style={{ marginLeft: 'auto' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gray-400)' }}>
                {inclureEnAttente ? 'Solde en caisse' : 'Solde validé'}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: soldeFinal < 0 ? 'var(--red)' : 'var(--berry)' }}>{CDP_mad(soldeFinal)}</div>
            </div>
          </div>

          {soldeFinal < 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', marginBottom: 14, borderRadius: 8, background: '#FEF3C7', border: '1px solid #FDE68A', fontSize: 11.5, color: '#92400E' }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ marginTop: 2 }}></i>
              <span>Solde négatif : les alimentations de cette caisse n'ont pas encore été saisies.</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <CDP_Colonne titre="Alimentations" icone="fa-arrow-down" couleur="var(--green)"
              bons={alimentations} total={totalIn} signe="+"
              vide="Aucune alimentation saisie." />
            <CDP_Colonne titre="Décaissements" icone="fa-arrow-up" couleur="var(--red)"
              bons={decaissements} total={totalOut} signe="−"
              vide="Aucun décaissement." />
          </div>
        </div>
      </div>
    );
  }

  window.CaisseDetailPopup = CaisseDetailPopup;
})();
