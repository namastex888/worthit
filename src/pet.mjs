// The hardware pet: a pixel creature in the corner that gets more nervous the harder this machine works while worthit runs.
// It reads CPU, memory, network, disk, temperature and power once a second, read-only, with tools the system already has.
import os from 'node:os'; import fs from 'node:fs'; import { exec } from 'node:child_process';

const MAC = process.platform === 'darwin', LINUX = process.platform === 'linux';
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const sh = cmd => new Promise(r => exec(cmd, { timeout: 2500, maxBuffer: 4 << 20 }, (e, out) => r(e ? '' : out)));
const cpuTimes = () => os.cpus().map(c => { let all = 0; for (const k in c.times) all += c.times[k]; return [c.times.idle, all]; });
const signed = s => { const n = BigInt(s); return Number(n > (1n << 63n) ? n - (1n << 64n) : n); };   // ioreg prints negative numbers as unsigned 64-bit

async function raw() {            // cumulative counters and instant readings; null = this machine does not give it
  const o = { t: Date.now(), cpu: cpuTimes(), mem: null, net: null, disk: null, temp: null, watts: null };
  if (MAC) {
    const [vm, ns, io, bat] = await Promise.all([sh('vm_stat'), sh('netstat -ib'), sh('iostat -Id'), sh('ioreg -rw0 -c AppleSmartBattery')]);
    const page = +(/page size of (\d+)/.exec(vm) || [])[1] || 16384, pg = k => +(new RegExp(k + ':\\s+(\\d+)').exec(vm) || [])[1] || 0;
    if (vm) o.mem = (pg('Pages active') + pg('Pages wired down') + pg('Pages occupied by compressor')) * page / os.totalmem();
    let nb = 0, seen = new Set(); for (const l of ns.split('\n')) { const c = l.trim().split(/\s+/); if (!/^<Link#/.test(c[2] || '') || c[0].startsWith('lo') || seen.has(c[0])) continue; seen.add(c[0]); nb += (+c[c.length - 5] || 0) + (+c[c.length - 2] || 0); }
    if (ns) o.net = nb;
    const row = (io.trim().split('\n')[2] || '').trim().split(/\s+/).map(Number); if (row.length >= 3) { let mb = 0; for (let i = 2; i < row.length; i += 3) mb += row[i] || 0; o.disk = mb * 1e6; }
    const load = /"SystemLoad"=(\d+)/.exec(bat), bp = /"BatteryPower"=(\d+)/.exec(bat), tmp = /"Temperature" = (\d+)/.exec(bat);
    if (load && +load[1] > 0) o.watts = +load[1] / 1000; else if (bp && signed(bp[1]) < 0) o.watts = -signed(bp[1]) / 1000;
    if (tmp) o.temp = +tmp[1] / 100;
  } else if (LINUX) {
    const mi = read('/proc/meminfo'), tot = +(/MemTotal:\s+(\d+)/.exec(mi) || [])[1], av = +(/MemAvailable:\s+(\d+)/.exec(mi) || [])[1]; if (tot && av) o.mem = 1 - av / tot;
    let nb = 0, any = false; for (const l of read('/proc/net/dev').split('\n').slice(2)) { const [name, rest] = l.split(':'); if (!rest || name.trim() === 'lo') continue; const c = rest.trim().split(/\s+/); nb += (+c[0] || 0) + (+c[8] || 0); any = true; } if (any) o.net = nb;
    let db = 0, anyD = false; for (const l of read('/proc/diskstats').split('\n')) { const c = l.trim().split(/\s+/); if (!/^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|mmcblk\d+)$/.test(c[2] || '')) continue; db += ((+c[5] || 0) + (+c[9] || 0)) * 512; anyD = true; } if (anyD) o.disk = db;
    let hot = 0; try { for (const z of fs.readdirSync('/sys/class/thermal')) if (z.startsWith('thermal_zone')) hot = Math.max(hot, +read(`/sys/class/thermal/${z}/temp`) / 1000 || 0); } catch { /* none */ } if (hot) o.temp = hot;
    try { for (const b of fs.readdirSync('/sys/class/power_supply')) { const p = +read(`/sys/class/power_supply/${b}/power_now`); if (p > 0 && /Discharging/.test(read(`/sys/class/power_supply/${b}/status`))) o.watts = p / 1e6; } } catch { /* none */ }
  }
  return o;
}

// each reading as 0..1 pressure; they compound, so several busy things at once make the pet far more nervous than one
const clamp = x => Math.max(0, Math.min(1, x));
const pressure = m => { const p = [0.8 * Math.pow(clamp(Math.max(m.cpu, 0.6 * (m.core || 0))), 1.5),   // one pinned core already counts
    m.mem == null ? 0 : 0.6 * clamp((m.mem - 0.6) / 0.4), m.net == null ? 0 : 0.7 * clamp(Math.log10(1 + m.net / 1e6) / 2),
  m.disk == null ? 0 : 0.6 * clamp(m.disk / 4e8), m.temp == null ? 0 : 0.6 * clamp((m.temp - (MAC ? 35 : 60)) / (MAC ? 12 : 30))]; return 1 - p.reduce((a, x) => a * (1 - x), 1); };

export function startPet(on) {    // calls on(state) about once a second; returns stop() → the run's totals
  let prev = null, nerve = 0, boom = 0, booms = 0, stopped = false, timer = null; const t0 = Date.now(), tot = { n: 0, cpu: 0, cpuPeak: 0, netPeak: 0, diskPeak: 0, netBytes: 0, diskBytes: 0, tempPeak: null, wh: 0, wattsN: 0, wattsSum: 0, wattsPeak: 0, wattsFirst: null };
  const tick = async () => { if (stopped) return; let r; try { r = await raw(); } catch { r = null; }
    if (r && prev && !stopped) { const dt = Math.max(0.2, (r.t - prev.t) / 1000); let busy = 0, all = 0, core = 0;
      r.cpu.forEach(([i, a], k) => { const p0 = prev.cpu[k] || [i, a], da = a - p0[1], db = da - (i - p0[0]); if (da > 0) { busy += db; all += da; core = Math.max(core, db / da); } });
      const m = { cpu: all > 0 ? busy / all : 0, core, mem: r.mem, net: r.net == null || prev.net == null ? null : Math.max(0, r.net - prev.net) / dt, disk: r.disk == null || prev.disk == null ? null : Math.max(0, r.disk - prev.disk) / dt, temp: r.temp, watts: r.watts };
      const p = pressure(m); if (boom > 0) boom--; else { nerve = clamp(nerve + (p > 0.2 ? (p - 0.2) * 0.3 : -0.1) * dt); if (nerve >= 1) { boom = 3; booms++; nerve = 0; } }
      tot.n++; tot.cpu += m.cpu; tot.cpuPeak = Math.max(tot.cpuPeak, m.cpu); if (m.net != null) { tot.netPeak = Math.max(tot.netPeak, m.net); tot.netBytes += m.net * dt; } if (m.disk != null) { tot.diskPeak = Math.max(tot.diskPeak, m.disk); tot.diskBytes += m.disk * dt; }
      if (m.temp != null) tot.tempPeak = Math.max(tot.tempPeak || 0, m.temp);
      if (m.watts != null) { tot.wh += m.watts * dt / 3600; tot.wattsN++; tot.wattsSum += m.watts; tot.wattsPeak = Math.max(tot.wattsPeak, m.watts); if (tot.wattsFirst == null) tot.wattsFirst = m.watts; }
      on({ ...m, pressure: p, nerve, boom, booms, wh: tot.wh }); }
    if (r) prev = r; if (!stopped) timer = setTimeout(tick, 1000); };
  tick();
  return () => { stopped = true; clearTimeout(timer); const n = Math.max(1, tot.n);
    return { seconds: Math.round((Date.now() - t0) / 1000), cpu_avg_pct: Math.round(100 * tot.cpu / n), cpu_peak_pct: Math.round(100 * tot.cpuPeak), net_peak_mb_s: +(tot.netPeak / 1e6).toFixed(1), net_mb: +(tot.netBytes / 1e6).toFixed(1),
      disk_peak_mb_s: +(tot.diskPeak / 1e6).toFixed(1), disk_mb: +(tot.diskBytes / 1e6).toFixed(1), temp_peak_c: tot.tempPeak == null ? null : +tot.tempPeak.toFixed(1),
      watts_avg: tot.wattsN ? +(tot.wattsSum / tot.wattsN).toFixed(1) : null, watts_peak: tot.wattsN ? +tot.wattsPeak.toFixed(1) : null, watt_hours: tot.wattsN ? +tot.wh.toFixed(3) : null, explosions: booms }; };
}

// ---- pixel art: '#' body, 'E' eye, 'M' mouth, '.' empty; two pixels per character row (half blocks)
const SMALL = ['..............', '..............', '....######....', '...########...', '...#E####E#...', '...########...', '...########...', '....######....', '....#.##.#....', '..............'];
const MID = ['..............', '...########...', '..##########..', '..##E####E##..', '..##########..', '..####MM####..', '..##########..', '...########...', '...#.#..#.#...', '..............'];
const BIG = ['..##########..', '.############.', '##############', '###EE####EE###', '###EE####EE###', '##############', '####MMMMMM####', '.############.', '..##########..', '..#.#....#.#..'];
const BOOM = [['..............', '......##......', '...#.####.#...', '....######....', '..##########..', '..##########..', '....######....', '...#.####.#...', '......##......', '..............'],
  ['...#......#...', '.#....##....#.', '....#....#....', '..#........#..', '#....#..#....#', '#....#..#....#', '..#........#..', '....#....#....', '.#....##....#.', '...#......#...'],
  ['#......#.....#', '..............', '....#......#..', '..............', '#............#', '.......#......', '..............', '..#.......#...', '..............', '#.....#......#']];
const STOPS = [[0, [91, 156, 245]], [0.3, [69, 199, 160]], [0.55, [242, 201, 76]], [0.78, [242, 153, 74]], [1, [235, 77, 77]]];
export const petColor = n => { for (let i = 1; i < STOPS.length; i++) if (n <= STOPS[i][0]) { const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], k = (n - a) / (b - a); return ca.map((v, j) => Math.round(v + (cb[j] - v) * k)); } return STOPS[STOPS.length - 1][1]; };
export const MOODS = ['calm', 'curious', 'nervous', 'stressed', 'about to pop'];
export const mood = s => s.boom ? 'BOOM' : MOODS[Math.min(4, Math.floor(s.nerve * 5))];

export function sprite(s, frame) {          // → 5 strings, 14 columns wide
  const n = s.nerve || 0, grid = s.boom ? BOOM[3 - s.boom] || BOOM[2] : n < 0.4 ? SMALL : n < 0.75 ? MID : BIG, body = s.boom ? [[255, 214, 102], [242, 153, 74], [235, 77, 77]][3 - s.boom] || [235, 77, 77] : petColor(n), dark = [24, 24, 28];
  const blink = !s.boom && n < 0.4 && frame % 28 < 2, shake = !s.boom && n >= 0.75 && frame % 2 ? 1 : 0;
  const px = (x, y) => { const ch = (grid[y] || '')[x - shake] || '.'; return ch === '.' ? null : ch === '#' || (ch === 'E' && blink) ? body : dark; };
  const f = c => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`, b = c => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`, same = (a, c) => a && c && a[0] === c[0] && a[1] === c[1] && a[2] === c[2], out = [];
  for (let y = 0; y < 10; y += 2) { let l = ''; for (let x = 0; x < 14; x++) { const t = px(x, y), u = px(x, y + 1);
      l += !t && !u ? ' ' : t && !u ? f(t) + '▀\x1b[39m' : !t && u ? f(u) + '▄\x1b[39m' : same(t, u) ? f(t) + '█\x1b[39m' : f(t) + b(u) + '▀\x1b[39m\x1b[49m'; } out.push(l); }
  return out;
}

const rate = b => b == null ? '  n/a' : b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB/s' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB/s' : Math.round(b / 1e3) + ' KB/s';
export function petLines(s, frame) {        // the sprite plus its readings, as plain lines (24 columns)
  if (!s) return ['', '', '   waking the pet…', '', ''];
  const c = petColor(s.boom ? 1 : s.nerve), col = t => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${t}\x1b[39m`, dim = t => `\x1b[38;2;116;116;122m${t}\x1b[39m`, meter = '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((s.boom ? 1 : s.nerve) * 8))];
  return [...sprite(s, frame).map(l => '     ' + l), col(`${meter} ${mood(s)}`) + (s.booms ? dim(`  popped ${s.booms}×`) : ''),
    dim('cpu ') + `${String(Math.round(s.cpu * 100)).padStart(2)}%` + dim(' core ') + `${Math.round((s.core || 0) * 100)}%` + dim(' mem ') + (s.mem == null ? 'n/a' : Math.round(s.mem * 100) + '%'),
    dim('net ') + rate(s.net), dim('disk ') + rate(s.disk),
    (s.watts == null ? dim('power n/a') : `${s.watts.toFixed(1)} W` + dim(` · ${(s.wh * 1000).toFixed(0)} mWh`)) + (s.temp == null ? '' : dim(`  ${Math.round(s.temp)}°C`))];
}
export const petSummary = t => !t || !t.seconds ? '' : (t.watts_avg == null ? '' : `${t.watts_avg} W avg · ${(t.watt_hours * 1000).toFixed(0)} mWh · `) + `cpu ${t.cpu_avg_pct}% (peak ${t.cpu_peak_pct}%) · net ${t.net_mb} MB · disk ${t.disk_mb} MB`
  + (t.explosions ? ` · the pet popped ${t.explosions}×` : ' · the pet survived');
