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
  day_provider: { about: 'One row per local day and tool. A day only grows: reruns keep the larger value.', columns: {
    day: 'YYYY-MM-DD', provider: 'claude | codex | google (Antigravity) | omp | dsh', api_usd: 'usage priced at API list rates, in dollars', output_tokens: 'output tokens, thinking included', requests: 'model requests' } },
  day_model: { about: 'One row per UTC day, model and tool.', columns: { day: 'YYYY-MM-DD', model: 'model id as logged', provider: 'tool that used it', output_tokens: 'output tokens', api_usd: 'priced dollars' } },
  day: { about: 'Git activity per local day (only days that were inside a run with git data).', columns: { day: 'YYYY-MM-DD', prs: 'merged pull requests authored by the user', commits: 'commits in local repos' } },
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
