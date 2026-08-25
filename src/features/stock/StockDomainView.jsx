// @ts-check
import React from 'react';
import { UiBadge } from '../../shared/components/UiBadge';

export function StockDomainView({ activeFarm }) {
  const stockItems = [
    { id: 'STK-01', article: 'Caisses Plastique Récolte 5kg', quantite: '4,500 unités', minSeuil: '1,000', status: 'Optimal', variant: 'emerald' },
    { id: 'STK-02', article: 'Engrais NPK 20-20-20 (Sac 25kg)', quantite: '85 sacs', minSeuil: '100', status: 'Réapprovisionner', variant: 'amber' },
    { id: 'STK-03', article: 'Barquettes Clamshell 250g PET', quantite: '12,000 unités', minSeuil: '2,500', status: 'Optimal', variant: 'emerald' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      <div style={{ backgroundColor: 'var(--bg-card)', padding: '20px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
        <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '4px' }}>Magasinier & Soldes de Stock</h4>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Mouvements de stock sécurisés & contrôle d'inventaire</p>
      </div>

      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Ref Stock</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Article / Intitulé</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Quantité en Stock</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Seuil Alerte</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {stockItems.map((s, idx) => (
              <tr key={s.id} style={{ borderBottom: idx === stockItems.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{s.id}</td>
                <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{s.article}</td>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{s.quantite}</td>
                <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{s.minSeuil}</td>
                <td style={{ padding: '14px 20px' }}>
                  <UiBadge variant={s.variant}>{s.status}</UiBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
