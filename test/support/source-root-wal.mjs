import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// A live writer keeps committed rows in WAL and an uncommitted different value.
// No polling, checkpointing, mounts or background process survives this scope.
export async function withWal(h, read) {
  const directory = path.join(h.manifest.root, 'wal-meter'), database = path.join(directory, 'meter.db');
  fs.mkdirSync(directory);
  fs.copyFileSync(path.join(h.manifest.meter, 'claude-limits.jsonl'), path.join(directory, 'claude-limits.jsonl'));
  const writer = spawn(h.python, [h.helper, 'wal', database], { cwd: h.base,
    env: { ...h.env, SOURCE_ROOT_ACTOR: 'setup' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  writer.stdout.on('data', chunk => { stdout += chunk; });
  writer.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(resolve => writer.on('close', (status, signal) => resolve({ status, signal })));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WAL writer readiness exceeded 10 seconds')), 10000);
      const ready = () => { if (stdout.includes('WAL_READY')) { clearTimeout(timer); writer.stdout.off('data', ready); resolve(); } };
      writer.stdout.on('data', ready);
      writer.once('error', error => { clearTimeout(timer); reject(error); });
      writer.once('exit', () => { clearTimeout(timer); reject(new Error('WAL writer exited before readiness')); });
    });
    assert.ok(fs.statSync(database + '-wal').size > 0, 'committed WAL must exist while reader scans');
    const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before = [hash(database), hash(database + '-wal')];
    const result = await read(directory);
    assert.deepEqual([hash(database), hash(database + '-wal')], before, 'reader never checkpoints or mutates source DB/WAL');
    assert.equal(stderr, '', 'synthetic writer is healthy');
    return result;
  } finally {
    writer.stdin.end('\n');
    const timer = setTimeout(() => writer.kill('SIGKILL'), 5000);
    const ended = await closed; clearTimeout(timer);
    assert.deepEqual(ended, { status: 0, signal: null }, 'WAL writer releases its lock and exits');
  }
}
