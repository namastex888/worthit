// The hardware pet: a pixel creature in the corner that shows, as one scale, how hard this machine is working while worthit runs.
// It reads CPU, memory, network, disk, temperature and power once a second, read-only, with tools the system already has.
import os from 'node:os'; import fs from 'node:fs'; import { exec } from 'node:child_process';

const MAC = process.platform === 'darwin', LINUX = process.platform === 'linux';
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const sh = cmd => new Promise(r => exec(cmd, { timeout: 2500, maxBuffer: 4 << 20 }, (e, out) => r(e ? '' : out)));
const cpuTimes = () => os.cpus().map(c => { let all = 0; for (const k in c.times) all += c.times[k]; return [c.times.idle, all]; });
const signed = s => { const n = BigInt(s); return Number(n >= (1n << 63n) ? n - (1n << 64n) : n); };   // ioreg prints negative numbers as unsigned 64-bit
const sane = w => w > 0.2 && w < 1500 ? w : null;                                                        // a laptop or workstation, in watts

async function raw() {            // cumulative counters and instant readings; null = this machine does not give it
  const o = { t: Date.now(), cpu: cpuTimes(), mem: null, net: null, disk: null, temp: null, watts: null };
  if (MAC) {
    const [vm, ns, io, bat] = await Promise.all([sh('vm_stat'), sh('netstat -ib'), sh('iostat -Id'), sh('ioreg -rw0 -c AppleSmartBattery')]);
    const page = +(/page size of (\d+)/.exec(vm) || [])[1] || 16384, pg = k => +(new RegExp(k + ':\\s+(\\d+)').exec(vm) || [])[1] || 0;
    if (vm) o.mem = (pg('Pages active') + pg('Pages wired down') + pg('Pages occupied by compressor')) * page / os.totalmem();
    let nb = 0; const seen = new Set(); for (const l of ns.split('\n')) { const c = l.trim().split(/\s+/); if (!/^<Link#/.test(c[2] || '') || c[0].startsWith('lo') || seen.has(c[0])) continue; seen.add(c[0]); nb += (+c[c.length - 5] || 0) + (+c[c.length - 2] || 0); }
    if (ns) o.net = nb;
    const row = (io.trim().split('\n')[2] || '').trim().split(/\s+/).map(Number); if (row.length >= 3) { let mb = 0; for (let i = 2; i < row.length; i += 3) mb += row[i] || 0; o.disk = mb * 1e6; }
    // whole-system power in mW: the load reading, else what comes in from the charger, else what the battery gives
    const mw = k => { const x = new RegExp(`"${k}"=(\\d+)`).exec(bat); return x ? signed(x[1]) : null; };
    o.watts = sane((mw('SystemLoad') ?? 0) / 1000) ?? sane((mw('SystemPowerIn') ?? 0) / 1000) ?? sane(Math.abs(mw('BatteryPower') ?? 0) / 1000);
    const tmp = /"Temperature" = (\d+)/.exec(bat); if (tmp) o.temp = +tmp[1] / 100;
  } else if (LINUX) {
    const mi = read('/proc/meminfo'), tot = +(/MemTotal:\s+(\d+)/.exec(mi) || [])[1], av = +(/MemAvailable:\s+(\d+)/.exec(mi) || [])[1]; if (tot && av) o.mem = 1 - av / tot;
    let nb = 0, any = false; for (const l of read('/proc/net/dev').split('\n').slice(2)) { const [name, rest] = l.split(':'); if (!rest || name.trim() === 'lo') continue; const c = rest.trim().split(/\s+/); nb += (+c[0] || 0) + (+c[8] || 0); any = true; } if (any) o.net = nb;
    let db = 0, anyD = false; for (const l of read('/proc/diskstats').split('\n')) { const c = l.trim().split(/\s+/); if (!/^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|mmcblk\d+)$/.test(c[2] || '')) continue; db += ((+c[5] || 0) + (+c[9] || 0)) * 512; anyD = true; } if (anyD) o.disk = db;
    let hot = 0; try { for (const z of fs.readdirSync('/sys/class/thermal')) if (z.startsWith('thermal_zone')) hot = Math.max(hot, +read(`/sys/class/thermal/${z}/temp`) / 1000 || 0); } catch { /* none */ } if (hot) o.temp = hot;
    try { for (const b of fs.readdirSync('/sys/class/power_supply')) { const p = +read(`/sys/class/power_supply/${b}/power_now`); if (p > 0 && /Discharging/.test(read(`/sys/class/power_supply/${b}/status`))) o.watts = sane(p / 1e6); } } catch { /* none */ }
  }
  return o;
}

// each reading as 0..1; they compound, so several busy things at once push the scale far higher than one
const clamp = x => Math.max(0, Math.min(1, x));
export const parts = m => ({ cpu: clamp(Math.max(m.cpu, 0.6 * (m.core || 0))), mem: m.mem == null ? null : clamp((m.mem - 0.5) / 0.5), net: m.net == null ? null : clamp(Math.log10(1 + m.net / 1e6) / 2),
  disk: m.disk == null ? null : clamp(m.disk / 4e8), temp: m.temp == null ? null : clamp((m.temp - (MAC ? 30 : 45)) / (MAC ? 15 : 45)) });
const WEIGHT = { cpu: 0.8, mem: 0.5, net: 0.7, disk: 0.6, temp: 0.5 };
const pressure = m => { const p = parts(m); return 1 - Object.keys(WEIGHT).reduce((a, k) => a * (1 - WEIGHT[k] * (p[k] || 0)), 1); };

export function startPet(on) {    // calls on(state) about once a second; returns stop() → the run's totals
  let prev = null, level = 0, stopped = false, timer = null; const t0 = Date.now(), tot = { n: 0, cpu: 0, cpuPeak: 0, netBytes: 0, diskBytes: 0, wh: 0, wattsN: 0, wattsSum: 0, levelPeak: 0 };
  const tick = async () => { if (stopped) return; let r; try { r = await raw(); } catch { r = null; }
    if (r && prev && !stopped) { const dt = Math.max(0.2, (r.t - prev.t) / 1000); let busy = 0, all = 0, core = 0;
      r.cpu.forEach(([i, a], k) => { const p0 = prev.cpu[k] || [i, a], da = a - p0[1], db = da - (i - p0[0]); if (da > 0) { busy += db; all += da; core = Math.max(core, db / da); } });
      const m = { cpu: all > 0 ? busy / all : 0, core, mem: r.mem, net: r.net == null || prev.net == null ? null : Math.max(0, r.net - prev.net) / dt, disk: r.disk == null || prev.disk == null ? null : Math.max(0, r.disk - prev.disk) / dt, temp: r.temp, watts: r.watts };
      level += (pressure(m) - level) * 0.5;                    // smoothed, so the pet does not flicker between moods
      tot.n++; tot.cpu += m.cpu; tot.cpuPeak = Math.max(tot.cpuPeak, m.cpu); tot.levelPeak = Math.max(tot.levelPeak, level); if (m.net != null) tot.netBytes += m.net * dt; if (m.disk != null) tot.diskBytes += m.disk * dt;
      if (m.watts != null) { tot.wh += m.watts * dt / 3600; tot.wattsN++; tot.wattsSum += m.watts; }
      on({ ...m, level, wh: tot.wh }); }
    if (r) prev = r; if (!stopped) timer = setTimeout(tick, 1000); };
  tick();
  return () => { stopped = true; clearTimeout(timer); const n = Math.max(1, tot.n);
    return { seconds: Math.round((Date.now() - t0) / 1000), cpu_avg_pct: Math.round(100 * tot.cpu / n), cpu_peak_pct: Math.round(100 * tot.cpuPeak), net_mb: +(tot.netBytes / 1e6).toFixed(1), disk_mb: +(tot.diskBytes / 1e6).toFixed(1),
      watts_avg: tot.wattsN ? +(tot.wattsSum / tot.wattsN).toFixed(1) : null, watt_hours: tot.wattsN ? +tot.wh.toFixed(3) : null, peak_level_pct: Math.round(100 * tot.levelPeak), peak_mood: MOODS[moodOf(tot.levelPeak)] }; };
}

// ---- pixel art, 16 × 12 pixels, two pixels per character row (half blocks)
// '#' body, 'o' lighter belly, 'E' eye, 'W' eye white, 'M' mouth, 'c' cheek, 's' sweat drop, '.' empty
const FACES = [
  ['................', '................', '....########....', '...##########...', '..############..', '..##E######E##..', '..############..', '..####MMMM####..', '..##oooooooo##..', '...##########...', '...##..##..##...', '................'],
  ['................', '................', '....########....', '...##########...', '..############..', '..#WE######WE#..', '..############..', '..#####MM#####..', '..##oooooooo##..', '...##########...', '...##..##..##...', '................'],
  ['................', '...##########...', '..############..', '.##############.', '.##WW######WW##.', '.##WE######EW##.', '.##############.', '.#####MMMM#####.', '.###oooooooo###.', '..############..', '..##..####..##..', '................'],
  ['.............s..', '..############s.', '.##############.', '################', '##WWW######WWW##', '##WEW######WEW##', '################', '####MMMMMMMM####', '####M######M####', '.###oooooooo###.', '.###..####..###.', '................'],
  ['s.############.s', '.##############.', '################', '##WWWW####WWWW##', '##WEEW####WEEW##', '##WWWW####WWWW##', '################', '###MMMMMMMMMM###', '###MoooooooM####', '###MMMMMMMMMM###', '################', '.###..####..###.']];
const STOPS = [[0, [86, 156, 245]], [0.25, [70, 196, 170]], [0.5, [240, 200, 80]], [0.75, [242, 150, 72]], [1, [236, 82, 82]]];
export const petColor = n => { n = clamp(n); for (let i = 1; i < STOPS.length; i++) if (n <= STOPS[i][0]) { const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], k = (n - a) / (b - a); return ca.map((v, j) => Math.round(v + (cb[j] - v) * k)); } return STOPS[4][1]; };
export const MOODS = ['calm', 'busy', 'nervous', 'stressed', 'maxed out'];
const moodOf = n => Math.min(4, Math.floor(clamp(n) * 5));
const f = c => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`, b = c => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`, paint = (c, t) => f(c) + t + '\x1b[39m';
const DIM = [116, 116, 122], INK = [228, 228, 224], TRACK = [52, 52, 60];

export function sprite(level, frame) {      // → 6 strings, 16 columns wide
  const k = moodOf(level), grid = FACES[k], body = petColor(level), belly = body.map(v => Math.round(v + (255 - v) * 0.45)), dark = [26, 26, 32], white = [246, 246, 240], drop = [120, 190, 255];
  const blink = k < 2 && frame % 30 < 2, shake = k >= 3 && frame % 2 ? 1 : 0, bob = k < 3 && frame % 16 < 8 ? 0 : k < 3 ? 1 : 0;
  const px = (x, y) => { const ch = (grid[y - bob] || '')[x - shake] || '.';
    return ch === '.' ? null : ch === '#' ? body : ch === 'o' ? belly : ch === 'W' ? (blink ? body : white) : ch === 'E' ? (blink ? body : dark) : ch === 's' ? (frame % 6 < 3 ? drop : null) : dark; };
  const same = (a, c) => a && c && a[0] === c[0] && a[1] === c[1] && a[2] === c[2], out = [];
  for (let y = 0; y < 12; y += 2) { let l = ''; for (let x = 0; x < 16; x++) { const t = px(x, y), u = px(x, y + 1);
      l += !t && !u ? ' ' : t && !u ? f(t) + '▀\x1b[39m' : !t && u ? f(u) + '▄\x1b[39m' : same(t, u) ? f(t) + '█\x1b[39m' : f(t) + b(u) + '▀\x1b[39m\x1b[49m'; } out.push(l); }
  return out;
}

const rate = v => v >= 1e9 ? (v / 1e9).toFixed(1) + ' GB/s' : v >= 1e6 ? (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + ' MB/s' : Math.round(v / 1e3) + ' KB/s';
const gauge = (x, n, c) => { const full = Math.round(clamp(x) * n); return paint(c, '━'.repeat(full)) + paint(TRACK, '━'.repeat(n - full)); };
export const PET_W = 28;
export function petLines(s, frame) {        // the sprite, the scale, and one small bar per reading: PET_W columns, 13 lines
  if (!s) return [...Array(6).fill(''), paint(DIM, '      waking the pet…'), ...Array(6).fill('')];
  const p = parts(s), c = petColor(s.level), row = (label, x, val) => x == null ? paint(DIM, label.padEnd(6) + '·'.repeat(10) + ' n/a') : paint(DIM, label.padEnd(6)) + gauge(x, 10, petColor(x)) + ' ' + paint(INK, val.padStart(9));
  return [...sprite(s.level, frame).map(l => '      ' + l),
    ' ' + gauge(s.level, 26, c),
    ' ' + paint(c, '\x1b[1m' + MOODS[moodOf(s.level)] + '\x1b[22m') + paint(DIM, ` · load ${Math.round(s.level * 100)}%`),
    row(' cpu', p.cpu, `${Math.round(s.cpu * 100)}%`), row(' mem', p.mem, s.mem == null ? '' : Math.round(s.mem * 100) + '%'), row(' net', p.net, s.net == null ? '' : rate(s.net)), row(' disk', p.disk, s.disk == null ? '' : rate(s.disk)),
    ' ' + (s.watts == null ? paint(DIM, 'power n/a') : paint(INK, `${s.watts.toFixed(1)} W`) + paint(DIM, ` · ${(s.wh * 1000).toFixed(0)} mWh`)) + (s.temp == null ? '' : paint(DIM, ` · ${Math.round(s.temp)}°C`))];
}
const mb = v => v >= 1000 ? (v / 1000).toFixed(1) + ' GB' : Math.round(v) + ' MB';
export const petSummary = t => !t || !t.seconds ? '' : (t.watts_avg == null ? '' : `${t.watts_avg} W avg · ${(t.watt_hours * 1000).toFixed(0)} mWh · `) + `cpu ${t.cpu_avg_pct}% · net ${mb(t.net_mb)} · disk ${mb(t.disk_mb)} · peak ${t.peak_level_pct}%`;
