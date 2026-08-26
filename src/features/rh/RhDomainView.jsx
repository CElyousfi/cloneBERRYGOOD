// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { AppConfirmModal } from '../../shared/components/AppConfirmModal';
import { DocumentViewerModal } from '../../shared/components/DocumentViewerModal';

export function RhDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeSubTab, setActiveSubTab] = useState('pointage');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDoc, setSelectedDoc] = useState(null);

  // Custom Confirm Modal State
  const [confirmModalState, setConfirmModalState] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // Modal Trigger States
  const [showAddPointageModal, setShowAddPointageModal] = useState(false);
  const [showAddPaieModal, setShowAddPaieModal] = useState(false);
  const [showAddTransportModal, setShowAddTransportModal] = useState(false);
  const [showAddAvanceModal, setShowAddAvanceModal] = useState(false);

  // Form states — Pointage
  const [pMatricule, setPMatricule] = useState('');
  const [pNom, setPNom] = useState('');
  const [pKg, setPKg] = useState('50');

  // Form states — Paie Ojra
  const [paieNom, setPaieNom] = useState('');
  const [paiePoste, setPaiePoste] = useState('Ouvrier Cueilleur');
  const [paieJours, setPaieJours] = useState('13');
  const [paiePrimes, setPaiePrimes] = useState('450');

  // Form states — Transport
  const [trTrajet, setTrTrajet] = useState('Navette Agadir - Ferme Souss');
  const [trTransporteur, setTrTransporteur] = useState('TransSouss Sarl');
  const [trCout, setTrCout] = useState('650');

  // Form states — Avance / Acompte
  const [avNom, setAvNom] = useState('');
  const [avMontant, setAvMontant] = useState('500');

  // Clean Production State Arrays (0 Fake Data)
  const [pointages, setPointages] = useState([]);
  const [bulletinsPaie, setBulletinsPaie] = useState([]);
  const [transports, setTransports] = useState([]);
  const [avances, setAvances] = useState([]);

  // REAL-TIME DYNAMIC RH RECALCULATION ENGINE
  const effectifPointe = pointages.length;
  const totalKgSum = pointages.reduce((acc, p) => acc + (p.rawKg || 0), 0);
  const totalPointageCout = pointages.reduce((acc, p) => acc + (p.rawCout || 0), 0);
  const totalNetPaie = bulletinsPaie.reduce((acc, b) => acc + (b.rawNet || 0), 0);
  const totalTransportCout = transports.reduce((acc, t) => acc + (t.rawCout || 0), 0);
  const totalAvancesSum = avances.reduce((acc, a) => acc + (a.rawMontant || 0), 0);

  const dynamicMasseSalariale = totalPointageCout + totalNetPaie;
  const dynamicAvgHarvestCost = totalKgSum > 0 ? Math.round((totalPointageCout / totalKgSum) * 100) / 100 : 0;

  // --- HANDLERS ---
  const handleAddPointage = (e) => {
    e.preventDefault();
    if (!pNom) return;

    const mat = pMatricule || `OUV-${Math.floor(100 + Math.random() * 900)}`;
    const kg = parseFloat(pKg) || 45;
    const cout = Math.round(kg * 1.85 * 100) / 100;

    const newP = {
      matricule: mat,
      nom: pNom,
      equipe: `${activeFarm.includes('Souss') ? 'Souss' : 'Loukkos'} Équipe 1`,
      heureArrivee: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      kgCueillis: `${kg} kg`,
      rawKg: kg,
      coutDirect: `${cout} MAD`,
      rawCout: cout,
      status: 'Présent (Validé Chef)',
      variant: 'emerald'
    };

    setPointages([newP, ...pointages]);
    setShowAddPointageModal(false);
    setPMatricule(''); setPNom('');
  };

  const handleAddPaie = (e) => {
    e.preventDefault();
    if (!paieNom) return;

    const jours = parseFloat(paieJours) || 13;
    const smagRate = 84.37; // Moroccan SMAG daily rate
    const salaireBase = Math.round(jours * smagRate * 100) / 100;
    const primes = parseFloat(paiePrimes) || 0;
    const cnss = Math.round((salaireBase + primes) * 0.0448 * 100) / 100; // CNSS worker share ~4.48%
    const net = Math.round((salaireBase + primes - cnss) * 100) / 100;

    const newB = {
      id: `OJRA-${Date.now().toString().slice(-4)}`,
      nom: paieNom,
      poste: paiePoste,
      quinzaine: 'Quinzaine 16',
      joursTravailles: `${jours} jrs`,
      salaireBase: `${salaireBase.toLocaleString('fr-FR')} MAD`,
      primes: `${primes.toLocaleString('fr-FR')} MAD`,
      cnss: `${cnss.toLocaleString('fr-FR')} MAD`,
      netAPayer: `${net.toLocaleString('fr-FR')} MAD`,
      rawNet: net,
      statut: 'Calculé & Validé',
      variant: 'emerald',
      documentUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
    };

    setBulletinsPaie([newB, ...bulletinsPaie]);
    setShowAddPaieModal(false);
    setPaieNom('');
  };

  const handleAddTransport = (e) => {
    e.preventDefault();
    if (!trTrajet) return;

    const cout = parseFloat(trCout) || 0;
    const newT = {
      id: `TR-${Date.now().toString().slice(-3)}`,
      trajet: trTrajet,
      transporteur: trTransporteur,
      date: new Date().toISOString().split('T')[0],
      cout: `${cout.toLocaleString('fr-FR')} MAD`,
      rawCout: cout,
      statut: 'Facturé & Réglé',
      variant: 'emerald'
    };

    setTransports([newT, ...transports]);
    setShowAddTransportModal(false);
    setTrTrajet('');
  };

  const handleAddAvance = (e) => {
    e.preventDefault();
    if (!avNom) return;

    const amt = parseFloat(avMontant) || 0;
    const newA = {
      id: `AV-${Date.now().toString().slice(-3)}`,
      nom: avNom,
      date: new Date().toISOString().split('T')[0],
      montant: `${amt.toLocaleString('fr-FR')} MAD`,
      rawMontant: amt,
      mode: 'Espèces (Caisse)',
      statut: 'Déduit sur Paie',
      variant: 'indigo'
    };

    setAvances([newA, ...avances]);
    setShowAddAvanceModal(false);
    setAvNom('');
  };

  const handleDeletePointage = (mat) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression de Pointage',
      message: `Voulez-vous vraiment supprimer le pointage de l'ouvrier ${mat} ?`,
      onConfirm: () => {
        setPointages(pointages.filter(p => p.matricule !== mat));
      }
    });
  };

  const handleDeletePaie = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Bulletin Ojra',
      message: `Voulez-vous vraiment supprimer le bulletin de paie ${id} ?`,
      onConfirm: () => {
        setBulletinsPaie(bulletinsPaie.filter(b => b.id !== id));
      }
    });
  };

  const handleDeleteTransport = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Course Transport',
      message: `Voulez-vous vraiment supprimer la course transport ${id} ?`,
      onConfirm: () => {
        setTransports(transports.filter(t => t.id !== id));
      }
    });
  };

  const handleDeleteAvance = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Acompte / Avance',
      message: `Voulez-vous vraiment supprimer l'acompte ${id} ?`,
      onConfirm: () => {
        setAvances(avances.filter(a => a.id !== id));
      }
    });
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
    { id: 'pointage', label: 'Pointage Journalier', icon: 'fa-user-check' },
    { id: 'paie', label: 'Paie & Bulletins (Ojra)', icon: 'fa-money-bill-wave' },
    { id: 'transport', label: 'Transport & Logistique', icon: 'fa-bus' },
    { id: 'avances', label: 'Contrats & Avances', icon: 'fa-hand-holding-dollar' },
  ];

  const filteredPointages = pointages.filter(p => p.nom.toLowerCase().includes(searchQuery.toLowerCase()) || p.matricule.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredPaie = bulletinsPaie.filter(b => b.nom.toLowerCase().includes(searchQuery.toLowerCase()) || b.id.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredTransports = transports.filter(t => t.trajet.toLowerCase().includes(searchQuery.toLowerCase()) || t.transporteur.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredAvances = avances.filter(a => a.nom.toLowerCase().includes(searchQuery.toLowerCase()) || a.id.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* REAL-TIME DYNAMIC RH KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Effectif Pointé Auj."
          value={`${effectifPointe} ouvriers`}
          subtext={`${effectifPointe} présents enregistrés`}
          trend="0.0%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Nombre total d'ouvriers enregistrés au pointage matin"
        />
        <UiStatCard
          label="Masse Salariale Brute"
          value={`${dynamicMasseSalariale.toLocaleString('fr-FR')} MAD`}
          subtext={`${bulletinsPaie.length} bulletins calculés`}
          trend="0.0%"
          highlightColor="var(--berry-600)"
          infoTooltip="Montant total direct du pointage et des bulletins Ojra"
        />
        <UiStatCard
          label="Frais Transport Ouvriers"
          value={`${totalTransportCout.toLocaleString('fr-FR')} MAD`}
          subtext={`${transports.length} courses navette`}
          trend="0.0%"
          highlightColor="var(--indigo-600)"
          infoTooltip="Coût logistique des navettes de transport"
        />
        <UiStatCard
          label="Total Acomptes & Avances"
          value={`${totalAvancesSum.toLocaleString('fr-FR')} MAD`}
          subtext={`${avances.length} avances accordées`}
          trend="À déduire paie"
          highlightColor="var(--amber-500)"
          infoTooltip="Montant global des avances à déduire sur le bulletin"
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

      {/* SUB-TAB 1: POINTAGE JOURNALIER */}
      {activeSubTab === 'pointage' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Pointage Journalier des Ouvriers — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Contrôle de présence terrain & pesée récolte par ouvrier</p>
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
            {filteredPointages.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-user-check" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun pointage enregistré aujourd'hui</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Nouveau Pointage"</strong> pour enregistrer la présence d'un ouvrier.</p>
              </div>
            ) : (
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
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: PAIE & BULLETINS (OJRA) */}
      {activeSubTab === 'paie' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Calculateur Paie & Bulletins de Salaire (Ojra) — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Barème SMAG Marocain (84.37 DH/jour) + Primes de rendement & CNSS</p>
            </div>
            <button onClick={() => setShowAddPaieModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Générer Bulletin Ojra
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredPaie.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-file-invoice" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun bulletin Ojra calculé</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Générer Bulletin Ojra"</strong> pour calculer le salaire quinzaine d'un ouvrier.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>N° Bulletin</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Nom & Prénom</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Poste / Fonction</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Jours Travaillés</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Base SMAG</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Primes</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>CNSS (-4.48%)</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Net à Payer</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Bulletin</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPaie.map((b, idx) => (
                    <tr key={b.id} style={{ borderBottom: idx === filteredPaie.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{b.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{b.nom}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{b.poste}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{b.joursTravailles}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{b.salaireBase}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--emerald-600)', fontWeight: '600' }}>{b.primes}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--rose-500)' }}>{b.cnss}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{b.netAPayer}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <button
                          onClick={() => setSelectedDoc({ title: `Bulletin Paie Ojra ${b.id} — ${b.nom}`, url: b.documentUrl })}
                          style={{ padding: '5px 10px', borderRadius: '4px', border: '1px solid var(--emerald-600)', backgroundColor: 'var(--emerald-50)', color: 'var(--emerald-700)', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <i className="fa-solid fa-eye"></i> Voir Bulletin
                        </button>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeletePaie(b.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
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

      {/* SUB-TAB 3: TRANSPORT & LOGISTIQUE */}
      {activeSubTab === 'transport' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Suivi Navettes & Transport des Ouvriers — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Contrats prestataires de transport & ramassage ouvriers</p>
            </div>
            <button onClick={() => setShowAddTransportModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Saisie Course Transport
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredTransports.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-bus" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucune course de transport enregistrée</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Saisie Course Transport"</strong> pour enregistrer une navette ouvriers.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Réf Navette</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Itinéraire / Trajet</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Prestataire Transport</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Course</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Coût Transport</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransports.map((t, idx) => (
                    <tr key={t.id} style={{ borderBottom: idx === filteredTransports.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{t.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{t.trajet}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{t.transporteur}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{t.date}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{t.cout}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <UiBadge variant={t.variant}>{t.statut}</UiBadge>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeleteTransport(t.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
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

      {/* SUB-TAB 4: CONTRATS & AVANCES */}
      {activeSubTab === 'avances' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Gestion des Acomptes & Avances sur Salaire — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Enregistrement des acomptes versés avant le calcul Ojra quinzaine</p>
            </div>
            <button onClick={() => setShowAddAvanceModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Saisie Acompte / Avance
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredAvances.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-hand-holding-dollar" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun acompte accordé</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Saisie Acompte / Avance"</strong> pour accorder une avance sur salaire.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Réf Avance</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Nom Ouvrier</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Versements</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Montant Avance</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Mode Paiement</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Ojra</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAvances.map((a, idx) => (
                    <tr key={a.id} style={{ borderBottom: idx === filteredAvances.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{a.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{a.nom}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{a.date}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--amber-500)' }}>{a.montant}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{a.mode}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <UiBadge variant={a.variant}>{a.statut}</UiBadge>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeleteAvance(a.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
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

      {/* Modal Add Paie Ojra */}
      {showAddPaieModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddPaie} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Génération Bulletin de Paie (Ojra)</h3>
            <input type="text" placeholder="Nom & Prénom Ouvrier *" required value={paieNom} onChange={e => setPaieNom(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Poste / Fonction (ex: Ouvrier Cueilleur)" value={paiePoste} onChange={e => setPaiePoste(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Nombre de Jours Travaillés (ex: 13) *" required value={paieJours} onChange={e => setPaieJours(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Primes de Rendement MAD (ex: 450)" value={paiePrimes} onChange={e => setPaiePrimes(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddPaieModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Calculer & Générer</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Add Transport */}
      {showAddTransportModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddTransport} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Course Transport Ouvriers</h3>
            <input type="text" placeholder="Itinéraire / Trajet (ex: Agadir - Ferme Souss) *" required value={trTrajet} onChange={e => setTrTrajet(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Prestataire / Transporteur *" required value={trTransporteur} onChange={e => setTrTransporteur(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Coût Course MAD *" required value={trCout} onChange={e => setTrCout(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddTransportModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer Course</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Add Avance */}
      {showAddAvanceModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddAvance} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Acompte / Avance sur Salaire</h3>
            <input type="text" placeholder="Nom & Prénom Ouvrier *" required value={avNom} onChange={e => setAvNom(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Montant Avance MAD *" required value={avMontant} onChange={e => setAvMontant(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddAvanceModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer Acompte</button>
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
