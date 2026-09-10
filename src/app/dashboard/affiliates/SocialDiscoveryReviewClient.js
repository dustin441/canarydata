'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewSocialDiscoveryCandidate, reviewSocialDiscoveryCandidates } from '@/app/actions';
import {
  SOCIAL_DISCOVERY_BATCH_LIMIT,
  filterSocialDiscoveryCandidates,
  rankSocialDiscoveryCandidates,
  socialDiscoveryAuthor,
  socialDiscoveryEngagement,
  socialDiscoveryPriority,
} from '@/lib/socialDiscoveryReview.mjs';

const label = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
const date = (value) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : 'Unknown date';

export default function SocialDiscoveryReviewClient({ districtId, candidates = [], available = false }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [authorFilter, setAuthorFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const rankedCandidates = useMemo(() => rankSocialDiscoveryCandidates(candidates), [candidates]);
  const visibleCandidates = useMemo(() => filterSocialDiscoveryCandidates(rankedCandidates, {
    priority: priorityFilter,
    platform: platformFilter,
    author: authorFilter,
  }), [rankedCandidates, priorityFilter, platformFilter, authorFilter]);
  const authors = useMemo(() => [...new Set(candidates.map(socialDiscoveryAuthor))].sort((left, right) => left.localeCompare(right)), [candidates]);
  const platforms = useMemo(() => [...new Set(candidates.map((candidate) => String(candidate.platform || '').toLowerCase()).filter(Boolean))].sort(), [candidates]);
  const selectableVisible = visibleCandidates.slice(0, SOCIAL_DISCOVERY_BATCH_LIMIT);
  const allVisibleSelected = Boolean(selectableVisible.length) && selectableVisible.every((candidate) => selectedIds.has(candidate.id));
  const selectedCandidates = candidates.filter((candidate) => selectedIds.has(candidate.id));

  function toggleCandidate(candidateId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else if (next.size < SOCIAL_DISCOVERY_BATCH_LIMIT) next.add(candidateId);
      return next;
    });
  }

  function toggleVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) selectableVisible.forEach((candidate) => next.delete(candidate.id));
      else selectableVisible.forEach((candidate) => next.add(candidate.id));
      return next;
    });
  }

  function review(candidate, action) {
    const verb = action === 'approve' ? 'approve this candidate for the client Social feed' : 'reject this candidate';
    const note = window.prompt(`Why do you want to ${verb}?`);
    if (!note?.trim()) return;
    setError('');
    setNotice('');
    startTransition(async () => {
      try {
        await reviewSocialDiscoveryCandidate({ districtId, candidateId: candidate.id, action, expectedVersion: candidate.review_version, reviewerNote: note, idempotencyKey: crypto.randomUUID() });
        setSelectedIds((current) => { const next = new Set(current); next.delete(candidate.id); return next; });
        router.refresh();
      } catch (reviewError) {
        setError(reviewError?.message || 'Unable to review candidate.');
      }
    });
  }

  function reviewBatch(action) {
    if (!selectedCandidates.length) return;
    const verb = action === 'approve' ? 'approve' : 'reject';
    const note = window.prompt(`Add one review note for all ${selectedCandidates.length} selected candidates:`);
    if (!note?.trim()) return;
    if (!window.confirm(`${label(verb)} ${selectedCandidates.length} selected candidate${selectedCandidates.length === 1 ? '' : 's'}? Every decision remains individually audited and reversible.`)) return;
    setError('');
    setNotice('');
    startTransition(async () => {
      try {
        const result = await reviewSocialDiscoveryCandidates({
          districtId,
          action,
          reviewerNote: note,
          idempotencyKey: crypto.randomUUID(),
          items: selectedCandidates.map((candidate) => ({ candidateId: candidate.id, expectedVersion: candidate.review_version })),
        });
        const completed = result?.reviewed?.length || 0;
        const failed = result?.failed?.length || 0;
        setNotice(`${completed} candidate${completed === 1 ? '' : 's'} ${action === 'approve' ? 'approved' : 'rejected'}${failed ? `; ${failed} failed and need a refresh.` : '.'}`);
        if (failed) setError(result.failed.map((item) => item.message).join(' '));
        setSelectedIds(new Set());
        router.refresh();
      } catch (reviewError) {
        setError(reviewError?.message || 'Unable to review selected candidates.');
      }
    });
  }

  return <section className="affiliate-admin-panel social-discovery-review-panel">
    <div><span>Human approval gate</span><h2>Prioritized public conversation review</h2><p>Provider discoveries remain server-only until a Canary administrator approves them. Review urgent and high-engagement mentions first, then batch decisions by district, platform, or author.</p></div>
    {!available ? <p className="social-affiliate-message">Candidate staging is not active in production yet. The provider workflows remain paused.</p> :
      !candidates.length ? <p>No pending candidates for this district.</p> : <>
        <div className="social-discovery-review-toolbar">
          <label>Priority<select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">All priorities</option><option value="urgent">Urgent / risk</option><option value="high">High engagement / direct</option><option value="standard">Standard</option></select></label>
          <label>Platform<select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}><option value="all">All platforms</option>{platforms.map((platform) => <option key={platform} value={platform}>{label(platform)}</option>)}</select></label>
          <label>Author<select value={authorFilter} onChange={(event) => setAuthorFilter(event.target.value)}><option value="all">All authors</option>{authors.map((author) => <option key={author} value={author.toLowerCase()}>{author}</option>)}</select></label>
          <span>{visibleCandidates.length} shown · {candidates.length} pending</span>
        </div>
        <div className="social-discovery-batch-bar">
          <label><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} disabled={pending || !selectableVisible.length} /> Select visible{visibleCandidates.length > SOCIAL_DISCOVERY_BATCH_LIMIT ? ` (first ${SOCIAL_DISCOVERY_BATCH_LIMIT})` : ''}</label>
          <span>{selectedCandidates.length}/{SOCIAL_DISCOVERY_BATCH_LIMIT} selected</span>
          <button disabled={pending || !selectedCandidates.length} onClick={() => reviewBatch('reject')}>Reject selected</button>
          <button className="btn btn-primary" disabled={pending || !selectedCandidates.length} onClick={() => reviewBatch('approve')}>Approve selected</button>
        </div>
        <div className="social-discovery-candidate-list">{visibleCandidates.map((candidate) => {
          const item = candidate.candidate_payload || {};
          const priority = socialDiscoveryPriority(candidate);
          const engagement = socialDiscoveryEngagement(candidate);
          return <article key={candidate.id} className={`social-discovery-priority-${priority}`}>
            <header><label className="social-discovery-select"><input type="checkbox" checked={selectedIds.has(candidate.id)} onChange={() => toggleCandidate(candidate.id)} disabled={pending || (!selectedIds.has(candidate.id) && selectedIds.size >= SOCIAL_DISCOVERY_BATCH_LIMIT)} /><span>Select</span></label><div><strong>{String(item.headline || item.body || 'Public Social candidate').slice(0, 180)}</strong><span>{socialDiscoveryAuthor(candidate)} · {label(candidate.platform)} · {date(item.published_at)}</span></div><small>{label(priority)} priority · version {candidate.review_version}</small></header>
            <p>{String(item.body || '').slice(0, 500)}</p><div className="social-discovery-evidence"><span>{label(candidate.relationship_type)}</span><span>Provider: {label(candidate.provider)}</span><span>Engagement: {engagement}</span><span>Last seen: {date(candidate.last_seen_at)}</span></div>
            <div className="social-discovery-actions"><a href={candidate.canonical_url} target="_blank" rel="noreferrer">Open source</a><button disabled={pending} onClick={() => review(candidate, 'reject')}>Reject</button><button className="btn btn-primary" disabled={pending} onClick={() => review(candidate, 'approve')}>Approve for client feed</button></div>
          </article>;
        })}</div>
      </>}
    {notice && <p className="social-affiliate-message" role="status">{notice}</p>}
    {error && <p className="social-affiliate-message error" role="alert">{error}</p>}
  </section>;
}
