// RFC 0003: checkpoint comparisons carry their own machine-coverage proof.
import './quiet.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { usd } from './draw.mjs';
import { retirementBlocks } from './hosts.mjs';
import { retainedUnitOverlapsWeek } from './collect.mjs';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

export const allowanceText = data => {
  const lines = data.plans.map(p => `${p.plan.toLowerCase()} ${usd(p.usd_per_full_week)}${p.proof !== 'measured' ? ' (at least)' : p.change_vs_last_week_pct == null ? '' : ` (${p.change_vs_last_week_pct >= 0 ? '▲' : '▼'}${Math.abs(p.change_vs_last_week_pct)}% vs the week before)`}${p.proof === 'measured' && p.retirement_note ? ` · ${p.retirement_note}` : ''}`);
  return `weekly ai allowance check, week to ${data.week.to}.. what one full weekly limit was worth at api prices:\n${lines.join('\n')}\nmeasured from my local logs: npx worthit`;
};

export function openWeekly(home) {
  fs.mkdirSync(home, { recursive: true });
  const db = new DatabaseSync(path.join(home, 'worthit.db'));
  db.exec('CREATE TABLE IF NOT EXISTS weekly (generated_at TEXT PRIMARY KEY, week_to TEXT, safe INTEGER, json TEXT)');
  return db;
}

export function weeklyBaseline(db, data) {
  const row = db.prepare(`SELECT json FROM weekly
    WHERE generated_at < ? AND week_to <= date(?, '-6 days')
    ORDER BY generated_at DESC LIMIT 1`).get(data.generated_at, data.week.to);
  if (!row) return null;
  const previous = JSON.parse(row.json);
  return { generated_at: previous.generated_at, week_to: previous.week.to,
    plans: previous.plans.map(({ plan, usd_per_full_week, proof }) => ({ plan, usd_per_full_week,
      proof: retirementBlocks(data.machines_retired || [], Date.parse(previous.generated_at)).length ? 'floor' : proof })) };
}

// Mutate the drawing data before either the fixed template or card reads it.
// In particular, discard every change supplied by the ordinary run's ledger.
export function prepareWeekly(data, comparedWith) {
  data.machines_missing ||= []; data.machines_left_out ||= []; data.machines_retained ||= [];
  const moved = [];
  for (const plan of data.plans) {
    const previous = comparedWith?.plans.find(p => p.plan === plan.plan);
    const pct = plan.proof === 'measured' && previous?.proof === 'measured' && previous.usd_per_full_week > 0
      ? 100 * (plan.usd_per_full_week - previous.usd_per_full_week) / previous.usd_per_full_week : null;
    plan.change_vs_last_week_pct = pct == null ? null : Math.round(pct);
    if (plan.change_vs_last_week_pct != null && Math.abs(plan.change_vs_last_week_pct) > 5) moved.push({ plan: plan.plan, from: previous.usd_per_full_week,
      to: plan.usd_per_full_week, pct: plan.change_vs_last_week_pct });
  }
  const reasons = [];
  for (const row of data.machines_missing) reasons.push(`${row.machine}: no fresh answer${row.saved_scan_at ? ' (saved scan used)' : ''}`);
  for (const machine of data.machines_left_out) reasons.push(`${machine}: saved machine with usage left out`);
  const end = Date.parse(data.generated_at);
  for (const row of data.machines_retained) for (const unit of row.units) {
    if (retainedUnitOverlapsWeek(unit, end)) reasons.push(`${row.machine}: retained ${unit.day} ${unit.provider} (lost logs inside this week)`);
  }
  return { week: data.week, generated_at: data.generated_at, text: '', image: null,
    plans: data.plans.map(({ plan, usd_per_full_week, times_plan_price, proof, change_vs_last_week_pct, retirement_note }) =>
      ({ plan, usd_per_full_week, times_plan_price, proof, change_vs_last_week_pct, ...(retirement_note ? { retirement_note } : {}) })),
    machines_read: data.machines, machines_missing: data.machines_missing, machines_left_out: data.machines_left_out,
    machines_retired: data.machines_retired || [], machines_retained: data.machines_retained, compared_with: comparedWith,
    moved, safe_to_post: !reasons.length, reasons };
}

export function saveWeekly(db, checkpoint) {
  db.prepare('INSERT INTO weekly (generated_at, week_to, safe, json) VALUES (?, ?, ?, ?)')
    .run(checkpoint.generated_at, checkpoint.week.to, +checkpoint.safe_to_post, JSON.stringify(checkpoint));
}
