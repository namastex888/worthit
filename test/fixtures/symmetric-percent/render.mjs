// Inspected visual evidence: bundled --demo data, replaced only with literal synthetic edge plans.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { demoData } from '../../../src/demo.mjs';
import { prepareWeekly, allowanceText } from '../../../src/weekly.mjs';
import { cardSpec, cardHtml } from '../../../src/card.mjs';
import { blocks } from '../../../src/draw.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(folder, '../../..');
const cases = JSON.parse(fs.readFileSync(path.join(folder, 'cases.json'), 'utf8')).slice(0, 3);
const data = demoData(), labels = ['Example Zero', 'Example Rise', 'Example Drop'];
data.week = { from: '2026-11-07', to: '2026-11-14' }; data.generated_at = '2026-11-14T12:00:00Z';
data.plans = cases.map((c, i) => ({ ...data.plans[i], plan: labels[i], proof: 'measured',
  usd_per_full_week: c.to, history: [c.from, c.to] }));
prepareWeekly(data, { plans: cases.map((c, i) => ({ plan: labels[i], proof: 'measured', usd_per_full_week: c.from })) });
const destination = path.join(root, 'docs/symmetric-percent-card.png');

const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
// Preserve actual TUI truecolor and bold sequences in a static terminal capture.
const ansiHtml = text => {
  let html = '', end = 0, color = '#f5f3f0', weight = 400;
  for (const match of text.matchAll(/\x1b\[([0-9;]*)m/g)) {
    html += `<span style="color:${color};font-weight:${weight}">${esc(text.slice(end, match.index))}</span>`;
    const code = match[1];
    if (code.startsWith('38;2;')) color = `rgb(${code.slice(5).split(';').join(',')})`;
    else if (code === '39' || code === '0') color = '#f5f3f0';
    if (code === '1') weight = 700;
    if (code === '22' || code === '0') weight = 400;
    end = match.index + match[0].length;
  }
  return html + esc(text.slice(end));
};
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'worthit-percent-render-'));
try {
  const html = path.join(scratch, 'tui.html'), image = path.join(root, 'docs/symmetric-percent-tui.png');
  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/chromium'].find(f => fs.existsSync(f));
  assert.ok(chrome, 'Chrome/Chromium required for inspected evidence');
  const screenshot = (source, destination, name) => {
    const fresh = path.join(scratch, name + '.png');
    const result = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
      '--disable-sync', '--disable-default-apps', '--metrics-recording-only', '--host-resolver-rules=MAP * ~NOTFOUND',
      '--user-data-dir=' + path.join(scratch, name + '-profile'), '--window-size=1600,900', '--screenshot=' + fresh, 'file://' + source],
    { encoding: 'utf8', timeout: 60000 });
    // Issue #67 is outside this repair: Chrome can exit 2 after writing its PNG.
    // This evidence-only helper accepts only a fresh, correctly sized PNG.
    assert.ok(fs.existsSync(fresh), `no new ${name} PNG: ${result.error || result.stderr}`);
    const png = fs.readFileSync(fresh);
    assert.ok(png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
    assert.equal(png.readUInt32BE(16), 1600); assert.equal(png.readUInt32BE(20), 900);
    fs.copyFileSync(fresh, destination);
    console.log(`${name}: browser exit ${result.status}; fresh PNG validated`);
  };
  const card = path.join(scratch, 'card.html');
  fs.writeFileSync(card, cardHtml(cardSpec('allowance', data)));
  screenshot(card, destination, 'card');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;width:1600px;height:900px;background:#0a0a0c;color:#ddd;font:22px/1.45 Menlo,monospace;padding:44px;box-sizing:border-box}h1{font-size:25px;margin-bottom:20px}pre{margin:0;white-space:pre}section{display:flex;gap:50px}.caption{font-size:17px;line-height:1.7;max-width:650px}</style><h1>Synthetic demo · symmetric weekly allowance changes</h1><section><pre>${ansiHtml(blocks.LimitTrend(data).join('\n'))}</pre><div class="caption">${cases.map((c, i) => `<p>${labels[i]}: $${c.from} → $${c.to}<br>Source change ${c.raw_pct}% → whole-number ${c.pct}%</p>`).join('')}<p>Zero has neutral color and no arrow.<br>Both half values round away from zero.<br>Moved threshold remains strictly greater than 5%.</p></div></section><pre style="margin-top:28px;font-size:17px">${esc(allowanceText(data))}</pre>`);
  screenshot(html, image, 'tui');
  console.log(destination); console.log(image);
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
