// @ts-check
import React from 'react';
import { UiBadge } from '../../shared/components/UiBadge';

export function AchatsDomainView({ activeFarm }) {
  const bdcs = [
    { id: 'BDC-8920', fournisseur: 'Agro Chimique SA', produit: 'Engrais Soluble NPK 20-20-20', montant: '34,500 MAD', status: 'Validé DG', variant: 'emerald' },
    { id: 'BDC-8921', fournisseur: 'Plastiques Emballage SARL', produit: 'Barquettes PET 250g', montant: '18,200 MAD', status: 'En Attente Achats', variant: 'amber' },
    { id: 'BDC-8922', fournisseur: 'Irrigation Modern Maroc', produit: 'Goutte-à-goutte 1.6L/h', montant: '52,000 MAD', status: 'Payé', variant: 'emerald' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      <div style={{ backgroundColor: 'var(--bg-card)', padding: '20px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
        <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '4px' }}>Bons de Commande & Achats (BDC)</h4>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Workflow BDC: Brouillon → Chef → Achats → DG → Commandé</p>
      </div>

      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>N° BDC</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Fournisseur</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Produit / Service</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant Total</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Validation</th>
            </tr>
          </thead>
          <tbody>
            {bdcs.map((b, idx) => (
              <tr key={b.id} style={{ borderBottom: idx === bdcs.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{b.id}</td>
                <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{b.fournisseur}</td>
                <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{b.produit}</td>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{b.montant}</td>
                <td style={{ padding: '14px 20px' }}>
                  <UiBadge variant={b.variant}>{b.status}</UiBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
