/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: admin | Déclaration(s): TutorialMenu */
import { PROFILES } from '../shared/PROFILES.jsx';
import { getTutorials } from './getTutorials.jsx';

// ===================== TUTORIAL COMPONENTS =====================
        function TutorialMenu({ currentProfile, onStart, onClose }) {
            const tutorials = getTutorials(currentProfile);
            const profileLabel = PROFILES.find(p => p.id === currentProfile)?.label || currentProfile;

            return (
                <div className="tutorial-menu-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
                    <div className="tutorial-menu-panel" onClick={e => e.stopPropagation()}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                            <div>
                                <h2><i className="fa-solid fa-graduation-cap" style={{marginRight:8,color:'var(--berry)'}}></i>Guide interactif</h2>
                                <div className="subtitle">Profil : {profileLabel} — Choisissez un tutoriel pour commencer</div>
                            </div>
                            <button onClick={onClose} style={{background:'none',border:'none',fontSize:18,color:'var(--gray-400)',cursor:'pointer',padding:4}}>
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        {tutorials.length === 0 ? (
                            <div style={{textAlign:'center',padding:'30px 0',color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-circle-info" style={{fontSize:28,marginBottom:8,display:'block'}}></i>
                                Aucun tutoriel disponible pour ce profil.
                            </div>
                        ) : tutorials.map(tut => {
                            const done = localStorage.getItem('tutorial_done_' + currentProfile + '_' + tut.id);
                            return (
                                <div key={tut.id} className={`tutorial-card ${done ? 'completed' : ''}`}
                                    onClick={() => { onClose(); setTimeout(() => onStart(tut), 200); }}>
                                    <div className="t-icon">
                                        <i className={`fa-solid ${tut.icon}`}></i>
                                    </div>
                                    <div className="t-info">
                                        <div className="t-title">{tut.title}</div>
                                        <div className="t-desc">{tut.description}</div>
                                        <div style={{fontSize:10,color:'var(--gray-400)',marginTop:4}}>
                                            <i className="fa-solid fa-shoe-prints" style={{marginRight:4}}></i>{tut.steps.length} étapes
                                        </div>
                                    </div>
                                    {done ? (
                                        <div className="t-done"><i className="fa-solid fa-circle-check"></i></div>
                                    ) : (
                                        <div style={{color:'var(--berry)',fontSize:12,fontWeight:600,whiteSpace:'nowrap'}}>
                                            Commencer <i className="fa-solid fa-arrow-right" style={{marginLeft:4}}></i>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

export { TutorialMenu };
