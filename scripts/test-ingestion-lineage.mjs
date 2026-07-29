import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./n8n/canary-live-finalize-story.js', import.meta.url), 'utf8');

assert.doesNotMatch(
  source,
  /\$\('Format for AI'\)\.all\(\)|\$\('Prepare Validated Shadow Story'\)\.all\(\)/,
  'the finalizer must not correlate records with global arrays from multiple branch executions',
);
assert.match(
  source,
  /\$\('Attach DB Strategic Priorities'\)\.itemMatching\(index\)/,
  'each AI output must resolve its own linked source item',
);
assert.match(source, /lineage_missing/, 'missing canonical lineage must fail closed');
assert.match(source, /lineage_district_mismatch/, 'district-context drift must fail closed');
assert.match(source, /raw_result_id/, 'raw-result lineage must survive the AI boundary');
assert.match(source, /story_candidate_id/, 'candidate lineage must survive the AI boundary');

const primary = [
  { raw_result_id: 'raw-primary-1', district_id: 'district-a', link: 'https://example.com/a', title: 'Primary A' },
  { raw_result_id: 'raw-primary-2', district_id: 'district-b', link: 'https://example.com/b', title: 'Primary B' },
];
const recovery = [
  { raw_result_id: 'raw-recovery-1', district_id: 'district-c', link: 'https://example.com/c', title: 'Recovery C' },
];

// The historical bug used the first global primary item when the recovery execution restarted at index 0.
assert.notEqual(primary[0].raw_result_id, recovery[0].raw_result_id);

// The repaired contract resolves the source through the current input item's linked execution.
function finalizeWithLinkedItem(aiItems, linkedItems) {
  return aiItems.map((ai, index) => {
    const linked = linkedItems[index];
    assert.ok(linked?.raw_result_id && linked?.district_id && linked?.link && linked?.title);
    return { ...ai, ...linked };
  });
}

const recovered = finalizeWithLinkedItem([{ summary: 'Recovery C analysis' }], recovery);
assert.deepEqual(recovered, [{
  summary: 'Recovery C analysis',
  raw_result_id: 'raw-recovery-1',
  district_id: 'district-c',
  link: 'https://example.com/c',
  title: 'Recovery C',
}]);

console.log('Canary ingestion lineage regression checks passed.');
