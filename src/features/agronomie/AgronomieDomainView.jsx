// @ts-check
import React from 'react';
import { UiBadge } from '../../shared/components/UiBadge';

export function AgronomieDomainView({ activeFarm }) {
  const stations = [
    { id: 'ST-01', nom: 'Station D\'Irrigation Souss 1', debit: '42 m³/h', pression: '2.8 Bar', secteur: 'Bloc A1 - A4', status: 'En Irrigation', variant: 'emerald' },
    { id: 'ST-02', nom: 'Station D\'Irrigation Souss 2', debit: '38 m³/h', pression: '3.1 Bar', secteur: 'Bloc B1 - B6', status: 'Automatique Standby', variant: 'neutral' },
    { id: 'ST-03', nom: 'Station Fertilisation Loukkos', debit: '18 m³/h', pression: '2.5 Bar', secteur: 'Bloc C2', status: 'Fertigation Active', variant: 'emerald' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <div style={{ backgroundColor: 'var(--bg-card)', padding: '18px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Température Extérieure</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-main)', marginTop: '4px' }}>24.5 °C</div>
          <span style={{ fontSize: '11px', color: 'var(--emerald-600)', fontWeight: '600' }}>API Meteoblue sync</span>
        </div>
        <div style={{ backgroundColor: 'var(--bg-card)', padding: '18px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Hygrométrie Serre</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--emerald-600)', marginTop: '4px' }}>68 %</div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Plage idéale: 60-75%</span>
        </div>
        <div style={{ backgroundColor: 'var(--bg-card)', padding: '18px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Volume D'Eau Appliqué</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-main)', marginTop: '4px' }}>340 m³</div>
          <span style={{ fontSize: '11px', color: 'var(--emerald-600)', fontWeight: '600' }}>Recommandation IA conforme</span>
        </div>
      </div>

      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Stations D'Irrigation & Pilotage Automatique</h4>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>ID Station</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Nom Station</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Débit / Pression</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Secteur Actif</th>
              <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Opérationnel</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((st, idx) => (
              <tr key={st.id} style={{ borderBottom: idx === stations.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{st.id}</td>
                <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{st.nom}</td>
                <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{st.debit} ({st.pression})</td>
                <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{st.secteur}</td>
                <td style={{ padding: '14px 20px' }}>
                  <UiBadge variant={st.variant}>{st.status}</UiBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
