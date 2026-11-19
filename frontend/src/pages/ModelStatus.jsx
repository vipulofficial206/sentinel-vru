import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import StatusBadge from '../components/common/StatusBadge';
import LoadingSpinner from '../components/common/LoadingSpinner';

export default function ModelStatus() {
  const [health, setHealth] = useState(null);
  const [models, setModels] = useState(null);
  const [sysStatus, setSysStatus] = useState(null);
  const [calib, setCalib] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSystemInfo();
    const interval = setInterval(fetchSystemInfo, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchSystemInfo = async () => {
    try {
      const [h, m, s, c] = await Promise.all([
        api.getHealth(),
        api.getModelStatus(),
        api.getSystemStatus(),
        api.getCalibrationStatus()
      ]);
      setHealth(h);
      setModels(m);
      setSysStatus(s);
      setCalib(c);
    } catch (e) {
      console.error('Failed to fetch system info', e);
    } finally {
      setLoading(false);
    }
  };

  const MODEL_INVENTORY = [
    {
      name: 'YOLO11m Object Detector',
      type: '2D Object Detection Backbone',
      path: 'models/yolo/yolo11m_best.pt',
      status: models?.yolo11m || 'UNAVAILABLE',
      target: 'Pedestrians, Vehicles, Cyclists (mAP@50 0.771)',
      format: 'PyTorch .pt Checkpoint'
    },
    {
      name: 'YOLO11m ONNX Optimized Engine',
      type: 'Graph Optimized Runtime',
      path: 'models/yolo/yolo11m_best.onnx',
      status: models?.onnx_detector || 'UNAVAILABLE',
      target: '32% CPU Speedup (625ms vs 919ms)',
      format: 'ONNX Runtime CPU'
    },
    {
      name: 'CAGT-Risk Interaction Model',
      type: 'Context-Aware Graph Transformer',
      path: 'models/cagt/cagt_risk_best.pth',
      status: models?.cagt_risk || 'UNAVAILABLE',
      target: 'Spatial-Temporal Risk & Uncertainty (AUROC 0.860)',
      format: 'PyTorch Geometric GNN'
    },
    {
      name: 'Isotonic Probability Calibrator',
      type: 'Post-Hoc Monotonic Calibration',
      path: 'results/uncertainty_calibration/isotonic_calibrator.pkl',
      status: models?.calibration || 'UNAVAILABLE',
      target: 'Expected Calibration Error ECE = 0.0245',
      format: 'Scikit-learn IsotonicRegression Pickled'
    },
    {
      name: 'Adaptive SAHI Slicing',
      type: 'Small Road-User Slicing Inference',
      path: 'configs/sahi.yaml',
      status: models?.sahi || 'LOADED',
      target: 'Optical-flow triggered 4-slice inference',
      format: 'SAHI Sliced Prediction'
    },
    {
      name: 'ByteTrack Multi-Object Tracker',
      type: 'Temporal Association & Trajectory Linking',
      path: 'configs/tracking.yaml',
      status: models?.tracking_config || 'LOADED',
      target: 'Low-confidence detection association',
      format: 'Kalman Filter + Hungarian Algorithm'
    },
    {
      name: 'Planar Camera Homography',
      type: 'Image to Ground Plane Geometry',
      path: 'configs/camera_calibration.json',
      status: calib?.status || 'IMAGE-SPACE ONLY',
      target: '4-Point Planar Correspondence with Error Bound',
      format: 'Homography Matrix H (3x3)'
    }
  ];

  const SERVICE_INVENTORY = [
    {
      service: 'FastAPI Backend Core',
      endpoint: 'http://localhost:8000',
      status: health ? 'READY' : 'DISCONNECTED',
      details: health?.system || 'Sentinel Traffic Anomaly API'
    },
    {
      service: 'Real-Time Telemetry WebSocket',
      endpoint: 'ws://localhost:8000/ws/live',
      status: sysStatus ? 'READY' : 'DISCONNECTED',
      details: `${sysStatus?.active_websockets ?? 0} Active WebSocket Client(s)`
    },
    {
      service: 'Annotated MJPEG Video Stream',
      endpoint: 'http://localhost:8000/video/stream',
      status: sysStatus?.pipeline_active ? 'READY' : 'NOT LOADED',
      details: sysStatus?.pipeline_active ? 'Broadcasting live annotated frames' : 'Idle'
    },
    {
      service: 'MongoDB Event Ring Buffer',
      endpoint: 'mongodb://localhost:27017/',
      status: health?.database === 'CONNECTED' ? 'READY' : 'UNAVAILABLE',
      details: health?.database === 'CONNECTED' ? 'Live MongoDB persistence connected' : 'Fallback: disk JSON storage in results/event_evidence'
    }
  ];

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
            <span style={{ fontSize: 20 }}>🧩</span>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-main)' }}>
              Model Architecture, Checkpoints & Service Readiness
            </h1>
            <StatusBadge status={health ? 'READY' : 'DISCONNECTED'} size="sm" />
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#94a3b8' }}>
            Comprehensive verification of AI checkpoints, hardware execution devices, and persistence layers.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: 'var(--bg-muted)', padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border-subtle)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
            HARDWARE: <b style={{ color: '#38bdf8' }}>{health?.device?.toUpperCase() || 'CPU'}</b>
          </div>
          <button
            onClick={fetchSystemInfo}
            style={{
              background: 'var(--bg-accent-soft)',
              border: '1px solid rgba(2, 132, 199, 0.35)',
              color: 'var(--accent-cyan)',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ↻ Recheck Health
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner message="Querying model readiness and hardware status..." />
      ) : (
        <>
          {/* Section 1: AI Model & Artifact Inventory */}
          <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
            <h2 style={{ fontSize: 15, margin: '0 0 14px 0', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🧠</span> Trained AI Artifacts & Checkpoints
            </h2>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', textAlign: 'left' }}>
                    <th style={{ padding: '12px 10px', fontWeight: 600 }}>Model / Pipeline Stage</th>
                    <th style={{ padding: '12px 10px', fontWeight: 600 }}>Architecture</th>
                    <th style={{ padding: '12px 10px', fontWeight: 600 }}>Artifact Path</th>
                    <th style={{ padding: '12px 10px', fontWeight: 600 }}>Target Task / Performance</th>
                    <th style={{ padding: '12px 10px', fontWeight: 600 }}>Readiness</th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_INVENTORY.map((m, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 700, color: 'var(--text-main)' }}>{m.name}</td>
                      <td style={{ padding: '12px 10px', color: 'var(--text-secondary)' }}>{m.type}</td>
                      <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#93c5fd' }}>{m.path}</td>
                      <td style={{ padding: '12px 10px', color: '#94a3b8' }}>{m.target}</td>
                      <td style={{ padding: '12px 10px' }}>
                        <StatusBadge status={m.status} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Core Services & Communication Endpoints */}
          <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
            <h2 style={{ fontSize: 15, margin: '0 0 14px 0', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔌</span> Communication Endpoints & Persistence Services
            </h2>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', textAlign: 'left' }}>
                    <th style={{ padding: '12px 10px', fontWeight: 600 }}>Service Name</th>
                    <th style={{ padding: '12px 10px', fontWeight: 600 }}>Network Endpoint</th>
                    <th style={{ padding: '12px 10px', fontWeight: 600 }}>Operational Status</th>
                    <th style={{ padding: '12px 10px', fontWeight: 600 }}>Runtime Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {SERVICE_INVENTORY.map((s, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 700, color: 'var(--text-main)' }}>{s.service}</td>
                      <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#38bdf8' }}>{s.endpoint}</td>
                      <td style={{ padding: '12px 10px' }}>
                        <StatusBadge status={s.status} size="sm" />
                      </td>
                      <td style={{ padding: '12px 10px', color: 'var(--text-secondary)' }}>{s.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
