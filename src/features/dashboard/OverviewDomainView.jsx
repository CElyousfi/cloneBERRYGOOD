// @ts-check
import React from 'react';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { UiTaskChecklist } from '../../shared/components/UiTaskChecklist';
import { UiChart } from '../../shared/components/UiChart';
import { UiActivityFeed } from '../../shared/components/UiActivityFeed';

/**
 * Main Overview Dashboard directly matching the uploaded Bonsai dashboard visual layout.
 * Displays top stat metrics row, main left content column (Tasks + Chart), and right Activity stream.
 */
export function OverviewDomainView({ activeFarm = 'Ferme 1 - Souss', onOpenNewModal }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Metrics Row — Bonsai style: 4 minimalist KPI stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Encaissements & Ventes"
          value="460,00 MAD"
          subtext="vs quinzaine préc."
          trend="+14.2%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Total des encaissements sur la quinzaine active"
        />
        <UiStatCard
          label="Factures Fournisseurs (Overdue)"
          value="0,00 MAD"
          subtext="0 factures en retard"
          trend="-100%"
          highlightColor="var(--text-main)"
          infoTooltip="Montant des factures validées en attente de paiement"
        />
        <UiStatCard
          label="Indice Qualité Compliant"
          value="96.4 %"
          subtext="Seuil Brix conforme > 8.0°B"
          trend="+2.1%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Pourcentage des lots de récolte conformes aux exigences qualité"
        />
        <UiStatCard
          label="Masse Salariale / Paie"
          value="184,200 MAD"
          subtext="342 ouvriers pointés"
          trend="+5.4%"
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
          <UiTaskChecklist />

          {/* Time Tracked & Yield Chart Card */}
          <UiChart title="Volume Récolté & Rendement Journalier" />
        </div>

        {/* Right Column (Bonsai Activity Stream) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <UiActivityFeed />
        </div>
      </div>
    </div>
  );
}
