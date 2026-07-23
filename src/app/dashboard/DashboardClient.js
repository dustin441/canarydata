'use client';

import { useState, useMemo, useEffect, useRef, useTransition, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { loadStripe } from '@stripe/stripe-js';
import { setEarnedMedia, saveNote, addQuery, deleteQuery, submitFeedback, addManualStory, excludeStory, restoreStory } from '@/app/actions';
import { createEmbeddedCanaryCheckout, confirmEmbeddedCanaryCheckout, saveBillingPurchaseOrder } from '@/app/payment/actions';
import { compareStrategicAlignmentRows } from '@/lib/strategicAlignmentSort.mjs';
import { CORE_TAGS, canonicalTags } from '@/lib/canonicalTags.mjs';
import { buildSocialResults, calculateSocialEngagementRate, rankTopSocialResults, resolveSocialFollowerCount, safeSocialMediaUrl, safeSocialUrl, socialActionFilterMatches, socialDateFilterMatches, socialRelationshipFilterMatches, summarizeSocialActions, summarizeSocialResults } from '@/lib/social.mjs';
import { formatDisplayDate } from '@/lib/date.mjs';
import { buildCommunicationsBrief, formatCommunicationsBriefRecommendation } from '@/lib/communicationsBrief.mjs';
import { buildStrategicGovernance } from '@/lib/strategicGovernance.mjs';

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

const ALL_COLUMNS = [
  { id: 'date',               label: 'Date',               required: true  },
  { id: 'headline',           label: 'Headline',           required: true  },
  { id: 'summary',            label: 'Summary',            defaultOn: true },
  { id: 'link',               label: 'Link',               defaultOn: true },
  { id: 'source',             label: 'Source',             defaultOn: true },
  { id: 'tags',               label: 'Tags',               defaultOn: true },
  { id: 'score',              label: 'Score',              defaultOn: true },
  { id: 'innovation_reason',  label: 'Strategic Alignment', defaultOn: true  },
  { id: 'recommendation',     label: 'Recommendation',     defaultOn: true  },
  { id: 'earned_media',       label: 'Earned Media',       defaultOn: true },
  { id: 'notes',              label: 'Notes',              defaultOn: true },
  { id: 'query',              label: 'Source Query',       defaultOn: false },
];

const DEFAULT_VISIBLE = new Set(
  ALL_COLUMNS.filter((c) => c.required || c.defaultOn).map((c) => c.id)
);
const COLUMN_PREFS_KEY = 'canary_columns_v3';
const LEGACY_COLUMN_PREFS_KEY = 'canary_columns_v2';
import {
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell, BarChart, Bar,
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

const DEMO_TESTIMONIALS = [
  {
    quote: 'I am sold. I think it’s amazing. I really like that it gives you a starting point.',
    name: 'Nicole Wheeler',
    role: 'School communicator, Alabama',
  },
  {
    quote: 'Had I had this tool during an employee crisis, the recommendations would have been spot on and perfect for me to have used at the time.',
    name: 'Cindy Warner',
    role: 'School communicator, Alabama',
  },
  {
    quote: 'This just seems like such a game changer for me. It is so much more in depth.',
    name: 'Merrick Wilson',
    role: 'School communicator, Alabama',
  },
];

const SOCIAL_SOURCE_TYPES = new Set(['facebook', 'instagram', 'tiktok', 'twitter', 'x', 'youtube', 'threads', 'linkedin']);

function formatSocialMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number).toLocaleString('en-US') : '0';
}

function formatAvailableSocialMetric(result, metric, value) {
  return result?.metricAvailability?.[metric] ? formatSocialMetric(value) : 'N/A';
}

function proxiedSocialMediaUrl(value) {
  const safeUrl = safeSocialMediaUrl(value);
  return safeUrl ? `/api/social-media?url=${encodeURIComponent(safeUrl)}` : '';
}

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

function normalizeEscapedRecommendationText(text) {
  if (!text) return text;
  return String(text)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\N/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    // Multi-alignment output like "**A | B | C** – explanation" was hard to scan;
    // split the focus areas onto their own bold lines while keeping the explanation.
    .replace(/^\s*\*\*([^*\n]+\s\|\s[^*\n]+)\*\*\s*[–-]\s*/gm, (_, labels) => {
      const labelLines = labels
        .split('|')
        .map((label) => label.trim())
        .filter(Boolean)
        .map((label) => `**${label}**`)
        .join('\n');
      return `${labelLines}\n`;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeExternalHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function externalSourceLabel(value, fallback = 'Source') {
  try {
    return new URL(value).hostname.replace(/^www\./, '') || fallback;
  } catch {
    return fallback;
  }
}

function sanitizeRecommendationText(text) {
  if (!text) return text;

  const normalizedText = normalizeEscapedRecommendationText(text);
  const lines = normalizedText.split('\n');
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

const formatDate = formatDisplayDate;

function formatDistrictName(id) {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function extractStrategicAlignmentLabels(text) {
  if (!text || text === 'N/A') return [];
  const normalized = normalizeEscapedRecommendationText(text);
  const labels = [];

  // Strategic Alignment output stores approved labels in bold and the supporting
  // explanation as plain text. Multi-label reasons are normalized onto separate
  // bold lines, so parsing every unbolded line would incorrectly turn explanation
  // sentences (for example, "The fabrication lab at Cabrillo Middle...") into
  // chart/filter focus areas. Prefer bold labels across the entire value; retain a
  // first-line fallback only for older rows that predate the bold-label format.
  const boldMatches = [...normalized.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
  const candidates = boldMatches.length
    ? boldMatches
    : [normalized.split('\n')[0].split(/[–-]/)[0]];

  candidates.forEach((candidate) => {
    candidate
      .split('|')
      .map((part) => part.replace(/^#+\s*/, '').replace(/[*:]/g, '').trim())
      .filter(Boolean)
      .filter((label) => label.length <= 120)
      .filter((label) => !isHiddenRoadmapMetricLine(label))
      .filter((label) => !/^(strategic alignment|visibility intelligence|n\/a)$/i.test(label))
      .forEach((label) => labels.push(label));
  });

  return [...new Set(labels)];
}

function buildStrategicAlignmentData(articles) {
  const counts = new Map();
  articles.forEach((article) => {
    extractStrategicAlignmentLabels(article.innovation_reason).forEach((label) => {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort(compareStrategicAlignmentRows);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join('; ') : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
function articleCsvValue(article, columnId, { isEarned, getNoteText } = {}) {
  switch (columnId) {
    case 'date': return article.date || '';
    case 'headline': return article.headline || '';
    case 'summary': return article.summary || '';
    case 'link': return article.link || '';
    case 'source': return article.source || formatSourceLabel(article.source_type ?? 'other');
    case 'tags': return canonicalTags(article.tags).join('; ');
    case 'score': return article.canary_score ?? '';
    case 'innovation_reason': return extractStrategicAlignmentLabels(article.innovation_reason).join('; ');
    case 'recommendation': return normalizeEscapedRecommendationText(article.recommendation || '');
    case 'earned_media': return isEarned?.(article) ? 'Yes' : 'No';
    case 'notes': return getNoteText ? (getNoteText(article) || '') : (article.notes || '');
    case 'query': return article.source_query || '';
    default: return '';
  }
}

function articleCsvRow(article, columns, helpers = {}) {
  return columns.map((column) => articleCsvValue(article, column.id, helpers));
}

const BIRD_EYE_CSV_COLUMNS = ALL_COLUMNS.filter((column) =>
  ['date', 'headline', 'summary', 'link', 'source', 'tags', 'score', 'innovation_reason', 'earned_media'].includes(column.id)
);

function StrategicAlignmentPills({ labels, selectedLabel, onSelect, max = 3 }) {
  const visible = labels.slice(0, max);
  if (!visible.length) return <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
      {visible.map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => onSelect(label)}
          title={`Filter to ${label}`}
          style={{
            border: selectedLabel === label ? '1px solid var(--canary-yellow)' : '1px solid var(--border-secondary)',
            background: selectedLabel === label ? 'rgba(245,197,24,0.14)' : 'var(--bg-elevated)',
            color: selectedLabel === label ? 'var(--canary-yellow)' : 'var(--text-secondary)',
            borderRadius: '999px',
            padding: '3px 8px',
            fontSize: '0.68rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
      {labels.length > max && (
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.7rem', alignSelf: 'center' }}>+{labels.length - max}</span>
      )}
    </div>
  );
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
          Sentiment labels sit below the arc ends and above the neutral midpoint.
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
        <text x="14"  y="116" textAnchor="middle" fill="#EF4444" fontSize="7.5" fontWeight="700" opacity="0.75">Concern</text>
        <text x="100" y="9"   textAnchor="middle" fill="#F5C518" fontSize="7.5" fontWeight="700" opacity="0.75">Neutral</text>
        <text x="186" y="116" textAnchor="middle" fill="#22C55E" fontSize="7.5" fontWeight="700" opacity="0.75">Positive</text>

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
      name: formatSourceLabel(name),
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

function QueriesView({ initialQueries, districts, userDistrictId, selectedDistrictId = 'All', onDistrictChange, demoMode = false }) {
  const [queries, setQueries] = useState(initialQueries);
  const districtFilter = userDistrictId ?? selectedDistrictId ?? 'All';
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    query_text: '',
    channels: 'news',
    district_id: userDistrictId ?? (selectedDistrictId !== 'All' ? selectedDistrictId : ''),
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
      setForm({ query_text: '', channels: 'news', district_id: userDistrictId ?? (districtFilter !== 'All' ? districtFilter : ''), geo_city: '', geo_state: '', geo_zip: '' });
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
                onChange={(e) => onDistrictChange?.(e.target.value)}
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
                placeholder="Query text (e.g. Canary Falls Unified budget)"
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
  const [noteSearch, setNoteSearch] = useState('');
  const noted = articles.filter((a) => getNoteText(a));
  const q = noteSearch.trim().toLowerCase();
  const visibleNotes = !q
    ? noted
    : noted.filter((a) => [a.headline, a.summary, getNoteText(a), a.innovation_reason, a.recommendation]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)));

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
        <h3>📝 Analyst Notes <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', fontWeight: 400 }}>({visibleNotes.length} of {noted.length})</span></h3>
        <input
          className="filter-input"
          placeholder="Search notes, headlines, or training examples..."
          value={noteSearch}
          onChange={(e) => setNoteSearch(e.target.value)}
          style={{ maxWidth: '360px' }}
        />
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
            {visibleNotes.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className="empty-state">
                    <div className="empty-state-icon">🔍</div>
                    <h3>No matching notes</h3>
                    <p>Try another keyword like training, crisis, board, or alignment.</p>
                  </div>
                </td>
              </tr>
            ) : visibleNotes.map((a) => (
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

function StrategicGovernancePanel({ governance, hasSelectedDistrict }) {
  if (!governance) {
    return (
      <section className="strategic-governance-card needs-review" aria-label="Strategic Alignment basis">
        <div>
          <span>Strategic Alignment basis</span>
          <h4>{hasSelectedDistrict ? 'Source profile needs review' : 'Select a district to see its alignment basis'}</h4>
        </div>
        <p>{hasSelectedDistrict ? 'Canary does not have a reviewed strategic profile for this district yet.' : 'District-level mission, priorities, review dates, and sources appear here.'}</p>
      </section>
    );
  }

  const confidenceLabel = governance.confidence === 'high'
    ? 'High-confidence sources'
    : governance.confidence === 'medium'
      ? 'Medium-confidence sources'
      : governance.confidence === 'low'
        ? 'Low-confidence sources'
        : 'Needs source review';

  return (
    <details className={`strategic-governance-card confidence-${governance.confidence}`}>
      <summary>
        <div>
          <span>Strategic Alignment basis</span>
          <h4>{confidenceLabel}</h4>
        </div>
        <div className="strategic-governance-summary-metrics">
          <div><strong>{governance.priorityCount}</strong><span>Active priorities</span></div>
          <div><strong>{governance.sourceCount}</strong><span>Source documents</span></div>
          <div><strong>{governance.lastReviewedAt ? formatDate(governance.lastReviewedAt) : 'Not recorded'}</strong><span>Last reviewed</span></div>
        </div>
        <span className="strategic-governance-expand">View basis</span>
      </summary>
      <div className="strategic-governance-details">
        {(governance.mission || governance.vision) && (
          <div className="strategic-governance-statements">
            {governance.mission && <div><span>Mission</span><p>{governance.mission}</p></div>}
            {governance.vision && <div><span>Vision</span><p>{governance.vision}</p></div>}
          </div>
        )}
        <div>
          <span className="strategic-governance-section-label">Active priorities used for alignment</span>
          <div className="strategic-governance-priorities">
            {governance.priorities.length > 0
              ? governance.priorities.map((priority) => <span key={priority.id || priority.label}>{priority.label}</span>)
              : <p>No active priorities are configured.</p>}
          </div>
        </div>
        <div>
          <span className="strategic-governance-section-label">Source documents</span>
          <div className="strategic-governance-sources">
            {governance.sourceUrls.length > 0
              ? governance.sourceUrls.map((url, index) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer">{externalSourceLabel(url, `Source ${index + 1}`)} ↗</a>
                ))
              : <p>No public source links are recorded.</p>}
          </div>
        </div>
      </div>
    </details>
  );
}

function BirdEyeView({ articles, strategicAlignmentData, strategicGovernance, hasSelectedDistrict, selectedLabel, onSelectLabel, isEarned, dateStart, dateEnd, setDateStart, setDateEnd, onExportPdf }) {
  const highlightedArticles = selectedLabel === 'All'
    ? articles.filter((article) => extractStrategicAlignmentLabels(article.innovation_reason).length > 0)
    : articles.filter((article) => extractStrategicAlignmentLabels(article.innovation_reason).includes(selectedLabel));
  const totalMentions = articles.length;
  const strategicHitCount = highlightedArticles.length;
  const earnedCount = highlightedArticles.filter((article) => isEarned(article)).length;
  const percent = (count, total = totalMentions) => total ? `${Math.round((count / total) * 100)}%` : '0%';

  function exportBirdEyeCsv() {
    downloadCsv(
      `canary-birdseye-${new Date().toISOString().slice(0, 10)}.csv`,
      BIRD_EYE_CSV_COLUMNS.map((column) => column.label),
      highlightedArticles.map((article) => articleCsvRow(article, BIRD_EYE_CSV_COLUMNS, { isEarned }))
    );
  }

  return (
    <div className="data-section">
      <div className="data-header">
        <div>
          <h3>🦅 Bird’s Eye View <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', fontWeight: 400 }}>({highlightedArticles.length} aligned articles)</span></h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginTop: '6px' }}>
            Executive Strategic Alignment report for superintendent, cabinet, board, district accreditation, and evaluation conversations.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
          {selectedLabel !== 'All' && (
            <button className="btn btn-secondary btn-sm" onClick={() => onSelectLabel('All')}>
              {selectedLabel} ✕
            </button>
          )}
          <button className="btn btn-secondary btn-sm" type="button" onClick={exportBirdEyeCsv}>⬇ Export CSV</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onExportPdf}>⬇ Export PDF</button>
        </div>
      </div>

      <StrategicGovernancePanel governance={strategicGovernance} hasSelectedDistrict={hasSelectedDistrict} />

      <div className="filter-secondary-bar" style={{ marginTop: 0, marginBottom: '18px' }}>
        <div className="filter-control-group date-filter-group">
          <span className="filter-group-label">Report Date Range</span>
          <input type="date" className="filter-date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>–</span>
          <input type="date" className="filter-date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          {(dateStart || dateEnd) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDateStart(''); setDateEnd(''); }}>
              Clear dates
            </button>
          )}
        </div>
      </div>

      <div style={{
        marginBottom: '18px',
        padding: '18px 20px',
        border: '1px solid rgba(245,197,24,0.28)',
        borderRadius: 'var(--radius-lg)',
        background: 'linear-gradient(135deg, rgba(245,197,24,0.12), rgba(15,42,68,0.32))',
      }}>
        <div style={{ color: 'var(--canary-yellow)', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}>
          Leadership-ready evidence
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
          Communication, stakeholder engagement, trust, transparency, and community partnership are board-adopted priorities for many districts. Bird’s Eye View helps communicators show where daily coverage supports those strategic goals and creates a cleaner artifact for superintendent, board, and district accreditation conversations.
        </p>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '18px' }}>
        <div className="kpi-card">
          <div className="kpi-header"><div className="kpi-label">Total Mentions</div><div className="kpi-icon yellow">📰</div></div>
          <div className="kpi-value">{totalMentions}</div>
          <span className="kpi-change positive">Filtered report set</span>
        </div>
        <div className="kpi-card">
          <div className="kpi-header"><div className="kpi-label">Canary Score</div><div className="kpi-icon green">📈</div></div>
          <div className="kpi-value">{totalMentions ? (articles.reduce((sum, a) => sum + parseFloat(a.canary_score ?? 0), 0) / totalMentions).toFixed(1) : '—'}</div>
          <span className="kpi-change positive">Average for report set</span>
        </div>
        <div className="kpi-card">
          <div className="kpi-header"><div className="kpi-label">Strategic Hits</div><div className="kpi-icon blue">🎯</div></div>
          <div className="kpi-value">{strategicHitCount}</div>
          <span className="kpi-change positive">{percent(strategicHitCount)} of mentions · {strategicAlignmentData.length} focus areas</span>
        </div>
        <div className="kpi-card">
          <div className="kpi-header"><div className="kpi-label">Earned Media</div><div className="kpi-icon yellow">⭐</div></div>
          <div className="kpi-value">{earnedCount}</div>
          <span className="kpi-change positive">{percent(earnedCount, strategicHitCount)} of strategic hits</span>
        </div>
      </div>

      <StrategicAlignmentChart
        data={strategicAlignmentData}
        selectedLabel={selectedLabel}
        onSelectLabel={onSelectLabel}
      />

      <div className="data-table-wrapper" style={{ marginTop: '18px' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Headline</th>
              <th>Summary</th>
              <th>Link</th>
              <th>Source</th>
              <th>Tags</th>
              <th>Score</th>
              <th>Strategic Alignment</th>
              <th>Earned Media</th>
            </tr>
          </thead>
          <tbody>
            {highlightedArticles.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="empty-state">
                    <div className="empty-state-icon">🦅</div>
                    <h3>No Strategic Alignment coverage in this view</h3>
                    <p>Try clearing filters or selecting another district/date range.</p>
                  </div>
                </td>
              </tr>
            ) : highlightedArticles.map((article) => {
              const labels = extractStrategicAlignmentLabels(article.innovation_reason);
              return (
                <tr key={article.id}>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{formatDate(article.date)}</td>
                  <td className="headline-cell">
                    <div className="headline-text" style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{article.headline}</div>
                  </td>
                  <td className="summary-cell">
                    <ExpandableText text={article.summary} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {article.link && (
                      <a href={article.link} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: 'var(--blue-400)' }}>
                        ↗ View Story
                      </a>
                    )}
                  </td>
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
                  <td>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '160px' }}>
                      {canonicalTags(article.tags).map((tag) => (
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
                  <td className="score-column">
                    <span className={`score-badge ${getScoreClass(article.canary_score)}`}>
                      {parseFloat(article.canary_score).toFixed(1)}
                    </span>
                  </td>
                  <td style={{ minWidth: '220px' }}>
                    <StrategicAlignmentPills labels={labels} selectedLabel={selectedLabel} onSelect={onSelectLabel} max={4} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {isEarned(article)
                      ? <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--canary-yellow)' }}>Earned</span>
                      : <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                    }
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

function StrategicAlignmentChart({ data, selectedLabel, onSelectLabel }) {
  const chartData = data.slice(0, 8).map((item) => ({
    ...item,
    shortLabel: item.label.length > 34 ? `${item.label.slice(0, 31)}…` : item.label,
  }));

  return (
    <div className="chart-card strategic-performance-chart" style={{ minHeight: '320px' }}>
      <h4>Strategic Alignment <span>Click a focus area to filter coverage</span></h4>
      {chartData.length === 0 ? (
        <div className="empty-state" style={{ padding: '36px 16px' }}>
          <div className="empty-state-icon">🎯</div>
          <h3>No Strategic Alignment labels yet</h3>
          <p>Aligned coverage will appear here once stories have Strategic Alignment output.</p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 18, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2D40" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis dataKey="shortLabel" type="category" width={170} tick={{ fill: '#94A3B8', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val) => [`${val} articles`, 'Coverage']} labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ''} />
              <Bar dataKey="count" radius={[0, 8, 8, 0]} onClick={(entry) => onSelectLabel(entry.label)} cursor="pointer">
                {chartData.map((entry) => (
                  <Cell key={entry.label} fill={selectedLabel === entry.label ? '#F5C518' : '#3B82F6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '12px' }}>
            {data.slice(0, 12).map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onSelectLabel(item.label)}
                className="btn btn-secondary btn-sm"
                style={{ borderColor: selectedLabel === item.label ? 'var(--canary-yellow)' : undefined, color: selectedLabel === item.label ? 'var(--canary-yellow)' : undefined }}
              >
                {item.label} ({item.count})
              </button>
            ))}
            {selectedLabel !== 'All' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelectLabel('All')}>Clear Strategic Alignment filter</button>}
          </div>
        </>
      )}
    </div>
  );
}

const MELODI_STARTERS = [
  'What should I pay attention to today?',
  'Which stories align with our strategic priorities?',
  'What public social conversations may need review?',
  'Summarize our top social posts from the last 30 days.',
];

function MelodiAnswer({ content }) {
  const lines = String(content || '')
    .replace(/\*\*/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/^#{1,4}\s*/, '').trim())
    .filter(Boolean);
  return <div className="melodi-answer-text">{lines.map((line, index) => <p key={`${index}-${line.slice(0, 24)}`}>{line}</p>)}</div>;
}

function MelodiChatView({ districtId, districtName }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const hasDistrict = Boolean(districtId && districtId !== 'All');

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, loading]);

  async function askMelodi(question) {
    const cleanQuestion = String(question || '').trim();
    if (!cleanQuestion || !hasDistrict || loading) return;
    const priorMessages = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: 'user', content: cleanQuestion }]);
    setDraft('');
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/melodi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: cleanQuestion, districtId, history: priorMessages }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'MELODI could not answer right now.');
      setMessages((current) => [...current, { role: 'assistant', content: payload.answer, sources: payload.sources || [], scope: payload.scope || null }]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'MELODI could not answer right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="melodi-shell" aria-label="Ask MELODI">
      <header className="melodi-hero">
        <div className="melodi-mark" aria-hidden="true">M</div>
        <div>
          <span>Canary conversational intelligence</span>
          <h2>Ask MELODI</h2>
          <p>Ask questions about {hasDistrict ? districtName : 'a selected district'} using Canary’s current news, public-social intelligence, and approved strategic profile.</p>
        </div>
      </header>

      {!hasDistrict ? (
        <div className="melodi-empty-state">
          <strong>Select one district to begin.</strong>
          <p>MELODI never combines client data across districts.</p>
        </div>
      ) : (
        <>
          <div className="melodi-starters" aria-label="Suggested questions">
            {MELODI_STARTERS.map((starter) => (
              <button type="button" key={starter} onClick={() => askMelodi(starter)} disabled={loading}>{starter}</button>
            ))}
          </div>

          <div className="melodi-conversation" aria-live="polite">
            {messages.length === 0 && (
              <div className="melodi-welcome">
                <strong>Start with a question, not another report.</strong>
                <p>MELODI will answer from the selected district’s accessible Canary records and cite the evidence it used.</p>
              </div>
            )}
            {messages.map((message, index) => (
              <article className={`melodi-message ${message.role}`} key={`${message.role}-${index}`}>
                <div className="melodi-message-label">{message.role === 'assistant' ? 'MELODI' : 'You'}</div>
                {message.role === 'assistant' ? <MelodiAnswer content={message.content} /> : <p>{message.content}</p>}
                {message.sources?.length > 0 && (
                  <div className="melodi-sources">
                    <span>Evidence used</span>
                    <div>
                      {message.sources.map((source) => source.url ? (
                        <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
                          <strong>{source.id}</strong><span>{source.title}</span><small>{source.type} ↗</small>
                        </a>
                      ) : (
                        <div key={source.id}>
                          <strong>{source.id}</strong><span>{source.title}</span><small>{source.type}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {message.scope && (
                  <small className="melodi-scope-note">Grounded in {message.scope.newsRecords} news records, {message.scope.socialRecords} public-social records, and {message.scope.strategicPriorities} strategic priorities for {message.scope.districtName}.</small>
                )}
              </article>
            ))}
            {loading && <div className="melodi-thinking"><span aria-hidden="true" />MELODI is reviewing the evidence…</div>}
            <div ref={endRef} />
          </div>

          {error && <div className="melodi-error" role="alert">{error}</div>}
          <form className="melodi-composer" onSubmit={(event) => { event.preventDefault(); askMelodi(draft); }}>
            <label htmlFor="melodi-question">Ask about media coverage, public social conversation, strategic alignment, or reporting</label>
            <div>
              <textarea id="melodi-question" value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 1200))} onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  askMelodi(draft);
                }
              }} rows={3} maxLength={1200} placeholder="What should our communications team review today?" disabled={loading} />
              <button className="btn btn-primary" type="submit" disabled={loading || !draft.trim()}>Ask MELODI</button>
            </div>
          </form>
          <p className="melodi-boundary">MELODI is advisory and may be wrong. Verify facts and original sources before acting. Public-social discovery is incomplete and does not replace native platform notifications or inboxes. MELODI cannot publish, reply, assign, approve, or complete actions.</p>
        </>
      )}
    </section>
  );
}

function HowItWorksView() {
  return (
    <div className="data-section" style={{ maxWidth: '960px' }}>
      <div className="data-header">
        <h3>▶ How This Works</h3>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Media to decision to proof</span>
      </div>
      <div className="how-it-works-content">
        <div className="how-it-works-intro">
          <span>Recommended workflow</span>
          <h2>Find the signal, decide locally, and show the impact</h2>
          <p>Canary reviews news and publicly available social content, organizes the evidence with district context, and offers review-only next steps. Your communications team remains responsible for verification and approval.</p>
        </div>
        <div className="how-it-works-flow">
          <article>
            <span>1</span>
            <div><strong>See the media</strong><p>Start with Dashboard for a filtered media brief. Open Social to separate district posts, tagged posts, and public conversation.</p></div>
          </article>
          <article>
            <span>2</span>
            <div><strong>Decide what matters</strong><p>Review Strategic Alignment, the original source, public comments, evidence confidence, and facts that still need verification.</p></div>
          </article>
          <article>
            <span>3</span>
            <div><strong>Choose the next step</strong><p>Use the recommendation as a starting point. Respond, amplify, plan, monitor, or elevate only after a communicator approves the action.</p></div>
          </article>
          <article>
            <span>4</span>
            <div><strong>Show the value</strong><p>Use Bird’s Eye View to package strategic hits, earned media, supporting stories, and date-filtered evidence for leadership.</p></div>
          </article>
        </div>
        <div className="how-it-works-boundary">
          <strong>Public coverage boundary</strong>
          <p>Canary can review public posts and configured official accounts. Private profiles, direct messages, closed groups, and content unavailable to the public are not included.</p>
        </div>
      </div>
    </div>
  );
}

function SettingsView({ userDistrictId, districts, billingInfo = null, onPayByCard = null }) {
  const [issue, setIssue] = useState('');
  const [isPending, startSupportTransition] = useTransition();
  const [isBillingPending, startBillingTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [billingSaved, setBillingSaved] = useState(false);
  const [supportError, setSupportError] = useState(null);
  const [billingError, setBillingError] = useState(null);
  const [poNumber, setPoNumber] = useState(billingInfo?.poNumber || '');
  const [billingOrganizationName, setBillingOrganizationName] = useState(billingInfo?.billingOrganizationName || '');
  const [billingContactName, setBillingContactName] = useState(billingInfo?.billingContactName || '');
  const [billingPhone, setBillingPhone] = useState(billingInfo?.billingPhone || '');
  const [billingAddressLine1, setBillingAddressLine1] = useState(billingInfo?.billingAddressLine1 || '');
  const [billingAddressLine2, setBillingAddressLine2] = useState(billingInfo?.billingAddressLine2 || '');
  const [billingCity, setBillingCity] = useState(billingInfo?.billingCity || '');
  const [billingState, setBillingState] = useState(billingInfo?.billingState || '');
  const [billingZip, setBillingZip] = useState(billingInfo?.billingZip || '');
  const assignedDistrict = userDistrictId ? districts?.find((d) => d.id === userDistrictId) : null;
  const profileName = assignedDistrict?.name ?? 'Canary Admin';
  const profileDetail = userDistrictId ? 'Client view · 1 district' : 'Admin view · all districts';

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

  function handleBillingSubmit(e) {
    e.preventDefault();
    setBillingError(null);
    setBillingSaved(false);
    const fd = new FormData();
    fd.append('po_number', poNumber);
    fd.append('billing_organization_name', billingOrganizationName || profileName);
    fd.append('billing_contact_name', billingContactName);
    fd.append('billing_phone', billingPhone);
    fd.append('billing_address_line1', billingAddressLine1);
    fd.append('billing_address_line2', billingAddressLine2);
    fd.append('billing_city', billingCity);
    fd.append('billing_state', billingState);
    fd.append('billing_zip', billingZip);
    startBillingTransition(async () => {
      try {
        await saveBillingPurchaseOrder(fd);
        setBillingSaved(true);
      } catch (err) {
        setBillingError(err.message || 'Could not save billing details. Please try again.');
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
            <label className="form-label" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>Account</label>
            <input type="text" className="form-input" disabled defaultValue={profileName} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>Access</label>
            <input type="text" className="form-input" disabled defaultValue={profileDetail} />
          </div>
        </div>

        <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--border-secondary)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleLogout} className="btn btn-danger">
            Sign Out
          </button>
        </div>
      </div>

      {/* Billing Documents */}
      {userDistrictId && (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-secondary)', borderRadius: 'var(--radius-lg)', padding: '32px', maxWidth: '800px', marginBottom: '24px' }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '1.2rem' }}>Billing Documents</h4>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.6 }}>
            Recommended school-finance flow: download the Price Quote for internal approval, download the W-9 for vendor setup, save the PO number when your district provides it, then generate the invoice for PO/check/ACH payment. The receipt becomes available after payment is confirmed.
          </p>

          <form onSubmit={handleBillingSubmit} style={{ display: 'grid', gap: '14px', marginBottom: '18px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>District / Organization</label>
              <input type="text" className="form-input" value={billingOrganizationName} onChange={(e) => setBillingOrganizationName(e.target.value)} placeholder={profileName} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>Billing contact name</label>
              <input type="text" className="form-input" value={billingContactName} onChange={(e) => setBillingContactName(e.target.value)} placeholder="Optional" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>Billing phone</label>
              <input type="tel" className="form-input" value={billingPhone} onChange={(e) => setBillingPhone(e.target.value)} placeholder="Optional billing/contact phone" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>District billing address</label>
              <input type="text" className="form-input" value={billingAddressLine1} onChange={(e) => setBillingAddressLine1(e.target.value)} placeholder="Street address" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <input type="text" className="form-input" value={billingAddressLine2} onChange={(e) => setBillingAddressLine2(e.target.value)} placeholder="Suite, building, or department" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 120px', gap: '10px' }}>
              <input type="text" className="form-input" value={billingCity} onChange={(e) => setBillingCity(e.target.value)} placeholder="City" />
              <input type="text" className="form-input" value={billingState} onChange={(e) => setBillingState(e.target.value)} placeholder="State" />
              <input type="text" className="form-input" value={billingZip} onChange={(e) => setBillingZip(e.target.value)} placeholder="ZIP" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>Purchase order number</label>
              <input type="text" className="form-input" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Enter PO number when your district provides it" />
            </div>
            {billingError && <p style={{ color: 'var(--status-negative)', fontSize: '0.82rem', margin: 0 }}>{billingError}</p>}
            {billingSaved && <p style={{ color: '#22C55E', fontSize: '0.82rem', margin: 0 }}>Billing details saved. Reopen documents to see the latest PO/contact details.</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-secondary" disabled={isBillingPending}>
                {isBillingPending ? <span className="spinner" style={{ margin: '0 auto' }} /> : 'Save Billing Details'}
              </button>
            </div>
          </form>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <a className="btn btn-primary" href="/billing/estimate" target="_blank" rel="noreferrer" style={{ textAlign: 'center' }}>Download Price Quote</a>
            <a className="btn btn-secondary" href="https://drive.google.com/file/d/1IjnCcx3O16KI8SZMe7oqfAkVn66_gfNC/view?usp=sharing" target="_blank" rel="noreferrer" style={{ textAlign: 'center' }}>Download W-9</a>
            {poNumber.trim() ? (
              <a className="btn btn-primary" href="/billing/invoice" target="_blank" rel="noreferrer" style={{ textAlign: 'center' }}>Generate Invoice</a>
            ) : (
              <button className="btn btn-secondary" type="button" disabled title="Enter and save a PO number to generate an invoice for check/ACH payment processing.">Generate Invoice after PO #</button>
            )}
            {billingInfo?.paymentStatus === 'paid' ? (
              <a className="btn btn-secondary" href="/billing/receipt" target="_blank" rel="noreferrer" style={{ textAlign: 'center' }}>Download Receipt</a>
            ) : (
              <button className="btn btn-secondary" type="button" disabled title="Receipt is available after payment is confirmed.">Receipt available after payment</button>
            )}
          </div>

          <div style={{ marginTop: '12px', padding: '12px 14px', border: '1px solid rgba(250,204,21,0.24)', borderRadius: 'var(--radius-md)', background: 'rgba(250,204,21,0.06)', color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--text-primary)' }}>Finance packet order:</strong> Price Quote → W-9 → PO # → Invoice → Receipt after payment.
          </div>

          {billingInfo?.paymentStatus !== 'paid' && (
            <div style={{ marginTop: '14px' }}>
              <button className="btn btn-primary" type="button" onClick={onPayByCard} style={{ width: '100%' }}>
                Pay by Card
              </button>
              <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                Opens secure Stripe payment inside the dashboard. If your district pays by PO, check, or ACH, save the PO number above and generate an invoice for payment processing instead.
              </p>
            </div>
          )}

          <div style={{ marginTop: '16px', padding: '14px 16px', border: '1px solid var(--border-secondary)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: 1.55 }}>
            Status: <strong style={{ color: 'var(--text-primary)' }}>{billingInfo?.paymentStatus === 'paid' ? 'paid / active' : (billingInfo?.paymentStatus || 'pending')}</strong><br />
            {billingInfo?.paymentStatus === 'paid' ? (
              <>Annual access through: <strong style={{ color: 'var(--text-primary)' }}>{billingInfo?.paidThrough ? new Date(billingInfo.paidThrough).toLocaleDateString() : 'Active'}</strong><br /></>
            ) : (
              <>Trial ends: <strong style={{ color: 'var(--text-primary)' }}>{billingInfo?.trialEndsAt ? new Date(billingInfo.trialEndsAt).toLocaleDateString() : 'Not set'}</strong><br /></>
            )}
            Annual access: <strong style={{ color: 'var(--text-primary)' }}>$1,499</strong>
          </div>
        </div>
      )}

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

  const hasSectionMarkdown = /^\s*(##\s+|\*\*[^*]+\*\*\s*$)/m.test(visibleText);
  const hasInlineMarkdown = /\*\*[^*]+\*\*/.test(visibleText);
  const hasMarkdown = hasSectionMarkdown || hasInlineMarkdown;
  const preview = hasMarkdown
    ? visibleText
        .replace(/##\s+[^\n]+/g, '')
        .replace(/^\s*\*\*[^*]+\*\*\s*$/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
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

function ReleaseSignupModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box release-signup-modal">
        <div>
          <h3>Set Up Your 30-Day Trial</h3>
          <div className="release-pricing-card">
            <span className="release-pricing-eyebrow">Early adopter launch offer</span>
            <div className="release-pricing-price">$1,499 <small>/ year</small></div>
            <p>Built for school communicators who need clarity without enterprise software sticker shock.</p>
            <ul>
              <li>Unlimited users for the district team</li>
              <li>Daily AI-summarized news and public social monitoring</li>
              <li>Hyper-local filtering, strategic recommendations, and PDF exports</li>
            </ul>
          </div>
          <p>Start with your district website. Canary will draft your setup, strategic priorities, and official social sources for your review before any login is created.</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-cancel-btn" onClick={onClose}>Not Yet</button>
          <Link className="modal-submit-btn" href="/onboarding">Start Trial Setup</Link>
        </div>
      </div>
    </div>
  );
}

function ScoreRangeFilter({ min, max, onChange }) {
  const SCORE_MIN = 1;
  const SCORE_MAX = 10;
  const pct = (v) => ((v - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 100;

  return (
    <div className="filter-control-group score-filter-group">
      <span className="filter-group-label">Score</span>
      <div className="score-filter-stack">
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

function CorrectionsView({ districts, userDistrictId, districtFilter, excludedStories, correctionEvents }) {
  const initialDistrict = userDistrictId || (districtFilter !== 'All' ? districtFilter : '');
  const [districtId, setDistrictId] = useState(initialDistrict);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const scopedExcluded = districtId ? excludedStories.filter((story) => story.district_id === districtId) : excludedStories;
  const scopedEvents = districtId ? correctionEvents.filter((event) => event.district_id === districtId) : correctionEvents;

  async function handleAdd(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      await addManualStory({
        districtId: userDistrictId || form.get('district_id'),
        link: form.get('link'),
        headline: form.get('headline'),
        source: form.get('source'),
        date: form.get('date'),
        summary: form.get('summary'),
        reason: form.get('reason'),
      });
      window.location.reload();
    } catch (error) {
      setMessage(error?.message || 'Unable to add the story.');
      setSaving(false);
    }
  }

  async function handleRestore(story) {
    const exclusion = scopedEvents.find((event) => event.story_id === story.id && event.action === 'exclude');
    if (!exclusion) {
      setMessage('The matching exclusion event could not be found.');
      return;
    }
    const reason = window.prompt('Why should this story be restored? (at least 10 characters)');
    if (reason === null) return;
    setSaving(true);
    setMessage('');
    try {
      await restoreStory({ storyId: story.id, exclusionEventId: exclusion.id, reason, expectedVersion: story.correction_version });
      window.location.reload();
    } catch (error) {
      setMessage(error?.message || 'Unable to restore the story.');
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '24px' }}>
      <section className="data-section">
        <div className="data-header">
          <div>
            <h3>➕ Add a missing story</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginTop: '4px' }}>Manual additions are district-scoped, deduplicated by canonical URL, and recorded in the immutable audit trail.</p>
          </div>
        </div>
        <form onSubmit={handleAdd} style={{ padding: '20px', display: 'grid', gap: '14px' }}>
          {!userDistrictId && (
            <label className="form-group">District
              <select className="form-input" name="district_id" value={districtId} onChange={(event) => setDistrictId(event.target.value)} required>
                <option value="">Select a district</option>
                {districts.map((district) => <option key={district.id} value={district.id}>{district.name}</option>)}
              </select>
            </label>
          )}
          <label className="form-group">Story URL
            <input className="form-input" name="link" type="url" required placeholder="https://publisher.com/story" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(180px, 1fr)', gap: '14px' }}>
            <label className="form-group">Headline
              <input className="form-input" name="headline" required />
            </label>
            <label className="form-group">Source
              <input className="form-input" name="source" required placeholder="Publisher name" />
            </label>
          </div>
          <label className="form-group">Story date
            <input className="form-input" name="date" type="date" required />
          </label>
          <label className="form-group">Summary <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span>
            <textarea className="form-textarea" name="summary" rows={3} />
          </label>
          <label className="form-group">Reason for manual addition
            <textarea className="form-textarea" name="reason" minLength={10} required rows={3} placeholder="Why this story belongs in this district’s coverage…" />
          </label>
          {message && <p style={{ color: 'var(--red-400)', fontSize: '0.85rem' }}>{message}</p>}
          <button className="btn btn-primary" type="submit" disabled={saving} style={{ width: 'fit-content' }}>{saving ? 'Saving…' : 'Add story'}</button>
        </form>
      </section>

      <section className="data-section">
        <div className="data-header"><h3>🚫 Excluded stories <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>({scopedExcluded.length})</span></h3></div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Headline</th><th>District</th><th>Action</th></tr></thead>
            <tbody>
              {scopedExcluded.length === 0 ? <tr><td colSpan={4} style={{ color: 'var(--text-tertiary)' }}>No excluded stories.</td></tr> : scopedExcluded.map((story) => (
                <tr key={story.id}>
                  <td>{formatDate(story.date)}</td>
                  <td>{story.link ? <a href={story.link} target="_blank" rel="noreferrer">{story.headline}</a> : story.headline}</td>
                  <td>{formatDistrictName(story.district_id)}</td>
                  <td><button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => handleRestore(story)}>Restore</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="data-section">
        <div className="data-header"><h3>🧾 Correction history <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>({scopedEvents.length})</span></h3></div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>When</th><th>Action</th><th>Story</th><th>Reason</th><th>District</th></tr></thead>
            <tbody>
              {scopedEvents.length === 0 ? <tr><td colSpan={5} style={{ color: 'var(--text-tertiary)' }}>No correction events yet.</td></tr> : scopedEvents.map((event) => (
                <tr key={event.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(event.created_at).toLocaleString()}</td>
                  <td><strong>{event.action.replace('_', ' ')}</strong></td>
                  <td>{event.after_state?.headline || event.before_state?.headline || event.story_id}</td>
                  <td>{event.reason}</td>
                  <td>{formatDistrictName(event.district_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatSocialRate(rate) {
  if (rate === null || !Number.isFinite(rate)) return 'N/A';
  if (rate > 0 && rate < 0.01) return '<0.01%';
  return `${rate.toFixed(2)}%`;
}

function formatSocialUrgency(value) {
  const labels = { now: 'Now', today: 'Today', this_week: 'This week', routine: 'Routine' };
  return labels[value] || String(value || 'Routine').replaceAll('_', ' ');
}

function SocialPostPreviewCard({ result, source, rank = null, showContext = false }) {
  const mediaUrl = safeSocialMediaUrl(result.mediaUrl);
  const videoUrl = safeSocialMediaUrl(result.videoUrl);
  const profileImageUrl = safeSocialMediaUrl(result.profileImageUrl || (result.relationshipType === 'owned' ? source?.metadata?.profile_picture_url : ''));
  const renderedMediaUrl = proxiedSocialMediaUrl(mediaUrl);
  const renderedVideoUrl = proxiedSocialMediaUrl(videoUrl);
  const renderedProfileImageUrl = proxiedSocialMediaUrl(profileImageUrl);
  const [failedMediaUrl, setFailedMediaUrl] = useState('');
  const [failedProfileImageUrl, setFailedProfileImageUrl] = useState('');
  const [videoOpen, setVideoOpen] = useState(false);
  const imageFailed = Boolean(mediaUrl && failedMediaUrl === mediaUrl);
  const profileImageFailed = Boolean(profileImageUrl && failedProfileImageUrl === profileImageUrl);

  const followers = resolveSocialFollowerCount(result, source);
  const engagementRate = result.hasPerformanceData ? calculateSocialEngagementRate(result, followers) : null;
  const displayName = result.authorName || source?.display_name || source?.handle || 'Public social account';
  const initials = displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 3).toUpperCase();
  const profileUrl = safeSocialUrl(result.authorProfileUrl || (result.relationshipType === 'owned' ? (source?.profile_url || source?.url) : null));
  const postCopy = result.summary || result.headline;
  const isVideo = result.mediaType === 'video';
  const action = result.actionIntelligence;

  return (
    <>
      <article className="social-post-preview-card">
        <header className="social-post-preview-header">
          <div className="social-post-preview-identity">
            {profileImageUrl && !profileImageFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={renderedProfileImageUrl} alt="" className="social-post-avatar" onError={() => setFailedProfileImageUrl(profileImageUrl)} />
            ) : (
              <span className="social-post-avatar social-post-avatar-fallback" aria-hidden="true">{initials}</span>
            )}
            <div>
              {profileUrl ? <a href={profileUrl} target="_blank" rel="noopener noreferrer">{displayName}</a> : <strong>{displayName}</strong>}
              <p>{formatDate(result.date)} · Public</p>
            </div>
          </div>
          <div className="social-post-preview-badges">
            {rank && <span className="social-top-rank">#{rank}</span>}
            {result.relationshipType !== 'owned' && <span className="social-content-badge">{result.relationshipLabel}</span>}
            {action && <span className={`social-action-badge ${action.actionType}`}>{action.actionLabel}</span>}
            {result.isSharedPost && <span className="social-content-badge">Shared</span>}
            {result.visibilityStatus === 'review' && <span className="social-review-badge">Review</span>}
          </div>
        </header>

        {postCopy && <p className="social-post-preview-copy">{postCopy}</p>}

        {action && (action.recommendedAction || action.situationSummary) && (
          <section className={`social-decision-cue ${action.actionType}`} aria-label={`${action.actionLabel} decision cue`}>
            <div>
              <span>What to do</span>
              <strong>{action.actionLabel} · {formatSocialUrgency(action.urgency)}</strong>
            </div>
            <p>{action.recommendedAction || action.situationSummary}</p>
            <small>Review-only recommendation</small>
          </section>
        )}

        <div className={`social-post-preview-media ${mediaUrl && !imageFailed ? 'has-media' : 'media-fallback'} ${result.isTextOnly && !imageFailed ? 'text-only-fallback' : ''}`}>
          {mediaUrl && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={renderedMediaUrl} alt={result.headline || 'District social post'} loading="lazy" onError={() => setFailedMediaUrl(mediaUrl)} />
          ) : (
            <div className="social-post-fallback-state">
              <span aria-hidden="true">{result.isTextOnly && !imageFailed ? 'Aa' : '◇'}</span>
              <strong>{result.isTextOnly && !imageFailed ? 'Text-only social post' : 'Media unavailable'}</strong>
              <small>{result.isTextOnly && !imageFailed ? 'This post was published without an image or video.' : 'Open the original post to review its media.'}</small>
            </div>
          )}
          {result.carouselCount > 1 && <span className="social-carousel-badge">▦ {result.carouselCount} images</span>}
          {isVideo && videoUrl ? (
            <button type="button" className="social-post-video-launch" onClick={() => setVideoOpen(true)} aria-label={`Play video: ${result.headline}`}>
              <span aria-hidden="true">▶</span><small>Play video</small>
            </button>
          ) : isVideo && result.url ? (
            <a className="social-post-video-launch" href={result.url} target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">▶</span><small>Watch on platform</small>
            </a>
          ) : null}
        </div>

        <div className="social-post-engagement-bar" aria-label="Public engagement counts">
          <span>👍 <strong>{formatAvailableSocialMetric(result, 'reactions', result.reactionCount)}</strong> reactions</span>
          <span>💬 <strong>{formatAvailableSocialMetric(result, 'comments', result.commentCount)}</strong> comments</span>
          <span>↗ <strong>{formatAvailableSocialMetric(result, 'shares', result.shareCount)}</strong> shares</span>
        </div>

        <div className="social-post-performance-grid">
          <div><strong>{formatAvailableSocialMetric(result, 'reactions', result.reactionCount)}</strong><span>Reactions</span></div>
          <div><strong>{formatAvailableSocialMetric(result, 'comments', result.commentCount)}</strong><span>Comments</span></div>
          <div title={result.hasPerformanceData && followers ? `${formatSocialMetric(result.engagementTotal)} available public interactions divided by ${formatSocialMetric(followers)} followers` : 'Performance or follower data unavailable'}>
            <strong>{formatSocialRate(engagementRate)}</strong><span>Engagement rate</span>
          </div>
          <div><strong>{formatAvailableSocialMetric(result, 'views', result.viewCount)}</strong><span>Views</span></div>
        </div>

        {result.representativeComments?.length > 0 && (
          <section className="social-post-conversation" aria-label="Representative public comments">
            <header>
              <strong>Public conversation</strong>
              <span>{result.representativeComments.length} representative {result.representativeComments.length === 1 ? 'comment' : 'comments'}</span>
            </header>
            {result.representativeComments.map((comment, index) => (
              <blockquote key={comment.id || `${result.id}-comment-${index}`}>
                <p>{comment.body}</p>
                <footer>
                  <span>{comment.authorName}{comment.date ? ` · ${formatDate(comment.date)}` : ''}</span>
                  {comment.reactionCount > 0 && <span>👍 {formatSocialMetric(comment.reactionCount)}</span>}
                </footer>
              </blockquote>
            ))}
          </section>
        )}

        {action && (
          <section className={`social-action-intelligence ${action.actionType}`} aria-label={`${action.actionLabel} recommendation`}>
            <header>
              <div><span>Suggested action</span><strong>{action.actionLabel}</strong></div>
              <div className="social-action-meta">
                <span>{formatSocialUrgency(action.urgency)}</span>
                {action.confidence !== null && <span>{Math.round(action.confidence * 100)}% evidence confidence</span>}
              </div>
            </header>
            {action.situationSummary && <p className="social-action-situation">{action.situationSummary}</p>}
            {action.recommendedAction && (
              <div className="social-action-recommendation"><strong>Recommended next step</strong><p>{action.recommendedAction}</p></div>
            )}
            {action.strategicPriorityLabels.length > 0 && (
              <div className="social-action-alignment">
                <strong>Aligned with</strong>
                <div>{action.strategicPriorityLabels.map((label) => <span key={label}>{label}</span>)}</div>
              </div>
            )}
            {(action.actionRationale || action.strategicAlignmentReason || action.missionOrValueEvidence.length > 0 || action.contentOpportunity || action.draftResponse || action.factsToVerify.length > 0) && (
              <details className="social-action-details">
                <summary>Review strategy and draft</summary>
                {action.actionRationale && <p><strong>Why this action:</strong> {action.actionRationale}</p>}
                {action.strategicAlignmentReason && <p><strong>Why it aligns:</strong> {action.strategicAlignmentReason}</p>}
                {action.missionOrValueEvidence.length > 0 && (
                  <div><strong>District grounding:</strong><ul>{action.missionOrValueEvidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul></div>
                )}
                {action.contentOpportunity && <p><strong>Communications opportunity:</strong> {action.contentOpportunity}</p>}
                {action.factsToVerify.length > 0 && (
                  <div><strong>Verify before acting:</strong><ul>{action.factsToVerify.map((fact) => <li key={fact}>{fact}</li>)}</ul></div>
                )}
                {action.draftResponse && <div className="social-action-draft"><strong>Review-only draft</strong><p>{action.draftResponse}</p></div>}
              </details>
            )}
            <footer><span>Grounded in the approved district profile · Review-only</span><span>No response will be posted automatically.</span></footer>
          </section>
        )}

        <footer className="social-post-preview-footer">
          <div>
            <span>Total engagement</span>
            <strong>{result.hasPerformanceData ? formatSocialMetric(result.engagementTotal) : 'N/A'}</strong>
            {followers > 0 && <small>{formatSocialMetric(followers)} followers</small>}
          </div>
          {result.url && <a href={result.url} target="_blank" rel="noopener noreferrer">View original post ↗</a>}
        </footer>

        {showContext && (result.matchReason || (!action && result.recommendation)) && (
          <div className="social-post-canary-context">
            {result.matchReason && <p><strong>Why Canary found it:</strong> {result.matchReason}</p>}
            {!action && result.recommendation && <p><strong>Recommended action:</strong> {result.recommendation}</p>}
          </div>
        )}
      </article>

      {videoOpen && videoUrl && (
        <div className="social-video-modal" role="dialog" aria-modal="true" aria-label={`Video player for ${result.headline}`} onClick={() => setVideoOpen(false)}>
          <div className="social-video-modal-panel" onClick={(event) => event.stopPropagation()}>
            <header><strong>{displayName}</strong><button type="button" onClick={() => setVideoOpen(false)} aria-label="Close video player">✕</button></header>
            <video src={renderedVideoUrl} poster={renderedMediaUrl || undefined} controls autoPlay playsInline>
              Your browser does not support video playback.
            </video>
            <footer><span>{result.headline}</span>{result.url && <a href={result.url} target="_blank" rel="noopener noreferrer">Open original post ↗</a>}</footer>
          </div>
        </div>
      )}
    </>
  );
}

function SocialView({ articles, socialThreads, socialSources, districtFilter, districts }) {
  const [relationshipFilter, setRelationshipFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [socialSearch, setSocialSearch] = useState('');
  const [socialResultLimit, setSocialResultLimit] = useState(24);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [performanceFilter, setPerformanceFilter] = useState('all');
  const [minimumEngagementRate, setMinimumEngagementRate] = useState('');
  const [maximumEngagementRate, setMaximumEngagementRate] = useState('');
  const [socialDateStart, setSocialDateStart] = useState('');
  const [socialDateEnd, setSocialDateEnd] = useState('');
  const [socialSort, setSocialSort] = useState('newest');
  const [topPostsAsOf] = useState(() => Date.now());
  const scopedRecords = useMemo(() => {
    const configuredPlatformKeys = new Set(socialSources.map((source) => `${source.district_id}:${String(source.platform || '').toLowerCase()}`));
    const legacyRecords = articles.filter((article) => {
      const platform = String(article.source_type || '').toLowerCase();
      const districtMatches = districtFilter === 'All' || article.district_id === districtFilter;
      return districtMatches && SOCIAL_SOURCE_TYPES.has(platform) && !configuredPlatformKeys.has(`${article.district_id}:${platform}`);
    });
    const stagedRecords = socialThreads.filter((thread) => districtFilter === 'All' || thread.district_id === districtFilter);
    return [...stagedRecords, ...legacyRecords];
  }, [articles, socialThreads, socialSources, districtFilter]);
  const results = useMemo(() => buildSocialResults(scopedRecords), [scopedRecords]);
  const summary = useMemo(() => summarizeSocialResults(results), [results]);
  const topPlatformGroups = useMemo(() => {
    const preferredOrder = ['facebook', 'instagram'];
    const cutoff = topPostsAsOf - (30 * 24 * 60 * 60 * 1000);
    const recentOwnedResults = results.filter((result) => result.relationshipType === 'owned' && new Date(result.date).getTime() >= cutoff);
    const platforms = [...new Set(recentOwnedResults.map((result) => result.platform))]
      .sort((a, b) => {
        const aIndex = preferredOrder.indexOf(a);
        const bIndex = preferredOrder.indexOf(b);
        if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? preferredOrder.length : aIndex) - (bIndex < 0 ? preferredOrder.length : bIndex);
        return a.localeCompare(b);
      });
    return platforms
      .map((platform) => ({ platform, posts: rankTopSocialResults(recentOwnedResults.filter((result) => result.platform === platform), 3) }))
      .filter((group) => group.posts.length > 0);
  }, [results, topPostsAsOf]);
  const scopedSources = useMemo(
    () => socialSources.filter((source) => districtFilter === 'All' || source.district_id === districtFilter),
    [socialSources, districtFilter],
  );
  const sourceByDistrictPlatform = useMemo(() => new Map(
    scopedSources.map((source) => [`${source.district_id}:${source.platform}`, source]),
  ), [scopedSources]);
  const platformOptions = useMemo(() => [...new Set(results.map((result) => result.platform))].sort(), [results]);
  const facetedResults = useMemo(() => {
    const query = socialSearch.trim().toLowerCase();
    const minRate = minimumEngagementRate === '' ? null : Number(minimumEngagementRate);
    const maxRate = maximumEngagementRate === '' ? null : Number(maximumEngagementRate);
    const rateFor = (result) => {
      const source = sourceByDistrictPlatform.get(`${result.districtId}:${result.platform}`);
      return result.hasPerformanceData ? calculateSocialEngagementRate(result, resolveSocialFollowerCount(result, source)) : null;
    };
    return results.filter((result) => {
      const relationshipMatches = socialRelationshipFilterMatches(result, relationshipFilter);
      const platformMatches = platformFilter === 'all' || result.platform === platformFilter;
      const mediaCategory = result.mediaType === 'video' ? 'video' : (result.mediaUrl ? 'image' : 'text');
      const mediaMatches = mediaFilter === 'all' || mediaCategory === mediaFilter;
      const performanceMatches = performanceFilter === 'all'
        || (performanceFilter === 'available' ? result.hasPerformanceData : !result.hasPerformanceData);
      const rate = rateFor(result);
      const minimumMatches = minRate === null || (rate !== null && Number.isFinite(minRate) && rate >= minRate);
      const maximumMatches = maxRate === null || (rate !== null && Number.isFinite(maxRate) && rate <= maxRate);
      const dateMatches = socialDateFilterMatches(result, socialDateStart, socialDateEnd);
      const searchMatches = !query || [result.headline, result.summary, result.authorName, result.platform, result.matchReason, result.actionIntelligence?.actionLabel, result.actionIntelligence?.recommendedAction, result.actionIntelligence?.strategicAlignmentReason, ...(result.actionIntelligence?.strategicPriorityLabels || [])]
        .some((value) => String(value || '').toLowerCase().includes(query));
      return relationshipMatches && platformMatches && mediaMatches && performanceMatches && minimumMatches && maximumMatches && dateMatches && searchMatches;
    });
  }, [results, relationshipFilter, platformFilter, mediaFilter, performanceFilter, minimumEngagementRate, maximumEngagementRate, socialDateStart, socialDateEnd, socialSearch, sourceByDistrictPlatform]);
  const actionSummary = useMemo(() => summarizeSocialActions(facetedResults), [facetedResults]);
  const selectedActionLabel = { respond: 'Respond', amplify: 'Amplify', strategy: 'Strategy', monitor: 'Monitor', elevate: 'Elevate' }[actionFilter] || null;
  const visibleResults = useMemo(() => {
    const rateFor = (result) => {
      const source = sourceByDistrictPlatform.get(`${result.districtId}:${result.platform}`);
      return result.hasPerformanceData ? calculateSocialEngagementRate(result, resolveSocialFollowerCount(result, source)) : null;
    };
    const filtered = facetedResults.filter((result) => socialActionFilterMatches(result, actionFilter));
    return filtered.sort((a, b) => {
      if (socialSort === 'engagement') return b.engagementTotal - a.engagementTotal;
      if (socialSort === 'engagement-rate') return (rateFor(b) ?? -1) - (rateFor(a) ?? -1);
      if (socialSort === 'reactions') return b.reactionCount - a.reactionCount;
      if (socialSort === 'comments') return b.commentCount - a.commentCount;
      if (socialSort === 'shares') return b.shareCount - a.shareCount;
      if (socialSort === 'views') return b.viewCount - a.viewCount;
      if (socialSort === 'oldest') return new Date(a.date).getTime() - new Date(b.date).getTime();
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [facetedResults, actionFilter, socialSort, sourceByDistrictPlatform]);
  const pagedResults = visibleResults.slice(0, socialResultLimit);
  const changeSocialFilter = (setter, value) => {
    setter(value);
    setSocialResultLimit(24);
  };
  const resetSocialFilters = () => {
    setRelationshipFilter('all');
    setActionFilter('all');
    setPlatformFilter('all');
    setMediaFilter('all');
    setPerformanceFilter('all');
    setMinimumEngagementRate('');
    setMaximumEngagementRate('');
    setSocialDateStart('');
    setSocialDateEnd('');
    setSocialSearch('');
    setSocialSort('newest');
    setSocialResultLimit(24);
  };
  const hasActiveSocialFilters = relationshipFilter !== 'all' || actionFilter !== 'all' || platformFilter !== 'all' || mediaFilter !== 'all'
    || performanceFilter !== 'all' || minimumEngagementRate !== '' || maximumEngagementRate !== '' || socialDateStart !== '' || socialDateEnd !== '' || socialSearch !== '' || socialSort !== 'newest';

  return (
    <div className="social-monitor-view">
      <section className="social-monitor-hero">
        <div>
          <span className="social-eyebrow">Public social intelligence</span>
          <h2>Where your district is showing up</h2>
          <p>Canary summarizes public posts and conversations without reproducing the full comment stream. Open the original post to review every available reaction, reply, and comment on the source platform.</p>
        </div>
        <div className="social-coverage-note">
          <strong>Coverage boundary</strong>
          <span>Public posts and authorized official accounts only. Private profiles, direct messages, and closed groups are excluded.</span>
        </div>
      </section>

      <div className="social-summary-grid" aria-label="Social result summary">
        <button type="button" className={relationshipFilter === 'all' ? 'active' : ''} onClick={() => changeSocialFilter(setRelationshipFilter, 'all')}>
          <span>All results</span><strong>{summary.total}</strong>
        </button>
        <button type="button" className={relationshipFilter === 'owned' ? 'active' : ''} onClick={() => changeSocialFilter(setRelationshipFilter, 'owned')}>
          <span>District posts</span><strong>{summary.owned}</strong>
        </button>
        <button type="button" className={relationshipFilter === 'direct' ? 'active' : ''} onClick={() => changeSocialFilter(setRelationshipFilter, 'direct')}>
          <span>Tagged / mentioned</span><strong>{summary.direct}</strong>
        </button>
        <button type="button" className={relationshipFilter === 'ambient' ? 'active' : ''} onClick={() => changeSocialFilter(setRelationshipFilter, 'ambient')}>
          <span>Public mentions</span><strong>{summary.ambient}</strong>
        </button>
      </div>

      <section className="social-navigation-controls" aria-label="Social channel navigation">
        <div className="social-navigation-heading"><div><strong>Channels</strong><span>Move between collected networks without losing your relationship or action filters.</span></div></div>
        <div className="social-channel-tabs">
          <button type="button" className={platformFilter === 'all' ? 'active' : ''} onClick={() => changeSocialFilter(setPlatformFilter, 'all')}>All channels</button>
          {platformOptions.map((platform) => (
            <button type="button" key={platform} className={platformFilter === platform ? 'active' : ''} onClick={() => changeSocialFilter(setPlatformFilter, platform)}>
              <span className={`social-platform-dot ${platform}`} aria-hidden="true" />{formatSourceLabel(platform)}
            </button>
          ))}
        </div>
      </section>

      <section className="social-action-queue" aria-label="Action Queue">
        <div className="social-navigation-heading">
          <div><strong>Action Queue</strong><span>District-grounded recommendations stay review-only until a communicator approves the next step.</span></div>
          <em>{actionSummary.total} enriched result{actionSummary.total === 1 ? '' : 's'}</em>
        </div>
        <div className="social-action-tabs">
          {[
            ['respond', 'Respond'],
            ['amplify', 'Amplify'],
            ['strategy', 'Strategy'],
            ['monitor', 'Monitor'],
            ['elevate', 'Elevate'],
          ].map(([value, label]) => (
            <button type="button" key={value} className={`${value} ${actionFilter === value ? 'active' : ''}`} onClick={() => changeSocialFilter(setActionFilter, actionFilter === value ? 'all' : value)}>
              <span>{label}</span><strong>{actionSummary[value]}</strong>
            </button>
          ))}
        </div>
      </section>

      {(relationshipFilter === 'all' || relationshipFilter === 'owned') && actionFilter === 'all' && platformFilter === 'all' && (
      <section className="social-top-section">
        <div className="social-section-heading">
          <div>
            <h3>Top district posts by platform</h3>
            <p>Up to three owned posts per platform from the last 30 days, ranked by public engagement. Engagement rate uses public interactions divided by the account’s public follower count.</p>
          </div>
          <span>{topPlatformGroups.reduce((total, group) => total + group.posts.length, 0)} ranked posts</span>
        </div>
        {topPlatformGroups.length === 0 ? (
          <div className="social-empty-inline">No reviewed owned posts are available for this 30-day window yet.</div>
        ) : (
          <div className="social-top-groups">
            {topPlatformGroups.map((group) => (
              <div className="social-top-group" key={group.platform}>
                <h4><span className={`social-platform-dot ${group.platform}`} aria-hidden="true" />{formatSourceLabel(group.platform)}</h4>
                <div className="social-top-grid">
                  {group.posts.map((result, index) => (
                    <SocialPostPreviewCard
                      key={`top-${result.platform}-${result.id}`}
                      result={result}
                      source={scopedSources.find((source) => source.platform === result.platform && source.district_id === result.districtId)}
                      rank={index + 1}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {(relationshipFilter === 'all' || relationshipFilter === 'owned') && actionFilter === 'all' && platformFilter === 'all' && (
      <section className="social-account-section">
        <div className="social-section-heading">
          <div>
            <h3>Monitored source registry</h3>
            <p>Official handles and public-discovery lanes configured for monitoring. “Configured” does not yet mean the district has authorized Canary through platform OAuth.</p>
          </div>
          <span>{scopedSources.length} configured source{scopedSources.length === 1 ? '' : 's'}</span>
        </div>
        <div className="social-account-list">
          {scopedSources.length === 0 ? (
            <div className="social-empty-inline">No official social sources are configured for this district yet.</div>
          ) : scopedSources.map((source) => {
            const district = districts.find((item) => item.id === source.district_id);
            const sourceUrl = safeSocialUrl(source.url);
            const AccountElement = sourceUrl ? 'a' : 'div';
            return (
              <AccountElement
                key={source.id}
                className="social-account-chip"
                {...(sourceUrl ? { href: sourceUrl, target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                <span className={`social-platform-dot ${source.platform}`} aria-hidden="true" />
                <span>
                  <strong>{source.handle ? `@${source.handle.replace(/^@/, '')}` : `${formatSourceLabel(source.platform)} public discovery`}</strong>
                  <small>{district?.name || formatDistrictName(source.district_id)} · {formatSourceLabel(source.platform)}{Number(source.metadata?.followers_count) > 0 ? ` · ${formatSocialMetric(source.metadata.followers_count)} followers` : ''}</small>
                </span>
                <em>{source.handle ? (sourceUrl ? 'Public feed live ↗' : 'Public feed live') : 'Keyword monitoring live'}</em>
              </AccountElement>
            );
          })}
        </div>
      </section>
      )}

      <section className="social-results-section">
        <div className="social-section-heading">
          <div>
            <h3>{selectedActionLabel ? `${selectedActionLabel} Action Queue` : 'All social posts and conversations'}</h3>
            <p>{selectedActionLabel ? `Showing review-only ${selectedActionLabel.toLowerCase()} recommendations that also match the selected channel and relationship.` : 'Every result uses the same post scorecard. Metrics show N/A when the original monitoring record did not collect that field.'}</p>
          </div>
          <div className="social-results-heading-controls">
            <span>{visibleResults.length} result{visibleResults.length === 1 ? '' : 's'}</span>
            <input className="filter-input" value={socialSearch} onChange={(event) => changeSocialFilter(setSocialSearch, event.target.value)} placeholder="Search social results…" />
          </div>
        </div>

        <div className="social-filter-panel" aria-label="Social result filters">
          <label><span>Platform</span><select value={platformFilter} onChange={(event) => changeSocialFilter(setPlatformFilter, event.target.value)}><option value="all">All platforms</option>{platformOptions.map((platform) => <option key={platform} value={platform}>{formatSourceLabel(platform)}</option>)}</select></label>
          <label><span>Content</span><select value={mediaFilter} onChange={(event) => changeSocialFilter(setMediaFilter, event.target.value)}><option value="all">All content</option><option value="image">Images</option><option value="video">Videos</option><option value="text">Text-only / no media</option></select></label>
          <label><span>From date</span><input type="date" value={socialDateStart} max={socialDateEnd || undefined} onChange={(event) => changeSocialFilter(setSocialDateStart, event.target.value)} /></label>
          <label><span>To date</span><input type="date" value={socialDateEnd} min={socialDateStart || undefined} onChange={(event) => changeSocialFilter(setSocialDateEnd, event.target.value)} /></label>
          <label><span>Performance data</span><select value={performanceFilter} onChange={(event) => changeSocialFilter(setPerformanceFilter, event.target.value)}><option value="all">Available or N/A</option><option value="available">Has performance data</option><option value="unavailable">Performance unavailable</option></select></label>
          <label><span>Min engagement rate</span><div className="social-rate-input"><input type="number" min="0" step="0.1" value={minimumEngagementRate} onChange={(event) => changeSocialFilter(setMinimumEngagementRate, event.target.value)} placeholder="0.0" /><em>%</em></div></label>
          <label><span>Max engagement rate</span><div className="social-rate-input"><input type="number" min="0" step="0.1" value={maximumEngagementRate} onChange={(event) => changeSocialFilter(setMaximumEngagementRate, event.target.value)} placeholder="Any" /><em>%</em></div></label>
          <label><span>Sort by</span><select value={socialSort} onChange={(event) => changeSocialFilter(setSocialSort, event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="engagement">Highest engagement</option><option value="engagement-rate">Highest engagement rate</option><option value="reactions">Most reactions</option><option value="comments">Most comments</option><option value="shares">Most shares</option><option value="views">Most views</option></select></label>
          <button type="button" className="social-filter-reset" onClick={resetSocialFilters} disabled={!hasActiveSocialFilters}>Reset filters</button>
        </div>

        {visibleResults.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">💬</div><h3>No reviewed social results found</h3><p>Try another filter, or check back after collected posts complete review.</p></div>
        ) : (
          <>
            <div className="social-scorecard-grid">
              {pagedResults.map((result) => (
                <SocialPostPreviewCard
                  key={`${result.platform}-${result.id}`}
                  result={result}
                  source={scopedSources.find((source) => source.platform === result.platform && source.district_id === result.districtId)}
                  showContext
                />
              ))}
            </div>
            {pagedResults.length < visibleResults.length && (
              <div className="social-load-more">
                <button type="button" className="btn btn-secondary" onClick={() => setSocialResultLimit((current) => current + 24)}>
                  Load 24 more scorecards
                </button>
                <span>Showing {pagedResults.length} of {visibleResults.length}</span>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default function DashboardClient({ articles, districts, queries: initialQueries, clients = [], userDistrictId, paymentNotice = null, billingInfo = null, excludedStories = [], correctionEvents = [], socialSources = [], socialThreads = [], strategicProfiles = [], strategicPriorities = [], melodiEnabled = false, demoMode = false }) {
  const defaultDistrictFilter = userDistrictId ?? districts[0]?.id ?? 'All';
  const [currentView, setCurrentView] = useState('dashboard');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [districtFilter, setDistrictFilter] = useState(defaultDistrictFilter);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [scoreMin, setScoreMin] = useState(1);
  const [scoreMax, setScoreMax] = useState(10);
  const [selectedQueries, setSelectedQueries] = useState(new Set());
  const [strategicAlignmentFilter, setStrategicAlignmentFilter] = useState('All');
  const [noteModal, setNoteModal] = useState(null);
  const [correctionModal, setCorrectionModal] = useState(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [releaseSignupOpen, setReleaseSignupOpen] = useState(false);
  const [releaseAutoPromptShown, setReleaseAutoPromptShown] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [paymentAmountLabel, setPaymentAmountLabel] = useState('$1,499 annual access');
  const [embeddedCheckout, setEmbeddedCheckout] = useState(null);
  const [embeddedCheckoutSessionId, setEmbeddedCheckoutSessionId] = useState('');
  const embeddedCheckoutRef = useRef(null);
  const colMenuRef = useRef(null);

  // Load saved column prefs from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLUMN_PREFS_KEY);
      if (saved) {
        setVisibleColumns(new Set(JSON.parse(saved)));
        return;
      }

      const legacySaved = localStorage.getItem(LEGACY_COLUMN_PREFS_KEY);
      if (legacySaved) {
        const next = new Set(JSON.parse(legacySaved));
        next.add('earned_media');
        localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify([...next]));
        setVisibleColumns(next);
      }
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

  useEffect(() => () => {
    if (embeddedCheckoutRef.current) {
      try { embeddedCheckoutRef.current.destroy(); } catch {}
      embeddedCheckoutRef.current = null;
    }
  }, []);

  async function openPaymentModal() {
    setPaymentModalOpen(true);
    setPaymentLoading(true);
    setPaymentError('');
    setPaymentSuccess(false);

    try {
      if (!stripePromise) throw new Error('Stripe publishable key is not configured.');
      if (embeddedCheckoutRef.current) {
        try { embeddedCheckoutRef.current.destroy(); } catch {}
        embeddedCheckoutRef.current = null;
      }
      setEmbeddedCheckout(null);
      const session = await createEmbeddedCanaryCheckout();
      setPaymentAmountLabel(session.amountLabel || '$1,499 annual access');
      setEmbeddedCheckoutSessionId(session.sessionId);
      const stripe = await stripePromise;
      if (!stripe) throw new Error('Stripe could not load. Please refresh and try again.');
      const checkout = await stripe.createEmbeddedCheckoutPage({
        clientSecret: session.clientSecret,
        onComplete: async () => {
          const result = await confirmEmbeddedCanaryCheckout(session.sessionId);
          if (result?.ok) {
            setPaymentSuccess(true);
            setEmbeddedCheckout(null);
          } else {
            setPaymentError('Stripe finished, but payment is not marked paid yet. Please contact Canary if this does not update shortly.');
          }
        },
      });
      embeddedCheckoutRef.current = checkout;
      setEmbeddedCheckout(checkout);
      setTimeout(() => checkout.mount('#canary-embedded-checkout'), 0);
    } catch (err) {
      setPaymentError(err?.message || 'Unable to start payment. Please try again.');
    } finally {
      setPaymentLoading(false);
    }
  }

  function closePaymentModal() {
    if (embeddedCheckoutRef.current) {
      try { embeddedCheckoutRef.current.destroy(); } catch {}
      embeddedCheckoutRef.current = null;
    }
    setEmbeddedCheckout(null);
    setEmbeddedCheckoutSessionId('');
    setPaymentModalOpen(false);
  }

  // Prompt demo visitors to join the release notification list after 30 seconds.
  useEffect(() => {
    if (!demoMode || releaseAutoPromptShown) return undefined;
    try {
      if (sessionStorage.getItem('canary_release_signup_auto_shown') === '1') return undefined;
    } catch {}

    const timer = setTimeout(() => {
      try { sessionStorage.setItem('canary_release_signup_auto_shown', '1'); } catch {}
      setReleaseAutoPromptShown(true);
      setReleaseSignupOpen(true);
    }, 30000);

    return () => clearTimeout(timer);
  }, [demoMode, releaseAutoPromptShown]);

  function toggleColumn(id) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify([...next])); } catch {}
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

  function openExcludeModal(article) {
    setCorrectionReason('');
    setCorrectionError('');
    setCorrectionModal(article);
  }

  async function handleExcludeStory() {
    if (!correctionModal) return;
    setCorrectionSaving(true);
    setCorrectionError('');
    try {
      await excludeStory({
        storyId: correctionModal.id,
        reason: correctionReason,
        expectedVersion: correctionModal.correction_version ?? 0,
      });
      window.location.reload();
    } catch (error) {
      setCorrectionError(error?.message || 'Unable to exclude the story.');
      setCorrectionSaving(false);
    }
  }

  const getNoteText = useCallback((article) => {
    return article.id in noteOverrides ? noteOverrides[article.id] : article.notes;
  }, [noteOverrides]);

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

  const scopedArticlesForCounts = useMemo(
    () => articles.filter((article) => districtFilter === 'All' || article.district_id === districtFilter),
    [articles, districtFilter]
  );
  const articleCount = scopedArticlesForCounts.length;
  const notesCount = scopedArticlesForCounts.filter((article) => getNoteText(article)).length;
  const queryCount = initialQueries.filter((query) => districtFilter === 'All' || query.district_id === districtFilter).length;
  const correctionCount = excludedStories.filter((story) => districtFilter === 'All' || story.district_id === districtFilter).length;
  const scopedSocialResultsForCounts = useMemo(() => {
    const configuredPlatformKeys = new Set(socialSources.map((source) => `${source.district_id}:${String(source.platform || '').toLowerCase()}`));
    const legacyRecords = scopedArticlesForCounts.filter((article) => {
      const platform = String(article.source_type || '').toLowerCase();
      return SOCIAL_SOURCE_TYPES.has(platform) && !configuredPlatformKeys.has(`${article.district_id}:${platform}`);
    });
    const stagedRecords = socialThreads.filter((thread) => districtFilter === 'All' || thread.district_id === districtFilter);
    return buildSocialResults([...stagedRecords, ...legacyRecords]);
  }, [scopedArticlesForCounts, socialThreads, socialSources, districtFilter]);
  const socialResultCount = scopedSocialResultsForCounts.length;
  const socialActionSummary = useMemo(() => summarizeSocialActions(scopedSocialResultsForCounts), [scopedSocialResultsForCounts]);

  const allTags = useMemo(() => ['All', ...CORE_TAGS], []);

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

  const allStrategicLabels = useMemo(() => {
    const scoped = districtFilter === 'All'
      ? articles
      : articles.filter((a) => a.district_id === districtFilter);
    return buildStrategicAlignmentData(scoped).map((item) => item.label);
  }, [articles, districtFilter]);

  const hasSecondaryFilters = dateStart || dateEnd || scoreMin !== 1 || scoreMax !== 10 || selectedQueries.size > 0 || strategicAlignmentFilter !== 'All';

  function clearSecondaryFilters() {
    setDateStart('');
    setDateEnd('');
    setScoreMin(1);
    setScoreMax(10);
    setSelectedQueries(new Set());
    setStrategicAlignmentFilter('All');
  }

  function handleExportPdf() {
    setCurrentView('dashboard');
    setColMenuOpen(false);
    setFeedbackOpen(false);
    setSidebarOpen(false);

    // Let React finish switching back to the dashboard and give print-only
    // assets a moment to paint before opening the browser print dialog.
    window.setTimeout(() => window.print(), 250);
  }

  function handleExportCsv() {
    downloadCsv(
      `canary-articles-${new Date().toISOString().slice(0, 10)}.csv`,
      ALL_COLUMNS.filter((column) => visibleColumns.has(column.id)).map((column) => column.label),
      filtered.map((article) => articleCsvRow(
        article,
        ALL_COLUMNS.filter((column) => visibleColumns.has(column.id)),
        { isEarned, getNoteText }
      ))
    );
  }

  function handleBirdEyePdf() {
    setColMenuOpen(false);
    setFeedbackOpen(false);
    setSidebarOpen(false);
    window.setTimeout(() => window.print(), 250);
  }

  function handleNavSelect(view) {
    setCurrentView(view);
    setSidebarOpen(false);
  }

  function handleDistrictSelect(districtId) {
    setDistrictFilter(districtId);
    setSearch('');
    setSourceFilter('All');
    setTagFilter('All');
    clearSecondaryFilters();
    setColMenuOpen(false);
    setSidebarOpen(false);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const seenArticleIds = new Set();
    return articles.filter((a) => {
      if (seenArticleIds.has(a.id)) return false;
      seenArticleIds.add(a.id);
      const matchSearch =
        !search ||
        a.headline?.toLowerCase().includes(q) ||
        a.summary?.toLowerCase().includes(q) ||
        getNoteText(a)?.toLowerCase().includes(q) ||
        a.recommendation?.toLowerCase().includes(q) ||
        a.innovation_reason?.toLowerCase().includes(q) ||
        a.source_query?.toLowerCase().includes(q);
      const articleSource = a.source_type ?? 'other';
      const matchSource =
        sourceFilter === 'All' ||
        articleSource === sourceFilter ||
        (sourceFilter === 'Social' && SOCIAL_SOURCE_TYPES.has(articleSource));
      const matchTag =
        tagFilter === 'All' || canonicalTags(a.tags).includes(tagFilter);
      const matchDistrict =
        districtFilter === 'All' || a.district_id === districtFilter;
      const matchDateStart = !dateStart || a.date >= dateStart;
      const matchDateEnd = !dateEnd || a.date <= dateEnd;
      const score = parseFloat(a.canary_score ?? 0);
      const matchScore = score >= scoreMin && score <= scoreMax;
      const matchQuery =
        selectedQueries.size === 0 ||
        (a.source_query && selectedQueries.has(a.source_query));
      const matchStrategicAlignment =
        strategicAlignmentFilter === 'All' ||
        extractStrategicAlignmentLabels(a.innovation_reason).includes(strategicAlignmentFilter);
      return matchSearch && matchSource && matchTag && matchDistrict && matchDateStart && matchDateEnd && matchScore && matchQuery && matchStrategicAlignment;
    }).sort((a, b) => {
      const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
      if (dateCompare !== 0) return dateCompare;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  }, [articles, search, sourceFilter, tagFilter, districtFilter, dateStart, dateEnd, scoreMin, scoreMax, selectedQueries, strategicAlignmentFilter, getNoteText]);

  // Keep KPI/charts aligned with the visible article table. This prevents cases
  // where a filtered table shows only TikTok rows but the source wheel still
  // reflects the broader district/all-article set.
  const chartArticles = filtered;
  const earnedMediaCount = chartArticles.filter((article) => isEarned(article)).length;
  const filteredNotesCount = chartArticles.filter((article) => getNoteText(article)).length;
  const communicationsBrief = useMemo(() => buildCommunicationsBrief(chartArticles, 3), [chartArticles]);

  const { mentionTrend, sentimentTrend, sourceBreakdown } = useMemo(
    () => buildChartData(chartArticles),
    [chartArticles]
  );

  const strategicAlignmentData = useMemo(
    () => buildStrategicAlignmentData(chartArticles),
    [chartArticles]
  );

  const strategicGovernance = useMemo(
    () => districtFilter === 'All'
      ? null
      : buildStrategicGovernance({ districtId: districtFilter, profiles: strategicProfiles, priorities: strategicPriorities }),
    [districtFilter, strategicProfiles, strategicPriorities]
  );

  const strategicAlignedCount = chartArticles.filter((article) => extractStrategicAlignmentLabels(article.innovation_reason).length > 0).length;

  const avgScore = chartArticles.length
    ? (
        chartArticles.reduce((sum, a) => sum + parseFloat(a.canary_score ?? 0), 0) /
        chartArticles.length
      ).toFixed(2)
    : '—';

  const topSource = sourceBreakdown[0];
  const selectedDistrict = districts.find((d) => d.id === districtFilter);
  const selectedDistrictName = districtFilter === 'All'
    ? 'All Districts'
    : selectedDistrict?.name ?? formatDistrictName(districtFilter);
  const accountDisplayName = demoMode
    ? 'Demo Account'
    : userDistrictId
      ? selectedDistrictName
      : 'Canary Admin';
  const accountDisplayDetail = demoMode
    ? 'Fictional demo data'
    : userDistrictId
      ? 'Client view · 1 district'
      : 'Admin view · all districts';

  return (
    <div className="dashboard-layout">
      {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="Close navigation menu" onClick={() => setSidebarOpen(false)} />}
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <Link href="/" className="sidebar-brand" aria-label="Return to Canary Data homepage">
            <Image src="/canary-logo.svg" alt="Canary Data" width={160} height={43} style={{ height: '32px', width: 'auto' }} />
          </Link>
          <button className="sidebar-close-btn" type="button" aria-label="Close navigation menu" onClick={() => setSidebarOpen(false)}>
            ×
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <div className="sidebar-section-label">Menu</div>
            <button
              className={`sidebar-link ${currentView === 'dashboard' ? 'active' : ''}`}
              onClick={() => handleNavSelect('dashboard')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">📊</span>
              Dashboard
            </button>
            <button
              className={`sidebar-link ${currentView === 'birdseye' ? 'active' : ''}`}
              onClick={() => handleNavSelect('birdseye')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">🦅</span>
              Bird’s Eye View
              <span className="sidebar-link-badge">v1</span>
            </button>
            <button
              className={`sidebar-link ${currentView === 'howto' ? 'active' : ''}`}
              onClick={() => handleNavSelect('howto')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">▶️</span>
              How This Works
            </button>
            <button
              className={`sidebar-link ${currentView === 'articles' ? 'active' : ''}`}
              onClick={() => handleNavSelect('articles')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">📰</span>
              Articles
              <span className="sidebar-link-badge">{articleCount}</span>
            </button>
            <button
              className={`sidebar-link ${currentView === 'social' ? 'active' : ''}`}
              onClick={() => handleNavSelect('social')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">💬</span>
              Social
              <span className="sidebar-link-badge">{socialResultCount}</span>
            </button>
            {!demoMode && melodiEnabled && (
              <button
                className={`sidebar-link melodi-sidebar-link ${currentView === 'melodi' ? 'active' : ''}`}
                onClick={() => handleNavSelect('melodi')}
                style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
              >
                <span className="sidebar-link-icon">✦</span>
                Ask MELODI
                <span className="sidebar-link-badge">AI</span>
              </button>
            )}
            <button
              className={`sidebar-link ${currentView === 'queries' ? 'active' : ''}`}
              onClick={() => handleNavSelect('queries')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">🔍</span>
              Queries
              <span className="sidebar-link-badge">{queryCount}</span>
            </button>
            <button
              className={`sidebar-link ${currentView === 'notes' ? 'active' : ''}`}
              onClick={() => handleNavSelect('notes')}
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sidebar-link-icon">📝</span>
              Notes
              <span className="sidebar-link-badge">{notesCount}</span>
            </button>
            {!demoMode && (
              <button
                className={`sidebar-link ${currentView === 'corrections' ? 'active' : ''}`}
                onClick={() => handleNavSelect('corrections')}
                style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
              >
                <span className="sidebar-link-icon">🛠️</span>
                Add / Correct Stories
                <span className="sidebar-link-badge">{correctionCount}</span>
              </button>
            )}
          </div>
          {!userDistrictId && (
            <div className="sidebar-section">
              <div className="sidebar-section-label">Admin</div>
              <button
                className={`sidebar-link ${districtFilter === 'All' ? 'active' : ''}`}
                onClick={() => handleDistrictSelect('All')}
                style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
                title="Admin-only global view with rows from every district. Select a district below to QA a client view."
              >
                <span className="sidebar-link-icon">🌐</span>
                All Districts
                <span className="sidebar-link-badge">Admin</span>
              </button>
              <button
                className={`sidebar-link ${currentView === 'clients' ? 'active' : ''}`}
                onClick={() => handleNavSelect('clients')}
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
                  onClick={() => handleDistrictSelect(d.id)}
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
            {demoMode && (
              <a
                className="sidebar-link"
                href="/privacy"
                target="_blank"
                rel="noreferrer"
                onClick={() => setSidebarOpen(false)}
              >
                <span className="sidebar-link-icon">🔒</span>
                Privacy Policy
              </a>
            )}
            {!demoMode && (
              <button
                className={`sidebar-link ${currentView === 'settings' ? 'active' : ''}`}
                onClick={() => handleNavSelect('settings')}
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
              <div className="sidebar-user-name">{accountDisplayName}</div>
              <div className="sidebar-user-email">{accountDisplayDetail}</div>
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
            {demoMode && (
              <button className="release-cta release-cta-left" onClick={() => setReleaseSignupOpen(true)}>
                Set Up Your 30-Day Trial
              </button>
            )}
            {demoMode && (
              <button className="release-cta release-cta-mobile" onClick={() => setReleaseSignupOpen(true)}>
                Start Trial
              </button>
            )}
            <div>
              <div className="topbar-title">
                {currentView === 'queries'
                  ? 'Search Queries'
                  : currentView === 'settings'
                    ? 'Settings'
                    : currentView === 'notes'
                      ? 'Analyst Notes'
                      : currentView === 'corrections'
                        ? 'Add / Correct Stories'
                        : currentView === 'birdseye'
                        ? 'Bird’s Eye View'
                        : currentView === 'clients'
                        ? 'Beta Testers'
                        : currentView === 'howto'
                          ? 'How This Works'
                          : currentView === 'articles'
                            ? 'Media Articles'
                            : currentView === 'social'
                              ? 'Social Intelligence'
                              : currentView === 'melodi'
                                ? 'Ask MELODI'
                                : selectedDistrictName}
              </div>
              <div className="topbar-breadcrumb">
                {currentView === 'queries' ? 'Manage monitored search terms'
                  : currentView === 'settings' ? 'Manage your account and preferences'
                  : currentView === 'notes' ? 'Articles with analyst annotations'
                  : currentView === 'corrections' ? 'Add, exclude, restore, and audit district stories'
                  : currentView === 'birdseye' ? 'Strategic Alignment themes, counts, and supporting coverage'
                  : currentView === 'clients' ? 'Login credentials for beta testers'
                  : currentView === 'howto' ? 'Media to decision to leadership proof'
                  : currentView === 'articles' ? 'Browse, filter, annotate, and export article-level coverage'
                  : currentView === 'social' ? 'District posts, tagged or mentioned posts, and public conversations'
                  : currentView === 'melodi' ? 'District-scoped conversational media intelligence with cited evidence'
                  : 'Media Intelligence Dashboard'}
              </div>
            </div>
          </div>
          <div className="topbar-right">
            {currentView === 'dashboard' && (
              <>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={handleExportCsv}
                  title="Exports the currently filtered table using your visible Columns selection."
                >
                  ⬇ Export CSV
                </button>
                <button
                  className="btn btn-secondary btn-sm export-pdf-btn"
                  onClick={handleExportPdf}
                  title="For the cleanest report, choose Tabloid / 11×17 and Landscape in the print dialog."
                >
                  ⬇ Export PDF
                  <span className="export-pdf-hint">Tabloid landscape works best</span>
                </button>
              </>
            )}
            {demoMode && (
              <a className="privacy-topbar-link" href="/privacy" target="_blank" rel="noreferrer">
                🔒 Privacy Policy
              </a>
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
          {!demoMode && paymentNotice && (
            <div className="demo-mode-banner" style={{ borderColor: 'rgba(245,197,24,0.45)', background: 'rgba(245,197,24,0.1)' }}>
              <strong>Your Canary Data trial {paymentNotice.daysUntilTrialEnds <= 0 ? 'is ending now' : `ends in ${paymentNotice.daysUntilTrialEnds} day${paymentNotice.daysUntilTrialEnds === 1 ? '' : 's'}`}.</strong>{' '}
              To keep access uninterrupted, review billing details, add any PO number, and confirm the correct district information before payment.{' '}
              <button type="button" onClick={() => handleNavSelect('settings')} style={{ color: 'var(--brand-primary)', fontWeight: 700, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>Review Billing</button>
            </div>
          )}
          {demoMode && currentView === 'dashboard' && (
            <section className="demo-testimonials" aria-label="Early district feedback">
              <div className="demo-testimonials-header">
                <span>Early district feedback</span>
                <strong>School communicators are seeing the value.</strong>
              </div>
              <div className="demo-testimonials-grid">
                {DEMO_TESTIMONIALS.map((testimonial) => (
                  <figure className="demo-testimonial-card" key={testimonial.quote}>
                    <blockquote>“{testimonial.quote}”</blockquote>
                    <figcaption>
                      <strong>{testimonial.name}</strong>
                      <span>{testimonial.role}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
          {!demoMode && !userDistrictId && districtFilter === 'All' && (
            <div className="demo-mode-banner">
              <strong>Admin global view:</strong> this view intentionally includes rows from every district. Select a specific district in the sidebar to QA the exact client view.
            </div>
          )}
          {currentView === 'clients' && <ClientsView clients={clients} />}
          {currentView === 'settings' && <SettingsView userDistrictId={userDistrictId} districts={districts} billingInfo={billingInfo} onPayByCard={openPaymentModal} />}
          {currentView === 'howto' && <HowItWorksView />}
          {currentView === 'social' && (
            <SocialView
              articles={articles}
              socialThreads={socialThreads}
              socialSources={socialSources}
              districtFilter={districtFilter}
              districts={districts}
            />
          )}
          {melodiEnabled && currentView === 'melodi' && (
            <MelodiChatView key={districtFilter} districtId={districtFilter} districtName={selectedDistrictName} />
          )}
          {currentView === 'queries' && (
            <QueriesView
              key={districtFilter}
              initialQueries={initialQueries}
              districts={districts}
              userDistrictId={userDistrictId}
              selectedDistrictId={districtFilter}
              onDistrictChange={handleDistrictSelect}
              demoMode={demoMode}
            />
          )}
          {currentView === 'notes' && (
            <NotesView
              articles={scopedArticlesForCounts}
              getNoteText={getNoteText}
              openNoteModal={openNoteModal}
            />
          )}
          {currentView === 'corrections' && (
            <CorrectionsView
              key={districtFilter}
              districts={districts}
              userDistrictId={userDistrictId}
              districtFilter={districtFilter}
              excludedStories={excludedStories}
              correctionEvents={correctionEvents}
            />
          )}
          {currentView === 'birdseye' && (
            <BirdEyeView
              articles={chartArticles}
              strategicAlignmentData={strategicAlignmentData}
              strategicGovernance={strategicGovernance}
              hasSelectedDistrict={districtFilter !== 'All'}
              selectedLabel={strategicAlignmentFilter}
              onSelectLabel={setStrategicAlignmentFilter}
              isEarned={isEarned}
              dateStart={dateStart}
              dateEnd={dateEnd}
              setDateStart={setDateStart}
              setDateEnd={setDateEnd}
              onExportPdf={handleBirdEyePdf}
            />
          )}
          {(currentView === 'dashboard' || currentView === 'articles') && (<>
          <div className="print-report-header">
            <div>
              <h1>{selectedDistrictName} Media Intelligence Dashboard</h1>
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
                <div className="kpi-label">Earned Media</div>
                <div className="kpi-icon yellow">🏆</div>
              </div>
              <div className="kpi-value">{earnedMediaCount}</div>
              <span className="kpi-change positive">Filtered timeframe</span>
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
              <div className="kpi-value">{filteredNotesCount}</div>
              <span className="kpi-change positive">
                Across {chartArticles.length} mentions
              </span>
            </div>

            <div className="kpi-card">
              <div className="kpi-header">
                <div className="kpi-label">Strategic Hits</div>
                <div className="kpi-icon blue">🎯</div>
              </div>
              <div className="kpi-value">{strategicAlignedCount}</div>
              <span className="kpi-change positive">
                {strategicAlignmentData.length} focus areas
              </span>
            </div>
          </div>

          <section className="communications-brief" aria-label="Communications brief">
            <header className="communications-brief-header">
              <div>
                <span>Communications brief</span>
                <h2>Here is what matters and what to do</h2>
                <p>Media values follow the active filters. Social action cues include all enriched results for the selected district. Recommendations are review-only and require source verification.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCurrentView('social')}>
                Open Social Action Queue{socialActionSummary.total ? ` (${socialActionSummary.total})` : ''}
              </button>
            </header>

            <div className="communications-brief-metrics">
              <div><span>Newest media mention</span><strong>{communicationsBrief.latestDate ? formatDate(communicationsBrief.latestDate) : 'No coverage'}</strong></div>
              <div><span>Recommended next steps</span><strong>{communicationsBrief.recommendedCount}</strong></div>
              <div><span>Social action cues</span><strong>{socialActionSummary.total}</strong></div>
              <div><span>Strategic hits</span><strong>{strategicAlignedCount}</strong></div>
            </div>

            {communicationsBrief.items.length > 0 ? (
              <div className="communications-brief-list">
                {communicationsBrief.items.map((article) => {
                  const articleUrl = safeExternalHttpUrl(article.link);
                  return (
                    <article key={article.id || articleUrl || `${article.date}:${article.headline}`}>
                      <div>
                        <span>{formatDate(article.date)} · {formatSourceLabel(article.source_type ?? 'other')} · Review-only recommendation</span>
                        <h3>{article.headline || 'Coverage recommendation'}</h3>
                      </div>
                      <p>{formatCommunicationsBriefRecommendation(article.recommendation)}</p>
                      {articleUrl && <a href={articleUrl} target="_blank" rel="noopener noreferrer">View story ↗</a>}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="communications-brief-empty">No specific next steps appear in this filtered coverage. Continue routine monitoring or adjust the filters.</p>
            )}
          </section>

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

            <StrategicAlignmentChart
              data={strategicAlignmentData}
              selectedLabel={strategicAlignmentFilter}
              onSelectLabel={setStrategicAlignmentFilter}
            />

          </div>
          </>)}

          {/* Articles Table */}
          <div className="data-section">
            <div className="data-header">
              <h3>📰 Media Articles</h3>
              <div className="data-filters">
                {!demoMode && (
                  <button className="btn btn-primary btn-sm" onClick={() => setCurrentView('corrections')}>
                    + Add Story
                  </button>
                )}
                <input
                  className="filter-input"
                  placeholder="Search headlines, summaries, notes, or alignment..."
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
              <div className="filter-control-group date-filter-group">
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

              <div className="filter-control-group">
                <span className="filter-group-label">Strategic Alignment</span>
                <select
                  className="filter-select"
                  value={strategicAlignmentFilter}
                  onChange={(e) => setStrategicAlignmentFilter(e.target.value)}
                  style={{ maxWidth: '260px' }}
                >
                  <option value="All">All focus areas</option>
                  {allStrategicLabels.map((label) => <option key={label} value={label}>{label}</option>)}
                </select>
              </div>

              {/* Clear all secondary filters */}
              {hasSecondaryFilters && (
                <button className="btn btn-ghost btn-sm" onClick={clearSecondaryFilters}>
                  ✕ Clear filters
                </button>
              )}
            </div>

            <div className="data-table-wrapper" key={`article-table-${districtFilter}-${currentView}`}>
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
                    {col('innovation_reason') && <th>Strategic Alignment</th>}
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
                        {!demoMode && (
                          <button
                            type="button"
                            className="expand-btn"
                            onClick={() => openExcludeModal(article)}
                            style={{ marginTop: '6px', color: 'var(--red-400)' }}
                          >
                            Exclude story
                          </button>
                        )}
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
                            {canonicalTags(article.tags).map((tag) => (
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

                      {/* Strategic Alignment */}
                      {col('innovation_reason') && (
                        <td className="summary-cell">
                          <StrategicAlignmentPills
                            labels={extractStrategicAlignmentLabels(article.innovation_reason)}
                            selectedLabel={strategicAlignmentFilter}
                            onSelect={setStrategicAlignmentFilter}
                          />
                          <RecommendationText
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
                              aria-label={`Mark ${article.headline} as earned media`}
                              style={{ accentColor: 'var(--canary-yellow)', width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: isEarned(article) ? 'var(--canary-yellow)' : 'var(--text-tertiary)' }}>
                              {isEarned(article) ? 'Earned' : 'Mark earned'}
                            </span>
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

      {/* Exclude Story Modal */}
      {correctionModal && (
        <div className="modal-overlay" onClick={() => !correctionSaving && setCorrectionModal(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: '540px' }}>
            <h3>🚫 Exclude story</h3>
            <p style={{ color: 'var(--canary-yellow)', fontWeight: 600, fontSize: '0.85rem', marginBottom: '12px', lineHeight: 1.4 }}>{correctionModal.headline}</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginBottom: '14px' }}>The story will be hidden, not deleted. The change will be audited and can be restored from Corrections.</p>
            <textarea
              className="form-textarea"
              placeholder="Why should this story be excluded? (at least 10 characters)"
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
              rows={4}
              minLength={10}
              autoFocus
            />
            {correctionError && <p style={{ color: 'var(--red-400)', fontSize: '0.84rem', marginTop: '10px' }}>{correctionError}</p>}
            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn btn-secondary btn-sm" disabled={correctionSaving} onClick={() => setCorrectionModal(null)}>Cancel</button>
              <button className="btn btn-danger btn-sm" disabled={correctionSaving || correctionReason.trim().length < 10} onClick={handleExcludeStory}>{correctionSaving ? 'Excluding…' : 'Exclude story'}</button>
            </div>
          </div>
        </div>
      )}

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

      {paymentModalOpen && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closePaymentModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '760px', width: 'min(760px, calc(100vw - 32px))', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ marginBottom: '0.35rem' }}>Complete Canary Data payment</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                  {paymentAmountLabel}. Add your card details below; payment stays tied to your logged-in district account.
                </p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={closePaymentModal} type="button" style={{ width: 'auto' }}>×</button>
            </div>

            {paymentSuccess ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>✅</div>
                <h3>Payment Successful</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Thanks — Stripe confirmed your Canary Data payment and your account has been updated. Open Settings to download your receipt, or refresh the dashboard if the paid status is not visible yet.
                </p>
                <button className="btn btn-primary" type="button" onClick={closePaymentModal} style={{ marginTop: '1rem' }}>
                  Back to Dashboard
                </button>
              </div>
            ) : (
              <>
                {paymentError && <div className="auth-error" style={{ marginBottom: '1rem' }}><span>⚠</span> {paymentError}</div>}
                {paymentLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '220px' }}>
                    <span className="spinner" />
                  </div>
                )}
                <div id="canary-embedded-checkout" style={{ minHeight: embeddedCheckout ? '560px' : '1px' }} />
                {!paymentLoading && embeddedCheckoutSessionId && !embeddedCheckout && !paymentSuccess && !paymentError && (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Preparing secure Stripe checkout…</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {releaseSignupOpen && (
        <ReleaseSignupModal onClose={() => setReleaseSignupOpen(false)} />
      )}
    </div>
  );
}
