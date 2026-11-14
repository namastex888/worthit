// Synthetic source answers; every invocation is recorded, including failed discovery.
import fs from 'node:fs';
const [command, ...args] = process.argv.slice(2), env = process.env;
const mode = fs.readFileSync(env.FIXTURE_MODE, 'utf8').trim();
fs.appendFileSync(env.FIXTURE_TRACE, JSON.stringify({ command, args }) + '\n');
const fail = () => process.exit(1);
const unexpected = () => { fs.appendFileSync(env.FIXTURE_TRACE, '"unexpected"\n'); process.exit(86); };
if (command === 'usagemeter') {
  if (args.join(' ') === 'sync --no-publish --budget-secs 20') { if (mode === 'meter-sync') fail(); }
  else if (args.join(' ') === 'status') {
    if (mode === 'meter-status') { console.log(JSON.stringify({ state_dir: env.METER_STATE_DIR })); fail(); }
    console.log(JSON.stringify({ version: 'fixture', state_dir: env.METER_STATE_DIR }));
  } else unexpected();
} else if (command === 'git') {
  if (args[0] !== '-C' || args.slice(2).join(' ') !== 'log --all --since=14 days ago --format=%H %ct') unexpected();
  if (mode === 'git-log') fail();
  if (mode !== 'empty') console.log('commit-a 1794322800\ncommit-b 1794322800'); // Nov 10, 15:00 UTC
} else if (command === 'gh') {
  if (args.join(' ') === 'auth status --hostname github.com') {
    if (mode === 'gh-discovery') fail();
    console.log('Logged in to github.com account coder-a\n  - Active account: true\nLogged in to github.com account coder-b\n  - Active account: false');
  } else if (args[0] === 'api' && args.includes('search/issues')) {
    if (!args.some(x => /^q=is:pr is:merged author:(coder-a|coder-b|@me) merged:/.test(x))) unexpected();
    if (mode === 'gh-account' && args.some(x => x.includes('author:coder-b '))) fail();
  } else unexpected();
} else if (command === 'glab') {
  if (args.join(' ') === 'auth status') {
    if (mode === 'glab-discovery') fail();
    console.log('forge-a.test\n  Logged in to forge-a.test\nforge-b.test\n  Logged in to forge-b.test');
  } else if (args[0] === 'api' && args[1] === '--hostname' && ['forge-a.test', 'forge-b.test'].includes(args[2]) && args[3].startsWith('merge_requests?scope=created_by_me&state=merged&updated_after=')) {
    if (mode === 'glab-host' && args[2] === 'forge-b.test') fail();
    console.log('[]');
  } else unexpected();
} else if (command === 'tea') {
  if (args[0] !== 'api' || !args[1].startsWith('/repos/issues/search?type=pulls&state=closed&created=true&since=')) unexpected();
  if (mode === 'tea') fail();
  console.log('[]');
} else unexpected();
