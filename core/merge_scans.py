"""Keep the fuller machine/local-day/provider scan before pricing and saving a run."""
import datetime as dt
import json
import os
import sys
from collections import defaultdict
from pricing import price, fit_meter_prices, meter_price


def day(ts):
    # Bucket hours are UTC; history/buildData groups them in the running person's local timezone.
    return dt.datetime.fromisoformat(ts[:19] + '+00:00').astimezone().date().isoformat()


def tokens(b):
    # Reasoning and cache_write_1h/5m are subsets, not additional tokens.
    return sum(b.get(pre + k, 0) for pre in ('', 'lc_') for k in ('input_uncached', 'cache_read', 'cache_write', 'output'))


def merge(saved, fresh, prices, meter_prices=None):
    def rows(scan):
        units = defaultdict(lambda: defaultdict(list))
        for field, stamp in (('buckets', 'hour'), ('meters', 'hour'), ('events', 'ts')):
            for r in scan.get(field, []):
                units[(day(r[stamp]), r['provider'])][field].append(r)
        fields = scan.get('meter_fields', [])
        for r in scan.get('meter_readings', []):
            x = dict(zip(fields, r))
            units[(day(x['ts']), 'claude')]['meter_readings'].append(r)
        for r in scan.get('meter_usage', []):
            d = dt.datetime.fromtimestamp(r[1] / 1000).date().isoformat()
            units[(d, {'dsh-tui': 'dsh'}.get(r[2], r[2]))]['meter_usage'].append(r)
        return units

    def score(unit):
        bs, mu = unit.get('buckets', []), unit.get('meter_usage', [])
        return (sum(price(b, prices) for b in bs) + sum(meter_price(r, meter_prices or {}) or 0 for r in mu),
                sum(tokens(b) for b in bs) + sum(sum(r[4:8]) for r in mu))

    old, new = rows(saved), rows(fresh)
    result = dict(fresh)
    for field in ('buckets', 'meters', 'events', 'meter_readings', 'meter_usage', 'sessions'):
        result[field] = []
    kept, sessions = [], {}
    metadata = [{(s['provider'], s['id']): s for s in scan.get('sessions', [])} for scan in (saved, fresh)]
    for key in sorted(old.keys() | new.keys()):
        # Issue #24: machine + local day + provider; compare this run's API-list USD, then total
        # tokens, with fresh winning a full tie. Keep ONE whole unit, never sum/union its buckets.
        use_old = key in old and (key not in new or score(old[key]) > score(new[key]))
        unit, meta = (old[key], metadata[0]) if use_old else (new[key], metadata[1])
        if use_old:
            kept.append({'day': key[0], 'provider': key[1]})
        for field, rs in unit.items():
            if field == 'meter_readings':
                source_fields = saved['meter_fields'] if use_old else fresh['meter_fields']
                rs = [[dict(zip(source_fields, r)).get(f) for f in result['meter_fields']] for r in rs]
            result[field].extend(rs)
        # A session can span winning units from both scans. Recount just the selected buckets so
        # cross-machine session deduplication sees their actual combined size, not a stale total.
        for b in unit.get('buckets', []):
            k = (b['provider'], b['session'])
            m = meta.get(k, {})
            first = m.get('first', '') if m.get('first', '')[:13] == b['hour'] else b['hour'] + ':00:00Z'
            last = m.get('last', '') if m.get('last', '')[:13] == b['hour'] else b['hour'] + ':00:00Z'
            if k not in sessions:
                sessions[k] = dict(m, provider=k[0], id=k[1], first=first, last=last, tokens=0)
            s = sessions[k]
            s['tokens'] += tokens(b)
            s['first'], s['last'] = min(s['first'], first), max(s['last'], last)
    if not kept:
        return fresh, []
    result['sessions'] = list(sessions.values())
    result['since'] = min(saved['since'], fresh['since'])
    result['days'] = max(saved.get('days', 0), fresh.get('days', 0))
    # Keep the account metadata needed to interpret retained Claude meter rows after log rotation.
    result['accounts'] = {**saved.get('accounts', {}), **fresh.get('accounts', {})}
    logins = {a['account']: a for scan in (saved, fresh) for a in scan.get('accounts', {}).get('claude_current_login', [])}
    if logins:
        result['accounts']['claude_current_login'] = list(logins.values())
    ag_old, ag_new = (scan.get('accounts', {}).get('antigravity') or {} for scan in (saved, fresh))
    if ag_old or ag_new:
        timelines = {}
        for ag in (ag_old, ag_new):
            for session, timeline in (ag.get('conv_model_timeline') or {}).items():
                timelines.setdefault(session, {}).update(dict(timeline))
        result['accounts']['antigravity'] = {**ag_old, **ag_new, 'conv_model_timeline': {
            s: sorted(t.items()) for s, t in timelines.items()}}
    return result, kept


def main(run_dir, keep_dir):
    with open(os.path.join(os.path.dirname(__file__), 'prices.json')) as f:
        prices = json.load(f)
    retained, scans, usage = [], {}, {}
    for name in sorted(os.listdir(run_dir)):
        prior = os.path.join(keep_dir, name)
        if not name.endswith('.json'):
            continue
        saved = None
        if os.path.exists(prior):
            with open(prior) as f:
                saved = json.load(f)
        current = os.path.join(run_dir, name)
        with open(current) as f:
            fresh = json.load(f)
        scans[name] = (saved, fresh)
    # Fit once from this run's candidate rows across machines, with fresh rows winning ID ties.
    # A model with no reported price stays unpriced, exactly as in weekly.py (tokens break its tie).
    for index in (0, 1):
        for pair in scans.values():
            for r in (pair[index] or {}).get('meter_usage', []): usage[r[0]] = r
    meter_prices = fit_meter_prices(usage.values())
    for name, (saved, fresh) in scans.items():
        if saved is None:
            continue
        current = os.path.join(run_dir, name)
        merged, units = merge(saved, fresh, prices, meter_prices)
        if units:
            with open(current, 'w') as f:
                json.dump(merged, f, separators=(',', ':'))
            retained.append({'machine': 'this machine' if name == 'local.json' else name[:-5],
                             'days_kept': len({u['day'] for u in units}), 'units': units})
    print(json.dumps(retained))


if __name__ == '__main__':
    main(*sys.argv[1:])
