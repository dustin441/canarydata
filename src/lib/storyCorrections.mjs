const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid',
  'igshid', 'ref', 'source',
]);

export function canonicalizeStoryUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('A story URL is required.');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a valid story URL.');
  }

  if (url.protocol !== 'https:') throw new Error('Story URLs must use HTTPS.');

  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

export function requireCorrectionReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 10) throw new Error('Please provide a reason of at least 10 characters.');
  return reason;
}
