import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from './environment.mjs';

const support = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(support, '../..');
const sources = path.join(root, 'test/sources');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export function sourceCase(folder, scenario) {
  const isolated = isolatedEnvironment(), { tmp, bin, home, python, env } = isolated;
  const trace = path.join(tmp, 'commands.jsonl');
  Object.assign(env, {
    NODE_OPTIONS: `--import=${path.join(support, 'clock.mjs')}`, PYTHONPATH: support,
    FIXTURE_MACHINE: 'box-a', FIXTURE_TMP: tmp, FIXTURE_PYTHON: python,
    FIXTURE_TRACE: trace, FIXTURE_SOURCES: sources,
  });
  const run = (exe, args, childEnv = env) => {
    const r = spawnSync(exe, args, { cwd: tmp, env: childEnv, encoding: 'utf8', maxBuffer: 16 << 20, timeout: 30000 });
    assert.equal(r.status, 0, `${path.basename(exe)} ${args.join(' ')}\n${r.stderr || r.error || r.stdout}`);
    return r.stdout;
  };
  const cli = (options = {}) => {
    const { hosts = 'box-b', offline = false, accounts = [], store = 'store' } = options;
    const childEnv = { ...env, WORTHIT_HOME: path.join(tmp, store), FIXTURE_OFFLINE: offline ? '1' : '0', FIXTURE_ACCOUNTS: JSON.stringify(accounts) };
    return JSON.parse(run(process.execPath, [path.join(root, 'bin/worthit.mjs'), '--json', '--no-files', '--days', '21', '--hosts', hosts, '--git', accounts.length ? 'yes' : 'no', '--ai', 'no'], childEnv));
  };
  const query = (sql, store = 'store') => JSON.parse(run(process.execPath, [path.join(root, 'bin/worthit.mjs'), 'sql', sql], { ...env, WORTHIT_HOME: path.join(tmp, store) }));
  const snapshot = (data, store = 'store') => ({
    week: data.week, machines: data.machines,
    missing: data.machines_missing.map(m => ({ machine: m.machine, saved: m.saved_scan_at ? '<saved scan>' : null })),
    left_out: data.machines_left_out,
    totals: { output_tokens: data.totals.output_tokens, api_value_usd: data.totals.api_value_usd, output_tokens_change_pct: data.totals.output_tokens_change_pct, api_value_change_pct: data.totals.api_value_change_pct },
    tools: data.tools.map(t => ({ key: t.key, requests: t.requests, output: t.output, usd: t.usd })),
    plans: data.plans.map(p => ({ key: p.key, proof: p.proof, usd_per_full_week: p.usd_per_full_week, change_allowed: p.change_vs_last_week_pct != null })),
    stored_weeks: query("SELECT CASE WHEN day < '2026-11-07' THEN 'previous' ELSE 'current' END AS week, SUM(output_tokens) AS output_tokens, ROUND(SUM(api_usd), 2) AS api_usd, SUM(requests) AS requests FROM day_provider GROUP BY 1 ORDER BY 1", store),
    ...(data.git ? { git: { merged_prs: data.git.merged_prs, merged_prs_change_pct: data.git.merged_prs_change_pct, sources: data.git.sources },
      delivery: { features: data.delivery.features, features_change_pct: data.delivery.features_change_pct, fix_share_pct: data.delivery.fix_share_pct,
        kinds: data.delivery.kinds.map(k => ({ kind: k.kind, prs: k.prs, last_week: k.last_week })).sort((a, b) => a.kind.localeCompare(b.kind)) } } : {}),
  });
  try {
    for (const [machine, machineHome] of [['box-a', home], ['box-b', path.join(tmp, 'box-b')]]) run(python, [path.join(support, 'materialize.py'), path.join(sources, machine), machineHome]);
    fs.mkdirSync(path.join(home, '.ssh')); fs.writeFileSync(path.join(home, '.ssh/config'), 'Host box-b\n  HostName box-b.invalid\n');
    for (const command of ['ssh', 'gh', 'usagemeter']) fs.writeFileSync(path.join(bin, command), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(support, 'commands.mjs'))} ${command} "$@"\n`, { mode: 0o755 });
    const expected = read(path.join(folder, 'expected-data.json'));
    const check = (name, data, store = 'store') => assert.deepEqual(snapshot(data, store), expected[name], `${path.basename(folder)} / ${name}: week's data differs from expected-data.json`);
    scenario({ cli, check, query, trace: () => fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [] });
    const commands = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '';
    assert.ok(!commands.includes('"unexpected"'), `unstubbed external command: ${commands}`);
    console.log(`${path.basename(folder)}: expected weekly data matches`);
  } finally { isolated.cleanup(); }
}
