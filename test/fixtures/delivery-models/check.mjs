import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDelivery, openedSignal } from '../../../src/delivery-models.mjs';
import { buildProjects, projectsText } from '../../../src/projects.mjs';
import { dataForAgent, redactProjects } from '../../../src/project-privacy.mjs';
import { runForAgent } from '../../../src/query.mjs';
import { demoData } from '../../../src/demo.mjs';
import { isolatedEnvironment } from '../../support/environment.mjs';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const start = Date.parse('2026-11-07T12:00:00Z'), end = Date.parse('2026-11-14T12:00:00Z');
const project = 'github.com/acme/app-api', sha = n => n.toString(16).padStart(40, '0');
const complete = { metadata: true, commits: true, parents: true, diffs: true };
const record = (n, extra = {}) => ({ key: `${project}#${n}`, project, host: 'github.com', forge: 'github', number: n,
  title: 'feat: synthetic feature', branch: `feat/item-${n}`, same_repository: true, head_sha: sha(n), opened_at: '2026-11-08T12:00:00Z', merged_ms: Date.parse('2026-11-13T23:30:00Z'),
  commits: [{ sha: sha(n) }], completeness: { ...complete }, reasons: [], base_ancestors: [sha(999)],
  lineage: [{ sha: sha(n), parents: [sha(999)], committed_at: '2026-11-08T12:00:00Z', files_complete: true, files: [{ path: 'src/app.mjs', old_path: 'src/app.mjs' }] }], ...extra });
const row = (n, usd = 20, extra = {}) => ({ hour: '2026-11-12T12', project, branch: `feat/item-${n}`, model: 'model-a', provider: 'codex', usd, output: 100, requests: 1, cost_complete: true, ...extra });
const build = (rs, rows = rs.map(r => row(r.number)), opts = {}) => buildDelivery(rows, { coverage: { prs: true }, project_prs: rs.filter(r => Number.isFinite(r.merged_ms)).map(({ key, merged_ms }) => ({ key, merged_ms })), delivery_evidence: rs }, { machines: true, projectFloor: false, start, end, ...opts });
const test = (name, fn) => { try { fn(); console.log('case ' + name + ': PASS'); } catch (e) { e.message = name + ': ' + e.message; throw e; } };
const change = (path, extra = {}) => ({ sha: sha(2), parents: [sha(999)], committed_at: '2026-11-09T00:00:00Z', files_complete: true, files: path ? [{ path, old_path: path }] : [], ...extra });

test('opened proxy strict committer boundary and misleading docs subject', () => {
  assert.equal(openedSignal(record(1)).state, 'first_try');
  assert.equal(openedSignal(record(1, { lineage: [change('src/app.mjs', { subject: 'docs: only docs' })] })).state, 'not_first_try');
  assert.equal(openedSignal(record(1, { lineage: [change('src/app.mjs', { committed_at: '2026-11-08T12:00:00Z' })] })).state, 'first_try');
});
test('docs images empty mixed rename deletion and incomplete file list', () => {
  for (const p of ['docs/guide.mjs', 'README.md', 'assets/demo.png', null]) assert.equal(openedSignal(record(1, { lineage: [change(p)] })).state, 'first_try', p);
  for (const files of [[{ path: 'docs/guide.md', old_path: 'src/app.mjs' }], [{ path: 'src/app.mjs', old_path: 'src/app.mjs' }, { path: 'docs/guide.md', old_path: 'docs/guide.md' }]]) assert.equal(openedSignal(record(1, { lineage: [change(null, { files })] })).state, 'not_first_try');
  assert.equal(openedSignal(record(1, { lineage: [change(null, { files_complete: false })] })).state, 'unknown');
  assert.equal(openedSignal(record(1, { lineage: [change('src/app.mjs', { committed_at: null })] })).state, 'unknown');
});
test('proven base integration excludes imported base history only', () => {
  const merge = change(null, { parents: [sha(1), sha(999)], base_integration: true });
  assert.equal(openedSignal(record(1, { lineage: [merge, record(1).lineage[0]] })).state, 'first_try');
  assert.equal(openedSignal(record(1, { lineage: [{ ...merge, parents: [sha(1), sha(888)] }] })).state, 'unknown');
  assert.equal(openedSignal(record(1, { lineage: [{ ...merge, base_integration: false }] })).state, 'unknown');
});
test('long verified review cost cannot select reviewer lead', () => {
  const p = build([record(41, { commits: [{ sha: '1234abcd' + '0'.repeat(32) }] })], [row(41, 20), row(41, 1000, { branch: 'review/pr-41-1234abcd', model: 'reviewer-model' })]);
  const d = p.deliveries[0]; assert.equal(d.lead_model, 'model-a'); assert.equal(d.lead_api_value_usd, 20); assert.equal(d.lead_share_pct, 100); assert.equal(d.review_api_value_usd, 1000);
  assert.equal(p.models.find(r => r.model === 'model-a').usd_per_pr_led, 1020); assert.equal(d.cost_floor, false);
  const unpriced = build([record(41, { commits: [{ sha: '1234abcd' + '0'.repeat(32) }] })], [row(41), row(41, 0, { branch: 'review/pr-41-1234abcd', model: 'reviewer-model', cost_complete: false })]);
  assert.equal(unpriced.deliveries[0].lead_model, 'model-a'); assert.equal(unpriced.deliveries[0].cost_floor, true);
});
test('invalid ambiguous review and review-only no lead', () => {
  const r = record(41, { commits: [{ sha: '1234abcd' + '0'.repeat(32) }] });
  const review = row(41, 1000, { branch: 'review/pr-41-1234abcd', model: 'reviewer-model' });
  assert.equal(build([r], [review]).deliveries[0].lead_model, null);
  const bad = build([r], [row(41), { ...review, branch: 'review/pr-41-deadbeef' }]);
  assert.equal(bad.coverage.unlinked.by_reason.review_unverified.api_value_usd, 1000); assert.equal(bad.deliveries[0].lead_model, 'model-a');
  const ambiguous = build([{ ...r, commits: [...r.commits, { sha: '1234abcd' + '1'.repeat(32) }] }], [row(41), review]);
  assert.equal(ambiguous.coverage.review.rows, 0); assert.equal(ambiguous.coverage.unlinked.by_reason.review_unverified.rows, 1);
});
test('reused implementation branch tie missing old branch and incomplete machine', () => {
  assert.equal(build([record(1)], [row(1), row(1, 20, { model: 'model-b' })]).deliveries[0].lead_model, null);
  const p = build([record(1), record(2, { branch: 'feat/item-1' })], [row(1)]);
  assert.equal(p.coverage.ambiguous_prs, 2); assert.equal(p.coverage.unlinked.by_reason.ambiguous_branch.rows, 1); assert.ok(p.deliveries.every(d => d.lead_model === null));
  assert.equal(build([record(1)], [row(1), row(1, 0, { branch: null })]).deliveries[0].lead_model, null);
  assert.equal(build([record(1)], undefined, { machines: false }).deliveries[0].lead_model, null);
  assert.equal(build([record(1)], [row(1, 20, { cost_complete: false })]).deliveries[0].lead_model, null);
});
test('omp dsh no git no folder and hourly cutoff coverage', () => {
  const p = build([record(1)], [row(1), row(1, 3, { provider: 'omp', branch: null, project: null }), row(1, 0, { provider: 'dsh', branch: null, project: null }), row(1, 2, { project: null }), row(1, 5, { hour: '2026-11-14T00' })]);
  assert.equal(p.coverage.unlinked.by_reason.omp_no_branch.api_value_usd, 3); assert.equal(p.coverage.unlinked.by_reason.dsh_tui_no_branch.output_tokens, 100);
  assert.equal(p.coverage.unlinked.by_reason.no_repository.rows, 1); assert.equal(p.coverage.unlinked.by_reason.after_merge.rows, 1);
  assert.equal(build([record(1)], [row(1, 21, { hour: '2026-11-13T23' })]).deliveries[0].api_value_usd, 21);
  assert.equal(buildDelivery([], null, { start, end }), null);
});
test('four versus five eligible counts unknown excluded optout wins', () => {
  for (const n of [4, 5]) { const rs = Array.from({ length: n }, (_, i) => record(i + 1));
    rs.push(record(99, { completeness: { ...complete, parents: false }, reasons: ['rewritten'] }));
    const p = build(rs); const m = p.models.find(m => m.model === 'model-a');
    assert.equal(m.eligible, n); assert.equal(m.unknown, 1); assert.equal(m.first_pass_pct, n === 5 ? 100 : null);
    const off = build(rs, undefined, { exclude: [project] }); const o = off.models.find(m => m.model === 'model-a');
    assert.equal(o.eligible, 0); assert.equal(o.not_measured, n + 1); assert.equal(o.first_pass_pct, null);
  }
});
test('four-five known denominator boundary excludes unknown and opt-out', () => {
  const rs = Array.from({ length: 5 }, (_, i) => record(i + 1));
  let p = build(rs.slice(0, 4)); let m = p.models.find(r => r.model === 'model-a');
  assert.equal(m.eligible, 4); assert.equal(m.first_pass, 4); assert.equal(m.first_pass_pct, null); assert.equal(m.first_pass_reason, 'insufficient_sample');
  p = build(rs); m = p.models.find(r => r.model === 'model-a'); assert.equal(m.eligible, 5); assert.equal(m.first_pass_pct, 100);
  assert.equal(p.project_models.find(r => r.model === 'model-a').first_pass_pct, 100); assert.equal(p.daily.find(r => r.model === 'model-a').first_pass_pct, 100);
  const unknown = { ...rs[4], completeness: { ...rs[4].completeness, diffs: false }, reasons: ['truncated_files'] };
  p = build([...rs.slice(0, 4), unknown]); m = p.models.find(r => r.model === 'model-a'); assert.equal(m.eligible, 4); assert.equal(m.unknown, 1); assert.equal(m.first_pass_pct, null);
  p = build(rs, undefined, { exclude: [rs[0].project] }); m = p.models.find(r => r.model === 'model-a'); assert.equal(m.eligible, 0); assert.equal(m.not_measured, 5); assert.equal(m.first_pass_pct, null);
});
test('transitive cross-day chains costs once and closed unmerged root', () => {
  const rs = [record(1), record(2, { title: 'Supersedes #1', merged_ms: Date.parse('2026-11-14T01:00:00Z') }), record(3, { title: 'Supersedes #2', merged_ms: Date.parse('2026-11-14T02:00:00Z') })];
  let p = build(rs); assert.equal(p.deliveries.length, 1); assert.equal(p.coverage.merged_prs, 3); assert.equal(p.coverage.canonical_deliveries, 1); assert.equal(p.deliveries[0].api_value_usd, 60); assert.equal(p.deliveries[0].first_pass.state, 'not_first_try'); assert.equal(p.deliveries[0].completed_day, '2026-11-13'); assert.equal(p.deliveries[0].root, `${project}#1`);
  p = build([{ ...rs[0], merged_ms: null }, rs[1]], [row(1), row(2)]); assert.equal(p.deliveries[0].completed_day, '2026-11-14'); assert.equal(p.deliveries[0].api_value_usd, 40);
  p = build([{ ...rs[0], merged_ms: start - 1 }, rs[1]]); assert.equal(p.deliveries.length, 0); assert.equal(p.coverage.merged_prs, 1); assert.equal(p.models.find(r => r.model === null).coverage.merged_prs, 1);
});
test('cycle self fork missing cross-repo and wrong typed chains stay unknown', () => {
  for (const rs of [[record(1, { title: 'Supersedes #1' })], [record(1, { title: 'Supersedes #2' }), record(2, { title: 'Supersedes #1' })], [record(1), record(2, { title: 'Supersedes #1' }), record(3, { title: 'Supersedes #1' })], [record(1, { title: 'Supersedes #99' })], [record(1, { title: 'Supersedes acme/other#2' })], [record(1, { title: 'Supersedes !2' })]]) {
    const p = build(rs); assert.equal(p.deliveries.length, 1); assert.equal(p.deliveries[0].first_pass.state, 'unknown'); assert.equal(p.deliveries[0].lead_model, null); assert.equal(p.coverage.unresolved_chains, 1);
    assert.equal(build(rs, undefined, { exclude: [project] }).deliveries[0].first_pass.state, 'not_measured');
  }
});
test('self-managed GitLab typed chain and no-lead daily visibility', () => {
  const rs = [record(1), record(2, { title: 'Supersedes !1' })].map(r => ({ ...r, project: 'forge.example/acme/web-client', key: `forge.example/acme/web-client!${r.number}`, host: 'forge.example', forge: 'gitlab' }));
  const p = build(rs, rs.map(r => row(r.number, 20, { project: r.project })));
  assert.equal(p.coverage.canonical_deliveries, 1); assert.equal(p.deliveries[0].first_pass.state, 'not_first_try');
  const unknown = build([record(1, { completeness: {}, reasons: ['unsupported_host'] })]);
  assert.equal(unknown.daily.find(r => r.model === null).coverage.unknown, 1); assert.equal(unknown.daily.find(r => r.model === null).usd_per_pr_led, null);
});
test('saved lookup config persistence privacy and physical-count reconciliation', () => {
  const isolated = isolatedEnvironment();
  try {
    const rs = [record(1), record(2, { title: 'Supersedes #1' })], g = { coverage: { prs: true }, project_prs: rs.map(({ key, merged_ms }) => ({ key, merged_ms })), delivery_evidence: rs };
    const p = buildProjects(rs.map(r => row(r.number)), g, true, start, end, { exclude: [project], scanStart: start });
    assert.equal(p.rows[0].merged_prs, 2); assert.equal(p.delivery.coverage.canonical_deliveries, 1);
    const d = { ...demoData(), projects: p };
    fs.mkdirSync(isolated.env.WORTHIT_HOME, { recursive: true }); fs.writeFileSync(path.join(isolated.env.WORTHIT_HOME, 'last.json'), JSON.stringify(d));
    const cli = args => { const r = spawnSync(process.execPath, [path.join(root, 'bin/worthit.mjs'), ...args], { env: isolated.env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
    assert.deepEqual(cli(['get', 'projects.delivery.daily']), p.delivery.daily); assert.equal(cli(['projects']).delivery.deliveries[0].first_pass.state, 'not_measured');
    assert.match(projectsText(d), /opened date proxy/); assert.match(projectsText(d), /not measured 1/);
    assert.ok(!dataForAgent(d).includes(project)); assert.ok(!dataForAgent(d).includes(rs[0].branch));
    assert.ok(!redactProjects(project + ' ' + rs[0].branch + ' ' + rs[0].key, d).includes(rs[0].branch));
    assert.throws(() => runForAgent(['get', 'projects.delivery.daily'], d), /local only/);
    if (process.env.WORTHIT_FIXTURE_ARTIFACTS) { fs.mkdirSync(process.env.WORTHIT_FIXTURE_ARTIFACTS, { recursive: true }); fs.writeFileSync(path.join(process.env.WORTHIT_FIXTURE_ARTIFACTS, 'delivery-models.json'), JSON.stringify(p, null, 2)); }
  } finally { isolated.cleanup(); }
});
