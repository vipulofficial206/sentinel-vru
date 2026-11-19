import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useTelemetryContext } from '../../context/TelemetryContext';
import ErrorBoundary from '../common/ErrorBoundary';

export default function Layout() {
  const { status, telemetry, isStale } = useTelemetryContext();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-main)', transition: 'background-color 0.2s ease, color 0.2s ease' }}>
      {/* Persistent Left Sidebar */}
      <Sidebar />

      {/* Main App Container */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflowX: 'hidden' }}>
        {/* Global Application Header */}
        <Header wsStatus={status} telemetry={telemetry} isStale={isStale} />

        {/* Page Content Viewport */}
        <main style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
          <ErrorBoundary componentName="Active Page">
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
