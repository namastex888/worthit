// Issue #120: malformed demo must be rejected at startup, before any store access or scan.
import '../../../src/quiet.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { isolatedEnvironment } from '../../support/environment.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(folder, '../../..');
const isolated = isolatedEnvironment(), { tmp, env } = isolated;
env.XDG_CACHE_HOME = path.join(env.HOME, '.cache');
env.npm_config_cache = path.join(env.XDG_CACHE_HOME, 'npm');
const diagnostic = 'worthit: --demo takes no value: use `--demo`.\n';
const dayDiagnostic = command => `worthit: --demo is not supported for ${command}: the bundled sample has no query tables. Use \`worthit get <section> --demo\`.\n`;
const historical = process.env.FIXTURE_EXPECT_HISTORICAL_FAILURES === '1';
const artifacts = process.env.WORTHIT_FIXTURE_ARTIFACTS;
let failed = 0, ran = 0;
const scrub = text => String(text).split(tmp).join('<sandbox>').split(root).join('<source>');
function evidence(name, value) {
  if (!artifacts) return;
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, name + '.json'), scrub(JSON.stringify(value, null, 2)) + '\n');
}
function invoke(name, args, store, policy = 'deny', script) {
  const trace = path.join(tmp, name + '.jsonl');
  const r = spawnSync(process.execPath, script ? ['--input-type=module', '-e', script] : [path.join(root, 'bin/worthit.mjs'), ...args], {
    cwd: tmp, env: { ...env, WORTHIT_HOME: store, FIXTURE_ACCESS_TRACE: trace, FIXTURE_ACCESS_POLICY: policy,
      NODE_OPTIONS: `--import=${path.join(root, 'test/support/clock.mjs')} --import=${path.join(folder, 'guard.mjs')}` },
    encoding: 'utf8', timeout: 15000, maxBuffer: 4 << 20,
  });
  const events = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  evidence(name, { args, policy, status: r.status, signal: r.signal, error: r.error?.message, stdout: r.stdout, stderr: r.stderr, events });
  // A missing dependency, timeout or absent preload is setup failure, never historical RED proof.
  assert.ifError(r.error);
  assert.equal(r.signal, null, name + ': child signal');
  assert.equal(events.filter(e => e.kind === 'ready').length, 1, name + ': guard loaded exactly once');
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)/, name + ': dependencies missing');
  return { ...r, events };
}
function check(name, r, assertions) {
  ran++;
  const errors = [];
  for (const [label, assertion] of assertions) try { assertion(); } catch (error) { errors.push(label + ': ' + scrub(error.message)); }
  evidence(name + '-assertions', { errors });
  if (errors.length) {
    failed++;
    console.error(`demo-startup: FAIL ${name} ${JSON.stringify({ status: r.status, stdout: scrub(r.stdout), stderr: scrub(r.stderr), events: r.events, errors })}`);
    process.exitCode = 1;
    return historical;
  }
  console.log('demo-startup: PASS ' + name);
  return true;
}
const isolatedAssertions = r => [
  ['no store/home access', () => assert.deepEqual(r.events.filter(e => e.kind === 'fs'), [])],
  ['no scan or other subprocess', () => assert.deepEqual(r.events.filter(e => e.kind === 'subprocess'), [])],
];
async function main() {
  const stores = Object.fromEntries(['valid', 'missing', 'corrupt', 'unreadable'].map(name => [name, path.join(tmp, name)]));
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'src/demo-data.json'), 'utf8'));
  saved.generated_at = '2001-02-03T00:00:00.000Z';
  saved.sentinel = 'SYNTHETIC-SAVED-RUN';
  saved.plans[0].plan = 'SYNTHETIC-SAVED-PLAN';
  saved.plans[0].usd_per_full_week = 987654321;
  for (const name of ['valid', 'corrupt', 'unreadable']) {
    fs.mkdirSync(stores[name]);
    fs.writeFileSync(path.join(stores[name], 'hosts.json'), name === 'valid' ? '{"selected":[],"retired":[]}' : '{invalid synthetic hosts');
    fs.writeFileSync(path.join(stores[name], 'last.json'), name === 'valid' ? JSON.stringify(saved) : '{invalid synthetic last');
    fs.writeFileSync(path.join(stores[name], 'worthit.db'), 'invalid synthetic sqlite');
  }
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  fs.unlinkSync(path.join(stores.valid, 'worthit.db'));
  const db = new DatabaseSync(path.join(stores.valid, 'worthit.db'));
  db.exec("CREATE TABLE secret(value TEXT); INSERT INTO secret VALUES('SYNTHETIC-SAVED-SQL');");
  db.close();
  for (const file of fs.readdirSync(stores.unreadable)) fs.chmodSync(path.join(stores.unreadable, file), 0);

  // Prove denial across default/named sync, callback, promise, stream, SQLite and process APIs.
  // All probes are caught deliberately; the trace must still retain every attempted access.
  const probes = [
    ['readFileSync', "fs.readFileSync(file)"], ['openSync', "namedOpen(file, 'r')"],
    ['writeFileSync', "fs.writeFileSync(file, 'x')"], ['appendFileSync', "fs.appendFileSync(file, 'x')"],
    ['existsSync', 'fs.existsSync(file)'], ['statSync', 'fs.statSync(file)'],
    ['accessSync', 'fs.accessSync(file)'], ['readdirSync', 'fs.readdirSync(store)'],
    ['createReadStream', 'fs.createReadStream(file)'], ['createWriteStream', 'fs.createWriteStream(file)'],
    ['copyFileSync', "fs.copyFileSync(outside, file)"], ['renameSync', 'fs.renameSync(outside, file)'],
    ['readFile', 'fs.readFile(file, () => {})'], ['open', "fs.open(file, 'r', () => {})"],
    ['writeFile', "fs.writeFile(file, 'x', () => {})"], ['copyFile', 'fs.copyFile(outside, file, () => {})'],
    ['promises.readFile', 'await readFile(new URL("file://" + file))'],
    ['promises.open', "await fs.promises.open(file, 'r')"],
    ['promises.writeFile', "await fs.promises.writeFile(Buffer.from(file), 'x')"],
    ['promises.copyFile', 'await fs.promises.copyFile(outside, file)'],
    ['promises.rename', 'await fs.promises.rename(outside, file)'],
    ['DatabaseSync', 'new DatabaseSync(file)'],
    ...['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map(name => [name, `cp.${name}('fixture-scan-must-never-run')`]),
  ];
  const sanityScript = `import fs, { openSync as namedOpen } from 'node:fs';
    import { readFile } from 'node:fs/promises'; import cp from 'node:child_process';
    import { createRequire } from 'node:module'; const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const store = process.env.WORTHIT_HOME, file = store + '/hosts.json', outside = 'outside';
    ${probes.map(([, expression]) => `try { ${expression}; throw new Error('guard missed a probe'); } catch(e) { if(e.code !== 'FIXTURE_ACCESS_DENIED') throw e; }`).join('\n')}
    console.log('guard sanity complete');`;
  const sanity = invoke('guard-sanity', [], stores.valid, 'deny', sanityScript);
  assert.equal(sanity.status, 0, sanity.stderr);
  assert.equal(sanity.stdout, 'guard sanity complete\n');
  assert.deepEqual(sanity.events.filter(e => e.kind !== 'ready').map(e => e.operation), probes.map(([name]) => name));
  const readOnly = invoke('guard-read-only-sanity', [], stores.valid, 'read-only', `
    import fs from 'node:fs';
    fs.readFileSync(process.env.WORTHIT_HOME + '/hosts.json');
    for (const file of [process.env.WORTHIT_HOME + '/hosts.json', 'must-not-be-written']) {
      try { fs.writeFileSync(file, 'x'); throw new Error('guard missed a write'); }
      catch(e) { if(e.code !== 'FIXTURE_ACCESS_DENIED') throw e; }
    }
    console.log('read-only guard sanity complete');`);
  assert.equal(readOnly.status, 0, readOnly.stderr);
  assert.equal(readOnly.stdout, 'read-only guard sanity complete\n');
  assert.equal(readOnly.events.filter(e => e.write).length, 2);
  assert.ok(readOnly.events.some(e => e.kind === 'fs' && !e.write));
  console.log('demo-startup: SETUP PASS deterministic access/subprocess guard sanity');

  const malformed = [
    ['get-plans', ['get', 'plans', '--demo=1']],
    ['get-true', ['get', '--demo=true', 'plans.0.usd_per_full_week']],
    ['get-middle', ['get', '--demo=1', 'plans']],
    ['get-leading', ['--demo=1', 'get', 'plans']],
    ['days', ['days', '--demo=1']], ['days-leading', ['--demo=1', 'days']],
    ['sql', ['sql', 'SELECT value FROM secret', '--demo=1']],
    ['sql-middle', ['sql', '--demo=1', 'SELECT 1']], ['sql-leading', ['--demo=1', 'sql', 'SELECT 1']],
    ['json', ['--json', '--demo=1', '--git', 'no', '--ai', 'no', '--hosts', 'none', '--days', '1', '--no-files']],
    ['json-leading', ['--demo=1', '--json', '--git', 'no', '--ai', 'no', '--hosts', 'none', '--days', '1', '--no-files']],
    ['share', ['share', 'allowance', '--demo=1', '--no-files']],
    ['share-middle', ['share', '--demo=1', 'allowance', '--no-files']],
    ['share-leading', ['--demo=1', 'share', 'allowance', '--no-files']],
    ['empty-value', ['get', 'plans', '--demo=']], ['both-flags', ['get', 'plans', '--demo', '--demo=1']],
    ...['hosts', 'schema', 'projects', 'weekly', 'install-skill', '--help', '--version', 'unknown-command']
      .map(command => [command.replace(/^--/, ''), [command, '--demo=1']]),
  ];
  for (const [state, store] of Object.entries(stores)) for (const [label, args] of malformed) {
    const name = state + '-' + label, r = invoke(name, args, store);
    if (!check(name, r, [
      ...isolatedAssertions(r),
      ['exit 2', () => assert.equal(r.status, 2)], ['empty stdout', () => assert.equal(r.stdout, '')],
      ['exact one-line production diagnostic', () => assert.equal(r.stderr, diagnostic)],
      ['no executable discovery before rejection', () => assert.deepEqual(r.events.filter(e => e.kind === 'probe'), [])],
    ])) return;
  }
  // Allow synthetic reads here so historical share also reproduces the saved-run disclosure.
  const shareArgs = ['share', 'allowance', '--demo=1', '--no-files'];
  const share = invoke('saved-share-sentinel', shareArgs, stores.valid, 'observe');
  if (!check('saved-share-sentinel', share, [
    ...isolatedAssertions(share), ['exit 2', () => assert.equal(share.status, 2)],
    ['exact diagnostic', () => assert.equal(share.stderr, diagnostic)],
    ['empty stdout/no saved-run sentinel', () => { assert.equal(share.stdout, ''); assert.doesNotMatch(share.stdout, /SYNTHETIC-SAVED|2001-02-03|987654321/); }],
  ])) return;

  // Exact lookups remain inaccessible; exact share permits traced reads but never writes.
  for (const [state, store] of Object.entries(stores)) for (const [label, args, command] of [
    ['get', ['get', 'plans', '--demo']], ['get-middle', ['get', '--demo', 'plans']],
    ['get-leading', ['--demo', 'get', 'plans']], ['days', ['days', '--demo'], 'days'],
    ['days-leading', ['--demo', 'days'], 'days'], ['sql', ['sql', 'SELECT 1', '--demo'], 'sql'],
    ['sql-leading', ['--demo', 'sql', 'SELECT 1'], 'sql'], ['json', ['--json', '--demo']],
    ['projects', ['projects', '--demo']],
    ['share', ['share', 'allowance', '--demo', '--no-files']],
  ]) {
    const name = state + '-exact-' + label, exactShare = label === 'share';
    const r = invoke(name, args, store, exactShare ? 'read-only' : 'deny');
    if (exactShare) {
      const reads = r.events.filter(e => e.kind === 'fs' && !e.write);
      evidence(name + '-read-observations', { reads });
      console.log('demo-startup: NOTE ' + name + ' read observations ' + JSON.stringify(reads));
    }
    if (!check(name, r, [...(exactShare ? [
      ['nothing written', () => assert.deepEqual(r.events.filter(e => e.write), [])],
      ['no subprocess', () => assert.deepEqual(r.events.filter(e => e.kind === 'subprocess'), [])],
    ] : isolatedAssertions(r)),
      ['exact demo result', () => {
        assert.equal(r.status, command ? 2 : 0);
        assert.equal(r.stderr, command ? dayDiagnostic(command) : '');
        assert.doesNotMatch(r.stdout, /SYNTHETIC-SAVED|2001-02-03|987654321/);
        if (command) { assert.equal(r.stdout, ''); return; }
        const data = JSON.parse(r.stdout);
        if (label === 'share') { assert.equal(data.topic, 'allowance'); assert.equal(data.image, null); assert.notEqual(data.data_generated_at, saved.generated_at); }
        // A historical unknown-projects diagnostic is a named case failure here, never setup failure.
        else if (label === 'projects') { assert.ok(Array.isArray(data.rows) && data.rows.length > 0); assert.notEqual(data.generated_at, saved.generated_at); }
        else { assert.equal(data.plans.length, saved.plans.length); assert.notEqual(data.plans[0].plan, saved.plans[0].plan); }
      }],
    ])) return;
  }
  // Positive controls prove the CLI really reads the selected synthetic store without demo.
  for (const [label, args, expected] of [
    ['get', ['get', 'sentinel'], { generated_at: saved.generated_at, sentinel: 'SYNTHETIC-SAVED-RUN' }],
    ['sql', ['sql', 'SELECT value FROM secret'], [{ value: 'SYNTHETIC-SAVED-SQL' }]],
  ]) {
    const name = 'non-demo-' + label, r = invoke(name, args, stores.valid, 'observe');
    if (!check(name, r, [
      ['real CLI control', () => { assert.equal(r.status, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout), expected); }],
      ['store access observed', () => assert.ok(r.events.some(e => e.kind === 'fs' && e.scope === 'store'))],
      ['no subprocess', () => assert.deepEqual(r.events.filter(e => e.kind === 'subprocess'), [])],
    ])) return;
  }
  const missing = invoke('non-demo-missing', ['get', 'plans'], stores.missing, 'observe');
  check('non-demo-missing', missing, [
    ['missing store control', () => { assert.equal(missing.status, 2); assert.equal(missing.stdout, ''); assert.match(missing.stderr, /no saved run yet/); }],
    ['missing store access observed', () => assert.ok(missing.events.some(e => e.kind === 'fs' && e.scope === 'store'))],
    ['no subprocess', () => assert.deepEqual(missing.events.filter(e => e.kind === 'subprocess'), [])],
  ]);
}
try { await main(); }
catch (error) { console.error('demo-startup: SETUP FAIL ' + scrub(error.stack)); process.exitCode = 2; }
finally {
  evidence('summary', { ran, failed, exit: process.exitCode || 0, historical });
  // Restore synthetic permissions for deterministic cleanup on non-root accounts too.
  const unreadable = path.join(tmp, 'unreadable');
  if (fs.existsSync(unreadable)) for (const file of fs.readdirSync(unreadable)) fs.chmodSync(path.join(unreadable, file), 0o600);
  isolated.cleanup();
}
console.log(`demo-startup: ${ran} cases, ${failed} failed${historical ? ' (historical assertions; failures remain exit 1)' : ''}`);
