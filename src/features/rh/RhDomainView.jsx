// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';

export function RhDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeSubTab, setActiveSubTab] = useState('pointage');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddPointageModal, setShowAddPointageModal] = useState(false);

  // Form states
  const [pMatricule, setPMatricule] = useState('');
  const [pNom, setPNom] = useState('');
  const [pKg, setPKg] = useState('50');

  const [pointages, setPointages] = useState([
    { matricule: 'OUV-102', nom: 'A. Bennani', equipe: 'Souss Équipe 1', heureArrivee: '07:00', kgCueillis: '48 kg', coutDirect: '88.80 MAD', status: 'Présent (Validé Chef)', variant: 'emerald' },
    { matricule: 'OUV-103', nom: 'F. Zahra', equipe: 'Souss Équipe 1', heureArrivee: '07:00', kgCueillis: '52 kg', coutDirect: '96.20 MAD', status: 'Présent (Validé Chef)', variant: 'emerald' },
    { matricule: 'OUV-104', nom: 'M. Oulhaj', equipe: 'Loukkos Équipe 2', heureArrivee: '07:15', kgCueillis: '44 kg', coutDirect: '81.40 MAD', status: 'Présent (Validé Chef)', variant: 'emerald' },
    { matricule: 'OUV-105', nom: 'K. Bouchra', equipe: 'Hafida Équipe 3', heureArrivee: '07:00', kgCueillis: '50 kg', coutDirect: '92.50 MAD', status: 'Présent (Validé Chef)', variant: 'emerald' },
  ]);

  const handleAddPointage = (e) => {
    e.preventDefault();
    if (!pNom) return;

    const mat = pMatricule || `OUV-${Math.floor(100 + Math.random() * 900)}`;
    const kg = parseFloat(pKg) || 45;
    const cout = Math.round(kg * 1.85 * 100) / 100;

    const newP = {
      matricule: mat,
      nom: pNom,
      equipe: 'Souss Équipe 1',
      heureArrivee: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      kgCueillis: `${kg} kg`,
      coutDirect: `${cout} MAD`,
      status: 'Présent (Validé Chef)',
      variant: 'emerald'
    };

    setPointages([newP, ...pointages]);
    setShowAddPointageModal(false);
    setPMatricule(''); setPNom('');
  };

  const handleDeletePointage = (mat) => {
    if (confirm(`Supprimer le pointage de ${mat} ?`)) {
      setPointages(pointages.filter(p => p.matricule !== mat));
    }
  };

  const handleExportRHCSV = () => {
    const headers = ['Matricule', 'Nom', 'Équipe', 'Heure Arrivée', 'Kg Cueillis', 'Coût Direct', 'Statut'];
    const rows = pointages.map(p => [p.matricule, p.nom, p.equipe, p.heureArrivee, p.kgCueillis, p.coutDirect, p.status]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `pointage_rh_${activeFarm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const subTabs = [
    { id: 'pointage', label: 'Pointage Ouvriers', icon: 'fa-user-check' },
    { id: 'paie', label: 'Paie & Bulletins OJRA', icon: 'fa-file-invoice-dollar' },
    { id: 'primes', label: 'Primes de Récolte', icon: 'fa-award' },
  ];

  const filteredPointages = pointages.filter(p => {
    return p.nom.toLowerCase().includes(searchQuery.toLowerCase()) || p.matricule.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top RH KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Effectif Pointé Auj."
          value={`${pointages.length} ouvriers`}
          subtext="Taux présence 98.2%"
          trend="+4.1%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Nombre total d'ouvriers enregistrés au pointage matin"
        />
        <UiStatCard
          label="Masse Salariale Brute"
          value="184,200 MAD"
          subtext="Quinzaine 16"
          trend="+5.4%"
          highlightColor="var(--berry-600)"
          infoTooltip="Montant total de la paie quinzaine"
        />
        <UiStatCard
          label="Coût Moyen Récolte"
          value="1.85 DH / kg"
          subtext="Rendement 12.5 kg/h"
          trend="-0.12 DH"
          highlightColor="var(--emerald-600)"
          infoTooltip="Coût direct de récolte par kg cueilli"
        />
        <UiStatCard
          label="Prestataires & Transport"
          value="24,500 MAD"
          subtext="4 navettes quotidiennes"
          trend="0.0%"
          highlightColor="var(--indigo-600)"
          infoTooltip="Remboursement transport & sous-traitants"
        />
      </div>

      {/* Sub-Tab Navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
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
                cursor: 'pointer'
              }}
            >
              <i className={`fa-solid ${tab.icon}`}></i>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* SUB-TAB 1: POINTAGE OUVRIERS WITH FULL CRUD */}
      {activeSubTab === 'pointage' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Pointage Journalier des Ouvriers — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Saisie horodateur & validation des équipes par le chef d'exploitation.</p>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Rechercher ouvrier..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', outline: 'none' }}
              />
              <button onClick={handleExportRHCSV} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-download" style={{ marginRight: '6px' }}></i> Exporter CSV
              </button>
              <button onClick={() => setShowAddPointageModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Nouveau Pointage
              </button>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Matricule</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Nom & Prénom</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Équipe</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Heure Arrivée</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Kg Cueillis</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Coût Direct</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Pointage</th>
                  <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPointages.map((p, idx) => (
                  <tr key={p.matricule} style={{ borderBottom: idx === filteredPointages.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{p.matricule}</td>
                    <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{p.nom}</td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{p.equipe}</td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{p.heureArrivee}</td>
                    <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{p.kgCueillis}</td>
                    <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{p.coutDirect}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <UiBadge variant={p.variant}>{p.status}</UiBadge>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <button onClick={() => handleDeletePointage(p.matricule)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
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

      {/* Modal Add Pointage */}
      {showAddPointageModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddPointage} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Pointage Ouvrier</h3>
            <input type="text" placeholder="Matricule (ex: OUV-108)" value={pMatricule} onChange={e => setPMatricule(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Nom & Prénom Ouvrier *" required value={pNom} onChange={e => setPNom(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Kg Cueillis (ex: 50) *" required value={pKg} onChange={e => setPKg(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddPointageModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer Pointage</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
