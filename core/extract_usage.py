#!/usr/bin/env python3
"""Per-host usage extractor: Claude Code, Codex, Antigravity. Stdlib only, read-only.
Prints one JSON document to stdout. Usage: python3 extract_usage.py [days]
v3 (2026-11-12): codex login = creator_user_id|creator_account_id; codex long-context (>272K input) counted apart;
  claude meter log (claude-limits.jsonl from claude-limits-statusline.mjs) shipped as meter_readings.
v2 (accounts): every session/bucket carries a salted-hash account tag ('acct-xxxxxxxxxx'), never a raw id or email.
  claude : one tag per config dir (~/.claude, ~/.claude-*, $CLAUDE_CONFIG_DIR) from <dir>/.claude.json oauthAccount.accountUuid
  codex  : session_meta.creator_account_id (per session) + login of the CODEX_HOME the file lives in (auth.json tokens.account_id)
  agy    : login timeline from 'applyAuthResult: email=' log lines; each step gets the login active at its timestamp
Set USAGE_ACCT_SALT to the same value on every host so tags match across machines."""
import sys, os, json, glob, time, socket, hashlib, re
from collections import defaultdict, Counter

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 45
H = os.path.expanduser('~')
NOW = time.time()
CUT_M = NOW - DAYS * 86400
CUT_TS = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(CUT_M))
HOST = socket.gethostname()
PROG = os.environ.get('WORTHIT_PROGRESS')
def prog(tool, i, n, f):
    """One line per file read, on stderr, so the caller can show a live bar and keep an audit log."""
    if PROG: sys.stderr.write('@f\t%s\t%d\t%d\t%s\n' % (tool, i, n, f))

def h64(s):
    return int.from_bytes(hashlib.blake2b(s.encode('utf-8', 'replace'), digest_size=8).digest(), 'big')

SALT = os.environ.get('USAGE_ACCT_SALT', 'usage-accounts-v2')
TZ_OFF_H = -time.timezone / 3600 if not time.localtime().tm_isdst else -time.altzone / 3600

def tag(x):
    """Salted short hash: stable across hosts with the same salt, not reversible to the id/email."""
    if not x or x in ('unknown', 'unattributed'): return x or 'unknown'
    return 'acct-' + hashlib.blake2b((SALT + '|' + str(x).strip().lower()).encode(), digest_size=5).hexdigest()

def jload(p):
    try:
        with open(p) as fh: return json.load(fh)
    except Exception:
        return None

def claude_homes():
    """(config_dir, account_tag, meta) for each Claude Code config dir on this host."""
    dirs = [os.path.join(H, '.claude')] + sorted(glob.glob(os.path.join(H, '.claude-*'))) + sorted(glob.glob(os.path.join(H, '.config', 'claude*')))
    if os.environ.get('CLAUDE_CONFIG_DIR'): dirs.append(os.path.expanduser(os.environ['CLAUDE_CONFIG_DIR']))
    out, seen_d = [], set()
    for d in dirs:
        d = os.path.realpath(d)
        if d in seen_d or not os.path.isdir(d) or d.endswith('.json'): continue
        seen_d.add(d)
        # default dir keeps its config at ~/.claude.json; a CLAUDE_CONFIG_DIR keeps it inside the dir
        cfg = jload(os.path.join(d, '.claude.json')) or (jload(os.path.join(H, '.claude.json')) if d == os.path.realpath(os.path.join(H, '.claude')) else None) or {}
        oa = cfg.get('oauthAccount') or {}
        meta = {k: oa.get(k) for k in ('planDisplayName', 'seatTier', 'organizationRateLimitTier', 'userRateLimitTier', 'organizationType', 'billingType')}
        meta['account'] = tag(oa.get('accountUuid')) if oa.get('accountUuid') else 'unattributed'
        meta['org'] = tag(oa.get('organizationUuid')) if oa.get('organizationUuid') else None
        meta['config_dir'] = os.path.basename(d)
        out.append((d, meta['account'], meta))
    return out

def codex_homes():
    """(codex_home, login_tag) for ~/.codex, ~/.codex-*, $CODEX_HOME. Reads ONLY tokens.account_id from auth.json."""
    dirs = [os.path.join(H, '.codex')] + sorted(glob.glob(os.path.join(H, '.codex-*')))
    if os.environ.get('CODEX_HOME'): dirs.append(os.path.expanduser(os.environ['CODEX_HOME']))
    out, seen_d = [], set()
    for d in dirs:
        d = os.path.realpath(d)
        if d in seen_d or not os.path.isdir(d): continue
        seen_d.add(d)
        a = jload(os.path.join(d, 'auth.json')) or {}
        acc = (a.get('tokens') or {}).get('account_id')
        out.append((d, tag(acc) if acc else 'unknown'))
    return out

def recent(paths):
    out = []
    for p in paths:
        try:
            if os.path.getmtime(p) >= CUT_M:
                out.append(p)
        except OSError:
            pass
    return out

def zopen(f):
    """Open a .jsonl or .jsonl.zst file as text lines."""
    if not f.endswith('.zst'):
        return open(f, errors='replace')
    import subprocess, io, shutil
    z = shutil.which('zstd') or shutil.which('unzstd')
    if z:
        pr = subprocess.Popen([z, '-dc', f], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        return io.TextIOWrapper(pr.stdout, errors='replace')
    try:
        from compression import zstd as _z
        return _z.open(f, 'rt', errors='replace')
    except ImportError:
        import zstandard
        return io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(open(f, 'rb')), errors='replace')

def walk(root, suffix):
    for d, _, fs in os.walk(root):
        for f in fs:
            if f.endswith(suffix) or (suffix == '.jsonl' and f.endswith('.jsonl.zst')):
                yield os.path.join(d, f)

buckets = defaultdict(lambda: defaultdict(int))   # (provider, account, model, effort, hour) -> counters
sessions = {}                                     # (provider, sid) -> info
events = []                                       # cap hits
meters = {}                                       # codex meter snapshots per (account, limit, slot, hour)
stats = defaultdict(int)
errors = []

def sess(provider, sid, ts, tok, **kw):
    s = sessions.get((provider, sid))
    if s is None:
        s = sessions[(provider, sid)] = {'provider': provider, 'id': sid, 'first': ts, 'last': ts, 'tokens': 0}
    if ts < s['first']: s['first'] = ts
    if ts > s['last']: s['last'] = ts
    s['tokens'] += tok
    for k, v in kw.items():
        if v and not s.get(k): s[k] = v

# ---------------- Claude Code ----------------
def claude():
    files = {}
    for home, acct_tag, _ in claude_homes():
        for root in ('projects', 'session-archive'):
            for f in walk(os.path.join(home, root), '.jsonl'):
                files.setdefault(os.path.realpath(f), acct_tag)   # ~/.claude-2/projects is often a symlink to ~/.claude/projects
    stats['claude_files'] = len(recent(files))
    seen, seen_ev = {}, set()
    _fl = list(recent(files))
    for _i, f in enumerate(_fl):
        prog('claude', _i + 1, len(_fl), f)
        acct = files[f]
        try:
            fh = open(f, errors='replace')
        except OSError as e:
            errors.append('claude %s: %s' % (f, e)); continue
        with fh:
            for l in fh:
                is_err = '"rate_limit' in l or '"apiError"' in l
                if '"usage"' not in l and not is_err:
                    continue
                try:
                    o = json.loads(l)
                except ValueError:
                    continue
                ts = o.get('timestamp') or ''
                if ts < CUT_TS:
                    continue
                m = o.get('message') if isinstance(o.get('message'), dict) else {}
                sid = o.get('sessionId') or o.get('session_id') or os.path.basename(f)[:-6]
                if o.get('isApiErrorMessage') or o.get('apiError'):
                    info = ((o.get('apiErrorParams') or {}).get('rate_limit_info')) or o.get('quotaLimits') or {}
                    if not info and o.get('error') != 'rate_limit':
                        continue
                    k = o.get('uuid') or (sid + ts)
                    if k in seen_ev: continue
                    seen_ev.add(k)
                    events.append({'provider': 'claude', 'kind': 'cap_hit', 'ts': ts, 'session': sid,
                                   'limit_type': info.get('rateLimitType'), 'resets_at': info.get('resetsAt'),
                                   'overage_disabled_reason': info.get('overageDisabledReason'),
                                   'api_error': o.get('apiError'), 'cwd': o.get('cwd'), 'account': acct})
                    continue
                u = m.get('usage')
                if not isinstance(u, dict) or m.get('model') in (None, '<synthetic>'):
                    continue
                k = h64((m.get('id') or '') + '|' + (o.get('requestId') or o.get('uuid') or ''))
                if k in seen:
                    stats['claude_dupes'] += 1
                    pb, po, plc = seen[k]; no = u.get('output_tokens') or 0
                    if no > po:
                        pb[plc + 'output'] += no - po; seen[k] = (pb, no, plc); stats['claude_output_raised'] += 1
                    continue
                cc = u.get('cache_creation') or {}
                od = u.get('output_tokens_details') or {}
                b = buckets[('claude', acct, m.get('model'), o.get('effort') or o.get('perTurnEffort') or '', ts[:13], sid, acct)]
                i, cw, cr, out = (u.get('input_tokens') or 0, u.get('cache_creation_input_tokens') or 0,
                                  u.get('cache_read_input_tokens') or 0, u.get('output_tokens') or 0)
                lc = 'lc_' if i + cw + cr > 100000 else ''        # Anthropic long-context tier (Haiku 5.5): prompt over 100K
                seen[k] = (b, out, lc)
                b[lc + 'input_uncached'] += i; b[lc + 'cache_write'] += cw; b[lc + 'cache_read'] += cr; b[lc + 'output'] += out
                b[lc + 'cache_write_1h'] += cc.get('ephemeral_1h_input_tokens') or 0
                b[lc + 'cache_write_5m'] += cc.get('ephemeral_5m_input_tokens') or 0
                b['reasoning'] += od.get('thinking_tokens') or 0
                b['requests'] += 1
                if o.get('isSidechain'): b['subagent_requests'] += 1
                sess('claude', sid, ts, i + cw + cr + out, cwd=o.get('cwd'), branch=o.get('gitBranch'), account=acct)
    stats['claude_messages'] = len(seen)

def claude_account():
    """All logins found on this host (hashed), one per config dir. Replaces the raw current-login UUIDs."""
    try:
        return [m for _, _, m in claude_homes()]
    except Exception as e:
        return {'error': str(e)}

# ---------------- Codex ----------------
def codex():
    login_of = {}
    for home, lt in codex_homes():
        for sub in ('sessions', 'archived_sessions'):
            for f in walk(os.path.join(home, sub), '.jsonl'): login_of.setdefault(f, lt)
    files = recent(list(login_of))
    stats['codex_files'] = len(files); stats['codex_zst_files'] = len([f for f in files if f.endswith('.zst')])
    seen = set()
    _fl = list(files)
    for _i, f in enumerate(_fl):
        prog('codex', _i + 1, len(_fl), f)
        acct = sid = cwd = branch = repo = None
        login = login_of.get(f, 'unknown')
        model = effort = ''
        prev = None; last_reset = None
        try:
            fh = zopen(f)
        except Exception as e:
            errors.append('codex %s: %s' % (f, e)); continue
        with fh:
            for l in fh:
                if '"token_count"' in l: kind = 'tc'
                elif l.startswith('{"timestamp"') and '"type":"session_meta"' in l[:120]: kind = 'sm'
                elif l.startswith('{"timestamp"') and '"type":"turn_context"' in l[:120]: kind = 'tx'
                elif '"session_meta"' in l[:200]: kind = 'sm'
                elif '"turn_context"' in l[:200]: kind = 'tx'
                else: continue
                try:
                    o = json.loads(l)
                except ValueError:
                    continue
                p = o.get('payload') if isinstance(o.get('payload'), dict) else {}
                t = o.get('type')
                ts = o.get('timestamp') or ''
                if t == 'session_meta':
                    if sid is None:
                        cu, ca = p.get('creator_user_id'), p.get('creator_account_id')
                        acct = tag('%s|%s' % (cu, ca)) if (cu or ca) else 'unknown'
                        sid = p.get('session_id') or p.get('id')
                        cwd = p.get('cwd'); g = p.get('git') or {}
                        branch = g.get('branch'); repo = g.get('repository_url')
                    continue
                if t == 'turn_context':
                    model = p.get('model') or model
                    effort = p.get('effort') or ((p.get('collaboration_mode') or {}).get('settings') or {}).get('reasoning_effort') or effort
                    continue
                if p.get('type') != 'token_count' or ts < CUT_TS:
                    if p.get('type') == 'token_count':
                        tot = (p.get('info') or {}).get('total_token_usage')
                        if tot: prev = tot
                    continue
                a = acct or 'unknown'; s = sid or os.path.basename(f).replace('.zst', '')
                rl = p.get('rate_limits') or {}
                last_reset = (rl.get('primary') or {}).get('resets_at') or last_reset
                for slot in ('primary', 'secondary'):
                    w = rl.get(slot)
                    if not isinstance(w, dict): continue
                    mk = (w.get('resets_at'), rl.get('limit_id'), slot, ts[:13])
                    mm = meters.get(mk)
                    up = w.get('used_percent')
                    if mm is None:
                        meters[mk] = {'provider': 'codex', 'account': a, 'limit_id': rl.get('limit_id'), 'slot': slot,
                                      'hour': ts[:13], 'used_min': up, 'used_max': up, 'window_minutes': w.get('window_minutes'),
                                      'resets_at': w.get('resets_at'), 'plan_type': rl.get('plan_type'), 'samples': 1, 'login': login}
                    else:
                        if up is not None:
                            if mm['used_min'] is None or up < mm['used_min']: mm['used_min'] = up
                            if mm['used_max'] is None or up > mm['used_max']:
                                mm['used_max'] = up; mm['resets_at'] = w.get('resets_at')
                        mm['samples'] += 1
                if rl.get('rate_limit_reached_type'):
                    events.append({'provider': 'codex', 'kind': 'cap_hit', 'ts': ts, 'session': s, 'account': a,
                                   'limit_type': rl.get('rate_limit_reached_type'),
                                   'resets_at': (rl.get('primary') or {}).get('resets_at'), 'cwd': cwd})
                tot = (p.get('info') or {}).get('total_token_usage')
                if not tot: continue
                k = h64('%s|%s|%s' % (s, ts, tot.get('total_tokens')))
                if k in seen:
                    stats['codex_dupes'] += 1; prev = tot; continue
                seen.add(k)
                d = {}
                lu = (p.get('info') or {}).get('last_token_usage') or {}
                if prev is not None and tot == prev: continue          # meter-only update, no new usage
                # a forked/resumed file starts with the parent's cumulative total: count only its last call, never the baseline
                reset = prev is None or any((tot.get(x) or 0) < (prev.get(x) or 0) for x in tot)
                for x in ('input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'):
                    d[x] = (lu.get(x) or 0) if reset else (tot.get(x) or 0) - (prev.get(x) or 0)
                if reset: stats['codex_baseline_skipped'] += 1
                prev = tot
                if not any(d.values()): continue
                b = buckets[('codex', str(last_reset), model, effort, ts[:13], s, a)]
                lc = 'lc_' if (lu.get('input_tokens') or d['input_tokens']) > 272000 else ''   # OpenAI long-context tier: >272K input per request
                b[lc + 'input_uncached'] += d['input_tokens'] - d['cached_input_tokens']
                b[lc + 'cache_read'] += d['cached_input_tokens']
                b[lc + 'cache_write'] += d['cache_write_input_tokens']
                b[lc + 'output'] += d['output_tokens']            # includes reasoning
                b['reasoning'] += d['reasoning_output_tokens']
                b['requests'] += 1
                sess('codex', s, ts, d['input_tokens'] + d['output_tokens'], cwd=cwd, branch=branch, repo=repo, account=a, login=login)

# ---------------- Antigravity ----------------
QRE = re.compile(r'RESOURCE_EXHAUSTED|quota|rate.?limit|exhausted|limit reached|usage limit', re.I)
MRE = re.compile(r'Gemini [0-9][A-Za-z0-9 .()\-]{0,30}')

GLOG = re.compile(r'^[IWEF](\d\d)(\d\d) (\d\d):(\d\d):(\d\d)')
AUTH = re.compile(r'applyAuthResult: email=([^,\s]+)')

def glog_utc(line, year):
    """glog prefix 'I1108 16:09:31' is host-local time without a year -> UTC ISO."""
    m = GLOG.match(line)
    if not m: return None
    import calendar
    ep = calendar.timegm((year, int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)))) - TZ_OFF_H * 3600
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(ep))

AGY_NAME = re.compile(rb'(gemini-4-[a-z]+|gemini-3\.\d-flash|claude-(?:opus|sonnet|haiku)-\d-\d)')
AGY_LSI = re.compile(rb'\n\x0flast_step_index\x12([\x00-\x7f])')
AGY_ENUM = re.compile(rb'MODEL_PLACEHOLDER_M\d+')
AGY_CID = re.compile(r'(?:cascade|conversation|trajectory)[_ ]?[iI][dD]["=: ]+([0-9a-f]{8}-[0-9a-f-]{27})')
AGY_RESET = re.compile(r'Resets in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?')

def agy_gen_rows(dbp):
    """Generation records of one conversation: (last_step_index, model enum, model names in the record). Read-only."""
    import sqlite3
    try:
        c = sqlite3.connect('file:%s?mode=ro' % dbp, uri=True)
        rows = c.execute('select data from gen_metadata').fetchall(); c.close()
    except Exception:
        return []
    out = []
    for (d,) in rows:
        if not isinstance(d, (bytes, bytearray)): continue
        m = AGY_LSI.search(d)
        if not m: continue
        try: lsi = int(d[m.end(): m.end() + m.group(1)[0]])
        except ValueError: continue
        e = AGY_ENUM.search(d)
        out.append((lsi, e.group().decode() if e else None, [n.decode() for n in AGY_NAME.findall(d)]))
    return out

def antigravity():
    import bisect
    model = ''
    for sp in ('.gemini/antigravity-cli/settings.json', '.gemini/antigravity/settings.json', '.gemini/settings.json'):
        try:
            mv = json.load(open(os.path.join(H, sp))).get('model')
            if isinstance(mv, dict): mv = mv.get('name')
            if mv: model = str(mv); break
        except Exception:
            pass
    stats_models = defaultdict(int)
    enum_names, conv_models = {}, defaultdict(list)
    logins, model_tl, step_keys = [], [], defaultdict(int)
    yr = int(time.strftime('%Y', time.gmtime(NOW)))
    for root in ('antigravity-cli', 'antigravity'):
        base = os.path.join(H, '.gemini', root)
        for f in sorted(recent(glob.glob(os.path.join(base, 'log', '*.log')) + glob.glob(os.path.join(base, '*.log')))):
            prog('antigravity', 0, 0, f)
            try:
                with open(f, errors='replace') as fh:
                    for l in fh:
                        ma = AUTH.search(l)
                        if ma:
                            t = glog_utc(l, yr)
                            if t: logins.append((t, tag(ma.group(1))))
                        for mm in MRE.findall(l):
                            t = glog_utc(l, yr)
                            if t and len(model_tl) < 50000: model_tl.append((t, mm.strip(), os.path.basename(f)))
            except OSError:
                pass
    logins.sort(); lt = [t for t, _ in logins]
    def login_at(ts):
        i = bisect.bisect_right(lt, ts[:19]) - 1
        return logins[i][1] if i >= 0 else 'unknown'
    for root in ('antigravity-cli', 'antigravity'):
        base = os.path.join(H, '.gemini', root)
        gens = {}
        for dbp in recent(glob.glob(os.path.join(base, 'conversations', '*.db'))):
            prog('antigravity', 0, 0, dbp)
            gens[os.path.basename(dbp)[:-3]] = agy_gen_rows(dbp)
        co = defaultdict(Counter)
        for rows in gens.values():
            for _, en, names in rows:
                if en:
                    for n in set(names): co[en][n] += 1
        enum_name = {en: c.most_common(1)[0][0] for en, c in co.items() if c}
        enum_names.update(enum_name)
        for conv in glob.glob(os.path.join(base, 'brain', '*')):
            lg = os.path.join(conv, '.system_generated', 'logs')
            f = os.path.join(lg, 'transcript_full.jsonl')
            if not os.path.exists(f): f = os.path.join(lg, 'transcript.jsonl')
            if not recent([f]): continue
            step_model_of = {}
            for lsi, en, names in gens.get(os.path.basename(conv), []):
                step_model_of[lsi + 1] = enum_name.get(en) or (names[0] if names else '')
            tl_conv = conv_models[os.path.basename(conv)]
            stats['agy_files'] += 1
            sid = os.path.basename(conv)
            try:
                fh = open(f, errors='replace')
            except OSError as e:
                errors.append('agy %s: %s' % (f, e)); continue
            with fh:
                for l in fh:
                    has_tok = '"input_tokens"' in l
                    if not has_tok and not ('"SYSTEM_MESSAGE"' in l[:200] or '"ERROR' in l[:200]):
                        continue
                    try:
                        o = json.loads(l)
                    except ValueError:
                        continue
                    ts = (o.get('created_at') or '')
                    if ts < CUT_TS: continue
                    if not has_tok or 'input_tokens' not in o:
                        c = o.get('content')
                        c = c if isinstance(c, str) else json.dumps(c)
                        mt = QRE.search(c or '')
                        if mt and o.get('type') != 'USER_INPUT' and len(events) < 5000:
                            events.append({'provider': 'antigravity', 'kind': 'quota_text', 'ts': ts, 'session': sid,
                                           'step_type': o.get('type'), 'status': o.get('status'),
                                           'text': c[max(0, mt.start() - 120): mt.start() + 240]})
                        continue
                    i, cr, out = o.get('input_tokens') or 0, o.get('cache_read_tokens') or 0, o.get('output_tokens') or 0
                    for kk in o: step_keys[kk] += 1          # discover where (if anywhere) a per-step model lives
                    md = o.get('metadata') if isinstance(o.get('metadata'), dict) else {}
                    step_model = (o.get('model') or o.get('model_name') or o.get('modelName') or o.get('generator_model')
                                  or md.get('model') or md.get('model_name') or step_model_of.get(o.get('step_index')) or '')
                    if step_model and (not tl_conv or tl_conv[-1][1] != step_model): tl_conv.append([ts[:19], step_model])
                    stats['agy_steps_with_model' if step_model else 'agy_steps_without_model'] += 1
                    b = buckets[('antigravity', root, step_model or model, '' if step_model else 'settings_label', ts[:13], sid, login_at(ts))]
                    b['input_uncached'] += i; b['cache_read'] += cr; b['output'] += out
                    b['reasoning'] += o.get('thinking_tokens') or 0
                    b['requests'] += 1
                    sess('antigravity', sid, ts, i + cr + out)
        # log files: model names and quota messages
        logs = recent(glob.glob(os.path.join(base, 'log', '*.log')) + glob.glob(os.path.join(base, '*.log')))
        for f in logs:
            try:
                txt = open(f, errors='replace').read()
            except OSError:
                continue
            for mm in MRE.findall(txt): stats_models[mm.strip()] += 1
            if 'RESOURCE_EXHAUSTED' not in txt: continue
            cid = (Counter(AGY_CID.findall(txt)).most_common(1) or [(None, 0)])[0][0]
            seen_s = set()
            for l in txt.splitlines():
                if 'RESOURCE_EXHAUSTED' not in l or 'agent executor error' not in l: continue
                t = glog_utc(l, yr); mr = AGY_RESET.search(l)
                if not t or not mr or t[:19] in seen_s: continue
                seen_s.add(t[:19])
                left = int(mr.group(1) or 0) * 3600 + int(mr.group(2) or 0) * 60 + float(mr.group(3) or 0)
                import calendar
                ep_ = calendar.timegm(time.strptime(t[:19], '%Y-%m-%dT%H:%M:%S'))
                events.append({'provider': 'antigravity', 'kind': 'cap', 'ts': t, 'session': cid, 'file': os.path.basename(f),
                               'resets_at': int(ep_ + left), 'resets_in_hours': round(left / 3600, 2),
                               'text': l[l.find('RESOURCE_EXHAUSTED'):][:160], 'account': login_at(t)})
    return {'settings_model': model, 'log_model_mentions': dict(stats_models),
            'logins': sorted(set(a for _, a in logins)), 'login_timeline': [{'ts': t, 'account': a} for t, a in logins if True][:2000],
            'model_timeline': [{'ts': t, 'model': m, 'file': fl} for t, m, fl in model_tl], 'step_keys': dict(step_keys),
            'host_tz_offset_hours': TZ_OFF_H, 'model_enums': enum_names, 'conv_model_timeline': dict(conv_models)}

def meter_log():
    out = []
    for f in (os.environ.get('METER_STATE_DIR', ''), os.path.join(H, '.worthit'), os.path.join(H, '.automagik', 'meter'), os.path.join(H, 'Library/Application Support/automagik'),
              os.path.join(os.environ.get('XDG_STATE_HOME', os.path.join(H, '.local/state')), 'automagik')):
        f = os.path.join(f, 'claude-limits.jsonl')
        if not f or not os.path.exists(f): continue
        with open(f, errors='replace') as fh:
            for l in fh:
                try: r = json.loads(l)
                except ValueError: continue
                if (r.get('ts') or '') < CUT_TS: continue
                sd, fh5 = r.get('seven_day') or {}, r.get('five_hour') or {}
                out.append([r.get('ts'), r.get('session'), r.get('account'), r.get('model'), sd.get('used_percentage'), sd.get('resets_at'),
                            fh5.get('used_percentage'), fh5.get('resets_at')])
        break
    stats['meter_readings'] = len(out)
    return out

res = {'host': HOST, 'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(NOW)), 'days': DAYS, 'since': CUT_TS}
agy_info = {}
for name, fn in (('claude', claude), ('codex', codex), ('antigravity', antigravity)):
    t0 = time.time()
    try:
        r = fn()
        if name == 'antigravity': agy_info = r or {}
    except Exception as e:
        errors.append('%s failed: %r' % (name, e))
    stats[name + '_seconds'] = round(time.time() - t0, 1)

res['accounts'] = {'claude_current_login': claude_account(), 'antigravity': agy_info}
res['token_semantics'] = {
    'input_uncached': 'fresh input, excludes cached (codex: input_tokens - cached_input_tokens)',
    'cache_read': 'cached input read', 'cache_write': 'cache creation (claude; codex if reported)',
    'output': 'output; codex includes reasoning, claude includes thinking', 'reasoning': 'subset of output where reported'}
# 'account' keeps its old meaning (claude: tag, codex: reset anchor, agy: root) so merge_usage.py still works;
# 'login' is the new per-session account tag used to split windows per account.
res['buckets'] = [dict(provider=k[0], account=k[1], model=k[2], effort=k[3], hour=k[4], session=k[5], login=k[6], **v) for k, v in sorted(buckets.items())]
res['meters'] = sorted(meters.values(), key=lambda m: (str(m['resets_at']), m['slot'], m['hour']))
res['events'] = sorted(events, key=lambda e: str(e.get('ts')))
res['sessions'] = sorted(sessions.values(), key=lambda s: s['first'])
res['meter_readings'] = meter_log()
res['meter_fields'] = ['ts', 'session', 'label', 'model', 'week_pct', 'week_reset', 'five_h_pct', 'five_h_reset']
res['stats'] = dict(stats)
res['errors'] = errors[:50]
json.dump(res, sys.stdout, separators=(',', ':'))
