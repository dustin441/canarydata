import assert from 'node:assert/strict';
import fs from 'node:fs';

const guardrails = fs.readFileSync(new URL('./n8n/canary-ai-sensitive-incident-guardrails.txt', import.meta.url), 'utf8');
const deployment = fs.readFileSync(new URL('./n8n/apply-lesley-followup.py', import.meta.url), 'utf8');
assert.match(deployment, /canary-ai-sensitive-incident-guardrails\.txt/);
assert.match(deployment, /canary-live-validate-shadow-candidate\.js/);
assert.match(deployment, /requests\.put\(url/);
assert.match(deployment, /Prompt readback mismatch/);
assert.match(deployment, /Workflow settings readback mismatch/);
assert.match(deployment, /'settings': expected_settings/);
assert.match(deployment, /settings_requiring_ui/);
assert.match(deployment, /Public n8n PUT cannot round-trip/);
const required = [
  'Context matters',
  'may or must legally disclose',
  'directory-information designation',
  'may or must be disclosed under applicable state law and board policy',
  'Never use absolute directions',
  'do not create unnecessary barriers to normal media relations',
  'may coordinate with the family',
  'Separate internal preparation',
  'Do not recommend a public social post merely because an incident is sensitive',
  'return local_recommendation "N/A"',
];
for (const phrase of required) assert.ok(guardrails.includes(phrase), `Missing guardrail: ${phrase}`);
assert.doesNotMatch(guardrails, /do not release (?:the )?(?:student|employee|former teacher)(?:'s)? name/i);
assert.ok(guardrails.split(/\s+/).length <= 350, 'Guardrail block should remain focused');
console.log('PASS: contextual disclosure and sensitive-incident guardrails preserve legal and communications distinctions.');
