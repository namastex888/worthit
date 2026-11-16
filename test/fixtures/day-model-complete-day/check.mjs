import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { expectedData } from '../../support/expected-data.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(folder, '../../..');
const support = path.join(root, 'test/support'), isolated = isolatedEnvironment();
const { tmp, home, bin, python, env } = isolated;
Object.assign(env, { NODE_OPTIONS: `--import=${path.join(support, 'clock.mjs')}`, PYTHONPATH: support,
  FIXTURE_MACHINE: 'box-a', FIXTURE_TMP: tmp, FIXTURE_PYTHON: python, FIXTURE_TRACE: path.join(tmp, 'commands.jsonl') });
const expected = expectedData(path.join(folder, 'expected-data.json'));
const check = (name, actual) => { assert.deepEqual(actual, expected.get(name), `day-model-complete-day / ${name}`); console.log(name + ': ' + JSON.stringify(actual)); };
const run = (args, childEnv = env) => {
  const r = spawnSync(process.execPath, args, { cwd: tmp, env: childEnv, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr || r.error || r.stdout}`);
  return JSON.parse(r.stdout);
};
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
try {
  // Only this private source copy is repriced; the implementation checkout is never edited.
  const app = path.join(tmp, 'app'); fs.mkdirSync(app);
  for (const entry of ['bin', 'src', 'core', 'skills', 'package.json']) fs.cpSync(path.join(root, entry), path.join(app, entry), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'dir');
  const priceFile = path.join(app, 'core/prices.json'), prices = JSON.parse(fs.readFileSync(priceFile));
  const price = rate => { prices.claude['claude-sonnet-5-5'].out = rate; fs.writeFileSync(priceFile, JSON.stringify(prices)); };
  const cli = args => run([path.join(app, 'bin/worthit.mjs'), ...args]);
  const scan = days => cli(['--json', '--no-files', '--days', String(days), '--hosts', 'box-b', '--git', 'no', '--ai', 'no']);
  const rows = by => cli(['days', '--since', '2026-11-07', '--until', '2026-11-14', '--by', by]);
  for (const [machine, output] of [['box-a', 100000], ['box-b', 200000]]) {
    const machineHome = machine === 'box-a' ? home : path.join(tmp, machine), logs = path.join(machineHome, '.claude/projects/example');
    fs.mkdirSync(logs, { recursive: true });
    const lines = ['2026-11-07', '2026-11-10', '2026-11-14'].map((day, i) => ({ timestamp: day + (i === 2 ? 'T09:00:00Z' : 'T15:00:00Z'), sessionId: `${machine}-${i}`, requestId: `${machine}-${i}`,
      message: { id: `${machine}-${i}`, model: 'claude-sonnet-5-5', usage: { input_tokens: 0, output_tokens: output } } }));
    fs.writeFileSync(path.join(logs, 'usage.jsonl'), lines.map(r => JSON.stringify(r)).join('\n') + '\n');
  }
  fs.mkdirSync(path.join(home, '.ssh')); fs.writeFileSync(path.join(home, '.ssh/config'), 'Host box-b\n  HostName box-b.invalid\n');
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(support, 'commands.mjs'))} ssh "$@"\n`, { mode: 0o755 });
  price(20);
  const first = scan(21); assert.deepEqual(first.machines_missing, []); assert.deepEqual(first.machines_left_out, []);
  check('before_models', rows('model')); check('before_totals', rows('total'));
  // Same literal source requests, actual API output price corrected from $20/M to $10/M.
  // Complete, oldest partial and current days all keep their stored usage maxima.
  price(10);
  const second = scan(7); assert.deepEqual(second.machines_missing, []); assert.deepEqual(second.machines_left_out, []);
  const models = rows('model'), totals = rows('total');
  check('corrected_models', models); check('corrected_totals', totals);
  assert.deepEqual(models.map(({ period, api_usd, output_tokens }) => ({ period, api_usd, output_tokens })),
    totals.map(({ period, api_usd, output_tokens }) => ({ period, api_usd, output_tokens })), 'rescan MAX: CLI --by model and --by total agree in UTC');
  check('corrected_models', rows('model')); // A query never changes stored values.
  scan(7); check('corrected_models', rows('model')); check('corrected_totals', rows('total'));
  // buildData controls isolate both field updates and coverage from scan merging/pricing.
  for (const [name, tz, now, hour] of [
    ['complete', 'UTC', '2026-11-14T12:00:00Z', '2026-11-10T15'],
    ['partial_oldest', 'UTC', '2026-11-14T12:00:00Z', '2026-11-07T15'],
    ['current', 'UTC', '2026-11-14T12:00:00Z', '2026-11-14T09'],
    ['utc_partial_local_complete', 'America/Los_Angeles', '2026-11-14T04:00:00Z', '2026-11-07T15'],
    ['utc_complete_local_partial', 'America/Los_Angeles', '2026-11-14T04:00:00Z', '2026-11-13T15'],
    ['crossed_midnight', 'UTC', '2026-11-15T00:01:00Z', '2026-11-14T15'],
    ['midnight', 'UTC', '2026-11-14T00:00:00Z', '2026-11-07T15'],
    ['missing', 'UTC', '2026-11-14T12:00:00Z', '2026-11-10T15'],
    ['cached', 'UTC', '2026-11-14T12:00:00Z', '2026-11-10T15'],
    ['left_out', 'UTC', '2026-11-14T12:00:00Z', '2026-11-10T15'],
    ['retired_before', 'UTC', '2026-11-14T12:00:00Z', '2026-11-10T15'],
    ['retired_boundary', 'UTC', '2026-11-14T12:00:00Z', '2026-11-10T15'],
    ['retired_local_only', 'America/Los_Angeles', '2026-11-14T12:00:00Z', '2026-11-10T15'],
  ]) check(name, run([path.join(folder, 'controls.mjs'), name, now, hour], { ...env, TZ: tz, WORTHIT_HOME: path.join(tmp, name) }));
  const schema = cli(['schema']);
  assert.match(schema.day_model.about, /UTC day.*never decreases.*MAX/);
  assert.match(schema.day_model.about, /price cuts or dedupe fixes cannot lower/);
  assert.match(schema.day_provider.about, /local day.*never decreases.*MAX/);
  assert.match(schema.day.about, /14-day window.*sources answered.*MAX.*outside/);
  expected.done();
  assert.ok(!fs.readFileSync(env.FIXTURE_TRACE, 'utf8').includes('"unexpected"'));
} finally { isolated.cleanup(); }
