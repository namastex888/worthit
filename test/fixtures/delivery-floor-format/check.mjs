// Saved all-surface floor policy and terminal formatting; synthetic inputs only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { projectsText } from '../../../src/projects.mjs';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const isolated = isolatedEnvironment(), failures = [];
const check = (name, fn) => { try { fn(); console.log(`case ${name}: PASS`); } catch (error) { failures.push(name); console.error(`case ${name}: FAIL: ${error.message}`); } };
const script = `import {buildData} from ${JSON.stringify(pathToFileURL(path.join(root, 'src/collect.mjs')).href)};
const project='github.com/acme/app-api', mode=process.argv[1], sha=n=>n.toString(16).padStart(40,'0');
const records=Array.from({length:6},(_,i)=>({key:project+'#'+(i+1),project,host:'github.com',forge:'github',number:i+1,title:'feat: synthetic',branch:'feat/example-'+i,same_repository:true,head_sha:sha(i+1),opened_at:'2026-11-10T12:00:00Z',merged_ms:Date.parse('2026-11-13T15:00:00Z'),commits:[{sha:sha(i+1)}],base_ancestors:[sha(99)],completeness:{metadata:true,commits:true,parents:true,diffs:true},reasons:[],lineage:[{sha:sha(i+1),parents:[sha(99)],committed_at:i<4?'2026-11-10T12:00:00Z':'2026-11-11T12:00:00Z',files_complete:true,files:[{path:'src/app.mjs',old_path:'src/app.mjs'}]}]}));
const current=records.map(r=>({hour:'2026-11-12T12',project,project_why:null,branch:r.branch,provider:'codex',model:'synthetic-model',usd:100/3,output:100,requests:1,cost_complete:true}));
const previous=records.map((r,i)=>({key:project+'#'+(101+i),merged_ms:Date.parse('2026-11-06T15:00:00Z')}));
const activity=[{hour:'2026-11-05T12',provider:'codex',model:'synthetic-model',project,project_why:null,branch:'feat/previous',usd:100,output:100,requests:1,cost_complete:true},...current];
if(mode==='usage'||mode==='usage-prior') activity.push({hour:mode==='usage'?'2026-11-12T12':'2026-11-05T12',provider:'omp',model:'branchless-model',project:null,project_why:'no_folder_read',branch:null,usd:13,output:10,requests:1,cost_complete:true});
const project_prs=[...records,...previous],g={project_prs,delivery_evidence:records,prs:project_prs.map(r=>r.merged_ms),kinds:project_prs.map(r=>[r.merged_ms,'feat']),commits:project_prs.map(r=>r.merged_ms),repos:1,src:{synthetic:12},coverage:{prs:true,commits:true,sources:[]}};
const report={activity,project_activity:activity,history_since:'2026-11-01T00:00:00Z',prices:{plan_usd_per_week:{}},this_week:{}};
console.log(JSON.stringify(buildData(report,g,{days:21},{counts:{},hosts:[{alias:'box-b',ok:mode!=='machine'}]})));`;
try {
  const results = {};
  for (const mode of ['machine', 'usage', 'usage-prior', 'complete']) {
    const store = path.join(isolated.tmp, mode), env = { ...isolated.env, WORTHIT_HOME: store, NODE_OPTIONS: `--import=${path.join(root, 'test/support/clock.mjs')}` };
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, mode], { cwd: root, env, encoding: 'utf8', maxBuffer: 16 << 20, timeout: 30000 });
    assert.equal(r.status, 0, r.stderr || r.error); const data = JSON.parse(r.stdout);
    const saved = JSON.parse(fs.readFileSync(path.join(store, 'last.json'), 'utf8')); assert.deepEqual(saved, data); results[mode] = saved;
  }
  check('machine floor withholds git, project and every model per-PR cost', () => {
    const d = results.machine; assert.equal(d.git.usd_per_merged_pr, null);
    assert.ok(d.projects.rows.every(r => r.usd_per_merged_pr === null));
    for (const key of ['models', 'project_models', 'daily']) assert.ok(d.projects.delivery[key].every(r => r.usd_per_pr_led === null));
    assert.equal(d.git.usd_per_pr_change_pct, null); assert.equal(d.git.merged_prs_change_pct, 0); assert.equal(d.git.merged_prs, 6);
  });
  check('usage-only floor keeps linked lead and numeric costs on all saved surfaces', () => {
    const d = results.usage; assert.equal(d.projects.floor, true); assert.equal(d.projects.coverage.machines, true);
    assert.ok(d.git.usd_per_merged_pr > 0); assert.ok(d.projects.rows[0].usd_per_merged_pr > 0);
    assert.ok(d.projects.delivery.deliveries.every(r => r.lead_model === 'synthetic-model' && r.cost_floor && r.cost_reasons.includes('project_usage_incomplete')));
    for (const key of ['models', 'project_models', 'daily']) { const m = d.projects.delivery[key].find(r => r.model === 'synthetic-model'); assert.equal(m.prs_led, 6); assert.ok(m.usd_per_pr_led > 0 && m.cost_floor); }
    assert.equal(d.projects.delivery.coverage.unlinked.by_reason.omp_no_branch.rows, 1);
  });
  check('usage-only cost comparison null preserves independent physical count comparison', () => {
    assert.equal(results.usage.git.usd_per_pr_change_pct, null); assert.equal(results.usage.git.merged_prs_change_pct, 0);
    assert.equal(results['usage-prior'].git.usd_per_pr_change_pct, null, 'prior-endpoint usage floor is also never compared');
    assert.equal(results['usage-prior'].projects.floor, false, 'prior floor does not demote current coverage');
    assert.equal(results['usage-prior'].git.merged_prs_change_pct, 0);
    assert.notEqual(results.complete.git.usd_per_pr_change_pct, null, 'complete usage keeps its existing comparison');
  });
  check('terminal USD two decimals and whole percentages preserve JSON precision', () => {
    const d = results.complete, before = JSON.stringify(d), text = projectsText(d);
    assert.match(text, /\$33\.33\/PR/); assert.match(text, /\$33\.33\/delivery/); assert.match(text, /\| 67% \| unknown/);
    assert.doesNotMatch(text, /\d+\.\d+%|\$\d+\.\d{3,}/); assert.equal(JSON.stringify(d), before);
    assert.ok(d.projects.rows[0].usd_per_merged_pr !== Number(d.projects.rows[0].usd_per_merged_pr.toFixed(2)));
  });
  check('terminal D1 floor ratio 69.09 and singular request/merged PR controls', () => {
    const d = structuredClone(results.usage), r = d.projects.rows[0];
    r.usd_per_merged_pr = 1520/22; r.requests = 1; r.merged_prs = 1; r.models[0].requests = 1;
    const text = projectsText(d); assert.match(text, /at least \$69\.09\/PR/); assert.match(text, /1 request \| 1 merged PR \|/);
    assert.doesNotMatch(text, /1 requests|1 merged PRs/);
    const plural = projectsText(results.complete); assert.match(plural, /6 requests \| 6 merged PRs/);
  });
  if (process.env.WORTHIT_FIXTURE_ARTIFACTS) { fs.mkdirSync(process.env.WORTHIT_FIXTURE_ARTIFACTS, { recursive: true }); fs.writeFileSync(path.join(process.env.WORTHIT_FIXTURE_ARTIFACTS, 'delivery-floor-format.json'), JSON.stringify(results, null, 2)); }
} finally { isolated.cleanup(); }
assert.deepEqual(failures, [], 'named floor/format regression cases failed');
