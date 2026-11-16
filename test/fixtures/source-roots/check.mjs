import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceRootsHarness, repository, output, writeJSON } from '../../support/source-roots.mjs';
import { withWal } from '../../support/source-root-wal.mjs';
import { future } from './future.mjs';
import { activated } from './activation.mjs';

const option = process.argv[2];
assert.ok(!option || option === '--future' || option.startsWith('--future='), 'use check.mjs [--future[=scenario-id]]');
const focused = option?.startsWith('--future=') ? option.slice('--future='.length) : null;
const selected = option ? future.filter(row => !focused || row.id === focused) : [];
if (option) assert.ok(selected.length, 'unknown future scenario id');
assert.equal(new Set(future.map(row => row.id)).size, future.length, 'scenario ids are unique');
assert.ok([...activated].every(id => future.some(row => row.id === id)), 'activation cannot name an absent assertion');
let active = 0, failed = 0;

async function scenario(id, run) {
  const h = sourceRootsHarness(id);
  try { await run(h); active++; console.log(`source-roots: PASS ${id}`); }
  catch (error) {
    failed++;
    // Assertion details remain private: child errors may contain generated paths.
    fs.writeFileSync(path.join(h.base, 'assertion.txt'), error.stack || String(error));
    console.error(`source-roots: FAIL ${id}: ${String(error.message).split('\n')[0].replaceAll(h.base, '<fixture>')}`);
  } finally { h.cleanup(); }
}

if (option) {
  for (const row of selected) await scenario(row.id, row.run);
  console.log(`source-roots future: ${active} passed, ${failed} failed; ${future.length - selected.length} not selected`);
} else {
  await scenario('existing-sentinel-denials', h => {
    for (const sentinel of h.manifest.sentinels) {
      for (const file of [sentinel.path, ...sentinel.aliases]) assert.ok(fs.statSync(file).isFile(), 'sentinel exists before denial');
    }
    h.secureBoundary(); h.clearTrace();
    for (const file of h.protectedPaths()) {
      const result = h.json(h.python, [h.helper, 'operator', file], { env: { ...h.env, SOURCE_ROOT_ACTOR: 'operator' } });
      assert.equal(result.boundary, 'verified', 'existing credential/raw-config inode requires actual OS denial');
      assert.ok(['EACCES', 'EPERM'].includes(result.open));
    }
    assert.equal(h.forbidden(h.rows()).length, 0, 'operator probes are not scanner probes');
    assert.ok(h.rows().some(row => row.actor === 'operator' && row.op === 'stat'));
  });
  await scenario('mount-boundary-simulation', h => {
    const sentinel = path.join(h.manifest.traversal, 'auth.json');
    assert.ok(fs.statSync(sentinel).isFile(), 'operator attests deployment sentinel existence before traversal denial');
    h.deny(h.manifest.traversal, true);
    const result = h.json(h.python, [h.helper, 'operator', sentinel], { env: { ...h.env, SOURCE_ROOT_ACTOR: 'operator' } });
    assert.equal(result.boundary, 'verified'); assert.ok(['EACCES', 'EPERM'].includes(result.stat), 'denied ancestor traversal is distinct from ENOENT');
  });
  await scenario('absent-is-unverified', h => {
    const result = h.json(h.python, [h.helper, 'operator', path.join(h.manifest.root, 'not-present/auth.json')], { env: { ...h.env, SOURCE_ROOT_ACTOR: 'operator' } });
    assert.equal(result.open, 'ENOENT'); assert.equal(result.boundary, 'unverified');
  });
  await scenario('readable-raw-rejects-boundary', h => {
    const result = h.json(h.python, [h.helper, 'operator', h.protectedPaths()[0]], { env: { ...h.env, SOURCE_ROOT_ACTOR: 'operator' } });
    assert.equal(result.open, 'opened-unread'); assert.equal(result.boundary, 'failed');
  });
  await scenario('default-positive-undeclared-negative', h => {
    h.secureBoundary(); h.clearTrace(); const scan = h.scanner();
    assert.equal(output(scan), 10, 'unchanged default-home usage remains useful');
    assert.ok(h.rows().some(row => row.actor === 'scanner' && row.op === 'open' && row.outcome === 'returned' && row.path.endsWith('/default/usage.jsonl')), 'positive trace control proves instrumentation is active');
    assert.equal(h.rows().filter(row => row.actor === 'scanner' && row.path.startsWith(h.manifest.root)).length, 0, 'undeclared extra roots are not scanned');
    assert.equal(h.forbidden(h.rows()).length, 0);
  });
  await scenario('poison-read-is-caught', h => {
    h.secureBoundary(); h.clearTrace();
    h.ok(h.python, [h.helper, 'forbidden', h.protectedPaths()[0]]);
    assert.ok(h.forbidden(h.rows()).some(row => row.op === 'open'), 'deliberately forbidden synthetic read must trip trace checker');
    assert.ok(h.forbidden(h.rows()).some(row => /^errno:(1|13)$/.test(row.outcome)), 'OS denied the poisoned read');
  });
  await scenario('physical-link-controls', h => {
    assert.equal(h.manifest.links.length, 16, 'two symlinks and two hardlinks for Claude, Codex, DB and limits file');
    for (const { original, alias } of h.manifest.links) {
      const first = fs.statSync(original), second = fs.statSync(alias);
      assert.equal(first.dev, second.dev); assert.equal(first.ino, second.ino);
    }
    assert.notEqual(fs.statSync(path.join(h.manifest.meter, 'meter.db')).ino, fs.statSync(path.join(h.manifest.root, 'other-meter/meter.db')).ino);
    const ids = h.json(h.python, ['-c', 'import json,sqlite3,sys; print(json.dumps([sqlite3.connect("file:"+p+"?mode=ro",uri=True).execute("select id from usage").fetchone()[0] for p in sys.argv[1:]]))', path.join(h.manifest.meter, 'meter.db'), path.join(h.manifest.root, 'other-meter/meter.db')]);
    assert.deepEqual(ids, ['colliding-row', 'colliding-row']);
  });
  await scenario('synthetic-ssh-success', h => {
    const scanner = fs.readFileSync(path.join(repository, 'core/extract_usage.py'), 'utf8');
    const result = h.run(path.join(h.bin, 'ssh'), ['-o', 'BatchMode=yes', 'synthetic-remote', 'env WORTHIT_PROGRESS=1 python3 - 21'], { input: scanner });
    assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).host, 'synthetic-physical-remote');
    const calls = fs.readFileSync(path.join(h.base, 'transport.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 1); assert.equal(calls[0].bytes, Buffer.byteLength(scanner));
  });
  for (const [mode, status] of [['offline', 255], ['truncated', 74], ['interrupted', 75]]) await scenario('synthetic-ssh-' + mode, h => {
    const scanner = fs.readFileSync(path.join(repository, 'core/extract_usage.py'), 'utf8');
    const result = h.run(path.join(h.bin, 'ssh'), ['synthetic-remote', 'env WORTHIT_PROGRESS=1 python3 - 21'], { input: scanner, env: { ...h.env, SOURCE_ROOT_TRANSPORT: mode } });
    assert.equal(result.status, status);
    if (mode === 'truncated') assert.throws(() => JSON.parse(result.stdout));
    const collected = h.collect(['synthetic-remote'], { SOURCE_ROOT_TRANSPORT: mode });
    assert.equal(collected.info.hosts[0].ok, false, 'failed transport never becomes a fresh answer');
    assert.equal(output(collected.scans['local.json']), 10);
  });
  await scenario('wal-snapshot-control', async h => {
    await withWal(h, directory => {
      const scan = h.scanner({ METER_STATE_DIR: directory });
      assert.equal(scan.meter_usage.reduce((sum, row) => sum + row[7], 0), 30, 'reader sees committed WAL value, never uncommitted 999');
    });
  });
  for (const row of future.filter(row => activated.has(row.id))) await scenario(row.id, row.run);
  const pending = future.filter(row => !activated.has(row.id));
  for (const row of pending) console.log(`source-roots: PENDING ${row.id} | ${row.owner} | RFC0006 ${row.reference} | ${row.assertion}`);
  console.log(`source-roots: ${active} active controls passed, ${failed} failed; ${pending.length} future assertions pending (not passes). Run check.mjs --future[=id] explicitly.`);
}
process.exitCode = failed ? 1 : 0;
