import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const saved = JSON.parse(fs.readFileSync(new URL('./saved.json', import.meta.url), 'utf8'));
const isolated = isolatedEnvironment(), { tmp, bin, home, env } = isolated;
env.XDG_CACHE_HOME = path.join(home, '.cache');
env.npm_config_cache = path.join(home, '.npm');
env.NODE_OPTIONS = `--import=${path.join(root, 'test/support/clock.mjs')}`;
env.FIXTURE_AGENT_TRACE = path.join(tmp, 'agent-calls.txt');
const last = path.join(env.WORTHIT_HOME, 'last.json');
const failures = [];
let cases = 0;
const check = (label, fn) => {
  cases++;
  try { fn(); console.log(`${label}: PASS`); }
  catch (error) { failures.push(label); console.error(`${label}: FAIL\n${error.message}`); }
};
const invoke = (data, topic, { ai = 'no', mode = 'unusable' } = {}) => {
  const before = JSON.stringify(data);
  fs.writeFileSync(last, before);
  fs.writeFileSync(env.FIXTURE_AGENT_TRACE, '');
  const result = spawnSync(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'share',
    ...(topic ? [topic] : []), '--ai', ai, '--no-files'], {
    cwd: tmp, env: { ...env, FIXTURE_AGENT_MODE: mode }, encoding: 'utf8', timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(fs.readFileSync(last, 'utf8'), before, 'share must leave the finished run untouched');
  assert.equal(fs.readFileSync(env.FIXTURE_AGENT_TRACE, 'utf8'), ai === 'claude' ? mode + '\n' : '',
    'custom AI must reach the local executable, built-in topics must not invoke AI');
  // Include the actual CLI streams in a failing receipt, rather than just the assertion delta.
  console.log(JSON.stringify({ topic: topic || '(default)', ai, status: result.status,
    stdout: result.stdout, stderr: result.stderr }));
  return result;
};
const unavailable = result => {
  assert.equal(result.status, 1, 'no allowance is an intentional no-result exit');
  assert.equal(result.stdout, '', 'no fabricated successful JSON or post');
  assert.equal(result.stderr, 'worthit share: no allowance data for this week\n',
    'one useful diagnostic, without a stack trace');
};
const usable = (result, topic, by = 'built-in') => {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const out = JSON.parse(result.stdout);
  assert.equal(out.topic, topic);
  assert.equal(out.written_by, by);
  assert.equal(out.image, null);
  assert.equal(out.data_generated_at, saved.generated_at);
  assert.equal(out.characters, out.text.length);
  assert.ok(out.text.trim());
  assert.equal(new URL(out.url).searchParams.get('text'), out.text);
  assert.deepEqual(Object.keys(out).sort(), ['topic', 'written_by', 'text', 'characters', 'image',
    'url', 'data_generated_at', 'warnings'].sort(), 'existing JSON contract');
  return out;
};
const delivery = { features: 8, fix_share_pct: 25, usd_per_feature: 20,
  usd_per_feature_change_pct: null,
  weeks: [{ weeks_ago: 0, to: saved.week.to, features: 8, usd_per_feature: 20 }] };
const supported = { ...saved, totals: { ...saved.totals, api_value_usd: 160 },
  git: { merged_prs: 16, usd_per_merged_pr: 10,
  coverage: { prs: true, commits: true } }, delivery };
const plan = { plan: 'Sample plan', key: 'sample', color: '#c898ff', proof: 'measured',
  usd_per_full_week: 100, plan_usd_per_week: 10, times_plan_price: 10, change_vs_last_week_pct: null };
try {
  fs.mkdirSync(env.WORTHIT_HOME, { recursive: true });
  const agent = path.join(bin, 'claude');
  fs.copyFileSync(new URL('./agent.mjs', import.meta.url), agent);
  fs.chmodSync(agent, 0o755);
  for (const topic of ['allowance', undefined, 'weekly', 'value', 'ranking']) {
    check(`no plans / ${topic || 'default'}`, () => unavailable(invoke(saved, topic)));
  }
  check('no plans / absent delivery fallback', () => unavailable(invoke(saved, 'delivery')));
  check('no plans / insufficient delivery cost fallback', () => unavailable(invoke({ ...supported,
    delivery: { ...delivery, features: 2, usd_per_feature: null } }, 'delivery')));
  check('no plans / unusable custom AI fallback', () => unavailable(invoke(saved, 'my busiest hours', { ai: 'claude' })));
  for (const topic of ['open', 'models', 'waste']) {
    check(`no plans / usable ${topic}`, () => usable(invoke(saved, topic), topic));
  }
  check('no plans / usable delivery', () => {
    const out = usable(invoke(supported, 'delivery'), 'delivery');
    assert.match(out.text, /\$20 each/);
    assert.ok(!out.warnings.some(w => /weekly allowance post instead/.test(w)));
  });
  check('no plans / withheld delivery stays delivery', () => {
    const data = { ...supported, machines_missing: [{ machine: 'sample-box' }],
      git: { ...supported.git, usd_per_merged_pr: null },
      delivery: { ...delivery, usd_per_feature: null } };
    const out = usable(invoke(data, 'delivery'), 'delivery');
    assert.match(out.text, /n\/a \(partial usage; not compared\)/);
    assert.ok(!/\$0|\$null|weekly ai allowance check/.test(out.text));
    assert.ok(!out.warnings.some(w => /weekly allowance post instead/.test(w)));
  });
  check('no plans / usable custom AI', () => {
    const out = usable(invoke(saved, 'my output tokens', { ai: 'claude', mode: 'usable' }), 'custom', 'Claude Sonnet 5.5');
    assert.equal(out.text, 'my ai output this week: 100000 tokens. npx worthit');
  });
  for (const proof of ['measured', 'floor']) {
    const data = { ...saved, plans: [{ ...plan, proof }] };
    for (const topic of ['allowance', 'value', 'ranking']) {
      check(`${proof} plan / ${topic}`, () => {
        const out = usable(invoke(data, topic), topic);
        assert.match(out.text, /sample plan/);
        if (topic === 'allowance') assert.match(out.text, /sample plan \$100/);
        assert.equal(out.warnings.some(w => /a floor/.test(w)), proof === 'floor');
      });
    }
    for (const [label, topic, options] of [
      ['absent delivery fallback', 'delivery', {}],
      ['unusable AI fallback', 'my busiest hours', { ai: 'claude' }],
    ]) {
      check(`${proof} plan / ${label}`, () => {
        const out = usable(invoke(data, topic, options), 'allowance');
        assert.match(out.text, /sample plan \$100/);
        assert.ok(out.warnings.some(w => /using the weekly allowance post instead/.test(w)));
        if (proof === 'floor') assert.match(out.text, /\(at least\)/);
      });
    }
  }
} finally { isolated.cleanup(); }
console.log(`share-no-plan: ${cases} cases, ${failures.length} failed`);
process.exitCode = failures.length ? 1 : 0;
