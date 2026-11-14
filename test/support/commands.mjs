// Deterministic external commands. Unknown invocations fail closed and leave a trace.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [command, ...args] = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.FIXTURE_TRACE, JSON.stringify({ command, args }) + '\n');
const die = message => { fs.appendFileSync(env.FIXTURE_TRACE, JSON.stringify({ unexpected: message }) + '\n'); console.error(message); process.exit(86); };
if (command === 'ssh') {
  if (args.at(-2) !== 'box-b' || !/^env .*python3 - \d+$/.test(args.at(-1))) die('unexpected fixture SSH arguments');
  let script = ''; for await (const chunk of process.stdin) script += chunk;
  if (env.FIXTURE_OFFLINE === '1') process.exit(255);
  const home = path.join(env.FIXTURE_TMP, 'box-b');
  const r = spawnSync(env.FIXTURE_PYTHON, ['-', args.at(-1).split(' ').at(-1)], {
    input: script, encoding: 'utf8', maxBuffer: 16 << 20,
    env: { ...env, HOME: home, CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      METER_STATE_DIR: path.join(home, '.meter'), XDG_STATE_HOME: path.join(home, '.local/state'), FIXTURE_MACHINE: 'box-b' },
  });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); process.exit(r.status ?? 1);
} else if (command === 'usagemeter') {
  if (args[0] === 'sync') process.exit(0);
  if (args[0] === 'status') console.log(JSON.stringify({ version: 'fixture', state_dir: env.METER_STATE_DIR }));
  else die('unexpected fixture meter command');
} else if (command === 'gh') {
  if (args.join(' ') === 'auth status --hostname github.com') {
    for (const [i, account] of JSON.parse(env.FIXTURE_ACCOUNTS).entries()) console.log(`Logged in to github.com account ${account}\n  - Active account: ${i === 0}`);
  } else if (args[0] === 'api' && args.includes('search/issues')) {
    const query = args.find(a => a.startsWith('q=')) || '', author = /author:(\S+)/.exec(query)?.[1], range = /merged:(\S+)\.\.(\S+)/.exec(query);
    if (!range || !JSON.parse(env.FIXTURE_ACCOUNTS).includes(author)) die('unexpected fixture code-host query');
    const rows = JSON.parse(fs.readFileSync(path.join(env.FIXTURE_SOURCES, 'pull-requests.json'), 'utf8'));
    for (const r of rows) if (r.author === author && r.merged_at >= range[1] && r.merged_at <= range[2]) console.log(`https://api.github.com/repos/example-lab/${r.repo}\t${r.number}\t${r.merged_at}\t${r.title}`);
  } else die('unexpected fixture gh command');
} else die('unexpected fixture command: ' + command);
