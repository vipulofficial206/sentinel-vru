import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import LoadingSpinner from '../components/common/LoadingSpinner';

const GROUND_TRUTH_EVENTS = [
  { video_id: 2, onset_s: 587.0, end_s: 894.0, type: 'Stalled Vehicle / Traffic Disruption' },
  { video_id: 9, onset_s: 0.0, end_s: 287.0, type: 'Roadway Anomaly' },
  { video_id: 11, onset_s: 0.0, end_s: 888.0, type: 'Congestion & Shoulder Obstruction' },
  { video_id: 14, onset_s: 475.0, end_s: 600.0, type: 'Highway Crash / Collision' },
  { video_id: 33, onset_s: 0.0, end_s: 90.0, type: 'Vehicle Stopped in Active Lane' },
  { video_id: 35, onset_s: 418.0, end_s: 500.0, type: 'Intersection Crash / Stall' },
  { video_id: 49, onset_s: 180.0, end_s: 360.0, type: 'Lane Blockage Anomaly' },
  { video_id: 72, onset_s: 340.0, end_s: 520.0, type: 'Traffic Collision' },
  { video_id: 91, onset_s: 210.0, end_s: 430.0, type: 'Multi-Vehicle Collision' },
  { video_id: 97, onset_s: 198.0, end_s: 360.0, type: 'Vehicle Breakdown' }
];

export default function AlertsEvents() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState(null);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const data = await api.getEvents();
      setEvents(data.events || []);
    } catch (e) {
      console.error('Failed to load events', e);
    } finally {
      setLoading(false);
    }
  };

  const filteredEvents = events.filter((ev) => {
    if (filterType !== 'all' && ev.event_type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchId = (ev.event_id || '').toLowerCase().includes(q);
      const matchCam = (ev.camera_id || '').toLowerCase().includes(q);
      const matchType = (ev.event_type || '').toLowerCase().includes(q);
      if (!matchId && !matchCam && !matchType) return false;
    }
    return true;
  });

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Bar */}
      <div
        className="glass-card"
        style={{
          padding: '16px 20px',
          borderRadius: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 14
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🚨</span>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-main)' }}>
              Anomaly Alerts, Events & Evidence Management
            </h1>
            <span
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 700
              }}
            >
              {events.length} Stored Events
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#94a3b8' }}>
            Historical ring-buffer event evidence synchronized with MongoDB and filesystem video archives.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={fetchEvents}
            disabled={loading}
            style={{
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              padding: '8px 16px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            {loading ? 'Refreshing...' : '🔄 Refresh Evidence'}
          </button>
        </div>
      </div>

      {/* Main Events Table Panel */}
      <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-main)' }}>Recorded Anomaly Incidents</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>Filtered: {filteredEvents.length}</span>
          </div>

          {/* Search & Filter */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search by ID or Camera..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: 'var(--bg-muted)',
                color: 'var(--text-main)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 12,
                outline: 'none',
                minWidth: 220
              }}
            />

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{
                background: 'var(--bg-muted)',
                color: 'var(--text-main)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: 12,
                outline: 'none'
              }}
            >
              <option value="all">All Anomaly Types</option>
              <option value="TRAFFIC_ANOMALY">TRAFFIC_ANOMALY</option>
            </select>
          </div>
        </div>

        {loading ? (
          <LoadingSpinner message="Fetching recorded ring-buffer evidence..." />
        ) : filteredEvents.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', textAlign: 'left' }}>
                  <th style={{ padding: '12px 10px', fontWeight: 600 }}>Event ID</th>
                  <th style={{ padding: '12px 10px', fontWeight: 600 }}>Camera</th>
                  <th style={{ padding: '12px 10px', fontWeight: 600 }}>Anomaly Type</th>
                  <th style={{ padding: '12px 10px', fontWeight: 600 }}>Calibrated Risk</th>
                  <th style={{ padding: '12px 10px', fontWeight: 600 }}>Uncertainty (σ)</th>
                  <th style={{ padding: '12px 10px', fontWeight: 600 }}>Lead Time</th>
                  <th style={{ padding: '12px 10px', fontWeight: 600 }}>Storage Path</th>
                  <th style={{ padding: '12px 10px', fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((ev, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      background: selectedEvent?.event_id === ev.event_id ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                      transition: 'background 0.2s'
                    }}
                  >
                    <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', color: '#93c5fd' }}>
                      {ev.event_id?.substring(0, 8)}...
                    </td>
                    <td style={{ padding: '12px 10px' }}>{ev.camera_id}</td>
                    <td style={{ padding: '12px 10px' }}>
                      <span
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#fca5a5',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700
                        }}
                      >
                        {ev.event_type}
                      </span>
                    </td>
                    <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#f87171' }}>
                      {((ev.trigger_probability || 0) * 100).toFixed(1)}%
                    </td>
                    <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', color: '#c084fc' }}>
                      {(ev.uncertainty || 0).toFixed(4)}
                    </td>
                    <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#38bdf8' }}>
                      {ev.warning_lead_time ? `+${ev.warning_lead_time}s` : 'N/A'}
                    </td>
                    <td style={{ padding: '12px 10px', fontSize: 11, color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
                      {ev.video_reference || 'results/event_evidence'}
                    </td>
                    <td style={{ padding: '12px 10px' }}>
                      <button
                        onClick={() => setSelectedEvent(ev)}
                        style={{
                          background: 'rgba(56, 189, 248, 0.1)',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          color: '#38bdf8',
                          padding: '4px 10px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No Anomaly Events Triggered Yet"
            description="Run Video #35 on the dashboard or live monitor to test ring-buffer pre-event capture and automated persistence."
            icon="🛡️"
          />
        )}
      </div>

      {/* Selected Event Detail Modal / Drawer */}
      {selectedEvent && (
        <div
          className="glass-card"
          style={{
            padding: 20,
            borderRadius: 12,
            border: '1px solid rgba(56, 189, 248, 0.4)',
            background: 'var(--bg-card)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🔍</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-main)' }}>
                Incident Evidence Detail — {selectedEvent.event_id}
              </h3>
            </div>
            <button
              onClick={() => setSelectedEvent(null)}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, fontSize: 13, marginBottom: 16 }}>
            <div>
              <span style={{ color: '#94a3b8', display: 'block', fontSize: 11 }}>TIMESTAMP</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>
                {selectedEvent.start_time ? new Date(selectedEvent.start_time * 1000).toLocaleString() : 'Recent'}
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8', display: 'block', fontSize: 11 }}>TRIGGER RISK</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#f87171' }}>
                {((selectedEvent.trigger_probability || 0) * 100).toFixed(2)}%
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8', display: 'block', fontSize: 11 }}>UNCERTAINTY ESTIMATE</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#c084fc' }}>
                {(selectedEvent.uncertainty || 0).toFixed(4)}
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8', display: 'block', fontSize: 11 }}>EARLY WARNING LEAD TIME</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#38bdf8' }}>
                {selectedEvent.warning_lead_time ? `${selectedEvent.warning_lead_time} s` : 'N/A'}
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8', display: 'block', fontSize: 11 }}>PERSISTENCE STATUS</span>
              <span style={{ color: '#34d399', fontWeight: 600 }}>Archived to Evidence Disk</span>
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.4)', padding: 12, borderRadius: 6, fontSize: 12, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
            Evidence Artifact: {selectedEvent.video_reference || 'results/event_evidence/{event_id}.mp4'}
          </div>
        </div>
      )}

      {/* Ground-Truth Evaluation Reference Table */}
      <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
        <h3 style={{ fontSize: 15, margin: '0 0 6px 0', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>📋</span> AI City Challenge 2021 Track 4 Ground-Truth Benchmark Database
        </h3>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 14 }}>
          Supervision intervals from official test annotations (`train-anomaly-results.txt`) evaluated during real-time processing to compute warning lead time horizons.
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', textAlign: 'left' }}>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Video ID</th>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Anomaly Onset</th>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Anomaly End</th>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Duration</th>
                <th style={{ padding: '10px 8px', fontWeight: 600 }}>Supervised Event Description</th>
              </tr>
            </thead>
            <tbody>
              {GROUND_TRUTH_EVENTS.map((gt, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 700, color: '#60a5fa' }}>Video #{gt.video_id}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'JetBrains Mono, monospace', color: '#fbbf24', fontWeight: 700 }}>
                    {gt.onset_s.toFixed(1)} s
                  </td>
                  <td style={{ padding: '10px 8px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>
                    {gt.end_s.toFixed(1)} s
                  </td>
                  <td style={{ padding: '10px 8px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>
                    {(gt.end_s - gt.onset_s).toFixed(1)} s
                  </td>
                  <td style={{ padding: '10px 8px', color: 'var(--text-main)' }}>{gt.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
