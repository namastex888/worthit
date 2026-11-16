import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { blocks } from '../../../src/draw.mjs';
import { cardSpec, cardHtml, deliveryText } from '../../../src/card.mjs';
import { expectedData } from '../../support/expected-data.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(folder, '../../..');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const expected = expectedData(path.join(folder, 'expected-data.json'));
const isolated = isolatedEnvironment(), { tmp, bin, home, env } = isolated;
Object.assign(env, { NODE_OPTIONS: `--import=${path.join(root, 'test/support/clock.mjs')}`, PYTHONPATH: path.join(root, 'test/support'),
  FIXTURE_MODE: path.join(tmp, 'mode'), FIXTURE_TRACE: path.join(tmp, 'commands.jsonl'), FIXTURE_AUDIT: path.join(tmp, 'audit.log'),
  GLAB_CHECK_UPDATE: 'true', GLAB_SHOW_WHATS_NEW: 'true' }); // Discovery must override inherited notice settings.
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
  for (const { command, args, authEnv } of calls.filter(x => ['gh', 'usagemeter', 'tea', 'glab'].includes(x.command))) {
    if (command === 'glab' && args.join(' ') === 'auth status') assert.deepEqual(authEnv,
      { GLAB_CHECK_UPDATE: 'false', GLAB_SHOW_WHATS_NEW: 'false' }, `${mode}: discovery disables update requests and notices`);
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
const coverage = (data, prs, commits, failed, name) => {
  assert.equal(data.git.coverage.prs, prs, `${name}: PR coverage`); assert.equal(data.git.coverage.commits, commits, `${name}: commit coverage`);
  assert.deepEqual(data.git.coverage.sources.filter(x => !x.answered).map(x => x.source), failed, `${name}: failed sources`);
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
    if (audit) coverage(data, e.prs, e.commits, e.failed, name);
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
    if (mode === 'glab-no-instances') assert.ok(fs.readFileSync(env.FIXTURE_AUDIT, 'utf8').includes('glab has no authenticated instance: skipped as a source'), `${mode}: real Fang frame is skipped`);
    if (mode === 'glab-host') assert.equal(data.git.coverage.sources.find(x => x.source === 'glab:forge-a.test').answered, true);
  }
  // Issue #54: supported host keys count literal MRs; glab's rejected port keys stay floors (#91).
  for (const mode of ['glab-ip', 'glab-port', 'glab-digit-tld', 'glab-bare', 'glab-localhost', 'glab-error-host', 'glab-malformed-before', 'glab-malformed-after', 'glab-orphan-body', 'glab-unreadable-body', 'glab-empty-block', 'glab-partial-errors', 'glab-footer']) {
    seed(); const start = trace().length, data = collect(mode), e = expected.get(mode);
    assert.equal(data.git.merged_prs, e.live.prs, `${mode}: literal merge request counted`);
    check(mode, data);
    assert.equal(data.git.sources.gitlab, e.keys.length, `${mode}: literal GitLab merge request count`);
    assert.ok(data.git.coverage.sources.some(x => x.source === 'glab:' + e.host && x.answered === !e.portRejected), `${mode}: host answer matches glab validation`);
    const calls = trace().slice(start).filter(x => x.command === 'glab' && x.args[0] === 'api');
    assert.deepEqual(calls.map(x => x.args), [['api', '--hostname', e.host, 'merge_requests?scope=created_by_me&state=merged&updated_after=2026-08-22T12:00:00.000Z&per_page=100&page=1']], `${mode}: exact configured key and relative REST request passed to glab`);
    const db = new DatabaseSync(path.join(env.WORTHIT_HOME, 'worthit.db'), { readOnly: true });
    assert.deepEqual(db.prepare('SELECT key FROM pr_kind ORDER BY key').all().map(x => x.key), e.keys, `${mode}: literal MR identity persisted`); db.close();
    const audit = fs.readFileSync(env.FIXTURE_AUDIT, 'utf8');
    if (e.portRejected) {
      assert.ok(audit.includes('GitLab: no usable answer from logged-in glab: using the pull requests already stored'), `${mode}: rejected hostname has no usable answer`);
      assert.equal(data.git.merged_prs_change_pct, null, `${mode}: rejected hostname is a floor`);
    } else if (e.line) assert.ok(audit.includes('glab discovery could not read') && audit.includes(e.line), `${mode}: unreadable line named`);
    else assert.ok(!audit.includes('FAILED'), `${mode}: complete host coverage`);
    console.log(`${mode}: ${e.portRejected ? 'port key rejected before request; no MR counted' : 'literal MR counted'}, exact subprocess target audited as net; coverage.prs=${e.prs}`);
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
  // Issue #52: real source failures pass through git(), buildData(), persistence and drawing.
  // All counts/titles come from the same meter/forge/log commands in each control.
  env.FIXTURE_DELIVERY = '1';
  const deliveryMeter = new DatabaseSync(meterFile);
  deliveryMeter.exec("INSERT INTO pr VALUES ('example/project', 1, 1794322800000), ('example/project', 2, 1794322800000)"); deliveryMeter.close();
  const proofExpected = expected.get('delivery-proof');
  for (const mode of ['meter-sync', 'gh-account', 'git-log', 'good']) {
    seed();
    // Old literal history makes both PR badges attainable in the measured control.
    const history = JSON.parse(fs.readFileSync(path.join(env.WORTHIT_HOME, 'history.json')));
    for (let i = 1; i <= 7; i++) history.days[`2026-10-${String(i).padStart(2, '0')}`] = { out: 1, usd: 100, prs: 1, commits: 1 };
    fs.writeFileSync(path.join(env.WORTHIT_HOME, 'history.json'), JSON.stringify(history));
    const data = collect(mode), covered = data.git.coverage.prs;
    assert.deepEqual([covered, data.git.coverage.commits], proofExpected[mode].coverage, `${mode}: independent proof`);
    assert.equal(data.git.merged_prs, 14); // 12 typed forge PRs plus 2 meter-only PRs
    assert.equal(data.git.commits, mode === 'git-log' ? 0 : 2);
    assert.deepEqual([data.git.merged_prs_change_pct, data.git.usd_per_pr_change_pct, data.delivery.features_change_pct, data.delivery.usd_per_feature_change_pct], proofExpected[mode].changes, `${mode}: delivery-proof changes`);
    assert.deepEqual(data.delivery.kinds.map(x => x.change_pct), covered ? [100, 100, null] : [null, null, null], `${mode}: every kind change`);
    assert.equal(data.git.usd_per_merged_pr, 200 / 14);
    assert.equal(data.delivery.usd_per_feature, 20);
    assert.deepEqual(data.game.personal_bests.filter(x => /PR/.test(x)), covered ? ['PRs merged in a week', 'lowest cost per PR'] : [], `${mode}: no floor badges`);
    const strip = lines => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
    const tiles = strip(blocks.Tiles(data)), delivery = strip(blocks.Delivery(data));
    assert.ok(tiles.includes(covered ? '14 PRs' : 'at least 14 PRs'), `${mode}: shipped proof`);
    assert.ok(tiles.includes(data.git.coverage.commits ? '2 commits' : `at least ${data.git.commits} commits`), `${mode}: commits independently floor`);
    if (data.git.coverage.commits) assert.ok(!tiles.includes('at least 2 commits'));
    if (!covered) {
      assert.ok(tiles.includes('partial PR count'));
      assert.ok(delivery.includes('at least 10'));
      assert.ok(delivery.includes('partial feature count'));
      assert.ok(!delivery.includes('vs prev 7 d'));
    } else assert.ok(delivery.includes('100%'));
    const spec = cardSpec('delivery', data), html = cardHtml(spec), text = deliveryText(data);
    assert.ok(!/at least \$/.test(tiles + delivery + html + text), `${mode}: costs are never floors`);
    assert.equal(spec.hero, '$20');
    assert.ok(spec.sub.includes(covered ? '50% vs last week' : 'at least 10 features'), `${mode}: delivery card proof`);
    assert.ok(text.includes(covered ? '50% vs last week' : 'at least 10 features'), `${mode}: share text proof`);
    if (!covered) {
      assert.ok(html.includes('partial feature count; not compared'));
      assert.ok(text.includes('partial feature count; not compared'));
      assert.ok(spec.rows.every(x => x.note.startsWith('at least ')));
      assert.ok(!html.includes('vs last week') && !text.includes('vs last week'));
    }
    if (env.WORTHIT_FIXTURE_ARTIFACTS) {
      fs.mkdirSync(env.WORTHIT_FIXTURE_ARTIFACTS, { recursive: true });
      fs.writeFileSync(path.join(env.WORTHIT_FIXTURE_ARTIFACTS, mode + '.json'), JSON.stringify(data, null, 2));
      fs.writeFileSync(path.join(env.WORTHIT_FIXTURE_ARTIFACTS, mode + '-dashboard.txt'), tiles + '\n' + delivery);
    }
  }
  expected.done();
  assert.ok(!fs.readFileSync(env.FIXTURE_TRACE, 'utf8').includes('"unexpected"'), 'all source calls were stubbed');
  const schema = run([path.join(root, 'bin/worthit.mjs'), 'schema']); assert.ok(schema['git.coverage']);
  console.log('git-source-coverage: failed sources preserve both stores; recovery and independent metrics replace; traced forge/meter commands audited, API calls net');
} finally { isolated.cleanup(); }
