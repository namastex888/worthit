// Test-only frozen clock; called in its own isolated home/store for each scenario.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const [name, now, hour] = process.argv.slice(2), RealDate = Date, clock = RealDate.parse(now);
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
const { buildData, HOME } = await import('../../../src/collect.mjs');
const day = hour.slice(0, 10), info = { counts: {}, hosts: [{ alias: 'box-b', ok: true }] };
const report = (output, usd) => ({ activity: [{ hour, provider: 'claude', output, usd, requests: 1 }],
  model_days: [{ day, model: 'fixture-model', provider: 'claude', output, usd }], this_week: {}, prices: { plan_usd_per_week: {} } });
const build = (output, usd) => buildData(report(output, usd), null, { days: 7 }, info);
const rows = () => {
  const db = new DatabaseSync(path.join(HOME, 'worthit.db'), { readOnly: true });
  try { return { models: db.prepare('SELECT output_tokens, api_usd FROM day_model').all(), providers: db.prepare('SELECT output_tokens, api_usd FROM day_provider').all() }; }
  finally { db.close(); }
};
build(100000, 10);
if (name === 'crossed_midnight') info.started_at = RealDate.parse('2026-11-14T23:59:00Z');
if (name === 'missing') info.hosts[0].ok = false;
if (name === 'cached') info.hosts[0].saved_at = '2026-11-13T12:00:00Z';
if (name === 'left_out') info.left_out = ['box-c'];
if (name.startsWith('retired_')) info.retirement = [{ machine: 'box-c', retired_at: name === 'retired_boundary' ? '2026-11-10T00:00:00Z' : '2026-11-10T04:00:00Z' }];
// Every field independently keeps MAX, including complete days and retirement boundaries.
build(50000, 20); const middle = rows();
build(200000, 5); const after = rows();
console.log(JSON.stringify({ middle, after }));
