// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';

export function DgDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeTab, setActiveTab] = useState('audit');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddLogModal, setShowAddLogModal] = useState(false);

  // Form state
  const [logAction, setLogAction] = useState('');
  const [logDetail, setLogDetail] = useState('');

  const [auditLogs, setAuditLogs] = useState([
    { id: 'LOG-901', action: 'Validation Finale Facture', user: 'M. Lazrak (DG)', detail: 'Facture #INV-2026-001 (45,200.00 MAD)', time: '26 Fév 14:00' },
    { id: 'LOG-902', action: 'Exportation Rapport Quinzaine', user: 'Finance Admin', detail: 'Quinzaine 16 - Souss & Loukkos', time: '26 Fév 11:30' },
    { id: 'LOG-903', action: 'Modification Code Analytique', user: 'Chef Comptable', detail: 'Code #ANA-402 activé pour Campagne 2026', time: '25 Fév 17:45' },
    { id: 'LOG-904', action: 'Validation Signature DG', user: 'M. Lazrak (DG)', detail: 'Tampon numérisé apposé sur BDC #8920', time: '25 Fév 14:20' }
  ]);

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

  const handleDeleteLog = (id) => {
    if (confirm(`Supprimer l'entrée d'audit ${id} ?`)) {
      setAuditLogs(auditLogs.filter(l => l.id !== id));
    }
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

  const filteredLogs = auditLogs.filter(l => {
    return l.action.toLowerCase().includes(searchQuery.toLowerCase()) || l.id.toLowerCase().includes(searchQuery.toLowerCase()) || l.user.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top DG KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Marge Brute Global"
          value="48.5 %"
          subtext="Objectif DG > 45%"
          trend="+3.1%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Marge brute consolidée sur l'ensemble des fermes"
        />
        <UiStatCard
          label="Suivi Budget vs Réel"
          value="87.4 %"
          subtext="Budget consommé"
          trend="Économie 12.6%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Taux d'exécution du budget campagne"
        />
        <UiStatCard
          label="Score Adoption Utilisateurs"
          value="98.2 %"
          subtext="7/7 fermes connectées"
          trend="Score parfait"
          highlightColor="var(--indigo-600)"
          infoTooltip="Taux d'utilisation quotidienne par les équipes terrain"
        />
        <UiStatCard
          label="Taux Sécurité BSNL"
          value="100 %"
          subtext="Aucune alerte sécurité"
          trend="Système sécurisé"
          highlightColor="var(--emerald-600)"
          infoTooltip="Intégrité du registre et des signatures numériques"
        />
      </div>

      {/* Sub-Tab Navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <button
          onClick={() => setActiveTab('audit')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'audit' ? '700' : '500',
            backgroundColor: activeTab === 'audit' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'audit' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'audit' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-shield-halved" style={{ marginRight: '6px' }}></i>
          Audit Log & Sécurité BSNL
        </button>
      </div>

      {/* Content Table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Audit Log Systémique & Tampons Numériques — {activeFarm}</h4>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Registre infalsifiable BSNL pour la Direction Générale</p>
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
        </div>
      </div>

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
    </div>
  );
}
