// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { createLiveRecord } from '../../shared/api/liveDataProvider.js';

export function QualiteDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeSubTab, setActiveSubTab] = useState('inspections');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddInspectionModal, setShowAddInspectionModal] = useState(false);

  // Form state
  const [inspLot, setInspLot] = useState('');
  const [inspInspector, setInspInspector] = useState('M. Lazrak');
  const [inspBrix, setInspBrix] = useState('9.2');
  const [inspDefect, setInspDefect] = useState('1.5');

  const [inspections, setInspections] = useState([
    { id: 'INSP-401', lot: 'Lot Fraise Star B4', date: '2026-08-26', inspecteur: 'K. Reda', brix: '9.4 °B', rawBrix: 9.4, defectRate: '1.2 %', rawDefect: 1.2, status: 'Conforme (Cat A)', variant: 'emerald' },
    { id: 'INSP-402', lot: 'Lot Framboise Diamond A2', date: '2026-08-25', inspecteur: 'M. Alami', brix: '8.8 °B', rawBrix: 8.8, defectRate: '2.5 %', rawDefect: 2.5, status: 'Conforme (Cat A)', variant: 'emerald' },
    { id: 'INSP-403', lot: 'Lot Myrtille Blue C1', date: '2026-08-24', inspecteur: 'S. Bennani', brix: '7.6 °B', rawBrix: 7.6, defectRate: '4.8 %', rawDefect: 4.8, status: 'Sous Réserve (Cat B)', variant: 'amber' },
  ]);

  // REAL-TIME DYNAMIC QUALITY RECALCULATION ENGINE
  const conformeCount = inspections.filter(i => i.status.includes('Conforme')).length;
  const dynamicConformityRate = Math.round((conformeCount / (inspections.length || 1)) * 100 * 10) / 10;
  const dynamicAvgBrix = Math.round((inspections.reduce((acc, i) => acc + (i.rawBrix || 8), 0) / (inspections.length || 1)) * 10) / 10;
  const dynamicAvgDefect = Math.round((inspections.reduce((acc, i) => acc + (i.rawDefect || 2), 0) / (inspections.length || 1)) * 10) / 10;

  const handleAddInspection = async (e) => {
    e.preventDefault();
    if (!inspLot) return;

    const brixVal = parseFloat(inspBrix) || 8.0;
    const defVal = parseFloat(inspDefect) || 0;
    const isConforme = brixVal >= 8.0 && defVal < 3.0;

    const newInsp = {
      id: `INSP-${Date.now().toString().slice(-3)}`,
      lot: inspLot,
      date: new Date().toISOString().split('T')[0],
      inspecteur: inspInspector,
      brix: `${brixVal} °B`,
      rawBrix: brixVal,
      defectRate: `${defVal} %`,
      rawDefect: defVal,
      status: isConforme ? 'Conforme (Cat A)' : 'Sous Réserve (Cat B)',
      variant: isConforme ? 'emerald' : 'amber'
    };

    setInspections([newInsp, ...inspections]);
    await createLiveRecord('inspections', {
      lot: inspLot,
      date_inspection: new Date().toISOString(),
      inspecteur: inspInspector,
      brix: brixVal,
      taux_defauts: defVal,
      statut_conformite: isConforme ? 'conforme' : 'sous_reserve',
      created_by: 'live-user'
    });

    setShowAddInspectionModal(false);
    setInspLot('');
  };

  const handleToggleConformity = (id) => {
    setInspections(inspections.map(insp => {
      if (insp.id === id) {
        const isCurrentlyConforme = insp.status.includes('Conforme');
        return {
          ...insp,
          status: isCurrentlyConforme ? 'Sous Réserve (Cat B)' : 'Conforme (Cat A)',
          variant: isCurrentlyConforme ? 'amber' : 'emerald'
        };
      }
      return insp;
    }));
  };

  const handleDeleteInspection = (id) => {
    if (confirm(`Supprimer le rapport d'inspection ${id} ?`)) {
      setInspections(inspections.filter(i => i.id !== id));
    }
  };

  const handleExportQualityCSV = () => {
    const headers = ['Réf Inspection', 'Lot', 'Date', 'Inspecteur', 'Taux Brix', '% Défauts', 'Statut'];
    const rows = inspections.map(i => [i.id, i.lot, i.date, i.inspecteur, i.brix, i.defectRate, i.status]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `inspections_qualite_${activeFarm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredInspections = inspections.filter(i => {
    return i.lot.toLowerCase().includes(searchQuery.toLowerCase()) || i.id.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* REAL-TIME DYNAMIC QUALITY KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Lots Conformes (Cat A)"
          value={`${dynamicConformityRate} %`}
          subtext={`${conformeCount} / ${inspections.length} lots validés`}
          trend="+2.1%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Taux de conformité recalculé dynamiquement selon les inspections"
        />
        <UiStatCard
          label="Moyenne Taux Brix"
          value={`${dynamicAvgBrix} °B`}
          subtext="Seuil min: 8.0°B"
          trend="+0.4"
          highlightColor="var(--emerald-600)"
          infoTooltip="Moyenne des réfractomètres recalculée en direct"
        />
        <UiStatCard
          label="Taux Moyen Écart / Déchets"
          value={`${dynamicAvgDefect} %`}
          subtext="Seuil toléré < 3.0%"
          trend="-0.5%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Moyenne dynamique des tri de déchets à l'emballage"
        />
        <UiStatCard
          label="Total Contrôles Réfractométriques"
          value={`${inspections.length} contrôles`}
          subtext="Inspection quotidienne active"
          trend="100% contrôlé"
          highlightColor="var(--indigo-600)"
          infoTooltip="Volume de contrôles effectués"
        />
      </div>

      {/* Content View */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Rapports d'Inspection Qualité — {activeFarm}</h4>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Contrôle réfractométrique Brix & tri des défauts | Recalcul dynamique</p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Rechercher lot..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', outline: 'none' }}
            />
            <button onClick={handleExportQualityCSV} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-download" style={{ marginRight: '6px' }}></i> Exporter CSV
            </button>
            <button onClick={() => setShowAddInspectionModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Saisie Inspection
            </button>
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Réf Inspection</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Lot / Parcelle</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Contrôle</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Inspecteur</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Taux Brix</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>% Défauts</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Conforme</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInspections.map((insp, idx) => (
                <tr key={insp.id} style={{ borderBottom: idx === filteredInspections.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{insp.id}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{insp.lot}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{insp.date}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{insp.inspecteur}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{insp.brix}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{insp.defectRate}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <button onClick={() => handleToggleConformity(insp.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
                      <UiBadge variant={insp.variant}>{insp.status}</UiBadge>
                    </button>
                  </td>
                  <td style={{ padding: '14px 20px', display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleToggleConformity(insp.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)', fontSize: '11px', cursor: 'pointer' }}>
                      Basculer Statut
                    </button>
                    <button onClick={() => handleDeleteInspection(insp.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Add Inspection */}
      {showAddInspectionModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddInspection} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Rapport d'Inspection Qualité</h3>
            <input type="text" placeholder="Intitulé du Lot (ex: Lot Fraise B4) *" required value={inspLot} onChange={e => setInspLot(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Inspecteur *" required value={inspInspector} onChange={e => setInspInspector(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" step="0.1" placeholder="Taux Brix °B (ex: 9.4) *" required value={inspBrix} onChange={e => setInspBrix(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" step="0.1" placeholder="% Défauts (ex: 1.2) *" required value={inspDefect} onChange={e => setInspDefect(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddInspectionModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer & Recalculer</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
