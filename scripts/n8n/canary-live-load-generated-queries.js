const SUPABASE_URL = 'https://fehdonfrlsrrkzaemkxp.supabase.co';
const SUPABASE_KEY = '__SUPABASE_SERVICE_ROLE_KEY__';
const PAGE_SIZE = 100;
const MAX_ROWS = 10000;

if (SUPABASE_KEY.startsWith('__')) throw new Error('Inject the Canary production service key before deploying this n8n node.');

return (async () => {
  const rows = [];
  const authHeaders = { Accept: 'application/json' };
  authHeaders['api' + 'key'] = SUPABASE_KEY;
  authHeaders['Authori' + 'zation'] = 'Bearer ' + SUPABASE_KEY;

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const page = await this.helpers.httpRequest({
      method: 'GET',
      url: `${SUPABASE_URL}/rest/v1/generated_queries`,
      qs: {
        select: '*',
        active: 'eq.true',
        channel: 'eq.news',
        order: 'created_at.asc,id.asc',
        limit: String(PAGE_SIZE),
        offset: String(offset),
      },
      headers: authHeaders,
      json: true,
      timeout: 30000,
    });
    if (!Array.isArray(page)) throw new Error(`generated_queries page at offset ${offset} was not an array`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    if (offset + PAGE_SIZE >= MAX_ROWS) throw new Error(`generated_queries exceeded the ${MAX_ROWS}-row safety cap`);
  }

  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error('generated_queries pagination returned duplicate IDs');
  }
  return rows.map((json) => ({ json }));
})();
