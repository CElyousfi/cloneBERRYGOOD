// @ts-check
import React from 'react';

/**
 * Left Sidebar Navigation directly inspired by Bonsai's minimalist sidebar layout.
 * Displays brand logo (Bonsai / Smart Berry), grouped section labels (Tools, Finances, Operations),
 * domain navigation links with active state indicator, farm switcher, and bottom links.
 */
export function Sidebar({ activeDomain = 'dashboard', onSelectDomain, activeFarm = 'Ferme 1 - Souss', onSelectFarm }) {
  const domains = [
    { id: 'dashboard', label: 'Tableau de bord', icon: 'fa-table-columns', category: 'Main' },
    { id: 'finance', label: 'Finances & Caisse', icon: 'fa-file-invoice-dollar', category: 'Tools' },
    { id: 'qualite', label: 'Qualité & Brix', icon: 'fa-shield-halved', category: 'Tools' },
    { id: 'rh', label: 'RH & Pointage', icon: 'fa-users', category: 'Tools' },
    { id: 'achats', label: 'Achats & Commandes', icon: 'fa-cart-shopping', category: 'Tools' },
    { id: 'stock', label: 'Stock & Magasinier', icon: 'fa-boxes-stacked', category: 'Tools' },
    { id: 'agronomie', label: 'Agronomie & Météo', icon: 'fa-seedling', category: 'Tools' },
    { id: 'recolte', label: 'Récolte & Rendement', icon: 'fa-basket-shopping', category: 'Tools' },
    { id: 'dg', label: 'Direction & Audit', icon: 'fa-chart-pie', category: 'Finances' },
  ];

  const mainDomains = domains.filter(d => d.category === 'Main');
  const toolDomains = domains.filter(d => d.category === 'Tools');
  const financeDomains = domains.filter(d => d.category === 'Finances');

  return (
    <aside
      style={{
        width: '240px',
        backgroundColor: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '24px 16px',
        minHeight: '100vh',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        flexShrink: 0
      }}
    >
      {/* Top Section: Brand Logo & Navigation */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
        {/* Brand Logo (Bonsai style clean text + green berry plant icon) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingLeft: '8px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--emerald-600)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <i className="fa-solid fa-seedling"></i>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '18px', fontWeight: '800', fontFamily: 'var(--font-display)', color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
              Smart Berry
            </span>
            <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--emerald-600)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Berry Good Farms
            </span>
          </div>
        </div>

        {/* Navigation Sections */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Main Group */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {mainDomains.map(item => {
              const isActive = activeDomain === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectDomain(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '13px',
                    fontWeight: isActive ? '700' : '500',
                    color: isActive ? 'var(--emerald-700)' : 'var(--text-secondary)',
                    backgroundColor: isActive ? 'var(--emerald-50)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all var(--transition-fast)'
                  }}
                >
                  <i className={`fa-solid ${item.icon}`} style={{ width: '18px', fontSize: '15px', color: isActive ? 'var(--emerald-600)' : 'var(--text-muted)' }}></i>
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Tools Group Header */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', paddingLeft: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Domaines Operationnels
            </span>
            {toolDomains.map(item => {
              const isActive = activeDomain === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectDomain(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '13px',
                    fontWeight: isActive ? '700' : '500',
                    color: isActive ? 'var(--emerald-700)' : 'var(--text-secondary)',
                    backgroundColor: isActive ? 'var(--emerald-50)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all var(--transition-fast)'
                  }}
                >
                  <i className={`fa-solid ${item.icon}`} style={{ width: '18px', fontSize: '14px', color: isActive ? 'var(--emerald-600)' : 'var(--text-muted)' }}></i>
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Finances & Executive Group */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', paddingLeft: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Direction
            </span>
            {financeDomains.map(item => {
              const isActive = activeDomain === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectDomain(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '13px',
                    fontWeight: isActive ? '700' : '500',
                    color: isActive ? 'var(--emerald-700)' : 'var(--text-secondary)',
                    backgroundColor: isActive ? 'var(--emerald-50)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all var(--transition-fast)'
                  }}
                >
                  <i className={`fa-solid ${item.icon}`} style={{ width: '18px', fontSize: '14px', color: isActive ? 'var(--emerald-600)' : 'var(--text-muted)' }}></i>
                  {item.label}
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Bottom Section: Farm Switcher & User Profile (Bonsai style bottom links) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
        {/* Farm Selector Dropdown */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', paddingLeft: '4px' }}>Exploitation Agricole</label>
          <select
            value={activeFarm}
            onChange={(e) => onSelectFarm(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-subtle)',
              fontSize: '12px',
              fontWeight: '600',
              color: 'var(--text-main)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="Ferme 1 - Souss">Ferme 1 - Souss</option>
            <option value="Ferme 2 - Loukkos">Ferme 2 - Loukkos</option>
            <option value="Toutes les Fermes">Toutes les Fermes</option>
          </select>
        </div>

        {/* Invite / Support Bottom buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '6px 8px',
              fontSize: '12px',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm)'
            }}
          >
            <i className="fa-solid fa-user-plus" style={{ color: 'var(--emerald-600)' }}></i>
            Inviter Collaborateur
          </button>
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '6px 8px',
              fontSize: '12px',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm)'
            }}
          >
            <i className="fa-solid fa-gift" style={{ color: 'var(--emerald-600)' }}></i>
            Version 2.4 Modulaire
          </button>
        </div>
      </div>
    </aside>
  );
}
