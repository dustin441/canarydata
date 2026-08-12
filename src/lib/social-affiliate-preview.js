export function normalizeSocialHandle(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function buildSocialAffiliatePreview({ claim, threads = [], now = new Date() }) {
  const account = claim?.social_accounts || {};
  const handle = normalizeSocialHandle(account.handle);
  const platform = String(account.platform || '').trim().toLowerCase();
  const seen = new Set();
  const matches = threads.filter((thread) => {
    if (!thread?.id || seen.has(thread.id)) return false;
    if (String(thread.platform || '').trim().toLowerCase() !== platform) return false;
    if (normalizeSocialHandle(thread.author_handle) !== handle) return false;
    seen.add(thread.id);
    return true;
  }).sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
  const cutoff30 = now.getTime() - (30 * 86_400_000);
  const cutoff90 = now.getTime() - (90 * 86_400_000);
  const countBy = (field) => matches.reduce((counts, row) => {
    const key = row[field] || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const sum = (field) => matches.reduce((total, row) => total + number(row[field]), 0);
  const published = matches.map((row) => Date.parse(row.published_at)).filter(Number.isFinite);
  return {
    claimId: claim.id,
    districtId: claim.district_id,
    relationshipLabel: claim.relationship_label,
    affiliateType: claim.affiliate_type,
    account: {
      id: account.id,
      displayName: account.display_name,
      platform: account.platform,
      handle: account.handle,
      active: account.active,
    },
    exactMatchRule: `${platform}:${handle}`,
    matchedPosts: matches.length,
    activePosts: matches.filter((row) => row.visibility_status === 'active').length,
    excludedPosts: matches.filter((row) => row.visibility_status === 'excluded').length,
    last30Days: published.filter((value) => value >= cutoff30).length,
    last90Days: published.filter((value) => value >= cutoff90).length,
    engagementTotal: sum('engagement_total'),
    reactions: sum('reaction_count'),
    comments: sum('comment_count'),
    replies: sum('reply_count'),
    shares: sum('share_count'),
    views: sum('view_count'),
    relationships: countBy('relationship_type'),
    visibility: countBy('visibility_status'),
    firstPublishedAt: published.length ? new Date(Math.min(...published)).toISOString() : null,
    latestPublishedAt: published.length ? new Date(Math.max(...published)).toISOString() : null,
    modeledAffiliatePosts: matches.length,
    wouldChangeStoredRows: false,
    samples: matches.slice(0, 5).map((row) => ({
      id: row.id,
      headline: row.headline,
      url: row.canonical_url,
      publishedAt: row.published_at,
      relationshipType: row.relationship_type,
      visibilityStatus: row.visibility_status,
      engagementTotal: number(row.engagement_total),
    })),
  };
}
