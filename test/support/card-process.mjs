// Test-only process fault instrumentation. Ordinary CLI cases use the executable
// override without this preload. No production hook or timeout override is added.
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

const spawn = childProcess.spawn, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout;
const record = event => fs.appendFileSync(process.env.FIXTURE_PROCESS_TRACE, JSON.stringify(event) + '\n');
let render = null;
const timers = new Map();
childProcess.spawn = (command, args, options) => {
  if (command !== process.env.WORTHIT_TEST_CHROME) return spawn(command, args, options);
  const mode = process.env.FIXTURE_CHROME_MODE;
  if (mode === 'error-no-close') {
    const child = new EventEmitter();
    child.kill = () => { record({ event: 'unexpected-kill' }); return false; };
    render = { mode };
    setImmediate(() => {
      record({ event: 'error', code: 'EMFILE' });
      child.emit('error', Object.assign(new Error('synthetic descriptor exhaustion'), { code: 'EMFILE' }));
      // Intentionally no close event, matching the descriptor-exhaustion path.
    });
    return child;
  }
  const child = spawn(command, args, options);
  if (mode === 'timeout') render = { mode, png: args.find(a => a.startsWith('--screenshot=')).slice(13) };
  return child;
};
globalThis.setTimeout = (callback, delay, ...args) => {
  if (delay !== 60000 || !render) return setTimer(callback, delay, ...args);
  const timer = setTimer(callback, delay, ...args);
  record({ event: 'timer', delay });
  let watcher = null, fired = false;
  if (render.mode === 'timeout') {
    const fire = () => {
      if (fired || !fs.existsSync(path.join(path.dirname(render.png), 'ready'))) return;
      fired = true; clearTimer(timer); watcher.close();
      record({ event: 'timeout' }); callback(...args);
    };
    watcher = fs.watch(path.dirname(render.png), fire);
    fire();
  }
  timers.set(timer, watcher);
  return timer;
};
globalThis.clearTimeout = timer => {
  if (timers.has(timer)) {
    timers.get(timer)?.close(); timers.delete(timer);
    record({ event: 'clear' });
  }
  return clearTimer(timer);
};
syncBuiltinESMExports();
