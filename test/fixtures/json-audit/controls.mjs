// Refuse browser processes even if a regression reaches an absolute host path.
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

for (const method of ['spawn', 'spawnSync']) {
  const original = childProcess[method];
  childProcess[method] = (command, ...args) => {
    if (/chrome|chromium/i.test(command)) {
      fs.appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify({ unexpected: 'browser process' }) + '\n');
      throw new Error('JSON fixture attempted a browser process');
    }
    return original(command, ...args);
  };
}
syncBuiltinESMExports();
