import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/news_stories_tenant_identity.sql', import.meta.url), 'utf8');

assert.match(sql, /lock table public\.news_stories in share row exclusive mode/i);
assert.match(sql, /group by district_id, canonical_url[\s\S]*having count\(\*\) > 1/i);
assert.match(sql, /drop constraint if exists news_stories_link_key/i);
assert.match(sql, /create unique index if not exists news_stories_district_canonical_url_all_uidx[\s\S]*\(district_id, canonical_url\)/i);
assert.doesNotMatch(sql, /delete from public\.news_stories/i, 'identity migration must not delete customer data');
assert.doesNotMatch(sql, /drop table/i, 'identity migration must not drop product tables');

console.log('Canary tenant-scoped story identity migration checks passed.');
