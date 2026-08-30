/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): ErrorBoundary */


// Error boundary pour capturer les erreurs React
        class ErrorBoundary extends React.Component {
            constructor(props) { super(props); this.state = { error: null, info: null }; }
            componentDidCatch(error, info) { this.setState({ error, info }); }
            render() {
                if (this.state.error) {
                    return React.createElement('pre', { style: { color: 'red', padding: 20, fontSize: 14, whiteSpace: 'pre-wrap' } },
                        'ERREUR REACT:\n' + this.state.error.toString() + '\n\n' + (this.state.info ? this.state.info.componentStack : ''));
                }
                return this.props.children;
            }
        }

export { ErrorBoundary };
