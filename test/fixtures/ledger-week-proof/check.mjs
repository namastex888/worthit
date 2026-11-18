// Issue #68: proof belongs to the saved observation, never to an arbitrary ledger pool.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceCase } from '../../support/source-case.mjs';
import { blocks, strip, len } from '../../../src/draw.mjs';
import { cardSpec, cardHtml } from '../../../src/card.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
sourceCase(folder, ({ expected, tmp, home, env, python, root, run, query }) => {
  const entry = path.join(root, 'bin/worthit.mjs');
  const scan = (store, overrides = {}) => JSON.parse(run(process.execPath,
    [entry, '--json', '--no-files', '--days', '21', '--hosts', 'box-b', '--git', 'no', '--ai', 'no'],
    { ...env, FIXTURE_ACCOUNTS: '[]', WORTHIT_HOME: path.join(tmp, store), ...overrides }));
  const sql = (store, statement) => run(python, ['-c',
    'import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.executescript(sys.argv[2]); d.close()',
    path.join(tmp, store, 'worthit.db'), statement]);
  const copy = name => fs.cpSync(path.join(tmp, 'measured'), path.join(tmp, name), { recursive: true });
  const claude = data => data.plans.find(p => p.key === 'claude');
  const result = (before, after) => ({ before: claude(before).proof, before_usd: claude(before).usd_per_full_week,
    after: claude(after).proof, after_usd: claude(after).usd_per_full_week, change: claude(after).change_vs_last_week_pct });
  const surfaces = (data, store, change) => {
    const label = 'ledger-week-proof / ' + store;
    const p = claude(data), trend = blocks.LimitTrend(data).map(strip).join('\n');
    assert.equal(p.change_vs_last_week_pct, change, label + ' JSON');
    assert.ok(blocks.LimitTrend(data).every(line => len(line) === 39), label + ' TUI width');
    const spec = cardSpec('allowance', data), html = cardHtml(spec);
    const share = JSON.parse(run(process.execPath, [entry, 'share', 'allowance', '--no-files', '--ai', 'no'],
      { ...env, WORTHIT_HOME: path.join(tmp, store) }));
    if (change === null) {
      assert.match(trend, /no baseline/, label + ' TUI baseline absent');
      assert.doesNotMatch(trend, /%.*vs last/, label + ' TUI no change');
      assert.doesNotMatch(html, /% vs last week/, label + ' card no change');
      assert.doesNotMatch(share.text, /%|week before/, label + ' actual share no change');
    } else {
      assert.match(trend, new RegExp(change + '%.*vs last'), label + ' TUI change');
      assert.equal(spec.sub, change === 0 ? '0% vs last week' : `▲ ${change}% vs last week`, label + ' card change');
      assert.match(share.text, new RegExp((change === 0 ? '' : '▲') + change + '% vs the week before'), label + ' actual share change');
    }
    const historical = p.weeks.filter(w => w.weeks_ago > 0);
    assert.ok(historical.length, label + ' real ledger history exists');
    assert.ok(historical.every(w => w.proof !== 'measured'), label + ' ledger never certified by observation');
    assert.match(blocks.AllowanceHistory(data).map(strip).join('\n'), /ledger weeks carry no machine check/, label + ' history disclosure');
    return data;
  };

  // Run last week against only last week's real source logs and tool SQLite rows.
  const futureLogs = [], futureStores = [];
  const visit = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) visit(file);
      else if (e.name.endsWith('.jsonl')) {
        const text = fs.readFileSync(file, 'utf8'); futureLogs.push([file, text]);
        fs.writeFileSync(file, text.split('\n').filter(l => !/2026-11-(09|11|13)/.test(l)).join('\n'));
      }
    }
  };
  for (const box of [home, path.join(tmp, 'box-b'), path.join(tmp, 'box-c')]) {
    visit(box);
    const file = path.join(box, '.meter/meter.db'); futureStores.push([file, fs.readFileSync(file)]);
    run(python, ['-c', "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute('DELETE FROM usage WHERE hour_ms >= 1794052800000'); d.commit(); d.close()", file]);
  }
  const prior = { FIXTURE_NOW: '2026-11-07T12:00:00Z' };
  const oldFloor = scan('floor', { ...prior, FIXTURE_OFFLINE: '1' });
  const oldMeasured = scan('measured', prior);
  copy('same-day-overwrite');
  const overwritten = scan('same-day-overwrite', { ...prior, FIXTURE_OFFLINE: '1' });
  assert.equal(claude(overwritten).proof, 'floor', 'later run on the same day loses machine coverage');
  assert.deepEqual(query("SELECT day, proof FROM plan_value WHERE provider='claude'", 'same-day-overwrite'),
    [{ day: '2026-11-07', proof: 'floor' }], 'later floor replaces the same-day measured proof');
  assert.deepEqual(oldFloor.machines_missing.map(m => m.machine), ['box-b'], 'actual prior missing machine');
  assert.deepEqual(query("SELECT day, proof, usd_per_full_week FROM plan_value WHERE provider='claude'", 'floor'),
    [{ day: '2026-11-07', proof: 'floor', usd_per_full_week: 3 }], 'actual prior floor saved');
  for (const [file, text] of futureLogs) fs.writeFileSync(file, text);
  for (const [file, bytes] of futureStores) fs.writeFileSync(file, bytes);

  const floorThenMeasured = scan('floor');
  assert.deepEqual(result(oldFloor, floorThenMeasured), expected.get('floor_then_measured'), 'ledger-week-proof / actual floor then measured');
  surfaces(floorThenMeasured, 'floor', null);
  const both = scan('measured');
  assert.deepEqual(result(oldMeasured, both), expected.get('both_measured'), 'ledger-week-proof / actual both measured');
  surfaces(both, 'measured', 0);
  surfaces(scan('same-day-overwrite'), 'same-day-overwrite', null);
  copy('current-floor');
  const currentFloor = scan('current-floor', { FIXTURE_OFFLINE: '1' });
  assert.equal(claude(currentFloor).proof, 'floor', 'current missing machine stays floor');
  assert.equal(claude(currentFloor).change_vs_last_week_pct, null, 'measured baseline cannot overrule current floor');
  assert.equal(cardSpec('allowance', currentFloor).sub, 'at least', 'current floor card');

  // A stored observation's USD is the denominator even when its ledger pool differs.
  copy('stored-denominator');
  sql('stored-denominator', "UPDATE plan_value SET usd_per_full_week=6 WHERE day='2026-11-07' AND provider='claude';");
  const denominator = surfaces(scan('stored-denominator'), 'stored-denominator', expected.get('stored_denominator'));
  assert.equal(claude(denominator).weeks.find(w => w.weeks_ago === 1).usd, 9, 'ledger pool kept intact, distinct from stored $6');

  const edits = {
    'six-days': "UPDATE plan_value SET day='2026-11-08' WHERE day='2026-11-07';",
    'eight-days': "UPDATE plan_value SET day='2026-11-06' WHERE day='2026-11-07';",
    'wrong-provider': "UPDATE plan_value SET provider='codex' WHERE day='2026-11-07';",
    'wrong-plan': "UPDATE plan_value SET plan='Other plan' WHERE day='2026-11-07';",
    zero: "UPDATE plan_value SET usd_per_full_week=0 WHERE day='2026-11-07';",
    unknown: "DELETE FROM plan_value WHERE day='2026-11-07';",
    'overwritten-floor': "UPDATE plan_value SET proof='floor' WHERE day='2026-11-07';",
    'no-proof': "UPDATE plan_value SET proof=NULL WHERE day='2026-11-07';",
  };
  for (const name of expected.get('ineligible')) {
    copy(name); sql(name, edits[name]); surfaces(scan(name), name, null);
  }

  // Exact local run day, not the UTC date printed on ledger history.
  copy('local-day');
  const local = { FIXTURE_NOW: '2026-11-14T01:00:00Z', TZ: 'America/New_York' };
  surfaces(scan('local-day', local), 'local-day', null);
  sql('local-day', `UPDATE plan_value SET day='${expected.get('local_day')}' WHERE day='2026-11-07';`);
  surfaces(scan('local-day', local), 'local-day', 0);

  // Synthetic shaping controls isolate the day key from the age of the source logs.
  const shapeScript = `import fs from 'node:fs';
import {buildData,git,AUDIT} from ${JSON.stringify(pathToFileURL(path.join(root, 'src/collect.mjs')).href)};
const prices=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root, 'core/prices.json'))}));
const w={usd_per_full_week:12,meter_start_pct:0,meter_end_pct:100,hours:1,measured:{api_usd:12,output_tokens:1000,cached_input_tokens:0,model_mix_by_usd:{}}};
const cfg={days:21},g=process.env.FIXTURE_FIRST_GIT ? await git(cfg,()=>{}) : null;
const data=buildData({prices,this_week:{claude:w}},g,cfg,{counts:{},hosts:[{alias:'box-b',ok:true}]});
console.log(JSON.stringify({change:data.plans[0].change_vs_last_week_pct,audit:AUDIT}));`;
  const shape = (store, overrides = {}) => JSON.parse(run(process.execPath,
    ['--input-type=module', '-e', shapeScript],
    { ...env, FIXTURE_ACCOUNTS: '[]', WORTHIT_HOME: path.join(tmp, store), ...overrides }));
  for (const test of expected.get('dst')) {
    copy(test.name);
    sql(test.name, `INSERT OR REPLACE INTO plan_value (day, provider, plan, usd_per_full_week, times_plan_price, stretches, proof) VALUES
      ('${test.day}', 'claude', 'Claude Ultra', 6, 1, 1, 'measured'),
      ('${test.elapsed_day}', 'claude', 'Claude Ultra', 99, 1, 1, 'floor');`);
    assert.equal(shape(test.name, { FIXTURE_NOW: test.now, TZ: 'America/New_York' }).change,
      test.change, `ledger-week-proof / ${test.name} uses seven local calendar days`);
  }
  // git() creates its tables before buildData on a fresh store, with no plan_value yet.
  const firstGit = shape('first-git', { FIXTURE_FIRST_GIT: '1' });
  assert.equal(firstGit.change, null, 'ledger-week-proof / first git run has no baseline');
  assert.ok(firstGit.audit.every(line => !line.includes('previous plan value unavailable')),
    'ledger-week-proof / absent plan_value on first git run is not an audit failure');

  // Previously measured observation cannot overrule known retained prior-week data.
  copy('retained');
  const log = path.join(home, '.claude/projects/example/usage.jsonl'), text = fs.readFileSync(log, 'utf8');
  fs.writeFileSync(log, text.split('\n').filter(l => !l.includes('2026-11-04')).join('\n'));
  const retained = surfaces(scan('retained'), 'retained', null);
  assert.ok(retained.machines_retained.some(m => m.units.some(u => u.day === '2026-11-04')), 'retained previous source unit');
  assert.equal(claude(retained).weeks.find(w => w.weeks_ago === 1).proof, 'floor', 'known floor precedes stored measured proof');
  fs.writeFileSync(log, text);

  if (env.WORTHIT_FIXTURE_ARTIFACTS) {
    fs.mkdirSync(env.WORTHIT_FIXTURE_ARTIFACTS, { recursive: true });
    for (const [name, data] of Object.entries({ 'ledger-floor-then-measured': floorThenMeasured, 'ledger-both-measured': both })) {
      fs.writeFileSync(path.join(env.WORTHIT_FIXTURE_ARTIFACTS, name + '.json'), JSON.stringify(data, null, 2));
    }
  }
});
