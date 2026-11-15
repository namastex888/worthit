// Exercise the shipped CLI, not just the bundled JSON or a parallel sample.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { blocks, machineNotes, strip } from '../../../src/draw.mjs';
import { cardSpec } from '../../../src/card.mjs';
import { machineVariants } from './variants.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const isolated = isolatedEnvironment();
const env = { ...isolated.env, NODE_OPTIONS: `--import=${path.join(root, 'test/support/clock.mjs')}` };
const run = (args, extra = {}) => {
  const r = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20, ...extra });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout;
};
const save = (name, text) => {
  if (!process.env.WORTHIT_FIXTURE_ARTIFACTS) return;
  fs.mkdirSync(process.env.WORTHIT_FIXTURE_ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(process.env.WORTHIT_FIXTURE_ARTIFACTS, name), text);
};
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
const pct = (a, b) => b ? Math.round(100 * (a - b) / b) : null;
try {
  const D = JSON.parse(run(['bin/worthit.mjs', '--demo', '--json'])), failures = [];
  for (const key of ['machines_missing', 'machines_left_out', 'machines_retained', 'machines_retired'])
    if (!Array.isArray(D[key])) failures.push(`${key}: required array missing from actual --demo --json`);
  if (!D.delivery?.kinds?.length || !D.delivery.features || D.delivery.usd_per_feature == null)
    failures.push('delivery: actual --demo --json has no usable kinds/features/cost per feature');
  assert.deepEqual(failures, [], failures.join('\n'));
  for (const key of ['machines_missing', 'machines_left_out', 'machines_retained', 'machines_retired'])
    assert.deepEqual(D[key], [], 'ordinary default demo: ' + key);

  const v = D.delivery, current = v.weeks.find(w => w.weeks_ago === 0), previous = v.weeks.find(w => w.weeks_ago === 1);
  assert.ok(D.git.coverage.prs, 'default demo has complete synthetic PR sources');
  assert.equal(sum(v.kinds, 'prs'), D.git.merged_prs);
  assert.equal(v.features, v.kinds.find(k => k.kind === 'feat').prs);
  assert.equal(v.usd_per_feature, Math.round(D.totals.api_value_usd / v.features));
  assert.equal(v.fix_share_pct, Math.round(100 * v.kinds.find(k => k.kind === 'fix').prs / D.git.merged_prs));
  assert.equal(v.typed_pct, Math.round(100 * (D.git.merged_prs - v.kinds.find(k => k.kind === 'other').prs) / D.git.merged_prs));
  for (const k of v.kinds) {
    assert.equal(k.share_pct, Math.round(100 * k.prs / D.git.merged_prs));
    assert.equal(k.change_pct, pct(k.prs, k.last_week));
  }
  assert.equal(current.to, D.week.to, 'delivery dates follow the runtime demo week');
  assert.equal(current.prs, D.git.merged_prs);
  assert.equal(current.features, v.features);
  assert.equal(current.usd, D.totals.api_value_usd);
  assert.equal(current.usd_per_feature, v.usd_per_feature);
  assert.equal(previous.prs, sum(v.kinds, 'last_week'));
  assert.equal(previous.features, v.kinds.find(k => k.kind === 'feat').last_week);
  assert.equal(previous.to, D.week.from);
  assert.equal(v.features_change_pct, pct(current.features, previous.features));
  assert.equal(v.usd_per_feature_change_pct, pct(current.usd_per_feature, previous.usd_per_feature));
  assert.equal(D.totals.api_value_change_pct, pct(current.usd, previous.usd));
  assert.equal(D.git.merged_prs_change_pct, pct(current.prs, previous.prs));
  assert.equal(v.days.length, 14);
  for (const [index, week] of [previous, current].entries()) {
    const days = v.days.slice(index * 7, index * 7 + 7);
    for (const key of ['prs', 'features', 'fixes', 'usd']) assert.equal(sum(days, key), week[key], key + ' daily/week coherence');
    assert.equal(week.usd_per_feature, Math.round(week.usd / week.features));
  }
  for (const [i, row] of v.days.entries()) {
    assert.equal(row.day, new Date(Date.parse(D.week.to) - (13 - i) * 864e5).toISOString().slice(0, 10));
    assert.equal(row.usd_per_feature, row.features >= 3 ? Math.round(row.usd / row.features) : null);
  }
  assert.deepEqual(v.days.slice(-7).map(r => r.prs), D.git.prs_per_day);
  assert.deepEqual(v.days.slice(-7).map(r => r.usd), D.totals.value_per_day);
  const delivery = blocks.Delivery(D).map(strip).join('\n');
  assert.match(delivery, /DELIVERY/);
  assert.match(delivery, /cost per feature\s+\$131/);
  assert.match(delivery, /features \/ week/);
  assert.doesNotMatch(delivery, /partial.*count|at least/);
  const dashboard = run(['bin/worthit.mjs', '--demo', '--git', 'yes', '--ai', 'no'], { env: { ...env, COLUMNS: '120', LINES: '40' } });
  assert.match(strip(dashboard), /DELIVERY/, 'actual default demo dashboard must render Delivery');
  assert.match(strip(dashboard), /cost per feature\s+\$131/);
  const share = JSON.parse(run(['bin/worthit.mjs', 'share', 'delivery', '--demo', '--no-files', '--ai', 'no']));
  assert.equal(share.topic, 'delivery');
  assert.match(share.text, /\$131 each.*32 features merged/);
  assert.doesNotMatch(share.text, /weekly limit|at least/);
  assert.equal(share.image, null, '--no-files does not claim a rendered image');
  assert.equal(cardSpec('delivery', D).hero, '$131');
  save('default.json', JSON.stringify(D, null, 2));
  save('default-dashboard.ansi', dashboard);
  save('delivery-share.json', JSON.stringify(share, null, 2));

  const expectedNotes = {
    missing: ['build-box: no answer, last saved scan used', 'sample-box: no answer, not counted'],
    'left-out': ['build-box: has usage, left out of this run'],
    retained: ['build-box: kept 2 older days'],
    'retained-old': ['build-box: kept 1 older day'],
  };
  // Independent oracle: run production buildData against a minimal synthetic meter report.
  // The fixture variants' proof labels must match the real machine gating rules.
  const proofScript = `import fs from 'node:fs'; import {buildData} from './src/collect.mjs';
const prices=JSON.parse(fs.readFileSync('core/prices.json'));
const w={usd_per_full_week:20,meter_start_pct:0,meter_end_pct:100,hours:1,measured:{api_usd:20,output_tokens:1000,cached_input_tokens:10,model_mix_by_usd:{}}};
const D=JSON.parse(fs.readFileSync(0,'utf8'));
const hosts=[{alias:'build-box',ok:!D.machines_missing.length}];
for(const m of D.machines_missing) { const h=hosts.find(h=>h.alias===m.machine); if(h) h.saved_at=m.saved_scan_at; else hosts.push({alias:m.machine,ok:false}); }
console.log(JSON.stringify(buildData({prices,this_week:{claude:w,codex:w,google:w}},null,{days:21},{counts:{},hosts,left_out:D.machines_left_out,retained:D.machines_retained}).plans));`;
  for (const [name, variant] of Object.entries(machineVariants(D))) {
    const plans = JSON.parse(run(['--input-type=module', '-e', proofScript], { input: JSON.stringify(variant), env: { ...env, WORTHIT_HOME: path.join(isolated.tmp, name) } }));
    for (const p of variant.plans) {
      assert.equal(p.proof, plans.find(q => q.key === p.key).proof, name + ' matches buildData proof');
      if (p.proof === 'floor' && name !== 'retained-old') assert.equal(p.change_vs_last_week_pct, null);
    }
    assert.deepEqual(machineNotes(variant), expectedNotes[name]);
    const ranking = blocks.PlanRanking(variant).map(strip).join('\n');
    for (const note of expectedNotes[name]) assert.ok(ranking.includes(note), 'actual ranking draws complete note: ' + note);
    if (name !== 'retained-old') {
      assert.ok(variant.plans.every(p => p.proof === 'floor'));
      assert.doesNotMatch(blocks.LimitTrend(variant).map(strip).join('\n'), /[▲▼]/, 'floor limits are never compared');
      assert.ok(cardSpec('allowance', variant).rows.every(r => r.note === 'at least'));
      assert.match(blocks.Delivery(variant).map(strip).join('\n'), /cost per feature\s+n\/a/);
      assert.ok(variant.git.coverage.prs, 'missing usage must not invent incomplete PR coverage');
    } else assert.equal(variant.plans.find(p => p.key === 'claude').proof, 'measured', 'old retained days do not demote this week');
    save(name + '.json', JSON.stringify(variant, null, 2));
  }
  assert.equal(fs.existsSync(env.WORTHIT_HOME), false, 'demo must not create a store');
  console.log('demo contract: actual JSON, dashboard, delivery share and four machine variants passed');
} finally { isolated.cleanup(); }
