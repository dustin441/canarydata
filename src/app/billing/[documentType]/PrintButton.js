'use client';

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{ background: '#f5c518', color: '#111827', padding: '10px 14px', borderRadius: '8px', border: 0, fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}
    >
      Print / Save PDF
    </button>
  );
}
