// PR 153 M1/M3 regressions. Both use the existing synthetic reader and store.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository, readJSON, writeJSON, output } from '../../support/source-roots.mjs';

const calls = h => fs.readFileSync(path.join(h.base, 'transport.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
function addRemote(h, spec = h.spec) {
  const file = path.join(h.base, 'review-spec.json'); writeJSON(file, spec);
  const result = h.cli(['hosts', 'roots', 'add', 'synthetic-remote', '--file', file]);
  assert.equal(result.status, 0, 'review setup: offline registration uses an established saved machine_id');
  return JSON.parse(result.stdout);
}

export function unrelatedDefaultCwd(h) {
  const prefix = path.join(h.base, 'prefix-root'), cwd = prefix + '-old/project';
  const usage = path.join(h.home, '.claude/projects/default/usage.jsonl');
  const record = JSON.parse(fs.readFileSync(usage, 'utf8').trim()); record.cwd = cwd;
  fs.writeFileSync(usage, JSON.stringify(record) + '\n');
  const baseline = h.collect(['synthetic-remote']);
  const savedFile = path.join(h.store, 'run-keep/local.json'), before = fs.readFileSync(savedFile);
  assert.equal(output(baseline.scans['local.json']), 10);
  assert.ok(baseline.scans['local.json'].sessions.some(session => session.cwd === cwd), 'M1 setup: actual default scanner emits the absolute prefix-path cwd');
  addRemote(h, { ...h.spec, path: prefix });
  const result = h.collect(['synthetic-remote']), after = fs.readFileSync(savedFile);
  const unchangedCwd = result.scans['local.json'].sessions.some(session => session.cwd === cwd);
  writeJSON(path.join(h.base, 'm1-proof.json'), { cwd, prefix, before: JSON.parse(before), after: JSON.parse(after),
    bytes_equal: before.equals(after), original_cwd_present: unchangedCwd, local_saved_only: result.info.local_saved_only });
  assert.equal(result.info.local_saved_only, false, 'M1 setup: the local physical machine is unrelated to the declared remote');
  assert.equal(before.equals(after), true, 'M1 unrelated default-only run-keep bytes changed');
  assert.equal(unchangedCwd, true, 'M1 unrelated default-only cwd changed');
}

export function failedProbeSharedMachine(h) {
  const first = h.collect(['synthetic-remote']);
  const declaredFile = path.join(h.store, 'run-keep/synthetic-remote.json');
  const legacyFile = path.join(h.store, 'run-keep/synthetic-alias.json');
  const established = readJSON(declaredFile), legacy = structuredClone(established);
  assert.match(established.machine_id, /^[a-f0-9]{64}$/);
  delete legacy.machine_id; writeJSON(legacyFile, legacy);
  const declaredBefore = fs.readFileSync(declaredFile), legacyBefore = fs.readFileSync(legacyFile);
  const root = addRemote(h);
  // The shared remote gets new usage only after its saved answers were captured.
  const record = JSON.parse(fs.readFileSync(path.join(h.home, '.claude/projects/default/usage.jsonl'), 'utf8').trim());
  record.sessionId = record.requestId = record.message.id = 'synthetic-new-shared-usage';
  record.message.usage.output_tokens = 900;
  const file = path.join(h.base, 'remote-home/.claude/projects/new/usage.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(record) + '\n');
  h.clearTrace();
  const result = h.collect(['synthetic-remote', 'synthetic-alias'], { SOURCE_ROOT_TRANSPORT: 'legacy-probe-fails' });
  const outcomes = fs.readFileSync(path.join(h.base, 'transport-results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const answered = outcomes.find(row => row.alias === 'synthetic-alias' && !row.identity_probe && row.code === 0);
  assert.ok(outcomes.some(row => row.alias === 'synthetic-alias' && row.identity_probe && row.code === 77), 'M3 setup: legacy alias identity probe actually fails');
  assert.ok(outcomes.some(row => row.alias === 'synthetic-alias' && !row.identity_probe && row.code === 0), 'M3 setup: the same alias full scanner actually answers');
  assert.equal(answered.host, established.host, 'M3 setup: actual full response matches the declared established physical host');
  assert.equal(answered.output, 900, 'M3 setup: actual full response contains new usage to discard');
  const transport = calls(h).filter(row => row.mode === 'legacy-probe-fails');
  assert.equal(transport.filter(row => row.identity_probe && row.args.at(-2) === 'synthetic-alias').length, 1);
  assert.equal(transport.filter(row => !row.identity_probe && row.args.at(-2) === 'synthetic-alias').length, 1);
  const freshOutput = Object.entries(result.scans).filter(([name]) => name !== 'local.json').reduce((sum, [, scan]) => sum + output(scan), 0);
  const shaped = h.evaluate(`
    import {analyse,buildData} from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/collect.mjs')).href)};
    const info=${JSON.stringify(result.info)};
    const report=await analyse(info.runDir);
    const data=buildData(report,null,{days:21,hosts:['synthetic-remote','synthetic-alias']},info);
    console.log(JSON.stringify({missing:data.machines_missing,roots:data.source_roots,output:data.totals.output_tokens}));
  `);
  const proof = { established_machine_id: established.machine_id, saved_host: established.host,
    scanner_host: answered.host,
    outcomes, fresh_output: freshOutput, total_output: shaped.output,
    declared_keep_equal: declaredBefore.equals(fs.readFileSync(declaredFile)), legacy_keep_equal: legacyBefore.equals(fs.readFileSync(legacyFile)),
    legacy_missing: shaped.missing.some(row => row.machine === 'synthetic-alias'),
    root_identity_unknown: shaped.roots.some(row => row.id === root.id && row.reasons.includes('identity_unknown')) };
  writeJSON(path.join(h.base, 'm3-proof.json'), proof);
  assert.equal(proof.scanner_host, established.host, 'M3 setup: the answered scanner shares the declared established physical host');
  assert.equal(freshOutput, 0, 'M3 fresh shared-machine usage admitted after failed identity probe');
  assert.equal(proof.total_output, output(first.scans['local.json']), 'M3 only unrelated local usage may contribute');
  assert.equal(proof.declared_keep_equal, true, 'M3 declared saved scan changed');
  assert.equal(proof.legacy_keep_equal, true, 'M3 legacy saved scan changed');
  assert.equal(proof.legacy_missing, true, 'M3 discarded fresh answer must remain missing');
  assert.equal(proof.root_identity_unknown, true, 'M3 relevant root coverage must disclose identity_unknown');
}
