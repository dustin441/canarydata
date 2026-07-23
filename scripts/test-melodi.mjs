import assert from 'node:assert/strict';
import { extractMelodiCitationIds, selectMelodiContext, safeMelodiSourceUrl } from '../src/lib/melodi.mjs';

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

assert.deepEqual(extractMelodiCitationIds('Review [N2], [S1], and [N2]. Ignore [X9].'), ['N2', 'S1']);
assert.equal(safeMelodiSourceUrl('https://example.com/story'), 'https://example.com/story');
assert.equal(safeMelodiSourceUrl('javascript:alert(1)'), null);
assert.equal(safeMelodiSourceUrl('https://user:pass@example.com/private'), null);

console.log('MELODI context unit tests passed.');
