import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';
import { expectedData } from '../../support/expected-data.mjs';
const folder = import.meta.dirname, support = path.resolve(folder, '../../support');
const isolated = isolatedEnvironment(), { env, tmp } = isolated;
const expected = expectedData(path.join(folder, 'expected-data.json'));
try {
  // Each child gets its own store and frozen clock; network and real configs are unavailable.
  const scenarios = [
    ['complete', 'complete'],
    ['partial', 'retained', 'UTC', '2026-11-14T12:00:00Z', '2026-11-07T15'],
    ['outside_window', 'retained', 'UTC', '2026-11-14T12:00:00Z', '2026-11-04T15'],
    ['today', 'retained', 'UTC', '2026-11-14T12:00:00Z', '2026-11-14T09'],
    ['midnight_first', 'midnight_first', 'UTC', '2026-11-14T00:00:00Z', '2026-11-07T15'],
    ['crossed_midnight', 'retained', 'UTC', '2026-11-15T00:01:00Z', '2026-11-14T15'],
    ['missing', 'retained'], ['cached', 'retained'], ['left_out', 'retained'],
    ['retired_before', 'retained'], ['retired_boundary', 'complete'],
    ['retired_local_only', 'local_complete', 'America/Los_Angeles'],
    ['utc_partial_local_complete', 'local_complete', 'America/Los_Angeles', '2026-11-14T04:00:00Z', '2026-11-07T15'],
    ['utc_complete_local_partial', 'utc_complete', 'America/Los_Angeles', '2026-11-14T04:00:00Z', '2026-11-13T15'],
    ['dst_long', 'local_complete', 'America/Los_Angeles', '2026-11-02T08:30:00Z', '2026-11-02T07', '2026-11-01'],
    ['dst_short', 'local_complete', 'America/Los_Angeles', '2026-03-09T07:30:00Z', '2026-03-09T06', '2026-03-08'],
    ['git_metric', 'git_metric'],
    ['git_midnight_first', 'git_midnight_first', 'UTC', '2026-11-14T00:00:00Z', '2026-11-07T15'],
    ['git_outside', 'retained', 'UTC', '2026-11-14T12:00:00Z', '2026-10-25T15'],
    ['rollback_provider_insert', 'rollback'], ['rollback_model_insert', 'rollback'], ['rollback_model_delete', 'rollback'],
  ];
  for (const [name, key, tz = 'UTC', now = '2026-11-14T12:00:00Z', hour = '2026-11-10T15', localDay = hour.slice(0, 10)] of scenarios) {
    const r = spawnSync(process.execPath, [path.join(folder, 'controls.mjs'), name, now, hour, localDay], {
      cwd: tmp, env: { ...env, TZ: tz, NODE_OPTIONS: `--import=${path.join(support, 'clock.mjs')}`, FIXTURE_NOW: now,
        WORTHIT_HOME: path.join(tmp, name) }, encoding: 'utf8', timeout: 30000, maxBuffer: 4 << 20,
    });
    assert.equal(r.status, 0, `complete-day-set / ${name}\n${r.stderr || r.error?.message || r.stdout}`);
    assert.deepEqual(JSON.parse(r.stdout), expected.get(key), `complete-day-set / ${name}`);
    console.log(`complete-day-set / ${name}: PASS`);
  }
  expected.done();
} finally { isolated.cleanup(); }
