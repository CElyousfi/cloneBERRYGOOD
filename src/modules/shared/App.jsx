/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): App */
import { AuthenticatedApp } from './AuthenticatedApp.jsx';
import { LoginScreen } from './LoginScreen.jsx';
import { NewVersionToast } from './NewVersionToast.jsx';
import { ProfileLoadErrorScreen } from './ProfileLoadErrorScreen.jsx';
import { ReconnectingBanner } from './ReconnectingBanner.jsx';
import { clearCachedProfile } from './clearCachedProfile.jsx';
import { loadCachedProfile } from './loadCachedProfile.jsx';
import { useEffect, useRef, useState } from './reactHooks.jsx';
import { saveCachedProfile } from './saveCachedProfile.jsx';

// Auth wrapper component
        function App() {
            const [authUser, setAuthUser] = useState(null);
            const [userProfile, setUserProfile] = useState(null);
            const [authLoading, setAuthLoading] = useState(true);
            const [authError, setAuthError] = useState('');
            // CORRECTIF (a) : bannière non bloquante "Reconnexion en cours…"
            const [reconnecting, setReconnecting] = useState(false);
            // CORRECTIF (a) : impossible de charger le profil ET aucun cache → écran retry.
            const [profileLoadFailed, setProfileLoadFailed] = useState(false);
            const retryTimerRef = useRef(null);
            const retryAttemptRef = useRef(0);

            useEffect(() => {
                const AR = window.AuthResilience;

                const clearRetry = () => {
                    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
                };

                // Appelle /api/auth?action=me et renvoie un meResult normalisé pour
                // AuthResilience.decideAuthState. ok=false => fetch a échoué (réseau/5xx).
                const fetchMe = async (user) => {
                    try {
                        const token = await user.getIdToken();
                        const r = await fetch('/api/auth?action=me', { headers: { 'Authorization': 'Bearer ' + token } });
                        let json = null;
                        try { json = await r.json(); } catch (e) { json = null; }
                        if (!r.ok || !json) {
                            return { ok: false, error: 'HTTP ' + r.status };
                        }
                        return { ok: true, success: !!json.success, user: json.user, disabled: !!json.disabled, error: json.error };
                    } catch (e) {
                        // Catch réseau : Firebase peut rester connecté → transitoire.
                        return { ok: false, error: (e && e.message) || 'network' };
                    }
                };

                // Applique la décision pure d'AuthResilience à l'état React.
                const applyDecision = (user, meResult) => {
                    const cachedProfile = loadCachedProfile();
                    const decision = AR
                        ? AR.decideAuthState({ authUser: user, meResult, cachedProfile })
                        : // Fallback ultra-défensif si la lib n'a pas chargé (ne devrait pas arriver).
                          (user && meResult && meResult.ok && meResult.success && meResult.user
                              ? { action: 'profile', profile: meResult.user }
                              : { action: 'login' });

                    if (decision.action === 'profile') {
                        clearRetry();
                        retryAttemptRef.current = 0;
                        setUserProfile(decision.profile);
                        saveCachedProfile(decision.profile);
                        setAuthError('');
                        setReconnecting(false);
                        setProfileLoadFailed(false);
                    } else if (decision.action === 'retry') {
                        // Firebase connecté mais `me` a échoué transitoirement.
                        // On RESTE dans l'app avec le dernier profil connu + bannière + retry.
                        setUserProfile(decision.profile);
                        setAuthError('');
                        setProfileLoadFailed(false);
                        setReconnecting(true);
                        scheduleRetry(user);
                    } else if (decision.action === 'error') {
                        // Firebase connecté mais aucun profil (ni live ni cache) → on ne
                        // peut pas entrer. Écran retry, surtout PAS de faux profil.
                        clearRetry();
                        setReconnecting(false);
                        setProfileLoadFailed(true);
                        setUserProfile(null);
                        setAuthError(meResult && meResult.error ? meResult.error : 'Impossible de charger votre profil');
                        // Retry en arrière-plan quand même (réseau peut revenir).
                        scheduleRetry(user);
                    } else {
                        // 'login' — vraie déconnexion (Firebase signé out OU compte désactivé).
                        clearRetry();
                        retryAttemptRef.current = 0;
                        setReconnecting(false);
                        setProfileLoadFailed(false);
                        setUserProfile(null);
                        // Compte désactivé : signOut explicite (comportement historique).
                        if (meResult && meResult.ok && meResult.success === false && meResult.disabled) {
                            setAuthError(meResult.error || 'Compte désactivé');
                            firebaseAuth.signOut();
                            clearCachedProfile();
                        }
                    }
                };

                // Retry automatique de `me` avec backoff court (2s,5s,10s… plafonné).
                const scheduleRetry = (user) => {
                    clearRetry();
                    const delay = AR ? AR.retryDelayMs(retryAttemptRef.current) : 5000;
                    retryAttemptRef.current += 1;
                    retryTimerRef.current = setTimeout(async () => {
                        // L'utilisateur a pu se déconnecter entre-temps.
                        const current = firebaseAuth.currentUser;
                        if (!current) { applyDecision(null, null); return; }
                        const meResult = await fetchMe(current);
                        applyDecision(current, meResult);
                    }, delay);
                };

                const unsub = firebaseAuth.onAuthStateChanged(async (user) => {
                    if (user) {
                        setAuthUser(user);
                        const meResult = await fetchMe(user);
                        applyDecision(user, meResult);
                    } else {
                        // Vraie déconnexion Firebase → login. Nettoie le cache profil.
                        setAuthUser(null);
                        clearRetry();
                        retryAttemptRef.current = 0;
                        setReconnecting(false);
                        setProfileLoadFailed(false);
                        setUserProfile(null);
                        clearCachedProfile();
                    }
                    setAuthLoading(false);
                });
                return () => { clearRetry(); unsub(); };
            }, []);

            // Plein écran automatique : DÉSACTIVÉ (demande d'Omar, 2026-08-22).
            //
            // Le mécanisme demandait le plein écran au premier clic après
            // authentification, sur desktop et en paysage mobile. Or le navigateur
            // sort du plein écran dès qu'on change de fenêtre, et l'app le
            // redemandait au retour : cette transition remontait l'onglet courant et
            // faisait disparaître la saisie en cours (bon de consommation du
            // magasinier). L'app reste désormais fenêtrée ; l'utilisateur garde le
            // plein écran natif du navigateur (F11 / bouton de la fenêtre) s'il le
            // veut. Une sortie propre est faite au montage pour les sessions déjà
            // basculées en plein écran par l'ancienne version.
            useEffect(() => {
                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    const exit = document.exitFullscreen || document.webkitExitFullscreen;
                    if (exit) { try { const r = exit.call(document); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
                }
            }, []);

            if (authLoading) return (
                <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#fff',position:'relative',overflow:'hidden',fontFamily:"'Inter',sans-serif"}}>
                    <div style={{position:'absolute',top:'8%',left:'12%',fontSize:28,opacity:0.12,animation:'float-berry 3s ease-in-out infinite'}}>🫐</div>
                    <div style={{position:'absolute',top:'15%',right:'18%',fontSize:22,opacity:0.12,animation:'float-berry2 3.5s ease-in-out 0.5s infinite'}}>🍇</div>
                    <div style={{position:'absolute',top:'65%',left:'8%',fontSize:28,opacity:0.12,animation:'float-berry2 3.5s ease-in-out 1s infinite'}}>🍇</div>
                    <div style={{position:'absolute',top:'75%',right:'12%',fontSize:32,opacity:0.12,animation:'float-berry 3s ease-in-out 1.5s infinite'}}>🫐</div>
                    <div style={{position:'absolute',top:'35%',left:'5%',fontSize:20,opacity:0.12,animation:'float-berry 3s ease-in-out 0.8s infinite'}}>🫐</div>
                    <div style={{position:'absolute',top:'45%',right:'6%',fontSize:24,opacity:0.12,animation:'float-berry2 3.5s ease-in-out 1.2s infinite'}}>🍇</div>
                    <img src="https://www.berrygood.ma/logo.png" alt="Smart BERRY" style={{maxWidth:'70%',width:240,height:'auto',objectFit:'contain',marginBottom:24,animation:'pulse-logo 2s ease-in-out infinite'}} />
                    <div style={{color:'#8B2252',fontSize:18,fontWeight:700,marginBottom:8}}>Smart BERRY</div>
                    <div style={{color:'#888',fontSize:13,fontWeight:500,marginBottom:24}}>Dashboard de gestion agricole</div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:6,height:6,borderRadius:'50%',background:'#8B2252',animation:'fade-dots 1.2s ease-in-out infinite'}}></div>
                        <div style={{width:6,height:6,borderRadius:'50%',background:'#8B2252',animation:'fade-dots 1.2s ease-in-out 0.2s infinite'}}></div>
                        <div style={{width:6,height:6,borderRadius:'50%',background:'#8B2252',animation:'fade-dots 1.2s ease-in-out 0.4s infinite'}}></div>
                    </div>
                    <div style={{color:'#aaa',fontSize:11,marginTop:12}}>Chargement en cours, veuillez patienter...</div>
                    <div style={{position:'absolute',bottom:24,display:'flex',gap:6,alignItems:'center',color:'#bbb',fontSize:10}}>
                        <span>🍇</span> Excellence agricole depuis le Maroc <span>🫐</span>
                    </div>
                    <style dangerouslySetInnerHTML={{__html:`
                        @keyframes float-berry { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-15px) rotate(10deg); } }
                        @keyframes float-berry2 { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-12px) rotate(-8deg); } }
                        @keyframes pulse-logo { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
                        @keyframes fade-dots { 0% { opacity: 0.3; } 50% { opacity: 1; } 100% { opacity: 0.3; } }
                    `}} />
                </div>
            );

            // CORRECTIF (a) — Firebase connecté mais profil introuvable ET aucun
            // cache (ex. tout premier login + réseau down). On ne fabrique PAS de
            // faux profil : écran d'erreur/retry explicite. Un retry tourne déjà en
            // arrière-plan ; le bouton force un essai immédiat.
            if (authUser && profileLoadFailed && !userProfile) return (
                <ProfileLoadErrorScreen
                    message={authError}
                    onSignOut={() => firebaseAuth.signOut()}
                />
            );

            // Vraie déconnexion : pas d'utilisateur Firebase OU (cas désactivé géré
            // ci-dessus via signOut). Si pas de profil ET pas en reconnexion → login.
            if (!authUser || (!userProfile && !reconnecting)) return (
                <div>
                    <NewVersionToast />
                    <LoginScreen />
                    {authError && authUser && (
                        <div style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',background:'rgba(220,53,69,0.95)',color:'#fff',padding:'12px 24px',borderRadius:12,fontSize:13,maxWidth:400,textAlign:'center',boxShadow:'0 4px 20px rgba(0,0,0,0.3)'}}>
                            <i className="fa-solid fa-circle-exclamation" style={{marginRight:8}}></i>{authError}
                            <button onClick={() => firebaseAuth.signOut()} style={{marginLeft:12,background:'rgba(255,255,255,0.2)',color:'#fff',border:'none',borderRadius:6,padding:'4px 12px',fontSize:11,cursor:'pointer'}}>Déconnexion</button>
                        </div>
                    )}
                </div>
            );

            // userProfile présent (frais OU restauré depuis le cache pendant une
            // reconnexion transitoire) → on entre dans l'app. Bannière non bloquante
            // si reconnexion en cours, + toast nouvelle version.
            return (
                <React.Fragment>
                    <NewVersionToast />
                    {reconnecting && <ReconnectingBanner />}
                    <AuthenticatedApp authUser={authUser} userProfile={userProfile} />
                </React.Fragment>
            );
        }

export { App };
