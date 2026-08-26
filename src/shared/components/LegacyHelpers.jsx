// @ts-check
import React from 'react';
import { KPICard } from './KPICard';

export function FarmBanner({ farmName = 'Ferme 1 - Souss' }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        border: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <i className="fa-solid fa-location-dot" style={{ color: 'var(--emerald-600)', fontSize: '16px' }}></i>
        <strong style={{ fontSize: '15px', color: 'var(--text-main)' }}>{farmName}</strong>
      </div>
      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Berry Good Farms — Smart BERRY</span>
    </div>
  );
}

export function Panel({ title = '', children = null, action = null }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--shadow-sm)',
        marginBottom: '20px'
      }}
    >
      {title && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
          <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>{title}</h4>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function WorkerLink({ workerId = '', name = '', onClick = null }) {
  return (
    <button
      onClick={onClick || (() => alert(`Fiche Ouvrier ${workerId} - ${name}`))}
      style={{
        background: 'none',
        border: 'none',
        color: 'var(--emerald-600)',
        fontWeight: '600',
        cursor: 'pointer',
        textDecoration: 'underline',
        padding: 0,
        fontSize: '13px'
      }}
    >
      {name || workerId}
    </button>
  );
}

export function SimpleBarChart({ data = [], height = 200 }) {
  return (
    <div style={{ height: `${height}px`, width: '100%', display: 'flex', alignItems: 'flex-end', gap: '8px', padding: '10px 0' }}>
      {(data || []).map((d, i) => (
        <div key={i} style={{ flex: 1, backgroundColor: 'var(--emerald-600)', height: `${Math.min(100, Math.max(15, (d.value || 20)))}%`, borderRadius: '4px 4px 0 0' }} />
      ))}
    </div>
  );
}

export function SimpleAreaChart({ data = [], height = 200 }) {
  return <SimpleBarChart data={data} height={height} />;
}

export function SimpleComboChart({ data = [], height = 200 }) {
  return <SimpleBarChart data={data} height={height} />;
}

export function SimplePieChart({ data = [], height = 200 }) {
  return (
    <div style={{ height: `${height}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: 'conic-gradient(var(--emerald-600) 0% 60%, var(--amber-500) 60% 85%, var(--rose-500) 85% 100%)' }} />
    </div>
  );
}

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.KPICard = KPICard;
  // @ts-ignore
  window.FarmBanner = FarmBanner;
  // @ts-ignore
  window.Panel = Panel;
  // @ts-ignore
  window.WorkerLink = WorkerLink;
  // @ts-ignore
  window.SimpleBarChart = SimpleBarChart;
  // @ts-ignore
  window.SimpleAreaChart = SimpleAreaChart;
  // @ts-ignore
  window.SimpleComboChart = SimpleComboChart;
  // @ts-ignore
  window.SimplePieChart = SimplePieChart;
}
