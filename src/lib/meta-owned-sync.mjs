import { normalizeProviderBatch } from './socialIngestion.mjs';

const SUPPORTED_META_ASSET_TYPES = new Set(['facebook_page', 'instagram_account']);
export const META_INITIAL_BACKFILL_DAYS = 90;

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function boundedMetaSourceCutoff(value, now = new Date()) {
  const floor = new Date(now.getTime() - META_INITIAL_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  if (!value) return floor.toISOString();
  const requested = new Date(value);
  if (Number.isNaN(requested.getTime()) || requested > now) throw new Error('Meta sync cutoff must be a valid past timestamp.');
  return new Date(Math.max(requested.getTime(), floor.getTime())).toISOString();
}

export function continuedMetaSourceCutoff(value, now = new Date()) {
  const requested = new Date(value);
  const oldestAllowed = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(requested.getTime()) || requested > now || requested < oldestAllowed) {
    throw new Error('Meta continuation cutoff must remain within its fixed safe window.');
  }
  return requested.toISOString();
}

function metaProviderError(providerError) {
  if (!providerError) return null;
  return {
    code: String(providerError.code || providerError.type || 'META_PROVIDER_ERROR'),
    message: String(providerError.message || 'Meta could not complete the selected-asset read.').slice(0, 300),
  };
}

function facebookItem(asset, row) {
  const commentsAvailable = row?.comments?.summary?.total_count != null || row?.comments_count != null;
  const reactionsAvailable = row?.reactions?.summary?.total_count != null || row?.reactions_count != null;
  const sharesAvailable = row?.shares?.count != null || row?.shares_count != null;
  const comments = count(row?.comments?.summary?.total_count ?? row?.comments_count);
  const reactions = count(row?.reactions?.summary?.total_count ?? row?.reactions_count);
  const shares = count(row?.shares?.count ?? row?.shares_count);
  return {
    platform: 'facebook',
    external_thread_id: row?.id,
    canonical_url: row?.permalink_url,
    relationship_type: 'owned',
    author_name: row?.from?.name || asset?.name || null,
    author_handle: asset?.handle || null,
    body: row?.message || row?.story || 'Facebook Page post',
    published_at: row?.created_time,
    comment_count: comments,
    reaction_count: reactions,
    share_count: shares,
    engagement_total: comments + reactions + shares,
    identity_confidence: 1,
    visibility_status: 'active',
    provider_metadata: {
      provider_asset_id: asset?.id,
      provider_page_id: asset?.provider_asset_id,
      source: 'meta_graph',
      metric_availability: { comments: commentsAvailable, reactions: reactionsAvailable, shares: sharesAvailable, views: false },
    },
  };
}

function instagramItem(asset, row) {
  const comments = count(row?.comments_count);
  const reactions = count(row?.like_count);
  return {
    platform: 'instagram',
    external_thread_id: row?.id,
    canonical_url: row?.permalink,
    relationship_type: 'owned',
    author_name: asset?.name || null,
    author_handle: row?.username || asset?.handle || null,
    body: row?.caption || 'Instagram media',
    published_at: row?.timestamp,
    comment_count: comments,
    reaction_count: reactions,
    share_count: 0,
    engagement_total: comments + reactions,
    identity_confidence: 1,
    visibility_status: 'active',
    provider_metadata: {
      provider_asset_id: asset?.id,
      provider_instagram_id: asset?.provider_asset_id,
      parent_provider_page_id: asset?.parent_provider_asset_id || null,
      media_type: row?.media_type || null,
      media_product_type: row?.media_product_type || null,
      source: 'meta_graph',
      metric_availability: { comments: true, reactions: true, shares: false, views: false },
    },
  };
}

function mapBatch({ districtId, asset, rows, providerError, mapper }) {
  if (!districtId) throw new Error('District is required for Meta selected-asset sync.');
  if (!asset?.id || !asset?.provider_asset_id) throw new Error('A tenant-bound Meta provider asset is required.');
  return normalizeProviderBatch({
    provider: 'meta',
    districtId,
    items: Array.isArray(rows) ? rows.map((row) => mapper(asset, row)) : [],
    providerError: metaProviderError(providerError),
  });
}

export function mapFacebookPagePosts({ districtId, asset, rows = [], providerError = null }) {
  if (asset?.asset_type && asset.asset_type !== 'facebook_page') throw new Error('Expected a Facebook Page asset.');
  return mapBatch({ districtId, asset, rows, providerError, mapper: facebookItem });
}

export function mapInstagramMedia({ districtId, asset, rows = [], providerError = null }) {
  if (asset?.asset_type && asset.asset_type !== 'instagram_account') throw new Error('Expected an Instagram account asset.');
  return mapBatch({ districtId, asset, rows, providerError, mapper: instagramItem });
}

export function validateMetaSyncSelection(assets) {
  const selected = Array.isArray(assets) ? assets : [];
  let facebookPages = 0;
  let instagramAccounts = 0;
  for (const asset of selected) {
    if (!asset?.active || !asset?.selected) throw new Error('Every Meta sync asset must be active and selected.');
    if (!SUPPORTED_META_ASSET_TYPES.has(asset.asset_type)) throw new Error('An unsupported selected Meta asset was provided.');
    if (asset.asset_type === 'facebook_page') facebookPages += 1;
    if (asset.asset_type === 'instagram_account') instagramAccounts += 1;
  }
  return { facebookPages, instagramAccounts };
}

export function summarizeMetaSyncOutcome(batches) {
  const rows = Array.isArray(batches) ? batches : [];
  const accountsSucceeded = rows.filter((batch) => ['success', 'empty'].includes(batch.status)).length;
  const postsRead = rows.reduce((total, batch) => total + (batch.threads?.length || 0), 0);
  const rejectedItems = rows.reduce((total, batch) => total + (batch.rejected?.length || 0), 0);
  const providerErrors = rows.reduce((total, batch) => total + Number(batch.providerErrors || 0), 0);
  const hasFailure = rows.some((batch) => batch.status === 'failed');
  const hasUseful = rows.some((batch) => ['success', 'empty', 'partial'].includes(batch.status));
  const hasPartial = rows.some((batch) => batch.status === 'partial');
  const allEmpty = rows.length > 0 && rows.every((batch) => batch.status === 'empty');
  return {
    status: hasFailure ? (hasUseful && rows.length > 1 ? 'partial' : 'failed') : hasPartial ? 'partial' : allEmpty ? 'empty' : 'success',
    accountsAttempted: rows.length,
    accountsSucceeded,
    postsRead,
    rejectedItems,
    providerErrors,
  };
}
