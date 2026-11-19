import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import StatusBadge from '../common/StatusBadge';
import { api } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';

const ROUTE_TITLES = {
  '/': 'Main Command Dashboard',
  '/live': 'Live CCTV Monitoring & Stream',
  '/trajectories': '3D Trajectory Analysis & Bird\'s-Eye View',
  '/calibration': 'Operator 4-Point Camera Calibration',
  '/events': 'Alerts, Events & Evidence Review',
  '/models': 'Model Architecture & Service Readiness',
  '/evaluation': 'Research Evaluation & Benchmark Ablations',
  '/settings': 'System Settings & API Diagnostics',
  '/review': 'Alerts, Events & Evidence Review',
  '/metrics': 'Research Evaluation & Benchmark Ablations'
};

export default function Header({ wsStatus, telemetry, isStale }) {
  const location = useLocation();
  const currentTitle = ROUTE_TITLES[location.pathname] || 'Sentinel Traffic Safety';
  const { theme, toggleTheme, isDark } = useTheme();

  const [healthStatus, setHealthStatus] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [lastCheckTime, setLastCheckTime] = useState(null);

  // Poll backend health periodically
  useEffect(() => {
    let isMounted = true;
    const checkHealth = async () => {
      try {
        const [health, models] = await Promise.all([
          api.getHealth(),
          api.getModelStatus()
        ]);
        if (isMounted) {
          setHealthStatus(health);
          setModelStatus(models);
          setLastCheckTime(new Date());
        }
      } catch (err) {
        if (isMounted) {
          setHealthStatus(null);
        }
      }
    };

    checkHealth();
    const timer = setInterval(checkHealth, 10000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  // Determine actual connection state
  let connectionState = 'UNKNOWN';
  if (wsStatus === 'CONNECTED') {
    connectionState = isStale ? 'DEGRADED' : 'CONNECTED';
  } else if (wsStatus === 'CONNECTING') {
    connectionState = 'CONNECTING';
  } else {
    connectionState = healthStatus ? 'DEGRADED' : 'DISCONNECTED';
  }

  // Model readiness summary
  const isYoloReady = modelStatus?.yolo11m === 'LOADED';
  const isCagtReady = modelStatus?.cagt_risk === 'LOADED';
  const modelsOverall = (isYoloReady && isCagtReady) ? 'READY' : (modelStatus ? 'DEGRADED' : 'NOT LOADED');

  const cameraId = telemetry?.camera_id || 'AICITY_TRACK4';
  const fps = telemetry?.system_metrics?.inference_fps ?? null;
  const latency = telemetry?.system_metrics?.latency_ms ?? null;

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        background: 'var(--bg-secondary)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-header)',
        position: 'sticky',
        top: 0,
        zIndex: 40,
        gap: 16,
        flexWrap: 'wrap',
        transition: 'background-color 0.2s ease, border-color 0.2s ease'
      }}
    >
      {/* Title & Path */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.01em' }}>
          {currentTitle}
        </h1>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            background: 'var(--bg-muted)',
            border: '1px solid var(--border-subtle)',
            padding: '3px 8px',
            borderRadius: 6,
            fontFamily: 'JetBrains Mono, monospace'
          }}
        >
          CAM: {cameraId}
        </span>
      </div>

      {/* Right System Telemetry Indicators */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {/* Inference Latency & FPS */}
        {fps !== null && latency !== null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
              borderRadius: 6,
              background: 'var(--bg-muted)',
              border: '1px solid var(--border-subtle)',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 12
            }}
          >
            <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{fps} FPS</span>
            <span style={{ color: 'var(--text-dim)' }}>|</span>
            <span style={{ color: 'var(--text-main)' }}>{latency} ms</span>
          </div>
        )}

        {/* Backend Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>API/WS:</span>
          <StatusBadge status={connectionState} size="sm" />
        </div>

        {/* AI Models Readiness */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>MODELS:</span>
          <StatusBadge status={modelsOverall} size="sm" />
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 12px',
            borderRadius: 6,
            background: 'var(--bg-muted)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-main)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <span>{isDark ? '🌙' : '☀️'}</span>
          <span>{isDark ? 'Dark' : 'Light'}</span>
        </button>

        {/* Quick Settings Link */}
        <Link
          to="/settings"
          title="System Settings & Diagnostics"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 6,
            background: 'var(--bg-muted)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-muted)',
            textDecoration: 'none',
            fontSize: 14,
            transition: 'all 0.2s'
          }}
        >
          ⚙️
        </Link>
      </div>
    </header>
  );
}
