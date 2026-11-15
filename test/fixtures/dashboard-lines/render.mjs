// Render saved, synthetic CLI captures. Not part of make check; requires local Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [captures, destination, only] = process.argv.slice(2);
if (!captures || !destination) throw new Error('usage: node render.mjs <capture-directory> <image-directory> [80]');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'worthit-lines-image-'));
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
fs.mkdirSync(destination, { recursive: true });
let failed = false;
try {
  for (const [name, columns, imageName] of [['retained-tty-80', 80, 'retained-80'], ['retained-120', 120, 'retained-120']]) {
    if (only === '80' && columns !== 80) continue;
    const lines = fs.readFileSync(path.join(captures, name + '.txt'), 'utf8').split('\n');
    // Exact captured rows: the notice, both paired boxes, waste, months and later events.
    const notice = [...new Set(lines.filter(l => /98 columns/.test(l)))];
    const start = lines.findIndex(l => l.includes('WHICH PLAN GAVE MORE'));
    const events = lines.findIndex(l => l.includes('EVENTS THIS WEEK'));
    const end = lines.findIndex((l, i) => i > events && l.startsWith('╰')) + 1;
    const tiles = lines.findIndex(l => l.includes('TOKENS OUT'));
    const ttyNotice = lines.findLastIndex((l, i) => i < tiles && /98 columns.*wrap/.test(l));
    const summary = lines.findIndex((l, i) => i >= end && l.includes('SUMMARY'));
    // The narrow excerpt keeps the actual notice position and Events-to-Summary spacing.
    const captured = columns === 80
      ? lines.slice(ttyNotice >= 0 ? ttyNotice : tiles, summary + 3)
      : [...notice, '', ...lines.slice(start, end)];
    // A terminal physically wraps long captured lines at its column boundary.
    const selected = captured.flatMap(line => { const cells = [...line], rows = [];
      do { rows.push(cells.splice(0, columns).join('')); } while (cells.length); return rows; });
    const width = columns * 9 + 32, height = selected.length * 18 + 76;
    const html = path.join(scratch, name + '.html');
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#17171c;color:#e5e5e2}p{font:12px monospace;color:#f2c14e;margin:0 0 16px}pre{font:14px/18px Menlo,monospace;white-space:pre;margin:0}</style><p>SYNTHETIC ${columns === 80 ? 'PTY STREAM EXCERPT' : 'CLI CAPTURE'} · ${columns} columns · retained machine</p><pre>${escape(selected.join('\n'))}</pre>`);
    const output = path.resolve(destination, imageName + '.png');
    fs.rmSync(output, { force: true }); // A failed capture must not report an old PNG as newly written.
    const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      '--force-device-scale-factor=1', '--user-data-dir=' + path.join(scratch, name),
      `--window-size=${width},${height}`, '--screenshot=' + output, 'file://' + html],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 2 << 20 });
    const status = { name, renderer_exit: r.status, renderer_signal: r.signal, renderer_error: r.error?.code || null,
      image_written: fs.existsSync(output), cli_exit: JSON.parse(fs.readFileSync(path.join(captures, 'cli-status.json'))).find(s => s.name === name).cli_exit };
    console.log(JSON.stringify(status));
    if (r.status !== 0 || !status.image_written) failed = true;
  }
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
process.exitCode = failed ? 1 : 0;
