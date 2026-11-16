// Literal synthetic display inputs: no scanners, accounts, stores or demo-data changes.
export const plan = { plan: 'Sample Plan', color: '#4c94f0', usd_per_full_week: 100,
  times_plan_price: 2, proof: 'floor' };
export const ordinary = { generated_at: '2026-11-15T12:00:00Z', plans: [] };
export const noPlans = { ...ordinary,
  machines_retained: [{ machine: 'box-kept', days_kept: 2, units: [{ day: '2026-11-12', provider: 'claude' }] }],
  machines_missing: [{ machine: 'box-saved', saved_scan_at: '2026-11-14T12:00:00Z' }, { machine: 'box-unread' }],
  machines_left_out: ['box-left'],
};
export const allNotes = { ...noPlans,
  machines_missing: [{ machine: 'box-saved', saved_scan_at: '2026-10-01T12:00:00Z' }, { machine: 'box-unread' }],
  machines_retired: [{ machine: 'box-retired', days_kept: 3, retired_at: '2026-11-13T00:00:00Z' }],
  retirement_conflicts: [{ machine: 'box-retired', same_as: 'box-answer' }],
};
