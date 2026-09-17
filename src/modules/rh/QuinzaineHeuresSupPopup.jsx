/* Popup de saisie des heures supplémentaires ACCORDÉES. Le montant y est une décision de la paie, pas une conversion des minutes badgées.
 *
 * Extrait de QuinzaineTab (3 554 lignes à l'origine). Bloc de rendu pur — aucun
 * hook, aucun effet : toutes ses entrées arrivent en props.
 */
import * as PrimesV2 from '../shared/lib/primesV2.js';

function QuinzaineHeuresSupPopup({ _chargesSociales, _hsTotal, _moRows, _nomOuvrierQz, currentPeriode, firebaseAuth, hsAjoutOuvert, hsAjoutQuery, hsAjoutsCourants, hsDraftCourant, hsEmargementsCourants, hsMinutes, hsMontantsCourants, hsSaving, numKey, setHsAjoutOuvert, setHsAjoutQuery, setHsAjouts, setHsDraft, setHsMontants, setHsSaving, setQuinzPopupKey }) {
    // SAISIE des heures sup accordées. Le montant est une
    // DÉCISION (la paie inscrit des sommes rondes), pas une
    // conversion des minutes badgées — celles-ci s'affichent
    // à côté pour justifier, jamais pour calculer.
    //
    // Le vivier est `_chargesSociales.detail`, c'est-à-dire les
    // ouvriers AYANT POINTÉ la quinzaine — et eux seuls, y compris
    // pour l'ajout manuel (cf. le commentaire de `hsAjouts`).
    const _hsAjoutees = new Set(hsAjoutsCourants);
    const _hsPointes = (_chargesSociales ? _chargesSociales.detail : [])
        .map(w => ({
            matricule: w.matricule,
            cle: numKey(w.matricule),
            jours: w.jours,
            montant: Number(hsMontantsCourants[numKey(w.matricule)] || 0),
            minutes: Number(hsMinutes[numKey(w.matricule)] || 0),
        }))
        .map(w => ({ ...w, ajoute: _hsAjoutees.has(w.cle) }));
    // Une ligne s'affiche si elle a un montant, un dépassement
    // badgé, OU si la paie vient de l'ajouter à la main. L'ajout
    // ne survit PAS à la fermeture : sans montant enregistré, la
    // ligne n'a rien à retenir — c'est le comportement voulu.
    const _hsVisible = (w) => w.montant > 0 || w.minutes > 0 || w.ajoute;
    const _hsList = _hsPointes
        .filter(_hsVisible)
        .sort((a, b) => b.montant - a.montant || b.minutes - a.minutes);
    // Ouvriers pointés que la liste ne montre pas encore : les
    // seuls ajoutables.
    const _hsCandidats = _hsPointes.filter(w => !_hsVisible(w));
    const _hsCandidatsRows = _hsCandidats.map(w => ({
        matricule: String(w.matricule),
        cle: w.cle, jours: w.jours,
        nom: _nomOuvrierQz(w.matricule),
    }));
    // Recherche déléguée au module pur (insensible casse/accents,
    // matricule OU nom). Script non chargé → repli local, jamais
    // de plantage : la RH garde un champ qui filtre.
    const _hsRechercher = (q) => {
        const PV = PrimesV2;
        if (PV && typeof PV.searchWorkers === 'function') {
            const trouves = PV.searchWorkers(_hsCandidatsRows, q, 40);
            const parMat = {};
            _hsCandidatsRows.forEach(r => { parMat[r.matricule] = r; });
            return trouves.map(t => parMat[t.matricule]).filter(Boolean);
        }
        const s = String(q || '').toLowerCase().trim();
        return _hsCandidatsRows
            .filter(r => (r.nom + ' ' + r.matricule).toLowerCase().includes(s))
            .slice(0, 40);
    };
    // Liste OUVERTE AU FOCUS, même sans frappe : la RH cherche
    // souvent un nom qu'elle reconnaît plutôt qu'elle ne tape.
    const _hsOptions = !hsAjoutOuvert ? []
        : (String(hsAjoutQuery || '').trim()
            ? _hsRechercher(hsAjoutQuery)
            : _hsCandidatsRows.slice(0, 40));
    const _hsAjouter = (r) => {
        setHsAjouts(prev => {
            const base = prev.periode === currentPeriode ? (prev.cles || []) : [];
            if (base.indexOf(r.cle) !== -1) return { periode: currentPeriode, cles: base };
            return { periode: currentPeriode, cles: base.concat([r.cle]) };
        });
        setHsAjoutQuery('');
        setHsAjoutOuvert(false);
    };
    const _hsDuree = (min) => min <= 0 ? '—'
        : (Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0'));
    // Enregistre UNE ligne. Ne montre rien à l'utilisateur :
    // l'appelant (le bouton) rend compte de l'ENSEMBLE, un
    // échec ligne par ligne se raconte en une seule fois.
    const _hsSave = async (cle, valeur) => {
        const per = currentPeriode;
        if (!per) return { ok: false, erreur: 'quinzaine inconnue' };
        try {
            const tok = (firebaseAuth && firebaseAuth.currentUser)
                ? await firebaseAuth.currentUser.getIdToken() : null;
            const r = await fetch('/api/primes?action=save-heures-sup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                    ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
                body: JSON.stringify({ periode: per, matricule: cle, montant: valeur }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.error || ('Erreur ' + r.status));
            // Mise à jour SOUS l'estampille : on ne remplace
            // pas la map par une map nue, sinon le montant
            // qu'on vient d'accorder redeviendrait orphelin
            // de sa quinzaine. Et si la quinzaine affichée a
            // changé entre-temps, on ne touche à rien — la
            // valeur est déjà en base, le prochain chargement
            // la rapportera.
            setHsMontants(prev => (prev && prev.periode === per
                ? { ...prev, periode: per, pret: prev.pret,
                    montants: { ...(prev.montants || {}), [cle]: valeur } }
                : prev));
            return { ok: true };
        } catch (e) {
            return { ok: false, erreur: e.message };
        }
    };
    // Valeur AFFICHÉE d'une ligne : le brouillon s'il existe,
    // sinon la valeur en base. Champ CONTRÔLÉ — c'est ce qui
    // garantit qu'un ouvrier présent dans deux quinzaines
    // n'hérite pas du montant de la précédente via le nœud
    // DOM que React réutilise.
    const _hsAffiche = (w) => {
        const d = hsDraftCourant[w.cle];
        return d === undefined ? (w.montant || '') : d;
    };
    const _hsSetDraft = (cle, brut) => {
        setHsDraft(prev => ({
            periode: currentPeriode,
            valeurs: { ...(prev.periode === currentPeriode ? prev.valeurs : {}), [cle]: brut },
        }));
    };
    // Lignes RÉELLEMENT modifiées : un brouillon égal à la
    // valeur en base n'est pas une modification (retaper le
    // même chiffre ne doit pas déclencher d'écriture).
    const _hsModifs = _hsList
        .map(w => ({ w: w, valeur: Number(hsDraftCourant[w.cle]) || 0 }))
        .filter(x => hsDraftCourant[x.w.cle] !== undefined && x.valeur !== x.w.montant);
    const _hsEnCours = hsSaving === '__all__';
    const _hsEnregistrer = async () => {
        if (!_hsModifs.length || _hsEnCours) return;
        setHsSaving('__all__');
        const ok = [];
        const ko = [];
        try {
            for (const x of _hsModifs) {
                const r = await _hsSave(x.w.cle, x.valeur);
                if (r.ok) ok.push(x.w); else ko.push({ w: x.w, erreur: r.erreur });
            }
        } finally { setHsSaving(''); }
        // On ne vide QUE ce qui est réellement parti en base.
        // Vider le brouillon entier après un échec partiel
        // ferait passer pour enregistré un montant qui ne
        // l'est pas — la saisie doit rester à l'écran.
        setHsDraft(prev => {
            if (prev.periode !== currentPeriode) return prev;
            const reste = { ...prev.valeurs };
            ok.forEach(w => { delete reste[w.cle]; });
            return { periode: currentPeriode, valeurs: reste };
        });
        if (ko.length) {
            alert(
                'Enregistrement PARTIEL.\n\n'
                + 'Enregistré(s) : ' + (ok.length ? ok.map(w => _nomOuvrierQz(w.matricule)).join(', ') : 'aucun')
                + '\n\nÉCHEC (montant NON enregistré, saisie conservée à l\'écran) :\n'
                + ko.map(x => '• ' + _nomOuvrierQz(x.w.matricule) + ' — ' + x.erreur).join('\n')
            );
        }
    };
    // Fermeture : un brouillon non vide se perdrait en silence.
    const _hsFermer = () => {
        if (_hsModifs.length && !confirm(
            _hsModifs.length + ' modification(s) non enregistrée(s) seront perdues. Fermer quand même ?'
        )) return;
        setHsDraft({ periode: currentPeriode, valeurs: {} });
        // Les lignes ajoutées à la main ne survivent pas à la
        // fermeture : ce qui a été enregistré revient par son
        // montant, le reste n'était qu'une intention.
        setHsAjouts({ periode: currentPeriode, cles: [] });
        setHsAjoutQuery('');
        setHsAjoutOuvert(false);
        setQuinzPopupKey(null);
    };
    // FERMES de la quinzaine — dérivées des lignes de
    // pointage réellement affichées, jamais d'une constante
    // en dur : le périmètre dépend du filtre ferme/culture,
    // et une liste figée réclamerait un état signé à une
    // ferme qui n'a pas travaillé (ou en oublierait une).
    const _hsFermes = (() => {
        const vues = [];
        _moRows.forEach(r => {
            const f = String((r && r.ferme) || '').trim();
            if (f && vues.indexOf(f) === -1) vues.push(f);
        });
        return vues.sort();
    })();
    // Enregistrement du dépôt DANS l'état existant : la map
    // des montants du même document ne doit pas être perdue
    // au passage, et un dépôt sur une autre quinzaine que
    // celle affichée ne touche à rien (la prochaine lecture
    // le rapportera).
    const _hsEmargementDepose = (fermeKey, entry) => {
        // Sans entrée renvoyée par le serveur, on n'invente
        // rien : la ligne resterait « manquante » jusqu'au
        // prochain chargement plutôt que d'afficher un
        // dépôt qu'on ne sait pas décrire.
        if (!fermeKey || !entry || !entry.path) return;
        setHsMontants(prev => (prev && prev.periode === currentPeriode
            ? { ...prev, emargements: { ...(prev.emargements || {}), [fermeKey]: entry } }
            : prev));
    };
    // Référence RÉSOLUE PAR NOM + garde : une référence nue à
    // un global absent (script non chargé) ferait planter tout
    // l'écran, pas seulement ce pied de pop-up.
    const _HsEmargementFooter = window.HsEmargementFooter;
    const _th = {padding:'8px 10px',textAlign:'right',fontSize:11,color:'var(--gray-500)',fontWeight:600,borderBottom:'1px solid var(--gray-200)'};
    const _thL = {..._th, textAlign:'left'};
    const _td = {padding:'6px 10px',textAlign:'right',fontSize:12};
    return (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
            onClick={_hsFermer}>
            <div style={{background:'#fff',borderRadius:16,maxWidth:900,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
                onClick={e => e.stopPropagation()}>
                <div style={{padding:'20px 24px',background:'linear-gradient(135deg, #e67e22 0%, #f0932b 100%)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:1}}>
                    <div>
                        <div style={{fontSize:18,fontWeight:700}}><i className="fa-solid fa-clock" style={{marginRight:8}}></i>Heures Supplémentaires — {currentPeriode}</div>
                        <div style={{fontSize:12,opacity:0.85,marginTop:4}}>{Math.round(_hsTotal).toLocaleString('fr-FR')} DH accordés — montant NET, soumis à cotisation</div>
                    </div>
                    <button onClick={_hsFermer} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div style={{padding:'16px 24px'}}>
                    {/* AJOUT D'UN OUVRIER. La badgeuse ne voit pas tous les
                        dépassements ; sans ce champ, un ouvrier qui a fait
                        des heures n'est tout simplement pas créditable.
                        Sélection FERMÉE (pas d'`<input list>`) : on ne peut
                        désigner qu'un ouvrier ayant pointé la quinzaine. */}
                    <div style={{marginBottom:14,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                        <span style={{fontSize:12,color:'var(--gray-500)',fontWeight:600}}>
                            <i className="fa-solid fa-user-plus" style={{marginRight:6}}></i>Ajouter un ouvrier
                        </span>
                        <div style={{position:'relative',flex:'1 1 260px',minWidth:220,maxWidth:360}}>
                            <input
                                value={hsAjoutQuery}
                                onChange={e => { setHsAjoutQuery(e.target.value); setHsAjoutOuvert(true); }}
                                onFocus={() => setHsAjoutOuvert(true)}
                                // Fermeture DIFFÉRÉE : le blur de l'input part
                                // avant le clic sur l'option.
                                onBlur={() => window.setTimeout(() => setHsAjoutOuvert(false), 150)}
                                disabled={_hsEnCours || _hsCandidatsRows.length === 0}
                                placeholder={_hsCandidatsRows.length === 0
                                    ? 'Tous les ouvriers pointés sont déjà listés'
                                    : 'Nom ou matricule…'}
                                autoComplete="off"
                                style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12}} />
                            {hsAjoutOuvert && (
                                <div style={{position:'absolute',zIndex:30,left:0,right:0,top:'100%',marginTop:2,maxHeight:220,
                                    overflowY:'auto',background:'#fff',border:'1px solid var(--gray-200)',borderRadius:6,
                                    boxShadow:'0 4px 14px rgba(0,0,0,.14)'}}>
                                    {_hsOptions.length === 0 ? (
                                        <div style={{padding:'6px 10px',fontSize:11,color:'var(--gray-400)'}}>
                                            Aucun ouvrier pointé sur cette quinzaine ne correspond.
                                        </div>
                                    ) : _hsOptions.map(r => (
                                        // onMouseDown + preventDefault, PAS onClick :
                                        // le blur refermerait la liste avant le choix.
                                        <div key={r.cle}
                                            onMouseDown={ev => { ev.preventDefault(); _hsAjouter(r); }}
                                            style={{padding:'6px 10px',fontSize:12,cursor:'pointer',borderBottom:'1px solid #f4f4f4'}}>
                                            {r.nom}
                                            <span style={{color:'var(--gray-400)',fontSize:10,marginLeft:6}}>{r.matricule} — {r.jours} j</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <span style={{fontSize:10.5,color:'var(--gray-400)'}}>
                            Uniquement les ouvriers ayant pointé la quinzaine.
                        </span>
                    </div>
                    {_hsList.length === 0 ? (
                        <div style={{color:'var(--gray-400)',fontSize:13,fontStyle:'italic',textAlign:'center',padding:'24px 0'}}>
                            Aucun dépassement badgé et aucun montant saisi sur cette quinzaine.
                        </div>
                    ) : (
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                        <thead><tr>
                            <th style={_thL}>Ouvrier</th>
                            <th style={_th}>Jours</th>
                            <th style={_th} title="Dépassement mesuré par la badgeuse. Justificatif, jamais le montant.">Badgé</th>
                            <th style={_th}>Montant accordé (DH net)</th>
                        </tr></thead>
                        <tbody>
                            {_hsList.map((w, i) => {
                                // Champ CONTRÔLÉ : la valeur vient de l'état, pas
                                // du nœud DOM. Un ouvrier présent dans deux
                                // quinzaines ne peut donc plus se voir réafficher
                                // — ni réenregistrer — le montant de la
                                // précédente, quel que soit le nœud que React
                                // réutilise. La clé sur le seul matricule suffit.
                                const _sale = hsDraftCourant[w.cle] !== undefined
                                    && (Number(hsDraftCourant[w.cle]) || 0) !== w.montant;
                                return (
                                <tr key={w.matricule} style={{background: _sale ? '#fff7e6' : (i % 2 ? '#fdf6ef' : '#fff'), borderBottom:'1px solid var(--gray-100)'}}>
                                    <td style={{..._td, textAlign:'left', fontWeight:500}}>{_nomOuvrierQz(w.matricule)}<span style={{color:'var(--gray-400)',fontSize:10,marginLeft:6}}>{w.matricule}</span>
                                        {w.ajoute && w.montant === 0 && w.minutes === 0 && (
                                            <span title="Ajouté manuellement : aucun dépassement badgé, aucun montant enregistré."
                                                style={{marginLeft:6,fontSize:9.5,fontWeight:600,color:'#e67e22',background:'#fdf0e3',borderRadius:4,padding:'1px 5px'}}>
                                                <i className="fa-solid fa-user-plus" style={{marginRight:3}}></i>ajouté
                                            </span>
                                        )}
                                    </td>
                                    <td style={_td}>{w.jours}</td>
                                    <td style={{..._td, color:'var(--gray-500)'}}>{_hsDuree(w.minutes)}</td>
                                    <td style={_td}>
                                        <input type="number" min="0" step="10"
                                            value={_hsAffiche(w)}
                                            disabled={_hsEnCours}
                                            onChange={e => _hsSetDraft(w.cle, e.target.value)}
                                            style={{width:110,padding:'4px 8px',textAlign:'right',border:'1px solid ' + (_sale ? '#e67e22' : 'var(--gray-200)'),borderRadius:6,fontSize:12}} />
                                        {_sale && <i className="fa-solid fa-pen" title="Modification non enregistrée" style={{marginLeft:6,fontSize:9,color:'#e67e22'}}></i>}
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                        <tfoot><tr style={{background:'#fdf0e3',fontWeight:700}}>
                            <td style={{..._td, textAlign:'left'}}>TOTAL</td>
                            <td style={_td}></td>
                            <td style={_td}>{_hsDuree(_hsList.reduce((s, w) => s + w.minutes, 0))}</td>
                            <td style={_td}>{Math.round(_hsTotal).toLocaleString('fr-FR')} DH</td>
                        </tr></tfoot>
                    </table>
                    )}
                    {_hsList.length > 0 && (
                        // ENREGISTREMENT EXPLICITE. La saisie ne partait qu'au
                        // `onBlur` : fermer la popup sans quitter le champ
                        // perdait le montant en silence. Le bouton est le seul
                        // chemin d'écriture, et il dit combien de lignes il
                        // porte.
                        <div style={{marginTop:14,display:'flex',alignItems:'center',justifyContent:'flex-end',gap:12,flexWrap:'wrap'}}>
                            {_hsModifs.length > 0 && (
                                <span style={{fontSize:12,color:'#e67e22',fontWeight:600}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                                    {_hsModifs.length} modification{_hsModifs.length > 1 ? 's' : ''} non enregistrée{_hsModifs.length > 1 ? 's' : ''}
                                </span>
                            )}
                            <button onClick={_hsEnregistrer}
                                disabled={_hsModifs.length === 0 || _hsEnCours}
                                style={{padding:'8px 18px',borderRadius:8,border:'none',fontSize:13,fontWeight:600,
                                    color:'#fff',background:(_hsModifs.length === 0 || _hsEnCours) ? 'var(--gray-300)' : '#e67e22',
                                    cursor:(_hsModifs.length === 0 || _hsEnCours) ? 'default' : 'pointer'}}>
                                {_hsEnCours
                                    ? <span><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Enregistrement…</span>
                                    : <span><i className="fa-solid fa-floppy-disk" style={{marginRight:6}}></i>Enregistrer{_hsModifs.length > 0 ? ' (' + _hsModifs.length + ')' : ''}</span>}
                            </button>
                        </div>
                    )}
                    {_HsEmargementFooter && (
                        <_HsEmargementFooter
                            periode={currentPeriode}
                            fermes={_hsFermes}
                            emargements={hsEmargementsCourants}
                            disabled={_hsEnCours}
                            onDepose={_hsEmargementDepose} />
                    )}
                    <div style={{marginTop:12,fontSize:10.5,color:'var(--gray-500)'}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>
                        Le montant est SAISI, comme sur le bulletin : la badgeuse mesure un dépassement,
                        elle ne décide pas d\'une rémunération. Il est net — les cotisations sont
                        recalculées dessus et apparaissent dans la tuile Charges Sociales.
                    </div>
                </div>
            </div>
        </div>
    );
}

export { QuinzaineHeuresSupPopup };
