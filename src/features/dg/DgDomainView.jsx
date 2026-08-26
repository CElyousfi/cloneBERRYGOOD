// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';

export function DgDomainView({ activeFarm }) {
  const [activeTab, setActiveTab] = useState('audit');

  const auditLogs = [
    { id: 'LOG-901', action: 'Validation Finale Facture', user: 'M. Lazrak (DG)', detail: 'Facture #INV-2026-001 (45,200.00 MAD)', time: '26 Fév 14:00' },
    { id: 'LOG-902', action: 'Exportation Rapport Quinzaine', user: 'Finance Admin', detail: 'Quinzaine 16 - Souss & Loukkos', time: '26 Fév 11:30' },
    { id: 'LOG-903', action: 'Modification Code Analytique', user: 'Chef Comptable', detail: 'Code #ANA-402 activé pour Campagne 2026', time: '25 Fév 17:45' },
    { id: 'LOG-904', action: 'Validation Signature DG', user: 'M. Lazrak (DG)', detail: 'Tampon numérisé apposé sur BDC #8920', time: '25 Fév 14:20' }
  ];

  const budgetSummary = [
    { poste: 'Engrais & Produits Phytosanitaires', budget: '150,000 MAD', consomme: '124,500 MAD', solde: '25,500 MAD', status: 'Sous Budget', variant: 'emerald' },
    { poste: 'Main d\'oeuvre & Paie Ouvriers', budget: '450,000 MAD', consomme: '412,000 MAD', solde: '38,000 MAD', status: 'Sous Budget', variant: 'emerald' },
    { poste: 'Transport & Logistique Export', budget: '80,000 MAD', consomme: '74,500 MAD', solde: '5,500 MAD', status: 'Sous Budget', variant: 'emerald' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top DG KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Marge Brute Global"
          value="48.5 %"
          subtext="Objectif DG > 45%"
          trend="+3.1%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Marge brute consolidée sur l'ensemble des fermes"
        />
        <UiStatCard
          label="Suivi Budget vs Réel"
          value="87.4 %"
          subtext="Budget consommé"
          trend="Économie 12.6%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Taux d'exécution du budget campagne"
        />
        <UiStatCard
          label="Score Adoption Utilisateurs"
          value="98.2 %"
          subtext="7/7 fermes connectées"
          trend="Score parfait"
          highlightColor="var(--indigo-600)"
          infoTooltip="Taux d'utilisation quotidienne par les équipes terrain"
        />
        <UiStatCard
          label="Taux Sécurité BSNL"
          value="100 %"
          subtext="Aucune alerte sécurité"
          trend="Système sécurisé"
          highlightColor="var(--emerald-600)"
          infoTooltip="Intégrité du registre et des signatures numériques"
        />
      </div>

      {/* Sub-Tab Navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <button
          onClick={() => setActiveTab('audit')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'audit' ? '700' : '500',
            backgroundColor: activeTab === 'audit' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'audit' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'audit' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-shield-halved" style={{ marginRight: '6px' }}></i>
          Audit Log & Sécurité BSNL
        </button>
        <button
          onClick={() => setActiveTab('budget')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'budget' ? '700' : '500',
            backgroundColor: activeTab === 'budget' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'budget' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'budget' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-chart-pie" style={{ marginRight: '6px' }}></i>
          Budget vs Réel Campagne
        </button>
      </div>

      {/* Content Table */}
      {activeTab === 'audit' ? (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Audit Log Systémique & Tampons Numériques</h4>
            <UiBadge variant="emerald">Registre Intègre (BSNL)</UiBadge>
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
      ) : (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Suivi Exécution Budget vs Réel</h4>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Poste de Dépense</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Budget Allocations</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Consommation Réelle</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Solde Disponible</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Exec</th>
              </tr>
            </thead>
            <tbody>
              {budgetSummary.map((b, idx) => (
                <tr key={b.poste} style={{ borderBottom: idx === budgetSummary.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{b.poste}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{b.budget}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{b.consomme}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{b.solde}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <UiBadge variant={b.variant}>{b.status}</UiBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
