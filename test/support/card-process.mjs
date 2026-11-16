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
  let watcher = null, poll = null, stopped = false;
  const closeWatcher = () => {
    const current = watcher; watcher = null;
    current?.close();
  };
  const stop = () => {
    stopped = true; closeWatcher();
    if (poll !== null) clearTimer(poll);
    poll = null;
  };
  const timer = setTimer(() => {
    if (stopped) return;
    stop(); callback(...args);
  }, delay);
  timers.set(timer, stop);
  record({ event: 'timer', delay });
  if (render.mode === 'timeout') {
    const fire = () => {
      if (stopped || !fs.existsSync(path.join(path.dirname(render.png), 'ready'))) return;
      stop(); clearTimer(timer);
      record({ event: 'timeout' }); callback(...args);
    };
    const pollReady = () => {
      poll = null; fire();
      // Use the real timer; stop() bounds polling by readiness, settle or deadline.
      if (!stopped) poll = setTimer(pollReady, 10);
    };
    const fallback = () => {
      closeWatcher();
      if (!stopped && poll === null) poll = setTimer(pollReady, 10);
    };
    try {
      watcher = fs.watch(path.dirname(render.png), fire);
      watcher.on('error', fallback);
    } catch { fallback(); }
    fire();
  }
  return timer;
};
globalThis.clearTimeout = timer => {
  if (timers.has(timer)) {
    timers.get(timer)(); timers.delete(timer);
    record({ event: 'clear' });
  }
  return clearTimer(timer);
};
syncBuiltinESMExports();
