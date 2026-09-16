'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewSocialDiscoveryCandidate, reviewSocialDiscoveryCandidates } from '@/app/actions';
import {
  SOCIAL_DISCOVERY_BATCH_LIMIT,
  filterSocialDiscoveryCandidates,
  rankSocialDiscoveryCandidates,
  socialDiscoveryAgeHours,
  socialDiscoveryAuthor,
  socialDiscoveryConfidence,
  socialDiscoveryConfidenceBand,
  socialDiscoveryEngagement,
  socialDiscoveryPriority,
} from '@/lib/socialDiscoveryReview.mjs';

const label = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
const date = (value) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Unknown date';
const age = (candidate, now) => {
  const hours = socialDiscoveryAgeHours(candidate, now);
  if (hours === null) return 'Age unknown';
  if (hours < 1) return 'Less than 1 hour old';
  if (hours < 48) return `${Math.floor(hours)} hours old`;
  return `${Math.floor(hours / 24)} days old`;
};

export default function SocialDiscoveryReviewClient({ districts = [], initialDistrictId = null, candidates = [], health = [], available = false, referenceNow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [districtFilter, setDistrictFilter] = useState(initialDistrictId || 'all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [authorFilter, setAuthorFilter] = useState('all');
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [ageFilter, setAgeFilter] = useState('all');
  const [queryFilter, setQueryFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const districtNames = useMemo(() => new Map(districts.map((district) => [district.id, district.name])), [districts]);
  const rankedCandidates = useMemo(() => rankSocialDiscoveryCandidates(candidates), [candidates]);
  const visibleCandidates = useMemo(() => filterSocialDiscoveryCandidates(rankedCandidates, {
    districtId: districtFilter,
    priority: priorityFilter,
    platform: platformFilter,
    author: authorFilter,
    confidence: confidenceFilter,
    maxAgeDays: ageFilter === 'all' ? null : Number(ageFilter),
    query: queryFilter,
    now: referenceNow,
  }), [rankedCandidates, districtFilter, priorityFilter, platformFilter, authorFilter, confidenceFilter, ageFilter, queryFilter, referenceNow]);
  const authors = useMemo(() => [...new Set(candidates.map(socialDiscoveryAuthor))].sort((left, right) => left.localeCompare(right)), [candidates]);
  const platforms = useMemo(() => [...new Set(candidates.map((candidate) => String(candidate.platform || '').toLowerCase()).filter(Boolean))].sort(), [candidates]);
  const selectableVisible = districtFilter === 'all' ? [] : visibleCandidates.slice(0, SOCIAL_DISCOVERY_BATCH_LIMIT);
  const allVisibleSelected = Boolean(selectableVisible.length) && selectableVisible.every((candidate) => selectedIds.has(candidate.id));
  const selectedCandidates = candidates.filter((candidate) => selectedIds.has(candidate.id));

  function resetSelectionForFilter(setter, value) {
    setSelectedIds(new Set());
    setter(value);
  }

  function toggleCandidate(candidate) {
    setError('');
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidate.id)) {
        next.delete(candidate.id);
      } else {
        const selectedDistrict = candidates.find((item) => next.has(item.id))?.district_id;
        if (selectedDistrict && selectedDistrict !== candidate.district_id) {
          setError('Batch reviews must contain candidates from one district. Filter to a district or clear the current selection.');
          return current;
        }
        if (next.size < SOCIAL_DISCOVERY_BATCH_LIMIT) next.add(candidate.id);
      }
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
        await reviewSocialDiscoveryCandidate({ districtId: candidate.district_id, candidateId: candidate.id, action, expectedVersion: candidate.review_version, reviewerNote: note, idempotencyKey: crypto.randomUUID() });
        setSelectedIds((current) => { const next = new Set(current); next.delete(candidate.id); return next; });
        router.refresh();
      } catch (reviewError) {
        setError(reviewError?.message || 'Unable to review candidate.');
      }
    });
  }

  function reviewBatch(action) {
    if (!selectedCandidates.length) return;
    const selectedDistricts = new Set(selectedCandidates.map((candidate) => candidate.district_id));
    if (selectedDistricts.size !== 1) {
      setError('Batch reviews must contain candidates from one district.');
      return;
    }
    const verb = action === 'approve' ? 'approve' : 'reject';
    const note = window.prompt(`Add one review note for all ${selectedCandidates.length} selected candidates:`);
    if (!note?.trim()) return;
    if (!window.confirm(`${label(verb)} ${selectedCandidates.length} selected candidate${selectedCandidates.length === 1 ? '' : 's'}? Every decision remains individually version-checked and audited.`)) return;
    setError('');
    setNotice('');
    startTransition(async () => {
      try {
        const result = await reviewSocialDiscoveryCandidates({
          districtId: selectedCandidates[0].district_id,
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

  return <>
    <section className="affiliate-admin-panel public-conversation-health-panel">
      <div><span>District visibility</span><h2>Public Conversation health</h2><p>Enrollment, latest provider run, pending-review pressure, and the newest client-visible ambient item by district.</p></div>
      <div className="public-conversation-health-table-wrap"><table className="public-conversation-health-table"><thead><tr><th>District</th><th>Enrolled</th><th>Latest run</th><th>Provider errors</th><th>Pending</th><th>Latest visible ambient item</th></tr></thead><tbody>{health.map((row) => <tr key={row.districtId}>
        <th scope="row">{row.districtName}</th>
        <td>{row.enrolled ? 'Yes' : 'No'}</td>
        <td><strong>{label(row.latestRunStatus || row.status)}</strong><small>{row.latestActivityAt ? date(row.latestActivityAt) : 'No terminal run'}{row.latestRunError ? ` · ${row.latestRunError}` : ''}</small></td>
        <td>{row.latestProviderErrors ?? 0}</td>
        <td>{row.pendingCandidateCount ?? 0}</td>
        <td>{row.latestVisibleAmbientItem ? <><a href={row.latestVisibleAmbientItem.canonicalUrl || '#'} target="_blank" rel="noreferrer">{row.latestVisibleAmbientItem.excerpt || 'Open visible item'}</a><small>{row.latestVisibleAmbientItem.author} · {date(row.latestVisibleAmbientItem.publishedAt)}</small></> : 'None visible'}</td>
      </tr>)}</tbody></table></div>
    </section>

    <section className="affiliate-admin-panel social-discovery-review-panel">
      <div><span>Human approval gate</span><h2>Public Conversation review queue</h2><p>Provider discoveries remain server-only until a Canary administrator approves them. Approvals create client-visible ambient Social items; rejections remain audited.</p></div>
      {!available ? <p className="social-affiliate-message">Candidate staging is not active in this environment. Unreviewed discoveries remain unavailable to clients.</p> : <>
        <div className="social-discovery-review-toolbar">
          <label>District<select value={districtFilter} onChange={(event) => resetSelectionForFilter(setDistrictFilter, event.target.value)}><option value="all">All districts</option>{districts.map((district) => <option key={district.id} value={district.id}>{district.name}</option>)}</select></label>
          <label>Platform<select value={platformFilter} onChange={(event) => resetSelectionForFilter(setPlatformFilter, event.target.value)}><option value="all">All platforms</option>{platforms.map((platform) => <option key={platform} value={platform}>{label(platform)}</option>)}</select></label>
          <label>Confidence<select value={confidenceFilter} onChange={(event) => resetSelectionForFilter(setConfidenceFilter, event.target.value)}><option value="all">All confidence</option><option value="high">High (80%+)</option><option value="medium">Medium (50–79%)</option><option value="low">Low (&lt;50%)</option><option value="unknown">Unknown</option></select></label>
          <label>Age<select value={ageFilter} onChange={(event) => resetSelectionForFilter(setAgeFilter, event.target.value)}><option value="all">Any age</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
          <label>Priority<select value={priorityFilter} onChange={(event) => resetSelectionForFilter(setPriorityFilter, event.target.value)}><option value="all">All priorities</option><option value="urgent">Urgent / risk</option><option value="high">High engagement / direct</option><option value="standard">Standard</option></select></label>
          <label>Author<select value={authorFilter} onChange={(event) => resetSelectionForFilter(setAuthorFilter, event.target.value)}><option value="all">All authors</option>{authors.map((author) => <option key={author} value={author.toLowerCase()}>{author}</option>)}</select></label>
          <label>Search<input value={queryFilter} onChange={(event) => resetSelectionForFilter(setQueryFilter, event.target.value)} placeholder="Excerpt or author" /></label>
          <span>{visibleCandidates.length} shown · {candidates.length} pending</span>
        </div>
        <div className="social-discovery-batch-bar">
          <label><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} disabled={pending || !selectableVisible.length} /> {districtFilter === 'all' ? 'Choose one district to select visible' : `Select visible${visibleCandidates.length > SOCIAL_DISCOVERY_BATCH_LIMIT ? ` (first ${SOCIAL_DISCOVERY_BATCH_LIMIT})` : ''}`}</label>
          <span>{selectedCandidates.length}/{SOCIAL_DISCOVERY_BATCH_LIMIT} selected</span>
          <button disabled={pending || !selectedCandidates.length} onClick={() => reviewBatch('reject')}>Reject selected</button>
          <button className="btn btn-primary" disabled={pending || !selectedCandidates.length} onClick={() => reviewBatch('approve')}>Approve selected</button>
        </div>
        {!visibleCandidates.length ? <p>No pending candidates match these filters.</p> : <div className="social-discovery-candidate-list">{visibleCandidates.map((candidate) => {
          const item = candidate.candidate_payload || {};
          const priority = socialDiscoveryPriority(candidate);
          const engagement = socialDiscoveryEngagement(candidate);
          const confidence = socialDiscoveryConfidence(candidate);
          return <article key={candidate.id} className={`social-discovery-priority-${priority}`}>
            <header><label className="social-discovery-select"><input type="checkbox" checked={selectedIds.has(candidate.id)} onChange={() => toggleCandidate(candidate)} disabled={pending || (!selectedIds.has(candidate.id) && selectedIds.size >= SOCIAL_DISCOVERY_BATCH_LIMIT)} /><span>Select</span></label><div><strong>{String(item.headline || item.body || 'Public Conversation candidate').slice(0, 180)}</strong><span>{districtNames.get(candidate.district_id) || candidate.district_id} · {socialDiscoveryAuthor(candidate)} · {label(candidate.platform)}</span></div><small>{label(priority)} priority · version {candidate.review_version}</small></header>
            <p>{String(item.body || item.headline || '').replace(/\s+/g, ' ').slice(0, 500)}</p><div className="social-discovery-evidence"><span>{age(candidate, referenceNow)}</span><span>{confidence === null ? 'Confidence unknown' : `${Math.round(confidence * 100)}% confidence (${socialDiscoveryConfidenceBand(candidate)})`}</span><span>{label(candidate.relationship_type)}</span><span>Provider: {label(candidate.provider)}</span><span>Engagement: {engagement}</span><span>Last seen: {date(candidate.last_seen_at)}</span></div>
            <div className="social-discovery-actions"><a href={candidate.canonical_url} target="_blank" rel="noreferrer">Open canonical source</a><button disabled={pending} onClick={() => review(candidate, 'reject')}>Reject</button><button className="btn btn-primary" disabled={pending} onClick={() => review(candidate, 'approve')}>Approve for client feed</button></div>
          </article>;
        })}</div>}
      </>}
      {notice && <p className="social-affiliate-message" role="status">{notice}</p>}
      {error && <p className="social-affiliate-message error" role="alert">{error}</p>}
    </section>
  </>;
}
