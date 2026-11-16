// Read-only RFC 0004 evidence. No repository checkout, code fetch, auth change or persistent cache.
import { projectFromKey } from './projects.mjs';

const SHA = /^[a-f0-9]{40,64}$/i;
export function deliveryIdentity(key) {
  const project = projectFromKey(key), match = /([#!])(\d+)$/.exec(key);
  if (!project || !match) return null;
  const host = project.split('/')[0], repo = project.slice(host.length + 1);
  const forge = host === 'github.com' && match[1] === '#' ? 'github' : match[1] === '!' ? 'gitlab' : 'unsupported';
  return { project, host, repo, forge, number: +match[2], mark: match[1] };
}

export function supersedes(title, id) {
  const text = String(title || '').trim(), m = /^Supersedes ([#!])(\d+)$/i.exec(text);
  if (m) return m[1] === id.mark ? { key: `${id.project}${m[1]}${+m[2]}` } : { reason: 'wrong_reference_type' };
  return /^Supersedes\b/i.test(text) ? { reason: 'invalid_supersede_reference' } : null;
}

export async function collectDeliveryEvidence(physical, { run, audit, enabled = true, maxRequests = 1200, maxPages = 30, maxItems = 300 } = {}) {
  if (!enabled) return null;
  let remaining = maxRequests;
  const records = new Map(), cache = new Map();
  const request = async (id, endpoint) => {
    const key = `${id.host}/${endpoint}`;
    if (cache.has(key)) return cache.get(key);
    const pending = (async () => {
      if (remaining-- <= 0) throw new Error('request_budget');
      const cli = id.forge === 'github' ? 'gh' : 'glab';
      const args = cli === 'gh' ? ['api', endpoint] : ['api', '--hostname', id.host, endpoint];
      audit('net', `${cli} ${args.join(' ')}  (delivery metadata)`);
      const result = await run(cli, args, 30000);
      if (result.code !== 0) throw new Error('request_failed');
      try { return JSON.parse(result.out); } catch { throw new Error('invalid_response'); }
    })();
    cache.set(key, pending); return pending;
  };
  const pages = async (id, endpoint, limit = Infinity) => {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const list = await request(id, `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(list)) throw new Error('invalid_page');
      all.push(...list);
      if (all.length >= limit) throw new Error('api_cap');
      // Ask for an empty terminator too: malformed/truncated intermediate pages fail closed.
        if (!list.length) return all;
    }
    throw new Error('page_budget');
  };
  const readItem = async (key, merged_ms = null, depth = 0) => {
    if (records.has(key)) return;
    const id = deliveryIdentity(key), r = { key, ...id, merged_ms, title: '', branch: null, commits: [], lineage: [],
      base_ancestors: [], completeness: { metadata: false, commits: false, parents: false, diffs: false }, reasons: [] };
    records.set(key, r);
    if (!id || id.forge === 'unsupported') { r.reasons.push('unsupported_forge'); return; }
    if (records.size > maxItems || depth > 40) { r.reasons.push('chain_budget'); return; }
    const gh = id.forge === 'github', prefix = gh ? `repos/${id.repo}` : `projects/${encodeURIComponent(id.repo)}`;
    const itemPath = `${prefix}/${gh ? 'pulls' : 'merge_requests'}/${id.number}`;
    const commitPath = sha => `${prefix}/${gh ? 'commits' : 'repository/commits'}/${sha}`;
    const metadata = async sha => {
      if (!SHA.test(sha || '')) throw new Error('missing_sha');
      const c = await request(id, commitPath(sha));
      const parents = gh ? c.parents?.map(p => p.sha) : c.parent_ids;
      if (!Array.isArray(parents) || parents.some(p => !SHA.test(p))) throw new Error('missing_parents');
      if ((gh ? c.sha : c.id) !== sha) throw new Error('commit_identity');
      return { raw: c, sha, parents, committed_at: gh ? c.commit?.committer?.date : c.committed_date };
    };
    const tree = async sha => {
      // A tree inventory proves file names even when GitLab's /diff silently reaches its file cap.
      const list = await pages(id, `${prefix}/repository/tree?ref=${sha}&recursive=true`);
      const map = new Map();
      for (const f of list) {
        if (!f.path || !f.type || !f.id || !f.mode || map.has(f.path)) throw new Error('incomplete_tree');
        if (f.type !== 'tree') map.set(f.path, `${f.type}:${f.id}:${f.mode}`);
      }
      return map;
    };
    const changedFiles = async c => {
      if (gh) {
        const files = [], first = c.raw;
        if (!Array.isArray(first.files)) throw new Error('missing_files');
        for (let page = 1; page <= maxPages; page++) {
          const v = page === 1 ? await request(id, `${commitPath(c.sha)}?per_page=100&page=1`) : await request(id, `${commitPath(c.sha)}?per_page=100&page=${page}`);
          if (!Array.isArray(v.files)) throw new Error('missing_files');
          files.push(...v.files);
          if (files.length >= 3000) throw new Error('github_files_cap');
          if (!v.files.length) {
            if (new Set(files.map(f => f.filename)).size !== files.length) throw new Error('duplicate_file_page');
            return files.map(f => {
            if (!f.filename || !f.status || f.status === 'renamed' && !f.previous_filename) throw new Error('missing_file_path');
            return { path: f.filename, old_path: f.previous_filename || f.filename };
            });
          }
        }
        throw new Error('page_budget');
      }
      const before = await tree(c.parents[0]), after = await tree(c.sha);
      return [...new Set([...before.keys(), ...after.keys()])].filter(p => before.get(p) !== after.get(p)).map(p => ({ path: p, old_path: p }));
    };
    try {
      const item = await request(id, itemPath);
      if (+item[gh ? 'number' : 'iid'] !== id.number || !item.created_at || !item.title || !item[gh ? 'head' : 'diff_refs']) throw new Error('missing_metadata');
      r.title = item.title; r.opened_at = item.created_at;
      r.merged_ms = item.merged_at ? Date.parse(item.merged_at) : merged_ms;
      r.branch = gh ? item.head?.ref : item.source_branch;
      r.head_sha = gh ? item.head?.sha : item.diff_refs?.head_sha;
      r.completeness.metadata = !!r.branch && SHA.test(r.head_sha || '') && Number.isFinite(Date.parse(r.opened_at));
      // Cross-repository source branches are ambiguous against local canonical origin ids.
      const source = gh ? item.head?.repo?.full_name : item.source_project_id;
      r.same_repository = gh ? typeof source === 'string' && source.toLowerCase() === id.repo : source != null && source === item.target_project_id;
      r.supersedes = supersedes(r.title, id);
      if (r.supersedes?.key) await readItem(r.supersedes.key, null, depth + 1);
      try {
        const list = await pages(id, `${itemPath}/commits`, gh ? 250 : Infinity);
        r.commits = list.map(c => ({ sha: gh ? c.sha : c.id }));
        if (r.commits.some(c => !SHA.test(c.sha || '')) || new Set(r.commits.map(c => c.sha)).size !== r.commits.length || !r.commits.some(c => c.sha === r.head_sha)) throw new Error('incomplete_commits');
        if (gh && (!Number.isInteger(item.commits) || item.commits !== list.length)) throw new Error('incomplete_commits');
        r.completeness.commits = true;
      } catch (e) { r.reasons.push(e.message === 'api_cap' ? 'github_commits_cap' : e.message); }
      // A normal GitHub merge proves its pre-merge target by the merge's first parent.
      // A squash/rebase does not retain those roles and cannot establish first-pass truth.
      if (gh) {
        const merge = await metadata(item.merge_commit_sha);
        if (merge.parents.length !== 2 || merge.parents[1] !== r.head_sha) throw new Error('rewritten_or_unproven_merge');
        r.base_before_sha = merge.parents[0];
      } else {
        // start_sha is target HEAD when the historical MR diff version was created.
        r.base_before_sha = item.diff_refs?.start_sha;
        const merge = await metadata(item.merge_commit_sha);
        if (merge.parents.length !== 2 || merge.parents[1] !== r.head_sha || !SHA.test(r.base_before_sha || '')) throw new Error('rewritten_or_unproven_merge');
        r.base_before_sha = merge.parents[0];
      }
      const isBase = async sha => {
        if (sha === r.base_before_sha) return true;
        const v = await request(id, gh ? `${prefix}/compare/${sha}...${r.base_before_sha}?per_page=1` : `${prefix}/repository/compare?from=${sha}&to=${r.base_before_sha}&straight=true`);
        if (v.compare_timeout || v.overflow) throw new Error('incomplete_compare');
        if (gh) {
          if (!['ahead', 'identical', 'behind', 'diverged'].includes(v.status)) throw new Error('missing_ancestry');
          return v.status === 'ahead' || v.status === 'identical';
        }
        // Compare merge-base is not exposed consistently by older GitLab hosts. Walk the
        // historical target graph instead, with a hard bound, to prove exact membership.
        const seen = new Set(), pending = [r.base_before_sha];
        while (pending.length) {
          const at = pending.pop(); if (at === sha) return true;
          if (seen.has(at)) continue; seen.add(at);
          if (seen.size > 250) throw new Error('ancestry_budget');
          pending.push(...(await metadata(at)).parents);
        }
        return false;
      };
      const seen = new Set(); let at = r.head_sha;
      while (true) {
        if (seen.has(at) || seen.size >= 250) throw new Error('lineage_budget');
        seen.add(at);
        if (await isBase(at)) { r.base_ancestors.push(at); break; }
        const c = await metadata(at);
        if (!c.parents.length || c.parents.length > 2) throw new Error('unproven_parent_roles');
        if (!Number.isFinite(Date.parse(c.committed_at))) throw new Error('missing_timestamp');
        if (c.parents.length === 2) {
          if (!await isBase(c.parents[1])) throw new Error('non_base_merge');
          if (await isBase(c.parents[0])) throw new Error('unproven_parent_roles');
          r.base_ancestors.push(c.parents[1]);
          c.base_integration = true; c.files = []; c.files_complete = true;
        } else {
          c.files = await changedFiles(c); c.files_complete = true;
        }
        r.lineage.push({ sha: c.sha, parents: c.parents, committed_at: c.committed_at, base_integration: !!c.base_integration, files: c.files, files_complete: c.files_complete });
        at = c.parents[0];
      }
      r.completeness.parents = true; r.completeness.diffs = true;
    } catch (e) { r.reasons.push(e.message); }
    r.reasons = [...new Set(r.reasons)];
  };
  for (const p of physical) await readItem(p.key, p.merged_ms);
  for (const r of records.values()) {
    const id = deliveryIdentity(r.key);
    if (!id || id.forge === 'unsupported') continue;
    const ref = supersedes(r.title, id);
    if (ref?.reason) r.chain_reason = ref.reason;
    if (ref?.key) {
      r.predecessor = ref.key;
      if (!records.has(ref.key)) {
        if (records.size >= maxItems) records.set(ref.key, { key: ref.key, ...deliveryIdentity(ref.key), reasons: ['chain_budget'], completeness: {} });
        else await readItem(ref.key, null);
      }
    }
  }
  return [...records.values()];
}
