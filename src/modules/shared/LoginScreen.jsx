/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): LoginScreen */
import { InstallGuide } from './InstallGuide.jsx';
import { useState } from './reactHooks.jsx';

// ===================== LOGIN SCREEN =====================
        function LoginScreen({ onLogin }) {
            const [email, setEmail] = useState('');
            const [password, setPassword] = useState('');
            const [error, setError] = useState('');
            const [loading, setLoading] = useState(false);
            const [showInstall, setShowInstall] = useState(false);

            const handleSubmit = async (e) => {
                e.preventDefault();
                setError(''); setLoading(true);
                try {
                    await firebaseAuth.signInWithEmailAndPassword(email, password);
                } catch (err) {
                    const msgs = { 'auth/user-not-found': 'Utilisateur introuvable', 'auth/wrong-password': 'Mot de passe incorrect',
                        'auth/invalid-email': 'Email invalide', 'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.',
                        'auth/invalid-credential': 'Email ou mot de passe incorrect' };
                    setError(msgs[err.code] || err.message);
                }
                setLoading(false);
            };

            const handleGoogle = async () => {
                setError(''); setLoading(true);
                try {
                    await firebaseAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
                } catch (err) {
                    if (err.code !== 'auth/popup-closed-by-user') setError(err.message);
                }
                setLoading(false);
            };

            return (
                <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'}}>
                    <div style={{background:'#fff',borderRadius:16,padding:40,width:'100%',maxWidth:400,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                        <div style={{textAlign:'center',marginBottom:32}}>
                            <img src="https://www.berrygood.ma/logo.png" alt="Smart BERRY" style={{maxWidth:'80%',width:180,height:'auto',objectFit:'contain',marginBottom:12}} />
                            <h1 style={{fontSize:22,fontWeight:700,color:'var(--gray-800)',margin:0}}>Smart <span style={{color:'var(--berry)'}}>BERRY</span></h1>
                            <p style={{fontSize:12,color:'var(--gray-400)',margin:'4px 0 0'}}>Connectez-vous pour accéder au tableau de bord</p>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div style={{marginBottom:16}}>
                                <label style={{display:'block',fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:4}}>
                                    <i className="fa-solid fa-envelope" style={{marginRight:6}}></i>Email
                                </label>
                                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                                    placeholder="votre@email.com"
                                    style={{width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:14,boxSizing:'border-box'}} />
                            </div>
                            <div style={{marginBottom:20}}>
                                <label style={{display:'block',fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:4}}>
                                    <i className="fa-solid fa-lock" style={{marginRight:6}}></i>Mot de passe
                                </label>
                                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                                    placeholder="Votre mot de passe"
                                    style={{width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:14,boxSizing:'border-box'}} />
                            </div>

                            {error && (
                                <div style={{background:'rgba(220,53,69,0.1)',color:'#dc3545',padding:'10px 14px',borderRadius:8,fontSize:12,marginBottom:16,fontWeight:500}}>
                                    <i className="fa-solid fa-circle-exclamation" style={{marginRight:6}}></i>{error}
                                </div>
                            )}

                            <button type="submit" disabled={loading}
                                style={{width:'100%',padding:'12px',background: loading ? 'var(--gray-300)' : 'var(--berry)',color:'#fff',border:'none',borderRadius:8,fontSize:14,fontWeight:700,cursor: loading ? 'wait' : 'pointer',marginBottom:12}}>
                                {loading ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Connexion...</> : <><i className="fa-solid fa-right-to-bracket" style={{marginRight:6}}></i>Se connecter</>}
                            </button>
                        </form>

                        <div style={{textAlign:'center',margin:'16px 0',color:'var(--gray-300)',fontSize:12}}>— ou —</div>

                        <button onClick={handleGoogle} disabled={loading}
                            style={{width:'100%',padding:'10px',background:'#fff',color:'var(--gray-700)',border:'1px solid var(--gray-200)',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                            Continuer avec Google
                        </button>

                        {!window.matchMedia('(display-mode: standalone)').matches && !window.navigator.standalone && (
                            <button onClick={() => setShowInstall(true)}
                                style={{width:'100%',marginTop:16,padding:'10px',background:'rgba(45,139,78,0.1)',color:'#2D8B4E',border:'1.5px solid rgba(45,139,78,0.15)',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,fontFamily:'Inter, sans-serif'}}>
                                <i className="fa-solid fa-download"></i> Installer sur mon téléphone
                            </button>
                        )}
                        <div style={{textAlign:'center',marginTop:20,fontSize:10,color:'var(--gray-300)'}}>Berry Good Farms Dashboard v2.0</div>
                    </div>
                    {showInstall && <InstallGuide onClose={() => setShowInstall(false)} />}
                </div>
            );
        }

export { LoginScreen };
