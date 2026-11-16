# RFC 0005: Day, week and month: views and the game

## Proposal in short

1. **Views.** The plain run leads with today against yesterday by the same hour. `--weekly` and `--monthly` are new views beside the `worthit weekly` command. Once all three exist, the plain run drops its week and month blocks.
2. **Proof.** A day is recorded only when it was read whole. A change is shown only when both ends match in machines, PR sources, prices and counting rules, and for dollars have no omp or dsh usage. Otherwise it is blank, the allowance change included.
3. **Game.** Delivery 1 takes token XP, the usage streak and the unproven bests off the screen. No win, streak or best is scored until a merged PR can be validated by a review verdict on the forge. Until then the views show comparisons and activity.
4. **KR1.** Per project and per model, daily: merged PRs, value per merged PR, and a first-pass proxy (no commit after the PR was opened), always labelled a proxy. The model and proxy fields need RFC 0004 delivery 2.
5. **Privacy.** Project rows appear only in `worthit projects`: not in the dashboard, the PNG, the `.md` or the AI agent's data.
6. **Order.** Proof base, day view, KR1 cut, week view, month view: one PR each. Month comparisons start in January 2027. **`yes` accepts every recommended answer below.**

| Field | Value |
|---|---|
| Status | Queued |
| Created | 2026-11-16 |
| Issue | none yet (the owner's ask, relayed 2026-11-16; KR1 of the OKR accepted 2026-11-16) |
| Depends on | Deliveries 1 and 2 need no data from another RFC; they land after RFC 0004 delivery 1 (same files). Delivery 3 needs RFC 0004 delivery 1, and its model and proxy fields RFC 0004 delivery 2. Scoring needs RFC 0004 question 6 |

## Summary

worthit gets three periods (the local day, the ISO week, the calendar month) and one view for each: the
plain run shows the day, `--weekly` the week, `--monthly` the month. Each view compares the period with
the one before, like with like. A new table, `period_result`, keeps one row for every period that was
read whole, with the basis it was counted on, and a comparison is shown only when the two bases match.
RFC 0004's per-project and per-model fields get a daily cut, kept in a second table so weeks and months
can add it up. The game's rules are fixed here, but nothing is scored until a delivery can be validated.

## Motivation

The owner's ask, in his words: "i would like to improve it further and keep gamifying, so that we can
see us improving everyday, and every week, and every month... the normal scan shows daily --weekly
--monthly is focused on week month stats (and the assistant just answers any questions)".

KR1 of the OKR the owner accepted on 2026-11-16: "worthit shows per project and per model, daily: merged
PRs, value per merged PR, and the share that passed on the first try".

The orchestrator's reading: the plain scan becomes the day view (today against yesterday, a streak, a
daily win); `--weekly` and `--monthly` show the week and the month; the skill and the question bar
answer everything else from the store. The code confirms the reading and corrects it in five places.

**Confirmed:**

- The plain run has no day view. `buildData` cuts everything at seven days back (`src/collect.mjs:388`),
  the tiles compare "vs prev 7 d" (`src/draw.mjs:66`), and the only per-day numbers are sparklines and
  `delivery.days`.
- `--weekly` and `--monthly` are free. Flags are looked up by name (`bin/worthit.mjs:37`) and only a
  first word without a dash is checked as a command (`:44`), so today `worthit --weekly` draws the plain
  dashboard and ignores the flag. Adding the two flags breaks nothing.
- The assistant already looks things up: the question bar runs `get`, `days` and `sql` on the store
  (`bin/worthit.mjs:158-159`), and the skill documents the same commands.

**Corrected:**

1. **Today is not over.** "Today against yesterday" compares a part of a day with a whole day. The view
   compares today with yesterday up to the same hour.
2. **Today's game pays for raw usage**, in three places: XP per output token (`src/collect.mjs:558`), a
   streak that counts any day with output and reads 0 every morning before the first request (`:559`),
   and the best "most tokens in a week" (`:561`). "Keep gamifying" cannot extend these.
3. **`--weekly` is not `worthit weekly`.** The command is headless, reads every ssh machine and has git
   off (`bin/worthit.mjs:57-58`); it writes a card and a `weekly` row (RFC 0003). The flag is a view.
   Both are kept.
4. **The store cannot say whether a past day was complete.** `history.json`, `day_provider` and `day`
   keep the highest value seen (`src/collect.mjs:487`, `:518`) with no machine check. RFC 0003 refused
   the meter ledger as a baseline for the same reason. A comparison therefore needs a new stored record.
5. **A daily win cannot be scored honestly yet.** The collector knows who authored a merged PR, when it
   merged and its title prefix (`src/collect.mjs:265-270`): no review and no size. Any count of merged
   PRs can be raised by trivial ones, so scoring waits for a validated delivery (section 3).

## Design

### 1. Three periods and the unit of proof

| Period | Id | Boundary | Same id as |
|---|---|---|---|
| day | `2026-11-19` | the local day of the machine that runs worthit | `day_provider.day`, `day.day` |
| week | `2026-W47` | ISO week, Monday to Sunday, of local days | `worthit days --group week` |
| month | `2026-11` | calendar month of local days | `worthit days --group month`, the `month` view |

**Two kinds of week, never mixed.** `week`, `totals`, `git`, `delivery`, `plans`, `worthit weekly` and
RFC 0004's `projects` keep their rolling seven days: a plan's limit is a rolling week, so the allowance
stays rolling. Periods that are compared must not overlap, so `periods.week` is the ISO week. Every
output says which one it shows: "last 7 days" or "week 47".

**Like with like.** A period that is still running is compared with the same stretch of the one before:

| Period | This stretch | Compared with |
|---|---|---|
| day | today up to the last full hour | yesterday up to the same clock hour |
| week | Monday through yesterday | the same weekdays of the week before |
| month | the 1st through yesterday | the same day numbers of the month before (through its last day when it is shorter) |

- The day stretch comes from this run's own scan: the hourly `activity` rows and the PR merge times.
- The week and month stretches use closed days only. On a Monday, or on the 1st, there is no stretch
  yet: the view leads with the period that just closed.
- A closed period is compared whole. Months differ in length, so a month's merged PRs are compared per
  calendar day.

**The day is the unit of proof.** A week or a month is complete only when every one of its days was
judged complete. This is what lets a month be trusted although git's coverage reaches back 14 days only.

**The record.** A new table in `worthit.db`:

`period_result (kind TEXT, period TEXT, result TEXT, judged_at TEXT, json TEXT, PRIMARY KEY (kind, period))`

- `kind` is `day`, `week` or `month`; `period` is the id; `judged_at` is an ISO time; `json` holds the
  numbers the period was judged on and their `basis` (section 5).
- `result` is the day's activity (`delivered`, `active`, `off`: section 3). For a week or a month it is
  `null` until scoring starts, then `win`, `held` or `miss`.
- A row proves the period was complete **for the machines and the PR sources its `basis` names**. It
  says nothing about a machine or a source added later. No row means **not judged**.

**When a day is judged.** A run judges every closed day that has no row, when all hold:

1. git is on and `git.coverage.prs` is true.
2. The machine half of the proof rule holds for that day (RFC 0002, as RFC 0004 applies it to its week):
   every machine that is not retired answered, none is left out, no retained unit falls on that day, and
   the day starts on or after every retirement.
3. **Every source read succeeded on every machine:** no log file, tool or usagemeter store failed to
   read. This is a requirement on delivery 1, not something the scanner proves today. It catches a
   failed tool or file, notes it and still prints its JSON (`core/extract_usage.py:271`, `:611`,
   `:616-622`); the collector takes exit 0 as success (`src/collect.mjs:101`, `:112`); and some `except`
   branches note nothing (`core/extract_usage.py:443`, `:464`). Delivery 1 makes every failed read reach
   the scan's `errors`, and a run with any error on any machine judges no day.
4. The day is over on this machine's clock.
5. **The whole local day, midnight to midnight, is inside both windows.** `--days` cuts at now minus N
   times 24 hours (`core/extract_usage.py:18`) and git at now minus 14 days (`src/collect.mjs:180`),
   neither at midnight. The oldest, partly cut day is not complete. So one run judges at most 13 days
   back, and a `--days 3` run at most 2.

Otherwise the run writes nothing for that day and names the reason. These runs judge nothing:
`worthit weekly` (git off), `--git no`, a run with a machine missing or left out, `--demo`.

- The numbers in a day row come from the run that judged it: its scan and its git answer, not the
  stored maximum. A week's and a month's numbers are the sums of their day rows.
- A row is final: no later run rewrites it. A day that leaves git's window not judged stays not judged.
- A week row is written from its seven day rows, and a month row from all of its day rows, by the first
  plain or `--json` run that finds them all.
- `worthit weekly` and `--demo` never write to this table.

**When each comparison first exists.**

| Comparison | First exists |
|---|---|
| Today against yesterday by the same hour | the first run whose checks pass (section 5) |
| Judged days | the first complete run, for up to 13 days back |
| The week so far against the same weekdays | the first complete run |
| A whole week against the week before | within 7 days of the first complete run (two whole ISO weeks of judged days) |
| The month so far against the same days | when both stretches are judged. With delivery 1 in late November 2026: January against December, from 2 January 2027 |
| A whole month against the month before | after two whole months of judged days. With delivery 1 in late November 2026: on 1 February 2027 |

Until then a week or month shows its numbers as floors, "at least", with no comparison.

Alternatives: judge from `history.json` (no machine check, so floors would be compared); rolling
seven-day periods (they overlap); let a later run rejudge a day (a comparison would change under the
person); judge a month with some days missing (a floor compared).

### 2. The views

One run draws one view. The flags choose what is drawn, never what is scanned or stored.

| Command | View | New block | Comparison |
|---|---|---|---|
| `worthit` (also `worthit --daily`) | day | `Today` | today against yesterday by the same hour |
| `worthit --weekly` | week | `Week` | week 47 so far against the same weekdays of week 46 |
| `worthit --monthly` | month | `Month` | November so far against the same days of October |

**The Today block** (synthetic numbers; the model lines arrive with delivery 3):

```
 TODAY  Thu 19 Nov · through 14:00                             yesterday by 14:00
 SHIPPED        6 merged PRs                                   5      ▲ 1 more
 COST PER PR    $45                                            $51    ▼ 12%
 value used     $270 · 2.8M tokens out                         $255   context
 opus-5-5       led 4 PRs · first-pass proxy 3 of 4
 gpt-6.1-sol    led 2 PRs · first-pass proxy 1 of 2
 ◆ merged a PR today · 4 of 5 judged days this week had one · yesterday: 8 merged PRs
```

When the day is a floor, the same block says so and compares nothing:

```
 TODAY  Thu 19 Nov · through 14:00
 SHIPPED        at least 6 merged PRs            not compared
 COST PER PR    $45 · partial PR count           not compared
 build-box: no answer, last saved scan used · these days stay not judged until it answers
```

**How each view relates to today's dashboard.** Today's order is Verdict, Tiles, Row(LevelCard,
PlanRanking), Receipts, Delivery, Row(Heatmap, LimitTrend), WasteTable, Months, ModelMix, Events, Summary
(`bin/worthit.mjs:146`).

- **Delivery 1** adds no block. It changes what the existing blocks may claim (sections 3 and 5).
- **Delivery 2** puts `Today` after the Verdict. No other block moves.
- **Every view keeps** Row(LevelCard, PlanRanking) and, with an AI agent, the Verdict and the Summary.
  Goal 1 is the allowance, so PlanRanking, its proof labels and its machine notes are on every view,
  and the Verdict keeps its rule (which plan gave the most).
- **With AI off** there is no Verdict and no Summary, as today (`builtin()`, `bin/worthit.mjs:186`).
  The period block is then the first block.
- **`--weekly`** is the period block plus the blocks that already show a week: Tiles, Receipts,
  Delivery, Row(Heatmap, LimitTrend), WasteTable, Events.
- **`--monthly`** is the period block plus Months and ModelMix.
- **After delivery 5**, when every block has a view to live in, the plain run goes slim (question 3):
  Verdict, Today, Row(LevelCard, PlanRanking), Tiles, WasteTable, Events, Summary. WasteTable stays
  because allowance about to reset is something to act on today. This changes what a plain run draws,
  and the README says so in the same PR.
- The plan change on every view is the one rule the plain run has: `plans[].change_vs_last_week_pct`,
  from the `plan_value` row seven local days earlier, both measured, and from delivery 1 with matching
  bases (section 5). No third rule. The month view shows no plan change month over month.
- Files: `--weekly` writes `<date>-worthit-weekly.md` and `.png`, `--monthly` writes `-monthly`. The
  audit log keeps its name.

**`--weekly` and `worthit weekly`.** Both are kept. The command's fields and their types, its exit codes
0, 1 and 3, its card and its `weekly` table stay as RFC 0003 delivered them. Two things change for it:
delivery 1 adds `basis` keys to its JSON and makes its changes fail closed (section 5), and delivery 4
adds a stderr line in a terminal (below).

| | `worthit weekly` (RFC 0003) | `worthit --weekly` (this RFC) |
|---|---|---|
| For | a scheduler | a person at a terminal |
| Prints | JSON, a card, an exit code | the dashboard, week blocks |
| Week | rolling 7 days | allowance: rolling 7 days. Everything else: the ISO week |
| Machines, git, AI | all machines, git off, AI off | as a plain run |
| Writes in the store | a `weekly` row | `period_result` rows |

- `worthit --json --weekly` prints the same JSON as `worthit --json`: the JSON always has all three
  periods. Two view flags in one run exit 2 with one line. `worthit weekly` ignores a view flag, as it
  does today.
- When `worthit weekly` runs with a terminal on stdout, it adds one line on stderr: "worthit weekly is
  the scheduler checkpoint. The week view is: worthit --weekly". Stdout and the exit code do not change.

Alternatives: merge the two (a public command would change by whether it is piped); rename the command
(breaks every scheduler that calls it); `--week` and `--month` (question 2).

### 3. The game

**Delivery 1 takes the unproven rewards and comparisons off the screen.** Every path that pays for raw
usage, or shows a change with no proof, is named here. The fields keep their types.

| Today | From delivery 1 |
|---|---|
| XP per output token (`src/collect.mjs:558`) | the token term leaves `game.xp`. Levels are recomputed from history once, so a level can drop |
| `game.streak_days`: days with any output (`:559`) | stays in the JSON, marked legacy in the schema and the skill, and is no longer drawn |
| `game.personal_bests`: most tokens; most PRs and lowest cost from stored maxima with no basis (`:561-563`) | an empty list, and not drawn, until bests are scored |
| `totals.output_tokens_change_pct`, `totals.api_value_change_pct`: no machine check (`:467`) | `null` unless both rolling weeks pass conditions 2, 3 and 5 of section 1; the dollar one also needs the dollar rule of section 5 |
| `git.usd_per_pr_change_pct`, `delivery.usd_per_feature_change_pct`: PR coverage only (`:473`, `:504`) | the same, with PR coverage |
| Tiles and LevelCard (`src/draw.mjs:65-79`) | a `null` change is drawn as "not compared". LevelCard draws the activity level, the days tracked and the Zero Waste line |
| the summary prompt (`bin/worthit.mjs:148`), share texts and cards | state a change only when its field is not `null`, and call a week more or less productive only then |

**The activity level.** With the token term gone, XP is 25 per merged PR and 2 per commit, as today. It
stays because it is a running count, not a claim of improvement, and it takes no part in any comparison.
Its limit is named: trivial PRs and commits raise it. LevelCard labels it "activity". Question 6 can hide
it. The Zero Waste line stays: it reports unused allowance (goal 1) and scores nothing.

**Activity per day, not a result.** A judged day is one of:

| Activity | Rule |
|---|---|
| `delivered` | at least one merged PR that day |
| `active` | some observed activity and no merged PR |
| `off` | no request, no token in or out, no omp or dsh row, no merged PR and no commit |

The views say "merged a PR today" and "4 of 5 judged days this week had one". There is no daily win and
no streak.

**Why nothing is scored yet.** Any merged PR counts, and nothing checks what it was. One self-merged
formatting PR a day would win every day, and splitting work raises any count of PRs. A filter on the
title prefix does not close this: the prefix is written by the author. So wins, streaks and bests wait
for a delivery that can be validated.

**A validated PR** is a merged PR with a review verdict recorded on the forge for its head commit. That
is RFC 0004's question 6; RFC 0004 found no forge review on three of this repository's merged PRs. The
scoring delivery is not scheduled. It needs that answer to be `yes` and RFC 0004 delivery 2 to read
reviews. Its first fixture: a day with one self-merged `style:` PR and no verdict is `delivered` and
scores nothing; the same PR with a verdict on its head commit is one validated PR.

**The rules scoring will use.** They are fixed here so that delivery is small.

- **Two measures:** validated PRs (more is better) and API value per validated PR (less is better, with
  at least five at both ends and the dollar rule of section 5). The first-pass proxy is shown, never
  scored. Nothing is scored on dollars, tokens or requests alone.
- **A week or a month.** Each measure that can be compared is `better` or `worse` when it moved more than
  5% (the `moved` threshold of RFC 0003, with the same rounding), otherwise `same`.

| Result | Rule |
|---|---|
| `win` | at least one measure better, none worse |
| `miss` | at least one measure worse, none better |
| `held` | everything else: all the same, or one better and one worse |
| not judged | a day of either period is not judged, or no measure can be compared (section 5) |

- **No day off for a week or a month.** A fully read week with no validated PR after a week that had
  some is a `miss`.
- **A day** wins with at least one validated PR, is a `miss` when `active` without one, and passes when
  `off`.
- **A streak** is the number of wins since the last miss. `held`, `off` and not-judged periods pass:
  they add nothing and break nothing. The visible text always shows them: "3 winning weeks since week
  44 · 1 held · 1 not judged".
- **A best** is kept per period and per basis (section 5): a best is beaten only by a period it can be
  compared with.
- **Missing evidence is never a loss.** A period that is not judged is never a miss.

Known limits, named: a validated PR can still be small or split; a verdict posted by the team's own
account is the team's process, not an outside check; a person who ships without pull requests has no
delivery to count.

Alternatives: score merged PRs as counted (question 1; it can be farmed); count commits as delivery
(cheaper still to inflate, and `git.coverage.commits` is a weaker source); filter by title prefix (the
author writes it); one score that mixes the measures (nobody can check it); a win for any measure that
got better (a cost that got worse would be hidden).

### 4. Truth rules

- **Measured stays with the plan's own meter.** A sum of logs is never called "measured" (RFC 0004). A
  period's numbers are complete (`floor: false`) or a floor (`floor: true`, say "at least").
- **A floor is never compared.** When `floor` is true at either end, every `change` field is `null` and
  the view says "not compared". This holds for the day, the week and the month, open or closed.
- **A floor is never a result.** A period that is not complete gets no row.
- **PR counts have their own check.** With `coverage.prs` false, `merged_prs` is "at least",
  `usd_per_merged_pr` is labelled "partial PR count" and is never a lower bound, and nothing is
  compared: the rule the skill has for `git.usd_per_merged_pr`.
- **Machines are stated.** Every view draws the machine notes, and the JSON keeps `machines_missing`,
  `machines_left_out`, `machines_retained` and `machines_retired`. `game.<kind>.not_judged` names each
  recent period without a row, why, and which machine.
- **Days are local days**, cut by the clock of the machine that runs worthit, as `day_provider` and `day`
  are today. Usage from other machines and PR merge times are placed on that clock.
  - An hourly usage bucket is a UTC hour. In a time zone with a half-hour offset the day stretch ends at
    the end of the last full UTC hour, shown in local time.
  - On a clock-change day "the same clock hour" is used as it reads; nothing is corrected.
  - A person who changes time zone keeps the stored days as they were cut.
- **UTC where the store is UTC.** `day_model` holds UTC days. The per-model numbers of section 6 are cut
  from hourly rows into local days, so for one date they do not equal `worthit days --by model`. Both
  are labelled, and the two are never put side by side per day. ModelMix keeps its UTC label.

### 5. The basis at both ends

A requirement of the fleet council (Sofia): a repricing or retained history must never look like a team
improving. So every stored row keeps what it was counted with, and a comparison is made only when the
two ends were counted the same way.

**What exists today.**

- A `weekly` checkpoint row (RFC 0003) keeps coverage for its own week: `machines_read`,
  `machines_missing`, `machines_left_out`, `machines_retired`, `machines_retained` and each plan's
  `proof`. Its `compared_with` repeats only the baseline's time, week end and plans with their proof
  (`src/weekly.mjs:30-32`).
- The plain run's plan change reads `plan_value`: a value and a proof, nothing else
  (`src/collect.mjs:413-438`, `:514`).
- No stored row names the worthit version. `--json` prints it at the root (`bin/worthit.mjs:99`);
  `last.json`, the checkpoint and `plan_value` do not keep it.
- Nothing names the price basis: `core/prices.json` has no version and no date field. Nothing names
  which machines were read: `machines` is a count (`src/collect.mjs:466`).

**What is added.** One object, `basis`, in every `period_result` row, in every `plan_value` row, in the
`worthit weekly` JSON, and beside every period in the run JSON together with the period it is compared
with:

```json
"basis": { "worthit": ["0.41.0"],
           "rules": { "usage": [1], "delivery": [1], "first_pass": [1] },
           "prices": ["3fa9c1d2e4b7"],
           "outside_table": { "rows": 0, "usd": 0, "unpriced_output_tokens": 0 },
           "machines": { "id": ["9c1e44a07b2d"], "read": 3, "missing": [], "left_out": [],
                         "retired": [], "retained": [] },
           "pr_sources": { "id": ["5d20be81f3a6"], "answered": 2 } }
```

| Key | Meaning |
|---|---|
| `worthit` | the package version that scanned and priced. The scanner is bundled and the same file is sent to every ssh machine, so one run has one scanner version |
| `rules` | three new integers, starting at 1, like `CACHE_VER`. `usage`: what a request counts or costs. `delivery`: which PRs are counted and how they are deduplicated. `first_pass`: the PR-to-model link and the proxy. A PR that changes one of these raises it |
| `prices` | the first 12 hex digits of the SHA-256 of `core/prices.json` without its `_sources` notes. It is computed, so nobody can forget it |
| `outside_table` | usage the price table did not price: omp rows with the cost omp reports, dsh rows priced at rates fitted from those costs or left unpriced at $0 (`core/weekly.py:359-365`), and tokens of any model the table has no price for. `rows` counts them whatever their dollar value |
| `machines.id` | which machines were counted, not how many: a hash of the sorted host names of every machine that answered and every retired snapshot, salted with a random value kept in the store. It cannot be read back into names and means nothing outside this store |
| `machines` (the rest) | machines read, and the missing, left-out, retired and retained lists for that period, as the run JSON has them |
| `pr_sources.id` | which PR sources answered: the same kind of hash over the names in `git.coverage.sources` (`usagemeter`, each `gh` account, each `glab` host, `tea`). Account names never leave the hash |

A day has one value in each list. A week or a month has every distinct value of its days.

**What may be compared.** A value is compared between two periods only when every key in its row is
known, single and equal at both ends. Anything else is not compared, with the reason in
`change.not_compared`: `basis_unknown`, `machines_changed`, `pr_sources_changed`, `rules_changed`,
`repriced`, `outside_table`.

| Compared | Keys |
|---|---|
| merged PRs, validated PRs | `pr_sources.id`, `rules.delivery` |
| the first-pass proxy, PRs led | those, and `rules.first_pass`, `machines.id`, `rules.usage` |
| tokens and requests | `machines.id`, `rules.usage` |
| any dollar value: API value, cost per merged PR, cost per feature | `machines.id`, `rules.usage`, `prices`, and `outside_table.rows` and `unpriced_output_tokens` both 0 at both ends. A cost per PR also needs the PR keys |
| a plan's value per full week | `machines.id`, `rules.usage`, `prices` |

- **This covers every period and both kinds of comparison.** A day's cost against yesterday's follows
  the dollar row like a week's: omp reports a cost per row, and two days can carry two tariffs. One run
  shares its version, rules, prices and machines, not its outside-table costs.
- **Anyone who uses omp or dsh gets no dollar comparison and no cost best,** at any period. Their dollar
  values are still shown. This is relaxed only when both ends can be priced on one documented basis.
- **The same table decides a win and a best.** A week or month with no comparable measure is not judged.
  A best is beaten only by a period whose keys match its own; on a new basis a best starts again and the
  old one is kept with its basis.
- **The version alone does not block.** Every merge into `dev` cuts a release. When the two ends differ,
  both versions are printed beside the comparison.
- **A machine or a PR source that is added or replaced** changes an id. Comparisons across that change
  stop, and resume once both ends are on the new id.
- A view prints one line when a comparison is left out: "prices changed on 3 Dec: cost per PR not
  compared", or "a machine was added on 9 Dec: usage not compared".

**The allowance comparisons** follow the same table from delivery 1, on both paths:

- `plan_value` gets one column, `basis` (the object above, as JSON). `plans[].change_vs_last_week_pct`
  is `null` when either row's basis is unknown or the keys differ.
- The `worthit weekly` JSON gets `basis` at its root and inside `compared_with`. Its
  `plans[].change_vs_last_week_pct` and `moved` follow the same rule. `safe_to_post`, `reasons` and the
  exit codes do not change: they are about machines.
- **There is no exception for old rows.** A row written before delivery 1 has no basis, so a plan's
  change is `null` for the first seven days after delivery 1 in a plain run, and in the first
  `worthit weekly` checkpoint after it. That is stated in the release note and the README.

Alternatives: a hand-written version in `prices.json` (somebody forgets to raise it); a count of machines
(a replaced machine keeps the count); block every comparison across two worthit versions (releases are
daily, so nothing would ever be compared); keep the percentage and label it "basis unknown" (a price
change would show as a quota change in exactly that week).

### 6. Per project and per model, per period

RFC 0004 delivers the fields: delivery 1 the projects, delivery 2 the lead model and the `first_pass`
signal. Its source is `opened`, as relayed from the owner: a date proxy, true when no commit on the PR
is dated after the PR was opened. It is not the review, and work redone before the PR was opened passes
it. This RFC defines the daily cut of those fields and how a week and a month add them up. That is KR1,
with the proxy standing for "passed on the first try" only if question 5 says so.

**The daily cut.** `periods.day.projects` is RFC 0004's `projects` block for one local day instead of
seven rolling days, with the same field names. It covers today so far, the same stretch as `now`.
`worthit projects --daily` prints it for today so far and for the last closed day. The example is the
whole day 2026-11-18:

```json
"projects": {
  "floor": false,
  "first_pass_source": "opened",
  "coverage": { "machines": true, "unresolved_rows": 0, "unresolved_usd": 0, "attributed_pct": 100,
                "prs_sources": true, "prs_attributed": true,
                "merged_prs": 8, "linked_prs": 7, "ambiguous_prs": 0, "signal_known_prs": 7 },
  "rows": [
    { "project": "github.com/acme/app-api", "name": "app-api",
      "merged_prs": 6, "api_value_usd": 300, "usd_per_merged_pr": 50,
      "first_pass": 4, "first_pass_known": 6, "first_pass_pct": 67,
      "models": [
        { "model": "opus-5-5", "tool": "claude", "api_value_usd": 210, "share_pct": 70,
          "prs_led": 4, "first_pass": 3, "first_pass_known": 4, "first_pass_pct": null },
        { "model": "gpt-6.1-sol", "tool": "codex", "api_value_usd": 90, "share_pct": 30,
          "prs_led": 2, "first_pass": 1, "first_pass_known": 2, "first_pass_pct": null } ] },
    { "project": "github.com/acme/web-client", "name": "web-client",
      "merged_prs": 2, "api_value_usd": 84, "usd_per_merged_pr": 42,
      "first_pass": 1, "first_pass_known": 1, "first_pass_pct": null,
      "models": [
        { "model": "opus-5-5", "tool": "claude", "api_value_usd": 84, "share_pct": 100,
          "prs_led": 1, "first_pass": 1, "first_pass_known": 1, "first_pass_pct": null } ] }
  ],
  "no_repository": { "api_value_usd": 0 },
  "prs_without_project": { "merged_prs": 0 }
}
```

- Usage belongs to the local day of its hour, from RFC 0004's hourly `project_activity`. A PR belongs to
  the local day it merged. `usd_per_pr_led` follows RFC 0004 delivery 2's definition.
- The rows and `no_repository` add up to the day's totals: here 8 merged PRs and $384.
- Before RFC 0004 delivery 2 merges, `prs_led` and every `first_pass` field are `null`.
- The `first_pass` field names are RFC 0004's. `first_pass_source` says which signal they hold.

**Rules.**

- **It is a proxy, and it is called one everywhere:** in the views, in `worthit projects`, in the schema
  and in the skill. The words are "first-pass proxy": "first-pass proxy 3 of 4". No output says "passed
  first time".
- **Counts are always shown. A rate needs five.** `first_pass_pct` is `null` under five PRs with a known
  signal in that row and that period (RFC 0004's rule), per project and per model. On one day most rates
  are `null`. That is expected.
- **Value per merged PR** is shown whenever a row has a PR, as in RFC 0004. A PR's work is rarely all on
  its merge day, so one day's value per PR is noisy: read it over the week.
- **A week and a month add counts, never rates.** `periods.week.projects` and `periods.month.projects`
  sum the days' `merged_prs`, `api_value_usd`, `prs_led`, `first_pass` and `first_pass_known`, then work
  out `usd_per_merged_pr`, `share_pct` and `first_pass_pct` on the sums. The minimum of five applies to
  the summed counts, so a rate that is `null` on every day can exist for the week.
- **Comparing two periods** follows the table of section 5, row by row, with five PRs at both ends for
  any ratio or rate (five PRs led, for a model row), and with RFC 0004's own checks:
  - PR counts and proxy counts need `prs_sources` and `prs_attributed` true and every day judged.
  - Value, value per PR and `prs_led` also need `floor: false`: no unresolved usage row on any day.
    Anyone who uses Antigravity, omp or dsh has unresolved usage every day (RFC 0004), so these numbers
    are "at least" for them and are never compared.
- **Unknown is said, never spread.** A PR with no lead model (not linked, or ambiguous) counts for its
  project and for no model. A PR with no proxy signal is in `merged_prs` and not in `first_pass_known`.
  Nothing is shared out by guess.
- **On all work together,** `periods.<kind>.now` gets `first_pass`, `first_pass_known` and
  `first_pass_pct`. They are shown and compared, and never scored (section 3).
- A day row is final, so a day judged before RFC 0004 delivery 2 keeps `null` model and proxy fields.

**Where it is shown.**

- `worthit projects --daily | --weekly | --monthly`: a table in a terminal, JSON when piped, from the
  last run and the store, with no scan. Without a flag it is RFC 0004's seven rolling days, unchanged.
- The `Today`, `Week` and `Month` blocks draw per model only, at most three lines. Repository names are
  not drawn into the dashboard, the PNG or the `.md` (RFC 0004, section 5). Question 4.
- While RFC 0004's question 3 is `no`, nothing with a repository name reaches the AI agent: the
  `projects` cut is left out of the question bar's data, and no lookup returns it by any path. `get
  periods`, `get periods.day` and any deeper path answer without the `projects` key, and `sql` refuses
  the table below. Per-model lines carry no repository name and can go.

**The store.** A second new table in `worthit.db`:

`day_project (day TEXT, project TEXT, model TEXT, tool TEXT, api_usd REAL, output_tokens INTEGER,
requests INTEGER, merged_prs INTEGER, first_pass INTEGER, first_pass_known INTEGER,
PRIMARY KEY (day, project, model, tool))`

- A row with an empty `model` is the project's day: its usage, its merged PRs and their proxy counts. A
  row with a model is that model's usage in the project, and `merged_prs` holds the PRs it led. An empty
  `project` is usage with no repository.
- The rows are written with the day's `period_result` row and never changed after. That row's `json`
  keeps the cut's `coverage`.
- A day with no row is read from this run's scan when it is inside it, and makes the sum a floor.
- This is the daily table RFC 0004 lists as its delivery 3. It is built once, here (section 9).

Alternatives: keep the cut inside `period_result.json` (the question bar's `sql` would hand repository
names to the AI agent); average the daily rates (a day with one PR would weigh as much as a day with
ten); share an unlinked PR between models (a guess).

### 7. JSON and schema

Every run that scans (`worthit`, `--json`, `last.json`) gets one new section, `periods`, and new keys in
`game`. A run with git off has `null` PR fields. Existing fields keep their names and types; the ones
that change value are listed under "Public contract touched".

```json
"periods": {
  "day": {
    "id": "2026-11-19", "days": "local", "open": true, "through": "2026-11-19T14:00",
    "now":    { "merged_prs": 6, "features": 3, "api_value_usd": 270, "output_tokens": 2800000,
                "usd_per_merged_pr": 45,
                "first_pass": null, "first_pass_known": null, "first_pass_pct": null },
    "before": { "id": "2026-11-18", "through": "2026-11-18T14:00",
                "merged_prs": 5, "features": 2, "api_value_usd": 255, "output_tokens": 2600000,
                "usd_per_merged_pr": 51,
                "first_pass": null, "first_pass_known": null, "first_pass_pct": null },
    "change": { "merged_prs": 1, "merged_prs_pct": 20, "usd_per_merged_pr_pct": -12,
                "first_pass_pts": null, "not_compared": [] },
    "floor": false,
    "coverage": { "machines": true, "prs": true },
    "basis": "the basis object of section 5, for this run",
    "last_closed": { "id": "2026-11-18", "activity": "delivered", "merged_prs": 8,
                     "api_value_usd": 384, "usd_per_merged_pr": 48,
                     "basis": "the basis object of 2026-11-18" },
    "projects": "the cut of section 6, for the same stretch as now"
  }
},
"game": {
  "day": {
    "today": "delivered",
    "this_week": { "delivered": 4, "active": 1, "off": 0, "judged": 5 },
    "not_judged": [ { "id": "2026-11-13", "why": "machine_missing", "machines": ["build-box"] } ]
  }
}
```

- `through` is local time with no offset. `usd_per_merged_pr` is not rounded, as in `git`.
- A `basis` shown as a sentence in the example is the full object of section 5. Today and yesterday come
  from one run and share it; for a week or a month, `before` has its own.
- `change.not_compared` lists each value left out and why: `floor`, `under_five`, or a reason from
  section 5.
- `not_judged[].why` is one of `git_off`, `prs_not_covered`, `machine_missing`, `machine_left_out`,
  `retained_unit`, `before_retirement`, `source_error`, `partial_window`, `too_old`.
- `periods.week`, `periods.month`, `game.week` and `game.month` arrive with deliveries 4 and 5, in the
  same shape. For a week or a month, `through` is the end of yesterday.
- When scoring starts, `game.<kind>` gets `last` (the result, its `measures`, its `basis` and
  `before_basis`), `streak` (`wins`, `since`, `held`, `off`, `not_judged`, `best`) and `bests` (each with
  its `basis`).
- `worthit get periods.day` and `worthit get game.day` read them from the last run.

**`worthit schema`** gets four entries: `periods`, `game` (the section has no entry today: its fields
are documented, the legacy ones marked) and the tables `period_result` and `day_project`. The names
already in use there (`day`, `month`, `weekly`, `weekly.result`, `days.result`) keep their meaning, and
`weekly.result` and `plan_value` gain `basis`.

**In the same PR as each delivery:** `worthit schema`, `skills/worthit/SKILL.md` (a row for `periods`,
the `game` row, a section "Day, week and month" with the rules of sections 3 to 6), the question bar's
lookup list (`bin/worthit.mjs:159`), the README, and `demoData()` so `--demo` carries the new fields.

### 8. The assistant answers the rest

- **Three views and no fourth.** A new stat gets a field or a row, and a question finds it.
- **The paths that exist:** the skill in the person's own agent, the question bar, and `--ask`. All
  three already use `get`, `days` and `sql`. This RFC adds what they could not answer: `periods`, the
  per-period `game`, and `period_result` ("how many days in October had a merged PR?", "which week was
  my cheapest per PR?").
- **Rules the skill and the question bar get:** read a period from `period_result`, never work one out;
  say "not judged" and the reason, never "lost"; say "at least" for a floor and compare nothing; say why
  a comparison was left out; give the counts beside any rate; say "first-pass proxy", never "passed
  first time".

### 9. RFC 0004

- **The same measure.** `usd_per_merged_pr` is RFC 0004's value per PR, with the same PR set (authored
  by the logged-in accounts, counted by merge time) and the same "partial PR count" label.
- **The same words.** `floor: true|false` and a `coverage` object, as in `projects`.
- **Different windows, labelled.** `projects` covers the run's rolling seven days (the squads' week of
  16 to 23 Nov). `periods.week` is the ISO week. The two are never shown as the same week.
- **The same privacy.** Repository names are never drawn and never reach the AI agent (RFC 0004,
  section 5), unless its questions 1 and 3 say otherwise.
- **Order.** RFC 0004 delivery 1 goes first: the squads' week is judged with it on 2026-11-23. This
  RFC's deliveries 1 and 2 follow its merge, because they touch `buildData`, `src/query.mjs` and the
  skill. Delivery 3 here needs RFC 0004 delivery 1 in the scan. KR1 is met when delivery 3 here and RFC
  0004 delivery 2 are both merged, with the proxy labelled.
- **Two places in RFC 0004 are now out of date.** This PR does not edit that file. The author of this
  RFC updates both in one docs PR after PR 117 merges, when the orchestrator says so:
  1. its question 5 (the first-pass source) is answered: `opened`;
  2. its delivery 3 no longer builds the daily table: `day_project` is built here, and RFC 0004's
     delivery 3 keeps `worthit days --by project`.

### What leaves the machine, and privacy

No new network request and no new read outside the store. The store gets two tables, listed in the
README's store table. `period_result` holds counts, dollars, the two hashed ids, and machine names only
where `machines_missing` already has them. `day_project` holds repository ids, as RFC 0004's `projects`
block does: local output only. No account name and no PR title is stored. Public images and the demo
use `worthit --demo` with synthetic projects (`app-api`, `web-client`).

### Public contract touched

- **Delivery 1.** New: the `period_result` table, `basis` (in its rows, in `plan_value`, in the
  `worthit weekly` JSON), the scanner's three `rules` numbers. Existing fields that keep their type and
  change value: `game.xp`, `level`, `title` and `xp_next` (no token term), `game.personal_bests`
  (empty), and these changes, which are `null` more often: `totals.output_tokens_change_pct`,
  `totals.api_value_change_pct`, `git.usd_per_pr_change_pct`, `delivery.usd_per_feature_change_pct`,
  `plans[].change_vs_last_week_pct` in a plain run and in `worthit weekly`, with `moved`. LevelCard and
  Tiles draw accordingly. Exit codes do not change.
- **Delivery 2.** The `periods` section (`day`), `game.day`, the `Today` block, the `--daily` flag.
- **Delivery 3.** `periods.day.projects`, the `day_project` table, `worthit projects --daily`, the
  model lines of `Today`.
- **Delivery 4.** `--weekly`, the week keys, `worthit projects --weekly`, the stderr line, exit 2 for
  two view flags.
- **Delivery 5.** `--monthly`, the month keys, `worthit projects --monthly`, the slim plain run.

### Tests

Fixture cases for delivery 1:
- a complete day gets a row with its activity: `delivered`, `active` (requests and input, no output and
  no PR) or `off`;
- no row is written and the reason is named for each of: a machine missing, a machine left out, a
  retained unit on that day, a day before a retirement, `--git no`, PR coverage false, `worthit weekly`;
- **a failed read:** a first scan where one tool's reader fails and git answers writes no row
  (`source_error`), although no older saved unit exists;
- **a partly cut day:** the oldest day that overlaps a `--days 3` cut, and the day that overlaps git's
  14-day cut, get no row (`partial_window`);
- a judged day is not rewritten by a later run with a machine missing or with higher usage;
- `basis`: a changed price file gives another `prices`, and a change to `_sources` alone does not; a
  machine added, and a machine replaced by another with the count unchanged, each give another
  `machines.id`; a newly logged-in forge account gives another `pr_sources.id`;
- a dsh row priced at $0 sets `outside_table.rows`, and every dollar change is `null`, the day one
  included;
- both allowance paths give `null` against a row with no basis, with other prices, or with another
  `machines.id`; the exit code of `worthit weekly` is unchanged;
- with a machine missing, the tiles draw "not compared" for tokens, value and cost per PR, and the
  summary states no change;
- `game.xp` has no token term, `personal_bests` is empty, the usage streak is not drawn; rendered images
  of LevelCard and Tiles were looked at;
- an older store gets the table and the column on its first run.

Fixture cases for delivery 2:
- today against yesterday: usage is cut at the last full hour and PRs at the same clock time; a floor at
  either end gives `null` changes; under 5 merged PRs at either end the cost change is `null`;
- with a fixed time zone, a PR merged at 23:30 local counts for that local day;
- `--demo` carries the new fields; rendered images of the `Today` block, complete and floor, were
  looked at.

Fixture cases for delivery 3:
- a day's rows plus `no_repository` add up to that day's totals;
- under five known PRs the rate is `null` and the counts are present; a week whose days are each under
  five has a rate on its sums;
- an unresolved usage row makes value "at least" and not compared, while PR counts still are;
- a PR that is not linked counts for its project and for no model;
- every output says "first-pass proxy"; none says "passed first time";
- no repository name is in the PNG, the `.md`, the summary prompt or a question-bar lookup, by `get
  periods`, a deeper path or `sql`.

## Deliveries

| # | Delivery | State |
|---|---|---|
| 1 | The proof base, with no new block: `basis`, the day admission rules, `period_result` with day rows, every existing change and both allowance paths fail closed, token XP and the unproven streak and bests off the screen, the summary and share prompts, schema, skill, README, the fixture cases | open |
| 2 | The day view: `periods.day`, `game.day`, the `Today` block, `--daily`, demo data, the fixture cases | open |
| 3 | Per project and per model, daily (KR1): `periods.day.projects`, `day_project`, `worthit projects --daily`, the model lines of `Today`. Model and proxy fields fill when RFC 0004 delivery 2 merges | open |
| 4 | The week view: week rows, `periods.week`, `game.week`, `--weekly` and the `Week` block, `worthit projects --weekly`, the stderr line on `worthit weekly` | open |
| 5 | The month view: month rows, `periods.month`, `game.month`, `--monthly` and the `Month` block, `worthit projects --monthly`, the slim plain run | open |
| 6 | Scoring on validated PRs: wins, streaks, bests, XP for wins (section 3). Needs RFC 0004 question 6 answered `yes` and its delivery 2 reading reviews | not scheduled |

Deliveries 1 and 2 are each a few days of work. The proof base goes first because a day view drawn
above unproven changes would contradict itself on one screen.

**Later work, not in this RFC.** Each of these is reported as unknown wherever it cannot be attributed,
never guessed:

- attribution by bot or squad (worthit sees repositories and models, not bots: RFC 0004, question 2);
- rework: a merged PR that a later PR fixes or reverts;
- human interventions: a person typing on a squad's branch counts for its model today (RFC 0004);
- wins, streaks and bests per project or per model;
- dollar comparisons for omp and dsh usage, once both ends can be priced on one documented basis;
- a share card for a streak or a best.

## Open questions (for the owner)

Question 6 blocks delivery 1. No question blocks delivery 2. Questions 4 and 5 block delivery
3. Question 2 blocks delivery 4. Question 3 blocks delivery 5. Question 1 blocks only delivery 6. Each
answer is one word, and `yes` alone takes every recommended one.

1. **When scoring starts.** `validated`: no win, streak or best until merged PRs carry a review verdict
   on the forge (recommended). `counted`: score merged PRs as counted from delivery 4, knowing trivial
   PRs can farm it.
2. **The flag names.** `weekly`: `--weekly` and `--monthly`, the owner's words, beside the
   `worthit weekly` command (recommended). `week`: `--week` and `--month`, further from the command.
3. **The plain run once all three views exist.** `slim`: the day blocks and the allowance only
   (recommended, it is what the owner asked for). `full`: everything it draws today, plus `Today`.
4. **Where the per-project cut is shown.** `command`: `worthit projects --daily`, with per-model lines
   only in the dashboard (recommended, it follows RFC 0004's privacy rule). `dashboard`: project rows in
   the `Today` block, which puts repository names into the PNG and the `.md`.
5. **KR1's "passed on the first try".** `proxy`: KR1 is reported with the opened-date proxy, always
   labelled a proxy (recommended; what was relayed is that the source `opened` was chosen, not that it
   defines KR1). `review`: KR1 waits for review verdicts on the forge.
6. **The activity level.** `keep`: LevelCard draws the level from merged PRs and commits, labelled
   "activity" (recommended). `hide`: no level on screen until scoring starts.
