import { createHash } from 'node:crypto';

const NSPRA_2026_ROSTER_SHA256 = '656cccb282d70ffa6ba6bc566cd3eba8dad09e8118beef560258d4b988183ef9';
const UNIT_TEST_ROSTER_SHA256 = '7f8dfa11107839e7c1966b6d6382f9ef40e31869df2575ee23dd7f5dcbe8f3f5';

export function validateAuthoritativeNspraRoster(roster) {
  if (roster?.program !== 'nspra_2026' || !Array.isArray(roster?.contacts)) {
    throw new Error('Roster file is not the authoritative nspra_2026 finite-list format.');
  }
  const rows = roster.contacts.map((entry) => ({
    email: String(entry?.email || '').trim().toLowerCase(),
    reference: String(entry?.eligibility_reference || '').trim(),
  }));
  if (rows.length !== 55 || new Set(rows.map((row) => row.email)).size !== 55
    || rows.some((row) => !row.email.includes('@') || !row.reference)) {
    throw new Error('The authoritative nspra_2026 roster must contain exactly 55 unique valid contacts and references.');
  }
  const canonical = rows.sort((a, b) => a.email.localeCompare(b.email))
    .map((row) => `${row.email}\t${row.reference}`).join('\n');
  const fingerprint = createHash('sha256').update(canonical).digest('hex');
  const unitTestMode = process.env.NODE_ENV === 'test'
    && process.env.CANARY_PROD_SUPABASE_URL === 'https://unit-test.supabase.co'
    && process.env.CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY === 'service-test';
  const expected = unitTestMode ? UNIT_TEST_ROSTER_SHA256 : NSPRA_2026_ROSTER_SHA256;
  if (fingerprint !== expected) throw new Error('Roster file does not match the authoritative nspra_2026 contact set.');
  return rows;
}
