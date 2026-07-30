import assert from 'node:assert/strict';
import { articleMatchesSearch, textMatchesWholeSearchTerms } from '../src/lib/articleSearch.mjs';

assert.equal(textMatchesWholeSearchTerms('student killed in crash', 'killed'), true);
assert.equal(textMatchesWholeSearchTerms('students built skilled career pathways', 'killed'), false);
assert.equal(textMatchesWholeSearchTerms('The district said the student died.', 'died'), true);
assert.equal(textMatchesWholeSearchTerms('studied attendance data', 'died'), false);
assert.equal(textMatchesWholeSearchTerms('Klein Collins High School student', 'klein student'), true);
assert.equal(textMatchesWholeSearchTerms('Safe & Wellness', '&'), true);

const coach = {
  headline: 'Countdown to kickoff: Chip English enters third season as head coach',
  summary: 'The coach discussed practice and the upcoming football season.',
  recommendation: 'Promote the season preview.',
};
assert.equal(articleMatchesSearch(coach, 'died'), false, 'unrelated coach coverage must not match a death search');

const tragedy = {
  headline: 'Klein ISD student killed in mini-bike crash',
  summary: 'The district offered counseling and grief resources.',
};
assert.equal(articleMatchesSearch(tragedy, 'killed'), true);
assert.equal(articleMatchesSearch(tragedy, 'grief'), true);

console.log('Article search whole-term checks passed.');
