import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const id of ['LhYW2M5c6u6BxVfh','SLZABQRPOmXstYV7']) {
  const workflow = JSON.parse(await readFile(new URL(`../config/n8n/${id}-social-discovery-staging.json`, import.meta.url), 'utf8'));
  const source = JSON.stringify(workflow);
  assert.equal(workflow.active, false, `${id} must remain inactive until bounded production QA passes`);
  assert.match(source, /canary_stage_social_discovery/);
  assert.doesNotMatch(source, /canary_ingest_social_thread|\/rest\/v1\/social_threads\?/);
  const stage = workflow.nodes.find((node) => node.name.startsWith('Stage Review'));
  assert.ok(stage, `${id} must have a candidate staging node`);
  assert.equal(stage.onError, 'continueErrorOutput', `${id} must branch stage-write errors locally`);
  const outputs = workflow.connections[stage.name]?.main || [];
  assert.ok(outputs[0]?.length, `${id} must have a success path`);
  assert.ok(outputs[1]?.length, `${id} must have a failure path`);
  const failureNode = outputs[1][0].node;
  const failureSource = JSON.stringify(workflow.nodes.find((node) => node.name === failureNode));
  assert.match(failureSource, /candidate_stage_write_failed/);
  assert.match(source, /review_only/);
}
console.log('Inactive Social discovery staging workflow contracts passed.');
