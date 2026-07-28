import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildOnboardingTask, onboardingPayloadFromRow } from '../src/lib/onboardingClickup.mjs';

const actionsSource = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');

const request = {
  id: 'onboarding-parity-id',
  created_at: '2026-07-28T12:00:00.000Z',
  organization_name: 'Parity Public Schools',
  website: 'https://parity.example',
  contact_name: 'Pat Parity',
  contact_email: 'pat@parity.example',
  contact_title: 'Communications Director',
  city: 'Mesa',
  state: 'AZ',
  zip: '85201',
  social_handles: '@parityschools',
  keywords: 'Parity Panthers',
  school_names: 'Parity High School',
  known_exclusions: 'Parity, France',
  current_monitoring: 'Manual alerts',
  notes: 'Launch in August',
  confirmed_profile: {
    mission_vision_values: 'Every learner thrives',
    strategic_priorities: 'Literacy and belonging',
    social_handles: '@parityschools',
    keywords: 'Panthers',
    school_names: 'Parity High School',
    known_exclusions: 'Parity, France',
    discovered_source_urls: 'https://parity.example/strategy',
    discovery_notes: 'Confirmed by customer',
  },
};

const directTask = buildOnboardingTask(request);
const fallbackRow = {
  id: request.id,
  created_at: request.created_at,
  _source: 'feedback',
  message: `30-day trial onboarding request confirmed by prospect.\n\nRaw intake:\n${JSON.stringify(request)}`,
};
const recovered = onboardingPayloadFromRow(fallbackRow);
const retryTask = buildOnboardingTask(fallbackRow);
assert.equal(recovered.organization_name, request.organization_name);
assert.deepEqual(retryTask, directTask, 'fallback retry payload must equal direct onboarding payload');
for (const expected of [
  request.contact_title,
  request.city,
  request.social_handles,
  request.keywords,
  request.school_names,
  request.known_exclusions,
  request.current_monitoring,
  request.notes,
  request.confirmed_profile.mission_vision_values,
  request.confirmed_profile.strategic_priorities,
  request.confirmed_profile.discovered_source_urls,
  request.confirmed_profile.discovery_notes,
]) assert.match(retryTask.markdown_content, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.equal(retryTask.name, '[Trial onboarding] Parity Public Schools');
assert.deepEqual(retryTask.tags, ['trial-onboarding', 'canary-data']);
assert.doesNotMatch(actionsSource, /id: saved\.id,\s*clickup_task_url:/, 'internal ClickUp task links must never cross the client-facing server-action boundary');

console.log('Onboarding ClickUp payload parity tests passed.');
