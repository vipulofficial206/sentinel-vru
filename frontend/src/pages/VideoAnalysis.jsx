import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import StatusBadge from '../components/common/StatusBadge';
import MetricCard from '../components/common/MetricCard';
import LoadingSpinner from '../components/common/LoadingSpinner';

export default function VideoAnalysis() {
  const [selectedVideoPath, setSelectedVideoPath] = useState('');
  const [validationData, setValidationData] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState(null);

  // Configuration options
  const [engine, setEngine] = useState('onnx');
  const [sensitivity, setSensitivity] = useState('standard');
  const [frameStride, setFrameStride] = useState(2);
  const [preEventSeconds, setPreEventSeconds] = useState(4.0);
  const [postEventSeconds, setPostEventSeconds] = useState(8.0);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState('');

  // Active Job State
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobData, setJobData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allJobs, setAllJobs] = useState([]);

  // Video Preview Player
  const playerRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [previewClipUrl, setPreviewClipUrl] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);

  // Load existing jobs on mount
  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 4000);
    return () => clearInterval(interval);
  }, []);

  // Poll active job while running
  useEffect(() => {
    if (!activeJobId) return;
    let timer = null;

    const poll = async () => {
      try {
        const job = await api.getAnalysisJob(activeJobId);
        setJobData(job);
        if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
          loadJobs(); // Refresh jobs table
        }
      } catch (err) {
        console.error('Failed to poll job status:', err);
      }
    };

    poll();
    timer = setInterval(poll, 1500);
    return () => clearInterval(timer);
  }, [activeJobId]);

  const loadJobs = async () => {
    try {
      const res = await api.getAnalysisJobs();
      setAllJobs(res.jobs || []);
    } catch (_) {}
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setValidationError(null);
    try {
      const res = await api.uploadVideo(file);
      await handleSelectVideo(res.path);
    } catch (err) {
      setValidationError(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSelectVideo = async (path) => {
    setSelectedVideoPath(path);
    setValidationData(null);
    setValidationError(null);
    setPreviewClipUrl(null);
    setIsValidating(true);
    try {
      const val = await api.validateVideo(path);
      setValidationData(val);
    } catch (err) {
      setValidationError(err.message || 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const handleStartAnalysis = async () => {
    if (!selectedVideoPath || !validationData?.valid) return;
    setIsSubmitting(true);
    try {
      const payload = {
        video_path: selectedVideoPath,
        pre_event_seconds: Number(preEventSeconds),
        post_event_seconds: Number(postEventSeconds),
        frame_stride: Number(frameStride),
        engine,
        sensitivity,
        max_duration_seconds: maxDurationMinutes ? Number(maxDurationMinutes) * 60 : null
      };
      const res = await api.createAnalysisJob(payload);
      setActiveJobId(res.job_id);
      setJobData(null);
      loadJobs();
    } catch (err) {
      alert(`Failed to start analysis job: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJobId) return;
    try {
      await api.cancelAnalysisJob(activeJobId);
    } catch (err) {
      alert(`Cancellation failed: ${err.message}`);
    }
  };

  const handleSeekPlayer = (timeSec) => {
    if (playerRef.current) {
      playerRef.current.currentTime = timeSec;
      playerRef.current.play().catch(() => {});
    }
  };

  const isJobRunning = jobData && (jobData.status === 'RUNNING' || jobData.status === 'EXTRACTING_EVENTS' || jobData.status === 'QUEUED');

  return (
    <div style={{ maxWidth: 1680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--text-main)' }}>
      {/* 1. Header & System Mode Banner */}
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
            <span style={{ fontSize: 24 }}>🎞️</span>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-main)' }}>
              Recorded Video Analysis & Accident Interval Extraction
            </h1>
            <span
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: 'var(--accent-cyan)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'JetBrains Mono, monospace'
              }}
            >
              MODE B — OFFLINE BATCH
            </span>
          </div>
          <p style={{ margin: '5px 0 0 0', fontSize: 13, color: '#94a3b8' }}>
            Full source chronological video scanning, temporal kinematic conflict modeling, automatic candidate interval merging, and verified [-15s, +30s] clip extraction.
          </p>
        </div>

        {validationData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Source Duration</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent-cyan)', fontFamily: 'JetBrains Mono, monospace' }}>
                {validationData.duration}s ({Math.floor(validationData.duration / 60)}m {Math.floor(validationData.duration % 60)}s)
              </div>
            </div>
            <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.1)' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Resolution / FPS</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-main)', fontFamily: 'JetBrains Mono, monospace' }}>
                {validationData.resolution} @ {validationData.fps} fps
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Main 2-Column Workspace: Left Config & Select, Right Player & Progress */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1fr) minmax(600px, 1.4fr)', gap: 24, alignItems: 'start' }}>
        
        {/* LEFT COLUMN: Steps A, B, C */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* STEP A: Upload Source Video */}
          <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ background: 'var(--accent-cyan)', color: '#ffffff', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>A</span>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>
                Upload Source Video
              </h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Direct File Upload Dropzone */}
              {!selectedVideoPath ? (
                <div
                  onClick={() => !isJobRunning && !isUploading && fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed var(--border-strong)',
                    borderRadius: 10,
                    padding: '30px 16px',
                    textAlign: 'center',
                    background: 'var(--bg-accent-soft)',
                    cursor: isJobRunning || isUploading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  <span style={{ fontSize: 32 }}>📹</span>
                  <div style={{ color: 'var(--accent-cyan)', fontSize: 14, fontWeight: 700 }}>
                    {isUploading ? '⏳ Uploading & Validating Video...' : 'Click to Upload CCTV Video from Computer'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    Supports MP4, AVI, MOV, MKV surveillance footage (Automatically validated & indexed)
                  </div>
                  <button
                    type="button"
                    disabled={isJobRunning || isUploading}
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text-main)',
                      padding: '7px 16px',
                      borderRadius: 7,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      marginTop: 4
                    }}
                  >
                    📁 Browse Files
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    background: 'var(--bg-accent-soft)',
                    border: '1px solid rgba(2, 132, 199, 0.4)',
                    borderRadius: 10,
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ fontSize: 24, flexShrink: 0 }}>🎬</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {selectedVideoPath.split('/').pop().split('\\').pop()}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                        {validationData ? `${validationData.resolution} • ${validationData.fps} fps • ${validationData.duration}s` : 'Validating video...'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isJobRunning || isUploading}
                    style={{
                      background: 'var(--bg-muted)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--accent-cyan)',
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      flexShrink: 0
                    }}
                  >
                    Upload Another
                  </button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mp4,.avi,.mov,.mkv"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
                disabled={isJobRunning || isUploading}
              />

              {/* Validation Feedback Banner */}
              {validationError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#fca5a5' }}>
                  ⚠️ Validation Error: {validationError}
                </div>
              )}

              {validationData && (
                <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 8, padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: 12 }}>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 10, fontWeight: 700 }}>VALIDATION</span>
                    <span style={{ color: '#10b981', fontWeight: 800 }}>VERIFIED OK</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 10, fontWeight: 700 }}>TOTAL FRAMES</span>
                    <span style={{ color: 'var(--text-main)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{validationData.frame_count}</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 10, fontWeight: 700 }}>CODEC</span>
                    <span style={{ color: 'var(--text-main)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{validationData.codec}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* STEP B: Analysis Pipeline Configuration */}
          <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ background: 'var(--accent-cyan)', color: '#ffffff', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>B</span>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>
                Analysis & Extraction Settings
              </h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 700 }}>
                  INFERENCE ENGINE
                </label>
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value)}
                  disabled={isJobRunning}
                  style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)', padding: '8px 10px', borderRadius: 6, fontSize: 12 }}
                >
                  <option value="onnx">YOLO11m ONNX (Optimized)</option>
                  <option value="pytorch">YOLO11m PyTorch Native</option>
                  <option value="sgas">Mode C: SGAS (Safety-Guided Adaptive)</option>
                  <option value="sahi">Mode B: SAHI (Uniform Sliced)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 700 }}>
                  SENSITIVITY POLICY
                </label>
                <select
                  value={sensitivity}
                  onChange={(e) => setSensitivity(e.target.value)}
                  disabled={isJobRunning}
                  style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)', padding: '8px 10px', borderRadius: 6, fontSize: 12 }}
                >
                  <option value="standard">Standard (Threshold = 0.65)</option>
                  <option value="high">High Sensitivity (Threshold = 0.55)</option>
                  <option value="density_conditioned">Density Conditioned (Adaptive)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 700 }}>
                  PRE-EVENT CONTEXT (SEC)
                </label>
                <input
                  type="number"
                  min="2"
                  max="30"
                  step="0.5"
                  value={preEventSeconds}
                  onChange={(e) => setPreEventSeconds(e.target.value)}
                  disabled={isJobRunning}
                  style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)', padding: '8px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}
                />
                <span style={{ fontSize: 10, color: '#64748b' }}>Default: 4s lead footage</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 700 }}>
                  POST-EVENT CONTEXT (SEC)
                </label>
                <input
                  type="number"
                  min="3"
                  max="30"
                  step="0.5"
                  value={postEventSeconds}
                  onChange={(e) => setPostEventSeconds(e.target.value)}
                  disabled={isJobRunning}
                  style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)', padding: '8px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}
                />
                <span style={{ fontSize: 10, color: '#64748b' }}>Dynamic: 5-10s based on impact severity</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 700 }}>
                  SAMPLING CADENCE (STRIDE)
                </label>
                <select
                  value={frameStride}
                  onChange={(e) => setFrameStride(Number(e.target.value))}
                  disabled={isJobRunning}
                  style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)', padding: '8px 10px', borderRadius: 6, fontSize: 12 }}
                >
                  <option value={1}>Every Frame (1x - Full Resolution)</option>
                  <option value={2}>Every 2nd Frame (2x - Recommended Fast)</option>
                  <option value={3}>Every 3rd Frame (3x - High Throughput)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 700 }}>
                  DURATION LIMIT (MINUTES)
                </label>
                <input
                  type="number"
                  placeholder="Full video"
                  value={maxDurationMinutes}
                  onChange={(e) => setMaxDurationMinutes(e.target.value)}
                  disabled={isJobRunning}
                  style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)', padding: '8px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}
                />
                <span style={{ fontSize: 10, color: '#64748b' }}>Leave blank for complete video</span>
              </div>
            </div>

            {/* STEP C: Action Buttons */}
            <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
              <button
                onClick={handleStartAnalysis}
                disabled={!validationData?.valid || isSubmitting || isJobRunning}
                style={{
                  flex: 1,
                  background: isJobRunning ? 'rgba(56, 189, 248, 0.2)' : 'linear-gradient(135deg, #0284c7, #0369a1)',
                  border: '1px solid #38bdf8',
                  color: '#ffffff',
                  padding: '12px 18px',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: isJobRunning ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 14px rgba(2, 132, 199, 0.4)'
                }}
              >
                {isSubmitting ? 'Submitting Job...' : isJobRunning ? 'Analysis Job Running...' : '🚀 Start Analysis Job'}
              </button>

              {isJobRunning && (
                <button
                  onClick={handleCancelJob}
                  style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.6)',
                    color: '#f87171',
                    padding: '12px 18px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  ⏹️ Cancel Job
                </button>
              )}
            </div>
          </div>

          {/* Historical Jobs List */}
          <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📑 Recent Video Analysis Jobs</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>{allJobs.length} jobs</span>
            </h3>

            {allJobs.length === 0 ? (
              <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: '16px 0' }}>
                No recorded jobs yet. Launch your first analysis above!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                {allJobs.map((j) => (
                  <div
                    key={j.job_id}
                    onClick={() => setActiveJobId(j.job_id)}
                    style={{
                      background: activeJobId === j.job_id ? 'var(--bg-accent-soft)' : 'var(--bg-muted)',
                      border: activeJobId === j.job_id ? '1px solid var(--border-focus)' : '1px solid var(--border-subtle)',
                      padding: '10px 12px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 12
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{j.filename}</span>
                        <StatusBadge status={j.status} size="sm" />
                      </div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                        {j.candidate_events_count} events | {j.extracted_clips_count} clips | {j.speed_ratio}x speed
                      </div>
                    </div>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-cyan)', fontWeight: 700 }}>
                      {j.progress_percent}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Player, Progress, Timeline & Extracted Clips */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Video Player Display: Original or Extracted Clip */}
          <div className="glass-card" style={{ padding: 18, borderRadius: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>📺</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>
                  {previewClipUrl ? 'Extracted Incident Clip Preview' : 'Source Video Preview'}
                </span>
                {previewClipUrl && (
                  <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 800 }}>
                    CLIP PLAYBACK
                  </span>
                )}
              </div>

              {previewClipUrl && (
                <button
                  onClick={() => setPreviewClipUrl(null)}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#94a3b8',
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    cursor: 'pointer'
                  }}
                >
                  Switch to Source Video
                </button>
              )}
            </div>

            <div style={{ width: '100%', height: 380, background: '#000000', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
              {selectedVideoPath ? (
                <video
                  ref={playerRef}
                  key={previewClipUrl || selectedVideoPath}
                  src={previewClipUrl || api.getVideoFileUrl(selectedVideoPath)}
                  controls
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
                />
              ) : (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>
                  Select a video to initialize HTML5 player
                </div>
              )}
            </div>
          </div>

          {/* STEP D: Real-Time Analysis Job Progress */}
          {jobData && (
            <div className="glass-card" style={{ padding: 20, borderRadius: 12, border: '1px solid rgba(56, 189, 248, 0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>⚡</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-main)' }}>
                    Job Progress: #{jobData.job_id}
                  </span>
                  <StatusBadge status={jobData.status} size="sm" />
                </div>
                <span style={{ color: 'var(--accent-cyan)', fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 800 }}>
                  {jobData.progress_percent}%
                </span>
              </div>

              {/* Progress Bar */}
              <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 999, overflow: 'hidden', marginBottom: 16 }}>
                <div
                  style={{
                    width: `${jobData.progress_percent}%`,
                    height: '100%',
                    background: jobData.status === 'FAILED' ? '#ef4444' : jobData.status === 'COMPLETED' ? '#10b981' : 'linear-gradient(90deg, #0284c7, #38bdf8)',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>

              {/* Current Stage */}
              <div style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', padding: '8px 12px', borderRadius: 6, fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 600, marginBottom: 14 }}>
                Current Stage: {jobData.stage}
              </div>

              {/* Disaggregated Metrics Matrix */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, fontSize: 12 }}>
                <div style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: 8 }}>
                  <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, display: 'block' }}>VIDEO POSITION</span>
                  <span style={{ color: '#fff', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' }}>
                    {jobData.current_video_time}s / {jobData.video_duration}s
                  </span>
                </div>
                <div style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: 8 }}>
                  <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, display: 'block' }}>THROUGHPUT</span>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' }}>
                    {jobData.speed_ratio}x ({jobData.processing_speed_fps} fps)
                  </span>
                </div>
                <div style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: 8 }}>
                  <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, display: 'block' }}>CANDIDATE EVENTS</span>
                  <span style={{ color: '#f59e0b', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' }}>
                    {jobData.candidate_events?.length || 0}
                  </span>
                </div>
                <div style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: 8 }}>
                  <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, display: 'block' }}>EXTRACTED CLIPS</span>
                  <span style={{ color: '#10b981', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' }}>
                    {jobData.extracted_clips?.length || 0}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STEP E: Candidate Event Timeline */}
          {jobData && jobData.candidate_events && jobData.candidate_events.length > 0 && (
            <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🎯</span> Event Timeline Alignment (Aligned to Original Video Time)
              </h3>

              {/* Graphic Timeline Bar */}
              <div style={{ position: 'relative', width: '100%', height: 36, background: 'var(--bg-muted)', borderRadius: 8, border: '1px solid var(--border-subtle)', overflow: 'hidden', marginBottom: 16 }}>
                {jobData.candidate_events.map((ev, idx) => {
                  const dur = jobData.video_duration || 1;
                  const leftPct = (ev.candidate_start_time / dur) * 100;
                  const widthPct = Math.max(((ev.candidate_end_time - ev.candidate_start_time) / dur) * 100, 3);
                  const isCrit = ev.severity === 'critical';
                  return (
                    <div
                      key={idx}
                      onClick={() => handleSeekPlayer(ev.peak_time)}
                      title={`Event ${ev.event_id}: ${ev.event_type} @ ${ev.peak_time}s (Risk: ${ev.peak_risk})`}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        height: '100%',
                        background: isCrit ? 'rgba(239, 68, 68, 0.7)' : 'rgba(245, 158, 11, 0.7)',
                        borderLeft: isCrit ? '2px solid #ef4444' : '2px solid #f59e0b',
                        borderRight: isCrit ? '2px solid #ef4444' : '2px solid #f59e0b',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 800
                      }}
                    >
                      {ev.peak_time}s
                    </div>
                  );
                })}
              </div>

              {/* Event Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {jobData.candidate_events.map((ev) => (
                  <div
                    key={ev.event_id}
                    style={{
                      background: 'var(--bg-muted)',
                      border: ev.severity === 'critical' ? '1px solid var(--badge-danger-border)' : '1px solid var(--badge-warning-border)',
                      padding: '12px 14px',
                      borderRadius: 8,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 12
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 800, color: ev.severity === 'critical' ? '#f87171' : '#fbbf24', fontSize: 13 }}>
                          {ev.event_type}
                        </span>
                        <span style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
                          #{ev.event_id}
                        </span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                        Window: <b style={{ color: 'var(--text-main)' }}>{ev.candidate_start_time}s → {ev.candidate_end_time}s</b> | Peak: <b style={{ color: 'var(--accent-cyan)' }}>{ev.peak_time}s</b> | Risk: <b style={{ color: '#f87171' }}>{((ev.peak_risk || 0) * 100).toFixed(1)}%</b> | Tracks: {ev.associated_track_ids?.join(', ') || 'N/A'}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => handleSeekPlayer(ev.peak_time)}
                        style={{
                          background: 'rgba(56, 189, 248, 0.15)',
                          border: '1px solid rgba(56, 189, 248, 0.4)',
                          color: 'var(--accent-cyan)',
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Seek to {ev.peak_time}s
                      </button>

                      {ev.clip_url && (
                        <button
                          onClick={() => setPreviewClipUrl(api.getClipUrl(`${jobData.job_id}_${ev.event_id}.mp4`))}
                          style={{
                            background: 'rgba(16, 185, 129, 0.15)',
                            border: '1px solid rgba(16, 185, 129, 0.4)',
                            color: '#34d399',
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          Play Clip
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP F & G: Extracted Clips & Downloadable Manifest Summary */}
          {jobData && jobData.extracted_clips && jobData.extracted_clips.length > 0 && (
            <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>💾</span> Extracted Context Video Clips ({jobData.extracted_clips.length} Files)
                </h3>

                <div style={{ display: 'flex', gap: 8 }}>
                  <a
                    href={api.getJobManifestUrl(jobData.job_id, 'json')}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: 'rgba(56, 189, 248, 0.15)',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      color: 'var(--accent-cyan)',
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      textDecoration: 'none'
                    }}
                  >
                    📥 Manifest JSON
                  </a>
                  <a
                    href={api.getJobManifestUrl(jobData.job_id, 'csv')}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                      color: '#34d399',
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      textDecoration: 'none'
                    }}
                  >
                    📥 Manifest CSV
                  </a>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '8px 10px' }}>Clip ID</th>
                      <th style={{ padding: '8px 10px' }}>Start → End</th>
                      <th style={{ padding: '8px 10px' }}>Duration</th>
                      <th style={{ padding: '8px 10px' }}>Status</th>
                      <th style={{ padding: '8px 10px' }}>Verification Detail</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobData.extracted_clips.map((clip) => (
                      <tr key={clip.clip_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '10px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-cyan)' }}>
                          {clip.clip_id}
                        </td>
                        <td style={{ padding: '10px' }}>
                          {clip.clip_start}s → {clip.clip_end}s
                        </td>
                        <td style={{ padding: '10px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-cyan)' }}>
                          {clip.clip_duration}s
                        </td>
                        <td style={{ padding: '10px' }}>
                          <StatusBadge status={clip.clip_status === 'verified' ? 'CONNECTED' : 'DISCONNECTED'} size="sm" />
                        </td>
                        <td style={{ padding: '10px', color: '#64748b', fontSize: 11 }}>
                          {clip.clip_verification_detail}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            <button
                              onClick={() => setPreviewClipUrl(api.getClipUrl(clip.filename))}
                              style={{
                                background: 'rgba(56, 189, 248, 0.15)',
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                color: 'var(--accent-cyan)',
                                padding: '4px 8px',
                                borderRadius: 4,
                                fontSize: 11,
                                cursor: 'pointer'
                              }}
                            >
                              Play
                            </button>
                            <a
                              href={api.getClipUrl(clip.filename)}
                              download={clip.filename}
                              style={{
                                background: 'var(--bg-muted)',
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--text-main)',
                                padding: '4px 8px',
                                borderRadius: 4,
                                fontSize: 11,
                                textDecoration: 'none'
                              }}
                            >
                              Save
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
