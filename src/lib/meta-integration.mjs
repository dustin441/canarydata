import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
export const META_REQUIRED_SCOPES = Object.freeze([
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'ads_read',
]);

export function metaConfigured() {
  return Boolean(
    process.env.META_APP_ID
    && process.env.META_APP_SECRET
    && process.env.META_TOKEN_ENCRYPTION_KEY
    && process.env.META_REDIRECT_URI
  );
}

export function metaDeletionConfigured() {
  return Boolean(process.env.META_APP_SECRET && process.env.META_REDIRECT_URI);
}

export function createOauthState() {
  const state = randomBytes(32).toString('base64url');
  return { state, stateHash: hashOauthState(state) };
}

export function hashOauthState(state) {
  return createHash('sha256').update(String(state || '')).digest('hex');
}

function encryptionKey() {
  const raw = String(process.env.META_TOKEN_ENCRYPTION_KEY || '');
  let key;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32) {
    throw new Error('META_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export function encryptMetaToken(token, aad) {
  if (!token) return null;
  if (!aad) throw new Error('Meta token encryption context is required.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptMetaToken(value, aad) {
  if (!aad) throw new Error('Meta token decryption context is required.');
  const [version, ivText, tagText, ciphertextText] = String(value || '').split('.');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) throw new Error('Invalid encrypted Meta token.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAAD(Buffer.from(String(aad), 'utf8'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function metaAppSecretProof(accessToken) {
  return createHmac('sha256', process.env.META_APP_SECRET).update(accessToken).digest('hex');
}

export function buildMetaAuthorizationUrl(state) {
  if (!metaConfigured()) throw new Error('Meta integration is not configured.');
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    state,
    response_type: 'code',
    scope: META_REQUIRED_SCOPES.join(','),
    auth_type: 'rerequest',
  });
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

function safeGraphError(payload, fallback) {
  const code = payload?.error?.code ? String(payload.error.code) : 'meta_request_failed';
  const type = payload?.error?.type ? String(payload.error.type) : 'MetaError';
  const message = payload?.error?.message ? String(payload.error.message).slice(0, 300) : fallback;
  const error = new Error(message);
  error.code = code;
  error.type = type;
  return error;
}

export async function metaGraph(path, accessToken, params = {}) {
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null)),
  );
  const relativePath = String(path).replace(/^\//, '');
  const relativeUrl = `${relativePath}${query.size ? `?${query.toString()}` : ''}`;
  const body = new URLSearchParams({
    access_token: accessToken,
    appsecret_proof: metaAppSecretProof(accessToken),
    batch: JSON.stringify([{ method: 'GET', relative_url: relativeUrl }]),
  });
  const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
  });
  const batchPayload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(batchPayload) || batchPayload.length !== 1) {
    throw safeGraphError(batchPayload, 'Meta could not complete the request.');
  }
  const result = batchPayload[0];
  const payload = JSON.parse(result?.body || '{}');
  if (Number(result?.code) < 200 || Number(result?.code) >= 300 || payload?.error) {
    throw safeGraphError(payload, 'Meta could not complete the request.');
  }
  return payload;
}

export async function metaGraphAll(path, accessToken, params = {}, maxPages = 20) {
  const rows = [];
  const seenCursors = new Set();
  let payload = await metaGraph(path, accessToken, params);
  for (let page = 0; page < maxPages; page += 1) {
    rows.push(...(Array.isArray(payload?.data) ? payload.data : []));
    const next = payload?.paging?.next;
    if (!next) break;
    const nextUrl = new URL(next);
    if (nextUrl.hostname !== 'graph.facebook.com') throw new Error('Meta pagination returned an unsupported host.');
    const after = payload?.paging?.cursors?.after || nextUrl.searchParams.get('after');
    if (!after || seenCursors.has(after)) throw new Error('Meta pagination returned an invalid cursor.');
    if (page === maxPages - 1) throw new Error('Meta pagination exceeded the safe page limit.');
    seenCursors.add(after);
    payload = await metaGraph(path, accessToken, { ...params, after });
  }
  return rows;
}

export async function exchangeMetaCode(code) {
  const body = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: process.env.META_REDIRECT_URI,
    code,
  });
  const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) throw safeGraphError(payload, 'Meta authorization code exchange failed.');
  return payload;
}

export async function exchangeLongLivedMetaToken(shortLivedToken) {
  const body = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });
  const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) throw safeGraphError(payload, 'Meta long-lived token exchange failed.');
  return payload;
}

export async function revokeMetaPermissions(accessToken) {
  const body = new URLSearchParams({
    access_token: accessToken,
    appsecret_proof: metaAppSecretProof(accessToken),
  });
  const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/permissions`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw safeGraphError(payload, 'Meta permissions could not be revoked.');
  return payload;
}

export function tokenExpiry(expiresIn) {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function constantTimeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyMetaSignedRequest(signedRequest) {
  const [signatureText, payloadText] = String(signedRequest || '').split('.');
  if (!signatureText || !payloadText) throw new Error('Invalid Meta signed request.');
  const signature = Buffer.from(signatureText, 'base64url');
  const expected = createHmac('sha256', process.env.META_APP_SECRET).update(payloadText).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    throw new Error('Invalid Meta signed request signature.');
  }
  const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8'));
  if (String(payload?.algorithm || '').toUpperCase() !== 'HMAC-SHA256' || !payload?.user_id) {
    throw new Error('Invalid Meta signed request payload.');
  }
  return payload;
}

export function sanitizeReturnPath(value) {
  const path = String(value || '');
  return path.startsWith('/dashboard/integrations') ? path : '/dashboard/integrations';
}
