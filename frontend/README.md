# Sentinel Live Frontend — React, Three.js & WebSocket Dashboard

The Sentinel Frontend is an interactive, real-time web application built with **React 18**, **Vite 5**, and **Three.js (WebGL)**. It communicates with the Python FastAPI backend via resilient WebSockets (`/ws/live`) and renders live multipart MJPEG video streaming alongside dynamic 3D ground-plane agent representations.

---

## 1. Quick Start Guide

### Prerequisites
* **Node.js**: v18.0 or higher (Installed: `v24.19.0`)
* **npm**: v9.0 or higher (Installed: `11.11.0`)
* **Backend Running**: Ensure `python main.py` is running on `http://localhost:8000`.

### Launching the Frontend
Open PowerShell in the frontend directory:

```powershell
cd "d:\cap 1\frontend"

# 1. Install dependencies (First-time setup only)
npm.cmd install

# 2. Start the Vite development server
npm.cmd run dev
```

The application will start immediately at:
**`http://localhost:3000`**

---

## 2. Key Features & What You Can Do

### Feature 1: Real CCTV Optical Stream with Inference Overlays
* Located on the **Sentinel Live Dashboard** (`/`).
* Receives the live MJPEG stream from `http://localhost:8000/video/stream`.
* Draws real bounding boxes, track IDs (e.g. `ID: 4`), VisDrone class names (`car`, `pedestrian`, `truck`, `motor`), and live pixel speeds ($\text{px/s}$).
* Displays an alert banner at the top of the video feed that changes from green (`NORMAL`) to red (`PRE-EVENT WARNING` / `ANOMALY INTERVAL`) whenever the calibrated risk probability exceeds the threshold.

### Feature 2: Three.js 3D Ground-Plane Representation
* Directly below the video feed on the dashboard.
* Built using **Three.js WebGL rendering**:
  * Road agents are rendered as 3D bounding meshes placed on a 3D ground plane.
  * Historical trajectories are drawn as dynamic blue trajectory ribbons using real multi-frame history.
  * Coordinates map directly from live backend WebSocket telemetry.
  * When uncalibrated, the mode displays `IMAGE-SPACE ONLY`; when calibrated, agents render in true ground-plane metric coordinates.

### Feature 3: Interactive 4-Point Camera Calibration Tool
* Click the **"Camera Calibration"** button in the dashboard top navigation bar.
* What you can do:
  1. Inspect the 4 point correspondences between image plane $(u, v)$ and ground plane $(X, Y)$.
  2. Select measurement units: **Meters** (Physical Metric), **Relative Scale**, or **Pixels**.
  3. Click **"Validate & Save Calibration"**: Sends coordinates to `POST /calibration/calibrate`. The backend validates that points are not collinear, computes planar homography matrix $H$, verifies the matrix condition number, and calculates the mean reprojection error (in pixels).
  4. Displays a real-time status badge:
     * `CALIBRATED — METRIC` (Green)
     * `CALIBRATED — RELATIVE/ARBITRARY SCALE` (Blue)
     * `CALIBRATION INVALID` (Red)
     * `IMAGE-SPACE ONLY` (Gray)
  5. Click **"Reset to Image-Space"** to discard homography and return to safe image-space mode.

### Feature 4: Dynamic Video Pipeline Controls
* Top control bar allows you to switch test scenarios without restarting the backend:
  * **Video Source:** Choose between Video #35 (crash interval: 418s–500s), Video #1 (normal traffic), Video #14 (crash interval: 475s–600s), Video #33, or Video #97.
  * **Runtime Engine:** Toggle between **PyTorch (FP32)** and **ONNX Runtime (CPU)**.
  * **Graph Topology Mode:** Toggle between **G0 (Full Graph)**, **G1 (k-NN, k=4)**, **G2 (Distance-Gated)**, and **G3 (Hybrid Motion-Aware)**.
  * **Alert Policy:** Toggle between **Fixed Threshold ($\tau=0.65$)** and **Traffic-Density-Conditioned Policy**.
  * **Start / Stop Buttons:** Dynamically triggers or halts backend processing.

### Feature 5: Real-Time Telemetry & Early Warning Lead Time
* The right sidebar updates at 30 FPS over WebSockets:
  * **Timestamp & Camera ID**
  * **Safety-Guided SAHI Status:** Indicates whether high-resolution slicing is active or gated by optical flow.
  * **CAGT-Risk Probability Gauge:** Displays calibrated anomaly probability ($0\%\text{--}100\%$).
  * **Aleatoric Uncertainty:** Displays Kalman covariance and GNN variance.
  * **Early Warning Lead Time Badge:** Automatically displays lead time in seconds (e.g., `2.12 s ahead of ground-truth onset`) whenever an anomaly is predicted ahead of the official ground-truth timestamp!
  * **Active Detections Table:** Real-time table listing track ID, class, speed, and uncertainty for every visible road user.

### Feature 6: Event Review Mode (`/review`)
* Historical event archive fetching data from `http://localhost:8000/events` and MongoDB:
  * Table of captured anomaly events with UUID, Camera ID, trigger probability, uncertainty, warning lead time, and video evidence path.
  * Full reference table of official AI City Challenge 2021 Track 4 anomaly intervals (start second, end second, and ground-truth disruption description).

### Feature 7: Research Metrics & Ablation Dashboard (`/metrics`)
* Research analytics page displaying the authentic experimental tables:
  * **Table E1:** Runtime Engine Benchmarking (PyTorch vs ONNX: load time, latency, FPS, RAM, numerical equivalence IoU).
  * **Table E2:** Dynamic Interaction-Graph Edge Pruning Ablation ($G_0$ to $G_3$: edge counts, reduction %, build latency, complexity).
  * **Table E3:** Decision Policy Comparison (Fixed vs Density-Conditioned vs Calibrated Uncertainty: Recall, Precision, F1, False Alarms/hr, Lead Time, ECE).

---

## 3. Frontend Architecture

```
frontend/
├── index.html                           # Single page HTML entrypoint
├── package.json                         # Node dependencies (React, Vite, Three.js, Axios, React Router)
├── vite.config.js                       # Vite build & development configuration
└── src/
    ├── App.jsx                          # Main router (Sentinel Live, Event Review, Research Metrics)
    ├── main.jsx                         # React DOM root mounting
    ├── components/
    │   ├── CameraCalibrationModal.jsx   # 4-point homography interactive calibration modal
    │   ├── DetectionPanel.jsx           # Live agent telemetry table
    │   ├── SystemStatus.jsx             # Backend telemetry & CAGT-risk status card
    │   └── ThreeScene.jsx               # Three.js WebGL 3D ground-plane renderer
    ├── pages/
    │   ├── Dashboard.jsx                # Unified live operator dashboard
    │   ├── EventReview.jsx              # Event intelligence & MongoDB archive
    │   └── SystemMetrics.jsx            # Research metrics & ablation tables
    └── services/
        └── websocket.js                 # Resilient WebSocket client with automatic reconnection
```

---

## 4. Testing & Verification

1. **Verify WebSocket Connection:**
   When the backend is running, the top-right pill in the sidebar will turn green and display `CONNECTED`. If the backend is stopped, it automatically turns red and displays `BACKEND DISCONNECTED` with automatic 3-second reconnect attempts.
2. **Verify Stream:**
   When you click "Start Pipeline", the MJPEG feed in the center displays live video with green bounding boxes and top telemetry banners.
3. **Verify 3D Visualizer:**
   Blue 3D bounding boxes will appear on the black grid corresponding to detected vehicles, with light-blue ribbons trailing behind them to visualize trajectories.
