// Replace only headless Chrome in this fixture; scanners still run normally.
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

const existsSync = fs.existsSync, spawn = childProcess.spawn;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.existsSync = file => file === chrome || existsSync(file);
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
