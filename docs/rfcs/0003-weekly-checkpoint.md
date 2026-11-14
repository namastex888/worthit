# RFC 0003: The weekly allowance checkpoint

| Field | Value |
|---|---|
| Status | Queued |
| Created | 2026-11-14 |
| Issue | #27 |
| Depends on | #24 (PR 33, for `machines_retained`); RFC 0002 for `machines_retired` |

## Summary

One command, `worthit weekly`, produces everything a weekly "what did each plan give this week" post
needs. It needs no terminal and asks no questions. It writes the allowance card and prints the post text
and the facts behind it as JSON. Its exit code says whether the numbers are safe to post. It never posts
anything.

## Motivation

Today the weekly allowance post takes two steps: `npx worthit` (interactive), then
`npx worthit share allowance`. `share` reads the last run from `last.json` and never scans
(`bin/worthit.mjs:512`). When stdout is not a terminal it already prints JSON (`bin/worthit.mjs:521`).
That JSON has the text and the image path, but it has no plan values and no list of the machines read.
Its exit code is 0 even when a machine was missing. So a scheduler cannot tell a safe week from a partial
one, and a person checks by hand before every post.

## Design

### The command

```
worthit weekly [--hosts all|none|a,b] [--allow-partial] [--no-files]
```

1. Runs a fresh scan with no UI, the same as `worthit --json`. Hosts default to `all`, which leaves
   out retired machines (RFC 0002). Git and the AI agent are off. The allowance post needs neither, and
   with them off the text is the fixed template (`SHARE_TOPICS.allowance`), the same every time for the
   same data.
2. Writes `<date>-worthit-share-allowance.png` in the current folder. With `--no-files`, it writes
   nothing.
3. Records the checkpoint in the store and prints one JSON object:

```json
{
  "week": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "generated_at": "ISO time",
  "text": "the post text",
  "image": "/abs/path/to/card.png or null",
  "plans": [{ "plan": "Claude Max", "usd_per_full_week": 0, "times_plan_price": 0,
              "proof": "measured | floor", "change_vs_last_week_pct": null }],
  "machines_read": 0,
  "machines_missing": [],
  "machines_left_out": [],
  "machines_retired": [],
  "machines_retained": [],
  "compared_with": { "generated_at": "ISO time", "week_to": "YYYY-MM-DD",
                     "plans": [{ "plan": "Claude Max", "usd_per_full_week": 0, "proof": "measured" }] },
  "moved": [{ "plan": "Claude Max", "from": 0, "to": 0, "pct": 0 }],
  "safe_to_post": true,
  "reasons": []
}
```

- `compared_with` is the most recent earlier checkpoint whose week ends at least six days before this
  one. It is `null` on the first run.
- **A change needs a measured plan at both ends.** A percentage is computed only when the same plan is
  measured both in this checkpoint and in `compared_with`. That covers `moved`,
  `plans[].change_vs_last_week_pct`, the text and the card. Otherwise the change is `null`, and the text
  and the card say "at least" with no change.
  - worthit does not search further back for a measured week, because every output labels the change
    "last week".
  - `weekly` never uses the change a plain run computes from the meter ledger. That baseline carries no
    machine check. So on the first checkpoint every change is `null`.
- `moved` lists the plans whose change, under that rule, is more than 5%.
- `safe_to_post` is true when three things hold:
  - `machines_missing` is empty;
  - `machines_left_out` is empty;
  - no entry of `machines_retained` (#24) has a unit inside this week. A retained unit means that machine
    lost logs this week: the week's totals are only a lower bound, and their change against last week
    can mislead.

  A floor does not make a week unsafe: the text and the card already say "at least".
- `reasons` names each machine that made the week unsafe, and why. A retained unit is named by machine,
  day and provider.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Safe to post, or `--allow-partial` was given (then `safe_to_post` may still be false) |
| 1 | No result: the scan failed, or there is no data for the week |
| 3 | Not safe: the run succeeded but `safe_to_post` is false (a machine missing, left out, or with a retained unit inside this week) and `--allow-partial` was not given. The JSON is still printed, with `reasons` |

### The store

A new table in `worthit.db`, with one row per `worthit weekly` run:
`weekly (generated_at TEXT PRIMARY KEY, week_to TEXT, safe INTEGER, json TEXT)`.
`compared_with` is read from it. `worthit sql` and `worthit schema` document it.

### What it never does

It never posts, opens a browser, touches the clipboard, asks a question or needs a TTY. Running it from
a scheduler (cron, launchd) is the intended use.

### Public contract touched

The `weekly` command, its JSON, its exit codes and the `weekly` table. `skills/worthit/SKILL.md`,
`worthit schema` and the README change in the same PR.

### Tests

Fixture cases from issue 25:
- a full week: exit 0, `safe_to_post: true`;
- a machine missing: exit 3, with the machine named in `reasons`;
- the same run with `--allow-partial`: exit 0, `safe_to_post: false`;
- a machine whose retained unit falls inside this week: exit 3, with the unit named in `reasons`;
- a retained unit only in earlier weeks: exit 0, `safe_to_post: true`;
- a retained unit inside the week, with `--allow-partial`: exit 0, `safe_to_post: false`;
- two checkpoints a week apart, both measured: `compared_with` is set, and the change appears in `moved`,
  `plans[]`, the text and the card;
- a measured week after a floor checkpoint: every change is `null`, and nothing is in `moved`;
- mixed plans (one measured at both ends, one a floor at either end): only the first gets a change;
- the first checkpoint: every change is `null`, even when the meter ledger has earlier weeks.

## Deliveries

| # | Delivery | State |
|---|---|---|
| 1 | `worthit weekly`, the `weekly` table, exit codes, fixture cases | open (#27) |

## Open questions (for the owner)

1. **Name.** `worthit weekly` (recommended) or `worthit share allowance --json`? `share` reads the last
   run and never scans. Keeping `share` that way and adding one command that scans keeps both easy to
   explain.
2. **Text by template or by the AI agent?** Recommended: the fixed template. A scheduled run should give
   the same text for the same data. The post in the owner's voice is written from the JSON afterwards.
3. **The `moved` threshold.** Recommended: 5%. Larger or smaller?
