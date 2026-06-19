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
  { id: 'query',              label: 'Source Query',       defaultOn: false },
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

const PRINT_LOGO_SVG = `<svg id="Layer_1" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="30 340 540 115">
  <!-- Generator: Adobe Illustrator 29.8.6, SVG Export Plug-In . SVG Version: 2.1.1 Build 1)  -->
  <defs>
    <style>
      .st0 {
        fill: #febe13;
      }

      .st1 {
        fill: #0f2a44;
      }

      .st2 {
        fill: #fdbe17;
      }
    </style>
  </defs>
  <path class="st0" d="M135.56,418.56v-18.46l-23.02,4.25v35.81c.77-.4,1.53-.81,2.28-1.25,8.51-4.92,15.66-11.94,20.74-20.35Z"/>
  <path class="st0" d="M83.51,403.18v43.47c.74.03,1.49.04,2.23.04,3.35,0,6.63-.28,9.83-.83,1.34-.23,2.67-.5,3.98-.82,2.39-.58,4.72-1.31,6.98-2.18v-43.94l-23.02,4.25Z"/>
  <path class="st0" d="M54.48,423.31v14.26c2.11,1.34,4.3,2.56,6.58,3.63,4.77,2.24,9.89,3.85,15.26,4.72.39.06.78.12,1.18.18v-27.04l-23.02,4.25Z"/>
  <path class="st0" d="M119.39,353.14s4.18-4.84,4.09-5.26c-.1-.45-3.77.74-5.61,1.37-5.14-4.38-13.59-3.26-18.19,1.48-2.98,3.07-4.12,7.08-6.8,10.25-1.26,1.49-12.56,4.27-22.62,17.62-3.3,4.38-8.17,7.32-12.73,10.42-5.56,3.77-25.2,11.1-25.2,11.1l1.32,5.31,13.88-7.14s5.21-2.31,5.06-2.19c-1.74,1.46-3.78,2.62-5.82,3.62-3.98,1.96-12.25,6.84-12.25,6.84l5.14,3.49s5.37-6.37,8.27-7.97c3.14-1.73,6.5-4.28,9.88-5.36.92-.29,1.86-.47,2.79-.73,0,0,0,0,0,0,4.53-1.2,9.44-2.09,10.66-2.42l3.63.88s.04.01.12.03c1.39.32,3.36.74,4.76.57.33-.04.69-.4,1.01-.2.11.07.64,1.11.82,1.36.71.99,1.54,1.39,2.69,1.75l5.57,5.85,2.76-.42s-3.86-3.91-4.46-4.55c-.34-.36-1.58-1.6-1.65-1.98-.09-.52.13-.79.16-1.21.02-.21-.26-1.32.16-1.22.2.05.6.62.9.79.81.47,1.22.21,2.04.3.68.08.94.78,1.52,1.06.43.21,1.01.23,1.47.38,1.28.43,1.71,1.15,2.62,1.98.28.26,4.57,3.52,4.57,3.52l2.63-.67s-5-4.11-6.68-5.39c-.59-.45-.32-.55-1.23-1.27-.41-.32.04-.56.45-.73,1.32-.54,2.95-.88,4.34-1.39,10.05-3.7,20.3-12.2,18.82-24.06-.33-2.64-1.28-6-.39-8.56.13-.38.77-1.83,1.01-2.06.34-.32.88-1.6,1.31-1.76.72-.27,3.79-.72,3.79-.72l-4.6-2.73Z"/>
  <path class="st2" d="M197.31,428.84c-2.54,1.32-8.16,2.63-15.27,2.63-18.78,0-30.19-11.76-30.19-29.75,0-19.48,13.52-31.24,31.59-31.24,7.11,0,12.2,1.49,14.39,2.63l-2.37,8.6c-2.81-1.23-6.67-2.28-11.58-2.28-12.02,0-20.71,7.55-20.71,21.76,0,12.99,7.63,21.32,20.62,21.32,4.39,0,8.95-.88,11.76-2.19l1.75,8.51Z"/>
  <path class="st2" d="M224.96,430.59l-.7-4.74h-.26c-2.63,3.33-7.11,5.7-12.64,5.7-8.6,0-13.43-6.23-13.43-12.72,0-10.79,9.57-16.24,25.36-16.15v-.7c0-2.81-1.14-7.46-8.69-7.46-4.21,0-8.6,1.32-11.5,3.16l-2.11-7.02c3.16-1.93,8.69-3.77,15.44-3.77,13.69,0,17.64,8.69,17.64,17.99v15.44c0,3.86.18,7.63.61,10.27h-9.74ZM223.56,409.71c-7.63-.18-14.92,1.49-14.92,7.99,0,4.21,2.72,6.14,6.14,6.14,4.3,0,7.46-2.81,8.42-5.88.26-.79.35-1.67.35-2.37v-5.88Z"/>
  <path class="st2" d="M241.12,400.58c0-4.92-.09-9.04-.35-12.72h9.48l.53,6.4h.26c1.84-3.33,6.49-7.37,13.6-7.37,7.46,0,15.18,4.83,15.18,18.34v25.36h-10.79v-24.13c0-6.14-2.28-10.79-8.16-10.79-4.3,0-7.28,3.07-8.42,6.32-.35.96-.44,2.28-.44,3.51v25.1h-10.88v-30.01Z"/>
  <path class="st2" d="M310.98,430.59l-.7-4.74h-.26c-2.63,3.33-7.11,5.7-12.64,5.7-8.6,0-13.43-6.23-13.43-12.72,0-10.79,9.57-16.24,25.36-16.15v-.7c0-2.81-1.14-7.46-8.69-7.46-4.21,0-8.6,1.32-11.5,3.16l-2.11-7.02c3.16-1.93,8.69-3.77,15.44-3.77,13.69,0,17.64,8.69,17.64,17.99v15.44c0,3.86.18,7.63.61,10.27h-9.74ZM309.58,409.71c-7.63-.18-14.92,1.49-14.92,7.99,0,4.21,2.72,6.14,6.14,6.14,4.3,0,7.46-2.81,8.42-5.88.26-.79.35-1.67.35-2.37v-5.88Z"/>
  <path class="st2" d="M327.13,401.63c0-5.79-.09-9.92-.35-13.78h9.39l.35,8.16h.35c2.11-6.05,7.11-9.12,11.67-9.12,1.05,0,1.67.09,2.54.26v10.18c-.88-.18-1.84-.35-3.16-.35-5.18,0-8.69,3.33-9.65,8.16-.18.97-.35,2.1-.35,3.33v22.11h-10.79v-28.96Z"/>
  <path class="st2" d="M362.68,387.86l7.72,22.9c.88,2.63,1.76,5.88,2.37,8.34h.26c.7-2.46,1.49-5.62,2.28-8.42l6.67-22.82h11.58l-10.71,29.13c-5.88,15.97-9.83,23.08-14.92,27.47-4.21,3.77-8.6,5.18-11.32,5.53l-2.46-9.13c1.84-.44,4.12-1.4,6.32-2.98,2.02-1.32,4.39-3.86,5.88-6.76.44-.79.7-1.4.7-1.93,0-.44-.09-1.05-.61-2.1l-15.62-39.23h11.85Z"/>
  <path class="st1" d="M409.64,372.23c4.74-.79,10.79-1.23,17.2-1.23,11.06,0,18.69,2.28,24.13,6.84,5.7,4.65,9.21,11.67,9.21,21.76s-3.6,18.43-9.21,23.52c-5.88,5.35-15.27,8.07-26.76,8.07-6.32,0-11.06-.35-14.57-.79v-58.18ZM420.43,422.34c1.49.26,3.77.26,5.97.26,14.04.09,22.38-7.63,22.38-22.64.09-13.07-7.46-20.53-20.97-20.53-3.42,0-5.88.26-7.37.61v42.3Z"/>
  <path class="st1" d="M488.81,430.59l-.7-4.74h-.26c-2.63,3.33-7.11,5.7-12.64,5.7-8.6,0-13.43-6.23-13.43-12.72,0-10.79,9.57-16.24,25.36-16.15v-.7c0-2.81-1.14-7.46-8.69-7.46-4.21,0-8.6,1.32-11.5,3.16l-2.11-7.02c3.16-1.93,8.69-3.77,15.44-3.77,13.69,0,17.64,8.69,17.64,17.99v15.44c0,3.86.18,7.63.61,10.27h-9.74ZM487.4,409.71c-7.63-.18-14.92,1.49-14.92,7.99,0,4.21,2.72,6.14,6.14,6.14,4.3,0,7.46-2.81,8.42-5.88.26-.79.35-1.67.35-2.37v-5.88Z"/>
  <path class="st1" d="M516.81,375.66v12.2h10.27v8.07h-10.27v18.87c0,5.18,1.4,7.9,5.53,7.9,1.84,0,3.25-.26,4.21-.53l.18,8.25c-1.58.61-4.39,1.05-7.81,1.05-3.95,0-7.28-1.32-9.3-3.51-2.28-2.46-3.34-6.32-3.34-11.93v-20.1h-6.14v-8.07h6.14v-9.65l10.53-2.55Z"/>
  <path class="st1" d="M554.9,430.59l-.7-4.74h-.26c-2.63,3.33-7.11,5.7-12.64,5.7-8.6,0-13.43-6.23-13.43-12.72,0-10.79,9.57-16.24,25.36-16.15v-.7c0-2.81-1.14-7.46-8.69-7.46-4.21,0-8.6,1.32-11.5,3.16l-2.11-7.02c3.16-1.93,8.69-3.77,15.44-3.77,13.69,0,17.64,8.69,17.64,17.99v15.44c0,3.86.18,7.63.61,10.27h-9.74ZM553.5,409.71c-7.63-.18-14.92,1.49-14.92,7.99,0,4.21,2.72,6.14,6.14,6.14,4.3,0,7.46-2.81,8.42-5.88.26-.79.35-1.67.35-2.37v-5.88Z"/>
</svg>`;
const PRINT_LOGO_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PRINT_LOGO_SVG)}`;

const SOURCE_COLORS = {
  news: '#F5C518',
  facebook: '#3B82F6',
  instagram: '#E1306C',
  tiktok: '#69C9D0',
  twitter: '#1DA1F2',
  other: '#94A3B8',
};

const SOCIAL_SOURCE_TYPES = new Set(['facebook', 'instagram', 'tiktok', 'twitter']);

function formatSourceLabel(source) {
  if (source === 'All') return 'All';
  if (source === 'Social') return 'Social';
  const labels = {
    news: 'News',
    facebook: 'Facebook',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    twitter: 'Twitter',
    other: 'Other',
  };
  return labels[source] ?? String(source || 'Other').replace(/\b\w/g, (c) => c.toUpperCase());
}

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

const HIDDEN_ROADMAP_METRIC_PATTERNS = [
  /\bVVE\b/i,
  /Visibility Value Equivalent/i,
  /Visibility Intelligence/i,
  /Calculated VVE/i,
  /Visibility Type/i,
  /VVE Role/i,
  /Earned Share/i,
  /Total VVE/i,
  /Earned[-\s]?only VVE/i,
];

function isHiddenRoadmapMetricLine(line) {
  return HIDDEN_ROADMAP_METRIC_PATTERNS.some((pattern) => pattern.test(line));
}

function isRecommendationHeading(line) {
  return /^\s*(#{1,3}\s+|\*\*[^*]+\*\*\s*$)/.test(line);
}

function isHiddenRoadmapMetricHeading(line) {
  const normalized = line
    .replace(/^\s*#{1,3}\s+/, '')
    .replace(/^\s*\*\*/, '')
    .replace(/\*\*\s*$/, '')
    .trim();
  return isHiddenRoadmapMetricLine(normalized);
}

function sanitizeRecommendationText(text) {
  if (!text) return text;

  const lines = text.split('\n');
  const kept = [];
  let skippingRoadmapSection = false;

  lines.forEach((line) => {
    if (isHiddenRoadmapMetricHeading(line)) {
      skippingRoadmapSection = true;
      return;
    }

    if (skippingRoadmapSection) {
      if (isRecommendationHeading(line)) {
        skippingRoadmapSection = false;
      } else {
        return;
      }
    }

    if (isHiddenRoadmapMetricLine(line)) return;
    kept.push(line);
  });

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

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
  // Arc circumference: π × r = π × 80 ≈ 251.33
  const C = Math.PI * 80;
  const d = 'M 20 100 A 80 80 0 0 1 180 100';

  // Compute strokeDasharray/strokeDashoffset for a zone segment s1→s2
  function zoneStroke(s1, s2) {
    const segLen = C * (s2 - s1) / 10;
    return { strokeDasharray: `${segLen} ${C}`, strokeDashoffset: -(C * s1 / 10) };
  }

  const progressLen = C * nScore / 10;

  let fillColor = '#EF4444';           // 0–3  red
  if (nScore >= 3) fillColor = '#F5C518'; // 3–7  yellow
  if (nScore >= 7) fillColor = '#22C55E'; // 7–10 green

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '4px' }}>
      {/*
        viewBox 0 0 200 120:
          Arc center at y=100, r=80 → top of arc at y=20, outer edge at y=11.
          "Low"/"High" labels sit below the arc ends at y=116.
          Score text baseline at y=96, "AVG SCORE" at y=110.
      */}
      <svg viewBox="0 0 200 120" style={{ width: '100%', maxWidth: '180px', overflow: 'visible' }}>
        {/* Gray base track */}
        <path d={d} fill="none" stroke="#1E2D40" strokeWidth="18" strokeLinecap="round" />

        {/* Dim zone tints — show threshold bands even when score = 0 */}
        <path d={d} fill="none" stroke="#EF4444" strokeWidth="16" strokeLinecap="butt" opacity="0.22" {...zoneStroke(0, 3)} />
        <path d={d} fill="none" stroke="#F5C518" strokeWidth="16" strokeLinecap="butt" opacity="0.22" {...zoneStroke(3, 7)} />
        <path d={d} fill="none" stroke="#22C55E" strokeWidth="16" strokeLinecap="butt" opacity="0.22" {...zoneStroke(7, 10)} />

        {/* Progress fill up to current score */}
        {nScore > 0 && (
          <path
            d={d}
            fill="none"
            stroke={fillColor}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${progressLen} ${C}`}
            strokeDashoffset={0}
            style={{ transition: 'stroke-dasharray 1s ease-out, stroke 1s ease' }}
          />
        )}

        {/*
          Threshold separator ticks at score=3 and score=7.
          score=3: θ=126°  inner(r=72)→(57.7,41.8)  outer(r=89)→(47.7,28.0)
          score=7: θ=54°   inner(r=72)→(142.3,41.8)  outer(r=89)→(152.3,28.0)
        */}
        <line x1="57.7"  y1="41.8" x2="47.7"  y2="28.0" stroke="#94A3B8" strokeWidth="1.5" opacity="0.55" />
        <line x1="142.3" y1="41.8" x2="152.3" y2="28.0" stroke="#94A3B8" strokeWidth="1.5" opacity="0.55" />

        {/* Zone labels */}
        <text x="14"  y="116" textAnchor="middle" fill="#EF4444" fontSize="8" fontWeight="700" opacity="0.75">Low</text>
        <text x="100" y="9"   textAnchor="middle" fill="#F5C518" fontSize="8" fontWeight="700" opacity="0.75">Avg</text>
        <text x="186" y="116" textAnchor="middle" fill="#22C55E" fontSize="8" fontWeight="700" opacity="0.75">High</text>

        {/* Score value */}
        <text
          x="100" y="96"
          textAnchor="middle" dominantBaseline="auto"
          fill={fillColor} fontSize="30" fontWeight="800"
          style={{ transition: 'fill 1s ease' }}
        >
          {score}
        </text>
      </svg>
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

function QueriesView({ initialQueries, districts, userDistrictId, demoMode = false }) {
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
    if (demoMode) return;
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
    if (demoMode) return;
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
          {demoMode ? (
            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', fontWeight: 600 }}>Demo</span>
          ) : (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => handleDelete(q.id)}
              disabled={deletingId === q.id}
              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            >
              {deletingId === q.id ? '…' : 'Delete'}
            </button>
          )}
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
            {!demoMode && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowAddForm((o) => !o)}
              >
                {showAddForm ? '✕ Cancel' : '+ Add Query'}
              </button>
            )}
          </div>
        </div>

        {/* Add Query Form */}
        {!demoMode && showAddForm && (
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

function HowItWorksView() {
  return (
    <div className="data-section" style={{ maxWidth: '860px' }}>
      <div className="data-header">
        <h3>▶ How This Works</h3>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Platform walkthrough</span>
      </div>
      <div style={{ padding: '28px' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px', lineHeight: 1.6 }}>
          Watch this short walkthrough to understand how Canary monitors media, interprets Canary Scores, and surfaces the insights most relevant to your district.
        </p>
        {/* Responsive 16:9 Loom embed */}
        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: '#0B1120' }}>
          <iframe
            src="https://www.loom.com/embed/e3a252bc1c0b4b258e5412720aa301b7"
            frameBorder="0"
            webkitallowfullscreen="true"
            mozallowfullscreen="true"
            allowFullScreen
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}

function SettingsView({ userDistrictId, districts }) {
  const [issue, setIssue] = useState('');
  const [isPending, startSupportTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [supportError, setSupportError] = useState(null);

  const handleLogout = async () => {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = '/login';
    } catch {}
  };

  function handleSupportSubmit(e) {
    e.preventDefault();
    setSupportError(null);
    const fd = new FormData();
    fd.append('message', issue);
    fd.append('district_id', userDistrictId || '');
    fd.append('district_name', districts?.find((d) => d.id === userDistrictId)?.name ?? '');
    startSupportTransition(async () => {
      try {
        await submitFeedback(fd);
        setSubmitted(true);
        setIssue('');
      } catch (err) {
        setSupportError(err.message || 'Something went wrong. Please try again.');
      }
    });
  }

  return (
    <div className="data-section">
      <div className="data-header">
        <h3>⚙️ Settings</h3>
      </div>

      {/* Profile */}
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

        <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--border-secondary)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleLogout} className="btn btn-danger">
            Sign Out
          </button>
        </div>
      </div>

      {/* Contact Support */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-secondary)', borderRadius: 'var(--radius-lg)', padding: '32px', maxWidth: '800px' }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '1.2rem' }}>Need Help?</h4>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px', lineHeight: 1.6 }}>
          Contact support by describing your issue below. Our team will follow up within 24–48 business hours.
        </p>

        {submitted ? (
          <div style={{
            background: '#22C55E15',
            border: '1px solid #22C55E40',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            color: '#22C55E',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>✓</span>
            Your issue has been received. Someone will reach back within 24–48 business hours.
          </div>
        ) : (
          <form onSubmit={handleSupportSubmit}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px' }}>
                Describe your issue
              </label>
              <textarea
                className="form-textarea"
                placeholder="What do you need help with?"
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                rows={5}
                required
                style={{ width: '100%' }}
              />
            </div>
            {supportError && (
              <p style={{ color: 'var(--status-negative)', fontSize: '0.82rem', marginBottom: '12px' }}>{supportError}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isPending || !issue.trim()}
              >
                {isPending ? <span className="spinner" style={{ margin: '0 auto' }} /> : 'Submit Request'}
              </button>
            </div>
          </form>
        )}
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

function renderRecMarkdown(text) {
  const lines = text.split('\n');
  const elements = [];
  let listBuffer = [];

  function flushList() {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} style={{ margin: '4px 0 8px 16px', padding: 0, listStyle: 'disc' }}>
          {listBuffer.map((item, i) => <li key={i} style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>{item}</li>)}
        </ul>
      );
      listBuffer = [];
    }
  }

  function renderInline(str) {
    const parts = str.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : part
    );
  }

  lines.forEach((line, i) => {
    const boldHeading = line.match(/^\s*\*\*([^*]+)\*\*\s*$/);
    if (line.startsWith('## ') || boldHeading) {
      flushList();
      elements.push(
        <div key={i} style={{ marginTop: elements.length > 0 ? '14px' : 0, marginBottom: '4px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--canary-yellow)', borderBottom: '1px solid var(--border-primary)', paddingBottom: '3px' }}>
          {boldHeading ? boldHeading[1] : line.slice(3)}
        </div>
      );
    } else if (line.startsWith('- ')) {
      listBuffer.push(renderInline(line.slice(2)));
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={i} style={{ margin: '2px 0', fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>
          {renderInline(line)}
        </p>
      );
    }
  });
  flushList();
  return elements;
}

function RecommendationText({ text }) {
  const [open, setOpen] = useState(false);
  const visibleText = sanitizeRecommendationText(text);
  if (!visibleText) return <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span>;

  const hasMarkdown = /^\s*(##\s+|\*\*[^*]+\*\*\s*$)/m.test(visibleText);
  const preview = hasMarkdown
    ? visibleText
        .replace(/##\s+[^\n]+/g, '')
        .replace(/^\s*\*\*[^*]+\*\*\s*$/gm, '')
        .replace(/\n+/g, ' ')
        .trim()
        .slice(0, 110)
    : visibleText.slice(0, 110);

  return (
    <>
      <div className="summary-text">{preview}{preview.length >= 110 ? '…' : ''}</div>
      <button className="expand-btn" onClick={() => setOpen(true)}>Show more</button>
      {open && (
        <div className="expand-overlay" onClick={() => setOpen(false)}>
          <div className="expand-popover" style={{ maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            {hasMarkdown
              ? <div>{renderRecMarkdown(visibleText)}</div>
              : <p className="expand-body">{visibleText}</p>
            }
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

function ScoreRangeFilter({ min, max, onChange }) {
  const SCORE_MIN = 1;
  const SCORE_MAX = 10;
  const pct = (v) => ((v - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 100;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span className="filter-group-label">Score</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div className="score-range-slider">
          <div className="score-range-track">
            <div className="score-range-fill" style={{ left: `${pct(min)}%`, right: `${100 - pct(max)}%` }} />
          </div>
          <input
            type="range" min={SCORE_MIN} max={SCORE_MAX} step="0.5" value={min}
            onChange={(e) => onChange(Math.min(parseFloat(e.target.value), max - 0.5), max)}
          />
          <input
            type="range" min={SCORE_MIN} max={SCORE_MAX} step="0.5" value={max}
            onChange={(e) => onChange(min, Math.max(parseFloat(e.target.value), min + 0.5))}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--canary-yellow)', fontWeight: 700 }}>
          <span>{min.toFixed(1)}</span>
          <span>{max.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

function QueryMultiSelect({ allQueries, selectedQueries, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const count = selectedQueries.size;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)}>
        🔍 {count === 0 ? 'All Queries' : `${count} Quer${count === 1 ? 'y' : 'ies'}`}
      </button>
      {open && (
        <div className="query-multiselect-dropdown">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span className="filter-group-label">Filter by Query</span>
            {count > 0 && (
              <button
                className="btn btn-ghost"
                style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                onClick={() => onChange(new Set())}
              >
                Clear
              </button>
            )}
          </div>
          {allQueries.length === 0 ? (
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', fontStyle: 'italic' }}>No queries found</p>
          ) : (
            allQueries.map((q) => (
              <label key={q} className="query-multiselect-item">
                <input
                  type="checkbox"
                  checked={selectedQueries.has(q)}
                  onChange={(e) => {
                    const next = new Set(selectedQueries);
                    if (e.target.checked) next.add(q);
                    else next.delete(q);
                    onChange(next);
                  }}
                  style={{ accentColor: 'var(--canary-yellow)', width: '14px', height: '14px', flexShrink: 0 }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{q}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardClient({ articles, districts, queries: initialQueries, clients = [], userDistrictId, demoMode = false }) {
  const [currentView, setCurrentView] = useState('dashboard');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [districtFilter, setDistrictFilter] = useState(userDistrictId ?? 'All');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [scoreMin, setScoreMin] = useState(1);
  const [scoreMax, setScoreMax] = useState(10);
  const [selectedQueries, setSelectedQueries] = useState(new Set());
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
      if (!demoMode) await saveNote(noteModal.id, noteText);
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
    if (demoMode) return;
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
    const sources = Array.from(s).sort();
    const hasSocial = sources.some((source) => SOCIAL_SOURCE_TYPES.has(source));
    return ['All', ...(hasSocial ? ['Social'] : []), ...sources];
  }, [articles]);

  const allSourceQueries = useMemo(() => {
    const qs = new Set();
    articles.forEach((a) => { if (a.source_query) qs.add(a.source_query); });
    return Array.from(qs).sort();
  }, [articles]);

  const hasSecondaryFilters = dateStart || dateEnd || scoreMin !== 1 || scoreMax !== 10 || selectedQueries.size > 0;

  function clearSecondaryFilters() {
    setDateStart('');
    setDateEnd('');
    setScoreMin(1);
    setScoreMax(10);
    setSelectedQueries(new Set());
  }

  function handleExportPdf() {
    setCurrentView('dashboard');
    setColMenuOpen(false);
    setFeedbackOpen(false);

    // Let React finish switching back to the dashboard and give print-only
    // assets a moment to paint before opening the browser print dialog.
    window.setTimeout(() => window.print(), 250);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return articles.filter((a) => {
      const matchSearch =
        !search ||
        a.headline?.toLowerCase().includes(q) ||
        a.summary?.toLowerCase().includes(q);
      const articleSource = a.source_type ?? 'other';
      const matchSource =
        sourceFilter === 'All' ||
        articleSource === sourceFilter ||
        (sourceFilter === 'Social' && SOCIAL_SOURCE_TYPES.has(articleSource));
      const matchTag =
        tagFilter === 'All' ||
        (Array.isArray(a.tags) && a.tags.includes(tagFilter));
      const matchDistrict =
        districtFilter === 'All' || a.district_id === districtFilter;
      const matchDateStart = !dateStart || a.date >= dateStart;
      const matchDateEnd = !dateEnd || a.date <= dateEnd;
      const score = parseFloat(a.canary_score ?? 0);
      const matchScore = score >= scoreMin && score <= scoreMax;
      const matchQuery =
        selectedQueries.size === 0 ||
        (a.source_query && selectedQueries.has(a.source_query));
      return matchSearch && matchSource && matchTag && matchDistrict && matchDateStart && matchDateEnd && matchScore && matchQuery;
    });
  }, [articles, search, sourceFilter, tagFilter, districtFilter, dateStart, dateEnd, scoreMin, scoreMax, selectedQueries]);

  // Keep KPI/charts aligned with the visible article table. This prevents cases
  // where a filtered table shows only TikTok rows but the source wheel still
  // reflects the broader district/all-article set.
  const chartArticles = filtered;

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
              className={`sidebar-link ${currentView === 'howto' ? 'active' : ''}`}
              onClick={() => setCurrentView('howto')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">▶️</span>
              How This Works
            </button>
            <button
              className={`sidebar-link ${currentView === 'articles' ? 'active' : ''}`}
              onClick={() => setCurrentView('articles')}
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
            {!demoMode && (
              <button
                className={`sidebar-link ${currentView === 'settings' ? 'active' : ''}`}
                onClick={() => setCurrentView('settings')}
                style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
              >
                <span className="sidebar-link-icon">⚙️</span>
                Settings
              </button>
            )}
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">C</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{demoMode ? 'Demo Account' : 'Canary Admin'}</div>
              <div className="sidebar-user-email">{demoMode ? 'Fictional demo data' : `${districts.length} districts`}</div>
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
                        : currentView === 'howto'
                          ? 'How This Works'
                          : currentView === 'articles'
                            ? 'Media Articles'
                            : districtFilter === 'All'
                              ? 'All Districts'
                            : formatDistrictName(districtFilter)}
              </div>
              <div className="topbar-breadcrumb">
                {currentView === 'queries' ? 'Manage monitored search terms'
                  : currentView === 'settings' ? 'Manage your account and preferences'
                  : currentView === 'notes' ? 'Articles with analyst annotations'
                  : currentView === 'clients' ? 'Login credentials for beta testers'
                  : currentView === 'howto' ? 'Platform walkthrough video'
                  : currentView === 'articles' ? 'Browse, filter, annotate, and export article-level coverage'
                  : 'Media Intelligence Dashboard'}
              </div>
            </div>
          </div>
          <div className="topbar-right">
            {currentView === 'dashboard' && (
              <button
                className="btn btn-secondary btn-sm export-pdf-btn"
                onClick={handleExportPdf}
                title="For the cleanest report, choose Tabloid / 11×17 and Landscape in the print dialog."
              >
                ⬇ Export PDF
                <span className="export-pdf-hint">Tabloid landscape works best</span>
              </button>
            )}
            <button className="feedback-btn" onClick={() => setFeedbackOpen(true)}>
              💬 Feedback
            </button>
          </div>
        </header>

        <main className="page-content">
          {demoMode && (
            <div className="demo-mode-banner">
              <strong>Interactive demo:</strong> sample public-media intelligence for Canary Falls Unified School District. Filters, Social aggregation, columns, notes, feedback, and PDF export are enabled; changes stay in this browser session.
            </div>
          )}
          {currentView === 'clients' && <ClientsView clients={clients} />}
          {currentView === 'settings' && <SettingsView userDistrictId={userDistrictId} districts={districts} />}
          {currentView === 'howto' && <HowItWorksView />}
          {currentView === 'queries' && (
            <QueriesView
              initialQueries={initialQueries}
              districts={districts}
              userDistrictId={userDistrictId}
              demoMode={demoMode}
            />
          )}
          {currentView === 'notes' && (
            <NotesView
              articles={articles}
              getNoteText={getNoteText}
              openNoteModal={openNoteModal}
            />
          )}
          {(currentView === 'dashboard' || currentView === 'articles') && (<>
          <div className="print-report-header">
            <div>
              <h1>{districtFilter === 'All' ? 'All Districts' : formatDistrictName(districtFilter)} Media Intelligence Dashboard</h1>
              <p>
                Exported {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                {' · '}{filtered.length} visible articles
                {dateStart || dateEnd ? ` · Date: ${dateStart || 'Any'}–${dateEnd || 'Any'}` : ''}
                {sourceFilter !== 'All' ? ` · Source: ${sourceFilter}` : ''}
                {tagFilter !== 'All' ? ` · Tag: ${tagFilter}` : ''}
              </p>
            </div>
            <div className="print-report-logo">
              {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI is intentional so browser PDF export cannot drop a hidden Next/Image asset. */}
              <img src={PRINT_LOGO_SRC} alt="Canary Data" width={178} height={40} style={{ height: '40px', width: 'auto' }} />
            </div>
          </div>
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
              <ScoreGauge score={avgScore} />
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

          </div>
          </>)}

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
                  {allSources.map((s) => <option key={s} value={s}>{formatSourceLabel(s)}</option>)}
                </select>
                <select className="filter-select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                  {allTags.map((t) => <option key={t}>{t}</option>)}
                </select>
                {!demoMode && districtFilter !== 'All' && (
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

            {/* Secondary filter bar — date, score, query */}
            <div className="filter-secondary-bar">
              {/* Date range */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="filter-group-label">Date</span>
                <input
                  type="date"
                  className="filter-date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                />
                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>–</span>
                <input
                  type="date"
                  className="filter-date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                />
              </div>

              {/* Canary score slider */}
              <ScoreRangeFilter
                min={scoreMin}
                max={scoreMax}
                onChange={(min, max) => { setScoreMin(min); setScoreMax(max); }}
              />

              {/* Query multi-select */}
              <QueryMultiSelect
                allQueries={allSourceQueries}
                selectedQueries={selectedQueries}
                onChange={setSelectedQueries}
              />

              {/* Clear all secondary filters */}
              {hasSecondaryFilters && (
                <button className="btn btn-ghost btn-sm" onClick={clearSecondaryFilters}>
                  ✕ Clear filters
                </button>
              )}
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
                    {col('score')             && <th className="score-column">Score<InfoTooltip text={SCORE_TOOLTIP} /></th>}
                    {col('innovation_reason') && <th>Innovation</th>}
                    {col('recommendation')    && <th>Recommendation</th>}
                    {col('earned_media')      && <th>Earned Media</th>}
                    {col('notes')             && <th>Notes</th>}
                    {col('query')             && <th>Source Query</th>}
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
                            {formatSourceLabel(article.source_type ?? 'other')}
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
                        <td className="score-column">
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
                          <RecommendationText text={article.recommendation} />
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
                        <td className="summary-cell">
                          {getNoteText(article)
                            ? <>
                                <ExpandableText text={getNoteText(article)} />
                                <button
                                  className="expand-btn"
                                  style={{ marginTop: '6px', opacity: 0.6 }}
                                  onClick={() => openNoteModal(article)}
                                >
                                  Edit note
                                </button>
                              </>
                            : <button
                                className={`note-indicator`}
                                onClick={() => openNoteModal(article)}
                              >
                                📝 Add note
                              </button>
                          }
                        </td>
                      )}

                      {/* Source Query */}
                      {col('query') && (
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '180px' }}>
                          {article.source_query
                            ? <span style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-full)',
                                background: 'var(--bg-elevated)',
                                color: 'var(--text-secondary)',
                                fontSize: '0.72rem',
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: '170px',
                              }}>
                                {article.source_query}
                              </span>
                            : <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span>
                          }
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
          districtId={userDistrictId || (demoMode ? districtFilter : '')}
          districtName={userDistrictId ? districts.find((d) => d.id === userDistrictId)?.name : (demoMode ? 'Canary Falls Unified School District' : null)}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </div>
  );
}
