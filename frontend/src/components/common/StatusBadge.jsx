import React from 'react';

const BADGE_TYPES = {
  // Safe / Normal states
  CONNECTED: 'normal',
  READY: 'normal',
  LOADED: 'normal',
  NORMAL: 'normal',
  'CALIBRATED — METRIC': 'normal',

  // Warning states
  CONNECTING: 'warning',
  DEGRADED: 'warning',
  'PRE-EVENT WARNING': 'warning',
  'NOT CONFIGURED': 'warning',
  'CALIBRATED — RELATIVE/ARBITRARY SCALE': 'warning',

  // Danger / Error states
  DISCONNECTED: 'danger',
  'ANOMALY INTERVAL': 'danger',
  ERROR: 'danger',
  UNAVAILABLE: 'danger',

  // Info states
  'IMAGE-SPACE ONLY': 'info',

  // Neutral states
  UNKNOWN: 'neutral',
  'NOT LOADED': 'neutral'
};

export default function StatusBadge({ status, label, size = 'md' }) {
  const normKey = (status || 'UNKNOWN').toUpperCase();
  const badgeType = BADGE_TYPES[normKey] || 'neutral';
  const displayLabel = label || status || 'UNKNOWN';

  const isSmall = size === 'sm';

  const styleMap = {
    normal: {
      bg: 'var(--badge-normal-bg)',
      text: 'var(--badge-normal-text)',
      border: 'var(--badge-normal-border)',
      dot: 'var(--status-normal)'
    },
    warning: {
      bg: 'var(--badge-warning-bg)',
      text: 'var(--badge-warning-text)',
      border: 'var(--badge-warning-border)',
      dot: 'var(--status-warning)'
    },
    danger: {
      bg: 'var(--badge-danger-bg)',
      text: 'var(--badge-danger-text)',
      border: 'var(--badge-danger-border)',
      dot: 'var(--status-danger)'
    },
    info: {
      bg: 'var(--badge-info-bg)',
      text: 'var(--badge-info-text)',
      border: 'var(--badge-info-border)',
      dot: 'var(--status-info)'
    },
    neutral: {
      bg: 'var(--badge-neutral-bg)',
      text: 'var(--badge-neutral-text)',
      border: 'var(--badge-neutral-border)',
      dot: 'var(--text-dim)'
    }
  };

  const currentStyle = styleMap[badgeType];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isSmall ? 5 : 6,
        padding: isSmall ? '2px 8px' : '3px 10px',
        borderRadius: 999,
        background: currentStyle.bg,
        border: `1px solid ${currentStyle.border}`,
        color: currentStyle.text,
        fontSize: isSmall ? 11 : 12,
        fontWeight: 700,
        fontFamily: 'JetBrains Mono, monospace',
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
        transition: 'all 0.2s ease'
      }}
    >
      <span
        style={{
          width: isSmall ? 6 : 7,
          height: isSmall ? 6 : 7,
          borderRadius: '50%',
          background: currentStyle.dot,
          boxShadow: `0 0 6px ${currentStyle.dot}`
        }}
      />
      {displayLabel}
    </span>
  );
}
