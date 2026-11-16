// Explicit visual-evidence step, separate from make check. Read real fixture output;
// never synthesize proof or patch the saved JSON to make the pictures look right.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { blocks, strip } from '../../../src/draw.mjs';
import { cardSpec, cardHtml } from '../../../src/card.mjs';
import { isolatedEnvironment } from '../../support/environment.mjs';

const [artifacts, destination] = process.argv.slice(2);
assert.ok(artifacts && destination, 'usage: render.mjs <fixture artifacts> <image destination>');
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => fs.existsSync(file));
assert.ok(chrome, 'Chrome/Chromium is required for visual evidence');
const isolated = isolatedEnvironment(), scratch = isolated.tmp;
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
// Reuse PR101/PR103's explicit fixture environment and fresh scratch PNG flow
// for both dashboard and card evidence; production rendering is unchanged.
const screenshot = (source, name, width, height) => {
  const png = path.join(scratch, name + '.png'), output = path.resolve(destination, name + '.png');
  assert.ok(!fs.existsSync(output), 'evidence destination must be fresh');
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-default-apps', '--metrics-recording-only', '--host-resolver-rules=MAP * ~NOTFOUND',
    '--user-data-dir=' + path.join(scratch, name + '-profile'), `--window-size=${width},${height}`, '--screenshot=' + png, 'file://' + source];
  const result = spawnSync(chrome, args, { env: isolated.env, encoding: 'utf8', timeout: 60000 });
  fs.writeFileSync(path.join(destination, name + '-chrome.stderr.log'), result.stderr || '');
  fs.writeFileSync(path.join(destination, name + '-chrome.json'), JSON.stringify({ command: chrome, args,
    status: result.status, signal: result.signal, error: result.error?.message || null }, null, 2));
  const teardown = result.status === 2 && (result.stderr || '').includes('Teardown watchdog expired') &&
    result.stderr.includes('bytes written to file ' + png);
  assert.ok(result.status === 0 || teardown, `Chrome failed: ${result.error?.message || result.signal || result.status}\n${result.stderr || ''}`);
  assert.ok(fs.existsSync(png), 'Chrome did not write a fresh PNG');
  const bytes = fs.readFileSync(png);
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'fresh signed PNG');
  assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
  fs.copyFileSync(png, output);
  console.log(JSON.stringify({ name, image: output, width, height, renderer_exit: result.status,
    renderer_signal: result.signal, teardown_after_screenshot: teardown }));
};
try {
  fs.mkdirSync(destination, { recursive: true });
  for (const mode of ['complete', 'retained-current']) {
    const data = JSON.parse(fs.readFileSync(path.join(artifacts, mode + '.json'), 'utf8'));
    const lines = [...blocks.Tiles(data), '', ...blocks.Delivery(data)].map(strip);
    const html = path.join(scratch, mode + '.html');
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#0b0b0d;color:#b4b4ae}h1{font:18px monospace;color:#f2c14e}pre{font:15px/19px Menlo,monospace;white-space:pre}</style><h1>SYNTHETIC DEMO · ${mode} · real buildData / dashboard blocks</h1><pre>${escape(lines.join('\n'))}</pre>`);
    const height = lines.length * 19 + 112;
    screenshot(html, mode + '-dashboard', 1280, height);
    const card = path.join(scratch, mode + '-card.html');
    fs.writeFileSync(card, cardHtml(cardSpec('delivery', data)));
    screenshot(card, mode + '-card', 1600, 900);
  }
} finally { isolated.cleanup(); }
