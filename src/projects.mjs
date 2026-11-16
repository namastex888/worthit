// RFC 0004 delivery 1: local project usage, never dashboard or share content.
import { buildDelivery } from './delivery-models.mjs';
export const PROJECT_REASONS = ['outside_a_repository', 'no_origin', 'origin_not_supported', 'folder_gone', 'no_folder_read', 'saved_before_projects'];
const unresolved = new Set(PROJECT_REASONS.slice(2));

export function projectFromKey(key) {
  const repo = String(key).replace(/[#!]\d+$/, '');
  // Forge keys already have a host; never invent one for owner/repo or gitea/owner/repo.
  try {
    const u = new URL('https://' + repo), host = u.hostname.toLowerCase();
    if (!host.includes('.') || u.username || u.password || u.search || u.hash) return null;
    const p = u.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase();
    return p && !p.split('/').some(x => !x || x === '.' || x === '..') ? u.host.toLowerCase() + '/' + p : null;
  } catch { return null; }
}

export function buildProjects(activity, g, machines, start, end, options = {}) {
  const rows = new Map(), no = { api_value_usd: 0, output_tokens: 0, requests: 0, why_usd: Object.fromEntries(PROJECT_REASONS.map(k => [k, 0])) };
  const rowFor = id => { if (!rows.has(id)) rows.set(id, { project: id, name: id.split('/').at(-1), api_value_usd: 0, output_tokens: 0, requests: 0, merged_prs: g ? 0 : null, usd_per_merged_pr: null, models: new Map() }); return rows.get(id); };
  const add = (row, a) => { row.api_value_usd += a.usd || 0; row.output_tokens += a.output || 0; row.requests += a.requests || 0; };
  let unresolvedRows = 0, unresolvedUsd = 0;
  for (const a of activity) {
    // The usage window deliberately matches totals, including its hourly boundary.
    if (!(Date.parse(a.hour + ':00:00Z') >= start)) continue;
    if (!a.project) {
      const why = PROJECT_REASONS.includes(a.project_why) ? a.project_why : 'saved_before_projects';
      add(no, a); no.why_usd[why] += a.usd || 0;
      if (unresolved.has(why)) { unresolvedRows++; unresolvedUsd += a.usd || 0; }
    } else {
      const row = rowFor(a.project); add(row, a);
      const key = JSON.stringify([a.provider, a.model]);
      if (!row.models.has(key)) row.models.set(key, { model: a.model, tool: a.provider, api_value_usd: 0, output_tokens: 0, requests: 0, share_pct: null });
      add(row.models.get(key), a);
    }
  }
  let unattributed = 0;
  if (g) for (const { key, merged_ms } of g.project_prs || g.prs.map(merged_ms => ({ key: '', merged_ms }))) {
    if (!(merged_ms >= start && merged_ms < end)) continue;
    const id = projectFromKey(key);
    if (id) rowFor(id).merged_prs++; else unattributed++;
  }
  const attributedUsd = [...rows.values()].reduce((n, r) => n + r.api_value_usd, 0), total = attributedUsd + no.api_value_usd;
  const names = new Map(); for (const r of rows.values()) names.set(r.name, (names.get(r.name) || 0) + 1);
  for (const r of rows.values()) {
    if (names.get(r.name) > 1) r.name = r.project.split('/').slice(1).join('/');
    r.models = [...r.models.values()].sort((a, b) => b.api_value_usd - a.api_value_usd || a.model.localeCompare(b.model));
    for (const m of r.models) { m.share_pct = r.api_value_usd ? Math.round(100 * m.api_value_usd / r.api_value_usd) : null; m.api_value_usd = Math.round(m.api_value_usd); }
    r.api_value_usd = Math.round(r.api_value_usd);
    r.usd_per_merged_pr = r.merged_prs ? r.api_value_usd / r.merged_prs : null;
  }
  no.api_value_usd = Math.round(no.api_value_usd);
  for (const k of PROJECT_REASONS) no.why_usd[k] = Math.round(no.why_usd[k]);
  return { floor: !machines || unresolvedRows !== 0,
    coverage: { machines, unresolved_rows: unresolvedRows, unresolved_usd: Math.round(unresolvedUsd), attributed_pct: total ? Math.round(100 * attributedUsd / total) : null,
      prs_sources: g ? !!g.coverage?.prs : null, prs_attributed: g ? unattributed === 0 : null },
    delivery: buildDelivery(activity, g, { machines, projectFloor: !machines || unresolvedRows !== 0, start, end, ...options }),
    rows: [...rows.values()].sort((a, b) => b.api_value_usd - a.api_value_usd || a.project.localeCompare(b.project)), no_repository: no,
    prs_without_project: g ? { merged_prs: unattributed, why: { no_host_in_key: unattributed } } : null };
}

export function projectsResult(data) {
  if (!data.projects) throw new Error('last run predates projects. Run `worthit --json` first.');
  return { ...data.projects, week: data.week, generated_at: data.generated_at,
    ...Object.fromEntries(['machines_missing', 'machines_left_out', 'machines_retained', 'machines_retired'].map(k => [k, data[k] || []])) };
}

export function projectsText(data) {
  const p = projectsResult(data), partial = p.coverage.prs_sources === false || p.coverage.prs_attributed === false;
  const floor = p.floor ? 'at least ' : '', prFloor = partial ? 'at least ' : '';
  const usage = r => `${floor}$${r.api_value_usd} | ${floor}${r.output_tokens} output tokens | ${floor}${r.requests} requests`;
  const lines = [`Projects · ${p.week.from} to ${p.week.to} · saved ${p.generated_at}`,
    `Machine coverage: ${p.coverage.machines ? 'complete' : 'incomplete'}; unresolved: ${p.coverage.unresolved_rows} rows / $${p.coverage.unresolved_usd}; attributed: ${p.coverage.attributed_pct ?? 'n/a'}%`,
    ...p.rows.flatMap(r => [`${r.name} (${r.project}) | ${usage(r)} | ${r.merged_prs == null ? 'PRs unavailable' : prFloor + r.merged_prs + ' merged PRs'} | ${r.usd_per_merged_pr == null ? 'cost n/a' : (partial ? '' : floor) + '$' + r.usd_per_merged_pr + '/PR' + (partial ? ' (partial PR count)' : '')}`,
      ...r.models.map(m => `  ${m.model} / ${m.tool} | ${usage(m)} | ${m.share_pct ?? 'n/a'}% value`)]),
    `No repository | ${usage(p.no_repository)}`,
    ...Object.entries(p.no_repository.why_usd).map(([why, usd]) => `  ${why}: ${floor}$${usd}`),
    ...(p.prs_without_project ? [`PRs without project: ${prFloor}${p.prs_without_project.merged_prs} (no_host_in_key)`] : ['PR data is off. Run `worthit --json` to fill PR counts and costs.']),
    ...(p.delivery ? [`Delivery · opened date proxy · ${p.delivery.coverage.canonical_deliveries} canonical deliveries (${p.delivery.coverage.merged_prs} physical merged PRs)`,
      ...p.delivery.project_models.map(r => `${r.project || 'No repository'} / ${r.model || 'No inferred lead'} | ${r.prs_led} PRs led | ${r.usd_per_pr_led == null ? 'cost n/a' : (r.cost_floor ? 'at least ' : '') + '$' + r.usd_per_pr_led + '/delivery'} | first try ${r.first_pass}/${r.eligible} eligible | ${r.first_pass_pct == null ? 'insufficient sample (minimum 5)' : r.first_pass_pct + '%'} | unknown ${r.unknown} | not measured ${r.not_measured}`),
      `Unlinked usage: ${JSON.stringify(p.delivery.coverage.unlinked.by_reason)}; daily: worthit get projects.delivery.daily`] : ['Delivery data unavailable. Run `worthit --json` with git on.']),
    ...['machines_missing', 'machines_left_out', 'machines_retained', 'machines_retired'].map(k => `${k}: ${JSON.stringify(p[k])}`)];
  return lines.join('\n');
}
