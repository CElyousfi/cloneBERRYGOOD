// @ts-check
import React from 'react';
import { UiBadge } from '../../shared/components/UiBadge';

export function DgDomainView({ activeFarm }) {
  const auditLogs = [
    { id: 'LOG-901', action: 'Validation Finale Facture', user: 'M. Lazrak (DG)', detail: 'Facture #INV-2026-001 (45,200.00 MAD)', time: '26 Fév 14:00' },
    { id: 'LOG-902', action: 'Exportation Rapport Quinzaine', user: 'Finance Admin', detail: 'Quinzaine 16 - Souss & Loukkos', time: '26 Fév 11:30' },
    { id: 'LOG-903', action: 'Modification Code Analytique', user: 'Chef Comptable', detail: 'Code #ANA-402 activé pour Campagne 2026', time: '25 Fév 17:45' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      <div style={{ backgroundColor: 'var(--bg-card)', padding: '24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
        <h3 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-main)', fontFamily: 'var(--font-display)', marginBottom: '8px' }}>
          Synthèse Exécutive Direction Générale
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Contrôle global des opérations, budget campagne, sécurité BSNL, et audit système.
        </p>
      </div>

      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Audit Log & Sécurité BSNL</h4>
          <UiBadge variant="emerald">Système Intègre</UiBadge>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Event Log</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Action Exécutée</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Utilisateur</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Détails</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Horodatage</th>
            </tr>
          </thead>
          <tbody>
            {auditLogs.map((log, idx) => (
              <tr key={log.id} style={{ borderBottom: idx === auditLogs.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{log.id}</td>
                <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{log.action}</td>
                <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{log.user}</td>
                <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{log.detail}</td>
                <td style={{ padding: '14px 20px', color: 'var(--text-muted)' }}>{log.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
