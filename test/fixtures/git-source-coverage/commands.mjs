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
    console.log(JSON.stringify({ version: 'fixture', state_dir: env.METER_STATE_DIR, pending_bytes: mode === 'meter-budget' ? 1 : 0, pending_files: mode === 'meter-budget' ? 1 : 0 }));
  } else unexpected();
} else if (command === 'git') {
  if (args[0] !== '-C' || args.slice(2).join(' ') !== 'log --all --since=14 days ago --format=%H %ct') unexpected();
  if (!fs.existsSync(args[1])) unexpected();
  if (mode === 'git-log') fail();
  if (mode !== 'empty') console.log('commit-a 1794322800\ncommit-b 1794322800'); // Nov 10, 15:00 UTC
} else if (command === 'gh') {
  if (args.join(' ') === 'auth status --hostname github.com') {
    if (mode === 'gh-discovery') fail();
    if (mode === 'gh-malformed') { console.log('unrecognized inventory'); process.exit(0); }
    if (mode === 'logged-out') { console.error('You are not logged into any GitHub hosts. Run gh auth login.'); fail(); }
    if (mode === 'gh-legacy') { console.log('Logged in to github.com as coder-a (keyring)'); process.exit(0); }
    console.log('Logged in to github.com account coder-a\n  - Active account: true\nLogged in to github.com account coder-b\n  - Active account: false');
    if (mode === 'gh-auth-error') fail();
  } else if (args[0] === 'api' && args.includes('search/issues')) {
    if (!args.some(x => /^q=is:pr is:merged author:(coder-a|coder-b|@me) merged:/.test(x))) unexpected();
    if (mode === 'gh-account' && args.some(x => x.includes('author:coder-b '))) fail();
  } else unexpected();
} else if (command === 'glab') {
  if (args.join(' ') === 'auth status') {
    if (mode === 'glab-discovery') fail();
    if (mode === 'glab-malformed') { console.log('unrecognized inventory'); process.exit(0); }
    if (mode === 'logged-out') { console.error('You are not logged into any GitLab hosts. Run glab auth login to authenticate.'); fail(); }
    console.log('forge-a.test\n  Logged in to forge-a.test\nforge-b.test\n  Logged in to forge-b.test');
    if (mode === 'glab-auth-error') fail();
  } else if (args[0] === 'api' && args[1] === '--hostname' && ['forge-a.test', 'forge-b.test'].includes(args[2]) && args[3].startsWith('merge_requests?scope=created_by_me&state=merged&updated_after=')) {
    if (mode === 'glab-host' && args[2] === 'forge-b.test') fail();
    console.log('[]');
  } else unexpected();
} else if (command === 'tea') {
  if (args.join(' ') === 'login list --output json') {
    if (mode === 'tea-discovery') fail();
    if (mode === 'tea-malformed') { console.log('[{}]'); process.exit(0); }
    console.log(mode === 'logged-out' ? '[]' : '[{"name":"fixture","url":"https://forge-c.test","user":"coder-c"}]');
    process.exit(0);
  }
  if (args[0] !== 'api' || !args[1].startsWith('/repos/issues/search?type=pulls&state=closed&created=true&since=')) unexpected();
  if (mode === 'tea') fail();
  if (mode === 'tea-partial') { if (args[1].endsWith('page=2')) fail(); console.log(JSON.stringify(Array(50).fill({}))); process.exit(0); }
  console.log('[]');
} else unexpected();
