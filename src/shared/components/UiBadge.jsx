// @ts-check
import React from 'react';

/**
 * Reusable Badge component for status tags, pills, and indicators.
 */
export function UiBadge({ children, variant = 'emerald', icon = null, className = '' }) {
  const variantStyles = {
    emerald: { bg: 'var(--emerald-50)', color: 'var(--emerald-700)', border: 'var(--emerald-100)' },
    berry: { bg: 'var(--berry-50)', color: 'var(--berry-700)', border: 'var(--berry-100)' },
    amber: { bg: 'var(--amber-50)', color: '#B45309', border: '#FDE68A' },
    rose: { bg: 'var(--rose-50)', color: '#BE123C', border: '#FECDD3' },
    indigo: { bg: 'var(--indigo-50)', color: 'var(--indigo-600)', border: '#C7D2FE' },
    neutral: { bg: 'var(--bg-subtle)', color: 'var(--text-secondary)', border: 'var(--border-color)' }
  };

  const style = variantStyles[variant] || variantStyles.neutral;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 10px',
        borderRadius: 'var(--radius-full)',
        fontSize: '12px',
        fontWeight: '600',
        backgroundColor: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap'
      }}
      className={className}
    >
      {icon && <i className={icon} style={{ fontSize: '11px' }}></i>}
      {children}
    </span>
  );
}

/**
 * Reusable Button component matching Bonsai minimalist aesthetic.
 */
export function UiButton({ children, onClick, variant = 'primary', size = 'md', icon = null, disabled = false, fullWidth = false }) {
  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    borderRadius: 'var(--radius-md)',
    fontWeight: '600',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: 'all var(--transition-fast)',
    border: 'none',
    width: fullWidth ? '100%' : 'auto',
  };

  const sizes = {
    sm: { padding: '6px 12px', fontSize: '12px' },
    md: { padding: '9px 16px', fontSize: '13px' },
    lg: { padding: '12px 20px', fontSize: '14px' }
  };

  const variants = {
    primary: { bg: 'var(--emerald-600)', color: '#FFFFFF', hoverBg: 'var(--emerald-700)', border: 'none' },
    berry: { bg: 'var(--berry-600)', color: '#FFFFFF', hoverBg: 'var(--berry-700)', border: 'none' },
    secondary: { bg: 'var(--bg-subtle)', color: 'var(--text-main)', border: '1px solid var(--border-color)' },
    outline: { bg: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-color)' },
    ghost: { bg: 'transparent', color: 'var(--text-secondary)', border: 'none' }
  };

  const currentSize = sizes[size] || sizes.md;
  const currentVariant = variants[variant] || variants.primary;

  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...baseStyle,
        ...currentSize,
        backgroundColor: isHovered && !disabled ? (currentVariant.hoverBg || 'var(--bg-hover)') : currentVariant.bg,
        color: currentVariant.color,
        border: currentVariant.border,
        boxShadow: variant === 'primary' || variant === 'berry' ? 'var(--shadow-xs)' : 'none'
      }}
    >
      {icon && <i className={icon}></i>}
      {children}
    </button>
  );
}
