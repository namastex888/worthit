// Review findings on RFC 0004: legacy Gitea aliases and local review/short-ref privacy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { redactProjects, dataForAgent } from '../../../src/project-privacy.mjs';
import { buildProjects } from '../../../src/projects.mjs';
import { demoData } from '../../../src/demo.mjs';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let failures = 0;
const test = (name, fn) => { try { fn(); console.log('case ' + name + ': PASS'); } catch (e) { failures++; console.error('case ' + name + ': FAIL: ' + e.message); } };
const iso = isolatedEnvironment(), { env, bin, tmp, home } = iso;
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v); };
const execute = (args, extra = {}) => { const r = spawnSync(process.execPath, args, { cwd: tmp, env: { ...env, ...extra }, encoding: 'utf8', maxBuffer: 16 << 20, timeout: 30000 }); assert.equal(r.status, 0, r.stderr || r.error); return r.stdout; };
Object.assign(env, { NODE_OPTIONS: `--import=${path.join(root, 'test/support/clock.mjs')}` });
try {
  fs.mkdirSync(env.METER_STATE_DIR, { recursive: true });
  const meter = new DatabaseSync(path.join(env.METER_STATE_DIR, 'meter.db')); meter.exec('CREATE TABLE pr(repo TEXT,pr INTEGER,merged_ms INTEGER); CREATE TABLE cwd_repo(repo TEXT,cwd TEXT,checked_ms INTEGER)'); meter.close();
  const stub = path.join(tmp, 'forge.mjs');
  write(stub, `const [c,...a]=process.argv.slice(2); if(c==='usagemeter'){if(a[0]==='status')console.log(JSON.stringify({version:'fixture',state_dir:process.env.METER_STATE_DIR}));}
else if(c==='tea'){if(a[0]==='login')console.log('[{"name":"synthetic","url":"https://forge-a.example","user":"coder-a"}]');else console.log(JSON.stringify([{number:41,title:'feat: synthetic',html_url:'https://forge-a.example/acme/app-api/pulls/41',repository:{full_name:'acme/app-api'},pull_request:{merged:true,merged_at:'2026-11-13T12:00:00Z'}}]));}else process.exit(86);`);
  for (const c of ['usagemeter', 'tea']) { write(path.join(bin, c), `#!/bin/sh\nexec '${process.execPath}' '${stub}' '${c}' "$@"\n`); fs.chmodSync(path.join(bin, c), 0o755); }
  for (const hosts of [['forge-a.example'], ['forge-a.example', 'forge-b.example']]) test('Gitea legacy alias collision with ' + hosts.length + ' observed host(s)', () => {
    const store = path.join(tmp, 'store-' + hosts.length); fs.mkdirSync(store);
    const db = new DatabaseSync(path.join(store, 'worthit.db')); db.exec('CREATE TABLE pr_kind(key TEXT PRIMARY KEY,merged_ms INTEGER,kind TEXT);');
    for (const key of ['gitea/acme/app-api#41', 'gitea/other/app-api#42', ...hosts.map(h => h + '/acme/app-api#41')]) db.prepare('INSERT INTO pr_kind VALUES(?,?,?)').run(key, Date.parse('2026-11-13T12:00:00Z'), 'feat'); db.close();
    const g = JSON.parse(execute(['--input-type=module', '-e', `import {git,AUDIT} from ${JSON.stringify(pathToFileURL(path.join(root, 'src/collect.mjs')).href)};const g=await git({git:true},()=>{});console.log(JSON.stringify({g,audit:AUDIT}));`], { WORTHIT_HOME: store }));
    assert.equal(g.g.prs.length, hosts.length + 1, 'legacy identity must not add another physical item');
    assert.ok(!g.g.project_prs.some(p => p.key === 'gitea/acme/app-api#41'));
    assert.ok(g.g.project_prs.some(p => p.key === 'gitea/other/app-api#42'), 'unmatched hostless count retained');
    const kept = new DatabaseSync(path.join(store, 'worthit.db'), { readOnly: true });
    assert.equal(kept.prepare('SELECT COUNT(*) AS n FROM pr_kind').get().n, hosts.length + 2, 'original legacy evidence retained'); kept.close();
    const p = buildProjects([], g.g, true, Date.parse('2026-11-07T12:00:00Z'), Date.parse('2026-11-14T12:00:00Z'));
    assert.equal(p.rows.reduce((n, r) => n + r.merged_prs, 0) + p.prs_without_project.merged_prs, g.g.prs.length, 'D1 physical reconciliation unchanged');
    assert.equal(p.prs_without_project.merged_prs, 1, 'unmatched legacy remains no_host_in_key'); assert.equal(g.g.coverage.prs, false, 'unprovable host alias must be an explicit PR floor');
    assert.equal(g.g.coverage.commits, true, 'legacy PR ambiguity does not demote commit source coverage');
    assert.ok(g.audit.some(s => s.includes('legacy') && s.includes('ambiguous')), 'ambiguity named in audit, never mapped to an invented host');
  });
  const data = demoData(); data.projects.delivery.deliveries = [{ root: 'github.com/acme/app-api#41', members: ['github.com/acme/app-api#41', 'forge.example/acme/web-client!42'], project: 'github.com/acme/app-api', provenance: [{ branch: 'feat/private-example', head_sha: '1'.repeat(40) }] }];
  const question = 'explain review/pr-41-1234abcd and #41, !42, feat/private-example';
  test('known review and short PR/MR references removed from question prose', () => {
    const safe = redactProjects(question, data); for (const s of ['review/pr-41-1234abcd', '#41', '!42', 'feat/private-example']) assert.ok(!safe.includes(s), s + ' leaked');
    assert.ok(redactProjects('unrelated #410', data).includes('#410'), 'short reference must not eat a different number');
    assert.ok(!dataForAgent({ ...data, events: [{ title: question }] }).includes('review/pr-41-1234abcd'));
  });
  test('actual custom-share agent input excludes review branch and known short references', () => {
    const store = path.join(tmp, 'share-store'), capture = path.join(tmp, 'agent-capture.json'); write(path.join(store, 'last.json'), JSON.stringify(data));
    const agent = path.join(tmp, 'agent.mjs'); write(agent, `import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;fs.writeFileSync(process.env.FIXTURE_CAPTURE,JSON.stringify({input:s,args:process.argv.slice(2)}));console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:JSON.stringify({text:'Synthetic usage. npx worthit',headline:'usage',caption:'output',facts:[]})}}}));`);
    write(path.join(bin, 'claude'), `#!/bin/sh\nexec '${process.execPath}' '${agent}' "$@"\n`); fs.chmodSync(path.join(bin, 'claude'), 0o755);
    execute([path.join(root, 'bin/worthit.mjs'), 'share', question, '--ai', 'claude', '--no-files'], { WORTHIT_HOME: store, FIXTURE_CAPTURE: capture });
    const sent = fs.readFileSync(capture, 'utf8'); for (const s of ['review/pr-41-1234abcd', '#41', '!42', 'feat/private-example']) assert.ok(!sent.includes(s), s + ' leaked through actual agent process');
  });
} finally { iso.cleanup(); }
assert.equal(failures, 0, `${failures} delivery upgrade/privacy findings reproduced`);
