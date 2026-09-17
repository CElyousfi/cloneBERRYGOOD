/* Module: agronomie | Déclaration(s): CampagneSegmentTable */
import { Panel } from '../shared/Panel.jsx';
import { getHa } from './getHa.jsx';
import { getKgExport } from './getKgExport.jsx';
import { getParcelleInfo } from './getParcelleInfo.jsx';
import { isMonoCycle } from './isMonoCycle.jsx';

function CampagneSegmentTable({ title, icon, segment, matchesFarm, showMonoCycleOnly }) {
            if (!segment) return null;
            const rows = (segment.parVariete || []).filter(v => matchesFarm(v) && (showMonoCycleOnly ? isMonoCycle(v.variete) : !isMonoCycle(v.variete)));
            if (rows.length === 0) return null;
            const tot = rows.reduce((a, v) => ({
                recolte: a.recolte + v.recolte.cout,
                horsRecolte: a.horsRecolte + v.horsRecolte.cout,
                postesFixes: a.postesFixes + v.postesFixes.cout,
                total: a.total + v.total.cout,
                kgExport: a.kgExport + getKgExport(v.variete, v.ferme),
                ha: a.ha + getHa(v.variete, v.ferme),
            }), { recolte: 0, horsRecolte: 0, postesFixes: 0, total: 0, kgExport: 0, ha: 0 });
            const COLORS_MO = ['#8B2252','#2D8B4E','#D4A847','#3498DB','#E67E22','#9B59B6','#E74C3C','#1ABC9C'];
            const fmt0 = (n) => Math.round(n).toLocaleString('fr-FR');
            const fmtRatio = (n) => n > 0 ? Math.round(n).toLocaleString('fr-FR') : '-';

            return (
                <Panel title={title} icon={icon || 'fa-users-gear'}>
                    <div style={{display:'flex',gap:16,marginBottom:16,flexWrap:'wrap'}}>
                        {[
                            {label:'Récolte',val:tot.recolte,color:'#E74C3C'},
                            {label:'Hors Récolte',val:tot.horsRecolte,color:'#3498DB'},
                            {label:'Ouvriers Avocatier',val:tot.postesFixes,color:'#95A5A6'},
                            {label:'Total M.O',val:tot.total,color:'#8B2252'},
                        ].map((s,i) => (
                            <div key={i} style={{flex:1,minWidth:120,background:'#f8f9fa',borderRadius:10,padding:'12px 16px',textAlign:'center'}}>
                                <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.5px',color:'#888',marginBottom:4}}>{s.label}</div>
                                <div style={{fontSize:18,fontWeight:700,color:s.color}}>{(s.val/1000).toFixed(0)}k</div>
                            </div>
                        ))}
                    </div>
                    <div style={{overflowX:'auto'}}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Parcelle</th>
                                <th>Culture</th>
                                <th>Ferme</th>
                                <th style={{textAlign:'right'}}>Ha</th>
                                <th style={{textAlign:'right'}}>Kg exporté</th>
                                <th style={{textAlign:'right'}}>Récolte (DH)</th>
                                <th style={{textAlign:'right'}}>Hors Récolte (DH)</th>
                                <th style={{textAlign:'right',color:'#E74C3C'}} title="M.O Récolte / Kg exporté">M.O Réc / Kg exp.</th>
                                <th style={{textAlign:'right',color:'#3498DB'}} title="M.O Hors Récolte / Ha">M.O HR / Ha</th>
                                <th style={{textAlign:'right'}}>%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((v, i) => {
                                const info = getParcelleInfo(v.variete, v.ferme);
                                const ha = info.ha;
                                const kgExp = info.kgExport;
                                const parcelleLabel = info.parcelles.join(' + ') || v.variete;
                                const hrParHa = ha > 0 ? v.horsRecolte.cout / ha : 0;
                                const moRecParKgExp = kgExp > 0 ? v.recolte.cout / kgExp : 0;
                                return (
                                    <tr key={i}>
                                        <td><strong>{parcelleLabel}</strong></td>
                                        <td><span style={{fontSize:11,padding:'2px 8px',borderRadius:12,background: v.culture==='Framboise'?'rgba(139,34,82,0.1)':v.culture==='Myrtille'?'rgba(52,152,219,0.1)':'rgba(45,139,78,0.1)',color: v.culture==='Framboise'?'#8B2252':v.culture==='Myrtille'?'#3498DB':'#2D8B4E',fontWeight:600}}>{v.culture}</span></td>
                                        <td>{v.ferme}</td>
                                        <td style={{textAlign:'right',fontFamily:'monospace'}}>{ha > 0 ? ha.toFixed(1) : '-'}</td>
                                        <td style={{textAlign:'right',fontFamily:'monospace'}}>{kgExp > 0 ? fmt0(kgExp) : '-'}</td>
                                        <td style={{textAlign:'right',fontFamily:'monospace'}}>{fmt0(v.recolte.cout)}</td>
                                        <td style={{textAlign:'right',fontFamily:'monospace'}}>{fmt0(v.horsRecolte.cout)}</td>
                                        <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:600,color:'#E74C3C'}} title={kgExp > 0 ? `${fmt0(v.recolte.cout)} DH / ${fmt0(kgExp)} kg` : 'Aucun kg exporté'}>{kgExp > 0 ? fmtRatio(moRecParKgExp) : '-'}</td>
                                        <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:600,color:'#3498DB'}} title={ha > 0 ? `${fmt0(v.horsRecolte.cout)} DH / ${ha} Ha` : 'Surface inconnue'}>{ha > 0 ? fmtRatio(hrParHa) : '-'}</td>
                                        <td style={{textAlign:'right',color:'#888'}}>{tot.total > 0 ? Math.round(v.total.cout / tot.total * 100) + '%' : '-'}</td>
                                    </tr>
                                );
                            })}
                            <tr style={{background:'var(--berry-pale)',fontWeight:700}}>
                                <td colSpan={3}>TOTAL</td>
                                <td style={{textAlign:'right',fontFamily:'monospace'}}>{tot.ha > 0 ? tot.ha.toFixed(1) : '-'}</td>
                                <td style={{textAlign:'right',fontFamily:'monospace'}}>{tot.kgExport > 0 ? fmt0(tot.kgExport) : '-'}</td>
                                <td style={{textAlign:'right',fontFamily:'monospace'}}>{fmt0(tot.recolte)}</td>
                                <td style={{textAlign:'right',fontFamily:'monospace'}}>{fmt0(tot.horsRecolte)}</td>
                                <td style={{textAlign:'right',fontFamily:'monospace',color:'#E74C3C'}}>{tot.kgExport > 0 ? fmtRatio(tot.recolte/tot.kgExport) : '-'}</td>
                                <td style={{textAlign:'right',fontFamily:'monospace',color:'#3498DB'}}>{tot.ha > 0 ? fmtRatio(tot.horsRecolte/tot.ha) : '-'}</td>
                                <td style={{textAlign:'right'}}>100%</td>
                            </tr>
                        </tbody>
                    </table>
                    </div>
                    <div style={{marginTop:16}}>
                        {rows.map((v, i) => {
                            const pct = tot.total > 0 ? (v.total.cout / tot.total * 100) : 0;
                            return (
                                <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                                    <div style={{width:120,fontSize:11,fontWeight:600,textAlign:'right',color:'#555',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={v.variete}>{getParcelleInfo(v.variete, v.ferme).parcelles.join(' + ') || v.variete}</div>
                                    <div style={{flex:1,height:18,background:'#f0f0f0',borderRadius:4,overflow:'hidden'}}>
                                        <div style={{width:pct+'%',height:'100%',background:COLORS_MO[i % COLORS_MO.length],borderRadius:4,transition:'width 0.5s',minWidth: pct > 0 ? 2 : 0}}></div>
                                    </div>
                                    <div style={{width:45,fontSize:11,color:'#888',textAlign:'right'}}>{Math.round(pct)}%</div>
                                </div>
                            );
                        })}
                    </div>
                </Panel>
            );
        }

export { CampagneSegmentTable };
