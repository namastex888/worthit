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
const collect = mode => { fs.writeFileSync(env.FIXTURE_MODE, mode); return run([path.join(folder, 'collect.mjs')]); };
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
  meter.prepare('INSERT INTO cwd_repo VALUES (?, ?, ?)').run('example/project', repo, 0); meter.close();
  for (const command of ['usagemeter', 'git', 'gh', 'glab', 'tea']) fs.writeFileSync(path.join(bin, command), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(folder, 'commands.mjs'))} ${command} \"$@\"\n`, { mode: 0o755 });
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
  };
  check('meter-sync', failedCLI, false);
  // Same store, same source rows: answering again replaces even the saved day with no new rows.
  const good = collect('good'); check('good', good);
  assert.deepEqual(good.git.coverage.sources, expected.get('all_sources'));
  for (const mode of ['meter-status', 'glab-host', 'gh-account', 'tea', 'gh-discovery', 'glab-discovery', 'git-log']) {
    seed(); const data = collect(mode); check(mode, data);
    if (mode === 'glab-host') assert.equal(data.git.coverage.sources.find(x => x.source === 'glab:forge-a.test').answered, true);
  }
  seed(); fs.rmdirSync(repo); check('missing-repo', collect('good'));
  fs.mkdirSync(repo);
  seed(); const db = new DatabaseSync(meterFile); db.exec('DELETE FROM pr'); db.close();
  check('empty', collect('empty'));
  expected.done();
  assert.ok(!fs.readFileSync(env.FIXTURE_TRACE, 'utf8').includes('"unexpected"'), 'all source calls were stubbed');
  const schema = run([path.join(root, 'bin/worthit.mjs'), 'schema']); assert.ok(schema['git.coverage']);
  console.log('git-source-coverage: failed sources preserve both stores; recovery and independent metrics replace');
} finally { isolated.cleanup(); }
