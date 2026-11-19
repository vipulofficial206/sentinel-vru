export default function DetectionPanel({ agents }) {
  if (!agents || agents.length === 0) {
    return (
      <div className="glass-card animate-fade-in" style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
        No active tracked road participants currently in camera field of view.
      </div>
    );
  }

  const getClassBadge = (cls) => {
    const c = (cls || '').toLowerCase();
    if (c.includes('pedestrian') || c.includes('people')) {
      return { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: '#10b981' };
    }
    if (c.includes('bicycle') || c.includes('motor')) {
      return { bg: 'rgba(6, 182, 212, 0.15)', text: '#22d3ee', border: '#06b6d4' };
    }
    if (c.includes('bus') || c.includes('truck')) {
      return { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: '#a855f7' };
    }
    return { bg: 'rgba(56, 189, 248, 0.15)', text: '#38bdf8', border: '#0284c7' };
  };

  return (
    <div className="glass-card animate-fade-in" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
          Real-Time Road Agent Kinematics
        </h3>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
          {agents.length} active
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(51, 65, 85, 0.6)', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '11px' }}>
              <th style={{ padding: '8px 6px' }}>Track ID</th>
              <th style={{ padding: '8px 6px' }}>Class</th>
              <th style={{ padding: '8px 6px' }}>Velocity (px/s)</th>
              <th style={{ padding: '8px 6px' }}>Uncertainty</th>
            </tr>
          </thead>
          <tbody>
            {agents.map(a => {
              const badge = getClassBadge(a.class);
              const speed = Math.sqrt((a.velocity?.x || 0)**2 + (a.velocity?.y || 0)**2);
              const uncert = a.uncertainty || 0;

              return (
                <tr
                  key={a.track_id}
                  style={{
                    borderBottom: '1px solid rgba(51, 65, 85, 0.3)',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(51, 65, 85, 0.25)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '8px 6px', fontWeight: 700, fontFamily: 'monospace', color: '#f8fafc' }}>
                    #{a.track_id}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      background: badge.bg,
                      color: badge.text,
                      border: `1px solid ${badge.border}`
                    }}>
                      {a.class}
                    </span>
                  </td>
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace', color: speed > 25 ? '#38bdf8' : '#cbd5e1' }}>
                    {speed.toFixed(1)} px/s
                  </td>
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace', color: uncert > 0.4 ? '#f59e0b' : '#94a3b8' }}>
                    {uncert.toFixed(3)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
