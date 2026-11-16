// Test-only synthetic scenarios. No public demo selector or collector changes.
export function machineVariants(sample) {
  const ago = days => new Date(Date.parse(sample.generated_at) - days * 864e5).toISOString();
  const day = days => ago(days).slice(0, 10);
  const scenarios = {
    missing: { machines: 1, machines_missing: [
      { machine: 'build-box', saved_scan_at: ago(2) },
      { machine: 'sample-box', saved_scan_at: null },
    ] },
    'left-out': { machines: 1, machines_left_out: ['build-box'] },
    retained: { machines_retained: [{ machine: 'build-box', days_kept: 2, units: [
      { day: day(2), provider: 'claude' }, { day: day(2), provider: 'codex' },
      { day: day(3), provider: 'claude' },
    ] }] },
    'retained-old': { machines_retained: [{ machine: 'build-box', days_kept: 1,
      units: [{ day: day(12), provider: 'claude' }] }] },
  };
  return Object.fromEntries(Object.entries(scenarios).map(([name, fields]) => {
    const D = { ...structuredClone(sample), ...fields };
    if (name !== 'retained-old') {
      for (const p of D.plans) {
        p.proof = 'floor'; p.change_vs_last_week_pct = null;
        for (const week of p.weeks || []) { week.proof = 'floor'; }
      }
    }
    return [name, D];
  }));
}
