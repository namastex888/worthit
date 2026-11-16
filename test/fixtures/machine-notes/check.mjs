import assert from 'node:assert/strict';
import { blocks, strip, len } from '../../../src/draw.mjs';
import { ordinary, noPlans, allNotes, plan } from './data.mjs';

// Render the actual block used by both the default dashboard and its plain-line view.
// Read the box body across wrapped lines, so long retirement notes remain testable.
const body = lines => lines.slice(1, -1).map(strip).map(l => l.slice(2, -2).trim().replace(/^! /, '')).join(' ').replace(/\s+/g, ' ');
const basic = ['box-saved: no answer, last saved scan used', 'box-unread: no answer, not counted',
  'box-left: has usage, left out of this run', 'box-kept: kept 2 older days'];
const extras = ['box-retired: retired, kept 3 saved days', 'box-retired is retired but answers as box-answer',
  'box-retired: week starts before retirement; first measured week 2026-11-20 (00:00 UTC)',
  'box-saved: gone for good? worthit hosts retire box-saved'];
const check = (data, expected) => {
  const before = structuredClone(data), lines = blocks.PlanRanking(data), text = body(lines);
  for (const note of expected) assert.equal(text.split(note).length - 1, 1, `PlanRanking: exactly one visible ${note} (plans=${data.plans.length})`);
  assert.equal((text.match(/measured meter \+ every machine on the account/g) || []).length, data.plans.length ? 1 : 0, 'legend only for ranked plans');
  assert.equal((text.match(/floor use elsewhere not counted: value ≥ shown/g) || []).length, data.plans.length ? 1 : 0);
  assert.equal(text.includes('No finished weekly limit in your logs yet.'), !data.plans.length);
  assert.ok(lines.every(l => len(l) === 56), 'notes stay inside the existing ranking box');
  assert.deepEqual(data, before, 'display preserves data, values and proof');
  return text;
};
check(noPlans, basic); // Fails before the fix: the no-plan return skips every note.
check({ ...noPlans, plans: [plan] }, basic);
check(allNotes, [...basic, ...extras]);
const retirementNote = 'retired since 2026-11-01, as stated by you';
check({ ...allNotes, plans: [{ ...plan, proof: 'measured', retirement_note: retirementNote }] }, [...basic, ...extras, 'Sample Plan: ' + retirementNote]);
for (const plans of [[], [plan]]) assert.doesNotMatch(check({ ...ordinary, plans }, []), /!|box-|kept|no answer|retired/, 'ordinary control has no machine warnings');
check({ ...ordinary, machines_retained: [{ machine: 'box-one', days_kept: 1 }] }, ['box-one: kept 1 older day']);
check({ ...ordinary, machines_retained: [{ machine: 'box-one', days_kept: 1 }, { machine: 'box-two', days_kept: 3 }] }, ['box-one +1: kept 1–3 older days each']);
console.log('machine-notes: no-plan and ranked blocks, every note kind, ordinary controls, no duplicates or mutations');
