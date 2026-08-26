// @ts-check
import React from 'react';

/**
 * Activity Feed component inspired directly by the right column "Activity" log in Bonsai.
 * Starts clean with 0 fake items in production.
 */
export function UiActivityFeed({ activities = [] }) {
  const items = activities;

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

      {items.length === 0 ? (
        <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          <i className="fa-solid fa-clock-rotate-left" style={{ fontSize: '28px', marginBottom: '8px', opacity: 0.4 }}></i>
          <p style={{ fontWeight: '600' }}>Aucune activité récente</p>
          <p style={{ fontSize: '12px' }}>Les événements en direct apparaîtront ici.</p>
        </div>
      ) : (
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '13px', lineHeight: '1.4' }}>
                <div style={{ color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--text-main)', fontWeight: '600' }}>{item.actor}</strong> {item.action}{' '}
                  <strong style={{ color: 'var(--text-main)', fontWeight: '600' }}>{item.target}</strong>.
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.time}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
