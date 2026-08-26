// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
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
 * Full RH Domain View with 100% sub-tab coverage & safe default data injection.
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
        {activeSubTab === 'pointage' && typeof PointageTab === 'function' && <PointageTab data={safeData} />}
        {activeSubTab === 'paie' && typeof PaieTab === 'function' && <PaieTab data={safeData} />}
        {activeSubTab === 'primes' && typeof PrimesRecolteTab === 'function' && <PrimesRecolteTab data={safeData} />}
        {activeSubTab === 'heures_sup' && typeof HeuresSupSub === 'function' && <HeuresSupSub data={safeData} />}
        {activeSubTab === 'cout_recolte' && typeof CoutRecolteTab === 'function' && <CoutRecolteTab data={safeData} />}
        {activeSubTab === 'transport' && typeof SousTraitantsConfigPanel === 'function' && <SousTraitantsConfigPanel data={safeData} />}
        {activeSubTab === 'parametres' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {typeof JoursFeriesConfigPanel === 'function' && <JoursFeriesConfigPanel data={safeData} />}
            {typeof ParametresTab === 'function' && <ParametresTab data={safeData} />}
          </div>
        )}
      </div>
    </div>
  );
}
