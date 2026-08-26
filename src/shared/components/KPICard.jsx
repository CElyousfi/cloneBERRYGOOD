// @ts-check
import React from 'react';

/**
 * Legacy KPICard component extracted from app.jsx (Line 2894).
 * Rendered across Finance, Qualité, RH, and DG tabs.
 */
export function KPICard({ icon = null, iconClass = 'berry', value = '', label = '', change = null, subItems = null, onClick = null }) {
  const iconColors = {
    berry: 'var(--berry-600)',
    green: 'var(--emerald-600)',
    blue: 'var(--indigo-600)',
    orange: 'var(--amber-500)',
    red: 'var(--rose-500)',
    purple: '#8B5CF6',
    gold: '#D97706'
  };

  const selectedColor = iconColors[iconClass] || 'var(--emerald-600)';

  return (
    <div
      onClick={onClick || undefined}
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '18px 20px',
        boxShadow: 'var(--shadow-sm)',
        border: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all var(--transition-fast)'
      }}
    >
      {icon && (
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-subtle)',
            color: selectedColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            flexShrink: 0
          }}
        >
          <i className={`fa-solid ${icon}`}></i>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>
          {value}
        </div>
        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
          {label}
        </div>
        {change && (
          <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--emerald-600)', marginTop: '2px' }}>
            {change}
          </div>
        )}
      </div>
    </div>
  );
}

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.KPICard = KPICard;
}
