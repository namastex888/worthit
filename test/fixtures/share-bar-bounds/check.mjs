// Issue #70: share must draw a bounded bar without changing the receipt's numbers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { cardSpec } from '../../../src/card.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const isolated = isolatedEnvironment(), { tmp, env } = isolated;
try {
  env.HOME = fs.realpathSync(env.HOME);
  fs.mkdirSync(env.WORTHIT_HOME);
  env.WORTHIT_HOME = fs.realpathSync(env.WORTHIT_HOME);
  // Start with the reported $6 allowance / $46 weekly price. Zero also produces
  // an infinite drawing ratio; zero/zero produces NaN. Neither should throw.
  for (const [allowance, price, multiple, currency] of [
    [6, 46, 0.13, '$6'], [0, 46, 0, '$0'], [0, 0, 0, '$0'],
    [-6, 46, -0.13, '$-6'], [92, 46, 2, '$92'],
  ]) {
    const data = { generated_at: new Date().toISOString(), week: { to: '2026-11-14' },
      plans: [{ plan: 'Example plan', usd_per_full_week: allowance, plan_usd_per_week: price,
        times_plan_price: multiple, proof: 'measured', color: '#78dcca' }] };
    const spec = cardSpec('value', data);
    assert.equal(spec.hero, multiple + '×');
    assert.equal(spec.rows[0].value, currency);
    assert.equal(spec.rows[1].value, '$' + price);
    assert.equal(spec.rows[1].pct, price / allowance, 'source ratio keeps its relative-value meaning');
    fs.writeFileSync(path.join(env.WORTHIT_HOME, 'last.json'), JSON.stringify(data));
    const r = spawnSync(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'share', 'value', '--ai', 'no', '--no-files'], {
      cwd: fs.realpathSync(tmp), env, input: '', encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, `share value (${allowance}/${price})\n${r.stderr || r.error?.message || r.stdout}`);
    const result = JSON.parse(r.stdout);
    assert.equal(result.topic, 'value');
    assert.ok(result.text.includes(`one weekly limit gave me ${currency} of api-priced usage.. ${multiple}× the price.`), 'printed value and multiple unchanged');
    assert.ok(result.text.startsWith(`i pay $${Math.round(price * 52 / 12 / 10) * 10}/mo for example plan.`), 'printed subscription price unchanged');
    assert.equal(result.image, null);
  }
  console.log('share-bar-bounds: low, zero, nonfinite, negative and ordinary ratios exit 0; receipt numbers unchanged');
} finally { isolated.cleanup(); }
