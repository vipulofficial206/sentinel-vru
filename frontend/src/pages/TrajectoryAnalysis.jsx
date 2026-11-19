import React, { useState, useMemo } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import TrajectoryCanvas from '../components/three/TrajectoryCanvas';
import StatusBadge from '../components/common/StatusBadge';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { api } from '../services/api';

export default function TrajectoryAnalysis() {
  const { agents, coordinateSpace, telemetry, frameId, videoTime } = useTelemetryContext();
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [filterClass, setFilterClass] = useState('all');
  const [loadingVideo, setLoadingVideo] = useState(false);

  const selectedAgent = agents.find((a) => a.track_id === selectedTrackId) || null;

  // Memoized filter agents by category
  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      if (filterClass === 'all') return true;
      const cls = (a.class || '').toLowerCase();
      if (filterClass === 'vru') return cls.includes('pedestrian') || cls.includes('people') || cls.includes('bicycle') || cls.includes('motor');
      if (filterClass === 'vehicle') return cls.includes('car') || cls.includes('van') || cls.includes('truck') || cls.includes('bus');
      if (filterClass === 'hazard') return a.risk_probability > 0.65;
      return true;
    });
  }, [agents, filterClass]);

  const handleStartQuickVideo = async (videoPath, startTime = 0.0) => {
    setLoadingVideo(true);
    try {
      await api.stopVideo();
      await new Promise((r) => setTimeout(r, 600));
      await api.startVideo({
        video_path: videoPath,
        engine: 'onnx',
        graph_mode: 'G3',
        alert_policy: 'density_conditioned',
        start_time_seconds: startTime
      });
    } catch (err) {
      console.error('Failed to start quick video:', err);
    } finally {
      setLoadingVideo(false);
    }
  };

  const handleStopQuickVideo = async () => {
    setLoadingVideo(true);
    try {
      await api.stopVideo();
    } catch (err) {
      console.error('Failed to stop video:', err);
    } finally {
      setLoadingVideo(false);
    }
  };

  return (
    <div style={{ maxWidth: 1680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Workspace Header */}
      <div
        className="glass-card"
        style={{
          padding: '16px 20px',
          borderRadius: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🌐</span>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.01em' }}>
              3D Trajectory Digital Twin & Spatial Kinematics
            </h1>
            <StatusBadge status={coordinateSpace} size="sm" />
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#94a3b8' }}>
            Interactive 3D bird's-eye projection of multi-agent road interactions with real-time velocity vectors and collision hazard links.
          </p>
        </div>

        {/* Quick Stream Launch Controls directly inside 3D View */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => handleStartQuickVideo('data/accident_demonstration_videos/accident_04_urban_intersection_crash.mp4', 7.0)}
            disabled={loadingVideo}
            style={{
              background: 'rgba(239, 68, 68, 0.22)',
              border: '1px solid rgba(239, 68, 68, 0.6)',
              color: '#fca5a5',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>🚨</span> Demo 1: Urban Intersection Crash (@ 7s)
          </button>

          <button
            onClick={() => handleStartQuickVideo('data/accident_demonstration_videos/accident_06_car_vs_truck_intersection.mp4', 0.0)}
            disabled={loadingVideo}
            style={{
              background: 'rgba(2, 132, 199, 0.22)',
              border: '1px solid rgba(2, 132, 199, 0.5)',
              color: '#38bdf8',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>💥</span> Demo 2: Heavy Truck Collision
          </button>

          <button
            onClick={() => handleStartQuickVideo('data/accident_demonstration_videos/accident_03_school_crosswalk_nearmiss.mp4', 0.0)}
            disabled={loadingVideo}
            style={{
              background: 'rgba(245, 158, 11, 0.18)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              color: '#fbbf24',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>🚶</span> Demo 3: School Crosswalk VRU Hazard
          </button>

          <button
            onClick={handleStopQuickVideo}
            disabled={loadingVideo}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94a3b8',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            ⏹️ Stop
          </button>

          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
            <span style={{ color: '#64748b' }}>FRAME:</span>
            <b style={{ color: '#fbbf24' }}>{frameId ?? '—'}</b>
            <span style={{ color: '#64748b' }}>|</span>
            <span style={{ color: '#64748b' }}>TIME:</span>
            <b style={{ color: '#38bdf8' }}>{videoTime ? `${videoTime}s` : '—'}</b>
          </div>
        </div>
      </div>

      {/* Main Split Layout: 3D Canvas + Track Inspector Sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
        {/* Left: Full 3D Three.js Canvas Container */}
        <div className="glass-card" style={{ padding: 16, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Controls sub-bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#94a3b8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>FILTER AGENTS:</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {[
                  { id: 'all', label: `All (${agents.length})` },
                  { id: 'vehicle', label: 'Vehicles' },
                  { id: 'vru', label: 'VRUs (Pedestrians/Cyclists)' },
                  { id: 'hazard', label: 'High Risk (>65%)' }
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilterClass(f.id)}
                    style={{
                      background: filterClass === f.id ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.04)',
                      border: filterClass === f.id ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
                      color: filterClass === f.id ? '#38bdf8' : '#94a3b8',
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#64748b' }}>
              <span>Orbit Controls: 360° Drag & Scroll Enabled</span>
            </div>
          </div>

          {/* 3D Canvas Viewport */}
          <div style={{ width: '100%', height: 650, borderRadius: 10, overflow: 'hidden' }}>
            <ErrorBoundary componentName="3D Trajectory Canvas">
              <TrajectoryCanvas
                agents={filteredAgents}
                coordinateSpace={coordinateSpace}
                height={650}
                showControls={true}
                selectedTrackId={selectedTrackId}
                onSelectAgent={(tid) => setSelectedTrackId(tid)}
              />
            </ErrorBoundary>
          </div>

          {/* Detailed Legend & Status bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, fontSize: 12, color: '#64748b', paddingTop: 4 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <span>Legend:</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} /> Pedestrian
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#06b6d4' }} /> Bicycle / Motor
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8' }} /> Passenger Car
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a855f7' }} /> Truck / Bus
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} /> Collision Hazard
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24' }} /> Selected
              </span>
            </div>

            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#475569' }}>
              G3 Hybrid Spatio-Temporal Interaction Edges Active
            </div>
          </div>
        </div>

        {/* Right: Active Tracks Directory & Selected Inspector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Selected Track Detailed Telemetry Inspector */}
          <div className="glass-card" style={{ padding: 18, borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontSize: 14, margin: 0, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🎯</span> Kinematics Telemetry Gauge
              </h3>
              {selectedAgent && (
                <button
                  onClick={() => setSelectedTrackId(null)}
                  style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12 }}
                >
                  Clear Selection
                </button>
              )}
            </div>

            {selectedAgent ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ background: '#fbbf24', color: '#090e1a', padding: '3px 8px', borderRadius: 4, fontWeight: 800 }}>
                      TRACK #{selectedAgent.track_id}
                    </span>
                    <span style={{ fontWeight: 700, color: 'var(--text-main)', textTransform: 'uppercase' }}>
                      {selectedAgent.class}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: selectedAgent.risk_probability > 0.65 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.15)',
                      color: selectedAgent.risk_probability > 0.65 ? '#ef4444' : '#10b981'
                    }}
                  >
                    {selectedAgent.risk_probability > 0.65 ? 'CRITICAL RISK' : 'NORMAL FLOW'}
                  </span>
                </div>

                {/* Primary Metrics Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ background: 'var(--bg-muted)', padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>SPEED</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#38bdf8', fontFamily: 'JetBrains Mono, monospace' }}>
                      {selectedAgent.speed} <span style={{ fontSize: 11, fontWeight: 400 }}>px/s</span>
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-muted)', padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>RISK PROBABILITY</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: selectedAgent.risk_probability > 0.65 ? '#ef4444' : '#10b981', fontFamily: 'JetBrains Mono, monospace' }}>
                      {((selectedAgent.risk_probability || 0) * 100).toFixed(1)}%
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-muted)', padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>EPISTEMIC UNCERTAINTY</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#c084fc', fontFamily: 'JetBrains Mono, monospace' }}>
                      {selectedAgent.uncertainty?.toFixed(4)}
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-muted)', padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>TRAJECTORY POINTS</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fbbf24', fontFamily: 'JetBrains Mono, monospace' }}>
                      {selectedAgent.trajectory ? selectedAgent.trajectory.length : 0} steps
                    </div>
                  </div>
                </div>

                {/* Vector Details */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#94a3b8', paddingTop: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Position (X, Y):</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-main)' }}>
                      ({selectedAgent.position?.x?.toFixed(1)}, {selectedAgent.position?.y?.toFixed(1)})
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Velocity (Vx, Vy):</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-main)' }}>
                      ({selectedAgent.velocity?.x?.toFixed(1)}, {selectedAgent.velocity?.y?.toFixed(1)})
                    </span>
                  </div>
                  {selectedAgent.ground_position && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Metric Ground (X, Y):</span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#10b981' }}>
                        {selectedAgent.ground_position.x?.toFixed(2)}m, {selectedAgent.ground_position.y?.toFixed(2)}m
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: '28px 12px', background: 'var(--bg-muted)', borderRadius: 8 }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>👆</div>
                Click any 3D vehicle or select from the directory list below to inspect live kinematics & uncertainty
              </div>
            )}
          </div>

          {/* Active Agents Directory List */}
          <div className="glass-card" style={{ padding: 18, borderRadius: 12, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, margin: 0, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📋</span> Active Road Users ({filteredAgents.length})
              </h3>
              <span style={{ fontSize: 11, color: '#64748b' }}>Click to focus</span>
            </div>

            <div style={{ overflowY: 'auto', maxHeight: 360, display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
              {filteredAgents.length > 0 ? (
                filteredAgents.map((a) => {
                  const isSel = selectedTrackId === a.track_id;
                  const isHaz = a.risk_probability > 0.65;
                  return (
                    <div
                      key={a.track_id}
                      onClick={() => setSelectedTrackId(isSel ? null : a.track_id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: isSel
                          ? 'rgba(251, 191, 36, 0.18)'
                          : isHaz
                          ? 'rgba(239, 68, 68, 0.12)'
                          : 'var(--bg-muted)',
                        border: `1px solid ${
                          isSel
                            ? 'rgba(251, 191, 36, 0.5)'
                            : isHaz
                            ? 'rgba(239, 68, 68, 0.35)'
                            : 'rgba(255, 255, 255, 0.06)'
                        }`,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 12,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                          style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontWeight: 800,
                            color: isSel ? '#fbbf24' : isHaz ? '#ef4444' : '#38bdf8'
                          }}
                        >
                          #{a.track_id}
                        </span>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', textTransform: 'capitalize' }}>
                            {a.class}
                          </div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>
                            {a.trajectory ? `${a.trajectory.length} pts` : '1 pt'}
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: isHaz ? '#ef4444' : '#34d399' }}>
                          {a.speed} px/s
                        </div>
                        {isHaz && (
                          <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 700 }}>
                            HAZARD ({((a.risk_probability || 0) * 100).toFixed(0)}%)
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
                  No active tracks match current filter
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
