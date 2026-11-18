// Issue #140: whole words in YOU, shared by Ink and the dashboard Markdown.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isolatedEnvironment } from '../../support/environment.mjs';
import * as draw from '../../../src/draw.mjs';
import { demoData } from '../../../src/demo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const isolated = isolatedEnvironment(), failures = [], artifacts = process.env.WORTHIT_FIXTURE_ARTIFACTS;
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
};
const save = (name, value) => {
  if (!artifacts) return;
  fs.mkdirSync(artifacts, { recursive: true }); fs.writeFileSync(path.join(artifacts, name), value);
};
const source = fs.readFileSync(path.join(root, 'bin/worthit.mjs'), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `production source boundaries: ${start}`);
  return source.slice(a, b);
};
// Demo intentionally skips files. Exercise the unchanged production spec walker and
// Markdown writer with only filesystem/audit effects and unrelated UI readiness stubbed.
const writers = section('function specLines(spec)', 'function builtin()')
  + section('function ansiHtml(lines)', 'const LOGO =')
  + section('function writeFiles(spec)', '// ---------------------------------------------------------------- UI');
const spec = { root: 'row', elements: { row: { type: 'Row', children: ['you', 'ranking'] },
  you: { type: 'LevelCard', props: {} }, ranking: { type: 'PlanRanking', props: {} } } };
const markdown = data => {
  const files = new Map(), context = vm.createContext({ ...draw, DATA: data, NO_FILES: false,
    VERSION: 'synthetic', STAMP: '2026-11-14', LOGO: [], process: { env: {} },
    ready: value => value, safe: (type, props) => draw.blocks[type](data, props),
    audit() {}, writeAudit() {}, fs: { existsSync: () => false, writeFileSync: (name, value) => files.set(name, value) } });
  vm.runInContext(writers, context);
  context.spec = spec; vm.runInContext('writeFiles(spec)', context);
  return files.get('2026-11-14-worthit.md');
};
const you = text => {
  const lines = text.split('\n'), start = lines.findIndex(line => line.includes('╭─ YOU '));
  assert.ok(start >= 0, 'YOU header present');
  const end = lines.findIndex((line, i) => i > start && line.startsWith('╰'));
  assert.ok(end > start, 'YOU footer present');
  return lines.slice(start, end + 1).map(line => [...line].slice(0, 41).join(''));
};
const words = lines => lines.slice(1, -1).map(line => line.slice(2, -2).trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
try {
  const data = demoData();
  const cases = [
    ['demo', data, '■ Zero Waste badge ($68 still open)'],
    ['all-bests', { ...data, game: { ...data.game, personal_bests: ['most tokens in a week', 'PRs merged in a week', 'lowest cost per PR'] } }, '■ Zero Waste badge ($68 still open)'],
    ['long-away', { ...data, waste: [{ unused_usd: 123456789012, at_risk_usd: 0 }] }, '■ Zero Waste badge ($123,456,789,012 away)'],
    ['long-open', { ...data, waste: [{ unused_usd: 0, at_risk_usd: 123456789012 }] }, '■ Zero Waste badge ($123,456,789,012 still open)'],
    ['earned', { ...data, game: { ...data.game, personal_bests: [] }, waste: [{ unused_usd: 0, at_risk_usd: 0 }] }, '■ Zero Waste badge earned'],
    ['no-weeks', { ...data, game: { ...data.game, personal_bests: [] }, waste: [] }, 'badges unlock as weeks close'],
  ];
  for (const [name, D, badge] of cases) {
    const lines = draw.blocks.LevelCard(D).map(draw.strip), text = words(lines), md = markdown(D);
    save(name + '.txt', lines.join('\n') + '\n'); save(name + '.md', md);
    check(name + ' box geometry', () => assert.ok(lines.every(line => [...line].length === 41)));
    for (const best of D.game.personal_bests) check(name + ' best: ' + best, () => assert.ok(text.includes('★ personal best ' + best), text));
    check(name + ' badge whole words and value', () => assert.ok(text.includes(badge), text));
    check(name + ' Markdown shares complete LevelCard', () => assert.deepEqual(you(md.split('```')[1]), lines));
  }
  const cli = spawnSync(process.execPath, [path.join(root, 'bin/worthit.mjs'), '--demo', '--git', 'yes', '--ai', 'no'],
    { cwd: isolated.tmp, env: { ...isolated.env, COLUMNS: '120', LINES: '40', NODE_OPTIONS: `--import=${path.join(root, 'test/support/clock.mjs')}` },
      encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
  assert.ifError(cli.error); assert.equal(cli.status, 0, cli.stderr);
  save('demo-cli.txt', draw.strip(cli.stdout));
  check('actual demo Ink shares complete LevelCard', () => assert.deepEqual(you(draw.strip(cli.stdout)), draw.blocks.LevelCard(data).map(draw.strip)));
  check('actual demo Ink best and badge whole words', () => {
    const text = words(you(draw.strip(cli.stdout)));
    assert.ok(text.includes('★ personal best most tokens in a week'), text);
    assert.ok(text.includes('■ Zero Waste badge ($68 still open)'), text);
  });
  check('#130 floor and empty ranking controls', () => {
    const trend = draw.blocks.LimitTrend(data).map(draw.strip).join('\n');
    for (const plan of data.plans.filter(plan => plan.proof === 'floor'))
      assert.ok(trend.includes(plan.plan.replace(' AI', '').padEnd(13) + draw.usd(plan.usd_per_full_week) + '  floor'));
    const ranking = draw.blocks.PlanRanking({ ...data, plans: [] }).map(draw.strip);
    const text = ranking.slice(1, -1).map(line => line.slice(2, -2).trim()).join(' ').replace(/\s+/g, ' ');
    assert.ok(text.includes('A plan is ranked once its weekly meter runs to the cap, or closes, inside the scanned days.'));
  });
  assert.equal(fs.existsSync(isolated.env.WORTHIT_HOME), false, 'demo never creates a store');
} finally { isolated.cleanup(); }
assert.deepEqual(failures, [], 'YOU whole-word regressions');
