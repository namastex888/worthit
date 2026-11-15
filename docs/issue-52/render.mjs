// Render the exact dashboard drawing blocks and delivery card from saved synthetic fixture output.
// Usage: HOME=<synthetic> WORTHIT_HOME=<synthetic>/store node docs/issue-52/render.mjs <fixture-artifacts>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { blocks } from '../../src/draw.mjs';
import { cardSpec, cardHtml } from '../../src/card.mjs';
const destination = path.dirname(fileURLToPath(import.meta.url));
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome || !process.argv[2]) throw new Error('Chrome and the synthetic fixture artifacts directory are required');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const ansiHtml = text => text.split(/(\x1b\[[0-9;]*m)/).map(part => {
  const rgb = /^\x1b\[38;2;(\d+);(\d+);(\d+)m$/.exec(part);
  if (rgb) return `</span><span style="color:rgb(${rgb.slice(1).join(',')})">`;
  return part.startsWith('\x1b') ? '' : escape(part);
}).join('');
for (const mode of ['meter-sync', 'good']) {
  const data = JSON.parse(fs.readFileSync(path.join(process.argv[2], mode + '.json')));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'worthit-52-render-'));
  try {
    const html = path.join(scratch, 'dashboard.html');
    const lines = [...blocks.Tiles(data), '', ...blocks.Delivery(data)].join('\n');
    fs.writeFileSync(html, `<meta charset="utf-8"><style>body{margin:0;padding:48px;background:#0a0a0c;color:#f4f4f2;font:22px/1.4 Menlo,monospace}h1{font:28px Menlo;color:#b4b4ae}pre{font:inherit}</style><h1>WORTHIT · synthetic ${mode === 'good' ? 'complete sources' : 'failed meter source'}</h1><pre><span>${ansiHtml(lines)}</span></pre>`);
    const screenshot = (input, output, size) => {
      const png = path.join(scratch, path.basename(output));
      const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--metrics-recording-only', '--host-resolver-rules=MAP * ~NOTFOUND', '--user-data-dir=' + path.join(scratch, path.basename(output) + '-profile'), '--window-size=' + size, '--screenshot=' + png, 'file://' + input], { encoding: 'utf8', timeout: 30000 });
      // This Mac can exit 2 during teardown AFTER writing a complete screenshot.
      // Accept only that explicit diagnostic with a newly written, signed PNG; log it.
      const teardown = run.status === 2 && run.stderr.includes('Teardown watchdog expired') && run.stderr.includes('bytes written to file ' + png);
      if ((run.status !== 0 && !teardown) || !fs.existsSync(png) || !fs.readFileSync(png).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('render failed: ' + output + '\n' + run.stderr);
      if (teardown) console.log('Chrome exit 2 during teardown; validated new PNG: ' + output);
      fs.copyFileSync(png, output);
    };
    screenshot(html, path.join(destination, mode + '-dashboard.png'), '1600,1100');
    const card = path.join(scratch, 'delivery.html'); fs.writeFileSync(card, cardHtml(cardSpec('delivery', data)));
    screenshot(card, path.join(destination, mode + '-delivery.png'), '1600,900');
    console.log(mode + ': rendered dashboard and delivery card');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
