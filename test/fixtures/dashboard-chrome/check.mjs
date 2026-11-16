import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sourceCase } from '../../support/source-case.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
sourceCase(folder, ({ tmp, env, root, trace }) => {
  const chromeTrace = path.join(tmp, 'chrome.jsonl');
  const childEnv = { ...env, NODE_OPTIONS: env.NODE_OPTIONS + ` --import=${path.join(root, 'test/support/dashboard-process.mjs')}`,
    FIXTURE_CHROME_TRACE: chromeTrace };
  const invoke = (args, mode) => {
    const output = path.join(tmp, mode); fs.mkdirSync(output);
    const result = spawnSync(process.execPath, args, { cwd: output, env: { ...childEnv, FIXTURE_CHROME_MODE: mode },
      input: '', encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr + result.stdout);
    return fs.realpathSync(output);
  };
  const required = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps',
    '--metrics-recording-only', '--host-resolver-rules=MAP * ~NOTFOUND'];
  const profiles = new Set();
  const readCalls = () => {
    if (process.env.WORTHIT_FIXTURE_ARTIFACTS) {
      fs.mkdirSync(process.env.WORTHIT_FIXTURE_ARTIFACTS, { recursive: true });
      fs.copyFileSync(chromeTrace, path.join(process.env.WORTHIT_FIXTURE_ARTIFACTS, 'dashboard-chrome.jsonl'));
    }
    return fs.readFileSync(chromeTrace, 'utf8').trim().split('\n').map(JSON.parse);
  };
  const control = (call, kind) => {
    assert.deepEqual(required.filter(flag => !call.args.includes(flag)), [], `${kind}: missing required Chrome arguments`);
    assert.ok(call.profile, `${kind}: private user-data-dir required`);
    assert.ok(path.isAbsolute(call.profile));
    assert.ok(call.scratch.startsWith(fs.realpathSync(tmp) + path.sep), 'profile stays within synthetic TMPDIR');
    assert.equal(path.dirname(call.profile), path.dirname(call.html), 'profile and input share private scratch');
    assert.ok(!profiles.has(call.profile), 'every screenshot gets a unique profile'); profiles.add(call.profile);
    assert.ok(!fs.existsSync(path.dirname(call.profile)), `${kind}/${call.mode}: scratch and profile removed`);
    assert.doesNotMatch(call.source, /https?:\/\/|@import/i, 'screenshot HTML/CSS loads no remote resources');
  };
  const sentinel = path.join(tmp, 'unrelated-sentinel'); fs.writeFileSync(sentinel, 'keep');
  for (const mode of ['exit0', 'exit2', 'throw']) {
    const output = invoke([path.join(root, 'bin/worthit.mjs'), '--hosts', 'none', '--git', 'no', '--ai', 'no'], mode);
    const calls = readCalls();
    assert.equal(calls.length, profiles.size + 1, 'one actual dashboard screenshot spawn per CLI run');
    const call = calls.at(-1); control(call, 'dashboard');
    assert.ok(call.args.includes('--force-device-scale-factor=2'));
    assert.match(call.args.find(a => a.startsWith('--window-size=')), /^--window-size=\d+,\d+$/);
    assert.equal(call.timeout, 60000);
    assert.equal(call.args.find(a => a.startsWith('--screenshot=')), '--screenshot=' + path.join(output, '2026-11-14-worthit.png'));
    if (mode !== 'throw') assert.match(fs.readFileSync(path.join(output, '2026-11-14-worthit-audit.log'), 'utf8'),
      /headless Chrome screenshot of the dashboard \(local file, no network\)/);
    console.log(`dashboard/${mode}: actual argv pinned; private scratch removed`);
  }
  // Pin the other real caller too, so extracting shared flags cannot weaken cards.
  invoke(['--input-type=module', '-e', `import {renderCardImage,cardSpec} from ${JSON.stringify(path.join(root, 'src/card.mjs'))};
    import {demoData} from ${JSON.stringify(path.join(root, 'src/demo.mjs'))};
    await renderCardImage(cardSpec('allowance', demoData()), 'card.png');`], 'card');
  const calls = readCalls();
  assert.equal(calls.length, 4); control(calls.at(-1), 'card');
  assert.ok(calls.at(-1).args.includes('--force-device-scale-factor=1'));
  assert.ok(calls.at(-1).args.includes('--window-size=1600,900'));
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep', 'cleanup leaves unrelated files alone');
  assert.deepEqual(trace(), [], 'no SSH, forge, meter, agent or browser executable needed');
});
