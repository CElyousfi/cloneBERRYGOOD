// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';

/**
 * Modular Qualité Domain View.
 * Renders quality inspection results, Brix compliance tracker, defect rate metrics, and export expeditions.
 */
export function QualiteDomainView({ activeFarm }) {
  const [inspections] = useState([
    { id: 'INSP-401', lot: 'Lot Fraise Star B4', date: '26 Fév 2026', inspecteur: 'K. Reda', brix: '9.4°B', defectRate: '1.2%', status: 'Conforme (Cat A)', variant: 'emerald' },
    { id: 'INSP-402', lot: 'Lot Framboise Diamond A2', date: '25 Fév 2026', inspecteur: 'M. Alami', brix: '8.8°B', defectRate: '2.5%', status: 'Conforme (Cat A)', variant: 'emerald' },
    { id: 'INSP-403', lot: 'Lot Myrtille Blue C1', date: '24 Fév 2026', inspecteur: 'K. Reda', brix: '7.9°B', defectRate: '4.8%', status: 'Attention (Cat B)', variant: 'amber' },
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Stat Summary Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <div style={{ backgroundColor: 'var(--bg-card)', padding: '18px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Taux de Défaut Moyen</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--emerald-600)', marginTop: '4px' }}>1.8 %</div>
          <span style={{ fontSize: '11px', color: 'var(--emerald-600)', fontWeight: '600' }}>-0.4% vs objectif</span>
        </div>
        <div style={{ backgroundColor: 'var(--bg-card)', padding: '18px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Brix Moyen Récolte</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-main)', marginTop: '4px' }}>8.90 °B</div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Seuil min: 8.0°B</span>
        </div>
        <div style={{ backgroundColor: 'var(--bg-card)', padding: '18px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Inspections Réalisées</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-main)', marginTop: '4px' }}>48 Lots</div>
          <span style={{ fontSize: '11px', color: 'var(--emerald-600)', fontWeight: '600' }}>100% contrôlés</span>
        </div>
      </div>

      {/* Inspections Table */}
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
          <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Dernières Inspections Qualité</h4>
          <UiBadge variant="emerald">Postgres schema `qualite.*` prêt</UiBadge>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>ID Control</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Lot / Variété</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Inspecteur</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Brix (°B)</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Taux Défaut</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Classification</th>
            </tr>
          </thead>
          <tbody>
            {inspections.map((item, idx) => (
              <tr key={item.id} style={{ borderBottom: idx === inspections.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{item.id}</td>
                <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{item.lot}</td>
                <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{item.inspecteur}</td>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{item.brix}</td>
                <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{item.defectRate}</td>
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
