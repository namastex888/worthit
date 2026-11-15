import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { expectedData } from '../../support/expected-data.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(folder, '../../..');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const expected = expectedData(path.join(folder, 'expected-data.json'));
const isolated = isolatedEnvironment(), { tmp, bin, home, env } = isolated;
Object.assign(env, { NODE_OPTIONS: `--import=${path.join(root, 'test/support/clock.mjs')}`, PYTHONPATH: path.join(root, 'test/support'),
  FIXTURE_MODE: path.join(tmp, 'mode'), FIXTURE_TRACE: path.join(tmp, 'commands.jsonl'), FIXTURE_AUDIT: path.join(tmp, 'audit.log') });
const day = '2026-11-10', emptyDay = '2026-11-11';
const run = args => {
  const r = spawnSync(process.execPath, args, { cwd: tmp, env, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr || r.error || r.stdout}`);
  return JSON.parse(r.stdout);
};
const meterFile = path.join(env.METER_STATE_DIR, 'meter.db'), repo = path.join(tmp, 'repo');
const seed = () => {
  fs.rmSync(env.WORTHIT_HOME, { recursive: true, force: true }); fs.mkdirSync(env.WORTHIT_HOME);
  fs.writeFileSync(path.join(env.WORTHIT_HOME, 'history.json'), JSON.stringify({ days: {
    [day]: { out: 0, usd: 0, prs: 9, commits: 8 }, [emptyDay]: { out: 0, usd: 0, prs: 7, commits: 6 },
  } }));
  const db = new DatabaseSync(path.join(env.WORTHIT_HOME, 'worthit.db'));
  db.exec("CREATE TABLE day (day TEXT PRIMARY KEY, prs INTEGER, commits INTEGER); INSERT INTO day VALUES ('2026-11-10', 9, 8), ('2026-11-11', 7, 6)"); db.close();
};
const stored = (prs, commits, emptyPrs, emptyCommits) => {
  const history = JSON.parse(fs.readFileSync(path.join(env.WORTHIT_HOME, 'history.json'))).days;
  const db = new DatabaseSync(path.join(env.WORTHIT_HOME, 'worthit.db'), { readOnly: true });
  const rows = db.prepare('SELECT * FROM day ORDER BY day').all(); db.close();
  const expected = [{ day, prs, commits }, { day: emptyDay, prs: emptyPrs, commits: emptyCommits }];
  assert.deepEqual(rows.map(r => ({ ...r })), expected, 'SQLite daily counts');
  assert.deepEqual(Object.entries(history).map(([day, r]) => ({ day, prs: r.prs, commits: r.commits })).sort((a, b) => a.day.localeCompare(b.day)), expected, 'history daily counts');
};
const trace = () => fs.existsSync(env.FIXTURE_TRACE) ? fs.readFileSync(env.FIXTURE_TRACE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const auditedCommands = (mode, calls) => {
  const entries = fs.readFileSync(env.FIXTURE_AUDIT, 'utf8').split('\n').flatMap(line => {
    const match = /^\S+\s+(run|net)\s+(\S+)(.*)$/.exec(line);
    return match ? [{ kind: match[1], text: (path.basename(match[2]) + match[3]).replaceAll('"', '').replace(/\s{2,}\(.*$/, '') }] : [];
  });
  for (const entry of entries) if (/^(gh|glab|tea) api /.test(entry.text)) assert.equal(entry.kind, 'net', `${mode}: ${entry.text} is network activity`);
  for (const { command, args } of calls.filter(x => ['gh', 'usagemeter', 'tea', 'glab'].includes(x.command))) {
    // gh's audit displays the endpoint, search and pagination; output-format flags are omitted.
    const shown = command === 'gh' && args[0] === 'api' ? ['api', 'search/issues', args.find(x => x.startsWith('q=')), '--paginate'] : args;
    const text = [command, ...shown].join(' '), index = entries.findIndex(entry => entry.text === text);
    assert.ok(index >= 0, `${mode}: audit records ${text}`);
    entries.splice(index, 1); // Repeated calls need separate audit entries.
  }
};
const collect = mode => {
  fs.writeFileSync(env.FIXTURE_MODE, mode); const start = trace().length, data = run([path.join(folder, 'collect.mjs')]);
  auditedCommands(mode, trace().slice(start)); return data;
};
const coverage = (data, prs, commits, failed) => {
  assert.equal(data.git.coverage.prs, prs); assert.equal(data.git.coverage.commits, commits);
  assert.deepEqual(data.git.coverage.sources.filter(x => !x.answered).map(x => x.source), failed);
  const audit = fs.readFileSync(env.FIXTURE_AUDIT, 'utf8');
  for (const source of failed) assert.ok(audit.includes(`git source ${source}: FAILED`), `audit names ${source}`);
};
try {
  fs.mkdirSync(env.METER_STATE_DIR, { recursive: true }); fs.mkdirSync(repo);
  const meter = new DatabaseSync(meterFile);
  meter.exec('CREATE TABLE pr (repo TEXT, pr INTEGER, merged_ms INTEGER); CREATE TABLE cwd_repo (repo TEXT, cwd TEXT, checked_ms INTEGER)');
  meter.exec("INSERT INTO pr VALUES ('example/project', 1, 1794322800000), ('example/project', 2, 1794322800000)");
  meter.prepare('INSERT INTO cwd_repo VALUES (?, ?, ?)').run('example/project', repo, 0);
  // Published meter: a main Claude transcript stores cwd alone; sub-agents also store session context.
  meter.exec('CREATE TABLE sessions (harness TEXT, session TEXT, parent_session TEXT, first_ms INTEGER, last_ms INTEGER, PRIMARY KEY(harness, session)); CREATE TABLE files (path TEXT PRIMARY KEY, source TEXT, mtime_ms INTEGER NOT NULL, ctx TEXT)');
  meter.prepare('INSERT INTO sessions VALUES (?, ?, NULL, ?, ?)').run('claude-code', 'fixture-session', 1794322800000, 1794322800000);
  const mainLog = path.join(tmp, 'fixture-session.jsonl'), subLog = path.join(tmp, 'fixture-session/subagents/agent-sub.jsonl');
  meter.prepare('INSERT INTO files VALUES (?, ?, ?, ?)').run(mainLog, 'claude-code', 1794322800000, JSON.stringify({ cwd: repo }));
  meter.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('claude-code', 'agent-sub', 'fixture-session', 1794322800000, 1794322800000);
  meter.prepare('INSERT INTO files VALUES (?, ?, ?, ?)').run(subLog, 'claude-code', 1793447999999, JSON.stringify({ session: 'agent-sub', parent_session: 'fixture-session', cwd: repo, parent_cwd: repo }));
  meter.close();
  const install = command => fs.writeFileSync(path.join(bin, command), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(folder, 'commands.mjs'))} ${command} \"$@\"\n`, { mode: 0o755 });
  for (const command of ['usagemeter', 'git', 'gh', 'glab', 'tea']) install(command);
  // The CLI --json path uses an empty synthetic scanner home, never the person's store.
  seed(); fs.writeFileSync(env.FIXTURE_MODE, 'meter-sync');
  const failedCLI = run([path.join(root, 'bin/worthit.mjs'), '--json', '--no-files', '--hosts', 'none', '--git', 'yes', '--ai', 'no']);
  const check = (name, data, audit = true) => {
    const e = expected.get(name);
    if (audit) coverage(data, e.prs, e.commits, e.failed);
    else {
      assert.equal(data.git.coverage.prs, e.prs); assert.equal(data.git.coverage.commits, e.commits);
      assert.deepEqual(data.git.coverage.sources.filter(x => !x.answered).map(x => x.source), e.failed);
    }
    stored(...e.counts);
    if (e.live) assert.deepEqual({ prs: data.git.merged_prs, commits: data.git.commits, repos: data.git.repos }, e.live, `${name}: existing data still read`);
  };
  check('meter-sync', failedCLI, false);
  // Same store, same source rows: answering again replaces even the saved day with no new rows.
  const good = collect('good'); check('good', good);
  assert.deepEqual(good.git.coverage.sources, expected.get('all_sources'));
  for (const mode of ['meter-status', 'meter-budget', 'glab-host', 'gh-account', 'tea', 'gh-discovery', 'glab-discovery', 'tea-discovery', 'gh-malformed', 'glab-malformed', 'tea-malformed', 'gh-auth-error', 'glab-auth-error', 'git-log', 'tea-partial', 'logged-out', 'glab-self-hosted', 'glab-no-instances', 'gh-legacy']) {
    seed(); const traceStart = trace().length, data = collect(mode); check(mode, data);
    if (mode === 'logged-out') {
      assert.deepEqual(data.git.coverage.sources, expected.get('meter_only'));
      assert.ok(!fs.readFileSync(env.FIXTURE_AUDIT, 'utf8').includes('FAILED'));
    }
    if (mode === 'glab-self-hosted') {
      assert.deepEqual(data.git.coverage.sources, expected.get('self_hosted_sources'));
      const audit = fs.readFileSync(env.FIXTURE_AUDIT, 'utf8');
      assert.ok(audit.includes('glab gitlab.com has no token: skipped as a source'));
      assert.ok(!audit.includes('FAILED'));
      const calls = trace().slice(traceStart);
      assert.ok(calls.some(x => x.command === 'glab' && x.args[0] === 'api' && x.args[2] === 'forge-a.test'));
      assert.ok(!calls.some(x => x.command === 'glab' && x.args[0] === 'api' && x.args[2] === 'gitlab.com'));
    }
    if (mode === 'gh-legacy') assert.deepEqual(data.git.coverage.sources, expected.get('legacy_sources'));
    if (mode === 'glab-host') assert.equal(data.git.coverage.sources.find(x => x.source === 'glab:forge-a.test').answered, true);
  }
  for (const command of ['gh', 'glab', 'tea']) fs.unlinkSync(path.join(bin, command));
  seed(); const absent = collect('good'); check('no-forges', absent);
  assert.deepEqual(absent.git.coverage.sources, expected.get('meter_only'));
  assert.ok(!fs.readFileSync(env.FIXTURE_AUDIT, 'utf8').includes('FAILED'));
  for (const command of ['gh', 'glab', 'tea']) install(command);
  const missingCwd = path.join(tmp, 'deleted');
  const d = new DatabaseSync(meterFile); d.prepare('INSERT INTO cwd_repo VALUES (?, ?, ?)').run('example/project', missingCwd, 1); d.close();
  seed(); check('two-cwds', collect('good'));
  fs.rmdirSync(repo);
  for (const [name, mtime, sessionAt] of [
    ['mtime-recent-no-checkout', 1794322800000, 1793447999999],
    ['mtime-boundary-no-checkout', 1793448000000, 1793447999999],
    ['mtime-old-no-checkout', 1793447999999, 1793447999999],
    ['session-recent-no-checkout', 1793447999999, 1794322800000],
    ['session-boundary-no-checkout', 1793447999999, 1793448000000],
    ['session-old-no-checkout', 1793447999999, 1793447999999],
  ]) {
    // Make the other path stale in every control: only mtime OR only the exact session can retain.
    const d = new DatabaseSync(meterFile);
    d.exec('UPDATE files SET mtime_ms = 1793447999999; UPDATE sessions SET first_ms = 1793447999999, last_ms = 1793447999999');
    d.prepare('UPDATE files SET mtime_ms = ? WHERE path = ?').run(mtime, path.join(tmp, 'fixture-session.jsonl'));
    d.prepare('UPDATE sessions SET first_ms = ?, last_ms = ? WHERE session = ?').run(sessionAt, sessionAt, 'agent-sub');
    assert.deepEqual(JSON.parse(d.prepare('SELECT ctx FROM files WHERE path = ?').get(path.join(tmp, 'fixture-session.jsonl')).ctx), { cwd: repo });
    d.close();
    seed(); check(name, collect('good'));
    const audit = fs.readFileSync(env.FIXTURE_AUDIT, 'utf8');
    assert.ok(audit.includes('1 repos have no checkout left; their commits from earlier runs are kept while the repo had a session in the last 14 days'));
    assert.ok(!audit.includes('FAILED'), 'no checkout is not a failed source');
  }
  fs.mkdirSync(repo);
  // An older meter can lack a query table. Keep the readable repo's live logs and protect commits.
  const oldMeter = new DatabaseSync(meterFile);
  oldMeter.prepare('INSERT INTO cwd_repo VALUES (?, ?, ?)').run('example/missing', path.join(tmp, 'missing-repo'), 0);
  oldMeter.exec('DROP TABLE sessions'); oldMeter.close();
  seed(); check('missing-query-table', collect('good'));
  assert.ok(fs.readFileSync(env.FIXTURE_AUDIT, 'utf8').includes('no-checkout recency query unavailable'));
  seed(); const db = new DatabaseSync(meterFile); db.exec("DELETE FROM cwd_repo WHERE repo = 'example/missing'; DELETE FROM pr"); db.close();
  check('empty', collect('empty'));
  expected.done();
  assert.ok(!fs.readFileSync(env.FIXTURE_TRACE, 'utf8').includes('"unexpected"'), 'all source calls were stubbed');
  const schema = run([path.join(root, 'bin/worthit.mjs'), 'schema']); assert.ok(schema['git.coverage']);
  console.log('git-source-coverage: failed sources preserve both stores; recovery and independent metrics replace; traced forge/meter commands audited, API calls net');
} finally { isolated.cleanup(); }
