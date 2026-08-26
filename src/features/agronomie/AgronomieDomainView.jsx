// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';

export function AgronomieDomainView({ activeFarm }) {
  const [activeTab, setActiveTab] = useState('stations');

  const stations = [
    { id: 'ST-01', nom: 'Station D\'Irrigation Souss 1', debit: '42 m³/h', pression: '2.8 Bar', secteur: 'Bloc A1 - A4', status: 'En Irrigation', variant: 'emerald' },
    { id: 'ST-02', nom: 'Station D\'Irrigation Souss 2', debit: '38 m³/h', pression: '3.1 Bar', secteur: 'Bloc B1 - B6', status: 'Automatique Standby', variant: 'neutral' },
    { id: 'ST-03', nom: 'Station Fertilisation Loukkos', debit: '18 m³/h', pression: '2.5 Bar', secteur: 'Bloc C2', status: 'Fertigation Active', variant: 'emerald' },
  ];

  const meteoForecast = [
    { jour: 'Aujourd\'hui', temp: '24.5 °C', hygro: '68 %', vent: '12 km/h', cond: 'Ensoleillé', variant: 'emerald' },
    { jour: 'Demain (J+1)', temp: '26.0 °C', hygro: '62 %', vent: '15 km/h', cond: 'Belles Éclaircies', variant: 'emerald' },
    { jour: 'Après-demain (J+2)', temp: '23.0 °C', hygro: '74 %', vent: '18 km/h', cond: 'Passages Nuageux', variant: 'indigo' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Agronomie KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Température Extérieure"
          value="24.5 °C"
          subtext="Capteurs Meteoblue"
          trend="Vent 12 km/h"
          highlightColor="var(--emerald-600)"
          infoTooltip="Température extérieure sous abri"
        />
        <UiStatCard
          label="Hygrométrie Serres"
          value="68 %"
          subtext="Plage idéale: 60-75%"
          trend="Conforme"
          highlightColor="var(--emerald-600)"
          infoTooltip="Humidité relative de l'air sous serre"
        />
        <UiStatCard
          label="Volume d'Eau Appliqué"
          value="340 m³"
          subtext="Pilotage automatique"
          trend="100% Reco IA"
          highlightColor="var(--indigo-600)"
          infoTooltip="Volume quotidien d'irrigation distribué"
        />
        <UiStatCard
          label="GDD Cumulé (Degrés Jours)"
          value="1,420 GDD"
          subtext="Stade phénologique: Pic de Récolte"
          trend="+18 GDD/j"
          highlightColor="var(--amber-500)"
          infoTooltip="Cumul des températures de croissance"
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
          Météo & Forecast Climat
        </button>
      </div>

      {/* Content Table */}
      {activeTab === 'stations' ? (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Stations D'Irrigation & Pilotage Automatique</h4>
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
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Prévisions Météorologiques (API Meteoblue)</h4>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Journée</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Température Max</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Hygrométrie Moy.</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Vitesse Vent</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Conditions</th>
              </tr>
            </thead>
            <tbody>
              {meteoForecast.map((m, idx) => (
                <tr key={m.jour} style={{ borderBottom: idx === meteoForecast.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{m.jour}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{m.temp}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{m.hygro}</td>
                  <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{m.vent}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <UiBadge variant={m.variant}>{m.cond}</UiBadge>
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
