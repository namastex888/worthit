// RFC 0003 scheduler contract, on literal source logs and isolated SQLite stores.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceCase } from '../../support/source-case.mjs';
import { allowanceText, openWeekly, prepareWeekly, saveWeekly } from '../../../src/weekly.mjs';
import { cardSpec, cardHtml } from '../../../src/card.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
sourceCase(folder, ({ expected, tmp, home, bin, env, python, root, run, query, trace }) => {
  env.HOME = fs.realpathSync(home);
  // If any UI, agent, clipboard or git command is attempted, fail and record it.
  for (const name of ['open', 'xdg-open', 'osascript', 'wl-copy', 'xclip', 'claude', 'codex', 'omp', 'dsh', 'git']) {
    fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\nimport fs from 'node:fs';fs.appendFileSync(process.env.FIXTURE_TRACE,JSON.stringify({unexpected:${JSON.stringify(name)}})+'\\n');process.exit(86);\n`, { mode: 0o755 });
  }
  const weekly = (store, { args = [], overrides = {}, status = 0, files = false, blockAudit = false } = {}) => {
    const outputDir = path.join(files ? home : tmp, 'output-' + store); fs.mkdirSync(outputDir, { recursive: true });
    const output = fs.realpathSync(outputDir); // macOS /var and /private/var name the same scratch directory.
    if (blockAudit) fs.mkdirSync(path.join(output, '2026-11-14-worthit-audit.log'));
    const rendersBefore = trace().filter(c => c.command === 'headless-chrome').length;
    const r = spawnSync(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'weekly', ...(files ? [] : ['--no-files']), ...args], {
      cwd: output, env: { ...env, NODE_OPTIONS: env.NODE_OPTIONS + ` --import=${path.join(folder, 'render.mjs')}`, WORTHIT_HOME: path.join(tmp, store),
        ...overrides },
      input: '', encoding: 'utf8', maxBuffer: 16 << 20, timeout: 30000,
    });
    assert.equal(r.status, status, `weekly ${store}: exit status\n${r.stderr}\n${r.stdout}`);
    if (status === 1) {
      assert.equal(r.stdout, '', 'failed run prints no result JSON');
      if (files) {
        const file = path.join(output, '2026-11-14-worthit-audit.log');
        if (blockAudit) {
          assert.ok(fs.statSync(file).isDirectory(), 'unwritable audit destination remains untouched');
          assert.match(r.stderr, /could not write audit log/);
          assert.ok(fs.existsSync(path.join(output, '2026-11-14-worthit-share-allowance.png')), 'audit failure can leave an already-rendered PNG');
        } else {
          assert.ok(fs.existsSync(file), 'exit-1 scan still writes its audit');
          const audit = fs.readFileSync(file, 'utf8');
          assert.match(audit, /  run\s+ssh box-b .*core\/extract_usage\.py/);
          assert.doesNotMatch(audit, /headless Chrome screenshot/);
          assert.equal(trace().filter(c => c.command === 'headless-chrome').length, rendersBefore);
          assert.deepEqual(fs.readdirSync(output), [path.basename(file)], 'missing Chrome leaves only the audit');
        }
        assert.ok(r.stderr.includes(file), 'failed run names its audit path on stderr');
        assert.equal(query('SELECT COUNT(*) AS n FROM weekly', store)[0].n, 0, 'failed run saves no checkpoint');
      } else assert.deepEqual(fs.readdirSync(output), [], '--no-files failure creates no output artifacts');
      return r;
    }
    const data = JSON.parse(r.stdout); // one JSON object, no TUI or questions
    assert.equal(trace().filter(c => c.command === 'headless-chrome').length - rendersBefore, +files, 'render only with output files enabled');
    if (files) {
      assert.equal(typeof data.audit_log, 'string', 'weekly JSON names its audit path');
      assert.ok(path.isAbsolute(data.audit_log), 'weekly JSON names its absolute audit path');
      assert.equal(fs.realpathSync(data.audit_log), fs.realpathSync(path.join(output, '2026-11-14-worthit-audit.log')));
      assert.ok(path.isAbsolute(data.image));
      assert.equal(fs.realpathSync(data.image), fs.realpathSync(path.join(output, '2026-11-14-worthit-share-allowance.png')));
      assert.ok(fs.readFileSync(data.image).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
      const audit = fs.readFileSync(data.audit_log, 'utf8');
      assert.match(audit, /^worthit .+ audit log · [^\n]+\n/);
      assert.match(audit, /Kinds: [^\n]*\bread\b[^\n]*\brun\b[^\n]*\bwrite\b/);
      assert.match(audit, /  run\s+python3 core\/extract_usage\.py/);
      const localRead = /^\S+  read\s+((?:~|\/[^\n]*)\/\.claude\/projects\/example\/usage\.jsonl)$/m.exec(audit)?.[1];
      assert.ok(localRead, 'audit includes the local session-log read');
      assert.equal(fs.realpathSync(localRead.replace(/^~(?=\/)/, env.HOME)),
        fs.realpathSync(path.join(home, '.claude/projects/example/usage.jsonl')), 'audit read names the actual fixture source');
      assert.match(audit, /  run\s+python3 core\/weekly\.py/);
      assert.match(audit, /  run\s+headless Chrome screenshot of the allowance card/);
      assert.match(audit, /  write\s+.*worthit\.db  \(weekly checkpoint\)/);
      for (const machine of ['box-b', 'box-c']) {
        assert.match(audit, new RegExp(`  run\\s+ssh ${machine} .*core/extract_usage\\.py`));
        assert.match(audit, new RegExp(`ssh ${machine} finished:`));
        if (status === 0) assert.match(audit, new RegExp(`  read\\s+${machine}:.*usage\\.jsonl`));
      }
      const display = file => '~' + file.slice(env.HOME.length);
      assert.ok(audit.includes('  write ' + display(data.image)), 'audit includes card write with tilde path');
      assert.ok(audit.includes('  write ' + display(data.audit_log)), 'audit includes its own write with tilde path');
      assert.deepEqual(fs.readdirSync(output).sort(), [path.basename(data.audit_log), path.basename(data.image)].sort());
    } else {
      assert.equal(data.image, null);
      assert.equal(data.audit_log, null, '--no-files reports no audit path');
      assert.deepEqual(fs.readdirSync(output), [], '--no-files creates no output artifacts');
    }
    assert.deepEqual(data.machines_retired, []);
    assert.deepEqual(data.week, { from: '2026-11-07', to: '2026-11-14' });
    const stored = query('SELECT generated_at, week_to, safe, json FROM weekly ORDER BY generated_at DESC', store).find(row => row.generated_at === data.generated_at);
    assert.deepEqual(JSON.parse(stored.json), data, 'SQLite stores exactly the printed object');
    assert.equal(stored.safe, +data.safe_to_post);
    assert.equal(stored.week_to, data.week.to);
    return { status: r.status, data };
  };
  const check = (name, store = name, options = {}) => {
    const e = expected.get(name), r = weekly(store, { ...options, status: e.status }), d = r.data, p = d.plans[0];
    assert.deepEqual({ status: r.status, safe: d.safe_to_post, machines: d.machines_read,
      proof: p.proof, value: p.usd_per_full_week, change: p.change_vs_last_week_pct }, e, name);
    return d;
  };
  // Issue #60: actual synthetic scans must persist their audit on exit 0 and 3.
  weekly('audit-no-chrome', { files: true, status: 1, overrides: { FIXTURE_NO_CHROME: '1' } });
  weekly('audit-blocked', { files: true, status: 1, blockAudit: true });
  weekly('audit-complete', { files: true });
  weekly('audit-missing', { files: true, status: 3, overrides: { FIXTURE_OFFLINE: '1' } });
  const first = check('complete');
  assert.equal(first.compared_with, null);
  assert.deepEqual(first.moved, []);
  assert.ok(fs.readFileSync(path.join(tmp, 'complete/weeks/ledger.jsonl'), 'utf8').includes('2026-11-06'), 'earlier ledger really exists');
  assert.doesNotMatch(first.text, /%|week before/);
  const draw = d => cardSpec('allowance', { ...d, plans: d.plans.map(p => ({ ...p, color: '#ffeecc' })) });
  assert.equal(draw(first).sub, 'measured', 'first checkpoint ignores ledger on card too');
  const again = weekly('complete').data;
  assert.notEqual(first.generated_at, again.generated_at, 'same-clock runs have distinct primary keys');
  assert.equal(query('SELECT COUNT(*) AS n FROM weekly', 'complete')[0].n, 2);
  assert.equal(again.compared_with, null, 'same-week run is not last week');
  assert.ok(trace().filter(c => c.command === 'ssh').some(c => c.args.at(-2) === 'box-c'), 'default all includes every SSH host');

  const missing = check('missing', 'missing', { overrides: { FIXTURE_OFFLINE: '1' } });
  for (const machine of ['box-b', 'box-c']) assert.ok(missing.reasons.some(r => r.includes(machine) && r.includes('no fresh answer')));
  const allowed = check('allow_partial', 'allow-partial', { args: ['--allow-partial'], overrides: { FIXTURE_OFFLINE: '1' } });
  assert.deepEqual(allowed.reasons, missing.reasons, 'allow-partial retains missing-machine reasons');
  // A warm reusable store cannot bypass the required new local and SSH scans.
  const before = trace().filter(c => c.command === 'ssh').length;
  const fresh = weekly('complete', { overrides: { WORTHIT_REUSE: '1', FIXTURE_OFFLINE: '1' }, status: 3 }).data;
  assert.equal(trace().filter(c => c.command === 'ssh').length - before, 2, 'fresh scan despite WORTHIT_REUSE');
  assert.equal(fresh.machines_missing.length, 2);
  assert.ok(fresh.machines_missing.every(m => m.saved_scan_at), 'saved answers remain explicitly missing');
  assert.ok(fresh.plans.every(p => p.proof === 'floor'));

  const left = check('left_out', 'complete', { args: ['--hosts', 'none'] });
  assert.deepEqual(left.machines_left_out, ['box-b', 'box-c']);
  assert.ok(left.reasons.some(r => r.includes('box-b') && r.includes('left out')));
  const floorSafe = check('floor_safe', 'floor-safe', { args: ['--hosts', 'none'] });
  assert.deepEqual(floorSafe.reasons, [], 'a floor by itself is safe');
  assert.match(floorSafe.text, /at least/);
  assert.equal(draw(floorSafe).sub, 'at least');

  const log = path.join(home, '.claude/projects/example/usage.jsonl'), original = fs.readFileSync(log, 'utf8');
  const removeDay = day => fs.writeFileSync(log, original.split('\n').filter(l => !l.includes(day)).join('\n'));
  weekly('current-retained');
  removeDay('2026-11-11');
  const retained = check('current_retained', 'current-retained');
  const unit = expected.get('retained_unit');
  assert.ok(retained.machines_retained.some(r => r.machine === 'this machine' && r.units.some(u => u.day === unit.day && u.provider === unit.provider)));
  assert.ok(retained.reasons.some(r => r.includes('this machine') && r.includes(unit.day) && r.includes(unit.provider)));
  const overridden = check('retained_override', 'current-retained', { args: ['--allow-partial'] });
  assert.deepEqual(overridden.reasons, retained.reasons, 'allow-partial retains machine/day/provider reasons');
  fs.writeFileSync(log, original);
  weekly('prior-retained');
  removeDay('2026-11-04');
  const prior = check('prior_retained', 'prior-retained');
  assert.ok(prior.machines_retained.length, 'prior retained unit exists');
  assert.deepEqual(prior.reasons, []);
  fs.writeFileSync(log, original);

  // Nov 7 starts before the rolling week's noon boundary and ends inside it.
  // Losing its source unit must force both floor proof and unsafe exit 3.
  const straddlingUnit = expected.get('straddling_unit');
  const edgeRow = JSON.parse(original.split('\n').find(l => l.includes('2026-11-06')));
  edgeRow.timestamp = straddlingUnit.day + 'T10:00:00Z';
  edgeRow.sessionId = edgeRow.requestId = edgeRow.message.id = 'box-a-straddling';
  fs.writeFileSync(log, original.trimEnd() + '\n' + JSON.stringify(edgeRow) + '\n');
  weekly('straddling-retained');
  fs.writeFileSync(log, original);
  const straddling = check('straddling_retained', 'straddling-retained');
  assert.ok(straddling.machines_retained.some(r => r.machine === 'this machine' && r.units.some(u => u.day === straddlingUnit.day && u.provider === straddlingUnit.provider)));
  assert.ok(straddling.reasons.some(r => r.includes('this machine') && r.includes(straddlingUnit.day) && r.includes(straddlingUnit.provider)), 'straddling retained unit names machine/day/provider');

  // Real checkpoints one week apart; increase only current Claude output in scratch.
  // Temporarily withhold future source rows from the historical run, including
  // the tool store, so that checkpoint is based only on its own week's sources.
  const futureSources = [], futureStores = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.jsonl')) {
        const text = fs.readFileSync(file, 'utf8'); futureSources.push([file, text]);
        fs.writeFileSync(file, text.split('\n').filter(l => !/2026-11-(09|11|13)/.test(l)).join('\n'));
      }
    }
  };
  for (const boxHome of [home, path.join(tmp, 'box-b'), path.join(tmp, 'box-c')]) {
    visit(boxHome);
    const file = path.join(boxHome, '.meter/meter.db'); futureStores.push([file, fs.readFileSync(file)]);
    run(python, ['-c', "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute('DELETE FROM usage WHERE hour_ms >= 1794052800000'); d.commit(); d.close()", file]);
  }
  // Claude is the only metered plan in these literal sources; exclude all
  // future Claude meter rows as well as requests before taking the checkpoint.
  const oldEnv = { ...env, WORTHIT_HOME: path.join(tmp, 'measured'), FIXTURE_NOW: '2026-11-07T12:00:00Z' };
  const previous = JSON.parse(run(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'weekly', '--no-files'], oldEnv));
  assert.equal(previous.plans[0].usd_per_full_week, 12);
  for (const [file, text] of futureSources) fs.writeFileSync(file, text);
  for (const [file, bytes] of futureStores) fs.writeFileSync(file, bytes);
  fs.writeFileSync(log, original.split('\n').map(l => {
    if (!l || !l.includes('current')) return l;
    const row = JSON.parse(l); row.message.usage.output_tokens = 500000; return JSON.stringify(row);
  }).join('\n'));
  const measured = check('measured_baseline', 'measured');
  assert.equal(measured.compared_with.generated_at, previous.generated_at);
  assert.deepEqual(measured.moved, [{ plan: measured.plans[0].plan, from: 12, to: 24, pct: 100 }]);
  assert.match(measured.text, /▲100% vs the week before/);
  assert.match(draw(measured).sub, /▲ 100% vs last week/);
  assert.match(cardHtml(draw(measured)), /▲ 100% vs last week/);
  fs.writeFileSync(log, original);

  const seed = (store, at, weekTo, proof, value = 10, safe = true) => {
    const db = openWeekly(path.join(tmp, store));
    saveWeekly(db, { generated_at: at, week: { from: '2026-10-01', to: weekTo },
      plans: [{ plan: first.plans[0].plan, usd_per_full_week: value, proof }], safe_to_post: safe });
    db.close();
  };
  seed('floor', '2026-10-31T12:00:00.000Z', '2026-10-31', 'measured');
  seed('floor', '2026-11-07T12:00:00.000Z', '2026-11-07', 'floor');
  const floor = check('floor_baseline', 'floor');
  assert.equal(floor.compared_with.week_to, '2026-11-07', 'never search past a floor');
  assert.deepEqual(floor.moved, []);
  assert.doesNotMatch(floor.text, /%|week before/);
  assert.equal(draw(floor).sub, 'measured');
  // Exactly six days qualifies; five does not, future-generated entries do not.
  seed('six', '2026-11-08T12:00:00.000Z', '2026-11-08', 'measured', 10, false);
  seed('six', '2026-11-09T12:00:00.000Z', '2026-11-09', 'measured', 1);
  seed('six', '2026-11-15T12:00:00.000Z', '2026-11-01', 'measured', 2);
  const six = check('six_days', 'six');
  assert.equal(six.compared_with.week_to, '2026-11-08');
  assert.equal(six.plans[0].change_vs_last_week_pct, 20, 'unsafe baseline still usable when this plan was measured');

  // Mixed endpoints and strict moved boundary. Deliberately preload a bogus
  // ledger change so even noncomparable plans must have it cleared before drawing.
  const plan = (name, value, proof = 'measured') => ({ plan: name, usd_per_full_week: value, times_plan_price: 1, proof, color: '#ffeecc', change_vs_last_week_pct: 999 });
  const baseData = plans => ({ generated_at: '2026-11-14T12:00:00.000Z', week: first.week, plans,
    machines: 1, machines_missing: [], machines_left_out: [], machines_retained: [] });
  const mixedData = baseData([plan('Both', 120), plan('Before floor', 120), plan('Now floor', 120, 'floor'), plan('New plan', 120)]);
  const mixed = prepareWeekly(mixedData, { generated_at: '2026-11-07T12:00:00.000Z', week_to: '2026-11-07',
    plans: [plan('Both', 100), plan('Before floor', 100, 'floor'), plan('Now floor', 100)] });
  assert.deepEqual(mixed.plans.map(p => p.change_vs_last_week_pct), expected.get('mixed_changes'));
  assert.deepEqual(mixed.moved.map(p => p.plan), ['Both']);
  const mixedCard = draw(mixed);
  assert.equal(mixedCard.rows.find(r => r.label === 'Both').note, '▲ 20% vs last week');
  assert.equal(mixedCard.rows.find(r => r.label === 'Before floor').note, 'measured');
  assert.equal(mixedCard.rows.find(r => r.label === 'Now floor').note, 'at least');
  const mixedText = allowanceText(mixedData);
  assert.match(mixedText, /both .*▲20% vs the week before/);
  assert.match(mixedText, /before floor \$120\n/);
  assert.match(mixedText, /now floor \$120 \(at least\)/);
  assert.doesNotMatch(mixedText, /999/);
  const boundaryData = baseData([plan('Up exact', 105), plan('Down exact', 95), plan('Up over', 105.1), plan('Down over', 94.9), plan('Up just over', 105.001), plan('Down just over', 94.999), plan('Up rounded over', 105.6), plan('Down rounded over', 94.4)]);
  const boundary = prepareWeekly(boundaryData, { plans: boundaryData.plans.map(p => plan(p.plan, 100)) });
  assert.deepEqual(boundary.moved.map(p => p.plan), expected.get('boundary_moved'));
  assert.deepEqual(boundary.plans.map(p => p.change_vs_last_week_pct), [5,-5,5,-5,5,-5,6,-6]);
  assert.ok(boundary.moved.every(p => Math.abs(p.pct) > 5), 'a displayed 5% is never moved');
  const fractionalData = baseData([plan('Rounded plan', 800)]);
  const fractional = prepareWeekly(fractionalData, { plans: [plan('Rounded plan', 700)] });
  assert.equal(JSON.parse(JSON.stringify(fractional)).plans[0].change_vs_last_week_pct, 14, '700 to 800 publishes whole-number JSON percent');
  assert.deepEqual(fractional.moved, [{ plan: 'Rounded plan', from: 700, to: 800, pct: 14 }]);
  assert.match(allowanceText(fractionalData), /▲14% vs the week before/);
  assert.equal(draw(fractional).sub, '▲ 14% vs last week');

  // --demo must never read or contaminate a real checkpoint store. Exercise
  // both explicit WORTHIT_HOME and its default, always inside this fixture HOME.
  const sentinelStore = path.join(home, '.worthit'), sentinel = openWeekly(sentinelStore);
  saveWeekly(sentinel, { generated_at: '2026-11-07T12:00:00.000Z', week: { to: '2026-11-07' },
    plans: [{ plan: 'Claude Ultra', usd_per_full_week: 100, proof: 'measured' }], safe_to_post: true });
  sentinel.close(); fs.writeFileSync(path.join(sentinelStore, 'last.json'), 'synthetic sentinel: do not change');
  const contents = () => Object.fromEntries(fs.readdirSync(sentinelStore).map(f => [f, fs.readFileSync(path.join(sentinelStore, f))]));
  const beforeDemo = contents();
  for (const explicit of [false, true]) {
    const demoEnv = { ...env }; if (explicit) demoEnv.WORTHIT_HOME = sentinelStore; else delete demoEnv.WORTHIT_HOME;
    const demo = JSON.parse(run(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'weekly', '--demo'], demoEnv));
    assert.equal(demo.compared_with, null, 'demo does not read the sentinel baseline');
    assert.ok(demo.plans.every(p => p.change_vs_last_week_pct === null));
    assert.equal(demo.image, null, 'demo keeps the existing no-files behavior');
    assert.equal(demo.audit_log, null, 'demo reports no audit path');
    assert.deepEqual(contents(), beforeDemo, 'demo leaves every sentinel file byte-for-byte unchanged');
  }
  const absentDemoStore = path.join(tmp, 'absent-demo-store');
  run(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'weekly', '--demo'], { ...env, WORTHIT_HOME: absentDemoStore });
  assert.ok(!fs.existsSync(absentDemoStore), 'demo creates no store at all');

  // Remove every source in the isolated homes: a successful empty scan is no result.
  for (const boxHome of [home, path.join(tmp, 'box-b'), path.join(tmp, 'box-c')]) {
    for (const name of ['.claude', '.codex', '.gemini', '.meter']) fs.rmSync(path.join(boxHome, name), { recursive: true, force: true });
  }
  const empty = weekly('no-data', { status: expected.get('no_data_exit') });
  assert.match(empty.stderr, /no allowance data/);
  assert.ok(!fs.existsSync(path.join(tmp, 'no-data/worthit.db')) || query('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=\'weekly\'', 'no-data')[0].n === 0);
  fs.unlinkSync(path.join(bin, 'python3')); fs.unlinkSync(path.join(bin, 'python'));
  assert.match(weekly('scan-failure', { status: 1 }).stderr, /Python 3 is needed/);
  assert.deepEqual(fs.readdirSync(tmp).filter(f => /\.(png|md|log)$/.test(f)), [], '--no-files writes no presentation files');
  const schema = JSON.parse(run(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'schema']));
  assert.ok(schema.weekly.columns.json && schema['weekly.result'].fields.compared_with && schema['weekly.result'].fields.audit_log);
  assert.match(run(process.execPath, [path.join(root, 'bin/worthit.mjs'), '--skill']), /worthit weekly/);
  assert.ok(trace().every(c => ['ssh', 'headless-chrome'].includes(c.command)), 'weekly runs no git, AI, UI or clipboard commands');
});
