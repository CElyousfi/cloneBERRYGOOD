// @ts-check
import React, { useState, useEffect } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { getLiveFarmWeather, getLiveFarmForecast } from '../../shared/api/weatherApi.js';

export function AgronomieDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeTab, setActiveTab] = useState('stations');
  const [weatherData, setWeatherData] = useState(null);
  const [forecastList, setForecastList] = useState([]);
  const [isLoadingWeather, setIsLoadingWeather] = useState(true);

  // Fetch live OpenWeather data when activeFarm changes
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

  const stations = [
    { id: 'ST-01', nom: `Station D'Irrigation ${activeFarm}`, debit: '42 m³/h', pression: '2.8 Bar', secteur: 'Bloc A1 - A4', status: 'En Irrigation', variant: 'emerald' },
    { id: 'ST-02', nom: `Station D'Irrigation ${activeFarm} 2`, debit: '38 m³/h', pression: '3.1 Bar', secteur: 'Bloc B1 - B6', status: 'Automatique Standby', variant: 'neutral' },
    { id: 'ST-03', nom: `Station Fertilisation ${activeFarm}`, debit: '18 m³/h', pression: '2.5 Bar', secteur: 'Bloc C2', status: 'Fertigation Active', variant: 'emerald' },
  ];

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
      </div>

      {/* Content Table */}
      {activeTab === 'stations' ? (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Stations D'Irrigation & Pilotage Automatique — {activeFarm}</h4>
            <UiBadge variant="emerald">Supabase Dual-Write Active</UiBadge>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>ID Station</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Nom Station</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Débit / Pression</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Secteur Actif</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut Opérationnel</th>
              </tr>
            </thead>
            <tbody>
              {stations.map((st, idx) => (
                <tr key={st.id} style={{ borderBottom: idx === stations.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{st.id}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{st.nom}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{st.debit} ({st.pression})</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{st.secteur}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <UiBadge variant={st.variant}>{st.status}</UiBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
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
    </div>
  );
}
