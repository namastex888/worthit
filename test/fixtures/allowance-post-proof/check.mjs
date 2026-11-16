// Issue 135: actual allowance posts must not turn plan floors into measurements.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { demoData } from '../../../src/demo.mjs';
import { allowanceText, prepareWeekly } from '../../../src/weekly.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const isolated = isolatedEnvironment(), { tmp, home, env } = isolated;
env.NODE_OPTIONS = `--import=${path.join(root, 'test/support/clock.mjs')}`;
env.XDG_CACHE_HOME = path.join(home, '.cache');
env.npm_config_cache = path.join(home, '.npm');
const last = path.join(env.WORTHIT_HOME, 'last.json');
const failures = [];
let cases = 0;
const check = (label, fn) => {
  cases++;
  try { fn(); console.log(`${label}: PASS`); }
  catch (error) { failures.push(label); console.error(`${label}: FAIL\n${error.stack}`); }
};
const invoke = (args, saved) => {
  const before = saved ? JSON.stringify(saved) : null;
  if (before) fs.writeFileSync(last, before);
  const result = spawnSync(process.execPath, [path.join(root, 'bin/worthit.mjs'), ...args], {
    cwd: tmp, env, input: '', encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20,
  });
  console.log(JSON.stringify({ args, status: result.status, signal: result.signal,
    error: result.error?.message, stdout: result.stdout, stderr: result.stderr }));
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  if (before) assert.equal(fs.readFileSync(last, 'utf8'), before, 'share leaves the saved run intact');
  return result;
};
const attribution = text => {
  const suffix = text.split('\n').at(-1);
  assert.doesNotMatch(suffix, /\bmeasured\b/i, 'post attribution must not claim every plan is measured');
  assert.match(suffix, /pric(?:ed|es|ing).*api/i, 'keep the API-pricing basis');
  assert.match(suffix, /local logs.*npx worthit$/i, 'keep the local source and command');
};
const lines = (text, plans) => {
  for (const plan of plans) {
    const line = text.split('\n').find(l => l.startsWith(plan.plan.toLowerCase() + ' '));
    assert.ok(line, `post includes ${plan.plan}`);
    if (plan.proof !== 'measured') {
      assert.match(line, /\(at least\)/);
      assert.doesNotMatch(line, /%|week before|retired/);
    } else {
      assert.doesNotMatch(line, /at least/);
      if (plan.change_vs_last_week_pct === 25) assert.match(line, /▲25% vs the week before/);
      if (plan.retirement_note) assert.ok(line.includes(plan.retirement_note));
    }
  }
};
const sample = demoData({ git: false });
sample.machines = 1;
sample.machines_missing = []; sample.machines_left_out = [];
sample.machines_retained = []; sample.machines_retired = [];
const plan = (name, proof) => ({ plan: name, key: name.toLowerCase().replaceAll(' ', '-'),
  color: '#4c94f0', usd_per_full_week: 125, times_plan_price: 5, plan_usd_per_week: 25,
  proof, change_vs_last_week_pct: 25, retirement_note: 'sample-old retired before this week' });
const measured = plan('Sample Meter', 'measured'), floor = plan('Sample Floor', 'floor');
try {
  fs.mkdirSync(env.WORTHIT_HOME, { recursive: true });
  for (const [label, plans] of [['mixed', [measured, floor]], ['measured', [measured]], ['floor', [floor]]]) {
    check(`share allowance / ${label}`, () => {
      const result = invoke(['share', 'allowance', '--ai', 'no', '--no-files'], { ...sample, plans });
      assert.equal(result.status, 0, result.stderr);
      const out = JSON.parse(result.stdout);
      assert.equal(out.topic, 'allowance'); assert.equal(out.written_by, 'built-in');
      assert.equal(out.image, null); assert.equal(out.characters, out.text.length);
      assert.equal(new URL(out.url).searchParams.get('text'), out.text);
      assert.equal(out.warnings.some(w => /a floor/.test(w)), plans.some(p => p.proof !== 'measured'));
      lines(out.text, plans);
      attribution(out.text);
    });
  }
  check('share allowance / empty', () => {
    const result = invoke(['share', 'allowance', '--ai', 'no', '--no-files'], { ...sample, plans: [] });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'worthit share: no allowance data for this week\n');
  });
  check('share allowance / demo', () => {
    const result = invoke(['share', 'allowance', '--demo', '--ai', 'no', '--no-files']);
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.ok(out.warnings.some(w => /a floor/.test(w)));
    lines(out.text, demoData().plans);
    attribution(out.text);
  });
  check('weekly / demo --no-files', () => {
    const result = invoke(['weekly', '--demo', '--no-files']);
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.safe_to_post, true); assert.deepEqual(out.reasons, []);
    assert.equal(out.image, null); assert.equal(out.audit_log, null);
    assert.ok(out.plans.some(p => p.proof === 'measured'));
    assert.ok(out.plans.some(p => p.proof === 'floor'));
    assert.ok(out.plans.every(p => p.change_vs_last_week_pct === null));
    lines(out.text, out.plans);
    attribution(out.text);
  });
  check('weekly / proof and comparison controls', () => {
    const data = { ...sample, plans: [measured, floor].map(p => ({ ...p })) };
    const baseline = { plans: data.plans.map(p => ({ ...p, proof: 'measured', usd_per_full_week: 100 })) };
    const out = prepareWeekly(data, baseline);
    assert.equal(out.safe_to_post, true, 'complete machines permit clearly labelled floors');
    assert.deepEqual(out.reasons, []);
    assert.deepEqual(out.plans.map(p => p.proof), ['measured', 'floor']);
    assert.deepEqual(out.plans.map(p => p.change_vs_last_week_pct), [25, null]);
    assert.deepEqual(out.moved.map(p => p.plan), ['Sample Meter']);
    lines(allowanceText(data), data.plans);
  });
  for (const [label, coverage] of [
    ['missing', { machines_missing: [{ machine: 'sample-box' }] }],
    ['left out', { machines_left_out: ['sample-box'] }],
    ['retained', { machines_retained: [{ machine: 'sample-box', units: [
      { day: sample.week.to, provider: 'claude' },
    ] }] }],
  ]) check(`weekly / ${label} machines remain unsafe`, () => {
    const data = { ...sample, plans: [{ ...floor }], ...coverage };
    const out = prepareWeekly(data, null);
    assert.equal(out.safe_to_post, false); assert.ok(out.reasons.length > 0);
    assert.equal(out.plans[0].proof, 'floor');
    assert.equal(out.plans[0].change_vs_last_week_pct, null);
  });
  check('formatter / empty does not claim a measurement', () => attribution(allowanceText({ ...sample, plans: [] })));
} finally { isolated.cleanup(); }
console.log(`allowance-post-proof: ${cases} cases, ${failures.length} failed`);
process.exitCode = failures.length ? 1 : 0;
