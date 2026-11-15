// Synthetic source answers; every invocation is recorded, including failed discovery.
import fs from 'node:fs';
const [command, ...args] = process.argv.slice(2), env = process.env;
const mode = fs.readFileSync(env.FIXTURE_MODE, 'utf8').trim();
const authEnv = command === 'glab' && args.join(' ') === 'auth status'
  ? { GLAB_CHECK_UPDATE: env.GLAB_CHECK_UPDATE, GLAB_SHOW_WHATS_NEW: env.GLAB_SHOW_WHATS_NEW } : null;
fs.appendFileSync(env.FIXTURE_TRACE, JSON.stringify({ command, args, ...(authEnv ? { authEnv } : {}) }) + '\n');
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
  if (env.FIXTURE_DELIVERY && mode !== 'empty') console.log('commit-prev 1793718000');
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
    if (env.FIXTURE_DELIVERY && args.some(x => x.includes('author:coder-a '))) {
      const range = args.find(x => x.startsWith('q=')).match(/merged:(\S+)\.\.(\S+)/);
      for (const [date, count, prefix] of [['2026-11-10', 10, 'feat'], ['2026-11-03', 5, 'feat'], ['2026-11-10', 2, 'fix'], ['2026-11-03', 1, 'fix']]) {
        if (date < range[1].slice(0, 10) || date > range[2].slice(0, 10)) continue;
        for (let i = 0; i < count; i++) console.log(`https://api.github.com/repos/example/delivery\t${Number(date.slice(-2)) * 1000 + (prefix === 'feat' ? 0 : 100) + i}\t${date}T15:00:00Z\t${prefix}: synthetic delivery`);
      }
    }
  } else unexpected();
} else if (command === 'glab') {
  if (args.join(' ') === 'auth status') {
    if (authEnv.GLAB_CHECK_UPDATE !== 'false' || authEnv.GLAB_SHOW_WHATS_NEW !== 'false') unexpected();
    if (mode === 'glab-discovery') fail();
    if (mode === 'glab-malformed') { console.log('unrecognized inventory'); process.exit(0); }
    const hostModes = ['glab-ip', 'glab-port', 'glab-digit-tld', 'glab-bare', 'glab-localhost', 'glab-error-host', 'glab-malformed-before', 'glab-malformed-after', 'glab-orphan-body', 'glab-unreadable-body', 'glab-empty-block', 'glab-partial-errors', 'glab-footer'];
    if (hostModes.includes(mode)) {
      const text = fs.readFileSync(new URL(mode + '.txt', import.meta.url), 'utf8');
      // Exercise both streams; glab itself normally prints text status to stderr.
      (mode === 'glab-port' ? process.stdout : process.stderr).write(text);
      if (['glab-malformed-before', 'glab-malformed-after', 'glab-orphan-body', 'glab-unreadable-body', 'glab-empty-block', 'glab-partial-errors'].includes(mode)) fail();
      process.exit(0);
    }
    const file = mode === 'logged-out' ? 'glab-logged-out.txt' : mode === 'glab-self-hosted' ? 'glab-self-hosted.txt' : mode === 'glab-auth-error' ? 'glab-auth-error.txt' : mode === 'glab-no-instances' ? 'glab-no-instances.txt' : 'glab-authenticated.txt';
    process.stderr.write(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
    if (file !== 'glab-authenticated.txt') fail();
  } else if (args[0] === 'api' && args[1] === '--hostname') {
    // glab 1.123.0 validates --hostname before constructing any client/request.
    if (args[2].includes(':') || args[2].includes('/')) { console.error('Error parsing --hostname: invalid hostname.'); fail(); }
    if (!['forge-a.test', 'forge-b.test', '10.0.0.5', 'gitlab.k8s', 'gitlab', 'ERROR'].includes(args[2]) || !args[3].startsWith('merge_requests?scope=created_by_me&state=merged&updated_after=')) unexpected();
    if (mode === 'glab-host' && args[2] === 'forge-b.test') fail();
    const rows = JSON.parse(fs.readFileSync(new URL('glab-merge-requests.json', import.meta.url), 'utf8'));
    console.log(JSON.stringify(rows[args[2]] || []));
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
