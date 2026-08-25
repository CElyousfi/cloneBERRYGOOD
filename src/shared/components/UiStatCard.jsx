// @ts-check
import React from 'react';

/**
 * Top Stat Card component matching Bonsai minimalist metrics row.
 * Displays metric title, value with custom styling (e.g. green highlight for positive income),
 * trend percentage, and info icon tooltip.
 */
export function UiStatCard({ label, value, subtext, highlightColor = null, trend = null, infoTooltip = null }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 22px',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        flex: 1,
        minWidth: '180px',
        transition: 'transform var(--transition-fast), boxShadow var(--transition-fast)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: '13px',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            letterSpacing: '-0.01em'
          }}
        >
          {label}
        </span>
        {infoTooltip && (
          <span
            title={infoTooltip}
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              cursor: 'help',
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: 'var(--bg-subtle)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <i className="fa-solid fa-circle-info"></i>
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: '24px',
          fontWeight: '700',
          color: highlightColor || 'var(--text-main)',
          fontFamily: 'var(--font-display)',
          letterSpacing: '-0.02em',
          marginTop: '2px'
        }}
      >
        {value}
      </div>

      {(subtext || trend) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
          {trend && (
            <span
              style={{
                fontWeight: '600',
                color: trend.startsWith('+') ? 'var(--emerald-600)' : 'var(--rose-500)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px'
              }}
            >
              <i className={`fa-solid ${trend.startsWith('+') ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}`}></i>
              {trend}
            </span>
          )}
          {subtext && <span>{subtext}</span>}
        </div>
      )}
    </div>
  );
}
