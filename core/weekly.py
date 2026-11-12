#!/usr/bin/env python3
"""Weekly per-account quota report for Claude Code and Codex, priced at API list rates.

Usage: python3 weekly.py <run dir with one <host>.json per machine from extract_usage.py>

Codex  : every token record carries its weekly window (resets_at) and the meter %, and every
         session carries the login (creator user|account). One window = one account-week.
Claude : no log names the account a request used, and switches swap accounts under the same
         login label. The meter log (claude-limits.jsonl) is the identity: all sessions on one
         account read the same rising %, so readings are grouped into "stints" (one account,
         one stretch). Tokens follow the session's readings. Machines without the meter log are
         joined to a stint only when they hit the cap at the same moment with the same reset.
"""
import sys, os, json, glob, time, calendar, statistics, subprocess
from collections import defaultdict, Counter

D = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('WORTHIT_OUT') or D     # where weeks/<date>/report.json and the ledger go
RUN = os.path.abspath(sys.argv[1])
PR = json.load(open(os.path.join(D, 'prices.json')))
NOW = time.time()
WEEK = 7 * 86400

def ep(t):
    t = t[:19] + ':00:00'[len(t[:19]) - 13:] if len(t[:19]) < 19 else t[:19]
    return calendar.timegm(time.strptime(t, '%Y-%m-%dT%H:%M:%S'))
def iso(e): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(e))
def hr(e): return time.strftime('%Y-%m-%dT%H', time.gmtime(e))

# ---------------------------------------------------------------- load, dedupe across hosts
hosts, B, M, E, S, R, ACC = {}, [], [], [], [], [], {}
for p in sorted(glob.glob(os.path.join(RUN, '*.json'))):
    try:
        r = json.load(open(p))
    except Exception as e:
        hosts[os.path.basename(p)] = {'error': str(e)}; continue
    h = r['host']
    hosts[h] = {'ssh_alias': os.path.basename(p)[:-5], 'since': r['since'], 'errors': r['errors'][:5],
                'meter_log_readings': len(r.get('meter_readings') or []),
                'claude_messages': r['stats'].get('claude_messages', 0), 'codex_files': r['stats'].get('codex_files', 0)}
    ACC[h] = r.get('accounts') or {}
    for b in r['buckets']: b['host'] = h; B.append(b)
    for m in r['meters']: m['host'] = h; M.append(m)
    for e in r['events']: e['host'] = h; E.append(e)
    for s in r['sessions']: s['host'] = h; S.append(s)
    for x in r.get('meter_readings') or []:
        R.append(dict(zip(r['meter_fields'], x), host=h))

best = {}
for s in S:
    k = (s['provider'], s['id'])
    if k not in best or s['tokens'] > best[k]['tokens']: best[k] = s
dup_sessions = sum(1 for s in S if best[(s['provider'], s['id'])] is not s)
B = [b for b in B if best.get((b['provider'], b['session']), {'host': b['host']})['host'] == b['host']]
SI = {(s['provider'], s['id']): s for s in best.values()}
E = list({(e['provider'], e.get('session'), e.get('ts'), e.get('text')): e for e in E}.values())
R = sorted({(x['ts'], x['session']): x for x in R}.values(), key=lambda x: x['ts'])

# ---------------------------------------------------------------- prices
unpriced = Counter()
def price(b):
    if b['provider'] == 'claude':
        t = PR['claude'].get(b['model'])
        if not t:
            unpriced[b['model']] += b.get('output', 0); t = PR['claude']['claude-opus-5-5']
        v = 0.0
        for pre in ('', 'lc_'):
            g = lambda k: t.get(pre + k, t[k])
            w1 = b.get(pre + 'cache_write_1h', 0); w5 = max(b.get(pre + 'cache_write', 0) - w1, 0)
            v += (b.get(pre + 'input_uncached', 0) * g('in') + b.get(pre + 'cache_read', 0) * g('cache_read') + w5 * g('cache_write_5m')
                  + w1 * g('cache_write_1h') + b.get(pre + 'output', 0) * g('out'))
        return v / 1e6
    if b['provider'] == 'codex':
        m = b['model'] or ''
        t = PR['codex'].get(m) or next((v for k, v in PR['codex'].items() if not k.startswith('_') and m.startswith(k)), None)
        if not t:
            unpriced[m] += b.get('output', 0) + b.get('lc_output', 0); t = PR['codex']['gpt-6.1-sol']
        v = 0.0
        for pre in ('', 'lc_'):
            v += (b.get(pre + 'input_uncached', 0) * t[pre + 'in'] + b.get(pre + 'cache_read', 0) * t[pre + 'cache_read']
                  + b.get(pre + 'cache_write', 0) * t[pre + 'cache_write'] + b.get(pre + 'output', 0) * t[pre + 'out'])
        return v / 1e6
    if b['provider'] == 'antigravity':
        m = agy_model(b['model'])
        if m.startswith('claude-'):
            t = PR['claude'].get(m, PR['claude']['claude-opus-5-5'])
        else:
            t = PR['google'].get(m)
            if not t: unpriced[m] += b.get('output', 0); t = PR['google']['gemini-4-carbon']
        return (b.get('input_uncached', 0) * t['in'] + b.get('cache_read', 0) * t['cache_read'] + b.get('output', 0) * t['out']) / 1e6
    return 0.0
def agy_model(m):
    m = (m or '').strip()
    for k in ('Carbon', 'Argon', 'Hydrogen'):
        if 'Gemini 4 ' + k in m: return 'gemini-4-' + k.lower()     # settings label fallback for the 1% of steps without a record
    return 'gemini-3.8-flash' if 'Flash' in m else m
for b in B:
    if b['provider'] == 'antigravity': b['model'] = agy_model(b['model'])
    b['usd'] = price(b)

def summ(rows):
    t = defaultdict(int); mix = defaultdict(float); usd = sum(b['usd'] for b in rows)
    for b in rows:
        mix[b['model'] or '?'] += b['usd']
        for f in ('input_uncached', 'cache_read', 'cache_write', 'output', 'reasoning', 'requests'):
            t[f] += b.get(f, 0) + b.get('lc_' + f, 0)
        t['lc'] += b.get('lc_input_uncached', 0) + b.get('lc_cache_read', 0)
    return {'api_usd': round(usd, 2), 'output_tokens': t['output'], 'reasoning_tokens': t['reasoning'],
            'cached_input_tokens': t['cache_read'], 'fresh_input_tokens': t['input_uncached'], 'cache_write_tokens': t['cache_write'],
            'long_context_input_tokens': t['lc'], 'requests': t['requests'], 'sessions': len({b['session'] for b in rows}),
            'hosts': sorted({b['host'] for b in rows}),
            'model_mix_by_usd': {k: round(v / usd, 3) for k, v in sorted(mix.items(), key=lambda kv: -kv[1])[:4]} if usd else {}}

# ---------------------------------------------------------------- Codex: one window = one account-week
CX = [b for b in B if b['provider'] == 'codex']
prim = [m for m in M if m['slot'] == 'primary' and m.get('resets_at')]
rs = sorted({m['resets_at'] for m in prim} | {int(b['account']) for b in CX if b['account'] not in ('None', None)})
groups = []
for r_ in rs:
    if groups and r_ - groups[-1][-1] < 120: groups[-1].append(r_)
    else: groups.append([r_])
gid = {r_: i for i, g in enumerate(groups) for r_ in g}
rows_by = defaultdict(list); unmetered = []
for b in CX:
    if b['account'] in ('None', None): unmetered.append(b)
    else: rows_by[gid[int(b['account'])]].append(b)
codex_weeks = []
for i, g in enumerate(groups):
    rows = rows_by.get(i, [])
    ms = sorted((m for m in prim if m['resets_at'] in g), key=lambda m: m['hour'])
    if not rows or not ms: continue
    reset = max(g)
    first_hour = ms[0]['hour']; first_pct = min(m['used_min'] or 0 for m in ms if m['hour'] == first_hour)
    peak = max(m['used_max'] or 0 for m in ms); peak_hour = min(m['hour'] for m in ms if (m['used_max'] or 0) == peak)
    login = Counter()
    for b in rows: login[b.get('login') or 'unknown'] += b['usd']
    acct = login.most_common(1)[0][0]
    upto = summ([b for b in rows if b['hour'] <= peak_hour])
    delta = peak - first_pct
    w = {'provider': 'codex', 'account': acct, 'account_share': round(login[acct] / (sum(login.values()) or 1), 3),
         'window_start': iso(reset - WEEK), 'window_reset': iso(reset), 'first_use': first_hour, 'meter_start_pct': first_pct,
         'meter_end_pct': peak, 'meter_end_hour': peak_hour, 'capped': peak >= 99,
         'status': 'capped' if peak >= 99 else ('closed' if reset < NOW else 'open'),
         'hours': round((ep(peak_hour) - ep(first_hour)) / 3600 + 1), 'plan': Counter(str(m.get('plan_type')) for m in ms).most_common(1)[0][0],
         'measured': upto, 'tokens_whole_window_usd': round(sum(b['usd'] for b in rows), 2)}
    w['quality'] = 'clean' if first_pct <= 5 and delta >= 50 else ('partial' if delta >= 15 else 'too_small')
    if delta >= 15: w['usd_per_full_week'] = round(upto['api_usd'] / (delta / 100.0))
    codex_weeks.append(w)
codex_weeks.sort(key=lambda w: w['first_use'])
overlaps = []
by_acct = defaultdict(list)
for w in codex_weeks:
    if w['measured']['api_usd'] > 20: by_acct[w['account']].append(w)
for a, ws in by_acct.items():
    for x, y in zip(ws, ws[1:]):
        if ep(y['first_use']) < ep(x['window_reset']) - 3600:
            overlaps.append({'account': a, 'week_a': x['window_reset'], 'week_b_first_use': y['first_use']})

# ---------------------------------------------------------------- Claude: meter stints
fresh, last = [], {}
for x in R:
    if x.get('week_pct') is None or not x.get('week_reset'): continue
    k = (x['week_pct'], x['week_reset'])
    x['fresh'] = last.get(x['session']) != k
    last[x['session']] = k
    if x['fresh']: fresh.append(x)
stints, pending = [], []
def add(s, x):
    s['hi'] = max(s['hi'], x['week_pct']); s['last'] = x['ts']; s['t_last'] = ep(x['ts']); s['n'] += 1
    s['sessions'].add(x['session']); s['hosts'].add(x['host']); s['labels'][x.get('label')] += 1
    if x['week_pct'] >= 99 and not s['cap_ts']: s['cap_ts'] = x['ts']
    x['stint'] = s['id']
mains, pend = {}, defaultdict(list)   # one active account per login folder at a time: the line most of its sessions agree on
for x in fresh:
    t = ep(x['ts']); pct = x['week_pct']; key = (x['host'], x.get('label')); main = mains.get(key)
    if main and main['reset'] == x['week_reset']:
        gap_h = (t - main['t_last']) / 3600
        if main['hi'] - 4 <= pct <= main['hi'] + 8 + 15 * gap_h:
            add(main, x); continue
    # a switch only when 3 sessions agree on a new level within 10 minutes; anything else is an idle session's old value
    pending = pend[key] = [q for q in pend[key] if t - ep(q['ts']) <= 600] + [x]
    grp = sorted((q for q in pending if q['week_reset'] == x['week_reset'] and abs(q['week_pct'] - pct) <= 4), key=lambda q: q['ts'])
    if len({q['session'] for q in grp}) >= 3:
        main = mains[key] = {'id': len(stints), 'reset': x['week_reset'], 'lo': min(q['week_pct'] for q in grp), 'hi': 0, 'first': grp[0]['ts'],
                'last': grp[0]['ts'], 't_last': ep(grp[0]['ts']), 'n': 0, 'sessions': set(), 'hosts': set(), 'labels': Counter(), 'cap_ts': None}
        stints.append(main)
        for q in grp: add(main, q); pending.remove(q)
valid = {s['id'] for s in stints if s['n'] >= 5 and len(s['sessions']) >= 2}
# lines are never merged: two accounts can share a reset time (seen 12 Nov: 89% -> 39% -> 100% -> 0%, all resetting Sun 12:00)
# session timeline: (t, stint) from every reading (repeats inherit the stint of their fresh reading)
tl = defaultdict(list); cur = {}
for x in R:
    if x.get('week_pct') is None: continue
    if x.get('fresh'): cur[x['session']] = x.get('stint')
    sid = cur.get(x['session'])
    if sid in valid: tl[x['session']].append((ep(x['ts']), sid))
CL = [b for b in B if b['provider'] == 'claude']
assign = {}
for b in CL:
    obs = tl.get(b['session'])
    if not obs: continue
    h0 = ep(b['hour'] + ':00:00'); h1 = h0 + 3600
    inh = [sid for t, sid in obs if h0 <= t < h1]
    if inh: assign[id(b)] = (Counter(inh).most_common(1)[0][0], 'meter'); continue
    near = min(obs, key=lambda o: abs(o[0] - (h0 + 1800)))
    if abs(near[0] - (h0 + 1800)) <= 5400: assign[id(b)] = (near[1], 'meter_nearby')
# machines without the meter log: join a stint when they hit the weekly cap at the same moment, same reset
caps = [e for e in E if e['provider'] == 'claude' and (e.get('limit_type') or '').startswith('seven_day') and e.get('resets_at')]
by_sess = defaultdict(list)
for b in CL: by_sess[b['session']].append(b)
joined = defaultdict(set)
single_login = {}
for p_ in glob.glob(os.path.join(RUN, '*.json')):
    try:
        r_ = json.load(open(p_)); homes = (r_.get('accounts') or {}).get('claude_current_login') or []
        single_login[r_['host']] = isinstance(homes, list) and len([h_ for h_ in homes if h_.get('account') not in (None, 'unattributed')]) == 1
    except Exception: pass
for s in stints:
    if s['id'] not in valid or not s['cap_ts']: continue
    tc = ep(s['cap_ts'])
    for e in caps:
        if abs(e['resets_at'] - s['reset']) <= 60 and tc - 1200 <= ep(e['ts']) <= tc + 1800:
            joined[s['id']].add(e['host'])
            # a machine with one Claude login uses one account at a time: from its previous cap on another account to this cap,
            # every session on it was on this account
            if single_login.get(e['host']):
                prev = max([c['ts'] for c in caps if c['host'] == e['host'] and abs(c['resets_at'] - s['reset']) > 60 and c['ts'] < e['ts']], default='')
                lo = max(s['first'], prev)[:13]
                for b in CL:
                    if b['host'] == e['host'] and lo <= b['hour'] <= e['ts'][:13] and id(b) not in assign:
                        assign[id(b)] = (s['id'], 'cap_match_host')
            for b in by_sess.get(e['session'], []):
                if s['first'][:13] <= b['hour'] <= e['ts'][:13] and id(b) not in assign: assign[id(b)] = (s['id'], 'cap_match')
claude_stints = []
first_reading = {}
for x in R: first_reading.setdefault(x['host'], x['ts'][:13])   # a machine counts as logged only from its first reading
for s in stints:
    if s['id'] not in valid: continue
    rows = [b for b in CL if assign.get(id(b), (None,))[0] == s['id']]
    lo_h, hi_h = s['first'][:13], (s['cap_ts'] or s['last'])[:13]
    rows = [b for b in rows if lo_h <= b['hour'] <= hi_h]
    other = [b for b in CL if lo_h <= b['hour'] <= hi_h and id(b) not in assign and first_reading.get(b['host'], '9') > b['hour']]
    delta = s['hi'] - s['lo']
    m = summ(rows)
    m_low = summ([b for b in rows if assign[id(b)][1] in ('meter', 'meter_nearby', 'cap_match')])
    st = {'provider': 'claude', 'stint': s['id'], 'login_label': s['labels'].most_common(1)[0][0], 'window_reset': iso(s['reset']),
          'start': s['first'], 'end': s['cap_ts'] or s['last'], 'meter_start_pct': s['lo'], 'meter_end_pct': s['hi'], 'capped': bool(s['cap_ts']),
          'hours': round((ep(s['cap_ts'] or s['last']) - ep(s['first'])) / 3600, 1), 'logged_hosts': sorted(s['hosts']),
          'joined_by_cap_match': sorted(joined.get(s['id'], ())), 'measured': m,
          'unlogged_usage_same_period_usd': round(sum(b['usd'] for b in other), 2), 'plan': 'Claude Ultra'}
    if delta >= 15:
        st['usd_per_full_week'] = round(m['api_usd'] / (delta / 100.0))
        st['usd_per_full_week_low'] = round(m_low['api_usd'] / (delta / 100.0))   # only sessions seen on the meter or capped with it
    # complete = nothing unexplained could have moved this meter: capped and joined by cap match, or every busy host logs
    st['quality'] = ('clean' if delta >= 40 and (st['unlogged_usage_same_period_usd'] < 0.1 * max(m['api_usd'], 1) or st['joined_by_cap_match'])
                     else 'partial' if delta >= 15 else 'too_small')
    claude_stints.append(st)
claude_stints.sort(key=lambda s: s['start'])

since = max(v['since'] for v in hosts.values() if 'since' in v)
# ---------------------------------------------------------------- Google (Antigravity): caps are the meter (a cap = 100%)
AG = [b for b in B if b['provider'] == 'antigravity']
ctl = {}
for h_, a_ in ACC.items():
    for cid, tl_ in ((a_.get('antigravity') or {}).get('conv_model_timeline') or {}).items(): ctl[cid] = tl_
def model_at(cid, ts):
    tl_ = ctl.get(cid) or []
    prev_m = tl_[0][1] if tl_ else None
    for t_, m_ in tl_:
        if t_ <= ts[:19]: prev_m = m_
    return agy_model(prev_m) if prev_m else None
gcaps = [e for e in E if e['provider'] == 'antigravity' and e.get('kind') == 'cap' and e.get('resets_in_hours', 0) > 24]
pools = []
for e in sorted(gcaps, key=lambda e: e['ts']):
    e['model'] = model_at(e.get('session'), e['ts'])
    for pl in pools:
        if abs(pl['reset'] - e['resets_at']) <= 1800 and pl['account'] == e.get('account'): pl['caps'].append(e); break
    else: pools.append({'reset': e['resets_at'], 'account': e.get('account'), 'caps': [e]})
google_weeks = []
for pl in pools:
    models = Counter(c['model'] for c in pl['caps'] if c['model'])
    group = sorted(models) or ['?']
    first = min(c['ts'] for c in pl['caps']); start = pl['reset'] - WEEK
    rows = [b for b in AG if b['model'] in group and b.get('login') == pl['account'] and hr(start) <= b['hour'] <= first[:13]]
    if not rows: continue
    m = summ(rows); fu = min(b['hour'] for b in rows)
    g = {'provider': 'google', 'plan': 'Google AI Ultra', 'account': pl['account'], 'pool_models': group, 'cap_models': dict(models),
         'window_start': iso(start), 'window_reset': iso(pl['reset']), 'first_use': fu, 'end': first, 'meter_start_pct': 0, 'meter_end_pct': 100,
         'capped': True, 'hours': round((ep(first) - ep(fu)) / 3600, 1), 'cap_events': len(pl['caps']),
         'hosts_capped': sorted({c['host'] for c in pl['caps']}), 'measured': m, 'usd_per_full_week': round(m['api_usd'])}
    # clean = the whole 7-day window is inside the logs and the capping requests ran Gemini (not Claude inside Antigravity)
    g['quality'] = 'clean' if iso(start) >= since and all(x.startswith('gemini') for x in group) else 'partial'
    google_weeks.append(g)
google_weeks.sort(key=lambda g: g['end'])

# ---------------------------------------------------------------- conservation
tot_cl = sum(b['usd'] for b in CL); att_cl = sum(b['usd'] for b in CL if id(b) in assign)
tot_cx = sum(b['usd'] for b in CX); att_cx = tot_cx - sum(b['usd'] for b in unmetered)

# ---------------------------------------------------------------- pick this week's accounts
week_lo = NOW - WEEK
def end_ep(w): return ep(w['meter_end_hour']) if w['provider'] == 'codex' else ep(w['end'])
def finished(w): return w['status'] in ('capped', 'closed') if w['provider'] == 'codex' else w['capped']
def pick(ws):
    cand = [w for w in ws if w.get('usd_per_full_week') and w['quality'] == 'clean' and finished(w) and end_ep(w) >= week_lo]
    if not cand: return None, []
    cand.sort(key=lambda w: -w['usd_per_full_week'])
    return cand[0], cand
cx_pick, cx_cands = pick(codex_weeks)
cl_pick, cl_cands = pick(claude_stints)
go_pick, go_cands = pick([g for g in google_weeks if g['quality'] == 'clean'])

stamp = time.strftime('%Y-%m-%d', time.gmtime(NOW))
outdir = os.path.join(OUT, 'weeks', stamp); os.makedirs(outdir, exist_ok=True)
report = {'generated_at': iso(NOW), 'run_dir': RUN, 'history_since': since, 'hosts': hosts, 'cross_host_duplicate_sessions': dup_sessions,
          'prices': PR, 'unpriced_models_output_tokens': dict(unpriced),
          'conservation': {'claude_total_usd': round(tot_cl), 'claude_attributed_to_stints_usd': round(att_cl),
                           'codex_total_usd': round(tot_cx), 'codex_in_metered_windows_usd': round(att_cx)},
          'codex_account_overlaps': overlaps,
          'this_week': {'claude': cl_pick, 'claude_candidates': len(cl_cands), 'claude_range': [min(w['usd_per_full_week'] for w in cl_cands), max(w['usd_per_full_week'] for w in cl_cands)] if cl_cands else None,
                        'google': go_pick, 'google_candidates': len(go_cands), 'google_range': [min(w['usd_per_full_week'] for w in go_cands), max(w['usd_per_full_week'] for w in go_cands)] if go_cands else None,
                        'codex': cx_pick, 'codex_candidates': len(cx_cands), 'codex_range': [min(w['usd_per_full_week'] for w in cx_cands), max(w['usd_per_full_week'] for w in cx_cands)] if cx_cands else None},
          'codex_weeks': codex_weeks, 'claude_stints': claude_stints, 'google_weeks': google_weeks}
# Claude fleet estimate for weeks without a meter log: all Claude usage that ISO week / allowances in play (accounts + resets, owner's count)
import datetime as _dt
try: _acc = json.load(open(os.path.join(D, 'claude_accounts.json')))
except Exception: _acc = None
if _acc:
    def _wk(s): y, w, _ = _dt.date(int(s[:4]), int(s[5:7]), int(s[8:10])).isocalendar(); return '%d-W%02d' % (y, w)
    _tot, _days = defaultdict(float), defaultdict(set)
    for b in CL: _tot[_wk(b['hour'])] += b['usd']; _days[_wk(b['hour'])].add(b['hour'][:10])
    _now = _wk(iso(NOW))
    report['claude_fleet_weeks'] = [{'iso_week': w, 'total_usd': round(_tot[w]), 'days_with_usage': len(_days[w]), 'accounts': _acc['accounts'],
                                     'resets': _acc.get('resets', {}).get(w, 0), 'allowances': _acc['accounts'] + _acc.get('resets', {}).get(w, 0),
                                     'usd_per_allowance': round(_tot[w] / (_acc['accounts'] + _acc.get('resets', {}).get(w, 0))),
                                     'complete_week': w < _now and len(_days[w]) >= 6} for w in sorted(_tot)]
# hourly activity per tool (priced), and session counts: what the dashboard's totals, sparklines and heatmap are drawn from
_act = defaultdict(lambda: defaultdict(float))
for b in B:
    a_ = _act[(b['hour'], b['provider'])]
    for f_ in ('output', 'input_uncached', 'cache_read', 'requests'): a_[f_] += b.get(f_, 0) + b.get('lc_' + f_, 0)
    a_['usd'] += b['usd']
report['activity'] = [dict(hour=h_, provider=p_, **{k_: (round(v_, 2) if k_ == 'usd' else int(v_)) for k_, v_ in a_.items()}) for (h_, p_), a_ in sorted(_act.items())]
report['sessions_by_provider'] = dict(Counter(s_['provider'] for s_ in best.values()))
report['scan_stats'] = {h_: v_ for h_, v_ in hosts.items()}
json.dump(report, open(os.path.join(outdir, 'report.json'), 'w'), indent=1)

# ---------------------------------------------------------------- ledger (append-only; a published row is never rewritten)
led = os.path.join(OUT, 'weeks', 'ledger.jsonl')
have = set()
if os.path.exists(led):
    for l in open(led):
        try: have.add(json.loads(l)['key'])
        except Exception: pass
added = 0
with open(led, 'a') as fh:
    for w in codex_weeks + claude_stints + google_weeks:
        closed = (w['provider'] == 'codex' and w['status'] != 'open') or (w['provider'] == 'claude' and (w['capped'] or ep(w['end']) < NOW - 6 * 3600)) or (w['provider'] == 'google' and w['capped'])
        if not closed or not w.get('usd_per_full_week') or w['quality'] != 'clean' or not finished(w): continue
        key = '%s|%s' % (w['provider'], w['window_reset'] + '|' + ','.join(w.get('pool_models', [])) if w['provider'] != 'claude' else w['start'])
        if key in have: continue
        fh.write(json.dumps({'key': key, 'recorded': iso(NOW), 'provider': w['provider'], 'account': w.get('account') or w.get('login_label'),
                             'start': w.get('first_use') or w['start'], 'end': w.get('meter_end_hour') or w['end'], 'pool_models': w.get('pool_models'), 'reset': w['window_reset'],
                             'meter': [w['meter_start_pct'], w['meter_end_pct']], 'capped': w['capped'], 'quality': w['quality'],
                             'usd_measured': w['measured']['api_usd'], 'usd_per_full_week': w['usd_per_full_week'], 'usd_per_full_week_low': w.get('usd_per_full_week_low'),
                             'output_tokens': w['measured']['output_tokens'], 'model_mix': w['measured']['model_mix_by_usd'],
                             'plan': w.get('plan'), 'hours': w['hours'], 'fresh_input_tokens': w['measured']['fresh_input_tokens'],
                             'cached_input_tokens': w['measured']['cached_input_tokens'], 'cache_write_tokens': w['measured']['cache_write_tokens'],
                             'reasoning_tokens': w['measured']['reasoning_tokens'], 'requests': w['measured']['requests'],
                             'prices_read': PR['_sources']}) + '\n')
        added += 1

def mix(w): return ', '.join('%s %d%%' % (k.replace('claude-', '').replace('gpt-', 'GPT-'), round(v * 100)) for k, v in list(w['measured']['model_mix_by_usd'].items())[:2])
# ---------------------------------------------------------------- cards (X + LinkedIn): card.py
if os.path.exists(os.path.join(D, 'card.py')): subprocess.run([sys.executable, os.path.join(D, 'card.py'), outdir], timeout=300)

# ---------------------------------------------------------------- console summary
print('report  ', os.path.join(outdir, 'report.json'))
print('card    ', os.path.join(outdir, 'card.png'))
print('ledger  ', led, '(+%d closed account-weeks)' % added)
print('hosts   ', {h: (v.get('meter_log_readings', 0), len(v.get('errors') or [])) for h, v in hosts.items()}, '(meter readings, errors)')
print('conserve', report['conservation'], 'unpriced', dict(unpriced))
print('codex overlaps (same account, overlapping weeks):', len(overlaps))
for w in codex_weeks:
    if w['quality'] == 'too_small': continue
    print('codex  %-15s %s  %3d%%->%3d%% %4dh  $%6.0f  per-week $%s  %s %s' % (w['account'], w['first_use'][5:], w['meter_start_pct'], w['meter_end_pct'], w['hours'],
          w['measured']['api_usd'], w.get('usd_per_full_week'), w['quality'], mix(w)))
for s in claude_stints:
    if s['quality'] == 'too_small': continue
    print('claude %-16s %s  %3d%%->%3d%% %5.1fh  $%6.0f  per-week $%s  %s  unlogged-same-period $%.0f joined %s' % (s['login_label'], s['start'][5:16], s['meter_start_pct'], s['meter_end_pct'],
          s['hours'], s['measured']['api_usd'], s.get('usd_per_full_week'), s['quality'], s['unlogged_usage_same_period_usd'], s['joined_by_cap_match']))
for g in google_weeks:
    print('google %s cap %s %5.1fh $%6.0f %s %s caps-by-model %s' % (g['window_reset'][:13], g['end'][5:16], g['hours'], g['measured']['api_usd'], g['quality'], g['pool_models'], g['cap_models']))
for k in ('claude', 'google', 'codex'):
    w = report['this_week'][k]
    print('PICK %-6s' % k, ('$%s per full week (%s), best of %d, range %s' % (w['usd_per_full_week'], w.get('account') or w.get('login_label'), report['this_week'][k + '_candidates'], report['this_week'][k + '_range'])) if w else 'none')
