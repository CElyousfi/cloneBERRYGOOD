// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';

export function StockDomainView({ activeFarm }) {
  const [activeTab, setActiveTab] = useState('soldes');

  const stockItems = [
    { id: 'STK-01', article: 'Caisses Plastique Récolte 5kg', quantite: '4,500 unités', minSeuil: '1,000', valorisation: '67,500 MAD', status: 'Stock Optimal', variant: 'emerald' },
    { id: 'STK-02', article: 'Engrais NPK 20-20-20 (Sac 25kg)', quantite: '85 sacs', minSeuil: '100', valorisation: '25,500 MAD', status: 'Réapprovisionner', variant: 'amber' },
    { id: 'STK-03', article: 'Barquettes Clamshell 250g PET', quantite: '12,000 unités', minSeuil: '2,500', valorisation: '14,400 MAD', status: 'Stock Optimal', variant: 'emerald' },
    { id: 'STK-04', article: 'Film Plastique Paillage Noir 30µ', quantite: '42 rouleaux', minSeuil: '10', valorisation: '33,600 MAD', status: 'Stock Optimal', variant: 'emerald' },
  ];

  const receptionBons = [
    { id: 'BR-401', date: '2026-08-25', fournisseur: 'Agro Chimique SA', articles: 'Engrais NPK (40 sacs)', magasinier: 'H. Amrani', status: 'Conforme & Intégré', variant: 'emerald' },
    { id: 'BR-402', date: '2026-08-24', fournisseur: 'Plastiques Emballage', articles: 'Barquettes 250g (5,000u)', magasinier: 'H. Amrani', status: 'Conforme & Intégré', variant: 'emerald' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Stock KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Valorisation Stock Total"
          value="141,000 MAD"
          subtext="4 familles d'articles"
          trend="+3.2%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Valeur financière totale des stocks en magasin"
        />
        <UiStatCard
          label="Articles sous Seuil Alerte"
          value="1 article"
          subtext="Engrais NPK 20-20-20"
          trend="Réappro urgent"
          highlightColor="var(--amber-500)"
          infoTooltip="Nombre d'articles nécessitant un réapprovisionnement"
        />
        <UiStatCard
          label="Bons de Réception (BR)"
          value="18 BR intégrés"
          subtext="Mois en cours"
          trend="100% rapprochés"
          highlightColor="var(--indigo-600)"
          infoTooltip="Nombre de réceptions validées par le magasinier"
        />
        <UiStatCard
          label="Taux Écart Inventaire"
          value="0.0 %"
          subtext="Dernier récolement physique"
          trend="Écart nul"
          highlightColor="var(--emerald-600)"
          infoTooltip="Écart entre stock théorique et stock physique"
        />
      </div>

      {/* Sub-Tab Navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <button
          onClick={() => setActiveTab('soldes')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'soldes' ? '700' : '500',
            backgroundColor: activeTab === 'soldes' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'soldes' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'soldes' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-boxes-stacked" style={{ marginRight: '6px' }}></i>
          Soldes de Stock Théoriques
        </button>
        <button
          onClick={() => setActiveTab('receptions')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'receptions' ? '700' : '500',
            backgroundColor: activeTab === 'receptions' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'receptions' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'receptions' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-truck-ramp-box" style={{ marginRight: '6px' }}></i>
          Bons de Réception (BR Magasinier)
        </button>
      </div>

      {/* Content Table */}
      {activeTab === 'soldes' ? (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Stock Magasinier & Seuil d'Alerte</h4>
            <UiBadge variant="emerald">Stock Guard Protégé</UiBadge>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Ref Stock</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Article / Intitulé</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Quantité en Stock</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Seuil Alerte</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Valorisation</th>
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
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{s.valorisation}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <UiBadge variant={s.variant}>{s.status}</UiBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Historique des Bons de Réception (BR)</h4>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>N° BR</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Réception</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Fournisseur</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Articles Reçus</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Magasinier</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {receptionBons.map((r, idx) => (
                <tr key={r.id} style={{ borderBottom: idx === receptionBons.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{r.id}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{r.date}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{r.fournisseur}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{r.articles}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{r.magasinier}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <UiBadge variant={r.variant}>{r.status}</UiBadge>
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
