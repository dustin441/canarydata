'use client';

import { useState, useMemo, useEffect, useRef, useTransition } from 'react';
import Image from 'next/image';
import { setEarnedMedia, saveNote, addQuery, deleteQuery, submitFeedback } from '@/app/actions';

const ALL_COLUMNS = [
  { id: 'date',               label: 'Date',               required: true  },
  { id: 'headline',           label: 'Headline',           required: true  },
  { id: 'summary',            label: 'Summary',            defaultOn: true },
  { id: 'link',               label: 'Link',               defaultOn: true },
  { id: 'source',             label: 'Source',             defaultOn: true },
  { id: 'tags',               label: 'Tags',               defaultOn: true },
  { id: 'score',              label: 'Score',              defaultOn: true },
  { id: 'innovation_reason',  label: 'Innovation Reason',  defaultOn: false },
  { id: 'recommendation',     label: 'Recommendation',     defaultOn: false },
  { id: 'earned_media',       label: 'Earned Media',       defaultOn: true },
  { id: 'notes',              label: 'Notes',              defaultOn: true },
];

const DEFAULT_VISIBLE = new Set(
  ALL_COLUMNS.filter((c) => c.required || c.defaultOn).map((c) => c.id)
);
import {
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const TOOLTIP_STYLE = {
  background: '#1A2332',
  border: '1px solid #1E2D40',
  borderRadius: '8px',
  color: '#F1F5F9',
  fontSize: '12px',
};

const SOURCE_COLORS = {
  news: '#F5C518',
  facebook: '#3B82F6',
  instagram: '#E1306C',
  tiktok: '#69C9D0',
  twitter: '#1DA1F2',
  youtube: '#FF0000',
  other: '#94A3B8',
};

function getScoreClass(score) {
  const n = parseFloat(score);
  if (n >= 7.0) return 'high';
  if (n >= 3.0) return 'medium';
  return 'low';
}

function InfoTooltip({ text }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: '5px', verticalAlign: 'middle' }}
      className="info-tooltip-wrap"
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '15px', height: '15px', borderRadius: '50%',
        background: 'var(--bg-elevated)', border: '1px solid var(--border-secondary)',
        color: 'var(--text-tertiary)', fontSize: '10px', fontWeight: 700,
        cursor: 'default', lineHeight: 1, userSelect: 'none',
      }}>i</span>
      <span style={{
        visibility: 'hidden', opacity: 0, position: 'absolute',
        top: 'calc(100% + 10px)', right: '-10px',
        background: '#1A2332', border: '1px solid var(--border-secondary)',
        borderRadius: '8px', padding: '12px 16px',
        fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5,
        width: '280px', whiteSpace: 'normal', zIndex: 1000,
        boxShadow: 'var(--shadow-lg)',
        transition: 'opacity 0.15s, visibility 0.15s',
        pointerEvents: 'none',
      }} className="info-tooltip-box">
        {text}
      </span>
      <style>{`.info-tooltip-wrap:hover .info-tooltip-box { visibility: visible !important; opacity: 1 !important; }`}</style>
    </span>
  );
}

const SCORE_TOOLTIP = 'Canary Score (1–10) measures how positive an article is about your district. 7–10 = positive coverage, 3–7 = neutral, 1–3 = negative or critical news.';

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatDistrictName(id) {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function ScoreGauge({ score }) {
  const nScore = score === '—' ? 0 : parseFloat(score);
  
  // Decide color based on score
  let color = '#EF4444'; // Red (0-3)
  if (nScore >= 3) color = '#F5C518'; // Yellow (3-7)
  if (nScore >= 7) color = '#22C55E'; // Green (7-10)

  // Math for SVG arc (strokeDasharray for a semicircle of r=80 is pi * 80 ~= 251.2)
  const dashArray = 251.2;
  const dashOffset = dashArray - (dashArray * (nScore / 10));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: '20px' }}>
      <svg width="200" height="105" viewBox="0 0 200 105" style={{ overflow: 'visible' }}>
        {/* Background track */}
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#1E2D40" strokeWidth="20" strokeLinecap="round" />
        {/* Progress track */}
        <path 
           d="M 20 100 A 80 80 0 0 1 180 100" 
           fill="none" 
           stroke={color} 
           strokeWidth="20" 
           strokeLinecap="round"
           strokeDasharray={dashArray} 
           strokeDashoffset={dashOffset} 
           style={{ transition: 'stroke-dashoffset 1s ease-out, stroke 1s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', bottom: '-10px', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', fontWeight: '800', color: 'var(--text-primary)', lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '6px' }}>Health Score</div>
      </div>
    </div>
  );
}

function buildChartData(articles) {
  // Group by week for trend charts — key is ISO date of Sunday (sortable, year-aware)
  const byWeek = {};
  articles.forEach((a) => {
    const d = new Date(a.date + 'T00:00:00');
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - d.getDay());
    // ISO key ensures no cross-year collisions and enables correct sort
    const key = sunday.toISOString().slice(0, 10);
    if (!byWeek[key]) byWeek[key] = { isoDate: key, mentions: 0, scoreSum: 0 };
    byWeek[key].mentions++;
    byWeek[key].scoreSum += parseFloat(a.canary_score ?? 0);
  });

  // Sort chronologically, then take the most recent 10 weeks
  const sorted = Object.values(byWeek).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  const recent = sorted.slice(-10);

  // Format display label: "May 12, 2025"
  function weekLabel(isoDate) {
    const [year, month, day] = isoDate.split('-');
    return new Date(Number(year), Number(month) - 1, Number(day))
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const mentionTrend = recent.map((w) => ({ date: weekLabel(w.isoDate), mentions: w.mentions }));

  const sentimentTrend = recent.map((w) => ({
    date: weekLabel(w.isoDate),
    score: parseFloat((w.scoreSum / w.mentions).toFixed(2)),
  }));

  // Source breakdown
  const sourceCounts = {};
  articles.forEach((a) => {
    const t = (a.source_type ?? 'other').toLowerCase();
    sourceCounts[t] = (sourceCounts[t] ?? 0) + 1;
  });
  const total = articles.length || 1;
  const sourceBreakdown = Object.entries(sourceCounts)
    .map(([name, count]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value: Math.round((count / total) * 100),
      color: SOURCE_COLORS[name] ?? SOURCE_COLORS.other,
    }))
    .sort((a, b) => b.value - a.value);

  return { mentionTrend, sentimentTrend, sourceBreakdown };
}

const CHANNEL_COLORS = {
  news:   { bg: '#F5C51820', color: '#F5C518' },
  social: { bg: '#3B82F620', color: '#3B82F6' },
  all:    { bg: '#22C55E20', color: '#22C55E' },
};

function QueriesView({ initialQueries, districts, userDistrictId }) {
  const [queries, setQueries] = useState(initialQueries);
  const [districtFilter, setDistrictFilter] = useState(userDistrictId ?? 'All');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    query_text: '',
    channels: 'news',
    district_id: userDistrictId ?? '',
    geo_city: '',
    geo_state: '',
    geo_zip: '',
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [addError, setAddError] = useState('');

  const filtered = districtFilter === 'All'
    ? queries
    : queries.filter((q) => q.district_id === districtFilter);

  // group by has-geo vs no-geo
  const geoQueries = filtered.filter((q) => q.geo_city || q.geo_state || q.geo_zip);
  const keywordQueries = filtered.filter((q) => !q.geo_city && !q.geo_state && !q.geo_zip);

  async function handleDelete(id) {
    setDeletingId(id);
    try {
      await deleteQuery(id);
      setQueries((prev) => prev.filter((q) => q.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.query_text.trim()) { setAddError('Query text is required.'); return; }
    setAddError('');
    setSaving(true);
    try {
      const districtName = districts.find((d) => d.id === form.district_id)?.name ?? null;
      const newQuery = await addQuery({ ...form, district_name: districtName });
      setQueries((prev) => [...prev, newQuery]);
      setForm({ query_text: '', channels: 'news', district_id: userDistrictId ?? '', geo_city: '', geo_state: '', geo_zip: '' });
      setShowAddForm(false);
    } catch (err) {
      setAddError(err.message ?? 'Failed to add query.');
    } finally {
      setSaving(false);
    }
  }

  function QueryRow({ q }) {
    const ch = CHANNEL_COLORS[q.channels] ?? CHANNEL_COLORS.news;
    const geo = [q.geo_city, q.geo_state, q.geo_zip].filter(Boolean).join(', ');
    return (
      <tr key={q.id}>
        <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{q.query_text}</td>
        <td>
          <span style={{
            padding: '3px 10px', borderRadius: 'var(--radius-full)',
            fontSize: '0.72rem', fontWeight: 600,
            background: ch.bg, color: ch.color,
          }}>
            {q.channels ?? 'news'}
          </span>
        </td>
        <td style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
          {geo || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span>}
        </td>
        {!userDistrictId && (
          <td style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
            {q.district_name ?? <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span>}
          </td>
        )}
        <td style={{ textAlign: 'right' }}>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => handleDelete(q.id)}
            disabled={deletingId === q.id}
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
          >
            {deletingId === q.id ? '…' : 'Delete'}
          </button>
        </td>
      </tr>
    );
  }

  function QueryTable({ rows, emptyMsg }) {
    if (rows.length === 0) {
      return <p style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '12px 0', fontSize: '0.85rem' }}>{emptyMsg}</p>;
    }
    return (
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Query</th>
              <th>Channel</th>
              <th>Location</th>
              {!userDistrictId && <th>District</th>}
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => <QueryRow key={q.id} q={q} />)}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      {/* Queries header */}
      <div className="data-section">
        <div className="data-header">
          <h3>🔍 Search Queries <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', fontWeight: 400 }}>({filtered.length})</span></h3>
          <div className="data-filters">
            {!userDistrictId && (
              <select
                className="filter-select"
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
              >
                <option value="All">All Districts</option>
                {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddForm((o) => !o)}
            >
              {showAddForm ? '✕ Cancel' : '+ Add Query'}
            </button>
          </div>
        </div>

        {/* Add Query Form */}
        {showAddForm && (
          <form onSubmit={handleAdd} style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border-secondary)',
            borderRadius: 'var(--radius-lg)', padding: '20px', marginBottom: '24px',
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '14px' }}>
              New Query
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', marginBottom: '12px' }}>
              <input
                className="form-input"
                placeholder="Query text (e.g. Bessemer City Schools budget)"
                value={form.query_text}
                onChange={(e) => setForm((f) => ({ ...f, query_text: e.target.value }))}
                required
              />
              <select
                className="filter-select"
                value={form.channels}
                onChange={(e) => setForm((f) => ({ ...f, channels: e.target.value }))}
                style={{ minWidth: '100px' }}
              >
                <option value="news">News</option>
                <option value="social">Social</option>
                <option value="all">All</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '12px', marginBottom: '12px' }}>
              <input
                className="form-input"
                placeholder="City (optional)"
                value={form.geo_city}
                onChange={(e) => setForm((f) => ({ ...f, geo_city: e.target.value }))}
              />
              <input
                className="form-input"
                placeholder="State (optional)"
                value={form.geo_state}
                onChange={(e) => setForm((f) => ({ ...f, geo_state: e.target.value }))}
              />
              <input
                className="form-input"
                placeholder="ZIP"
                value={form.geo_zip}
                onChange={(e) => setForm((f) => ({ ...f, geo_zip: e.target.value }))}
              />
            </div>
            {!userDistrictId && (
              <div style={{ marginBottom: '12px' }}>
                <select
                  className="filter-select"
                  value={form.district_id}
                  onChange={(e) => setForm((f) => ({ ...f, district_id: e.target.value }))}
                  style={{ width: '100%' }}
                >
                  <option value="">No district</option>
                  {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
            {addError && (
              <div style={{ color: '#EF4444', fontSize: '0.82rem', marginBottom: '10px' }}>{addError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? <span className="spinner" style={{ margin: '0 auto' }} /> : 'Add Query'}
              </button>
            </div>
          </form>
        )}

        {/* Keyword Queries */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
            Keyword Queries ({keywordQueries.length})
          </div>
          <QueryTable rows={keywordQueries} emptyMsg="No keyword queries." />
        </div>

        {/* Geographic Queries */}
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
            Geographic Queries ({geoQueries.length})
          </div>
          <QueryTable rows={geoQueries} emptyMsg="No geographic queries." />
        </div>
      </div>
    </>
  );
}

function NotesView({ articles, getNoteText, openNoteModal }) {
  const noted = articles.filter((a) => getNoteText(a));

  if (noted.length === 0) {
    return (
      <div className="data-section">
        <div className="data-header"><h3>📝 Analyst Notes</h3></div>
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <h3>No notes yet</h3>
          <p>Add notes to articles from the Dashboard view.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="data-section">
      <div className="data-header">
        <h3>📝 Analyst Notes <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', fontWeight: 400 }}>({noted.length})</span></h3>
      </div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Headline</th>
              <th>Note</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {noted.map((a) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{formatDate(a.date)}</td>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                  {a.link
                    ? <a href={a.link} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{a.headline}</a>
                    : a.headline}
                </td>
                <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: '400px' }}>{getNoteText(a)}</td>
                <td>
                  <button className="btn btn-secondary btn-sm" onClick={() => openNoteModal(a)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsView() {
  const handleLogout = async () => {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = '/login';
    } catch {}
  };

  return (
    <div className="data-section">
      <div className="data-header">
        <h3>⚙️ Settings</h3>
      </div>
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-secondary)', borderRadius: 'var(--radius-lg)', padding: '32px', maxWidth: '800px', marginBottom: '24px' }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: '16px', fontSize: '1.2rem' }}>Profile Information</h4>
        <div style={{ display: 'grid', gap: '20px', marginBottom: '32px', maxWidth: '400px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>Full Name</label>
            <input type="text" className="form-input" disabled defaultValue="Canary Admin" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>Email Address</label>
            <input type="text" className="form-input" disabled defaultValue="admin@canary.data" />
          </div>
        </div>

        <h4 style={{ color: 'var(--text-primary)', marginBottom: '16px', marginTop: '32px', fontSize: '1.2rem', paddingTop: '32px', borderTop: '1px solid var(--border-secondary)' }}>Notification Preferences</h4>
        <div style={{ display: 'grid', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', fontSize: '0.95rem', cursor: 'pointer' }}>
            <input type="checkbox" defaultChecked style={{ width: '18px', height: '18px', accentColor: 'var(--brand-primary)' }} />
            Daily digest emails
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', fontSize: '0.95rem', cursor: 'pointer' }}>
            <input type="checkbox" defaultChecked style={{ width: '18px', height: '18px', accentColor: 'var(--brand-primary)' }} />
            Alerts for negative sentiment drops
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', fontSize: '0.95rem', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: '18px', height: '18px', accentColor: 'var(--brand-primary)' }} />
            Weekly reporting summaries
          </label>
        </div>

        <div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px solid var(--border-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Need help? Contact support.
          </div>
          <button onClick={handleLogout} className="btn btn-danger">
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientsView({ clients }) {
  const [revealed, setRevealed] = useState({});
  const [copied, setCopied] = useState({});

  function toggleReveal(id) {
    setRevealed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function copyText(key, text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => setCopied((prev) => ({ ...prev, [key]: false })), 1500);
    });
  }

  const loginUrl = 'https://canarydata.vercel.app/login';

  return (
    <div className="data-section">
      <div className="data-header">
        <h3>👥 Beta Testers</h3>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{clients.length} clients</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ minWidth: '900px' }}>
          <thead>
            <tr>
              <th>Organization</th>
              <th>Contact</th>
              <th>Email</th>
              <th>Temp Password</th>
              <th>Login URL</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const emailKey = `email-${c.district_id}`;
              const pwKey = `pw-${c.district_id}`;
              const urlKey = `url-${c.district_id}`;
              return (
                <tr key={c.district_id}>
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    {c.district_id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{c.first_name} {c.last_name}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.email}</span>
                      <button
                        onClick={() => copyText(emailKey, c.email)}
                        className="btn btn-sm btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '0.75rem', minWidth: '52px' }}
                      >
                        {copied[emailKey] ? '✓' : 'Copy'}
                      </button>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {revealed[c.district_id] ? c.temp_password : '••••••••••••••'}
                      </span>
                      <button
                        onClick={() => toggleReveal(c.district_id)}
                        className="btn btn-sm btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '0.75rem', minWidth: '52px' }}
                      >
                        {revealed[c.district_id] ? 'Hide' : 'Show'}
                      </button>
                      <button
                        onClick={() => copyText(pwKey, c.temp_password)}
                        className="btn btn-sm btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '0.75rem', minWidth: '52px' }}
                      >
                        {copied[pwKey] ? '✓' : 'Copy'}
                      </button>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <a href={loginUrl} target="_blank" rel="noreferrer"
                        style={{ fontSize: '0.85rem', color: 'var(--brand-primary)', textDecoration: 'none' }}>
                        canarydata.vercel.app/login
                      </a>
                      <button
                        onClick={() => copyText(urlKey, loginUrl)}
                        className="btn btn-sm btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '0.75rem', minWidth: '52px' }}
                      >
                        {copied[urlKey] ? '✓' : 'Copy'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpandableText({ text, empty = false }) {
  const [open, setOpen] = useState(false);
  if (empty || !text) return <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span>;
  return (
    <>
      <div className="summary-text">{text}</div>
      <button className="expand-btn" onClick={() => setOpen(true)}>Show more</button>
      {open && (
        <div className="expand-overlay" onClick={() => setOpen(false)}>
          <div className="expand-popover" onClick={(e) => e.stopPropagation()}>
            <p className="expand-body">{text}</p>
            <button className="expand-close-btn" onClick={() => setOpen(false)}>Hide</button>
          </div>
        </div>
      )}
    </>
  );
}

function FeedbackModal({ districtId, districtName, onClose }) {
  const [message, setMessage] = useState('');
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.append('message', message);
    fd.append('district_id', districtId || '');
    fd.append('district_name', districtName || '');
    if (photo) fd.append('photo', photo);
    startTransition(async () => {
      try {
        await submitFeedback(fd);
        setSubmitted(true);
      } catch (err) {
        setError(err.message || 'Something went wrong. Please try again.');
      }
    });
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        {submitted ? (
          <>
            <h3>Thanks for the feedback! 🙌</h3>
            <p className="modal-success">We received your message and will review it shortly.</p>
            <div className="modal-actions">
              <button className="modal-submit-btn" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h3>Share Feedback</h3>
              <p>Found a bug, have a suggestion, or want to share something? Let us know.</p>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
              <textarea
                className="modal-textarea"
                placeholder="Describe your feedback..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
              />
              <label className="modal-file-label">
                Attach a screenshot (optional)
                <input
                  className="modal-file-input"
                  type="file"
                  accept="image/*"
                  onChange={handlePhoto}
                />
              </label>
              {preview && <img className="modal-preview-img" src={preview} alt="Preview" />}
              {error && <p style={{ color: 'var(--status-negative)', fontSize: '0.82rem', margin: 0 }}>{error}</p>}
              <div className="modal-actions">
                <button type="button" className="modal-cancel-btn" onClick={onClose}>Cancel</button>
                <button type="submit" className="modal-submit-btn" disabled={isPending || !message.trim()}>
                  {isPending ? 'Sending…' : 'Send Feedback'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function DashboardClient({ articles, districts, queries: initialQueries, clients = [], userDistrictId }) {
  const [currentView, setCurrentView] = useState('dashboard');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [districtFilter, setDistrictFilter] = useState(userDistrictId ?? 'All');
  const [noteModal, setNoteModal] = useState(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef(null);

  // Load saved column prefs from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('canary_columns');
      if (saved) setVisibleColumns(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

  // Close column menu on outside click
  useEffect(() => {
    function handleClick(e) {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) {
        setColMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggleColumn(id) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('canary_columns', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  const col = (id) => visibleColumns.has(id);

  // Note editing
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteOverrides, setNoteOverrides] = useState({});

  function openNoteModal(article) {
    setNoteText(noteOverrides[article.id] ?? article.notes ?? '');
    setNoteModal(article);
  }

  async function handleSaveNote() {
    if (!noteModal) return;
    setNoteSaving(true);
    try {
      await saveNote(noteModal.id, noteText);
      setNoteOverrides((prev) => ({ ...prev, [noteModal.id]: noteText || null }));
      setNoteModal(null);
    } finally {
      setNoteSaving(false);
    }
  }

  function getNoteText(article) {
    return article.id in noteOverrides ? noteOverrides[article.id] : article.notes;
  }

  // Optimistic earned media state — tracks checkbox changes before DB confirms
  const [earnedOverrides, setEarnedOverrides] = useState({});
  const [, startTransition] = useTransition();

  function handleEarnedMedia(article, checked) {
    setEarnedOverrides((prev) => ({ ...prev, [article.id]: checked }));
    startTransition(async () => {
      try {
        await setEarnedMedia(article.id, checked);
      } catch {
        // Revert on failure
        setEarnedOverrides((prev) => ({ ...prev, [article.id]: !checked }));
      }
    });
  }

  function isEarned(article) {
    return article.id in earnedOverrides
      ? earnedOverrides[article.id]
      : article.is_earned_media;
  }

  const notesCount = articles.filter((a) => a.notes).length;

  const allTags = useMemo(() => {
    const tagSet = new Set();
    articles.forEach((a) => {
      if (Array.isArray(a.tags)) a.tags.forEach((t) => tagSet.add(t));
    });
    return ['All', ...Array.from(tagSet).sort()];
  }, [articles]);

  const allSources = useMemo(() => {
    const s = new Set(articles.map((a) => a.source_type ?? 'other'));
    return ['All', ...Array.from(s).sort()];
  }, [articles]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return articles.filter((a) => {
      const matchSearch =
        !search ||
        a.headline?.toLowerCase().includes(q) ||
        a.summary?.toLowerCase().includes(q);
      const matchSource =
        sourceFilter === 'All' || (a.source_type ?? 'other') === sourceFilter;
      const matchTag =
        tagFilter === 'All' ||
        (Array.isArray(a.tags) && a.tags.includes(tagFilter));
      const matchDistrict =
        districtFilter === 'All' || a.district_id === districtFilter;
      return matchSearch && matchSource && matchTag && matchDistrict;
    });
  }, [articles, search, sourceFilter, tagFilter, districtFilter]);

  const chartArticles = districtFilter === 'All'
    ? articles
    : articles.filter((a) => a.district_id === districtFilter);

  const { mentionTrend, sentimentTrend, sourceBreakdown } = useMemo(
    () => buildChartData(chartArticles),
    [chartArticles]
  );

  const avgScore = chartArticles.length
    ? (
        chartArticles.reduce((sum, a) => sum + parseFloat(a.canary_score ?? 0), 0) /
        chartArticles.length
      ).toFixed(2)
    : '—';

  const topSource = sourceBreakdown[0];

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <Image src="/canary-logo.svg" alt="Canary Data" width={160} height={43} style={{ height: '32px', width: 'auto' }} />
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <div className="sidebar-section-label">Menu</div>
            <button
              className={`sidebar-link ${currentView === 'dashboard' ? 'active' : ''}`}
              onClick={() => setCurrentView('dashboard')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">📊</span>
              Dashboard
            </button>
            <button
              className={`sidebar-link ${currentView === 'articles' ? 'active' : ''}`}
              onClick={() => setCurrentView('dashboard')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">📰</span>
              Articles
              <span className="sidebar-link-badge">{articles.length}</span>
            </button>
            <button
              className={`sidebar-link ${currentView === 'queries' ? 'active' : ''}`}
              onClick={() => setCurrentView('queries')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">🔍</span>
              Queries
              <span className="sidebar-link-badge">{initialQueries.length}</span>
            </button>
            <button
              className={`sidebar-link ${currentView === 'notes' ? 'active' : ''}`}
              onClick={() => setCurrentView('notes')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">📝</span>
              Notes
              <span className="sidebar-link-badge">{notesCount}</span>
            </button>
          </div>
          {!userDistrictId && (
            <div className="sidebar-section">
              <div className="sidebar-section-label">Admin</div>
              <button
                className={`sidebar-link ${currentView === 'clients' ? 'active' : ''}`}
                onClick={() => setCurrentView('clients')}
                style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
              >
                <span className="sidebar-link-icon">👥</span>
                Beta Testers
                <span className="sidebar-link-badge">{clients.length}</span>
              </button>
            </div>
          )}
          {!userDistrictId && (
            <div className="sidebar-section">
              <div className="sidebar-section-label">Districts</div>
              {districts.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDistrictFilter(d.id === districtFilter ? 'All' : d.id)}
                  className={`sidebar-link ${districtFilter === d.id ? 'active' : ''}`}
                  style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
                >
                  <span className="sidebar-link-icon">🏫</span>
                  {d.name}
                </button>
              ))}
            </div>
          )}
          <div className="sidebar-section">
            <div className="sidebar-section-label">Account</div>
            <button
              className={`sidebar-link ${currentView === 'settings' ? 'active' : ''}`}
              onClick={() => setCurrentView('settings')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">⚙️</span>
              Settings
            </button>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">C</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">Canary Admin</div>
              <div className="sidebar-user-email">{districts.length} districts</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen((o) => !o)}
            >
              ☰
            </button>
            <div>
              <div className="topbar-title">
                {currentView === 'queries'
                  ? 'Search Queries'
                  : currentView === 'settings'
                    ? 'Settings'
                    : currentView === 'notes'
                      ? 'Analyst Notes'
                      : currentView === 'clients'
                        ? 'Beta Testers'
                        : districtFilter === 'All'
                          ? 'All Districts'
                          : formatDistrictName(districtFilter)}
              </div>
              <div className="topbar-breadcrumb">
                {currentView === 'queries' ? 'Manage monitored search terms'
                  : currentView === 'settings' ? 'Manage your account and preferences'
                  : currentView === 'notes' ? 'Articles with analyst annotations'
                  : currentView === 'clients' ? 'Login credentials for beta testers'
                  : 'Media Intelligence Dashboard'}
              </div>
            </div>
          </div>
          <div className="topbar-right">
            <button className="feedback-btn" onClick={() => setFeedbackOpen(true)}>
              💬 Feedback
            </button>
          </div>
        </header>

        <main className="page-content">
          {currentView === 'clients' && <ClientsView clients={clients} />}
          {currentView === 'settings' && <SettingsView />}
          {currentView === 'queries' && (
            <QueriesView
              initialQueries={initialQueries}
              districts={districts}
              userDistrictId={userDistrictId}
            />
          )}
          {currentView === 'notes' && (
            <NotesView
              articles={articles}
              getNoteText={getNoteText}
              openNoteModal={openNoteModal}
            />
          )}
          {currentView === 'dashboard' && (<>
          {/* KPI Cards */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-header">
                <div className="kpi-label">Total Mentions</div>
                <div className="kpi-icon yellow">📰</div>
              </div>
              <div className="kpi-value">{chartArticles.length}</div>
              <span className="kpi-change positive">↑ Active monitoring</span>
            </div>

            <div className="kpi-card">
              <div className="kpi-header">
                <div className="kpi-label">
                  Avg Canary Score
                  <InfoTooltip text={SCORE_TOOLTIP} />
                </div>
                <div className="kpi-icon green">📈</div>
              </div>
              <div className="kpi-value">{avgScore}</div>
              <span className="kpi-change positive">↑ Positive sentiment</span>
            </div>

            <div className="kpi-card">
              <div className="kpi-header">
                <div className="kpi-label">Top Source</div>
                <div className="kpi-icon blue">🌐</div>
              </div>
              <div className="kpi-value" style={{ fontSize: '1.4rem' }}>
                {topSource?.name ?? '—'}
              </div>
              {topSource && (
                <span className="kpi-change positive">
                  {topSource.value}% of coverage
                </span>
              )}
            </div>

            <div className="kpi-card">
              <div className="kpi-header">
                <div className="kpi-label">Notes Added</div>
                <div className="kpi-icon yellow">📝</div>
              </div>
              <div className="kpi-value">{notesCount}</div>
              <span className="kpi-change positive">
                Across {articles.length} articles
              </span>
            </div>
          </div>

          {/* Charts */}
          <div className="charts-grid">
            <div className="chart-card">
              <h4>Mention Trend <span>By week</span></h4>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={mentionTrend}>
                  <defs>
                    <linearGradient id="mentionGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F5C518" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#F5C518" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E2D40" />
                  <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="mentions" stroke="#F5C518" strokeWidth={2} fill="url(#mentionGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h4>Source Breakdown <span>By type</span></h4>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={sourceBreakdown}
                    cx="50%" cy="50%"
                    innerRadius={52} outerRadius={80}
                    dataKey="value" paddingAngle={3}
                  >
                    {sourceBreakdown.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val) => `${val}%`} />
                  <Legend formatter={(val) => <span style={{ color: '#94A3B8', fontSize: '11px' }}>{val}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h4>Sentiment Trend <span>Canary score over time</span></h4>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={sentimentTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E2D40" />
                  <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[6, 10]} tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="score" stroke="#22C55E" strokeWidth={2} dot={{ fill: '#22C55E', r: 3, strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h4>Overall Health <span>Current score</span></h4>
              <div style={{ width: '100%', height: '200px', display: 'flex' }}>
                <ScoreGauge score={avgScore} />
              </div>
            </div>
          </div>

          {/* Articles Table */}
          <div className="data-section">
            <div className="data-header">
              <h3>📰 Media Articles</h3>
              <div className="data-filters">
                <input
                  className="filter-input"
                  placeholder="Search headlines..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select className="filter-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                  {allSources.map((s) => <option key={s}>{s}</option>)}
                </select>
                <select className="filter-select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                  {allTags.map((t) => <option key={t}>{t}</option>)}
                </select>
                {districtFilter !== 'All' && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setDistrictFilter('All')}>
                    {formatDistrictName(districtFilter)} ✕
                  </button>
                )}

                {/* Column Manager */}
                <div ref={colMenuRef} style={{ position: 'relative' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setColMenuOpen((o) => !o)}
                  >
                    ⊞ Columns
                  </button>
                  {colMenuOpen && (
                    <div style={{
                      position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                      background: 'var(--bg-card)', border: '1px solid var(--border-secondary)',
                      borderRadius: 'var(--radius-lg)', padding: '12px 16px',
                      zIndex: 200, minWidth: '190px', boxShadow: 'var(--shadow-lg)',
                    }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
                        Visible Columns
                      </div>
                      {ALL_COLUMNS.map((c) => (
                        <label key={c.id} style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '6px 0', cursor: c.required ? 'default' : 'pointer',
                          fontSize: '0.85rem', color: c.required ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        }}>
                          <input
                            type="checkbox"
                            checked={visibleColumns.has(c.id)}
                            disabled={c.required}
                            onChange={() => toggleColumn(c.id)}
                            style={{ accentColor: 'var(--canary-yellow)', width: '15px', height: '15px' }}
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Headline</th>
                    {col('summary')           && <th>Summary</th>}
                    {col('link')              && <th>Link</th>}
                    {col('source')            && <th>Source</th>}
                    {col('tags')              && <th>Tags</th>}
                    {col('score')             && <th>Score<InfoTooltip text={SCORE_TOOLTIP} /></th>}
                    {col('innovation_reason') && <th>Innovation</th>}
                    {col('recommendation')    && <th>Recommendation</th>}
                    {col('earned_media')      && <th>Earned Media</th>}
                    {col('notes')             && <th>Notes</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty-state">
                          <div className="empty-state-icon">🔍</div>
                          <h3>No results found</h3>
                          <p>Try adjusting your search or filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : filtered.map((article) => (
                    <tr key={article.id}>
                      {/* Date */}
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                        {formatDate(article.date)}
                      </td>

                      {/* Headline */}
                      <td className="headline-cell">
                        <div className="headline-text" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                          {article.headline}
                        </div>
                      </td>

                      {/* Summary */}
                      {col('summary') && (
                        <td className="summary-cell">
                          <ExpandableText text={article.summary} />
                        </td>
                      )}

                      {/* Link */}
                      {col('link') && (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {article.link && (
                            <a href={article.link} target="_blank" rel="noopener noreferrer"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: 'var(--blue-400)' }}>
                              ↗ View Story
                            </a>
                          )}
                        </td>
                      )}

                      {/* Source */}
                      {col('source') && (
                        <td>
                          <span style={{
                            padding: '3px 10px', borderRadius: 'var(--radius-full)',
                            fontSize: '0.72rem', fontWeight: 600,
                            background: SOURCE_COLORS[article.source_type] ? `${SOURCE_COLORS[article.source_type]}20` : 'var(--bg-elevated)',
                            color: SOURCE_COLORS[article.source_type] ?? 'var(--text-secondary)',
                          }}>
                            {article.source_type ?? 'other'}
                          </span>
                        </td>
                      )}

                      {/* Tags */}
                      {col('tags') && (
                        <td>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '160px' }}>
                            {Array.isArray(article.tags) && article.tags.map((tag) => (
                              <span key={tag} style={{
                                padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                fontSize: '0.68rem', fontWeight: 600,
                                background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                              }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        </td>
                      )}

                      {/* Score */}
                      {col('score') && (
                        <td>
                          <span className={`score-badge ${getScoreClass(article.canary_score)}`}>
                            {parseFloat(article.canary_score).toFixed(1)}
                          </span>
                        </td>
                      )}

                      {/* Innovation Reason */}
                      {col('innovation_reason') && (
                        <td className="summary-cell">
                          <ExpandableText
                            text={article.innovation_reason !== 'N/A' ? article.innovation_reason : null}
                          />
                        </td>
                      )}

                      {/* Recommendation */}
                      {col('recommendation') && (
                        <td className="summary-cell">
                          <ExpandableText text={article.recommendation} />
                        </td>
                      )}

                      {/* Earned Media */}
                      {col('earned_media') && (
                        <td style={{ textAlign: 'center' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={isEarned(article)}
                              onChange={(e) => handleEarnedMedia(article, e.target.checked)}
                              style={{ accentColor: 'var(--canary-yellow)', width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            {isEarned(article) && (
                              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--canary-yellow)' }}>
                                Earned
                              </span>
                            )}
                          </label>
                        </td>
                      )}

                      {/* Notes */}
                      {col('notes') && (
                        <td>
                          <button
                            className={`note-indicator ${getNoteText(article) ? 'has-note' : ''}`}
                            onClick={() => openNoteModal(article)}
                          >
                            📝 {getNoteText(article) ? 'Edit' : 'Add'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="data-footer">
              <div className="data-footer-info">
                Showing {filtered.length} of {articles.length} articles
              </div>
            </div>
          </div>
          </>)}
        </main>
      </div>

      {/* Note Modal */}
      {noteModal && (
        <div className="modal-overlay" onClick={() => setNoteModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <h3>📝 {getNoteText(noteModal) ? 'Edit Note' : 'Add Note'}</h3>
            <p style={{
              color: 'var(--canary-yellow)', fontWeight: 600,
              fontSize: '0.85rem', marginBottom: '16px', lineHeight: 1.4,
            }}>
              {noteModal.headline}
            </p>

            <textarea
              className="form-textarea"
              placeholder="Add your note here — context, follow-up actions, key observations..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={5}
              autoFocus
            />

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              {getNoteText(noteModal) && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setNoteText('')}
                  disabled={noteSaving}
                  style={{ marginRight: 'auto' }}
                >
                  Clear
                </button>
              )}
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setNoteModal(null)}
                disabled={noteSaving}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveNote}
                disabled={noteSaving}
                style={{ width: 'auto', minWidth: '80px' }}
              >
                {noteSaving ? <span className="spinner" style={{ margin: '0 auto' }} /> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {feedbackOpen && (
        <FeedbackModal
          districtId={userDistrictId}
          districtName={userDistrictId ? districts.find((d) => d.id === userDistrictId)?.name : null}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </div>
  );
}
