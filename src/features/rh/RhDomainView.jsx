// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';
import { defaultAppData } from '../../shared/utils/appDataMock.js';
import {
  PointageTab,
  PaieTab,
  PrimesRecolteTab,
  HeuresSupSub,
  CoutRecolteTab,
  SousTraitantsConfigPanel,
  JoursFeriesConfigPanel,
  ParametresTab
} from './index.jsx';

/**
 * Clean & Modular RH Domain View.
 * Displays top RH KPI cards, sub-tab navigation, and safe error-bounded extracted sub-components.
 */
export function RhDomainView({ activeFarm, data = defaultAppData }) {
  const [activeSubTab, setActiveSubTab] = useState('pointage');

  const safeData = data || defaultAppData;

  const subTabs = [
    { id: 'pointage', label: 'Pointage Ouvriers', icon: 'fa-user-check' },
    { id: 'paie', label: 'Paie & Bulletins OJRA', icon: 'fa-file-invoice-dollar' },
    { id: 'primes', label: 'Primes de Récolte', icon: 'fa-award' },
    { id: 'heures_sup', label: 'Heures Sup. (HS)', icon: 'fa-clock' },
    { id: 'cout_recolte', label: 'Coût Récolte / kg', icon: 'fa-chart-pie' },
    { id: 'transport', label: 'Transport & Prestataires', icon: 'fa-bus' },
    { id: 'parametres', label: 'Jours Fériés & Barèmes', icon: 'fa-gears' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top RH KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Effectif Pointé Auj."
          value="342 ouvriers"
          subtext="Taux présence 98.2%"
          trend="+4.1%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Nombre total d'ouvriers enregistrés au pointage matin"
        />
        <UiStatCard
          label="Masse Salariale Brute"
          value="184,200 MAD"
          subtext="Quinzaine 16"
          trend="+5.4%"
          highlightColor="var(--berry-600)"
          infoTooltip="Montant total de la paie quinzaine"
        />
        <UiStatCard
          label="Coût Moyen Récolte"
          value="1.85 DH / kg"
          subtext="Rendement 12.5 kg/h"
          trend="-0.12 DH"
          highlightColor="var(--emerald-600)"
          infoTooltip="Coût direct de récolte par kg cueilli"
        />
        <UiStatCard
          label="Prestataires & Transport"
          value="24,500 MAD"
          subtext="4 navettes quotidiennes"
          trend="0.0%"
          highlightColor="var(--indigo-600)"
          infoTooltip="Remboursement transport & sous-traitants"
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
        {activeSubTab === 'pointage' && (
          <ErrorBoundary domainName="Pointage Ouvriers">
            {typeof PointageTab === 'function' && <PointageTab data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'paie' && (
          <ErrorBoundary domainName="Paie OJRA">
            {typeof PaieTab === 'function' && <PaieTab data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'primes' && (
          <ErrorBoundary domainName="Primes Récolte">
            {typeof PrimesRecolteTab === 'function' && <PrimesRecolteTab data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'heures_sup' && (
          <ErrorBoundary domainName="Heures Sup.">
            {typeof HeuresSupSub === 'function' && <HeuresSupSub data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'cout_recolte' && (
          <ErrorBoundary domainName="Coût Récolte">
            {typeof CoutRecolteTab === 'function' && <CoutRecolteTab data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'transport' && (
          <ErrorBoundary domainName="Transport & Prestataires">
            {typeof SousTraitantsConfigPanel === 'function' && <SousTraitantsConfigPanel data={safeData} />}
          </ErrorBoundary>
        )}
        {activeSubTab === 'parametres' && (
          <ErrorBoundary domainName="Paramètres RH">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {typeof JoursFeriesConfigPanel === 'function' && <JoursFeriesConfigPanel data={safeData} />}
              {typeof ParametresTab === 'function' && <ParametresTab data={safeData} />}
            </div>
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
