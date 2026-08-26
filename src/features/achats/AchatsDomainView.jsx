// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';

export function AchatsDomainView({ activeFarm }) {
  const [activeTab, setActiveTab] = useState('bdc');

  const bdcs = [
    { id: 'BDC-8920', fournisseur: 'Agro Chimique SA', produit: 'Engrais Soluble NPK 20-20-20', montant: '34,500 MAD', status: 'Validé DG', variant: 'emerald' },
    { id: 'BDC-8921', fournisseur: 'Plastiques Emballage SARL', produit: 'Barquettes PET 250g', montant: '18,200 MAD', status: 'En Attente Achats', variant: 'amber' },
    { id: 'BDC-8922', fournisseur: 'Irrigation Modern Maroc', produit: 'Goutte-à-goutte 1.6L/h', montant: '52,000 MAD', status: 'Payé', variant: 'emerald' },
    { id: 'BDC-8923', fournisseur: 'Phyto Protection SA', produit: 'Fongicide Biologique', montant: '14,800 MAD', status: 'Validé Achats', variant: 'indigo' },
  ];

  const devis = [
    { id: 'DEV-301', fournisseur: 'Maroc Emballage', offres: '3 Offres reçues', prixMin: '17,500 MAD', recommandation: 'Maroc Emballage (Moins cher)', variant: 'emerald' },
    { id: 'DEV-302', fournisseur: 'Tuyaux & Pompes SARL', offres: '2 Offres reçues', prixMin: '48,000 MAD', recommandation: 'Tuyaux & Pompes (Meilleur délai)', variant: 'emerald' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Achats KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Total Engagé BDC"
          value="119,500 MAD"
          subtext="4 bons de commande"
          trend="+8.2%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Total des commandes engagées sur la période"
        />
        <UiStatCard
          label="BDC En Attente Achats"
          value="18,200 MAD"
          subtext="1 bon à valider"
          trend="1 BDC"
          highlightColor="var(--amber-500)"
          infoTooltip="Bons de commande en attente de visa achats"
        />
        <UiStatCard
          label="Economie Négo. 3 Devis"
          value="14,200 MAD"
          subtext="Gain négocié vs devis max"
          trend="-11.5%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Économie réalisée via comparaison 3 devis"
        />
        <UiStatCard
          label="Fournisseurs Actifs"
          value="14 fournisseurs"
          subtext="Catalogue certifié"
          trend="100% à jour"
          highlightColor="var(--indigo-600)"
          infoTooltip="Nombre de fournisseurs agréés au catalogue"
        />
      </div>

      {/* Sub-Tab Navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <button
          onClick={() => setActiveTab('bdc')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'bdc' ? '700' : '500',
            backgroundColor: activeTab === 'bdc' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'bdc' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'bdc' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-file-contract" style={{ marginRight: '6px' }}></i>
          Bons de Commande (BDC)
        </button>
        <button
          onClick={() => setActiveTab('devis')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'devis' ? '700' : '500',
            backgroundColor: activeTab === 'devis' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'devis' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'devis' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-scale-balanced" style={{ marginRight: '6px' }}></i>
          Consultation 3 Devis
        </button>
      </div>

      {/* Content View */}
      {activeTab === 'bdc' ? (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Workflow Bons de Commande</h4>
            <UiBadge variant="emerald">BDC State Guard Actif</UiBadge>
          </div>
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
      ) : (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Comparateur 3 Devis Fournisseurs</h4>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Réf Devis</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Intitulé Consultation</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Offres Reçues</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Meilleur Prix</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Recommandation System</th>
              </tr>
            </thead>
            <tbody>
              {devis.map((d, idx) => (
                <tr key={d.id} style={{ borderBottom: idx === devis.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{d.id}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{d.fournisseur}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{d.offres}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{d.prixMin}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <UiBadge variant={d.variant}>{d.recommandation}</UiBadge>
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
