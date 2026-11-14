// This clock belongs only to a fixture subprocess, never to production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const [name, now, hour] = process.argv.slice(2), RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [RealDate.parse(now)])); }
  static now() { return RealDate.parse(now); }
};
const { buildData, HOME } = await import('../../../src/collect.mjs');
const activity = (output, usd) => [{ hour, provider: 'claude', output, usd, requests: 1 }];
const report = rows => ({ activity: rows, this_week: {}, prices: { plan_usd_per_week: {} } });
const g = n => ({ prs: Array(n).fill(Date.parse(hour + ':00:00Z')), commits: Array(n).fill(Date.parse(hour + ':00:00Z')), src: {}, repos: 0 });
const info = { counts: {}, hosts: [{ alias: 'box-b', ok: true }] }, cfg = { days: ['dst_long', 'dst_short'].includes(name) ? 1 : 7 };
buildData(report(activity(100000, 10)), g(2), cfg, info);
if (name === 'crossed_midnight') info.started_at = Date.parse('2026-11-14T23:59:00Z');
if (name === 'missing') info.hosts[0].ok = false;
if (name === 'cached') info.hosts[0].saved_at = '2026-11-13T12:00:00Z';
// One field drops while the other grows; MAX must operate independently in both directions.
buildData(report(activity(50000, 20)), g(1), cfg, info);
const middle = JSON.parse(fs.readFileSync(path.join(HOME, 'history.json'))).days;
buildData(report(activity(200000, 5)), g(0), cfg, info);
const after = JSON.parse(fs.readFileSync(path.join(HOME, 'history.json'))).days;
const db = new DatabaseSync(path.join(HOME, 'worthit.db'), { readOnly: true });
const providers = db.prepare('SELECT day, api_usd, output_tokens, requests FROM day_provider').all();
const days = db.prepare('SELECT * FROM day').all(); db.close();
// Even a full-day lowering in history preserves the existing SQLite MAX behavior.
assert.equal(providers.length, 1);
console.log(JSON.stringify({ middle, after, providers, days }));
