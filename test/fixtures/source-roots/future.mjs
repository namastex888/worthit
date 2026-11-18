// Executable contracts for #144 (B) and #145 (C). Nothing here runs implicitly.
// A pending line means NOT VERIFIED. --future[=id] executes assertions unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository, readJSON, writeJSON, output } from '../../support/source-roots.mjs';
import { withWal } from '../../support/source-root-wal.mjs';

export const future = [];
const add = (id, owner, reference, assertion, run) => future.push({ id, owner, reference, assertion, run });
const C = '#145 part C', B = '#144 part B';
const declared = h => [{ spec: h.spec }];
const scanOf = result => result.scans['local.json'];
const coverage = (h, result) => {
  const roots = h.rootCoverage(result);
  assert.ok(roots.length, 'declared roots must have coverage; absent is unknown, never a passing empty set');
  return roots;
};
const command = (h, args, status = 0, pattern) => {
  const result = h.cli(['hosts', 'roots', ...args]);
  assert.equal(result.status, status, `part B command ${args[0]}: expected exit ${status}, got ${result.status}`);
  if (pattern) assert.match(result.stderr + result.stdout, pattern);
  assert.ok(!result.stdout.includes(h.manifest.root) && !result.stderr.includes(h.manifest.root), 'commands never echo private paths');
  return result.stdout ? JSON.parse(result.stdout) : null;
};
const specFile = (h, spec = h.spec) => { const file = path.join(h.base, 'spec.json'); writeJSON(file, spec); return file; };
const register = h => {
  command(h, ['add', 'local', '--file', specFile(h)]);
  const settings = readJSON(path.join(h.store, 'source-roots.json'));
  assert.equal(settings.version, 1);
  return settings.machines.local.roots[0];
};
const listedId = h => {
  const records = command(h, ['local']);
  assert.ok(Array.isArray(records) && records.length === 1, 'listing returns all root records');
  assert.match(records[0].id, /^[a-f0-9]{64}$/);
  return records[0].id;
};

add('registration-preflight-unread', B, '#144 acceptance 2/3; §2/6', 'a declared unverified root is shown unread, contributes nothing, and is never silently ignored', h => {
  register(h); h.clearTrace(); const result = h.collect(), root = coverage(h, result)[0];
  assert.equal(root.status, 'unreadable'); assert.equal(root.boundary, 'unverified');
  assert.ok(root.reasons.includes('boundary_unverified'));
  assert.match(root.reader_id, /^[a-f0-9]{64}$/);
  assert.equal(output(scanOf(result)), 10);
  assert.equal(h.rows().filter(row => row.actor === 'scanner' && row.op === 'open' && row.path.startsWith(h.manifest.root)).length, 0);
});
add('registration-machine-floor-and-guard', B, '#144 acceptance 3; §6/7', 'pre-reader registration floors the machine and withholds plain/weekly comparisons', h => {
  register(h); const collected = h.collect(), roots = coverage(h, collected);
  const result = weeklyGuard(h, roots, []);
  assert.equal(result.safe_to_post, false); assert.equal(result.plans[0].proof, 'floor');
  assert.equal(result.plans[0].change_vs_last_week_pct, null); assert.ok(result.plans[0].not_compared.includes('roots_changed'));
  assert.deepEqual(result.moved, []);
  const plain = h.evaluate(`
    import {buildData} from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/collect.mjs')).href)};
    const report={activity:[],this_week:{claude:{usd_per_full_week:20,meter_start_pct:0,meter_end_pct:100,hours:1,measured:{api_usd:20,output_tokens:10,cached_input_tokens:0,model_mix_by_usd:{}}}},prices:{plan_usd_per_week:{claude:5}},hosts:{'fixture-reader':{}},claude_stints:[],codex_weeks:[],google_weeks:[]};
    console.log(JSON.stringify(buildData(report,null,{days:21,hosts:[]},{...${JSON.stringify(collected.info)},hosts:[{alias:'synthetic-remote',ok:true}],source_roots:${JSON.stringify(roots)}})));
  `);
  assert.ok(plain.plans.length); assert.ok(plain.plans.every(plan => plan.proof === 'floor' && plan.change_vs_last_week_pct === null));
  assert.ok(plain.plans.every(plan => plan.not_compared.includes('roots_changed')));
});

add('commands-add-list', B, '§1; §8 1a declaration', 'add is selected, stable, private and does not scan/connect', h => {
  const record = register(h);
  assert.equal(record.selected, true); assert.equal(record.revision, 1);
  assert.equal(record.boundary, null); assert.equal(record.retired_at, null);
  assert.ok(Number.isFinite(Date.parse(record.registered_at)));
  const id = listedId(h); assert.equal(listedId(h), id);
  assert.equal(fs.statSync(path.join(h.store, 'source-roots.key')).mode & 0o077, 0);
  assert.equal(fs.statSync(path.join(h.store, 'source-roots.json')).mode & 0o077, 0);
  assert.ok(!fs.existsSync(path.join(h.base, 'transport.jsonl')));
  assert.equal(h.rows().filter(r => r.actor === 'scanner' && r.path.startsWith(h.manifest.root)).length, 0);
});
add('commands-selection', B, '§1; §8 1a', 'selection preserves registration and revisions; no deletion-as-retirement', h => {
  const before = register(h), id = listedId(h);
  command(h, ['select', 'local', id, 'off']);
  let record = readJSON(path.join(h.store, 'source-roots.json')).machines.local.roots[0];
  assert.equal(record.selected, false); assert.equal(record.key, before.key); assert.ok(record.revision > before.revision);
  assert.equal(record.retired_at, null);
  command(h, ['select', 'local', id, 'on']);
  record = readJSON(path.join(h.store, 'source-roots.json')).machines.local.roots[0]; assert.equal(record.selected, true);
});
add('commands-boundary', B, '§2; §8 OS boundary', 'strict boundary attestation is stored without advancing the revision', h => {
  const record = register(h), id = listedId(h), file = path.join(h.base, 'proof.json');
  const proof = { status: 'verified', checked_at: h.env.FIXTURE_NOW, revision: record.revision, reader_id: 'b'.repeat(64), proof_sha256: 'c'.repeat(64) };
  writeJSON(file, proof); command(h, ['boundary', 'local', id, '--file', file]);
  const after = readJSON(path.join(h.store, 'source-roots.json')).machines.local.roots[0];
  assert.equal(after.revision, record.revision); assert.deepEqual(after.boundary, proof);
  writeJSON(file, { ...proof, raw_path: h.manifest.root }); command(h, ['boundary', 'local', id, '--file', file], 2);
});
for (const [name, modify] of [
  ['antigravity', spec => ({ ...spec, sources: [{ kind: 'antigravity', home: '.gemini/antigravity' }] })],
  ['account', spec => ({ ...spec, sources: [{ kind: 'claude', home: 'agents/alpha/.claude', account: 'derived/account.json' }] })],
  ['model', spec => ({ ...spec, sources: [{ kind: 'antigravity', home: '.gemini/antigravity', model: 'derived/model.json' }] })],
  ['mappings', spec => ({ ...spec, mappings: [{ from: '/synthetic-container', to: 'repositories/example' }] })],
]) add('unsupported-' + name, B, '§8 unsupported 1a settings', `${name} is rejected explicitly, never ignored`, h => {
  command(h, ['add', 'local', '--file', specFile(h, modify(h.spec))], 2, /unsupported/i);
});
for (const name of ['duplicate-keys', 'unknown-key', 'traversal', 'relative-root', 'duplicate-binding']) {
  add('invalid-' + name, B, '§1 strict settings', 'invalid settings abort without destroying a prior valid registration', h => {
    register(h); const file = specFile(h), saved = fs.readFileSync(path.join(h.store, 'source-roots.json'));
    if (name === 'duplicate-keys') fs.writeFileSync(file, '{"path":"/synthetic-a","path":"/synthetic-b","sources":[]}');
    else {
      const spec = structuredClone(h.spec);
      if (name === 'unknown-key') spec.extra = true;
      if (name === 'traversal') spec.sources[0].home = '../outside';
      if (name === 'relative-root') spec.path = 'relative';
      if (name === 'duplicate-binding') spec.sources.push(spec.sources[0]);
      writeJSON(file, spec);
    }
    command(h, ['add', 'local', '--file', file], 2);
    assert.deepEqual(fs.readFileSync(path.join(h.store, 'source-roots.json')), saved);
  });
}
add('empty-retirement', B, '§1/7; §8 1a empty retire', 'never-answered root freezes an empty attested envelope; boundary rejects retirement', h => {
  const record = register(h), id = listedId(h);
  command(h, ['retire', 'local', id]);
  const frozen = readJSON(path.join(h.store, 'run-keep/roots/retired', id + '.json'));
  assert.equal(frozen.no_saved_scan, true); assert.equal(frozen.last_scan_at, null);
  assert.equal(frozen.since, record.registered_at); assert.deepEqual(frozen.source_ids, []);
  for (const field of ['buckets', 'meters', 'events', 'meter_readings', 'meter_usage', 'sessions']) assert.deepEqual(frozen[field], []);
  assert.equal(frozen.version, 1);
  const file = path.join(h.base, 'proof.json'); writeJSON(file, {});
  command(h, ['boundary', 'local', id, '--file', file], 2);
});
for (const [name, date] of [['before-registration', '2026-10-01'], ['future', '2099-01-01']]) {
  add('empty-retire-' + name, B, '§7 date bounds', 'empty retirement refuses dates outside registration and now', h => {
    register(h); command(h, ['retire', 'local', listedId(h), '--since', date], 2);
  });
}
for (const action of ['update', 'unretire']) add('unsupported-' + action, B, '§1/8 1a lifecycle', `${action} waits for 1b with a clear unsupported error`, h => {
  register(h); command(h, [action, 'local', listedId(h), ...(action === 'update' ? ['--file', specFile(h)] : [])], 2, /unsupported/i);
});
add('answered-retire-rejected', B, '§7/8 1a lifecycle', 'a read or partial answer cannot retire until 1b', h => {
  // Import synthetic prior-answer evidence without calling C's root reader.
  // A lost usage file would still not turn this registration into never-answered.
  register(h); const id = listedId(h), stamp = '2026-11-13T12:00:00Z';
  const settings = readJSON(path.join(h.store, 'source-roots.json'));
  settings.machines.local.roots[0].last_scan_at = stamp;
  writeJSON(path.join(h.store, 'source-roots.json'), settings);
  const source_ids = [{ file_id: 'd'.repeat(64), path_id: 'e'.repeat(64) }];
  const sourceRoot = { id, status: 'read', lifecycle: 'active', selected: true, revision: 1,
    registered_at: settings.machines.local.roots[0].registered_at, last_scan_at: stamp,
    machine_id: 'f'.repeat(64), reader_id: 'b'.repeat(64), canonical_id: 'c'.repeat(64),
    attempted_at: stamp, retired_at: null, reasons: [], boundary: 'verified', sources: [], retained: [],
    window: { from: '2026-11-01T00:00:00Z', to: stamp, complete: true },
    attribution: { account_complete: false, model_complete: true, unattributed_rows: 1,
      unattributed_output_tokens: 100, unattributed_api_value_usd: 0.0015, model_unknown_rows: 0, unpriced_rows: 0 } };
  writeJSON(path.join(h.store, 'run-keep/roots', id + '.json'), { version: 1, source_roots: [sourceRoot], source_ids,
    generated_at: stamp, registered_at: sourceRoot.registered_at, last_scan_at: stamp, no_saved_scan: false });
  writeJSON(path.join(h.store, 'run-keep/local.json'), { host: 'fixture-reader', generated_at: stamp,
    since: '2026-11-01T00:00:00Z', days: 21, errors: [], stats: { claude_messages: 1 }, accounts: {},
    source_roots: [sourceRoot], source_ownership: [{ collection: 'buckets', row: 0, source_ids }],
    buckets: [{ provider: 'claude', session: 'synthetic-owned-root', hour: '2026-11-13T12', model: 'claude-sonnet-5-5',
      account: 'unattributed', login: 'unattributed', input_uncached: 10, cache_read: 0, cache_write: 0, output: 100, requests: 1 }],
    meters: [], events: [], sessions: [], meter_usage: [], meter_readings: [], meter_fields: [] });
  command(h, ['retire', 'local', id], 2, /unsupported/i);
});

add('nested-bindings', C, '§2/8 first 1a bullet', 'explicit nested and archived Claude/Codex bindings retain usage once', h => {
  const result = h.admit(declared(h)), scan = scanOf(result);
  assert.equal(output(scan), 210); // default 10 + root Claude 120 + Codex 80
  assert.equal(scan.meter_usage.reduce((n, row) => n + row[7], 0), 30);
  assert.equal(coverage(h, result)[0].status, 'read');
});
add('default-root-overlap', C, '§2/4/8 first bullet', 'the stricter root policy wins for overlapping default files', h => {
  const alias = path.join(h.home, '.claude/projects/root-link.jsonl'); fs.symlinkSync(h.manifest.native, alias);
  const result = h.admit(declared(h)); assert.equal(output(scanOf(result)), 210);
  assert.equal(h.forbidden(h.rows()).length, 0);
});
add('symlinked-root', C, '§4/8 first bullet', 'canonical root aliases have coverage and one contribution', h => {
  const alias = path.join(h.base, 'volume-alias'); fs.symlinkSync(h.manifest.root, alias);
  const result = h.admit([{ spec: h.spec }, { spec: { ...h.spec, path: alias } }]);
  assert.equal(output(scanOf(result)), 210);
  assert.equal(coverage(h, result).length, 2);
  assert.ok(coverage(h, result).every(row => row.status === 'read'));
  assert.equal(new Set(coverage(h, result).map(row => row.canonical_id)).size, 1);
});
for (const kind of ['claude', 'codex', 'meter']) add('per-file-links-' + kind, C, '§4/8 two symlinks and hardlinks to each file/meter path', 'all aliases get coverage; physical sources and meter events contribute once', h => {
  const spec = structuredClone(h.spec);
  if (kind === 'meter') for (const home of ['meter-symlink-one', 'meter-symlink-two', 'meter-hardlink-one', 'meter-hardlink-two']) spec.sources.push({ kind: 'meter', home });
  const result = h.admit([{ spec }]), scan = scanOf(result), root = coverage(h, result)[0];
  assert.equal(output(scan), 210); assert.equal(scan.meter_usage.reduce((n, row) => n + row[7], 0), 30);
  assert.equal(scan.meter_readings.length, 1);
  assert.ok(root.sources.every(source => source.status === 'read'));
  const pairs = root.sources.flatMap(source => source.source_ids);
  assert.ok(pairs.length > 0); assert.ok(pairs.every(pair => /^[a-f0-9]{64}$/.test(pair.file_id) && /^[a-f0-9]{64}$/.test(pair.path_id)));
  const ownership = scan.source_ownership;
  assert.ok(Array.isArray(ownership) && ownership.length);
  for (const entry of ownership) {
    assert.ok(['buckets', 'meters', 'events', 'meter_readings', 'meter_usage', 'sessions'].includes(entry.collection));
    assert.ok(scan[entry.collection][entry.row]); assert.ok(entry.source_ids.length);
  }
  if (kind !== 'meter') assert.ok(new Set(pairs.map(pair => pair.path_id)).size > new Set(pairs.map(pair => pair.file_id)).size, 'hardlink realpaths share physical file hashes');
});
add('meter-colliding-ids', C, '§4/8 distinct meter DBs', 'distinct DBs with equal row ids both contribute; aliases do not', h => {
  const spec = { ...h.spec, sources: [...h.spec.sources, { kind: 'meter', home: 'other-meter' }] };
  for (const source of ['meter', 'other-meter']) for (const suffix of ['symlink-one', 'symlink-two', 'hardlink-one', 'hardlink-two']) {
    spec.sources.push({ kind: 'meter', home: source + '-' + suffix });
  }
  const result = h.admit([{ spec }]), scan = scanOf(result);
  assert.equal(scan.meter_usage.reduce((n, row) => n + row[7], 0), 100);
  assert.equal(scan.meter_usage.filter(row => row[0] === 'colliding-row').length, 2);
});
for (const kind of ['escape', 'loop', 'retarget']) add('link-' + kind, C, '§2/4/8 link escape/loop/retarget', 'unsafe links fail closed without a secret read or complete coverage claim', h => {
  // Each scan sees one fault; retarget changes across scans, retaining registration.
  const directory = path.dirname(h.manifest.native);
  const fault = path.join(directory, kind + '.jsonl');
  fs.symlinkSync(kind === 'loop' ? 'loop.jsonl' : kind === 'escape' ? h.protectedPaths()[0] : h.manifest.native, fault);
  const result = h.admit(declared(h)), root = coverage(h, result)[0];
  if (kind === 'retarget') {
    const link = path.join(directory, 'retarget.jsonl'); fs.unlinkSync(link); fs.symlinkSync(h.protectedPaths()[0], link);
    const changed = h.collect();
    assert.ok(coverage(h, changed)[0].reasons.some(reason => ['link_changed', 'link_outside'].includes(reason)));
    assert.notEqual(coverage(h, changed)[0].status, 'read');
  } else { assert.notEqual(root.status, 'read'); assert.ok(root.reasons.some(reason => ['link_outside', 'link_changed', 'io_error'].includes(reason))); }
  assert.equal(h.forbidden(h.rows()).length, 0);
});
add('unknown-account-cap-match-host', C, '§3/8 single-login cap_match_host', 'root usage remains unattributed despite one host login and a matching cap', h => {
  const usage = JSON.parse(fs.readFileSync(h.manifest.native, 'utf8')); usage.message.usage.output_tokens = 1000000;
  const reset = 1794657600;
  const cap = { timestamp: '2026-11-13T12:10:00Z', sessionId: 'root-cap', uuid: 'synthetic-root-cap',
    apiError: 'rate_limit', apiErrorParams: { rate_limit_info: { rateLimitType: 'seven_day', resetsAt: reset } } };
  fs.writeFileSync(h.manifest.native, JSON.stringify(usage) + '\n' + JSON.stringify(cap) + '\n');
  const result = h.admit([{ spec: { ...h.spec, sources: h.spec.sources.filter(source => source.kind === 'claude') } }]), root = coverage(h, result)[0];
  assert.equal(root.attribution.account_complete, false); assert.ok(root.attribution.unattributed_rows > 0);
  const scan = scanOf(result);
  const meterHost = { ...structuredClone(scan), host: 'synthetic-meter-host', buckets: [], events: [], sessions: [], meter_usage: [], meters: [],
    source_roots: [], source_ownership: [], meter_readings: [] };
  for (const [stamp, pct, session] of [
    ['03:00', 0, 'meter-a'], ['03:01', 0, 'meter-b'], ['03:02', 0, 'meter-c'],
    ['06:00', 25, 'meter-a'], ['09:00', 50, 'meter-b'], ['12:00', 100, 'meter-c'],
  ]) meterHost.meter_readings.push(['2026-11-13T' + stamp + ':00Z', session, 'synthetic-meter-account', 'claude-sonnet-5-5', pct, reset, 0, reset]);
  writeJSON(path.join(result.info.runDir, 'synthetic-meter-host.json'), meterHost);
  const code = `import {analyse} from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/collect.mjs')).href)};
    const raw=await analyse(${JSON.stringify(result.info.runDir)}); console.log(JSON.stringify(raw));`;
  const priced = h.evaluate(code);
  assert.ok(priced.claude_stints.length, 'positive cap/meter control establishes an actual valid stint');
  assert.ok(priced.claude_stints.every(stint => stint.measured.output_tokens < 1000000), 'cap_match_host must never assign the unknown root million-token row');
  assert.ok(root.attribution.unattributed_output_tokens >= 1000020);
});
add('unmapped-host-cwd-and-poison-cache', C, '§5/8 matching host cwd and folder_project cache', 'unmapped container cwd never probes the host path or consumes its cache', h => {
  delete h.env.WORTHIT_NO_CACHE;
  const result = h.admit(declared(h)), scan = scanOf(result);
  const rooted = scan.buckets.filter(row => row.session !== 'default-native');
  assert.ok(rooted.length); assert.ok(rooted.every(row => row.project === null));
  assert.ok(rooted.every(row => row.project_why === 'folder_gone'));
  assert.equal(h.rows().filter(row => row.actor === 'scanner' && row.path.startsWith(h.manifest.cwd)).length, 0);
  assert.ok(!JSON.stringify(scan).includes('forge.invalid/example/poison'));
});

for (const saved of [false, true]) for (const state of ['missing', 'unreadable', 'partial', 'empty', 'malformed', 'interrupted', 'excluded']) {
  add(`${saved ? 'saved' : 'first'}-${state}`, C, '§4/6/8 first and saved failure matrix', `${state} preserves whole-unit winners and root coverage; missing is never zero`, h => {
    let initial;
    const mutate = () => {
    if (state === 'missing') fs.renameSync(h.manifest.root, h.manifest.root + '-gone');
    if (state === 'unreadable') h.deny(h.manifest.root, true);
    if (state === 'partial') fs.unlinkSync(path.join(h.manifest.meter, 'claude-limits.jsonl'));
    if (state === 'empty') for (const source of h.spec.sources.filter(row => row.kind !== 'meter')) {
      // Move source homes to preserve private sentinel ACL cleanup handles.
      const home = path.join(h.manifest.root, source.home);
      for (const sub of ['projects', 'session-archive', 'sessions', 'archived_sessions']) fs.rmSync(path.join(home, sub), { recursive: true, force: true });
    }
    if (state === 'malformed') fs.appendFileSync(h.manifest.native, '{broken-json\n');
    if (state === 'interrupted') h.env.SOURCE_ROOT_INTERRUPT = path.dirname(h.manifest.native);
    if (state === 'excluded') {
      const settings = readJSON(path.join(h.store, 'source-roots.json')); settings.machines.local.roots[0].selected = false;
      writeJSON(path.join(h.store, 'source-roots.json'), settings);
    }
    };
    let next;
    try {
      if (saved) { initial = h.admit(declared(h)); mutate(); next = h.collect(); }
      else next = h.admit(declared(h), 'local', [], mutate);
    } finally {
      if (state === 'missing' && fs.existsSync(h.manifest.root + '-gone')) fs.renameSync(h.manifest.root + '-gone', h.manifest.root);
    }
    const root = coverage(h, next)[0];
    if (state === 'empty') {
      if (saved) assert.notEqual(root.status, 'read');
      else assert.equal(root.status, 'read');
    } else if (state === 'excluded') { assert.equal(root.status, 'left_out'); assert.equal(root.attempted_at, null); }
    else assert.notEqual(root.status, 'read');
    if (state !== 'excluded') assert.ok(root.attempted_at);
    if (!(state === 'empty' && !saved)) assert.ok(root.reasons.length);
    if (saved) assert.ok(output(scanOf(next)) >= output(scanOf(initial)), 'protected saved usage never lowers');
    const audit = fs.readFileSync(path.join(h.store, 'fixture-audit.log'), 'utf8');
    assert.ok(audit.includes(root.id), 'every root outcome is audited');
    assert.ok(!audit.includes(h.manifest.root), 'root path sanitized in audit');
  });
}
add('first-readable-empty', C, '§6/8 empty first usage', 'existing readable empty native home is read with zero root rows', h => {
  const home = path.join(h.manifest.root, 'empty-claude'); fs.mkdirSync(home);
  const result = h.admit([{ spec: { ...h.spec, sources: [{ kind: 'claude', home: 'empty-claude' }] } }]);
  assert.equal(coverage(h, result)[0].status, 'read'); assert.equal(output(scanOf(result)), 10);
});
for (const saved of [false, true]) for (const mode of ['offline', 'truncated', 'interrupted']) add(`ssh-${saved ? 'saved' : 'first'}-${mode}`, C, '§7/8 each stage synthetic SSH failure audit', 'transport failure retains saved values and makes every attempted root a floor', h => {
  if (saved) h.admit(declared(h), 'synthetic-remote', ['synthetic-remote']);
  else h.seed(declared(h), 'synthetic-remote');
  const result = h.collect(['synthetic-remote'], { SOURCE_ROOT_TRANSPORT: mode });
  const roots = coverage(h, result);
  assert.ok(roots.every(root => ['saved', 'unreadable'].includes(root.status)));
  assert.ok(roots.every(root => root.reasons.includes('transport_failed')));
  const audit = fs.readFileSync(path.join(h.store, 'fixture-audit.log'), 'utf8');
  assert.ok(roots.every(root => audit.includes(root.id)));
});
add('ssh-private-framing', C, '§7 framed script/spec stdin and collector-memory adapter', 'private specs use framed stdin; key remains local; no raw staging/output', h => {
  const result = h.admit(declared(h), 'synthetic-remote', ['synthetic-remote']);
  const calls = fs.readFileSync(path.join(h.base, 'transport.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.length);
  for (const call of calls) {
    assert.ok(!JSON.stringify(call.args).includes(h.manifest.root)); assert.equal(call.keyInEnvironment, false);
    const bytes = Buffer.from(call.input, 'base64');
    assert.ok(bytes.includes(Buffer.from(h.manifest.root)), 'spec arrives in actual stdin, after script framing');
    assert.ok(!bytes.includes(Buffer.alloc(32, 37)), 'collector HMAC key never leaves collector');
  }
  assert.ok(!JSON.stringify(result.scans).includes(h.manifest.root));
  assert.ok(!JSON.stringify(result.progress).includes(h.manifest.root));
  const inspect = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (['source-roots.json', 'source-roots.key'].includes(entry.name)) continue;
      if (entry.isDirectory()) inspect(file);
      else assert.ok(!fs.readFileSync(file).includes(Buffer.from(h.manifest.root)), 'no raw pipe data becomes a staging file/log/saved scan');
    }
  };
  inspect(h.store);
});
add('same-host-aliases', C, '§4/8 aliases', 'aliases request the union of roots and contribute one physical machine', h => {
  h.seed(declared(h), 'synthetic-remote');
  const settings = readJSON(path.join(h.store, 'source-roots.json'));
  settings.machines['synthetic-alias'] = structuredClone(settings.machines['synthetic-remote']);
  writeJSON(path.join(h.store, 'source-roots.json'), settings);
  const result = h.collect(['synthetic-remote', 'synthetic-alias']);
  assert.equal(result.info.hosts.filter(host => host.ok).length, 1);
  assert.equal(coverage(h, result).length, 2, 'both aliases keep coverage even if physical usage deduplicates');
});
add('unknown-copy-identity', C, '§4/8 unknown host/copy identity', 'copied DBs without provenance cannot become complete by equal row ids', h => {
  fs.copyFileSync(path.join(h.manifest.meter, 'meter.db'), path.join(h.manifest.root, 'other-meter/meter.db'));
  const result = h.admit([{ spec: { ...h.spec, sources: [...h.spec.sources, { kind: 'meter', home: 'other-meter' }] } }]);
  assert.ok(coverage(h, result).some(root => root.reasons.includes('identity_unknown')));
});

const weeklyGuard = (h, currentRoots, previousRoots) => h.evaluate(`
  import {prepareWeekly} from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/weekly.mjs')).href)};
  const data={generated_at:'2026-11-14T12:00:00Z',week:{from:'2026-11-07',to:'2026-11-14'},machines:['fixture-reader'],
    source_roots:${JSON.stringify(currentRoots)}, plans:[{plan:'Synthetic Plan',proof:'measured',usd_per_full_week:20,times_plan_price:2}],
    machines_missing:[],machines_left_out:[],machines_retained:[],machines_retired:[]};
  const baseline={generated_at:'2026-11-07T12:00:00Z',week_to:'2026-11-07',${previousRoots === undefined ? '' : 'source_roots:' + JSON.stringify(previousRoots) + ','}
    plans:[{plan:'Synthetic Plan',proof:'measured',usd_per_full_week:10}]};
  console.log(JSON.stringify(prepareWeekly(data,baseline)));
`);
for (const [name, current, previous] of [
  ['default-legacy-unknown', [], undefined], ['active-root', [{ id: 'a'.repeat(64), lifecycle: 'active', status: 'read' }], []],
  ['retired-empty-root', [{ id: 'a'.repeat(64), lifecycle: 'retired', status: 'retired', no_saved_scan: true }], []],
  ['left-out-root', [{ id: 'a'.repeat(64), lifecycle: 'active', status: 'left_out' }], []],
  ['previous-root-only', [], [{ id: 'a'.repeat(64), lifecycle: 'active', status: 'read' }]],
]) add('weekly-guard-' + name, C, '§7/8 root presence and default-only legacy guard', 'any root-bearing/unknown endpoint withholds change with roots_changed and omits moved', h => {
  const result = weeklyGuard(h, current, previous);
  assert.equal(result.plans[0].change_vs_last_week_pct, null);
  assert.ok(result.plans[0].not_compared.includes('roots_changed'));
  assert.deepEqual(result.moved, []);
});
add('weekly-explicit-empty-endpoints', C, '§7 1a guard baseline control', 'known explicit-empty roots can compare under existing proof rules', h => {
  const result = weeklyGuard(h, [], []);
  assert.equal(result.plans[0].change_vs_last_week_pct, 100); assert.deepEqual(result.plans[0].not_compared, []);
});
for (const args of [['get', 'source_roots'], ['projects']]) add('offline-' + args[0], C, '§7/8 offline zero root/SSH reads', 'saved-only commands do not revalidate paths, permissions or connect', h => {
  h.admit(declared(h));
  // Build last.json through the actual non-rendering pipeline before taking trace baseline.
  const built = h.cli(['--json', '--no-files', '--hosts', 'none', '--git', 'no', '--ai', 'no']);
  assert.equal(built.status, 0);
  h.clearTrace(); const before = fs.existsSync(path.join(h.base, 'transport.jsonl')) ? fs.readFileSync(path.join(h.base, 'transport.jsonl'), 'utf8') : '';
  fs.renameSync(h.manifest.root, h.manifest.root + '-offline');
  try {
    const result = h.cli(args); assert.equal(result.status, 0);
    assert.equal(h.rows().filter(row => ['scanner', 'collector'].includes(row.actor) && row.path.startsWith(h.manifest.root)).length, 0);
    assert.equal(fs.existsSync(path.join(h.base, 'transport.jsonl')) ? fs.readFileSync(path.join(h.base, 'transport.jsonl'), 'utf8') : '', before);
    assert.ok(result.stdout.includes('source_roots') || Array.isArray(JSON.parse(result.stdout)));
  } finally { fs.renameSync(h.manifest.root + '-offline', h.manifest.root); }
});

add('root-sentinel-policy', C, '§2/8 existing credential/raw-config sentinels and trace', 'allowed usage is read; no scanner/collector opens or probes prohibited raw names, aliases or sibling secrets', h => {
  const result = h.admit(declared(h));
  assert.equal(output(scanOf(result)), 210, 'denied raw config never removes allowed usage');
  assert.equal(h.forbidden(h.rows()).length, 0);
  assert.equal(h.rows().filter(row => ['scanner', 'collector'].includes(row.actor) &&
    (h.protectedPaths().includes(row.path) || row.path.includes('/sibling-secrets/'))).length, 0);
  assert.ok(h.rows().some(row => row.actor === 'scanner' && row.op === 'open' && row.outcome === 'returned' && row.path === h.manifest.native));
});
for (const status of ['unverified', 'failed']) add('boundary-' + status, C, '§2/6 boundary enforcement', 'unverified/failed attestation skips content and records an unreadable root', h => {
  h.seed([{ spec: h.spec, boundary: status === 'unverified' ? null : {
    status, checked_at: h.env.FIXTURE_NOW, revision: 1, reader_id: 'b'.repeat(64), proof_sha256: 'c'.repeat(64),
  } }]);
  h.clearTrace(); const result = h.collect(), root = coverage(h, result)[0];
  assert.equal(root.status, 'unreadable'); assert.ok(root.reasons.includes('boundary_' + status));
  assert.equal(h.rows().filter(row => row.actor === 'scanner' && row.op === 'open' && row.path.startsWith(h.manifest.root)).length, 0);
});
add('root-wal-snapshot', C, '§2/8 SQLite WAL snapshot consistency', 'root-enabled reader sees committed WAL snapshot and never modifies source database/WAL', async h => {
  await withWal(h, () => {
    const spec = { ...h.spec, sources: [{ kind: 'meter', home: 'wal-meter' }] };
    const result = h.admit([{ spec }]);
    assert.equal(coverage(h, result)[0].status, 'read');
    assert.equal(scanOf(result).meter_usage.reduce((sum, row) => sum + row[7], 0), 30);
  });
});
for (const freshWins of [false, true]) add('whole-machine-winner-' + (freshWins ? 'higher-fresh-floor' : 'protected-saved'), C, '§4/8 saved-machine winner/floor', 'winner is selected per machine/local-day/provider, never summed; a fresh floor may win by score', h => {
  const initial = h.admit(declared(h)), prior = scanOf(initial);
  const usage = JSON.parse(fs.readFileSync(h.manifest.native, 'utf8'));
  usage.message.usage.output_tokens = freshWins ? 1000000 : 1;
  fs.writeFileSync(h.manifest.native, JSON.stringify(usage) + '\n');
  // One binding fails, but another successful binding still has higher fresh USD.
  fs.unlinkSync(path.join(h.manifest.meter, 'claude-limits.jsonl'));
  const result = h.collect(), root = coverage(h, result)[0], next = scanOf(result);
  assert.notEqual(root.status, 'read');
  if (freshWins) {
    assert.equal(next.buckets.filter(row => row.provider === 'claude').reduce((sum, row) => sum + row.output, 0), 1000030);
  } else {
    assert.deepEqual(next.buckets.filter(row => row.provider === 'claude'), prior.buckets.filter(row => row.provider === 'claude'));
    assert.ok(root.retained.some(unit => unit.provider === 'claude' && unit.day === '2026-11-13'));
  }
});
add('retired-machine-live-alias-overlap', C, '§4/8 RFC0002 retired-machine/live overlap', 'whole-machine frozen snapshot and a live alias never add the same physical usage twice', h => {
  const initial = h.admit(declared(h)), saved = scanOf(initial);
  writeJSON(path.join(h.store, 'run-keep/retired/synthetic-retired.json'), saved);
  writeJSON(path.join(h.store, 'hosts.json'), { selected: [], retired: [{ machine: 'synthetic-retired',
    retired_at: '2026-11-14T12:00:00Z', last_scan_at: saved.generated_at }] });
  const next = h.collect();
  const total = Object.values(next.scans).reduce((sum, scan) => sum + output(scan), 0);
  assert.equal(total, output(saved));
  assert.ok(next.info.retirement_conflicts.some(row => row.machine === 'synthetic-retired'));
  coverage(h, next);
});
add('empty-retire-measured-still-not-compared', C, '§7/8 empty retire and root-presence guard', 'post-retirement complete machine regains proof; retired presence still suppresses comparison and discloses attestation', h => {
  register(h); const id = listedId(h);
  command(h, ['retire', 'local', id]);
  const result = h.build({ FIXTURE_NOW: '2026-11-23T12:00:00Z' });
  assert.ok(result.source_roots.some(root => root.id === id && root.status === 'retired'));
  assert.match(JSON.stringify(result), /retired with no saved scan, as stated by you/);
  // Use a complete independent plan observation; no meter/price implementation from RFC0005 needed.
  const checkpoint = weeklyGuard(h, result.source_roots, []);
  assert.equal(checkpoint.plans[0].proof, 'measured');
  assert.equal(checkpoint.safe_to_post, true, 'a valid retired empty root alone is not unsafe after its boundary');
  assert.equal(checkpoint.plans[0].change_vs_last_week_pct, null);
  assert.ok(checkpoint.plans[0].not_compared.includes('roots_changed'));
});
for (const state of ['missing', 'partial', 'saved', 'left_out']) add('weekly-unsafe-' + state, C, '§6/7/8 machine floor and hashed unsafe reasons', 'unanswered or retained roots block plan proof and posting with hashed root reason', h => {
  const root = { id: 'a'.repeat(64), machine_id: 'b'.repeat(64), status: state, lifecycle: 'active',
    reasons: [state === 'left_out' ? 'not_selected' : 'retained_unit'],
    retained: state === 'saved' ? [{ day: '2026-11-13', provider: 'claude', root_ids: ['a'.repeat(64)], why: 'retained_unit' }] : [] };
  const result = weeklyGuard(h, [root], []);
  assert.equal(result.safe_to_post, false); assert.equal(result.plans[0].proof, 'floor');
  assert.ok(result.reasons.some(reason => reason.includes(root.id)));
});
add('plain-plan-legacy-unknown-guard', C, '§7/8 default-only old baseline roots_changed; plan_value.source_roots', 'plain buildData path persists explicit empty coverage and refuses an unknown legacy baseline', h => {
  const result = h.evaluate(`
    import {DatabaseSync} from 'node:sqlite';
    import {buildData,HOME} from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/collect.mjs')).href)};
    import path from 'node:path';
    const db=new DatabaseSync(path.join(HOME,'worthit.db'));
    db.exec("CREATE TABLE plan_value(day TEXT,provider TEXT,plan TEXT,usd_per_full_week INTEGER,times_plan_price INTEGER,stretches INTEGER,proof TEXT,PRIMARY KEY(day,provider)); INSERT INTO plan_value VALUES('2026-11-07','claude','Claude Ultra',10,1,1,'measured')");db.close();
    const measured={api_usd:20,output_tokens:10,cached_input_tokens:0,model_mix_by_usd:{}};
    const report={activity:[],this_week:{claude:{usd_per_full_week:20,meter_start_pct:0,meter_end_pct:100,hours:1,measured}},prices:{plan_usd_per_week:{claude:5}},hosts:{'fixture-reader':{}},claude_stints:[],codex_weeks:[],google_weeks:[]};
    const data=buildData(report,null,{days:21,hosts:[]},{counts:{claude:1},hosts:[{alias:'synthetic-remote',ok:true}],left_out:[],retained:[],retirement:[],source_roots:[]});
    console.log(JSON.stringify(data));
  `);
  assert.ok(result.plans.length, 'the plain plan path must actually produce a plan');
  assert.equal(result.plans[0].change_vs_last_week_pct, null);
  assert.ok(result.plans[0].not_compared.includes('roots_changed'));
  assert.deepEqual(result.source_roots, []);
  const columns = h.json(h.python, ['-c', 'import json,sqlite3,sys; db=sqlite3.connect(sys.argv[1]); print(json.dumps([r[1] for r in db.execute("pragma table_info(plan_value)")]))', path.join(h.store, 'worthit.db')]);
  assert.ok(columns.includes('source_roots'));
});

add('same-account-native-tags', C, '§3/7/8 each-stage account tags', 'per-record Codex identity uses identical account tags in defaults and roots without sharing host login fallback', h => {
  const source = fs.readFileSync(h.manifest.codex, 'utf8').trim().split('\n').map(JSON.parse);
  source[0].payload.creator_user_id = 'synthetic-person'; source[0].payload.creator_account_id = 'synthetic-account';
  fs.writeFileSync(h.manifest.codex, source.map(row => JSON.stringify(row)).join('\n') + '\n');
  const defaultFile = path.join(h.home, '.codex/sessions/default.jsonl'); fs.mkdirSync(path.dirname(defaultFile), { recursive: true });
  const defaults = structuredClone(source); defaults[0].payload.id = 'synthetic-default-codex';
  fs.writeFileSync(defaultFile, defaults.map(row => JSON.stringify(row)).join('\n') + '\n');
  const result = h.admit(declared(h)), rows = scanOf(result).buckets.filter(row => row.provider === 'codex' && ['synthetic-default-codex', 'synthetic-codex'].includes(row.session));
  assert.equal(rows.length, 2); assert.match(rows[0].login, /^acct-/); assert.equal(rows[0].login, rows[1].login);
  assert.ok(!JSON.stringify(result.scans).includes('synthetic-person'));
});

// The ordinary plan path has an independently persisted endpoint. Weekly's guard
// cannot stand in for this path, usage deltas, project costs or delivery claims.
const completeRoot = {
  id: 'a'.repeat(64), machine_id: 'b'.repeat(64), reader_id: 'c'.repeat(64), canonical_id: 'd'.repeat(64),
  revision: 1, selected: true, lifecycle: 'active', status: 'read', reasons: [], boundary: 'verified',
  registered_at: '2026-11-01T00:00:00Z', attempted_at: '2026-11-14T12:00:00Z', last_scan_at: '2026-11-14T12:00:00Z', retired_at: null,
  window: { from: '2026-10-24T12:00:00Z', to: '2026-11-14T12:00:00Z', complete: true },
  sources: [], retained: [], attribution: { account_complete: true, model_complete: true, unattributed_rows: 0,
    unattributed_output_tokens: 0, unattributed_api_value_usd: 0, model_unknown_rows: 0, unpriced_rows: 0 },
};
const plainRootGuard = (h, currentRoots, previousRoots, withDelivery = false) => h.evaluate(`
  import {DatabaseSync} from 'node:sqlite'; import path from 'node:path';
  import {buildData,HOME} from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/collect.mjs')).href)};
  const roots=${JSON.stringify(currentRoots)}, previous=${JSON.stringify(previousRoots)};
  const db=new DatabaseSync(path.join(HOME,'worthit.db'));
  db.exec('CREATE TABLE plan_value(day TEXT,provider TEXT,plan TEXT,usd_per_full_week INTEGER,times_plan_price INTEGER,stretches INTEGER,proof TEXT,source_roots TEXT,PRIMARY KEY(day,provider))');
  db.prepare('INSERT INTO plan_value VALUES(?,?,?,?,?,?,?,?)').run('2026-11-07','claude','Claude Ultra',10,1,1,'measured',JSON.stringify(previous));db.close();
  const activity=[['2026-11-03',60,400000],['2026-11-05',90,600000],['2026-11-10',120,800000],['2026-11-13',180,1200000]]
    .map(([day,usd,output])=>({hour:day+'T15',provider:'claude',usd,output,requests:1}));
  const measured={api_usd:300,output_tokens:2000000,cached_input_tokens:0,model_mix_by_usd:{}};
  const report={activity,source_roots:roots,history_since:'2026-10-24T12:00:00Z',
    prices:{plan_usd_per_week:{claude:46}},this_week:{claude:{usd_per_full_week:600,meter_start_pct:0,meter_end_pct:50,hours:2,measured}},
    project_activity:activity.map(row=>({...row,model:'claude-sonnet-5-5',project:null,project_why:'no_folder_read',cost_complete:true}))};
  const kinds=[];for(const [date,count] of [['2026-11-03',3],['2026-11-05',2],['2026-11-10',3],['2026-11-13',3]])
    for(let index=0;index<count;index++) kinds.push([Date.parse(date+'T15:00:00Z')+index,'feat']);
  const git=${withDelivery} ? {prs:kinds.map(([t])=>t),kinds,commits:kinds.map(([t])=>t),repos:1,src:{synthetic:kinds.length},
    coverage:{prs:true,commits:true,sources:[{source:'synthetic',answered:true,metrics:['prs']}]}} : null;
  console.log(JSON.stringify(buildData(report,git,{days:21,hosts:[]},{counts:{claude:4},hosts:[{alias:'synthetic-remote',ok:true}],
    left_out:[],retained:[],retirement:[],source_roots:roots})));
`);
for (const [name, current, previous] of [
  ['active', [completeRoot], []],
  ['retired-empty', [{ ...completeRoot, lifecycle: 'retired', status: 'retired', selected: false,
    retired_at: '2026-11-01T00:00:00Z', last_scan_at: null, no_saved_scan: true }], []],
  ['deselected', [{ ...completeRoot, selected: false, status: 'left_out', attempted_at: null, reasons: ['not_selected'] }], []],
  ['tombstone', [{ ...completeRoot, selected: false, status: 'left_out', attempted_at: null, reasons: ['removed_setting'] }], []],
  ['previous-only', [], [completeRoot]],
]) add('plain-plan-root-' + name, C, '§7/8 both plan endpoints and root-presence after empty retire', 'plain plan changes are null with roots_changed and exact endpoint coverage is persisted', h => {
  const result = plainRootGuard(h, current, previous);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].change_vs_last_week_pct, null);
  assert.ok(result.plans[0].not_compared.includes('roots_changed'));
  assert.deepEqual(result.source_roots, current);
  const persisted = h.json(h.python, ['-c', 'import json,sqlite3,sys; db=sqlite3.connect(sys.argv[1]); print(json.dumps(json.loads(db.execute("select source_roots from plan_value where day=\'2026-11-14\'").fetchone()[0])))', path.join(h.store, 'worthit.db')]);
  assert.deepEqual(persisted, current);
});
add('root-usage-cost-comparison-guards', C, '§6/7/8 usage, value and delivery-cost guards', 'root presence withholds usage-derived improvements while physical PR counts retain independent proof', h => {
  const result = plainRootGuard(h, [completeRoot], [], true);
  assert.equal(result.totals.output_tokens, 2000000); assert.equal(result.totals.api_value_usd, 300);
  assert.equal(result.totals.output_tokens_change_pct, null); assert.equal(result.totals.api_value_change_pct, null);
  assert.equal(result.git.usd_per_pr_change_pct, null); assert.equal(result.delivery.usd_per_feature_change_pct, null);
  assert.equal(result.git.merged_prs, 6); assert.equal(result.git.merged_prs_change_pct, 20);
  assert.equal(result.delivery.features, 6); assert.equal(result.delivery.features_change_pct, 20);
  assert.ok(!result.game.personal_bests.includes('lowest cost per PR'));
});
