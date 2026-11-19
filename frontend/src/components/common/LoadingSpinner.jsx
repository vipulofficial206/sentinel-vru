import React from 'react';

const SIZE_MAP = {
  xs: 16,
  sm: 20,
  md: 28,
  lg: 40,
  xl: 56
};

export default function LoadingSpinner({ message = 'Loading...', size = 28 }) {
  const pixelSize = typeof size === 'number' ? size : (SIZE_MAP[size] || 28);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 12
      }}
    >
      <svg
        width={pixelSize}
        height={pixelSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ animation: 'spin 1s linear infinite' }}
      >
        <circle cx="12" cy="12" r="10" stroke="rgba(56, 189, 248, 0.2)" />
        <path d="M12 2a10 10 0 0 1 10 10" />
      </svg>
      {message && (
        <span style={{ fontSize: 13, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
          {message}
        </span>
      )}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
