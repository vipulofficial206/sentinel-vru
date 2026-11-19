// Centralized HTTP client for Sentinel FastAPI backend
// Connects strictly to existing endpoints in main.py

const DEFAULT_API_BASE = 'http://localhost:8000';

export const getApiBaseUrl = () => {
  return localStorage.getItem('sentinel_api_base') || DEFAULT_API_BASE;
};

export const setApiBaseUrl = (url) => {
  if (url) {
    localStorage.setItem('sentinel_api_base', url.replace(/\/+$/, ''));
  } else {
    localStorage.removeItem('sentinel_api_base');
  }
};

async function request(endpoint, options = {}) {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  
  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {})
  };

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 10000);

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      let errDetail = res.statusText;
      try {
        const errJson = await res.json();
        errDetail = errJson.detail || errJson.error || errDetail;
      } catch (_) {}
      const error = new Error(`HTTP ${res.status}: ${errDetail}`);
      error.status = res.status;
      throw error;
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${options.timeout || 10000}ms: ${endpoint}`);
    }
    throw err;
  }
}

export const api = {
  // System & Health Endpoints
  getHealth: () => request('/health'),
  getSystemStatus: () => request('/system/status'),
  getModelStatus: () => request('/models/status'),
  
  // Video & Stream Controls
  getVideoStatus: () => request('/video/status'),
  startVideo: (config = {}) => request('/video/start', {
    method: 'POST',
    body: {
      video_path: typeof config.video_path === 'string' ? config.video_path : '',
      engine: config.engine || 'onnx',
      graph_mode: config.graph_mode || 'G3',
      alert_policy: config.alert_policy || 'density_conditioned',
      start_time_seconds: Number(config.start_time_seconds || 0.0),
      playback_speed: Number(config.playback_speed || 1.0)
    }
  }),
  setPlaybackSpeed: (speed) => request('/video/speed', {
    method: 'POST',
    body: { speed: Number(speed) }
  }),
  stopVideo: () => request('/video/stop', { method: 'POST' }),
  getVideoStreamUrl: () => `${getApiBaseUrl()}/video/stream`,

  // Telemetry & Detections
  getDetections: () => request('/detections'),
  getTracks: () => request('/tracks'),
  getTrajectories: () => request('/trajectories'),
  getRisk: () => request('/risk'),
  getUncertainty: () => request('/uncertainty'),

  // Alerts, Ring Buffer & Events
  getAlerts: () => request('/alerts'),
  getEvents: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.append('search', params.search);
    if (params.category) qs.append('category', params.category);
    if (params.review_status) qs.append('review_status', params.review_status);
    if (params.limit) qs.append('limit', params.limit);
    const qStr = qs.toString();
    return request(`/events${qStr ? `?${qStr}` : ''}`);
  },
  getSingleEvent: (eventId) => request(`/events/${eventId}`),
  reviewEvent: (eventId, reviewData) => request(`/events/${eventId}/review`, {
    method: 'POST',
    body: reviewData
  }),
  clearEvents: () => request('/events/clear', { method: 'POST' }),
  getRingBufferStatus: () => request('/ring_buffer/status'),
  getEventsManifestUrl: (format = 'json') => `${getApiBaseUrl()}/events/manifest?format=${format}`,

  // Mode B: Recorded Video Analysis & Clip Extraction
  getAnalysisVideos: () => request('/analysis/videos'),
  uploadVideo: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return request('/analysis/upload', {
      method: 'POST',
      body: formData,
      timeout: 60000
    });
  },
  validateVideo: (videoPath) => request('/analysis/validate', {
    method: 'POST',
    body: { video_path: videoPath }
  }),
  createAnalysisJob: (jobConfig) => request('/analysis/jobs', {
    method: 'POST',
    body: jobConfig
  }),
  getAnalysisJobs: () => request('/analysis/jobs'),
  getAnalysisJob: (jobId) => request(`/analysis/jobs/${jobId}`),
  cancelAnalysisJob: (jobId) => request(`/analysis/jobs/${jobId}/cancel`, { method: 'POST' }),
  getJobManifestUrl: (jobId, format = 'json') => `${getApiBaseUrl()}/analysis/jobs/${jobId}/manifest?format=${format}`,
  getClipUrl: (clipFilename) => `${getApiBaseUrl()}/analysis/clips/${clipFilename}`,
  getVideoFileUrl: (videoPath) => `${getApiBaseUrl()}/video/file?path=${encodeURIComponent(videoPath)}`,

  // Camera Calibration
  getCalibrationStatus: () => request('/calibration/status'),
  calibrateCamera: (calibrationData) => request('/calibration/calibrate', {
    method: 'POST',
    body: calibrationData
  }),
  resetCalibration: () => request('/calibration/reset', { method: 'POST' })
};
