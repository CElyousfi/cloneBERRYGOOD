// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { defaultAppData } from '../../shared/utils/appDataMock.js';
import { createLiveRecord } from '../../shared/api/liveDataProvider.js';

export function FinanceDomainView({ activeFarm = 'Ferme 1 - Souss', data = defaultAppData }) {
  const [activeSubTab, setActiveSubTab] = useState('workflow');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('tous');
  const [showAddInvoiceModal, setShowAddInvoiceModal] = useState(false);
  const [showAddCaisseModal, setShowAddCaisseModal] = useState(false);

  // Form states for New Invoice
  const [invNum, setInvNum] = useState('');
  const [invSupplier, setInvSupplier] = useState('');
  const [invAmount, setInvAmount] = useState('');

  // Form states for New Caisse Movement
  const [caisseDesc, setCaisseDesc] = useState('');
  const [caisseAmount, setCaisseAmount] = useState('');
  const [caisseType, setCaisseType] = useState('depense');

  // Local state initialized with live data or defaults
  const [invoices, setInvoices] = useState([
    { id: 'INV-2026-001', fournisseur: 'Agro Chimique SA', montant: '45,200.00 MAD', rawMontant: 45200, status: 'validee_dg', date: '2026-08-25', statusLabel: 'Validée DG', variant: 'emerald' },
    { id: 'INV-2026-002', fournisseur: 'Plastiques Emballage SARL', montant: '18,750.00 MAD', rawMontant: 18750, status: 'validee_finance', date: '2026-08-24', statusLabel: 'Validée Finance', variant: 'indigo' },
    { id: 'INV-2026-003', fournisseur: 'Irrigation Modern Maroc', montant: '52,000.00 MAD', rawMontant: 52000, status: 'payee', date: '2026-08-22', statusLabel: 'Payée', variant: 'emerald' },
    { id: 'INV-2026-004', fournisseur: 'Phyto Protection SA', montant: '14,800.00 MAD', rawMontant: 14800, status: 'en_validation', date: '2026-08-21', statusLabel: 'En Validation', variant: 'amber' },
    { id: 'INV-2026-005', fournisseur: 'Transporteur Souss SARL', montant: '24,500.00 MAD', rawMontant: 24500, status: 'validee_achats', date: '2026-08-20', statusLabel: 'Validée Achats', variant: 'indigo' },
  ]);

  const [caisseTransactions, setCaisseTransactions] = useState([
    { id: 'CS-801', date: '2026-08-25', type: 'depense', categorie: 'Achat Phyto Urgent', montant: '- 1,200.00 MAD', beneficiaire: 'H. Amrani' },
    { id: 'CS-802', date: '2026-08-24', type: 'recette', categorie: 'Vente Fruit Local (Caisse)', montant: '+ 4,500.00 MAD', beneficiaire: 'Client Local' },
    { id: 'CS-803', date: '2026-08-22', type: 'depense', categorie: 'Carburant Véhicule Souss', montant: '- 850.00 MAD', beneficiaire: 'Station Afriquia' },
  ]);

  // CRUD Actions
  const handleAddInvoice = async (e) => {
    e.preventDefault();
    if (!invSupplier || !invAmount) return;

    const newId = invNum || `INV-${Date.now().toString().slice(-4)}`;
    const amtNum = parseFloat(invAmount) || 0;
    const newInv = {
      id: newId,
      fournisseur: invSupplier,
      montant: `${amtNum.toLocaleString('fr-FR')} MAD`,
      rawMontant: amtNum,
      status: 'en_validation',
      date: new Date().toISOString().split('T')[0],
      statusLabel: 'En Validation',
      variant: 'amber'
    };

    setInvoices([newInv, ...invoices]);
    await createLiveRecord('invoices', {
      numero_facture: newId,
      fournisseur: invSupplier,
      montant: amtNum,
      montant_ttc: amtNum,
      payment_status: 'en_validation',
      ferme: activeFarm,
      date_facture: newInv.date,
      created_by: 'live-user'
    });

    setShowAddInvoiceModal(false);
    setInvNum(''); setInvSupplier(''); setInvAmount('');
  };

  const handleAddCaisse = async (e) => {
    e.preventDefault();
    if (!caisseDesc || !caisseAmount) return;

    const amtNum = parseFloat(caisseAmount) || 0;
    const newCS = {
      id: `CS-${Date.now().toString().slice(-3)}`,
      date: new Date().toISOString().split('T')[0],
      type: caisseType,
      categorie: caisseDesc,
      montant: caisseType === 'recette' ? `+ ${amtNum.toLocaleString('fr-FR')} MAD` : `- ${amtNum.toLocaleString('fr-FR')} MAD`,
      beneficiaire: 'Caisse Terrain'
    };

    setCaisseTransactions([newCS, ...caisseTransactions]);
    await createLiveRecord('caisse_transactions', {
      type: caisseType,
      montant: amtNum,
      description: caisseDesc,
      date: newCS.date,
      ferme: activeFarm,
      categorie: 'Caisse Quick',
      created_by: 'live-user'
    });

    setShowAddCaisseModal(false);
    setCaisseDesc(''); setCaisseAmount('');
  };

  const handleAdvanceStatus = (id) => {
    const nextMap = {
      en_validation: { status: 'validee_achats', label: 'Validée Achats', variant: 'indigo' },
      validee_achats: { status: 'validee_finance', label: 'Validée Finance', variant: 'indigo' },
      validee_finance: { status: 'validee_dg', label: 'Validée DG', variant: 'emerald' },
      validee_dg: { status: 'payee', label: 'Payée', variant: 'emerald' },
      payee: { status: 'en_validation', label: 'En Validation', variant: 'amber' }
    };

    setInvoices(invoices.map(inv => {
      if (inv.id === id) {
        const next = nextMap[inv.status] || nextMap.en_validation;
        return { ...inv, status: next.status, statusLabel: next.label, variant: next.variant };
      }
      return inv;
    }));
  };

  const handleDeleteInvoice = (id) => {
    if (confirm(`Supprimer définitivement la facture ${id} ?`)) {
      setInvoices(invoices.filter(inv => inv.id !== id));
    }
  };

  const handleExportCSV = () => {
    const headers = ['N° Facture', 'Fournisseur', 'Date', 'Montant TTC', 'Statut'];
    const rows = invoices.map(i => [i.id, i.fournisseur, i.date, i.montant, i.statusLabel]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `factures_smartberry_${activeFarm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const subTabs = [
    { id: 'workflow', label: 'Workflow Factures', icon: 'fa-file-invoice-dollar' },
    { id: 'caisse', label: 'Trésorerie & Caisse', icon: 'fa-vault' },
    { id: 'ojra', label: 'Paie & Charges OJRA', icon: 'fa-calculator' },
    { id: 'liquidations', label: 'Liquidations Export', icon: 'fa-chart-pie' },
    { id: 'virements', label: 'Virements Bancaires', icon: 'fa-building-columns' },
    { id: 'codes_analytiques', label: 'Codes Analytiques', icon: 'fa-tags' },
    { id: 'security', label: 'Sécurité & Audit BSNL', icon: 'fa-shield-halved' }
  ];

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = inv.fournisseur.toLowerCase().includes(searchQuery.toLowerCase()) || inv.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'tous' || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Financial KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Chiffre d'Affaires Total"
          value="460,000 MAD"
          subtext="Campagne 2025/2026"
          trend="+12.4%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Somme CA Export + CA Local"
        />
        <UiStatCard
          label="Solde Caisse & Trésorerie"
          value="18,450 MAD"
          subtext="Compte principal Souss"
          trend="+3.1%"
          highlightColor="var(--indigo-600)"
          infoTooltip="Solde caisse disponible en temps réel"
        />
        <UiStatCard
          label="Charges Salariales OJRA"
          value="184,200 MAD"
          subtext="Quinzaine 16"
          trend="+4.8%"
          highlightColor="var(--berry-600)"
          infoTooltip="Masse salariale brute + charges sociales"
        />
        <UiStatCard
          label="Résultat Avant Impôt (EBE)"
          value="240,000 MAD"
          subtext="EBE global estimé"
          trend="+8.9%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Excédent Brut d'Exploitation"
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
                whiteSpace: 'nowrap',
                transition: 'all var(--transition-fast)',
                boxShadow: isActive ? 'var(--shadow-xs)' : 'none'
              }}
            >
              <i className={`fa-solid ${tab.icon}`}></i>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* SUB-TAB 1: WORKFLOW FACTURES WITH FULL INLINE CRUD */}
      {activeSubTab === 'workflow' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>Pipeline Factures Fournisseurs — {activeFarm}</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Workflow: Non Payée → Validée Achats → Validée Finance → Validée DG → Payée</p>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Rechercher fournisseur..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '13px', outline: 'none' }}
              />

              <button
                onClick={handleExportCSV}
                style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <i className="fa-solid fa-download" style={{ marginRight: '6px' }}></i> Exporter CSV
              </button>

              <button
                onClick={() => setShowAddInvoiceModal(true)}
                style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer', boxShadow: 'var(--shadow-xs)' }}
              >
                <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Nouvelle Facture
              </button>
            </div>
          </div>

          {/* Interactive Status Chips */}
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto' }}>
            {['tous', 'en_validation', 'validee_achats', 'validee_finance', 'validee_dg', 'payee'].map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: statusFilter === st ? '700' : '500',
                  backgroundColor: statusFilter === st ? 'var(--text-main)' : 'var(--bg-card)',
                  color: statusFilter === st ? '#FFF' : 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  cursor: 'pointer'
                }}
              >
                {st === 'tous' ? 'Toutes' : st.replace('_', ' ').toUpperCase()}
              </button>
            ))}
          </div>

          {/* Factures Data Table */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>N° Facture</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Fournisseur</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Facture</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant TTC</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Validation</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions CRUD</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv, idx) => (
                  <tr key={inv.id} style={{ borderBottom: idx === filteredInvoices.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{inv.id}</td>
                    <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{inv.fournisseur}</td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{inv.date}</td>
                    <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{inv.montant}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <button onClick={() => handleAdvanceStatus(inv.id)} title="Cliquer pour faire avancer l'étape de validation" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
                        <UiBadge variant={inv.variant}>{inv.statusLabel} ➔</UiBadge>
                      </button>
                    </td>
                    <td style={{ padding: '14px 20px', display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleAdvanceStatus(inv.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)', fontSize: '11px', cursor: 'pointer' }}>
                        Avancer Statut
                      </button>
                      <button onClick={() => handleDeleteInvoice(inv.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: TRÉSORERIE & CAISSE */}
      {activeSubTab === 'caisse' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Gestion de Caisse & Mouvements Trésorerie</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Solde caisse disponible en temps réel: 18,450.00 MAD</p>
            </div>
            <button onClick={() => setShowAddCaisseModal(true)} style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Saisie Mouvement Caisse
            </button>
          </div>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Réf Caisse</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Catégorie</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Bénéficiaire / Source</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant</th>
                </tr>
              </thead>
              <tbody>
                {caisseTransactions.map((c, idx) => (
                  <tr key={c.id} style={{ borderBottom: idx === caisseTransactions.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{c.id}</td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{c.date}</td>
                    <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{c.categorie}</td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{c.beneficiaire}</td>
                    <td style={{ padding: '14px 20px', fontWeight: '700', color: c.type === 'recette' ? 'var(--emerald-600)' : 'var(--rose-500)' }}>{c.montant}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Add Invoice */}
      {showAddInvoiceModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddInvoice} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Nouvelle Facture</h3>
            <input type="text" placeholder="N° Facture (ex: INV-901)" value={invNum} onChange={e => setInvNum(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Nom Fournisseur *" required value={invSupplier} onChange={e => setInvSupplier(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Montant TTC (MAD) *" required value={invAmount} onChange={e => setInvAmount(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddInvoiceModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Add Caisse */}
      {showAddCaisseModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddCaisse} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Mouvement Caisse</h3>
            <select value={caisseType} onChange={e => setCaisseType(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <option value="depense">Dépense Caisse (-)</option>
              <option value="recette">Recette Caisse (+)</option>
            </select>
            <input type="text" placeholder="Description / Motifs *" required value={caisseDesc} onChange={e => setCaisseDesc(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Montant (MAD) *" required value={caisseAmount} onChange={e => setCaisseAmount(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddCaisseModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
