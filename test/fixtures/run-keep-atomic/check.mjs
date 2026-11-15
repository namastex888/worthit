import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceCase } from '../../support/source-case.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
sourceCase(folder, ({ cli, expected, tmp, env, python, root, run, trace }) => {
  const entry = path.join(root, 'bin/worthit.mjs'), fault = path.join(folder, 'fault.mjs');
  const complete = expected.get('complete'), local = expected.get('local');
  const totals = (data, want, name) => assert.deepEqual({ output_tokens: data.totals.output_tokens, api_value_usd: data.totals.api_value_usd }, want, 'run-keep-atomic / ' + name);
  const scanArgs = ['--json', '--no-files', '--days', '21', '--hosts', 'box-b', '--git', 'no', '--ai', 'no'];
  const invoke = (store, args = scanArgs, overrides = {}) => spawnSync(process.execPath, [entry, ...args], {
    cwd: tmp, env: { ...env, WORTHIT_HOME: store, FIXTURE_ACCOUNTS: '[]', ...overrides },
    input: '', encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20,
  });
  const good = (store, args = scanArgs, overrides = {}) => {
    const r = invoke(store, args, overrides);
    assert.equal(r.status, 0, `run-keep-atomic / ${args.join(' ')}\n${r.stderr}\n${r.stdout}`);
    return JSON.parse(r.stdout);
  };
  const faultEnv = overrides => ({ NODE_OPTIONS: env.NODE_OPTIONS + ' --import=' + fault, ...overrides });
  totals(cli(), complete, 'source baseline');
  const baseline = path.join(tmp, 'store');
  const clone = name => { const store = path.join(tmp, name); fs.cpSync(baseline, store, { recursive: true }); return store; };
  totals(good(clone('local-control'), scanArgs.map(a => a === 'box-b' ? 'none' : a)), local, 'local-only source control');
  const bytes = file => fs.readFileSync(file);
  const age = file => fs.utimesSync(file, new Date('2026-11-14T10:00:00Z'), new Date('2026-11-14T10:00:00Z'));
  const interruptedTemp = (receipt, file, pid) => {
    const { file: temp } = JSON.parse(bytes(receipt));
    assert.equal(path.dirname(temp), path.dirname(file));
    assert.ok(temp.startsWith(file + '.' + pid + '.') && temp.endsWith('.tmp'), 'run-keep-atomic / actual unique temp was created');
    assert.equal(bytes(temp).toString(), '{"interrupted":');
    return temp;
  };
  const unchanged = (file, before, name) => {
    assert.deepEqual(bytes(file), before, 'run-keep-atomic / ' + name);
    assert.ok(JSON.parse(bytes(file)).host, 'run-keep-atomic / saved JSON stays readable');
  };
  const runFolder = store => path.join(store, 'run', fs.readdirSync(path.join(store, 'run'))[0]);

  for (const machine of ['box-b', 'local']) {
    const store = clone('interrupt-' + machine), file = path.join(store, 'run-keep', machine + '.json');
    const before = bytes(file), receipt = path.join(tmp, machine + '-interruption.json');
    const r = invoke(store, scanArgs, faultEnv({ FIXTURE_INTERRUPT_FILE: file, FIXTURE_FAULT_RECEIPT: receipt }));
    assert.equal(r.signal, 'SIGKILL', 'run-keep-atomic / real process interruption after file creation');
    // Keep this assertion first: the plain-copy negative control must name this case.
    unchanged(file, before, `interrupted ${machine === 'local' ? 'local' : 'active'} scan preserves saved bytes`);
    const temp = interruptedTemp(receipt, file, r.pid);
    age(temp); // Only expired scratch is eligible for next-run cleanup.
    const start = trace().length;
    const recovered = good(store, scanArgs, machine === 'local' ? { WORTHIT_REUSE: '1' } : { FIXTURE_OFFLINE: '1' });
    totals(recovered, complete, 'next actual run uses saved ' + machine + ' scan');
    assert.ok(!fs.existsSync(temp), 'run-keep-atomic / next actual run cleans expired interrupted temp');
    if (machine === 'box-b') {
      assert.ok(recovered.machines_missing.some(m => m.machine === 'box-b' && m.saved_scan_at));
      unchanged(file, before, 'offline recovery keeps entire active scan');
      assert.ok(trace().slice(start).some(c => c.command === 'ssh'), 'recovery actually attempts the offline host');
    } else unchanged(path.join(runFolder(store), 'local.json'), before, 'reuse reads complete saved local bytes');
  }

  const hostsStore = clone('interrupt-hosts'), hostsFile = path.join(hostsStore, 'hosts.json');
  fs.writeFileSync(hostsFile, '{"selected":["box-b"],"retired":[]}');
  const hostsBefore = bytes(hostsFile), hostsReceipt = path.join(tmp, 'hosts-interruption.json');
  const hostsWrite = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { writeHosts } from ${JSON.stringify(new URL('../../../src/hosts.mjs', import.meta.url).href)}; writeHosts(process.env.WORTHIT_HOME, { selected: ['box-c'], retired: [] });`], {
    cwd: tmp, env: { ...env, WORTHIT_HOME: hostsStore, ...faultEnv({ FIXTURE_INTERRUPT_FILE: hostsFile, FIXTURE_FAULT_RECEIPT: hostsReceipt }) },
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(hostsWrite.signal, 'SIGKILL', 'run-keep-atomic / interrupt hosts after temp creation');
  assert.deepEqual(bytes(hostsFile), hostsBefore, 'run-keep-atomic / interrupted hosts write preserves state bytes');
  assert.deepEqual(JSON.parse(bytes(hostsFile)), { selected: ['box-b'], retired: [] });
  const hostsTemp = interruptedTemp(hostsReceipt, hostsFile, hostsWrite.pid);
  age(hostsTemp);
  assert.equal(good(hostsStore, ['hosts']).find(h => h.machine === 'box-b').status, 'selected');
  assert.ok(!fs.existsSync(hostsTemp), 'run-keep-atomic / hosts recovery cleans expired interrupted temp');

  run(process.execPath, [path.join(folder, 'interleave.mjs'), 'coordinate', clone('concurrent')]);

  const store = clone('stale'), keep = path.join(store, 'run-keep');
  fs.mkdirSync(path.join(keep, 'retired'), { recursive: true });
  fs.mkdirSync(path.join(keep, 'nested'), { recursive: true });
  const stale = ['local.json.tmp', 'box-b.json.tmp', 'ghost.json.tmp', 'retired/ghost.json.tmp', 'nested/ghost.json.tmp', 'ghost.json.123.fixture.tmp'];
  const seedTemps = () => {
    for (const name of stale) {
      const file = path.join(keep, name);
      fs.writeFileSync(file, '{broken');
      fs.utimesSync(file, new Date('2026-11-14T11:30:00Z'), new Date('2026-11-14T11:30:00Z'));
    }
    fs.writeFileSync(path.join(store, 'hosts.json.tmp'), '{broken');
  };
  seedTemps();
  const inventory = good(store, ['hosts']);
  assert.deepEqual(inventory.map(h => h.machine), ['box-b', 'box-c'], 'run-keep-atomic / inventory ignores temp-only aliases');
  const reused = good(store, scanArgs, { WORTHIT_REUSE: '1' });
  totals(reused, complete, 'reuse ignores stale temps');
  assert.deepEqual(fs.readdirSync(runFolder(store)).sort(), ['box-b.json', 'local.json'], 'run-keep-atomic / reuse never recursively copies temp files or retired folders');
  for (const name of stale) {
    assert.ok(fs.existsSync(path.join(keep, name)), 'run-keep-atomic / fresh temp is preserved and ignored');
    age(path.join(keep, name));
  }
  assert.ok(fs.existsSync(path.join(store, 'hosts.json.tmp')));
  age(path.join(store, 'hosts.json.tmp'));
  totals(good(store, scanArgs, { FIXTURE_OFFLINE: '1' }), complete, 'fresh scan ignores and cleans stale temps');
  for (const name of stale) assert.ok(!fs.existsSync(path.join(keep, name)), 'run-keep-atomic / cleans ' + name);
  assert.ok(!fs.existsSync(path.join(store, 'hosts.json.tmp')));
  seedTemps(); for (const name of stale) age(path.join(keep, name)); age(path.join(store, 'hosts.json.tmp')); good(store, ['hosts']);
  for (const name of stale) assert.ok(!fs.existsSync(path.join(keep, name)), 'run-keep-atomic / hosts also cleans ' + name);
  assert.ok(!fs.existsSync(path.join(store, 'hosts.json.tmp')));

  // Directly exercise both core readers with temp files still present, independently
  // of Node cleanup. Neither reader may parse a malformed .json.tmp as a scan.
  const coreRun = path.join(tmp, 'core-run'), coreKeep = path.join(tmp, 'core-keep');
  fs.mkdirSync(coreRun); fs.mkdirSync(coreKeep);
  fs.copyFileSync(path.join(baseline, 'run-keep/local.json'), path.join(coreRun, 'local.json'));
  for (const dir of [coreRun, coreKeep]) fs.writeFileSync(path.join(dir, 'ghost.json.tmp'), '{broken');
  const tempScan = JSON.parse(bytes(path.join(coreRun, 'local.json')));
  tempScan.host = 'temp-only';
  fs.writeFileSync(path.join(coreKeep, 'valid.json.tmp'), JSON.stringify(tempScan));
  for (const field of ['buckets', 'sessions', 'meters', 'events', 'meter_usage', 'meter_readings']) tempScan[field] = [];
  const tempBytes = JSON.stringify(tempScan);
  fs.writeFileSync(path.join(coreRun, 'valid.json.tmp'), tempBytes);
  assert.deepEqual(JSON.parse(run(python, [path.join(root, 'core/merge_scans.py'), coreRun, coreKeep])), []);
  assert.equal(bytes(path.join(coreRun, 'valid.json.tmp')).toString(), tempBytes, 'run-keep-atomic / Python merge never reads or rewrites temp scans');
  const coreOut = path.join(tmp, 'core-output');
  run(python, [path.join(root, 'core/weekly.py'), coreRun], { ...env, WORTHIT_OUT: coreOut });
  const week = fs.readdirSync(path.join(coreOut, 'weeks')).filter(n => /^\d{4}-/.test(n)).sort().pop();
  const summary = JSON.parse(bytes(path.join(coreOut, 'weeks', week, 'report.json')));
  assert.deepEqual(Object.keys(summary.hosts), ['box-a'], 'run-keep-atomic / Python weekly ignores temp scans');

  // RFC 0002 moves remain byte-preserving renames. A failed hosts replacement
  // rolls the move back in both directions; later scans never rewrite the snapshot.
  const retiredStore = clone('retired'), active = path.join(retiredStore, 'run-keep/box-b.json');
  const frozen = path.join(retiredStore, 'run-keep/retired/box-b.json'), before = bytes(active);
  fs.writeFileSync(path.join(retiredStore, 'hosts.json'), '{"selected":["box-b"],"retired":[]}');
  const state = bytes(path.join(retiredStore, 'hosts.json'));
  const failedRetire = invoke(retiredStore, ['hosts', 'retire', 'box-b'], faultEnv({ FIXTURE_FAIL_HOSTS: '1' }));
  assert.equal(failedRetire.status, 2); assert.match(failedRetire.stderr, /fixture hosts replacement failed/);
  unchanged(active, before, 'failed retirement restores active scan');
  assert.deepEqual(bytes(path.join(retiredStore, 'hosts.json')), state);
  assert.ok(!fs.existsSync(frozen));
  good(retiredStore, ['hosts', 'retire', 'box-b']);
  unchanged(frozen, before, 'retirement preserves frozen bytes');
  const retiredState = bytes(path.join(retiredStore, 'hosts.json'));
  fs.writeFileSync(frozen + '.tmp', '{broken');
  age(frozen + '.tmp');
  totals(good(retiredStore, scanArgs, { WORTHIT_REUSE: '1', FIXTURE_OFFLINE: '1' }), complete, 'actual scan uses frozen saved scan');
  unchanged(frozen, before, 'actual scan never rewrites retired snapshot');
  assert.ok(!fs.existsSync(frozen + '.tmp'));
  const failedUnretire = invoke(retiredStore, ['hosts', 'unretire', 'box-b'], faultEnv({ FIXTURE_FAIL_HOSTS: '1' }));
  assert.equal(failedUnretire.status, 2); assert.match(failedUnretire.stderr, /fixture hosts replacement failed/);
  unchanged(frozen, before, 'failed unretirement restores frozen scan');
  assert.deepEqual(bytes(path.join(retiredStore, 'hosts.json')), retiredState);
  assert.ok(!fs.existsSync(active));
  fs.writeFileSync(active + '.tmp', '{broken');
  fs.writeFileSync(path.join(retiredStore, 'hosts.json.tmp'), '{broken');
  age(active + '.tmp'); age(path.join(retiredStore, 'hosts.json.tmp'));
  good(retiredStore, ['hosts', 'unretire', 'box-b']);
  unchanged(active, before, 'unretirement restores frozen bytes');
  assert.deepEqual(JSON.parse(bytes(path.join(retiredStore, 'hosts.json'))), { selected: ['box-b'], retired: [] });
  assert.ok(!fs.existsSync(active + '.tmp')); assert.ok(!fs.existsSync(path.join(retiredStore, 'hosts.json.tmp')));
});
