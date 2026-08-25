// @ts-check
import React, { useState } from 'react';
import { Sidebar } from './shared/layout/Sidebar';
import { TopHeader } from './shared/layout/TopHeader';
import { ErrorBoundary } from './shared/components/ErrorBoundary';

// Domain Feature Views
import { OverviewDomainView } from './features/dashboard/OverviewDomainView';
import { FinanceDomainView } from './features/finance/FinanceDomainView';
import { QualiteDomainView } from './features/qualite/QualiteDomainView';
import { RhDomainView } from './features/rh/RhDomainView';
import { AchatsDomainView } from './features/achats/AchatsDomainView';
import { StockDomainView } from './features/stock/StockDomainView';
import { AgronomieDomainView } from './features/agronomie/AgronomieDomainView';
import { DgDomainView } from './features/dg/DgDomainView';

// CSS Theme System
import './shared/styles/theme.css';

/**
 * Main Application Component for Smart BERRY Modular Web Application.
 * Manages active domain state, active farm filter, theme mode, and global quick creation modal.
 */
export function App() {
  const [activeDomain, setActiveDomain] = useState('dashboard');
  const [activeFarm, setActiveFarm] = useState('Ferme 1 - Souss');
  const [showNewModal, setShowNewModal] = useState(false);
  const [newDocumentType, setNewDocumentType] = useState('facture');
  const [documentNotes, setDocumentNotes] = useState('');

  const domainTitles = {
    dashboard: 'Tableau de bord Général',
    finance: 'Finances & Caisse',
    qualite: 'Qualité & Contrôle Brix',
    rh: 'Ressources Humaines & Paie',
    achats: 'Achats & Commandes (BDC)',
    stock: 'Stock & Magasinier',
    agronomie: 'Agronomie & Stationnaire',
    recolte: 'Suivi Récolte & Coûts',
    dg: 'Direction Générale & Audits'
  };

  const handleCreateDocument = (e) => {
    e.preventDefault();
    alert(`Nouveau document [${newDocumentType.toUpperCase()}] créé avec succès pour ${activeFarm}!`);
    setShowNewModal(false);
    setDocumentNotes('');
  };

  const renderActiveDomainView = () => {
    switch (activeDomain) {
      case 'dashboard':
        return (
          <ErrorBoundary domainName="Tableau de bord">
            <OverviewDomainView activeFarm={activeFarm} onOpenNewModal={() => setShowNewModal(true)} />
          </ErrorBoundary>
        );
      case 'finance':
        return (
          <ErrorBoundary domainName="Finances & Caisse">
            <FinanceDomainView activeFarm={activeFarm} />
          </ErrorBoundary>
        );
      case 'qualite':
        return (
          <ErrorBoundary domainName="Qualité & Brix">
            <QualiteDomainView activeFarm={activeFarm} />
          </ErrorBoundary>
        );
      case 'rh':
        return (
          <ErrorBoundary domainName="RH & Paie">
            <RhDomainView activeFarm={activeFarm} />
          </ErrorBoundary>
        );
      case 'achats':
        return (
          <ErrorBoundary domainName="Achats & Commandes">
            <AchatsDomainView activeFarm={activeFarm} />
          </ErrorBoundary>
        );
      case 'stock':
        return (
          <ErrorBoundary domainName="Stock & Magasinier">
            <StockDomainView activeFarm={activeFarm} />
          </ErrorBoundary>
        );
      case 'agronomie':
        return (
          <ErrorBoundary domainName="Agronomie & Météo">
            <AgronomieDomainView activeFarm={activeFarm} />
          </ErrorBoundary>
        );
      case 'recolte':
        return (
          <ErrorBoundary domainName="Récolte & Rendement">
            <OverviewDomainView activeFarm={activeFarm} onOpenNewModal={() => setShowNewModal(true)} />
          </ErrorBoundary>
        );
      case 'dg':
        return (
          <ErrorBoundary domainName="Direction & Audit">
            <DgDomainView activeFarm={activeFarm} />
          </ErrorBoundary>
        );
      default:
        return (
          <ErrorBoundary domainName="Tableau de bord">
            <OverviewDomainView activeFarm={activeFarm} onOpenNewModal={() => setShowNewModal(true)} />
          </ErrorBoundary>
        );
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-app)' }}>
      {/* Left Sidebar Navigation (Bonsai Style) */}
      <Sidebar
        activeDomain={activeDomain}
        onSelectDomain={setActiveDomain}
        activeFarm={activeFarm}
        onSelectFarm={setActiveFarm}
      />

      {/* Main Workspace Layout */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top Header Bar */}
        <TopHeader
          activeDomainTitle={domainTitles[activeDomain] || 'Smart BERRY'}
          activeFarm={activeFarm}
          onOpenNewModal={() => setShowNewModal(true)}
        />

        {/* Main Viewport Content Container */}
        <main style={{ padding: '28px 32px', flex: 1 }}>
          {renderActiveDomainView()}
        </main>
      </div>

      {/* Quick Action Modal ("+ Nouveau") */}
      {showNewModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.4)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.15s ease-out'
          }}
          onClick={() => setShowNewModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--bg-card)',
              borderRadius: 'var(--radius-xl)',
              width: '100%',
              maxWidth: '480px',
              padding: '28px',
              boxShadow: 'var(--shadow-modal)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700', fontFamily: 'var(--font-display)', color: 'var(--text-main)' }}>
                Créer un Nouveau Document
              </h3>
              <button
                onClick={() => setShowNewModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '16px', cursor: 'pointer' }}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleCreateDocument} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>Type de Document</label>
                <select
                  value={newDocumentType}
                  onChange={(e) => setNewDocumentType(e.target.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                >
                  <option value="facture">Facture Fournisseur</option>
                  <option value="bdc">Bon de Commande (BDC)</option>
                  <option value="inspection">Rapport d'Inspection Qualité</option>
                  <option value="pointage">Pointage Ouvriers Exceptionnel</option>
                  <option value="caisse">Alimentation / Sortie Caisse</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>Notes & Description</label>
                <textarea
                  rows={3}
                  placeholder="Saisissez les détails du document..."
                  value={documentNotes}
                  onChange={(e) => setDocumentNotes(e.target.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '13px',
                    outline: 'none',
                    resize: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-subtle)',
                    border: '1px solid var(--border-color)',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '9px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--emerald-600)',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-xs)'
                  }}
                >
                  Créer Document
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
