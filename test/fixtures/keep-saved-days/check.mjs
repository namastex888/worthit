// Synthetic regression for issue #24. Runs with its own HOME, store and fake scanner/SSH.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { machineNotes, blocks, strip, len } from '../../../src/draw.mjs';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { expectedData } from '../../support/expected-data.mjs';
import '../../support/clock.mjs';

const fixture = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixture, '../../..');
const isolated = isolatedEnvironment(), { tmp, python } = isolated;
const support = path.resolve(fixture, '../../support');
const env = { ...isolated.env, TZ: 'America/New_York', NODE_OPTIONS: `--import=${path.join(support, 'clock.mjs')}`, PYTHONPATH: support };
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data)); };
const run = (cmd, args, extra = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 << 20, ...extra });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stderr || r.error || r.stdout}`);
  return r.stdout;
};
const saved = read(path.join(fixture, 'saved.json')), fresh = read(path.join(fixture, 'fresh.json'));
const expected = expectedData(path.join(fixture, 'expected-data.json'));
const copy = v => structuredClone(v);
const empty = host => ({ ...copy(saved), host, buckets: [], sessions: [] });
let serial = 0;
const merge = (old, next, options = {}) => {
  const dir = path.join(tmp, 'case-' + serial++), keep = path.join(dir, 'keep'), current = path.join(dir, 'run');
  write(path.join(keep, 'box-a.json'), old); write(path.join(current, 'box-a.json'), next);
  const notes = JSON.parse(run(python, [...(options.pythonArgs || []), 'core/merge_scans.py', current, keep], { env: { ...env, ...options.env } }));
  return { data: read(path.join(current, 'box-a.json')), notes };
};

try {
  const retained = merge(saved, fresh);
  assert.equal(new Set(retained.data.buckets.map(b => b.hour.slice(0, 10))).size, 14, '14 saved days + 1 fresh day must yield 14 days');
  assert.deepEqual(retained.data.buckets, saved.buckets, 'richer saved overlap is selected whole, never added to fresh');
  assert.equal(retained.notes[0].days_kept, 14);
  assert.equal(retained.data.sessions.length, 1, 'session spanning 14 days is not counted 14 times');
  assert.equal(retained.data.sessions[0].tokens, saved.buckets.reduce((n, b) => n + b.input_uncached + b.cache_read + b.output, 0));

  const raised = copy(fresh); raised.buckets[0].output = 200000;
  raised.buckets.push({ ...raised.buckets[0], hour: '2026-01-15T12', session: 'new-day' });
  const grown = merge(saved, raised);
  assert.equal(grown.data.buckets.length, 15, 'fresh adds a day');
  assert.deepEqual(grown.data.buckets.filter(b => b.hour >= '2026-01-14'), raised.buckets, 'richer fresh overlap is selected whole');
  assert.equal(grown.notes[0].days_kept, 13);

  const costly = empty('box-a'), cheap = empty('box-a');
  costly.buckets = [{ ...saved.buckets[13], model: 'claude-opus-5-5', output: 100000 }];
  cheap.buckets = [{ ...fresh.buckets[0], model: 'claude-haiku-5-5', output: 200000 }];
  assert.deepEqual(merge(costly, cheap).data.buckets, costly.buckets, 'fewer pricier tokens beat more cheaper tokens');
  const prices = read(path.join(root, 'core/prices.json'));
  // Exact USD tie with different token counts, then exact tie with different session/account keys.
  const tie = empty('box-a'), tieFresh = empty('box-a');
  tie.buckets = [{ ...saved.buckets[13], input_uncached: 0, cache_read: 0, output: 100, model: 'claude-opus-5-5' }];
  tieFresh.buckets = [{ ...tie.buckets[0], output: 200, model: 'claude-sonnet-5-5' }];
  assert.equal(prices.claude['claude-opus-5-5'].out, 2 * prices.claude['claude-sonnet-5-5'].out);
  assert.deepEqual(merge(tie, tieFresh).data.buckets, tieFresh.buckets, 'USD tie selects more tokens');
  const exact = copy(tie); exact.buckets[0].session = 'new-extractor-key'; exact.buckets[0].account = 'account-b';
  assert.deepEqual(merge(tie, exact).data.buckets, exact.buckets, 'full tie selects fresh without unioning changed keys');

  // A provider that grew still wins when another provider's logs on that day were lost.
  const mixedSaved = copy(costly), mixedFresh = copy(cheap);
  const cx = { ...saved.buckets[13], provider: 'codex', model: 'gpt-6.1-sol', account: 'None', session: 'session-b' };
  mixedSaved.buckets.push({ ...cx, output: 10 }); mixedFresh.buckets.push({ ...cx, output: 300000 });
  const mixed = merge(mixedSaved, mixedFresh);
  assert.deepEqual(mixed.data.buckets, [costly.buckets[0], mixedFresh.buckets[1]], 'providers rotate independently');
  assert.equal(mixed.notes[0].days_kept, 1, 'count distinct days, not units');

  // Select every row of a winning unit, including meters, events, readings and tool-store rows.
  const detailed = copy(saved);
  detailed.meters = [{ provider: 'claude', hour: '2026-01-14T12', slot: 'secondary' }];
  detailed.events = [{ provider: 'claude', ts: '2026-01-14T12:05:00Z', kind: 'cap_hit' }];
  detailed.meter_readings = [['2026-01-14T12:00:00Z', 'session-a', 'account-a', 'claude-sonnet-5-5', 80, 1768564800, 40, 1768482000]];
  detailed.meter_usage = [['row-a', Date.parse('2026-01-14T12:00:00Z'), 'omp', 'model-a', 20, 10, 0, 30, 5, 1, 2]];
  detailed.accounts = { antigravity: { conv_model_timeline: { 'session-ag': [['2026-01-14T12:00:00', 'gemini-4-carbon']] } } };
  const detailResult = merge(detailed, fresh);
  for (const field of ['meters', 'events', 'meter_readings', 'meter_usage']) assert.deepEqual(detailResult.data[field], detailed[field], field + ' retained');
  assert.equal(detailResult.notes[0].days_kept, 14, 'two saved provider units on one day count once');
  assert.equal(detailResult.notes[0].units.length, 15);
  assert.deepEqual(detailResult.data.accounts.antigravity, detailed.accounts.antigravity, 'retained Antigravity cap-model metadata survives');

  // Tool-store rows without reported USD use the same inferred rates as the weekly report.
  const storeOld = empty('box-a'), storeNew = empty('box-a');
  const training = [];
  for (let i = 0; i < 9; i++) {
    const basis = i % 3;
    training.push(['training-' + i, Date.parse('2026-01-01T12:00:00Z'), 'omp', 'model-a', basis === 0 ? 100000 : 0, basis === 1 ? 100000 : 0, 0, basis === 2 ? 100000 : 0, 0, 1, [.1, .01, 10][basis]]);
  }
  storeOld.meter_usage = [...training, ['dsh-old', Date.parse('2026-01-14T12:00:00Z'), 'dsh-tui', 'model-a', 0, 0, 0, 30000, 0, 1, null]];
  storeNew.meter_usage = [...training, ['dsh-fresh', Date.parse('2026-01-14T12:00:00Z'), 'dsh-tui', 'model-a', 50000, 0, 0, 0, 0, 1, null]];
  assert.deepEqual(merge(storeOld, storeNew).data.meter_usage.filter(r => r[2] === 'dsh-tui'), storeOld.meter_usage.slice(-1), 'inferred USD beats more lower-value tokens');

  // Both hours fall on Jan 13 in the running timezone: one whole day wins, not one of each UTC day.
  const boundary = empty('box-a'), boundaryFresh = empty('box-a');
  boundary.buckets = [{ ...saved.buckets[13], hour: '2026-01-14T01', output: 300000 }];
  boundaryFresh.buckets = [{ ...fresh.buckets[0], hour: '2026-01-13T23' }];
  const localDay = merge(boundary, boundaryFresh);
  assert.equal(localDay.data.buckets.length, 1);
  assert.deepEqual(localDay.notes[0].units, [{ day: '2026-01-13', provider: 'claude' }]);

  // Intact logs: yesterday's extra edge-day bucket slid out of today's fully covered days.
  const slidingFresh = copy(fresh); slidingFresh.since = '2026-01-14T12:00:00';
  slidingFresh.buckets[0].hour = '2026-01-15T12';
  const slidingSaved = { ...copy(slidingFresh), since: '2026-01-13T12:00:00', buckets: [{ ...saved.buckets[0], hour: '2026-01-14T10' }, ...slidingFresh.buckets] };
  const slid = merge(slidingSaved, slidingFresh);
  assert.deepEqual(slid.notes, [], 'sliding window must not report a lost day');
  assert.deepEqual(slid.data, slidingFresh, 'intact sliding-window scan stays exactly fresh');
  // Lost logs inside a moving window retain eligible days without moving the cutoff backwards.
  const lostSaved = copy(saved), lostFresh = copy(fresh);
  lostSaved.since = '2026-01-01T00:00:00';
  lostFresh.since = '2026-01-07T12:00:00';
  assert.notEqual(lostSaved.since, lostFresh.since, 'cutoffs differ so restoring min(saved, fresh) is detectable');
  const lost = merge(lostSaved, lostFresh);
  assert.equal(lost.notes[0].days_kept, expected.get('sliding_lost_days'));
  assert.equal(lost.data.buckets.length, expected.get('sliding_lost_days'));
  assert.equal(lost.data.since, lostFresh.since, 'retained units must keep the fresh sliding since');
  for (const side of ['saved', 'fresh']) {
    const old = copy(saved), next = copy(fresh); delete (side === 'saved' ? old : next).since;
    assert.deepEqual(merge(old, next), { data: next, notes: [] }, 'missing ' + side + ' since skips retention');
  }
  assert.equal(merge(saved, fresh, { pythonArgs: ['-I'] }).notes[0].days_kept, 14, 'merge imports pricing under isolated Python');
  assert.equal(merge(saved, fresh, { env: { PYTHONSAFEPATH: '1' } }).notes[0].days_kept, 14, 'merge imports pricing under safe-path Python');
  const badDir = path.join(tmp, 'bad-run'), badKeep = path.join(tmp, 'bad-keep');
  fs.mkdirSync(badDir); write(path.join(badKeep, 'box-a.json'), saved);
  fs.writeFileSync(path.join(badDir, 'box-a.json'), '{');
  write(path.join(badDir, 'local.json'), { ...saved, host: 'box-b' });
  assert.deepEqual(JSON.parse(run(python, ['core/merge_scans.py', badDir, badKeep])), [], 'unreadable run file skips its pair');
  assert.equal(fs.readFileSync(path.join(badDir, 'box-a.json'), 'utf8'), '{', 'bad run is untouched for weekly reporting');
  const safeOut = path.join(tmp, 'safe-weekly');
  run(python, ['-I', 'core/weekly.py', badDir], { env: { ...env, WORTHIT_OUT: safeOut } });
  run(python, ['core/weekly.py', badDir], { env: { ...env, WORTHIT_OUT: safeOut, PYTHONSAFEPATH: '1' } });
  const safeReport = read(path.join(safeOut, 'weeks', fs.readdirSync(path.join(safeOut, 'weeks')).filter(n => /^\d{4}-/.test(n)).sort().at(-1), 'report.json'));
  assert.ok(safeReport.hosts['box-a.json'].error, 'weekly still reports the unreadable run file');

  // Exercise the real --json -> scan -> merge -> analyse -> history path, with only fake scanner/SSH IO.
  const bin = path.join(tmp, 'fake-bin'); fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(env.HOME, { recursive: true });
  const fake = `#!${process.execPath}\nimport fs from 'node:fs'; import path from 'node:path'; import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2), ssh=process.argv[1].endsWith('/ssh');
if(ssh){process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(fs.readFileSync(path.join(process.env.FIXTURE_SCAN_DIR,args.at(-2)+'.json'))));}
else if(args[0]?.endsWith('extract_usage.py'))process.stdout.write(fs.readFileSync(path.join(process.env.FIXTURE_SCAN_DIR,'local.json')));
else {const r=spawnSync(${JSON.stringify(python)},args,{stdio:'inherit'});process.exit(r.status??1);}\n`;
  for (const name of ['python3', 'ssh']) fs.writeFileSync(path.join(bin, name), fake, { mode: 0o755 });
  env.PATH = bin + path.delimiter + env.PATH;
  assert.ok(env.PATH.split(path.delimiter).every(dir => dir.startsWith(tmp + path.sep)), 'scanner command PATH stays inside fixture scratch');
  // Keep the literal fixture readable; shift its dates into the current rolling window only in scratch.
  const anchor = Date.UTC(2026, 0, 15), today = new Date().toISOString().slice(0, 10), shift = Date.parse(today) - anchor;
  const recent = scan => JSON.parse(JSON.stringify(scan).replace(/202[56]-\d\d-\d\d/g, d => new Date(Date.parse(d) + shift).toISOString().slice(0, 10)));
  const baselineDir = path.join(tmp, 'baseline'), nextDir = path.join(tmp, 'fresh');
  for (const [dir, boxA] of [[baselineDir, recent(saved)], [nextDir, recent(fresh)]]) {
    write(path.join(dir, 'box-a.json'), boxA);
    const boxB = recent(empty('box-b'));
    boxB.buckets = [{ ...boxA.buckets.at(-1), output: 5000, session: 'session-box-b' }];
    boxB.sessions = [{ provider: 'claude', id: 'session-box-b', first: boxB.buckets[0].hour + ':00:00Z', last: boxB.buckets[0].hour + ':00:00Z', tokens: 6200 }];
    write(path.join(dir, 'local.json'), boxB); write(path.join(dir, 'box-b.json'), boxB);
  }
  const cli = (dir, hosts = 'box-a,box-b') => JSON.parse(run(process.execPath, ['bin/worthit.mjs', '--json', '--git', 'no', '--hosts', hosts], { env: { ...env, FIXTURE_SCAN_DIR: dir } }));
  const before = cli(baselineDir), oldHistory = read(path.join(env.WORTHIT_HOME, 'history.json'));
  const after = cli(nextDir), newHistory = read(path.join(env.WORTHIT_HOME, 'history.json'));
  assert.deepEqual(after.totals, before.totals, 'weekly USD and output stay stable');
  assert.deepEqual(newHistory, oldHistory, 'every history row stays stable');
  assert.equal(after.machines, 2, 'duplicate SSH alias of local machine is counted once');
  assert.equal(after.machines_retained[0].machine, 'box-a');
  assert.equal(after.machines_retained[0].days_kept, 14);
  assert.equal(read(path.join(env.WORTHIT_HOME, 'run-keep/box-a.json')).buckets.length, 14, 'retained days persisted');
  assert.deepEqual(read(path.join(env.WORTHIT_HOME, 'run-keep/local.json')).buckets, read(path.join(nextDir, 'local.json')).buckets, 'box-a does not alter box-b');
  assert.ok(machineNotes(after).includes('box-a: kept 14 older days'), 'dashboard names machine and distinct days');
  const again = cli(nextDir);
  assert.deepEqual(again.totals, after.totals, 'next scan reuses persisted retained days without double counting');
  // A successful SSH response with genuinely empty logs must retain the same 14 days.
  const emptyDir = path.join(tmp, 'empty-answer');
  write(path.join(emptyDir, 'box-a.json'), recent({ ...empty('box-a'), generated_at: fresh.generated_at, since: fresh.since }));
  for (const name of ['local.json', 'box-b.json']) write(path.join(emptyDir, name), read(path.join(nextDir, name)));
  const emptyAnswer = cli(emptyDir);
  assert.deepEqual(emptyAnswer.machines_missing, [], 'empty successful response is not a missing machine');
  assert.deepEqual(emptyAnswer.totals, before.totals, 'empty successful response preserves the week');
  assert.deepEqual({ output_tokens: emptyAnswer.totals.output_tokens, api_value_usd: emptyAnswer.totals.api_value_usd }, expected.get('week'), 'empty answer matches literal expected week');
  assert.deepEqual(read(path.join(env.WORTHIT_HOME, 'history.json')), oldHistory, 'empty successful response preserves every history row');
  assert.equal(read(path.join(env.WORTHIT_HOME, 'run-keep/box-a.json')).buckets.length, expected.get('saved_days'), 'empty answer persists all saved days');
  assert.equal(emptyAnswer.machines_retained[0].machine, 'box-a');
  assert.equal(emptyAnswer.machines_retained[0].days_kept, expected.get('saved_days'));
  assert.ok(machineNotes(emptyAnswer).includes('box-a: kept 14 older days'), 'empty answer names retained machine and days');
  const conflictDir = path.join(tmp, 'conflicting-model');
  const conflict = recent(fresh); conflict.buckets[0].model = 'claude-haiku-5-5'; conflict.buckets[0].output = 200000;
  write(path.join(conflictDir, 'box-a.json'), conflict);
  for (const name of ['local.json', 'box-b.json']) write(path.join(conflictDir, name), read(path.join(nextDir, name)));
  const conflictWeek = cli(conflictDir);
  assert.ok(conflict.buckets[0].output > saved.buckets[13].output, 'conflict has more fresh tokens');
  assert.equal(conflictWeek.totals.api_value_usd, before.totals.api_value_usd, 'real current-week API USD cannot drop for a cheaper-model fresh overlap');
  assert.equal(conflictWeek.machines_retained[0].days_kept, 14);
  const schema = JSON.parse(run(process.execPath, ['bin/worthit.mjs', 'schema']));
  assert.ok(schema.machines_retained.fields.days_kept);
  assert.match(run(process.execPath, ['bin/worthit.mjs', '--skill']), /machines_retained/);

  // Local logs get the same protection and a readable label.
  const localStore = path.join(tmp, 'local-store');
  fs.mkdirSync(path.join(localStore, 'run-keep'), { recursive: true });
  write(path.join(localStore, 'run-keep/local.json'), recent(saved));
  const localDir = path.join(tmp, 'local-fresh'); write(path.join(localDir, 'local.json'), recent(fresh));
  const local = JSON.parse(run(process.execPath, ['bin/worthit.mjs', '--json', '--git', 'no', '--hosts', 'none'], { env: { ...env, WORTHIT_HOME: localStore, FIXTURE_SCAN_DIR: localDir } }));
  assert.equal(local.machines_retained[0].machine, 'this machine');
  assert.equal(local.machines_retained[0].days_kept, 14);

  const corruptStore = path.join(tmp, 'corrupt-store');
  fs.mkdirSync(path.join(corruptStore, 'run-keep'), { recursive: true });
  fs.copyFileSync(path.join(fixture, 'truncated-saved.json'), path.join(corruptStore, 'run-keep/local.json'));
  const recovered = JSON.parse(run(process.execPath, ['bin/worthit.mjs', '--json', '--git', 'no', '--hosts', 'none'], { env: { ...env, WORTHIT_HOME: corruptStore, FIXTURE_SCAN_DIR: localDir } }));
  assert.deepEqual(recovered.machines_retained, [], 'truncated saved file does not abort the real run');
  assert.deepEqual(read(path.join(corruptStore, 'run-keep/local.json')), read(path.join(localDir, 'local.json')), 'fresh replaces truncated saved file');

  const sevenStore = path.join(tmp, 'seven-store'), sevenDir = path.join(tmp, 'seven-fresh');
  const cut = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19);
  const sevenFresh = { ...recent(fresh), days: 7, since: cut };
  const sevenSaved = { ...copy(sevenFresh), since: new Date(Date.parse(cut + 'Z') - 864e5).toISOString().slice(0, 19), buckets: [{ ...sevenFresh.buckets[0], hour: cut.slice(0, 13) }, ...sevenFresh.buckets] };
  write(path.join(sevenStore, 'run-keep/local.json'), sevenSaved); write(path.join(sevenDir, 'local.json'), sevenFresh);
  const seven = JSON.parse(run(process.execPath, ['bin/worthit.mjs', '--json', '--git', 'no', '--hosts', 'none', '--days', '7'], { env: { ...env, WORTHIT_HOME: sevenStore, FIXTURE_SCAN_DIR: sevenDir } }));
  assert.deepEqual(seven.machines_retained, [], '--days 7 intact window is not falsely retained');
  assert.deepEqual(read(path.join(sevenStore, 'run-keep/local.json')), sevenFresh, '--days 7 persists fresh window unchanged');

  // Give buildData clean meter-derived plans: current retained units must force EVERY plan to floor.
  const proofScript = `import fs from 'node:fs';import {buildData} from './src/collect.mjs';
const prices=JSON.parse(fs.readFileSync('core/prices.json'));
const w={usd_per_full_week:20,meter_start_pct:0,meter_end_pct:100,hours:1,measured:{api_usd:20,output_tokens:1000,cached_input_tokens:10,model_mix_by_usd:{}}};
const report={prices,this_week:{claude:w,codex:w,google:w}};
const retained=JSON.parse(process.env.FIXTURE_RETAINED),cfg={days:+process.env.FIXTURE_DAYS||21};
console.log(JSON.stringify(buildData(report,null,cfg,{counts:{},hosts:[{alias:'box-a',ok:true}],retained})));`;
  const proof = (rows, days = 21) => JSON.parse(run(process.execPath, ['--input-type=module', '-e', proofScript], { env: { ...env, FIXTURE_RETAINED: JSON.stringify(rows), FIXTURE_DAYS: String(days) } }));
  const pastEnd = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 13);
  fs.writeFileSync(path.join(env.WORTHIT_HOME, 'weeks/ledger.jsonl'), JSON.stringify({ provider: 'claude', quality: 'clean', reset: 'reset-a', start: pastEnd, end: pastEnd, usd_measured: 10, usd_per_full_week: 10, meter: [0, 100] }) + '\n');
  assert.equal(proof([]).plans[0].change_vs_last_week_pct, 100, 'comparison exists with fresh complete data');
  const sevenProof = proof(seven.machines_retained, 7).plans[0];
  assert.equal(sevenProof.proof, 'measured', '--days 7 sliding edge must not force floor');
  assert.equal(sevenProof.change_vs_last_week_pct, 100, '--days 7 with ledger keeps comparison eligible');
  const floor = proof(after.machines_retained);
  assert.equal(floor.plans.length, 3);
  for (const p of floor.plans) { assert.equal(p.proof, 'floor'); assert.equal(p.change_vs_last_week_pct, null); }
  for (const p of proof(emptyAnswer.machines_retained).plans) {
    assert.equal(p.proof, 'floor', 'empty-answer retained current-week units force floor');
    assert.equal(p.change_vs_last_week_pct, null, 'empty-answer floor has no weekly comparison');
  }
  assert.equal(proof([{ machine: 'box-a', days_kept: 1, units: [{ day: '2020-01-01', provider: 'claude' }] }]).plans[0].proof, 'measured', 'old retained days outside this week do not taint this week');
  const multi = { ...after, plans: floor.plans, machines_retained: [{ machine: 'box-a-long-alias-for-fixture', days_kept: 14 }, { machine: 'box-b-long-alias-for-fixture', days_kept: 7 }] };
  const multiNotes = machineNotes(multi);
  assert.deepEqual(multiNotes, ['box-a-long-alias +1: kept 7–14 older days each']);
  assert.ok(len(multiNotes[0]) + 2 <= 52, 'folded retained note fits PlanRanking inner width');
  assert.ok(blocks.PlanRanking(multi).map(strip).some(l => l.includes(multiNotes[0])), 'ranking draws the complete note without clipping');
  assert.deepEqual(machineNotes({ machines_retained: [{ machine: 'box-a', days_kept: 14 }, { machine: 'box-b', days_kept: 14 }] }), ['box-a +1: kept 14 older days each'], 'equal distinct-day counts stay exact');
  if (process.env.WORTHIT_FIXTURE_ARTIFACT_DIR) {
    const out = process.env.WORTHIT_FIXTURE_ARTIFACT_DIR; fs.mkdirSync(out, { recursive: true });
    write(path.join(out, 'data.json'), after);
    write(path.join(out, 'multi-data.json'), multi);
    fs.writeFileSync(path.join(out, 'dashboard.txt'), ['WORTHIT · synthetic saved-days regression', ...machineNotes(after), '', ...blocks.Tiles(after), '', ...blocks.Months(after)].map(strip).join('\n'));
  }
  expected.done();
  console.log('keep-saved-days: ok (14 -> 14 including empty successful answer, literal week/history stable, retained sliding since, overlaps, persistence, JSON/dashboard, floor proof; intact 7-day CLI and synthetic proof, corrupt files, safe Python imports, folded aliases)');
} finally {
  isolated.cleanup();
}
