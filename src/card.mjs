// The share card: one image made to be read in a feed. One headline number, one caption, up to four rows.
// cardSpec() turns the week's data into that shape per topic; cardHtml() draws it at 1600x900.
import { C, usd } from './draw.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Relative value ratios can exceed 1; bound only the terminal drawing, including NaN/Infinity.
export const barCells = (pct, w = 20) => Math.max(1, Math.round(Math.max(0, Math.min(1, pct || 0)) * w));

// Bound the output check to Chrome's card contract, without imposing a decoder
// or color format. Walk chunk lengths so a truncated body cannot masquerade as
// a complete PNG merely by containing the signature or the text "IEND".
function validCardPng(bytes) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return false;
  let offset = 8, hasData = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), end = offset + 12 + size;
    if (end > bytes.length) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset === 8) {
      if (type !== 'IHDR' || size !== 13 || bytes.readUInt32BE(offset + 8) !== 1600 || bytes.readUInt32BE(offset + 12) !== 900) return false;
    } else if (type === 'IHDR') return false;
    else if (type === 'IDAT' && size > 0) hasData = true;
    else if (type === 'IEND') return hasData && size === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

// A private headless profile never touches the person's browser session. Render
// to scratch first: a stale destination image must not count as a successful run.
export async function renderCardImage(spec, destination) {
  // Test-only executable seam; normal discovery remains fixed (never PATH).
  const chrome = process.env.WORTHIT_TEST_CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(c => fs.existsSync(c));
  const failure = error => ({ image: null, error, note: null });
  if (!chrome) return failure('Chrome not found');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'worthit-card-'));
  try {
    const html = path.join(scratch, 'card.html'), png = path.join(scratch, 'card.png');
    fs.writeFileSync(html, cardHtml(spec));
    // Use filesystem time: isolated fixtures can freeze the JavaScript clock.
    const started = fs.statSync(html).mtimeMs;
    const result = await new Promise(resolve => {
      const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
        '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
        '--disable-sync', '--disable-default-apps', '--metrics-recording-only', '--host-resolver-rules=MAP * ~NOTFOUND',
        '--user-data-dir=' + path.join(scratch, 'profile'), '--window-size=1600,900', '--screenshot=' + png, 'file://' + html], { stdio: 'ignore' });
      let settled = false, timedOut = false;
      const settle = (code, signal, error = null) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        resolve({ code, signal, error, timedOut });
      };
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 60000);
      child.on('error', error => settle(null, null, error));
      child.on('close', (code, signal) => settle(code, signal));
    });
    if (result.error) return failure(result.error.code === 'ENOENT' ? 'Chrome not found (ENOENT)' : `Chrome could not start (${result.error.code || result.error.message})`);
    const outcome = result.timedOut ? `Chrome killed after the 60 s timeout (${result.signal || 'exit ' + result.code})`
      : result.signal ? `Chrome terminated by ${result.signal}` : `Chrome exited ${result.code}`;
    if (!fs.existsSync(png)) return failure(`${outcome}: no PNG was written`);
    const stat = fs.lstatSync(png);
    if (!stat.isFile() || stat.mtimeMs < started || stat.size > 32 * 1024 * 1024 || !validCardPng(fs.readFileSync(png)))
      return failure(`${outcome}: render did not produce a fresh valid 1600x900 PNG`);
    const image = path.resolve(destination); fs.copyFileSync(png, image);
    return { image, error: null, note: result.code === 0 && !result.signal && !result.timedOut ? null : `${outcome} after writing a valid PNG; image accepted` };
  } catch (e) { return failure(`Chrome render failed: ${e.message}`); }
  finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

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
      rows: ps.map(p => ({ label: p.plan, pct: p.usd_per_full_week / mx, color: p.color, value: usd(p.usd_per_full_week), note: moved(p).t, ...(measured(p) && p.retirement_note ? { retirement_note: p.retirement_note } : {}) })) }; },
  value(D) { const p = D.plans.slice().sort((a, b) => b.times_plan_price - a.times_plan_price)[0];
    return { eyebrow: 'The receipt', hero: p.times_plan_price + '×', color: p.color, cap: `what I pay for ${p.plan}, back in API-priced usage`, sub: measured(p) ? 'measured from the plan\'s own meter' : 'at least', subColor: C.ink3,
      rows: [{ label: 'one weekly limit', pct: 1, color: p.color, value: usd(p.usd_per_full_week), note: '', ...(measured(p) && p.retirement_note ? { retirement_note: p.retirement_note } : {}) }, { label: 'the plan, per week', pct: p.plan_usd_per_week / p.usd_per_full_week, color: C.ink3, value: usd(p.plan_usd_per_week), note: '' }] }; },
  ranking(D) { const ps = D.plans.slice().sort((a, b) => b.times_plan_price - a.times_plan_price), h = ps[0];
    return { eyebrow: 'Which AI plan gives more for its price', hero: h.times_plan_price + '×', color: h.color, cap: `${h.plan} gives the most for its price`, sub: 'API-priced usage in one weekly limit ÷ its price', subColor: C.ink3,
      rows: ps.map(p => ({ label: p.plan, pct: p.times_plan_price / h.times_plan_price, color: p.color, value: p.times_plan_price + '×', note: usd(p.usd_per_full_week) + (measured(p) ? ' measured' : ' at least'), ...(measured(p) && p.retirement_note ? { retirement_note: p.retirement_note } : {}) })) }; },
  open(D) { const o = D.model_mix.open, c = D.model_mix.closed, n = o.share_pct.length - 1, s = Math.round(o.share_pct[n]), ch = o.change_pts;
    return { eyebrow: 'Open vs closed models', hero: s + '%', color: C.cx, cap: 'of my AI coding output ran on open models', sub: ch == null || Math.abs(ch) < 0.5 ? 'this week' : `${ch > 0 ? '▲' : '▼'} ${Math.abs(Math.round(ch))} pts vs last week`, subColor: C.ink3,
      rows: [{ label: 'open models', pct: s / 100, color: C.cx, value: s + '%', note: `$${o.usd_per_m_output} per M output` }, { label: 'closed models', pct: 1 - s / 100, color: C.cl, value: (100 - s) + '%', note: `$${c.usd_per_m_output} per M output` }] }; },
  models(D) { const n = D.model_mix.weeks.length - 1, top = D.model_mix.series.filter(x => !x.models).sort((a, b) => b.share_pct[n] - a.share_pct[n]).slice(0, 4), h = top[0], col = x => x.open ? C.cx : C.cl;
    return { eyebrow: 'My model mix this week', hero: Math.round(h.share_pct[n]) + '%', color: col(h), cap: `of my output tokens came from ${h.model}`, sub: 'most used first', subColor: C.ink3,
      rows: top.map(x => ({ label: x.model, pct: x.share_pct[n] / h.share_pct[n], color: col(x), value: Math.round(x.share_pct[n]) + '%', note: x.open ? 'open' : 'closed' })) }; },
  delivery(D) { const v = D.delivery; if (!v || v.usd_per_feature == null) return CARD_TOPICS.allowance(D);
    const covered = !!D.git?.coverage?.prs;
    const ws = v.weeks.filter(x => x.usd_per_feature != null && (covered || x.weeks_ago === 0)).slice(-4), mx = Math.max(...ws.map(x => x.usd_per_feature)), ch = covered ? v.usd_per_feature_change_pct : null, md = iso => { const t = new Date(iso + 'T00:00:00Z'); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };
    return { eyebrow: 'What a shipped feature costs me in AI', hero: '$' + v.usd_per_feature, color: C.gold, cap: `of API-priced AI usage per feature merged this week`, sub: !covered ? `at least ${v.features} features · partial count` : ch == null ? `${v.features} features this week` : `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}% vs last week`, subColor: ch == null ? C.ink3 : ch > 0 ? C.red : C.cx,
      rows: ws.map(x => ({ label: 'week to ' + md(x.to), pct: x.usd_per_feature / mx, color: x.weeks_ago === 0 ? C.gold : C.ink2, value: '$' + x.usd_per_feature, note: `${covered ? '' : 'at least '}${x.features} features` })),
      foot: (covered ? '' : 'cost uses a partial feature count; not compared · ') + 'a feature = a merged PR titled feat:' }; },
  waste(D) { const un = D.waste.reduce((a, x) => a + (x.unused_usd || 0), 0), risk = D.waste.reduce((a, x) => a + (x.at_risk_usd || 0), 0), color = name => (D.plans.find(p => name.startsWith(p.plan.split(' ')[0])) || {}).color || C.ink2;
    return { eyebrow: 'AI allowance I paid for and did not use', hero: usd(un), color: un ? C.red : C.cx, cap: un ? 'of weekly allowance left unused last week' : 'unused: every weekly limit was spent', sub: risk ? `${usd(risk)} more still open before the reset` : '', subColor: C.gold,
      rows: D.waste.slice().sort((a, b) => (b.unused_usd || 0) - (a.unused_usd || 0)).slice(0, 4).map(x => ({ label: x.account, pct: x.used_pct / 100, color: color(x.account), value: x.used_pct + '% used', note: x.unused_usd ? usd(x.unused_usd) + ' unused' : 'hit the cap' })),
      foot: proofLine(D) }; },
};

export function deliveryText(D) {
  const v = D.delivery, covered = !!D.git?.coverage?.prs, ch = covered ? v.usd_per_feature_change_pct : null;
  return `what does a shipped feature cost you in ai? mine this week: $${v.usd_per_feature} each${ch == null ? '' : ` (${ch >= 0 ? '▲' : '▼'}${Math.abs(ch)}% vs last week)`}.. ${covered ? '' : 'at least '}${v.features} features merged, ${v.fix_share_pct}% of my ${covered ? '' : 'observed '}prs were fixes.${covered ? '' : ' cost uses a partial feature count; not compared.'} priced at api rates from my local logs + git: npx worthit`;
}

export const cardSpec = (key, D) => ({ foot: '', ...CARD_TOPICS[key](D), date: '7 days to ' + day(D.week.to) });
// a card the person's agent described: one number, what it is, and up to four facts (no bars)
export const customSpec = (D, title, j) => ({ eyebrow: title.slice(0, 46), hero: String(j.headline).slice(0, 9), color: C.pink, cap: String(j.caption || '').slice(0, 64), sub: '', subColor: C.ink3, foot: '', plain: true,
  rows: (j.facts || []).slice(0, 4).map(f => ({ label: String(f.label).slice(0, 26), pct: null, color: C.ink2, value: String(f.value).slice(0, 16), note: '' })), date: '7 days to ' + day(D.week.to) });

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function cardHtml(s) {
  const heroSize = s.hero.length > 7 ? 150 : s.hero.length > 5 ? 180 : 210, bars = s.rows.some(r => r.pct != null);
  const rows = s.rows.map(r => `<div class="row${bars ? '' : ' nobar'}"><span class="label" style="color:${r.color}">${esc(r.label)}</span>`
    + (bars ? `<span class="track"><span class="fill" style="width:${Math.max(1.5, Math.min(100, (r.pct || 0) * 100)).toFixed(1)}%;background:${r.color}"></span></span>` : '<span class="dots"></span>')
    + `<span class="value">${esc(r.value)}</span>${bars ? `<span class="note">${esc(r.note)}</span>` : ''}${r.retirement_note ? `<span class="retirement">${esc(r.retirement_note)}</span>` : ''}</div>`).join('');
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
.retirement{grid-column:1/-1;font-size:26px;line-height:1.3;color:${C.ink3};overflow-wrap:anywhere}
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
