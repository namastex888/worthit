// Issue #112: demo lookups must never disclose the synthetic stand-in for a real store.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { isolatedEnvironment } from '../../support/environment.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(folder, '../../..');
const isolated = isolatedEnvironment(), { tmp, env } = isolated;
const cli = path.join(root, 'bin/worthit.mjs'), trace = path.join(tmp, 'store-access.log');
const clock = `--import=${path.join(root, 'test/support/clock.mjs')}`;
const failures = [];
const check = (name, fn) => { try { fn(); } catch (error) { failures.push(name + ': ' + error.message); } };
const invoke = (args, store, guard = false, direct = false) => {
  const launch = direct ? ['--input-type=module', '-e', `import { run } from ${JSON.stringify(path.join(root, 'src/query.mjs'))};
    try { console.log(JSON.stringify(run(${JSON.stringify(args)}))); }
    catch (error) { console.error('worthit: ' + error.message); process.exitCode = 2; }`] : [cli, ...args];
  const r = spawnSync(process.execPath, launch, {
    cwd: tmp, env: { ...env, WORTHIT_HOME: store, FIXTURE_STORE_TRACE: trace,
      // A dispatch regression must fail promptly instead of starting an interactive demo scan.
      ...(args.some(arg => ['get', 'days', 'sql'].includes(arg)) ? { WORTHIT_RUNNING: 'fixture-lookup-only' } : {}),
      NODE_OPTIONS: clock + (guard ? ` --import=${path.join(folder, 'guard.mjs')}` : '') },
    encoding: 'utf8', timeout: 10000, maxBuffer: 4 << 20,
  });
  assert.ifError(r.error);
  return r;
};
const snapshot = store => fs.existsSync(store) ? fs.readdirSync(store).sort().map(name => {
  const file = path.join(store, name), stat = fs.statSync(file);
  return [name, stat.mode, stat.mtimeMs, fs.readFileSync(file).toString('base64')];
}) : null;
try {
  const present = path.join(tmp, 'present'); fs.mkdirSync(present);
  const stored = { generated_at: '2001-02-03T00:00:00Z', plans: [{ usd_per_full_week: 987654321 }], sentinel: 'PRIVATE-SYNTHETIC-LAST' };
  fs.writeFileSync(path.join(present, 'last.json'), JSON.stringify(stored));
  const db = new DatabaseSync(path.join(present, 'worthit.db'));
  db.exec(`CREATE TABLE day_provider(day TEXT, provider TEXT, api_usd REAL, output_tokens INTEGER, requests INTEGER);
    CREATE TABLE day(day TEXT, prs INTEGER, commits INTEGER);
    CREATE TABLE secret(value TEXT);
    INSERT INTO day_provider VALUES('2001-02-03', 'codex', 876543219, 123, 1);
    INSERT INTO day VALUES('2001-02-03', 4, 5);
    INSERT INTO secret VALUES('PRIVATE-SYNTHETIC-SQL');`);
  db.close();
  const baseline = invoke(['--json', '--demo'], present);
  assert.equal(baseline.status, 0, baseline.stderr);
  const { worthit, audit_log, ...sample } = JSON.parse(baseline.stdout);
  assert.equal(audit_log, null);
  const cases = [
    { args: ['get', 'plans', '--demo'], expected: { generated_at: sample.generated_at, plans: sample.plans } },
    { args: ['get', '--demo', 'plans.0.usd_per_full_week'], expected: sample.plans[0].usd_per_full_week },
    { args: ['--demo', 'get', 'delivery'], expected: { generated_at: sample.generated_at, delivery: sample.delivery } },
    { args: ['get', '--demo'], expected: { generated_at: sample.generated_at, sections: Object.keys(sample), hint: 'worthit get <section>, e.g. worthit get plans, worthit get model_mix.series, worthit get plans.0.usd_per_full_week' } },
    { args: ['get', 'missing-section', '--demo'], error: /no "missing-section"/ },
    ...[['days', '--demo'], ['--demo', 'days', '--by', 'model'], ['days', '--by', 'tool', '--demo'],
      ['sql', 'SELECT value FROM secret', '--demo'], ['sql', '--demo', 'SELECT 1'], ['--demo', 'sql', 'SELECT 1']]
      .map(args => ({ args, error: /--demo.*not supported.*bundled sample.*worthit get/ })),
  ];
  const verify = (r, test) => {
    assert.doesNotMatch(r.stdout + r.stderr, /PRIVATE-SYNTHETIC|987654321|876543219/, 'private synthetic sentinel leaked');
    if (test.error) {
      assert.equal(r.status, 2, 'explicit rejection exit'); assert.equal(r.stdout, '');
      assert.equal(r.stderr.trim().split('\n').length, 1, 'one-line rejection'); assert.match(r.stderr, test.error);
    } else {
      assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ''); assert.deepEqual(JSON.parse(r.stdout), test.expected);
    }
  };
  // Unguarded present-store runs expose the original privacy symptom for all three commands.
  const before = snapshot(present);
  for (const test of [cases[0], cases[5], cases[8],
    ...[['get', 'plans', '--demo=1'], ['get', '--demo=true', 'plans.0.usd_per_full_week'],
      ['sql', 'SELECT value FROM secret', '--demo=1']]
      .map(args => ({ args, error: /--demo takes no value: use `--demo`\./ })),
  ]) check('privacy ' + test.args.join(' '), () => verify(invoke(test.args, present), test));
  assert.deepEqual(snapshot(present), before, 'lookup must not modify stored bytes, modes or mtimes');

  const empty = path.join(tmp, 'empty'), corrupt = path.join(tmp, 'corrupt'), unreadable = path.join(tmp, 'unreadable');
  fs.mkdirSync(corrupt); fs.mkdirSync(unreadable);
  for (const name of ['hosts.json', 'last.json', 'worthit.db']) {
    fs.writeFileSync(path.join(corrupt, name), '{not valid JSON or SQLite');
    fs.writeFileSync(path.join(unreadable, name), 'unreadable synthetic store', { mode: 0 });
  }
  // Access instrumentation, including DatabaseSync, is stronger than permissions (which root can bypass).
  for (const store of [empty, present, corrupt, unreadable]) {
    const original = store === unreadable ? null : snapshot(store);
    for (const test of cases) check(path.basename(store) + ' ' + test.args.join(' '), () => verify(invoke(test.args, store, true), test));
    check(path.basename(store) + ' JSON demo', () => {
      const r = invoke(['--json', '--demo'], store, true);
      assert.equal(r.status, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout), { worthit, ...sample, audit_log });
    });
    if (store !== unreadable) assert.deepEqual(snapshot(store), original, 'demo leaves store untouched');
  }
  check('no store access from imports/dispatch/queries', () => assert.equal(fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '', ''));
  for (const test of [cases[0], cases[2], cases[5], cases[8]])
    check('direct query ' + test.args.join(' '), () => verify(invoke(test.args, present, true, true), test));
  check('direct query store isolation', () => assert.equal(fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '', ''));
  // Non-demo lookups keep reading the selected synthetic store. SQL text is not a CLI flag.
  for (const [args, expected] of [
    [['get', 'plans.0.usd_per_full_week'], 987654321],
    [['sql', "SELECT '--demo' AS value"], [{ value: '--demo' }]],
    [['sql', 'SELECT value FROM secret'], [{ value: 'PRIVATE-SYNTHETIC-SQL' }]],
    [['days'], [{ period: '2001-02-03', api_usd: 876543219, output_tokens: 123, requests: 1, days: 1, merged_prs: 4, commits: 5 }]],
  ]) check('non-demo ' + args.join(' '), () => {
    const r = invoke(args, present); assert.equal(r.status, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout), expected);
  });
  assert.deepEqual(snapshot(present), before, 'non-demo lookups remain read-only');
  for (const failure of failures) console.error('demo-lookups: FAIL ' + failure);
  assert.equal(failures.length, 0, `${failures.length} demo lookup regressions`);
  console.log('demo-lookups: sample get matches JSON demo; days/sql reject; four store states inaccessible; non-demo controls unchanged');
} finally { isolated.cleanup(); }
