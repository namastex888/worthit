"""Shared API-list pricing for scan retention and weekly reports."""
from collections import Counter, defaultdict
import time

def price(b, PR, unpriced=None):
    if unpriced is None: unpriced = Counter()
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


# Tool-store rows with no reported cost use the same inferred prices as the weekly report.
def _fit(rows):
    n = [[0.0] * 3 for _ in range(3)]; y = [0.0] * 3
    for r in rows:
        x = (r[4] / 1e6, r[5] / 1e6, r[7] / 1e6)
        for i in range(3):
            y[i] += x[i] * r[10]
            for j in range(3): n[i][j] += x[i] * x[j]
    def det(m): return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))
    d = det(n)
    if abs(d) < 1e-12: return None
    k = []
    for i in range(3):
        m = [row[:] for row in n]
        for j in range(3): m[j][i] = y[j]
        k.append(det(m) / d)
    tot = sum(r[10] for r in rows); err = sum(abs(k[0] * r[4] / 1e6 + k[1] * r[5] / 1e6 + k[2] * r[7] / 1e6 - r[10]) for r in rows)
    if min(k) < -1e-6 or tot <= 0 or err / tot > 0.05: return None
    return {'input_per_m': round(max(k[0], 0), 4), 'cached_input_per_m': round(max(k[1], 0), 4), 'output_per_m': round(max(k[2], 0), 4), 'rows': len(rows), 'fit_error_pct': round(100 * err / tot, 2)}
def _price(f_, r): return (f_['input_per_m'] * r[4] + f_['cached_input_per_m'] * r[5] + f_['output_per_m'] * r[7]) / 1e6
def _bands(rs):
    by = defaultdict(list)
    for r in rs: by[time.gmtime(r[1] / 1000.0).tm_hour // 3].append(r)
    good = {b: f for b, f in ((b, _fit(x)) for b, x in by.items() if len(x) >= 8) if f}
    if not good:
        whole = _fit(rs)
        return {b: dict(whole, how='fit, all hours') for b in range(8)} if whole else None
    base = max(good.values(), key=lambda f: f['rows'])
    out = {}
    for b in range(8):
        if b in good: out[b] = dict(good[b], how='fit')
        elif by.get(b):
            bp = sum(_price(base, r) for r in by[b]); mult = sum(r[10] for r in by[b]) / bp if bp > 0 else 1.0
            out[b] = {'input_per_m': round(base['input_per_m'] * mult, 4), 'cached_input_per_m': round(base['cached_input_per_m'] * mult, 4), 'output_per_m': round(base['output_per_m'] * mult, 4),
                      'rows': len(by[b]), 'how': 'base rate x %.2f' % mult}
        else: out[b] = dict(base, how='base rate, no reported cost in these hours')
    return out

def fit_meter_prices(rows):
    by_model = defaultdict(list)
    for r in rows:
        if r[10]: by_model[r[3]].append(r)
    return {m: f for m, f in ((m, _bands(rs)) for m, rs in by_model.items() if len(rs) >= 8) if f}

def meter_price(row, fitted):
    if row[10] is not None: return row[10]
    if row[3] in fitted: return _price(fitted[row[3]][time.gmtime(row[1] / 1000.0).tm_hour // 3], row)
    return None
