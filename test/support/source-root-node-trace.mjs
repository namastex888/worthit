// Test-only collector trace: includes saved-only command probes that Python cannot see.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const append = fs.appendFileSync.bind(fs), trace = process.env.SOURCE_ROOT_TRACE, base = process.env.SOURCE_ROOT_BASE;
let busy = false;
const record = (op, file) => {
  if (!trace || busy || typeof file !== 'string' || !file.startsWith(base)) return;
  busy = true;
  try { append(trace, JSON.stringify({ actor: 'collector', op, path: file, outcome: 'attempt' }) + '\n'); }
  finally { busy = false; }
};
for (const name of ['openSync', 'readFileSync', 'statSync', 'lstatSync', 'accessSync', 'existsSync', 'readdirSync', 'readlinkSync', 'realpathSync', 'createReadStream']) {
  const original = fs[name];
  const traced = function (file, ...args) { record(name, file); return original.call(this, file, ...args); };
  if (original.native) traced.native = function (file, ...args) { record(name + '.native', file); return original.native.call(this, file, ...args); };
  fs[name] = traced;
}
for (const name of ['open', 'readFile', 'stat', 'lstat', 'access', 'readdir', 'readlink', 'realpath']) {
  const original = fs.promises[name];
  fs.promises[name] = function (file, ...args) { record('promises.' + name, file); return original.call(this, file, ...args); };
}
syncBuiltinESMExports();
