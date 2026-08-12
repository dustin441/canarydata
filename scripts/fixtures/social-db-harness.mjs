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

function createPsqlSession(container, label, { role } = {}) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0;
  let stdout = '';
  let stderr = '';
  let pending;
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
    if (pending && stdout.includes(pending.marker)) {
      const markerIndex = stdout.indexOf(pending.marker);
      const output = stdout.slice(0, markerIndex).trim();
      stdout = stdout.slice(markerIndex + pending.marker.length).replace(/^\s+/, '');
      clearTimeout(pending.timer);
      const resolve = pending.resolve;
      pending = undefined;
      resolve(output);
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => {
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`${label} psql session failed (${code}): ${stderr.trim()}`));
      pending = undefined;
    }
  });
  const exec = (statement, timeoutMs = 15000) => {
    assert.equal(pending, undefined, `${label} session already has a pending command`);
    const marker = `__CANARY_DONE_${label}_${sequence += 1}__`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${label} psql command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending = { marker, resolve, reject, timer };
      child.stdin.write(`${role ? `set role ${role};\n` : ''}${statement}\n\\echo ${marker}\n`);
    });
  };
  return {
    exec,
    async pid() { return Number(await exec('select pg_backend_pid();')); },
    close() { if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end('\\q\n'); },
  };
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
      const check = spawnSync('docker', ['exec', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1;'], { encoding: 'utf8' });
      if (check.status === 0) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Disposable PostgreSQL did not pass an executable SELECT 1 readiness check.');
    const [fixture, legacy, migration] = await Promise.all([
      readFile(new URL('./social-n1.sql', import.meta.url), 'utf8'),
      readFile(new URL('../../supabase/social_review_workflow.sql', import.meta.url), 'utf8'),
      readFile(new URL('../../supabase/migrations/20260804193000_social_visibility_lifecycle.sql', import.meta.url), 'utf8'),
    ]);
    execPsql(container, fixture);
    execPsql(container, legacy);
    execPsql(container, migration);
    const sessions = new Set();
    await test({
      sql: (statement, options) => execPsql(container, statement, options),
      sqlAsync: (statement, options) => execPsqlAsync(container, statement, options),
      expectFailure(statement, pattern, options) {
        assert.throws(() => execPsql(container, statement, options), pattern);
      },
      session(sessionLabel, options) {
        const psqlSession = createPsqlSession(container, sessionLabel, options);
        sessions.add(psqlSession);
        return psqlSession;
      },
      async waitForBlocked(blockedPid, blockerPid) {
        let state = '';
        for (let attempt = 0; attempt < 100; attempt += 1) {
          state = execPsql(container, `select coalesce(wait_event_type, '') || '|' || coalesce(array_to_string(pg_blocking_pids(pid), ','), '') from pg_stat_activity where pid=${blockedPid};`).trim();
          const lockMatch = state.match(/Lock\|([0-9,]*)/);
          if (lockMatch && (!blockerPid || lockMatch[1].split(',').includes(String(blockerPid)))) return lockMatch[0];
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const activity = execPsql(container, `select pid,state,wait_event_type,wait_event,left(query,120),pg_blocking_pids(pid) from pg_stat_activity where pid in (${blockedPid}${blockerPid ? `,${blockerPid}` : ''}) order by pid;`).trim();
        throw new Error(`Backend ${blockedPid} was not observably blocked by ${blockerPid || 'a lock holder'}; last=${state}; activity=${activity}`);
      },
    });
    for (const psqlSession of sessions) psqlSession.close();
  } finally {
    if (started) spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8' });
    const remains = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}'], { encoding: 'utf8' });
    assert.equal(remains.stdout?.trim(), '', `Disposable container was not removed: ${container}`);
  }
}
