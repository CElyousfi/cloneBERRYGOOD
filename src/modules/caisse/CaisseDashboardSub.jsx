/* Module: caisse | Déclaration(s): CaisseDashboardSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { STATUS_LABELS } from '../shared/STATUS_LABELS.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { TXN_TYPE_LABELS } from './TXN_TYPE_LABELS.jsx';
import { getCaisseColor } from './getCaisseColor.jsx';

import * as CaisseUtils from '../shared/lib/caisseUtils.js';
import { CaisseDetailPopup } from './CaisseDetailPopup.jsx';
// ---- Dashboard Sub ----
        function CaisseDashboardSub({ dashData, caisses, isControle, onNavigate }) {
            const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0,10));
            const [selectedCaisseId, setSelectedCaisseId] = useState('');
            // Entité affichée sur le dashboard. Mémorisée d'une visite à l'autre.
            const [entite, setEntite] = useState(() => { try { return localStorage.getItem('caisseEntite') || 'BGF'; } catch(e) { return 'BGF'; } });
            const changerEntite = (code) => { setEntite(code); try { localStorage.setItem('caisseEntite', code); } catch(e) {} };
            const [allTx, setAllTx] = useState([]);
            // Caisse dont on affiche le détail (pop-up). null = fermée.
            const [detailCaisse, setDetailCaisse] = useState(null);
            const [txLoaded, setTxLoaded] = useState(false);

            React.useEffect(() => {
                fetch('/api/caisse?action=list-transactions&limit=2000').then(r => r.json())
                    .then(json => { if (json.success) { setAllTx(json.transactions || []); setTxLoaded(true); } })
                    .catch(() => {});
            }, []);

            // Un bon SAISI a déjà bougé l'argent du tiroir, même sans validation
            // DG. Ce bloc affiche donc le SOLDE EN CAISSE, même convention que
            // les cartes ci-dessous — sinon il reste à zéro tant que la DG n'a
            // pas fait sa revue, ce qui ne dit rien au caissier.
            const STATUTS_EN_CAISSE = ['valide', 'soumis', 'a_revoir'];
            const compteEnCaisse = (t) => STATUTS_EN_CAISSE.indexOf(t.status) !== -1;

            const computeBalanceForDate = (caisseId, dateStr) => {
                const caisse = caisses.find(c => c.id === caisseId);
                if (!caisse) return 0;
                let bal = caisse.solde_initial || 0;
                allTx.forEach(t => {
                    if (t.caisse_id !== caisseId) return;
                    if (!compteEnCaisse(t)) return;
                    if (t.date > dateStr) return;
                    const m = t.montant || 0;
                    if (t.type === 'alimentation' || t.type === 'transfer_in') bal += m;
                    else if (['depense','sortie','transfer_out','paie','transport'].includes(t.type)) bal -= m;
                });
                return bal;
            };

            const computeDayMovements = (caisseId, dateStr) => {
                const txOfDay = allTx.filter(t => t.date === dateStr && compteEnCaisse(t) && (caisseId ? t.caisse_id === caisseId : true));
                let entrees = 0, sorties = 0;
                txOfDay.forEach(t => {
                    const m = t.montant || 0;
                    if (t.type === 'alimentation' || t.type === 'transfer_in') entrees += m;
                    else if (['depense','sortie','transfer_out','paie','transport'].includes(t.type)) sorties += m;
                });
                return { entrees, sorties, count: txOfDay.length };
            };

            const shiftDay = (delta) => {
                const d = new Date(selectedDate + 'T12:00');
                d.setDate(d.getDate() + delta);
                setSelectedDate(d.toISOString().slice(0,10));
            };

            // --- Entité affichée (BERRY GOOD FARMS / BAHIA) ---
            // Les deux entités ont leurs propres caisses ; les additionner n'a
            // aucun sens de gestion. On en présente UNE à la fois.
            const ENTITES_CAISSE = [
                { code: 'BGF', label: 'BERRY GOOD FARMS' },
                { code: 'BAHIA', label: 'BAHIA' },
            ];
            const mappingEntites = (dashData && dashData.parametres && dashData.parametres.entites) || {};
            // Rattachement : choix explicite (Paramètres) sinon repli sur le nom,
            // pour que l'écran soit juste avant toute configuration.
            const entiteDe = (c) => {
                const choisi = mappingEntites[c.id];
                if (choisi && ENTITES_CAISSE.some(e => e.code === choisi)) return choisi;
                return `${c.id || ''} ${c.nom || ''}`.toLowerCase().indexOf('bahia') !== -1 ? 'BAHIA' : 'BGF';
            };

            // Les comptes clients du Marché Local vivent dans caisse_definitions
            // (préfixe compte_client_) mais ne sont PAS des caisses : ils n'ont
            // pas de nom et s'affichaient en bulles anonymes à 0,00 DH. Ils ont
            // leur propre onglet « Comptes Clients ».
            const estCompteClient = (c) => (CaisseUtils && CaisseUtils.isCompteClientCaisse
                ? CaisseUtils.isCompteClientCaisse(c)
                : String(c.id || '').indexOf('compte_client_') === 0);
            // Les caisses « Marché Local F1 / F5 » ne sont plus présentées comme
            // des caisses : le suivi se fait PAR CLIENT (bloc dédié plus bas).
            // Elles restent accessibles depuis Transactions et les rapports.
            const estCaisseMarcheLocal = (c) => String(c.id || '').indexOf('caisse_marche_local') === 0;
            // Caisses de gestion de l'entité affichée.
            const caissesReelles = caisses.filter(c => !estCompteClient(c) && !estCaisseMarcheLocal(c) && entiteDe(c) === entite);
            // Comptes clients Marché Local — rattachés à Berry Good, présentés
            // séparément : ce sont des créances clients, pas des caisses.
            const comptesClients = caisses.filter(c => estCompteClient(c) && entiteDe(c) === entite);

            const soldeJour = selectedCaisseId
                ? computeBalanceForDate(selectedCaisseId, selectedDate)
                : caissesReelles.reduce((s, c) => s + computeBalanceForDate(c.id, selectedDate), 0);
            const dayMov = computeDayMovements(selectedCaisseId, selectedDate);

            // Date du dernier mouvement de la sélection. Sans elle, l'écran
            // semble figé quand on navigue au-delà du dernier bon : le cumul
            // est correct mais rien n'explique pourquoi il ne bouge plus.
            const idsSelection = selectedCaisseId ? [selectedCaisseId] : caissesReelles.map(c => c.id);
            const derniereDateMvt = allTx.reduce((max, t) => {
                if (!compteEnCaisse(t) || idsSelection.indexOf(t.caisse_id) === -1) return max;
                return (!max || t.date > max) ? t.date : max;
            }, '');
            const dateApresDernierMvt = !!derniereDateMvt && selectedDate > derniereDateMvt;
            const formatJour = (iso) => {
                const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
                return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
            };

            if (!dashData) return null;

            const totalSolde = caissesReelles.reduce((s, c) => s + (c.solde_actuel || 0), 0);
            // Solde en caisse toutes caisses = validé + bons saisis non validés.
            const totalSoldeCaisse = caissesReelles.reduce((s, c) => s + (c.solde_provisoire !== undefined ? c.solde_provisoire : (c.solde_actuel || 0)), 0);
            const totalEnAttente = Math.round(caissesReelles.reduce((s, c) => s + (Number(c.en_attente_montant) || 0), 0) * 100) / 100;
            const totalEnAttenteCount = caissesReelles.reduce((s, c) => s + (Number(c.en_attente_count) || 0), 0);
            return (
                <div>
                    {/* Sélecteur d'entité — chaque entité a ses propres caisses. */}
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16,flexWrap:'wrap'}}>
                        <span style={{fontSize:11,fontWeight:700,color:'var(--gray-400)',letterSpacing:0.5}}>ENTITÉ</span>
                        {ENTITES_CAISSE.map(e => {
                            const actif = entite === e.code;
                            return (
                                <button key={e.code} onClick={() => changerEntite(e.code)}
                                    style={{padding:'8px 18px',borderRadius:20,fontSize:12.5,fontWeight:actif?700:500,cursor:'pointer',
                                        border: actif ? 'none' : '1px solid var(--gray-200)',
                                        background: actif ? 'var(--berry)' : 'white',
                                        color: actif ? 'white' : 'var(--gray-600)'}}>
                                    {e.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Real-time balance with day navigation */}
                    <div style={{padding:'18px 24px',background:'white',borderRadius:12,marginBottom:20,border:'2px solid var(--berry)',boxShadow:'0 2px 8px rgba(139,34,82,0.08)'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:16}}>
                            <div style={{display:'flex',alignItems:'center',gap:14}}>
                                <button onClick={() => shiftDay(-1)} style={{width:36,height:36,borderRadius:'50%',border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:14,color:'var(--berry)'}}>
                                    <i className="fa-solid fa-chevron-left"></i>
                                </button>
                                <div style={{textAlign:'center',minWidth:140}}>
                                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,color:'var(--gray-600)'}}>Solde au</div>
                                    <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                                        style={{padding:'4px 8px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:13,fontWeight:600,textAlign:'center'}} />
                                </div>
                                <button onClick={() => shiftDay(1)} style={{width:36,height:36,borderRadius:'50%',border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:14,color:'var(--berry)'}}>
                                    <i className="fa-solid fa-chevron-right"></i>
                                </button>
                                <button onClick={() => setSelectedDate(new Date().toISOString().slice(0,10))} style={{padding:'6px 12px',borderRadius:6,border:'1px solid var(--gray-200)',background:'#f5f5f5',cursor:'pointer',fontSize:11}}>Aujourd'hui</button>
                            </div>
                            <select value={selectedCaisseId} onChange={e => setSelectedCaisseId(e.target.value)}
                                style={{padding:'8px 14px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,fontWeight:600}}>
                                <option value="">Toutes caisses</option>
                                {/* Restreint à l'entité affichée : proposer une caisse
                                    de l'autre entité n'aurait aucun sens ici. */}
                                {caissesReelles.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                            </select>
                            <div style={{textAlign:'right'}}>
                                <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,color:'var(--gray-600)'}} title="Inclut les bons saisis non encore validés">Solde en caisse en fin de journée</div>
                                <div style={{fontSize:24,fontWeight:700,color: soldeJour >= 0 ? 'var(--berry)' : 'var(--red)'}}>{txLoaded ? formatMAD(soldeJour) : '...'}</div>
                                <div style={{fontSize:11,color:'var(--gray-600)',marginTop:2}}>
                                    <span style={{color:'var(--green)'}}>+{formatMAD(dayMov.entrees)}</span>
                                    <span style={{margin:'0 6px',color:'var(--gray-400)'}}>•</span>
                                    <span style={{color:'var(--red)'}}>-{formatMAD(dayMov.sorties)}</span>
                                    <span style={{margin:'0 6px',color:'var(--gray-400)'}}>•</span>
                                    <span>{dayMov.count} mvt(s)</span>
                                </div>
                                {/* Explique un solde qui « ne bouge pas » : au-delà du
                                    dernier bon, le cumul est forcément constant. */}
                                {txLoaded && dateApresDernierMvt && (
                                    <div style={{fontSize:11,color:'var(--orange)',marginTop:4}}>
                                        <i className="fa-solid fa-circle-info" style={{marginRight:4}}></i>
                                        Aucun mouvement depuis le {formatJour(derniereDateMvt)} — le solde est inchangé depuis
                                        <button onClick={() => setSelectedDate(derniereDateMvt)}
                                            style={{marginLeft:6,padding:'2px 8px',borderRadius:6,border:'1px solid var(--orange)',background:'white',color:'var(--orange)',cursor:'pointer',fontSize:10.5,fontWeight:600}}>
                                            Aller au dernier mouvement
                                        </button>
                                    </div>
                                )}
                                {txLoaded && !derniereDateMvt && (
                                    <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>
                                        Aucun mouvement enregistré sur cette sélection.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    {/* Total banner */}
                    <div style={{padding:'18px 24px',background:'linear-gradient(135deg, var(--berry) 0%, var(--berry-light) 100%)',borderRadius:12,marginBottom:20,color:'white'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
                            <div>
                                <div style={{fontSize:11,textTransform:'uppercase',letterSpacing:1,opacity:0.7,marginBottom:4}}>Solde en caisse — toutes caisses</div>
                                <div style={{fontSize:26,fontWeight:700}}>{formatMAD(totalSoldeCaisse)}</div>
                                <div style={{fontSize:11,opacity:0.85,marginTop:4}}>
                                    Solde validé : <strong>{formatMAD(totalSolde)}</strong>
                                    {totalEnAttenteCount > 0 && (
                                        <span> · {totalEnAttenteCount} bon(s) en attente&nbsp;: {totalEnAttente >= 0 ? '+' : '−'}{formatMAD(Math.abs(totalEnAttente))}</span>
                                    )}
                                </div>
                            </div>
                            <div style={{display:'flex',gap:24,textAlign:'center'}}>
                                <div>
                                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,opacity:0.6}}>Alimentations (semaine)</div>
                                    <div style={{fontSize:18,fontWeight:700,color:'#81ecec'}}>{formatMAD(dashData.weekAlimentations)}</div>
                                </div>
                                <div>
                                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,opacity:0.6}}>Dépenses (semaine)</div>
                                    <div style={{fontSize:18,fontWeight:700,color:'#fab1a0'}}>{formatMAD(dashData.weekDepenses)}</div>
                                </div>
                                <div>
                                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,opacity:0.6}}>En attente</div>
                                    <div style={{fontSize:18,fontWeight:700,color:'#ffeaa7'}}>{dashData.pendingCount}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* KPI cards per caisse */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:12,marginBottom:20}}>
                        {caissesReelles.map(c => {
                            const cc = getCaisseColor(c.id);
                            return (
                                <div key={c.id} onClick={() => setDetailCaisse(c)}
                                    title={'Voir le détail de ' + (c.nom || c.id)}
                                    style={{padding:16,background:'white',borderRadius:12,border:'1px solid var(--gray-200)',position:'relative',overflow:'hidden',cursor:'pointer',transition:'box-shadow 0.15s, transform 0.15s'}}
                                    onMouseEnter={e=>{e.currentTarget.style.boxShadow='0 4px 14px rgba(0,0,0,0.08)';e.currentTarget.style.transform='translateY(-1px)';}}
                                    onMouseLeave={e=>{e.currentTarget.style.boxShadow='none';e.currentTarget.style.transform='none';}}>
                                    <div style={{position:'absolute',top:0,left:0,width:4,height:'100%',background:cc.color}}></div>
                                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10,paddingLeft:8}}>
                                        <div style={{width:36,height:36,borderRadius:10,background:cc.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                            <i className={`fa-solid ${cc.icon}`} style={{color:cc.color,fontSize:15}}></i>
                                        </div>
                                        <div style={{fontSize:12,fontWeight:600,color:'var(--gray-800)'}}>{c.nom}</div>
                                    </div>
                                    {/* Deux soldes distincts et jamais confondus :
                                        — Solde en caisse : ce que le caissier doit trouver dans
                                          son tiroir (inclut les bons saisis non encore validés) ;
                                        — Solde validé : le solde comptable, seul utilisé par le
                                          rapprochement mensuel.
                                        Le solde en caisse est mis en avant car c'est celui qui
                                        sert au quotidien ; le validé reste visible en dessous. */}
                                    {(() => {
                                        const enAttente = Number(c.en_attente_montant) || 0;
                                        const aDesEnAttente = (Number(c.en_attente_count) || 0) > 0;
                                        const soldeCaisse = c.solde_provisoire !== undefined ? c.solde_provisoire : c.solde_actuel;
                                        return (
                                            <div style={{paddingLeft:8}}>
                                                <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:0.6,color:'var(--gray-400)'}}>
                                                    Solde en caisse
                                                </div>
                                                <div style={{fontSize:20,fontWeight:700,color:cc.color}}>{formatMAD(soldeCaisse)}</div>
                                                {aDesEnAttente ? (
                                                    <div style={{marginTop:6,paddingTop:6,borderTop:'1px dashed var(--gray-200)',fontSize:11,color:'var(--gray-600)',lineHeight:1.5}}>
                                                        <div>Solde validé : <strong>{formatMAD(c.solde_actuel)}</strong></div>
                                                        <div style={{color:'#E67E22'}}>
                                                            <i className="fa-solid fa-clock" style={{marginRight:4}}></i>
                                                            {c.en_attente_count} bon(s) en attente&nbsp;: {enAttente >= 0 ? '+' : '−'}{formatMAD(Math.abs(enAttente))}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{marginTop:6,fontSize:11,color:'var(--gray-400)'}}>
                                                        <i className="fa-solid fa-check" style={{marginRight:4}}></i>Tout est validé
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        })}
                    </div>

                    {/* Détail d'une caisse — alimentations / décaissements.
                        Aucun appel réseau : allTx est déjà chargé. */}
                    {detailCaisse && CaisseDetailPopup && (
                        <CaisseDetailPopup
                            caisse={detailCaisse}
                            transactions={allTx}
                            onClose={() => setDetailCaisse(null)}
                        />
                    )}

                    {/* Marché Local — détail par client. Uniquement là où des
                        comptes clients existent (Berry Good aujourd'hui). Ce sont
                        des créances : montant restant dû, pas un fonds de caisse. */}
                    {(comptesClients.length > 0 || entite === 'BGF') && (
                        <div style={{padding:16,background:'white',borderRadius:12,border:'1px solid var(--gray-200)',marginBottom:20}}>
                            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                                <i className="fa-solid fa-store" style={{color:'var(--berry)'}}></i>
                                <span style={{fontWeight:600,fontSize:14,color:'var(--gray-800)'}}>Marché Local — par client</span>
                                <span style={{fontSize:11,color:'var(--gray-400)'}}>{comptesClients.length} client(s) actif(s)</span>
                                <button onClick={() => onNavigate('caisse_comptes_clients')}
                                    style={{marginLeft:'auto',padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12,color:'var(--gray-600)'}}>
                                    Détail<i className="fa-solid fa-arrow-right" style={{marginLeft:6}}></i>
                                </button>
                            </div>
                            {comptesClients.length === 0 && (
                                <div style={{padding:'14px 16px',borderRadius:10,background:'#FEF3C7',border:'1px solid #FDE68A',fontSize:12,color:'#92400E'}}>
                                    <i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>
                                    Aucun client actif pour la campagne. Activez-les dans <strong>Paramètres → Clients Marché Local</strong> pour démarrer le suivi.
                                </div>
                            )}
                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:10}}>
                                {comptesClients.map(c => {
                                    // Les comptes existants n'ont pas de champ `nom` :
                                    // on dérive un libellé lisible de leur identifiant.
                                    const nom = (c.nom && String(c.nom).trim())
                                        || String(c.id || '').replace('compte_client_', '').split('_').filter(Boolean).join(' ').toUpperCase();
                                    const solde = Number(c.solde_actuel) || 0;
                                    return (
                                        <div key={c.id} style={{padding:'10px 12px',background:'var(--gray-100)',borderRadius:10}}>
                                            <div style={{fontSize:11,fontWeight:600,color:'var(--gray-800)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={nom}>{nom}</div>
                                            <div style={{fontSize:15,fontWeight:700,color: solde > 0 ? 'var(--orange)' : 'var(--green)',marginTop:2}}>{formatMAD(solde)}</div>
                                            <div style={{fontSize:10,color:'var(--gray-400)'}}>{solde > 0 ? 'reste dû' : 'soldé'}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Pending validations panel — DG/Finance only */}
                    {isControle && dashData.pendingCount > 0 && (
                        <div style={{padding:16,background:'rgba(243,156,18,0.06)',borderRadius:12,border:'1px solid rgba(243,156,18,0.2)',marginBottom:20}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                    <i className="fa-solid fa-clock" style={{color:'#E67E22'}}></i>
                                    <span style={{fontWeight:600,fontSize:14,color:'var(--gray-800)'}}>{dashData.pendingCount} transaction(s) en attente de validation</span>
                                </div>
                                {/* Ce bouton NE valide rien : il ouvre la revue. Le libellé
                                    « Valider » + l'icône double-coche le faisaient passer pour
                                    une validation en masse, qui n'existe pas. */}
                                <button onClick={() => onNavigate('caisse_validation')} style={{padding:'6px 14px',borderRadius:8,background:'#E67E22',color:'white',border:'none',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                    <i className="fa-solid fa-arrow-right" style={{marginRight:4}}></i>Ouvrir la revue
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Recent transactions */}
                    <div style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',overflow:'hidden'}}>
                        <div style={{padding:'14px 20px',borderBottom:'1px solid var(--gray-200)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                            <span style={{fontWeight:600,fontSize:14}}>
                                <i className="fa-solid fa-clock-rotate-left" style={{marginRight:8,color:'var(--berry)'}}></i>Dernières Transactions
                            </span>
                            <button onClick={() => onNavigate('caisse_transactions')} style={{fontSize:11,color:'var(--berry)',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>
                                Voir tout <i className="fa-solid fa-arrow-right" style={{marginLeft:4}}></i>
                            </button>
                        </div>
                        {(!dashData.recentTx || dashData.recentTx.length === 0) ? (
                            <div style={{padding:40,textAlign:'center',color:'var(--gray-400)',fontSize:13}}>Aucune transaction enregistrée</div>
                        ) : (
                            <div style={{overflowX:'auto'}}>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                    <thead><tr style={{background:'var(--gray-100)'}}>
                                        <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Date</th>
                                        <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Caisse</th>
                                        <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Type</th>
                                        <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Description</th>
                                        <th style={{padding:'10px 14px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Montant</th>
                                        <th style={{padding:'10px 14px',textAlign:'center',fontWeight:600,color:'var(--gray-600)'}}>Statut</th>
                                    </tr></thead>
                                    <tbody>
                                        {dashData.recentTx.map((tx, i) => {
                                            const tt = TXN_TYPE_LABELS[tx.type] || {};
                                            const ss = STATUS_LABELS[tx.status] || {};
                                            const caisseName = caisses.find(c => c.id === tx.caisse_id)?.nom || tx.caisse_id;
                                            return (
                                                <tr key={tx.id || i} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                    <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}>{tx.date}</td>
                                                    <td style={{padding:'10px 14px',fontSize:11}}>{caisseName}</td>
                                                    <td style={{padding:'10px 14px'}}>
                                                        <span style={{padding:'3px 10px',borderRadius:12,background:tt.bg||'#eee',color:tt.color||'#333',fontSize:11,fontWeight:600,whiteSpace:'nowrap'}}>
                                                            <i className={`fa-solid ${tt.icon||'fa-circle'}`} style={{marginRight:4}}></i>{tt.label||tx.type}
                                                        </span>
                                                    </td>
                                                    <td style={{padding:'10px 14px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tx.description || tx.reference}</td>
                                                    <td style={{padding:'10px 14px',textAlign:'right',fontWeight:600,color: ['depense','sortie','transfer_out'].includes(tx.type)?'var(--red)':'var(--green)'}}>
                                                        {['depense','sortie','transfer_out'].includes(tx.type)?'-':'+'}{formatMAD(tx.montant)}
                                                    </td>
                                                    <td style={{padding:'10px 14px',textAlign:'center'}}>
                                                        <span style={{padding:'3px 10px',borderRadius:12,background:ss.bg||'#eee',color:ss.color||'#333',fontSize:11,fontWeight:600}}>{ss.label||tx.status}</span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

export { CaisseDashboardSub };
