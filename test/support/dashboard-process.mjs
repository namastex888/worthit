// Test-only interception of the real screenshot calls; never launch a browser.
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

const exists = fs.existsSync, spawn = childProcess.spawn, spawnSync = childProcess.spawnSync;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.existsSync = file => file === chrome || exists(file);
const capture = (command, args, options) => {
  const html = args.find(a => a.startsWith('file://')).slice(7);
  const profile = args.find(a => a.startsWith('--user-data-dir='))?.slice(16);
  if (profile) { fs.mkdirSync(profile, { recursive: true }); fs.writeFileSync(path.join(profile, 'sentinel'), 'synthetic profile'); }
  fs.appendFileSync(process.env.FIXTURE_CHROME_TRACE, JSON.stringify({ command, args, timeout: options.timeout,
    html, source: fs.readFileSync(html, 'utf8'), profile, scratch: profile ? fs.realpathSync(path.dirname(profile)) : null,
    mode: process.env.FIXTURE_CHROME_MODE }) + '\n');
};
childProcess.spawnSync = (command, args, options) => {
  if (command !== chrome) return spawnSync(command, args, options);
  capture(command, args, options);
  if (process.env.FIXTURE_CHROME_MODE === 'throw') throw new Error('synthetic screenshot spawn failure');
  return { status: process.env.FIXTURE_CHROME_MODE === 'exit2' ? 2 : 0, signal: null };
};
childProcess.spawn = (command, args, options) => {
  if (command !== chrome) return spawn(command, args, options);
  capture(command, args, options);
  const child = new EventEmitter(); child.kill = () => true;
  process.nextTick(() => child.emit('close', 0));
  return child;
};
syncBuiltinESMExports();
