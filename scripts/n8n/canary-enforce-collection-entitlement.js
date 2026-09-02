const items = $input.all();

return items.filter((item) => {
  const decision = item.json?._canary_collection_entitlement;

  if (!decision || typeof decision.enforced !== 'boolean' || typeof decision.allowed !== 'boolean') {
    throw new Error('Canary collection entitlement decision is missing or malformed');
  }

  if (decision.enforced === false && decision.allowed !== true) {
    throw new Error('Non-pilot district received a denying entitlement decision');
  }

  return decision.allowed === true;
});
