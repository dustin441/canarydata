import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('./n8n/canary-live-load-generated-queries.js', import.meta.url), 'utf8');
const source = template.replace('__SUPABASE_SERVICE_ROLE_KEY__', 'test-service-key');
const calls = [];
const rows = Array.from({ length: 117 }, (_, index) => ({ id: `query-${String(index).padStart(3, '0')}` }));
const runner = vm.runInNewContext(`(function () {${source}\n})`, { console });
const output = await runner.call({
  helpers: {
    httpRequest: async (options) => {
      calls.push(options);
      const offset = Number(options.qs.offset);
      const limit = Number(options.qs.limit);
      return rows.slice(offset, offset + limit);
    },
  },
});

assert.equal(output.length, 117);
assert.equal(new Set(output.map((item) => item.json.id)).size, 117);
assert.deepEqual(calls.map((call) => Number(call.qs.offset)), [0, 100]);
assert.ok(calls.every((call) => call.qs.limit === '100'));
assert.ok(calls.every((call) => call.qs.order === 'created_at.asc,id.asc'));
assert.ok(calls.every((call) => call.headers.apikey === 'test-service-key'));
assert.ok(calls.every((call) => call.headers.Authorization === 'Bearer test-service-key'));

console.log('Live generated-query pagination checks passed.');
