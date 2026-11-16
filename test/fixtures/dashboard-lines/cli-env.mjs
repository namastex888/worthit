// Fixture-only terminal widths and retained-machine data; the real CLI and Ink run unchanged.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.FIXTURE_COLUMNS) Object.defineProperty(process.stdout, 'columns', { value: Number(process.env.FIXTURE_COLUMNS) });
if (process.env.FIXTURE_RETAINED === '1') {
  const demo = fileURLToPath(new URL('../../../src/demo-data.json', import.meta.url));
  const read = fs.readFileSync;
  fs.readFileSync = (file, ...args) => {
    const original = read(file, ...args);
    if (file !== demo) return original;
    const data = JSON.parse(String(original));
    data.machines_retained = [{ machine: 'box-z', days_kept: 1, units: [{ day: '2026-11-13', provider: 'claude' }] }];
    for (const plan of data.plans) { plan.proof = 'floor'; plan.change_vs_last_week_pct = null; }
    data.waste[0] = { ...data.waste[0], used_pct: 80, unused_usd: 24, why: 'spent less' };
    const result = JSON.stringify(data);
    return Buffer.isBuffer(original) ? Buffer.from(result) : result;
  };
}
