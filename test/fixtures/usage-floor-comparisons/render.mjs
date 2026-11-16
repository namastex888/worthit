// Explicit visual-evidence step, separate from make check. Read real fixture output;
// never synthesize proof or patch the saved JSON to make the pictures look right.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { blocks, strip } from '../../../src/draw.mjs';
import { cardSpec, renderCardImage } from '../../../src/card.mjs';

const [artifacts, destination] = process.argv.slice(2);
assert.ok(artifacts && destination, 'usage: render.mjs <fixture artifacts> <image destination>');
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => fs.existsSync(file));
assert.ok(chrome, 'Chrome/Chromium is required for visual evidence');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'worthit-usage-render-'));
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
try {
  fs.mkdirSync(destination, { recursive: true });
  for (const mode of ['complete', 'retained-current']) {
    const data = JSON.parse(fs.readFileSync(path.join(artifacts, mode + '.json'), 'utf8'));
    const lines = [...blocks.Tiles(data), '', ...blocks.Delivery(data)].map(strip);
    const html = path.join(scratch, mode + '.html');
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#0b0b0d;color:#b4b4ae}h1{font:18px monospace;color:#f2c14e}pre{font:15px/19px Menlo,monospace;white-space:pre}</style><h1>SYNTHETIC DEMO · ${mode} · real buildData / dashboard blocks</h1><pre>${escape(lines.join('\n'))}</pre>`);
    const dashboard = path.resolve(destination, mode + '-dashboard.png');
    assert.ok(!fs.existsSync(dashboard), 'evidence destination must be fresh');
    const height = lines.length * 19 + 112;
    const result = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
      '--disable-sync', '--disable-default-apps', '--metrics-recording-only', '--host-resolver-rules=MAP * ~NOTFOUND',
      '--user-data-dir=' + path.join(scratch, mode), `--window-size=1280,${height}`, '--screenshot=' + dashboard, 'file://' + html],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 2 << 20 });
    assert.ok(fs.existsSync(dashboard), `dashboard renderer failed: ${result.error?.message || result.signal || result.status}`);
    assert.ok(fs.readFileSync(dashboard).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
    const card = await renderCardImage(cardSpec('delivery', data), path.resolve(destination, mode + '-card.png'));
    assert.ok(card.image, card.error);
    console.log(JSON.stringify({ mode, dashboard, dashboard_renderer_exit: result.status, dashboard_renderer_signal: result.signal, card: card.image, card_note: card.note }));
  }
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
