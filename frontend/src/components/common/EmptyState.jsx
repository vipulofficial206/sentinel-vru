import React from 'react';

export default function EmptyState({
  title = 'No Data Available',
  description = 'No telemetry or records were found.',
  actionLabel,
  onAction,
  icon
}) {
  return (
    <div
      style={{
        padding: '36px 20px',
        textAlign: 'center',
        background: 'var(--bg-muted)',
        border: '1px dashed var(--border-strong)',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10
      }}
    >
      <div style={{ fontSize: 28, color: 'var(--text-dim)' }}>
        {icon || '📁'}
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)' }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 400, lineHeight: 1.5 }}>
        {description}
      </div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          style={{
            marginTop: 8,
            background: 'var(--bg-accent-soft)',
            border: '1px solid rgba(2, 132, 199, 0.3)',
            color: 'var(--accent-cyan)',
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
