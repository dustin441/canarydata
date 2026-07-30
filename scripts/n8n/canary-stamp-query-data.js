const queryItems = $('Get Search Queries1').all().map((item) => item.json || {});
const byQueryText = new Map();
for (const query of queryItems) {
  const key = String(query.query_text || '');
  if (!key) throw new Error('Generated query missing query_text');
  if (byQueryText.has(key)) throw new Error(`Duplicate active query_text prevents safe pagination mapping: ${key}`);
  byQueryText.set(key, query);
}

function pairedItemIndex(item, fallbackIndex) {
  const paired = Array.isArray(item?.pairedItem) ? item.pairedItem[0] : item?.pairedItem;
  const index = Number(paired?.item);
  return Number.isSafeInteger(index) && index >= 0 ? index : fallbackIndex;
}

function providerErrorMessage(error) {
  if (!error) return null;
  const outer = typeof error === 'object' ? error : { error };
  let nested = outer.error;
  if (typeof nested === 'string') {
    try { nested = JSON.parse(nested); } catch { /* retain provider text */ }
  }
  const message = typeof nested === 'object'
    ? nested?.error || nested?.message || nested?.search_metadata?.status
    : nested;
  return String(message || outer.message || outer.description || 'Provider request failed').slice(0, 240);
}

const inputs = $input.all();
const mapped = inputs.map((item, inputIndex) => {
  const responseQuery = String(item.json?.search_parameters?.q || '');
  const linkedIndex = pairedItemIndex(item, inputIndex);
  const queryItem = byQueryText.get(responseQuery) || queryItems[linkedIndex];
  if (!queryItem) {
    throw new Error(`No generated query mapping for provider response at input ${inputIndex}`);
  }

  const providerError = providerErrorMessage(item.json?.error);
  const allResults = item.json?.news_results || item.json?.organic_results || [];
  const validationProfile = queryItem.search_params?.validation_profile || null;
  const validationEntities = queryItem.search_params?.validation_entities || null;
  const lookbackDays = queryItem.search_params?.lookback_days || null;
  const resultOffset = Number(item.json?.search_parameters?.start || 0);

  return {
    json: {
      ...item.json,
      generated_query_id: queryItem.id,
      profile_id: queryItem.profile_id,
      query_text: queryItem.query_text,
      district_id: queryItem.district_id,
      profile_version: queryItem.profile_version,
      lookback_days: lookbackDays,
      result_offset: resultOffset,
      provider_error: providerError,
      news_results: allResults.map((article) => ({
        ...article,
        snippet: article.snippet || article.description || '',
        source_type: 'news',
        source_query: queryItem.query_text,
        generated_query_id: queryItem.id,
        profile_id: queryItem.profile_id,
        district_id: queryItem.district_id,
        profile_version: queryItem.profile_version,
        validation_profile: validationProfile,
        validation_entities: validationEntities,
        lookback_days: lookbackDays,
        result_offset: resultOffset,
        _stamped_link: article.link || article.url || '',
      })),
    },
    pairedItem: item.pairedItem,
  };
});

const failed = mapped.filter((item) => item.json.provider_error);
if (mapped.length > 0 && failed.length === mapped.length) {
  const evidence = failed.slice(0, 5).map((item) => ({
    generated_query_id: item.json.generated_query_id,
    district_id: item.json.district_id,
    error: item.json.provider_error,
  }));
  throw new Error(`provider_batch_failed: ${failed.length}/${mapped.length} search requests failed; ${JSON.stringify(evidence)}`);
}

return mapped;
