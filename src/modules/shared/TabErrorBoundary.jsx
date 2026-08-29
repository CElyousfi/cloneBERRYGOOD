/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): TabErrorBoundary */


// Error boundary par onglet — isole les crashs pour que seul l'onglet cassé affiche une erreur
        class TabErrorBoundary extends React.Component {
            constructor(props) { super(props); this.state = { error: null, info: null }; }
            static getDerivedStateFromError(error) { return { error }; }
            componentDidCatch(error, info) { this.setState({ info }); console.error('[Tab:' + (this.props.name || '?') + ']', error); }
            render() {
                if (this.state.error) {
                    return React.createElement('div', { style: { padding: 40, textAlign: 'center' } },
                        React.createElement('i', { className: 'fa-solid fa-triangle-exclamation', style: { fontSize: 48, color: '#dc2626', marginBottom: 16 } }),
                        React.createElement('h3', { style: { margin: '16px 0 8px', color: '#1e293b' } }, 'Erreur dans : ' + (this.props.name || 'cet onglet')),
                        React.createElement('p', { style: { color: '#64748b', fontSize: 14, marginBottom: 16 } }, this.state.error.toString()),
                        React.createElement('button', {
                            onClick: () => this.setState({ error: null, info: null }),
                            style: { padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }
                        }, 'Réessayer'),
                        React.createElement('details', { style: { marginTop: 16, textAlign: 'left', maxWidth: 600, margin: '16px auto' } },
                            React.createElement('summary', { style: { cursor: 'pointer', color: '#94a3b8', fontSize: 12 } }, 'Détails techniques'),
                            React.createElement('pre', { style: { fontSize: 11, color: '#94a3b8', whiteSpace: 'pre-wrap', marginTop: 8 } }, this.state.info && this.state.info.componentStack)
                        )
                    );
                }
                return this.props.children;
            }
        }

export { TabErrorBoundary };
