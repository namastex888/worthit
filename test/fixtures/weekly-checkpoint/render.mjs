// Trace actual merge invocations and completed audit writes.
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const spawnSync = childProcess.spawnSync, writeFileSync = fs.writeFileSync;
childProcess.spawnSync = (command, args, options) => {
  if (args?.[0]?.endsWith('/core/merge_scans.py')) fs.appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify({ command: 'merge-scans', args }) + '\n');
  return spawnSync(command, args, options);
};
fs.writeFileSync = (file, data, ...options) => {
  const result = writeFileSync(file, data, ...options);
  if (String(file).endsWith('-worthit-audit.log')) fs.appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify({ command: 'audit-written', file: String(file), text: String(data) }) + '\n');
  return result;
};
syncBuiltinESMExports();
