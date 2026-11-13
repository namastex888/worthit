// worthit blocks: each function takes the week's data (and a few agent-written props) and returns ANSI lines.
// The agent never draws: it names a block, the harness draws it the same way every time.
export const C = { ink: '#f4f4f2', ink2: '#b4b4ae', ink3: '#74747a', line: '#3d3d46', track: '#26262c', cl: '#4c94f0', go: '#ee7440', cx: '#27b888',
                   gold: '#f2c14e', red: '#ef6b6b', pink: '#c77dff' };
export const W = 98;
const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = a => '#' + a.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * Math.max(0, Math.min(1, t)))); };
const NAMED = { green: C.cx, red: C.red, blue: C.cl, orange: C.go, gold: C.gold, yellow: C.gold, pink: C.pink, purple: C.pink, magenta: C.pink, cyan: C.cl, white: C.ink, gray: C.ink3, grey: C.ink3 };
const col = (c, dflt) => /^#[0-9a-f]{6}$/i.test(c || '') ? c : NAMED[String(c || '').toLowerCase()] || dflt;
export const fg = (h, s) => { const [r, g, b] = rgb(h); return `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`; };
export const bold = s => `\x1b[1m${s}\x1b[22m`, ital = s => `\x1b[3m${s}\x1b[23m`;
export const d = s => fg(C.ink3, s), m = s => fg(C.ink2, s), w = s => fg(C.ink, s);
export const grad = (s, a, b, c) => { const ch = [...s], n = Math.max(1, ch.length - 1); return ch.map((x, i) => x === ' ' ? x : fg(c ? (i / n < .5 ? mix(a, b, i / n * 2) : mix(b, c, (i / n - .5) * 2)) : mix(a, b, i / n), x)).join(''); };
export const fmtTok = n => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e7 ? Math.round(n / 1e6) + 'M' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(Math.round(n));
export const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
export const len = s => [...strip(s)].length;
export const pad = (s, n) => s + ' '.repeat(Math.max(0, n - len(s)));
export const lpad = (s, n) => ' '.repeat(Math.max(0, n - len(s))) + s;
function clip(l, n) { if (len(l) <= n) return l; let o = '', c = 0; for (const t of l.split(/(\x1b\[[0-9;]*m)/)) { if (t.startsWith('\x1b')) { o += t; continue; } for (const ch of t) if (c < n) { o += ch; c++; } } return o + '\x1b[39m\x1b[22m\x1b[23m'; }
const EI = ' ▏▎▍▌▋▊▉█';
export function bar(v, max, n, c1, c2, track = true) {
  const cells = Math.max(0, Math.min(1, max ? v / max : 0)) * n, full = Math.floor(cells), part = Math.round((cells - full) * 8);
  let o = ''; for (let i = 0; i < full; i++) o += fg(mix(c1, c2, i / Math.max(1, n - 1)), '█');
  let used = full; if (part && full < n) { o += fg(mix(c1, c2, full / Math.max(1, n - 1)), EI[part]); used++; }
  return o + (track ? fg(C.track, '█'.repeat(n - used)) : ' '.repeat(n - used));
}
const dark = c => mix(c, '#000000', .35);
const spark = (a, c) => { const mx = Math.max(...a) || 1; return a.map((v, i) => fg(i === a.length - 1 ? c : mix(C.track, c, .55), ' ▁▂▃▄▅▆▇█'[Math.max(1, Math.round(v / mx * 8))])).join(''); };
function box(title, lines, width, color, right = '', h = 0) {
  const inner = width - 4, t = title ? ' ' + bold(fg(color, title)) + ' ' : '', r = right ? ' ' + d(right) + ' ' : '';
  const top = fg(C.line, '╭─') + t + fg(C.line, '─'.repeat(Math.max(0, width - 4 - len(t) - len(r)))) + r + fg(C.line, '─╮');
  const body = lines.slice(); while (body.length < h) body.push('');
  return [top, ...body.map(l => fg(C.line, '│') + ' ' + pad(clip(l, inner), inner) + ' ' + fg(C.line, '│')), fg(C.line, '╰' + '─'.repeat(width - 2) + '╯')];
}
export const hstack = (boxes, gap = 1) => boxes[0].map((_, i) => boxes.map(b => b[i]).join(' '.repeat(gap)));
const row = (defs, gap = 1) => { const h = Math.max(...defs.map(x => x.lines.length)); return hstack(defs.map(x => box(x.title, x.lines, x.w, x.color, x.right, h)), gap); };
export const usd = n => '$' + Math.round(n).toLocaleString('en-US');
const delta = (pct, goodWhenUp = true) => { if (pct == null) return d('no earlier week'); const up = pct >= 0, good = up === goodWhenUp; return fg(good ? C.cx : C.red, (up ? '▲ ' : '▼ ') + Math.abs(pct) + '%'); };
function wrap(text, n) { const out = []; let l = ''; for (const word of String(text).split(/\s+/)) { if ((l + ' ' + word).trim().length > n) { out.push(l); l = word; } else l = (l + ' ' + word).trim(); } if (l) out.push(l); return out; }

// ---------------------------------------------------------------- blocks
export const blocks = {
  Verdict: (D, p) => [fg(C.gold, '→') + ' ' + bold(w(clip(String(p.text || ''), W - 3)))],

  Tiles(D) {
    const t = [{ title: 'TOKENS OUT', color: C.pink, v: fmtTok(D.totals.output_tokens), dl: delta(D.totals.output_tokens_change_pct) + d(' vs prev 7 d'), sp: spark(D.totals.tokens_per_day, C.pink) },
               { title: 'VALUE USED', color: C.gold, v: usd(D.totals.api_value_usd), dl: delta(D.totals.api_value_change_pct) + d(' vs prev 7 d'), sp: spark(D.totals.value_per_day, C.gold) }];
    if (D.git) t.push({ title: 'SHIPPED', color: C.cx, v: D.git.merged_prs + ' PRs', dl: delta(D.git.merged_prs_change_pct) + d(' vs prev 7 d'), sp: spark(D.git.prs_per_day, C.cx), note: fmtTok(D.git.commits) + ' commits' },
                      { title: 'COST PER PR', color: C.cl, v: D.git.usd_per_merged_pr == null ? 'n/a' : '$' + D.git.usd_per_merged_pr.toFixed(2), dl: delta(D.git.usd_per_pr_change_pct, false) + d(' vs prev 7 d'), sp: spark(D.git.usd_per_pr_per_day, C.cl) });
    const wd = t.length === 4 ? 24 : 48;
    return row(t.map((x, i) => ({ title: x.title, color: x.color, w: i === t.length - 1 ? W - (wd + 1) * (t.length - 1) : wd, lines: [bold(w(x.v)), x.dl, x.sp + d(' ' + (x.note || '7 days'))] })));
  },

  LevelCard(D) {
    const g = D.game; const l = [bold(fg(C.gold, 'LEVEL ' + g.level)) + '  ' + bold(w(g.title.toUpperCase())), bar(g.xp, g.xp_next, 16, C.gold, C.go) + ' ' + m(g.xp.toLocaleString('en-US')) + d(' / ' + g.xp_next.toLocaleString('en-US') + ' XP'), '',
      fg(C.go, '◆') + ' ' + w(g.streak_days + '-day streak') + d('  ' + g.days_tracked + ' days tracked')];
    for (const b of g.personal_bests || []) l.push(fg(C.gold, '★') + ' ' + w('personal best') + d('  ' + b));
    const un = (D.waste || []).reduce((s, x) => s + x.unused_usd, 0), risk = (D.waste || []).reduce((s, x) => s + (x.at_risk_usd || 0), 0);
    l.push('', !(D.waste || []).length ? d('badges unlock as weeks close') : un ? fg(C.track, '■') + d(' Zero Waste badge  (' + usd(un) + ' away)') : risk ? fg(C.track, '■') + d(' Zero Waste badge  (' + usd(risk) + ' still open)') : fg(C.cx, '■') + m(' Zero Waste badge earned'));
    while (l.length < 9) l.splice(l.length - 1, 0, '');
    return box('YOU', l, 41, C.gold);
  },

  PlanRanking(D) {
    if (!D.plans.length) return box('WHICH PLAN GAVE MORE', [m('No finished weekly limit in your logs yet.'), d('A plan is ranked once its weekly meter runs to the cap,'), d('or closes, inside the scanned days.')], 56, C.ink, '$ per full weekly limit', 9);
    const ps = [...D.plans].sort((a, b) => b.usd_per_full_week - a.usd_per_full_week), mx = ps[0].usd_per_full_week;
    const l = ps.map((p, i) => bold(w(String(i + 1))) + ' ' + pad(fg(p.color, p.plan), 16) + lpad(bold(w(usd(p.usd_per_full_week))), 7) + ' ' + bar(p.usd_per_full_week, mx, 13, dark(p.color), p.color, false) + lpad(w(p.times_plan_price + '×'), 4) + ' ' + d(p.proof));
    while (l.length < 7) l.push('');
    l.push(d('measured  meter + every machine on the account'), d('floor     use elsewhere not counted: value ≥ shown'));
    return box('WHICH PLAN GAVE MORE', l, 56, C.ink, '$ per full weekly limit');
  },

  Receipts(D) {
    if (!D.plans.length) return [];
    const k = D.plans.length, wd = Math.floor((W - (k - 1)) / k), n = wd - 4;
    return row(D.plans.map((p, i) => { const a = p.meter_from ?? 0, b = p.meter_to ?? 100, pre = Math.round(a / 100 * n), mid = Math.round((b - a) / 100 * n);
      return { title: p.plan, color: p.color, right: p.proof, w: i === k - 1 ? W - (wd + 1) * (k - 1) : wd, lines: [
        fg(C.track, '█'.repeat(pre)) + bar(1, 1, mid, dark(p.color), p.color) + fg(C.track, '█'.repeat(Math.max(0, n - pre - mid))),
        m(p.meter), d('tokens ') + m(p.tokens), d('priced ') + w(usd(p.priced_usd)), d('scaled ') + m('÷ ' + p.fraction_of_week + ' weekly limits'),
        d('     = ') + bold(fg(p.color, usd(p.usd_per_full_week))) + d(' per week'), d('price  ') + m('÷ $' + p.plan_usd_per_week + ' plan') + d(' = ') + bold(w(p.times_plan_price + '×'))] }; }));
  },

  Heatmap(D) {
    const cell = v => fg(v < .5 ? mix('#17171c', C.cl, v * 2) : mix(C.cl, C.pink, (v - .5) * 2), '██');
    const mx = Math.max(...D.heat.rows.flat()) || 1;
    const l = [d('     ' + [0, 3, 6, 9, 12, 15, 18, 21].map(h => pad(String(h).padStart(2, '0'), 6)).join(''))];
    D.heat.days.forEach((n, i) => l.push(m(n) + '  ' + D.heat.rows[i].map(v => cell(v / mx)).join('')));
    l.push(d('     less ') + [0, .25, .5, .75, 1].map(cell).join('') + d(' more') + m('   ' + D.heat.note));
    return box('WHEN YOU WORKED', l, 58, C.pink, 'output tokens per hour');
  },

  LimitTrend(D) {
    if (!D.plans.length) return box('DID THE LIMIT MOVE', [d('needs one finished week')], 39, C.cx, '', 9);
    const p = D.plans.find(x => (x.history || []).length > 1) || D.plans[0], cv = p.history, mx = Math.max(...cv), l = [];
    for (let r = 4; r >= 0; r--) l.push(d(r === 4 ? lpad(usd(mx), 6) + ' ' : r === 0 ? '    $0 ' : '       ') + cv.map((v, i) => fg(i === cv.length - 1 ? p.color : mix(C.track, p.color, .6), ' ▁▂▃▄▅▆▇█'[Math.round(Math.max(0, Math.min(1, v / mx * 5 - r)) * 8)].repeat(3))).join(' '));
    l.push('');
    for (const q of D.plans) l.push(pad(fg(q.color, q.plan.replace(' AI', '')), 13) + bold(w(usd(q.usd_per_full_week))) + '  ' + (q.change_vs_last_week_pct != null ? delta(q.change_vs_last_week_pct) + d(' vs last') : d('first reading')));
    return box('DID THE LIMIT MOVE', l, 39, C.cx, cv.length + ' weeks');
  },

  Events(D) {
    const ev = D.events || []; if (!ev.length) return box('EVENTS THIS WEEK', [d('No reset, limit change or launch on record for these 7 days.')], W, C.gold, 'core/events.csv');
    const l = [d(pad('Date', 12) + pad('Provider', 10) + pad('Type', 14) + 'What happened')];
    for (const e of ev) { const c = (D.plans.find(p => p.key === e.provider) || {}).color || C.ink2;
      l.push(m(pad(e.date, 12)) + fg(c, pad(e.provider, 10)) + (e.type === 'reset' ? bold(w(pad(e.type, 14))) : d(pad(e.type.replace('_', ' '), 14))) + w(e.title.slice(0, W - 42)) + (e.confidence !== 'high' ? d(' (' + e.confidence + ')') : '')); }
    return box('EVENTS THIS WEEK', l, W, C.gold, 'listed for context · not assumed used');
  },
  Months(D) {                       // grouped bars: one group per month, one bar per plan, height = API value used
    const ms = D.months || []; if (!ms.length) return [];
    const order = ['claude', 'codex', 'google'], keys = order.filter(k => ms.some(x => x.key === k)), all = [...new Set(ms.map(x => x.month))].sort();
    const inner = W - 4, axis = 7, n = Math.min(all.length, Math.max(1, Math.floor((inner - axis) / (keys.length * 6 + 3)))), months = all.slice(-n);
    const g = Math.floor((inner - axis) / n), slot = Math.min(9, Math.floor((g - 2) / keys.length)), bw = slot - 1, H = 8;
    const at = (mo, k) => ms.find(x => x.month === mo && x.key === k), max = Math.max(1, ...months.flatMap(mo => keys.map(k => (at(mo, k) || {}).api_usd_used || 0)));
    const short = v => v >= 9950 ? '$' + Math.round(v / 1000) + 'K' : v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'K' : '$' + Math.round(v);
    const mid = (t, wd) => { const a = Math.max(0, Math.floor((wd - t.length) / 2)); return ' '.repeat(a) + t + ' '.repeat(Math.max(0, wd - a - t.length)); };
    const part = ' ▁▂▃▄▅▆▇█', lines = [];
    const color = k => (ms.find(x => x.key === k) || {}).color || C.ink2;
    lines.push(keys.map(k => fg(color(k), '■ ') + m((ms.find(x => x.key === k) || {}).plan)).join('   '));
    for (let r = H; r >= 0; r--) {             // row H is headroom for the tallest bar's label
      let line = d(lpad(r === H - 1 ? short(max) : r === 0 ? '$0' : '', axis - 1)) + ' ';
      for (const mo of months) { let cell = '';
        for (const k of keys) { const x = at(mo, k), v = x ? x.api_usd_used : 0, e = Math.max(x ? 1 : 0, Math.round(v / max * H * 8)), full = Math.floor(e / 8), rem = e % 8, top = full + (rem ? 1 : 0);
          if (r < full) cell += fg(color(k), '█'.repeat(bw)) + ' ';
          else if (r === full && rem) cell += fg(color(k), part[rem].repeat(bw)) + ' ';
          else if (r === top && x) cell += bold(w(mid(short(v), slot)));
          else cell += ' '.repeat(slot); }
        line += cell + ' '.repeat(g - slot * keys.length); }
      lines.push(line);
    }
    lines.push(' '.repeat(axis) + months.map(mo => keys.map(k => { const x = at(mo, k); return x ? bold(fg(color(k), mid((x.used_times_plan_price >= 100 ? Math.round(x.used_times_plan_price) : x.used_times_plan_price) + '×', slot))) : ' '.repeat(slot); }).join('') + ' '.repeat(g - slot * keys.length)).join(''));
    lines.push(' '.repeat(axis) + months.map(mo => { const days = Math.max(...keys.map(k => (at(mo, k) || {}).days_tracked || 0)); return w(mo) + d(' · ' + days + ' days') + ' '.repeat(Math.max(0, g - mo.length - (' · ' + days + ' days').length)); }).join(''));
    return box('MONTH BY MONTH', lines, W, C.cx, 'API value used · under each bar: × one $' + ms[0].plan_usd_per_month + ' plan');
  },
  ModelMix(D) {                     // two line charts: each model's share week by week, and open-weight vs closed
    const X = D.model_mix; if (!X || !X.series.length) return [];
    // solid lines from half-block pixels (two per character row), a round marker on every week's point
    const plot = (S, cols, rows, max) => { const Hd = rows * 2, px = Array.from({ length: Hd }, () => Array(cols).fill(null)), mark = Array.from({ length: rows }, () => Array(cols).fill(null));
      const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < cols && y < Hd) px[y][x] = c; };
      for (const s of S) { const n = s.vals.length, X = i => n === 1 ? Math.round((cols - 1) / 2) : Math.round(i * (cols - 1) / (n - 1)), Y = v => (Hd - 1) - Math.min(1, v / max) * (Hd - 1);
        if (n === 1) { for (let x = 0; x < cols; x++) set(x, Math.round(Y(s.vals[0])), s.color); }
        for (let i = 0; i < n - 1; i++) { const x0 = X(i), x1 = X(i + 1); let prev = Math.round(Y(s.vals[i]));
          for (let x = x0; x <= x1; x++) { const y = Math.round(Y(s.vals[i]) + (Y(s.vals[i + 1]) - Y(s.vals[i])) * (x - x0) / Math.max(1, x1 - x0)); for (let k = Math.min(prev, y); k <= Math.max(prev, y); k++) set(x, k, s.color); prev = y; } }
        for (let i = 0; i < n; i++) mark[Math.min(rows - 1, Math.floor(Math.round(Y(s.vals[i])) / 2))][X(i)] = s.color; }
      return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, x) => { const t = px[2 * r][x], b = px[2 * r + 1][x], k = mark[r][x];
        return k ? fg(k, '●') : t && b && t === b ? fg(t, '█') : t ? fg(t, '▀') : b ? fg(b, '▄') : ' '; }).join('')); };
    const chart = (S, cols, rows) => { const max = Math.max(10, Math.ceil(Math.max(...S.flatMap(s => s.vals)) / 10) * 10), body = plot(S, cols, rows, max), n = X.weeks.length;
      const out = body.map((l, i) => d(lpad(i === 0 ? max + '%' : i === rows - 1 ? '0%' : '', 4)) + ' ' + l);
      const lab = Array(cols).fill(' '), put = (t, at) => { const a = Math.max(0, Math.min(cols - t.length, Math.round(at - t.length / 2))); for (let i = 0; i < t.length; i++) lab[a + i] = t[i]; };
      const idx = n <= 2 ? [...Array(n).keys()] : n <= 4 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1]; for (const i of idx) put(X.weeks[i], n === 1 ? cols / 2 : i * (cols - 1) / (n - 1));
      out.push('     ' + d(lab.join(''))); return out; };
    const pal = [C.cl, C.cx, C.go, C.pink, C.gold, C.red, '#8a8a93'], S = X.series.map((s, i) => ({ ...s, color: s.model === 'other' ? '#8a8a93' : pal[i % pal.length], vals: s.share_pct }));
    const chg = s => s.change_pts == null ? d('  first week') : Math.abs(s.change_pts) < 0.5 ? d('  =') : s.change_pts > 0 ? fg(C.cx, ' ▲' + Math.abs(s.change_pts).toFixed(0)) : fg(C.red, ' ▼' + Math.abs(s.change_pts).toFixed(0));
    const wl = 58, wr = W - wl - 1, left = chart([...S].reverse(), wl - 4 - 5, 10);            // biggest series drawn last, on top
    left.push(''); for (let i = 0; i < S.length; i += 2) left.push(S.slice(i, i + 2).map(s => fg(s.color, '■ ') + pad(w(s.model.slice(0, 15)), 15) + lpad(m(Math.round(s.share_pct[s.share_pct.length - 1]) + '%'), 4) + pad(chg(s), 5)).join('  '));
    const O = { ...X.open, color: C.cx, vals: X.open.share_pct }, K = { ...X.closed, color: C.cl, vals: X.closed.share_pct }, right = chart([K, O], wr - 4 - 5, 6), cw = 10;
    const rowOf = (label, f) => d(pad(label, 13)) + lpad(f(O), cw) + lpad(f(K), cw);
    right.push('', pad('', 13) + lpad(fg(C.cx, '■ ') + w('open'), cw) + lpad(fg(C.cl, '■ ') + w('closed'), cw),
      rowOf('share', s => bold(w(Math.round(s.share_pct[s.share_pct.length - 1]) + '%')) ), rowOf('vs last week', s => chg(s)),
      rowOf('output', s => m(fmtTok(s.output_tokens))), rowOf('API value', s => m(usd(s.api_usd))), rowOf('$ per M out', s => m(s.usd_per_m_output == null ? '·' : '$' + s.usd_per_m_output)));
    return row([{ title: 'MODEL MIX', color: C.pink, right: 'share of output tokens · 7-day blocks', w: wl, lines: left }, { title: 'OPEN vs CLOSED', color: C.cx, right: 'weights', w: wr, lines: right }]);
  },
  WasteTable(D) {
    const l = [d(pad('Plan', 18) + lpad('Limit', 7) + '   ' + pad('You used', 31) + '   ' + lpad('Unused', 6) + '   Why')];
    if (!D.waste.length) return box('SUBSCRIPTION WASTE', [d('No account week closed in the last 7 days.')], W, C.red);
    for (const x of D.waste) { const c = (D.plans.find(p => x.account.startsWith(p.plan)) || {}).color || C.ink2;
      l.push(pad(fg(c, x.account), 18) + lpad(w(usd(x.limit_usd)), 7) + '   ' + bar(x.used_pct, 100, 26, dark(c), c) + ' ' + lpad(w(x.used_pct + '%'), 4) + '   ' + lpad(bold(fg(x.unused_usd ? C.red : C.ink3, usd(x.unused_usd))), 6) + '   ' + fg(x.unused_usd ? C.gold : x.open ? C.ink2 : C.ink3, x.why)); }
    const un = D.waste.reduce((s, x) => s + x.unused_usd, 0);
    if (D.waste_hidden) l.push(d(D.waste_hidden + ' smaller account-weeks not shown'));
    l.push(d(pad('Total unused', 18) + lpad('', 7) + '   ' + pad('', 31) + '   ') + lpad(bold(fg(un ? C.red : C.ink3, usd(un))), 6));
    return box('SUBSCRIPTION WASTE', l, W, C.red, 'unused allowance is not the provider\'s fault');
  },

  Summary: (D, p) => box('EXECUTIVE SUMMARY', wrap(p.text || '', W - 6).map(x => ital(w(x))), W, C.gold, p.by || ''),

  // free-form blocks for answers: the agent supplies labels and values, the harness draws them
  Chart(D, p) {
    const items = (p.items || []).slice(0, 12), mx = Math.max(...items.map(x => +x.value || 0), 0) || 1, lw = Math.min(26, Math.max(...items.map(x => String(x.label).length), 4)), bw = W - 4 - lw - 14;
    const val = v => (p.unit === '$' ? usd(v) : (+v).toLocaleString('en-US') + (p.unit && p.unit !== '$' ? p.unit : ''));
    const l = items.map(x => { const c = col(x.color, (D.plans.find(q => String(x.label).startsWith(q.plan)) || {}).color || C.cl); return pad(fg(c, clip(String(x.label), lw)), lw) + ' ' + bar(+x.value || 0, mx, bw, dark(c), c, false) + ' ' + lpad(bold(w(val(x.value))), 9) + (x.note ? ' ' + d(x.note) : ''); });
    if (p.note) l.push('', ...wrap(p.note, W - 6).map(d));
    return box(String(p.title || 'CHART').toUpperCase(), l, W, C.cl, p.subtitle || '');
  },
  Facts(D, p) {
    const it = (p.items || []).slice(0, 4); if (!it.length) return [];
    const wd = Math.floor((W - (it.length - 1)) / it.length);
    return row(it.map((x, i) => ({ title: String(x.label || '').toUpperCase(), color: col(x.color, [C.pink, C.gold, C.cx, C.cl][i % 4]), w: i === it.length - 1 ? W - (wd + 1) * (it.length - 1) : wd, lines: [bold(w(String(x.value ?? ''))), x.note ? m(String(x.note)) : ''] })));
  },
  Note: (D, p) => wrap(p.text || '', W - 2).map(x => ' ' + m(x)),
};
export const widths = { Verdict: W, Tiles: W, LevelCard: 41, PlanRanking: 56, Receipts: W, Heatmap: 58, LimitTrend: 39, WasteTable: W, Events: W, Months: W, ModelMix: W, Summary: W, Chart: W, Facts: W, Note: W };
