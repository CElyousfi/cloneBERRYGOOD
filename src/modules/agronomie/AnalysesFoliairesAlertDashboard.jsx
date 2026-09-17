/* Module: agronomie | Déclaration(s): AnalysesFoliairesAlertDashboard */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ANALYSES FOLIAIRES ALERT (Dashboard Chef) =====================
        function AnalysesFoliairesAlertDashboard({ ferme, onNavigate }) {
            const [data, setData] = useState(null);
            useEffect(() => {
                if (!ferme) return;
                fetch('/api/stock?action=list-analyses-foliaires&ferme=' + ferme)
                    .then(r => r.json()).then(j => { if (j.success) setData(j); }).catch(() => {});
            }, [ferme]);

            if (!data) return null;
            const { parcelles_overdue = [], counts = {} } = data;
            if (parcelles_overdue.length === 0 && (counts.en_retard || 0) === 0) return null;

            return (
                <div style={{marginBottom:12}}>
                    {(counts.en_retard || 0) > 0 && (
                        <div onClick={() => onNavigate && onNavigate('chef_agronomie')} style={{background:'#fef2f2',border:'1.5px solid #fca5a5',borderRadius:10,padding:'10px 16px',marginBottom:6,cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
                            <i className="fa-solid fa-triangle-exclamation" style={{color:'#dc2626',fontSize:18}}/>
                            <div style={{flex:1}}>
                                <div style={{fontSize:13,fontWeight:700,color:'#dc2626'}}>Résultat(s) d'analyse foliaire en retard</div>
                                <div style={{fontSize:11,color:'#7f1d1d'}}>{counts.en_retard} analyse{counts.en_retard > 1 ? 's' : ''} prélevée{counts.en_retard > 1 ? 's' : ''} sans résultat depuis plus de 3 jours</div>
                            </div>
                            <i className="fa-solid fa-chevron-right" style={{color:'#dc2626',fontSize:11}}/>
                        </div>
                    )}
                    {parcelles_overdue.length > 0 && (
                        <div onClick={() => onNavigate && onNavigate('chef_agronomie')} style={{background:'#fffbeb',border:'1.5px solid #fde68a',borderRadius:10,padding:'10px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
                            <i className="fa-solid fa-flask-vial" style={{color:'#d97706',fontSize:18}}/>
                            <div style={{flex:1}}>
                                <div style={{fontSize:13,fontWeight:700,color:'#d97706'}}>{parcelles_overdue.length} parcelle{parcelles_overdue.length > 1 ? 's' : ''} sans analyse foliaire récente</div>
                                <div style={{fontSize:11,color:'#78350f'}}>{parcelles_overdue.filter(o=>o.never).length > 0 ? `Dont ${parcelles_overdue.filter(o=>o.never).length} jamais analysée(s). ` : ''}{parcelles_overdue.filter(o=>!o.never).map(o=>`${o.parcelle} (${o.days_since}j)`).join(', ')}</div>
                            </div>
                            <i className="fa-solid fa-chevron-right" style={{color:'#d97706',fontSize:11}}/>
                        </div>
                    )}
                </div>
            );
        }

export { AnalysesFoliairesAlertDashboard };
