// Fixture-only filesystem faults. No application hook or real store is involved.
import fs from 'node:fs';
import path from 'node:path';
const { writeFileSync, copyFileSync, cpSync, renameSync } = fs;
const target = process.env.FIXTURE_INTERRUPT_FILE;
const matches = file => target && (String(file) === target || String(file).startsWith(target + '.') && String(file).endsWith('.tmp'));
function interrupt(file) {
  // Both the atomic and plain-copy controls stop at the same partial-write boundary.
  writeFileSync(file, '{"interrupted":');
  writeFileSync(process.env.FIXTURE_FAULT_RECEIPT, JSON.stringify({ file: String(file) }));
  process.kill(process.pid, 'SIGKILL');
}
fs.writeFileSync = (file, ...args) => { if (matches(file)) interrupt(file); return writeFileSync(file, ...args); };
fs.copyFileSync = (source, file, ...args) => { if (matches(file)) interrupt(file); return copyFileSync(source, file, ...args); };
// cpSync uses internal bindings, so its filter supplies the equivalent write boundary
// for the private negative control that restores the old recursive plain copy.
fs.cpSync = (source, dest, options = {}) => cpSync(source, dest, { ...options, filter: (from, to) => {
  if (options.filter && !options.filter(from, to)) return false;
  if (matches(to)) interrupt(to);
  return true;
} });
fs.renameSync = (from, to) => {
  if (process.env.FIXTURE_FAIL_HOSTS === '1' && String(to) === path.join(process.env.WORTHIT_HOME, 'hosts.json')) {
    const error = new Error('fixture hosts replacement failed'); error.code = 'EIO'; throw error;
  }
  return renameSync(from, to);
};
