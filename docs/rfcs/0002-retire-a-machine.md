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

A machine that is gone for good (sold, wiped, reinstalled) keeps every plan at floor:

- While it stays in the saved selection, or in any run with `--hosts all`, its saved scan stands in on
  every run, so it is missing forever. The weekly checkpoint (RFC 0003) runs with `--hosts all`.
- When the person leaves it out of the selection, it counts as left out while its saved scan is younger
  than the run's window (`--days`, 21 by default) and holds usage (`src/collect.mjs:101-103`).

So the weekly allowance check cannot say whether a plan moved for at least three weeks, and never under
`--hosts all`.

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
- `unretire` moves the snapshot back to `run-keep/<alias>.json`, removes the entry and adds the alias back
  to the saved selection, so the next plain run asks it. Its next fresh answer is merged with the snapshot
  by #24's rule, like any saved scan. Weeks already recorded keep their values.
- All three commands print JSON when stdout is not a terminal, like the other read commands.

### What a run does with a retired machine

- It is never asked over ssh. It is never in `--hosts all` or the saved selection. The machine picker
  lists it as retired and does not offer it (open question 1).
- **Its snapshot.** `retire` moves `run-keep/<alias>.json` to `run-keep/retired/<alias>.json`. No run
  writes to that folder, so the snapshot stays frozen until `unretire`. It is identified by its alias and
  by the host name the scan reports (its `host` field). That is the same key the duplicate check uses
  (`src/collect.mjs:90-93`).
- **Reading it.** A run reads each snapshot after the duplicate check of live answers, and only for days
  inside the run's window:
  - No live answer reports the snapshot's host (no ssh alias, and not the local scan). The snapshot stands
    for that machine, as a saved scan does today.
  - A live answer reports the same host. Then the machine is not gone. The snapshot is merged into that
    answer exactly as #24 merges a saved scan into a fresh one (`core/merge_scans.py`):
    - one whole winner per machine + day + provider unit: higher API value, then more tokens, and a full
      tie keeps the fresh scan;
    - only days the fresh scan fully covers are compared;
    - units are never summed, so one session cannot count twice.

    The run notes "<alias> is retired but answers as <other alias>".
- **Days before the window** are not read. A run rewrites only the days inside its window
  (`src/collect.mjs:313`), so the retired machine's older days stay in the history as they are.
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

Two more cases:
- **Retired, but answering under another alias.** A retired snapshot, and a fresh answer from another
  alias that reports the same host, with sessions in both. Each unit is counted once, and the winner
  follows #24's rule.
- **Retire, then unretire.** Retire, then run on several days while the window moves, then unretire.
  The snapshot does not change while the machine is retired. The first run after unretire merges it with
  #24's rule, and the history rows before the window keep their values.

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
