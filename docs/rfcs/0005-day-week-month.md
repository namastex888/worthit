# RFC 0005: Day, week and month: views and the game

## Proposal in short

1. **Views.** The plain run leads with today against yesterday by the same hour. `--weekly` and `--monthly` are new views beside the `worthit weekly` command. Once all three exist, the plain run drops its week and month blocks.
2. **Proof.** A day is recorded only when it was read whole. A change is shown only when both ends match in machines, PR sources, prices and counting rules; otherwise it reads "not compared", the allowance change included. A dollar change compares priced usage only, labelled "priced usage only; omp/dsh not compared".
3. **Game.** A day wins with a qualifying merged PR (title kind feat, fix, perf or refactor, counted once) on a complete day. A week or a month wins when qualifying PRs or their priced cost got better by more than 5% and neither got worse. Streaks and bests read judged periods only. A trivial PR titled `feat:` still wins, so a win is labelled the game and never feeds KR1, a comparison or a productivity claim.
4. **On screen.** Nothing changes until the day view ships. Then, in one delivery: the Today block; the win streak and judged bests replace the usage streak and the old bests; XP stops paying for tokens and commits, with no level lost; a change with no proof reads "not compared".
5. **KR1 and privacy.** Per project and per model, daily: merged PRs, value per merged PR, and a first-pass proxy (no commit after the PR was opened), always labelled a proxy, in `worthit projects --daily`. Project rows never reach the dashboard, the PNG, the `.md` or the AI agent's data. The model and proxy fields need RFC 0004 delivery 2.
6. **Order.** Record (nothing on screen), the KR1 cut, the day view with the game, the week, the month. The day view is the largest PR and is not promised in days; the first two are. Month comparisons start in January 2027. **`yes` accepts every recommended answer below.**

| Field | Value |
|---|---|
| Status | Queued |
| Created | 2026-11-16 |
| Issue | none yet (the owner's ask, relayed 2026-11-16; KR1 of the OKR accepted 2026-11-16) |
| Depends on | Delivery 1 lands after RFC 0004 delivery 1: same files, and it stores that delivery's project rows per day. The model and proxy fields need RFC 0004 delivery 2 |

## Summary

worthit gets three periods (the local day, the ISO week, the calendar month) and one view for each: the
plain run shows the day, `--weekly` the week, `--monthly` the month. Each view compares the period with
the one before, like with like. A new table, `period_result`, keeps one row for every period that was
read whole, with the basis it was counted on, and a comparison is shown only when the two bases match.
RFC 0004's per-project and per-model fields get a daily cut, kept in a second table so weeks and months
can add it up. The game is judged per period on qualifying merged PRs. It is labelled a game and kept
apart from every comparison and from KR1.

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
5. **Any merged PR is too easy a win.** The collector knows who authored a merged PR, when it merged
   and its title prefix (`src/collect.mjs:265-270`): no review and no size. So the game counts
   qualifying PRs only, says what still games it, and is kept apart from every comparison (section 3).

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
- `result` is the game's result (section 3): `win`, `rest` or `miss` for a day, `win`, `held` or `miss`
  for a week or a month. It is `null` when the period is complete and has no result.
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
   `:616-622`); the collector takes exit 0 as success (`src/collect.mjs:101`, `:112`); and at least one
   failed read notes nothing (an Antigravity conversation's records, `core/extract_usage.py:440-444`).
   Delivery 1 makes every failed read reach the scan's `errors`, and a run with any error on any machine
   judges no day.
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

**The Today block** (synthetic numbers):

```
 TODAY  Thu 19 Nov · through 14:00                             yesterday by 14:00
 SHIPPED        6 merged PRs                                   5      ▲ 1 more
 COST PER PR    $45                                            $51    ▼ 12%
 value used     $270 · 2.8M tokens out                         $255   context
 opus-5-5       led 4 PRs · first-pass proxy 3 of 4
 gpt-6.1-sol    led 2 PRs · first-pass proxy 1 of 2
 game ◆ 5-day win streak since 12 Nov · 1 day off · 1 not judged · 5 qualifying PRs so far today
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

- **Deliveries 1 and 2** change nothing on screen.
- **Delivery 3** puts `Today` after the Verdict and changes what the existing blocks may claim
  (section 3). No other block moves.
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
  from the `plan_value` row seven local days earlier, both measured, and from delivery 3 with matching
  bases (section 5). No third rule. The month view shows no plan change month over month.
- Files: `--weekly` writes `<date>-worthit-weekly.md` and `.png`, `--monthly` writes `-monthly`. The
  audit log keeps its name.

**`--weekly` and `worthit weekly`.** Both are kept. The command's fields and their types, its exit codes
0, 1 and 3, its card and its `weekly` table stay as RFC 0003 delivered them. Three things change for it:
delivery 1 adds `basis` keys to its JSON, delivery 3 makes its changes follow section 5, and delivery 4
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

**The game is a game, and it is kept apart.** It is drawn under the word "game". Its numbers live under
`game` only. `periods.*.now`, `projects`, every `change` field, KR1's numbers, the summary's claims
about improving and the share texts' claims about productivity never read a win, a streak, a best or
the qualifying count. What improved is said by the comparisons of sections 1 and 5, nothing else.

**A qualifying PR.** It uses data worthit already has, and it works for a team on one forge account. A
merged PR qualifies when its title kind is `feat`, `fix`, `perf` or `refactor`. It does not qualify when
the kind is `docs`, `chore`, `ci`, `test`, `style`, `build` or `revert`, or when the title has no prefix.

It is counted once. These rules are requirements on delivery 1, and together they are `rules.delivery` 1:

1. One PR is one key (`host/owner/repo#number`), whichever account or source saw it. A PR seen by a
   forge and by the usagemeter store is one PR, as today (`src/collect.mjs:346-349`).
2. It counts on the local day it merged, and on no other day.
3. A revert never qualifies, and a revert merged in a repository takes one qualifying PR of that
   repository off the same day's count, never below zero. GitHub's default title, `Revert "..."`,
   parses as no prefix today (`src/collect.mjs:177`). The game reads it as a revert on its own, in a
   new `pr_kind.revert` column: `kindOf`, `delivery.kinds` and `typed_pct` do not change. A PR stored
   before delivery 1 keeps its stored kind and has no revert mark, because `pr_kind` holds no title.
4. Only merged PRs are read. A PR closed without merging and replaced by another counts as its merged
   end only.
5. **An unknown kind is not a miss.** A PR whose title was never read (one that only the usagemeter store
   knows, `src/collect.mjs:351`) has no kind. A day with no qualifying PR and at least one merged PR of
   unknown kind has no result.

**A daily win.** A judged day (section 1) is one of:

| Result | Rule |
|---|---|
| `win` | at least one qualifying PR merged that day |
| `rest` | no observed usage of any kind (no request, no input token, no output token, no omp or dsh row) and no qualifying PR |
| `miss` | observed usage and no qualifying PR |

A day with no usage and only a PR that does not qualify is a `rest`. While today is open the game shows
the qualifying PRs so far, never a result.

**A weekly and a monthly win.** Two measures: qualifying PRs (more is better) and the priced cost per
qualifying PR (less is better, with at least five at both ends and the dollar rule of section 5). The
first-pass proxy is never scored. Each measure that can be compared is `better` or `worse` when it moved
more than 5% (the `moved` threshold of RFC 0003, with the same rounding), otherwise `same`. Any
qualifying PR is `better` when the period before had none. For a month, qualifying PRs are compared per
calendar day, as merged PRs are (section 1).

| Result | Rule |
|---|---|
| `win` | at least one measure better, none worse |
| `miss` | at least one measure worse, none better |
| `held` | everything else: all the same, or one better and one worse |
| no result | a day of either period is not judged, or no measure can be compared (section 5) |

**No day off for a week or a month.** A known worse period is never turned into a pause: a fully read
week with no qualifying PR, after a week that had some, is a `miss`.

**Streaks.** One per period: the number of wins since the last miss, read from judged periods only. A
`rest` day, a `held` period and a period with no result pass: they add nothing and break nothing. The
visible text always says how many passed: "5-day win streak since 12 Nov · 1 day off · 1 not judged".
Missing evidence is never a loss.

**Bests.** Two for each of the day, the week and the month, over judged periods only: the most
qualifying PRs, and the lowest priced cost per qualifying PR (at least five in the period, and the dollar
rule). A best is kept with its basis (section 5): it is beaten only by a period it can be compared with,
and it is marked new when the period that just closed set it.

**XP and the level.** From delivery 3, XP is paid by the game: 25 per qualifying PR on a judged day and
50 per daily win, then 100 per winning week (delivery 4) and 400 per winning month (delivery 5). Tokens
and commits stop paying. The XP earned before that day is kept as it stood, so no level is lost. It
still contains the token XP of the past: that is said in the schema and the skill. Game XP starts on
the day delivery 3 first runs: days judged before it were paid by the old formula and are not paid
again.

**What still games it.** The game is harder to farm than today's, not impossible:

- a trivial PR titled `feat:` or `fix:` qualifies: the prefix is the author's word, and no review or
  size is checked;
- splitting one change into several PRs raises the count and lowers the cost per PR;
- a revert and its reland on different days both stay counted, because a day row is final and nothing
  links a PR to the one it replaces;
- a repository mirrored on two forges, with the PR merged on both, counts it twice;
- moving work to omp or dsh inside the bound of section 5 lowers the priced cost;
- a repository that uses no title prefixes has no qualifying PR (`delivery.typed_pct` says how many
  titles carry one).

**What changes on screen, and when.** Nothing changes before delivery 3. In delivery 3 each thing that
leaves the screen has its replacement in the same PR, or the rule that forces it is named. The list is
every reward in `buildData` and every change field found by searching `src/collect.mjs`, `src/draw.mjs`,
`src/card.mjs` and `bin/worthit.mjs` for `change_pct`, `change_pts`, `last_week_pct`, `moved` and
`delta(`. The fields keep their types. The rules named are: **usage** (nothing is scored on usage alone:
the brief of this RFC), **floor** (AGENTS.md: a floor is never compared week to week) and **basis**
(section 5: an unknown or different basis is never compared).

| Today | From delivery 3 | Replacement, or rule |
|---|---|---|
| XP per output token (`src/collect.mjs:558`) | stops paying; earned XP is kept, no level drops | none for tokens. Rule: usage |
| XP per merged PR and per commit (`:558`) | stop paying | XP per qualifying PR and per win, which a commit or a docs PR cannot earn |
| `game.streak_days`, drawn as "N-day streak" (`:559`, `src/draw.mjs:76`) | stays in the JSON, marked legacy; no longer drawn | the day win streak, drawn in its place. Rule: usage |
| best "most tokens in a week" (`:561`) | removed | none. Rule: usage |
| bests "PRs merged in a week" and "lowest cost per PR", from stored maxima with no basis (`:562-563`) | removed | the day bests; the week bests return in delivery 4. Rule: floor |
| `totals.output_tokens_change_pct`, `totals.api_value_change_pct`: no machine check (`:467`) | `null` unless both rolling weeks pass conditions 2, 3 and 5 of section 1; the dollar one follows the dollar rule of section 5 | the `Today` comparison. Rule: floor |
| `git.usd_per_pr_change_pct`, `delivery.usd_per_feature_change_pct`: PR coverage only (`:473`, `:504`) | the same, with PR coverage | Rule: floor |
| `model_mix` `change_pts`: token shares from stored maxima (`:549`) | `null` unless both rolling weeks pass the same conditions, and then computed from this run's rows, not from the stored maxima | Rule: floor |
| `git.merged_prs_change_pct`, `delivery.features_change_pct`, `delivery.kinds[].change_pct`, `delivery.fix_share_last_week_pct` (`:473`, `:503-505`) | unchanged: already `null` without PR coverage, and both weeks come from one run, so one set of PR sources and one `rules.delivery` | |
| `plans[].change_vs_last_week_pct`, and `moved` in `worthit weekly` (`:437`, `src/weekly.mjs:42-46`); LimitTrend draws the same field (`src/draw.mjs:119`) | `null` unless the two bases match | Rule: basis. Bases are recorded from delivery 1, so the change is blank only if delivery 3 follows it by less than seven days |
| Tiles, LevelCard, Delivery, ModelMix, LimitTrend (`src/draw.mjs:65-79`, `:119`, `:146-148`, `:198`) | a `null` change is drawn as "not compared" | |
| the share cards and the `.md` report (`src/card.mjs:76`, `:92`, `:100`, `bin/worthit.mjs:263`, `:268`) | read the same fields, so a `null` draws no arrow and no percentage | |
| the summary prompt (`bin/worthit.mjs:148`) and share texts | state a change only when its field is not `null`; may name the streak and the level as the game, never as improvement | |

The Zero Waste line stays: it reports unused allowance (goal 1) and scores nothing.

Not in the table, and unchanged: the history charts (AllowanceHistory, the LimitTrend and Delivery week
columns, Months, the ModelMix bars). They draw stored values per week or month and state no change.
Their limit is named: an older week there has no basis, so nothing may be read off them as proven.
Deliveries 4 and 5 give the week and the month a proven comparison beside them.

**The alternative: validated PRs** (question 1). A win would need a merged PR whose last review on its
head commit is approving and was posted on the forge by an account other than the PR's author. It is
harder to farm, and it is not recommended: RFC 0004 found no forge review on three of this repository's
merged PRs, and a team on one forge account would have no game at all.

Other alternatives: count every merged PR (a formatting PR a day would win every day); count commits
(cheaper still to inflate, and `git.coverage.commits` is a weaker source); one score that mixes the
measures (nobody can check it); a win for any measure that got better (a cost that got worse would be
hidden); a day off for a week (a known worse week would be hidden).

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
           "outside_table": { "rows": 0, "usd": 0, "unpriced_output_tokens": 0, "output_tokens_pct": 0 },
           "machines": { "id": ["9c1e44a07b2d"], "read": 3, "missing": [], "left_out": [],
                         "retired": [], "retained": [] },
           "pr_sources": { "id": ["5d20be81f3a6"], "answered": 2 } }
```

| Key | Meaning |
|---|---|
| `worthit` | the package version that scanned and priced. The scanner is bundled and the same file is sent to every ssh machine, so one run has one scanner version |
| `rules` | three new integers, starting at 1, like `CACHE_VER`. `usage`: what a request counts or costs. `delivery`: which PRs are counted and how they are deduplicated. `first_pass`: the PR-to-model link and the proxy. A PR that changes one of these raises it |
| `prices` | the first 12 hex digits of the SHA-256 of `core/prices.json` without its `_sources` notes. It is computed, so nobody can forget it |
| `outside_table` | usage the price table did not price: omp rows with the cost omp reports, dsh rows priced at rates fitted from those costs or left unpriced at $0 (`core/weekly.py:359-365`), and tokens of any model the table has no price for. `rows` counts them whatever their dollar value, and `output_tokens_pct` is their share of the period's output tokens |
| `machines.id` | which machines were counted, not how many: a hash of the sorted host names of every machine that answered and every retired snapshot, salted with a random value kept in the store. It cannot be read back into names and means nothing outside this store |
| `machines` (the rest) | machines read, and the missing, left-out, retired and retained lists for that period, as the run JSON has them |
| `pr_sources.id` | whose PRs were counted: the same kind of salted hash over one canonical tuple per contributing source: forge kind, endpoint host and resolved account. The account is the one the forge resolves for the login in use: each logged-in `gh` account, the user of a `glab` host's token, the user and host of the selected `tea` login. The names in `git.coverage.sources` are not enough: they are only `tea` or `glab:<host>` (`src/collect.mjs:283`). The usagemeter store is one tuple. Raw account names never leave the hash |

A day has one value in each list. A week or a month has every distinct value of its days.

**What may be compared.** A value is compared between two periods only when every key in its row is
known, single and equal at both ends. Anything else is not compared, with the reason in
`change.not_compared`: `basis_unknown`, `machines_changed`, `pr_sources_changed`, `rules_changed`,
`attribution_unpriced`,
`repriced`. The game adds `outside_share_moved` (below).

| Compared | Keys |
|---|---|
| merged PRs, qualifying PRs | `pr_sources.id`, `rules.delivery` |
| the first-pass proxy on all work or per project | those, and `rules.first_pass`, `machines.id`, `rules.usage` |
| PRs led, and every proxy count or rate grouped by lead model | those, and `prices` |
| tokens and requests | `machines.id`, `rules.usage` |
| any dollar value: API value, cost per merged PR, cost per qualifying PR, cost per feature | `machines.id`, `rules.usage`, `prices`, on priced usage only (below). A cost per PR also needs the PR keys |
| a plan's value per full week | `machines.id`, `rules.usage`, `prices` |

- **A ratio or a rate needs five.** `usd_per_merged_pr`, a cost per qualifying PR and `first_pass_pct`
  are compared only with at least five PRs in the denominator at both ends, in every period, the day
  stretch included. Under five the reason is `under_five` and the counts are shown.
- **A dollar comparison is made on priced usage only.** Priced usage is what `core/prices.json` priced.
  omp's reported cost, dsh's fitted or missing price and unpriced tokens are left out of both ends,
  because two days can carry two tariffs there with no change to `prices`. Their presence is still
  tracked in `outside_table`, by rows, not by dollars. The dollar values shown stay the full ones.
- **It is labelled, with both shares.** When either end has outside-table usage, the comparison reads
  "priced usage only; omp/dsh not compared", followed by their share of output tokens at each end:
  "18% then, 31% now". This is in the views, the cards and the JSON (`change.priced_only`).
- **Its limit is said beside it.** Priced dollars per PR fall when work moves to omp or dsh, with
  nothing getting cheaper. The two shares are printed so the reader can see such a move. The views
  show the comparison whatever the shares are.
- **The game is stricter.** A win or a cost best rests on a priced comparison only when the share
  moved by no more than 5 points between the two ends. Beyond that the cost measure has no result for
  the game, with the reason `outside_share_moved`, and the period is judged on qualifying PRs.
- **This covers every period, the day included.**
- **The same table decides a win and a best.** A week or month with no comparable measure has no result.
  A best is beaten only by a period whose keys match its own; on a new basis a best starts again and the
  old one is kept with its basis.
- **The version alone does not block.** Every merge into `dev` cuts a release. When the two ends differ,
  both versions are printed beside the comparison.
- **An unknown PR population is never a comparable hash.** A period's count can include PRs kept from
  an earlier run: `git()` joins stored `pr_kind` rows to today's answers (`src/collect.mjs:344-350`). So
  the id covers every source that contributed to the count, not only the ones that answered today.
  Delivery 1 stores each PR's source tuple, hashed, in a new `pr_kind.source` column. `pr_sources.id`
  is `null`, and every value that needs it reads `basis_unknown`, when a contributing source's endpoint
  or account cannot be resolved, or when a counted PR row has no stored source.
- **The lead model depends on prices.** RFC 0004 names a PR's lead model by the largest share of API
  value on its branch. A price change can therefore move a PR from one model to another with no change
  in the work. So `prs_led`, and every proxy count or rate grouped by lead model, is compared only on
  one known, single and equal `prices` at both ends (`repriced` otherwise). Where the usage linked to a
  period's PRs includes omp or dsh rows, whose price has no reproducible basis, the per-model
  comparisons of that period are `null`, with the reason `attribution_unpriced`. The counts are still
  shown. The proxy on all work and per project does not depend on prices and is not blocked by this.
- **A machine or a PR source that is added or replaced** changes an id. Another account on the same
  GitLab host, and another Gitea login or host, each change `pr_sources.id`. Comparisons across that change
  stop, and resume once both ends are on the new id.
- A view prints one line when a comparison is left out: "prices changed on 3 Dec: cost per PR not
  compared", or "a machine was added on 9 Dec: usage not compared".

**The allowance comparisons** follow the same table, on both paths. Delivery 1 records the bases and
delivery 3 applies the rule:

- `plan_value` gets one column, `basis` (the object above, as JSON). `plans[].change_vs_last_week_pct`
  is `null` when either row's basis is unknown or the keys differ.
- The `worthit weekly` JSON gets `basis` at its root and inside `compared_with`. Its
  `plans[].change_vs_last_week_pct` and `moved` follow the same rule. `safe_to_post`, `reasons` and the
  exit codes do not change: they are about machines.
- **There is no exception for old rows.** A row with no basis is never compared. Delivery 1 starts
  writing bases, so when delivery 3 follows it by seven days or more, with one `worthit weekly`
  checkpoint taken in between, no plan change goes blank. If delivery 3 comes sooner, the change is
  `null` for the days that are missing, and the release note and the README say so.

Alternatives: a hand-written version in `prices.json` (somebody forgets to raise it); a count of machines
(a replaced machine keeps the count); block every comparison across two worthit versions (releases are
daily, so nothing would ever be compared); keep the percentage and label it "basis unknown" (a price
change would show as a quota change in exactly that week); refuse every dollar comparison when omp or
dsh was used (the owner's own fleet runs both, so he would see less than today).

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
  any ratio or rate (five PRs led, for a model row), and with RFC 0004's own checks. A model row also
  needs one price basis, because the lead model is chosen by API value (section 5):
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
- The rows are written with the day's `period_result` row, from delivery 1 on, and never changed
  after. That row's `json` keeps the cut's `coverage`. So no judged day is without its cut; delivery 2
  adds only the JSON section and the command.
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
    "now":    { "merged_prs": 6, "features": 3, "api_value_usd": 270, "priced_usd": 270,
                "output_tokens": 2800000, "usd_per_merged_pr": 45,
                "first_pass": null, "first_pass_known": null, "first_pass_pct": null },
    "before": { "id": "2026-11-18", "through": "2026-11-18T14:00",
                "merged_prs": 5, "features": 2, "api_value_usd": 255, "priced_usd": 255,
                "output_tokens": 2600000, "usd_per_merged_pr": 51,
                "first_pass": null, "first_pass_known": null, "first_pass_pct": null },
    "change": { "merged_prs": 1, "merged_prs_pct": 20, "usd_per_merged_pr_pct": -12,
                "first_pass_pts": null, "priced_only": false, "not_compared": [] },
    "floor": false,
    "coverage": { "machines": true, "prs": true },
    "basis": "the basis object of section 5, for this run",
    "last_closed": { "id": "2026-11-18", "merged_prs": 8,
                     "api_value_usd": 384, "usd_per_merged_pr": 48,
                     "basis": "the basis object of 2026-11-18" },
    "projects": "the cut of section 6, for the same stretch as now"
  }
},
"game": {
  "day": {
    "today": { "qualifying_prs": 5 },
    "last": { "id": "2026-11-18", "result": "win", "qualifying_prs": 7,
              "basis": "the basis object of 2026-11-18" },
    "streak": { "wins": 5, "since": "2026-11-12", "rest": 1, "not_judged": 1, "best": 9 },
    "bests": [ { "what": "qualifying_prs", "value": 9, "id": "2026-11-06", "new": false,
                 "basis": "the basis object of 2026-11-06" },
               { "what": "priced_usd_per_qualifying_pr", "value": 31, "id": "2026-11-10", "new": false,
                 "basis": "the basis object of 2026-11-10" } ],
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
- `game.<kind>.last` and every entry of `bests` carry the `basis` of their period. For a week or a
  month, `last` also carries `before_basis` and `measures`, for example `{ "qualifying_prs": "better",
  "priced_usd_per_qualifying_pr": "same" }`, and `streak` also counts `held`.
- `game.day.today` is a count, never a result: a result exists only for a judged day. A judged day
  with no qualifying PR and a merged PR of unknown kind has `result: null` and the reason
  `kind_unknown`.
- `usd_per_merged_pr` is the full value. The change beside it is made on `priced_usd` (section 5).
- `periods.day` arrives in two steps: its `id`, `through`, `basis` and `projects` with delivery 2, the
  rest with delivery 3.
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
  first time"; name a win, a streak or the level as the game, never as proof of improving.

### 9. RFC 0004

- **The same measure.** `usd_per_merged_pr` is RFC 0004's value per PR, with the same PR set (authored
  by the logged-in accounts, counted by merge time) and the same "partial PR count" label.
- **The same words.** `floor: true|false` and a `coverage` object, as in `projects`.
- **Different windows, labelled.** `projects` covers the run's rolling seven days (the squads' week of
  16 to 23 Nov). `periods.week` is the ISO week. The two are never shown as the same week.
- **The same privacy.** Repository names are never drawn and never reach the AI agent (RFC 0004,
  section 5), unless its questions 1 and 3 say otherwise.
- **Order.** RFC 0004 delivery 1 goes first: the squads' week is judged with it on 2026-11-23. This
  RFC's delivery 1 follows its merge: both touch `buildData`, `src/query.mjs` and the skill, and it
  stores RFC 0004's project rows per day. KR1 is met when delivery 2 here and RFC 0004 delivery 2 are
  both merged, with the proxy labelled.
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

- **Delivery 1.** New, and nothing existing changes value: the `period_result` and `day_project`
  tables, `basis` (in period rows, in a new `plan_value.basis` column, and as new keys in the
  `worthit weekly` JSON), new `pr_kind.revert` and `pr_kind.source` columns, the scanner's three `rules` numbers, and failed
  reads in the scan's `errors`. The question bar's `sql` refuses `day_project` from this delivery on.
- **Delivery 2.** `periods.day` with its `projects` cut, and `worthit projects --daily`.
- **Delivery 3.** New: the rest of `periods.day`, `game.day`, the `Today` block, the `--daily` flag.
  Existing fields that keep their type and change value: `game.xp`, `level`, `title` and `xp_next`
  (paid by the game from that day), `game.personal_bests` (judged bests), and these changes, which are
  `null` more often: `totals.output_tokens_change_pct`, `totals.api_value_change_pct`,
  `git.usd_per_pr_change_pct`, `delivery.usd_per_feature_change_pct`, `model_mix` `change_pts`,
  `plans[].change_vs_last_week_pct` in a plain run and in `worthit weekly`, with `moved`. Exit codes do
  not change.
- **Delivery 4.** `--weekly`, the week keys, `worthit projects --weekly`, the stderr line, exit 2 for
  two view flags.
- **Delivery 5.** `--monthly`, the month keys, `worthit projects --monthly`, the slim plain run.

### Tests

Fixture cases for delivery 1:
- a complete day gets a row: a `win` with a `feat:` PR; a `miss` with requests and input, no output
  and no qualifying PR; a `rest` with no usage, also when a `docs:` PR merged that day;
- a day with a `style:` PR and a `chore:` PR and usage is a `miss`; a `feat:` PR and its `Revert "..."`
  on the same day leave no qualifying PR; a PR seen by two accounts counts once; a day with a
  `docs:` PR and a PR of unknown kind has no result; `delivery.kinds` and `typed_pct` are unchanged;
- a judged day's `day_project` rows add up to its totals, and a question-bar `sql` on that table is
  refused;
- no row is written and the reason is named for each of: a machine missing, a machine left out, a
  retained unit on that day, a day before a retirement, `--git no`, PR coverage false, `worthit weekly`;
- **a failed read:** a first scan where one tool's reader fails and git answers writes no row
  (`source_error`), although no older saved unit exists;
- **a partly cut day:** the oldest day that overlaps a `--days 3` cut, and the day that overlaps git's
  14-day cut, get no row (`partial_window`);
- a judged day is not rewritten by a later run with a machine missing or with higher usage;
- `basis`: a changed price file gives another `prices`, and a change to `_sources` alone does not; a
  machine added, and a machine replaced by another with the count unchanged, each give another
  `machines.id`; a newly logged-in forge account, a second account on the same GitLab host, and a Gitea login on another host each give another `pr_sources.id`; a day that counts a stored PR row with no source has a `null` `pr_sources.id` and reads `basis_unknown`; a dsh row priced at $0
  sets `outside_table.rows`;
- an older store gets the table and the column on its first run; every existing field of `--json` and
  of `worthit weekly` is unchanged, and the dashboard image is unchanged.

Fixture cases for delivery 2:
- a day's rows plus `no_repository` add up to that day's totals;
- under five known PRs the rate is `null` and the counts are present; a week whose days are each under
  five has a rate on its sums;
- an unresolved usage row makes value "at least" and not compared, while PR counts still are;
- a PR that is not linked counts for its project and for no model;
- **a flipped lead:** two periods with the same work by two models, where only the model prices change
  and the lead model of the PRs flips: `prs_led` and the per-model proxy are not compared (`repriced`),
  while the proxy on all work and per project still is;
- usage linked to a period's PRs that includes omp rows leaves that period's per-model comparisons
  `null` (`attribution_unpriced`);
- every output says "first-pass proxy"; none says "passed first time";
- no repository name reaches the summary prompt or a question-bar lookup, by `get periods`, a deeper
  path or `sql`.

Fixture cases for delivery 3:
- today against yesterday: usage is cut at the last full hour and PRs at the same clock time; a floor at
  either end gives `null` changes; under 5 merged PRs at either end the cost change is `null`;
- with a fixed time zone, a PR merged at 23:30 local counts for that local day;
- with omp rows at both ends, the cost change is made on priced usage and carries the label and both
  shares; when the share moved by more than 5 points the view still shows it, and the game's cost
  measure has no result;
- both allowance paths give `null` against a row with no basis, with other prices, or with another
  `machines.id`; the exit code of `worthit weekly` is unchanged;
- with a machine missing, the tiles draw "not compared" for tokens, value and cost per PR, and the
  summary states no change;
- a not-judged day between two wins: the streak counts both wins and says "1 not judged"; a miss sets
  the streak to 0 and keeps the best streak; a rest day passes and is shown;
- the level on the day of the switch equals the level the day before; a day of tokens with no
  qualifying PR adds no XP;
- no win, streak, best or qualifying count is in `periods`, in `projects`, in a change field, in the
  summary's claim about the week or in a share text's claim;
- no repository name is in the PNG or the `.md`;
- `--demo` carries the new fields; rendered images of the `Today` block (complete, floor, priced usage
  only), LevelCard and Tiles were looked at.

## Deliveries

| # | Delivery | State |
|---|---|---|
| 1 | Record, with nothing on screen changed: failed reads reported by the scanner, the day admission rules, `basis` (period rows, `plan_value`, the `worthit weekly` JSON), `period_result` day rows with the qualifying count and the result, `day_project` rows, the counting rules, schema, skill, the fixture cases | open |
| 2 | Per project and per model, daily (KR1), shown: `periods.day` with `projects` and `worthit projects --daily`, from the rows delivery 1 stored. Model and proxy fields fill when RFC 0004 delivery 2 merges | open |
| 3 | The day view and the game, the first delivery that changes the screen: the rest of `periods.day`, the `Today` block with its model lines, `--daily`, `game.day` (win, streak, bests, XP), every switch of section 3's table, the summary and share prompts, README, demo data, the fixture cases | open |
| 4 | The week view: week rows, `periods.week`, `game.week`, `--weekly` and the `Week` block, `worthit projects --weekly`, the stderr line on `worthit weekly` | open |
| 5 | The month view: month rows, `periods.month`, `game.month`, `--monthly` and the `Month` block, `worthit projects --monthly`, the slim plain run | open |

**Does the first visible delivery fit in days?** Not as one PR that also carries the proof base. So the
proof base is split in two. Its recording half is delivery 1: it changes nothing on screen, claims no
new comparison, and can ship in days. It is complete for the person through the assistant, which can
answer from `period_result`, and it has to come first because rows are final: the game and KR1 read
what it stored. Its visible half cannot be split further. The switches of section 3 must land with the
`Today` block, or one screen would show "not compared" above an unproven change; and the game must land
with the switches, or rewards would leave the screen with nothing in their place. That is delivery 3,
the smallest first visible delivery and the largest PR of this RFC. It is not promised in days.

**Why KR1 is delivery 2.** `worthit projects --daily` needs the day rows and RFC 0004 delivery 1, not
the `Today` block. Its rows are stored from delivery 1, so no judged day lacks a cut. Only the model
lines of `Today` wait for delivery 3.

**Later work, not in this RFC.** Each of these is reported as unknown wherever it cannot be attributed,
never guessed:

- attribution by bot or squad (worthit sees repositories and models, not bots: RFC 0004, question 2);
- rework: a merged PR that a later PR fixes or reverts on another day, and a reland;
- human interventions: a person typing on a squad's branch counts for its model today (RFC 0004);
- wins, streaks and bests per project or per model;
- omp and dsh dollars inside a comparison, once both ends can be priced on one documented basis;
- a share card for a streak or a best.

## Open questions (for the owner)

Question 1 blocks delivery 1. Questions 4 and 5 block delivery 2. No question blocks delivery 3 beyond
question 1. Question 2 blocks delivery 4. Question 3 blocks delivery 5. Each answer is one word, and
`yes` alone takes every recommended one.

1. **The game.** `qualifying`: a win is a qualifying merged PR by its title kind, on data worthit has
   today, for a team on one forge account; what still games it is listed in section 3 (recommended).
   `validated`: a win needs an approving review from another account on the forge. Then there is no win,
   streak or best until such reviews exist, a team on one account has no game, and from delivery 3 the
   screen keeps the level with no new XP and loses the usage streak and the old bests under their rules.
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
