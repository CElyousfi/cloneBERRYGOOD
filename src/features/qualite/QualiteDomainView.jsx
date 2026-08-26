// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';
import { defaultAppData } from '../../shared/utils/appDataMock.js';
import {
  QualiteDashboardTab,
  QualiteInspectionsTab,
  QualiteHistoriqueTab,
  QualiteBrixTab,
  QualiteBonsApportTab,
  QualitePFQInterneTab,
  QualiteSuiviCalibreTab,
  QualiteExpeditionsTab,
  QualiteLiquidationsTab,
  QualiteEcartsTab
} from './index.jsx';

/**
 * Clean & Modular Qualité Domain View.
 * Displays top quality KPI cards, sub-tab navigation, and safe error-bounded extracted sub-components.
 */
export function QualiteDomainView({ activeFarm, data = defaultAppData }) {
  const [activeSubTab, setActiveSubTab] = useState('dashboard');

  const safeData = data || defaultAppData;

  const subTabs = [
    { id: 'dashboard', label: 'Dashboard Qualité', icon: 'fa-chart-line' },
    { id: 'inspections', label: 'Inspections & Saisie', icon: 'fa-clipboard-check' },
    { id: 'brix', label: 'Suivi Taux Brix (°B)', icon: 'fa-droplet' },
    { id: 'bons_apport', label: 'Bons d\'Apport', icon: 'fa-file-signature' },
    { id: 'pfq', label: 'PFQ Interne & Calibres', icon: 'fa-sliders' },
    { id: 'expeditions', label: 'Expéditions Export', icon: 'fa-truck-fast' },
    { id: 'ecarts', label: 'Écarts & Liquidations', icon: 'fa-scale-balanced' },
    { id: 'historique', label: 'Historique Contrôles', icon: 'fa-clock-rotate-left' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Quality KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Lots Conformes (Cat A)"
          value="96.4 %"
          subtext="Objectif > 95%"
          trend="+2.1%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Taux d'inspection conforme aux exigences export"
        />
        <UiStatCard
          label="Moyenne Taux Brix"
          value="9.1 °B"
          subtext="Seuil min: 8.0°B"
          trend="+0.4"
          highlightColor="var(--emerald-600)"
          infoTooltip="Moyenne des réfractomètres sur la quinzaine"
        />
        <UiStatCard
          label="Expéditions en Transit"
          value="9,800 kg"
          subtext="2 conteneurs expédiés"
          trend="+12%"
          highlightColor="var(--indigo-600)"
          infoTooltip="Volume net expédié vers l'Union Européenne"
        />
        <UiStatCard
          label="Taux Écart / Déchets"
          value="1.4 %"
          subtext="Seuil toléré < 3.0%"
          trend="-0.5%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Pourcentage d'écart tri à l'emballage"
        />
      </div>

      {/* Sub-Tab Navigation Pills */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        {subTabs.map(tab => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                fontSize: '13px',
                fontWeight: isActive ? '700' : '500',
                backgroundColor: isActive ? 'var(--emerald-600)' : 'var(--bg-card)',
                color: isActive ? '#FFFFFF' : 'var(--text-secondary)',
                border: isActive ? 'none' : '1px solid var(--border-color)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all var(--transition-fast)',
                boxShadow: isActive ? 'var(--shadow-xs)' : 'none'
              }}
            >
              <i className={`fa-solid ${tab.icon}`}></i>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Sub-Tab Content rendering extracted domain components safely */}
      <div style={{ minHeight: '380px' }}>
        {activeSubTab === 'dashboard' && (
          <ErrorBoundary domainName="Qualité Dashboard">
            {typeof QualiteDashboardTab === 'function' && <QualiteDashboardTab data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'inspections' && (
          <ErrorBoundary domainName="Inspections & Saisie">
            {typeof QualiteInspectionsTab === 'function' && <QualiteInspectionsTab data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'brix' && (
          <ErrorBoundary domainName="Suivi Brix">
            {typeof QualiteBrixTab === 'function' && <QualiteBrixTab data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'bons_apport' && (
          <ErrorBoundary domainName="Bons d'Apport">
            {typeof QualiteBonsApportTab === 'function' && <QualiteBonsApportTab data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'pfq' && (
          <ErrorBoundary domainName="PFQ Interne & Calibres">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {typeof QualitePFQInterneTab === 'function' && <QualitePFQInterneTab data={safeData} />}
              {typeof QualiteSuiviCalibreTab === 'function' && <QualiteSuiviCalibreTab data={safeData} />}
            </div>
          </ErrorBoundary>
        )}
        {activeSubTab === 'expeditions' && (
          <ErrorBoundary domainName="Expéditions Export">
            {typeof QualiteExpeditionsTab === 'function' && <QualiteExpeditionsTab data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'ecarts' && (
          <ErrorBoundary domainName="Écarts & Liquidations">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {typeof QualiteEcartsTab === 'function' && <QualiteEcartsTab data={safeData} />}
              {typeof QualiteLiquidationsTab === 'function' && <QualiteLiquidationsTab data={safeData} />}
            </div>
          </ErrorBoundary>
        )}
        {activeSubTab === 'historique' && (
          <ErrorBoundary domainName="Historique Contrôles">
            {typeof QualiteHistoriqueTab === 'function' && <QualiteHistoriqueTab data={safeData} />}
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
