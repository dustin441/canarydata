import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('./n8n/canary-live-load-generated-queries.js', import.meta.url), 'utf8');
const source = template.replace('__SUPABASE_SERVICE_ROLE_KEY__', 'test-service-key');
const runner = vm.runInNewContext(`(function () {${source}\n})`, { console });

async function execute(rowCount) {
  const calls = [];
  const rows = Array.from({ length: rowCount }, (_, index) => ({ id: `query-${String(index).padStart(5, '0')}` }));
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
  return { output, calls };
}

const ordinary = await execute(117);
assert.equal(ordinary.output.length, 117);
assert.equal(new Set(ordinary.output.map((item) => item.json.id)).size, 117);
assert.deepEqual(ordinary.calls.map((call) => Number(call.qs.offset)), [0, 100]);
assert.ok(ordinary.calls.every((call) => call.qs.limit === '100'));
assert.ok(ordinary.calls.every((call) => call.qs.order === 'created_at.asc,id.asc'));
assert.ok(ordinary.calls.every((call) => call.headers.apikey === 'test-service-key'));
assert.ok(ordinary.calls.every((call) => call.headers.Authorization === 'Bearer test-service-key'));

const exactCap = await execute(10000);
assert.equal(exactCap.output.length, 10000);
assert.equal(exactCap.calls.length, 101);
assert.equal(Number(exactCap.calls.at(-1).qs.offset), 10000);

await assert.rejects(() => execute(10001), /exceeded the 10000-row safety cap/);

console.log('Live generated-query pagination checks passed, including the exact safety-cap boundary.');
