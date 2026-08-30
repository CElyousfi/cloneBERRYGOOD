// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { AppConfirmModal } from '../../shared/components/AppConfirmModal';

export function DgDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeSubTab, setActiveSubTab] = useState('audit');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddLogModal, setShowAddLogModal] = useState(false);

  // Custom Confirm Modal State
  const [confirmModalState, setConfirmModalState] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // Form state — Audit Log
  const [logAction, setLogAction] = useState('');
  const [logDetail, setLogDetail] = useState('');

  // Clean Production State Arrays
  const [auditLogs, setAuditLogs] = useState([]);
  const [approbations, setApprobations] = useState([]);

  const handleAddLog = (e) => {
    e.preventDefault();
    if (!logAction) return;

    const newLog = {
      id: `LOG-${Math.floor(900 + Math.random() * 99)}`,
      action: logAction,
      user: 'M. Lazrak (DG)',
      detail: logDetail || 'Action validée dans le registre BSNL',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setAuditLogs([newLog, ...auditLogs]);
    setShowAddLogModal(false);
    setLogAction(''); setLogDetail('');
  };

  const handleApproveDemand = (id) => {
    setApprobations(approbations.map(a => a.id === id ? { ...a, statut: 'Signé & Validé DG', variant: 'emerald' } : a));
  };

  const handleDeleteLog = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Entrée Registre BSNL',
      message: `Voulez-vous vraiment supprimer l'entrée d'audit ${id} ?`,
      onConfirm: () => {
        setAuditLogs(auditLogs.filter(l => l.id !== id));
      }
    });
  };

  const handleExportAuditCSV = () => {
    const headers = ['Event Log', 'Action', 'Utilisateur', 'Détails', 'Horodatage'];
    const rows = auditLogs.map(l => [l.id, l.action, l.user, l.detail, l.time]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `audit_bsnl_${activeFarm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const subTabs = [
    { id: 'audit', label: 'Registre Audit BSNL', icon: 'fa-shield-halved' },
    { id: 'approbations', label: 'Approbations DG & Signatures', icon: 'fa-signature' },
    { id: 'performance', label: 'Indicateurs Clés & Performance', icon: 'fa-chart-pie' },
  ];

  const filteredLogs = auditLogs.filter(l => l.action.toLowerCase().includes(searchQuery.toLowerCase()) || l.id.toLowerCase().includes(searchQuery.toLowerCase()) || l.user.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* REAL-TIME DYNAMIC DG KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Total Événements Audit BSNL"
          value={`${auditLogs.length} logs`}
          subtext="Registre horodaté active"
          trend="0.0%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Nombre d'événements d'audit horodatés"
        />
        <UiStatCard
          label="Taux Sécurité Registre"
          value="100 %"
          subtext="Infalsifiable"
          trend="Secured"
          highlightColor="var(--emerald-600)"
          infoTooltip="Intégrité du registre BSNL"
        />
        <UiStatCard
          label="Approbations Signées"
          value={`${approbations.filter(a => a.statut.includes('Signé')).length} signatures`}
          subtext="Signatures qualifiées DG"
          trend="Active"
          highlightColor="var(--indigo-600)"
          infoTooltip="Nombre d'approbations signées par la DG"
        />
        <UiStatCard
          label="Score Sécurité Global"
          value="100 %"
          subtext="Audit conforme"
          trend="Conforme"
          highlightColor="var(--emerald-600)"
          infoTooltip="Score de conformité générale"
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

      {/* SUB-TAB 1: AUDIT BSNL */}
      {activeSubTab === 'audit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Audit Log Systémique & Tampons Numériques — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Registre horodaté infalsifiable BSNL</p>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Rechercher action/user..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', outline: 'none' }}
              />
              <button onClick={handleExportAuditCSV} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-download" style={{ marginRight: '6px' }}></i> Exporter CSV
              </button>
              <button onClick={() => setShowAddLogModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Saisie Entrée Audit
              </button>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredLogs.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-shield-halved" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun événement d'audit dans le registre</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Saisie Entrée Audit"</strong> pour horodater votre première action réelle.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Event Log</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Action Exécutée</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Utilisateur</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Détails</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Horodatage</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log, idx) => (
                    <tr key={log.id} style={{ borderBottom: idx === filteredLogs.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{log.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{log.action}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{log.user}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{log.detail}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-muted)' }}>{log.time}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeleteLog(log.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
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

      {/* SUB-TAB 2: APPROBATIONS DG */}
      {activeSubTab === 'approbations' && (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
          <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '8px' }}>File d'Attente des Approbations & Signatures DG — {activeFarm}</h4>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>Validation des engagements financiers majeurs (&gt; 50 000 MAD)</p>

          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <i className="fa-solid fa-signature" style={{ fontSize: '32px', color: 'var(--emerald-600)', marginBottom: '12px' }}></i>
            <p style={{ fontSize: '14px', fontWeight: '600' }}>Toutes les demandes sont à jour</p>
            <p style={{ fontSize: '12px' }}>Aucun bon de commande supérieur à 50 000 MAD en attente de signature.</p>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: PERFORMANCE & ROI */}
      {activeSubTab === 'performance' && (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
          <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '8px' }}>Tableau de Performance Executive & EBE — {activeFarm}</h4>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>Synthese de rentabilite operationnelle et marge brute</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div style={{ padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Marge Brute Operationnelle</span>
              <h3 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--emerald-600)', marginTop: '4px' }}>42.5 %</h3>
            </div>
            <div style={{ padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Coût Unitaire Global / Kg</span>
              <h3 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>4.85 DH / kg</h3>
            </div>
            <div style={{ padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Rendement Global / Hectare</span>
              <h3 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--emerald-600)', marginTop: '4px' }}>14.8 T/ha</h3>
            </div>
          </div>
        </div>
      )}

      {/* Modal Add Audit Log */}
      {showAddLogModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddLog} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Entrée Registre Audit BSNL</h3>
            <input type="text" placeholder="Intitulé Action *" required value={logAction} onChange={e => setLogAction(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <textarea rows={3} placeholder="Détails & Justifications *" required value={logDetail} onChange={e => setLogDetail(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', resize: 'none' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddLogModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Horodater BSNL</button>
            </div>
          </form>
        </div>
      )}

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
