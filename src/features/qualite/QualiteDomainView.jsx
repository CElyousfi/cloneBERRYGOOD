// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
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
 * Full Qualité Domain View with 100% sub-tab coverage & safe default data injection.
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', animation: 'fadeIn 0.2s ease-in-out' }}>
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

      {/* Sub-Tab Content rendering extracted domain components */}
      <div style={{ minHeight: '400px' }}>
        {activeSubTab === 'dashboard' && typeof QualiteDashboardTab === 'function' && <QualiteDashboardTab data={safeData} />}
        {activeSubTab === 'inspections' && typeof QualiteInspectionsTab === 'function' && <QualiteInspectionsTab data={safeData} />}
        {activeSubTab === 'brix' && typeof QualiteBrixTab === 'function' && <QualiteBrixTab data={safeData} />}
        {activeSubTab === 'bons_apport' && typeof QualiteBonsApportTab === 'function' && <QualiteBonsApportTab data={safeData} />}
        {activeSubTab === 'pfq' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {typeof QualitePFQInterneTab === 'function' && <QualitePFQInterneTab data={safeData} />}
            {typeof QualiteSuiviCalibreTab === 'function' && <QualiteSuiviCalibreTab data={safeData} />}
          </div>
        )}
        {activeSubTab === 'expeditions' && typeof QualiteExpeditionsTab === 'function' && <QualiteExpeditionsTab data={safeData} />}
        {activeSubTab === 'ecarts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {typeof QualiteEcartsTab === 'function' && <QualiteEcartsTab data={safeData} />}
            {typeof QualiteLiquidationsTab === 'function' && <QualiteLiquidationsTab data={safeData} />}
          </div>
        )}
        {activeSubTab === 'historique' && typeof QualiteHistoriqueTab === 'function' && <QualiteHistoriqueTab data={safeData} />}
      </div>
    </div>
  );
}
