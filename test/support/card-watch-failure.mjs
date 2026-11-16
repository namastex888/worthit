// Fail the timeout harness's watcher deterministically, without exhausting host
// descriptors. Imported before card-process.mjs only by watcher regression cases.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

const record = event => fs.appendFileSync(process.env.FIXTURE_WATCH_TRACE, JSON.stringify(event) + '\n');
fs.watch = () => {
  const error = Object.assign(new Error('synthetic watcher descriptor exhaustion'), { code: 'EMFILE' });
  record({ event: 'watch', mode: process.env.FIXTURE_WATCH_FAILURE });
  if (process.env.FIXTURE_WATCH_FAILURE === 'sync') throw error;
  const watcher = new EventEmitter();
  watcher.close = () => record({ event: 'close' });
  setImmediate(() => {
    record({ event: 'error', code: error.code });
    watcher.emit('error', error);
  });
  return watcher;
};
syncBuiltinESMExports();
