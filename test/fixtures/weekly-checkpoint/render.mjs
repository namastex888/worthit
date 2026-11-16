// Replace headless Chrome; trace actual merge invocations and completed audit writes.
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

const existsSync = fs.existsSync, spawn = childProcess.spawn, spawnSync = childProcess.spawnSync, writeFileSync = fs.writeFileSync;
childProcess.spawnSync = (command, args, options) => {
  if (args?.[0]?.endsWith('/core/merge_scans.py')) fs.appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify({ command: 'merge-scans', args }) + '\n');
  return spawnSync(command, args, options);
};
fs.writeFileSync = (file, data, ...options) => {
  const result = writeFileSync(file, data, ...options);
  if (String(file).endsWith('-worthit-audit.log')) fs.appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify({ command: 'audit-written', file: String(file), text: String(data) }) + '\n');
  return result;
};
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromes = new Set([chrome, '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']);
fs.existsSync = file => process.env.FIXTURE_NO_CHROME === '1' && chromes.has(file) ? false : file === chrome || existsSync(file);
childProcess.spawn = (command, args, options) => {
  if (command !== chrome) return spawn(command, args, options);
  fs.appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify({ command: 'headless-chrome', args }) + '\n');
  const child = new EventEmitter();
  child.kill = () => {};
  process.nextTick(() => {
    // A literal valid one-pixel PNG, never a screenshot of personal data.
    fs.writeFileSync(args.find(a => a.startsWith('--screenshot=')).slice(13),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVioAAAAASUVORK5CYII=', 'base64'));
    child.emit('close', 0);
  });
  return child;
};
syncBuiltinESMExports();
