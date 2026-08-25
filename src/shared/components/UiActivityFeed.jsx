// @ts-check
import React from 'react';

/**
 * Activity Feed component inspired directly by the right column "Activity" log in Bonsai.
 * Renders chronological event log entries with bullet status dots, formatted bold text, timestamps, and action links.
 */
export function UiActivityFeed({ activities = null }) {
  const defaultActivities = [
    {
      id: 'act-1',
      actor: 'Ingénieur Qualité',
      action: 'a complété le rapport d\'inspection',
      target: 'Lot Fraises Souss #B-9402',
      time: '26 Fév, 2026 14:15',
      linkText: 'Voir Rapport'
    },
    {
      id: 'act-2',
      actor: 'Chef d\'Exploitation',
      action: 'a validé le pointage récolte',
      target: 'Equipe #3 - Ferme Loukkos',
      time: '26 Fév, 2026 13:40',
      linkText: null
    },
    {
      id: 'act-3',
      actor: 'Service Finance',
      action: 'a généré le virement fournisseur',
      target: 'Agro Chimique SA (65,400 MAD)',
      time: '26 Fév, 2026 12:10',
      linkText: 'Voir Virement'
    },
    {
      id: 'act-4',
      actor: 'Station Irrigation #2',
      action: 'a exécuté le programme automatique',
      target: 'Secteur 4B (Durée 45 min)',
      time: '26 Fév, 2026 10:30',
      linkText: null
    },
    {
      id: 'act-5',
      actor: 'Magasinier Stock',
      action: 'a enregistré l\'entrée de stock',
      target: '500x Caisses Emballage 500g',
      time: '26 Fév, 2026 09:15',
      linkText: 'Bon de Réception'
    },
    {
      id: 'act-6',
      actor: 'Système Météo',
      action: 'a mis à jour la prévision extérieure',
      target: 'Température Max +28°C détectée',
      time: '26 Fév, 2026 08:00',
      linkText: null
    }
  ];

  const items = activities || defaultActivities;

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}
    >
      {/* Title */}
      <h3
        style={{
          fontSize: '18px',
          fontWeight: '700',
          color: 'var(--text-main)',
          fontFamily: 'var(--font-display)',
          letterSpacing: '-0.01em'
        }}
      >
        Activité en Direct
      </h3>

      {/* Activity Timeline List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {items.map(item => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              position: 'relative'
            }}
          >
            {/* Green Bullet Dot (Bonsai style) */}
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: 'var(--emerald-600)',
                flexShrink: 0,
                marginTop: '6px'
              }}
            />

            {/* Event Description & Metadata */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '13px', lineHeight: '1.4' }}>
              <div style={{ color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-main)', fontWeight: '600' }}>{item.actor}</strong> {item.action}{' '}
                <strong style={{ color: 'var(--text-main)', fontWeight: '600' }}>{item.target}</strong>.
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.time}</span>
                {item.linkText && (
                  <button
                    onClick={() => alert(`Visualisation: ${item.target}`)}
                    style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      color: 'var(--emerald-600)',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    {item.linkText}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
