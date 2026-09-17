/* Module: shared | Déclaration(s): ProfileLoadErrorScreen */


// CORRECTIF (a) — écran d'erreur quand le profil est introuvable et qu'aucun
        // cache n'existe. PAS un faux profil : on propose réessayer / se déconnecter.
        function ProfileLoadErrorScreen({ message, onSignOut }) {
            return (
                <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#fff',padding:24,textAlign:'center',fontFamily:"'Inter',sans-serif"}}>
                    <i className="fa-solid fa-cloud-exclamation" style={{fontSize:48,color:'var(--berry, #8B2252)',marginBottom:16}}></i>
                    <h3 style={{margin:'0 0 8px',color:'#1e293b'}}>Impossible de charger votre profil</h3>
                    <p style={{color:'#64748b',fontSize:14,maxWidth:420,marginBottom:8}}>{message || 'Vérifiez votre connexion. Une nouvelle tentative est en cours automatiquement.'}</p>
                    <div style={{display:'flex',alignItems:'center',gap:8,color:'var(--berry, #8B2252)',fontSize:13,marginBottom:20}}>
                        <i className="fa-solid fa-spinner fa-spin"></i><span>Nouvelle tentative…</span>
                    </div>
                    <div style={{display:'flex',gap:8}}>
                        <button onClick={() => window.location.reload()} style={{padding:'8px 20px',background:'var(--berry, #8B2252)',color:'#fff',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>
                            <i className="fa-solid fa-rotate-right" style={{marginRight:6}}></i>Réessayer
                        </button>
                        <button onClick={onSignOut} style={{padding:'8px 20px',background:'var(--gray-200, #e2e8f0)',color:'#475569',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>Déconnexion</button>
                    </div>
                </div>
            );
        }

export { ProfileLoadErrorScreen };
