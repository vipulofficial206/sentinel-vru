import React, { createContext, useContext } from 'react';
import { useTelemetry } from '../hooks/useTelemetry';

const TelemetryContext = createContext(null);

export function TelemetryProvider({ children }) {
  const telemetryData = useTelemetry();
  return (
    <TelemetryContext.Provider value={telemetryData}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetryContext() {
  const ctx = useContext(TelemetryContext);
  if (!ctx) {
    throw new Error('useTelemetryContext must be used within a TelemetryProvider');
  }
  return ctx;
}
