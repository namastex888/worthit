// Deterministic dual faults: failure to remove scratch must not replace the
// original write/rename error or turn a completed publication into a failure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { copyFileAtomic, writeFileAtomic, cleanSavedTemps } from '../../../src/atomic.mjs';

const home = process.argv[2], saved = path.join(home, 'run-keep');
fs.mkdirSync(saved, { recursive: true });
const original = { writeFileSync: fs.writeFileSync, copyFileSync: fs.copyFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync };
const source = path.join(home, 'source.json'), old = '{"host":"old-scan"}', next = '{"host":"new-scan"}';
fs.writeFileSync(source, next);

for (const method of ['write', 'copy']) for (const phase of ['write', 'rename', 'success']) {
  const file = path.join(saved, `${method}-${phase}.json`);
  fs.writeFileSync(file, old);
  const primary = Object.assign(new Error(`fixture original ${phase} failure`), { code: phase === 'write' ? 'ENOSPC' : 'EIO' });
  const cleanup = Object.assign(new Error('fixture cleanup denied'), { code: 'EACCES' });
  const isTemp = name => String(name).startsWith(file + '.') && String(name).endsWith('.tmp');
  let temp, cleanupAttempts = 0;
  const writing = (name, operation) => {
    if (isTemp(name)) {
      temp = name;
      if (phase === 'write') { original.writeFileSync(name, '{"partial":'); throw primary; }
    }
    return operation();
  };
  fs.writeFileSync = (name, ...args) => writing(name, () => original.writeFileSync(name, ...args));
  fs.copyFileSync = (from, to, ...args) => writing(to, () => original.copyFileSync(from, to, ...args));
  fs.renameSync = (from, to) => { if (to === file && phase === 'rename') throw primary; return original.renameSync(from, to); };
  fs.rmSync = (name, ...args) => {
    if (isTemp(name)) { cleanupAttempts++; throw cleanup; }
    return original.rmSync(name, ...args);
  };
  const publish = () => method === 'write' ? writeFileAtomic(file, next) : copyFileAtomic(source, file);
  try {
    if (phase === 'success') assert.doesNotThrow(publish, `run-keep-atomic / cleanup preserves successful ${method}FileAtomic publication`);
    else assert.throws(publish, error => error === primary, `run-keep-atomic / cleanup preserves original ${method}FileAtomic ${phase} error`);
  } finally { Object.assign(fs, original); }
  assert.equal(cleanupAttempts, 1, 'run-keep-atomic / injected cleanup failure was exercised');
  assert.equal(fs.readFileSync(file, 'utf8'), phase === 'success' ? next : old, 'run-keep-atomic / error path preserves correct destination bytes');
  if (phase !== 'success') {
    assert.ok(fs.existsSync(temp), 'run-keep-atomic / failed cleanup leaves recoverable scratch');
    const expired = new Date(Date.now() - 2 * 3600e3);
    fs.utimesSync(temp, expired, expired);
    cleanSavedTemps(home);
    assert.ok(!fs.existsSync(temp), 'run-keep-atomic / later cleanup removes abandoned error scratch');
    assert.equal(fs.readFileSync(file, 'utf8'), old);
  }
}
