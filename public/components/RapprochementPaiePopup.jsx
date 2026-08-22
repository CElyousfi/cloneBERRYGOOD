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
    const [survol, setSurvol] = useState(false);
    // Tous les instantanés enregistrés, pour APPARIER le fichier à sa quinzaine
    // par ses DATES. Sans cela, l'outil comparait toujours à la quinzaine
    // AFFICHÉE : déposer le fichier de juillet en regardant août produisait un
    // écart énorme, et seul un humain attentif pouvait s'en apercevoir.
    const [tousSnaps, setTousSnaps] = useState(null);
    const [apparie, setApparie] = useState(null);

    React.useEffect(() => {
      let annule = false;
      fetch('/api/pointage-rh?action=cout-quinzaine')
        .then((r) => r.json())
        .then((d) => { if (!annule && d && d.success) setTousSnaps(d.parPeriode || {}); })
        .catch(() => { /* on retombe sur la quinzaine affichée */ });
      return () => { annule = true; };
    }, []);

    /**
     * Trouve l'instantané dont les DATES couvrent celles du fichier.
     * Rend `null` plutôt que la quinzaine affichée : comparer au mauvais
     * instantané est pire que ne pas comparer — le rapport paraîtrait valide.
     */
    function apparier(periodeFic) {
      if (!periodeFic || !tousSnaps) return null;
      const cles = Object.keys(tousSnaps);
      for (const k of cles) {
        const s = tousSnaps[k];
        if (s && s.dateDebut === periodeFic.debut && s.dateFin === periodeFic.fin) return s;
      }
      return null;
    }

    // GARDE-FOU NAVIGATEUR. Sans elle, un fichier lâché À CÔTÉ de la zone fait
    // NAVIGUER l'onglet vers ce fichier : l'application disparaît et tout le
    // travail en cours est perdu. Le comportement par défaut d'un navigateur
    // sur un drop est d'ouvrir le fichier — il faut l'annuler sur toute la
    // fenêtre tant que le popup est ouvert, pas seulement sur la zone.
    React.useEffect(() => {
      const stop = (e) => { e.preventDefault(); };
      window.addEventListener('dragover', stop);
      window.addEventListener('drop', stop);
      return () => {
        window.removeEventListener('dragover', stop);
        window.removeEventListener('drop', stop);
      };
    }, []);

    function traiter(f) {
      if (!f) return;
      if (!/\.xlsx$/i.test(f.name)) {
        setErreur('« ' + f.name + ' » n\'est pas un .xlsx. Dépose le fichier de '
          + 'quinzaine, pas un .xls ni un PDF.');
        return;
      }
      setErreur(null); setRapport(null);
      setNomFichier(f.name);
      const lecteur = new FileReader();
      lecteur.onload = (ev) => {
        try {
          const lu = lireClasseur(new Uint8Array(ev.target.result));
          setPeriodeFichier(lu.periode);
          const R = window.RapprochementPaie;
          if (!R) throw new Error('Module de rapprochement non chargé — recharge la page.');
          // APPARIEMENT AUTOMATIQUE par les dates du fichier. À défaut, on
          // retombe sur la quinzaine affichée — mais on le DIT, plutôt que de
          // laisser croire que la comparaison porte sur la bonne période.
          const trouve = apparier(lu.periode);
          const cible = trouve || quinzaine;
          setApparie(trouve ? { auto: true, snap: trouve } : { auto: false, snap: quinzaine });
          setRapport(R.comparer({ fichier: lu.postes, quinzaine: cible, baremes }));
        } catch (err) {
          setErreur(err.message);
        }
      };
      lecteur.onerror = () => setErreur('Lecture du fichier impossible.');
      lecteur.readAsArrayBuffer(f);
    }

    const deposer = (e) => traiter(e.target.files && e.target.files[0]);

    function lacher(e) {
      e.preventDefault();
      setSurvol(false);
      const dt = e.dataTransfer;
      traiter(dt && dt.files && dt.files[0]);
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

          {/* Zone de dépôt ET bouton. Le CLIC reste le chemin principal : en
              plein écran macOS, glisser un fichier depuis le Finder oblige à
              changer d'espace, et le glisser-déposer y est peu fiable. */}
          <label
            onDragEnter={(e) => { e.preventDefault(); setSurvol(true); }}
            onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
            onDragLeave={() => setSurvol(false)}
            onDrop={lacher}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 6, padding: '22px 18px',
              border: '2px dashed ' + (survol ? C.vert : C.berry), borderRadius: 10,
              cursor: 'pointer', color: survol ? C.vert : C.berry, fontSize: 13,
              fontWeight: 600, background: survol ? '#e9f7f1' : '#fcfbf9',
              transition: 'background .15s, border-color .15s' }}>
            <i className={'fa-solid ' + (survol ? 'fa-file-arrow-down' : 'fa-folder-open')}
              style={{ fontSize: 22 }}></i>
            <span>{nomFichier || 'Cliquer pour choisir le fichier .xlsx de la quinzaine'}</span>
            <span style={{ fontSize: 11, fontWeight: 400, color: C.gris }}>
              …ou glisser le fichier ici
            </span>
            <input type="file" accept=".xlsx" onChange={deposer} style={{ display: 'none' }} />
          </label>
          <div style={{ fontSize: 11, color: C.gris, marginTop: 8 }}>
            <i className="fa-solid fa-lightbulb" style={{ marginRight: 6 }}></i>
            En plein écran, le glisser-déposer depuis le Finder est peu fiable (macOS
            change d'espace en cours de glissement). <strong>Le clic ouvre le
            sélecteur de fichiers</strong> et fonctionne toujours.
          </div>

          {periodeFichier && (
            <div style={{ fontSize: 12, marginTop: 10, padding: '8px 12px', borderRadius: 6,
              background: apparie && apparie.auto ? '#e9f7f1' : '#fff8e6',
              borderLeft: '3px solid ' + (apparie && apparie.auto ? C.vert : C.ambre),
              color: apparie && apparie.auto ? C.vert : C.ambre }}>
              <i className={'fa-solid ' + (apparie && apparie.auto ? 'fa-circle-check' : 'fa-triangle-exclamation')}
                style={{ marginRight: 8 }}></i>
              {apparie && apparie.auto ? (
                <span>
                  Quinzaine reconnue d'après les dates de la feuille :
                  <strong> {periodeFichier.debut} → {periodeFichier.fin}</strong>
                  {' '}(« {apparie.snap.periode} »). La comparaison porte sur celle-là,
                  quelle que soit la quinzaine affichée à l'écran.
                </span>
              ) : (
                <span>
                  Le fichier couvre <strong>{periodeFichier.debut} → {periodeFichier.fin}</strong>,
                  et aucun instantané enregistré ne porte ces dates. La comparaison
                  se fait donc avec la quinzaine <strong>affichée</strong> («&nbsp;{periode}&nbsp;») —
                  vérifie qu'il s'agit bien de la même période. Sinon, ouvre la bonne
                  quinzaine sans filtre pour l'enregistrer, puis recommence.
                </span>
              )}
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
