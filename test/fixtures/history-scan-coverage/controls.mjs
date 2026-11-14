// This clock belongs only to a fixture subprocess, never to production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const [name, now, hour] = process.argv.slice(2), RealDate = Date;
let clock = RealDate.parse(now);
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
const { buildData, HOME } = await import('../../../src/collect.mjs');
const activity = (output, usd, requests) => [{ hour, provider: 'claude', output, usd, requests }];
const report = rows => ({ activity: rows, this_week: {}, prices: { plan_usd_per_week: {} } });
const g = n => ({ prs: Array(n).fill(Date.parse(hour + ':00:00Z')), commits: Array(n).fill(Date.parse(hour + ':00:00Z')), src: {}, repos: 0 });
const info = { counts: {}, hosts: [{ alias: 'box-b', ok: true }] }, cfg = { days: ['dst_long', 'dst_short'].includes(name) ? 1 : name.startsWith('git_') ? 21 : 7 };
// Seed delivery while these older days still lie inside git's 14-day window.
if (['git_old', 'git_partial', 'git_midnight'].includes(name)) clock -= 7 * 864e5;
buildData(report(activity(100000, 10, 3)), g(2), cfg, info);
clock = RealDate.parse(now);
const gitResult = n => name === 'git_no' ? null : g(name === 'git_old' ? 0 : n);
const providerRows = () => {
  const db = new DatabaseSync(path.join(HOME, 'worthit.db'), { readOnly: true });
  try { return db.prepare('SELECT day, api_usd, output_tokens, requests FROM day_provider').all(); }
  finally { db.close(); }
};
if (name === 'crossed_midnight') info.started_at = Date.parse('2026-11-14T23:59:00Z');
if (name === 'missing') info.hosts[0].ok = false;
if (name === 'cached') info.hosts[0].saved_at = '2026-11-13T12:00:00Z';
// One field drops while the other grows; MAX must operate independently in both directions.
buildData(report(activity(50000, 20, 2)), gitResult(1), cfg, info);
const middle = JSON.parse(fs.readFileSync(path.join(HOME, 'history.json'))).days, middleProviders = providerRows();
buildData(report(activity(200000, 5, 1)), gitResult(0), cfg, info);
const after = JSON.parse(fs.readFileSync(path.join(HOME, 'history.json'))).days;
const db = new DatabaseSync(path.join(HOME, 'worthit.db'), { readOnly: true });
const providers = db.prepare('SELECT day, api_usd, output_tokens, requests FROM day_provider').all();
const days = db.prepare('SELECT * FROM day').all(); db.close();
// Usage and delivery follow their separate coverage rules in both stores.
assert.equal(providers.length, 1);
console.log(JSON.stringify({ middle, middleProviders, after, providers, days }));
