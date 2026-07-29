const failed = $input.all();
const evidence = failed.slice(0, 10).map((item) => {
  const json = item.json || {};
  const original = json.error?.item?.json || json.input || json;
  const message = json.error?.message || json.message || json.description || 'Story write failed';
  return {
    district_id: original.district_id || null,
    raw_result_id: original.raw_result_id || null,
    story_candidate_id: original.story_candidate_id || null,
    canonical_url: original.canonical_url || null,
    error: String(message).slice(0, 240),
  };
});

throw new Error(`story_write_partial_failure: ${failed.length} row(s) failed after bounded retries; ${JSON.stringify(evidence)}`);
