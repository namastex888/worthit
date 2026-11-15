// Issue #35: assertions inspect actual CLI/Ink output, never the block string generator.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../../support/environment.mjs';

const fixture = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixture, '../../..');
const isolated = isolatedEnvironment();
const artifacts = process.env.WORTHIT_FIXTURE_ARTIFACTS;
const errors = [], statuses = [];
const strip = s => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
const compact = s => s.replace(/\s/g, '');
function check(name, columns, retained) {
  const env = { ...isolated.env, NODE_OPTIONS: `--import=${path.join(fixture, 'cli-env.mjs')}`,
    // Static terminal-size fallback, independent of the invoking terminal's /dev/tty.
    COLUMNS: '80', LINES: '24', FIXTURE_RETAINED: retained ? '1' : '0' };
  if (columns) env.FIXTURE_COLUMNS = String(columns);
  const r = spawnSync(process.execPath, [path.join(root, 'bin/worthit.mjs'), '--demo', '--git', 'no', '--ai', 'no'],
    { cwd: isolated.tmp, env, encoding: 'utf8', timeout: 25000, maxBuffer: 16 << 20 });
  const output = strip(r.stdout || '');
  statuses.push({ name, cli_exit: r.status, signal: r.signal, columns: columns || 'pipe (80 fallback)' });
  if (artifacts) { fs.mkdirSync(artifacts, { recursive: true }); fs.writeFileSync(path.join(artifacts, name + '.txt'), output); }
  const verify = (label, fn) => { try { fn(); } catch (e) { errors.push(`${name}: ${label}: ${e.message}`); } };
  verify('CLI status', () => assert.equal(r.status, 0, r.stderr || String(r.error || r.signal || '')));
  const lines = output.split('\n');
  const section = (start, end) => { const a = lines.findIndex(l => l.includes(start)); const b = lines.findIndex((l, i) => i > a && l.includes(end)); return lines.slice(a, b).join('\n'); };
  const waste = compact(section('SUBSCRIPTION WASTE', 'MONTH BY MONTH'));
  for (const [label, tokens] of [
    ['Google account and unused value', ['GoogleAIUltra', '$120', retained ? '80%' : '100%', retained ? '$24' : '$0', retained ? 'spentless' : 'hitthecap']],
    ['Claude account and unused value', ['ClaudeUltra', '$640', '100%', '$0', 'hitthecap']],
    ['Codex account and open allowance', ['ChatGPTPro200(×2)', '$310', '78%', '$0', '$68left(1open)']],
    ['Total unused', ['Totalunused', retained ? '$24' : '$0']],
  ]) verify(label, () => assert.ok(waste.includes(tokens.join('')) || new RegExp(tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^A-Za-z0-9$%]*')).test(waste), `missing ${tokens.join(' / ')}`));
  verify('waste closing footer', () => assert.match(waste, /╰─+╯$/));
  const months = compact(section('MONTH BY MONTH', 'MODEL MIX'));
  verify('month closing footer and later data', () => { assert.ok(months.includes('2026-11')); assert.match(months, /╰─+╯$/); });
  const heat = section('WHEN YOU WORKED', 'SUBSCRIPTION WASTE');
  verify('heatmap footer and later legend', () => { assert.ok(heat.includes('quiet Sun')); assert.match(heat, /╰─+╯/); });
  verify('later events', () => assert.ok(output.includes('EVENTS THIS WEEK') && output.includes('Gemini 4 Hydrogen launch')));
  verify('width notice', () => assert.equal(/98 columns.*wrap/i.test(output), !columns || columns < 98));
  if (retained) verify('retained lower-bound reason and legend', () => {
    assert.ok(output.includes('box-z: kept 1 older day'), 'machine reason vanished');
    assert.ok(output.includes('floor') && output.includes('value ≥ shown'), 'proof legend vanished');
  });
}
try {
  check('demo-80', 80, false);
  check('demo-120', 120, false);
  check('demo-pipe', undefined, false);
  check('retained-80', 80, true);
  check('retained-120', 120, true);
  check('retained-pipe', undefined, true);
  if (artifacts) fs.writeFileSync(path.join(artifacts, 'cli-status.json'), JSON.stringify(statuses, null, 2) + '\n');
  for (const s of statuses) console.log(`${s.name}: CLI exit ${s.cli_exit}`);
  assert.equal(errors.length, 0, '\n' + errors.join('\n'));
  console.log('dashboard-lines: actual CLI rows, numbers, footers, later lines and retained-machine reason preserved');
} finally { isolated.cleanup(); }
