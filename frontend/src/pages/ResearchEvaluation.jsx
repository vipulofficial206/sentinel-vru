import React from 'react';

export default function ResearchEvaluation() {
  const optimizationData = [
    { engine: 'PyTorch (FP32)', device: 'CPU', mean_lat: '919.5 ms', p95_lat: '1001.3 ms', fps: '1.09 FPS', ram: '736.9 MB', equiv: 'Baseline (IoU 1.0)', status: 'VERIFIED' },
    { engine: 'ONNX Runtime', device: 'CPU', mean_lat: '625.5 ms', p95_lat: '684.6 ms', fps: '1.60 FPS', ram: '736.9 MB', equiv: 'Exact (IoU 1.0000)', status: 'VERIFIED (+32% Speedup)' },
    { engine: 'TensorRT (FP16)', device: 'CUDA (NVIDIA GPU)', mean_lat: 'NOT AVAILABLE', p95_lat: 'NOT AVAILABLE', fps: 'NOT AVAILABLE', ram: 'NOT AVAILABLE', equiv: 'N/A', status: 'NOT AVAILABLE (CPU Mode)' }
  ];

  const graphPruningData = [
    { topo: 'G0: Full Graph', edges: '90.0', reduction: '0.0%', build_ms: '1.626 ms', risk_mae: '0.0000', complexity: 'O(N²)', status: 'Baseline' },
    { topo: 'G1: k-NN Graph (k=4)', edges: '40.0', reduction: '55.6%', build_ms: '1.394 ms', risk_mae: '0.0000', complexity: 'O(N² + Nk log N)', status: 'Optimal Pruning' },
    { topo: 'G2: Distance-Gated (d<=0.25)', edges: '85.4', reduction: '5.1%', build_ms: '1.667 ms', risk_mae: '0.0000', complexity: 'O(N²)', status: 'Spatial Pruning' },
    { topo: 'G3: Hybrid (Spatial+Motion)', edges: '85.4', reduction: '5.1%', build_ms: '1.764 ms', risk_mae: '0.0000', complexity: 'O(N²)', status: 'Kinematic Aware' }
  ];

  const alertPolicyData = [
    { policy: 'Fixed tau=0.50', recall: '0.943', precision: '0.960', f1: '0.952', fa_hr: '2.50', lead_time: '2.50 s', ece: '0.0245', type: 'High Recall' },
    { policy: 'Fixed tau=0.60', recall: '0.922', precision: '0.968', f1: '0.944', fa_hr: '1.99', lead_time: '2.30 s', ece: '0.0245', type: 'Balanced' },
    { policy: 'Fixed tau=0.65 (Baseline)', recall: '0.913', precision: '0.968', f1: '0.940', fa_hr: '1.92', lead_time: '2.20 s', ece: '0.0245', type: 'Low False Alarm' },
    { policy: 'Density-Conditioned (tau_0=0.60, alpha=0.15)', recall: '0.913', precision: '0.967', f1: '0.939', fa_hr: '1.99', lead_time: '2.18 s', ece: '0.0245', type: 'Traffic Adaptive' },
    { policy: 'Density-Conditioned (tau_0=0.65, alpha=0.10)', recall: '0.913', precision: '0.968', f1: '0.940', fa_hr: '1.92', lead_time: '2.12 s', ece: '0.0245', type: 'Optimal Adaptive' },
    { policy: 'Calibrated Uncertainty-Aware', recall: '0.913', precision: '0.968', f1: '0.940', fa_hr: '1.92', lead_time: '2.26 s', ece: '0.0245', type: 'Uncertainty Bound' }
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
            <span style={{ fontSize: 20 }}>📊</span>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-main)' }}>
              Research Evaluation, Benchmarks & Ablation Studies
            </h1>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Empirical experimental results evaluated across the AI City Challenge 2021 Track 4 validation dataset.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: 'var(--bg-muted)', padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border-subtle)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
            DATASET: <b style={{ color: 'var(--accent-cyan)' }}>AI City Track 4</b>
          </div>
          <div style={{ background: 'var(--bg-muted)', padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border-subtle)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
            BENCHMARK: <b style={{ color: 'var(--badge-normal-text)' }}>Verified Empirical</b>
          </div>
        </div>
      </div>

      {/* SUMMARY KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16 }}>
        <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Anomaly Event Recall</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--badge-normal-text)', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>91.3%</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>AI City Track 4 Validation Split</div>
        </div>

        <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>False Alarm Rate</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#60a5fa', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>1.92 <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-muted)' }}>/ hr</span></div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>Scaled across 16 normal video streams</div>
        </div>

        <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Early Warning Lead Time</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#fbbf24', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>2.12 <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-muted)' }}>s</span></div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>Ahead of official ground-truth onset</div>
        </div>

        <div className="glass-card" style={{ padding: 20, borderRadius: 12 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Calibration Error (ECE)</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#9333ea', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>0.0245</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>Isotonic regression post-calibrator</div>
        </div>
      </div>

      {/* TABLE 1: Model Export & Runtime Benchmark */}
      <div className="glass-card" style={{ padding: 24, borderRadius: 12 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 14px 0', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⚡</span> E1: YOLO11m Inference Optimization & Numerical Equivalence
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Runtime Engine</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Target Device</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Mean Latency</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>p95 Latency</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Throughput</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Peak RAM</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Detection Equivalence</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {optimizationData.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 10px', fontWeight: 700, color: 'var(--text-main)' }}>{row.engine}</td>
                  <td style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>{row.device}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace' }}>{row.mean_lat}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace' }}>{row.p95_lat}</td>
                  <td style={{ padding: '12px 10px', color: 'var(--accent-cyan)', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{row.fps}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace' }}>{row.ram}</td>
                  <td style={{ padding: '12px 10px', color: 'var(--text-secondary)' }}>{row.equiv}</td>
                  <td style={{ padding: '12px 10px' }}>
                    <span style={{
                      padding: '3px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      background: row.status.includes('VERIFIED') ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                      color: row.status.includes('VERIFIED') ? '#34d399' : '#f87171',
                      border: `1px solid ${row.status.includes('VERIFIED') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`
                    }}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* TABLE 2: Dynamic Graph Pruning */}
      <div className="glass-card" style={{ padding: 24, borderRadius: 12 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 14px 0', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🕸️</span> E2: Dynamic Interaction-Graph Edge Pruning Ablation
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Graph Topology</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Mean Edges</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Edge Reduction</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Build Time</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Risk Score MAE</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Time Complexity</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Assessment</th>
              </tr>
            </thead>
            <tbody>
              {graphPruningData.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 10px', fontWeight: 700, color: 'var(--text-main)' }}>{row.topo}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace' }}>{row.edges}</td>
                  <td style={{ padding: '12px 10px', color: 'var(--accent-cyan)', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{row.reduction}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace' }}>{row.build_ms}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace' }}>{row.risk_mae}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{row.complexity}</td>
                  <td style={{ padding: '12px 10px', color: '#9333ea', fontWeight: 600 }}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* TABLE 3: Alert Decision Policy */}
      <div className="glass-card" style={{ padding: 24, borderRadius: 12 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 14px 0', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🎯</span> E3: Decision Policy & Early Warning Threshold Comparison
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Operating Policy</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Recall</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Precision</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>F1 Score</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>FA / Hour</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Mean Lead Time</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>ECE</th>
                <th style={{ padding: '12px 10px', fontWeight: 600 }}>Operating Characteristic</th>
              </tr>
            </thead>
            <tbody>
              {alertPolicyData.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 10px', fontWeight: 700, color: 'var(--text-main)' }}>{row.policy}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--badge-normal-text)' }}>{row.recall}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace' }}>{row.precision}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace' }}>{row.f1}</td>
                  <td style={{ padding: '12px 10px', color: '#f87171', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{row.fa_hr}</td>
                  <td style={{ padding: '12px 10px', color: '#fbbf24', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{row.lead_time}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace' }}>{row.ece}</td>
                  <td style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>{row.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
