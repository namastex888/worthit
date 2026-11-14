// One process per plain check.mjs; always finish discovery before reporting failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from './support/environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'test/fixtures');
// These regression cases must not silently disappear from CI. Extra folders are discovered too.
const required = ['no-answer-machine', 'left-out-machine', 'second-code-host-account', 'keep-saved-days', 'history-scan-coverage'];
let failed = 0, ran = 0;
const fail = (name, reason) => { failed++; console.error(`fixture ${name}: FAIL (${reason})`); };
let folders = [];
try { folders = fs.readdirSync(fixtures, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(); }
catch (error) { fail('discovery', error.message); }
for (const name of required) if (!folders.includes(name)) fail(name, 'missing fixture folder');
if (!folders.length) fail('discovery', 'no fixture folders');
for (const name of folders) {
  const check = path.join(fixtures, name, 'check.mjs');
  let isolated;
  try {
    if (!fs.existsSync(check) || !fs.statSync(check).isFile()) { fail(name, 'missing check.mjs'); continue; }
    if (!fs.readFileSync(check, 'utf8').trim()) { fail(name, 'empty check.mjs'); continue; }
    isolated = isolatedEnvironment();
    console.log(`fixture ${name}: RUN`);
    ran++;
    const r = spawnSync(process.execPath, [check], { cwd: root, env: isolated.env, encoding: 'utf8', maxBuffer: 16 << 20, timeout: 120000 });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.error || r.status !== 0) fail(name, r.error?.message || `exit ${r.status}, signal ${r.signal || 'none'}`);
    else console.log(`fixture ${name}: PASS`);
  } catch (error) { fail(name, error.message); }
  finally { isolated?.cleanup(); }
}
console.log(`fixtures: ${ran} run, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
