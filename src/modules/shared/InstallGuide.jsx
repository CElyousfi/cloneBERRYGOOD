/* Module: shared | Déclaration(s): InstallGuide */
import { useState } from './reactHooks.jsx';

// ===================== INSTALL GUIDE COMPONENT =====================
        function InstallGuide({ onClose }) {
            const [phoneType, setPhoneType] = useState(null);
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

            const androidSteps = [
                { title: 'Ouvrir dans Chrome', desc: React.createElement('span', null, 'Ouvrez cette application dans ', React.createElement('strong', null, 'Google Chrome'), ' sur votre t\u00e9l\u00e9phone Android.') },
                { title: 'Menu du navigateur', desc: React.createElement('span', null, 'Appuyez sur les ', React.createElement('strong', null, 'trois points'), ' ', React.createElement('i', { className: 'fa-solid fa-ellipsis-vertical step-icon' }), ' en haut \u00e0 droite de Chrome.') },
                { title: 'Ajouter \u00e0 l\u2019\u00e9cran d\u2019accueil', desc: React.createElement('span', null, 'S\u00e9lectionnez ', React.createElement('strong', null, '\u00ab\u00a0Ajouter \u00e0 l\u2019\u00e9cran d\u2019accueil\u00a0\u00bb'), ' ou ', React.createElement('strong', null, '\u00ab\u00a0Installer l\u2019application\u00a0\u00bb'), '.') },
                { title: 'Confirmer', desc: React.createElement('span', null, 'Appuyez sur ', React.createElement('strong', null, '\u00ab\u00a0Ajouter\u00a0\u00bb'), ' ou ', React.createElement('strong', null, '\u00ab\u00a0Installer\u00a0\u00bb'), ' dans la fen\u00eatre de confirmation.') },
                { title: 'C\u2019est fait !', desc: React.createElement('span', null, 'L\u2019ic\u00f4ne ', React.createElement('strong', null, 'Smart BERRY'), ' appara\u00eet sur votre \u00e9cran d\u2019accueil. Ouvrez-la comme une app normale !') }
            ];

            const iosSteps = [
                { title: 'Ouvrir dans Safari', desc: React.createElement('span', null, 'Ouvrez cette application dans ', React.createElement('strong', null, 'Safari'), ' sur votre iPhone. ', React.createElement('em', null, '(Chrome/Firefox ne supportent pas l\u2019installation sur iOS)')) },
                { title: 'Bouton Partager', desc: React.createElement('span', null, 'Appuyez sur le bouton ', React.createElement('strong', null, 'Partager'), ' ', React.createElement('i', { className: 'fa-solid fa-arrow-up-from-bracket step-icon' }), ' en bas de l\u2019\u00e9cran (barre Safari).') },
                { title: 'Sur l\u2019\u00e9cran d\u2019accueil', desc: React.createElement('span', null, 'Faites d\u00e9filer et appuyez sur ', React.createElement('strong', null, '\u00ab\u00a0Sur l\u2019\u00e9cran d\u2019accueil\u00a0\u00bb'), ' ', React.createElement('i', { className: 'fa-solid fa-plus-square step-icon' }), '.') },
                { title: 'Ajouter', desc: React.createElement('span', null, 'V\u00e9rifiez le nom (Smart BERRY) et appuyez sur ', React.createElement('strong', null, '\u00ab\u00a0Ajouter\u00a0\u00bb'), ' en haut \u00e0 droite.') },
                { title: 'C\u2019est fait !', desc: React.createElement('span', null, 'L\u2019ic\u00f4ne ', React.createElement('strong', null, 'Smart BERRY'), ' appara\u00eet sur votre \u00e9cran d\u2019accueil. L\u2019app s\u2019ouvre en plein \u00e9cran !') }
            ];

            const steps = phoneType === 'android' ? androidSteps : iosSteps;

            return React.createElement('div', { className: 'install-guide-overlay', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
                React.createElement('div', { className: 'install-guide-panel', onClick: e => e.stopPropagation() },
                    React.createElement('div', { className: 'install-guide-header' },
                        React.createElement('i', { className: 'fa-solid fa-mobile-screen-button', style: { fontSize: 36 } }),
                        React.createElement('h2', null, 'Installer Smart BERRY'),
                        React.createElement('p', null, 'Ajoutez l\u2019application \u00e0 votre t\u00e9l\u00e9phone')
                    ),
                    React.createElement('div', { className: 'install-guide-body' },
                        isStandalone
                            ? React.createElement('div', { className: 'install-guide-already' },
                                React.createElement('i', { className: 'fa-solid fa-circle-check', style: { fontSize: 40, display: 'block', marginBottom: 12 } }),
                                'L\u2019application est d\u00e9j\u00e0 install\u00e9e sur cet appareil !',
                                React.createElement('button', { className: 'install-guide-close', onClick: onClose, style: { marginTop: 16 } }, 'Fermer')
                              )
                            : React.createElement(React.Fragment, null,
                                React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: 'var(--gray-800)', marginBottom: 12, textAlign: 'center' } }, 'Quel est votre t\u00e9l\u00e9phone ?'),
                                React.createElement('div', { className: 'install-guide-choice' },
                                    React.createElement('button', {
                                        className: phoneType === 'android' ? 'selected' : '',
                                        onClick: () => setPhoneType('android')
                                    },
                                        React.createElement('i', { className: 'fa-brands fa-android', style: { color: '#3DDC84' } }),
                                        React.createElement('span', null, 'Android')
                                    ),
                                    React.createElement('button', {
                                        className: phoneType === 'ios' ? 'selected' : '',
                                        onClick: () => setPhoneType('ios')
                                    },
                                        React.createElement('i', { className: 'fa-brands fa-apple', style: { color: '#333' } }),
                                        React.createElement('span', null, 'iPhone / iPad')
                                    )
                                ),
                                phoneType && React.createElement('div', { className: 'install-guide-steps' },
                                    steps.map((step, i) =>
                                        React.createElement('div', { key: i, className: 'install-guide-step' },
                                            React.createElement('div', { className: 'install-guide-step-num' }, i + 1),
                                            React.createElement('div', { className: 'install-guide-step-content' },
                                                React.createElement('strong', null, step.title),
                                                React.createElement('p', null, step.desc)
                                            )
                                        )
                                    ),
                                    React.createElement('button', { className: 'install-guide-close', onClick: onClose }, 'Compris !')
                                )
                              )
                    )
                )
            );
        }

export { InstallGuide };
