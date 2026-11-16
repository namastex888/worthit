// Real CLI -> collectors -> scan -> pricing -> model aggregation -> last.json -> lookup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
const folder = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(folder, '../../..');
const i = isolatedEnvironment(), { env, home, bin, python, tmp } = i;
Object.assign(env, { NODE_OPTIONS: `--import=${path.join(root, 'test/support/clock.mjs')}`, PYTHONPATH: path.join(root, 'test/support'), FIXTURE_MACHINE: 'box-a', FIXTURE_TRACE: path.join(tmp, 'commands.jsonl') });
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v); };
const run = (exe, args) => { const r = spawnSync(exe, args, { cwd: tmp, env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 << 20 }); assert.equal(r.status, 0, r.stderr || r.error); return r.stdout; };
const cli = args => JSON.parse(run(process.execPath, [path.join(root, 'bin/worthit.mjs'), ...args]));
try {
  // The stub accepts command as its first argument; wrappers keep executable paths synthetic.
  for (const name of ['gh', 'glab', 'usagemeter']) { write(path.join(bin, name), `#!/bin/sh\nexec '${process.execPath}' '${path.join(folder, 'forge-stub.mjs')}' '${name}' "$@"\n`); fs.chmodSync(path.join(bin, name), 0o755); }
  fs.mkdirSync(env.METER_STATE_DIR, { recursive: true });
  run(python, ['-c', "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.executescript('CREATE TABLE pr(repo TEXT,pr INTEGER,merged_ms INTEGER); CREATE TABLE cwd_repo(repo TEXT,cwd TEXT,checked_ms INTEGER)'); d.close()", path.join(env.METER_STATE_DIR, 'meter.db')]);
  const rows = [];
  for (const [name, url] of [['app-api', 'https://github.com/acme/app-api.git'], ['web-client', 'https://forge.example/acme/web-client.git']]) {
    const cwd = path.join(home, name); write(path.join(cwd, '.git/config'), `[remote "origin"]\n url = ${url}\n`);
    rows.push({ timestamp: '2026-11-12T12:00:00Z', sessionId: name, requestId: name, cwd, gitBranch: 'feat/example', message: { id: name, model: 'claude-sonnet-5-5', usage: { output_tokens: 100000 } } });
  }
  write(path.join(home, '.claude/projects/example/usage.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  write(path.join(env.WORTHIT_HOME, 'settings.json'), JSON.stringify({ projects: { first_pass_exclude: ['forge.example/acme/web-client'] } }));
  const d = cli(['--json', '--hosts', 'none', '--no-files']);
  assert.equal(d.git.merged_prs, 2); assert.equal(d.projects.rows.reduce((n, r) => n + r.merged_prs, 0), 2);
  assert.equal(d.projects.delivery.coverage.canonical_deliveries, 2);
  assert.ok(d.projects.delivery.deliveries.every(r => r.lead_model === 'claude-sonnet-5-5' && r.api_value_usd > 0));
  assert.equal(d.projects.delivery.deliveries.find(r => r.project.startsWith('github.com')).first_pass.state, 'first_try');
  assert.equal(d.projects.delivery.deliveries.find(r => r.project.startsWith('forge.example')).first_pass.state, 'not_measured');
  assert.ok(d.projects.delivery.coverage.forges.every(f => f.answered && ['metadata', 'commits', 'parents', 'diffs'].every(k => f[k].complete)));
  const saved = JSON.parse(fs.readFileSync(path.join(env.WORTHIT_HOME, 'last.json'))); assert.deepEqual(saved.projects, d.projects);
  const before = fs.readFileSync(env.FIXTURE_TRACE, 'utf8'); assert.deepEqual(cli(['get', 'projects.delivery.daily']), d.projects.delivery.daily);
  assert.equal(fs.readFileSync(env.FIXTURE_TRACE, 'utf8'), before, 'saved lookup makes no request');
  const off = cli(['--json', '--hosts', 'none', '--git', 'no', '--no-files']); assert.equal(off.projects.delivery, null);
  assert.equal(fs.readFileSync(env.FIXTURE_TRACE, 'utf8'), before, 'git off makes no metadata/network calls');
  assert.ok(!before.includes('unexpected')); console.log('delivery-pipeline: GitHub/self-managed GitLab collect/build/save/config/lookup and git-off passed');
} finally { i.cleanup(); }
