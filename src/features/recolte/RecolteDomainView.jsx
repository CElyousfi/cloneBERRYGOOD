// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { AppConfirmModal } from '../../shared/components/AppConfirmModal';

export function RecolteDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [taskFilter, setTaskFilter] = useState('tous');
  const [searchQuery, setSearchQuery] = useState('');
  const [openTaskMenuId, setOpenTaskMenuId] = useState(null);
  const [showAddHarvestModal, setShowAddHarvestModal] = useState(false);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);

  // Custom Confirm Modal State
  const [confirmModalState, setConfirmModalState] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // Form states
  const [hParcelle, setHParcelle] = useState('');
  const [hVariete, setHVariete] = useState('Fraise Star');
  const [hKg, setHKg] = useState('');

  const [tTitle, setTTitle] = useState('');
  const [tDomain, setTDomain] = useState('Finance');

  // Interactive Task List state
  const [tasks, setTasks] = useState([
    { id: 'TSK-1', text: 'Validation Facture Engrais NPK #FACT-9482', domain: 'Finance', status: 'en_cours', userInitials: 'JD', dateLabel: 'Aujourd\'hui' },
    { id: 'TSK-2', text: 'Contrôle Taux Brix Variété Star - Bloc B4', domain: 'Qualité', status: 'en_cours', userInitials: 'KR', dateLabel: 'En retard (Hier)' },
    { id: 'TSK-3', text: 'Rapprochement Paie Quinzaine 16 — Ferme Souss', domain: 'RH', status: 'terminee', userInitials: 'JD', dateLabel: 'Aujourd\'hui' },
    { id: 'TSK-4', text: 'Inspection Station d\'Irrigation #2 & Filtres', domain: 'Agronomie', status: 'en_cours', userInitials: 'MA', dateLabel: 'Demain' },
  ]);

  // Interactive Harvest Records state
  const [harvestLogs, setHarvestLogs] = useState([
    { id: 'REC-101', parcelle: 'Bloc A1 - Fraise Star', variete: 'Fraise Star', kg: '1,450 kg', rawKg: 1450, coutParKg: '1.80 DH/kg', catA: '98 %', status: 'Conforme', variant: 'emerald' },
    { id: 'REC-102', parcelle: 'Bloc B2 - Framboise Diamond', variete: 'Framboise Diamond', kg: '980 kg', rawKg: 980, coutParKg: '1.95 DH/kg', catA: '96 %', status: 'Conforme', variant: 'emerald' },
    { id: 'REC-103', parcelle: 'Bloc C4 - Myrtille Blue', variete: 'Myrtille Blue', kg: '1,200 kg', rawKg: 1200, coutParKg: '1.85 DH/kg', catA: '94 %', status: 'Conforme', variant: 'emerald' },
  ]);

  // Dynamic Aggregations
  const totalHarvestKg = harvestLogs.reduce((acc, h) => acc + (h.rawKg || 0), 0);
  const completedTasksCount = tasks.filter(t => t.status === 'terminee').length;

  // Task Actions
  const handleToggleTaskStatus = (id) => {
    setTasks(tasks.map(t => {
      if (t.id === id) {
        return { ...t, status: t.status === 'terminee' ? 'en_cours' : 'terminee' };
      }
      return t;
    }));
  };

  const handleDeleteTask = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression de Tâche',
      message: `Voulez-vous vraiment supprimer cette tâche ?`,
      onConfirm: () => {
        setTasks(tasks.filter(t => t.id !== id));
        setOpenTaskMenuId(null);
      }
    });
  };

  const handleAddTask = (e) => {
    e.preventDefault();
    if (!tTitle) return;

    const newT = {
      id: `TSK-${Date.now().toString().slice(-3)}`,
      text: tTitle,
      domain: tDomain,
      status: 'en_cours',
      userInitials: 'LA',
      dateLabel: 'Aujourd\'hui'
    };

    setTasks([newT, ...tasks]);
    setShowAddTaskModal(false);
    setTTitle('');
  };

  const handleAddHarvest = (e) => {
    e.preventDefault();
    if (!hParcelle || !hKg) return;

    const kgVal = parseFloat(hKg) || 0;
    const newH = {
      id: `REC-${Date.now().toString().slice(-3)}`,
      parcelle: hParcelle,
      variete: hVariete,
      kg: `${kgVal.toLocaleString('fr-FR')} kg`,
      rawKg: kgVal,
      coutParKg: '1.82 DH/kg',
      catA: '97 %',
      status: 'Conforme',
      variant: 'emerald'
    };

    setHarvestLogs([newH, ...harvestLogs]);
    setShowAddHarvestModal(false);
    setHParcelle(''); setHKg('');
  };

  const handleDeleteHarvest = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Bon de Récolte',
      message: `Voulez-vous vraiment supprimer le bon de récolte ${id} ?`,
      onConfirm: () => {
        setHarvestLogs(harvestLogs.filter(h => h.id !== id));
      }
    });
  };

  const handleExportHarvestCSV = () => {
    const headers = ['Réf Récolte', 'Parcelle / Bloc', 'Variété Culture', 'Volume Kg', 'Coût Direct', 'Catégorie A %'];
    const rows = harvestLogs.map(h => [h.id, h.parcelle, h.variete, h.kg, h.coutParKg, h.catA]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `suivi_recolte_${activeFarm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredTasks = tasks.filter(t => {
    if (taskFilter === 'en_cours') return t.status === 'en_cours';
    if (taskFilter === 'terminee') return t.status === 'terminee';
    return true;
  });

  const filteredHarvestLogs = harvestLogs.filter(h => {
    return h.parcelle.toLowerCase().includes(searchQuery.toLowerCase()) || h.variete.toLowerCase().includes(searchQuery.toLowerCase()) || h.id.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Harvest KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Total Récolté (Kg)"
          value={`${totalHarvestKg.toLocaleString('fr-FR')} kg`}
          subtext="Rendement cumulé"
          trend="+14.2%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Somme totale des apports récoltés"
        />
        <UiStatCard
          label="Rendement Moyen Par Hectare"
          value="14.8 T/ha"
          subtext="Objectif: 15 T/ha"
          trend="+2.4%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Rendement moyen sur l'exploitation"
        />
        <UiStatCard
          label="Coût Moyen Récolte / Kg"
          value="1.85 DH / kg"
          subtext="Coût direct cueillette"
          trend="-0.12 DH"
          highlightColor="var(--emerald-600)"
          infoTooltip="Coût direct de récolte par kg"
        />
        <UiStatCard
          label="Tâches Récolte Complétées"
          value={`${completedTasksCount} / ${tasks.length}`}
          subtext="Checklist terrain active"
          trend={`${Math.round((completedTasksCount / (tasks.length || 1)) * 100)}% accompli`}
          highlightColor="var(--indigo-600)"
          infoTooltip="Avancement des tâches prioritaires"
        />
      </div>

      {/* Main Section: Interactive Tasks Checklist Manager */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>
              Tâches Prioritaires & Urentes — {activeFarm}
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{completedTasksCount} sur {tasks.length} tâches terminées</p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {/* Task Filter Pills */}
            <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-subtle)', padding: '3px', borderRadius: 'var(--radius-md)' }}>
              <button onClick={() => setTaskFilter('tous')} style={{ padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: taskFilter === 'tous' ? '700' : '500', backgroundColor: taskFilter === 'tous' ? 'var(--bg-card)' : 'transparent', border: 'none', cursor: 'pointer' }}>Toutes</button>
              <button onClick={() => setTaskFilter('en_cours')} style={{ padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: taskFilter === 'en_cours' ? '700' : '500', backgroundColor: taskFilter === 'en_cours' ? 'var(--bg-card)' : 'transparent', border: 'none', cursor: 'pointer' }}>En cours</button>
              <button onClick={() => setTaskFilter('terminee')} style={{ padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: taskFilter === 'terminee' ? '700' : '500', backgroundColor: taskFilter === 'terminee' ? 'var(--bg-card)' : 'transparent', border: 'none', cursor: 'pointer' }}>Terminées</button>
            </div>

            <button onClick={() => setShowAddTaskModal(true)} style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--emerald-50)', color: 'var(--emerald-600)', border: '1px solid var(--emerald-200)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Ajouter une tâche">
              <i className="fa-solid fa-plus"></i>
            </button>
          </div>
        </div>

        {/* Task Items Checklist */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredTasks.map(t => {
            const isDone = t.status === 'terminee';
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', backgroundColor: isDone ? 'var(--bg-subtle)' : 'var(--bg-card)', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  {/* Interactive Checkbox */}
                  <input
                    type="checkbox"
                    checked={isDone}
                    onChange={() => handleToggleTaskStatus(t.id)}
                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--emerald-600)' }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: isDone ? 'var(--text-muted)' : 'var(--text-main)', textDecoration: isDone ? 'line-through' : 'none' }}>
                      {t.text}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {t.dateLabel} • Domain: <strong>{t.domain}</strong>
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', position: 'relative' }}>
                  <UiBadge variant={isDone ? 'emerald' : 'amber'}>{isDone ? 'Terminée' : 'En cours'}</UiBadge>
                  <span style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                    {t.userInitials}
                  </span>

                  {/* WORKING THREE-DOTS MENU dropdown */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setOpenTaskMenuId(openTaskMenuId === t.id ? null : t.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px', fontSize: '14px' }}
                    >
                      <i className="fa-solid fa-ellipsis-vertical"></i>
                    </button>

                    {openTaskMenuId === t.id && (
                      <div style={{ position: 'absolute', right: 0, top: '28px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: '6px', zIndex: 50, width: '160px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <button onClick={() => { handleToggleTaskStatus(t.id); setOpenTaskMenuId(null); }} style={{ padding: '6px 10px', textAlign: 'left', background: 'none', border: 'none', fontSize: '12px', cursor: 'pointer', color: 'var(--text-main)' }}>
                          <i className="fa-solid fa-check" style={{ marginRight: '8px' }}></i> {isDone ? 'Marquer En Cours' : 'Marquer Terminée'}
                        </button>
                        <button onClick={() => handleDeleteTask(t.id)} style={{ padding: '6px 10px', textAlign: 'left', background: 'none', border: 'none', fontSize: '12px', cursor: 'pointer', color: 'var(--rose-500)' }}>
                          <i className="fa-solid fa-trash" style={{ marginRight: '8px' }}></i> Supprimer
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Harvest Records Data Table with Full CRUD */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Journal des Apports Récolte & Coûts — {activeFarm}</h4>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Suivi des volumes cueillis par parcelle et coût de récolte direct</p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Rechercher parcelle/variété..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', outline: 'none' }}
            />
            <button onClick={handleExportHarvestCSV} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-download" style={{ marginRight: '6px' }}></i> Exporter CSV
            </button>
            <button onClick={() => setShowAddHarvestModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Saisie Récolte
            </button>
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Réf Récolte</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Parcelle / Bloc</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Variété Culture</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Volume Cueilli</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Coût Direct / Kg</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>% Catégorie A</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredHarvestLogs.map((h, idx) => (
                <tr key={h.id} style={{ borderBottom: idx === filteredHarvestLogs.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{h.id}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{h.parcelle}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{h.variete}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{h.kg}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{h.coutParKg}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{h.catA}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <button onClick={() => handleDeleteHarvest(h.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Add Harvest Entry */}
      {showAddHarvestModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddHarvest} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Apport Récolte Terrain</h3>
            <input type="text" placeholder="Parcelle / Bloc (ex: Bloc A1) *" required value={hParcelle} onChange={e => setHParcelle(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <select value={hVariete} onChange={e => setHVariete(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <option value="Fraise Star">Fraise Star</option>
              <option value="Framboise Diamond">Framboise Diamond</option>
              <option value="Myrtille Blue">Myrtille Blue</option>
            </select>
            <input type="number" placeholder="Volume Cueilli Kg *" required value={hKg} onChange={e => setHKg(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddHarvestModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer Apport</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Add Task */}
      {showAddTaskModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddTask} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Création Nouvelle Tâche</h3>
            <input type="text" placeholder="Intitulé de la tâche *" required value={tTitle} onChange={e => setTTitle(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <select value={tDomain} onChange={e => setTDomain(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <option value="Finance">Finance</option>
              <option value="Qualité">Qualité</option>
              <option value="RH">RH</option>
              <option value="Agronomie">Agronomie</option>
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddTaskModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Créer Tâche</button>
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
