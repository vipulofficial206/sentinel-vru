import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function CameraCalibrationModal({ isOpen, onClose }) {
  const [points, setPoints] = useState([
    { image_x: 450, image_y: 580, ground_x: 0, ground_y: 0 },
    { image_x: 820, image_y: 580, ground_x: 12, ground_y: 0 },
    { image_x: 1100, image_y: 920, ground_x: 12, ground_y: 35 },
    { image_x: 220, image_y: 920, ground_x: 0, ground_y: 35 }
  ]);
  const [units, setUnits] = useState('meters');
  const [calibStatus, setCalibStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchCalibrationStatus();
    }
  }, [isOpen]);

  const fetchCalibrationStatus = async () => {
    try {
      const data = await api.getCalibrationStatus();
      setCalibStatus(data);
    } catch (e) {
      console.error('Failed to fetch calibration status', e);
    }
  };

  const handlePointChange = (index, field, value) => {
    const updated = [...points];
    updated[index][field] = parseFloat(value) || 0;
    setPoints(updated);
  };

  const submitCalibration = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.calibrateCamera({
        camera_id: 'AICITY_TRACK4',
        points: points,
        units: units
      });
      if (data.status === 'CALIBRATION INVALID') {
        setErrorMsg(data.error || 'Calibration rejected due to ill-conditioned geometry.');
      }
      setCalibStatus(data);
    } catch (e) {
      setErrorMsg('Failed to connect to backend calibration API.');
    } finally {
      setLoading(false);
    }
  };

  const resetCalibration = async () => {
    setLoading(true);
    try {
      const data = await api.resetCalibration();
      setCalibStatus(data);
      setErrorMsg(null);
    } catch (e) {
      setErrorMsg('Failed to reset calibration.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20
    }}>
      <div style={{
        background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 800, width: '100%',
        maxHeight: '90vh', overflowY: 'auto', border: '1px solid #334155', color: '#f8fafc'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Interactive 4-Point Camera Calibration</h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 24, cursor: 'pointer'
          }}>&times;</button>
        </div>

        <p style={{ color: '#94a3b8', fontSize: 14 }}>
          Establish planar homography correspondences between 2D image coordinates \((u, v)\) and ground-plane coordinates \((X, Y)\).
          Uncalibrated cameras remain strictly in <b>IMAGE-SPACE ONLY</b> mode until validated.
        </p>

        {/* Status Badge */}
        <div style={{
          padding: 12, borderRadius: 8, marginBottom: 16,
          background: calibStatus?.status === 'CALIBRATED — METRIC' ? '#064e3b' :
                      calibStatus?.status === 'CALIBRATED — RELATIVE/ARBITRARY SCALE' ? '#1e3a8a' :
                      calibStatus?.status === 'CALIBRATION INVALID' ? '#7f1d1d' : '#334155',
          color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div>
            <b>Current Status:</b> {calibStatus?.status || 'IMAGE-SPACE ONLY'}
          </div>
          {calibStatus?.mean_reprojection_error && (
            <div style={{ fontSize: 13 }}>
              Reprojection Error: <b>{calibStatus.mean_reprojection_error} px</b>
            </div>
          )}
        </div>

        {errorMsg && (
          <div style={{ padding: 10, background: '#7f1d1d', color: '#fca5a5', borderRadius: 6, marginBottom: 16 }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {/* 4 Points Table */}
        <h3 style={{ fontSize: 16, marginBottom: 10 }}>Point Correspondences (Image Plane \(\to\) Ground Plane)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #475569', color: '#94a3b8', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>Point</th>
              <th style={{ padding: 8 }}>Image X (u)</th>
              <th style={{ padding: 8 }}>Image Y (v)</th>
              <th style={{ padding: 8 }}>Ground X ({units})</th>
              <th style={{ padding: 8 }}>Ground Y ({units})</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: 8, fontWeight: 'bold' }}>Point {idx + 1}</td>
                <td style={{ padding: 8 }}>
                  <input
                    type="number"
                    value={p.image_x}
                    onChange={(e) => handlePointChange(idx, 'image_x', e.target.value)}
                    style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: '4px 8px', borderRadius: 4, width: 90 }}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <input
                    type="number"
                    value={p.image_y}
                    onChange={(e) => handlePointChange(idx, 'image_y', e.target.value)}
                    style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: '4px 8px', borderRadius: 4, width: 90 }}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <input
                    type="number"
                    value={p.ground_x}
                    onChange={(e) => handlePointChange(idx, 'ground_x', e.target.value)}
                    style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: '4px 8px', borderRadius: 4, width: 90 }}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <input
                    type="number"
                    value={p.ground_y}
                    onChange={(e) => handlePointChange(idx, 'ground_y', e.target.value)}
                    style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: '4px 8px', borderRadius: 4, width: 90 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Units Selector */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
          <label style={{ fontSize: 14, color: '#94a3b8' }}>Measurement Units:</label>
          <select
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: '6px 12px', borderRadius: 6 }}
          >
            <option value="meters">Meters (Physical Metric Plane)</option>
            <option value="relative">Relative / Arbitrary Scale</option>
            <option value="pixels">Pixels (Image Coordinates)</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={resetCalibration}
            disabled={loading}
            style={{ background: '#475569', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer' }}
          >
            Reset to Image-Space
          </button>
          <button
            onClick={submitCalibration}
            disabled={loading}
            style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }}
          >
            {loading ? 'Validating...' : 'Validate & Save Calibration'}
          </button>
        </div>
      </div>
    </div>
  );
}
