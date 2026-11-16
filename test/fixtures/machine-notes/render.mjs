// Real Chrome screenshot of the affected ANSI block, with literal synthetic inputs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { blocks } from '../../../src/draw.mjs';
import { ordinary, noPlans, plan } from './data.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome or Chromium is required for the synthetic visual');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-notes-render-'));
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const htmlLines = lines => lines.join('\n').split(/(\x1b\[[0-9;]*m)/).map(part => {
  const rgb = /^\x1b\[38;2;(\d+);(\d+);(\d+)m$/.exec(part);
  if (rgb) return `</span><span style="color:rgb(${rgb.slice(1).join(',')})">`;
  if (part === '\x1b[39m') return '</span><span>';
  return part.startsWith('\x1b') ? '' : escape(part);
}).join('');
try {
  const panels = [['No ranked plan · machine notes', noPlans], ['Ranked plan · same notes once', { ...noPlans, plans: [plan] }],
    ['No ranked plan · ordinary control', ordinary], ['Ranked plan · ordinary control', { ...ordinary, plans: [plan] }]];
  const html = path.join(scratch, 'blocks.html'), png = path.join(scratch, 'blocks.png');
  fs.writeFileSync(html, `<meta charset="utf-8"><style>body{margin:32px;background:#0a0a0c;color:#f4f4f2;font:14px/1.4 Menlo,monospace}h1{font-size:20px}h2{font-size:15px;color:#b4b4ae}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}pre{font:inherit;white-space:pre}</style><h1>WORTHIT · synthetic machine-note display controls</h1><main>${panels.map(([label, data]) => `<section><h2>${label}</h2><pre><span>${htmlLines(blocks.PlanRanking(data))}</span></pre></section>`).join('')}</main>`);
  const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--metrics-recording-only', '--host-resolver-rules=MAP * ~NOTFOUND', '--user-data-dir=' + path.join(scratch, 'profile'), '--window-size=1200,800', '--screenshot=' + png, 'file://' + html], { encoding: 'utf8', timeout: 30000 });
  console.log(`Chrome status=${run.status}, signal=${run.signal}, error=${run.error?.message || 'none'}`);
  if (run.stderr) process.stderr.write(run.stderr);
  // Record the known issue #67 / PR #79 teardown outcome separately from screenshot validity.
  const teardown = run.status === 2 && run.stderr.includes('Teardown watchdog expired') && run.stderr.includes('bytes written to file ' + png);
  if ((run.status !== 0 && !teardown) || !fs.existsSync(png) || !fs.readFileSync(png).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('No valid new block screenshot');
  fs.copyFileSync(png, path.join(folder, 'dashboard.png'));
  console.log('Saved actual PlanRanking output: test/fixtures/machine-notes/dashboard.png' + (teardown ? ' (Chrome teardown issue #67 / PR #79)' : ''));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
