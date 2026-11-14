import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { expectedData } from '../../support/expected-data.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(folder, '../../..');
const support = path.join(root, 'test/support');
const isolated = isolatedEnvironment(), { tmp, bin, home, python, env } = isolated;
Object.assign(env, { NODE_OPTIONS: `--import=${path.join(support, 'clock.mjs')}`, PYTHONPATH: support,
  FIXTURE_MACHINE: 'box-a', FIXTURE_TMP: tmp, FIXTURE_PYTHON: python, FIXTURE_TRACE: path.join(tmp, 'commands.jsonl'),
  FIXTURE_SOURCES: folder, FIXTURE_ACCOUNTS: '["coder-a"]' });
const expected = expectedData(path.join(folder, 'expected-data.json'));
const run = (exe, args, childEnv = env, input) => {
  const r = spawnSync(exe, args, { cwd: tmp, env: childEnv, input, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr || r.error || r.stdout}`);
  return r.stdout;
};
const cli = (days, hosts) => JSON.parse(run(process.execPath, [path.join(root, 'bin/worthit.mjs'), '--json', '--no-files', '--days', String(days), '--hosts', hosts, '--git', 'yes', '--ai', 'no']));
const query = sql => JSON.parse(run(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'sql', sql]));
const history = () => JSON.parse(fs.readFileSync(path.join(env.WORTHIT_HOME, 'history.json'))).days;
const check = (name, actual) => { assert.deepEqual(actual, expected.get(name), `history-scan-coverage / ${name}`); console.log(name + ': ' + JSON.stringify(actual)); };
try {
  for (const machine of ['box-a', 'box-b']) {
    const machineHome = machine === 'box-a' ? home : path.join(tmp, machine);
    const logs = path.join(machineHome, '.claude/projects/example'); fs.mkdirSync(logs, { recursive: true });
    fs.copyFileSync(path.join(folder, machine + '.jsonl'), path.join(logs, 'usage.jsonl'));
  }
  fs.mkdirSync(path.join(home, '.meter'));
  run(python, ['-c', 'import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.executescript("CREATE TABLE pr (repo TEXT, pr INTEGER, merged_ms INTEGER); CREATE TABLE cwd_repo (repo TEXT, cwd TEXT, checked_ms INTEGER);")', path.join(home, '.meter/meter.db')]);
  fs.mkdirSync(path.join(home, '.ssh')); fs.writeFileSync(path.join(home, '.ssh/config'), 'Host box-b\n  HostName box-b.invalid\n');
  // Shell-free command wrappers use only synthetic homes and never contact a host.
  for (const command of ['ssh', 'gh', 'usagemeter']) fs.writeFileSync(path.join(bin, command), `#!${process.execPath}\nprocess.argv.splice(1,1,${JSON.stringify(path.join(support, 'commands.mjs'))},${JSON.stringify(command)}); await import(${JSON.stringify(path.join(support, 'commands.mjs'))});\n`, { mode: 0o755 });
  cli(21, 'box-b');
  check('baseline', history());
  const short = cli(7, 'box-b');
  assert.deepEqual(short.machines_missing, []);
  check('short_history', history());
  const saved = JSON.parse(fs.readFileSync(path.join(env.WORTHIT_HOME, 'run-keep/local.json')));
  assert.equal(saved.since, '2026-11-07T12:00:00', 'real scanner cutoff is midday UTC');
  assert.ok(!saved.buckets.some(b => b.hour === '2026-11-04T15'), 'older PR day is outside the scan');
  assert.ok(!saved.buckets.some(b => b.hour === '2026-11-07T09'), 'oldest morning is outside the scan');
  assert.ok(saved.buckets.some(b => b.hour === '2026-11-07T15'), 'oldest afternoon is inside the scan');
  const selected = cli(7, 'none');
  assert.deepEqual(selected.machines_left_out, ['box-b']);
  check('left_out_history', history());
  check('stored_providers', query('SELECT day, provider, api_usd, output_tokens, requests FROM day_provider ORDER BY day, provider'));
  check('stored_days', query('SELECT * FROM day ORDER BY day'));
  // buildData controls isolate history replacement from the earlier saved-scan merge.
  // Exercise UTC/local midnight, both DST day lengths, current-day protection, per-field MAX,
  // missing/cached hosts, and unchanged PR/commit semantics with literal expectations.
  for (const [name, tz, now, hour] of [
    ['complete', 'UTC', '2026-11-14T12:00:00Z', '2026-11-10T15'],
    ['today', 'UTC', '2026-11-14T12:00:00Z', '2026-11-14T09'],
    ['local_partial', 'America/Los_Angeles', '2026-11-14T12:00:00Z', '2026-11-07T15'],
    ['local_complete', 'America/Los_Angeles', '2026-11-14T12:00:00Z', '2026-11-08T08'],
    ['crossed_midnight', 'UTC', '2026-11-15T00:01:00Z', '2026-11-14T15'],
    ['midnight', 'UTC', '2026-11-14T00:00:00Z', '2026-11-07T00'],
    ['dst_long', 'America/Los_Angeles', '2026-11-02T08:30:00Z', '2026-11-02T07'],
    ['dst_short', 'America/Los_Angeles', '2026-03-09T07:30:00Z', '2026-03-09T06'],
    ['missing', 'UTC', '2026-11-14T12:00:00Z', '2026-11-10T15'],
    ['cached', 'UTC', '2026-11-14T12:00:00Z', '2026-11-10T15'],
  ]) {
    const actual = JSON.parse(run(process.execPath, [path.join(folder, 'controls.mjs'), name, now, hour],
      { ...env, TZ: tz, WORTHIT_HOME: path.join(tmp, name) }));
    check(name, actual);
  }
  expected.done();
  assert.ok(!fs.readFileSync(env.FIXTURE_TRACE, 'utf8').includes('"unexpected"'));
} finally { isolated.cleanup(); }
