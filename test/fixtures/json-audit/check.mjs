// Issue #65: ordinary JSON scans retain evidence without drawing a dashboard.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceCase } from '../../support/source-case.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
sourceCase(folder, ({ expected, tmp, home, bin, env, root, trace }) => {
  env.HOME = fs.realpathSync(home);
  for (const [key, value] of Object.entries(env)) if (value.startsWith(home + path.sep)) env[key] = env.HOME + value.slice(home.length);
  env.FIXTURE_ACCOUNTS = JSON.stringify(['coder-a']);
  env.NODE_OPTIONS += ` --import=${path.join(folder, 'controls.mjs')}`;
  const fileName = expected.get('audit_file'), cli = path.join(root, 'bin/worthit.mjs');
  for (const name of ['open', 'xdg-open', 'osascript', 'wl-copy', 'xclip', 'claude', 'codex', 'omp', 'dsh', 'git']) {
    fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\nimport fs from 'node:fs';fs.appendFileSync(process.env.FIXTURE_TRACE,JSON.stringify({unexpected:${JSON.stringify(name)}})+'\\n');process.exit(86);\n`, { mode: 0o755 });
  }
  const invoke = (args, store, output) => spawnSync(process.execPath, [cli, ...args], {
    cwd: output, env: { ...env, WORTHIT_HOME: store }, input: '', encoding: 'utf8', maxBuffer: 16 << 20, timeout: 30000,
  });
  const activity = (text, calls) => {
    assert.match(text, /  run\s+python3 core\/extract_usage\.py/);
    assert.match(text, /  run\s+python3 core\/weekly\.py/);
    const read = /^\S+  read\s+(~\/\.claude\/projects\/example\/usage\.jsonl)$/m.exec(text)?.[1];
    assert.ok(read, 'session read keeps its private HOME behind a tilde');
    assert.equal(fs.realpathSync(read.replace(/^~(?=\/)/, env.HOME)),
      fs.realpathSync(path.join(home, '.claude/projects/example/usage.jsonl')), 'audit names the actual fixture source');
    assert.match(text, /  run\s+ssh box-b .*core\/extract_usage\.py/);
    assert.match(text, /  read\s+box-b:.*usage\.jsonl/);
    assert.match(text, /  run\s+gh auth status --hostname github\.com/);
    assert.match(text, /  net\s+gh api search\/issues/);
    assert.match(text, /  run\s+.*usagemeter sync --no-publish --budget-secs 20/);
    assert.match(text, /  run\s+.*usagemeter status/);
    assert.ok(calls.some(c => c.command === 'gh' && c.args[0] === 'api'), 'git defaults on, using a synthetic forge');
    assert.ok(calls.some(c => c.command === 'usagemeter' && c.args[0] === 'status'));
    assert.doesNotMatch(text, /headless Chrome|  agent\s|  sent\s/);
    assert.ok(calls.every(c => ['ssh', 'gh', 'usagemeter'].includes(c.command)), 'no UI, AI, clipboard or unstubbed commands');
  };
  const scan = (name, { noFiles = false, failAfterScan = false, blockAudit = false } = {}) => {
    const store = path.join(tmp, name), dir = path.join(home, 'output-' + name);
    fs.mkdirSync(store); fs.mkdirSync(dir);
    const output = fs.realpathSync(dir), auditFile = path.join(output, fileName);
    fs.writeFileSync(path.join(store, 'hosts.json'), JSON.stringify({ selected: ['box-b'], retired: [] }));
    // The real scan and pricing complete; buildData then cannot save history.
    if (failAfterScan) fs.mkdirSync(path.join(store, 'history.json'));
    if (blockAudit) fs.mkdirSync(auditFile);
    const before = trace().length;
    const r = invoke(['--json', ...(noFiles ? ['--no-files'] : [])], store, output), calls = trace().slice(before);
    assert.equal(r.status, failAfterScan || blockAudit ? 1 : 0, r.stderr || r.error || r.stdout);
    if (failAfterScan || blockAudit) {
      assert.equal(r.stdout, '', 'failed scan prints no success JSON');
      if (failAfterScan) assert.match(r.stderr, /EISDIR.*history\.json/, 'failure really follows scan and pricing');
      if (!noFiles) assert.ok(r.stderr.includes(auditFile), 'exit 1 names its absolute audit destination');
      if (blockAudit) {
        assert.match(r.stderr, /could not write audit log/);
        assert.ok(fs.statSync(auditFile).isDirectory());
        return;
      }
    } else {
      const data = JSON.parse(r.stdout);
      assert.equal(data.audit_log, noFiles ? null : auditFile, 'JSON names the matching absolute audit path');
      assert.ok(data.git, 'default scan includes git data');
    }
    if (noFiles) assert.deepEqual(fs.readdirSync(output), [], '--no-files creates no output artifacts');
    else {
      assert.ok(fs.existsSync(auditFile), 'ordinary JSON scan writes its audit');
      const text = fs.readFileSync(auditFile, 'utf8');
      assert.match(text, /^worthit .+ audit log · /);
      activity(text, calls);
      assert.ok(text.includes('  write ~' + auditFile.slice(env.HOME.length)), 'audit records its own write with a private path');
      assert.deepEqual(fs.readdirSync(output), [fileName], 'JSON scan writes only the audit, no Markdown or PNG');
    }
    return { store, data: r.status === 0 ? JSON.parse(r.stdout) : null };
  };
  const complete = scan('complete'); // Fails before the production repair: missing audit_log/file.
  scan('no-files', { noFiles: true });
  scan('post-scan-failure', { failAfterScan: true });
  scan('post-scan-failure-no-files', { failAfterScan: true, noFiles: true });
  scan('audit-write-failure', { blockAudit: true });

  const output = fs.realpathSync(fs.mkdtempSync(path.join(home, 'query-output-'))), beforeQuery = trace().length;
  const query = args => {
    const r = invoke(args, complete.store, output);
    assert.equal(r.status, 0, r.stderr || r.error); return JSON.parse(r.stdout);
  };
  const saved = JSON.parse(fs.readFileSync(path.join(complete.store, 'last.json'), 'utf8'));
  const { worthit, audit_log, ...emitted } = complete.data;
  assert.deepEqual(emitted, saved, 'all scan data stays identical to the saved last run');
  assert.deepEqual(query(['get']), { generated_at: saved.generated_at, sections: Object.keys(saved), hint: 'worthit get <section>, e.g. worthit get plans, worthit get model_mix.series, worthit get plans.0.usd_per_full_week' });
  assert.deepEqual(query(['get', 'totals']), { generated_at: saved.generated_at, totals: complete.data.totals });
  assert.ok(!Object.hasOwn(saved, 'audit_log'), 'scan output metadata does not change the saved data contract');
  const days = query(['days']); assert.ok(Array.isArray(days) && days.length);
  assert.deepEqual(Object.keys(days[0]), ['period', 'api_usd', 'output_tokens', 'requests', 'days', 'merged_prs', 'commits']);
  assert.deepEqual(query(['sql', 'SELECT 1 AS n']), [{ n: 1 }]);
  assert.ok(query(['schema'])['scan.result'].fields.audit_log, 'schema documents the public scan root field');
  assert.deepEqual(fs.readdirSync(output), [], 'queries create no audit or presentation files');
  assert.equal(trace().length, beforeQuery, 'queries perform no scan or external commands');

  const snapshot = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const f = path.join(dir, e.name); return e.isDirectory() ? snapshot(f) : [[f, fs.readFileSync(f)]];
  });
  const beforeDemo = snapshot(complete.store), beforeCalls = trace().length;
  const absent = path.join(tmp, 'absent-demo-store');
  for (const store of [complete.store, absent]) {
    const r = invoke(['--json', '--demo'], store, output);
    assert.equal(r.status, 0, r.stderr || r.error);
    assert.equal(JSON.parse(r.stdout).audit_log, null, 'demo names no audit file');
  }
  assert.deepEqual(snapshot(complete.store), beforeDemo, 'demo preserves the store byte for byte');
  assert.ok(!fs.existsSync(absent), 'demo creates no store');
  assert.equal(trace().length, beforeCalls, 'demo runs no external commands');
  assert.deepEqual(fs.readdirSync(output), [], 'demo creates no files');
});
