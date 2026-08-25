// @ts-check
import React, { useState } from 'react';

/**
 * Interactive Bar & Production Chart directly inspired by Bonsai's "Time Tracked" bar chart.
 * Features SVG rendering, hover tooltips, metric highlights below, and period switching.
 */
export function UiChart({ title = 'Suivi Production & Heures Récolte' }) {
  const [activeBar, setActiveBar] = useState(null);
  const [period, setPeriod] = useState('7d');

  const chartData = [
    { label: '25 JAN', yieldKg: 420, hours: 24, billedMad: 3100, active: false },
    { label: '27 JAN', yieldKg: 510, hours: 32, billedMad: 4200, active: false },
    { label: '29 JAN', yieldKg: 480, hours: 28, billedMad: 3800, active: false },
    { label: '31 JAN', yieldKg: 620, hours: 40, billedMad: 5100, active: false },
    { label: '02 FÉV', yieldKg: 740, hours: 45, billedMad: 6200, active: false },
    { label: '04 FÉV', yieldKg: 890, hours: 52, billedMad: 7500, active: false },
    { label: '06 FÉV', yieldKg: 1250, hours: 68, billedMad: 10400, active: true },
    { label: '08 FÉV', yieldKg: 1840, hours: 84, billedMad: 15200, active: true },
  ];

  const maxYield = Math.max(...chartData.map(d => d.yieldKg));

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
        gap: '24px'
      }}
    >
      {/* Top Header & Range Selection */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3
          style={{
            fontSize: '18px',
            fontWeight: '700',
            color: 'var(--text-main)',
            fontFamily: 'var(--font-display)'
          }}
        >
          {title}
        </h3>
        <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-subtle)', padding: '3px', borderRadius: 'var(--radius-md)' }}>
          {['7d', '14d', '30d'].map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: '600',
                border: 'none',
                backgroundColor: period === p ? '#FFFFFF' : 'transparent',
                color: period === p ? 'var(--text-main)' : 'var(--text-muted)',
                boxShadow: period === p ? 'var(--shadow-xs)' : 'none',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Bar Chart Visualization */}
      <div style={{ position: 'relative', width: '100%', height: '220px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        {/* Background Grid Lines */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', zIndex: 0 }}>
          {[1, 2, 3, 4].map(line => (
            <div key={line} style={{ width: '100%', borderTop: '1px dashed var(--border-subtle)' }} />
          ))}
        </div>

        {/* Bars Container */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: '170px', zIndex: 1, padding: '0 10px' }}>
          {chartData.map((item, index) => {
            const heightPct = Math.max(10, (item.yieldKg / maxYield) * 100);
            const isHovered = activeBar === index;
            const isHighlighted = item.active || isHovered;

            return (
              <div
                key={index}
                onMouseEnter={() => setActiveBar(index)}
                onMouseLeave={() => setActiveBar(null)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  flex: 1,
                  cursor: 'pointer',
                  position: 'relative'
                }}
              >
                {/* Tooltip on Hover */}
                {isHovered && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-45px',
                      backgroundColor: 'var(--text-main)',
                      color: '#FFFFFF',
                      padding: '4px 8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11px',
                      fontWeight: '600',
                      whiteSpace: 'nowrap',
                      boxShadow: 'var(--shadow-md)',
                      zIndex: 10
                    }}
                  >
                    {item.yieldKg} kg · {item.hours}h ({item.billedMad} DH)
                  </div>
                )}

                {/* Vertical Bar */}
                <div
                  style={{
                    width: '28px',
                    height: `${heightPct}%`,
                    backgroundColor: isHighlighted ? 'var(--emerald-600)' : '#E2E8F0',
                    opacity: isHighlighted ? 1 : 0.7,
                    borderRadius: '6px 6px 2px 2px',
                    transition: 'all var(--transition-fast)'
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* X-Axis Labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 10px 0', borderTop: '1px solid var(--border-subtle)', zIndex: 1 }}>
          {chartData.map((item, i) => (
            <span key={i} style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', textAlign: 'center', flex: 1 }}>
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {/* Metric Breakdown Row (Matching Bonsai bottom metrics: Unbilled Hours, Billed Amount) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '16px',
          paddingTop: '16px',
          borderTop: '1px solid var(--border-subtle)'
        }}
      >
        <div>
          <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-muted)' }}>Heures Récolte</div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-main)', marginTop: '2px' }}>373:15:00</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Valorisation Récolte
            <i className="fa-solid fa-circle-info" style={{ fontSize: '10px' }}></i>
          </div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-main)', marginTop: '2px' }}>56,300 MAD</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-muted)' }}>Volume Emballé</div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--emerald-600)', marginTop: '2px' }}>6,750.00 kg</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Rendement Net
            <i className="fa-solid fa-circle-info" style={{ fontSize: '10px' }}></i>
          </div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--emerald-600)', marginTop: '2px' }}>96.4 %</div>
        </div>
      </div>
    </div>
  );
}
