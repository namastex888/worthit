// Synthetic inputs to the real shaper; never replace or patch its output.
import { buildData } from '../../../src/collect.mjs';

const mode = process.argv[2];
const hour = (date, usd, output) => ({ hour: date + 'T15', provider: 'claude', usd, output, requests: 1 });
const activity = [hour('2026-11-03', 60, 400000), hour('2026-11-05', 90, 600000),
  hour('2026-11-10', 120, 800000), hour('2026-11-13', 180, 1200000)];
const kinds = [];
for (const [date, features, fixes] of [['2026-11-03', 3, 0], ['2026-11-05', 2, 1], ['2026-11-10', 3, 1], ['2026-11-13', 3, 1]]) {
  const at = Date.parse(date + 'T15:00:00Z');
  for (let i = 0; i < features; i++) kinds.push([at + i, 'feat']);
  for (let i = 0; i < fixes; i++) kinds.push([at + 100 + i, 'fix']);
}
const prsCovered = !mode.includes('partial-pr');
const g = { prs: kinds.map(([t]) => t), kinds, commits: kinds.map(([t]) => t), repos: 1,
  src: { synthetic: kinds.length }, coverage: { prs: prsCovered, commits: true,
    sources: [{ source: 'synthetic', answered: prsCovered, metrics: ['prs'] }] } };
const scan = { counts: { claude: 4 }, hosts: [{ alias: 'box-b', ok: true }] };
if (mode.includes('missing')) scan.hosts = [{ alias: 'box-b', ok: false }];
if (mode === 'saved-answer') scan.hosts = [{ alias: 'box-b', ok: true, saved_at: '2026-11-13T12:00:00Z' }];
if (mode === 'left-out') scan.left_out = ['box-c'];
const retainedDay = { 'retained-current': '2026-11-10', 'retained-boundary': '2026-11-07',
  'retained-prior': '2026-11-03', 'retained-outside': '2026-10-25' }[mode];
if (retainedDay) scan.retained = [{ machine: 'box-b', days_kept: 1, units: [{ day: retainedDay, provider: 'claude' }] }];
const measured = { api_usd: 300, output_tokens: 2000000, cached_input_tokens: 0, model_mix_by_usd: {} };
const report = { activity, prices: { plan_usd_per_week: { claude: 46 } },
  this_week: mode === 'no-plan-missing' ? {} : { claude: { usd_per_full_week: 600,
    meter_start_pct: 0, meter_end_pct: 50, hours: 2, measured } } };
console.log(JSON.stringify(buildData(report, g, { days: 21 }, scan)));
