import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./n8n/canary-stamp-query-data.js', import.meta.url), 'utf8');

function execute({ queries, responses }) {
  const context = {
    $: (name) => {
      assert.equal(name, 'Get Search Queries1');
      return { all: () => queries.map((json) => ({ json })) };
    },
    $input: { all: () => responses },
  };
  vm.createContext(context);
  return new vm.Script(`(() => { ${source} })()`).runInContext(context);
}

const queries = [
  { id: 'q1', district_id: 'district-a', query_text: 'District A', search_params: {} },
  { id: 'q2', district_id: 'district-b', query_text: 'District B', search_params: {} },
];

const successful = execute({
  queries,
  responses: [
    { json: { search_parameters: { q: 'District A' }, news_results: [{ title: 'A', link: 'https://example.com/a' }] }, pairedItem: { item: 0 } },
    { json: { search_parameters: { q: 'District B' }, news_results: [] }, pairedItem: { item: 1 } },
  ],
});
assert.equal(successful[0].json.generated_query_id, 'q1');
assert.equal(successful[0].json.news_results[0].district_id, 'district-a');
assert.equal(successful[0].json.provider_error, null);

const partial = execute({
  queries,
  responses: [
    { json: { error: { statusCode: 503, error: JSON.stringify({ error: 'Please try again later.' }) } }, pairedItem: { item: 0 } },
    { json: { search_parameters: { q: 'District B' }, news_results: [] }, pairedItem: { item: 1 } },
  ],
});
assert.equal(partial[0].json.generated_query_id, 'q1', 'provider errors must retain paired query lineage');
assert.equal(partial[0].json.provider_error, 'Please try again later.');
assert.equal(partial[1].json.generated_query_id, 'q2');

assert.throws(
  () => execute({
    queries,
    responses: [
      { json: { error: { statusCode: 503, error: JSON.stringify({ error: 'Outage' }) } }, pairedItem: { item: 0 } },
      { json: { error: { statusCode: 503, error: JSON.stringify({ error: 'Outage' }) } }, pairedItem: { item: 1 } },
    ],
  }),
  /provider_batch_failed: 2\/2 search requests failed/,
  'an all-provider-error batch must fail with the real provider failure instead of a mapping error',
);

console.log('Canary provider lineage and failure checks passed.');
