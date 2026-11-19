import React, { useEffect, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * MathFormula — renders LaTeX via bundled KaTeX with styled container.
 * Falls back to styled plain-text if LaTeX fails to parse.
 */
export default function MathFormula({ latex, fallback }) {
  const ref = useRef(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    if (!latex) {
      setRendered(true);
      return;
    }
    try {
      katex.render(latex, ref.current, {
        throwOnError: false,
        displayMode: true,
        output: 'html',
        strict: false,
        trust: true,
      });
      setRendered(true);
    } catch (e) {
      console.warn('KaTeX render error:', e);
      if (ref.current) ref.current.textContent = fallback || latex;
      setRendered(true);
    }
  }, [latex, fallback]);

  return (
    <div
      className="math-formula-box"
      style={{
        marginTop: 14,
        padding: '14px 18px',
        borderRadius: 8,
        background: 'rgba(15, 23, 42, 0.80)',
        border: '1px solid rgba(56, 189, 248, 0.30)',
        boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.35)',
        overflowX: 'auto',
        fontSize: 14,
        lineHeight: 1.7,
        minHeight: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* KaTeX target div — starts empty, filled by useEffect */}
      <div
        ref={ref}
        style={{
          textAlign: 'center',
          width: '100%',
          color: '#e0f2fe',
        }}
      />
      {/* Fallback shown only if KaTeX failed or before it renders */}
      {!rendered && (
        <div style={{ textAlign: 'center', width: '100%', color: '#94a3b8', fontStyle: 'italic', fontSize: 12 }}>
          {fallback || '…'}
        </div>
      )}
    </div>
  );
}
