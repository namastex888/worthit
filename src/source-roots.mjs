// RFC 0006 delivery 1a/B: private declarations; no source content is read here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { activeHosts } from './hosts.mjs';

const HASH = /^[a-f0-9]{64}$/;
const RECORD = ['key', 'selected', 'revision', 'spec', 'registered_at', 'boundary', 'revisions', 'retired_at', 'last_scan_at', 'since'];
const collections = ['buckets', 'meters', 'events', 'meter_readings', 'meter_usage', 'sessions'];
export class RootError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}
const invalid = () => { throw new RootError('invalid source-root settings; check the RFC 0006 schema'); };
const unsupported = () => { throw new RootError('unsupported feature in RFC 0006 delivery 1a; see worthit hosts roots help'); };
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => { if (!object(x) || Object.keys(x).some(k => !keys.includes(k))) invalid(); };
const instant = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().replace('.000Z', 'Z') === x.replace('.000Z', 'Z');
const safeText = x => typeof x === 'string' && x.length > 0 && x.length <= 4096 && !/[\p{Cc}\p{Zl}\p{Zp}$`~*?\[\]{}\\]/u.test(x) && !x.includes('://') && !/^[a-z][a-z0-9+.-]*:/i.test(x);
function validPath(x, absolute) {
  if (!safeText(x) || x.split('/').includes('..') || (absolute ? !x.startsWith('/') : x.startsWith('/'))) invalid();
  return path.posix.normalize(x);
}

// JSON.parse alone loses duplicate object keys. Walk the grammar before parsing.
export function strictJSON(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1 << 20) invalid();
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] || '') && i < text.length) i++; };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') i++;
      else if (c === '"') return JSON.parse(text.slice(start, i));
    }
    invalid();
  };
  const value = (depth = 0) => {
    if (depth > 64) invalid();
    ws();
    if (text[i] === '{') {
      i++; ws(); const keys = new Set();
      if (text[i] === '}') { i++; return; }
      while (i < text.length) {
        ws(); if (text[i] !== '"') invalid();
        const key = string(); if (keys.has(key)) invalid(); keys.add(key);
        ws(); if (text[i++] !== ':') invalid(); value(depth + 1); ws();
        const end = text[i++]; if (end === '}') return; if (end !== ',') invalid();
      }
      invalid();
    } else if (text[i] === '[') {
      i++; ws(); if (text[i] === ']') { i++; return; }
      while (i < text.length) { value(depth + 1); ws(); const end = text[i++]; if (end === ']') return; if (end !== ',') invalid(); }
      invalid();
    } else if (text[i] === '"') string();
    else { const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i)); if (!m) invalid(); i += m[0].length; }
  };
  try { value(); ws(); if (i !== text.length) invalid(); return JSON.parse(text); }
  catch { invalid(); }
}
function readJSON(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try { if (fs.fstatSync(fd).size > 1 << 20) invalid(); return strictJSON(fs.readFileSync(fd, 'utf8')); }
    finally { fs.closeSync(fd); }
  } catch (e) { if (e instanceof RootError) throw e; throw new RootError('cannot read private source-root document', 1); }
}
function readEvidence(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try { if (fs.fstatSync(fd).size > 64 << 20) invalid(); return JSON.parse(fs.readFileSync(fd, 'utf8')); }
    finally { fs.closeSync(fd); }
  } catch { throw new RootError('cannot validate saved source-root evidence', 1); }
}
function privateWrite(file, data) {
  if (Buffer.byteLength(data) > 1 << 20) invalid();
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch { throw new RootError('cannot write private source-root store', 1); }
  finally { try { fs.unlinkSync(tmp); } catch { /* no temporary file */ } }
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const rootHash = (key, domain, tuple) => crypto.createHmac('sha256', key).update(JSON.stringify(canonical([domain, tuple]))).digest('hex');
export function validateSpec(spec) {
  exact(spec, ['path', 'sources', 'mappings']); validPath(spec.path, true);
  if (!Array.isArray(spec.sources) || !spec.sources.length || spec.sources.length > 128) invalid();
  if (spec.mappings !== undefined && !Array.isArray(spec.mappings)) invalid();
  if (spec.mappings?.length) unsupported();
  const seen = new Set();
  for (const source of spec.sources) {
    exact(source, ['kind', 'home', 'account', 'model']);
    if (source.kind === 'antigravity' || 'account' in source || 'model' in source) unsupported();
    if (!['claude', 'codex', 'meter'].includes(source.kind)) invalid();
    const home = validPath(source.home, false), id = source.kind + ':' + home;
    if (seen.has(id)) invalid(); seen.add(id);
  }
  return { ...spec, mappings: spec.mappings || [] };
}
function validateBoundary(proof) {
  exact(proof, ['status', 'checked_at', 'revision', 'reader_id', 'proof_sha256']);
  if (!['verified', 'unverified', 'failed'].includes(proof.status) || !instant(proof.checked_at) ||
      !Number.isSafeInteger(proof.revision) || proof.revision < 1 || !HASH.test(proof.reader_id) || !HASH.test(proof.proof_sha256)) invalid();
}
function validateRecord(record, history = false) {
  exact(record, history ? RECORD.filter(k => k !== 'revisions') : RECORD);
  if (!safeText(record.key) || typeof record.selected !== 'boolean' || !Number.isSafeInteger(record.revision) || record.revision < 1 ||
      !instant(record.registered_at) || !['retired_at', 'last_scan_at'].every(k => record[k] === null || instant(record[k])) ||
      !(record.since === null || /^\d{4}-\d\d-\d\d$/.test(record.since))) invalid();
  validateSpec(record.spec);
  if (record.boundary !== null) validateBoundary(record.boundary);
  if (!history) { if (!Array.isArray(record.revisions)) invalid(); for (const old of record.revisions) validateRecord(old, true); }
}
export function readSourceRoots(home) {
  const file = path.join(home, 'source-roots.json'), salt = path.join(home, 'source-roots.key');
  const exists = fs.existsSync(file), keyExists = fs.existsSync(salt);
  if (!exists && !keyExists) {
    // A prior provenance record prevents accidental reinitialization after loss.
    if (fs.existsSync(path.join(home, 'run-keep/roots'))) throw new RootError('source-root settings or key missing; restore the private store');
    const keep = path.join(home, 'run-keep');
    if (fs.existsSync(keep)) for (const name of fs.readdirSync(keep).filter(n => n.endsWith('.json'))) {
      let scan;
      try { scan = readEvidence(path.join(keep, name)); } catch { continue; }
      if (HASH.test(scan.machine_id)) throw new RootError('source-root settings or key missing; restore the private store');
    }
    return { state: { version: 1, machines: {} }, key: null };
  }
  if (!exists || !keyExists) throw new RootError('source-root settings or key missing; restore the private store');
  let key;
  try {
    for (const target of [file, salt]) { const st = fs.lstatSync(target); if (!st.isFile() || st.mode & 0o077) invalid(); }
    key = fs.readFileSync(salt);
  } catch (e) { if (e instanceof RootError) throw e; throw new RootError('cannot read private source-root key', 1); }
  if (key.length !== 32) invalid();
  const state = readJSON(file); exact(state, ['version', 'machines']);
  if (state.version !== 1 || !object(state.machines)) invalid();
  const keys = new Set();
  for (const [machine, entry] of Object.entries(state.machines)) {
    if (!validMachine(machine)) invalid(); exact(entry, ['roots', 'machine_id']); if (!Array.isArray(entry.roots) || (entry.machine_id !== undefined && !HASH.test(entry.machine_id))) invalid();
    for (const record of entry.roots) { validateRecord(record); if (keys.has(record.key)) invalid(); keys.add(record.key); }
  }
  return { state, key };
}
const validMachine = name => typeof name === 'string' && !['__proto__', 'constructor', 'prototype'].includes(name) && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,253}$/.test(name);
const rootId = (store, record) => rootHash(store.key, 'root-v1', [record.key]);
export function storedRootCoverage(home) {
  const dir = path.join(home, 'run-keep/roots');
  if (!fs.existsSync(dir)) return [];
  let names;
  try { names = fs.readdirSync(dir); } catch { throw new RootError('cannot read source-root provenance', 1); }
  const result = [];
  for (const name of names.filter(x => /^[a-f0-9]{64}\.json$/.test(x))) {
    const record = readJSON(path.join(dir, name));
    if (record.version !== 1 || !Array.isArray(record.source_roots) || record.source_roots.some(r => !HASH.test(r.id))) invalid();
    result.push(...record.source_roots.map(root => ({ ...root, machine: record.machine })));
  }
  return result;
}
export function sourceRootsFor(home, store, machine) {
  const current = (store.state.machines[machine]?.roots || []).map(record => ({ record, id: rootId(store, record) }));
  const ids = new Set(current.map(r => r.id));
  // Missing private declarations never erase population evidence.
  for (const saved of storedRootCoverage(home)) if (saved.machine === machine && !ids.has(saved.id)) current.push({ id: saved.id, tombstone: saved });
  return current;
}
function publicRecord(home, store, machine, record) {
  const id = rootId(store, record), prior = storedRootCoverage(home).find(r => r.id === id);
  return { id, revision: record.revision, selected: record.selected, lifecycle: record.retired_at ? 'retired' : 'active',
    registered_at: record.registered_at, retired_at: record.retired_at, last_scan_at: record.last_scan_at,
    reader_id: prior?.reader_id || null, machine_id: prior?.machine_id || store.state.machines[machine]?.machine_id || null,
    boundary: record.boundary?.status || 'unverified', status: record.retired_at ? 'retired' : prior?.revision === record.revision ? prior.status : record.selected ? 'unreadable' : 'left_out',
    reasons: record.retired_at ? [] : prior?.revision === record.revision ? prior.reasons : record.selected ? ['boundary_unverified'] : ['not_selected'] };
}
function revise(record) {
  const { revisions, ...old } = structuredClone(record); record.revisions.push(old); record.revision++;
}
function mutateRoots(home, known, argv) {
  if (argv[0] === 'help') return { help: 'worthit hosts roots <machine>; add <machine> --file <spec.json>; select <machine> <root-id> on|off; boundary <machine> <root-id> --file <proof.json>; retire <machine> <root-id> [--since YYYY-MM-DD]. Roots are recorded, not read. Machines with a declared root use saved data only until the next delivery. update/unretire and answered-root retirement are unsupported.' };
  const actions = ['add', 'select', 'boundary', 'retire', 'update', 'unretire'];
  const action = actions.includes(argv[0]) ? argv[0] : 'list';
  const machine = action === 'list' ? argv[0] : argv[1];
  if (!validMachine(machine)) throw new RootError('use worthit hosts roots help');
  const store = readSourceRoots(home);
  if (machine !== 'local' && !known.some(h => h.alias === machine) && !store.state.machines[machine]) throw new RootError('machine must be local or an existing saved SSH alias');
  if (['update', 'unretire'].includes(action)) unsupported();
  const roots = store.state.machines[machine]?.roots || [];
  if (action === 'list') {
    if (argv.length !== 1) throw new RootError('use worthit hosts roots help');
    return sourceRootsFor(home, store, machine).map(({ record, tombstone }) => {
      if (record) return publicRecord(home, store, machine, record);
      const { machine: ignored, ...coverage } = tombstone;
      return { ...coverage, selected: false, lifecycle: 'active', status: 'left_out', reasons: ['removed_setting'], attempted_at: null };
    });
  }
  let record;
  if (action === 'add') {
    if (argv.length !== 4 || argv[2] !== '--file') throw new RootError('use worthit hosts roots add <machine> --file <spec.json>');
    const spec = validateSpec(readJSON(argv[3]));
    if (roots.some(r => JSON.stringify(canonical(r.spec)) === JSON.stringify(canonical(spec)))) throw new RootError('source root is already registered');
    const identity = machine === 'local' ? localIdentity() : null;
    const saved = machine === 'local' ? null : savedMachineId(home, store, machine);
    if (machine !== 'local' && !identity && !saved) throw new RootError('scan ' + machine + ' once before adding a root');
    record = { key: crypto.randomUUID(), selected: true, revision: 1, spec, registered_at: new Date().toISOString(), boundary: null,
      revisions: [], retired_at: null, last_scan_at: null, since: null };
    if (!store.key) {
      store.key = crypto.randomBytes(32);
      // Exclusive creation: a concurrent first registration must not rotate the key.
      try { fs.mkdirSync(home, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(home, 'source-roots.key'), store.key, { flag: 'wx', mode: 0o600 }); }
      catch { throw new RootError('cannot initialize private source-root key', 1); }
    }
    const machineId = identity ? rootHash(store.key, 'machine-v1', [identity.host]) : saved;
    if (!machineId) throw new RootError('scan ' + machine + ' once before adding a root');
    if (store.state.machines[machine]?.machine_id && store.state.machines[machine].machine_id !== machineId) throw new RootError('machine identity changed; restore the established identity before adding a root');
    store.state.machines[machine] = { machine_id: machineId, roots: [...roots, record] };
  } else {
    record = roots.find(r => rootId(store, r) === argv[2]);
    if (!record) throw new RootError('unknown source-root id');
    if (record.retired_at) throw new RootError('source root is retired; lifecycle changes are unsupported until delivery 1b');
    if (action === 'select') {
      if (argv.length !== 4 || !['on', 'off'].includes(argv[3])) throw new RootError('selection must be on or off');
      const selected = argv[3] === 'on';
      if (record.selected !== selected) { revise(record); record.selected = selected; record.boundary = null; }
    } else if (action === 'boundary') {
      if (argv.length !== 5 || argv[3] !== '--file') throw new RootError('use worthit hosts roots boundary <machine> <root-id> --file <proof.json>');
      const proof = readJSON(argv[4]); validateBoundary(proof);
      if (proof.revision !== record.revision || Date.parse(proof.checked_at) > Date.now()) throw new RootError('boundary proof does not match current revision or date');
      record.boundary = proof;
    } else if (action === 'retire') {
      if (!(argv.length === 3 || (argv.length === 5 && argv[3] === '--since'))) throw new RootError('use worthit hosts roots retire <machine> <root-id> [--since YYYY-MM-DD]');
      const id = rootId(store, record), evidence = path.join(home, 'run-keep/roots', id + '.json');
      if (record.last_scan_at || record.revisions.some(r => r.last_scan_at)) unsupported();
      if (fs.existsSync(evidence)) {
        const saved = readJSON(evidence);
        if (saved.last_scan_at || saved.no_saved_scan === false || saved.source_ids?.length || saved.source_roots?.some(r => ['read', 'partial'].includes(r.status))) unsupported();
      }
      const keep = path.join(home, 'run-keep');
      if (fs.existsSync(keep)) for (const name of fs.readdirSync(keep).filter(n => n.endsWith('.json'))) {
        const scan = readEvidence(path.join(keep, name));
        if (scan.source_roots?.some(root => root.id === id && (root.last_scan_at || ['read', 'partial'].includes(root.status)))) unsupported();
      }
      const now = Date.now(), since = argv[4]; let retiredAt = now;
      if (since !== undefined) {
        retiredAt = Date.parse(since + 'T00:00:00Z');
        if (!/^\d{4}-\d\d-\d\d$/.test(since) || !Number.isFinite(retiredAt) || new Date(retiredAt).toISOString().slice(0, 10) !== since || retiredAt < Date.parse(record.registered_at) || retiredAt > now)
          throw new RootError('retirement date must be valid UTC, no earlier than registration and no later than now');
      }
      revise(record); record.selected = false; record.retired_at = new Date(retiredAt).toISOString(); record.since = since || null;
      const coverage = unreadCoverage(home, store, machine, null, null).find(root => root.id === id);
      const frozen = { version: 1, source_roots: [coverage], generated_at: new Date(now).toISOString(),
        since: record.registered_at, registered_at: record.registered_at, last_scan_at: null, no_saved_scan: true, source_ids: [],
        ...Object.fromEntries(collections.map(k => [k, []])) };
      const snapshot = path.join(home, 'run-keep/roots/retired', id + '.json');
      if (fs.existsSync(snapshot)) throw new RootError('existing frozen root evidence must be restored before retirement');
      privateWrite(snapshot, JSON.stringify(frozen));
      try { privateWrite(path.join(home, 'source-roots.json'), JSON.stringify(store.state)); }
      catch (e) { try { fs.unlinkSync(snapshot); } catch {} throw e; }
      return publicRecord(home, store, machine, record);
    }
  }
  privateWrite(path.join(home, 'source-roots.json'), JSON.stringify(store.state));
  if (action === 'add') saveRootCoverage(home, machine, unreadCoverage(home, store, machine, machine === 'local' ? localIdentity() : null, null));
  return publicRecord(home, store, machine, record);
}

export function rootsCommand(home, known, argv) {
  const mutation = ['add', 'select', 'boundary', 'retire'].includes(argv[0]);
  if (!mutation) return mutateRoots(home, known, argv);
  const lock = path.join(home, 'source-roots.lock'); let fd;
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (e) { throw new RootError(e.code === 'EEXIST' ? 'source-root store is busy; retry after the current operation' : 'cannot lock private source-root store', e.code === 'EEXIST' ? 2 : 1); }
    return mutateRoots(home, known, argv);
  } catch (e) { if (e instanceof RootError) throw e; throw new RootError('private source-root operation failed', 1); }
  finally { if (fd !== undefined) try { fs.closeSync(fd); fs.unlinkSync(lock); } catch { throw new RootError('cannot release private source-root store lock', 1); } }
}

export function unreadCoverage(home, store, machine, identity, attemptedAt, transportFailed = false, inspectSnapshot = false) {
  return sourceRootsFor(home, store, machine).map(({ record, id, tombstone }) => {
    if (tombstone) { const { machine: ignored, ...coverage } = tombstone; return { ...coverage, selected: false, lifecycle: 'active', status: 'left_out', reasons: ['removed_setting'], attempted_at: null }; }
    const machineId = identity ? rootHash(store.key, 'machine-v1', [identity.host]) : null;
    const readerId = identity ? rootHash(store.key, 'reader-v1', [identity.host, identity.os, identity.uid, identity.gid]) : null;
    const proof = record.boundary;
    const boundary = proof?.revision === record.revision && proof.reader_id === readerId ? proof.status : 'unverified';
    const retired = !!record.retired_at, selected = record.selected && !retired;
    const reasons = retired ? [] : !selected ? ['not_selected'] : transportFailed ? ['transport_failed'] :
      boundary === 'failed' ? ['boundary_failed'] : boundary !== 'verified' ? ['boundary_unverified'] : ['legacy_coverage_unknown'];
    if (retired && inspectSnapshot) {
      const snapshot = path.join(home, 'run-keep/roots/retired', id + '.json');
      if (!fs.existsSync(snapshot)) reasons.push('not_found');
      else try {
        const frozen = readJSON(snapshot);
        if (frozen.version !== 1 || frozen.no_saved_scan !== true || frozen.last_scan_at !== null || frozen.since !== record.registered_at ||
            !Array.isArray(frozen.source_ids) || frozen.source_ids.length || !collections.every(k => Array.isArray(frozen[k]) && frozen[k].length === 0) ||
            !frozen.source_roots?.some(r => r.id === id && r.lifecycle === 'retired')) reasons.push('parse_error');
      } catch { reasons.push('parse_error'); }
    }
    const status = retired ? 'retired' : selected ? 'unreadable' : 'left_out';
    return { id, machine_id: machineId, reader_id: readerId, canonical_id: null, revision: record.revision, registered_at: record.registered_at,
      selected: record.selected, lifecycle: retired ? 'retired' : 'active', status, reasons, attempted_at: selected ? attemptedAt : null,
      last_scan_at: record.last_scan_at, retired_at: record.retired_at, window: { from: null, to: null, complete: false }, boundary,
      sources: record.spec.sources.map(binding => ({ id: rootHash(store.key, 'binding-v1', [id, binding]), kind: binding.kind, status, reasons,
        source_ids: [], account: { status: 'disabled', rows_unknown: 0 }, model: { status: 'disabled', rows_unknown: 0 }, mapping: { status: 'disabled', reasons: [] } })),
      attribution: { account_complete: false, model_complete: false, unattributed_rows: 0, unattributed_output_tokens: 0,
        unattributed_api_value_usd: 0, model_unknown_rows: 0, unpriced_rows: 0 }, retained: [] };
  });
}
export function saveRootCoverage(home, machine, roots) {
  for (const root of roots) {
    const file = path.join(home, 'run-keep/roots', root.id + '.json');
    const prior = fs.existsSync(file) ? readJSON(file) : {};
    privateWrite(file, JSON.stringify({ version: 1, machine, source_roots: [root], generated_at: new Date().toISOString(),
      registered_at: root.registered_at, last_scan_at: root.last_scan_at || prior.last_scan_at || null,
      no_saved_scan: prior.no_saved_scan !== false && !root.last_scan_at, source_ids: prior.source_ids || [] }));
  }
}

const localIdentity = () => ({ host: os.hostname(), os: process.platform, uid: process.geteuid?.() ?? null, gid: process.getegid?.() ?? null });
function savedMachineId(home, store, machine) {
  const file = path.join(home, 'run-keep', machine + '.json');
  if (!fs.existsSync(file)) return null;
  try { const scan = readEvidence(file); return HASH.test(scan.machine_id) ? scan.machine_id : null; }
  catch { return null; } // Unreadable/legacy evidence cannot establish identity.
}
export function initializeRootStore(home, store) {
  if (store.key) return;
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    store.key = crypto.randomBytes(32);
    fs.writeFileSync(path.join(home, 'source-roots.key'), store.key, { flag: 'wx', mode: 0o600 });
    privateWrite(path.join(home, 'source-roots.json'), JSON.stringify(store.state));
  } catch { throw new RootError('cannot initialize private source-root identity store', 1); }
}
const identityScript = 'import json,socket,os,sys\nprint(json.dumps({"host":socket.gethostname(),"os":sys.platform,"uid":os.geteuid(),"gid":os.getegid()}))\n';
function probeIdentity(machine, py) {
  const args = machine === 'local' ? ['-'] : ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', machine, 'env PYTHONDONTWRITEBYTECODE=1 python3 -'];
  const r = spawnSync(machine === 'local' ? py : 'ssh', args, { input: identityScript, encoding: 'utf8', timeout: 15000, maxBuffer: 8192,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  let value;
  try { value = JSON.parse(r.stdout); } catch { return null; }
  if (r.error || r.status !== 0 || !value || Object.keys(value).sort().join(',') !== 'gid,host,os,uid' ||
      typeof value.host !== 'string' || !value.host.length || value.host.length > 256 || /[\x00-\x1f\x7f]/.test(value.host) ||
      typeof value.os !== 'string' || !/^[a-z0-9_]{1,32}$/.test(value.os) || !Number.isSafeInteger(value.uid) || value.uid < 0 || !Number.isSafeInteger(value.gid) || value.gid < 0) return null;
  return value;
}
// Establish once, before concurrent scanner/meter lanes. Identity-only probes carry
// no paths/spec/key and their bounded raw pipes are consumed only in memory.
export function sourceRootPolicy(home, aliases = []) {
  aliases = activeHosts(home, aliases);
  const store = readSourceRoots(home);
  initializeRootStore(home, store);
  const machines = new Set(['local', ...aliases, ...Object.keys(store.state.machines), ...storedRootCoverage(home).map(r => r.machine).filter(Boolean)]);
  const declared = new Map(), identity = new Map(), withheld = new Set(), unknown = new Set();
  const established = new Map();
  for (const machine of machines) {
    const roots = sourceRootsFor(home, store, machine);
    if (roots.length) { declared.set(machine, roots); withheld.add(machine); }
  }
  // Default-only stores retain their existing saved-scan error/reuse behavior.
  if (!declared.size) return { store, declared, identity, withheld, unknown };
  for (const machine of machines) {
    const id = store.state.machines[machine]?.machine_id || storedRootCoverage(home).find(r => r.machine === machine)?.machine_id || savedMachineId(home, store, machine);
    if (id) established.set(machine, id);
  }
  const rootIds = new Set([...declared.keys()].map(machine => established.get(machine)).filter(Boolean));
  if (declared.size) {
    const py = ['python3', 'python'].find(name => spawnSync('which', [name], { stdio: 'ignore' }).status === 0);
    if (!py) throw new RootError('Python 3 is needed for source-root identity preflight');
    for (const machine of new Set(['local', ...aliases])) {
      const current = probeIdentity(machine, py);
      if (current) identity.set(machine, current);
      const id = current ? rootHash(store.key, 'machine-v1', [current.host]) : null;
      const prior = established.get(machine);
      if (declared.has(machine) || rootIds.has(id) || rootIds.has(prior)) withheld.add(machine);
      if (withheld.has(machine) && (!id || (prior && id !== prior))) unknown.add(machine);
    }
  }
  return { store, declared, identity, withheld, unknown };
}
