// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';
import { defaultAppData } from '../../shared/utils/appDataMock.js';
import {
  FinDashboardTab,
  FinCATab,
  FinOjraTab,
  FinTresorerieTab,
  FinLiquidationsTab,
  FinCodesAnalytiquesTab,
  FinVirementsTab,
  SecurityRegistreTab
} from './index.jsx';

/**
 * Clean & Modular Finance Domain View.
 * Displays top KPI cards, sub-tab navigation, and safe error-bounded extracted sub-components.
 */
export function FinanceDomainView({ activeFarm, data = defaultAppData }) {
  const [activeSubTab, setActiveSubTab] = useState('workflow');

  const safeData = data || defaultAppData;

  const subTabs = [
    { id: 'workflow', label: 'Workflow Factures', icon: 'fa-file-invoice-dollar' },
    { id: 'caisse', label: 'Trésorerie & Caisse', icon: 'fa-vault' },
    { id: 'ojra', label: 'Paie & Charges OJRA', icon: 'fa-calculator' },
    { id: 'liquidations', label: 'Liquidations Export', icon: 'fa-chart-pie' },
    { id: 'virements', label: 'Virements Bancaires', icon: 'fa-building-columns' },
    { id: 'codes_analytiques', label: 'Codes Analytiques', icon: 'fa-tags' },
    { id: 'security', label: 'Sécurité & Audit BSNL', icon: 'fa-shield-halved' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Financial KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Chiffre d'Affaires Total"
          value="460,000 MAD"
          subtext="Campagne 2025/2026"
          trend="+12.4%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Somme CA Export + CA Local"
        />
        <UiStatCard
          label="Solde Caisse & Trésorerie"
          value="18,450 MAD"
          subtext="Compte principal Souss"
          trend="+3.1%"
          highlightColor="var(--indigo-600)"
          infoTooltip="Solde caisse disponible en temps réel"
        />
        <UiStatCard
          label="Charges Salariales OJRA"
          value="184,200 MAD"
          subtext="Quinzaine 16"
          trend="+4.8%"
          highlightColor="var(--berry-600)"
          infoTooltip="Masse salariale brute + charges sociales"
        />
        <UiStatCard
          label="Résultat Avant Impôt (EBE)"
          value="240,000 MAD"
          subtext="EBE global estimé"
          trend="+8.9%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Excédent Brut d'Exploitation"
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
        {activeSubTab === 'workflow' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>Pipeline Factures Fournisseurs</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Workflow: Non Payée → Validée Achats → Validée Finance → Validée DG → Payée</p>
                </div>
                <UiBadge variant="emerald">Postgres Dual-Write Active</UiBadge>
              </div>
            </div>
            <ErrorBoundary domainName="Finance Dashboard">
              {typeof FinDashboardTab === 'function' && <FinDashboardTab data={safeData} />}
            </ErrorBoundary>
          </div>
        )}

        {activeSubTab === 'caisse' && (
          <ErrorBoundary domainName="Trésorerie & Caisse">
            {typeof FinTresorerieTab === 'function' && <FinTresorerieTab data={safeData} />}
          </ErrorBoundary>
        )}

        {activeSubTab === 'ojra' && (
          <ErrorBoundary domainName="Paie & Charges OJRA">
            {typeof FinOjraTab === 'function' && <FinOjraTab data={safeData} />}
          </ErrorBoundary>
        )}

        {activeSubTab === 'liquidations' && (
          <ErrorBoundary domainName="Liquidations Export">
            {typeof FinLiquidationsTab === 'function' && <FinLiquidationsTab data={safeData} />}
          </ErrorBoundary>
        )}

        {activeSubTab === 'virements' && (
          <ErrorBoundary domainName="Virements Bancaires">
            {typeof FinVirementsTab === 'function' && <FinVirementsTab data={safeData} />}
          </ErrorBoundary>
        )}

        {activeSubTab === 'codes_analytiques' && (
          <ErrorBoundary domainName="Codes Analytiques">
            {typeof FinCodesAnalytiquesTab === 'function' && <FinCodesAnalytiquesTab data={safeData} />}
          </ErrorBoundary>
        )}

        {activeSubTab === 'security' && (
          <ErrorBoundary domainName="Sécurité & Registre">
            {typeof SecurityRegistreTab === 'function' && <SecurityRegistreTab data={safeData} />}
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
