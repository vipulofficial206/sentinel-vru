import React from 'react';

export default function MetricCard({
  title,
  value,
  unit,
  caption,
  source,
  color = 'var(--accent-cyan)',
  icon
}) {
  const displayVal = value !== null && value !== undefined && value !== '' ? value : '—';
  
  // Adapt neon cyan or light colors for contrast if passed directly
  const computedColor = color === '#38bdf8' ? 'var(--accent-cyan)' : color;

  return (
    <div className="glass-card" style={{ padding: 18, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </span>
        {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '4px 0' }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: computedColor,
            fontFamily: 'JetBrains Mono, monospace',
            letterSpacing: '-0.02em'
          }}
        >
          {displayVal}
        </span>
        {unit && (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
            {unit}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
        {caption && <span>{caption}</span>}
        {source && <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>[{source}]</span>}
      </div>
    </div>
  );
}
