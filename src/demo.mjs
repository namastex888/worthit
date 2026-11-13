// worthit --demo: the whole run on bundled sample data. Nothing on this machine is read, no model is called, no file is written.
import fs from 'node:fs'; import path from 'node:path';
import { ROOT } from './collect.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
const hex = n => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
export const demoHosts = [{ alias: 'build-box', hostname: '10.0.0.12' }, { alias: 'gpu-server', hostname: '10.0.0.20' }];

export async function demoScan(hosts, on) {
  const projects = ['acme-api', 'acme-web', 'billing-service', 'docs-site', 'infra', 'mobile-app', 'search-index', 'design-system'], counts = { claude: 0, codex: 0, antigravity: 0 };
  const plan = [['claude', 'Claude Code', 0, .68, 1840, () => `~/.claude/projects/${projects[Math.floor(Math.random() * projects.length)]}/${hex(8)}-${hex(4)}-${hex(4)}.jsonl`],
    ['codex', 'Codex', .68, .97, 912, () => `~/.codex/sessions/2026/11/${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}/rollout-${hex(8)}.jsonl`],
    ['antigravity', 'Antigravity', .97, 1, 31, () => `~/.gemini/antigravity/conversations/${hex(8)}-${hex(4)}.pb`]];
  for (const [key, label, lo, hi, n, file] of plan) { const steps = key === 'antigravity' ? 4 : 28;
    for (let i = 1; i <= steps; i++) { counts[key] = Math.round(n * i / steps); const where = hosts.length && i % 3 === 0 ? hosts[i % hosts.length] + ' · ' : hosts.length ? 'this machine · ' : '';
      on({ pct: lo + (hi - lo) * i / steps, detail: `${where}${label} · ${i % 4 ? 'unchanged, from cache · ' : ''}${file()}`, counts }); await wait(55); } }
  on({ pct: 1, detail: 'done', counts });
  return { runDir: null, counts, cached: 2741, hosts: hosts.map((alias, i) => ({ alias, ok: true, files: [1204, 388][i % 2], cached: [1190, 371][i % 2] })) };
}

export async function demoGit(on) {
  const steps = [[.15, 'usagemeter sync · reading new usage into its local store'], [.4, 'git log · ~/code/acme-api'], [.55, 'git log · ~/code/billing-service'], [.75, 'GitHub · your merged pull requests (gh search)']];
  for (const [pct, detail] of steps) { on({ pct, detail }); await wait(420); }
  on({ pct: 1, detail: 'done' });
  return { src: { github: 118, meter: 96 }, meter: { version: '3.130.1', downloaded: false } };
}

export async function demoPricing() { await wait(1100); }

export function demoData() {
  const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'demo-data.json'), 'utf8')), now = new Date();
  D.generated_at = now.toISOString(); D.week = { from: new Date(now - 7 * 864e5).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  return D;
}

// the built-in tables plus a headline and a summary, as an agent would write them
export function demoSpec(spec, D) {
  const E = spec.elements, top = D.plans.slice().sort((a, b) => b.usd_per_full_week - a.usd_per_full_week)[0], t = D.totals, g = D.git;
  E.v = { type: 'Verdict', props: { text: `${top.plan} gave the most: $${top.usd_per_full_week.toLocaleString('en-US')} per full week, ${top.times_plan_price}× its price.` }, children: [] };
  E.s = { type: 'Summary', props: { text: `Output ran ${t.output_tokens_change_pct}% above the 7 days before and API value ${t.api_value_change_pct}% higher, so the week was more productive${g ? `, even with merged PRs ${g.merged_prs_change_pct < 0 ? 'down' : 'up'} ${Math.abs(g.merged_prs_change_pct)}%` : ''}. ${top.plan} carried it and still hit its cap. Next: use the allowance that is about to reset, and keep the ${D.game.streak_days}-day streak alive.` }, children: [] };
  E[spec.root].children = ['v', ...E[spec.root].children, 's'];
  return spec;
}

export const demoAnswer = () => ({ root: 'r', elements: { r: { type: 'Stack', props: {}, children: ['v', 'p'] },
  v: { type: 'Verdict', props: { text: 'This is sample data. Run npx worthit to ask about your own usage.' }, children: [] }, p: { type: 'PlanRanking', props: {}, children: [] } } });

// the hardware pet on a scripted load curve, so the recording shows the whole scale without stressing anything
export function demoPet(on) {
  const t0 = Date.now(), curve = t => t < 7 ? 0.08 + 0.87 * Math.sin(Math.min(1, t / 6) * Math.PI / 2) ** 1.4 : Math.max(0.3, 0.95 - (t - 7) * 0.12);
  const timer = setInterval(() => { const t = (Date.now() - t0) / 1000, l = curve(t), j = 0.96 + 0.08 * Math.random();
    on({ level: l, cpu: 0.06 + 0.82 * l * j, core: Math.min(1, 0.3 + l), mem: 0.52 + 0.4 * l, net: 2e5 * Math.pow(500, l) * j, disk: 4e6 * Math.pow(100, l) * j, temp: 30 + 12 * l, watts: 9 + 58 * l * j, wh: 0.0006 * t * (1 + 3 * l) }); }, 400);
  return () => { clearInterval(timer); return { seconds: Math.round((Date.now() - t0) / 1000), cpu_avg_pct: 48, cpu_peak_pct: 86, net_mb: 212.4, disk_mb: 1840.5, watts_avg: 41.3, watt_hours: 0.118, peak_level_pct: 95, peak_mood: 'maxed out' }; };
}
