/* Module: agronomie | Déclaration(s): AgroPhytoTab */
import { displayCulture } from './displayCulture.jsx';

function AgroPhytoTab({ data, getAlias, getFerme, farmFilter }) {
            const agro = data.agroData;
            const [programs, setPrograms] = React.useState({});
            const [articlesInfo, setArticlesInfo] = React.useState({});
            const [apiStatus, setApiStatus] = React.useState('idle');

            const typeColors = { 'Fongicide':'#3498DB', 'Acaricide':'#E67E22', 'Insecticide':'#E74C3C', 'Herbicide':'#27AE60', 'Biostimulant':'#8E44AD', 'Pesticides':'#E74C3C' };
            const autoColors = ['#E91E63','#9C27B0','#673AB7','#3F51B5','#009688','#FF5722','#795548','#607D8B','#CDDC39','#00BCD4','#FF9800','#4CAF50','#2196F3','#F44336','#8BC34A'];

            React.useEffect(() => {
                setApiStatus('loading');
                fetch('/api/phytosanitaire')
                    .then(r => r.json())
                    .then(json => {
                        if (json.success && json.data) {
                            setPrograms(json.data);
                            setArticlesInfo(json.articlesInfo || {});
                            setApiStatus('ok');
                        } else { setApiStatus('error'); }
                    })
                    .catch(() => { setApiStatus('error'); });
            }, []);

            // ---- Cascade Ferme → Culture → Parcelle ----
            const [fermeFilter, setFermeFilter] = React.useState(farmFilter || 'Toutes');
            const [cultureFilter, setCultureFilter] = React.useState('Toutes');
            const [selParc, setSelParc] = React.useState('Toutes');
            const [weekIdx, setWeekIdx] = React.useState(0);

            const allParcNames = Object.keys(programs).sort();
            var getParcFerme = function(p) { return getFerme(p, (programs[p] || {}).ferme); };
            const allFermes = ['Toutes', ...new Set(allParcNames.map(p => getParcFerme(p)).filter(Boolean))].sort();
            const parcByFerme = fermeFilter === 'Toutes' ? allParcNames : allParcNames.filter(p => getParcFerme(p) === fermeFilter);
            const culturesInFerme = ['Toutes', ...new Set(parcByFerme.map(p => displayCulture(programs[p].culture)).filter(Boolean))].sort();
            var parcFilteredAll = cultureFilter === 'Toutes' ? parcByFerme : parcByFerme.filter(p => displayCulture(programs[p].culture) === cultureFilter);

            // Filtrage spécifique par ferme pour Chef de Ferme
            var phytoAllowedParcelles = {
                'F1': ['maravilla green can', 'maravilla logn can', 'maravilla long can', 'maravilla mow down'],
                'F5': ['breeze myrtille', 'cascade myrtille', 'f5 breeze', 'f5 cascade', 'f5 corina', 'yazmin cut back']
            };
            var parcFiltered = parcFilteredAll;
            if (farmFilter && phytoAllowedParcelles[farmFilter]) {
                var allowed = phytoAllowedParcelles[farmFilter];
                // Filtrer depuis TOUTES les parcelles (pas seulement celles de la ferme)
                // car certaines parcelles (Breeze, Cascade) ont une ferme SQL différente (S8)
                var baseList = cultureFilter === 'Toutes' ? allParcNames : allParcNames.filter(function(p) { return displayCulture(programs[p].culture) === cultureFilter; });
                parcFiltered = baseList.filter(function(p) {
                    var name = p.toLowerCase();
                    var alias = (getAlias(p) || '').toLowerCase();
                    return allowed.some(function(a) { return name.indexOf(a) !== -1 || alias.indexOf(a) !== -1; });
                });
            }

            React.useEffect(() => { setCultureFilter('Toutes'); setSelParc('Toutes'); }, [fermeFilter]);
            React.useEffect(() => { setSelParc('Toutes'); }, [cultureFilter]);

            var isAllParc = selParc === 'Toutes';

            // Collecter toutes les semaines à travers les parcelles filtrées
            var allWeekKeysSet = {};
            parcFiltered.forEach(function(p) {
                Object.keys(programs[p].weeks || {}).forEach(function(wk) { allWeekKeysSet[wk] = true; });
            });
            var allWeekKeys = Object.keys(allWeekKeysSet).sort().reverse();
            var safeWeekIdx = Math.min(weekIdx, Math.max(allWeekKeys.length - 1, 0));
            var curWeekKey = allWeekKeys[safeWeekIdx] || '';

            // Date range
            var weekDateRange = '';
            if (curWeekKey) {
                try {
                    var parts = curWeekKey.split('-W');
                    var yr = parseInt(parts[0]); var wk = parseInt(parts[1]);
                    var jan4 = new Date(yr, 0, 4);
                    var dow = jan4.getDay() || 7;
                    var monday = new Date(jan4); monday.setDate(jan4.getDate() - dow + 1 + (wk - 1) * 7);
                    var sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
                    var fmtD = function(d) { return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' }); };
                    weekDateRange = fmtD(monday) + ' — ' + fmtD(sunday);
                } catch(e) {}
            }

            // Semaine label
            var weekLabel = '';
            if (curWeekKey) {
                var wkNum = parseInt(curWeekKey.split('-W')[1]);
                weekLabel = 'Sem. ' + wkNum;
            }

            const days = ['lun','mar','mer','jeu','ven','sam','dim'];
            const dayLabels = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
            var fmtFR = function(v, dec) { return v ? v.toFixed(dec !== undefined ? dec : 1).replace('.', ',') : '—'; };

            // Helper: build table for one parcelle
            var buildParcTable = function(parcKey) {
                var pData = programs[parcKey] || { weeks: {} };
                var wData = (pData.weeks || {})[curWeekKey] || { days: {} };
                var dData = wData.days || {};
                var pSup = 1;
                var mP = (agro.parcelles || []).find(function(pp) { return pp.parcelle === parcKey; });
                if (mP && mP.sup > 0) pSup = mP.sup;

                var uKeys = {};
                Object.values(dData).forEach(function(dp) { Object.keys(dp || {}).forEach(function(k) { if (dp[k] > 0) uKeys[k] = true; }); });
                var prods = Object.keys(uKeys).sort().map(function(name, idx) {
                    return { name: name, key: name, color: autoColors[idx % autoColors.length], type: (articlesInfo[name] || {}).type || 'Pesticides' };
                });

                var gv = function(day, key) { return (dData[day] || {})[key] || 0; };
                var td = function(day) { return prods.reduce(function(s, p) { return s + gv(day, p.key); }, 0); };

                if (prods.length === 0) return (
                    <div key={parcKey} className="panel" style={{padding:0,overflow:'auto',marginBottom:16}}>
                        <div style={{padding:'10px 16px',background:'linear-gradient(135deg,#E74C3C11,#8E44AD11)',borderBottom:'1px solid #eee',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                            <div>
                                <span style={{fontWeight:800,fontSize:14,color:'#333'}}>{getAlias(parcKey)}</span>
                                <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:12}}>Culture</span>
                                <span style={{fontWeight:700,fontSize:12,marginLeft:4,color:'var(--green)'}}>{displayCulture(pData.culture)}</span>
                                <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:12}}>Ferme</span>
                                <span style={{fontWeight:700,fontSize:12,marginLeft:4,color:'var(--berry)'}}>{getParcFerme(parcKey)}</span>
                            </div>
                            <span style={{fontSize:11,color:'#999',fontStyle:'italic'}}>Aucun traitement cette semaine</span>
                        </div>
                    </div>
                );

                return (
                    <div key={parcKey} className="panel" style={{padding:0,overflow:'auto',marginBottom:16}}>
                        <div style={{padding:'10px 16px',background:'linear-gradient(135deg,#E74C3C11,#8E44AD11)',borderBottom:'1px solid #eee',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                            <div>
                                <span style={{fontWeight:800,fontSize:14,color:'#333'}}>{getAlias(parcKey)}</span>
                                <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:12}}>Culture</span>
                                <span style={{fontWeight:700,fontSize:12,marginLeft:4,color:'var(--green)'}}>{displayCulture(pData.culture)}</span>
                                <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:12}}>Ferme</span>
                                <span style={{fontWeight:700,fontSize:12,marginLeft:4,color:'var(--berry)'}}>{getParcFerme(parcKey)}</span>
                                <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:12}}>Sup</span>
                                <span style={{fontWeight:700,fontSize:12,marginLeft:4}}>{pSup} Ha</span>
                            </div>
                        </div>
                        <div style={{overflowX:'auto'}}>
                            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                                <thead>
                                    <tr style={{background:'#f8f9fa'}}>
                                        <th style={{padding:'8px 12px',textAlign:'left',position:'sticky',left:0,background:'#f8f9fa',zIndex:2,minWidth:180}}>Produit</th>
                                        <th style={{padding:'8px 6px',textAlign:'center',fontSize:10,width:60}}>Type</th>
                                        {days.map((d,i) => <th key={d} style={{padding:'8px 6px',textAlign:'center',minWidth:70,fontSize:11}}>{dayLabels[i]}</th>)}
                                        <th style={{padding:'8px 12px',textAlign:'center',fontWeight:800,background:'#f0f0f0',minWidth:80}}>TOTAL</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {prods.map(function(prod, pi) {
                                        var wt = days.reduce(function(s,d) { return s + gv(d, prod.key); }, 0);
                                        return (
                                            <tr key={pi} style={{borderBottom:'1px solid #f0f0f0'}}>
                                                <td style={{padding:'6px 12px',fontWeight:600,position:'sticky',left:0,background:'#fff',zIndex:1}}>
                                                    <span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:typeColors[prod.type]||'#999',marginRight:6}}></span>
                                                    {prod.name}
                                                </td>
                                                <td style={{padding:'4px 4px',textAlign:'center'}}>
                                                    <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:(typeColors[prod.type]||'#999')+'22',color:typeColors[prod.type]||'#999',fontWeight:600}}>{prod.type}</span>
                                                </td>
                                                {days.map(function(d) { var v = gv(d, prod.key); return <td key={d} style={{padding:'6px',textAlign:'center',fontWeight:v>0?600:400,color:v>0?'#333':'#ccc'}}>{v>0?fmtFR(v):'—'}</td>; })}
                                                <td style={{padding:'6px 12px',textAlign:'center',fontWeight:800,background:'#f8f8f8'}}>{fmtFR(wt)}</td>
                                            </tr>
                                        );
                                    })}
                                    <tr style={{background:'linear-gradient(135deg,#E74C3C11,#8E44AD11)',fontWeight:800}}>
                                        <td style={{padding:'8px 12px',position:'sticky',left:0,background:'#fdf2f2',zIndex:1}}>TOTAL (kg)</td>
                                        <td></td>
                                        {days.map(function(d) { return <td key={d} style={{padding:'8px 6px',textAlign:'center'}}>{fmtFR(td(d))}</td>; })}
                                        <td style={{padding:'8px 12px',textAlign:'center',fontSize:14,color:'var(--berry)'}}>{fmtFR(days.reduce(function(s,d){return s+td(d);},0))}</td>
                                    </tr>
                                    <tr style={{background:'#f9f9f9',fontWeight:700,fontSize:11,color:'#888'}}>
                                        <td style={{padding:'6px 12px',position:'sticky',left:0,background:'#f9f9f9',zIndex:1}}>Total/Ha (kg/Ha)</td>
                                        <td></td>
                                        {days.map(function(d) { return <td key={d} style={{padding:'6px',textAlign:'center'}}>{fmtFR(td(d)/pSup, 2)}</td>; })}
                                        <td style={{padding:'6px 12px',textAlign:'center'}}>{fmtFR(days.reduce(function(s,d){return s+td(d);},0)/pSup, 2)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            };

            if (apiStatus === 'loading') {
                return <div className="fade-in" style={{textAlign:'center',padding:60}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:'var(--berry)'}}></i><div style={{marginTop:12,color:'#999'}}>Chargement des données phytosanitaires...</div></div>;
            }
            if (apiStatus === 'error' || allParcNames.length === 0) {
                return <div className="fade-in" style={{textAlign:'center',padding:60}}><i className="fa-solid fa-triangle-exclamation" style={{fontSize:32,color:'var(--red)'}}></i><div style={{marginTop:12,color:'#999'}}>Aucune donnée phytosanitaire disponible</div></div>;
            }

            // Parcelles ayant des données cette semaine (filtrer celles sans traitement)
            var parcWithData = isAllParc ? parcFiltered.filter(function(p) {
                var pData = programs[p] || { weeks: {} };
                var wData = (pData.weeks || {})[curWeekKey] || { days: {} };
                var dData = wData.days || {};
                var hasData = false;
                Object.values(dData).forEach(function(dp) {
                    Object.keys(dp || {}).forEach(function(k) { if (dp[k] > 0) hasData = true; });
                });
                return hasData;
            }) : [];

            return (
                <div className="fade-in">

                    {/* ---- FERME BUTTONS ---- */}
                    {!farmFilter && <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                        {allFermes.map(f => (
                            <button key={f} onClick={() => setFermeFilter(f)}
                                className={`chip c-berry ${fermeFilter===f ? 'active' : ''}`}>
                                {f === 'Toutes' ? <><i className="fa-solid fa-layer-group" style={{marginRight:4}}></i>Toutes</> : f}
                            </button>
                        ))}
                    </div>}

                    {/* ---- CULTURE BUTTONS ---- */}
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                        {culturesInFerme.map(c => (
                            <button key={c} onClick={() => setCultureFilter(c)}
                                style={{padding:'6px 14px',borderRadius:8,border: cultureFilter===c ? '2px solid var(--green)' : '1px solid #ddd',
                                    background: cultureFilter===c ? 'var(--green)' : '#fff', color: cultureFilter===c ? '#fff' : '#555',
                                    fontWeight:700,fontSize:12,cursor:'pointer',transition:'all 0.2s'}}>
                                {c === 'Toutes' ? <><i className="fa-solid fa-seedling" style={{marginRight:4}}></i>Toutes</> : c}
                            </button>
                        ))}
                    </div>

                    {/* ---- PARCELLE + SEMAINE ---- */}
                    <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16,alignItems:'flex-end'}}>
                        <div style={{flex:1,minWidth:260}}>
                            <label style={{fontSize:11,color:'var(--gray-400)',display:'block',marginBottom:4}}>Parcelle Culturale</label>
                            <select value={selParc} onChange={e => { setSelParc(e.target.value); setWeekIdx(0); }}
                                style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,background:'#fff'}}>
                                <option value="Toutes">Toutes ({parcFiltered.length} parcelles)</option>
                                {parcFiltered.map(p => <option key={p} value={p}>{getAlias(p)} — {displayCulture(programs[p].culture)} ({getParcFerme(p)})</option>)}
                            </select>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <button onClick={() => setWeekIdx(Math.min(weekIdx+1, allWeekKeys.length-1))} disabled={weekIdx >= allWeekKeys.length-1}
                                style={{padding:'6px 12px',borderRadius:6,border:'1px solid #ddd',background:weekIdx >= allWeekKeys.length-1 ? '#f5f5f5':'#fff',cursor:weekIdx >= allWeekKeys.length-1?'default':'pointer',fontSize:12}}>
                                <i className="fa-solid fa-chevron-left"></i> Sem. précédente
                            </button>
                            <div style={{minWidth:200,textAlign:'center'}}>
                                <div style={{fontWeight:700,fontSize:13,color:'var(--berry)'}}>{weekLabel || curWeekKey}</div>
                                {weekDateRange && <div style={{fontSize:10,color:'var(--gray-400)',marginTop:2}}>{weekDateRange}</div>}
                            </div>
                            <button onClick={() => setWeekIdx(Math.max(weekIdx-1, 0))} disabled={weekIdx <= 0}
                                style={{padding:'6px 12px',borderRadius:6,border:'1px solid #ddd',background:weekIdx <= 0 ? '#f5f5f5':'#fff',cursor:weekIdx <= 0?'default':'pointer',fontSize:12}}>
                                Sem. suivante <i className="fa-solid fa-chevron-right"></i>
                            </button>
                        </div>
                    </div>

                    {/* ---- TABLES ---- */}
                    {isAllParc ? (
                        <React.Fragment>
                            {parcWithData.length === 0 && (
                                <div style={{textAlign:'center',padding:40,color:'#999'}}>
                                    <i className="fa-solid fa-spray-can-sparkles" style={{fontSize:32,marginBottom:12,display:'block',opacity:0.3}}></i>
                                    Aucun traitement phytosanitaire cette semaine
                                </div>
                            )}
                            {parcWithData.map(function(p) { return buildParcTable(p); })}
                        </React.Fragment>
                    ) : (
                        <React.Fragment>
                            {buildParcTable(selParc) || (
                                <div style={{textAlign:'center',padding:40,color:'#999'}}>
                                    <i className="fa-solid fa-spray-can-sparkles" style={{fontSize:32,marginBottom:12,display:'block',opacity:0.3}}></i>
                                    Aucun traitement phytosanitaire cette semaine
                                </div>
                            )}
                        </React.Fragment>
                    )}
                </div>
            );
        }

export { AgroPhytoTab };
