/*
 * MagBonsCommandeTab.jsx — Liste de TOUS les bons de commande (tous statuts)
 * pour le profil magasinier, en LECTURE, SANS AUCUN PRIX NI MONTANT.
 *
 * Identifiants internes préfixés MBC_.
 *
 * Contexte métier : le magasinier gère la réception physique des BDC, pas les
 * aspects financiers. Cette page complète MagBdcReceptionTab ("BDC à
 * réceptionner") qui, elle, filtre sur valide_dg/envoye et affiche le Total
 * TTC. Ici : tous les statuts, aucun prix — ni dans la liste, ni dans le
 * détail d'un BDC.
 *
 * Backend : action list-bdc (functions/index.js) retourne le document
 * purchase_orders complet (total_ttc, prix_unitaire, montant_* compris). Le
 * masquage se fait CÔTÉ CLIENT UNIQUEMENT : ce composant ne lit/affiche
 * JAMAIS total_ht, total_tva, total_ttc, ni prix_unitaire/montant_ht/
 * montant_tva/montant_ttc sur les lignes d'articles.
 *
 * Props :
 *   - currentProfile : id du profil courant (string)
 *   - profileData    : objet profil (non utilisé pour l'instant, écran 100% lecture)
 */

import * as BdcReceptionUtils from '../shared/lib/bdcReceptionUtils.js';

var useState = React.useState;
var useMemo = React.useMemo;
var useEffect = React.useEffect;

var MBC_STATUS_META = {
  brouillon:       { label: 'Brouillon',        cls: 'brouillon' },
  en_attente_chef: { label: 'Attente Chef',     cls: 'en-attente' },
  valide_chef:     { label: 'Validé Chef',      cls: 'valide' },
  en_attente_dg:   { label: 'Attente DG',       cls: 'en-attente' },
  valide_dg:       { label: 'Validé DG',        cls: 'valide' },
  envoye:          { label: 'Envoyé',           cls: 'envoye' },
  virement_lance:  { label: 'Virement lancé',   cls: 'en-attente' },
  virement_signe:  { label: 'Virement signé',   cls: 'valide' },
  rejete:          { label: 'Rejeté',           cls: 'rejete' },
  rejete_dg:       { label: 'Rejeté DG',         cls: 'rejete' },
  annule:          { label: 'Annulé',           cls: 'rejete' }
};

var MBC_DELIVERY_META = {
  complet: { label: 'Complet', cls: 'valide' },
  partiel: { label: 'Partiel', cls: 'en-attente' },
  non_livre: { label: 'Non livré', cls: 'brouillon' }
};

function mbcStatusMeta(status) {
  return MBC_STATUS_META[status] || { label: status || '—', cls: 'brouillon' };
}

function mbcDeliveryMeta(status) {
  return MBC_DELIVERY_META[status] || MBC_DELIVERY_META.non_livre;
}

function mbcFmtDate(v) {
  if (!v) return '—';
  // created_at est un timestamp epoch (Date.now()) côté backend BDC.
  var d = typeof v === 'number' ? new Date(v) : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('fr-FR');
}

function MBC_Badge(props) {
  return <span className={'status-badge ' + props.cls}>{props.label}</span>;
}

function MagBonsCommandeTab() {
  var listState = useState([]);
  var bdcList = listState[0];
  var setBdcList = listState[1];

  var loadingState = useState(true);
  var loading = loadingState[0];
  var setLoading = loadingState[1];

  var errState = useState(null);
  var err = errState[0];
  var setErr = errState[1];

  var queryState = useState('');
  var query = queryState[0];
  var setQuery = queryState[1];

  var detailState = useState(null);
  var detail = detailState[0];
  var setDetail = detailState[1];

  // Reçu/Reliquat par article pour le BDC ouvert dans la popup (lecture seule,
  // aucun prix). Reset à chaque ouverture/fermeture — cf. openDetail/closeDetail.
  var detailReceptionState = useState(null);
  var detailReception = detailReceptionState[0];
  var setDetailReception = detailReceptionState[1];

  // Bons de Réception (BR-XXXX, stock_movements type reception) rattachés au
  // BDC ouvert dans la popup — document distinct des BL (delivery_notes) mais
  // créé en même temps par create-bl, même bdc_id. Fetché en parallèle du
  // reliquat (indépendant, ne bloque jamais l'affichage Reçu/Reliquat).
  var detailReceptionsState = useState(null);
  var detailReceptions = detailReceptionsState[0];
  var setDetailReceptions = detailReceptionsState[1];

  function openDetail(b) {
    setDetail(b);
    setDetailReception({ loading: true, byArticle: {}, error: null });
    setDetailReceptions({ loading: true, list: [], error: null });
    fetch('/api/stock?action=list-bl&bdc_id=' + b.id)
      .then(function (r) { return r.json(); })
      .then(function (json) {
        var resolved = BdcReceptionUtils.resolveDeliveryDataOrError(json);
        if (!resolved.ok) {
          // NE JAMAIS afficher Reçu=0/Reliquat=quantité commandée quand la donnée
          // est en fait indisponible (bug BDC-2026-0142) — écran 100% lecture
          // seule, donc on affiche l'erreur à la place des colonnes.
          setDetailReception({ loading: false, byArticle: {}, error: resolved.error });
          return;
        }
        var delivery = BdcReceptionUtils.computeDeliveryData(b.items, resolved.data);
        var byArticle = {};
        delivery.forEach(function (d) { byArticle[d.article] = d; });
        setDetailReception({ loading: false, byArticle: byArticle, error: null });
      })
      .catch(function () { setDetailReception({ loading: false, byArticle: {}, error: 'Erreur réseau — reliquat indisponible.' }); });

    fetch('/api/stock?action=list-movements&type=reception&limit=200')
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (!json || !json.success) {
          setDetailReceptions({ loading: false, list: [], error: (json && json.error) || 'Impossible de charger les bons de réception.' });
          return;
        }
        var list = BdcReceptionUtils.filterReceptionsForBdc(json.movements, b.id);
        setDetailReceptions({ loading: false, list: list, error: null });
      })
      .catch(function () { setDetailReceptions({ loading: false, list: [], error: 'Erreur réseau — bons de réception indisponibles.' }); });
  }

  function closeDetail() {
    setDetail(null);
    setDetailReception(null);
    setDetailReceptions(null);
  }

  useEffect(function () {
    setLoading(true);
    fetch('/api/stock?action=list-bdc')
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (json && json.success) {
          setBdcList(json.bdc || []);
        } else {
          setErr((json && json.error) || 'Erreur de chargement des bons de commande');
        }
      })
      .catch(function () { setErr('Erreur réseau'); })
      .finally(function () { setLoading(false); });
  }, []);

  var visible = useMemo(function () {
    var q = query.trim().toLowerCase();
    if (!q) return bdcList;
    return bdcList.filter(function (b) {
      var numero = (b.numero || '').toLowerCase();
      var fournisseur = ((b.fournisseur && b.fournisseur.nom) || '').toLowerCase();
      return numero.indexOf(q) !== -1 || fournisseur.indexOf(q) !== -1;
    });
  }, [bdcList, query]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 32, color: 'var(--berry)' }}></i>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>
          <i className="fa-solid fa-file-contract" style={{ marginRight: 8, color: 'var(--berry)' }}></i>
          Bons de Commande
        </h3>
        <input
          type="search"
          placeholder="Rechercher (n° BDC, fournisseur…)"
          value={query}
          onChange={function (e) { setQuery(e.target.value); }}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 12, minWidth: 260 }}
        />
      </div>

      {err ? (
        <div style={{ background: '#FCEBEB', color: '#A32D2D', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{err}</div>
      ) : null}

      <div className="panel">
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 13, color: 'var(--gray-400)' }}>
          {visible.length} bon{visible.length === 1 ? '' : 's'} de commande
        </p>
        {visible.length === 0 ? (
          <p style={{ color: 'var(--gray-400)', textAlign: 'center', padding: 20 }}>Aucun bon de commande.</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>N° BDC</th>
                  <th>Date</th>
                  <th>Fournisseur</th>
                  <th>Ferme</th>
                  <th>Articles</th>
                  <th>Statut</th>
                  <th>Livraison</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(function (b) {
                  var statusMeta = mbcStatusMeta(b.status);
                  var deliveryMeta = mbcDeliveryMeta(b.delivery_status);
                  return (
                    <tr key={b.id} onClick={function () { openDetail(b); }} style={{ cursor: 'pointer' }}>
                      <td style={{ fontWeight: 700, color: 'var(--berry)', fontSize: 12 }}>{b.numero}</td>
                      <td>{mbcFmtDate(b.created_at)}</td>
                      <td style={{ fontWeight: 600 }}>{(b.fournisseur && b.fournisseur.nom) || '—'}</td>
                      <td>{b.ferme || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{(b.items && b.items.length) || 0}</td>
                      <td><MBC_Badge cls={statusMeta.cls} label={statusMeta.label} /></td>
                      <td><MBC_Badge cls={deliveryMeta.cls} label={deliveryMeta.label} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail ? (
        <div className="modal-overlay" onClick={function (e) { if (e.target === e.currentTarget) closeDetail(); }}>
          <div className="modal-content" style={{ maxWidth: 640, maxHeight: '85vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0, color: 'var(--berry)' }}>
              <i className="fa-solid fa-file-contract" style={{ marginRight: 8 }}></i>
              BDC {detail.numero}
            </h3>
            <div style={{ background: '#f8f8f8', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <span><strong>Fournisseur :</strong> {(detail.fournisseur && detail.fournisseur.nom) || '—'}</span>
              <span><strong>Ferme :</strong> {detail.ferme || '—'}</span>
              <span><strong>Date :</strong> {mbcFmtDate(detail.created_at)}</span>
              <span><strong>Statut :</strong> <MBC_Badge cls={mbcStatusMeta(detail.status).cls} label={mbcStatusMeta(detail.status).label} /></span>
            </div>
            <h4 style={{ marginBottom: 8 }}>Articles</h4>
            {detailReception && detailReception.error ? (
              <div style={{ background: '#fdecea', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }}></i>
                {detailReception.error}
              </div>
            ) : (
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Désignation</th>
                    <th>Quantité</th>
                    <th>Unité</th>
                    <th>Reçu</th>
                    <th>Reliquat</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map(function (it, idx) {
                    var d = detailReception && detailReception.byArticle ? detailReception.byArticle[it.article] : null;
                    var loadingReception = detailReception && detailReception.loading;
                    return (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{it.article}</td>
                        <td style={{ textAlign: 'center' }}>{it.quantite}</td>
                        <td>{it.unite || '—'}</td>
                        <td style={{ textAlign: 'center' }}>{loadingReception ? '…' : (d ? d.qLiv : 0)}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: d && d.reste <= 0 ? 'var(--gray-400)' : 'var(--berry)' }}>{loadingReception ? '…' : (d ? d.reste : it.quantite)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
              <h4 style={{ marginTop: 0, marginBottom: 8 }}>Bons de Réception</h4>
              {detailReceptions && detailReceptions.loading ? (
                <p style={{ color: 'var(--gray-400)', fontSize: 12 }}>Chargement…</p>
              ) : detailReceptions && detailReceptions.error ? (
                <div style={{ background: '#fdecea', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 8, padding: 10, fontSize: 12 }}>
                  <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }}></i>
                  {detailReceptions.error}
                </div>
              ) : detailReceptions && detailReceptions.list.length > 0 ? (
                <table className="data-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>N° BR</th>
                      <th>Date</th>
                      <th>Désignation</th>
                      <th>Qté reçue</th>
                      <th>Reliquat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BdcReceptionUtils.computeReceptionRowsWithReliquat(detail.items, detailReceptions.list).map(function (row) {
                      return (
                        <tr key={row.numero}>
                          <td style={{ fontWeight: 700, color: 'var(--berry)' }}>{row.numero}</td>
                          <td>{mbcFmtDate(row.date)}</td>
                          <td>
                            {row.articles.map(function (a, i) {
                              return <div key={i}>{a.article}</div>;
                            })}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {row.articles.map(function (a, i) {
                              return <div key={i}>{a.quantite_recue} {a.unite}</div>;
                            })}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {row.articles.map(function (a, i) {
                              return <div key={i} style={{ fontWeight: 700, color: a.reliquat_apres <= 0 ? 'var(--gray-400)' : 'var(--berry)' }}>{a.reliquat_apres}</div>;
                            })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: 'var(--gray-400)', fontSize: 12 }}>Aucune réception enregistrée.</p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={function () { closeDetail(); }}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 }}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { MagBonsCommandeTab };
