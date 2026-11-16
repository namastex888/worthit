import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const support = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(support, '../..');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export const writeJSON = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
};
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const output = scan => scan.buckets.reduce((sum, row) => sum + (row.output || 0) + (row.lc_output || 0), 0);

// Every subprocess has a bound. No inherited credentials, vendor homes, stores,
// config, cache or command search path; a missing command cannot reach real SSH.
export function sourceRootsHarness(label) {
  const python = spawnSync('/usr/bin/which', ['python3'], { encoding: 'utf8', timeout: 5000 }).stdout.trim();
  assert.ok(path.isAbsolute(python), 'Python 3 executable required');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'source-roots-' + label + '-')));
  const home = path.join(base, 'home'), bin = path.join(base, 'bin'), store = path.join(base, 'store');
  for (const directory of [home, bin, store, path.join(base, 'tmp')]) fs.mkdirSync(directory, { recursive: true });
  for (const [name, target] of Object.entries({ node: process.execPath, python3: python, python, which: '/usr/bin/which' })) fs.symlinkSync(target, path.join(bin, name));
  const trace = path.join(base, 'scanner-trace.jsonl');
  const env = {
    PATH: bin, HOME: home, WORTHIT_HOME: store, TMPDIR: path.join(base, 'tmp'),
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_STATE_HOME: path.join(home, '.local/state'), XDG_DATA_HOME: path.join(home, '.local/share'),
    CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    METER_STATE_DIR: path.join(home, '.meter'), GH_CONFIG_DIR: path.join(home, '.config/gh'),
    PYTHONPATH: path.join(support, 'source-root-python'), PYTHONDONTWRITEBYTECODE: '1',
    NODE_OPTIONS: `--import=${path.join(support, 'clock.mjs')} --import=${path.join(support, 'source-root-node-trace.mjs')}`, TZ: 'UTC', LANG: 'C.UTF-8',
    FIXTURE_NOW: '2026-11-14T12:00:00Z', FIXTURE_MACHINE: 'fixture-reader',
    USAGE_ACCT_SALT: 'synthetic-source-root-fixture', WORTHIT_NO_CACHE: '1',
    SOURCE_ROOT_TRACE: trace, SOURCE_ROOT_BASE: base, SOURCE_ROOT_PYTHON: python,
    SOURCE_ROOT_ACTOR: 'scanner', SOURCE_ROOT_TRANSPORT: 'success',
  };
  const run = (executable, args, options = {}) => {
    const result = spawnSync(executable, args, { cwd: base, env, encoding: 'utf8', timeout: 20000, maxBuffer: 16 << 20, ...options });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'bounded child must finish without a signal');
    return result;
  };
  const ok = (executable, args, options) => {
    const result = run(executable, args, options);
    // Output stays in private evidence, assertion errors use synthetic operation names.
    if (result.status !== 0) {
      fs.writeFileSync(path.join(base, 'failed-child.json'), JSON.stringify(result));
      assert.fail(`${path.basename(executable)} failed with exit ${result.status}; private failed-child.json`);
    }
    return result.stdout;
  };
  const json = (executable, args, options) => JSON.parse(ok(executable, args, options));
  const helper = path.join(support, 'source-root-fixture.py');
  const manifest = json(python, [helper, 'materialize', base], { env: { ...env, SOURCE_ROOT_ACTOR: 'setup' } });
  const acl = [];
  const chmod = (args) => {
    const result = run('/bin/chmod', args);
    assert.equal(result.status, 0, 'private ACL installation/removal unavailable; boundary fixture is blocked');
  };
  const deny = (file, traversal = false) => {
    if (process.platform === 'darwin') chmod(['+a', `everyone deny ${traversal ? 'search' : 'read'}`, file]);
    else { assert.notEqual(process.getuid?.(), 0, 'actual POSIX denial needs a non-root reader'); fs.chmodSync(file, 0); }
    acl.push({ file, mode: traversal ? 0o700 : 0o600 });
  };
  const restore = () => {
    for (const { file, mode } of acl.splice(0).reverse()) {
      if (process.platform === 'darwin') chmod(['-N', file]);
      fs.chmodSync(file, mode);
    }
  };
  const rows = () => fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  const clearTrace = () => fs.writeFileSync(trace, '');
  const scanner = (extra = {}) => json(python, [path.join(repository, 'core/extract_usage.py'), '21'], { env: { ...env, ...extra } });
  const cli = (args, extra = {}) => run(process.execPath, [path.join(repository, 'bin/worthit.mjs'), ...args], { env: { ...env, ...extra } });
  const evaluate = (code, extra = {}) => {
    const result = run(process.execPath, ['--input-type=module', '--eval', code], { env: { ...env, ...extra } });
    if (result.status !== 0) {
      fs.writeFileSync(path.join(base, 'failed-child.json'), JSON.stringify(result));
      assert.fail(`collector failed with exit ${result.status}; private failed-child.json`);
    }
    assert.ok(!result.stdout.includes(manifest.root) && !result.stderr.includes(manifest.root), 'collector stdout/stderr never expose raw root paths');
    return JSON.parse(result.stdout);
  };
  const collect = (hosts = [], extra = {}) => evaluate(`
    import fs from 'node:fs'; import path from 'node:path';
    import {scan, writeAudit} from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/collect.mjs')).href)};
    const progress = [];
    const info = await scan({days:21, hosts:${JSON.stringify(hosts)}, fresh:true}, x => progress.push(x));
    const scans = Object.fromEntries(fs.readdirSync(info.runDir).filter(f=>f.endsWith('.json')).map(f=>[f, JSON.parse(fs.readFileSync(path.join(info.runDir,f),'utf8'))]));
    writeAudit(path.join(process.env.WORTHIT_HOME, 'fixture-audit.log'));
    console.log(JSON.stringify({info,scans,progress}));
  `, extra);
  const build = (extra = {}) => evaluate(`
    import {scan,analyse,buildData} from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/collect.mjs')).href)};
    const cfg={days:21,hosts:[],fresh:true,git:'no',ai:'no'};
    const info=await scan(cfg,()=>{}); const report=await analyse(info.runDir);
    const data=buildData(report,null,cfg,info); console.log(JSON.stringify(data));
  `, extra);
  // Use actual argv/stdin SSH shape, never invoke a shell on supplied remote paths.
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(support, 'source-root-ssh.mjs'))} "$@"\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ssh/config'), 'Host synthetic-remote synthetic-alias\n  HostName fixture.invalid\n');
  const spec = { path: manifest.root, sources: [
    { kind: 'claude', home: 'agents/alpha/.claude' }, { kind: 'codex', home: 'agents/beta/.codex' },
    { kind: 'meter', home: 'meter' },
  ], mappings: [] };
  const seed = (roots = [{ spec }], machine = 'local') => {
    fs.writeFileSync(path.join(store, 'source-roots.key'), Buffer.alloc(32, 37), { mode: 0o600 });
    const records = roots.map((record, index) => ({ key: `synthetic-registration-${index}`, selected: true, revision: 1,
      spec, registered_at: '2026-11-01T00:00:00Z', boundary: null, revisions: [],
      retired_at: null, last_scan_at: null, since: null, ...record }));
    writeJSON(path.join(store, 'source-roots.json'), { version: 1, machines: { [machine]: { roots: records } } });
    return records;
  };
  const rootCoverage = result => Object.values(result.scans).flatMap(scan => scan.source_roots || []);
  const secureBoundary = () => {
    for (const sentinel of manifest.sentinels) if (!acl.some(row => row.file === sentinel.path)) deny(sentinel.path);
    if (!acl.some(row => row.file === manifest.traversal)) deny(manifest.traversal, true);
  };
  const admit = (roots, machine = 'local', hosts = [], beforeRead = () => {}) => {
    secureBoundary();
    seed(roots, machine);
    const preflight = collect(hosts), coverage = rootCoverage(preflight);
    assert.equal(coverage.length, roots.length, 'part C: preflight must disclose every declared root');
    const settings = readJSON(path.join(store, 'source-roots.json'));
    for (const [index, record] of settings.machines[machine].roots.entries()) {
      assert.match(coverage[index].reader_id || '', /^[a-f0-9]{64}$/, 'preflight establishes actual reader identity');
      record.boundary = { status: 'verified', checked_at: env.FIXTURE_NOW, revision: record.revision,
        reader_id: coverage[index].reader_id, proof_sha256: 'a'.repeat(64) };
    }
    writeJSON(path.join(store, 'source-roots.json'), settings);
    beforeRead();
    return collect(hosts);
  };
  const protectedPaths = () => manifest.sentinels.flatMap(row => [row.path, ...row.aliases]);
  const forbidden = records => records.filter(row => row.actor === 'scanner' && protectedPaths().some(file => row.path === file || row.path === 'file:' + file + '?mode=ro'));
  return { base, home, bin, store, python, env, helper, manifest, trace, run, ok, json, cli, evaluate, scanner, collect, build,
    spec, seed, admit, rootCoverage, rows, clearTrace, deny, restore, secureBoundary, protectedPaths, forbidden,
    cleanup() {
      restore();
      // An explicit evidence destination retains synthetic inputs and traces for inspection.
      if (!process.env.SOURCE_ROOT_KEEP) fs.rmSync(base, { recursive: true, force: true });
    },
  };
}
