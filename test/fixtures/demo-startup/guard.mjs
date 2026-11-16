// Loaded before CLI imports. Record attempts even when production catches the denial.
import '../../../src/quiet.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cp from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';

const rawOpen = fs.openSync.bind(fs), rawWrite = fs.writeSync.bind(fs), rawClose = fs.closeSync.bind(fs);
const descriptors = new Map();
const roots = [['store', process.env.WORTHIT_HOME], ['home', process.env.HOME]]
  .map(([scope, folder]) => [scope, path.resolve(folder)]);
const record = event => {
  const fd = rawOpen(process.env.FIXTURE_ACCESS_TRACE, 'a');
  try { rawWrite(fd, JSON.stringify(event) + '\n'); } finally { rawClose(fd); }
};
const denied = () => { const e = new Error('fixture denied synthetic access'); e.code = 'FIXTURE_ACCESS_DENIED'; throw e; };
function target(file) {
  if (typeof file === 'number') return descriptors.get(file);
  if (file instanceof URL) file = fileURLToPath(file);
  if (typeof file !== 'string' && !Buffer.isBuffer(file)) return;
  const resolved = path.resolve(String(file));
  for (const [scope, folder] of roots) if (resolved === folder || resolved.startsWith(folder + path.sep))
    return { scope, file: path.relative(folder, resolved) || '.' };
}
function observe(operation, file, write = false) {
  const policy = process.env.FIXTURE_ACCESS_POLICY;
  const location = target(file) || (write && policy === 'read-only' ? { scope: 'output', file: path.basename(String(file)) } : null);
  if (!location) return;
  record({ kind: 'fs', operation, ...location, ...(write ? { write: true } : {}) });
  if (policy !== 'observe' && (policy !== 'read-only' || write)) denied();
}
const singles = ['access', 'appendFile', 'chmod', 'chown', 'lstat', 'mkdir', 'mkdtemp', 'open',
  'opendir', 'readFile', 'readdir', 'readlink', 'realpath', 'rm', 'rmdir', 'stat', 'truncate',
  'unlink', 'utimes', 'watch', 'watchFile', 'writeFile'];
const pairs = ['copyFile', 'cp', 'link', 'rename', 'symlink'];
const mutations = new Set(['appendFile', 'chmod', 'chown', 'mkdir', 'mkdtemp', 'rm', 'rmdir',
  'truncate', 'unlink', 'utimes', 'writeFile', 'createWriteStream', 'write', 'writev']);
const writable = flags => typeof flags === 'number'
  ? !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND))
  : /[wa+]/.test(flags || 'r');
for (const name of [...singles, ...pairs, 'exists', 'createReadStream', 'createWriteStream', 'read', 'write', 'readv', 'writev']) {
  for (const key of [name, name + 'Sync']) {
    if (typeof fs[key] !== 'function') continue;
    const original = fs[key];
    fs[key] = function(file, ...args) {
      observe(key, file, mutations.has(name) || name === 'rename' || name === 'open' && writable(args[0]));
      if (pairs.includes(name)) observe(key, args[0], true);
      if (key === 'open') {
        const cb = args.pop();
        args.push((error, fd) => { if (!error) { descriptors.delete(fd); if (target(file)) descriptors.set(fd, target(file)); } cb(error, fd); });
      }
      const result = original.call(this, file, ...args);
      if (key === 'openSync') { descriptors.delete(result); if (target(file)) descriptors.set(result, target(file)); }
      return result;
    };
  }
}
const close = fs.close, closeSync = fs.closeSync;
fs.close = function(fd, ...args) { descriptors.delete(fd); return close.call(this, fd, ...args); };
fs.closeSync = function(fd, ...args) { descriptors.delete(fd); return closeSync.call(this, fd, ...args); };
for (const name of [...singles, ...pairs]) {
  if (typeof fs.promises[name] !== 'function') continue;
  const original = fs.promises[name];
  fs.promises[name] = async function(file, ...args) {
    observe('promises.' + name, file, mutations.has(name) || name === 'rename' || name === 'open' && writable(args[0]));
    if (pairs.includes(name)) observe('promises.' + name, args[0], true);
    return original.call(this, file, ...args);
  };
}
const sqlite = createRequire(import.meta.url)('node:sqlite'), Database = sqlite.DatabaseSync;
sqlite.DatabaseSync = class extends Database {
  constructor(file, ...args) { observe('DatabaseSync', file, !args[0]?.readOnly); super(file, ...args); }
};
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const original = cp[name];
  cp[name] = function(command, ...args) {
    // Exact demo JSON/share legitimately discover optional executables, but never run them.
    const probe = ['spawnSync', 'execFileSync'].includes(name) && command === 'which' &&
      Array.isArray(args[0]) && args[0].length === 1 && ['claude', 'codex', 'omp', 'dsh'].includes(args[0][0]);
    record({ kind: probe ? 'probe' : 'subprocess', operation: name, command: path.basename(String(command)) });
    if (probe) return original.call(this, command, ...args);
    denied();
  };
}
syncBuiltinESMExports();
record({ kind: 'ready' });
