// Issue #102: machine proof must reach usage changes and every displayed cost.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { blocks, strip, usageCostWithheld } from '../../../src/draw.mjs';
import { cardSpec, cardHtml, deliveryText } from '../../../src/card.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(folder, '../../..');
const isolated = isolatedEnvironment(), failures = [];
const check = (name, fn) => { try { fn(); } catch (error) { failures.push(`${name}: ${error.message}`); } };
const modes = ['complete', 'retained-outside', 'retained-prior', 'partial-pr',
  'missing', 'saved-answer', 'left-out', 'retained-current', 'retained-boundary', 'no-plan-missing', 'missing-partial-pr',
  'no-delivery', 'zero-feature-missing', 'few-features-missing', 'zero-prs', 'zero-usage'];
try {
  for (const mode of modes) {
    const store = path.join(isolated.tmp, mode);
    const env = { ...isolated.env, WORTHIT_HOME: store,
      NODE_OPTIONS: `--import=${path.join(root, 'test/support/clock.mjs')}`, FIXTURE_NOW: '2026-11-14T12:00:00Z' };
    const run = args => {
      const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
      assert.equal(result.status, 0, `${mode}: child failed: ${result.error || result.stderr || result.stdout}`);
      return JSON.parse(result.stdout);
    };
    const data = run([path.join(folder, 'collect.mjs'), mode]);
    if (['no-delivery', 'zero-feature-missing', 'few-features-missing', 'zero-prs', 'zero-usage'].includes(mode)) {
      check(`${mode} real buildData invariant and fallback control`, () => {
        assert.equal(usageCostWithheld(data), mode.includes('missing'));
        if (mode === 'zero-usage') {
          assert.equal(data.git.merged_prs, 8);
          assert.equal(data.git.usd_per_merged_pr, 0);
          assert.equal(data.delivery.usd_per_feature, 0);
        } else if (mode === 'no-delivery') assert.equal(data.delivery, undefined);
        else {
          assert.equal(data.git.usd_per_merged_pr, null);
          assert.equal(data.delivery.features, mode === 'few-features-missing' ? 2 : 0);
          assert.deepEqual(cardSpec('delivery', data), cardSpec('allowance', data));
        }
        const shared = run([path.join(root, 'bin/worthit.mjs'), 'share', 'features', '--no-files', '--ai', 'no']);
        assert.equal(shared.topic, mode === 'zero-usage' ? 'delivery' : 'allowance');
        if (mode === 'zero-usage') assert.match(shared.text, /\$0 each/);
        else assert.ok(shared.warnings.some(warning => /weekly allowance post instead/.test(warning)));
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(store, 'last.json'), 'utf8')), data);
      });
      continue;
    }
    const floor = !['complete', 'retained-outside', 'retained-prior', 'partial-pr'].includes(mode);
    const priorFloor = mode === 'retained-prior' || mode === 'retained-boundary';
    const covered = !mode.includes('partial-pr');
    const changes = [data.totals.output_tokens_change_pct, data.totals.api_value_change_pct,
      data.git.usd_per_pr_change_pct, data.delivery.usd_per_feature_change_pct];
    const tiles = blocks.Tiles(data).map(strip).join('\n');
    const delivery = blocks.Delivery(data).map(strip).join('\n');
    const costLine = delivery.split('\n').find(line => line.includes('cost per feature'));
    let spec, html = '', text = '';
    check(`${mode} delivery surface construction`, () => {
      spec = cardSpec('delivery', data); html = cardHtml(spec); text = deliveryText(data);
    });
    const saved = JSON.parse(fs.readFileSync(path.join(store, 'last.json'), 'utf8'));
    check(`${mode} persisted actual buildData output`, () => assert.deepEqual(saved, data));
    check(`${mode} source condition`, () => {
      assert.equal(data.git.coverage.prs, covered);
      assert.equal(data.totals.api_value_usd, 300);
      assert.equal(data.totals.output_tokens, 2000000);
      assert.equal(data.git.merged_prs, 8);
      assert.equal(data.delivery.features, 6);
      assert.equal(data.git.merged_prs_change_pct, covered ? 33 : null);
      assert.equal(data.delivery.features_change_pct, covered ? 20 : null);
      if (mode === 'no-plan-missing') assert.deepEqual(data.plans, []);
      else assert.equal(data.plans[0].proof, floor ? 'floor' : 'measured');
      if (mode.includes('missing') || mode === 'saved-answer') assert.equal(data.machines_missing.length, 1);
      if (mode === 'left-out') assert.deepEqual(data.machines_left_out, ['box-c']);
      if (mode.startsWith('retained-')) assert.equal(data.machines_retained.length, 1);
    });
    // These positive non-half percentages also follow symmetric rounding; every
    // machine-floor assertion still requires null, before any presentation rule.
    check(`${mode} usage-derived changes`, () => assert.deepEqual(changes,
      floor || priorFloor ? [null, null, null, null] : [100, 100, covered ? 50 : null, covered ? 67 : null]));
    check(`${mode} current costs`, () => {
      assert.equal(usageCostWithheld(data), floor, 'the shared signal follows real buildData, independently of plan availability');
      assert.equal(data.git.usd_per_merged_pr, floor ? null : 37.5);
      assert.equal(data.delivery.usd_per_feature, floor ? null : 50);
      const current = data.delivery.weeks.find(row => row.weeks_ago === 0);
      assert.equal(current.usd, floor ? null : 300);
      assert.equal(current.usd_per_feature, floor ? null : 50);
      if (floor) {
        assert.ok(data.git.usd_per_pr_per_day.every(value => value == null), 'daily PR ratios must not imply complete usage');
        assert.ok(data.delivery.days.every(row => row.usd == null && row.usd_per_feature == null), 'daily costs withheld for partial usage');
        assert.ok(data.delivery.months.every(row => row.usd == null && row.usd_per_feature == null), 'monthly costs withheld for partial usage');
        assert.ok(!data.game.personal_bests.includes('lowest cost per PR'));
      }
    });
    check(`${mode} prior-only floor cost`, () => {
      if (!priorFloor) return;
      const prior = data.delivery.weeks.find(row => row.weeks_ago === 1);
      assert.equal(prior.usd, null);
      assert.equal(prior.usd_per_feature, null);
      assert.ok(data.delivery.days.every(row => row.usd == null && row.usd_per_feature == null));
      assert.ok(data.delivery.months.every(row => row.usd == null && row.usd_per_feature == null));
    });
    check(`${mode} dashboard cost proof`, () => {
      if (floor || priorFloor) {
        // Check usage cells only; complete Git count arrows must remain visible.
        for (const column of [1, 3, 7]) {
          const cell = tiles.split('\n').map(line => line.split('│')[column] || '').join('\n');
          assert.match(cell, /not compared/);
          assert.doesNotMatch(cell, /no earlier week|[▲▼]|vs prev 7 d/);
        }
        assert.doesNotMatch(costLine, /[▲▼]|vs prev 7 d/);
      }
      if (floor) {
        assert.match(costLine, /n\/a.*partial usage.*not compared/);
      }
      if (covered) assert.match(tiles, /▲ 33% vs prev 7 d/, 'complete PR comparison remains independent');
      if (mode === 'partial-pr') {
        assert.match(tiles, /partial PR count/);
        assert.match(costLine, /\$50.*partial feature count.*not compared/);
      }
      assert.doesNotMatch(tiles + delivery, /at least \$/);
    });
    check(`${mode} explicit delivery card and text`, () => {
      assert.ok(spec, 'delivery card must support usage floors even when there are no plans');
      assert.match(spec.eyebrow, /feature/i);
      assert.equal(spec.hero, floor ? 'n/a' : '$50');
      assert.doesNotMatch(html + text, /at least \$|\$null|\$undefined/);
      if (floor) {
        assert.match(html, /partial usage.*not compared/);
        assert.match(text, /partial usage.*not compared/);
        assert.doesNotMatch(html + text, /% vs last week/);
      }
      if (priorFloor) assert.doesNotMatch(html + text, /% vs last week/);
      if (!covered) {
        assert.match(html + text, /at least 6 features/);
        assert.doesNotMatch(html + text, /% vs last week/);
      }
      if (!floor && !priorFloor && covered) assert.match(html + text, /67% vs last week/);
    });
    check(`${mode} real share consumer`, () => {
      const shared = run([path.join(root, 'bin/worthit.mjs'), 'share', 'delivery', '--no-files', '--ai', 'no']);
      assert.equal(shared.topic, 'delivery', 'usage withholding must not select the allowance fallback');
      assert.equal(shared.text, text, 'the CLI must keep the delivery topic when usage withholds its cost');
    });
    if (isolated.env.WORTHIT_FIXTURE_ARTIFACTS) {
      const artifacts = path.join(isolated.env.WORTHIT_FIXTURE_ARTIFACTS, 'usage-floor-comparisons');
      fs.mkdirSync(artifacts, { recursive: true });
      for (const [suffix, content] of [['.json', JSON.stringify(data, null, 2)], ['-dashboard.txt', tiles + '\n' + delivery],
        ['-card.html', html], ['-share.txt', text]])
        fs.writeFileSync(path.join(artifacts, mode + suffix), content);
    }
  }
} finally { isolated.cleanup(); }
assert.equal(failures.length, 0, failures.join('\n'));
console.log('usage-floor-comparisons: real buildData machine floors suppress usage changes and costs; independent Git counts and complete-source controls preserved');
