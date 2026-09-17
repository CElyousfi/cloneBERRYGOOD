/* Module: shared | Déclaration(s): ToastProvider */
import { ToastContext } from './ToastContext.jsx';
import { useState } from './reactHooks.jsx';

function ToastProvider({ children }) {
            const [toasts, setToasts] = useState([]);
            const showToast = React.useCallback((message, type = 'error', duration = 5000) => {
                const id = Date.now() + Math.random();
                setToasts(prev => [...prev, { id, message, type }]);
                setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
            }, []);
            const colors = { error: { bg: 'rgba(231,76,60,0.08)', border: 'rgba(231,76,60,0.25)', icon: 'fa-circle-xmark', color: '#e74c3c' }, success: { bg: 'rgba(39,174,96,0.08)', border: 'rgba(39,174,96,0.25)', icon: 'fa-circle-check', color: '#27ae60' }, warning: { bg: 'rgba(241,196,15,0.08)', border: 'rgba(241,196,15,0.25)', icon: 'fa-triangle-exclamation', color: '#f39c12' }, info: { bg: 'rgba(52,152,219,0.08)', border: 'rgba(52,152,219,0.25)', icon: 'fa-circle-info', color: '#3498db' } };
            return (
                <ToastContext.Provider value={{ showToast }}>
                    {children}
                    <div style={{position:'fixed',top:20,right:20,zIndex:10000,display:'flex',flexDirection:'column',gap:10,maxWidth:420}}>
                        {toasts.map(t => {
                            const c = colors[t.type] || colors.error;
                            return (
                                <div key={t.id} style={{background:c.bg,border:`1px solid ${c.border}`,borderRadius:12,padding:'14px 18px',display:'flex',alignItems:'flex-start',gap:10,boxShadow:'0 4px 20px rgba(0,0,0,0.08)',animation:'slideInRight 0.3s ease',backdropFilter:'blur(8px)'}}>
                                    <i className={`fa-solid ${c.icon}`} style={{color:c.color,fontSize:18,marginTop:1}}></i>
                                    <div style={{flex:1,fontSize:13,color:'#2c3e50',lineHeight:1.5}}>{t.message}</div>
                                    <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} style={{background:'none',border:'none',cursor:'pointer',color:'#95a5a6',fontSize:16,padding:0,lineHeight:1}}>x</button>
                                </div>
                            );
                        })}
                    </div>
                </ToastContext.Provider>
            );
        }

export { ToastProvider };
