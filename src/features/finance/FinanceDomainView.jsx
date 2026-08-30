// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { createLiveRecord } from '../../shared/api/liveDataProvider.js';
import { DocumentViewerModal } from '../../shared/components/DocumentViewerModal';
import { AppConfirmModal } from '../../shared/components/AppConfirmModal';

export function FinanceDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeSubTab, setActiveSubTab] = useState('workflow');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('tous');
  const [showAddInvoiceModal, setShowAddInvoiceModal] = useState(false);
  const [showAddCaisseModal, setShowAddCaisseModal] = useState(false);
  const [showAddLiquidationModal, setShowAddLiquidationModal] = useState(false);
  const [showAddVirementModal, setShowAddVirementModal] = useState(false);

  // Custom Confirm Modal State
  const [confirmModalState, setConfirmModalState] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // Document Viewer Modal State
  const [selectedDoc, setSelectedDoc] = useState(null);

  // Form states — Facture
  const [invNum, setInvNum] = useState('');
  const [invSupplier, setInvSupplier] = useState('');
  const [invAmount, setInvAmount] = useState('');
  const [invFileUrl, setInvFileUrl] = useState('');

  // Form states — Caisse
  const [caisseDesc, setCaisseDesc] = useState('');
  const [caisseAmount, setCaisseAmount] = useState('');
  const [caisseType, setCaisseType] = useState('depense');
  const [caisseFileUrl, setCaisseFileUrl] = useState('');

  // Form states — Liquidation
  const [liqClient, setLiqClient] = useState('');
  const [liqMontant, setLiqMontant] = useState('');

  // Form states — Virement
  const [virBanque, setVirBanque] = useState('Attijariwafa Bank');
  const [virRef, setVirRef] = useState('');
  const [virMontant, setVirMontant] = useState('');

  // Clean Production State Arrays
  const [invoices, setInvoices] = useState([]);
  const [caisseTransactions, setCaisseTransactions] = useState([]);
  const [liquidations, setLiquidations] = useState([]);
  const [virements, setVirements] = useState([]);

  // REAL-TIME DYNAMIC AGGREGATION ENGINE
  const totalInvoicesSum = invoices.reduce((acc, i) => acc + (i.rawMontant || 0), 0);
  const caisseNetSum = caisseTransactions.reduce((acc, c) => acc + (c.type === 'recette' ? c.rawAmount : -c.rawAmount), 0);
  const totalLiquidationsSum = liquidations.reduce((acc, l) => acc + (l.rawMontant || 0), 0);
  const totalVirementsSum = virements.reduce((acc, v) => acc + (v.rawMontant || 0), 0);

  const dynamicCaisseBalance = caisseNetSum;
  const validatedInvoicesCount = invoices.filter(i => i.status === 'validee_dg' || i.status === 'payee').length;

  const handleFileUpload = (e, setUrlFn) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setUrlFn(event.target?.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddInvoice = async (e) => {
    e.preventDefault();
    if (!invSupplier || !invAmount) return;

    const newId = invNum || `INV-${Date.now().toString().slice(-4)}`;
    const amtNum = parseFloat(invAmount) || 0;
    const docUrl = invFileUrl || 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

    const newInv = {
      id: newId,
      fournisseur: invSupplier,
      montant: `${amtNum.toLocaleString('fr-FR')} MAD`,
      rawMontant: amtNum,
      status: 'en_validation',
      date: new Date().toISOString().split('T')[0],
      statusLabel: 'En Validation',
      variant: 'amber',
      documentUrl: docUrl
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
      justificatif_url: docUrl,
      created_by: 'live-user'
    });

    setShowAddInvoiceModal(false);
    setInvNum(''); setInvSupplier(''); setInvAmount(''); setInvFileUrl('');
  };

  const handleAddCaisse = async (e) => {
    e.preventDefault();
    if (!caisseDesc || !caisseAmount) return;

    const amtNum = parseFloat(caisseAmount) || 0;
    const docUrl = caisseFileUrl || 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

    const newCS = {
      id: `CS-${Date.now().toString().slice(-3)}`,
      date: new Date().toISOString().split('T')[0],
      type: caisseType,
      categorie: caisseDesc,
      montant: caisseType === 'recette' ? `+ ${amtNum.toLocaleString('fr-FR')} MAD` : `- ${amtNum.toLocaleString('fr-FR')} MAD`,
      rawAmount: amtNum,
      beneficiaire: 'Caisse Terrain',
      documentUrl: docUrl
    };

    setCaisseTransactions([newCS, ...caisseTransactions]);
    await createLiveRecord('caisse_transactions', {
      type: caisseType,
      montant: amtNum,
      description: caisseDesc,
      date: newCS.date,
      ferme: activeFarm,
      categorie: 'Caisse Quick',
      justificatif_url: docUrl,
      created_by: 'live-user'
    });

    setShowAddCaisseModal(false);
    setCaisseDesc(''); setCaisseAmount(''); setCaisseFileUrl('');
  };

  const handleAddLiquidation = (e) => {
    e.preventDefault();
    if (!liqClient || !liqMontant) return;

    const amt = parseFloat(liqMontant) || 0;
    const newL = {
      id: `LIQ-${Date.now().toString().slice(-3)}`,
      client: liqClient,
      date: new Date().toISOString().split('T')[0],
      montant: `${amt.toLocaleString('fr-FR')} MAD`,
      rawMontant: amt,
      status: 'Encaissé',
      variant: 'emerald'
    };

    setLiquidations([newL, ...liquidations]);
    setShowAddLiquidationModal(false);
    setLiqClient(''); setLiqMontant('');
  };

  const handleAddVirement = (e) => {
    e.preventDefault();
    if (!virMontant) return;

    const amt = parseFloat(virMontant) || 0;
    const newV = {
      id: virRef || `VIR-${Date.now().toString().slice(-4)}`,
      banque: virBanque,
      date: new Date().toISOString().split('T')[0],
      montant: `${amt.toLocaleString('fr-FR')} MAD`,
      rawMontant: amt,
      status: 'Exécuté',
      variant: 'emerald',
      documentUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
    };

    setVirements([newV, ...virements]);
    setShowAddVirementModal(false);
    setVirRef(''); setVirMontant('');
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
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression de Facture',
      message: `Voulez-vous vraiment supprimer définitivement la facture ${id} ?`,
      onConfirm: () => {
        setInvoices(invoices.filter(inv => inv.id !== id));
      }
    });
  };

  const handleDeleteCaisse = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Mouvement Caisse',
      message: `Voulez-vous vraiment supprimer le mouvement de caisse ${id} ?`,
      onConfirm: () => {
        setCaisseTransactions(caisseTransactions.filter(c => c.id !== id));
      }
    });
  };

  const handleDeleteLiquidation = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Liquidation',
      message: `Voulez-vous vraiment supprimer la liquidation ${id} ?`,
      onConfirm: () => {
        setLiquidations(liquidations.filter(l => l.id !== id));
      }
    });
  };

  const handleDeleteVirement = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Virement',
      message: `Voulez-vous vraiment supprimer le virement bancaire ${id} ?`,
      onConfirm: () => {
        setVirements(virements.filter(v => v.id !== id));
      }
    });
  };

  const handleExportCSV = () => {
    const headers = ['N° Facture', 'Fournisseur', 'Date', 'Montant TTC', 'Statut'];
    const rows = invoices.map(i => [i.id, i.fournisseur, i.date, i.montant, i.statusLabel]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `factures_${activeFarm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const subTabs = [
    { id: 'workflow', label: 'Workflow Factures', icon: 'fa-file-invoice-dollar' },
    { id: 'caisse', label: 'Trésorerie & Caisse', icon: 'fa-vault' },
    { id: 'liquidations', label: 'Liquidations & Ventes', icon: 'fa-chart-line' },
    { id: 'virements', label: 'Virements & Banques', icon: 'fa-building-columns' },
  ];

  const filteredInvoices = invoices.filter(inv => inv.fournisseur.toLowerCase().includes(searchQuery.toLowerCase()) || inv.id.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredLiquidations = liquidations.filter(l => l.client.toLowerCase().includes(searchQuery.toLowerCase()) || l.id.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredVirements = virements.filter(v => v.banque.toLowerCase().includes(searchQuery.toLowerCase()) || v.id.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* REAL-TIME DYNAMIC RECALCULATED KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Engagement Factures Total"
          value={`${totalInvoicesSum.toLocaleString('fr-FR')} MAD`}
          subtext={`${invoices.length} factures en base`}
          trend={`${validatedInvoicesCount} validées DG`}
          highlightColor="var(--emerald-600)"
          infoTooltip="Calculé dynamiquement selon les factures réelles de la base"
        />
        <UiStatCard
          label="Solde Caisse (Temps Réel)"
          value={`${dynamicCaisseBalance.toLocaleString('fr-FR')} MAD`}
          subtext={`${caisseTransactions.length} mouvements réels`}
          trend={caisseNetSum >= 0 ? `+${caisseNetSum.toLocaleString('fr-FR')} MAD` : `${caisseNetSum.toLocaleString('fr-FR')} MAD`}
          highlightColor="var(--indigo-600)"
          infoTooltip="Solde caisse calculé sur les entrées/sorties réelles"
        />
        <UiStatCard
          label="Total Liquidations Ventes"
          value={`${totalLiquidationsSum.toLocaleString('fr-FR')} MAD`}
          subtext={`${liquidations.length} décomptes encaissés`}
          trend="0.0%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Total des liquidations sur ventes export & local"
        />
        <UiStatCard
          label="Virements Bancaires Exécutés"
          value={`${totalVirementsSum.toLocaleString('fr-FR')} MAD`}
          subtext={`${virements.length} virements réglés`}
          trend="0.0%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Somme des règlements bancaires effectués"
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

      {/* SUB-TAB 1: WORKFLOW FACTURES */}
      {activeSubTab === 'workflow' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>Pipeline Factures Fournisseurs — {activeFarm}</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Workflow validation 3 niveaux & documents numérisés</p>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Rechercher fournisseur..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '13px', outline: 'none' }}
              />

              <button onClick={handleExportCSV} style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-download" style={{ marginRight: '6px' }}></i> Exporter CSV
              </button>

              <button onClick={() => setShowAddInvoiceModal(true)} style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Nouvelle Facture
              </button>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredInvoices.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-file-invoice-dollar" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucune facture dans la base de données</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"+ Nouvelle Facture"</strong> pour saisir et téléverser votre premier justificatif.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>N° Facture</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Fournisseur</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Facture</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant TTC</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Validation</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Document</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
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
                        <button onClick={() => handleAdvanceStatus(inv.id)} title="Cliquer pour avancer le statut" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
                          <UiBadge variant={inv.variant}>{inv.statusLabel} ➔</UiBadge>
                        </button>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button
                          onClick={() => setSelectedDoc({ title: `Facture ${inv.id} — ${inv.fournisseur}`, url: inv.documentUrl })}
                          style={{ padding: '5px 10px', borderRadius: '4px', border: '1px solid var(--emerald-600)', backgroundColor: 'var(--emerald-50)', color: 'var(--emerald-700)', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <i className="fa-solid fa-eye"></i> Voir Facture
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
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: TRÉSORERIE & CAISSE */}
      {activeSubTab === 'caisse' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Gestion de Caisse & Mouvements Trésorerie</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Solde caisse recalculé en direct: {dynamicCaisseBalance.toLocaleString('fr-FR')} MAD</p>
            </div>
            <button onClick={() => setShowAddCaisseModal(true)} style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Saisie Mouvement Caisse
            </button>
          </div>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {caisseTransactions.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-vault" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun mouvement de caisse</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Saisie Mouvement Caisse"</strong> pour ajouter votre première entrée/sortie.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Réf Caisse</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Catégorie</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Bénéficiaire / Source</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Justificatif</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
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
                      <td style={{ padding: '14px 20px' }}>
                        <button
                          onClick={() => setSelectedDoc({ title: `Justificatif Caisse ${c.id}`, url: c.documentUrl })}
                          style={{ padding: '5px 10px', borderRadius: '4px', border: '1px solid var(--emerald-600)', backgroundColor: 'var(--emerald-50)', color: 'var(--emerald-700)', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <i className="fa-solid fa-eye"></i> Voir Reçu
                        </button>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeleteCaisse(c.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
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

      {/* SUB-TAB 3: LIQUIDATIONS & VENTES */}
      {activeSubTab === 'liquidations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Liquidations des Ventes & Comptes Clients — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Décomptes de vente export & marché local</p>
            </div>
            <button onClick={() => setShowAddLiquidationModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Saisie Liquidation
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredLiquidations.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-chart-line" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucune liquidation de vente</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Saisie Liquidation"</strong> pour enregistrer votre premier décompte de vente.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Réf Liquidation</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Client / Exportateur</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Décompte</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant Encaissé</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLiquidations.map((l, idx) => (
                    <tr key={l.id} style={{ borderBottom: idx === filteredLiquidations.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{l.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{l.client}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{l.date}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{l.montant}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <UiBadge variant={l.variant}>{l.status}</UiBadge>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeleteLiquidation(l.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
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

      {/* SUB-TAB 4: VIREMENTS & BANQUES */}
      {activeSubTab === 'virements' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Registre des Virements Bancaires & Ordres de Paiement — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Exécution des ordonnancements de paiement fournisseurs & paie</p>
            </div>
            <button onClick={() => setShowAddVirementModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Saisie Ordre Virement
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredVirements.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-building-columns" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun virement bancaire enregistré</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Saisie Ordre Virement"</strong> pour exécuter un virement bancaire.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>N° Virement</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Banque Émettrice</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Virement</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant Réglé</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Avis Virement</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVirements.map((v, idx) => (
                    <tr key={v.id} style={{ borderBottom: idx === filteredVirements.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{v.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{v.banque}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{v.date}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{v.montant}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <UiBadge variant={v.variant}>{v.status}</UiBadge>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button
                          onClick={() => setSelectedDoc({ title: `Avis Virement ${v.id}`, url: v.documentUrl })}
                          style={{ padding: '5px 10px', borderRadius: '4px', border: '1px solid var(--emerald-600)', backgroundColor: 'var(--emerald-50)', color: 'var(--emerald-700)', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <i className="fa-solid fa-eye"></i> Voir Avis
                        </button>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeleteVirement(v.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
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
      {showAddInvoiceModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddInvoice} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '440px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Nouvelle Facture & Téléversement</h3>
            <input type="text" placeholder="N° Facture (ex: INV-901)" value={invNum} onChange={e => setInvNum(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Nom Fournisseur *" required value={invSupplier} onChange={e => setInvSupplier(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Montant TTC (MAD) *" required value={invAmount} onChange={e => setInvAmount(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Joindre le Document PDF / Photo de la Facture *</label>
              <input type="file" accept="image/*,.pdf" onChange={e => handleFileUpload(e, setInvFileUrl)} style={{ fontSize: '12px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button type="button" onClick={() => setShowAddInvoiceModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer & Joindre</button>
            </div>
          </form>
        </div>
      )}

      {showAddCaisseModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddCaisse} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '440px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Mouvement Caisse & Justificatif</h3>
            <select value={caisseType} onChange={e => setCaisseType(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <option value="depense">Dépense Caisse (-)</option>
              <option value="recette">Recette Caisse (+)</option>
            </select>
            <input type="text" placeholder="Description / Motifs *" required value={caisseDesc} onChange={e => setCaisseDesc(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Montant (MAD) *" required value={caisseAmount} onChange={e => setCaisseAmount(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Joindre Reçu / Ticket Caisse *</label>
              <input type="file" accept="image/*,.pdf" onChange={e => handleFileUpload(e, setCaisseFileUrl)} style={{ fontSize: '12px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button type="button" onClick={() => setShowAddCaisseModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer Mouvement</button>
            </div>
          </form>
        </div>
      )}

      {showAddLiquidationModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddLiquidation} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Liquidation Ventes</h3>
            <input type="text" placeholder="Nom Client / Exportateur *" required value={liqClient} onChange={e => setLiqClient(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Montant Encaissé MAD *" required value={liqMontant} onChange={e => setLiqMontant(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddLiquidationModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer Décompte</button>
            </div>
          </form>
        </div>
      )}

      {showAddVirementModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddVirement} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Ordre de Virement Bancaire</h3>
            <select value={virBanque} onChange={e => setVirBanque(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <option value="Attijariwafa Bank">Attijariwafa Bank</option>
              <option value="Banque Populaire">Banque Populaire</option>
              <option value="BMCE Bank of Africa">BMCE Bank of Africa</option>
              <option value="Crédit Agricole du Maroc">Crédit Agricole du Maroc</option>
            </select>
            <input type="text" placeholder="Réf Ordre / N° Transaction (ex: VIR-9081)" value={virRef} onChange={e => setVirRef(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Montant Virement MAD *" required value={virMontant} onChange={e => setVirMontant(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddVirementModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Exécuter Virement</button>
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
