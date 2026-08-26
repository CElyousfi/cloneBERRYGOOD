// @ts-check
import React, { useState, useEffect } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { getLiveFarmWeather, getLiveFarmForecast } from '../../shared/api/weatherApi.js';
import { AppConfirmModal } from '../../shared/components/AppConfirmModal';

export function AgronomieDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeTab, setActiveTab] = useState('stations');
  const [searchQuery, setSearchQuery] = useState('');
  const [weatherData, setWeatherData] = useState(null);
  const [forecastList, setForecastList] = useState([]);
  const [isLoadingWeather, setIsLoadingWeather] = useState(true);
  const [showAddStationModal, setShowAddStationModal] = useState(false);
  const [showAddPhytoModal, setShowAddPhytoModal] = useState(false);

  // Custom Confirm Modal State
  const [confirmModalState, setConfirmModalState] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // Form states — Station
  const [stName, setStName] = useState('');
  const [stFlow, setStFlow] = useState('40 m³/h');
  const [stSector, setStSector] = useState('Bloc A1');

  // Form states — Phyto
  const [phyProduit, setPhyProduit] = useState('');
  const [phyParcelle, setPhyParcelle] = useState('Bloc A1');
  const [phyDar, setPhyDar] = useState('7');

  // Clean Production State Arrays
  const [stations, setStations] = useState([]);
  const [phytos, setPhytos] = useState([]);

  useEffect(() => {
    let isMounted = true;
    async function loadWeather() {
      setIsLoadingWeather(true);
      const [current, forecast] = await Promise.all([
        getLiveFarmWeather(activeFarm),
        getLiveFarmForecast(activeFarm)
      ]);
      if (isMounted) {
        setWeatherData(current);
        setForecastList(forecast);
        setIsLoadingWeather(false);
      }
    }
    loadWeather();
    return () => { isMounted = false; };
  }, [activeFarm]);

  const handleAddStation = (e) => {
    e.preventDefault();
    if (!stName) return;

    const newSt = {
      id: `ST-${Date.now().toString().slice(-2)}`,
      nom: stName,
      debit: stFlow,
      pression: '2.8 Bar',
      secteur: stSector,
      status: 'En Irrigation',
      variant: 'emerald'
    };

    setStations([newSt, ...stations]);
    setShowAddStationModal(false);
    setStName('');
  };

  const handleAddPhyto = (e) => {
    e.preventDefault();
    if (!phyProduit) return;

    const darDays = parseInt(phyDar) || 7;
    const dateAppl = new Date();
    const dateRecolteAutorisee = new Date(dateAppl.getTime() + darDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const newPhy = {
      id: `PHY-${Date.now().toString().slice(-3)}`,
      produit: phyProduit,
      parcelle: phyParcelle,
      dateApplication: dateAppl.toISOString().split('T')[0],
      dar: `${darDays} jours`,
      recolteAutorisee: dateRecolteAutorisee,
      statut: 'Délai DAR en cours',
      variant: 'amber'
    };

    setPhytos([newPhy, ...phytos]);
    setShowAddPhytoModal(false);
    setPhyProduit('');
  };

  const handleToggleStation = (id) => {
    setStations(stations.map(st => {
      if (st.id === id) {
        const isIrrigating = st.status === 'En Irrigation' || st.status === 'Fertigation Active';
        return {
          ...st,
          status: isIrrigating ? 'Automatique Standby' : 'En Irrigation',
          variant: isIrrigating ? 'neutral' : 'emerald'
        };
      }
      return st;
    }));
  };

  const handleDeleteStation = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Station d\'Irrigation',
      message: `Voulez-vous vraiment supprimer la station ${id} ?`,
      onConfirm: () => {
        setStations(stations.filter(s => s.id !== id));
      }
    });
  };

  const handleDeletePhyto = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Traitement Phyto',
      message: `Voulez-vous vraiment supprimer le registre de traitement ${id} ?`,
      onConfirm: () => {
        setPhytos(phytos.filter(p => p.id !== id));
      }
    });
  };

  const handleExportAgronomieCSV = () => {
    const headers = ['ID Station', 'Nom Station', 'Débit / Pression', 'Secteur Actif', 'Statut'];
    const rows = stations.map(s => [s.id, s.nom, `${s.debit} (${s.pression})`, s.secteur, s.status]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `irrigation_stations_${activeFarm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredStations = stations.filter(s => s.nom.toLowerCase().includes(searchQuery.toLowerCase()) || s.id.toLowerCase().includes(searchQuery.toLowerCase()) || s.secteur.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredPhytos = phytos.filter(p => p.produit.toLowerCase().includes(searchQuery.toLowerCase()) || p.parcelle.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top OpenWeather Live Climate KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Température Extérieure (Live)"
          value={isLoadingWeather ? '...' : `${weatherData?.temp ?? 24.5} °C`}
          subtext={weatherData?.description ?? 'OpenWeather Sync'}
          trend={isLoadingWeather ? '...' : `Ressenti ${weatherData?.feelsLike ?? 25} °C`}
          highlightColor="var(--emerald-600)"
          infoTooltip="Données météo en direct de l'API OpenWeather"
        />
        <UiStatCard
          label="Hygrométrie Serres (Live)"
          value={isLoadingWeather ? '...' : `${weatherData?.humidity ?? 68} %`}
          subtext="Plage idéale: 60-75%"
          trend="Conforme"
          highlightColor="var(--emerald-600)"
          infoTooltip="Humidité de l'air en temps réel"
        />
        <UiStatCard
          label="Vitesse du Vent (Live)"
          value={isLoadingWeather ? '...' : `${weatherData?.windSpeed ?? 14} km/h`}
          subtext={weatherData?.region ?? 'Souss / Loukkos'}
          trend="Vent modéré"
          highlightColor="var(--indigo-600)"
          infoTooltip="Vitesse du vent captée par la station OpenWeather"
        />
        <UiStatCard
          label="GDD Quotidien (Degrés Jours)"
          value={isLoadingWeather ? '...' : `+${weatherData?.gddDaily ?? 14.5} GDD`}
          subtext="Base 10°C — Phénologie"
          trend="Croissance optimale"
          highlightColor="var(--amber-500)"
          infoTooltip="Growing Degree Days pour la maturation des fruits"
        />
      </div>

      {/* Sub-Tab Navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <button
          onClick={() => setActiveTab('stations')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'stations' ? '700' : '500',
            backgroundColor: activeTab === 'stations' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'stations' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'stations' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-faucet-drip" style={{ marginRight: '6px' }}></i>
          Stationnaire & Pilotage Irrigation
        </button>
        <button
          onClick={() => setActiveTab('meteo')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'meteo' ? '700' : '500',
            backgroundColor: activeTab === 'meteo' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'meteo' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'meteo' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-cloud-sun" style={{ marginRight: '6px' }}></i>
          Météo & Forecast Climat (OpenWeather Live)
        </button>
        <button
          onClick={() => setActiveTab('phyto')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'phyto' ? '700' : '500',
            backgroundColor: activeTab === 'phyto' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'phyto' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'phyto' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-spray-can" style={{ marginRight: '6px' }}></i>
          Traitements Phytosanitaires & DAR
        </button>
      </div>

      {/* Content Views */}
      {activeTab === 'stations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Stations D'Irrigation & Pilotage Automatique — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Contrôle des débits, pressions et vannes de fertilisation en direct</p>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Rechercher station/secteur..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', outline: 'none' }}
              />
              <button onClick={handleExportAgronomieCSV} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-download" style={{ marginRight: '6px' }}></i> Exporter CSV
              </button>
              <button onClick={() => setShowAddStationModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Nouvelle Station
              </button>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredStations.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-faucet-drip" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucune station enregistrée</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Nouvelle Station"</strong> pour créer votre première vanne ou station d'irrigation.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>ID Station</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Nom Station</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Débit / Pression</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Secteur Actif</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Opérationnel</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStations.map((st, idx) => (
                    <tr key={st.id} style={{ borderBottom: idx === filteredStations.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{st.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{st.nom}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{st.debit} ({st.pression})</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{st.secteur}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleToggleStation(st.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
                          <UiBadge variant={st.variant}>{st.status} ➔</UiBadge>
                        </button>
                      </td>
                      <td style={{ padding: '14px 20px', display: 'flex', gap: '8px' }}>
                        <button onClick={() => handleToggleStation(st.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-subtle)', fontSize: '11px', cursor: 'pointer' }}>
                          Basculer Statut
                        </button>
                        <button onClick={() => handleDeleteStation(st.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
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

      {activeTab === 'meteo' && (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>
              Prévisions Météorologiques 5 Jours en Direct — {weatherData?.region || activeFarm}
            </h4>
            <UiBadge variant="emerald">OpenWeather Live Sync</UiBadge>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Journée</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Température Max</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Hygrométrie Moy.</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Vitesse Vent</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Conditions Météo</th>
              </tr>
            </thead>
            <tbody>
              {forecastList.map((m, idx) => (
                <tr key={m.jour} style={{ borderBottom: idx === forecastList.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{m.jour}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{m.temp}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{m.hygro}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{m.vent}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <UiBadge variant="emerald">{m.cond}</UiBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'phyto' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Registre des Traitements Phytosanitaires & DAR — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Contrôle des Délais Avant Récolte (DAR) et sécurité alimentaire</p>
            </div>
            <button onClick={() => setShowAddPhytoModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Nouveau Traitement Phyto
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredPhytos.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-spray-can" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun traitement phytosanitaire en cours</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Nouveau Traitement Phyto"</strong> pour enregistrer une application de produit.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Réf Traitement</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Produit Phytosanitaire</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Parcelle Concernée</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Application</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>DAR (Jours)</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Récolte Autorisée</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPhytos.map((p, idx) => (
                    <tr key={p.id} style={{ borderBottom: idx === filteredPhytos.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{p.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{p.produit}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{p.parcelle}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{p.dateApplication}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--amber-500)' }}>{p.dar}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{p.recolteAutorisee}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <UiBadge variant={p.variant}>{p.statut}</UiBadge>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeletePhyto(p.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
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
      {showAddStationModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddStation} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Création Nouvelle Station / Vanne</h3>
            <input type="text" placeholder="Nom de la Station (ex: Station Irrigation Serre 4) *" required value={stName} onChange={e => setStName(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Débit Nominal (ex: 45 m³/h)" value={stFlow} onChange={e => setStFlow(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Secteur Actif (ex: Bloc A1-A4)" value={stSector} onChange={e => setStSector(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddStationModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Créer Station</button>
            </div>
          </form>
        </div>
      )}

      {showAddPhytoModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddPhyto} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Traitement Phytosanitaire</h3>
            <input type="text" placeholder="Produit Phytosanitaire (ex: Fungicide Switch) *" required value={phyProduit} onChange={e => setPhyProduit(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Parcelle Concernée (ex: Bloc A1) *" required value={phyParcelle} onChange={e => setPhyParcelle(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Délai DAR en jours (ex: 7) *" required value={phyDar} onChange={e => setPhyDar(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddPhytoModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer Traitement</button>
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
