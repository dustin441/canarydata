import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';

const IMAGE = 'postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const PASSWORD = 'disposable-social-test-only';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${String(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function execPsql(container, sql, { role } = {}) {
  const prefix = role ? `set role ${role};\n` : '';
  return run('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {
    input: `${prefix}${sql}`,
  });
}

function execPsqlAsync(container, sql, { role } = {}) {
  const prefix = role ? `set role ${role};\n` : '';
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`parallel psql failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(`${prefix}${sql}`);
  });
}

export async function withSocialDatabase(label, test) {
  const availability = spawnSync('docker', ['info'], { encoding: 'utf8' });
  assert.equal(availability.status, 0, `Docker is required for Social database tests: ${availability.stderr?.trim()}`);
  const container = `canary-social-${label}-${process.pid}-${randomBytes(4).toString('hex')}`;
  let started = false;
  try {
    run('docker', ['run', '--detach', '--rm', '--name', container, '-e', `POSTGRES_PASSWORD=${PASSWORD}`, IMAGE]);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const check = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
      if (check.status === 0) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Disposable PostgreSQL did not become ready.');
    const [fixture, migration] = await Promise.all([
      readFile(new URL('./social-n1.sql', import.meta.url), 'utf8'),
      readFile(new URL('../../supabase/migrations/20260804193000_social_visibility_lifecycle.sql', import.meta.url), 'utf8'),
    ]);
    execPsql(container, fixture);
    execPsql(container, migration);
    await test({
      sql: (statement, options) => execPsql(container, statement, options),
      sqlAsync: (statement, options) => execPsqlAsync(container, statement, options),
      expectFailure(statement, pattern, options) {
        assert.throws(() => execPsql(container, statement, options), pattern);
      },
    });
  } finally {
    if (started) spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8' });
    const remains = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}'], { encoding: 'utf8' });
    assert.equal(remains.stdout?.trim(), '', `Disposable container was not removed: ${container}`);
  }
}
