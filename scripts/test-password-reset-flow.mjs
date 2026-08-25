import fs from 'node:fs';
import assert from 'node:assert/strict';

const forgot = fs.readFileSync(new URL('../src/app/forgot-password/page.js', import.meta.url), 'utf8');
const reset = fs.readFileSync(new URL('../src/app/reset-password/page.js', import.meta.url), 'utf8');
const callback = fs.readFileSync(new URL('../src/app/auth/callback/route.js', import.meta.url), 'utf8');

assert.match(forgot, /auth\/callback\?next=\/reset-password/, 'new recovery emails must use the server callback');
assert.match(callback, /exchangeCodeForSession\(code\)/, 'server callback must exchange the PKCE code');
assert.match(callback, /safeNextPath/, 'callback redirect must remain same-origin and path constrained');
assert.match(reset, /query\.get\('code'\)/, 'reset page must accept already-issued direct PKCE links');
assert.match(reset, /exchangeCodeForSession\(code\)/, 'direct PKCE links must exchange their code');
assert.match(reset, /hash\.get\('access_token'\)/, 'legacy hash recovery links must remain supported');
assert.match(reset, /supabase\.auth\.updateUser/, 'password update must require the recovered session');

console.log('Password reset routing and compatibility checks passed.');