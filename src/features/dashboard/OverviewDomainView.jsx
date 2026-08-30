// @ts-check
import React from 'react';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { UiTaskChecklist } from '../../shared/components/UiTaskChecklist';
import { UiChart } from '../../shared/components/UiChart';
import { UiActivityFeed } from '../../shared/components/UiActivityFeed';

export function OverviewDomainView({ activeFarm = 'Ferme 1 - Souss', data = {}, onOpenNewModal }) {
  const invoices = data.invoices || [];
  const caisse = data.caisse_transactions || [];
  const inspections = data.inspections || [];
  const pointages = data.ojra_payroll || [];

  // Dynamic Aggregations (0 when empty)
  const totalSales = caisse.filter(c => c.type === 'recette').reduce((acc, c) => acc + (parseFloat(c.montant) || 0), 0);
  const overdueInvoices = invoices.filter(i => i.payment_status === 'en_validation' || i.payment_status === 'non_payee').reduce((acc, i) => acc + (parseFloat(i.montant_ttc) || 0), 0);
  const conformeInspections = inspections.filter(i => i.statut_conformite === 'conforme').length;
  const qualityRate = inspections.length > 0 ? Math.round((conformeInspections / inspections.length) * 100 * 10) / 10 : 0;
  const totalPayroll = pointages.reduce((acc, p) => acc + (parseFloat(p.net_a_payer) || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Metrics Row — Bonsai style: 4 minimalist KPI stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Encaissements & Ventes"
          value={`${totalSales.toLocaleString('fr-FR')} MAD`}
          subtext="Base de données active"
          trend="0.0%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Total des encaissements recalculé en direct"
        />
        <UiStatCard
          label="Factures Fournisseurs (En Attente)"
          value={`${overdueInvoices.toLocaleString('fr-FR')} MAD`}
          subtext={`${invoices.length} factures en base`}
          trend="0.0%"
          highlightColor="var(--text-main)"
          infoTooltip="Montant des factures en attente de paiement"
        />
        <UiStatCard
          label="Indice Qualité Compliant"
          value={`${qualityRate} %`}
          subtext="Seuil Brix conforme > 8.0°B"
          trend="0.0%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Pourcentage des lots de récolte conformes"
        />
        <UiStatCard
          label="Masse Salariale / Paie"
          value={`${totalPayroll.toLocaleString('fr-FR')} MAD`}
          subtext={`${pointages.length} ouvriers pointés`}
          trend="0.0%"
          highlightColor="var(--berry-600)"
          infoTooltip="Montant global de la paie quinzaine active"
        />
      </div>

      {/* Main Grid: Left Column (Tasks + Chart) and Right Column (Activity Stream) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 340px',
          gap: '24px',
          alignItems: 'start'
        }}
      >
        {/* Left Column (Main Work Cards) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Upcoming & Overdue Tasks Card */}
          <UiTaskChecklist initialTasks={[]} />

          {/* Time Tracked & Yield Chart Card */}
          <UiChart title="Volume Récolté & Rendement Journalier" />
        </div>

        {/* Right Column (Bonsai Activity Stream) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <UiActivityFeed activities={[]} />
        </div>
      </div>
    </div>
  );
}
