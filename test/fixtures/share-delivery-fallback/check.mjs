import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { cardSpec } from '../../../src/card.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const saved = JSON.parse(fs.readFileSync(new URL('./saved.json', import.meta.url), 'utf8'));
const isolated = isolatedEnvironment(), { tmp, env } = isolated;
env.NODE_OPTIONS = `--import=${path.join(root, 'test/support/clock.mjs')}`;
const last = path.join(env.WORTHIT_HOME, 'last.json');
const share = (data, topic = 'delivery', demo = false) => {
  const before = JSON.stringify(data);
  fs.writeFileSync(last, before);
  const result = spawnSync(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'share', topic, '--ai', 'no', '--no-files', ...(demo ? ['--demo'] : [])],
    { cwd: tmp, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  assert.equal(fs.readFileSync(last, 'utf8'), before, 'sharing leaves the saved run untouched');
  const out = JSON.parse(result.stdout);
  assert.equal(out.written_by, 'built-in');
  assert.equal(out.image, null);
  assert.equal(new URL(out.url).searchParams.get('text'), out.text);
  assert.equal(out.characters, out.text.length);
  assert.deepEqual(Object.keys(out).sort(), ['topic', 'written_by', 'text', 'characters', 'image', 'url', 'data_generated_at', 'warnings'].sort(), 'existing share JSON shape');
  return out;
};
const fallback = (out, label) => {
  console.log(`${label}: topic=${out.topic}; allowance=${out.text.startsWith('weekly ai allowance check')}; fallback warning=${out.warnings.some(w => /weekly allowance post instead/.test(w))}`);
  assert.equal(out.topic, 'allowance', `${label}: effective topic matches the allowance post`);
  assert.match(out.text, /^weekly ai allowance check/);
  assert.ok(out.warnings.some(w => /delivery.*(?:unavailable|no cost per feature).*using the weekly allowance post instead/.test(w)), `${label}: explains unavailable delivery and fallback`);
};
try {
  fs.mkdirSync(env.WORTHIT_HOME, { recursive: true });
  fallback(share(saved), 'no-git saved run');
  assert.deepEqual(cardSpec('delivery', saved), cardSpec('allowance', saved), 'same existing allowance drawing');
  const delivery = { features: 10, fix_share_pct: 25, usd_per_feature: 20, usd_per_feature_change_pct: -50,
    weeks: [{ weeks_ago: 1, to: '2026-11-07', features: 5, usd_per_feature: 40 }, { weeks_ago: 0, to: '2026-11-14', features: 10, usd_per_feature: 20 }] };
  const supported = { ...saved, git: { coverage: { prs: true, commits: true } }, delivery };
  fallback(share({ ...supported, delivery: { ...delivery, features: 2, usd_per_feature: null } }), 'unavailable cost');
  fallback(share(saved, 'features'), 'delivery alias');
  for (const coverage of [{ prs: true, commits: true }, { prs: false, commits: true }, { prs: true, commits: false }, {}]) {
    const out = share({ ...supported, git: { coverage } });
    assert.equal(out.topic, 'delivery', 'usable cost retains delivery even with floor plans or partial git coverage');
    assert.match(out.text, /mine this week: \$20 each/);
    assert.ok(!out.warnings.some(w => /weekly allowance post instead/.test(w)));
    assert.equal(/at least 10 features/.test(out.text), !coverage.prs);
    assert.equal(/partial feature count; not compared/.test(out.text), !coverage.prs);
    assert.equal(/50% vs last week/.test(out.text), !!coverage.prs);
    assert.ok(out.warnings.some(w => /a floor/.test(w)), 'preserves plan proof warning');
    assert.equal(out.warnings.some(w => /git source coverage is incomplete/.test(w)), !coverage.prs);
    assert.ok(!/at least \$/.test(out.text), 'partial cost is never a floor');
  }
  assert.equal(share({ ...supported, delivery: { ...delivery, usd_per_feature: 0 } }).topic, 'delivery', 'zero cost is usable');
  // Demo is another caller of the same selection logic; do not change its data.
  fallback(share(saved, 'delivery', true), 'bundled demo');
  console.log('share-delivery-fallback: absent/null data, aliases, demo and supported coverage controls match');
} finally { isolated.cleanup(); }
