import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const support = path.join(root, 'test/support');
const isolated = isolatedEnvironment(), { tmp, home, python, env } = isolated;
Object.assign(env, { NODE_OPTIONS: `--import=${path.join(support, 'clock.mjs')}`, PYTHONPATH: support });
const run = (exe, args, childEnv) => {
  const r = spawnSync(exe, args, { cwd: tmp, env: childEnv, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, r.stderr || r.error?.message || r.stdout);
  return JSON.parse(r.stdout);
};
const cacheAt = store => path.join(store, 'scan-cache.db');
try {
  // Real scanner discovery paths under a synthetic HOME, separate from the store.
  const logs = path.join(home, '.claude/projects/example');
  fs.mkdirSync(logs, { recursive: true });
  fs.copyFileSync(path.join(root, 'test/sources/box-a/claude.jsonl'), path.join(logs, 'usage.jsonl'));
  const enabled = { ...env };
  delete enabled.WORTHIT_NO_CACHE;
  const scanCode = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { scan } from ${JSON.stringify(pathToFileURL(path.join(root, 'src/collect.mjs')).href)};
    const info = await scan({ days: 21, hosts: [], fresh: true }, () => {});
    console.log(fs.readFileSync(path.join(info.runDir, 'local.json'), 'utf8'));
  `;
  const result = run(process.execPath, ['--input-type=module', '--eval', scanCode], enabled);
  assert.equal(result.buckets.reduce((n, b) => n + b.requests, 0), 6, 'log discovery still uses HOME');
  assert.deepEqual(result.errors, []);
  const fallback = path.join(home, '.worthit');
  assert.ok(!fs.existsSync(cacheAt(fallback)), 'selected store must never create HOME/.worthit/scan-cache.db');
  assert.ok(fs.existsSync(cacheAt(env.WORTHIT_HOME)), 'selected store contains scan-cache.db');

  // Standalone/remote-style scanner without a selected store keeps its home cache.
  const defaultEnv = { ...enabled };
  delete defaultEnv.WORTHIT_HOME;
  const direct = run(python, [path.join(root, 'core/extract_usage.py'), '21'], defaultEnv);
  assert.equal(direct.buckets.reduce((n, b) => n + b.requests, 0), 6);
  assert.ok(fs.existsSync(cacheAt(fallback)), 'unset WORTHIT_HOME falls back to HOME/.worthit');
  fs.rmSync(fallback, { recursive: true });

  // The shared harness remains cache-disabled; only this case opts in above.
  const disabledStore = path.join(tmp, 'disabled-store');
  run(process.execPath, ['--input-type=module', '--eval', scanCode], { ...env, WORTHIT_HOME: disabledStore });
  assert.ok(!fs.existsSync(cacheAt(disabledStore)), 'WORTHIT_NO_CACHE disables the selected cache');
  assert.ok(!fs.existsSync(cacheAt(fallback)), 'disabled cache does not fall back to HOME');
  console.log('scan-cache-home: selected store, home fallback and disabled cache match');
} finally { isolated.cleanup(); }
