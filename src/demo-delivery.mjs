// Synthetic delivery observations; no settings, store, process or network reads.
import { buildDelivery } from './delivery-models.mjs';
export function demoDelivery(data, now) {
  const end = +now, start = end - 7 * 864e5, records = [], activity = [];
  let number = 0;
  for (const row of data.projects.rows) for (let i = 0; i < row.merged_prs; i++) {
    number++;
    const merged_ms = start + (i % 6 + 1) * 864e5, sha = number.toString(16).padStart(40, '0'), opened_at = new Date(merged_ms - 864e5).toISOString();
    const r = { key: row.project + '#' + number, project: row.project, host: 'github.com', forge: 'github', number, merged_ms, title: 'feat: synthetic delivery',
      branch: 'feat/example-' + number, head_sha: sha, opened_at, same_repository: true, commits: [{ sha }], base_ancestors: ['base'],
      completeness: { metadata: true, commits: true, parents: i % 7 !== 0, diffs: true }, reasons: i % 7 === 0 ? ['synthetic_incomplete_ancestry'] : [],
      lineage: [{ sha, parents: ['base'], committed_at: i % 3 === 0 ? new Date(merged_ms - 3600000).toISOString() : opened_at, files_complete: true, files: [{ path: 'src/app.mjs', old_path: 'src/app.mjs' }] }] };
    records.push(r); activity.push({ project: row.project, branch: r.branch, provider: 'claude', model: 'opus-5-5', hour: new Date(merged_ms - 3600000).toISOString().slice(0, 13), usd: row.api_value_usd / row.merged_prs, output: 1000, cost_complete: true });
  }
  return buildDelivery(activity, { project_prs: records, delivery_evidence: records, coverage: { prs: true } }, { machines: true, projectFloor: data.projects.floor, start, end, scanStart: start - 14 * 864e5, exclude: ['github.com/acme/docs-site'] });
}
