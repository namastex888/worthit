// Real files, mtimes, scanner, merge, pricing and persistence; no fabricated scan results.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { expectedData } from '../../support/expected-data.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(folder, '../../..');
const isolated = isolatedEnvironment(), { tmp, home, bin, python, env } = isolated;
const support = path.join(root, 'test/support'), app = path.join(tmp, 'app');
Object.assign(env, { NODE_OPTIONS: `--import=${path.join(support, 'clock.mjs')}`, PYTHONPATH: support,
  FIXTURE_MACHINE: 'box-a', FIXTURE_TMP: tmp, FIXTURE_PYTHON: python, FIXTURE_TRACE: path.join(tmp, 'commands.jsonl') });
const expected = expectedData(path.join(folder, 'expected-data.json'));
const check = (name, value) => { assert.deepEqual(value, expected.get(name), `log-evidence / ${name}`); console.log(`log-evidence / ${name}: PASS`); };
const run = (exe, args, overrides = {}) => {
  const r = spawnSync(exe, args, { cwd: tmp, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr || r.error || r.stdout}`); return r.stdout;
};
const cli = (args, overrides) => JSON.parse(run(process.execPath, [path.join(app, 'bin/worthit.mjs'), ...args], overrides));
const scan = (days, hosts = 'none', overrides) => cli(['--json', '--no-files', '--days', String(days), '--hosts', hosts, '--git', 'no', '--ai', 'no'], overrides);
const sql = (query, overrides) => cli(['sql', query], overrides);
const snapshot = overrides => ({
  providers: sql('SELECT * FROM day_provider ORDER BY day, provider', overrides),
  models: sql('SELECT * FROM day_model ORDER BY day, provider, model', overrides),
  months: sql('SELECT * FROM month ORDER BY month, provider', overrides),
  history: JSON.parse(fs.readFileSync(path.join(overrides?.WORTHIT_HOME || env.WORTHIT_HOME, 'history.json'))).days,
});
const write = (file, rows, mtime) => {
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.utimesSync(file, new Date(mtime), new Date(mtime));
};
const claude = (base, day, id, model = 'claude-sonnet-5-5', outputs = [100000], mtime = day + (day === '2026-11-14' ? 'T10:00:00Z' : 'T16:00:00Z')) => {
  const file = path.join(base, '.claude/projects/example', id + '.jsonl');
  write(file, outputs.map((output, i) => ({ timestamp: day + (day === '2026-11-14' ? 'T09:00:00Z' : 'T15:00:00Z'), sessionId: id,
    requestId: `${id}-${i}`, message: { id: `${id}-${i}`, model, usage: { input_tokens: 0, output_tokens: output } } })), mtime);
  return file;
};
const separate = name => {
  const local = path.join(tmp, name + '-home'); fs.mkdirSync(local);
  return { HOME: local, WORTHIT_HOME: path.join(tmp, name + '-store'), CODEX_HOME: path.join(local, '.codex'),
    CLAUDE_CONFIG_DIR: path.join(local, '.claude'), METER_STATE_DIR: path.join(local, '.meter'),
    XDG_STATE_HOME: path.join(local, '.local/state'), XDG_CONFIG_HOME: path.join(local, '.config'), XDG_DATA_HOME: path.join(local, '.local/share') };
};
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
try {
  fs.mkdirSync(app);
  for (const entry of ['bin', 'src', 'core', 'skills', 'package.json']) fs.cpSync(path.join(root, entry), path.join(app, entry), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(support, 'commands.mjs'))} ssh "$@"\n`, { mode: 0o755 });

  // Thirty recent daily logs plus five older days; actual old mtimes, not fake stat responses.
  const recent = expected.get('recent_days');
  for (const day of recent) claude(home, day, 'recent-' + day);
  const pruned = ['2026-08-25', '2026-09-15', '2026-10-05', '2026-10-06', '2026-10-07'].map(day => claude(home, day, 'old-' + day));
  claude(home, '2026-10-07', 'surviving-model', 'claude-opus-5-5', [100000], '2026-11-13T16:00:00Z');
  write(path.join(home, '.codex/sessions/surviving.jsonl'), [
    { timestamp: '2026-10-05T15:00:00Z', type: 'session_meta', payload: { id: 'fixture-codex' } },
    { timestamp: '2026-10-05T15:00:00Z', type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
    { timestamp: '2026-10-05T15:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 0, output_tokens: 200000, total_tokens: 200000 }, last_token_usage: { input_tokens: 0, output_tokens: 200000 } } } },
  ], '2026-11-13T16:00:00Z');
  scan(90); const before = snapshot();
  check('baseline_totals', { providers: before.providers.length, models: before.models.length, history: Object.keys(before.history).length,
    output: before.providers.reduce((n, r) => n + r.output_tokens, 0), usd: before.providers.reduce((n, r) => n + r.api_usd, 0), requests: before.providers.reduce((n, r) => n + r.requests, 0) });
  check('older_providers', before.providers.filter(r => r.day < '2026-10-16'));
  check('older_models', before.models.filter(r => r.day < '2026-10-16'));
  check('months', before.months);
  for (const day of recent) {
    assert.deepEqual(before.history[day], { out: 100000, usd: 1, prs: 0, commits: 0 });
    assert.deepEqual(before.providers.filter(r => r.day === day), [{ day, provider: 'claude', api_usd: 1, output_tokens: 100000, requests: 1 }]);
    assert.deepEqual(before.models.filter(r => r.day === day), [{ day, model: 'claude-sonnet-5-5', provider: 'claude', output_tokens: 100000, api_usd: 1 }]);
  }
  check('older_history', Object.fromEntries(Object.entries(before.history).filter(([day]) => day < '2026-10-16')));
  scan(21); assert.deepEqual(snapshot(), before, 'narrow21 retains every stored field');
  const keep = JSON.parse(fs.readFileSync(path.join(env.WORTHIT_HOME, 'run-keep/local.json')));
  assert.ok(!keep.buckets.some(b => b.hour < '2026-10-16'), 'narrow scan really drops old run-keep usage');
  for (const file of pruned) fs.unlinkSync(file);
  for (const days of [60, 90, 60, 90]) {
    scan(days); assert.deepEqual(snapshot(), before, `pruned/repeated wide${days}: every usage field remains`);
  }
  // All-pruned, including entire providers, still cannot lower either table or history.
  fs.rmSync(path.join(home, '.claude'), { recursive: true }); fs.rmSync(path.join(home, '.codex'), { recursive: true });
  scan(90); assert.deepEqual(snapshot(), before, 'all-pruned empty real sources keep every stored field');

  // Independent output/USD/request maxima after actual file and price corrections.
  const correction = separate('correction'), pricesFile = path.join(app, 'core/prices.json');
  const prices = JSON.parse(fs.readFileSync(pricesFile));
  claude(correction.HOME, '2026-11-14', 'current');
  const correct = (rate, outputs) => {
    scan(1, 'none', correction); // Empty the target day from run-keep before changing its real source.
    prices.claude['claude-sonnet-5-5'].out = rate; fs.writeFileSync(pricesFile, JSON.stringify(prices));
    claude(correction.HOME, '2026-11-10', 'corrected', 'claude-sonnet-5-5', outputs);
    scan(60, 'none', correction);
    return {
      providers: sql("SELECT api_usd, output_tokens, requests FROM day_provider WHERE day='2026-11-10'", correction),
      models: sql("SELECT output_tokens, api_usd FROM day_model WHERE day='2026-11-10'", correction),
      history: JSON.parse(fs.readFileSync(path.join(correction.WORTHIT_HOME, 'history.json'))).days['2026-11-10'],
    };
  };
  check('correction_initial', correct(10, [50000, 50000]));
  check('correction_usd', correct(40, [50000]));
  check('correction_tokens', correct(5, [100000, 25000, 75000]));
  check('correction_requests', correct(5, [10000, 10000, 10000, 10000]));
  prices.claude['claude-sonnet-5-5'].out = 10; fs.writeFileSync(pricesFile, JSON.stringify(prices));

  // M2: remote real meter DB, no Claude/Codex/Antigravity buckets at all.
  const meter = separate('meter'), remote = path.join(tmp, 'box-b');
  fs.mkdirSync(path.join(remote, '.meter'), { recursive: true });
  run(python, ['-c', `import sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.executescript("""CREATE TABLE usage(id TEXT, hour_ms INTEGER, harness TEXT, model TEXT, input_uncached INTEGER, cache_read INTEGER, cache_write_5m INTEGER, cache_write_1h INTEGER, output INTEGER, reasoning INTEGER, events INTEGER, reported_usd REAL);
INSERT INTO usage VALUES('fixture-omp',1794409200000,'omp','fixture-meter',0,0,0,0,100000,0,1,1),('fixture-dsh',1794409200000,'dsh-tui','fixture-meter',0,0,0,0,200000,0,1,2);"""); c.close()`, path.join(remote, '.meter/meter.db')]);
  fs.mkdirSync(path.join(meter.HOME, '.ssh')); const config = path.join(meter.HOME, '.ssh/config');
  fs.writeFileSync(config, 'Host box-b\n  HostName box-b.invalid\nHost box-c\n  HostName box-c.invalid\n');
  scan(21, 'box-b', meter);
  const savedFile = path.join(meter.WORTHIT_HOME, 'run-keep/box-b.json'), savedBytes = fs.readFileSync(savedFile);
  const saved = JSON.parse(savedBytes); assert.deepEqual(saved.buckets, []); assert.equal(saved.meter_usage.length, 2);
  check('meter_providers', sql("SELECT provider, api_usd, output_tokens, requests FROM day_provider ORDER BY provider", meter));
  check('meter_left_out', scan(21, 'none', meter).machines_left_out);
  // M3: actual removal from SSH config, not a hand-set machines_left_out field.
  fs.writeFileSync(config, '');
  check('removed_alias', scan(21, 'none', meter).machines_left_out);
  const later = { ...meter, FIXTURE_NOW: '2026-12-20T12:00:00Z' };
  check('removed_alias_old_scan', scan(21, 'none', later).machines_left_out);
  check('meter_providers', sql("SELECT provider, api_usd, output_tokens, requests FROM day_provider ORDER BY provider", later));
  fs.writeFileSync(savedFile, '{broken');
  check('unreadable_saved', scan(21, 'none', later).machines_left_out);
  fs.writeFileSync(savedFile, savedBytes);
  // Temporary files and retired subdirectories are not saved aliases.
  fs.writeFileSync(path.join(meter.WORTHIT_HOME, 'run-keep/box-b.json.123.fixture.tmp'), '{broken');
  fs.mkdirSync(path.join(meter.WORTHIT_HOME, 'run-keep/retired'), { recursive: true });
  fs.writeFileSync(path.join(meter.WORTHIT_HOME, 'run-keep/retired/not-an-active-alias.json'), '{broken');
  check('ignored_temporary', scan(21, 'none', later).machines_left_out);

  // Dot names and names containing tmp are legitimate aliases, scanned from actual config.
  const aliasNames = ['tmp', 'fixture.tmp', '.box', '.tmp'];
  const aliases = { ...separate('aliases'), FIXTURE_SSH_ALIASES: JSON.stringify(aliasNames) };
  for (const alias of aliasNames) fs.cpSync(path.join(remote, '.meter'), path.join(tmp, alias, '.meter'), { recursive: true });
  fs.mkdirSync(path.join(aliases.HOME, '.ssh'));
  const aliasConfig = path.join(aliases.HOME, '.ssh/config');
  fs.writeFileSync(aliasConfig, aliasNames.map(alias => `Host ${alias}\n  HostName fixture.invalid\n`).join(''));
  scan(21, 'all', aliases);
  for (const alias of aliasNames) assert.ok(fs.existsSync(path.join(aliases.WORTHIT_HOME, 'run-keep', alias + '.json')));
  fs.writeFileSync(aliasConfig, '');
  check('removed_dot_tmp_aliases', scan(21, 'none', aliases).machines_left_out);

  // An actual fresh equivalent answer suppresses the saved alias; its fallback does not.
  const dup = { ...meter, WORTHIT_HOME: path.join(tmp, 'duplicate-store'), FIXTURE_HOST_NAMES: '{"box-c":"box-b"}' };
  fs.cpSync(meter.WORTHIT_HOME, dup.WORTHIT_HOME, { recursive: true });
  fs.cpSync(path.join(remote, '.meter'), path.join(tmp, 'box-c/.meter'), { recursive: true });
  fs.writeFileSync(config, 'Host box-c\n  HostName box-c.invalid\n');
  check('fresh_equivalent', scan(21, 'box-c', dup).machines_left_out);
  const fallback = scan(21, 'box-c', { ...dup, FIXTURE_OFFLINE_ALIASES: 'box-c' });
  check('fallback_not_equivalent', fallback.machines_left_out);
  assert.equal(fallback.machines_missing.length, 1); assert.ok(fallback.machines_missing[0].saved_scan_at);

  // Explicit retirement ends the left-out warning and keeps the source snapshot frozen.
  cli(['hosts', 'retire', 'box-b'], later);
  const frozen = path.join(meter.WORTHIT_HOME, 'run-keep/retired/box-b.json'), frozenBytes = fs.readFileSync(frozen);
  check('retired_alias', scan(90, 'none', later).machines_left_out);
  assert.deepEqual(fs.readFileSync(frozen), frozenBytes);
  check('meter_providers', sql("SELECT provider, api_usd, output_tokens, requests FROM day_provider ORDER BY provider", later));
  expected.done();
  assert.ok(!fs.readFileSync(env.FIXTURE_TRACE, 'utf8').includes('"unexpected"'));
} finally { isolated.cleanup(); }
