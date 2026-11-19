import { useState, useEffect, useRef } from 'react';
import { socketService } from '../services/websocket';

export function useTelemetry() {
  const [status, setStatus] = useState('DISCONNECTED');
  const [telemetry, setTelemetry] = useState(null);
  const [isStale, setIsStale] = useState(false);
  const lastReceivedRef = useRef(null);

  useEffect(() => {
    // Connect to WebSocket
    socketService.connect();

    // Subscribe to status changes
    const unsubStatus = socketService.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    // Subscribe to messages with smooth frame-throttling to maintain instantaneous UI responsiveness
    let latestPayload = null;
    let rafId = null;
    let lastRenderTime = 0;
    const THROTTLE_MS = 65; // ~15 FPS React DOM refresh cadence, perfectly smooth without freezing the thread

    const unsubMessage = socketService.subscribe((payload) => {
      lastReceivedRef.current = Date.now();
      latestPayload = payload;
      const now = performance.now();

      if (now - lastRenderTime >= THROTTLE_MS) {
        lastRenderTime = now;
        setIsStale(false);
        setTelemetry(payload);
      } else if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          lastRenderTime = performance.now();
          setIsStale(false);
          if (latestPayload) {
            setTelemetry(latestPayload);
          }
        });
      }
    });

    // Check staleness timer
    const staleInterval = setInterval(() => {
      if (lastReceivedRef.current && Date.now() - lastReceivedRef.current > 4000) {
        setIsStale(true);
      }
    }, 1500);

    return () => {
      unsubStatus();
      unsubMessage();
      if (rafId) cancelAnimationFrame(rafId);
      clearInterval(staleInterval);
    };
  }, []);

  return {
    status,
    telemetry,
    isStale,
    isConnected: status === 'CONNECTED',
    agents: telemetry?.agents || [],
    alerts: telemetry?.alerts || [],
    metrics: telemetry?.system_metrics || null,
    risk: telemetry ? {
      raw: telemetry.risk_score,
      calibrated: telemetry.calibrated_risk,
      uncertainty: telemetry.uncertainty,
      warningState: telemetry.warning_state,
      leadTime: telemetry.warning_lead_time,
      isAlert: telemetry.anomaly_alert
    } : null,
    frameId: telemetry?.frame_id ?? null,
    videoTime: telemetry?.video_time ?? null,
    coordinateSpace: telemetry?.coordinate_space || 'IMAGE-SPACE ONLY'
  };
}
