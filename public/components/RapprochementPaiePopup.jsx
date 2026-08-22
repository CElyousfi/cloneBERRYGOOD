/*
 * RapprochementPaiePopup.jsx — « Comparer au fichier de paie ».
 *
 * Le responsable RH dépose le fichier Excel de la quinzaine ; l'écran lui dit
 * poste par poste où il diverge de Smart Berry, et surtout de quelle NATURE est
 * chaque écart : un calcul à corriger, ou un désaccord de données à arbitrer.
 *
 * ── LECTURE SEULE ──────────────────────────────────────────────────────────
 * Le fichier n'est ni envoyé au serveur, ni stocké : il porte la paie nominative
 * de 250 personnes. Il est lu EN MÉMOIRE dans le navigateur, comparé, puis jeté.
 * Aucune écriture Firestore.
 *
 * ── CE QUE L'ÉCRAN DOIT ÉVITER DE FAIRE CROIRE ─────────────────────────────
 * Le « NET » du fichier (153 503 DH sur la Quinzaine 01) ne couvre QUE les
 * salaires ; le « Net à payer » de Smart Berry (187 737) y ajoute le transport
 * et la sous-traitance. Les afficher côte à côte sans reconstituer le périmètre
 * fabrique 34 000 DH d'écart qui n'existent pas — c'est arrivé le 2026-08-22, et
 * il a fallu une demi-journée pour établir que les deux chiffres ne parlaient
 * pas de la même chose. Chaque ligne porte donc son périmètre dans son libellé.
 *
 * Chargé en <script> classique : IIFE, aucun identifiant top-level (une
 * collision dans le scope global crashe le boot React #200). Un seul global :
 * window.RapprochementPaiePopup.
 */
(function () {
  'use strict';

  const { useState } = React;

  /** Palette alignée sur l'écran Quinzaine. */
  const C = {
    berry: 'var(--berry)',
    rouge: '#c0392b',
    ambre: '#b7791f',
    vert: '#1D9E75',
    gris: 'var(--gray-500)',
    bord: 'var(--gray-200)',
  };

  const dh = (v) => Math.round(v).toLocaleString('fr-FR');

  /** Feuille du classeur, par nom, en tolérant espaces et casse. */
  function feuille(wb, ...noms) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const n of noms) {
      const trouve = wb.SheetNames.find((s) => norm(s) === norm(n));
      if (trouve) return trouve;
    }
    return null;
  }

  /** Feuille → grille de cellules, cases vides à `null`. */
  function grille(wb, nom) {
    if (!nom || !wb.Sheets[nom]) return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null });
  }

  /**
   * Lit un classeur déposé et en extrait les postes.
   * Lève une erreur PARLANTE : « fichier illisible » n'aide personne à corriger.
   */
  function lireClasseur(buffer) {
    const L = window.LecturePaieExcel;
    if (!L) throw new Error('Module de lecture non chargé — recharge la page.');
    const wb = XLSX.read(buffer, { type: 'array' });
    const nP = feuille(wb, 'POINTAGE');
    const nS = feuille(wb, 'SANS CNSS');
    if (!nP || !nS) {
      throw new Error('Feuilles « POINTAGE » et « SANS CNSS » introuvables. '
        + 'Feuilles présentes : ' + wb.SheetNames.join(', '));
    }
    const gP = grille(wb, nP);
    const gS = grille(wb, nS);
    const pointage = L.lireFeuilleOuvriers(gP);
    const sansCnss = L.lireFeuilleOuvriers(gS);
    if (!pointage.length && !sansCnss.length) {
      throw new Error('Aucune ligne d\'ouvrier lue — les colonnes attendues '
        + '(« Matricule », « Montant Brut ») sont-elles présentes ?');
    }
    const nT = feuille(wb, 'TRANSPORT');
    const transport = nT ? L.lireTransport(grille(wb, nT)) : { total: 0, places: 0, equipes: [] };
    // La quinzaine se lit DANS la feuille, jamais dans le nom du fichier :
    // macOS encode les accents en NFD, et deux quinzaines ont déjà été
    // interverties à cause de ça (2026-08-21).
    const periode = L.periodeDeGrille(gP) || L.periodeDeGrille(gS);
    return { periode, postes: L.postesExcel({ pointage, sansCnss, transport }) };
  }

  /** Bandeau d'alerte — la couleur porte la NATURE de l'écart. */
  function Alerte({ a }) {
    const style = {
      bloquant: { fond: '#fdecea', bord: C.rouge, icone: 'fa-circle-exclamation', couleur: C.rouge },
      arbitrage: { fond: '#fff8e6', bord: C.ambre, icone: 'fa-scale-balanced', couleur: C.ambre },
      calcul: { fond: '#fdecea', bord: C.rouge, icone: 'fa-calculator', couleur: C.rouge },
      ok: { fond: '#e9f7f1', bord: C.vert, icone: 'fa-circle-check', couleur: C.vert },
    }[a.niveau] || { fond: '#f5f5f5', bord: C.gris, icone: 'fa-circle-info', couleur: C.gris };
    return (
      <div style={{ background: style.fond, borderLeft: '3px solid ' + style.bord,
        padding: '10px 14px', borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
        <i className={'fa-solid ' + style.icone} style={{ color: style.couleur, marginRight: 8 }}></i>
        {a.texte}
      </div>
    );
  }

  function RapprochementPaiePopup({ periode, quinzaine, baremes, onClose }) {
    const [rapport, setRapport] = useState(null);
    const [erreur, setErreur] = useState(null);
    const [nomFichier, setNomFichier] = useState(null);
    const [periodeFichier, setPeriodeFichier] = useState(null);

    function deposer(e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      setErreur(null); setRapport(null);
      setNomFichier(f.name);
      const lecteur = new FileReader();
      lecteur.onload = (ev) => {
        try {
          const lu = lireClasseur(new Uint8Array(ev.target.result));
          setPeriodeFichier(lu.periode);
          const R = window.RapprochementPaie;
          if (!R) throw new Error('Module de rapprochement non chargé — recharge la page.');
          setRapport(R.comparer({ fichier: lu.postes, quinzaine, baremes }));
        } catch (err) {
          setErreur(err.message);
        }
      };
      lecteur.onerror = () => setErreur('Lecture du fichier impossible.');
      lecteur.readAsArrayBuffer(f);
    }

    const td = { padding: '7px 10px', fontSize: 13, textAlign: 'right' };
    const tdL = { ...td, textAlign: 'left' };
    const th = { ...td, fontSize: 11, fontWeight: 700, color: C.gris,
      borderBottom: '1px solid ' + C.bord };

    return (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14,
          maxWidth: 940, width: '100%', maxHeight: '88vh', overflowY: 'auto', padding: 20 }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <i className="fa-solid fa-file-excel" style={{ color: C.vert, fontSize: 18 }}></i>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              Comparer au fichier de paie — {periode}
            </div>
            <button onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'none',
              fontSize: 20, cursor: 'pointer', color: C.gris }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: C.gris, marginBottom: 14 }}>
            Le fichier est lu <strong>dans ton navigateur</strong> : il n'est ni envoyé au
            serveur, ni enregistré. Rien n'est modifié.
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            border: '1px dashed ' + C.berry, borderRadius: 8, cursor: 'pointer', color: C.berry,
            fontSize: 13, fontWeight: 600 }}>
            <i className="fa-solid fa-upload"></i>
            {nomFichier || 'Déposer le fichier .xlsx de la quinzaine'}
            <input type="file" accept=".xlsx" onChange={deposer} style={{ display: 'none' }} />
          </label>

          {periodeFichier && (
            <div style={{ fontSize: 12, color: C.gris, marginTop: 8 }}>
              Quinzaine lue <strong>dans la feuille</strong> : du {periodeFichier.debut} au {periodeFichier.fin}
              {' '}— vérifie qu'elle correspond bien à « {periode} ».
            </div>
          )}

          {erreur && (
            <div style={{ background: '#fdecea', borderLeft: '3px solid ' + C.rouge, padding: '10px 14px',
              borderRadius: 6, marginTop: 14, fontSize: 13, color: C.rouge }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 8 }}></i>{erreur}
            </div>
          )}

          {rapport && rapport.comparable && (
            <div style={{ marginTop: 18 }}>
              {rapport.alertes.map((a, i) => <Alerte key={i} a={a} />)}

              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'left' }}>Poste (périmètre explicite)</th>
                    <th style={th}>Fichier de paie</th>
                    <th style={th}>Smart Berry</th>
                    <th style={th}>Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {rapport.lignes.map((l) => {
                    const nul = l.ecart === null || Math.abs(l.ecart) < (l.unite === 'DH' ? 1 : 0.5);
                    const couleur = l.nature === 'donnees' ? C.ambre : C.rouge;
                    const fmt = (v) => (v === null ? '—'
                      : (l.unite === 'DH' ? dh(v) : (Math.round(v * 10) / 10).toLocaleString('fr-FR')));
                    return (
                      <tr key={l.cle} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                        <td style={tdL}>
                          {l.libelle}
                          {l.note && (
                            <div style={{ fontSize: 11, color: C.gris, marginTop: 2 }}>{l.note}</div>
                          )}
                        </td>
                        <td style={{ ...td, color: C.gris }}>{fmt(l.fichier)}</td>
                        <td style={{ ...td, color: C.gris }}>{fmt(l.smartBerry)}</td>
                        <td style={{ ...td, fontWeight: nul ? 400 : 700,
                          color: nul ? C.gris : couleur, opacity: nul ? 0.5 : 1 }}>
                          {l.ecart === null ? '—' : fmt(l.ecart)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, background: 'var(--gray-50)' }}>
                    <td style={tdL}>{rapport.total.libelle}</td>
                    <td style={td}>{dh(rapport.total.fichier)}</td>
                    <td style={td}>{dh(rapport.total.smartBerry)}</td>
                    <td style={{ ...td, color: Math.abs(rapport.total.ecart) < 500 ? C.vert : C.rouge }}>
                      {dh(rapport.total.ecart)}
                      {rapport.total.ecartPct !== null && (
                        <span style={{ fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
                          ({(Math.round(rapport.total.ecartPct * 1000) / 10).toFixed(1)} %)
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>

              <div style={{ fontSize: 11, color: C.gris, marginTop: 12, lineHeight: 1.5 }}>
                <i className="fa-solid fa-circle-info" style={{ marginRight: 6 }}></i>
                Un écart <strong style={{ color: C.ambre }}>ambre</strong> relève des
                <strong> données</strong> : les deux sources ne sont pas d'accord sur une
                présence, et aucun code ne tranche cela. Un écart
                <strong style={{ color: C.rouge }}> rouge</strong> relève du
                <strong> calcul</strong> Smart Berry, et se corrige.
              </div>
            </div>
          )}

          {rapport && !rapport.comparable && (
            <div style={{ marginTop: 16, fontSize: 13, color: C.gris }}>
              Aucun instantané enregistré pour cette quinzaine — ouvre l'écran Quinzaine
              sur cette période, sans filtre, puis recommence.
            </div>
          )}
        </div>
      </div>
    );
  }

  if (typeof window !== 'undefined') window.RapprochementPaiePopup = RapprochementPaiePopup;

})();
