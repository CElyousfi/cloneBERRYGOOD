// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
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
 * Full Finance Domain View with 100% sub-tab coverage.
 * Features:
 *  - Workflow Factures & Validation Pipeline
 *  - Gestion Caisse & Trésorerie
 *  - Paie & Charges Sociales (OJRA)
 *  - Liquidations Finance
 *  - Codes Analytiques
 *  - Virements Bancaires
 *  - Sécurité & Registre BSNL
 */
export function FinanceDomainView({ activeFarm }) {
  const [activeSubTab, setActiveSubTab] = useState('workflow');

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
        {activeSubTab === 'workflow' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>Pipeline Factures & Validation Multi-Niveau</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Workflow: Non Payée → Validée Achats → Validée Finance → Validée DG → Payée</p>
                </div>
                <UiBadge variant="emerald">Postgres Dual-Write Connecté</UiBadge>
              </div>
            </div>
            {typeof FinDashboardTab === 'function' && <FinDashboardTab />}
          </div>
        )}

        {activeSubTab === 'caisse' && typeof FinTresorerieTab === 'function' && <FinTresorerieTab />}
        {activeSubTab === 'ojra' && typeof FinOjraTab === 'function' && <FinOjraTab />}
        {activeSubTab === 'liquidations' && typeof FinLiquidationsTab === 'function' && <FinLiquidationsTab />}
        {activeSubTab === 'virements' && typeof FinVirementsTab === 'function' && <FinVirementsTab />}
        {activeSubTab === 'codes_analytiques' && typeof FinCodesAnalytiquesTab === 'function' && <FinCodesAnalytiquesTab />}
        {activeSubTab === 'security' && typeof SecurityRegistreTab === 'function' && <SecurityRegistreTab />}
      </div>
    </div>
  );
}
