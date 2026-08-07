'use client';

import { useEffect } from 'react';

export default function DashboardError({ error, reset }) {
  useEffect(() => {
    console.error('[dashboard-render-error]', {
      digest: error?.digest || null,
      message: error?.message || 'Unknown dashboard render error',
    });
  }, [error]);

  return (
    <main className="auth-page">
      <section className="auth-card" role="alert">
        <div className="auth-brand">
          <span className="auth-brand-badge">C</span>
          <span>Canary Data</span>
        </div>
        <h1>Dashboard could not finish loading</h1>
        <p>Your account and saved data are unchanged. Try the dashboard again.</p>
        <button className="btn btn-primary" type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
