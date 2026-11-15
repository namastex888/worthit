import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sourceCase } from '../../support/source-case.mjs';
import { fixturePng, installChromeStub } from '../../support/chrome-stub.mjs';
import { demoData } from '../../../src/demo.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
sourceCase(folder, ({ tmp, bin, env, root, query, trace }) => {
  const chrome = installChromeStub(bin), chromeTrace = path.join(tmp, 'chrome.jsonl');
  const destination = path.join(tmp, '2026-11-14-worthit-share-allowance.png');
  const canonical = p => fs.realpathSync(p);
  const invoke = (command, mode, options = {}) => {
    const store = `${command}-${mode}${options.unsafe ? '-unsafe' : ''}${options.partial ? '-partial' : ''}`;
    const storePath = path.join(tmp, store); fs.mkdirSync(storePath, { recursive: true });
    fs.writeFileSync(path.join(storePath, 'last.json'), JSON.stringify(demoData()));
    const stale = fixturePng(); fs.writeFileSync(destination, stale); fs.utimesSync(destination, 1, 1);
    const r = spawnSync(process.execPath, [path.join(root, 'bin/worthit.mjs'), command,
      ...(command === 'share' ? ['allowance', '--ai', 'no'] : []), ...(options.partial ? ['--allow-partial'] : [])], {
      cwd: tmp, env: { ...env, WORTHIT_HOME: storePath, WORTHIT_TEST_CHROME: options.executable || chrome,
        FIXTURE_CHROME_MODE: mode, FIXTURE_CHROME_TRACE: chromeTrace, FIXTURE_OFFLINE: options.unsafe ? '1' : '0' },
      encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20,
    });
    assert.ifError(r.error);
    const success = ['exit0', 'exit2', 'signal'].includes(mode) && !options.executable;
    assert.equal(r.status, command === 'share' ? 0 : !success ? 1 : options.unsafe && !options.partial ? 3 : 0, `${command}/${mode}: ${r.stderr}`);
    const result = r.stdout.trim() ? JSON.parse(r.stdout) : null;
    if (success) {
      assert.ok(result.image, `${command}/${mode}: freshly written PNG must be accepted`);
      assert.ok(path.isAbsolute(result.image));
      assert.equal(canonical(result.image), canonical(destination));
      assert.deepEqual(fs.readFileSync(result.image), fixturePng());
      assert.ok(fs.statSync(result.image).mtimeMs > 1000, 'replaced stale destination');
      if (mode !== 'exit0') assert.match(command === 'share' ? result.warnings.join('\n') : r.stderr, mode === 'exit2' ? /Chrome exited 2 after writing/ : /Chrome.*SIGTERM.*after writing/);
    } else {
      if (command === 'share') {
        assert.equal(result.image, null);
        assert.match(result.warnings.join('\n'), options.executable ? /Chrome.*(not found|could not start)/ : /Chrome.*(render|PNG|exited 2)/);
      } else {
        assert.equal(result, null, 'failed weekly prints no success result');
        assert.match(r.stderr, /PNG.*could not be rendered/);
        assert.match(r.stderr, options.executable ? /Chrome.*(not found|could not start)/ : /Chrome.*(render|PNG|exited 2)/);
      }
      assert.deepEqual(fs.readFileSync(destination), stale, 'failed invocation never accepts or overwrites stale destination');
      assert.equal(fs.statSync(destination).mtimeMs, 1000);
    }
    if (command === 'weekly') {
      const rows = query('SELECT json FROM weekly', store);
      assert.equal(rows.length, success ? 1 : 0, 'checkpoint only after accepted render');
      if (success) assert.deepEqual(JSON.parse(rows[0].json), result);
    }
    console.log(`${command}/${mode}${options.unsafe ? '/unsafe' : ''}: exit ${r.status}, ${success ? 'image accepted' : 'no image'}`);
  };
  // Two commands at the real CLI -> renderer -> executable boundary, serialized.
  for (const mode of ['exit0', 'exit2', 'none', 'invalid', 'wrong-size', 'truncated']) {
    invoke('share', mode); invoke('weekly', mode);
  }
  invoke('weekly', 'signal');
  invoke('weekly', 'no-write-zero');
  invoke('share', 'old');
  invoke('weekly', 'absent', { executable: path.join(bin, 'missing-chrome') });
  const unexecutable = path.join(bin, 'unexecutable'); fs.writeFileSync(unexecutable, 'no executable permission');
  invoke('share', 'unexecutable', { executable: unexecutable });
  invoke('weekly', 'exit2', { unsafe: true });
  invoke('weekly', 'exit2', { unsafe: true, partial: true });
  const calls = fs.readFileSync(chromeTrace, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.length > 0);
  for (const { args, png } of calls) {
    const scratch = path.dirname(png);
    assert.notEqual(path.resolve(png), destination);
    assert.ok(!fs.existsSync(scratch), 'private profile and scratch removed');
    for (const flag of ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--metrics-recording-only', '--host-resolver-rules=MAP * ~NOTFOUND', '--window-size=1600,900', '--force-device-scale-factor=1']) assert.ok(args.includes(flag), flag);
    assert.equal(args.find(a => a.startsWith('--user-data-dir=')), '--user-data-dir=' + path.join(scratch, 'profile'));
  }
  assert.ok(trace().every(c => c.command === 'ssh'), 'only synthetic SSH reads; no UI, agents or clipboard');
});
