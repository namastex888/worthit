// worthit query commands: instant answers from what earlier runs stored (no scan, no model, no network).
//   worthit get [section[.field…]]      a part of the last run's data (plans, months, model_mix, tools, waste, git, events, game, totals…)
//   worthit days [--since D] [--until D] [--group day|week|month] [--by total|tool|model] [--tool X] [--model X]
//   worthit sql "SELECT …"              read-only SQL over the local store
//   worthit schema                      tables and columns of the store, with what each means
//   worthit --skill                     the full guide for agents (Markdown)
import './quiet.mjs';
import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');   // loaded here, after quiet.mjs, so its 'experimental' warning stays silent
import { HOME, ROOT } from './collect.mjs';

const DB = path.join(HOME, 'worthit.db'), LAST = path.join(HOME, 'last.json');
const out = v => console.log(JSON.stringify(v, null, 1));
const fail = msg => { throw new Error(msg); };
const open = () => { if (!fs.existsSync(DB)) fail('no local store yet. Run `worthit --json` once to scan and fill it.'); return new DatabaseSync(DB, { readOnly: true }); };

export const SCHEMA = {
  'weekly.result': { about: 'worthit weekly [--hosts all|none|a,b] [--allow-partial] [--no-files]: fresh headless allowance scan; hosts default all, git/AI off. Fixed allowance template, no questions, browser UI, clipboard or posting. Exit 0 safe or explicitly allowed partial, 1 scan/no-data/render/audit/store failure, 3 unsafe with JSON still printed. Chrome/Chromium renders the PNG unless --no-files.', fields: {
    week: '{from, to}: YYYY-MM-DD rolling seven-day window', generated_at: 'ISO checkpoint time', text: 'fixed SHARE_TOPICS.allowance post', image: 'absolute <date>-worthit-share-allowance.png path, or null with --no-files; --demo uses synthetic data with null baseline/image and never reads or writes a store or files',
    audit_log: 'absolute <date>-worthit-audit.log path beside the PNG, same audit format as a plain scan; null with --no-files or --demo; checkpoint store still updated with --no-files',
    plans: 'array of {plan, usd_per_full_week, times_plan_price, proof: measured | floor, change_vs_last_week_pct: number | null, retirement_note?: string}; retirement_note quotes any --since statement beside a measured plan; change requires same-plan measured proof at both checkpoint endpoints; ledger changes never used',
    machines_read: 'number of machines included in the scan', machines_missing: 'array of {machine, saved_scan_at}: no fresh answer, saved scan may stand in', machines_left_out: 'saved machines with usage or unknown saved data omitted from this scan; aliases removed from SSH config stay left out until retired or covered by a fresh equivalent-machine answer', machines_retired: 'array of {machine, retired_at, last_scan_at, days_kept}; frozen retired snapshots, never missing or left out', machines_retained: 'array of {machine, days_kept, units: [{day, provider}]} as in the last-run field',
    compared_with: 'null or {generated_at, week_to, plans: [{plan, usd_per_full_week, proof}]} from the latest earlier checkpoint ending at least six days earlier; never search past a floor; a baseline week starting before a current retirement is treated as floor without rewriting the saved checkpoint',
    moved: 'array of {plan, from, to, pct}: only eligible absolute changes strictly greater than 5%', safe_to_post: 'true iff no missing/left-out machines and no retained units overlap this week; floors alone, including pre-retirement weeks, and prior retained units are safe', reasons: 'array of unsafe-machine explanations; retained reasons name machine, day and provider' } },
  weekly: { about: 'One row per worthit weekly checkpoint, including unsafe runs and --no-files. Compared endpoints must both be measured for the same plan in JSON, text and card; first checkpoint changes are null even with ledger history.', columns: {
    generated_at: 'TEXT PRIMARY KEY: ISO checkpoint time', week_to: 'TEXT: end of rolling week (YYYY-MM-DD)', safe: 'INTEGER: 1 safe to post, 0 unsafe (unaffected by --allow-partial)', json: 'TEXT: complete weekly.result JSON' } },
  'git.coverage': { about: 'Last-run JSON field (worthit get git.coverage), not a SQL table. Within the git 14-day window each metric replaces stored daily counts only with full coverage; otherwise history.json and SQLite day keep per-metric MAX. False prs marks this week merged PRs, features and kind counts as floors (at least); merged_prs_change_pct, usd_per_pr_change_pct, delivery.features_change_pct, delivery.usd_per_feature_change_pct and delivery.kinds[].change_pct are number | null and are null without PR coverage. PR-derived personal bests are suppressed. Cost ratios retain observed values but use partial PR/feature counts, are not lower bounds, and are not compared. False commits independently marks this week commits as at least. No commits change field exists. Outside that window counts keep MAX. Absent gh/tea/glab CLIs and explicit empty login inventories are skipped as a source with an audit note, omitted from sources, and do not reduce coverage. glab classifies each host: No token found with no login line is skipped, including gitlab.com beside a successful self-hosted login; aggregate exit 1 alone does not fail discovery. Host errors with tokens, malformed inventories, process execution failures and partial logged-in answers remain failures. glab auth status can contact gitlab.com even without a token.', fields: {
    prs: 'boolean: usagemeter and every selected forge source answered; a nonzero sync or pending meter work is uncovered but existing data is still read',
    commits: 'boolean: meter repository discovery and every local git log answered, independent of forges; newest existing checkout per repo. No checkout left is a note, not a failed source; commit coverage is false if its exact session overlaps inclusive now - 14 days through now OR a mapped meter file has mtime_ms >= now - 14 days; main Claude context may hold cwd alone. Both checks are additive. An unavailable recency query keeps MAX conservatively while readable checkouts still contribute live logs',
    sources: 'array of {source, answered, metrics}: source is usagemeter, git log, gh:<account>, glab:<host>, or tea; gh discovery / glab discovery / tea discovery names failed discovery. answered is boolean; metrics is an array of prs and/or commits. Both multi-account and older gh login output are supported. See audit notes for no-checkout retention.' } },
  'hosts.json': { about: 'worthit hosts lists SSH machines as selected, not selected or retired (JSON when piped). worthit hosts retire <machine> [--since YYYY-MM-DD] freezes run-keep/<alias>.json at run-keep/retired/<alias>.json; refuses absent/unreadable scans and suggests leaving the alias out instead. Unretire restores the snapshot and saved selection. No scan or network request.', fields: {
    selected: 'array of active SSH aliases; retired aliases are excluded even from --hosts all or an explicit alias',
    retired: 'array of {machine, retired_at, last_scan_at, since?: YYYY-MM-DD}; legacy absent key means []; retired_at defaults to now, or --since at UTC midnight, never before last_scan_at or in the future. since records the user statement. Invalid retired_at or corrupt state fails every non-demo command cleanly with exit 2: worthit: cannot read <path>: <reason>. Fix or remove it. No run writes the frozen snapshot' } },
  machines_retired: { about: 'Last-run and weekly JSON field, not a SQL table. Snapshot units inside the run window stand in for retired machines. A duplicate live host (including local) is merged with the snapshot by the whole-day/provider USD, tokens, fresh-tie rule, never summed. The partial oldest day is protected by history MAX. Pre-retirement weeks stay floors; machine notes name the alias and first possible measured week end. Missing frozen snapshots fail the run with advice to restore it or use hosts unretire; unretire with no snapshot removes retirement and reselects the alias.', fields: {
    machine: 'retired SSH alias', retired_at: 'ISO retirement time; each measured week must start on or after every retired_at', last_scan_at: 'ISO time of the frozen saved scan', days_kept: 'distinct local days whose frozen units were selected inside this run window; decreases as the window moves' } },
  retirement_conflicts: { about: 'Last-run JSON field: retired snapshots whose host answers live under another alias or locally. Machine notes say <machine> is retired but answers as <same_as>.', fields: {
    machine: 'retired SSH alias', same_as: 'answering SSH alias or this machine' } },
  'plans.weeks': { about: 'Last-run per-plan rolling allowance history. Week 0 carries its actual proof. A ledger week gets floor only when retirement or retained units block it; otherwise proof is absent. Ledger weeks carry no machine check. Ordinary comparison eligibility remains unchanged. Only Claude currently has a measurable meter.', fields: {
    weeks_ago: '0 current, 1 previous, up to 11', to: 'YYYY-MM-DD week end', usd: 'API value per full weekly limit', proof: 'week 0: measured | floor; ledger week: floor when blocked by retirement or retained units, otherwise absent; ≥ on a history chart marks a known floor', retirement_note: 'optional field on the current plan (also weekly plans): <machine>: retired since <date>, as stated by you; printed next to a measured plan relying on --since' } },
  machines_retained: { about: 'Last-run JSON field (also available with worthit get machines_retained), not a SQL table. Older machine/local-day/provider units kept by current API-list USD, then total tokens; fresh wins a full tie. Any retained unit intersecting this week makes every plan a floor with change_vs_last_week_pct null.', fields: {
    machine: 'SSH alias, or "this machine" for local logs', days_kept: 'number of distinct local days with a saved unit selected', units: 'one {day: YYYY-MM-DD, provider: claude | codex | antigravity | omp | dsh} for every unit selected from the saved scan' } },
  day_provider: { about: 'One row per local day and tool. Stored usage never decreases on rescan: api_usd, output_tokens and requests each keep MAX on every day because tools prune logs. Later price cuts or dedupe fixes cannot lower days already stored. Git rows have separate coverage.', columns: {
    day: 'YYYY-MM-DD', provider: 'claude | codex | google (Antigravity) | omp | dsh', api_usd: 'usage priced at API list rates, in dollars', output_tokens: 'output tokens, thinking included', requests: 'model requests' } },
  day_model: { about: 'One row per UTC day, model and tool. Stored usage never decreases on rescan: output_tokens and api_usd each keep MAX on every day because tools prune logs. Later price cuts or dedupe fixes cannot lower days already stored. --by model and any --model filter use this UTC basis, including --by total/tool; never compare UTC and local views per day.', columns: { day: 'YYYY-MM-DD (UTC)', model: 'model id as logged', provider: 'tool that used it', output_tokens: 'output tokens', api_usd: 'priced dollars' } },
  day: { about: 'Git activity per local day. Each metric replaces inside git\'s 14-day window only when all its sources answered; otherwise keeps per-metric MAX, including outside that window.', columns: { day: 'YYYY-MM-DD', prs: 'merged pull requests authored by the user', commits: 'commits in local repos' } },
  plan_value: { about: 'What one full weekly limit of each plan was worth, as measured on each run day.', columns: {
    day: 'day of the run', provider: 'claude | codex | google', plan: 'plan name', usd_per_full_week: 'API-list dollars per full weekly limit', times_plan_price: 'that value divided by the weekly plan price',
    stretches: 'meter stretches pooled into the number', proof: 'measured | floor | estimate' } },
  month: { about: 'View: day_provider summed per month and tool.', columns: { month: 'YYYY-MM', provider: 'tool', api_usd: 'dollars', output_tokens: 'tokens', requests: 'requests', days: 'days with data in that month' } },
  pr_kind: { about: 'Merged pull requests you authored, from every forge (GitHub, GitLab hosts, Gitea), kept for 12 weeks.', columns: { key: 'host/owner/repo#number (GitLab: host/group/project!number)', merged_ms: 'merge time, Unix milliseconds', kind: 'from the title prefix: feat | fix | docs | test | chore | ci | refactor | perf | build | style | revert | other (no prefix)' } },
  meta: { about: 'Bookkeeping for incremental fetches.', columns: { k: 'name', v: 'value' } },
};

export const QUERY_COMMANDS = ['get', 'days', 'sql', 'schema'];
// CLI entry: prints the answer as JSON; false when argv is not a query command
export async function query(argv) {
  if (argv.includes('--skill')) { console.log(fs.readFileSync(path.join(ROOT, 'skills', 'worthit', 'SKILL.md'), 'utf8')); return true; }
  if (!QUERY_COMMANDS.includes(argv[0])) return false;
  try { out(run(argv)); } catch (e) { console.error('worthit: ' + e.message); process.exit(2); }
  return true;
}
// The same commands as a function: returns the value, throws an Error with a plain message
export function run(argv) {
  const cmd = argv[0], arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (cmd === 'schema') return SCHEMA;
  if (cmd === 'get') {
    if (!fs.existsSync(LAST)) fail('no saved run yet. Run `worthit --json` once.');
    const data = JSON.parse(fs.readFileSync(LAST, 'utf8')), p = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    if (!p) return { generated_at: data.generated_at, sections: Object.keys(data), hint: 'worthit get <section>, e.g. worthit get plans, worthit get model_mix.series, worthit get plans.0.usd_per_full_week' };
    let v = data; for (const k of p.split('.')) { if (v == null || !(k in Object(v))) fail(`no "${p}" in the last run. Sections: ${Object.keys(data).join(', ')}`); v = v[k]; }
    return p.includes('.') ? v : { generated_at: data.generated_at, [p]: v };
  }
  if (cmd === 'days') {
    const group = arg('--group', 'day'), by = arg('--by', 'total'), since = arg('--since', '0000'), until = arg('--until', '9999'), tool = arg('--tool'), model = arg('--model');
    if (!['day', 'week', 'month'].includes(group) || !['total', 'tool', 'model'].includes(by)) fail('use --group day|week|month and --by total|tool|model');
    const g = group === 'day' ? 'day' : group === 'month' ? 'substr(day, 1, 7)' : "strftime('%G-W%V', day)", db = open();
    const table = by === 'model' || model ? 'day_model' : 'day_provider', keyCol = by === 'model' ? ', model' : by === 'tool' ? ', provider AS tool' : '';
    const where = ['day >= ?', 'day <= ?'], args = [since, until]; if (tool) { where.push('provider = ?'); args.push(tool); } if (model) { where.push('model LIKE ?'); args.push('%' + model + '%'); }
    const rows = db.prepare(`SELECT ${g} AS period${keyCol}, ROUND(SUM(api_usd), 2) AS api_usd, SUM(output_tokens) AS output_tokens${table === 'day_provider' ? ', SUM(requests) AS requests' : ''}, COUNT(DISTINCT day) AS days
      FROM ${table} WHERE ${where.join(' AND ')} GROUP BY 1${keyCol ? ', 2' : ''} ORDER BY 1, api_usd DESC`).all(...args);
    if (by === 'total' && !tool && !model) { const gd = {}; for (const r of db.prepare(`SELECT ${g} AS period, SUM(prs) AS prs, SUM(commits) AS commits FROM day WHERE day >= ? AND day <= ? GROUP BY 1`).all(since, until)) gd[r.period] = r;
      for (const r of rows) { r.merged_prs = (gd[r.period] || {}).prs ?? null; r.commits = (gd[r.period] || {}).commits ?? null; } }
    db.close(); return rows;
  }
  if (cmd === 'sql') {
    const q = (argv[1] || '').trim(); if (!/^(select|with)\b/i.test(q) || /;\s*\S/.test(q)) fail('only one read-only SELECT (or WITH … SELECT) statement is accepted. See `worthit schema`.');
    const db = open(); let rows; try { rows = db.prepare(q).all(); } catch (e) { db.close(); fail('SQL error: ' + e.message); }
    db.close(); return rows.length > 500 ? { rows: rows.slice(0, 500), truncated: true, total_rows: rows.length } : rows;
  }
  throw new Error('unknown command: ' + cmd);
}
