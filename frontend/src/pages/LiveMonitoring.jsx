import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelemetryContext } from '../context/TelemetryContext';
import { api } from '../services/api';
import StatusBadge from '../components/common/StatusBadge';
import AlertBanner from '../components/common/AlertBanner';
import { AVAILABLE_VIDEOS as INITIAL_VIDEOS } from '../constants/availableVideos';

export default function LiveMonitoring() {
  const navigate = useNavigate();
  const { status, telemetry, agents, risk, metrics, coordinateSpace, frameId, videoTime } = useTelemetryContext();

  const [videoList, setVideoList] = useState(INITIAL_VIDEOS);
  const [selectedVideo, setSelectedVideo] = useState(INITIAL_VIDEOS[0].path);
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [engine, setEngine] = useState('onnx');
  const [graphMode, setGraphMode] = useState('G3');
  const [alertPolicy, setAlertPolicy] = useState('density_conditioned');
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isStarting, setIsStarting] = useState(false);
  const [videoStatus, setVideoStatus] = useState(null);
  const [streamKey, setStreamKey] = useState(Date.now());

  // Filters & Search
  const [classFilter, setClassFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('speed');

  useEffect(() => {
    fetchStatus();
    loadCatalog();
    
    // Automatically respect URL navigation params (e.g. from Dashboard or Evidence Hub)
    const urlParams = new URLSearchParams(window.location.search);
    const videoParam = urlParams.get('video');
    const seekParam = urlParams.get('seek');
    if (videoParam) {
      setSelectedVideo(videoParam);
      handleStart(videoParam, seekParam ? parseFloat(seekParam) : 0.0);
    }

    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadCatalog = async () => {
    try {
      const res = await api.getAnalysisVideos();
      if (res?.videos && res.videos.length > 0) {
        const existingPaths = new Set(INITIAL_VIDEOS.map((v) => v.path));
        const extraVideos = res.videos
          .filter((v) => !existingPaths.has(v.path))
          .map((v) => ({
            id: v.id,
            path: v.path,
            label: v.label,
            seekTime: v.default_seek_seconds || 0.0,
            category: v.category || 'surveillance',
            desc: `${v.filename} (${v.file_size_mb} MB)`
          }));
        if (extraVideos.length > 0) {
          setVideoList([...INITIAL_VIDEOS, ...extraVideos]);
        }
      }
    } catch (_) {}
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const res = await api.uploadVideo(file);
      const newVid = {
        id: res.id,
        path: res.path,
        label: res.label,
        seekTime: 0.0,
        category: 'uploaded',
        desc: `Uploaded video: ${res.filename} (${res.resolution} @ ${res.fps} fps)`
      };
      setVideoList((prev) => [newVid, ...prev.filter((v) => v.path !== res.path)]);
      setSelectedVideo(res.path);
      alert(`Video uploaded successfully: ${file.name}`);
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const fetchStatus = async () => {
    try {
      const vs = await api.getVideoStatus();
      setVideoStatus(vs);
    } catch (_) {}
  };

  const handleSpeedChange = async (speed) => {
    setPlaybackSpeed(speed);
    try {
      await api.setPlaybackSpeed(speed);
    } catch (_) {}
  };

  const handleStart = async (customPath = null, customStart = null) => {
    setIsStarting(true);
    const targetVideo = (typeof customPath === 'string' && customPath.trim().length > 0)
      ? customPath
      : selectedVideo;
    if (customPath) {
      setSelectedVideo(customPath);
    }
    const vidMeta = videoList.find((v) => v.path === targetVideo);
    const startSec = (typeof customStart === 'number')
      ? customStart
      : 0.0; // Play entire CCTV clip from 0.0s by default!
    try {
      setVideoStatus({ is_playing: true, video_path: targetVideo });
      await api.startVideo({
        video_path: String(targetVideo),
        engine,
        graph_mode: graphMode,
        alert_policy: alertPolicy,
        start_time_seconds: Number(startSec),
        playback_speed: Number(playbackSpeed)
      });
      setStreamKey(Date.now());
      await fetchStatus();
    } catch (err) {
      alert(`Start failed: ${err.message}`);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      setVideoStatus({ is_playing: false });
      await api.stopVideo();
      setStreamKey(Date.now());
      await fetchStatus();
    } catch (err) {
      alert(`Stop failed: ${err.message}`);
    }
  };

  const isPlaying = videoStatus?.is_playing || false;

  // Memoized Filter & sort agents
  const filteredAgents = useMemo(() => {
    return agents
      .filter((a) => {
        if (classFilter !== 'all' && (a.class || '').toLowerCase() !== classFilter) return false;
        if (searchQuery && !String(a.track_id).includes(searchQuery)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'speed') return (b.speed || 0) - (a.speed || 0);
        if (sortBy === 'risk') return (b.risk_probability || 0) - (a.risk_probability || 0);
        if (sortBy === 'track_id') return a.track_id - b.track_id;
        return 0;
      });
  }, [agents, classFilter, searchQuery, sortBy]);

  const getClassBadgeStyle = (cls) => {
    const c = (cls || '').toLowerCase();
    if (c.includes('pedestrian')) return { bg: 'var(--badge-normal-bg)', text: 'var(--badge-normal-text)', border: 'var(--badge-normal-border)' };
    if (c.includes('cycle') || c.includes('motor')) return { bg: 'var(--badge-info-bg)', text: 'var(--badge-info-text)', border: 'var(--badge-info-border)' };
    if (c.includes('truck') || c.includes('bus')) return { bg: 'var(--badge-warning-bg)', text: 'var(--badge-warning-text)', border: 'var(--badge-warning-border)' };
    return { bg: 'var(--bg-accent-soft)', text: 'var(--accent-cyan)', border: 'rgba(2, 132, 199, 0.25)' };
  };

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Alert Banner */}
      {risk && risk.isAlert && (
        <AlertBanner
          warningState={risk.warningState}
          calibratedRisk={risk.calibrated}
          leadTime={risk.leadTime}
          uncertainty={risk.uncertainty}
          threshold={alertPolicy === 'density_conditioned' ? 0.60 : 0.65}
          videoTime={videoTime}
        />
      )}

      {/* Professor Accident Demonstration Presets Showcase */}
      <div
        className="glass-card"
        style={{
          padding: '14px 18px',
          borderRadius: 12,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🎯</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.01em' }}>
              PROFESSOR DEMO SHOWCASE — HIGH-IMPACT REAL ACCIDENT PRESETS
            </span>
            <span style={{ background: 'var(--bg-accent-soft)', color: 'var(--accent-cyan)', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
              AUTO-SEEK (PRE-CRASH WINDOW)
            </span>
          </div>
          <p style={{ margin: '3px 0 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
            Click any scenario to immediately seek 7–8s before impact and observe pre-event warning, calibrated risk surge, and 3D interaction graphs.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => handleStart('data/accident_demonstration_videos/accident_04_urban_intersection_crash.mp4', 0.0)}
            disabled={isStarting}
            style={{
              background: 'var(--badge-danger-bg)',
              border: '1px solid var(--badge-danger-border)',
              color: 'var(--badge-danger-text)',
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
            <span>🚨</span> Demo 1: Urban CCTV Crash (Car vs Bus, 28s)
          </button>

          <button
            onClick={() => handleStart('data/accident_demonstration_videos/accident_06_car_vs_truck_intersection.mp4', 0.0)}
            disabled={isStarting}
            style={{
              background: 'var(--bg-accent-soft)',
              border: '1px solid rgba(2, 132, 199, 0.35)',
              color: 'var(--accent-cyan)',
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
            <span>💥</span> Demo 2: Heavy Truck CCTV Collision (36s)
          </button>

          <button
            onClick={() => handleStart('data/accident_demonstration_videos/accident_03_school_crosswalk_nearmiss.mp4', 0.0)}
            disabled={isStarting}
            style={{
              background: 'var(--badge-warning-bg)',
              border: '1px solid var(--badge-warning-border)',
              color: 'var(--badge-warning-text)',
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
            <span>🚶</span> Demo 3: School Crosswalk VRU Hazard (48s)
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isPlaying || isUploading}
            title="Upload any real video from your computer to analyze"
            style={{
              background: 'var(--bg-accent-soft)',
              border: '1px solid var(--accent-cyan)',
              color: 'var(--accent-cyan)',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>📤</span> {isUploading ? 'Uploading...' : 'Upload Custom Video'}
          </button>
        </div>
      </div>

      {/* Control Station Header Bar */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 700 }}>CCTV CAMERA FEED</label>
            <select
              value={selectedVideo}
              onChange={(e) => setSelectedVideo(e.target.value)}
              disabled={isPlaying}
              style={{
                background: 'var(--input-bg)',
                color: 'var(--input-text)',
                border: '1px solid var(--input-border)',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                outline: 'none',
                minWidth: 320
              }}
            >
              {videoList.map((v) => (
                <option key={v.id} value={v.path}>{v.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isPlaying || isUploading}
              title="Upload any traffic video from computer"
              style={{
                marginLeft: 8,
                background: 'var(--bg-accent-soft)',
                border: '1px solid rgba(2, 132, 199, 0.35)',
                color: 'var(--accent-cyan)',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {isUploading ? '⏳ Uploading...' : '📤 Upload'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mp4,.avi,.mov,.mkv"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 700 }}>RUNTIME ENGINE</label>
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              disabled={isPlaying}
              style={{
                background: 'var(--input-bg)',
                color: 'var(--input-text)',
                border: '1px solid var(--input-border)',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                outline: 'none'
              }}
            >
              <option value="pytorch">PyTorch (FP32 CPU Baseline)</option>
              <option value="onnx">ONNX Runtime (Optimized +32%)</option>
              <option value="sgas">Mode C: SGAS (Adaptive Slicing)</option>
              <option value="sahi">Mode B: Uniform SAHI (High Recall)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 700 }}>GRAPH PRUNING</label>
            <select
              value={graphMode}
              onChange={(e) => setGraphMode(e.target.value)}
              disabled={isPlaying}
              style={{
                background: 'var(--input-bg)',
                color: 'var(--input-text)',
                border: '1px solid var(--input-border)',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                outline: 'none'
              }}
            >
              <option value="G0">G0: Full Graph</option>
              <option value="G1">G1: k-NN (k=4, -55.6% edges)</option>
              <option value="G2">G2: Distance-Gated (d≤0.25)</option>
              <option value="G3">G3: Hybrid (Spatial+Motion)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 700 }}>ALERT POLICY</label>
            <select
              value={alertPolicy}
              onChange={(e) => setAlertPolicy(e.target.value)}
              disabled={isPlaying}
              style={{
                background: 'var(--input-bg)',
                color: 'var(--input-text)',
                border: '1px solid var(--input-border)',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                outline: 'none'
              }}
            >
              <option value="fixed">Fixed Threshold (τ = 0.65)</option>
              <option value="density_conditioned">Traffic-Density Conditioned (τ = 0.60 + 0.15·ρ)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 700 }}>PLAYBACK SPEED</label>
            <div style={{ display: 'flex', gap: 3, background: 'var(--bg-muted)', padding: 3, borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
              {[
                { val: 0.5, label: '0.5x Slow' },
                { val: 1.0, label: '1.0x Normal' },
                { val: 1.5, label: '1.5x Brisk' },
                { val: 2.0, label: '2.0x Fast' },
                { val: 3.0, label: '3.0x Max' }
              ].map((sp) => (
                <button
                  key={sp.val}
                  type="button"
                  onClick={() => handleSpeedChange(sp.val)}
                  style={{
                    background: playbackSpeed === sp.val ? 'var(--accent-cyan)' : 'transparent',
                    color: playbackSpeed === sp.val ? '#ffffff' : 'var(--text-muted)',
                    border: 'none',
                    padding: '5px 9px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          {!isPlaying ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => handleStart(null, 0.0)}
                disabled={isStarting}
                title="Play full CCTV footage from 0.0 seconds"
                style={{
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 20px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)'
                }}
              >
                {isStarting ? 'Initializing...' : '▶ Start Stream (From 0s)'}
              </button>
              {(() => {
                const vm = videoList.find((v) => v.path === selectedVideo);
                const s = vm?.seekTime || 0.0;
                if (s > 0) {
                  return (
                    <button
                      onClick={() => handleStart(null, s)}
                      disabled={isStarting}
                      title={`Fast-forward directly to collision moment (${s}s)`}
                      style={{
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                        color: '#fff',
                        border: 'none',
                        padding: '9px 16px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)'
                      }}
                    >
                      ⚡ Jump to Incident ({s}s)
                    </button>
                  );
                }
                return null;
              })()}
            </div>
          ) : (
            <button
              onClick={handleStop}
              style={{
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                color: '#fff',
                border: 'none',
                padding: '9px 22px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)'
              }}
            >
              ⏹ Terminate Stream
            </button>
          )}
        </div>
      </div>

      {/* Main Video Viewport & Real-Time Telemetry Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
        {/* Left: CCTV Video Player & Frame Stats */}
        <div className="glass-card" style={{ padding: 20, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>📺</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-main)' }}>Live Annotated CCTV Stream</span>
              <StatusBadge status={isPlaying ? 'CONNECTED' : 'NOT LOADED'} size="sm" label={isPlaying ? 'ACTIVE' : 'OFFLINE'} />
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>
              FRAME: <b style={{ color: 'var(--accent-cyan)' }}>{frameId !== null ? frameId : '—'}</b> | TIME: <b style={{ color: 'var(--status-warning)' }}>{videoTime !== null ? `${videoTime}s` : '—'}</b>
            </div>
          </div>

          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '16/9',
              background: '#070d19',
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid var(--border-subtle)'
            }}
          >
            {isPlaying ? (
              <img
                key={streamKey}
                src={`${api.getVideoStreamUrl()}?t=${streamKey}`}
                alt="Live Stream"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-dim)',
                  gap: 8
                }}
              >
                <span style={{ fontSize: 40 }}>🛰️</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Stream Idle</span>
                <span style={{ fontSize: 12 }}>Click "Start Stream" above to activate detector and CAGT-Risk pipeline</span>
              </div>
            )}
          </div>

          {/* Telemetry Strip Under Video */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: 8,
              background: 'var(--bg-muted)',
              border: '1px solid var(--border-subtle)',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 12
            }}
          >
            <span>INFERENCE: <b style={{ color: 'var(--accent-cyan)' }}>{metrics?.inference_fps ?? '—'} FPS</b></span>
            <span>LATENCY: <b style={{ color: 'var(--text-main)' }}>{metrics?.latency_ms ?? '—'} ms</b></span>
            <span>SPACE: <b style={{ color: 'var(--status-normal)' }}>{coordinateSpace}</b></span>
            <span>TRACKS: <b style={{ color: 'var(--status-warning)' }}>{agents.length}</b></span>
          </div>
        </div>

        {/* Right: Live Object Telemetry Table */}
        <div className="glass-card" style={{ padding: 20, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>🎯</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-main)' }}>Active Detections & Trajectories</span>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'var(--bg-accent-soft)',
                  color: 'var(--accent-cyan)',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700
                }}
              >
                {filteredAgents.length} Agents
              </span>
            </div>

            {/* Filter controls */}
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                style={{
                  background: 'var(--input-bg)',
                  color: 'var(--input-text)',
                  border: '1px solid var(--input-border)',
                  padding: '4px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  outline: 'none'
                }}
              >
                <option value="all">All Classes</option>
                <option value="pedestrian">Pedestrians</option>
                <option value="car">Cars</option>
                <option value="truck">Trucks</option>
                <option value="bicycle">Bicycles</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  background: 'var(--input-bg)',
                  color: 'var(--input-text)',
                  border: '1px solid var(--input-border)',
                  padding: '4px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  outline: 'none'
                }}
              >
                <option value="speed">Sort by Speed</option>
                <option value="risk">Sort by Risk</option>
                <option value="track_id">Sort by ID</option>
              </select>
            </div>
          </div>

          {/* Table Container */}
          <div style={{ overflowX: 'auto', flex: 1, maxHeight: 520 }}>
            {filteredAgents.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', textAlign: 'left' }}>
                    <th style={{ padding: '8px 6px', fontWeight: 600 }}>ID</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600 }}>Class</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600 }}>Pos (X, Y)</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600 }}>Speed</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600 }}>Uncertainty</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600 }}>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map((a) => {
                    const badge = getClassBadgeStyle(a.class);
                    const isHighRisk = a.risk_probability > 0.65;
                    return (
                      <tr
                        key={a.track_id}
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          background: isHighRisk ? 'var(--badge-danger-bg)' : 'transparent',
                          transition: 'background 0.2s'
                        }}
                      >
                        <td style={{ padding: '8px 6px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                          #{a.track_id}
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              background: badge.bg,
                              color: badge.text,
                              border: `1px solid ${badge.border}`
                            }}
                          >
                            {a.class}
                          </span>
                        </td>
                        <td style={{ padding: '8px 6px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>
                          ({a.position?.x?.toFixed(0)}, {a.position?.y?.toFixed(0)})
                        </td>
                        <td style={{ padding: '8px 6px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--text-main)' }}>
                          {a.speed} px/s
                        </td>
                        <td style={{ padding: '8px 6px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-indigo)' }}>
                          {a.uncertainty?.toFixed(4)}
                        </td>
                        <td style={{ padding: '8px 6px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: isHighRisk ? 'var(--status-danger)' : 'var(--status-normal)' }}>
                          {((a.risk_probability || 0) * 100).toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '60px 20px',
                  color: '#64748b',
                  gap: 8
                }}
              >
                <span style={{ fontSize: 28 }}>🔍</span>
                <span>No tracked road users in current frame</span>
                <span style={{ fontSize: 11 }}>Agents tracked by ByteTrack will appear here in real-time</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
