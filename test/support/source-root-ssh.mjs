// Pipe-only synthetic SSH. The real SSH executable is never reachable from PATH.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2), env = process.env;
const alias = args.at(-2), command = args.at(-1);
assert.ok(['synthetic-remote', 'synthetic-alias'].includes(alias), 'unscripted SSH alias');
// Parse the trusted bootstrap invocation as data, never run a remote shell.
// This accepts script-stdin today and a fixed -c framed bootstrap in part C.
const parsed = spawnSync(env.SOURCE_ROOT_PYTHON, ['-c', 'import json,shlex,sys; print(json.dumps(shlex.split(sys.argv[1])))', command], {
  env, encoding: 'utf8', timeout: 5000,
});
assert.equal(parsed.status, 0, 'SSH command must be a parseable fixed Python invocation');
const tokens = JSON.parse(parsed.stdout), remoteEnv = {};
if (tokens[0] === 'env') {
  tokens.shift();
  while (tokens[0]?.includes('=')) {
    const [name, ...value] = tokens.shift().split('=');
    assert.ok(['WORTHIT_PROGRESS', 'PYTHONDONTWRITEBYTECODE', 'USAGE_ACCT_SALT', 'WORTHIT_NO_CACHE'].includes(name), 'unscripted remote env');
    remoteEnv[name] = value.join('=');
  }
}
if (tokens[0] === 'nice') tokens.shift();
assert.equal(tokens.shift(), 'python3');
assert.ok(tokens[0] === '-' || (tokens[0] === '-c' && tokens.length >= 2), 'only Python stdin or a fixed bootstrap is permitted');
let input = Buffer.alloc(0);
for await (const chunk of process.stdin) input = Buffer.concat([input, chunk]);
const mode = env.SOURCE_ROOT_TRANSPORT || 'success';
fs.appendFileSync(path.join(env.SOURCE_ROOT_BASE, 'transport.jsonl'), JSON.stringify({ args, mode, bytes: input.length,
  // Private fixture receipts retain stdin so future framing assertions inspect actual bytes.
  input: input.toString('base64'), keyInEnvironment: Object.keys(env).some(key => /source.roots.key/i.test(key)) }) + '\n');
if (mode === 'offline') process.exit(255);
if (mode === 'truncated') { process.stdout.write('{"host":"synthetic-remote"'); process.exit(74); }
if (mode === 'interrupted') { process.stderr.write('synthetic interrupted enumeration\n'); process.exit(75); }
assert.equal(mode, 'success', 'unscripted transport failure');
const home = path.join(env.SOURCE_ROOT_BASE, 'remote-home'), remoteStore = path.join(env.SOURCE_ROOT_BASE, 'remote-store');
fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(remoteStore, { recursive: true });
const result = spawnSync(env.SOURCE_ROOT_PYTHON, tokens, {
  input, encoding: 'utf8', timeout: 15000, maxBuffer: 16 << 20,
  env: { ...env, ...remoteEnv, HOME: home, WORTHIT_HOME: remoteStore, CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    METER_STATE_DIR: path.join(home, '.meter'), XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.local/state'), FIXTURE_MACHINE: 'synthetic-physical-remote' },
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 76);
