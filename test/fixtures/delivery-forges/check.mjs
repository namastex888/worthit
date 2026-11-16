import assert from 'node:assert/strict';
import { collectDeliveryEvidence } from '../../../src/delivery-forges.mjs';
import { openedSignal } from '../../../src/delivery-models.mjs';
const hash = n => n.toString(16).padStart(40, '0');
const base = hash(1), target = hash(2), impl = hash(3), merge = hash(4), integrated = hash(5), docs = hash(6), stranger = hash(7);
const at = '2026-11-13T15:00:00Z', opened = '2026-11-12T12:00:00Z';
async function scenario(forge, options = {}) {
  const gh = forge === 'github', project = gh ? 'github.com/acme/app-api' : 'forge.example/acme/web-client';
  const prefix = gh ? 'repos/acme/app-api' : 'projects/acme%2Fweb-client', itemPrefix = prefix + (gh ? '/pulls/' : '/merge_requests/');
  const head = options.integration ? integrated : options.docs ? docs : impl;
  const graph = {
    [base]: { parents: [], files: [], date: '2026-11-10T10:00:00Z' },
    [target]: { parents: [base], files: ['src/base.mjs'], date: '2026-11-13T10:00:00Z' },
    [impl]: { parents: [base], files: ['src/app.mjs'], date: options.later ? '2026-11-12T12:00:01Z' : '2026-11-12T12:00:00Z' },
    [merge]: { parents: options.rewritten ? [target] : [target, head], files: [], date: at },
    [integrated]: { parents: [impl, options.stranger ? stranger : target], files: [], date: '2026-11-13T12:00:00Z' },
    [docs]: { parents: [impl], files: ['docs/guide.md'], date: '2026-11-13T12:00:00Z' },
    [stranger]: { parents: [base], files: ['src/feature.mjs'], date: '2026-11-13T12:00:00Z' },
  };
  const calls = [], audits = [];
  const list = [impl, ...(options.integration ? [target, integrated] : options.docs ? [docs] : [])];
  const rows = ids => ids.map(sha => gh ? { sha } : { id: sha });
  const run = async (cli, args) => {
    const endpoint = args.at(-1); calls.push({ cli, args, endpoint });
    const url = new URL('https://fixture.example/' + endpoint), route = url.pathname.slice(1), page = +(url.searchParams.get('page') || 0);
    if (options.fail && endpoint.includes(options.fail)) return { code: 1, out: '' };
    let value;
    const itemMatch = route.startsWith(itemPrefix) && route.slice(itemPrefix.length).match(/^(\d+)$/);
    if (itemMatch) {
      const number = +itemMatch[1];
      if (options.missingTarget && number === 40) return { code: 1, out: '' };
      value = { number, iid: number, title: options.chain && number === 41 ? `Supersedes ${gh ? '#' : '!'}40` : 'feat: synthetic delivery', created_at: opened, merged_at: number === 40 ? null : at,
        head: { sha: head, ref: 'feat/example', repo: { full_name: 'acme/app-api' } }, source_branch: 'feat/example', source_project_id: 10, target_project_id: 10,
        commits: options.cap ? 250 : list.length, merge_commit_sha: options.noMerge ? null : merge, diff_refs: { head_sha: head, start_sha: target, base_sha: base } };
    } else if (route.endsWith('/commits') && route.startsWith(itemPrefix)) {
      if (options.cap) value = page === 1 ? rows(Array.from({ length: 250 }, (_, i) => hash(i + 100))) : [];
      else value = page <= list.length ? rows([list[page - 1]]) : [];
    } else if (route.includes('/compare')) {
      const pair = route.split('/compare/')[1], candidate = pair?.split('...')[0];
      value = gh ? { status: candidate === base ? 'ahead' : 'diverged' } : { compare_timeout: !!options.compareTimeout };
    } else if (route.endsWith('/repository/tree')) {
      const ref = url.searchParams.get('ref');
      if (options.treeFailure && ref === impl) return { code: 1, out: '' };
      if (page === 1) value = [{ path: 'src/app.mjs', type: 'blob', id: options.mode ? 'same' : ref === base ? 'old' : 'new', mode: options.mode && ref !== base ? '100755' : '100644' }];
      else if (page === 2 && ref === docs) value = [{ path: 'docs/guide.md', type: 'blob', id: 'guide', mode: '100644' }];
      else value = [];
      if (!page || page === 1) value.push({ path: 'docs', type: 'tree', id: url.searchParams.get('ref') === docs ? 'new-dir' : 'old-dir', mode: '040000' });
    } else {
      const sha = route.split('/').at(-1), c = graph[sha];
      if (!c) return { code: 1, out: '' };
      const files = c.files.map(filename => ({ filename, status: 'modified' }));
      value = gh ? { sha, parents: c.parents.map(sha => ({ sha })), commit: { committer: { date: options.noTimestamp ? null : c.date } }, files: page > 1 ? [] : files }
        : { id: sha, parent_ids: c.parents, committed_date: options.noTimestamp ? null : c.date };
      if (options.fileCap && gh) value.files = Array.from({ length: 3000 }, (_, i) => ({ filename: `docs/${i}.md`, status: 'modified' }));
    }
    return { code: 0, out: JSON.stringify(value) };
  };
  const records = await collectDeliveryEvidence([{ key: project + (gh ? '#' : '!') + '41', merged_ms: Date.parse(at) }], { run, audit: (...a) => audits.push(a), ...options.budgets });
  assert.equal(audits.length, calls.length, 'every request including pages and predecessors gets net audit');
  assert.ok(audits.every(a => a[0] === 'net'));
  assert.equal(new Set(calls.map(c => c.endpoint)).size, calls.length, 'same immutable metadata never refetched within run');
  if (!gh) assert.ok(calls.every(c => c.args[1] === '--hostname' && c.args[2] === 'forge.example'), 'self-managed hostname preserved');
  return { records, calls, audits, first: records[0] };
}
const test = async (name, fn) => { try { await fn(); console.log('case ' + name + ': PASS'); } catch (e) { console.error('case ' + name + ': FAIL'); e.message = name + ': ' + e.message; throw e; } };
for (const forge of ['github', 'gitlab']) {
  await test(`${forge} committer dates pagination and parent proof`, async () => {
    const x = await scenario(forge); assert.equal(openedSignal(x.first).state, 'first_try');
    assert.ok(x.calls.some(c => c.endpoint.includes('/commits?') && c.endpoint.includes('page=2')));
    const later = await scenario(forge, { later: true }); assert.equal(openedSignal(later.first).state, 'not_first_try');
  });
  await test(`${forge} base integration excludes imported base commits`, async () => {
    const x = await scenario(forge, { integration: true }); assert.equal(openedSignal(x.first).state, 'first_try');
    assert.ok(!x.first.lineage.some(c => c.sha === target));
    const unrelated = await scenario(forge, { integration: true, stranger: true }); assert.equal(openedSignal(unrelated.first).state, 'unknown'); assert.ok(unrelated.first.reasons.includes('non_base_merge'));
  });
  await test(`${forge} docs-only after open and unknown timestamps/rewrites`, async () => {
    assert.equal(openedSignal((await scenario(forge, { docs: true })).first).state, 'first_try');
    assert.equal(openedSignal((await scenario(forge, { noTimestamp: true })).first).state, 'unknown');
    assert.equal(openedSignal((await scenario(forge, { rewritten: true })).first).state, 'unknown');
  });
  await test(`${forge} failed page and request budget are explicit unknown`, async () => {
    const x = await scenario(forge, { fail: 'page=2' }); assert.equal(openedSignal(x.first).state, 'unknown'); assert.equal(x.first.completeness.commits, false);
    const budget = await scenario(forge, { budgets: { maxRequests: 1 } }); assert.ok(budget.first.reasons.includes('request_budget'));
  });
  await test(`${forge} recursively resolves closed unmerged predecessor`, async () => {
    const x = await scenario(forge, { chain: true }); assert.equal(x.records.length, 2); assert.equal(x.records[1].merged_ms, null); assert.equal(x.records[1].completeness.metadata, true);
    const missing = await scenario(forge, { chain: true, missingTarget: true }); assert.equal(missing.records[1].completeness.metadata, false);
  });
}
await test('GitHub 250 commits and 3000 files caps never prove absence', async () => {
  const c = await scenario('github', { cap: true }); assert.ok(c.first.reasons.includes('github_commits_cap')); assert.equal(openedSignal(c.first).state, 'unknown');
  const f = await scenario('github', { fileCap: true }); assert.ok(f.first.reasons.includes('github_files_cap')); assert.equal(openedSignal(f.first).state, 'unknown');
});
await test('GitLab tree inventories include chmod and fail closed at page budget', async () => {
  const x = await scenario('gitlab', { later: true, mode: true }); assert.equal(openedSignal(x.first).state, 'not_first_try');
  assert.ok(x.calls.some(c => c.endpoint.includes('/repository/tree?'))); assert.ok(!x.calls.some(c => c.endpoint.includes('/diff')));
  assert.equal(openedSignal((await scenario('gitlab', { treeFailure: true })).first).state, 'unknown');
  assert.equal(openedSignal((await scenario('gitlab', { compareTimeout: true })).first).state, 'unknown');
  const cap = await scenario('gitlab', { budgets: { maxPages: 1 } }); assert.ok(cap.first.reasons.includes('page_budget'));
});
await test('git off and unsupported Gitea cannot issue metadata network', async () => {
  let n = 0; const opts = { run: async () => { n++; throw new Error('network forbidden'); }, audit: () => { n++; } };
  assert.equal(await collectDeliveryEvidence([{ key: 'github.com/acme/app-api#1' }], { ...opts, enabled: false }), null);
  const x = await collectDeliveryEvidence([{ key: 'forge.example/acme/app-api#1' }], opts);
  assert.equal(n, 0); assert.ok(x[0].reasons.includes('unsupported_forge'));
});
