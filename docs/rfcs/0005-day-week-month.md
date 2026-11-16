# RFC 0005: Day, week and month: views and the game

## Proposal in short

1. The plain run leads with **today**: merged PRs and cost per merged PR so far, against yesterday by
   the same hour. The allowance stays on screen in every view.
2. `worthit --weekly` and `worthit --monthly` show the week and the month the same way. `worthit weekly`
   (the scheduler checkpoint, RFC 0003) keeps its fields, exit codes, card and table.
3. The game counts delivery only. A day wins when a PR merged. A week or a month wins when it delivered
   more, or the same for less, than the one before. No win, streak or best comes from tokens or dollars
   alone.
4. Only a closed, complete period is judged. A floor is never compared, never a win and never a broken
   streak. Every result keeps its scanner version, price basis and machines, for both ends of every
   comparison, so a repricing or a machine that lost logs can never read as improving.
5. Per project and per model, daily (KR1): merged PRs, value per merged PR and the first-pass share, on
   RFC 0004's fields. A week and a month add the counts. A rate needs five PRs.
6. Results are stored, so the assistant (the skill and the question bar) answers every other question.
   There is no fourth view. Delivery 1, in days: the day view and the daily game, with no existing field
   changed. Month comparisons start in January 2027. **`yes` alone accepts every recommended answer.**

| Field | Value |
|---|---|
| Status | Queued |
| Created | 2026-11-16 |
| Issue | none yet (the owner's ask, relayed 2026-11-16; KR1 of the OKR accepted 2026-11-16) |
| Depends on | Delivery 1 lands after RFC 0004 delivery 1 (same files, no data needed). Delivery 2 needs RFC 0004 delivery 1; its lead-model and first-pass fields need RFC 0004 delivery 2 |

## Summary

worthit gets three periods (the local day, the ISO week, the calendar month), one view for each, and a
game that is judged per period. The plain run shows the day, `--weekly` the week, `--monthly` the month.
Each view compares the period with the one before, like with like. A new table, `period_result`, keeps
one row for every period that was complete when it was judged, with the basis it was counted on.
Streaks, bests and every period-over-period comparison are read from it. RFC 0004's per-project and
per-model fields get a daily cut, and a second table keeps it so weeks and months can add it up.

## Motivation

The owner's ask, in his words: "i would like to improve it further and keep gamifying, so that we can
see us improving everyday, and every week, and every month... the normal scan shows daily --weekly
--monthly is focused on week month stats (and the assistant just answers any questions)".

KR1 of the OKR the owner accepted on 2026-11-16: "worthit shows per project and per model, daily: merged
PRs, value per merged PR, and the share that passed on the first try".

The orchestrator's reading: the plain scan becomes the day view (today against yesterday, a streak, a
daily win); `--weekly` and `--monthly` show the week and the month; the skill and the question bar
answer everything else from the store. The code confirms the reading and corrects it in four places.

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
   compares today with yesterday up to the same hour. A win is judged only when the day is closed.
2. **Today's game pays for raw usage**, in three places: XP per output token (`src/collect.mjs:558`), a
   streak that counts any day with output and reads 0 every morning before the first request (`:559`),
   and the best "most tokens in a week" (`:561`). "Keep gamifying" cannot extend these.
3. **`--weekly` is not `worthit weekly`.** The command is headless, reads every ssh machine and has git
   off (`bin/worthit.mjs:57-58`); it writes a card and a `weekly` row (RFC 0003). The flag is a view.
   Both are kept.
4. **The store cannot say whether a past day was complete.** `history.json`, `day_provider` and `day`
   keep the highest value seen (`src/collect.mjs:487`, `:518`) with no machine check. RFC 0003 refused
   the meter ledger as a baseline for the same reason. A streak therefore needs a new stored record.

## Design

### 1. Three periods and the unit of proof

| Period | Id | Boundary | Same id as |
|---|---|---|---|
| day | `2026-11-19` | the local day of the machine that runs worthit | `day_provider.day`, `day.day` |
| week | `2026-W47` | ISO week, Monday to Sunday, of local days | `worthit days --group week` |
| month | `2026-11` | calendar month of local days | `worthit days --group month`, the `month` view |

**Two kinds of week, never mixed.** `week`, `totals`, `git`, `delivery`, `plans`, `worthit weekly` and
RFC 0004's `projects` keep their rolling seven days: a plan's limit is a rolling week, so the allowance
stays rolling. The game needs weeks that do not overlap, so `periods.week` is the ISO week. Every output
says which one it shows: "last 7 days" or "week 47".

**Like with like.** A period that is still running is compared with the same stretch of the one before:

| Period | This stretch | Compared with |
|---|---|---|
| day | today up to the last full hour | yesterday up to the same clock hour |
| week | Monday through yesterday | the same weekdays of the week before |
| month | the 1st through yesterday | the same day numbers of the month before (through its last day when it is shorter) |

- The day stretch comes from this run's own scan: the hourly `activity` rows and the PR merge times.
- The week and month stretches use closed days only. On a Monday, or on the 1st, there is no stretch
  yet: the view leads with the result of the period that just closed.
- A closed period is compared whole. Months differ in length, so a month's merged PRs are compared per
  calendar day.

**The day is the unit of proof.** A week or a month is complete only when every one of its days was
judged complete. This is what lets a month be trusted although git's coverage reaches back 14 days only.

**The record.** A new table in `worthit.db`:

`period_result (kind TEXT, period TEXT, result TEXT, judged_at TEXT, json TEXT, PRIMARY KEY (kind, period))`

- `kind` is `day`, `week` or `month`; `period` is the id; `result` is `win`, `miss`, `rest` or `held`
  (section 3); `judged_at` is an ISO time; `json` holds the numbers the period was judged on and their
  `basis` (section 5).
- A row proves the period was complete. No row means **not judged**.

**When a day is judged.** A run judges every closed day of the last 14 that has no row, when all hold:

1. git is on and `git.coverage.prs` is true. The day is then inside git's 14-day window, where a covered
   count replaces the stored one (`src/collect.mjs:483`).
2. The machine half of the proof rule holds for that day (RFC 0002, as RFC 0004 applies it to its week):
   every machine that is not retired answered, none is left out, no retained unit falls on that day, and
   the day starts on or after every retirement.
3. The day is over on this machine's clock.
4. The day is inside this run's scan (`--days`, 21 by default). A shorter scan judges fewer days.

Otherwise the run writes nothing for that day and names the reason. So these runs never break a streak:
`worthit weekly` (git off), `--git no`, a run with a machine missing or left out, `--demo`.

- The numbers in a day row come from the run that judged it: its scan and its git answer, not the
  stored maximum. A week's and a month's numbers are the sums of their day rows.
- A result is final: no later run rewrites it. A day not judged within 14 days stays not judged.
- A week is judged from its seven day rows, and a month from all of its day rows, by the first plain or
  `--json` run that finds them all, together with all the day rows of the period before.
- `worthit weekly` and `--demo` never write to this table.

**When each comparison first exists.**

| Comparison | First exists |
|---|---|
| Today against yesterday by the same hour | the first run, when its machine and PR checks pass |
| Day results and the day streak | the first complete run, for up to 14 days back |
| The week so far against the same weekdays | the first complete run |
| A week result | within 7 days of the first complete run (two whole ISO weeks of judged days) |
| The month so far against the same days | when both stretches are judged. With delivery 1 in late November 2026: January against December, from 2 January 2027 |
| A month result | after two whole months of judged days. With delivery 1 in late November 2026: January against December, on 1 February 2027 |

Until then a week or month shows its numbers as floors, "at least", with no comparison.

Alternatives: judge from `history.json` (no machine check, so floors would be compared); rolling
seven-day wins (they overlap, so a streak means nothing); let a later run rejudge a day (a streak would
change under the person); judge a month with some days missing (a floor compared).

### 2. The views

One run draws one view. The flags choose what is drawn, never what is scanned or stored.

| Command | View | New block | Comparison |
|---|---|---|---|
| `worthit` (also `worthit --daily`) | day | `Today` | today against yesterday by the same hour |
| `worthit --weekly` | week | `Week` | week 47 so far against the same weekdays of week 46 |
| `worthit --monthly` | month | `Month` | November so far against the same days of October |

**The Today block** (synthetic numbers; the model lines arrive with delivery 2):

```
 TODAY  Thu 19 Nov · through 14:00                             yesterday by 14:00
 SHIPPED        6 merged PRs                                   5      ▲ 1 more
 COST PER PR    $45                                            $51    ▼ 12%
 value used     $270 · 2.8M tokens out                         $255   context, not scored
 opus-5-5       led 4 PRs · 3 of 4 passed first time
 gpt-6.1-sol    led 2 PRs · 1 of 2 passed first time
 ◆ shipped today · judged tomorrow     streak 5 shipping days (best 9)     yesterday: win, 8 PRs
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

- **Delivery 1** puts `Today` after the Verdict and changes one line of LevelCard (section 3). No other
  block moves or changes.
- **Every view keeps** Row(LevelCard, PlanRanking) and, with an AI agent, the Verdict and the Summary.
  Goal 1 is the allowance, so PlanRanking, its proof labels and its machine notes are on every view,
  and the Verdict keeps its rule (which plan gave the most).
- **With AI off** there is no Verdict and no Summary, as today (`builtin()`, `bin/worthit.mjs:186`).
  The period block is then the first block.
- **`--weekly`** is the period block plus the blocks that already show a week: Tiles, Receipts,
  Delivery, Row(Heatmap, LimitTrend), WasteTable, Events. The `Week` block also names one way to win,
  worked out from the rule: "to win week 47: 23 merged PRs at $63 or less each (week 46: 21 at $60)".
- **`--monthly`** is the period block plus Months and ModelMix.
- **After delivery 4**, when every block has a view to live in, the plain run can go slim (question 5):
  Verdict, Today, Row(LevelCard, PlanRanking), Tiles, WasteTable, Events, Summary. WasteTable stays
  because allowance about to reset is something to act on today.
- The plan change on every view is the one rule the plain run has: `plans[].change_vs_last_week_pct`,
  from the `plan_value` row seven local days earlier, both measured. No third rule. The month view shows
  no plan change month over month.
- Files: `--weekly` writes `<date>-worthit-weekly.md` and `.png`, `--monthly` writes `-monthly`. The
  audit log keeps its name.

**`--weekly` and `worthit weekly`.** Both are kept. The command's fields, its exit codes 0, 1 and 3, its
card and its `weekly` table stay as RFC 0003 delivered them. Delivery 3 adds two things to it: a stderr
line in a terminal (below) and the `basis` keys of section 5.

| | `worthit weekly` (RFC 0003) | `worthit --weekly` (this RFC) |
|---|---|---|
| For | a scheduler | a person at a terminal |
| Prints | JSON, a card, an exit code | the dashboard, week blocks |
| Week | rolling 7 days | allowance: rolling 7 days. Delivery and the game: the ISO week |
| Machines, git, AI | all machines, git off, AI off | as a plain run |
| Writes in the store | a `weekly` row | `period_result` rows |

- `worthit --json --weekly` prints the same JSON as `worthit --json`: the JSON always has all three
  periods. Two view flags in one run exit 2 with one line. `worthit weekly` ignores a view flag, as it
  does today.
- When `worthit weekly` runs with a terminal on stdout, it adds one line on stderr: "worthit weekly is
  the scheduler checkpoint. The week view is: worthit --weekly". Stdout and the exit code do not change.

Alternatives: merge the two (a public command would change by whether it is piped); rename the command
(breaks every scheduler that calls it); `--week` and `--month` (question 3).

### 3. The game

**What improving means.** Three measures, on all work together, and nothing else is scored:

| Measure | Field | Better is | Compared when |
|---|---|---|---|
| Delivery | `merged_prs` | more | both ends judged |
| Cost of a delivery | `usd_per_merged_pr` (API value per merged PR, RFC 0004's value per PR) | less | both ends judged, at least 5 merged PRs at each end, and one price basis (section 5) |
| First pass | `first_pass_pct` | more | both ends judged, at least 5 PRs with a known signal at each end. `null` until RFC 0004 delivery 2 |

One minimum everywhere: five. Under it a ratio or a rate is not compared, and the counts are shown.
`api_value_usd`, `output_tokens` and `features` are shown as context.

**It never rewards raw spending.** No win, streak or best is computed from dollars, tokens or requests
alone. More spending with no more delivery raises the cost of a delivery and can only lose.

**A daily win.** A judged day is one of:

| Result | Rule |
|---|---|
| `win` | at least one merged PR that day: a shipping day |
| `rest` | no merged PR and no output tokens: a day off |
| `miss` | output tokens and no merged PR |

A day is too small to compare fairly (one large PR moves it), so the day wins by shipping, and the
comparison with yesterday is shown beside it. While today is open the game says `shipped` or `not_yet`,
never a result.

**A weekly and a monthly win.** Each measure that can be compared is `better` or `worse` when it moved
more than 5% (the `moved` threshold of RFC 0003, with the same rounding), otherwise `same`. Any merged
PR is `better` when the period before had none.

| Result | Rule |
|---|---|
| `win` | at least one measure better, none worse |
| `miss` | at least one measure worse, none better |
| `held` | everything else: all the same, or one better and one worse |
| `rest` | every day of the period was a rest day |

**Streaks.** One per period: the number of wins since the last miss. Only a `miss` breaks a streak.
`rest`, `held` and not-judged periods pass: they add nothing and break nothing. The JSON gives the count
of passed periods, so "5 wins since 12 Nov, 2 days passed" can be said in full.

**Bests.** Per period, over judged periods only: most merged PRs, lowest cost per merged PR, and later
the highest first-pass share, each with the minimum of five. A best is `new` when the period that just
closed set it. A cost best is beaten only on the same price basis (section 5).

**Today's game.** `game.level`, `title`, `xp`, `xp_next`, `streak_days`, `days_tracked` and
`personal_bests` keep their values and meaning in deliveries 1 to 4.

- LevelCard draws the shipping streak in place of the usage streak once one day is judged. Before that
  it keeps today's line. `game.streak_days` stays in the data.
- Whether XP stops paying for output tokens, and whether "most tokens in a week" stops being a best, is
  question 6. Removing them recomputes every level from history, so a level can drop once.
- The Zero Waste badge stays. It is about allowance already paid for, and it is not a win.

Known limits: counting PRs rewards small PRs (`features` is shown beside the count, and first pass
balances it); a person who ships without pull requests never wins a day.

Alternatives: a day wins by beating yesterday (question 1; a streak of always more cannot last); count
commits as delivery (cheap to inflate, and `git.coverage.commits` is a weaker source); one score that
mixes the measures (nobody can check it); a win for any measure that got better (question 4).

### 4. Truth rules

- **Measured stays with the plan's own meter.** A sum of logs is never called "measured" (RFC 0004). A
  period's numbers are complete (`floor: false`) or a floor (`floor: true`, say "at least").
- **A floor is never compared.** When `floor` is true at either end, every `change` field is `null` and
  the view says "not compared". This holds for the day, the week and the month, open or closed.
- **A floor is never a win, a miss or a broken streak.** A period that is not complete gets no row.
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
improving. So every stored result keeps what it was counted with, and every week and month comparison,
every win and every best shows it for both ends.

**What exists today.**

- A `weekly` checkpoint row (RFC 0003) keeps coverage for its own week: `machines_read`,
  `machines_missing`, `machines_left_out`, `machines_retired`, `machines_retained` and each plan's
  `proof`. Its `compared_with` repeats only the baseline's time, week end and plans with their proof
  (`src/weekly.mjs:30-32`): the baseline's machines stay in the baseline's own row.
- No stored row names the worthit version. `--json` prints it at the root (`bin/worthit.mjs:99`);
  `last.json`, the checkpoint and `plan_value` do not keep it.
- Nothing names the price basis. `core/prices.json` has no version and no date field, only notes in
  `_sources`.

**What is added.** One object, `basis`, in every `period_result` row, beside every period in the JSON,
and beside the period it is compared with:

```json
"basis": { "worthit": ["0.41.0"], "rules": [1], "prices": ["3fa9c1d2e4b7"],
           "machines": { "read": 3, "missing": [], "left_out": [], "retired": [], "retained": [] } }
```

| Key | Meaning |
|---|---|
| `worthit` | the package version that scanned and priced. The scanner is bundled and the same file is sent to every ssh machine, so one run has one scanner version |
| `rules` | a new integer in the scanner, starting at 1. A PR that changes what a request counts or costs (dedupe, a pricing rule, cache accounting) raises it, as `CACHE_VER` is raised today |
| `prices` | the first 12 hex digits of the SHA-256 of `core/prices.json` without its `_sources` notes. It is computed, so nobody can forget it |
| `machines` | machines read, and the missing, left-out, retired and retained lists for that period, as the run JSON has them |

A day has one value in each list. A week or a month has every distinct value of its days.

**Rules.**

- **Dollars need one price basis and one rules number.** `usd_per_merged_pr` is compared only when both
  ends have the same single `prices` and the same single `rules`. Otherwise that measure is not compared,
  with the reason `repriced` or `rules_changed`, and the period is judged on the measures that are not
  dollars. A period that itself spans a price change has no comparable cost.
- **A cost best does not cross a price change.** On a new basis the lowest-cost best starts again; the
  old one is kept with its basis.
- **The version alone does not block.** Every merge into `dev` cuts a release. When the two ends differ,
  both versions are printed beside the comparison.
- **Coverage blocks as section 1 says:** a period with a machine missing, left out or with a retained
  unit is not judged, so it is never an end of a comparison.
- Today against yesterday comes from one run, so both ends share one `basis`.
- A view prints one line when the ends differ: "counted with v0.41.0 and v0.42.0, same prices", or
  "prices changed on 3 Dec: cost per PR not compared".

**The allowance comparisons.** They are dollar comparisons too, and `core/prices.json` already notes
that a price change must not look like a quota change. Delivery 3 adds, without changing a field:

- `basis` at the root of the `worthit weekly` JSON and inside `compared_with`, so the checkpoint names
  both ends' version, price basis and machines;
- three columns on `plan_value`: `worthit`, `rules`, `prices` (`null` on rows written before);
- whether a plan's change becomes `null` across a price change is question 8. A row written before this
  delivery has no basis: its change is kept and labelled "basis unknown" for that one week.

Alternatives: a hand-written version in `prices.json` (somebody forgets to raise it); block every
comparison across two worthit versions (releases are daily, so nothing would ever be compared); keep
tokens per model in every row to reprice old periods (a much larger store).

### 6. Per project and per model, per period

RFC 0004 delivers the fields: delivery 1 the projects, delivery 2 the lead model and the `first_pass`
signal, with the source `opened`, which the owner chose. This RFC defines their daily cut and how a week
and a month add them up. That is KR1.

**The daily cut.** `periods.day.projects` is RFC 0004's `projects` block for one local day instead of
seven rolling days, with the same field names. It covers today so far, the same stretch as `now`.
`worthit projects --daily` prints it for today so far and for the last closed day. The example is the
whole day 2026-11-18:

```json
"projects": {
  "floor": false,
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

**Rules.**

- **Counts are always shown. A rate needs five.** `first_pass_pct` is `null` under five PRs with a known
  signal in that row and that period (RFC 0004's rule), per project and per model. The counts stand
  beside it: "3 of 4 passed first time". On one day most rates are `null`. That is expected.
- **Value per merged PR** is shown whenever a row has a PR, as in RFC 0004. It is compared between two
  periods only with five merged PRs at both ends (five PRs led, for a model row). A PR's work is rarely
  all on its merge day, so one day's value per PR is noisy: read it over the week.
- **A week and a month add counts, never rates.** `periods.week.projects` and `periods.month.projects`
  sum the days' `merged_prs`, `api_value_usd`, `prs_led`, `first_pass` and `first_pass_known`, then work
  out `usd_per_merged_pr`, `share_pct` and `first_pass_pct` on the sums. The minimum of five applies to
  the summed counts, so a rate that is `null` on every day can exist for the week.
- **Coverage, in two halves.** The cut carries RFC 0004's `floor` and `coverage` for its period.
  - PR counts and first-pass counts need the PR checks (`prs_sources`, `prs_attributed`) and every day
    judged.
  - Value, value per PR and `prs_led` also need `floor: false`: no unresolved usage row on any day.
    Anyone who uses Antigravity, omp or dsh has unresolved usage every day (RFC 0004), so these numbers
    are "at least" for them and are never compared.
- **The basis** of section 5 is carried at both ends, and dollars need one price basis.
- **Unknown is said, never spread.** A PR with no lead model (not linked, or ambiguous) counts for its
  project and for no model. A PR with no first-pass signal is in `merged_prs` and not in
  `first_pass_known`. Nothing is shared out by guess.
- **On all work together,** `periods.<kind>.now` gets `first_pass`, `first_pass_known` and
  `first_pass_pct`, which is the third measure of section 3.
- No win, streak or best per project or per model in this RFC: the game is judged on all work together.

**Where it is shown.**

- `worthit projects --daily | --weekly | --monthly`: a table in a terminal, JSON when piped, from the
  last run and the store, with no scan. Without a flag it is RFC 0004's seven rolling days, unchanged.
- The `Today`, `Week` and `Month` blocks draw per model only, at most three lines. Repository names are
  not drawn into the dashboard, the PNG or the `.md` (RFC 0004, section 5). Question 7.
- While RFC 0004's question 3 is `no`, nothing with a repository name reaches the AI agent: the
  `projects` cut is left out of the question bar's data, and its lookups refuse
  `get periods.<kind>.projects` and the table below. Per-model lines carry no repository name and can go.

**The store.** A second new table in `worthit.db`:

`day_project (day TEXT, project TEXT, model TEXT, tool TEXT, api_usd REAL, output_tokens INTEGER,
requests INTEGER, merged_prs INTEGER, first_pass INTEGER, first_pass_known INTEGER,
PRIMARY KEY (day, project, model, tool))`

- A row with an empty `model` is the project's day: its usage, its merged PRs and their first-pass
  counts. A row with a model is that model's usage in the project, and `merged_prs` holds the PRs it
  led. An empty `project` is usage with no repository.
- The rows are written with the day's `period_result` row and never changed after. That row's `json`
  keeps the cut's `coverage`.
- A day with no row is read from this run's scan when it is inside it, and makes the sum a floor.
- This is the daily table RFC 0004 lists as its delivery 3. It is built once, here. RFC 0004's
  delivery 3 keeps `worthit days --by project`.

Alternatives: keep the cut inside `period_result.json` (the question bar's `sql` would hand repository
names to the AI agent); average the daily rates (a day with one PR would weigh as much as a day with
ten); share an unlinked PR between models (a guess).

### 7. JSON and schema

Every run that scans (`worthit`, `--json`, `last.json`) gets one new section, `periods`, and new keys in
`game`. Both are additive: no existing field changes. A run with git off has `null` PR fields.

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
    "basis": { "worthit": ["0.41.0"], "rules": [1], "prices": ["3fa9c1d2e4b7"],
               "machines": { "read": 3, "missing": [], "left_out": [], "retired": [], "retained": [] } },
    "last_closed": { "id": "2026-11-18", "result": "win", "merged_prs": 8, "api_value_usd": 384,
                     "usd_per_merged_pr": 48 },
    "projects": "the cut of section 6, for the same stretch as now"
  }
},
"game": {
  "day": {
    "today": "shipped",
    "last": { "id": "2026-11-18", "result": "win" },
    "streak": { "wins": 5, "since": "2026-11-12", "passed": 2, "best": 9 },
    "bests": [ { "what": "merged_prs", "value": 11, "id": "2026-11-06", "new": false },
               { "what": "usd_per_merged_pr", "value": 31, "id": "2026-11-10", "new": false,
                 "prices": "3fa9c1d2e4b7" } ],
    "not_judged": [ { "id": "2026-11-13", "why": "machine_missing", "machines": ["build-box"] } ]
  }
}
```

- `through` is local time with no offset. `usd_per_merged_pr` is not rounded, as in `git`.
- `last_closed.result` is `null` when that period is not judged.
- `change.not_compared` lists each measure left out and why: `floor`, `under_five`, `repriced`,
  `rules_changed`. For a week or a month, `before` has its own `basis`.
- `not_judged[].why` is one of `git_off`, `prs_not_covered`, `machine_missing`, `machine_left_out`,
  `retained_unit`, `before_retirement`, `outside_scan`, `too_old`.
- `periods.week`, `periods.month`, `game.week` and `game.month` arrive with deliveries 3 and 4, in the
  same shape. For a week or a month, `through` is the end of yesterday, and `game.<kind>.last` also
  carries `measures`, for example `{ "merged_prs": "better", "usd_per_merged_pr": "same" }`.
- `worthit get periods.day` and `worthit get game.day` read them from the last run.

**`worthit schema`** gets four entries: `periods`, `game` (the section has no entry today: its existing
fields are documented as they are, with the new keys) and the tables `period_result` and `day_project`.
The names already in use there (`day`, `month`, `weekly`, `weekly.result`, `days.result`) keep their
meaning.

**In the same PR as each delivery:** `worthit schema`, `skills/worthit/SKILL.md` (a row for `periods`,
the `game` row, a section "Day, week and month" with the truth rules of sections 4 to 6), the question
bar's lookup list (`bin/worthit.mjs:159`), the README, and `demoData()` so `--demo` carries the new
fields.

### 8. The assistant answers the rest

- **Three views and no fourth.** A new stat gets a field or a row, and a question finds it.
- **The paths that exist:** the skill in the person's own agent, the question bar, and `--ask`. All
  three already use `get`, `days` and `sql`. This RFC adds what they could not answer: `periods`, the
  per-period `game`, and `period_result` ("how many shipping days in October?", "which week was my
  cheapest per PR?").
- **Rules the skill and the question bar get:** read a result from `period_result`, never work one out;
  say "not judged" and the reason, never "lost"; say "at least" for a floor and compare nothing; name
  both ends' basis when they differ; give the counts beside any rate.

### 9. RFC 0004

- **The same measure.** `usd_per_merged_pr` is RFC 0004's value per PR, with the same PR set (authored
  by the logged-in accounts, counted by merge time) and the same "partial PR count" label.
- **The same words.** `floor: true|false` and a `coverage` object, as in `projects`.
- **Different windows, labelled.** `projects` covers the run's rolling seven days (the squads' week of
  16 to 23 Nov). `periods.week` is the ISO week. The two are never shown as the same week.
- **The same privacy.** Repository names are never drawn and never reach the AI agent (RFC 0004,
  section 5), unless its questions 1 and 3 say otherwise.
- **Order.** RFC 0004 delivery 1 goes first: the squads' week is judged with it on 2026-11-23. This
  RFC's delivery 1 follows its merge, because both touch `buildData`, `src/query.mjs` and the skill.
  Delivery 2 here needs RFC 0004 delivery 1 in the scan. KR1 is met when delivery 2 here and RFC 0004
  delivery 2 are both merged.

### What leaves the machine, and privacy

No new network request and no new read outside the store. The store gets two tables, listed in the
README's store table. `period_result` holds counts, dollars and machine names only where
`machines_missing` already has them. `day_project` holds repository ids, as RFC 0004's `projects` block
does: local output only. No account name and no PR title is stored. Public images and the demo use
`worthit --demo` with synthetic projects (`app-api`, `web-client`).

### Public contract touched

- Delivery 1: the `periods` section (`day`), `game.day`, the `period_result` table, `basis` and the
  scanner's `rules` number, the `Today` block, the LevelCard streak line, the `--daily` flag.
- Delivery 2: `periods.day.projects`, the `day_project` table, `worthit projects --daily`, the model
  lines of `Today`.
- Delivery 3: `--weekly`, the week keys, `worthit projects --weekly`, the stderr line, exit 2 for two
  view flags, `basis` in the `worthit weekly` JSON, the three `plan_value` columns.
- Delivery 4: `--monthly`, the month keys, `worthit projects --monthly`, the slim plain run if chosen.

### Tests

Fixture cases for delivery 1:
- a complete day with a merged PR is a `win`; with usage and no PR a `miss`; with neither a `rest`;
- no row is written, the reason is named and the streak is unchanged for each of: a machine missing, a
  machine left out, a retained unit on that day, a day before a retirement, `--git no`, PR coverage
  false, `worthit weekly`;
- a not-judged day between two wins: the streak counts both wins and one passed day;
- a miss sets the streak to 0 and keeps the best streak;
- a judged day is not rewritten by a later run with a machine missing or with higher usage;
- a day older than 14 days is never judged, and a `--days 3` run judges no day outside its scan;
- today against yesterday: usage is cut at the last full hour and PRs at the same clock time; a floor at
  either end gives `null` changes; under 5 merged PRs at either end the cost change is `null`;
- with a fixed time zone, a PR merged at 23:30 local counts for that local day;
- every row carries its `basis`; a changed price file gives another `prices`, and a change to
  `_sources` alone does not;
- an older store gets the table on its first run, and every existing field of `--json` is unchanged;
- `--demo` carries the new fields; rendered images of the `Today` block, complete and floor, were
  looked at.

Fixture cases for delivery 2:
- a day's rows plus `no_repository` add up to that day's totals;
- under five known PRs the rate is `null` and the counts are present; a week whose days are each under
  five has a rate on its sums;
- an unresolved usage row makes value "at least" and not compared, while PR counts still are;
- a PR that is not linked counts for its project and for no model;
- no repository name is in the PNG, the `.md`, the summary prompt or a question-bar lookup.

Fixture cases for delivery 3 include: two weeks on two price bases (cost not compared, `repriced`, the
week still judged on merged PRs, the cost best starts again); a raised `rules` (the same); two versions
on one price basis (compared, both versions printed).

## Deliveries

| # | Delivery | State |
|---|---|---|
| 1 | The day: `periods.day`, `game.day`, `period_result` with day rows and `basis`, the `Today` block, the LevelCard streak line, `--daily`, schema, skill, question bar, README, demo data, the fixture cases | open |
| 2 | Per project and per model, daily (KR1): `periods.day.projects`, `day_project`, `worthit projects --daily`, the model lines of `Today`. Lead-model and first-pass fields fill when RFC 0004 delivery 2 merges | open |
| 3 | The week: week rows, `periods.week`, `game.week`, `--weekly` and the `Week` block, `worthit projects --weekly`, the stderr line and `basis` on `worthit weekly`, the `plan_value` columns | open |
| 4 | The month: month rows, `periods.month`, `game.month`, `--monthly` and the `Month` block, `worthit projects --monthly`, the slim plain run if chosen | open |
| 5 | Today's game without raw usage (question 6), and XP for wins | not scheduled |

**Later work, not in this RFC.** Each of these is reported as unknown wherever it cannot be attributed,
never guessed:

- attribution by bot or squad (worthit sees repositories and models, not bots: RFC 0004, question 2);
- rework: a merged PR that a later PR fixes or reverts;
- human interventions: a person typing on a squad's branch counts for its model today (RFC 0004);
- wins, streaks and bests per project or per model;
- a share card for a streak or a best.

## Open questions (for the owner)

Questions 1 and 2 block delivery 1. Question 7 blocks delivery 2. Questions 3, 4 and 8 block delivery 3.
Question 5 blocks delivery 4. Question 6 blocks only delivery 5. Each answer is one word, and `yes` alone
takes every recommended one.

1. **The daily win.** `shipped`: at least one merged PR that day (recommended). `beat`: more merged PRs
   than the day before.
2. **A day off.** `pause`: a day with no usage and no merged PR passes, and the streak neither grows nor
   breaks (recommended). `break`: it ends the streak.
3. **The flag names.** `weekly`: `--weekly` and `--monthly`, the owner's words, beside the
   `worthit weekly` command (recommended). `week`: `--week` and `--month`, further from the command.
4. **The weekly and monthly win.** `strict`: at least one measure better, none worse (recommended).
   `any`: any measure better.
5. **The plain run once all three views exist.** `slim`: the day blocks and the allowance only
   (recommended, it is what the owner asked for). `full`: everything it draws today, plus `Today`.
6. **Raw usage in today's game.** `drop`: output tokens stop giving XP and "most tokens in a week" stops
   being a best, in delivery 5 (recommended). `keep`: both stay.
7. **Where the per-project cut is shown.** `command`: `worthit projects --daily`, with per-model lines
   only in the dashboard (recommended, it follows RFC 0004's privacy rule). `dashboard`: project rows in
   the `Today` block, which puts repository names into the PNG and the `.md`.
8. **A plan's change across a price change.** `null`: no percentage, with the reason (recommended).
   `show`: the percentage, with both price bases beside it.
