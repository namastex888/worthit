// Literal synthetic reports bypass #24's retained-input winner rule. No production hooks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
const [name, now, hour, localDay] = process.argv.slice(2), RealDate = Date, clock = RealDate.parse(now);
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
const { buildData, HOME, AUDIT } = await import('../../../src/collect.mjs');
const day = hour.slice(0, 10), info = { counts: {}, hosts: [{ alias: 'box-b', ok: true }] };
const rows = [
  { model: 'fixture-keep', provider: 'claude', output: 100000, usd: 1, requests: 1 },
  { model: 'fixture-removed-model', provider: 'claude', output: 200000, usd: 2, requests: 2 },
  { model: 'fixture-removed-provider', provider: 'codex', output: 400000, usd: 4, requests: 4 },
];
const report = rows => ({ activity: rows.map(r => ({ ...r, hour })), model_days: rows.map(r => ({ ...r, day })),
  this_week: {}, prices: { plan_usd_per_week: { claude: 10, codex: 10 } } });
const stamp = RealDate.parse(hour + ':00:00Z');
const git = { prs: [stamp, stamp], commits: [stamp, stamp, stamp], repos: [], src: {}, coverage: { prs: true, commits: true } };
buildData(report(rows), git, { days: 30 }, info);
const dbFile = path.join(HOME, 'worthit.db');
const read = () => {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return {
      providers: db.prepare('SELECT provider, output_tokens, api_usd, requests FROM day_provider ORDER BY provider').all().map(Object.values),
      models: db.prepare('SELECT model, output_tokens, api_usd FROM day_model ORDER BY model').all().map(Object.values),
      history: Object.values(JSON.parse(fs.readFileSync(path.join(HOME, 'history.json'))).days[localDay]),
      month: Object.values(db.prepare('SELECT COALESCE(SUM(output_tokens), 0), COALESCE(SUM(api_usd), 0), COALESCE(SUM(requests), 0), COALESCE(SUM(days), 0) FROM month').get()),
      git: Object.values(db.prepare('SELECT prs, commits FROM day WHERE day = ?').get(localDay)),
    };
  } finally { db.close(); }
};
if (name.startsWith('rollback_')) {
  const db = new DatabaseSync(dbFile);
  const snapshots = connection => ['day_provider', 'day_model', 'day', 'plan_value'].map(t => connection.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all());
  const before = snapshots(db);
  const [table, operation, failure] = name === 'rollback_provider_insert' ? ['day_provider', 'INSERT', 'FAIL'] :
    name === 'rollback_model_delete' ? ['day_model', 'DELETE', 'ABORT'] : ['day_model', 'INSERT', 'ABORT'];
  db.exec(`CREATE TRIGGER reject_write BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(${failure}, 'synthetic write failure'); END`);
  db.close();
  buildData(report([{ ...rows[0], output: 50000 }]), null, { days: 7 }, info);
  const after = new DatabaseSync(dbFile);
  try {
    assert.deepEqual(snapshots(after), before, `${name}: every SQLite write rolls back together`);
    // An immediate write lock proves the catch/finally path released the failed connection.
    after.exec('BEGIN IMMEDIATE; DROP TRIGGER reject_write; COMMIT');
  } finally { after.close(); }
  const reported = AUDIT.some(s => s.includes('worthit.db not updated: synthetic write failure'));
  console.log(JSON.stringify({ unchanged: true, unlocked: true, reported }));
} else {
  if (name === 'crossed_midnight') info.started_at = RealDate.parse('2026-11-14T23:59:00Z');
  if (name === 'missing') info.hosts[0].ok = false;
  if (name === 'cached') info.hosts[0].saved_at = '2026-11-13T12:00:00Z';
  if (name === 'left_out') info.left_out = ['box-c'];
  if (name.startsWith('retired_')) info.retirement = [{ machine: 'box-c', retired_at: name === 'retired_boundary' ? '2026-11-10T00:00:00Z' : '2026-11-10T04:00:00Z' }];
  const currentGit = name.startsWith('git_') ? { ...git, prs: [], commits: [], coverage: { prs: true, commits: false } } : null;
  buildData(report([{ ...rows[0], output: 50000 }]), currentGit, { days: 7 }, info);
  const dropped = read();
  if (name === 'complete') {
    const query = by => {
      const r = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../../../bin/worthit.mjs'), 'days', '--since', day, '--until', day, '--by', by],
        { env: process.env, encoding: 'utf8', timeout: 30000 });
      assert.equal(r.status, 0, r.stderr || r.error?.message);
      return JSON.parse(r.stdout);
    };
    assert.equal(process.env.TZ, 'UTC', 'per-day CLI equality is only asserted under UTC (#80)');
    const models = query('model'), totals = query('total');
    const sum = models.reduce((s, r) => [s[0] + r.output_tokens, s[1] + r.api_usd], [0, 0]);
    assert.deepEqual(sum, [50000, 1], 'complete-day dropped-row case: actual CLI model sum is literal 50000 tokens / $1');
    assert.deepEqual(totals.map(r => [r.output_tokens, r.api_usd]), [[50000, 1]], 'complete-day dropped-row case: actual CLI total is literal 50000 tokens / $1');
    assert.deepEqual(sum, [totals[0].output_tokens, totals[0].api_usd], 'complete-day dropped-row case: --by model equals --by total');
  }
  // Empty report, with no day key in either usage source, must also clear stored complete days.
  buildData(report([]), currentGit, { days: 7 }, info);
  console.log(JSON.stringify({ dropped, empty: read() }));
}
