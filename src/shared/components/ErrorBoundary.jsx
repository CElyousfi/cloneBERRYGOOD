// @ts-check
import React from 'react';

/**
 * React Error Boundary component.
 * Catches JavaScript errors anywhere in its child component tree,
 * logs those errors, and displays a fallback UI instead of crashing to a blank screen.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '32px',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            margin: '16px 0'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: 'var(--amber-50)',
                color: 'var(--amber-500)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                flexShrink: 0
              }}
            >
              <i className="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>
                {this.props.domainName || 'Module Domain'} — Chargement du sous-composant
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Le composant d'origine nécessite des dépendances globales Firebase/Firestore live.
              </p>
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              fontFamily: 'monospace',
              fontSize: '12px',
              color: 'var(--rose-500)',
              overflowX: 'auto'
            }}
          >
            {this.state.error?.toString()}
          </div>

          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              alignSelf: 'flex-start',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--emerald-600)',
              color: '#FFFFFF',
              border: 'none',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Réessayer
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
