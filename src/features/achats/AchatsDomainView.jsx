// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { createLiveRecord } from '../../shared/api/liveDataProvider.js';

export function AchatsDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeTab, setActiveTab] = useState('bdc');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddBDCModal, setShowAddBDCModal] = useState(false);

  // Form state
  const [bdcSupplier, setBdcSupplier] = useState('');
  const [bdcArticle, setBdcArticle] = useState('');
  const [bdcAmount, setBdcAmount] = useState('');

  const [bdcList, setBdcList] = useState([
    { id: 'BDC-8920', fournisseur: 'Agro Chimique SA', articles: 'Engrais NPK 20-20-20 (50 sacs)', montant: '25,500.00 MAD', rawAmount: 25500, date: '2026-08-25', status: 'Validé Achats', variant: 'indigo' },
    { id: 'BDC-8921', fournisseur: 'Plastiques Emballage SARL', articles: 'Barquettes Clamshell 250g (10,000u)', montant: '12,000.00 MAD', rawAmount: 12000, date: '2026-08-24', status: 'En Attente Validation DG', variant: 'amber' },
    { id: 'BDC-8922', fournisseur: 'Irrigation Modern Maroc', articles: 'Goutteurs Intégrés 1.6L/h (5,000m)', montant: '18,400.00 MAD', rawAmount: 18400, date: '2026-08-22', status: 'Payé & Livré', variant: 'emerald' },
  ]);

  const devisList = [
    { supplier: 'Agro Chimique SA', produit: 'Engrais NPK 20-20-20', prixUnitaire: '510 MAD / Sac', note: 'Offre retenue (Moins cher)', status: 'Sélectionné', variant: 'emerald' },
    { supplier: 'Chimie Agricole Souss', produit: 'Engrais NPK 20-20-20', prixUnitaire: '540 MAD / Sac', note: 'Concurrence', status: 'Écarté', variant: 'neutral' },
    { supplier: 'Fertilisation Maghreb', produit: 'Engrais NPK 20-20-20', prixUnitaire: '525 MAD / Sac', note: 'Concurrence', status: 'Écarté', variant: 'neutral' }
  ];

  const handleAddBDC = async (e) => {
    e.preventDefault();
    if (!bdcSupplier || !bdcAmount) return;

    const amt = parseFloat(bdcAmount) || 0;
    const newBdc = {
      id: `BDC-${Date.now().toString().slice(-4)}`,
      fournisseur: bdcSupplier,
      articles: bdcArticle || 'Fournitures Agricoles',
      montant: `${amt.toLocaleString('fr-FR')} MAD`,
      rawAmount: amt,
      date: new Date().toISOString().split('T')[0],
      status: 'Validé Achats',
      variant: 'indigo'
    };

    setBdcList([newBdc, ...bdcList]);
    await createLiveRecord('invoices', {
      numero_facture: newBdc.id,
      fournisseur: bdcSupplier,
      montant: amt,
      montant_ttc: amt,
      payment_status: 'validee_achats',
      ferme: activeFarm,
      date_facture: newBdc.date,
      created_by: 'live-user'
    });

    setShowAddBDCModal(false);
    setBdcSupplier(''); setBdcArticle(''); setBdcAmount('');
  };

  const handleAdvanceBDCStatus = (id) => {
    setBdcList(bdcList.map(b => {
      if (b.id === id) {
        const nextMap = {
          'Validé Achats': { status: 'En Attente Validation DG', variant: 'amber' },
          'En Attente Validation DG': { status: 'Payé & Livré', variant: 'emerald' },
          'Payé & Livré': { status: 'Validé Achats', variant: 'indigo' }
        };
        const next = nextMap[b.status] || nextMap['Validé Achats'];
        return { ...b, status: next.status, variant: next.variant };
      }
      return b;
    }));
  };

  const handleDeleteBDC = (id) => {
    if (confirm(`Supprimer le bon de commande ${id} ?`)) {
      setBdcList(bdcList.filter(b => b.id !== id));
    }
  };

  const handleExportAchatsCSV = () => {
    const headers = ['N° BDC', 'Fournisseur', 'Articles', 'Montant TTC', 'Date', 'Statut'];
    const rows = bdcList.map(b => [b.id, b.fournisseur, b.articles, b.montant, b.date, b.status]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `bons_de_commande_${activeFarm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredBDC = bdcList.filter(b => {
    return b.fournisseur.toLowerCase().includes(searchQuery.toLowerCase()) || b.id.toLowerCase().includes(searchQuery.toLowerCase()) || b.articles.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Achats KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Total Engagé BDC"
          value="55,900 MAD"
          subtext="Mois en cours"
          trend="+8.2%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Total des bons de commande validés"
        />
        <UiStatCard
          label="BDC En Attente DG"
          value="1 BDC"
          subtext="Barquettes Clamshell"
          trend="Action requise"
          highlightColor="var(--amber-500)"
          infoTooltip="Bons de commande nécessitant la signature DG"
        />
        <UiStatCard
          label="Économie 3 Devis"
          value="4,500 MAD"
          subtext="Négociation fournisseurs"
          trend="-7.5%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Gains réalisés par la comparaison systématique des 3 devis"
        />
        <UiStatCard
          label="Fournisseurs Actifs"
          value="12 fournisseurs"
          subtext="Certifiés GlobalGAP"
          trend="100% à jour"
          highlightColor="var(--indigo-600)"
          infoTooltip="Nombre de fournisseurs référencés"
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
          <i className="fa-solid fa-code-compare" style={{ marginRight: '6px' }}></i>
          Comparateur 3 Devis Fournisseurs
        </button>
      </div>

      {/* Content Table */}
      {activeTab === 'bdc' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Registre des Bons de Commande — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Workflow validation 3 niveaux (Achats → DG → Paiement)</p>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Rechercher fournisseur/BDC..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', outline: 'none' }}
              />
              <button onClick={handleExportAchatsCSV} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-download" style={{ marginRight: '6px' }}></i> Exporter CSV
              </button>
              <button onClick={() => setShowAddBDCModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Nouveau BDC
              </button>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>N° BDC</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Fournisseur</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Designation / Articles</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant Engagement</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Émission</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Validation</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredBDC.map((b, idx) => (
                  <tr key={b.id} style={{ borderBottom: idx === filteredBDC.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{b.id}</td>
                    <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{b.fournisseur}</td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{b.articles}</td>
                    <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{b.montant}</td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{b.date}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <button onClick={() => handleAdvanceBDCStatus(b.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
                        <UiBadge variant={b.variant}>{b.status} ➔</UiBadge>
                      </button>
                    </td>
                    <td style={{ padding: '14px 20px', display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleAdvanceBDCStatus(b.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)', fontSize: '11px', cursor: 'pointer' }}>
                        Avancer Statut
                      </button>
                      <button onClick={() => handleDeleteBDC(b.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Comparateur Automatique 3 Devis (Offre Optimale)</h4>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Fournisseur Consulté</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Produit / Article</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Prix Unitaire Proposé</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Remarques Négociation</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Décision</th>
              </tr>
            </thead>
            <tbody>
              {devisList.map((d, idx) => (
                <tr key={d.supplier} style={{ borderBottom: idx === devisList.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{d.supplier}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{d.produit}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{d.prixUnitaire}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{d.note}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <UiBadge variant={d.variant}>{d.status}</UiBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Add BDC */}
      {showAddBDCModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddBDC} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Émission Nouveau Bon de Commande</h3>
            <input type="text" placeholder="Fournisseur *" required value={bdcSupplier} onChange={e => setBdcSupplier(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Désignation des Articles (ex: Engrais NPK)" value={bdcArticle} onChange={e => setBdcArticle(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Montant TTC (MAD) *" required value={bdcAmount} onChange={e => setBdcAmount(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddBDCModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Émettre BDC</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
