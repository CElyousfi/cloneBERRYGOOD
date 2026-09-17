/* Module: shared | Déclaration(s): ReconnectingBanner */


// CORRECTIF (a) — bannière non bloquante affichée quand `me` échoue
        // transitoirement alors que Firebase est connecté. Le retry tourne en
        // arrière-plan (App); cette bannière est purement informative.
        function ReconnectingBanner() {
            return (
                <div style={{position:'fixed',top:0,left:0,right:0,zIndex:99998,background:'var(--berry, #8B2252)',color:'#fff',padding:'8px 16px',fontSize:13,fontWeight:500,textAlign:'center',boxShadow:'0 2px 10px rgba(0,0,0,0.2)',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                    <i className="fa-solid fa-spinner fa-spin"></i>
                    <span>Reconnexion en cours…</span>
                </div>
            );
        }

export { ReconnectingBanner };
