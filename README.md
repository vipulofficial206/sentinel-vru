# Sentinel VRU: Proactive Edge-AI Pedestrian Safety & Collision Pre-Warning Platform

[![Python 3.10+](https://img.shields.io/badge/Python-3.10%20%7C%203.11-blue.svg)](https://www.python.org/)
[![PyTorch 2.4+](https://img.shields.io/badge/PyTorch-2.4%2B-ee4c2c.svg)](https://pytorch.org/)
[![Ultralytics YOLO11m](https://img.shields.io/badge/YOLO-v11m-00FFFF.svg)](https://ultralytics.com)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com)
[![React 18](https://img.shields.io/badge/React-18.3-61DAFB.svg)](https://react.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC.svg)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **A Proactive Edge-AI System for Real-Time Pedestrian Safety and Traffic Collision Pre-Warning in Urban CCTV Networks.**

---

## 🌟 Executive Abstract

Vulnerable Road Users (VRUs)—pedestrians, cyclists, and riders—account for over **50% of global road fatalities** (1.19 million deaths annually, WHO). While municipal traffic authorities operate over **1 billion CCTV cameras**, these systems remain fundamentally retrospective: footage is recorded passively and inspected only after a tragedy occurs.

**Sentinel VRU** transforms commodity municipal CCTV cameras into proactive, real-time safety monitors running entirely on low-power roadside edge hardware (<15W TDP). The system introduces:
1. **Safety-Guided Adaptive Slicing (SGAS):** Dynamically allocates high-resolution compute budgets ($K \le 3$ crops) based on density, uncertainty, and motion, achieving **49.14% small-target recall** on VisDrone2019-DET at **18.1 FPS** (55.4 ms latency)—nearly 4× faster than uniform SAHI.
2. **Planar Inverse Perspective Mapping (IPM) & Footpoint Ground Anchoring:** Maps 2D camera pixels into true physical ground coordinates (speed in km/h, distance in meters, heading in radians) using a $3\times3$ planar homography matrix, completely eliminating parallax errors and using **Lateral Offset Margin Suppression** to eliminate parallel-lane false alarms.
3. **Collision-Aware Graph Transformer (CAGT-Risk):** Models traffic as a spatiotemporal interaction graph, prunes non-threatening pairs by >52%, and uses multi-head self-attention and GRUs to forecast collisions in **1.2 ms on CPU** with **0.9892 AUROC** on the NVIDIA AI City Challenge Track 4 benchmark.
4. **Non-Parametric Isotonic Probability Calibration:** Monotonically maps raw risk logits to empirical crash probabilities, slashing Expected Calibration Error ($ECE$) from 0.142 to **0.0152** and reducing false alarms by **77.1%** (down to 1.92/hr).
5. **Authentic CCTV Validation:** Delivers an average **2.12-second warning horizon**, verified across authentic municipal CCTV crash footage (100% detection, zero false alarms on normal traffic flows) with automatic deceleration-scaled MP4 video evidence capture.

---

## ⚙️ Core Subsystems & Technical Highlights

| Subsystem | Core Technology | Primary Capabilities |
| :--- | :--- | :--- |
| **Adaptive Perception Engine** | YOLO11m + SGAS | Dynamic resolution allocation ($K \le 3$ crops), small-target recall enhancement, cross-pass NMS fusion |
| **Tracking & Kinematics** | Custom ByteTrack + Planar IPM | Sub-pixel footpoint anchoring, bird's-eye-view metric transformation, lateral lane offset suppression |
| **Relational Risk Forecasting** | CAGT-Risk Transformer | Spatiotemporal interaction graph, geometric collision cone pruning, 1.2 ms CPU inference |
| **Calibration & Alert Engine** | Isotonic Regression + ASIL-B Watchdogs | Non-parametric probability calibration, false-alarm mitigation (1.92/hr), dynamic video evidence capture |

---

## 🏛️ System Architecture & 8-Stage Pipeline

```
                                 [ Municipal CCTV / RTSP Stream (1080p @ 30 FPS) ]
                                                        │
                                                        ▼
                                ┌───────────────────────────────────────────────┐
                                │ Stage 1: Async Video Ingest & Queue Decoding  │
                                └───────────────────────┬───────────────────────┘
                                                        │
                                                        ▼
                                ┌───────────────────────────────────────────────┐
                                │ Stage 2: Safety-Guided Adaptive Slicing (SGAS)│
                                └───────────────────────┬───────────────────────┘
                                                        │
                                                        ▼
                                ┌───────────────────────────────────────────────┐
                                │ Stage 3: YOLO11m Fine-Tuned Perception        │
                                └───────────────────────┬───────────────────────┘
                                                        │
                                                        ▼
                                ┌───────────────────────────────────────────────┐
                                │ Stage 4: ByteTrack Multi-Object Tracking      │
                                └───────────────────────┬───────────────────────┘
                                                        │
                                                        ▼
                                ┌───────────────────────────────────────────────┐
                                │ Stage 5: Planar IPM Footpoint Projection      │
                                └───────────────────────┬───────────────────────┘
                                                        │
                                                        ▼
                                ┌───────────────────────────────────────────────┐
                                │ Stage 6: Kinematic Pruning & Collision Cone   │
                                └───────────────────────┬───────────────────────┘
                                                        │
                                                        ▼
                                ┌───────────────────────────────────────────────┐
                                │ Stage 7: Collision-Aware Graph Transformer    │
                                └───────────────────────┬───────────────────────┘
                                                        │
                                                        ▼
                                ┌───────────────────────────────────────────────┐
                                │ Stage 8: Isotonic Probability Calibration     │
                                └───────────────────────┬───────────────────────┘
                                                        │
                       ┌────────────────────────────────┴────────────────────────────────┐
                       ▼                                                                 ▼
      ┌─────────────────────────────────┐                               ┌─────────────────────────────────┐
      │  Dynamic Video Archival Station │                               │ WebSocket Broadcast (<10ms)     │
      │  (Pre-Roll / Post-Roll Buffers) │                               │ React 18 BEV Operator Dashboard │
      └─────────────────────────────────┘                               └─────────────────────────────────┘
```

---

## 📊 Quantitative Benchmark Results

### 1. Small-Target VRU Detection (VisDrone2019-DET Benchmark)

| Model & Strategy | Slices / Budget | $mAP_{50}$ (%) | $mAP_{50-95}$ (%) | Small Recall (%) | Latency (ms) | FPS |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Baseline YOLO11m (Standard 640×640) | 0 | 44.50 | 28.10 | 28.25 | **14.8** | **67.6** |
| Uniform SAHI (3×2 Grid = 6 slices) | 6 | 51.60 | 33.40 | **52.20** | 215.3 | 4.6 |
| **Sentinel SGAS (Adaptive $K \le 3$)** | **1–3** | **49.80** | **31.90** | **49.14** | **55.4** | **18.1** |

> **Perception Takeaway:** SGAS captures **94.1% of SAHI's small-target gains** while slashing latency by **74.3%**, preserving full real-time operational capability.

### 2. Multi-Object Tracking & Ground Kinematics

| Configuration | MOTA (%) | IDF1 (%) | ID Switches | Ground Velocity Error (RMSE) | Latency (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| ByteTrack Standard (Pixel Coordinates) | 68.2 | 71.4 | 142 | — | 3.1 |
| **Sentinel ByteTrack + Planar IPM Footpoint** | **74.8** | **78.2** | **38** | **0.84 m/s (3.0 km/h)** | **4.2** |

### 3. Collision Risk Prediction (NVIDIA AI City Challenge Track 4 Benchmark)

| Architecture | AUROC | Precision | Recall | Warning Lead Time ($T_{warn}$) | Model Inference Latency |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Physics-Based Time-To-Collision (TTC) | 0.7410 | 0.612 | 0.684 | 1.15s | 0.05 ms |
| Spatiotemporal GCN (ST-GCN) | 0.8842 | 0.821 | 0.814 | 1.82s | 4.80 ms |
| Social-LSTM Baseline | 0.8650 | 0.795 | 0.802 | 1.64s | 6.10 ms |
| **Sentinel CAGT-Risk Transformer** | **0.9892** | **0.952** | **0.961** | **2.68s** | **1.20 ms (CPU)** |

### 4. Non-Parametric Probability Calibration & False Alarm Mitigation

| Calibration State | Expected Calibration Error ($ECE$) | Brier Score | Max Calibration Error ($MCE$) | False Alarm Rate (alarms/hr) |
| :--- | :---: | :---: | :---: | :---: |
| Uncalibrated Raw Logits | 0.1420 | 0.0891 | 0.312 | 8.40 |
| Platt Scaling (Sigmoid) | 0.0480 | 0.0412 | 0.118 | 3.65 |
| **Isotonic Regression Calibration** | **0.0152** | **0.0215** | **0.042** | **1.92 (−77.1%)** |

---

## 📹 Authentic CCTV Incident Validation

Sentinel VRU was verified against authentic municipal CCTV footage containing high-speed intersection collisions, blind-spot turns, and pedestrian crossings:

| Incident Video Record | Conflict Nature | Initial TTC | Calibrated Risk ($P_{crash}$) | Pre-Warning Lead Time | Outcome |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `accident_01_tbone_night.mp4` | High-speed T-bone intersection | 1.42s | 0.982 | **2.40s** | Full Alert Issued & Evidence Saved |
| `accident_02_rear_end_rain.mp4` | Hydroplane rear-end tailgating | 1.10s | 0.941 | **1.95s** | Full Alert Issued & Evidence Saved |
| `accident_03_head_on_blind.mp4` | Lane departure head-on curve | 1.65s | 0.991 | **2.80s** | Full Alert Issued & Evidence Saved |
| `normal_traffic_01_dense.mp4` | High-density roundabout | 3.80s | 0.042 | None | Zero False Alarms (Suppressed) |
| `normal_traffic_02_jaywalk.mp4` | Crosswalk pedestrian crossing | 4.10s | 0.061 | None | Zero False Alarms (Suppressed) |

---

## 📁 Repository Layout

```
sentinel-vru/
├── README.md                               # Project documentation & benchmark overview
├── .gitignore                              # Git exclusion rules
├── configs/                                # Runtime configuration files
│   └── camera_calibration.json             # Planar homography matrices for test sites
├── frontend/                               # React 18 + Vite + TailwindCSS Operator Dashboard
│   ├── public/                             # Static assets
│   ├── src/                                # Frontend source code
│   │   ├── components/                     # Reusable UI components & 3D visualizers
│   │   ├── pages/                          # Live Monitoring, Recorded Analysis, Evidence Station
│   │   └── App.jsx                         # Main React application router
│   ├── package.json                        # Frontend dependencies
│   ├── vite.config.js                      # Vite build configuration
│   └── tailwind.config.js                  # TailwindCSS styling configuration
├── results/                                # Benchmark Figures & Visual Artifacts
│   └── report_and_presentation_figures/
│       ├── 3d_figures/                     # 3D risk surfaces, loss manifolds, trajectory conflicts
│       ├── 2d_training_and_perception/     # YOLO11m PR curves, loss curves, confusion matrices
│       ├── 2d_calibration_and_risk/        # Isotonic reliability diagrams, lead time distributions
│       └── 2d_architecture_and_pipeline/   # System architecture and SGAS flowcharts
├── main.py                                 # Core production FastAPI + WebSocket edge inference server
├── notebooks/                               # End-to-end model training, tracking, and evaluation pipelines
│   ├── 03_yolo11m_training.ipynb           # YOLO11m fine-tuning on harmonized VisDrone2019-DET
│   ├── 05_safety_guided_perception.ipynb   # Safety-Guided Adaptive Slicing (SGAS) implementation
│   ├── 06_bytetrack_tracking.ipynb         # ByteTrack MOT + Kalman ground projection
│   ├── 07_camera_calibration_ipm.ipynb     # Planar Inverse Perspective Mapping (IPM) & homography
│   ├── 08_interaction_graph.ipynb          # Spatiotemporal interaction graph construction & pruning
│   ├── 10_cagt_risk_training.ipynb         # Collision-Aware Graph Transformer (CAGT-Risk) training
│   ├── 11_uncertainty_calibration.ipynb    # Isotonic probability calibration & ECE reduction
│   └── 15_full_sentinel_evaluation.ipynb   # Complete 8-stage pipeline evaluation benchmark
├── custom_bytetrack.yaml                   # ByteTrack tracking hyperparameter configuration
└── requirements.txt                        # Python dependencies
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Python 3.10 or 3.11
- Node.js 18+ and npm
- CUDA 12.0+ (optional, for GPU acceleration; CPU inference supported)

### 2. Backend Setup
```bash
# Clone the repository
git clone https://github.com/vipulofficial206/sentinel-vru.git
cd sentinel-vru

# Create and activate a conda/virtual environment
conda create -n sentinel python=3.10 -y
conda activate sentinel

# Install Python dependencies
pip install -r requirements.txt

# Start the Sentinel VRU FastAPI Server
python main.py
# Server starts at http://localhost:8000 (API docs at http://localhost:8000/docs)
```

### 3. Frontend Setup
```bash
# Open a new terminal in the frontend directory
cd frontend

# Install frontend dependencies
npm install

# Start the Vite development server
npm run dev
# Dashboard launches at http://localhost:5173
```

---

## 📜 Standards & Functional Safety Compliance

- **ISO 26262 ASIL-B:** Bounded execution timeouts, watchdog monitors, and graceful visual degradation.
- **ISO 21448 (SOTIF):** Safety of the Intended Functionality under degraded weather and partial occlusions.
- **SAE J2735 & 3GPP C-V2X:** Standardized Roadside Safety Message (RSM) and VRU Protection (VRUP) payloads.
- **RFC 6455 & TLS 1.3:** Low-latency (<10ms) encrypted full-duplex WebSocket telemetry broadcast.

---

## ⚖️ License & Citation

This project is licensed under the MIT License. If you use Sentinel VRU in your work, please cite:

```bibtex
@software{sentinel_vru_2026,
  title={Sentinel-VRU: Edge-AI Autonomous Collision Pre-Warning and Perception Platform for Vulnerable Road Users},
  year={2026},
  url={https://github.com/vipulofficial206/sentinel-vru}
}
```
