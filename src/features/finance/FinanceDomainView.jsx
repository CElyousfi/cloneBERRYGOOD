// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiButton } from '../../shared/components/UiBadge';

/**
 * Modular Finance Domain View.
 * Displays Invoice Workflow Pipeline, Caisse Running Balance, Liquidation Summary,
 * and Dual-Write Postgres Migration Status.
 */
export function FinanceDomainView({ activeFarm }) {
  const [activeTab, setActiveTab] = useState('invoices');

  const [invoices, setInvoices] = useState([
    {
      id: 'INV-2026-001',
      fournisseur: 'Agro Chem Maghreb',
      montantTtc: '45,200.00 MAD',
      ferme: 'Ferme 1 - Souss',
      date: '24 Fév 2026',
      status: 'validee_finance',
      statusLabel: 'Validée Finance',
      badgeVariant: 'amber'
    },
    {
      id: 'INV-2026-002',
      fournisseur: 'Plastiques du Sud SA',
      montantTtc: '18,750.00 MAD',
      ferme: 'Ferme 2 - Loukkos',
      date: '25 Fév 2026',
      status: 'validee_achats',
      statusLabel: 'Validée Achats',
      badgeVariant: 'indigo'
    },
    {
      id: 'INV-2026-003',
      fournisseur: 'Irrigation Maroc SARL',
      montantTtc: '89,400.00 MAD',
      ferme: 'Ferme 1 - Souss',
      date: '22 Fév 2026',
      status: 'payee',
      statusLabel: 'Payée',
      badgeVariant: 'emerald'
    },
    {
      id: 'INV-2026-004',
      fournisseur: 'Transport Express Maroc',
      montantTtc: '12,300.00 MAD',
      ferme: 'Ferme 1 - Souss',
      date: '26 Fév 2026',
      status: 'en_validation',
      statusLabel: 'En Validation',
      badgeVariant: 'neutral'
    }
  ]);

  const caisseTransactions = [
    { id: 'TR-101', date: '26 Fév', type: 'Recette', label: 'Vente Marché Local Caisses', montant: '+ 8,500 MAD', solde: '42,100 MAD' },
    { id: 'TR-102', date: '25 Fév', type: 'Dépense', label: 'Achat Gasoil Tracteur #4', montant: '- 1,200 MAD', solde: '33,600 MAD' },
    { id: 'TR-103', date: '24 Fév', type: 'Dépense', label: 'Avance Caisse Chantiers', montant: '- 3,500 MAD', solde: '34,800 MAD' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Banner: Dual-Write & Postgres Status */}
      <div
        style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--emerald-50)',
              color: 'var(--emerald-600)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px'
            }}
          >
            <i className="fa-solid fa-database"></i>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Statut Migration Postgres (Finance)</h4>
              <UiBadge variant="emerald">Postgres Dual-Write Actif</UiBadge>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              11 Tables dans le schéma <code style={{ color: 'var(--emerald-700)', fontWeight: '700' }}>finance.*</code> · Adaptateur repository isolé & tests unitaires validés.
            </p>
          </div>
        </div>

        <button
          onClick={() => alert('Mode Dual-Write activé: Les factures et liquidations sont synchronisées en temps réel.')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-subtle)',
            border: '1px solid var(--border-color)',
            fontSize: '12px',
            fontWeight: '600',
            color: 'var(--text-main)',
            cursor: 'pointer'
          }}
        >
          Inspecter RLS Policies
        </button>
      </div>

      {/* Tabs Row */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
        {[
          { id: 'invoices', label: 'Workflow Factures', icon: 'fa-file-invoice' },
          { id: 'caisse', label: 'Gestion Caisse', icon: 'fa-vault' },
          { id: 'liquidations', label: 'Liquidations Expor', icon: 'fa-chart-column' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
              fontWeight: activeTab === t.id ? '700' : '500',
              backgroundColor: activeTab === t.id ? 'var(--emerald-600)' : 'transparent',
              color: activeTab === t.id ? '#FFFFFF' : 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all var(--transition-fast)'
            }}
          >
            <i className={`fa-solid ${t.icon}`}></i>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content: Invoices Table */}
      {activeTab === 'invoices' && (
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
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Pipeline de Validation Factures</h4>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Workflow: Non payée → Achats → Finance → DG → Payée</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>N° Facture</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Fournisseur</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Exploitation</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant TTC</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Workflow</th>
                <th style={{ padding: '12px 20px', fontWeight: '600', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, idx) => (
                <tr key={inv.id} style={{ borderBottom: idx === invoices.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{inv.id}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-main)', fontWeight: '600' }}>{inv.fournisseur}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{inv.ferme}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{inv.montantTtc}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <UiBadge variant={inv.badgeVariant}>{inv.statusLabel}</UiBadge>
                  </td>
                  <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                    <button
                      onClick={() => alert(`Validation Facture ${inv.id} par la Finance`)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--emerald-50)',
                        color: 'var(--emerald-700)',
                        border: '1px solid var(--emerald-100)',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Valider
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab Content: Caisse */}
      {activeTab === 'caisse' && (
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Solde Actuel Caisse</h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Mouvements récents & justificatifs d'alimentation</p>
            </div>
            <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--emerald-600)', fontFamily: 'var(--font-display)' }}>
              42,100.00 MAD
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {caisseTransactions.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)' }}>
                <div>
                  <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>{t.label}</strong>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{t.date} · {t.id}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: t.type === 'Recette' ? 'var(--emerald-600)' : 'var(--rose-500)' }}>
                    {t.montant}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Solde: {t.solde}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
