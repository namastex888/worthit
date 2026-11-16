import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { isolatedEnvironment } from '../../support/environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const isolated = isolatedEnvironment(), { env, tmp } = isolated;
env.TZ = 'America/Sao_Paulo';
process.env.TZ = env.TZ;
assert.equal(new Date('2026-11-01T01:00:00Z').getDate(), 31, 'fixture crosses midnight in UTC-3');
const cli = path.join(root, 'bin/worthit.mjs');
try {
  fs.mkdirSync(env.WORTHIT_HOME);
  const db = new DatabaseSync(path.join(env.WORTHIT_HOME, 'worthit.db'));
  db.exec(`CREATE TABLE day_provider (day TEXT, provider TEXT, api_usd REAL, output_tokens INTEGER, requests INTEGER);
    CREATE TABLE day_model (day TEXT, model TEXT, provider TEXT, api_usd REAL, output_tokens INTEGER);
    CREATE TABLE day (day TEXT, prs INTEGER, commits INTEGER);
    INSERT INTO day_provider VALUES ('2026-10-31', 'codex', 7, 700, 1), ('2026-11-01', 'codex', 5, 500, 1);
    INSERT INTO day_model VALUES ('2026-11-01', 'fixture-model', 'codex', 7, 700), ('2026-11-02', 'fixture-model', 'codex', 5, 500);`);
  db.close();
  // Same synthetic requests at 01:00Z: UTC dates differ from UTC-3 local dates.
  const observations = [];
  for (const group of ['day', 'week', 'month']) {
    for (const [by, model] of [['total', false], ['tool', false], ['model', false], ['total', true], ['tool', true]]) {
      const utc = by === 'model' || model;
      const periods = group === 'day' ? (utc ? ['2026-11-01', '2026-11-02'] : ['2026-10-31', '2026-11-01'])
        : group === 'week' ? (utc ? ['2026-W44', '2026-W45'] : ['2026-W44', '2026-W44'])
        : (utc ? ['2026-11', '2026-11'] : ['2026-10', '2026-11']);
      const rows = [];
      for (let i = 0; i < 2; i++) {
        let row = rows.find(r => r.period === periods[i]);
        if (!row) {
          row = { period: periods[i], ...(by === 'model' ? { model: 'fixture-model' } : by === 'tool' ? { tool: 'codex' } : {}),
            api_usd: 0, output_tokens: 0, ...(!utc ? { requests: 0 } : {}), days: 0 };
          rows.push(row);
        }
        row.api_usd += [7, 5][i]; row.output_tokens += [700, 500][i]; row.days++;
        if (!utc) row.requests++;
      }
      if (by === 'total' && !model) for (const row of rows) Object.assign(row, { merged_prs: null, commits: null });
      const args = ['days', '--by', by, '--group', group, '--since', '2026-10-31', '--until', '2026-11-02', ...(model ? ['--model', 'fixture'] : [])];
      for (const tty of [false, true]) {
        // Exercise terminal detection without depending on a platform-specific PTY utility.
        const launch = tty ? ['--input-type=module', '-e', `Object.defineProperty(process.stdout, 'isTTY', { value: true }); Object.defineProperty(process.stderr, 'isTTY', { value: true }); process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}]; await import(${JSON.stringify(cli)});`]
          : [cli, ...args, '--json'];
        const result = spawnSync(process.execPath, launch, { cwd: tmp, env, encoding: 'utf8', timeout: 30000 });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        assert.equal(result.stdout, JSON.stringify(rows, null, 1) + '\n', `${group}/${by}/model=${model}/tty=${tty}: original dates, totals and bare JSON bytes`);
        observations.push({ result, utc, group, by, model, tty });
      }
    }
  }
  const empty = spawnSync(process.execPath, [cli, 'days', '--by', 'model', '--since', '2099-01-01'], { cwd: tmp, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(empty.status, 0); assert.equal(empty.stdout, '[]\n');
  observations.push({ result: empty, utc: true });
  console.log('day-basis-label: 31 unchanged stdout snapshots (day/week/month, model filters, terminal/piped, empty)');
  for (const { result, utc, ...context } of observations) {
    assert.equal(result.stderr, `worthit days: ${utc ? 'UTC days (day_model)' : 'local days (day_provider)'}\n`, `visible basis: ${JSON.stringify(context)}`);
  }
  console.log('day-basis-label: stderr labels match the selected table in non-UTC TZ');
} finally { isolated.cleanup(); }
