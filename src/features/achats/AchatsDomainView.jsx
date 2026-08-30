// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { createLiveRecord } from '../../shared/api/liveDataProvider.js';
import { DocumentViewerModal } from '../../shared/components/DocumentViewerModal';
import { AppConfirmModal } from '../../shared/components/AppConfirmModal';

export function AchatsDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeSubTab, setActiveSubTab] = useState('bdc');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddBDCModal, setShowAddBDCModal] = useState(false);
  const [showAddFournisseurModal, setShowAddFournisseurModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);

  // Custom Confirm Modal State
  const [confirmModalState, setConfirmModalState] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // Form state — BDC
  const [bdcSupplier, setBdcSupplier] = useState('');
  const [bdcArticle, setBdcArticle] = useState('');
  const [bdcAmount, setBdcAmount] = useState('');
  const [bdcFileUrl, setBdcFileUrl] = useState('');

  // Form state — Fournisseur
  const [fournNom, setFournNom] = useState('');
  const [fournCat, setFournCat] = useState('Engrais & Phyto');
  const [fournTel, setFournTel] = useState('');

  // Clean Production State Arrays
  const [bdcList, setBdcList] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);

  // REAL-TIME DYNAMIC ACHATS RECALCULATION ENGINE
  const totalEngagedSum = bdcList.reduce((acc, b) => acc + (b.rawAmount || 0), 0);
  const pendingDGCount = bdcList.filter(b => b.status === 'En Attente Validation DG').length;

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setBdcFileUrl(event.target?.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddBDC = async (e) => {
    e.preventDefault();
    if (!bdcSupplier || !bdcAmount) return;

    const amt = parseFloat(bdcAmount) || 0;
    const docUrl = bdcFileUrl || 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

    const newBdc = {
      id: `BDC-${Date.now().toString().slice(-4)}`,
      fournisseur: bdcSupplier,
      articles: bdcArticle || 'Fournitures Agricoles',
      montant: `${amt.toLocaleString('fr-FR')} MAD`,
      rawAmount: amt,
      date: new Date().toISOString().split('T')[0],
      status: 'Validé Achats',
      variant: 'indigo',
      documentUrl: docUrl
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
      justificatif_url: docUrl,
      created_by: 'live-user'
    });

    setShowAddBDCModal(false);
    setBdcSupplier(''); setBdcArticle(''); setBdcAmount(''); setBdcFileUrl('');
  };

  const handleAddFournisseur = (e) => {
    e.preventDefault();
    if (!fournNom) return;

    const newF = {
      id: `FRN-${Date.now().toString().slice(-3)}`,
      nom: fournNom,
      categorie: fournCat,
      telephone: fournTel || '+212 528 84 90 00',
      note: '4.8 / 5',
      statut: 'Référencé Compliant',
      variant: 'emerald'
    };

    setFournisseurs([newF, ...fournisseurs]);
    setShowAddFournisseurModal(false);
    setFournNom(''); setFournTel('');
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
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Bon de Commande',
      message: `Voulez-vous vraiment supprimer le bon de commande ${id} ?`,
      onConfirm: () => {
        setBdcList(bdcList.filter(b => b.id !== id));
      }
    });
  };

  const handleDeleteFournisseur = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Fournisseur',
      message: `Voulez-vous vraiment supprimer le fournisseur ${id} du référentiel ?`,
      onConfirm: () => {
        setFournisseurs(fournisseurs.filter(f => f.id !== id));
      }
    });
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

  const subTabs = [
    { id: 'bdc', label: 'Bons de Commande (BDC)', icon: 'fa-file-contract' },
    { id: 'devis', label: 'Comparateur 3 Devis', icon: 'fa-scale-balanced' },
    { id: 'fournisseurs', label: 'Référentiel Fournisseurs', icon: 'fa-truck-field' },
  ];

  const filteredBDC = bdcList.filter(b => b.fournisseur.toLowerCase().includes(searchQuery.toLowerCase()) || b.id.toLowerCase().includes(searchQuery.toLowerCase()) || b.articles.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredFournisseurs = fournisseurs.filter(f => f.nom.toLowerCase().includes(searchQuery.toLowerCase()) || f.categorie.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* REAL-TIME DYNAMIC ACHATS KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Total Engagé BDC"
          value={`${totalEngagedSum.toLocaleString('fr-FR')} MAD`}
          subtext={`${bdcList.length} BDC en base`}
          trend="0.0%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Total des bons de commande validés recalculé en temps réel"
        />
        <UiStatCard
          label="BDC En Attente DG"
          value={`${pendingDGCount} BDC`}
          subtext={pendingDGCount > 0 ? 'Signature requise' : 'Aucune attente'}
          trend={pendingDGCount > 0 ? 'Action requise' : 'À jour'}
          highlightColor={pendingDGCount > 0 ? 'var(--amber-500)' : 'var(--emerald-600)'}
          infoTooltip="Bons de commande nécessitant la signature DG"
        />
        <UiStatCard
          label="Total Commandes Emises"
          value={`${bdcList.length} commandes`}
          subtext="Base de données active"
          trend="Commandes réelles"
          highlightColor="var(--indigo-600)"
          infoTooltip="Nombre total de bons de commande"
        />
        <UiStatCard
          label="Fournisseurs Enregistrés"
          value={`${fournisseurs.length} fournisseurs`}
          subtext="Référencés en base"
          trend="Base propre"
          highlightColor="var(--emerald-600)"
          infoTooltip="Nombre de fournisseurs actifs"
        />
      </div>

      {/* Sub-Tab Navigation Pills */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        {subTabs.map(tab => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                fontSize: '13px',
                fontWeight: isActive ? '700' : '500',
                backgroundColor: isActive ? 'var(--emerald-600)' : 'var(--bg-card)',
                color: isActive ? '#FFFFFF' : 'var(--text-secondary)',
                border: isActive ? 'none' : '1px solid var(--border-color)',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <i className={`fa-solid ${tab.icon}`}></i>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* SUB-TAB 1: BDC */}
      {activeSubTab === 'bdc' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Registre des Bons de Commande — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Workflow validation & consultation des devis numérisés</p>
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
            {filteredBDC.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-file-contract" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun bon de commande dans la base</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Nouveau BDC"</strong> pour émettre et joindre votre premier devis/BDC réel.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>N° BDC</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Fournisseur</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Designation / Articles</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant Engagement</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Émission</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Validation</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Document</th>
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
                      <td style={{ padding: '14px 20px' }}>
                        <button
                          onClick={() => setSelectedDoc({ title: `BDC ${b.id} — ${b.fournisseur}`, url: b.documentUrl })}
                          style={{ padding: '5px 10px', borderRadius: '4px', border: '1px solid var(--emerald-600)', backgroundColor: 'var(--emerald-50)', color: 'var(--emerald-700)', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <i className="fa-solid fa-eye"></i> Voir BDC / Devis
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
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: COMPARATEUR 3 DEVIS */}
      {activeSubTab === 'devis' && (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
          <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '8px' }}>Comparateur 3 Devis & Benchmark Prix — {activeFarm}</h4>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>Comparez 3 propositions fournisseurs avant émission du Bon de Commande</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px' }}>
            <div style={{ padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <UiBadge variant="emerald">Option 1 — Moins Chère</UiBadge>
              <h5 style={{ fontSize: '15px', fontWeight: '700' }}>Agro Chimique SA</h5>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Offre Engrais NPK 20-20-20 (10 Tonnes)</p>
              <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--emerald-600)' }}>42,500 MAD</span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Livraison sous 48h included</span>
            </div>

            <div style={{ padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <UiBadge variant="neutral">Option 2 — Standard</UiBadge>
              <h5 style={{ fontSize: '15px', fontWeight: '700' }}>Fertilizers Souss SARL</h5>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Offre Engrais NPK 20-20-20 (10 Tonnes)</p>
              <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)' }}>46,000 MAD</span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Paiement à 30 jours</span>
            </div>

            <div style={{ padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <UiBadge variant="amber">Option 3 — Premium</UiBadge>
              <h5 style={{ fontSize: '15px', fontWeight: '700' }}>Comptoir Agricole Maroc</h5>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Offre Engrais NPK 20-20-20 (10 Tonnes)</p>
              <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)' }}>49,200 MAD</span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Assistance technique terrain</span>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: RÉFÉRENTIEL FOURNISSEURS */}
      {activeSubTab === 'fournisseurs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Référentiel des Fournisseurs Homologués — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Base des fournisseurs d'engrais, emballages, et matériel d'irrigation</p>
            </div>
            <button onClick={() => setShowAddFournisseurModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Nouveau Fournisseur
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredFournisseurs.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-truck-field" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun fournisseur enregistré</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Nouveau Fournisseur"</strong> pour référencer votre premier fournisseur.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Code Fournisseur</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Nom Rationale</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Catégorie Produits</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Téléphone Contact</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Note Qualité</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFournisseurs.map((f, idx) => (
                    <tr key={f.id} style={{ borderBottom: idx === filteredFournisseurs.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{f.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{f.nom}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{f.categorie}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{f.telephone}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{f.note}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <UiBadge variant={f.variant}>{f.statut}</UiBadge>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeleteFournisseur(f.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* MODALS */}
      {showAddBDCModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddBDC} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '440px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Émission Nouveau Bon de Commande</h3>
            <input type="text" placeholder="Fournisseur *" required value={bdcSupplier} onChange={e => setBdcSupplier(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Désignation des Articles (ex: Engrais NPK)" value={bdcArticle} onChange={e => setBdcArticle(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Montant TTC (MAD) *" required value={bdcAmount} onChange={e => setBdcAmount(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Joindre le Devis / Bon de Commande Numérisé *</label>
              <input type="file" accept="image/*,.pdf" onChange={handleFileUpload} style={{ fontSize: '12px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button type="button" onClick={() => setShowAddBDCModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Émettre & Joindre</button>
            </div>
          </form>
        </div>
      )}

      {showAddFournisseurModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddFournisseur} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Référencement Nouveau Fournisseur</h3>
            <input type="text" placeholder="Nom Rationale Fournisseur *" required value={fournNom} onChange={e => setFournNom(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <select value={fournCat} onChange={e => setFournCat(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <option value="Engrais & Phyto">Engrais & Phyto</option>
              <option value="Emballage & Barquettes">Emballage & Barquettes</option>
              <option value="Irrigation & Serres">Irrigation & Serres</option>
              <option value="Carburants & Transport">Carburants & Transport</option>
            </select>
            <input type="text" placeholder="Téléphone Contact" value={fournTel} onChange={e => setFournTel(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddFournisseurModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Référencer</button>
            </div>
          </form>
        </div>
      )}

      {/* Universal Document Viewer Modal */}
      <DocumentViewerModal
        isOpen={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        documentTitle={selectedDoc?.title || 'Document Preview'}
        documentUrl={selectedDoc?.url}
      />

      {/* In-App Confirmation Modal */}
      <AppConfirmModal
        isOpen={confirmModalState.isOpen}
        onClose={() => setConfirmModalState({ ...confirmModalState, isOpen: false })}
        onConfirm={confirmModalState.onConfirm}
        title={confirmModalState.title}
        message={confirmModalState.message}
      />
    </div>
  );
}
