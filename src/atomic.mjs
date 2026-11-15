// Keep the previous file readable until its same-directory replacement is complete.
import fs from 'node:fs';
import path from 'node:path';

function replace(file, write) {
  const tmp = file + '.tmp';
  try {
    write(tmp);
    const fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}
export const copyFileAtomic = (source, file) => replace(file, tmp => fs.copyFileSync(source, tmp));
export const writeFileAtomic = (file, data) => replace(file, tmp => fs.writeFileSync(tmp, data));

// Interrupted replacements are scratch, never saved scans (including frozen snapshots).
export function cleanSavedTemps(home) {
  fs.rmSync(path.join(home, 'hosts.json.tmp'), { force: true });
  const clean = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) clean(file);
      else if (entry.name.endsWith('.tmp')) fs.rmSync(file, { force: true });
    }
  };
  clean(path.join(home, 'run-keep'));
}
