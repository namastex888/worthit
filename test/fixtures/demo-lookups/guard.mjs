// Observe access from startup imports onward; fail even when application code catches it.
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports, createRequire } from 'node:module';

const store = path.resolve(process.env.WORTHIT_HOME), log = process.env.FIXTURE_STORE_TRACE;
const append = fs.appendFileSync.bind(fs);
const observe = (operation, file) => {
  if (file instanceof URL) file = file.pathname;
  if (typeof file !== 'string' && !Buffer.isBuffer(file)) return;
  const target = path.resolve(String(file));
  if (target !== store && !target.startsWith(store + path.sep)) return;
  append(log, operation + '\n');
  throw new Error('fixture denied synthetic store access: ' + operation);
};
for (const name of ['existsSync', 'readFileSync', 'openSync', 'statSync', 'lstatSync', 'accessSync', 'readdirSync', 'realpathSync', 'writeFileSync', 'mkdirSync', 'rmSync', 'unlinkSync']) {
  const original = fs[name];
  fs[name] = function(file, ...args) { observe(name, file); return original.call(this, file, ...args); };
}
for (const name of ['readFile', 'open', 'stat', 'lstat', 'access', 'readdir', 'realpath', 'writeFile', 'mkdir', 'rm', 'unlink']) {
  const original = fs.promises[name];
  fs.promises[name] = async function(file, ...args) { observe('promises.' + name, file); return original.call(this, file, ...args); };
}
const sqlite = createRequire(import.meta.url)('node:sqlite'), OriginalDatabase = sqlite.DatabaseSync;
sqlite.DatabaseSync = class extends OriginalDatabase {
  constructor(file, ...args) { observe('DatabaseSync', file); super(file, ...args); }
};
syncBuiltinESMExports();
