import React from 'react';

export default function AlertBanner({
  warningState,
  calibratedRisk,
  leadTime,
  uncertainty,
  threshold = 0.65,
  videoTime
}) {
  if (!warningState || warningState === 'NORMAL') return null;

  const isSevere = warningState === 'ANOMALY INTERVAL';

  return (
    <div
      style={{
        background: isSevere
          ? 'linear-gradient(90deg, rgba(185, 28, 28, 0.95), rgba(127, 29, 29, 0.95))'
          : 'linear-gradient(90deg, rgba(217, 119, 6, 0.95), rgba(180, 83, 9, 0.95))',
        border: `1px solid ${isSevere ? '#ef4444' : '#f59e0b'}`,
        color: '#ffffff',
        padding: '12px 20px',
        borderRadius: 10,
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        boxShadow: isSevere ? '0 0 24px rgba(239, 68, 68, 0.4)' : '0 0 20px rgba(245, 158, 11, 0.3)',
        animation: 'pulse-alert 2s infinite ease-in-out'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 24 }}>{isSevere ? '🚨' : '⚠️'}</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{warningState}</span>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(0,0,0,0.3)',
                fontFamily: 'JetBrains Mono, monospace'
              }}
            >
              τ = {threshold}
            </span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
            Calibrated collision risk exceeded operational decision threshold. Ring buffer active.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
        <div>
          <span style={{ opacity: 0.7, fontSize: 11, display: 'block' }}>CALIBRATED RISK</span>
          <span style={{ fontWeight: 800, fontSize: 16 }}>{((calibratedRisk || 0) * 100).toFixed(1)}%</span>
        </div>
        {leadTime !== null && leadTime !== undefined && (
          <div>
            <span style={{ opacity: 0.7, fontSize: 11, display: 'block' }}>EARLY LEAD TIME</span>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#fef08a' }}>{leadTime}s</span>
          </div>
        )}
        {uncertainty !== null && uncertainty !== undefined && (
          <div>
            <span style={{ opacity: 0.7, fontSize: 11, display: 'block' }}>UNCERTAINTY (σ)</span>
            <span>{uncertainty.toFixed(4)}</span>
          </div>
        )}
        {videoTime !== null && videoTime !== undefined && (
          <div>
            <span style={{ opacity: 0.7, fontSize: 11, display: 'block' }}>VIDEO TIME</span>
            <span>{videoTime.toFixed(1)}s</span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse-alert {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.003); opacity: 0.95; }
        }
      `}</style>
    </div>
  );
}
