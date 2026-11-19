import React, { useState } from 'react';
import { getApiBaseUrl, setApiBaseUrl, api } from '../services/api';
import StatusBadge from '../components/common/StatusBadge';
import { useTheme } from '../context/ThemeContext';

export default function Settings() {
  const { theme, setTheme, isDark } = useTheme();
  const [apiUrl, setApiUrl] = useState(getApiBaseUrl());
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  // User preferences stored in localStorage
  const [historyLength, setHistoryLength] = useState(() => {
    return localStorage.getItem('sentinel_history_len') || '30';
  });
  const [coordMode, setCoordMode] = useState(() => {
    return localStorage.getItem('sentinel_coord_mode') || 'auto';
  });

  const handleSaveApi = () => {
    setApiBaseUrl(apiUrl);
    alert('API Base URL saved.');
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await api.getHealth();
      const elapsed = Math.round(performance.now() - start);
      setTestResult({
        status: 'SUCCESS',
        latency: elapsed,
        device: res.device,
        system: res.system,
        database: res.database
      });
    } catch (err) {
      setTestResult({
        status: 'FAILED',
        error: err.message
      });
    } finally {
      setTesting(false);
    }
  };

  const handleHistoryChange = (val) => {
    setHistoryLength(val);
    localStorage.setItem('sentinel_history_len', val);
  };

  const handleCoordModeChange = (val) => {
    setCoordMode(val);
    localStorage.setItem('sentinel_coord_mode', val);
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
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
            <span style={{ fontSize: 20 }}>⚙️</span>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-main)' }}>
              System Settings & Diagnostic Workspace
            </h1>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#94a3b8' }}>
            Configure network endpoints, view connection diagnostics, and customize 3D trajectory rendering preferences.
          </p>
        </div>
      </div>

      {/* Network Configuration & Diagnostics */}
      <div className="glass-card" style={{ padding: 24, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🌐</span> Backend Network Connection
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6, fontWeight: 600 }}>
              FASTAPI REST BASE URL
            </label>
            <div style={{ display: 'flex', gap: 10, maxWidth: 600 }}>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                style={{
                  flex: 1,
                  background: 'var(--input-bg)',
                  color: 'var(--input-text)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  padding: '8px 14px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono, monospace',
                  outline: 'none'
                }}
              />
              <button
                onClick={handleSaveApi}
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  color: '#38bdf8',
                  padding: '8px 16px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Save URL
              </button>
              <button
                onClick={handleTestConnection}
                disabled={testing}
                style={{
                  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {testing ? 'Testing...' : 'Test Diagnostics'}
              </button>
            </div>
          </div>

          {/* Test Diagnostic Output */}
          {testResult && (
            <div
              style={{
                marginTop: 8,
                padding: 14,
                borderRadius: 8,
                background: testResult.status === 'SUCCESS' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${testResult.status === 'SUCCESS' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                fontSize: 13
              }}
            >
              {testResult.status === 'SUCCESS' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#34d399' }}>
                    <span>✓ Backend Active & Healthy</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>({testResult.latency} ms round-trip)</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    System: <b>{testResult.system}</b> | Hardware Device: <b>{testResult.device?.toUpperCase()}</b> | Database: <b>{testResult.database}</b>
                  </div>
                </div>
              ) : (
                <div style={{ color: '#f87171', fontWeight: 600 }}>
                  ✕ Connection Failed: {testResult.error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3D Visualization Preferences */}
      <div className="glass-card" style={{ padding: 24, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🎨</span> 3D Visualization & Kinematics Preferences
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          <div>
            <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6, fontWeight: 600 }}>
              TRAJECTORY HISTORY WINDOW (FRAMES)
            </label>
            <select
              value={historyLength}
              onChange={(e) => handleHistoryChange(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--input-bg)',
                color: 'var(--input-text)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 13,
                outline: 'none'
              }}
            >
              <option value="15">15 frames (~0.5 seconds)</option>
              <option value="30">30 frames (~1.0 second, recommended)</option>
              <option value="60">60 frames (~2.0 seconds)</option>
              <option value="90">90 frames (~3.0 seconds)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6, fontWeight: 600 }}>
              COORDINATE MAPPING CONVENTION
            </label>
            <select
              value={coordMode}
              onChange={(e) => handleCoordModeChange(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--input-bg)',
                color: 'var(--input-text)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 13,
                outline: 'none'
              }}
            >
              <option value="auto">Auto-Detect from Backend Calibration</option>
              <option value="image_space">Enforce Image-Space Only</option>
              <option value="ground_plane">Ground-Plane Metric If Valid</option>
            </select>
          </div>
        </div>
      </div>

      {/* Appearance & Color Theme Section */}
      <div className="glass-card" style={{ padding: 24, borderRadius: 12 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 14px 0', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🎨</span> UI Appearance & Visual Theme
        </h2>
        <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Configure the visual display theme for optimal visibility and contrast across monitoring workstations.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <div
            onClick={() => setTheme('light')}
            style={{
              padding: '16px 18px',
              borderRadius: 10,
              cursor: 'pointer',
              border: !isDark ? '2px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
              background: !isDark ? 'var(--bg-accent-soft)' : 'var(--bg-muted)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>☀️</span> Professional Light Theme
              </span>
              {!isDark && (
                <span style={{ background: 'var(--accent-cyan)', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999 }}>
                  ACTIVE (DEFAULT)
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Crisp slate-50 canvas, elevated white cards, WCAG AAA deep slate typography, and executive azure accents.
            </p>
          </div>

          <div
            onClick={() => setTheme('dark')}
            style={{
              padding: '16px 18px',
              borderRadius: 10,
              cursor: 'pointer',
              border: isDark ? '2px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
              background: isDark ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-muted)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🌙</span> Cyberpunk Dark Theme
              </span>
              {isDark && (
                <span style={{ background: 'var(--accent-cyan)', color: '#090e1a', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999 }}>
                  ACTIVE
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Command center dark surfaces with luminous cyan and emerald telemetry glow.
            </p>
          </div>
        </div>
      </div>

      {/* System & Build Environment Info */}
      <div className="glass-card" style={{ padding: 24, borderRadius: 12 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 14px 0', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>💻</span> System Environment & Frontend Stack
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, fontSize: 13 }}>
          <div style={{ background: 'var(--bg-muted)', padding: 12, borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
            <span style={{ color: '#94a3b8', fontSize: 11, display: 'block' }}>FRAMEWORK</span>
            <span style={{ fontWeight: 700, color: '#38bdf8' }}>React 18.2.0 + Vite 5.4</span>
          </div>

          <div style={{ background: 'var(--bg-muted)', padding: 12, borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
            <span style={{ color: '#94a3b8', fontSize: 11, display: 'block' }}>3D VISUALIZATION</span>
            <span style={{ fontWeight: 700, color: '#c084fc' }}>Three.js 0.158.0</span>
          </div>

          <div style={{ background: 'var(--bg-muted)', padding: 12, borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
            <span style={{ color: '#94a3b8', fontSize: 11, display: 'block' }}>ROUTER</span>
            <span style={{ fontWeight: 700, color: '#34d399' }}>React Router DOM v6.20</span>
          </div>

          <div style={{ background: 'var(--bg-muted)', padding: 12, borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
            <span style={{ color: '#94a3b8', fontSize: 11, display: 'block' }}>REAL-TIME ENGINE</span>
            <span style={{ fontWeight: 700, color: '#fbbf24' }}>Native WebSocket API</span>
          </div>
        </div>
      </div>
    </div>
  );
}
