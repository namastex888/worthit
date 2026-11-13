// The share card: one image made to be read in a feed. One headline number, one caption, up to four rows.
// cardSpec() turns the week's data into that shape per topic; cardHtml() draws it at 1600x900.
import { C, usd } from './draw.mjs';

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const day = iso => { const t = new Date(iso + 'T00:00:00Z'); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
const measured = p => p.proof === 'measured';
// what to say beside a plan's number: a floor is "at least" and is never compared week to week
const moved = p => !measured(p) ? { t: 'at least', c: C.ink3 } : p.change_vs_last_week_pct == null ? { t: 'measured', c: C.ink3 }
  : { t: `${p.change_vs_last_week_pct >= 0 ? '▲' : '▼'} ${Math.abs(p.change_vs_last_week_pct)}% vs last week`, c: p.change_vs_last_week_pct >= 0 ? C.cx : C.red };
const proofLine = D => { const a = D.plans.filter(measured).map(p => p.plan), b = D.plans.filter(p => !measured(p)).map(p => p.plan);
  return !b.length ? 'every plan measured' : !a.length ? 'every plan is a floor: at least this much' : `${a.join(', ')} measured · the others at least`; };

export const CARD_TOPICS = {
  allowance(D) { const ps = D.plans.slice().sort((a, b) => measured(b) - measured(a) || b.usd_per_full_week - a.usd_per_full_week), h = ps[0], mx = Math.max(...ps.map(p => p.usd_per_full_week)), mv = moved(h);
    return { eyebrow: 'Weekly AI allowance check', hero: usd(h.usd_per_full_week), color: h.color, cap: `of API-priced usage in one ${h.plan} weekly limit`, sub: mv.t, subColor: mv.c,
      rows: ps.map(p => ({ label: p.plan, pct: p.usd_per_full_week / mx, color: p.color, value: usd(p.usd_per_full_week), note: moved(p).t })) }; },
  value(D) { const p = D.plans.slice().sort((a, b) => b.times_plan_price - a.times_plan_price)[0];
    return { eyebrow: 'The receipt', hero: p.times_plan_price + '×', color: p.color, cap: `what I pay for ${p.plan}, back in API-priced usage`, sub: measured(p) ? 'measured from the plan\'s own meter' : 'at least', subColor: C.ink3,
      rows: [{ label: 'one weekly limit', pct: 1, color: p.color, value: usd(p.usd_per_full_week), note: '' }, { label: 'the plan, per week', pct: p.plan_usd_per_week / p.usd_per_full_week, color: C.ink3, value: usd(p.plan_usd_per_week), note: '' }] }; },
  ranking(D) { const ps = D.plans.slice().sort((a, b) => b.times_plan_price - a.times_plan_price), h = ps[0];
    return { eyebrow: 'Which AI plan gives more for its price', hero: h.times_plan_price + '×', color: h.color, cap: `${h.plan} gives the most for its price`, sub: 'API-priced usage in one weekly limit ÷ its price', subColor: C.ink3,
      rows: ps.map(p => ({ label: p.plan, pct: p.times_plan_price / h.times_plan_price, color: p.color, value: p.times_plan_price + '×', note: usd(p.usd_per_full_week) + (measured(p) ? ' measured' : ' at least') })) }; },
  open(D) { const o = D.model_mix.open, c = D.model_mix.closed, n = o.share_pct.length - 1, s = Math.round(o.share_pct[n]), ch = o.change_pts;
    return { eyebrow: 'Open vs closed models', hero: s + '%', color: C.cx, cap: 'of my AI coding output ran on open models', sub: ch == null || Math.abs(ch) < 0.5 ? 'this week' : `${ch > 0 ? '▲' : '▼'} ${Math.abs(Math.round(ch))} pts vs last week`, subColor: C.ink3,
      rows: [{ label: 'open models', pct: s / 100, color: C.cx, value: s + '%', note: `$${o.usd_per_m_output} per M output` }, { label: 'closed models', pct: 1 - s / 100, color: C.cl, value: (100 - s) + '%', note: `$${c.usd_per_m_output} per M output` }] }; },
  models(D) { const n = D.model_mix.weeks.length - 1, top = D.model_mix.series.filter(x => !x.models).sort((a, b) => b.share_pct[n] - a.share_pct[n]).slice(0, 4), h = top[0], col = x => x.open ? C.cx : C.cl;
    return { eyebrow: 'My model mix this week', hero: Math.round(h.share_pct[n]) + '%', color: col(h), cap: `of my output tokens came from ${h.model}`, sub: 'most used first', subColor: C.ink3,
      rows: top.map(x => ({ label: x.model, pct: x.share_pct[n] / h.share_pct[n], color: col(x), value: Math.round(x.share_pct[n]) + '%', note: x.open ? 'open' : 'closed' })) }; },
  waste(D) { const un = D.waste.reduce((a, x) => a + (x.unused_usd || 0), 0), risk = D.waste.reduce((a, x) => a + (x.at_risk_usd || 0), 0), color = name => (D.plans.find(p => name.startsWith(p.plan.split(' ')[0])) || {}).color || C.ink2;
    return { eyebrow: 'AI allowance I paid for and did not use', hero: usd(un), color: un ? C.red : C.cx, cap: un ? 'of weekly allowance left unused last week' : 'unused: every weekly limit was spent', sub: risk ? `${usd(risk)} more still open before the reset` : '', subColor: C.gold,
      rows: D.waste.slice().sort((a, b) => (b.unused_usd || 0) - (a.unused_usd || 0)).slice(0, 4).map(x => ({ label: x.account, pct: x.used_pct / 100, color: color(x.account), value: x.used_pct + '% used', note: x.unused_usd ? usd(x.unused_usd) + ' unused' : 'hit the cap' })),
      foot: proofLine(D) }; },
};

export const cardSpec = (key, D) => ({ foot: '', ...CARD_TOPICS[key](D), date: '7 days to ' + day(D.week.to) });
// a card the person's agent described: one number, what it is, and up to four facts (no bars)
export const customSpec = (D, title, j) => ({ eyebrow: title.slice(0, 46), hero: String(j.headline).slice(0, 9), color: C.pink, cap: String(j.caption || '').slice(0, 64), sub: '', subColor: C.ink3, foot: '', plain: true,
  rows: (j.facts || []).slice(0, 4).map(f => ({ label: String(f.label).slice(0, 26), pct: null, color: C.ink2, value: String(f.value).slice(0, 16), note: '' })), date: '7 days to ' + day(D.week.to) });

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function cardHtml(s) {
  const heroSize = s.hero.length > 7 ? 150 : s.hero.length > 5 ? 180 : 210, bars = s.rows.some(r => r.pct != null);
  const rows = s.rows.map(r => `<div class="row${bars ? '' : ' nobar'}"><span class="label" style="color:${r.color}">${esc(r.label)}</span>`
    + (bars ? `<span class="track"><span class="fill" style="width:${Math.max(1.5, Math.min(100, (r.pct || 0) * 100)).toFixed(1)}%;background:${r.color}"></span></span>` : '<span class="dots"></span>')
    + `<span class="value">${esc(r.value)}</span>${bars ? `<span class="note">${esc(r.note)}</span>` : ''}</div>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1600px;height:900px;background:#0a0a0c;color:${C.ink};font-family:"SF Mono",ui-monospace,Menlo,Consolas,"DejaVu Sans Mono",monospace;-webkit-font-smoothing:antialiased}
body{display:flex;flex-direction:column;padding:60px 76px 56px}
.top{display:flex;justify-content:space-between;align-items:baseline}
.mark{font-size:44px;font-weight:800;letter-spacing:.14em;background:linear-gradient(90deg,${C.cl},${C.pink} 55%,${C.go});-webkit-background-clip:text;background-clip:text;color:transparent}
.date{font-size:28px;color:${C.ink3}}
.eyebrow{margin-top:44px;font-size:34px;letter-spacing:.1em;text-transform:uppercase;color:${C.ink2}}
.hero{display:flex;align-items:center;gap:52px;margin-top:10px}
.num{font-size:${heroSize}px;font-weight:800;line-height:1.05;letter-spacing:-.03em;color:${s.color};white-space:nowrap}
.cap{font-size:44px;line-height:1.22;color:${C.ink};max-width:780px}
.sub{margin-top:14px;font-size:34px;white-space:nowrap;color:${s.subColor}}
.rows{margin-top:auto;display:flex;flex-direction:column;gap:${s.rows.length > 3 ? 16 : 26}px}
.row{display:grid;grid-template-columns:460px 1fr 220px 370px;column-gap:26px;align-items:center;font-size:38px}
.row.nobar{grid-template-columns:auto 1fr auto}
.label{white-space:nowrap;overflow:hidden}
.track{height:42px;border-radius:7px;background:${C.track};overflow:hidden;display:block}
.fill{display:block;height:100%;border-radius:7px}
.dots{border-bottom:3px dotted ${C.line};height:20px}
.value{font-weight:800;text-align:right;white-space:nowrap}
.note{font-size:30px;color:${C.ink3};white-space:nowrap;overflow:hidden}
.foot{margin-top:36px;padding-top:28px;border-top:2px solid ${C.line};display:flex;justify-content:space-between;align-items:center}
.src{font-size:27px;color:${C.ink3};line-height:1.4}
.cmd{font-size:30px;color:${C.ink3};white-space:nowrap}
.cmd b{font-size:46px;color:${C.ink};margin-left:18px;padding:8px 26px;border:3px solid ${C.line};border-radius:14px}
</style>
<div class="top"><span class="mark">WORTHIT</span><span class="date">${esc(s.date)}</span></div>
<div class="eyebrow">${esc(s.eyebrow)}</div>
<div class="hero"><div class="num">${esc(s.hero)}</div><div><div class="cap">${esc(s.cap)}</div>${s.sub ? `<div class="sub">${esc(s.sub)}</div>` : ''}</div></div>
<div class="rows">${rows}</div>
<div class="foot"><div class="src">${s.plain ? 'measured from my own local logs' : 'priced at API list rates, from my own local logs'}${s.foot ? '<br>' + esc(s.foot) : ''}</div><div class="cmd">measure yours<b>npx worthit</b></div></div>`;
}
