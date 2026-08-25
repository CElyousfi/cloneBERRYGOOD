// @ts-check
import React, { useState } from 'react';
import { UiButton } from '../components/UiBadge';

/**
 * Top Header Navigation Bar matching the sleek Bonsai header layout.
 * Includes global search input with ⌘K shortcut, domain breadcrumbs, farm badge,
 * quick action button (+ Nouveau), notifications icon, and user profile avatar.
 */
export function TopHeader({ activeDomainTitle = 'Tableau de bord', activeFarm = 'Ferme 1 - Souss', onOpenNewModal }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <header
      style={{
        height: '64px',
        backgroundColor: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 28px',
        position: 'sticky',
        top: 0,
        zIndex: 90
      }}
    >
      {/* Left: Domain Breadcrumb & Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <h2
          style={{
            fontSize: '18px',
            fontWeight: '700',
            fontFamily: 'var(--font-display)',
            color: 'var(--text-main)',
            letterSpacing: '-0.01em'
          }}
        >
          {activeDomainTitle}
        </h2>
        <span
          style={{
            fontSize: '11px',
            fontWeight: '600',
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            backgroundColor: 'var(--emerald-50)',
            color: 'var(--emerald-700)',
            border: '1px solid var(--emerald-100)'
          }}
        >
          <i className="fa-solid fa-location-dot" style={{ marginRight: '4px' }}></i>
          {activeFarm}
        </span>
      </div>

      {/* Center: Search Bar with ⌘K */}
      <div style={{ position: 'relative', width: '320px' }}>
        <i
          className="fa-solid fa-magnifying-glass"
          style={{
            position: 'absolute',
            left: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            fontSize: '13px'
          }}
        ></i>
        <input
          type="text"
          placeholder="Rechercher facture, lot, ouvrier..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 36px 8px 34px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-subtle)',
            fontSize: '13px',
            color: 'var(--text-main)',
            outline: 'none',
            transition: 'all var(--transition-fast)'
          }}
        />
        <kbd
          style={{
            position: 'absolute',
            right: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '10px',
            fontWeight: '700',
            color: 'var(--text-muted)',
            backgroundColor: 'var(--bg-card)',
            padding: '2px 5px',
            borderRadius: '4px',
            border: '1px solid var(--border-color)'
          }}
        >
          ⌘K
        </kbd>
      </div>

      {/* Right Controls: Quick Action, Notifications, Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Quick Action Button */}
        <button
          onClick={onOpenNewModal}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--emerald-600)',
            color: '#FFFFFF',
            fontWeight: '600',
            fontSize: '13px',
            border: 'none',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-xs)',
            transition: 'all var(--transition-fast)'
          }}
        >
          <i className="fa-solid fa-plus"></i>
          Nouveau
        </button>

        {/* Notifications Icon with Badge */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setNotificationsOpen(prev => !prev)}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '15px',
              cursor: 'pointer',
              position: 'relative'
            }}
          >
            <i className="fa-regular fa-bell"></i>
            <span
              style={{
                position: 'absolute',
                top: '6px',
                right: '6px',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: 'var(--rose-500)'
              }}
            />
          </button>

          {notificationsOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '44px',
                width: '280px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                border: '1px solid var(--border-color)',
                padding: '12px',
                zIndex: 100
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Notifications (3)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                <div style={{ padding: '6px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-subtle)' }}>
                  <strong>Facture #FACT-9482</strong> validée par Achats.
                </div>
                <div style={{ padding: '6px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-subtle)' }}>
                  <strong>Alerte Brix:</strong> Lot B4 sous le seuil minimal (8.2°B).
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Profile Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingLeft: '8px', borderLeft: '1px solid var(--border-subtle)' }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              backgroundColor: 'var(--berry-600)',
              color: '#FFFFFF',
              fontWeight: '700',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              letterSpacing: '0.02em'
            }}
          >
            LA
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)' }}>M. Lazrak</span>
            <span style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-muted)' }}>Direction Générale</span>
          </div>
        </div>
      </div>
    </header>
  );
}
