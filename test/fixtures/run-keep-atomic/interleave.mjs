// Two real publishers paused inside their writes, with cleanup between them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFileAtomic, cleanSavedTemps } from '../../../src/atomic.mjs';

const [mode, store, source] = process.argv.slice(2), file = path.join(store, 'run-keep/box-b.json');
if (mode === 'writer') {
  const copy = fs.copyFileSync;
  fs.copyFileSync = (from, tmp) => {
    fs.writeFileSync(tmp, '{"partial":');
    process.stdout.write(JSON.stringify({ tmp }) + '\n');
    fs.readSync(0, Buffer.alloc(1), 0, 1, null);
    copy(from, tmp);
  };
  copyFileAtomic(source, file);
} else {
  const writers = [];
  const start = async name => {
    const source = path.join(store, name + '.json');
    fs.writeFileSync(source, JSON.stringify({ host: name, payload: name.repeat(10000) }));
    const child = spawn(process.execPath, [new URL(import.meta.url).pathname, 'writer', store, source], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    writers.push(child);
    const done = once(child, 'exit');
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const ready = await Promise.race([
      once(child.stdout, 'data').then(([chunk]) => JSON.parse(chunk.toString())),
      done.then(([code, signal]) => { throw new Error(`publisher exited before partial write: ${code}/${signal} ${stderr}`); }),
    ]);
    return { child, done, tmp: ready.tmp, source };
  };
  const timer = setTimeout(() => { for (const child of writers) child.kill('SIGKILL'); }, 10000);
  try {
    const old = fs.readFileSync(file), a = await start('writer-a'), b = await start('writer-b');
    assert.notEqual(a.tmp, b.tmp, 'run-keep-atomic / concurrent writers have unique temp names');
    for (const writer of [a, b]) {
      assert.equal(path.dirname(writer.tmp), path.dirname(file));
      assert.ok(writer.tmp.startsWith(file + '.' + writer.child.pid + '.') && writer.tmp.endsWith('.tmp'));
      assert.equal(fs.readFileSync(writer.tmp, 'utf8'), '{"partial":');
    }
    cleanSavedTemps(store);
    for (const writer of [a, b]) assert.ok(fs.existsSync(writer.tmp), 'run-keep-atomic / cleanup preserves fresh live temp');
    assert.deepEqual(fs.readFileSync(file), old, 'run-keep-atomic / partial concurrent writes leave old bytes intact');
    a.child.stdin.end('x'); assert.deepEqual(await a.done, [0, null]);
    assert.deepEqual(fs.readFileSync(file), fs.readFileSync(a.source), 'run-keep-atomic / first publication is complete while second is partial');
    assert.equal(fs.readFileSync(b.tmp, 'utf8'), '{"partial":');
    b.child.stdin.end('x'); assert.deepEqual(await b.done, [0, null]);
    assert.deepEqual(fs.readFileSync(file), fs.readFileSync(b.source), 'run-keep-atomic / concurrent winner contains complete bytes');
    assert.equal(JSON.parse(fs.readFileSync(file)).host, 'writer-b');
    for (const writer of [a, b]) assert.ok(!fs.existsSync(writer.tmp));
  } finally {
    clearTimeout(timer);
    for (const child of writers) if (child.exitCode == null) child.kill('SIGKILL');
  }
}
