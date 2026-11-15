// RFC 0002: retirement changes selection, never the saved scan's contents.
import fs from 'node:fs';
import path from 'node:path';

export function readHosts(home) {
  const file = path.join(home, 'hosts.json');
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state) ||
        (state.selected != null && (!Array.isArray(state.selected) || state.selected.some(a => typeof a !== 'string'))) ||
        (state.retired != null && !Array.isArray(state.retired))) throw new Error('expected selected and retired arrays');
    for (const r of state.retired || []) {
      if (!r || !validAlias(r.machine) || typeof r.retired_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(r.retired_at) || !Number.isFinite(Date.parse(r.retired_at)))
        throw new Error('each retired machine needs a valid alias and ISO retired_at');
    }
    return { ...state, selected: state.selected || [], retired: state.retired || [] };
  } catch (e) {
    if (e.code === 'ENOENT') return { selected: [], retired: [] };
    throw new Error(`cannot read ${file}: ${e.message.replace(/[\r\n]+/g, ' ').replace(/[.\s]+$/, '')}. Fix or remove it.`);
  }
}
export function writeHosts(home, state) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, 'hosts.json'), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, file);
}
export const activeHosts = (home, aliases) => {
  const retired = new Set(readHosts(home).retired.map(r => r.machine));
  return aliases.filter(a => !retired.has(a));
};
const validAlias = alias => typeof alias === 'string' && alias !== 'local' && alias !== '.' && alias !== '..' && !/[\/\\\0]/.test(alias) && alias.length > 0;
export function hostsCommand(home, known, argv) {
  const state = readHosts(home), [action, machine, ...options] = argv;
  const saved = path.join(home, 'run-keep'), frozen = path.join(saved, 'retired');
  if (action == null) {
    const aliases = new Set([...known.map(h => h.alias), ...state.selected, ...state.retired.map(r => r.machine)]);
    try { for (const f of fs.readdirSync(saved)) if (f.endsWith('.json') && f !== 'local.json') aliases.add(f.slice(0, -5)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return [...aliases].sort().map(machine => {
      const retired = state.retired.find(r => r.machine === machine);
      return { machine, status: retired ? 'retired' : state.selected.includes(machine) ? 'selected' : 'not selected', ...(retired || {}) };
    });
  }
  if (!['retire', 'unretire'].includes(action) || !validAlias(machine) ||
      (options.length && !(action === 'retire' && options.length === 2 && options[0] === '--since'))) {
    throw new Error('use: worthit hosts; worthit hosts retire <machine> [--since YYYY-MM-DD]; worthit hosts unretire <machine>');
  }
  const file = path.join(saved, machine + '.json'), snapshot = path.join(frozen, machine + '.json');
  const entry = state.retired.find(r => r.machine === machine);
  if (action === 'unretire') {
    if (!entry) throw new Error(`${machine} is not retired. See worthit hosts.`);
    // A lost snapshot must not trap the store in retirement forever.
    let moved = false;
    try { fs.renameSync(snapshot, file); moved = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    state.retired = state.retired.filter(r => r.machine !== machine);
    state.selected = [...new Set([...state.selected, machine])];
    try { writeHosts(home, state); } catch (e) { if (moved) fs.renameSync(file, snapshot); throw e; }
    return { machine, status: 'selected' };
  }
  if (entry) throw new Error(`${machine} is already retired. Use worthit hosts unretire ${machine} first.`);
  let scan;
  try { scan = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
    throw new Error(`${machine} has no readable saved scan to keep. Leave it out with --hosts none or --hosts <other aliases>, or change the machine selection. See worthit hosts.`);
  }
  if (!scan.host || !scan.since || !Number.isFinite(Date.parse(scan.generated_at)) || !Array.isArray(scan.buckets)) {
    throw new Error(`${machine} has no valid saved scan to keep. Leave it out of the machine selection instead.`);
  }
  const since = options[1], now = Date.now();
  let retiredAt = now;
  if (since != null) {
    retiredAt = Date.parse(since + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Number.isFinite(retiredAt) || new Date(retiredAt).toISOString().slice(0, 10) !== since) throw new Error('--since needs a valid YYYY-MM-DD date (UTC).');
    if (retiredAt < Date.parse(scan.generated_at)) throw new Error(`--since cannot be earlier than last_scan_at (${scan.generated_at}). Choose a later date or omit --since.`);
    if (retiredAt > now) throw new Error('--since cannot be in the future.');
  }
  const retired = { machine, retired_at: new Date(retiredAt).toISOString(), last_scan_at: scan.generated_at, ...(since ? { since } : {}) };
  if (fs.existsSync(snapshot)) throw new Error(`${machine} already has a frozen snapshot; restore its hosts.json retirement record before retrying.`);
  fs.mkdirSync(frozen, { recursive: true }); fs.renameSync(file, snapshot);
  state.retired.push(retired); state.selected = state.selected.filter(a => a !== machine);
  try { writeHosts(home, state); } catch (e) { fs.renameSync(snapshot, file); throw e; }
  return { ...retired, status: 'retired' };
}

export const retirementBlocks = (retired, end) => retired.filter(r => end - 7 * 864e5 < Date.parse(r.retired_at));
export const firstMeasuredAt = retired => new Date(Date.parse(retired.retired_at) + 7 * 864e5).toISOString();
export const retirementStatement = retired => retired.filter(r => r.since).map(r => `${r.machine}: retired since ${r.since}, as stated by you`).join('; ');
