// RFC 0002, through real source extraction, pricing, CLI, history and checkpoint storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceCase } from '../../support/source-case.mjs';
import { machineNotes, blocks, strip } from '../../../src/draw.mjs';
import { cardSpec, cardHtml } from '../../../src/card.mjs';
import { openWeekly, saveWeekly } from '../../../src/weekly.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
sourceCase(folder, ({ expected, tmp, home, env, python, root, run, query, trace }) => {
  const entry = path.join(root, 'bin/worthit.mjs'), store = path.join(tmp, 'store');
  const invoke = (args, overrides = {}, status = 0) => {
    const r = spawnSync(process.execPath, [entry, ...args], { cwd: tmp, env: { ...env, WORTHIT_HOME: store, FIXTURE_ACCOUNTS: '[]', ...overrides }, input: '', encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
    assert.equal(r.status, status, `retire-machine / ${args.join(' ')}\n${r.stderr}\n${r.stdout}`);
    return status === 2 ? r.stderr : JSON.parse(r.stdout);
  };
  const scan = (overrides = {}, days = 21, hosts = 'all', git = false) => invoke(['--json', '--no-files', '--days', String(days), '--hosts', hosts, '--git', git ? 'yes' : 'no', '--ai', 'no'], overrides);
  const weekly = (overrides = {}, status = 0) => invoke(['weekly', '--no-files'], overrides, status);
  const hosts = (...args) => invoke(['hosts', ...args]);
  const history = () => JSON.parse(fs.readFileSync(path.join(store, 'history.json'))).days;
  const freeze = path.join(store, 'run-keep/retired/box-b.json');
  const saved = path.join(store, 'run-keep/box-b.json');
  const past = expected.get('past_history'), days = expected.get('retired_days');
  const assertPast = () => { for (const [d, row] of Object.entries(past)) assert.deepEqual(history()[d], row, `retire-machine / unchanged past ${d}`); };
  const noRetiredSSH = start => assert.ok(!trace().slice(start).some(c => c.command === 'ssh' && c.args.at(-2) === 'box-b'), 'retire-machine / retired alias must never be asked');

  // Fourteen literal daily Claude source rows; the retired machine has no other tools.
  const remote = path.join(tmp, 'box-b'), remoteLog = path.join(remote, '.claude/projects/example/usage.jsonl');
  fs.copyFileSync(path.join(folder, 'retired.jsonl'), remoteLog);
  for (const dir of ['.codex', '.gemini']) fs.rmSync(path.join(remote, dir), { recursive: true, force: true });
  fs.writeFileSync(path.join(remote, '.meter/claude-limits.jsonl'), '');
  run(python, ['-c', "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute('DELETE FROM usage'); d.commit(); d.close()", path.join(remote, '.meter/meter.db')]);
  // Historical priming sees no future source rows, including meter rows in SQLite.
  const backups = [];
  const visit = dir => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, f.name);
      if (f.isDirectory()) visit(file);
      else if (f.name.endsWith('.jsonl')) { const text = fs.readFileSync(file, 'utf8'); backups.push([file, text]); fs.writeFileSync(file, text.split('\n').filter(l => !/2026-11-(09|11|13)/.test(l)).join('\n')); }
    }
  };
  for (const dir of [home, path.join(tmp, 'box-c')]) {
    visit(dir);
    const file = path.join(dir, '.meter/meter.db'); backups.push([file, fs.readFileSync(file)]);
    run(python, ['-c', "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute('DELETE FROM usage WHERE hour_ms >= 1794009600000'); d.commit(); d.close()", file]);
  }
  scan({ FIXTURE_NOW: '2026-11-07T00:00:00Z' }, 28);
  for (const [file, bytes] of backups) fs.writeFileSync(file, bytes);
  assert.deepEqual([...new Set(JSON.parse(fs.readFileSync(saved)).buckets.map(b => b.hour.slice(0, 10)))].sort(), days);
  const oldBytes = fs.readFileSync(saved);
  fs.writeFileSync(path.join(store, 'hosts.json'), JSON.stringify({ selected: ['box-b', 'box-c'] })); // legacy store
  assert.match(invoke(['hosts', 'retire', 'unknown-box'], {}, 2), /no readable saved scan.*Leave it out/s);
  assert.match(invoke(['hosts', 'retire', 'box-b', '--since', '2026-11-06'], {}, 2), /earlier than last_scan_at/);
  assert.match(invoke(['hosts', 'retire', 'box-b', '--since', '2026-02-30'], {}, 2), /valid YYYY-MM-DD/);
  assert.match(invoke(['hosts', 'retire', 'box-b', '--since', '2026-12-01'], {}, 2), /future/);
  const retired = hosts('retire', 'box-b', '--since', '2026-11-07');
  assert.equal(retired.since, '2026-11-07');
  assert.deepEqual(fs.readFileSync(freeze), oldBytes, 'retirement moves bytes without rewriting');
  assert.ok(!fs.existsSync(saved));
  assert.equal(hosts().find(r => r.machine === 'box-b').status, 'retired');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(store, 'hosts.json'))).selected, ['box-c']);

  // Literal historical control: the retired machine's unmetered prior usage
  // correctly prevents a clean source-derived stint. This pins proof for an
  // existing historical ledger value without weakening the source-log assertions.
  fs.appendFileSync(path.join(store, 'weeks/ledger.jsonl'), fs.readFileSync(path.join(folder, 'prior-ledger.json'), 'utf8'));
  const start = trace().length;
  const d = scan({ FIXTURE_OFFLINE_ALIASES: 'box-b', WORTHIT_REUSE: '1' });
  const p = d.plans.find(p => p.key === 'claude');
  assert.deepEqual({ machines: d.machines, missing: d.machines_missing, left_out: d.machines_left_out, out: d.totals.output_tokens, usd: d.totals.api_value_usd, proof: p.proof, plan_usd: p.usd_per_full_week, change: p.change_vs_last_week_pct }, expected.get('measured'), 'retire-machine / measured-after-retirement proof rule');
  assert.deepEqual(d.machines_retired, [expected.get('retirement')]);
  if (env.WORTHIT_FIXTURE_ARTIFACTS) { fs.mkdirSync(env.WORTHIT_FIXTURE_ARTIFACTS, { recursive: true }); fs.writeFileSync(path.join(env.WORTHIT_FIXTURE_ARTIFACTS, 'retirement-data.json'), JSON.stringify(d, null, 2)); }
  assert.equal(p.weeks.find(w => w.weeks_ago === 1)?.proof, 'floor', 'pre-retirement week stays floor: ' + JSON.stringify({ weeks: p.weeks, ledger: fs.readFileSync(path.join(store, 'weeks/ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).map(({ provider, start, end, usd_measured, usd_per_full_week }) => ({ provider, start, end, usd_measured, usd_per_full_week })) }));
  assert.match(p.retirement_note, /retired since 2026-11-07, as stated by you/);
  assert.ok(machineNotes(d).some(s => s.includes('box-b: retired')));
  assertPast(); noRetiredSSH(start);
  assert.deepEqual(fs.readFileSync(freeze), oldBytes);
  // Explicit retired selection is ignored just as --hosts all and the saved selection are.
  const explicitStart = trace().length;
  const explicit = scan({}, 21, 'box-b,box-c');
  assert.deepEqual(explicit.machines_missing, []); assert.deepEqual(explicit.machines_left_out, []);
  noRetiredSSH(explicitStart);
  const selected = invoke(['--json', '--no-files', '--git', 'no', '--ai', 'no']);
  assert.equal(selected.plans[0].proof, 'measured');

  // A previously recorded measured checkpoint is not a comparable pre-retirement week.
  const seed = (at, proof) => { const db = openWeekly(store); saveWeekly(db, { generated_at: at, week: { to: at.slice(0, 10) }, plans: [{ plan: p.plan, proof, usd_per_full_week: 6 }], safe_to_post: true }); db.close(); };
  seed('2026-11-07T00:00:00.000Z', 'measured');
  const now = weekly();
  assert.equal(now.safe_to_post, true); assert.equal(now.plans[0].proof, 'measured');
  assert.equal(now.compared_with.plans[0].proof, 'floor'); assert.equal(now.plans[0].change_vs_last_week_pct, null);
  assert.match(now.text, /retired since 2026-11-07, as stated by you/);
  assert.match(cardHtml(cardSpec('allowance', d)), /retired since 2026-11-07, as stated by you/);
  const early = weekly({ FIXTURE_NOW: '2026-11-13T12:00:00Z' }, 3), earlyExpected = expected.get('early');
  assert.deepEqual({ proof: early.plans[0].proof, change: early.plans[0].change_vs_last_week_pct, status: 3, first_measured: earlyExpected.first_measured }, earlyExpected);
  assert.ok(early.reasons.some(r => r.includes('box-b') && r.includes(earlyExpected.first_measured)));
  assert.ok(machineNotes({ ...d, generated_at: early.generated_at }).some(r => r.includes('box-b') && r.includes('2026-11-14')));
  const laterStore = path.join(tmp, 'later-store'); fs.cpSync(store, laterStore, { recursive: true });
  const futureBackups = [];
  const advance = dir => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, f.name);
      if (f.isDirectory()) advance(file);
      else if (f.name.endsWith('.jsonl')) {
        const text = fs.readFileSync(file, 'utf8'); futureBackups.push([file, text]);
        fs.writeFileSync(file, text.replaceAll('2026-11-09', '2026-11-16').replaceAll('2026-11-11', '2026-11-18').replaceAll('2026-11-13', '2026-11-20').replaceAll('1794657600', '1795262400'));
      }
    }
  };
  for (const dir of [home, path.join(tmp, 'box-c')]) {
    advance(dir); const file = path.join(dir, '.meter/meter.db'); futureBackups.push([file, fs.readFileSync(file)]);
    run(python, ['-c', "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute('UPDATE usage SET hour_ms = hour_ms + 604800000 WHERE hour_ms >= 1794225600000'); d.commit(); d.close()", file]);
  }
  const later = weekly({ WORTHIT_HOME: laterStore, FIXTURE_NOW: '2026-11-21T12:00:00Z' });
  for (const [file, bytes] of futureBackups) fs.writeFileSync(file, bytes);
  assert.deepEqual({ proof: later.plans[0].proof, change: later.plans[0].change_vs_last_week_pct, status: 0 }, expected.get('eligible_change'), 'retire-machine / measured checkpoint comparison restored');
  assert.deepEqual(fs.readFileSync(freeze), oldBytes);
  assertPast();

  // Another alias reports the retired host: choose whole units, never add both copies.
  // Three overlaps have lower fresh USD ($1 vs $2); one wins with higher fresh USD.
  const aliasLog = path.join(tmp, 'box-c/.claude/projects/example/usage.jsonl');
  const aliasBytes = fs.readFileSync(aliasLog);
  const rows = fs.readFileSync(path.join(folder, 'retired.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const fresh = rows.filter(r => ['2026-11-02', '2026-11-04', '2026-11-06'].includes(r.timestamp.slice(0, 10))).map((r, i) => ({ ...r, sessionId: 'alias-fresh-' + i, requestId: 'alias-fresh-' + i, message: { ...r.message, id: 'alias-fresh-' + i, usage: { input_tokens: 0, output_tokens: i === 2 ? 300000 : i === 1 ? 200000 : 100000 } } }));
  fs.writeFileSync(aliasLog, fresh.map(JSON.stringify).join('\n') + '\n');
  const cloneRetirement = name => { const dir = path.join(tmp, name); fs.mkdirSync(path.join(dir, 'run-keep/retired'), { recursive: true }); fs.copyFileSync(freeze, path.join(dir, 'run-keep/retired/box-b.json')); fs.copyFileSync(path.join(store, 'hosts.json'), path.join(dir, 'hosts.json')); return dir; };
  const dupStore = cloneRetirement('dup-store');
  const dup = scan({ WORTHIT_HOME: dupStore, FIXTURE_HOST_NAMES: '{"box-c":"box-b"}' });
  const retireRun = path.join(dupStore, 'run', fs.readdirSync(path.join(dupStore, 'run'))[0]);
  assert.ok(!fs.existsSync(path.join(retireRun, 'box-b.json')), 'duplicate snapshot is merged into live alias');
  const merged = JSON.parse(fs.readFileSync(path.join(retireRun, 'box-c.json')));
  const totals = merged.buckets.reduce((a, b) => ({ out: a.out + b.output, usd: a.usd + b.output / 100000, requests: a.requests + b.requests }), { out: 0, usd: 0, requests: 0 });
  assert.ok(merged.buckets.some(b => b.provider === 'claude' && b.session === 'alias-fresh-1'), 'fresh wins a full USD/tokens tie');
  assert.ok(!merged.buckets.some(b => b.provider === 'claude' && b.session === 'alias-fresh-0'), 'higher saved whole unit wins');
  // Only Claude buckets are counted here; other tools remain in the live source.
  const claude = merged.buckets.filter(b => b.provider === 'claude');
  assert.equal(claude.reduce((n, b) => n + b.output, 0), 2900000, '14 whole units, higher fresh winner on Nov 6');
  assert.ok(dup.retirement_conflicts.some(r => r.machine === 'box-b' && r.same_as === 'box-c'));
  assert.ok(machineNotes(dup).some(s => s === 'box-b is retired but answers as box-c'));
  fs.writeFileSync(aliasLog, aliasBytes);
  // Local reports the same host too; the alias is absent, snapshot merges into local.
  const localStore = cloneRetirement('local-dup-store');
  const localDup = scan({ WORTHIT_HOME: localStore, FIXTURE_MACHINE: 'box-b' }, 21, 'none');
  assert.ok(localDup.retirement_conflicts.some(r => r.same_as === 'this machine'));
  const localRun = path.join(localStore, 'run', fs.readdirSync(path.join(localStore, 'run'))[0]);
  assert.ok(!fs.existsSync(path.join(localRun, 'box-b.json')));
  // The extra literal total pins whole-unit selection across all source-log bucket providers.
  assert.deepEqual(totals, expected.get('duplicate'));
  assert.deepEqual(fs.readFileSync(freeze), oldBytes);

  for (const at of ['2026-11-15T12:00:00Z', '2026-11-16T12:00:00Z']) { scan({ FIXTURE_NOW: at }); assertPast(); assert.deepEqual(fs.readFileSync(freeze), oldBytes); }
  hosts('unretire', 'box-b');
  assert.deepEqual(fs.readFileSync(saved), oldBytes, 'unretire restores the entire frozen scan');
  assert.equal(hosts().find(r => r.machine === 'box-b').status, 'selected');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(store, 'hosts.json'))).selected, ['box-c', 'box-b']);
  const unretired = invoke(['--json', '--no-files', '--git', 'no', '--ai', 'no'], { FIXTURE_NOW: '2026-11-16T12:00:00Z' });
  assert.deepEqual(unretired.machines_retired, []); assertPast();
  assert.ok(trace().some(c => c.command === 'ssh' && c.args.at(-2) === 'box-b'));

  // Short window: history keeps the morning of its partial oldest day and git-only older rows.
  // Start another isolated store and reuse the repository's literal source fixture.
  const shortStore = path.join(tmp, 'short-store');
  for (const [box, dest] of [['box-a', home], ['box-b', remote]]) {
    const file = path.join(root, 'test/fixtures/history-scan-coverage', box + '.jsonl');
    fs.copyFileSync(file, path.join(dest, '.claude/projects/example/usage.jsonl'));
  }
  fs.copyFileSync(path.join(folder, 'short-box-b.jsonl'), remoteLog);
  for (const dir of ['.codex', '.gemini']) fs.rmSync(path.join(home, dir), { recursive: true, force: true });
  fs.writeFileSync(path.join(home, '.meter/claude-limits.jsonl'), '');
  run(python, ['-c', "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute('DELETE FROM usage'); d.commit(); d.close()", path.join(home, '.meter/meter.db')]);
  const shortEnv = { WORTHIT_HOME: shortStore, FIXTURE_ACCOUNTS: '["coder-a"]', FIXTURE_SOURCES: path.join(root, 'test/fixtures/history-scan-coverage') };
  scan(shortEnv, 21, 'box-b', true);
  invoke(['hosts', 'retire', 'box-b'], shortEnv);
  const shortBefore = JSON.parse(fs.readFileSync(path.join(shortStore, 'history.json'))).days;
  scan(shortEnv, 7, 'box-b', true);
  const shortAfter = JSON.parse(fs.readFileSync(path.join(shortStore, 'history.json'))).days;
  const shortExpected = expected.get('short_history');
  for (const [day, row] of Object.entries(shortExpected)) {
    assert.deepEqual(shortBefore[day], row, 'retire-machine / short source baseline ' + day);
    assert.deepEqual(shortAfter[day], row, 'retire-machine / short retirement preserves ' + day);
  }
  invoke(['hosts', 'unretire', 'box-b'], shortEnv); scan(shortEnv, 7, 'box-b', true);
  const shortRestored = JSON.parse(fs.readFileSync(path.join(shortStore, 'history.json'))).days;
  for (const [day, row] of Object.entries(shortExpected)) assert.deepEqual(shortRestored[day], row, 'retire-machine / short unretirement preserves ' + day);
  const stored = query("SELECT day, SUM(api_usd) AS usd, SUM(output_tokens) AS out FROM day_provider WHERE day IN ('2026-11-04','2026-11-07') GROUP BY day", 'short-store');
  for (const row of stored) { assert.equal(row.usd, shortExpected[row.day].usd); assert.equal(row.out, shortExpected[row.day].out); }
  assert.ok(!fs.existsSync(freeze), 'unretired store has no frozen scan');
  // Rendering uses this synthetic source data only; no real host identities enter the image.
  assert.ok(blocks.PlanRanking(d).map(strip).join('\n').includes('retired'));
});
