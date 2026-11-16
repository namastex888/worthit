import fs from 'node:fs';
const [command, ...args] = process.argv.slice(2), env = process.env;
fs.appendFileSync(env.FIXTURE_TRACE, JSON.stringify({ command, args }) + '\n');
if (command === 'usagemeter') {
  if (args[0] === 'status') console.log(JSON.stringify({ version: 'fixture', state_dir: env.METER_STATE_DIR }));
  else if (args[0] !== 'sync') process.exit(86);
} else if (args[0] === 'auth') {
  console.log(command === 'gh' ? 'Logged in to github.com account coder-a\n  - Active account: true' : 'forge.example\n  ✓ Logged in to forge.example as coder-a');
} else if (args[0] === 'api') {
  const gh = command === 'gh', endpoint = args.at(-1), sha = n => n.toString(16).padStart(40, '0');
  const base = sha(1), target = sha(2), head = sha(3), merge = sha(4), merged = '2026-11-13T15:00:00Z';
  if (args.includes('search/issues')) {
    const q = args.find(a => a.startsWith('q=')), range = /merged:(\S+)\.\.(\S+)/.exec(q);
    if (merged >= range[1] && merged <= range[2]) console.log(`https://api.github.com/repos/acme/app-api\t41\t${merged}\tfeat: synthetic delivery`);
  } else {
    const url = new URL('https://fixture.example/' + endpoint), route = url.pathname, page = +(url.searchParams.get('page') || 0);
    let v;
    if (endpoint.startsWith('merge_requests?')) v = [{ iid: 41, merged_at: merged, title: 'feat: synthetic delivery', references: { full: 'acme/web-client!41' } }];
    else if (/\/(pulls|merge_requests)\/41$/.test(route)) v = gh ? { number: 41, title: 'feat: synthetic delivery', created_at: '2026-11-11T12:00:00Z', merged_at: merged, commits: 1, head: { ref: 'feat/example', sha: head, repo: { full_name: 'acme/app-api' } }, merge_commit_sha: merge }
      : { iid: 41, title: 'feat: synthetic delivery', created_at: '2026-11-11T12:00:00Z', merged_at: merged, source_branch: 'feat/example', source_project_id: 1, target_project_id: 1, diff_refs: { start_sha: target, head_sha: head }, merge_commit_sha: merge };
    else if (/\/(pulls|merge_requests)\/41\/commits$/.test(route)) v = page === 1 ? [gh ? { sha: head } : { id: head }] : [];
    else if (route.includes('/compare/')) v = { status: endpoint.includes(base + '...') ? 'ahead' : 'diverged' };
    else if (route.endsWith('/repository/compare')) v = {};
    else if (route.endsWith('/repository/tree')) v = page === 1 ? [{ path: 'src/app.mjs', type: 'blob', mode: '100644', id: url.searchParams.get('ref') === base ? 'old' : 'new' }] : [];
    else if (route.includes('/commits/')) {
      const at = route.split('/').at(-1), parents = at === merge ? [target, head] : at === target ? [base] : at === head ? [base] : [];
      v = gh ? { sha: at, parents: parents.map(sha => ({ sha })), commit: { committer: { date: '2026-11-11T12:00:00Z' } }, files: page > 1 ? [] : [{ filename: 'src/app.mjs', status: 'modified' }] }
        : { id: at, parent_ids: parents, committed_date: '2026-11-11T12:00:00Z' };
    } else { fs.appendFileSync(env.FIXTURE_TRACE, JSON.stringify({ unexpected: endpoint }) + '\n'); process.exit(86); }
    console.log(JSON.stringify(v));
  }
} else process.exit(86);
