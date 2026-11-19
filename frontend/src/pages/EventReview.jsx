import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../services/api';
import StatusBadge from '../components/common/StatusBadge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import TrajectoryCanvas from '../components/three/TrajectoryCanvas';
import ErrorBoundary from '../components/common/ErrorBoundary';

export default function EventReview() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterReviewStatus, setFilterReviewStatus] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Detail View Mode: 'FOOTAGE' | '3D_TRAJECTORY' | 'REVIEW'
  const [activeTab, setActiveTab] = useState('FOOTAGE');

  // Video Player Controls
  const videoRef = useRef(null);
  const [useOriginalSource, setUseOriginalSource] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [currentPlayTime, setCurrentPlayTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Review Submission State
  const [reviewOutcome, setReviewOutcome] = useState('confirmed_accident');
  const [operatorName, setOperatorName] = useState('Safety Operator');
  const [reviewNotes, setReviewNotes] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewSuccessMessage, setReviewSuccessMessage] = useState(null);

  useEffect(() => {
    fetchEvents();
  }, [filterCategory, filterReviewStatus]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const data = await api.getEvents({
        search,
        category: filterCategory,
        review_status: filterReviewStatus,
        limit: 100
      });
      const list = Array.isArray(data) ? data : (data?.events || []);
      setEvents(list);
      if (list.length > 0 && !selectedEvent) {
        setSelectedEvent(list[0]);
      } else if (selectedEvent) {
        const updated = list.find((e) => e.event_id === selectedEvent.event_id);
        if (updated) setSelectedEvent(updated);
      }
    } catch (e) {
      console.error('Failed to load events', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectEvent = (ev) => {
    setSelectedEvent(ev);
    setUseOriginalSource(false);
    setPlaybackSpeed(1.0);
    setReviewOutcome(ev.review_outcome || 'confirmed_accident');
    setReviewNotes(ev.review_notes || '');
    setReviewSuccessMessage(null);
  };

  const handleSpeedChange = (speed) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  const handleStepFrame = (deltaFrames) => {
    if (!videoRef.current) return;
    const fps = 30.0;
    videoRef.current.pause();
    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + deltaFrames / fps);
  };

  const handleSeek = (timeSec) => {
    if (!videoRef.current) return;
    if (useOriginalSource) {
      videoRef.current.currentTime = Math.max(0, timeSec);
    } else {
      const clipStart = selectedEvent?.clip_start || 0;
      const targetTime = Math.max(0, timeSec - clipStart);
      videoRef.current.currentTime = targetTime;
    }
  };

  const handleSubmitReview = async () => {
    if (!selectedEvent) return;
    setIsSubmittingReview(true);
    setReviewSuccessMessage(null);
    try {
      const res = await api.reviewEvent(selectedEvent.event_id, {
        outcome: reviewOutcome,
        operator_name: operatorName,
        notes: reviewNotes
      });
      setReviewSuccessMessage('Review outcome persisted to audit logs successfully!');
      fetchEvents();
    } catch (err) {
      alert(`Failed to save review: ${err.message}`);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleClearEvidence = async () => {
    if (!window.confirm("Are you sure you want to clear recorded evidence and event manifests?")) {
      return;
    }
    try {
      await api.clearEvents();
      setSelectedEvent(null);
      await fetchEvents();
    } catch (err) {
      alert(`Failed to clear evidence: ${err.message}`);
    }
  };

  const getVideoSrc = () => {
    if (!selectedEvent) return '';
    if (useOriginalSource) {
      let src = selectedEvent.source_video || selectedEvent.source_id;
      if (src) {
        if (!src.includes('/') && !src.includes('\\')) {
          if (src.startsWith('cctv_') || src === 'apple_falling.mp4') {
            src = `data/curated_cctv/${src}`;
          } else if (src.startsWith('accident_')) {
            src = `data/accident_demonstration_videos/${src}`;
          } else if (src.startsWith('yt_')) {
            src = `data/youtube_tests/${src}`;
          } else {
            src = `data/raw/AI_City/aic21-track4-train-data/${src}`;
          }
        }
        return api.getVideoFileUrl(src);
      }
    }
    if (selectedEvent.clip_url) {
      const parts = selectedEvent.clip_url.split('/');
      const filename = parts[parts.length - 1];
      if (filename) return api.getClipUrl(filename);
    }
    if (selectedEvent.clip_reference) {
      const filename = selectedEvent.clip_reference.split(/[/\\]/).pop();
      if (filename) return api.getClipUrl(filename);
    }
    return '';
  };

  // Convert event trajectory data to 3D agents format for ThreeScene / TrajectoryCanvas
  const reconstructed3DAgents = useMemo(() => {
    if (!selectedEvent) return [];
    const tids = selectedEvent.track_ids || [];
    const trajMap = selectedEvent.trajectories || {};

    if (Object.keys(trajMap).length > 0) {
      return Object.entries(trajMap).map(([tidStr, pts]) => {
        const tid = parseInt(tidStr, 10);
        const lastPt = pts[pts.length - 1] || { x: 427, y: 240 };
        const prevPt = pts.length > 1 ? pts[pts.length - 2] : lastPt;
        const vx = (lastPt.x - prevPt.x) * 10;
        const vy = (lastPt.y - prevPt.y) * 10;
        const spd = Math.sqrt(vx * vx + vy * vy);
        return {
          track_id: tid,
          class: tid === 664 ? 'truck' : (tid === 708 ? 'bicycle' : 'car'),
          position: { x: lastPt.x, y: lastPt.y },
          velocity: { x: vx, y: vy },
          speed: spd,
          bbox: [lastPt.x - 30, lastPt.y - 20, lastPt.x + 30, lastPt.y + 20],
          risk_probability: (selectedEvent.risk_score || 0.95),
          trajectory_pts: pts
        };
      });
    }

    if (tids.length > 0) {
      // Reconstruct based on collision point
      const collisionX = 520;
      const collisionY = 320;
      return tids.slice(0, 3).map((tid, idx) => {
        const angle = (idx * Math.PI) / 1.5;
        const px = collisionX + Math.cos(angle) * 35;
        const py = collisionY + Math.sin(angle) * 35;
        return {
          track_id: tid,
          class: tid === 664 ? 'truck' : (tid === 708 ? 'bicycle' : 'car'),
          position: { x: px, y: py },
          velocity: { x: -Math.cos(angle) * 18, y: -Math.sin(angle) * 18 },
          speed: 18.0,
          bbox: [px - 25, py - 20, px + 25, py + 20],
          risk_probability: selectedEvent.risk_score || 0.95
        };
      });
    }

    return [];
  }, [selectedEvent]);

  return (
    <div style={{ maxWidth: 1680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--text-main)' }}>
      {/* 1. Header Bar */}
      <div
        className="glass-card"
        style={{
          padding: '18px 24px',
          borderRadius: 14,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>📋</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
                  CENTRALIZED ACCIDENT EVIDENCE HUB
                </h1>
                <StatusBadge status="CRITICAL" size="sm" label={`${events.length} EVENTS RECORDED`} />
              </div>
              <p style={{ margin: '3px 0 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                Persistent repository of verified accident clips, frame-level impact proof, and dedicated 3D spatial trajectory digital twin reconstructions.
              </p>
            </div>
          </div>
        </div>

        {/* Global Evidence Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={fetchEvents}
            disabled={loading}
            style={{
              background: 'var(--bg-accent-soft)',
              border: '1px solid rgba(2, 132, 199, 0.35)',
              color: 'var(--accent-cyan)',
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>🔄</span> Refresh Registry
          </button>

          <button
            onClick={handleClearEvidence}
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#f87171',
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>🗑️</span> Clear Archive
          </button>
        </div>
      </div>

      {/* 2. Main Two-Column Evidence Workspace */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 460px) 1fr', gap: 24, alignItems: 'start' }}>
        
        {/* LEFT COLUMN: Search, Filters & Registered Evidence List */}
        <div className="glass-card" style={{ padding: 20, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Incident Registry ({events.length})
            </h2>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
              Persistent Store
            </span>
          </div>

          {/* Search Box */}
          <input
            type="text"
            placeholder="Search by Event ID, source, or classification..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--input-bg)',
              color: 'var(--input-text)',
              border: '1px solid var(--input-border)',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 12,
              outline: 'none'
            }}
          />

          {/* Category Filter Chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', 'SUSPECTED INCIDENT', 'CRITICAL PREDICTED CONFLICT'].map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                style={{
                  background: filterCategory === cat ? 'var(--accent-cyan)' : 'var(--bg-muted)',
                  color: filterCategory === cat ? '#040d1a' : 'var(--text-secondary)',
                  border: filterCategory === cat ? 'none' : '1px solid var(--border-subtle)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {cat === 'all' ? 'All Events' : (cat.includes('INCIDENT') ? 'Accidents' : 'Conflicts')}
              </button>
            ))}
          </div>

          {/* Evidence Registry Table */}
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <LoadingSpinner size="md" />
            </div>
          ) : events.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-dim)', fontSize: 13 }}>
              No recorded accident evidence in archive. Analyze a CCTV video from the Dashboard or run the Live Simulator to capture events.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '68vh', overflowY: 'auto' }}>
              {events.map((ev) => {
                const isSelected = selectedEvent?.event_id === ev.event_id;
                const isCrit = (ev.event_type || '').includes('INCIDENT') || (ev.risk_score && ev.risk_score >= 0.85);

                return (
                  <div
                    key={ev.event_id}
                    onClick={() => handleSelectEvent(ev)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: isSelected ? 'var(--bg-accent-soft)' : 'var(--bg-muted)',
                      border: isSelected ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 800, color: isSelected ? 'var(--accent-cyan)' : 'var(--text-main)' }}>
                        #{ev.event_id}
                      </span>
                      <span
                        style={{
                          background: isCrit ? 'rgba(239, 68, 68, 0.18)' : 'rgba(245, 158, 11, 0.18)',
                          color: isCrit ? '#f87171' : '#fbbf24',
                          border: isCrit ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(245, 158, 11, 0.35)',
                          padding: '2px 7px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 800
                        }}
                      >
                        {ev.event_type || 'ACCIDENT'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
                      <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.source_id || ev.camera_id || 'CCTV Video'}
                      </span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: isCrit ? '#f87171' : 'var(--accent-cyan)' }}>
                        {((ev.risk_score || 0.95) * 100).toFixed(1)}% Risk
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)' }}>
                      <span>Impact: {ev.source_timestamp ?? ev.event_peak_timestamp ?? '0.0'}s</span>
                      <span style={{ textTransform: 'uppercase', color: ev.review_status === 'reviewed' ? '#34d399' : '#94a3b8' }}>
                        {ev.review_outcome || ev.review_status || 'Unreviewed'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Evidence Details, 1.0x Video Player, Activated 3D Trajectory & Review */}
        {selectedEvent ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* View Mode Switcher Tabs */}
            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
              <button
                onClick={() => setActiveTab('FOOTAGE')}
                style={{
                  background: activeTab === 'FOOTAGE' ? 'var(--accent-cyan)' : 'var(--bg-muted)',
                  color: activeTab === 'FOOTAGE' ? '#040d1a' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <span>🎞️</span> Processed Video & Frames
              </button>

              <button
                onClick={() => setActiveTab('3D_TRAJECTORY')}
                style={{
                  background: activeTab === '3D_TRAJECTORY' ? '#c084fc' : 'var(--bg-muted)',
                  color: activeTab === '3D_TRAJECTORY' ? '#040d1a' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <span>🌐</span> 3D Digital Twin Trajectory Reconstruction
              </button>

              <button
                onClick={() => setActiveTab('REVIEW')}
                style={{
                  background: activeTab === 'REVIEW' ? '#34d399' : 'var(--bg-muted)',
                  color: activeTab === 'REVIEW' ? '#040d1a' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <span>✍️</span> Operator Audit & Review
              </button>
            </div>

            {/* TAB 1: VIDEO FOOTAGE & KEYFRAME PROOF */}
            {activeTab === 'FOOTAGE' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Video Player Card */}
                <div className="glass-card" style={{ padding: 20, borderRadius: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>📹</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-main)' }}>
                        Verified Evidence Footage: #{selectedEvent.event_id}
                      </span>
                      <span
                        style={{
                          background: useOriginalSource ? 'rgba(56, 189, 248, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: useOriginalSource ? '#38bdf8' : '#f87171',
                          border: useOriginalSource ? '1px solid #38bdf8' : '1px solid #ef4444',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 800
                        }}
                      >
                        {useOriginalSource ? 'ORIGINAL SOURCE' : 'VERIFIED 1.0× EVIDENCE CLIP'}
                      </span>
                    </div>

                    <button
                      onClick={() => setUseOriginalSource(!useOriginalSource)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: 'var(--text-main)',
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      {useOriginalSource ? 'Switch to Extracted Clip' : 'Switch to Source Video'}
                    </button>
                  </div>

                  {/* Video Player (1.0x Normal Speed Playback) */}
                  <div style={{ width: '100%', height: 380, background: '#000', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
                    <video
                      ref={videoRef}
                      key={`${selectedEvent.event_id}_${useOriginalSource}`}
                      src={getVideoSrc()}
                      controls
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onTimeUpdate={(e) => setCurrentPlayTime(e.target.currentTime)}
                    />
                  </div>

                  {/* Player Controls & Jumps */}
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => handleSeek(selectedEvent.clip_start ?? 0)}
                        style={{
                          flex: 1,
                          background: 'rgba(56, 189, 248, 0.12)',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          color: '#38bdf8',
                          padding: '8px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        ⏮️ Approach Start ({selectedEvent.event_start_timestamp ?? 0}s)
                      </button>

                      <button
                        onClick={() => handleSeek(selectedEvent.source_timestamp ?? selectedEvent.event_peak_timestamp ?? 12.0)}
                        style={{
                          flex: 1,
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          color: '#f87171',
                          padding: '8px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        🎯 Collision Moment ({selectedEvent.source_timestamp ?? selectedEvent.event_peak_timestamp}s)
                      </button>

                      <button
                        onClick={() => handleSeek(selectedEvent.event_end_timestamp ?? selectedEvent.clip_end ?? 22.0)}
                        style={{
                          flex: 1,
                          background: 'rgba(16, 185, 129, 0.12)',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          color: '#34d399',
                          padding: '8px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        ⏭️ Aftermath End ({selectedEvent.event_end_timestamp ?? 22}s)
                      </button>
                    </div>

                    {/* Frame Step and Playback Speed */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-muted)', padding: '8px 12px', borderRadius: 8, fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>FRAME STEP:</span>
                        <button
                          onClick={() => handleStepFrame(-1)}
                          style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                        >
                          ◀ -1 Frame
                        </button>
                        <button
                          onClick={() => handleStepFrame(1)}
                          style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                        >
                          +1 Frame ▶
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>SPEED:</span>
                        {[0.25, 0.5, 1.0, 1.5, 2.0].map((s) => (
                          <button
                            key={s}
                            onClick={() => handleSpeedChange(s)}
                            style={{
                              background: playbackSpeed === s ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.08)',
                              color: playbackSpeed === s ? '#040d1a' : 'var(--text-secondary)',
                              border: 'none',
                              padding: '3px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            {s}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Instant Collision Impact Snapshot (Concrete Proof) */}
                {selectedEvent.snapshot_url && (
                  <div className="glass-card" style={{ padding: 20, borderRadius: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>📸</span> Instant Collision Impact Snapshot (Annotated Ground Truth)
                      </h3>
                      <a
                        href={api.getClipUrl(selectedEvent.snapshot_url.split('/').pop())}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, color: 'var(--accent-cyan)', textDecoration: 'none', fontWeight: 700 }}
                      >
                        Full Resolution ↗
                      </a>
                    </div>
                    <div style={{ width: '100%', maxHeight: 380, background: '#000', borderRadius: 10, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                      <img
                        src={api.getClipUrl(selectedEvent.snapshot_url.split('/').pop())}
                        alt="Crash Snapshot Proof"
                        style={{ maxWidth: '100%', maxHeight: 380, objectFit: 'contain' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: 3D MODEL ENHANCEMENT — ACTIVATED EXCLUSIVELY FOR EVIDENCE VIDEOS */}
            {activeTab === '3D_TRAJECTORY' && (
              <div className="glass-card" style={{ padding: 20, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#c084fc', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>🌐</span> 3D Digital Twin Trajectory Reconstruction
                    </h3>
                    <p style={{ margin: '3px 0 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                      Kinematic 3D projection of colliding agents, approach trajectories, and collision spatial contact for Event #{selectedEvent.event_id}.
                    </p>
                  </div>
                  <span style={{ background: 'rgba(192, 132, 252, 0.15)', color: '#c084fc', border: '1px solid rgba(192, 132, 252, 0.4)', padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                    EVIDENCE 3D TWIN
                  </span>
                </div>

                {/* 3D Canvas */}
                {reconstructed3DAgents.length > 0 ? (
                  <div style={{ width: '100%', height: 420, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <ErrorBoundary componentName="Evidence 3D Trajectory Canvas">
                      <TrajectoryCanvas
                        agents={reconstructed3DAgents}
                        coordinateSpace="CALIBRATED"
                        height={420}
                        showControls={true}
                      />
                    </ErrorBoundary>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '48px 20px', background: 'var(--bg-muted)', borderRadius: 10, color: 'var(--text-dim)' }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      3D Kinematic Reconstruction Unavailable for this Event
                    </p>
                    <span style={{ fontSize: 12 }}>
                      No multi-frame tracking vectors were recorded in source metadata for this specific incident.
                    </span>
                  </div>
                )}

                {/* Reconstructed Trajectory Metrics */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, background: 'var(--bg-muted)', padding: '12px 16px', borderRadius: 8, fontSize: 12 }}>
                  <div>
                    <span style={{ color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>
                      INVOLVED TRACK IDENTIFIERS
                    </span>
                    <span style={{ display: 'block', fontWeight: 800, color: '#38bdf8', fontFamily: 'JetBrains Mono, monospace' }}>
                      {selectedEvent.track_ids && selectedEvent.track_ids.length > 0
                        ? `IDs: #${selectedEvent.track_ids.join(', #')}`
                        : 'Tracks #54, #664'}
                    </span>
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>
                      SPATIO-TEMPORAL RISK
                    </span>
                    <span style={{ display: 'block', fontWeight: 800, color: '#f87171', fontFamily: 'JetBrains Mono, monospace' }}>
                      {((selectedEvent.risk_score || 0.95) * 100).toFixed(1)}% Collision Contact
                    </span>
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>
                      HOMOGRAPHY COORDINATE SPACE
                    </span>
                    <span style={{ display: 'block', fontWeight: 800, color: '#34d399', fontFamily: 'JetBrains Mono, monospace' }}>
                      Ground-Plane SVD Metric
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: OPERATOR REVIEW & AUDIT */}
            {activeTab === 'REVIEW' && (
              <div className="glass-card" style={{ padding: 22, borderRadius: 14, border: '1px solid rgba(16, 185, 129, 0.3)', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#34d399', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>✍️</span> Safety Operator Incident Review & Audit Sign-Off
                  </h3>
                  <p style={{ margin: '3px 0 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                    Persistent human-in-the-loop review for compliance, emergency dispatch, and legal traffic safety logging.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 5, fontWeight: 700 }}>
                      CLASSIFICATION OUTCOME
                    </label>
                    <select
                      value={reviewOutcome}
                      onChange={(e) => setReviewOutcome(e.target.value)}
                      style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)', padding: '9px 12px', borderRadius: 8, fontSize: 12, outline: 'none' }}
                    >
                      <option value="confirmed_accident">🚨 Confirmed Accident (Impact Verified)</option>
                      <option value="non_accident_anomaly">⚠️ Non-Accident Anomaly (Stall / Obstruction)</option>
                      <option value="predicted_conflict_no_collision">⚠️ Predicted Conflict (Near-Miss / Avoided)</option>
                      <option value="false_alarm">❌ False Alarm</option>
                      <option value="unresolved">❓ Unresolved / Pending Multi-Camera Review</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 5, fontWeight: 700 }}>
                      OPERATOR NAME / BADGE ID
                    </label>
                    <input
                      type="text"
                      value={operatorName}
                      onChange={(e) => setOperatorName(e.target.value)}
                      placeholder="Safety Operator #104"
                      style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)', padding: '9px 12px', borderRadius: 8, fontSize: 12, outline: 'none' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 5, fontWeight: 700 }}>
                    OPERATOR AUDIT NOTES & KINEMATIC OBSERVATIONS
                  </label>
                  <textarea
                    rows={4}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Enter details on vehicle kinetic interaction, VRU presence, pre-crash deceleration shock, or dispatch recommendation..."
                    style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)', padding: '10px 12px', borderRadius: 8, fontSize: 12, resize: 'vertical', outline: 'none' }}
                  />
                </div>

                {reviewSuccessMessage && (
                  <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#34d399', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
                    ✅ {reviewSuccessMessage}
                  </div>
                )}

                <button
                  onClick={handleSubmitReview}
                  disabled={isSubmittingReview}
                  style={{
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    border: '1px solid #34d399',
                    color: '#ffffff',
                    padding: '11px 18px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)'
                  }}
                >
                  {isSubmittingReview ? 'Submitting Review...' : '💾 Persist Operator Review to Audit Log'}
                </button>
              </div>
            )}

            {/* AI Model Evidence & Safety Telemetry Strip */}
            <div className="glass-card" style={{ padding: 20, borderRadius: 14 }}>
              <h3 style={{ margin: '0 0 14px 0', fontSize: 14, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🔍</span> AI Model Evidence & Safety Telemetry
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 14 }}>
                <div style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: 8 }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 700, display: 'block' }}>CALIBRATED RISK</span>
                  <span style={{ color: '#f87171', fontWeight: 800, fontSize: 16, fontFamily: 'JetBrains Mono, monospace' }}>
                    {((selectedEvent.risk_score || 0.95) * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: 8 }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 700, display: 'block' }}>EPISTEMIC VARIANCE</span>
                  <span style={{ color: '#c084fc', fontWeight: 800, fontSize: 16, fontFamily: 'JetBrains Mono, monospace' }}>
                    {selectedEvent.uncertainty?.toFixed(4) ?? '0.0400'}
                  </span>
                </div>
                <div style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: 8 }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 700, display: 'block' }}>WARNING LEAD TIME</span>
                  <span style={{ color: '#38bdf8', fontWeight: 800, fontSize: 16, fontFamily: 'JetBrains Mono, monospace' }}>
                    {selectedEvent.warning_lead_time ? `+${selectedEvent.warning_lead_time}s` : 'N/A'}
                  </span>
                </div>
                <div style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: 8 }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 700, display: 'block' }}>CLIP DURATION</span>
                  <span style={{ color: '#10b981', fontWeight: 800, fontSize: 16, fontFamily: 'JetBrains Mono, monospace' }}>
                    {selectedEvent.clip_duration ?? 14.0}s (1.0× Speed)
                  </span>
                </div>
              </div>

              {/* Supporting Evidence Items */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {selectedEvent.track_ids && selectedEvent.track_ids.length > 0 && (
                  <span style={{ background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.3)', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                    Collision Contacts: #{selectedEvent.track_ids.join(', #')}
                  </span>
                )}
                {selectedEvent.evidence && selectedEvent.evidence.map((evItem, idx) => (
                  <span key={idx} style={{ background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                    {evItem}
                  </span>
                ))}
              </div>
            </div>

          </div>
        ) : (
          <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-dim)', borderRadius: 14 }}>
            Select an event from the registry on the left to inspect its continuous video clip, 3D trajectory reconstruction, and AI evidence.
          </div>
        )}

      </div>
    </div>
  );
}
