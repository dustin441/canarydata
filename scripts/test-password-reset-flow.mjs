import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { safeNextPath } from '../src/lib/authRedirect.mjs';

const forgot = await readFile(new URL('../src/app/forgot-password/page.js', import.meta.url), 'utf8');
const reset = await readFile(new URL('../src/app/reset-password/page.js', import.meta.url), 'utf8');
const callback = await readFile(new URL('../src/app/auth/callback/route.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/lib/supabase/client.js', import.meta.url), 'utf8');

assert.match(client, /export function createClient\(options\)/);
assert.match(client, /NEXT_PUBLIC_SUPABASE_ANON_KEY,\s*options/);
assert.match(forgot, /const supabase = createClient\(\)/);
assert.match(forgot, /redirectTo:\s*`\$\{window\.location\.origin\}\/reset-password`/);
assert.match(forgot, /8-digit recovery code/);
assert.match(forgot, /router\.push\('\/reset-password'\)/);
assert.match(callback, /exchangeCodeForSession\(code\)/, 'server callback must exchange the PKCE code');
assert.match(callback, /safeNextPath/, 'callback redirect must remain same-origin and path constrained');
const origin = 'https://canary.example';
assert.equal(safeNextPath('/reset-password?from=email', origin, '/dashboard'), '/reset-password?from=email');
assert.equal(safeNextPath('//evil.example', origin, '/dashboard'), '/dashboard');
assert.equal(safeNextPath('/\\evil.example', origin, '/dashboard'), '/dashboard');
assert.equal(safeNextPath('https://evil.example', origin, '/dashboard'), '/dashboard');
assert.match(reset, /onAuthStateChange/, 'the reset page must use the SDK recovery event for URL sessions');
assert.match(reset, /event !== 'PASSWORD_RECOVERY'/, 'ordinary sign-in sessions must not unlock password recovery');
assert.doesNotMatch(reset, /exchangeCodeForSession/, 'the page must not double-exchange SDK-managed PKCE codes');
assert.doesNotMatch(reset, /setSession\(/, 'the page must not treat arbitrary URL tokens as recovery proof');
assert.match(reset, /verifyOtp\(\{/, 'recovery codes must be verified through Supabase Auth');
assert.match(reset, /type:\s*'recovery'/, 'the code verifier must use the recovery OTP type');
assert.match(reset, /\^\\d\{8\}\$/, 'the recovery form must require the configured 8-digit code');
assert.match(reset, /user\.id !== recoveryUserId/, 'the password update must preserve recovery-session provenance');
assert.match(reset, /disabled=\{loading \|\| !sessionReady\}/, 'submit must remain disabled until recovery is ready');
assert.match(reset, /supabase\.auth\.updateUser/, 'password update must require the recovered session');

console.log('Password reset routing and compatibility checks passed.');