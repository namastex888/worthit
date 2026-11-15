// Literal priced reports and ledger/checkpoint baselines exercise both real rounding paths.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../../support/clock.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
assert.ok(process.env.WORTHIT_HOME && process.env.HOME, 'run inside an isolated fixture environment');
const { buildData, HOME } = await import('../../../src/collect.mjs');
const { prepareWeekly, allowanceText } = await import('../../../src/weekly.mjs');
const { cardSpec, cardHtml } = await import('../../../src/card.mjs');
const { C, blocks, strip, fg } = await import('../../../src/draw.mjs');
const { SCHEMA } = await import('../../../src/query.mjs');
const cases = JSON.parse(fs.readFileSync(path.join(folder, 'cases.json'), 'utf8'));
for (const contract of [SCHEMA['weekly.result'].fields.plans, SCHEMA['weekly.result'].fields.moved,
  SCHEMA['plans.weeks'].about, fs.readFileSync(path.join(folder, '../../../skills/worthit/SKILL.md'), 'utf8')]) {
  assert.match(contract, /whole-number percent/); assert.match(contract, /halves away from zero/);
}
fs.mkdirSync(path.join(HOME, 'weeks'), { recursive: true });
let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`); }
  catch (error) { failures++; console.error(`FAIL ${label}: ${error.message}`); }
};
const reportFor = c => ({
  this_week: { claude: { usd_per_full_week: c.to, meter_start_pct: 0, meter_end_pct: 100,
    hours: 168, measured: { api_usd: c.to } } }, prices: { plan_usd_per_week: { claude: 10 } },
  activity: [
    { hour: '2026-11-04T12', provider: 'claude', output: c.from, usd: c.from, requests: 1 },
    { hour: '2026-11-11T12', provider: 'claude', output: c.to, usd: c.to, requests: 1 },
  ],
});
const baselineFor = (plan, from, proof = 'measured') => ({ generated_at: '2026-11-07T12:00:00Z',
  week_to: '2026-11-07', plans: [{ plan, usd_per_full_week: from, proof }] });
const display = (data, c) => {
  const sign = c.pct > 0 ? '▲' : '▼', spec = cardSpec('allowance', data);
  const text = allowanceText(data), tui = blocks.LimitTrend(data).join('\n');
  if (c.pct === 0) {
    assert.match(text, /\(0% vs the week before\)/);
    assert.equal(spec.sub, '0% vs last week'); assert.equal(spec.subColor, C.ink3);
    assert.equal(spec.rows[0].note, '0% vs last week');
    assert.ok(tui.includes(fg(C.ink3, '0%')), 'TUI zero has neutral ink');
    for (const output of [text, cardHtml(spec), strip(tui)]) assert.doesNotMatch(output, /[▲▼]\s*0%/);
  } else {
    assert.ok(text.includes(`${sign}${Math.abs(c.pct)}%`));
    assert.equal(spec.sub, `${sign} ${Math.abs(c.pct)}% vs last week`);
    assert.equal(spec.subColor, c.pct > 0 ? C.cx : C.red);
    assert.ok(strip(tui).includes(`${sign} ${Math.abs(c.pct)}%`));
  }
};

// Run only the mod's plan builder against inert view nodes; no Herdr, store or UI access.
// Each builder needs its own fluent proxy so .when receives that exact node.
const builder = () => {
  const target = { children: [], color: null };
  const proxy = new Proxy(target, { get: (t, key) => key in t ? t[key] : (...args) => {
    if (key === 'child') t.children.push(args[0]);
    if (key === 'text_color') t.color = args[0];
    if (key === 'when' && args[0]) args[1](proxy);
    return proxy;
  } });
  return proxy;
};
const modSource = fs.readFileSync(path.join(folder, '../../../herdr-mod/mods/worthit/main.js'), 'utf8');
const context = { View: class {}, div: builder, v_flex: builder, h_flex: builder };
vm.runInNewContext(modSource.replace(/^import .*;\n/gm, '').replace('export default class', 'globalThis.Worthit = class'), context);
const mod = new context.Worthit();
const notes = tree => tree.children.flatMap(child => typeof child === 'string' ? [{ text: child, color: tree.color }] : notes(child));

for (const c of cases) {
  assert.equal(100 * (c.to - c.from) / c.from, c.raw_pct, 'literal source ratio');
  const report = reportFor(c), original = structuredClone(report);
  fs.writeFileSync(path.join(HOME, 'weeks/ledger.jsonl'), JSON.stringify({ provider: 'claude', quality: 'clean',
    start: '2026-11-01T12', end: '2026-11-06T12', usd_per_full_week: c.from }) + '\n');
  const ordinary = buildData(report, null, { days: 21 }, { hosts: [], counts: {} });
  const plan = ordinary.plans[0];
  assert.deepEqual(report, original, 'priced source values remain unchanged');
  assert.equal(plan.usd_per_full_week, c.to); assert.equal(plan.proof, 'measured');
  console.log(`OBSERVED ${c.name}: ordinary=${Object.is(plan.change_vs_last_week_pct, -0) ? '-0' : plan.change_vs_last_week_pct}`);
  check(`ordinary ${c.name}`, () => {
    assert.equal(plan.change_vs_last_week_pct, c.pct);
    assert.equal(ordinary.totals.output_tokens_change_pct, c.pct);
    assert.equal(ordinary.totals.api_value_change_pct, c.pct);
  });
  check(`ordinary display ${c.name}`, () => display(ordinary, c));
  const data = structuredClone(ordinary), before = baselineFor(plan.plan, c.from), saved = structuredClone(before);
  const weekly = prepareWeekly(data, before);
  console.log(`OBSERVED ${c.name}: weekly=${Object.is(weekly.plans[0].change_vs_last_week_pct, -0) ? '-0' : weekly.plans[0].change_vs_last_week_pct}`);
  check(`weekly ${c.name}`, () => {
    assert.equal(weekly.plans[0].change_vs_last_week_pct, c.pct);
    assert.deepEqual(weekly.moved, c.moved ? [{ plan: plan.plan, from: c.from, to: c.to, pct: c.pct }] : []);
    assert.equal(JSON.parse(JSON.stringify(weekly)).plans[0].change_vs_last_week_pct, c.pct);
  });
  assert.deepEqual(before, saved); assert.equal(data.plans[0].usd_per_full_week, c.to);
  check(`weekly display ${c.name}`, () => display(data, c));
  check(`mod display ${c.name}`, () => {
    const t = { dim: 'neutral', done: 'up', blocked: 'down' };
    const note = notes(mod.plan({ ...plan, change_vs_last_week_pct: c.pct }, c.to, t)).find(n => n.text.endsWith('% vs last week'));
    assert.deepEqual(note, { text: `${c.pct === 0 ? '' : c.pct > 0 ? '▲ ' : '▼ '}${Math.abs(c.pct)}% vs last week`,
      color: c.pct === 0 ? 'neutral' : c.pct > 0 ? 'up' : 'down' });
  });
  for (const [label, overrides, baseline] of [
    ['no baseline', {}, null], ['prior floor', {}, baselineFor(plan.plan, c.from, 'floor')],
    ['zero baseline', {}, baselineFor(plan.plan, 0)], ['current floor', { proof: 'floor' }, before],
  ]) {
    const guarded = structuredClone(ordinary); Object.assign(guarded.plans[0], overrides);
    const result = prepareWeekly(guarded, baseline);
    assert.equal(result.plans[0].change_vs_last_week_pct, null, label); assert.deepEqual(result.moved, [], label);
    assert.doesNotMatch(allowanceText(guarded), /% vs/); assert.doesNotMatch(cardSpec('allowance', guarded).sub, /%/);
  }
  for (const coverage of [{ hosts: [{ alias: 'box-b', ok: false }] }, { left_out: ['box-b'] },
    { retained: [{ machine: 'box-b', units: [{ day: '2026-11-11', provider: 'claude' }] }] }]) {
    const floor = buildData(report, null, { days: 21 }, { hosts: [], counts: {}, ...coverage });
    assert.equal(floor.plans[0].proof, 'floor'); assert.equal(floor.plans[0].change_vs_last_week_pct, null);
  }
}
console.log(`symmetric-percent: ${failures} failed checks`);
process.exitCode = failures ? 1 : 0;
