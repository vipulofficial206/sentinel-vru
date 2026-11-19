// Sentinel Telemetry WebSocket Service
// Connects to ws://localhost:8000/ws/live or ws://localhost:8000/ws

export class SentinelSocket {
  constructor(options = {}) {
    this.baseUrl = options.url || 'ws://localhost:8000/ws/live';
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.status = 'DISCONNECTED'; // 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 10000;
    this.reconnectTimer = null;
    this.isExplicitlyClosed = false;
    this.lastMessageTime = null;
    this.heartbeatTimer = null;
  }

  setUrl(url) {
    if (this.baseUrl !== url) {
      this.baseUrl = url;
      if (this.status === 'CONNECTED' || this.status === 'CONNECTING') {
        this.disconnect();
        this.connect();
      }
    }
  }

  setStatus(newStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.statusListeners.forEach((fn) => {
        try {
          fn(newStatus);
        } catch (e) {
          console.error('[SentinelSocket] Status listener error:', e);
        }
      });
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatusChange(listener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isExplicitlyClosed = false;
    this.setStatus('CONNECTING');

    try {
      this.ws = new WebSocket(this.baseUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('CONNECTED');
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.lastMessageTime = Date.now();
          this.listeners.forEach((fn) => {
            try {
              fn(data);
            } catch (err) {
              console.error('[SentinelSocket] Message listener error:', err);
            }
          });
        } catch (err) {
          console.warn('[SentinelSocket] Malformed JSON payload received:', event.data);
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.setStatus('DISCONNECTED');
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[SentinelSocket] Connection error:', err);
        // On error, onclose is called next
      };
    } catch (err) {
      console.error('[SentinelSocket] Failed to create WebSocket:', err);
      this.setStatus('DISCONNECTED');
      this.scheduleReconnect();
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Send lightweight keepalive ping text
        try {
          this.ws.send('ping');
        } catch (_) {}
      }
    }, 15000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    this.isExplicitlyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.setStatus('DISCONNECTED');
  }
}

// Global shared socket instance
export const socketService = new SentinelSocket();
