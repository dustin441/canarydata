import assert from 'node:assert/strict';
import { extractMelodiCitationIds, selectMelodiContext, safeMelodiSourceUrl, stableMelodiCitationId, validateMelodiAnswer } from '../src/lib/melodi.mjs';

const news = [
  { id: 'n-old', date: '2026-05-01', headline: 'Graduation ceremony', summary: 'Students graduate', canary_score: 90, link: 'https://news.example/old' },
  { id: 'n-bus', date: '2026-07-20', headline: 'Bus route changes', summary: 'Transportation schedule changes for families', canary_score: 70, link: 'https://news.example/bus' },
  { id: 'n-board', date: '2026-07-18', headline: 'Board celebrates literacy gains', summary: 'Reading outcomes improved', canary_score: 88, link: 'https://news.example/literacy' },
];
const social = [
  { id: 's-high', published_at: '2026-07-21', headline: 'Health fair photos', body: 'Community health fair', engagement_total: 120, canonical_url: 'https://social.example/high' },
  { id: 's-low', published_at: '2026-07-22', headline: 'Bus question', body: 'Is the bus schedule changing?', engagement_total: 4, canonical_url: 'https://social.example/low' },
];

const busContext = selectMelodiContext({ question: 'What is happening with bus transportation?', news, social, now: new Date('2026-07-23T12:00:00Z') });
assert.equal(busContext.news[0].id, 'n-bus');
assert.equal(busContext.social[0].id, 's-low');

const topContext = selectMelodiContext({ question: 'What are our top social posts in the last 30 days?', news, social, now: new Date('2026-07-23T12:00:00Z') });
assert.equal(topContext.social[0].id, 's-high');
assert.equal(topContext.news.some((item) => item.id === 'n-old'), false);

const stableNewsId = stableMelodiCitationId('N', { id: '6f0bb1da-d8ca-4989-9171-337c057aafe7' });
assert.equal(stableNewsId, 'N-6F0BB1DAD8CA');
assert.equal(stableMelodiCitationId('N', { id: '6f0bb1da-d8ca-4989-9171-337c057aafe7' }), stableNewsId);
assert.deepEqual(extractMelodiCitationIds(`Review [${stableNewsId}], [S-ABC12345], and [${stableNewsId}]. Ignore [X-9999].`), [stableNewsId, 'S-ABC12345']);
assert.equal(validateMelodiAnswer(`## Finding\nThe bus schedule changed [${stableNewsId}].`, new Set([stableNewsId])).valid, true);
assert.equal(validateMelodiAnswer('The bus schedule changed without evidence.', new Set([stableNewsId])).valid, false);
assert.equal(validateMelodiAnswer('The bus schedule changed [N-UNKNOWN123].', new Set([stableNewsId])).valid, false);
assert.equal(safeMelodiSourceUrl('https://example.com/story'), 'https://example.com/story');
assert.equal(safeMelodiSourceUrl('javascript:alert(1)'), null);
assert.equal(safeMelodiSourceUrl('https://user:pass@example.com/private'), null);

console.log('MELODI context unit tests passed.');
