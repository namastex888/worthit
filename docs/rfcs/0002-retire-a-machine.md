# RFC 0002: Retire a machine

| Field | Value |
|---|---|
| Status | Queued |
| Created | 2026-11-14 |
| Issue | #26 |
| Depends on | #24 (a fresh scan never erases days a saved scan had) |

## Summary

A person can retire an ssh machine that will never answer again. Its saved days stay in every total and
in the history. worthit stops asking it, stops listing it as missing, and stops listing it as left out.
A week that starts on or after the retirement can be measured again.

## Motivation

worthit keeps the last scan of each ssh machine (`run-keep/<machine>.json`). When a machine gives no
answer, that saved scan stands in for it (`src/collect.mjs:88`). A plan's weekly value is measured only
when every machine answered in this run. A machine that answered from its saved scan counts as missing
(`src/collect.mjs:253`). A saved machine with usage that is not in the selection counts as left out
(`src/collect.mjs:101`). Either one turns the plan into a floor (`src/collect.mjs:259`). A floor is never
compared week to week.

A machine that is gone for good (sold, wiped, reinstalled) therefore answers from its saved scan forever.
Every week stays a floor, and the weekly allowance check can never say whether a plan moved. Leaving the
machine out of `--hosts` does not help: it then counts as left out.

Today only Claude's plan can be measured (`src/collect.mjs:272`). This RFC unblocks that one, and any
plan that becomes measurable later.

## Design

### The command

```
worthit hosts                              # every saved ssh machine: selected, not selected, retired
worthit hosts retire <machine> [--since <YYYY-MM-DD>]
worthit hosts unretire <machine>
```

- `retire` records the machine in `hosts.json` under a new key:
  `"retired": [{ "machine": "<alias>", "retired_at": "<ISO time>", "last_scan_at": "<ISO time>" }]`.
  `retired_at` is now unless `--since` is given (see the open questions). `last_scan_at` is the time of
  the saved scan that will stand for the machine from now on.
- `retire` refuses a machine that has no saved scan, because there would be nothing to keep. It says so
  and suggests leaving the machine out of the selection instead.
- `unretire` removes the entry. The machine is asked again from the next run on. Weeks already recorded
  keep their values.
- All three commands print JSON when stdout is not a terminal, like the other read commands.

### What a run does with a retired machine

- It is never asked over ssh. It is never in `--hosts all`, the machine picker or the saved selection.
- Its saved scan is read for the days it covers, exactly as today, and is never replaced (issue 24
  already guarantees that a fresh scan cannot shrink it).
- It never appears in `machines_missing` or `machines_left_out`.
- The proof rule becomes: a plan is **measured** when every machine that is not retired answered, no
  machine is left out, no `machines_retained` unit (#24) falls inside the week, and the week window
  starts on or after the `retired_at` of every retired machine.
  If the window starts before a retirement, the plan stays a **floor**. The run then names the machine
  and the first day a measured week is possible.
- `--json` gets a new field: `machines_retired: [{ machine, retired_at, last_scan_at, days_kept }]`.
  The dashboard shows one line per retired machine under the machine notes (`machineNotes()` in
  `src/draw.mjs`).

### Public contract touched

- `hosts.json`: the new `retired` key. Old stores without it read as "nothing retired".
- `--json`: the new `machines_retired` field.
- `skills/worthit/SKILL.md` and `worthit schema` describe both, in the same PR.
- The README's machine section names the command.

### Tests

The fixture store from issue 25 gets the case "a retired machine with 14 saved days and no answer". The
expected file holds those 14 days, `machines_missing: []`, and a measured plan for a week window that
starts after `retired_at`. Breaking the proof rule makes `make check` fail and name the case.

## Deliveries

| # | Delivery | State |
|---|---|---|
| 1 | `worthit hosts` and `hosts retire` / `unretire`, the proof rule, `machines_retired`, the fixture case | open (#26) |

## Open questions (for the owner)

1. **Command, picker, or both?** Recommended: the command now, and the picker lists retired machines
   without offering them. Retiring is rare and hard to undo by accident from a command. An arrow-key
   picker makes it easy to hit by mistake.
2. **May `retired_at` be set back in time?** Without `--since`, the first measured week comes seven days
   after the command runs. With `--since <date>`, the person states that nothing ran on the machine
   after that date. The date may not be earlier than `last_scan_at`. That moves the first measured week
   earlier, but the claim is the person's, not the data's. Recommended: allow `--since`, and have every
   run that relies on it say "retired since <date>, as stated by you" next to the measured plan.
3. **Should worthit suggest retiring?** For example, a hint after a machine has given no answer for 14
   days. Recommended: a one-line hint in the machine notes only. Never retire anything automatically.
