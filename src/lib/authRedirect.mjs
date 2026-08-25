export function safeNextPath(value, origin, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;

  try {
    const resolved = new URL(value, origin);
    if (resolved.origin !== origin) return fallback;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return fallback;
  }
}
