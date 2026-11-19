export default function SystemStatus({ data }) {
  const isSahi = data.sahi_active;
  const warning = data.warning_state || 'NORMAL';
  const riskPct = Math.min(100, Math.max(0, (data.global_risk * 100)));
  const isAlert = warning !== 'NORMAL';

  return (
    <div className="glass-card animate-fade-in" style={{ padding: '16px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', letterSpacing: '0.3px' }}>
          Mission Telemetry & Health
        </h3>
        <span style={{
          fontSize: '11px',
          fontFamily: 'monospace',
          color: 'var(--accent-cyan)',
          background: 'var(--bg-accent-soft)',
          padding: '2px 8px',
          borderRadius: '4px',
          border: '1px solid rgba(2, 132, 199, 0.25)'
        }}>
          {data.camera_id}
        </span>
      </div>

      {/* Grid of Key Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
        <div style={{ background: 'var(--bg-muted)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Elapsed Time</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)', fontFamily: 'monospace' }}>
            {data.timestamp ? data.timestamp.toFixed(2) : '0.00'}s
          </div>
        </div>

        <div style={{ background: 'var(--bg-muted)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active Tracks</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>
            {data.agents ? data.agents.length : 0} agents
          </div>
        </div>

        <div style={{ background: 'var(--bg-muted)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Adaptive SAHI</div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: isSahi ? 'var(--status-warning)' : 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isSahi ? 'var(--status-warning)' : 'var(--text-dim)' }}></span>
            {isSahi ? 'ACTIVE (Slicing)' : 'STANDBY (Gated)'}
          </div>
        </div>

        <div style={{ background: 'var(--bg-muted)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Perception Var</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
            {data.global_uncertainty ? data.global_uncertainty.toFixed(3) : '0.000'}
          </div>
        </div>
      </div>

      {/* CAGT-Risk Calibrated Prediction Gauge */}
      <div style={{
        background: 'var(--bg-muted)',
        padding: '14px',
        borderRadius: '8px',
        border: '1px solid var(--border-subtle)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Calibrated Conflict Probability</span>
          <span style={{
            fontSize: '15px',
            fontWeight: 800,
            fontFamily: 'monospace',
            color: riskPct > 65 ? 'var(--status-danger)' : (riskPct > 40 ? 'var(--status-warning)' : 'var(--status-normal)')
          }}>
            {riskPct.toFixed(1)}%
          </span>
        </div>

        {/* Progress Bar Container */}
        <div style={{ width: '100%', height: '8px', background: 'var(--border-subtle)', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
          <div style={{
            width: `${riskPct}%`,
            height: '100%',
            background: riskPct > 65 ? 'linear-gradient(90deg, #f59e0b, #ef4444)' : 'linear-gradient(90deg, #10b981, #0284c7)',
            borderRadius: '4px',
            transition: 'width 0.3s ease-out'
          }} />
        </div>

        {/* Pulsing Alert Banner */}
        <div
          className={isAlert ? 'pulse-badge-red' : ''}
          style={{
            padding: '10px',
            borderRadius: '6px',
            textAlign: 'center',
            fontWeight: 800,
            fontSize: '13px',
            letterSpacing: '0.8px',
            background: isAlert ? 'var(--badge-danger-bg)' : 'var(--badge-normal-bg)',
            border: isAlert ? '1px solid var(--badge-danger-border)' : '1px solid var(--badge-normal-border)',
            color: isAlert ? 'var(--badge-danger-text)' : 'var(--badge-normal-text)'
          }}
        >
          {isAlert ? `⚠ ${warning}` : `✓ STATUS: ${warning}`}
        </div>
      </div>
    </div>
  );
}
