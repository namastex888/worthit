// One real Chrome render per invocation, from isolated fixture artifacts.
// The default is an extract of the actual CLI dashboard, warnings use real drawing blocks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { blocks, strip } from '../../../src/draw.mjs';
import { isolatedEnvironment } from '../../support/environment.mjs';

const [artifacts, mode] = process.argv.slice(2);
assert.ok(['default', 'missing', 'left-out', 'retained'].includes(mode), 'choose one fixture image');
const folder = path.dirname(fileURLToPath(import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const isolated = isolatedEnvironment();
try {
  const D = JSON.parse(fs.readFileSync(path.join(artifacts, mode + '.json')));
  let lines;
  if (mode === 'default') {
    const dashboard = fs.readFileSync(path.join(artifacts, 'default-dashboard.ansi'), 'utf8').split('\n');
    const start = dashboard.findLastIndex(l => strip(l).startsWith('╭') && strip(l).includes('DELIVERY'));
    const end = dashboard.findIndex((l, i) => i > start && strip(l).startsWith('╰'));
    assert.ok(start >= 0 && end > start, 'actual CLI must have a complete Delivery block');
    lines = dashboard.slice(start, end + 1);
  } else lines = [...blocks.PlanRanking(D), '', ...blocks.LimitTrend(D)];
  const esc = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const ansi = lines.join('\n').split(/(\x1b\[[0-9;]*m)/).map(part => {
    const rgb = /^\x1b\[38;2;(\d+);(\d+);(\d+)m$/.exec(part);
    if (rgb) return `</span><span style="color:rgb(${rgb.slice(1).join(',')})">`;
    return part.startsWith('\x1b') ? '' : esc(part);
  }).join('');
  const html = path.join(isolated.tmp, 'dashboard.html'), png = path.join(isolated.tmp, 'dashboard.png');
  fs.writeFileSync(html, `<meta charset="utf-8"><style>body{margin:0;padding:40px;background:#0a0a0c;color:#f4f4f2;font:20px/1.4 Menlo,monospace}h1{font:24px Menlo;color:#b4b4ae}pre{font:inherit}</style><h1>WORTHIT · synthetic demo · ${esc(mode)}</h1><pre><span>${ansi}</span></pre>`);
  const width = mode === 'default' ? 1400 : 900, height = 1000;
  const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--metrics-recording-only',
    '--host-resolver-rules=MAP * ~NOTFOUND', '--user-data-dir=' + path.join(isolated.tmp, 'profile'),
    `--window-size=${width},${height}`, '--screenshot=' + png, 'file://' + html], { env: isolated.env, encoding: 'utf8', timeout: 60000 });
  const teardown = r.status === 2 && r.stderr.includes('Teardown watchdog expired') && r.stderr.includes('bytes written to file ' + png);
  assert.ok(r.status === 0 || teardown, 'Chrome failed: ' + r.status + '\n' + r.stderr);
  const bytes = fs.readFileSync(png);
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'fresh signed PNG');
  assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
  const destination = path.join(folder, mode + '.png');
  fs.copyFileSync(png, destination);
  console.log(`${mode}: Chrome exit ${r.status}${teardown ? ' (teardown after screenshot; known #67/#79)' : ''}; new ${width}x${height} PNG, ${bytes.length} bytes: ${destination}`);
} finally { isolated.cleanup(); }
