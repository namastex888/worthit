// RFC 0004: observations of branch cost, never authorship or model-quality claims.
import { deliveryIdentity, supersedes } from './delivery-forges.mjs';

const time = x => typeof x === 'number' ? x : Date.parse(x);
const utcDay = ms => new Date(ms).toISOString().slice(0, 10);
const usage = () => ({ rows: 0, output_tokens: 0, api_value_usd: 0 });
const addUsage = (to, a) => { to.rows++; to.output_tokens += a.output || 0; to.api_value_usd += a.usd || 0; };
const addCounters = (to, from) => { for (const k of ['rows', 'output_tokens', 'api_value_usd']) to[k] += from[k]; };
const proofKeys = ['metadata', 'commits', 'parents', 'diffs'];
const signal = (state, reason, complete = false) => ({ state, source: 'opened', reason, complete });

export function nonmaterialPath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('/') || p.split('/').includes('..')) return false;
  return p.startsWith('docs/') || /^(README|README\.md|LICENSE|LICENSE\.md|CHANGELOG\.md)$/i.test(p) || /\.(md|mdx|rst|txt|png|jpg|jpeg|gif|webp|svg|ico)$/i.test(p);
}
export function openedSignal(r) {
  if (!proofKeys.every(k => r.completeness?.[k])) return signal('unknown', r.reasons?.join(',') || 'incomplete_evidence');
  const opened = time(r.opened_at);
  if (!Number.isFinite(opened) || !Array.isArray(r.lineage) || !r.lineage.length || !r.base_ancestors?.length) return signal('unknown', 'incomplete_lineage');
  let later = false;
  for (const c of r.lineage) {
    const at = time(c.committed_at);
    if (!Number.isFinite(at) || !Array.isArray(c.parents) || !c.parents.length || !c.files_complete || !Array.isArray(c.files)) return signal('unknown', 'incomplete_commit');
    if (c.base_integration) {
      if (c.parents.length !== 2 || !r.base_ancestors.includes(c.parents[1])) return signal('unknown', 'unproven_parent_roles');
      continue;
    }
    if (c.parents.length !== 1) return signal('unknown', 'unproven_parent_roles');
    if (c.files.some(f => !f.path || !f.old_path)) return signal('unknown', 'incomplete_paths');
    if (at > opened && c.files.some(f => !nonmaterialPath(f.path) || !nonmaterialPath(f.old_path))) later = true;
  }
  return signal(later ? 'not_first_try' : 'first_try', later ? 'material_after_open' : 'no_material_after_open', true);
}

const newCoverage = () => ({ merged_prs: 0, canonical_deliveries: 0, linked_prs: 0, linked_deliveries: 0, ambiguous_prs: 0,
  signal_known_prs: 0, eligible: 0, unknown: 0, not_measured: 0, superseded_prs: 0, unresolved_chains: 0,
  implementation: usage(), review: usage(), unlinked: { ...usage(), by_reason: {} }, forges: [] });
const metric = keys => ({ ...keys, prs_led: 0, api_value_usd: 0, usd_per_pr_led: null, cost_floor: false, cost_reasons: [],
  first_pass: 0, not_first_pass: 0, unknown: 0, not_measured: 0, eligible: 0, first_pass_pct: null, first_pass_reason: 'insufficient_sample', coverage: newCoverage(), _evidence: new Set() });
const scopeRows = () => ({ models: new Map(), project_models: new Map(), daily: new Map() });
function scopes(tables, project, model, day) {
  const get = (map, keys) => { const k = JSON.stringify(keys); if (!map.has(k)) map.set(k, metric(keys)); return map.get(k); };
  return [get(tables.models, { model }), get(tables.project_models, { project, model }), get(tables.daily, { day, project, model })];
}
function forgeProof(records) {
  const hosts = new Map();
  for (const r of records) {
    const host = r.host || 'unknown';
    if (!hosts.has(host)) hosts.set(host, { host, answered: true, reasons: [], ...Object.fromEntries(proofKeys.map(k => [k, { complete: true, reasons: [] }])) });
    const f = hosts.get(host);
    for (const k of proofKeys) if (!r.completeness?.[k]) {
      f.answered = false; f[k].complete = false; f[k].reasons.push(...(r.reasons?.length ? r.reasons : ['incomplete_' + k]));
    }
    f.reasons.push(...r.reasons || []);
  }
  return [...hosts.values()].map(f => { f.reasons = [...new Set(f.reasons)]; for (const k of proofKeys) f[k].reasons = [...new Set(f[k].reasons)]; return f; });
}

export function buildDelivery(activity, g, { machines, projectFloor, start, end, exclude = [], scanStart = start }) {
  if (!g) return null;
  const physical = (g.project_prs || []).filter(p => p.merged_ms >= start && p.merged_ms < end);
  const records = new Map((g.delivery_evidence || []).map(r => [r.key, r]));
  for (const p of g.project_prs || []) if (!records.has(p.key)) records.set(p.key, { ...p, ...deliveryIdentity(p.key), completeness: {}, reasons: ['metadata_unavailable'] });
  const union = new Map([...records.keys()].map(k => [k, k]));
  const find = k => { const parent = union.get(k); if (parent === k) return k; const root = find(parent); union.set(k, root); return root; };
  const edges = new Map(), reasons = new Map(), successors = new Map();
  for (const r of records.values()) {
    const id = deliveryIdentity(r.key), ref = id && supersedes(r.title, id);
    if (ref?.reason || r.chain_reason) reasons.set(r.key, ref?.reason || r.chain_reason);
    if (!ref?.key) continue;
    const target = ref.key; edges.set(r.key, target);
    if (!union.has(target)) { union.set(target, target); records.set(target, { key: target, ...deliveryIdentity(target), completeness: {}, reasons: ['target_unavailable'] }); }
    const a = find(r.key), b = find(target); if (a !== b) union.set(a, b);
    if (!successors.has(target)) successors.set(target, []); successors.get(target).push(r.key);
  }
  const components = new Map();
  for (const r of records.values()) { const root = find(r.key); if (!components.has(root)) components.set(root, []); components.get(root).push(r); }
  const items = [], memberDelivery = new Map();
  for (const members of components.values()) {
    const merged = members.filter(r => Number.isFinite(r.merged_ms)).sort((a, b) => a.merged_ms - b.merged_ms);
    if (!merged.length) continue;
    const errors = [];
    for (const r of members) {
      if (reasons.has(r.key)) errors.push(reasons.get(r.key));
      if ((successors.get(r.key) || []).length > 1) errors.push('multiple_successors');
      if (members.length > 1 && !r.completeness?.metadata) errors.push('target_unavailable');
      const seen = new Set(); let k = r.key;
      while (edges.has(k)) { if (seen.has(k)) { errors.push('cycle'); break; } seen.add(k); k = edges.get(k); }
    }
    const roots = members.filter(r => !edges.has(r.key));
    if (roots.length !== 1) errors.push('unresolved_root');
    const root = roots[0] || [...members].sort((a, b) => a.key.localeCompare(b.key))[0];
    const d = { root: root.key, members: members.map(r => r.key).sort(), project: root.project || null,
      completed_day: utcDay(merged[0].merged_ms), completed_ms: merged[0].merged_ms, lead_model: null, lead_api_value_usd: null, lead_share_pct: null,
      implementation_api_value_usd: 0, review_api_value_usd: 0, api_value_usd: 0, cost_floor: false, cost_reasons: [], link_reasons: [],
      first_pass: null, _members: members, _errors: [...new Set(errors)], _models: new Map(), _implementation: usage(), _review: usage(), _linked: new Set(), _ambiguous: new Set() };
    items.push(d); for (const r of members) memberDelivery.set(r.key, d);
  }
  const branches = new Map();
  for (const r of records.values()) if (r.project && r.branch) { const k = JSON.stringify([r.project, r.branch]); if (!branches.has(k)) branches.set(k, []); branches.get(k).push(r); }
  const coverage = newCoverage(), tables = scopeRows(), unlinked = [];
  const miss = (a, reason, candidates = []) => {
    unlinked.push({ a, reason });
    for (const d of new Set(candidates.map(r => memberDelivery.get(r.key)).filter(Boolean))) {
      d.link_reasons.push(reason);
      if (reason === 'ambiguous_branch') for (const r of candidates) d._ambiguous.add(r.key);
    }
  };
  for (const a of activity) {
    const at = time(a.hour + ':00:00Z'); if (!(at < end)) continue;
    if (a.provider === 'omp' || a.provider === 'dsh' || a.provider === 'dsh-tui') { miss(a, a.provider === 'omp' ? 'omp_no_branch' : 'dsh_tui_no_branch'); continue; }
    if (!a.project) { miss(a, 'no_repository'); continue; }
    if (!a.branch) { miss(a, 'missing_branch', [...records.values()].filter(r => r.project === a.project)); continue; }
    const review = /^review\/pr-(\d+)-([0-9a-f]{8})$/i.exec(a.branch);
    if (a.branch.startsWith('review/pr-') && !review) { miss(a, 'review_unverified'); continue; }
    let matches;
    if (review) {
      matches = [...records.values()].filter(r => r.project === a.project && r.number === +review[1] && r.completeness?.commits && r.commits?.filter(c => c.sha.startsWith(review[2].toLowerCase())).length === 1);
      if (matches.length !== 1) { miss(a, 'review_unverified', [...records.values()].filter(r => r.project === a.project && r.number === +review[1])); continue; }
    } else {
      matches = branches.get(JSON.stringify([a.project, a.branch])) || [];
      if (matches.length !== 1) { miss(a, matches.length ? 'ambiguous_branch' : 'no_matching_branch', matches); continue; }
    }
    const r = matches[0], d = memberDelivery.get(r.key);
    if (!d || !Number.isFinite(r.merged_ms) && !r.opened_at) { miss(a, 'metadata_unavailable', matches); continue; }
    const cutoff = Number.isFinite(r.merged_ms) ? r.merged_ms : d._members.reduce((ms, x) => Math.max(ms, x.merged_ms || 0), 0);
    if (at > Math.floor(cutoff / 3600000) * 3600000) { miss(a, 'after_merge'); continue; }
    if (r.same_repository !== true || !r.completeness?.metadata || !r.completeness?.commits || r.forge === 'unsupported') { miss(a, 'incomplete_link_evidence', matches); continue; }
    addUsage(review ? d._review : d._implementation, a); d._linked.add(r.key);
    if (a.cost_complete !== true) { d.cost_reasons.push('unpriced_usage'); if (!review) d._implementationIncomplete = true; }
    if (!review) d._models.set(a.model, (d._models.get(a.model) || 0) + (a.usd || 0));
  }
  const inWindow = items.filter(d => d.completed_ms >= start && d.completed_ms < end);
  for (const d of items) {
    const members = d._members;
    if (!machines) d.cost_reasons.push('machines_incomplete');
    if (projectFloor) d.cost_reasons.push('project_usage_incomplete');
    if (!g.coverage?.prs) d.cost_reasons.push('forge_sources_incomplete');
    if (members.some(r => !r.completeness?.metadata || !r.completeness?.commits)) d.cost_reasons.push('metadata_incomplete');
    if (!Number.isFinite(scanStart) || members.some(r => !Number.isFinite(time(r.opened_at)) || time(r.opened_at) < scanStart)) d.cost_reasons.push('scan_window');
    if (d.link_reasons.length) d.cost_reasons.push('unlinked_usage');
    if (d._errors.length) d.cost_reasons.push('unresolved_chain');
    if (!d._implementation.rows) { d.link_reasons.push('no_implementation_usage'); d.cost_reasons.push('no_implementation_usage'); }
    const ranking = [...d._models].sort((a, b) => b[1] - a[1]);
    const tie = ranking.length > 1 && Math.abs(ranking[0][1] - ranking[1][1]) <= Math.max(Math.abs(ranking[0][1]), Math.abs(ranking[1][1])) * 1e-12;
    // Missing project/machine/branch or price evidence can hide a different largest model.
    const leadBlocked = !machines || projectFloor || !g.coverage?.prs || members.some(r => !r.completeness?.metadata || !r.completeness?.commits) || d._errors.length || d.link_reasons.some(x => x !== 'review_unverified') || d._implementationIncomplete || d.cost_reasons.includes('scan_window');
    if (!leadBlocked && ranking[0]?.[0] && ranking[0][0] !== '?' && ranking[0][1] > 0 && !tie) {
      d.lead_model = ranking[0][0]; d.lead_api_value_usd = ranking[0][1]; d.lead_share_pct = 100 * ranking[0][1] / d._implementation.api_value_usd;
    } else if (!d.lead_model) d.link_reasons.push(tie ? 'lead_tie' : 'lead_unavailable');
    d.implementation_api_value_usd = d._implementation.api_value_usd; d.review_api_value_usd = d._review.api_value_usd;
    d.api_value_usd = d.implementation_api_value_usd + d.review_api_value_usd;
    d.cost_reasons = [...new Set(d.cost_reasons)]; d.cost_floor = !!d.cost_reasons.length;
    d.link_reasons = [...new Set(d.link_reasons)];
    d.first_pass = exclude.includes(d.project) ? signal('not_measured', 'repository_opt_out') : d._errors.length ? signal('unknown', d._errors.join(',')) : members.length > 1 ? signal('not_first_try', 'superseded', true) : openedSignal(members[0]);
    d.provenance = members.map(r => ({ key: r.key, branch: r.branch || null, head_sha: r.head_sha || null, merged_at: Number.isFinite(r.merged_ms) ? new Date(r.merged_ms).toISOString() : null,
      completeness: Object.fromEntries(proofKeys.map(k => [k, !!r.completeness?.[k]])), reasons: r.reasons || [] }));
    if (!inWindow.includes(d)) continue;
    const rows = scopes(tables, d.project, d.lead_model, d.completed_day), known = ['first_try', 'not_first_try'].includes(d.first_pass.state);
    for (const c of [coverage, ...rows.map(r => r.coverage)]) {
      c.canonical_deliveries++; c.linked_deliveries += d._linked.size ? 1 : 0; c.eligible += known ? 1 : 0;
      c.unknown += d.first_pass.state === 'unknown' ? 1 : 0; c.not_measured += d.first_pass.state === 'not_measured' ? 1 : 0;
      c.superseded_prs += Math.max(0, members.length - 1); c.unresolved_chains += d._errors.length ? 1 : 0;
      addCounters(c.implementation, d._implementation); addCounters(c.review, d._review);
    }
    for (const row of rows) {
      for (const r of members) row._evidence.add(r);
      if (d.lead_model !== null) { row.prs_led++; row.api_value_usd += d.api_value_usd; }
      row.cost_floor ||= d.cost_floor; row.cost_reasons.push(...d.cost_reasons);
      row.first_pass += d.first_pass.state === 'first_try' ? 1 : 0; row.not_first_pass += d.first_pass.state === 'not_first_try' ? 1 : 0;
      row.unknown += d.first_pass.state === 'unknown' ? 1 : 0; row.not_measured += d.first_pass.state === 'not_measured' ? 1 : 0;
    }
  }
  // Raw physical counts stay visible even when a chain's canonical day is outside this window.
  for (const p of physical) {
    const d = memberDelivery.get(p.key), id = deliveryIdentity(p.key);
    const model = inWindow.includes(d) ? d.lead_model : null;
    const rows = scopes(tables, id?.project || null, model, utcDay(p.merged_ms));
    for (const row of rows) for (const r of d?._members || [records.get(p.key)]) if (r) row._evidence.add(r);
    for (const c of [coverage, ...rows.map(r => r.coverage)]) {
      c.merged_prs++; c.linked_prs += d?._linked.has(p.key) ? 1 : 0; c.ambiguous_prs += d?._ambiguous.has(p.key) ? 1 : 0;
      c.signal_known_prs += ['first_try', 'not_first_try'].includes(d?.first_pass?.state) ? 1 : 0;
    }
  }
  for (const { a, reason } of unlinked) {
    const at = time(a.hour + ':00:00Z'); if (!(at >= start && at < end)) continue;
    const rows = scopes(tables, a.project || null, a.model || null, utcDay(at));
    for (const row of rows) for (const r of records.values()) if (a.project && r.project === a.project) row._evidence.add(r);
    for (const c of [coverage, ...rows.map(r => r.coverage)]) {
      addUsage(c.unlinked, a); if (!c.unlinked.by_reason[reason]) c.unlinked.by_reason[reason] = usage(); addUsage(c.unlinked.by_reason[reason], a);
    }
  }
  coverage.forges = forgeProof([...records.values()]);
  const finish = map => [...map.values()].map(r => {
    r.eligible = r.first_pass + r.not_first_pass; r.usd_per_pr_led = r.prs_led ? r.api_value_usd / r.prs_led : null;
    r.first_pass_pct = r.eligible >= 5 ? 100 * r.first_pass / r.eligible : null; r.first_pass_reason = r.eligible >= 5 ? null : 'insufficient_sample';
    r.cost_reasons = [...new Set(r.cost_reasons)];
    const scoped = [...r._evidence];
    delete r._evidence;
    r.coverage.forges = forgeProof(scoped);
    return r;
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { source: 'opened', label: 'opened date proxy', window: { from: new Date(start).toISOString(), to: new Date(end).toISOString() },
    coverage, deliveries: inWindow.map(d => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_') && k !== 'completed_ms'))),
    models: finish(tables.models), project_models: finish(tables.project_models), daily: finish(tables.daily) };
}
