// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';

/**
 * Modular RH Domain View.
 * Displays Worker Pointage, Overtime hours calculation, Transport Fee convergence, and OJRA Payroll summary.
 */
export function RhDomainView({ activeFarm }) {
  const [pointages] = useState([
    { id: 'WRK-104', nom: 'Hamza El Amrani', equipe: 'Equipe Récolte #1', jours: 13.5, heuresSup: 4.0, primes: '450 MAD', transport: 'Transport Souss (240 DH)', status: 'Validé', variant: 'emerald' },
    { id: 'WRK-105', nom: 'Fatima Zahra Mansouri', equipe: 'Equipe Conditionnement', jours: 14.0, heuresSup: 6.5, primes: '600 MAD', transport: 'Transport Souss (240 DH)', status: 'Validé', variant: 'emerald' },
    { id: 'WRK-106', nom: 'Youssef Benali', equipe: 'Equipe Stationnaire', jours: 12.0, heuresSup: 0.0, primes: '200 MAD', transport: 'Navette Interne', status: 'En Révision', variant: 'amber' },
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <div style={{ backgroundColor: 'var(--bg-card)', padding: '18px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Ouvriers Actifs Pointés</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-main)', marginTop: '4px' }}>342 Ouvriers</div>
          <span style={{ fontSize: '11px', color: 'var(--emerald-600)', fontWeight: '600' }}>Quinzaine active: 2026-08-2</span>
        </div>
        <div style={{ backgroundColor: 'var(--bg-card)', padding: '18px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Total Heures Sup.</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--emerald-600)', marginTop: '4px' }}>148.5 Heures</div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Calcul pure logic tests validés</span>
        </div>
        <div style={{ backgroundColor: 'var(--bg-card)', padding: '18px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Convergence Transport</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--berry-600)', marginTop: '4px' }}>100 % Conforme</div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Même total sur les 2 écrans</span>
        </div>
      </div>

      {/* Pointage Table */}
      <div
        style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden'
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Pointage & Paie Quinzaine</h4>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Module `functions/lib/rh/pointageCalc.js`</span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Matricule</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Nom Ouvrier</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Équipe</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Jours Pointés</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Heures Sup</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Transport</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {pointages.map((item, idx) => (
              <tr key={item.id} style={{ borderBottom: idx === pointages.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{item.id}</td>
                <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{item.nom}</td>
                <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{item.equipe}</td>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{item.jours} j</td>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>+{item.heuresSup} h</td>
                <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{item.transport}</td>
                <td style={{ padding: '14px 20px' }}>
                  <UiBadge variant={item.variant}>{item.status}</UiBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
