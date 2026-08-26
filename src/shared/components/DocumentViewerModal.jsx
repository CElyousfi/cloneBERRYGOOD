// @ts-check
import React from 'react';

/**
 * Universal Document Viewer Modal for Smart BERRY.
 * Renders uploaded invoices, receipts, quality reports, and BDC quote files with Zoom & Download controls.
 */
export function DocumentViewerModal({ isOpen, onClose, documentTitle = 'Document Preview', documentUrl }) {
  if (!isOpen || !documentUrl) return null;

  const isImage = documentUrl.startsWith('data:image/') || documentUrl.endsWith('.png') || documentUrl.endsWith('.jpg') || documentUrl.endsWith('.jpeg') || documentUrl.endsWith('.webp');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
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
          maxWidth: '720px',
          maxHeight: '85vh',
          padding: '24px',
          boxShadow: 'var(--shadow-modal)',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <i className="fa-solid fa-file-pdf" style={{ color: 'var(--rose-500)', fontSize: '20px' }}></i>
            <h3 style={{ fontSize: '16px', fontWeight: '700', fontFamily: 'var(--font-display)', color: 'var(--text-main)' }}>
              {documentTitle}
            </h3>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <a
              href={documentUrl}
              download={documentTitle.replace(/\s+/g, '_') + (isImage ? '.png' : '.pdf')}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text-secondary)',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <i className="fa-solid fa-download"></i> Télécharger
            </a>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '18px', cursor: 'pointer' }}
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>

        {/* Viewport */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '320px', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', padding: '16px', border: '1px solid var(--border-subtle)' }}>
          {isImage ? (
            <img
              src={documentUrl}
              alt={documentTitle}
              style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)' }}
            />
          ) : (
            <iframe
              src={documentUrl}
              title={documentTitle}
              style={{ width: '100%', height: '55vh', border: 'none', borderRadius: 'var(--radius-sm)' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
