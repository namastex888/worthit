// B-only cases use A's existing synthetic harness; no reader or materializer fork.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceRootsHarness, repository, readJSON, writeJSON, output } from '../../support/source-roots.mjs';

export function noFreshUsageReads(h, home = h.home) {
  const roots = [h.manifest.root, ...['.claude', '.claude.json', '.codex', '.gemini', '.meter'].map(name => path.join(home, name))];
  const touches = h.rows().filter(row => ['scanner', 'collector'].includes(row.actor) && roots.some(root => row.path === root || row.path.startsWith(root + path.sep)));
  assert.equal(touches.length, 0, 'matched machines perform no default/root/raw-config content reads or path probes');
  assert.equal(h.forbidden(h.rows()).length, 0);
}
const invoke = (h, args, expected = 0) => {
  const result = h.cli(['hosts', 'roots', ...args]);
  assert.equal(result.status, expected, 'offline root command exit');
  assert.ok(!result.stdout.includes(h.manifest.root) && !result.stderr.includes(h.manifest.root));
  return result;
};
const transport = h => fs.existsSync(path.join(h.base, 'transport.jsonl')) ? fs.readFileSync(path.join(h.base, 'transport.jsonl'), 'utf8') : '';
const specFile = h => { const file = path.join(h.base, 'registration.json'); writeJSON(file, h.spec); return file; };
const withHarness = (name, run) => {
  const h = sourceRootsHarness(name);
  try { run(h); } finally { h.cleanup(); }
};

export function offlineRemoteIdentity() {
  withHarness('b-offline-remote-identity', h => {
    const file = specFile(h), savedFile = path.join(h.store, 'run-keep/synthetic-remote.json');
    const legacy = { host: 'synthetic-physical-remote', generated_at: h.env.FIXTURE_NOW, since: '2026-11-01T00:00:00Z',
      days: 21, stats: {}, errors: [], accounts: {}, buckets: [], meters: [], events: [], sessions: [], meter_usage: [], meter_readings: [], meter_fields: [] };
    writeJSON(savedFile, legacy);
    const refused = invoke(h, ['add', 'synthetic-remote', '--file', file], 2);
    assert.match(refused.stderr, /scan synthetic-remote once before adding a root/);
    assert.equal(transport(h), '', 'legacy host strings never trigger an add-time SSH probe');
    assert.equal(fs.existsSync(path.join(h.store, 'source-roots.key')), false, 'refused add does not invent a key or retrofit identity');
    assert.deepEqual(readJSON(savedFile), legacy);

    const normal = h.collect(['synthetic-remote']);
    assert.equal(output(normal.scans['local.json']), 10, 'default-only local behavior is unchanged');
    const saved = readJSON(savedFile);
    assert.match(saved.machine_id, /^[a-f0-9]{64}$/, 'only an ordinary answering scan establishes remote identity');
    const before = transport(h);
    invoke(h, ['add', 'synthetic-remote', '--file', file]);
    const root = JSON.parse(invoke(h, ['synthetic-remote']).stdout)[0];
    invoke(h, ['select', 'synthetic-remote', root.id, 'off']);
    invoke(h, ['select', 'synthetic-remote', root.id, 'on']);
    assert.equal(transport(h), before, 'add/list/select stay offline after identity is established');
    assert.equal(readJSON(path.join(h.store, 'source-roots.json')).machines['synthetic-remote'].machine_id, saved.machine_id);

    h.clearTrace();
    const matched = h.collect(['synthetic-remote', 'synthetic-alias']);
    assert.equal(matched.info.local_saved_only, false, 'an unrelated physical machine is not globally frozen');
    assert.equal(output(matched.scans['local.json']), 10);
    assert.ok(matched.info.hosts.every(row => row.files === 0), 'both aliases of the declared physical machine withhold fresh defaults');
    const probes = transport(h).slice(before.length).trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(probes.length, 2, 'selected aliases use identity-only scan preflight');
    const key = fs.readFileSync(path.join(h.store, 'source-roots.key'));
    assert.equal(key.length, 32);
    for (const call of probes) {
      const input = Buffer.from(call.input, 'base64').toString('utf8');
      assert.ok(input.includes('gethostname') && input.includes('geteuid'));
      assert.ok(!input.includes('token_semantics') && !input.includes(h.manifest.root));
      assert.ok(!input.includes(key.toString('hex')));
      assert.equal(call.keyInEnvironment, false);
    }
    noFreshUsageReads(h, path.join(h.base, 'remote-home'));

    const settings = path.join(h.store, 'source-roots.json'), bytes = fs.readFileSync(settings);
    const keyFile = path.join(h.store, 'source-roots.key');
    fs.renameSync(keyFile, keyFile + '.held');
    try { invoke(h, ['synthetic-remote'], 2); assert.deepEqual(fs.readFileSync(settings), bytes); }
    finally { fs.renameSync(keyFile + '.held', keyFile); }
  });
}

export function aliasAndMeterPolicy() {
  withHarness('b-alias-meter-policy', h => {
    const first = h.collect(), local = first.scans['local.json'];
    // A prior saved alias observation of this physical machine is synthetic store
    // evidence, not a host-name retrofit at add time or a C content-reader call.
    writeJSON(path.join(h.store, 'run-keep/synthetic-remote.json'), local);
    invoke(h, ['add', 'synthetic-remote', '--file', specFile(h)]);
    assert.equal(transport(h), '', 'registration uses the saved machine_id without connecting');
    fs.writeFileSync(path.join(h.bin, 'usagemeter'), '#!/bin/sh\n: > "$SOURCE_ROOT_BASE/meter-called"\nexit 77\n', { mode: 0o755 });
    h.clearTrace();
    const result = h.evaluate(`
      import {sourceRootPolicy} from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/source-roots.mjs')).href)};
      import {git,AUDIT} from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/collect.mjs')).href)};
      const hosts=['synthetic-remote','synthetic-alias'];
      const rootPolicy=sourceRootPolicy(process.env.WORTHIT_HOME,hosts);
      const answer=await git({hosts,rootPolicy},()=>{});
      console.log(JSON.stringify({withheld:[...rootPolicy.withheld],unknown:[...rootPolicy.unknown],answer,audit:AUDIT}));
    `);
    assert.ok(result.withheld.includes('local'), 'a declaration through another alias suppresses the matching local meter lane');
    assert.ok(result.withheld.includes('synthetic-remote'));
    assert.ok(result.withheld.includes('synthetic-alias'), 'a changed declared identity also withholds peers sharing that current identity');
    assert.ok(result.unknown.includes('synthetic-remote') && result.unknown.includes('synthetic-alias'));
    assert.equal(fs.existsSync(path.join(h.base, 'meter-called')), false, 'fresh meter sync never starts before/alongside the policy');
    assert.ok(!result.audit.some(line => /GET .*meter-lane|sync --no-publish|git -C /.test(line)));
    assert.ok(result.answer.coverage.sources.some(source => source.source === 'usagemeter' && source.answered === false), 'withheld meter lane retains truthful existing source coverage');
    noFreshUsageReads(h);
  });
}
