import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { TelemetryProvider } from './context/TelemetryContext';
import Layout from './components/layout/Layout';

// Pages in Exact Required Navigation Order
import Dashboard from './pages/Dashboard';
import LiveMonitoring from './pages/LiveMonitoring';
import VideoAnalysis from './pages/VideoAnalysis';
import EventReview from './pages/EventReview';
import TrajectoryAnalysis from './pages/TrajectoryAnalysis';
import ModelStatus from './pages/ModelStatus';
import ResearchEvaluation from './pages/ResearchEvaluation';
import ResearchArchitecture from './pages/ResearchArchitecture';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <TelemetryProvider>
          <Routes>
          <Route path="/" element={<Layout />}>
            {/* 1. Main Dashboard */}
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Navigate to="/" replace />} />

            {/* 2. Live Monitoring */}
            <Route path="live" element={<LiveMonitoring />} />

            {/* 3. Video Analysis (Recorded Video Analysis & Clip Extraction) */}
            <Route path="analysis" element={<VideoAnalysis />} />

            {/* 4. Accident & Event Review / Evidence Hub */}
            <Route path="review" element={<EventReview />} />
            <Route path="evidence" element={<EventReview />} />
            <Route path="events" element={<EventReview />} />

            {/* 5. Trajectory Analysis — Three.js */}
            <Route path="trajectories" element={<TrajectoryAnalysis />} />


            {/* 7. Model & System Status */}
            <Route path="models" element={<ModelStatus />} />

            {/* 8. Research Evaluation */}
            <Route path="evaluation" element={<ResearchEvaluation />} />

            {/* Research Architecture & Defense */}
            <Route path="architecture" element={<ResearchArchitecture />} />

            {/* 9. Settings */}
            <Route path="settings" element={<Settings />} />

            {/* Backwards compatibility alias */}
            <Route path="metrics" element={<Navigate to="/evaluation" replace />} />

            {/* Fallback route */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </TelemetryProvider>
    </ThemeProvider>
  </BrowserRouter>
);
}
