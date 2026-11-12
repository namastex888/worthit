// worthit collectors: scan local logs (bundled Python core), price and read the weekly meters, git activity
// (GitHub search + the usagemeter store), then shape everything into the one DATA object the dashboard draws.
// Everything read, run, fetched or written is recorded in AUDIT.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { C } from './draw.mjs';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const HOME = process.env.WORTHIT_HOME || path.join(os.homedir(), '.worthit');
export const tilde = p => String(p).startsWith(os.homedir()) ? '~' + String(p).slice(os.homedir().length) : String(p);
export const AUDIT = [];
export const audit = (kind, text) => { AUDIT.push(new Date().toISOString() + '  ' + kind.padEnd(5) + ' ' + text); };
export const has = c => spawnSync('which', [c], { stdio: 'ignore' }).status === 0;
const H = 3600e3, DAY = 24 * H;
const LANE = 'https://github.com/automagik-dev/automagik/releases/download/meter-lane/meter.json';

// ---------------------------------------------------------------- other machines: the ssh hosts already saved on this computer
export function sshHosts() {             // aliases from ~/.ssh/config and its Include files; nothing is contacted here
  const dir = path.join(os.homedir(), '.ssh'), seen = new Set(), out = [];
  const read = (file, depth) => {
    if (depth > 4 || seen.has(file)) return; seen.add(file);
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    let cur = null; const flush = () => { if (cur) out.push(cur); cur = null; };
    for (const raw of text.split('\n')) {
      const l = raw.trim(); if (!l || l.startsWith('#')) continue;
      const sp = l.search(/[\s=]/), k = (sp < 0 ? l : l.slice(0, sp)).toLowerCase(), v = sp < 0 ? '' : l.slice(sp + 1).replace(/^[\s=]+/, '').trim();
      if (k === 'include') { for (const pat of v.split(/\s+/)) { const p = pat.replace(/^~/, os.homedir()), abs = path.isAbsolute(p) ? p : path.join(dir, p);
        if (!abs.includes('*')) { read(abs, depth + 1); continue; }
        const d = path.dirname(abs), re = new RegExp('^' + path.basename(abs).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        let names = []; try { names = fs.readdirSync(d); } catch {} names.filter(n => re.test(n)).sort().forEach(n => read(path.join(d, n), depth + 1)); } }
      else if (k === 'host') { flush(); cur = { names: v.split(/\s+/).filter(Boolean), hostname: '', user: '' }; }
      else if (k === 'match') flush();
      else if (cur && k === 'hostname') cur.hostname = v; else if (cur && k === 'user') cur.user = v;
    }
    flush();
  };
  read(path.join(dir, 'config'), 0);
  const forge = /(github|gitlab|bitbucket|gitea|codeberg|sourcehut|dev\.azure)/i, res = [];
  for (const b of out) { if (b.user === 'git' || forge.test(b.hostname)) continue;
    for (const n of b.names) if (!/[*?!]/.test(n) && !forge.test(n) && !res.some(x => x.alias === n)) res.push({ alias: n, hostname: b.hostname || n }); }
  return res;
}
const HOSTS_FILE = path.join(HOME, 'hosts.json');
export const savedHosts = () => { try { const known = new Set(sshHosts().map(x => x.alias)); return JSON.parse(fs.readFileSync(HOSTS_FILE, 'utf8')).selected.filter(a => known.has(a)); } catch { return null; } };
export const saveHosts = sel => { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(HOSTS_FILE, JSON.stringify({ selected: sel })); audit('write', tilde(HOSTS_FILE) + `  (${sel.length} machines remembered)`); };

// ---------------------------------------------------------------- step 1: scan
const SPAN = { claude: [0, .68], codex: [.68, .97], antigravity: [.97, 1] }, TOOL = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' };
export async function scan(cfg, on) {
  const py = ['python3', 'python'].find(has);
  if (!py) throw new Error('Python 3 is needed for the log scanner. macOS: xcode-select --install · Linux: install python3 with your package manager.');
  const runDir = path.join(HOME, 'run'); fs.rmSync(runDir, { recursive: true, force: true }); fs.mkdirSync(runDir, { recursive: true });
  const script = path.join(ROOT, 'core', 'extract_usage.py'), counts = { claude: 0, codex: 0, antigravity: 0 };
  const cache = path.join(HOME, 'run-counts.json'), keepDir = path.join(HOME, 'run-keep');
  if (process.env.WORTHIT_REUSE && fs.existsSync(path.join(keepDir, 'local.json'))) { fs.cpSync(keepDir, runDir, { recursive: true }); audit('note', 'WORTHIT_REUSE: using the previous scan'); return { runDir, counts: JSON.parse(fs.readFileSync(cache, 'utf8')), hosts: [] }; }
  const names = cfg.hosts || [], pcts = { local: 0 }; names.forEach(a => { pcts[a] = 0; });
  const emit = detail => { const v = Object.values(pcts); on({ pct: v.reduce((a, b) => a + b, 0) / v.length, detail, counts }); };
  audit('run', `${py} core/extract_usage.py ${cfg.days}   (reads local session logs, read-only)`);
  const local = new Promise((res, rej) => {
    const p = spawn(py, [script, String(cfg.days)], { env: { ...process.env, WORTHIT_PROGRESS: '1', PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.pipe(fs.createWriteStream(path.join(runDir, 'local.json')));
    let buf = '', errs = '';
    p.stderr.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.startsWith('@f\t')) { errs += l + '\n'; continue; }
      const [, tool, a, b, file] = l.split('\t'); counts[tool] = (counts[tool] || 0) + 1; audit('read', tilde(file));
      const [lo, hi] = SPAN[tool] || [0, 1]; pcts.local = +b > 0 ? lo + (hi - lo) * (+a / +b) : lo; emit(`${names.length ? 'this machine · ' : ''}${TOOL[tool] || tool} · ${tilde(file)}`); } });
    p.on('error', rej); p.on('close', code => { pcts.local = 1; code ? rej(new Error('scanner failed: ' + (errs.trim().split('\n').pop() || 'exit ' + code))) : res(); });
  });
  const remote = (cfg.hosts || []).map(alias => new Promise(res => {      // other machines over ssh: the same script, piped in, nothing installed there
    audit('run', `ssh ${alias} "nice python3 - ${cfg.days}" < core/extract_usage.py   (same read-only scanner, piped in; nothing is installed there)`);
    const p = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', alias, `env WORTHIT_PROGRESS=1 PYTHONDONTWRITEBYTECODE=1 nice python3 - ${cfg.days}`], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', files = 0;
    p.stderr.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.startsWith('@f\t')) continue;
      const [, tool, a, b, file] = l.split('\t'); files++; audit('read', alias + ':' + file);
      const [lo, hi] = SPAN[tool] || [0, 1]; pcts[alias] = +b > 0 ? lo + (hi - lo) * (+a / +b) : lo; emit(`${alias} · ${TOOL[tool] || tool} · ${file}`); } });
    const f = path.join(runDir, alias + '.json'); p.stdout.pipe(fs.createWriteStream(f)); fs.createReadStream(script).pipe(p.stdin);
    p.stdin.on('error', () => {}); p.on('error', () => { pcts[alias] = 1; res({ alias, ok: false, files: 0 }); });
    p.on('close', code => { const ok = !code && fs.existsSync(f) && fs.statSync(f).size > 2; if (!ok) fs.rmSync(f, { force: true }); pcts[alias] = 1; audit('run', `ssh ${alias} finished: ${ok ? files + ' files read' : 'no data (exit ' + code + ')'}`); emit(`${alias} · ${ok ? 'done' : 'no answer'}`); res({ alias, ok, files }); });
  }));
  await local; const hosts = await Promise.all(remote);
  // two ssh aliases can point at one machine: keep the first answer, drop the repeat so nothing is counted twice
  const hostOf = f => { try { const fd = fs.openSync(f, 'r'), b = Buffer.alloc(400); fs.readSync(fd, b, 0, 400, 0); fs.closeSync(fd); return (/"host"\s*:\s*"([^"]*)"/.exec(b.toString()) || [])[1] || null; } catch { return null; } };
  const seenHost = new Map([[hostOf(path.join(runDir, 'local.json')), 'this machine']]);
  for (const x of hosts) { if (!x.ok) continue; const f = path.join(runDir, x.alias + '.json'), hn = hostOf(f);
    if (hn && seenHost.has(hn)) { x.same_as = seenHost.get(hn); x.ok = false; fs.rmSync(f, { force: true }); audit('note', `${x.alias} is the same machine as ${x.same_as} (${hn}): its copy is dropped`); } else if (hn) seenHost.set(hn, x.alias); }
  on({ pct: 1, detail: 'done', counts });
  fs.writeFileSync(cache, JSON.stringify(counts)); fs.cpSync(runDir, keepDir, { recursive: true, force: true });
  return { runDir, counts, hosts };
}

// ---------------------------------------------------------------- step 2: price every request, read the weekly meters
export async function analyse(runDir) {
  const py = ['python3', 'python'].find(has);
  audit('run', `${py} core/weekly.py ${tilde(runDir)}   (prices requests at API list rates, reads the weekly meters)`);
  const r = spawnSync(py, [path.join(ROOT, 'core', 'weekly.py'), runDir], { env: { ...process.env, WORTHIT_OUT: HOME }, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status) throw new Error('pricing failed: ' + String(r.stderr).trim().split('\n').pop());
  const wk = path.join(HOME, 'weeks'), dir = fs.readdirSync(wk).filter(x => /^\d{4}-/.test(x)).sort().pop();
  const f = path.join(wk, dir, 'report.json'); audit('write', tilde(f));
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// ---------------------------------------------------------------- step 3: git activity
async function meterBin(on) {
  for (const c of [spawnSync('which', ['usagemeter'], { encoding: 'utf8' }).stdout.trim(), path.join(os.homedir(), '.local/bin/usagemeter'), path.join(HOME, 'bin', 'usagemeter')]) if (c && fs.existsSync(c)) return { bin: c, downloaded: false };
  // not installed: take the build the signed meter lane points to, and check its sha256 before running it
  on({ pct: .05, detail: 'downloading usagemeter (Automagik\'s open-source token meter)' });
  audit('net', 'GET ' + LANE);
  const lane = await (await fetch(LANE)).json();
  const key = `${process.platform}-${process.arch === 'arm64' ? (process.platform === 'darwin' ? 'arm64' : 'aarch64') : 'x86_64'}`, a = lane.assets && lane.assets[key];
  if (!a) throw new Error('no usagemeter build for ' + key);
  audit('net', 'GET ' + a.url); const buf = Buffer.from(await (await fetch(a.url)).arrayBuffer());
  const sum = crypto.createHash('sha256').update(buf).digest('hex'); if (sum !== a.sha256) throw new Error('usagemeter download failed its checksum');
  const bin = path.join(HOME, 'bin', 'usagemeter'); fs.mkdirSync(path.dirname(bin), { recursive: true }); fs.writeFileSync(bin, buf, { mode: 0o755 });
  audit('write', `${tilde(bin)}  (usagemeter ${lane.version}, sha256 ${sum.slice(0, 16)}… verified)`);
  return { bin, downloaded: true, version: lane.version };
}
export async function git(cfg, on) {
  const since = Date.now() - 14 * DAY, prs = new Map(), commits = new Map(), src = { github: 0, meter: 0 }; let repos = 0, meter = null;
  try {
    meter = await meterBin(on);
    on({ pct: .15, detail: 'usagemeter sync · reading new usage into its local store' });
    audit('run', `${tilde(meter.bin)} sync --no-publish --budget-secs 20`);
    spawnSync(meter.bin, ['sync', '--no-publish', '--budget-secs', '20'], { timeout: 90000, stdio: 'ignore' });
    const st = JSON.parse(spawnSync(meter.bin, ['status'], { encoding: 'utf8', timeout: 20000 }).stdout); meter.version = meter.version || st.version;
    const db = path.join(st.state_dir, 'meter.db'); audit('read', tilde(db) + '  (tables pr, cwd_repo; read-only)');
    const { DatabaseSync } = await import('node:sqlite'); const d = new DatabaseSync(db, { readOnly: true });
    for (const r of d.prepare('select repo, pr, merged_ms from pr where merged_ms >= ?').all(since)) { const k = (r.repo + '#' + r.pr).toLowerCase(); if (!prs.has(k)) { prs.set(k, r.merged_ms); src.meter++; } }
    const seen = new Set(), dirs = [];
    for (const r of d.prepare('select repo, cwd from cwd_repo where repo is not null order by checked_ms desc').all()) { if (seen.has(r.repo) || !fs.existsSync(r.cwd)) continue; seen.add(r.repo); dirs.push(r.cwd); }
    d.close(); repos = dirs.length;
    dirs.forEach((cwd, i) => { on({ pct: .3 + .4 * i / Math.max(1, dirs.length), detail: 'git log · ' + tilde(cwd) }); audit('run', `git -C ${tilde(cwd)} log --all --since="14 days ago" --format="%H %ct"`);
      const o = spawnSync('git', ['-C', cwd, 'log', '--all', '--since=14 days ago', '--format=%H %ct'], { encoding: 'utf8', timeout: 8000, maxBuffer: 64 << 20 }).stdout || '';
      for (const l of o.split('\n')) { const [hh, ct] = l.split(' '); if (hh && ct) commits.set(hh, +ct * 1000); } });
  } catch (e) { audit('note', 'usagemeter not used: ' + e.message); }
  if (has('gh')) {                                             // GitHub: PRs you authored that merged in the last 14 days
    on({ pct: .75, detail: 'GitHub · your merged pull requests (gh search)' });
    const day = new Date(since).toISOString().slice(0, 10); audit('run', `gh api search/issues q="is:pr is:merged author:@me merged:>=${day}" --paginate`); audit('net', 'api.github.com/search/issues (through your gh login)');
    const o = spawnSync('gh', ['api', '-X', 'GET', 'search/issues', '-f', `q=is:pr is:merged author:@me merged:>=${day}`, '-f', 'per_page=100', '--paginate', '-q', '.items[] | [.repository_url, .number, .pull_request.merged_at] | @tsv'], { encoding: 'utf8', timeout: 90000, maxBuffer: 64 << 20 });
    for (const l of (o.stdout || '').split('\n')) { const [url, n, at] = l.split('\t'); if (!url || !at) continue; const k = ('github.com/' + url.split('/repos/')[1] + '#' + n).toLowerCase(); if (!prs.has(k)) src.github++; prs.set(k, Date.parse(at)); }
  } else audit('note', 'gh CLI not found: GitHub PRs not counted');
  on({ pct: 1, detail: 'done' });
  return { prs: [...prs.values()], commits: [...commits.values()], repos, src, meter: meter && { version: meter.version, downloaded: meter.downloaded } };
}

// ---------------------------------------------------------------- shape the data the dashboard draws
const PLAN = { claude: { plan: 'Claude Ultra', tool: 'Claude Code', color: C.cl }, google: { plan: 'Google AI Ultra', tool: 'Antigravity', color: C.go }, codex: { plan: 'ChatGPT Pro', tool: 'Codex', color: C.cx } };
const isoWeek = t => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() + 6) % 7); const y = d.getUTCFullYear(), w1 = new Date(Date.UTC(y, 0, 4)); return y + '-W' + String(1 + Math.round(((d - w1) / DAY - 3 + (w1.getUTCDay() + 6) % 7) / 7)).padStart(2, '0'); };
const pctChange = (a, b) => b > 0 ? Math.round(100 * (a - b) / b) : null;
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const TITLES = ['Apprentice', 'Builder', 'Shipper', 'Operator', 'Conductor', 'Maestro', 'Orchestrator', 'Architect', 'Fleet Admiral'];
const models = mix => Object.entries(mix || {}).slice(0, 2).map(([k, v]) => `${k.replace('claude-', '').replace('gpt-', 'GPT-')} ${Math.round(v * 100)}%`).join(', ');
const ft = n => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e3) + 'K';

export function buildData(report, g, cfg, scanInfo) {
  const now = Date.now(), w1 = now - 7 * DAY, w0 = now - 14 * DAY;
  const act = (report.activity || []).map(a => ({ ...a, t: Date.parse(a.hour + ':00:00Z') }));
  const cur = act.filter(a => a.t >= w1), prev = act.filter(a => a.t >= w0 && a.t < w1), sum = (rows, f) => rows.reduce((s, a) => s + (a[f] || 0), 0);
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const days = Array.from({ length: 7 }, (_, i) => d0.getTime() - (6 - i) * DAY), di = t => Math.floor((t - days[0]) / DAY);
  const perDay = (rows, f) => { const o = Array(7).fill(0); for (const a of rows) { const i = di(a.t); if (i >= 0 && i < 7) o[i] += a[f] || 0; } return o; };
  const names = days.map(t => new Date(t).toLocaleDateString('en-US', { weekday: 'short' }));
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0)); for (const a of act) { const i = di(a.t); if (i >= 0 && i < 7) heat[i][new Date(a.t).getHours()] += a.output || 0; }
  let pk = [0, 0, 0]; heat.forEach((r, i) => r.forEach((v, hh) => { if (v > pk[2]) pk = [i, hh, v]; })); const dsum = heat.map(r => r.reduce((s, v) => s + v, 0)), quiet = dsum.indexOf(Math.min(...dsum));

  // plans: this week's measured value of one full weekly limit
  const hs = scanInfo.hosts || [], allMachines = hs.length ? hs.every(x => x.ok || x.same_as) : !sshHosts().length;   // saved ssh machines left out = use elsewhere may be missing
  let ledger = []; try { ledger = fs.readFileSync(path.join(HOME, 'weeks', 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { /* first run */ }
  const plans = [];
  for (const key of ['claude', 'google', 'codex']) {
    const w = report.this_week && report.this_week[key]; if (!w || !w.usd_per_full_week) continue;
    const byWeek = {}; for (const r of ledger) if (r.provider === key && r.quality === 'clean' && r.usd_per_full_week) { const k = isoWeek(Date.parse(String(r.end).slice(0, 13).padEnd(13, '0') + ':00:00Z') || now); byWeek[k] = Math.max(byWeek[k] || 0, r.usd_per_full_week); }
    const thisWk = isoWeek(Date.parse(String(w.end || w.meter_end_hour || '').slice(0, 13) + ':00:00Z') || now); delete byWeek[thisWk];
    const past = Object.keys(byWeek).sort().slice(-5).map(k => byWeek[k]), v = w.usd_per_full_week, from = Math.round(w.meter_start_pct), to = Math.round(w.meter_end_pct), per = report.prices.plan_usd_per_week[key];
    plans.push({ key, ...PLAN[key], usd_per_full_week: v, times_plan_price: Math.round(v / per), proof: key === 'claude' && allMachines ? 'measured' : 'floor', plan_usd_per_week: Math.round(per), meter_from: from, meter_to: to,
      meter: key === 'google' ? `no meter · cap after ${w.hours} h` : `meter ${from}% → ${to}% in ${w.hours} h`, priced_usd: w.measured.api_usd, fraction_of_week: +((to - from) / 100).toFixed(2),
      tokens: `${ft(w.measured.output_tokens)} out ${ft(w.measured.cached_input_tokens)} cached`, models: models(w.measured.model_mix_by_usd), history: [...past, v], change_vs_last_week_pct: past.length ? pctChange(v, past[past.length - 1]) : null });
  }

  // waste: account-weeks that closed in the last 7 days (and ones still open, shown as at risk, never as waste)
  const waste = []; let n = 0;
  for (const c of (report.codex_weeks || []).filter(c => c.quality !== 'too_small' && Date.parse(c.window_reset) > w1).sort((a, b) => a.window_reset < b.window_reset ? -1 : 1)) {
    const used = Math.round(c.meter_end_pct), limit = c.usd_per_full_week || (used > 0 ? c.measured.api_usd / (used / 100) : 0); if (!limit) continue;
    const open = c.status === 'open', left = Math.round(limit * (1 - used / 100)), hrs = Math.max(0, Math.round((Date.parse(c.window_reset) - now) / H));
    waste.push({ account: 'ChatGPT Pro ' + String.fromCharCode(65 + n++), limit_usd: Math.round(limit), used_pct: used, unused_usd: open || c.capped ? 0 : left, at_risk_usd: open && !c.capped ? left : 0, open, why: c.capped ? 'hit the cap' : open ? `$${left} left, resets ${hrs} h` : 'you spent less' });
  }
  // an account-week priced far below the others was mostly used on machines that were not scanned: leave it out
  const med = waste.map(x => x.limit_usd).sort((a, b) => a - b)[Math.floor(waste.length / 2)] || 0, ok = waste.filter(x => x.limit_usd >= .25 * med), rank = x => x.unused_usd ? 0 : x.open ? 1 : 2, keep = [...ok].sort((a, b) => rank(a) - rank(b)).slice(0, 5).sort((a, b) => ok.indexOf(a) - ok.indexOf(b)), hidden = waste.length - keep.length;
  waste.length = 0; keep.forEach((x, i) => waste.push({ ...x, account: 'ChatGPT Pro ' + String.fromCharCode(65 + i) }));
  for (const p of plans) if (p.key !== 'codex') waste.unshift({ account: p.plan, limit_usd: p.usd_per_full_week, used_pct: 100, unused_usd: 0, why: 'hit the cap' });

  const tools = ['claude', 'codex', 'antigravity'].map(p => { const r = cur.filter(a => a.provider === p); return { tool: TOOL[p], key: p, found: (scanInfo.counts[p] || 0) > 0, files: scanInfo.counts[p] || 0, sessions: (report.sessions_by_provider || {})[p] || 0, requests: sum(r, 'requests'), output: sum(r, 'output'), cached: sum(r, 'cache_read'), fresh: sum(r, 'input_uncached'), usd: Math.round(sum(r, 'usd')) }; });
  const D = { generated_at: new Date(now).toISOString(), week: { from: new Date(w1).toISOString().slice(0, 10), to: new Date(now).toISOString().slice(0, 10) }, machines: 1 + (scanInfo.hosts || []).filter(x => x.ok).length, days_scanned: cfg.days,
    plans, tools, waste, waste_hidden: hidden, totals: { output_tokens: sum(cur, 'output'), output_tokens_change_pct: pctChange(sum(cur, 'output'), sum(prev, 'output')), api_value_usd: Math.round(sum(cur, 'usd')), api_value_change_pct: pctChange(sum(cur, 'usd'), sum(prev, 'usd')),
      tokens_per_day: perDay(act, 'output'), value_per_day: perDay(act, 'usd').map(Math.round) },
    heat: { days: names, rows: heat, note: pk[2] ? `peak ${names[pk[0]]} ${String(pk[1]).padStart(2, '0')}:00 · quiet ${names[quiet]}` : 'no activity' } };
  if (g) {
    const inw = (t, a, b) => t >= a && t < b, mc = g.prs.filter(t => inw(t, w1, now)).length, mp = g.prs.filter(t => inw(t, w0, w1)).length, per = Array(7).fill(0); for (const t of g.prs) { const i = di(t); if (i >= 0 && i < 7) per[i]++; }
    const cost = mc ? D.totals.api_value_usd / mc : null, costPrev = mp ? sum(prev, 'usd') / mp : null;
    D.git = { merged_prs: mc, merged_prs_change_pct: pctChange(mc, mp), commits: g.commits.filter(t => t >= w1).length, repos: g.repos, usd_per_merged_pr: cost, usd_per_pr_change_pct: cost != null && costPrev ? pctChange(cost, costPrev) : null,
      prs_per_day: per, usd_per_pr_per_day: per.map((k, i) => k ? D.totals.value_per_day[i] / k : 0), sources: g.src, meter: g.meter };
  }

  // player history: one small row per day, kept forever; XP, level, streak and bests are computed from it
  const hf = path.join(HOME, 'history.json'); let hist = { days: {} }; try { hist = JSON.parse(fs.readFileSync(hf, 'utf8')); } catch { /* first run */ }
  const agg = {}; for (const a of act) { const k = dayKey(a.t), o = agg[k] = agg[k] || { out: 0, usd: 0, prs: 0, commits: 0 }; o.out += a.output || 0; o.usd += a.usd || 0; }
  if (g) { for (const t of g.prs) (agg[dayKey(t)] = agg[dayKey(t)] || { out: 0, usd: 0, prs: 0, commits: 0 }).prs++; for (const t of g.commits) (agg[dayKey(t)] = agg[dayKey(t)] || { out: 0, usd: 0, prs: 0, commits: 0 }).commits++; }
  for (const [k, o] of Object.entries(agg)) hist.days[k] = { out: Math.round(o.out), usd: Math.round(o.usd), prs: g ? o.prs : (hist.days[k] || {}).prs || 0, commits: g ? o.commits : (hist.days[k] || {}).commits || 0 };
  fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(hf, JSON.stringify(hist)); audit('write', tilde(hf) + `  (${Object.keys(hist.days).length} daily rows)`);
  const keys = Object.keys(hist.days).sort(), xp = keys.reduce((s, k) => s + Math.round(hist.days[k].out / 1e5) + 25 * hist.days[k].prs + 2 * hist.days[k].commits, 0), level = Math.floor(Math.sqrt(xp / 2500)) + 1;
  let streak = 0; for (let t = d0.getTime(); (hist.days[dayKey(t)] || {}).out > 0; t -= DAY) streak++;
  const old = keys.filter(k => k < dayKey(days[0])).reverse(), blocks = []; for (let i = 0; i + 7 <= old.length; i += 7) { const b = old.slice(i, i + 7).map(k => hist.days[k]); blocks.push({ out: b.reduce((s, x) => s + x.out, 0), prs: b.reduce((s, x) => s + x.prs, 0), usd: b.reduce((s, x) => s + x.usd, 0) }); }
  const bests = []; if (blocks.length) { if (D.totals.output_tokens > Math.max(...blocks.map(b => b.out))) bests.push('most tokens in a week');
    if (D.git && D.git.merged_prs > Math.max(...blocks.map(b => b.prs))) bests.push('PRs merged in a week');
    const pc = blocks.filter(b => b.prs).map(b => b.usd / b.prs); if (D.git && D.git.usd_per_merged_pr != null && pc.length && D.git.usd_per_merged_pr < Math.min(...pc)) bests.push('lowest cost per PR'); }
  D.game = { level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], xp, xp_next: 2500 * level * level, streak_days: streak, days_tracked: keys.length, personal_bests: bests };
  return D;
}
