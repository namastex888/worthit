// RFC 0004: real logs -> scanner/cache -> pricing -> buildData -> saved command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { buildProjects, projectsText, projectFromKey } from '../../../src/projects.mjs';
import { dataForAgent, redactProjects } from '../../../src/project-privacy.mjs';
import { cardSpec } from '../../../src/card.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const isolated = isolatedEnvironment(), { tmp, home, python, bin, env } = isolated;
Object.assign(env, { NODE_OPTIONS: `--import=${path.join(root, 'test/support/clock.mjs')}`, PYTHONPATH: path.join(root, 'test/support'), WORTHIT_PROGRESS: '1' });
delete env.WORTHIT_NO_CACHE;
const moduleUrl = name => pathToFileURL(path.join(root, name)).href;
const execute = (exe, args, extra = {}) => {
  const r = spawnSync(exe, args, { cwd: tmp, env: { ...env, ...extra }, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr || r.stdout); return r;
};
const node = code => execute(process.execPath, ['--input-type=module', '--eval', code]);
const cli = args => execute(process.execPath, [path.join(root, 'bin/worthit.mjs'), ...args]);
const write = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const jsonl = (f, rows) => write(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const repo = (name, url) => { const dir = path.join(tmp, name); write(path.join(dir, '.git/config'), url === null ? '[core]\n bare = false\n' : `[remote "origin"]\n url = ${url}\n`); return dir; };
const logs = path.join(home, '.claude/projects/example/usage.jsonl'), ts = '2026-11-13T15:00:00Z';
const claudeRow = (id, cwd) => ({ timestamp: ts, sessionId: 'one-session', requestId: id, ...(cwd === undefined ? {} : { cwd }), message: { id, model: 'claude-sonnet-5-5', usage: { output_tokens: 100000 } } });
const scan = extra => JSON.parse(execute(python, [path.join(root, 'core/extract_usage.py'), '21'], extra).stdout);
const reasons = ['outside_a_repository', 'no_origin', 'origin_not_supported', 'folder_gone', 'no_folder_read', 'saved_before_projects'];
const sum = (rows, k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
try {
  const a = repo('app', 'git@github.com:acme/App-API.git'), b = repo('web', 'https://fixture-secret@github.com/acme/web-client.git');
  const sub = path.join(a, 'src'); fs.mkdirSync(sub);
  const linked = path.join(tmp, 'linked'), gitdir = path.join(a, '.git/worktrees/linked');
  write(path.join(linked, '.git'), 'gitdir: ../app/.git/worktrees/linked\n'); write(path.join(gitdir, 'commondir'), '../..\n');
  const outside = path.join(home, 'outside'); fs.mkdirSync(outside);
  const noOrigin = repo('no-origin', null), alias = repo('alias', 'git@work-gh:acme/app-api.git');
  const port = repo('port', 'ssh://git@forge.example:2222/acme/app-api.git');
  const defaultPort = repo('default-port', 'ssh://git@github.com:22/acme/app-api.git');
  const secondPort = repo('second-port', 'ssh://git@forge.example:2223/acme/app-api.git');
  const gone = path.join(tmp, 'gone');
  const records = [a, sub, linked, b, outside, noOrigin, alias, port, defaultPort, secondPort, gone, undefined].map((cwd, i) => claudeRow(String(i), cwd));
  jsonl(logs, records);
  const codex = path.join(home, '.codex/sessions/usage.jsonl');
  jsonl(codex, [
    { timestamp: ts, type: 'session_meta', payload: { id: 'codex-session', cwd: gone, git: { repository_url: 'https://fixture-secret@github.com/acme/app-api.git' } } },
    { timestamp: ts, type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
    { timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 0, output_tokens: 100000 }, last_token_usage: { input_tokens: 0, output_tokens: 100000 } } } },
  ]);
  let s = scan(); assert.deepEqual(s.errors, []);
  assert.equal(sum(s.buckets, 'requests'), 13);
  assert.equal(s.buckets.filter(r => r.project === 'github.com/acme/app-api').length, 2, 'per-request projects split one Claude hour; identical live forms aggregate');
  assert.equal(sum(s.buckets.filter(r => r.project === 'github.com/acme/app-api'), 'requests'), 5, 'linked worktree (gitfile -> commondir) resolves to the main repository');
  for (const why of reasons.slice(0, 5)) assert.ok(s.buckets.some(b => b.project_why === why), why);
  for (const p of ['forge.example:2222/acme/app-api', 'forge.example:2223/acme/app-api', 'github.com/acme/web-client']) assert.ok(s.buckets.some(b => b.project === p));
  assert.ok(!JSON.stringify(s).includes('fixture-secret'), 'sanitized before transport');
  const cached = execute(python, ['-c', `import sqlite3,zlib,sys,json
c=sqlite3.connect(sys.argv[1]); rows=c.execute('select tail,data from files').fetchall()
assert all(b'fixture-secret' not in tail and b'fixture-secret' not in zlib.decompress(data) for tail,data in rows)
print(json.dumps(c.execute('select path,project,ver from folder_project').fetchall()))`, path.join(env.WORTHIT_HOME, 'scan-cache.db')]);
  assert.ok(JSON.parse(cached.stdout).some(r => r[0] === linked && r[1] === 'github.com/acme/app-api' && r[2] === 1));
  fs.rmSync(linked, { recursive: true });
  s = scan(); assert.equal(sum(s.buckets.filter(r => r.project === 'github.com/acme/app-api'), 'requests'), 5, 'deleted linked worktree remembered on cache replay');
  // A stale identity-rule version is ignored, and sanitized Codex URL precedes the remembered map.
  execute(python, ['-c', `import sqlite3,sys
c=sqlite3.connect(sys.argv[1]);c.execute('update folder_project set ver=0 where path=?',(sys.argv[2],));c.execute('insert or replace into folder_project values (?,?,?,1)',(sys.argv[3],'github.com/acme/web-client','2026-11-13T00:00:00Z'));c.commit()`, path.join(env.WORTHIT_HOME, 'scan-cache.db'), linked, gone]);
  s = scan(); assert.equal(sum(s.buckets.filter(r => r.project_why === 'folder_gone'), 'requests'), 1);
  assert.equal(s.buckets.find(r => r.provider === 'codex').project, 'github.com/acme/app-api');
  assert.equal(sum(scan({ WORTHIT_NO_CACHE: '1' }).buckets.filter(r => r.project_why === 'folder_gone'), 'requests'), 2);
  // Reused live folder replaces the remembered origin; duplicate and absent origins stay unsupported.
  fs.mkdirSync(linked); write(path.join(linked, '.git/config'), '[remote "origin"]\n url = https://github.com/acme/web-client.git\n');
  scan(); fs.rmSync(linked, { recursive: true });
  // Three Claude requests: live b, deleted linked after live origin reuse, and gone.
  // RFC 0004 section 1 uses the current-version remembered live map for a gone
  // folder without a Codex URL. The synthetic gone -> web-client row above stands
  // in for that prior live resolution; it remains attributed, not folder_gone.
  assert.equal(sum(scan().buckets.filter(r => r.project === 'github.com/acme/web-client'), 'requests'), 3);
  write(path.join(alias, '.git/config'), '[remote "origin"]\n url = https://github.com/acme/app-api.git\n url = https://github.com/acme/web-client.git\n');
  assert.ok(scan().buckets.some(r => r.project_why === 'origin_not_supported'));

  // Pricing uses real selected rows, including a zero-dollar dsh meter row and an old scan bucket.
  const run = path.join(tmp, 'run'); fs.mkdirSync(run);
  s = scan(); s.buckets.push({ ...s.buckets[0], session: 'old', project: undefined, project_why: undefined });
  s.meter_usage = [['zero-dsh', Date.parse(ts), 'dsh-tui', 'unpriced-model', 0, 0, 0, 1234, 0, 1, null]];
  write(path.join(run, 'local.json'), JSON.stringify(s));
  execute(python, [path.join(root, 'core/weekly.py'), run], { WORTHIT_OUT: env.WORTHIT_HOME });
  const reportFile = path.join(env.WORTHIT_HOME, 'weeks/2026-11-14/report.json');
  const report = JSON.parse(fs.readFileSync(reportFile));
  assert.equal(sum(report.project_activity, 'output'), sum(report.activity, 'output'));
  assert.equal(sum(report.project_activity, 'requests'), sum(report.activity, 'requests'));
  assert.ok(Math.abs(sum(report.project_activity, 'usd') - sum(report.activity, 'usd')) < 0.02);
  assert.ok(report.project_activity.some(r => r.project_why === 'saved_before_projects'));
  assert.ok(report.project_activity.some(r => r.provider === 'dsh' && r.project_why === 'no_folder_read' && r.usd === 0));
  const build = extra => JSON.parse(node(`import fs from 'node:fs'; import { buildData } from ${JSON.stringify(moduleUrl('src/collect.mjs'))};
    const report=JSON.parse(fs.readFileSync(${JSON.stringify(reportFile)}));
    const g={coverage:{prs:true,commits:true,sources:[]},project_prs:[{key:'github.com/acme/app-api#1',merged_ms:Date.parse('${ts}')},{key:'gitlab.example/acme/pr-only!2',merged_ms:Date.parse('${ts}')},{key:'acme/app-api#3',merged_ms:Date.parse('${ts}')}],prs:[1,2,3].map(()=>Date.parse('${ts}')),kinds:[],commits:[],repos:2,src:{}};
    console.log(JSON.stringify(buildData(report,${extra?.gitOff ? 'null' : 'g'}, {days:21}, ${JSON.stringify({ counts: {}, hosts: [], ...extra?.info })})));`).stdout);
  const D = build();
  assert.equal(sum(D.projects.rows, 'output_tokens') + D.projects.no_repository.output_tokens, D.totals.output_tokens);
  assert.equal(sum(D.projects.rows, 'requests') + D.projects.no_repository.requests, sum(D.tools, 'requests'));
  assert.ok(Math.abs(sum(D.projects.rows, 'api_value_usd') + D.projects.no_repository.api_value_usd - D.totals.api_value_usd) <= D.projects.rows.length + 1);
  assert.equal(sum(D.projects.rows, 'merged_prs') + D.projects.prs_without_project.merged_prs, D.git.merged_prs);
  assert.equal(D.projects.rows.find(r => r.project === 'gitlab.example/acme/pr-only').merged_prs, 1);
  assert.equal(D.projects.coverage.prs_attributed, false); assert.equal(D.projects.coverage.prs_sources, true);
  const partialText = projectsText(D); assert.match(partialText, /partial PR count/); assert.ok(!partialText.includes('at least $' + D.projects.rows[0].usd_per_merged_pr + '/PR'));
  const off = build({ gitOff: true });
  assert.equal(off.projects.prs_without_project, null); assert.equal(off.projects.coverage.prs_sources, null); assert.equal(off.projects.coverage.prs_attributed, null);
  for (const r of off.projects.rows) { assert.equal(r.merged_prs, null); assert.equal(r.usd_per_merged_pr, null); }
  for (const info of [{ hosts: [{ alias: 'box-b', ok: false }] }, { left_out: ['box-b'] },
    { retained: [{ machine: 'box-b', units: [{ day: '2026-11-13', provider: 'claude' }] }] },
    { retirement: [{ machine: 'box-b', retired_at: '2026-11-10T00:00:00Z' }] }]) {
    const p = build({ info }).projects; assert.equal(p.coverage.machines, false); assert.equal(p.floor, true);
  }
  const start = Date.parse('2026-11-07T12:00:00Z'), end = Date.parse('2026-11-14T12:00:00Z');
  const clean = [{ hour: '2026-11-13T15', provider: 'claude', model: 'fixture', project: 'github.com/acme/app-api', project_why: null, usd: 0, output: 1, requests: 1 }];
  assert.equal(buildProjects(clean, null, true, start, end).floor, false);
  for (const why of reasons.slice(2)) {
    const p = buildProjects([...clean, { ...clean[0], project: null, project_why: why }], null, true, start, end);
    assert.equal(p.floor, true); assert.equal(p.coverage.unresolved_rows, 1); assert.equal(p.coverage.unresolved_usd, 0);
  }
  assert.equal(buildProjects(clean, null, true, start, end).rows[0].models[0].share_pct, null);
  for (const k of ['acme/app-api#1', 'gitea/acme/app-api#1']) assert.equal(projectFromKey(k), null);
  assert.equal(projectFromKey('gitlab.example/acme/sub/app-api!2'), 'gitlab.example/acme/sub/app-api');

  // The real saved command never touches logs or invokes collectors; demo never reads sentinel last.json.
  write(path.join(env.WORTHIT_HOME, 'last.json'), JSON.stringify(D));
  const saved = JSON.parse(cli(['projects']).stdout); assert.deepEqual(saved.rows, D.projects.rows);
  assert.equal(saved.generated_at, D.generated_at); assert.deepEqual(saved.machines_retained, D.machines_retained);
  write(path.join(env.WORTHIT_HOME, 'last.json'), 'private-sentinel-not-json');
  const sampleProjects = JSON.parse(cli(['projects', '--demo']).stdout);
  assert.ok(sampleProjects.rows.some(r => r.project === 'github.com/acme/app-api'));
  for (const k of ['week', 'generated_at', 'machines_missing', 'machines_left_out', 'machines_retained', 'machines_retired']) delete sampleProjects[k];
  assert.deepEqual(JSON.parse(cli(['get', 'projects', '--demo']).stdout).projects, sampleProjects);
  assert.equal(JSON.parse(cli(['get', 'projects.rows.0.project', '--demo']).stdout), 'github.com/acme/app-api');
  assert.equal(fs.readFileSync(path.join(env.WORTHIT_HOME, 'last.json'), 'utf8'), 'private-sentinel-not-json');
  const valued = spawnSync(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'projects', '--demo=true'], { env, encoding: 'utf8' });
  assert.equal(valued.status, 2); assert.ok(!valued.stderr.includes('private-sentinel'));
  const demo = JSON.parse(cli(['--demo', '--json']).stdout);
  assert.equal(sum(demo.projects.rows, 'output_tokens') + demo.projects.no_repository.output_tokens, demo.totals.output_tokens);
  assert.equal(sum(demo.projects.rows, 'merged_prs') + demo.projects.prs_without_project.merged_prs, demo.git.merged_prs);
  assert.equal(JSON.parse(cli(['--demo', '--json', '--git', 'no']).stdout).projects.coverage.prs_sources, null);

  // Agent-only boundary is real code, while public local SQL remains available.
  write(path.join(env.WORTHIT_HOME, 'last.json'), JSON.stringify(D));
  node(`import {createRequire} from 'node:module';const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');const d=new DatabaseSync(${JSON.stringify(path.join(env.WORTHIT_HOME, 'worthit.db'))}); d.exec("CREATE TABLE IF NOT EXISTS pr_kind(key TEXT PRIMARY KEY, merged_ms INTEGER, kind TEXT); INSERT OR REPLACE INTO pr_kind VALUES('github.com/acme/app-api#42',1,'feat')");d.close();`);
  assert.ok(cli(['sql', 'SELECT key FROM pr_kind']).stdout.includes('github.com/acme/app-api'));
  const aiChecks = node(`import fs from 'node:fs';import assert from 'node:assert/strict';import {runForAgent} from ${JSON.stringify(moduleUrl('src/query.mjs'))};
    const D=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(env.WORTHIT_HOME, 'last.json'))}));
    assert.throws(()=>runForAgent(['get','projects'],D),/local only/);
    for (const q of ['SELECT key FROM pr_kind', 'SELECT json FROM weekly', 'SELECT v FROM meta', "SELECT name,sql FROM sqlite_master WHERE name='pr_kind'"]) {
      let result;try{result=JSON.stringify(runForAgent(['sql',q],D));}catch(e){result=e.message;} assert.ok(!result.includes('github.com/acme/app-api')); }
    assert.ok(Array.isArray(runForAgent(['sql','SELECT SUM(api_usd) AS usd FROM day_provider'],D)));
    assert.ok(!JSON.stringify(runForAgent(['get'],D)).includes('projects'));
    const collision={...D,projects:{rows:[{project:'github.com/acme/api',name:'api'}]}}; assert.equal(runForAgent(['get','totals.api_value_usd'],collision),D.totals.api_value_usd);
    assert.ok(Object.hasOwn(runForAgent(['sql','SELECT SUM(api_usd) AS api_value_usd FROM day_provider'],collision)[0],'api_value_usd')); console.log('agent lookups: project get/SQL denied, usage SQL allowed');`);
  process.stdout.write(aiChecks.stdout);
  assert.ok(!dataForAgent(D).includes('github.com/acme/app-api'));
  const sharedBasename = { projects: { rows: [
    { project: 'github.com/acme/app-api', name: 'acme/app-api' },
    { project: 'github.com/fork-owner/app-api', name: 'fork-owner/app-api' },
  ] } };
  assert.equal(redactProjects('brag about app-api and acme/app-api and fork-owner/app-api', sharedBasename),
    'brag about [repository] and [repository] and [repository]', 'shared repository basename and owner/name aliases are removed from AI prose');
  const collision = { ...D, projects: { rows: [{ project: 'github.com/acme/api', name: 'api' }] } };
  assert.equal(JSON.parse(dataForAgent(collision)).totals.api_value_usd, D.totals.api_value_usd, 'short repository names must never rename public metric keys');
  assert.ok(!JSON.stringify(cardSpec('models', D)).includes('github.com/acme/app-api'));

  // Capture actual summary/question-bar and custom-share agent calls through a synthetic executable.
  const capture = path.join(tmp, 'agent.jsonl');
  write(path.join(tmp, 'agent.mjs'), `import fs from 'node:fs';let input='';for await(const c of process.stdin)input+=c;const args=process.argv.slice(2);const system=args[args.indexOf('--system-prompt')+1]||'';fs.appendFileSync(process.env.FIXTURE_CAPTURE,JSON.stringify({system,input})+'\\n');let text='';
    if(system.includes('ONE post for X')) text=JSON.stringify({text:'my usage this week: 100000 output tokens. npx worthit',headline:'100000',caption:'output tokens',facts:[{label:'tokens',value:'100000'},{label:'requests',value:'1'}]});
    else if(input.includes('Lookup results')) text='';
    else if(input.includes('Question:')) text='QUERY: worthit get projects\\nQUERY: worthit sql "SELECT key FROM pr_kind"';
    else text=JSON.stringify({op:'add',path:'/root',value:'r'})+'\\n'+JSON.stringify({op:'add',path:'/elements/r',value:{type:'Stack',props:{},children:['v']}})+'\\n'+JSON.stringify({op:'add',path:'/elements/v',value:{type:'Verdict',props:{text:'Synthetic summary'},children:[]}});
    console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}}));`);
  write(path.join(bin, 'claude'), `#!/bin/sh\nexec '${process.execPath}' '${path.join(tmp, 'agent.mjs')}' "$@"\n`); fs.chmodSync(path.join(bin, 'claude'), 0o755);
  env.FIXTURE_CAPTURE = capture;
  cli(['--hosts', 'none', '--git', 'no', '--ai', 'claude', '--fresh', '--no-files', '--ask', 'show github.com/acme/app-api']);
  const calls = fs.readFileSync(capture, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(c => c.input.includes('Compose the dashboard')));
  assert.ok(calls.some(c => c.input.includes('Lookup results') && c.input.includes('repository details are local only')));
  for (const c of calls) assert.ok(!JSON.stringify(c).includes('github.com/acme/app-api'), 'summary and question/SQL path carry no identity');
  cli(['share', 'brag about github.com/acme/app-api', '--ai', 'claude', '--no-files']);
  const shareCalls = fs.readFileSync(capture, 'utf8').trim().split('\n').map(JSON.parse).filter(c => c.system.includes('ONE post for X'));
  assert.equal(shareCalls.length, 1); assert.ok(!JSON.stringify(shareCalls).includes('github.com/acme/app-api'), 'custom share topic and DATA carry no identity');
  console.log('project-stats: identities/cache/pricing/reconciliation/floors/PRs/read command/demo and all three AI paths PASS');
} finally { isolated.cleanup(); }
