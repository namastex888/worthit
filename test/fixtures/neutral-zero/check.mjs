// Issue #104: inspect real presentation functions and the share CLI, using synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../../support/clock.mjs';

assert.ok(process.env.HOME && process.env.WORTHIT_HOME && process.env.TMPDIR,
  'explicit synthetic HOME, WORTHIT_HOME and TMPDIR required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const draw = await import('../../../src/draw.mjs');
const { C, blocks, strip, fg, len } = draw;
const { cardSpec, cardHtml } = await import('../../../src/card.mjs');
const { demoData } = await import('../../../src/demo.mjs');
const { roundPercent } = await import('../../../src/percent.mjs');
const { SCHEMA } = await import('../../../src/query.mjs');
const source = fs.readFileSync(path.join(root, 'bin/worthit.mjs'), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `CLI source boundaries: ${start}`);
  return source.slice(a, b);
};
// Run the unchanged CLI's HTML/Markdown writers without Ink startup or Chrome discovery.
// Only filesystem/audit effects are replaced; all percentage formatting is production code.
const writers = section('function ansiHtml(lines)', 'const LOGO =')
  + section('function writeFiles(spec)', '// ---------------------------------------------------------------- UI');
const surfacesHtml = lines => vm.runInNewContext(
  section('function ansiHtml(lines)', 'const LOGO =') + '\nansiHtml(lines)', { lines });
const artifacts = process.env.WORTHIT_FIXTURE_ARTIFACTS;
const save = (name, value) => {
  if (!artifacts) return;
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, name), value);
};
let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`); }
  catch (error) { failures++; console.error(`FAIL ${label}: ${error.message}`); }
};
const surfaces = data => {
  const lines = [...blocks.Tiles(data), '', ...blocks.Delivery(data)];
  const files = new Map();
  const context = vm.createContext({ ...draw, DATA: data, NO_FILES: false,
    VERSION: 'synthetic', STAMP: '2026-11-14', LOGO: [], process: { env: {} },
    specLines: () => lines, audit() {}, writeAudit() {},
    fs: { existsSync: () => false, writeFileSync: (name, value) => files.set(name, value) } });
  vm.runInContext(writers, context, { filename: 'worthit-presentation.mjs' });
  vm.runInContext('writeFiles({ elements: {} })', context);
  const html = vm.runInContext('ansiHtml(specLines())', context);
  return { lines, html, md: files.get('2026-11-14-worthit.md') };
};
const dataFor = pct => {
  const data = demoData();
  data.totals.output_tokens_change_pct = data.totals.api_value_change_pct = pct;
  data.git.merged_prs_change_pct = data.git.usd_per_pr_change_pct = pct;
  data.delivery.usd_per_feature_change_pct = pct;
  data.delivery.kinds = [
    { kind: 'feat', label: 'features', prs: 6, share_pct: 75, change_pct: pct },
    { kind: 'fix', label: 'fixes', prs: 2, share_pct: 25, change_pct: pct },
  ];
  data.delivery.fix_share_pct = 25;
  data.delivery.fix_share_last_week_pct = 17;
  return data;
};
fs.mkdirSync(process.env.WORTHIT_HOME, { recursive: true });
const cliShare = data => {
  const last = path.join(process.env.WORTHIT_HOME, 'last.json');
  const saved = JSON.stringify(data);
  fs.writeFileSync(last, saved);
  // Explicit allowlist; no inherited account/config credentials or real tool stores.
  const env = Object.fromEntries(['HOME', 'WORTHIT_HOME', 'TMPDIR', 'PATH', 'TZ', 'LANG']
    .map(key => [key, process.env[key]]).filter(([, value]) => value !== undefined));
  const result = spawnSync(process.execPath,
    ['--import', path.join(root, 'test/support/clock.mjs'),
      path.join(root, 'bin/worthit.mjs'), 'share', 'delivery', '--ai', 'no', '--no-files'],
    { cwd: process.env.TMPDIR, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  assert.equal(fs.readFileSync(last, 'utf8'), saved, 'share preserves saved data');
  const output = JSON.parse(result.stdout);
  assert.equal(output.image, null);
  return output.text;
};
const rgb = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16)).join(',');

for (const [name, raw, expected] of [
  ['zero', 0, 0], ['negative-zero', -0, 0], ['tiny-rise', 0.3, 0], ['tiny-drop', -0.3, 0],
  ['rise', 0.5, 1], ['drop', -0.5, -1],
]) {
  const pct = roundPercent(raw), data = dataFor(pct), actual = surfaces(data);
  const card = cardSpec('delivery', data), html = cardHtml(card);
  check(`${name}: rounding`, () => { assert.equal(pct, expected); assert.ok(!Object.is(pct, -0)); });
  save(`${name}-dashboard.html`, actual.html); save(`${name}-card.html`, html);
  save(`${name}.md`, actual.md); save(`${name}.json`, JSON.stringify(data, null, 2));
  // Four tile deltas, then feature/fix kinds and cost per feature: seven consumers.
  const deltaLines = actual.lines.filter(line => strip(line).includes('vs prev 7 d'));
  check(`${name}: dashboard deltas`, () => {
    assert.equal(deltaLines.length, 4);
    const joined = deltaLines.join('\n');
    if (expected === 0) {
      assert.equal(joined.split(fg(C.ink3, '0%')).length - 1, 7, 'all seven deltas use neutral ink');
      assert.doesNotMatch(strip(joined), /[▲▼+−-]\s*0%/);
      assert.equal((actual.html.match(new RegExp(`color:rgb\\(${rgb(C.ink3)}\\);[^>]*>0%<`, 'g')) || []).length, 7);
    } else {
      const arrow = expected > 0 ? '▲' : '▼';
      // Tokens/value/shipped/features improve upwards; costs and fixes improve downwards.
      assert.equal(joined.split(fg(expected > 0 ? C.cx : C.red, `${arrow} 1%`)).length - 1, 4);
      assert.equal(joined.split(fg(expected > 0 ? C.red : C.cx, `${arrow} 1%`)).length - 1, 3);
    }
  });
  check(`${name}: card HTML`, () => {
    const arrow = expected > 0 ? '▲ ' : expected < 0 ? '▼ ' : '';
    assert.equal(card.sub, `${arrow}${Math.abs(expected)}% vs last week`);
    assert.equal(card.subColor, expected === 0 ? C.ink3 : expected > 0 ? C.red : C.cx);
    assert.ok(html.includes(`color:${card.subColor}`));
    assert.ok(html.includes(`<div class="sub">${card.sub}</div>`));
    if (expected === 0) assert.doesNotMatch(html, /[▲▼+−-]\s*0%/);
  });
  check(`${name}: CLI Markdown`, () => {
    const tokenLine = actual.md.split('\n').find(line => line.startsWith('- Output tokens:'));
    const signed = expected > 0 ? `+${expected}` : String(expected);
    assert.ok(tokenLine.includes(`(${signed}% vs the 7 days before)`));
  });
  check(`${name}: actual share CLI`, () => {
    const text = cliShare(data);
    save(`${name}-share.txt`, text);
    assert.ok(text.includes(`(${expected === 0 ? '' : expected > 0 ? '▲' : '▼'}${Math.abs(expected)}% vs last week)`));
    if (expected === 0) assert.doesNotMatch(text, /[▲▼+−-]\s*0%/);
  });
}

check('null: no comparison on dashboard, card, CLI', () => {
  const data = dataFor(null), actual = surfaces(data), card = cardSpec('delivery', data);
  const joined = actual.lines.join('\n');
  // #116 retains distinct labels for unavailable usage and count baselines.
  assert.equal(joined.split(fg(C.ink3, 'no earlier week')).length - 1, 3);
  assert.equal(joined.split(fg(C.ink3, 'not compared')).length - 1, 4);
  assert.equal(card.subColor, C.ink3); assert.doesNotMatch(card.sub, /%/);
  assert.doesNotMatch(actual.md.split('\n').find(line => line.startsWith('- Output tokens:')), /%/);
  assert.doesNotMatch(cliShare(data), /% vs last week/);
});
check('partial PR count: remains not compared', () => {
  const data = dataFor(0); data.git.coverage.prs = false;
  const delivery = blocks.Delivery(data).map(strip).join('\n');
  assert.match(delivery, /partial feature count · not compared/);
  assert.doesNotMatch(delivery, /[▲▼]\s*0%/);
  assert.equal(cardSpec('delivery', data).subColor, C.ink3);
  assert.doesNotMatch(cliShare(data), /% vs last week/);
});
check('usage floor: cost line fits without a clipped parenthesis (requires #116)', () => {
  const data = dataFor(null);
  data.machines_missing = [{ machine: 'box-z' }];
  data.git.usd_per_merged_pr = null;
  data.delivery.usd_per_feature = null;
  const actual = surfaces(data), line = actual.lines.find(line => strip(line).includes('cost per feature'));
  save('usage-floor-dashboard.html', actual.html);
  save('usage-floor.json', JSON.stringify(data, null, 2));
  assert.equal(len(line), 98);
  const plain = strip(line);
  assert.match(plain, /partial usage · not compared/, 'PR116 floor-display dependency must be present');
  assert.match(plain, /fixes 25% of PRs/);
  assert.equal((plain.match(/\(/g) || []).length, (plain.match(/\)/g) || []).length, 'no clipped closing parenthesis');
  assert.doesNotMatch(plain, /[▲▼]\s*0%/);
});
check('schema: rounding belongs to plans.change_vs_last_week_pct', () => {
  assert.match(SCHEMA['plans.change_vs_last_week_pct'].fields.value, /whole-number percent/);
  assert.match(SCHEMA['plans.change_vs_last_week_pct'].fields.value, /halves away from zero/);
  assert.doesNotMatch(SCHEMA['plans.weeks'].about, /change_vs_last_week_pct is a whole-number/);
});
check('#130: demo floor labels fit the limit trend box', () => {
  const data = demoData(), lines = blocks.LimitTrend(data);
  const floors = data.plans.filter(plan => plan.proof !== 'measured');
  assert.ok(floors.length > 0, 'demo includes floor controls');
  for (const plan of floors) {
    const line = lines.find(line => strip(line).includes(plan.plan.replace(' AI', '')));
    assert.equal(len(line), 39);
    assert.match(strip(line), /\bfloor(?:[ :·]+not compared)?\s*│$/, 'floor label ends on a whole word');
    assert.doesNotMatch(strip(line), /[▲▼]|\d+%/);
  }
  save('floor-trend-dashboard.html', surfacesHtml(lines));
});
check('#130: empty ranking keeps the complete explanation', () => {
  const data = demoData(); data.plans = [];
  const lines = blocks.PlanRanking(data);
  for (const line of lines) assert.equal(len(line), 56);
  const text = lines.slice(1, -1).map(line => strip(line).slice(2, -2).trim()).join(' ');
  assert.match(text, /A plan is ranked once its weekly meter runs to the cap,\s+or closes, inside the scanned days\./);
  save('empty-ranking-dashboard.html', surfacesHtml(lines));
});
console.log(`neutral-zero: ${failures} failed checks`);
process.exitCode = failures ? 1 : 0;
