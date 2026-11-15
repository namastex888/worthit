// Keep the previous file readable until its same-directory replacement is complete.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function replace(file, write) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    write(tmp);
    const fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally {
    // Cleanup is best effort: keep the original I/O error (or successful publish).
    try { fs.rmSync(tmp, { force: true }); } catch { /* expired scratch is cleaned on a later run */ }
  }
}
export const copyFileAtomic = (source, file) => replace(file, tmp => fs.copyFileSync(source, tmp));
export const writeFileAtomic = (file, data) => replace(file, tmp => fs.writeFileSync(tmp, data));

// Interrupted replacements are scratch, never saved scans (including frozen snapshots).
export function cleanSavedTemps(home) {
  const expired = file => fs.statSync(file).mtimeMs < Date.now() - 3600e3;
  const remove = file => {
    try { if (expired(file)) fs.rmSync(file, { force: true }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  };
  // Leave fresh temps alone: another CLI may still be writing one.
  let entries = [];
  try { entries = fs.readdirSync(home); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const name of entries) if (['hosts.json.', 'history.json.'].some(prefix => name.startsWith(prefix)) && name.endsWith('.tmp')) remove(path.join(home, name));
  const clean = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) clean(file);
      else if (entry.name.endsWith('.tmp')) remove(file);
    }
  };
  clean(path.join(home, 'run-keep'));
}
