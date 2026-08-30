// @ts-check
import React from 'react';

/**
 * Custom In-App Confirmation Modal (Replaces browser confirm/alert dialogs).
 * Designed according to Smart BERRY / Bonsai SaaS design guidelines.
 */
export function AppConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirmation de suppression',
  message = 'Êtes-vous sûr de vouloir supprimer cet élément ? Cette action est irréversible.',
  confirmText = 'Confirmer la suppression',
  cancelText = 'Annuler',
  variant = 'danger' // 'danger' | 'warning' | 'info'
}) {
  if (!isOpen) return null;

  const isDanger = variant === 'danger';
  const accentColor = isDanger ? 'var(--rose-500)' : 'var(--emerald-600)';
  const accentBg = isDanger ? '#FEF2F2' : 'var(--emerald-50)';
  const iconClass = isDanger ? 'fa-trash-can' : 'fa-circle-info';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        animation: 'fadeIn 0.15s ease-out'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: 'var(--radius-xl)',
          width: '90%',
          maxWidth: '440px',
          padding: '24px',
          boxShadow: 'var(--shadow-modal)',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px'
        }}
      >
        {/* Icon & Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: accentBg,
              color: accentColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              flexShrink: 0
            }}
          >
            <i className={`fa-solid ${iconClass}`}></i>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700', fontFamily: 'var(--font-display)', color: 'var(--text-main)' }}>
              {title}
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              {message}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-subtle)',
              border: '1px solid var(--border-color)',
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              cursor: 'pointer'
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            style={{
              padding: '9px 16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: accentColor,
              color: '#FFFFFF',
              border: 'none',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-xs)'
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
