// worthit query commands: instant answers from earlier runs or the bundled --demo sample (no scan, no model, no network).
//   worthit get [section[.field…]]      a part of the last run's data (plans, months, model_mix, tools, waste, git, events, game, totals…)
//   worthit days [--since D] [--until D] [--group day|week|month] [--by total|tool|model] [--tool X] [--model X]
//   worthit sql "SELECT …"              read-only SQL over the local store
//   worthit schema                      tables and columns of the store, with what each means
//   worthit --skill                     the full guide for agents (Markdown)
import './quiet.mjs';
import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');   // loaded here, after quiet.mjs, so its 'experimental' warning stays silent
import { demoData } from './demo.mjs';
import { dataForAgent, redactProjectValues } from './project-privacy.mjs';
import { HOME, ROOT } from './collect.mjs';

const DB = path.join(HOME, 'worthit.db'), LAST = path.join(HOME, 'last.json');
const out = v => console.log(JSON.stringify(v, null, 1));
const fail = msg => { throw new Error(msg); };
const open = () => { if (!fs.existsSync(DB)) fail('no local store yet. Run `worthit --json` once to scan and fill it.'); return new DatabaseSync(DB, { readOnly: true }); };

export const SCHEMA = {
  projects: { about: 'RFC 0004 delivery 1. Last-run JSON block; worthit get projects. worthit projects reads last.json without scanning or network: terminal table, piped JSON adds week, generated_at, machines_missing, machines_left_out, machines_retained and machines_retired. --demo is synthetic and never reads a store. No dashboard, Markdown, share card, project history, week-over-week or model PR credit. Project identities are excluded from summary prompts, question-bar lookups and custom share topics.', fields: {
    floor: 'boolean: false only when coverage.machines and unresolved_rows === 0. Usage is log-derived, never called measured. Every value/token/request is at least when true.',
    coverage: '{machines: boolean, unresolved_rows: integer, unresolved_usd: whole dollars, attributed_pct: whole percent | null, prs_sources: boolean | null, prs_attributed: boolean | null}. machines uses RFC 0002: every active machine answered, none left out, no retained unit overlaps rolling week, week starts on/after all retirements. Unresolved rows include $0 rows. attributed_pct is rounded 100 * project USD / total USD, null at zero. prs_sources is git.coverage.prs; prs_attributed requires zero unattributed PRs; both null with git off.',
    rows: 'array of {project, name, api_value_usd, output_tokens, requests, merged_prs, usd_per_merged_pr, models}. project=canonical origin host[:nondefaultport]/path, lowercase, no scheme/user/credentials/trailing .git or slash. name=last path part, with owner when names collide. Includes PR-only projects. Same rolling seven-day usage window as totals; project_prs merge times use git rolling week. Dollars whole; tokens/requests exact; rows plus no_repository reconcile with totals (USD within rounding). merged_prs integer | null; usd_per_merged_pr=rounded project USD / PRs, unrounded ratio, null with zero PRs or git off.',
    models: 'rows[].models: [{model, tool, api_value_usd, output_tokens, requests, share_pct}]. Model id as logged, tool provider. share_pct=rounded 100 * model raw USD / project raw USD, null when project USD=0; no PR credit per model.',
    no_repository: '{api_value_usd, output_tokens, requests, why_usd: {outside_a_repository, no_origin, origin_not_supported, folder_gone, no_folder_read, saved_before_projects}}. Last four reasons are unresolved, even at zero USD.',
    prs_without_project: 'null with git off, else {merged_prs, why: {no_host_in_key}}. Hostless keys never matched by repository name. Project PRs plus this count equal git.merged_prs. When prs_sources or prs_attributed is false, PRs say at least and cost says partial PR count, NEVER lower bound. With complete PR proof and floor=true, cost says at least. Git-off rows have null merged_prs/usd_per_merged_pr; run worthit --json to fill them.' } },
  'scan.buckets.project': { about: 'RFC 0004 machine scan bucket key parts, per request for Claude Code and per session for Codex.', fields: {
    project: 'canonical origin id | null; walk cwd upward to .git, resolve gitfile -> gitdir -> commondir -> shared config origin. File reads only, no git subprocess/includes/insteadOf. Supported http/https/ssh/git URLs and user@host:path; default ports omitted; nondefault ports kept. Alias hosts without a dot/local paths/multiple origin URLs/unreadable config/non-origin remotes are unsupported. Credentials removed on originating machine before any cache or SSH transport.',
    project_why: 'null with project; otherwise outside_a_repository (live folder, no .git), no_origin (no remotes), origin_not_supported, folder_gone, no_folder_read (Antigravity/omp/dsh/missing cwd), saved_before_projects (old bucket lacks project key). Deleted folder: sanitized Codex URL first, then current-version live-resolution map, else folder_gone. No hostless cwd_repo guess.' } },
  project_activity: { about: 'Core report array of {hour, provider, model, project, project_why, output, requests, usd}; same selected, deduplicated, priced scan and meter rows as activity, including omp/dsh no_folder_read rows; buildData filters with totals rolling window. USD retains pricing precision until project display rounds. Not a worthit.db table.' },
  folder_project: { about: 'Only in each machine scan-cache.db, never worthit.db or transported. Optional; disabled with WORTHIT_NO_CACHE or unwritable cache. Only live resolutions insert/replace; mismatched ver is ignored; path reuse remembers latest live origin.', columns: { path: 'TEXT PRIMARY KEY: folder as logged', project: 'TEXT: sanitized canonical id', resolved_at: 'TEXT: ISO live-resolution time', ver: 'INTEGER: identity-rule version (1)' } },
  'scan.result': { about: 'worthit --json: fresh headless scan, git on by default, no AI, Markdown, PNG or Chrome. The usual last-run data plus output metadata; saved last.json and get/days/sql query results are unchanged.', fields: {
    audit_log: 'root field: absolute <date>-worthit-audit.log path in the current working directory, using the shared scan audit format; null with --no-files or --demo. --no-files still updates the store; demo reads and writes no store or output files. Exit 1 after activity attempts to retain the audit and names its path on stderr, with no success JSON.' } },
  'days.result': { about: 'worthit days returns a bare JSON row array on stdout. A one-line stderr note names the selected day basis, in terminals and pipes: "worthit days: local days (day_provider)" for total/tool without --model, or "worthit days: UTC days (day_model)" for --by model OR a --model filter (including --by total/tool). --since/--until and day/week/month grouping use that stored basis. Never compare UTC and local views per day; grouped boundaries can differ too. No dates, values or stored columns are converted.' },
  'weekly.result': { about: 'worthit weekly [--hosts all|none|a,b] [--allow-partial] [--no-files]: fresh headless allowance scan; hosts default all, git/AI off. Fixed allowance template, no questions, browser UI, clipboard or posting. Exit 0 safe or explicitly allowed partial, 1 scan/no-data/render/audit/store failure, 3 unsafe with JSON still printed. Chrome/Chromium renders the PNG unless --no-files.', fields: {
    week: '{from, to}: YYYY-MM-DD rolling seven-day window', generated_at: 'ISO checkpoint time', text: 'fixed SHARE_TOPICS.allowance post', image: 'absolute <date>-worthit-share-allowance.png path, or null with --no-files; --demo uses synthetic data with null baseline/image and never reads or writes a store or files',
    audit_log: 'absolute <date>-worthit-audit.log path beside the PNG, same audit format as a plain scan; null with --no-files or --demo; checkpoint store still updated with --no-files',
    plans: 'array of {plan, usd_per_full_week, times_plan_price, proof: measured | floor, change_vs_last_week_pct: whole-number percent | null, retirement_note?: string}; change rounds symmetrically (halves away from zero), normalizes negative zero, and displays 0% neutrally without an arrow; retirement_note quotes any --since statement beside a measured plan; change requires same-plan measured proof at both checkpoint endpoints; ledger changes never used',
    machines_read: 'number of machines included in the scan', machines_missing: 'array of {machine, saved_scan_at}: no fresh answer, saved scan may stand in', machines_left_out: 'saved machines with usage or unknown saved data omitted from this scan; aliases removed from SSH config stay left out until retired or covered by a fresh equivalent-machine answer', machines_retired: 'array of {machine, retired_at, last_scan_at, days_kept}; frozen retired snapshots, never missing or left out', machines_retained: 'array of {machine, days_kept, units: [{day, provider}]} as in the last-run field',
    compared_with: 'null or {generated_at, week_to, plans: [{plan, usd_per_full_week, proof}]} from the latest earlier checkpoint ending at least six days earlier; never search past a floor; a baseline week starting before a current retirement is treated as floor without rewriting the saved checkpoint',
    moved: 'array of {plan, from, to, pct}: pct is a whole-number percent rounded symmetrically (halves away from zero); only eligible rounded absolute changes strictly greater than 5%', safe_to_post: 'true iff no missing/left-out machines and no retained units overlap this week; floors alone, including pre-retirement weeks, and prior retained units are safe', reasons: 'array of unsafe-machine explanations; retained reasons name machine, day and provider' } },
  weekly: { about: 'One row per worthit weekly checkpoint, including unsafe runs and --no-files. Compared endpoints must both be measured for the same plan in JSON, text and card; first checkpoint changes are null even with ledger history.', columns: {
    generated_at: 'TEXT PRIMARY KEY: ISO checkpoint time', week_to: 'TEXT: end of rolling week (YYYY-MM-DD)', safe: 'INTEGER: 1 safe to post, 0 unsafe (unaffected by --allow-partial)', json: 'TEXT: complete weekly.result JSON' } },
  totals: { about: 'Last-run usage totals. Usage uses the existing machine condition independently of plan availability: missing answers (including saved fallbacks), left-out machines, retained local days overlapping the rolling week (including a straddling day), or a week starting before retirement make it a floor. Eligible changes are whole-number percentages rounded symmetrically (halves away from zero), with negative zero normalized to 0; floors remain null. Complete Git count comparisons remain independent.', fields: {
    output_tokens_change_pct: 'number | null: null when either current or previous usage week is a floor, or the previous value is not positive; not compared',
    api_value_change_pct: 'number | null: same usage coverage rule as output_tokens_change_pct; current totals remain observed lower bounds when usage is incomplete' } },
  git: { about: 'Last-run Git data, with usage cost coverage independent of Git count coverage. buildData sets cost = allMachines && merged_prs ? API value / merged_prs : null. usageCostWithheld is the shared dashboard/card/share interpretation. Never coerce null to zero or label a partial-denominator ratio at least.', fields: {
    usd_per_merged_pr: 'number | null: nonzero merged_prs plus explicit null cost means usage withheld as a floor, not no PR data. Zero PRs have no denominator; numeric zero cost is usable',
    usd_per_pr_change_pct: 'number | null: needs complete PR coverage, both usage weeks free of machine blockers, non-null current cost and a positive previous cost; otherwise not compared',
    usd_per_pr_per_day: 'array of number | null: every entry null when current usage is a floor' } },
  delivery: { about: 'Last-run delivery counts use independent Git coverage. usd_per_feature is number | null: null when current usage is a floor or fewer than five features exist. usd_per_feature_change_pct is null when either usage week is a floor, PR coverage is incomplete or no usable baseline exists. Costs use partial PR denominators when usage is complete but PR coverage is incomplete; label partial feature count, never at least. Delivery cards/posts keep the delivery topic with n/a and partial usage; not compared when at least five features exist and usageCostWithheld is true. Absent delivery or insufficient features keep the allowance fallback.', fields: {
    weeks: 'rows retain observed counts; usd and usd_per_feature are null with a known machine blocker at that rolling endpoint or insufficient priced days/features',
    days: '14 observed day rows; usd and usd_per_feature conservatively null for the entire series if either current or previous usage week is incomplete',
    months: 'observed monthly rows; usd and usd_per_feature conservatively null for the entire series if either source week is incomplete, even for periods extending outside those two weeks. days_with_cost is an observation count, not period proof. No historical machine proof is inferred or persisted' } },
  'git.coverage': { about: 'Last-run JSON field (worthit get git.coverage), not a SQL table. Within the git 14-day window each metric replaces stored daily counts only with full coverage; otherwise history.json and SQLite day keep per-metric MAX. False prs marks this week merged PRs, features and kind counts as floors (at least); merged_prs_change_pct, usd_per_pr_change_pct, delivery.features_change_pct, delivery.usd_per_feature_change_pct and delivery.kinds[].change_pct are number | null and are null without PR coverage. PR-derived personal bests are suppressed. When usage is complete, cost ratios retain observed values but use partial PR/feature counts, are not lower bounds, and are not compared; incomplete usage withholds the costs as null. False commits independently marks this week commits as at least. No commits change field exists. Outside that window counts keep MAX. Absent gh/tea/glab CLIs and explicit empty login inventories are skipped as a source with an audit note, omitted from sources, and do not reduce coverage. glab classifies each host: No token found with no login line is skipped, including gitlab.com beside a successful self-hosted login; aggregate exit 1 alone does not fail discovery. Host errors with tokens, malformed inventories, process execution failures and partial logged-in answers remain failures. glab auth status can contact gitlab.com even without a token.', fields: {
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
  'plans.change_vs_last_week_pct': { about: 'Last-run per-plan percentage change versus the measured value recorded seven days earlier, not versus recomputed ledger history.', fields: {
    value: 'number | null: both this run and the plan_value row at exactly seven local calendar days earlier must be measured, with the same provider and plan and a positive stored USD denominator. Calendar subtraction preserves the local date across DST; it is not 168 elapsed hours. No nearby-date or floor fallback. Null when no eligible row exists or retirement/retained units block either endpoint. Same-day runs replace the daily observation; no exact run timestamp or rolling period is implied.' } },
  'plans.weeks': { about: 'Last-run per-plan rolling allowance history. Week 0 carries its actual proof. A ledger week gets floor only when retirement or retained units block it; otherwise proof is absent. Ledger weeks carry no machine check and are never used for changes or labelled measured. Ordinary comparison eligibility remains unchanged; change_vs_last_week_pct is a whole-number percent or null, rounded symmetrically (halves away from zero), with negative zero normalized to 0 and 0% displayed neutrally without an arrow. Only Claude currently has a measurable meter.', fields: {
    weeks_ago: '0 current, 1 previous, up to 11', to: 'YYYY-MM-DD week end', usd: 'API value per full weekly limit', proof: 'week 0: measured | floor; ledger week: floor when blocked by retirement or retained units, otherwise absent; ≥ on a history chart marks a known floor', retirement_note: 'optional field on the current plan (also weekly plans): <machine>: retired since <date>, as stated by you; printed next to a measured plan relying on --since' } },
  machines_retained: { about: 'Last-run JSON field (also available with worthit get machines_retained), not a SQL table. Older machine/local-day/provider units kept by current API-list USD, then total tokens; fresh wins a full tie. Any retained unit intersecting this week makes every plan a floor with change_vs_last_week_pct null.', fields: {
    machine: 'SSH alias, or "this machine" for local logs', days_kept: 'number of distinct local days with a saved unit selected', units: 'one {day: YYYY-MM-DD, provider: claude | codex | antigravity | omp | dsh} for every unit selected from the saved scan' } },
  day_provider: { about: 'One row per local day and tool. Stored usage never decreases on rescan: api_usd, output_tokens and requests each keep MAX on every day because tools prune logs. Later price cuts or dedupe fixes cannot lower days already stored. Git rows have separate coverage.', columns: {
    day: 'YYYY-MM-DD', provider: 'claude | codex | google (Antigravity) | omp | dsh', api_usd: 'usage priced at API list rates, in dollars', output_tokens: 'output tokens, thinking included', requests: 'model requests' } },
  day_model: { about: 'One row per UTC day, model and tool. Stored usage never decreases on rescan: output_tokens and api_usd each keep MAX on every day because tools prune logs. Later price cuts or dedupe fixes cannot lower days already stored. --by model and any --model filter use this UTC basis, including --by total/tool; never compare UTC and local views per day.', columns: { day: 'YYYY-MM-DD (UTC)', model: 'model id as logged', provider: 'tool that used it', output_tokens: 'output tokens', api_usd: 'priced dollars' } },
  day: { about: 'Git activity per local day. Each metric replaces inside git\'s 14-day window only when all its sources answered; otherwise keeps per-metric MAX, including outside that window.', columns: { day: 'YYYY-MM-DD', prs: 'merged pull requests authored by the user', commits: 'commits in local repos' } },
  plan_value: { about: 'What one full weekly limit of each plan was worth, as measured on each run day.', columns: {
    day: 'local day of the run; the last run on that day replaces its provider row', provider: 'claude | codex | google', plan: 'plan name', usd_per_full_week: 'API-list dollars per full weekly limit', times_plan_price: 'that value divided by the weekly plan price',
    stretches: 'meter stretches pooled into the number', proof: 'measured | floor | estimate' } },
  month: { about: 'View: day_provider summed per month and tool.', columns: { month: 'YYYY-MM', provider: 'tool', api_usd: 'dollars', output_tokens: 'tokens', requests: 'requests', days: 'days with data in that month' } },
  pr_kind: { about: 'Merged pull requests you authored, from every forge (GitHub, GitLab hosts, Gitea), kept for 12 weeks.', columns: { key: 'host/owner/repo#number (GitLab: host/group/project!number)', merged_ms: 'merge time, Unix milliseconds', kind: 'from the title prefix: feat | fix | docs | test | chore | ci | refactor | perf | build | style | revert | other (no prefix)' } },
  meta: { about: 'Bookkeeping for incremental fetches.', columns: { k: 'name', v: 'value' } },
};

export const QUERY_COMMANDS = ['get', 'days', 'sql', 'schema'];
// Match standalone CLI flags only; SQL text containing "--demo" remains one statement.
const withoutDemo = argv => argv.filter(arg => arg !== '--demo' && !arg.startsWith('--demo='));
export function normalizeDemoArgs(argv) {
  if (argv.some(arg => arg.startsWith('--demo='))) fail('--demo takes no value: use `--demo`.');
  return { demo: argv.includes('--demo'), args: withoutDemo(argv) };
}
// CLI entry: prints the answer as JSON; false when argv is not a query command
export async function query(argv) {
  if (argv.includes('--skill')) { console.log(fs.readFileSync(path.join(ROOT, 'skills', 'worthit', 'SKILL.md'), 'utf8')); return true; }
  if (!QUERY_COMMANDS.includes(withoutDemo(argv)[0])) return false;
  try { out(run(argv, note => console.error(note))); } catch (e) { console.error('worthit: ' + e.message); process.exit(2); }
  return true;
}
// The same commands as a function: returns the value, with an optional day-basis note for the caller.
export function run(argv, note = () => {}) {
  const { demo, args } = normalizeDemoArgs(argv);
  argv = args;
  const cmd = argv[0], arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (demo && ['days', 'sql'].includes(cmd)) fail(`--demo is not supported for ${cmd}: the bundled sample has no query tables. Use \`worthit get <section> --demo\`.`);
  if (cmd === 'schema') return SCHEMA;
  if (cmd === 'get') {
    let data;
    if (demo) data = demoData();
    else {
      if (!fs.existsSync(LAST)) fail('no saved run yet. Run `worthit --json` once.');
      data = JSON.parse(fs.readFileSync(LAST, 'utf8'));
    }
    const p = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    if (!p) return { generated_at: data.generated_at, sections: Object.keys(data), hint: 'worthit get <section>, e.g. worthit get plans, worthit get model_mix.series, worthit get plans.0.usd_per_full_week' };
    let v = data; for (const k of p.split('.')) { if (v == null || !(k in Object(v))) fail(`no "${p}" in the ${demo ? 'sample' : 'last'} run. Sections: ${Object.keys(data).join(', ')}`); v = v[k]; }
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
    db.close(); note(`worthit days: ${table === 'day_model' ? 'UTC' : 'local'} days (${table})`); return rows;
  }
  if (cmd === 'sql') {
    const q = (argv[1] || '').trim(); if (!/^(select|with)\b/i.test(q) || /;\s*\S/.test(q)) fail('only one read-only SELECT (or WITH … SELECT) statement is accepted. See `worthit schema`.');
    const db = open(); let rows; try { rows = db.prepare(q).all(); } catch (e) { db.close(); fail('SQL error: ' + e.message); }
    db.close(); return rows.length > 500 ? { rows: rows.slice(0, 500), truncated: true, total_rows: rows.length } : rows;
  }
  throw new Error('unknown command: ' + cmd);
}

// AI lookups use only usage tables in an in-memory database. They cannot query
// pr_kind, meta, weekly JSON, attached files or another saved identity surface.
const AGENT_TABLES = ['day_provider', 'day_model', 'day', 'plan_value', 'month'];
export function runForAgent(argv, data, note = () => {}) {
  const { demo, args } = normalizeDemoArgs(argv);
  argv = args;
  const cmd = argv[0];
  if (demo && ['days', 'sql'].includes(cmd)) return run([...argv, '--demo'], note);
  if (demo) data = demoData();
  if (cmd === 'get') {
    const section = (argv[1] || '').split('.')[0];
    if (section === 'projects' || section === 'project_activity') throw new Error('repository details are local only');
    const safe = JSON.parse(dataForAgent(data));
    if (!section) return { generated_at: safe.generated_at, sections: Object.keys(safe) };
    let v = safe;
    for (const key of argv[1].split('.')) {
      if (v == null || !Object.hasOwn(Object(v), key)) throw new Error('section unavailable to the agent');
      v = v[key];
    }
    return v;
  }
  if (cmd === 'schema') return Object.fromEntries(AGENT_TABLES.map(k => [k, SCHEMA[k]]));
  if (cmd === 'days') return run(argv, note);
  if (cmd !== 'sql') throw new Error('only get, days, sql and schema can be looked up');
  const q = (argv[1] || '').trim();
  if (!/^(select|with)\b/i.test(q) || /;\s*\S/.test(q)) throw new Error('only one usage SELECT is accepted');
  const source = open(), db = new DatabaseSync(':memory:');
  try {
    for (const table of AGENT_TABLES) {
      const cols = Object.keys(SCHEMA[table].columns);
      db.exec(`CREATE TABLE "${table}" (${cols.map(c => `"${c}"`).join(',')})`);
      if (!source.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table)) continue;
      const insert = db.prepare(`INSERT INTO "${table}" VALUES (${cols.map(() => '?').join(',')})`);
      for (const row of source.prepare(`SELECT ${cols.map(c => `"${c}"`).join(',')} FROM "${table}"`).all()) insert.run(...cols.map(c => row[c]));
    }
    const rows = db.prepare(q).all();
    return redactProjectValues(rows.slice(0, 500), data);
  } catch { throw new Error('AI SQL is limited to usage tables; use days or get for usage'); }
  finally { source.close(); db.close(); }
}
