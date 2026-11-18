---
name: worthit
description: Answer questions about AI coding usage, cost and productivity with the worthit CLI — which subscription gave more, tokens and API value per day/week/month, per tool and per model, merged PRs and commits, unused allowance, open vs closed models — and turn any of it into a ready-to-post card and text with `worthit share`. Use when the user asks how much they used, what a plan is worth, how this week compares, which model or tool they lean on, or wants to share or post a stat.
---

# worthit

`worthit` measures AI coding usage on this machine (and chosen ssh machines): Claude Code, Codex, Antigravity, omp, dsh. Every request is priced at API list rates. Everything is local.

Run it as `worthit` (or `npx worthit`). All commands below print JSON on stdout; errors go to stderr with a non-zero exit code.

## Pick the cheapest command that answers the question

| Need | Command | Cost |
|---|---|---|
| A number from the last run | `worthit get <section>` | instant, no scan |
| Totals over any dates, by tool or model | `worthit days …` | instant, no scan |
| Anything else the store holds | `worthit sql "SELECT …"` | instant, no scan |
| Fresh numbers | `worthit --json` | 5–10 s warm; first run or `--days 90` is longer |

Start with `worthit get` (no argument): it lists the sections and when the data was generated. If `generated_at` is older than the question needs, run `worthit --json` first, then query.

For safe sample lookups, use `worthit get <section> --demo` (including dotted fields),
or `worthit get --demo` to list the bundled sample's sections. It uses the same data
as `worthit --json --demo`. A standalone `--demo` may also precede the lookup command.
`days --demo` and `sql ... --demo` reject with exit 2 and a one-line error because the
sample has no historical query tables. Demo lookups never read or write the store,
even when it is missing or unreadable. Text containing `--demo` inside a SQL statement
is SQL text, not a CLI flag.

## `worthit get [section[.field…]]`

Parts of the last run. Dots walk into objects and arrays (`plans.0.usd_per_full_week`).

| Section | What it holds |
|---|---|
| `plans` | Per plan: `usd_per_full_week` (API-list dollars one full weekly limit is worth), `times_plan_price`, `proof` (measured, floor), `stretches`, `meter`, `priced_usd`, `models`, `history` (earlier 7-day blocks, oldest first, then this week), `weeks` (the same with dates and gaps: `weeks_ago`, `to`, `usd`, `proof`, up to 12; a missing week had no meter reading), `change_vs_last_week_pct`, and when machines without a meter log were busy in the same hours: `other_machines_usd`, `usd_per_full_week_all_machines` (an upper figure) |
| `totals` | Last 7 days against the 7 before: output tokens, API value, changes in % |
| `tools` | Per tool, last 7 days: requests, output, cached and fresh input, dollars, where the data came from |
| `months` | Per month and plan: API value used, times the monthly plan price, days tracked |
| `model_mix` | `weeks`, `series` (per model: `share_pct` per week, `change_pts`), `open`, `closed` (share, tokens, dollars, dollars per million output) |
| `git` | Merged PRs, commits, repos, cost per merged PR, per-day series, `sources` (GitHub, the usagemeter store, Gitea when `tea` is logged in, and every GitLab host `glab` is logged in to) |
| `delivery` | What the merged PRs were, read from each title prefix (`feat:`, `fix:`, `docs:` ...): `kinds` ranked for this week with last week beside it, `features`, `usd_per_feature`, `fix_share_pct`, and `days` (14), `weeks` (12) and `months` with features, fixes, cost and cost per feature. Null costs mean usage was withheld or insufficient priced days/features were available; see the coverage rules below. Compare a person with their own earlier weeks, not with other people |
| `waste` | One row per plan: limit, share used, dollars unused, dollars still open (`at_risk_usd`), and why. Several accounts on one plan are summed into one row (`accounts`, `account_weeks`), named like `ChatGPT Pro 200 (×4)` |
| `events` | Provider events in the window: resets, limit changes, launches, with source links |
| `game` | Level, XP, streak, personal bests |
| `heat` | Output tokens per weekday and hour |
| `week`, `machines`, `days_scanned`, `generated_at` | What the run covered |
| `machines_missing`, `machines_left_out` | Machines that gave no answer this run (`saved_scan_at` set = their last saved scan was used) and saved machines with usage (or unreadable saved scans) left out. Removing an SSH alias does not clear it; retire the machine or scan a fresh equivalent machine. Either one not empty = the week may be undercounted and every plan is a floor |
| `machines_retained` | Older scans kept for machines that answered with less data. Each row names `machine` (SSH alias or `this machine`), `days_kept` (distinct local days) and `units` (`day`, `provider`). Each machine/local-day/provider keeps the whole scan unit with higher API-list USD at this run's prices, then total tokens; fresh wins a full tie. Mention the named machines and days kept. Any retained unit intersecting this week makes every plan a floor and `change_vs_last_week_pct` null: later lost hours remain unknown |

When `machines_retained` has a unit inside this week, that week's totals are a lower bound too.

Usage comparisons use the same machine condition as plan proof, independently of
whether any plan has a meter reading. Missing answers (including saved fallbacks),
left-out machines, retained units overlapping the rolling week, and a week starting
before a retirement make usage a floor. `totals.output_tokens_change_pct`,
`totals.api_value_change_pct`, `git.usd_per_pr_change_pct` and
`delivery.usd_per_feature_change_pct` are null if either compared week is a floor.
An overlapping retained local day counts even when it straddles the week's start.
Complete Git counts can still be compared when usage is a floor.
Eligible usage changes use the ordinary symmetric whole-number percentage rule
(halves away from zero, negative zero normalized to 0); floors remain null.

When current usage is a floor, `git.usd_per_merged_pr`, every entry of
`git.usd_per_pr_per_day`, and `delivery.usd_per_feature` are null. With
`git.merged_prs > 0`, an explicit null `git.usd_per_merged_pr` means **cost withheld
because usage is a floor**, not no PR data. With zero PRs, null means there is no
denominator; a numeric zero cost remains a valid value. The shared
`usageCostWithheld` helper interprets this invariant for the dashboard, card and
share consumers. Say **n/a, partial usage; not compared**, never `$0` or **at least**
for a withheld ratio. Delivery sharing keeps its delivery topic when at least five
features exist but usage withholds their cost; absent delivery or insufficient
features retain the weekly allowance fallback.

Each `delivery.weeks` row with a known machine blocker has null `usd` and
`usd_per_feature`. Daily/monthly cost series are conservatively withheld in full
if either current or previous usage week is incomplete, including months extending
outside those two weeks; their `usd` and `usd_per_feature` are null. This is not
proof of historical daily/monthly coverage. Counts and `days_with_cost` remain
observed data, not coverage certificates. No machine proof is added to the store.

`git.coverage` reports `prs` and `commits` booleans and `sources`, an array of
`{source, answered, metrics}`. Sources are `usagemeter`, `git log`, `gh:<account>`,
`glab:<host>` and `tea`. Absent CLIs and explicit empty login inventories are
skipped as a source with an audit note, omitted from `sources`, and do not reduce coverage.
For glab, each host with `No token found` and no login line is skipped; a successful
self-hosted login still counts when token-less gitlab.com makes auth exit 1. Host
errors with a token and process execution failures remain uncovered. Discovery
can contact gitlab.com even without a token; source selection does not imply no network request.
Malformed inventories and command errors remain failures, named `gh discovery`,
`glab discovery` or `tea discovery`. Both multi-account and older `gh` login
output are supported. A logged-in source that gives a partial answer is uncovered.
When `git.coverage.prs` is false, this week's `git.merged_prs`, `delivery.features`
and `delivery.kinds[].prs` are floors: say **at least**. `git.merged_prs_change_pct`,
`git.usd_per_pr_change_pct`, `delivery.features_change_pct`,
`delivery.usd_per_feature_change_pct` and `delivery.kinds[].change_pct` are numbers
or null; all are null without PR coverage. Do not compare floors with earlier
weeks or award PR-derived personal bests. `git.usd_per_merged_pr` and
`delivery.usd_per_feature` retain their observed ratios when usage is complete: label them **partial PR
count** / **partial feature count**, never lower bounds, and do not compare them.
Shares describe observed PRs. Dashboard, report and share text/cards use these
same rules. False `git.coverage.commits` independently means **at least** for
`git.commits`; a commit-only failure does not suppress measured PR comparisons.
No additional proof or commits change field is needed.

PR coverage needs the meter and every selected forge answer. Commit coverage needs
meter repository discovery and every local git log; forge failures do not affect it.
A nonzero sync or pending meter work leaves meter-fed metrics uncovered, while
existing meter PRs and local git logs are still read. For each repo, the newest
existing checkout is used. No checkout left is an audit note, not a failed source;
commit coverage stays false if its exact session overlaps the inclusive interval
from now minus 14 days through now OR a meter file mapped to it has `mtime_ms`
at or after that lower bound. These paths are additive; main Claude transcript
context may contain only cwd. An unavailable session/file recency query keeps MAX
conservatively while readable checkouts still contribute live git-log counts.
Within git's 14-day window, each metric replaces stored daily counts only with full
coverage. Otherwise `history.json` and SQLite `day` keep the per-metric MAX, also
outside the window. Name sources with `answered: false` when reporting failures;
use the audit note to explain no-checkout retention. The audit log names each
source's answer, failure or skip too.

## `worthit days`

Sums from the local store over any period.

```
worthit days --since 2026-10-01 --until 2026-10-31 --group week
worthit days --group month --by tool
worthit days --since 2026-11-01 --by model
worthit days --group week --model opus
worthit days --group day --tool codex --since 2026-11-05
```

- `--group day|week|month` (default day; week is ISO, `2026-W45`)
- `--by total|tool|model` (default total; `total` also returns `merged_prs` and `commits` when neither `--tool` nor `--model` is set)
- `--tool claude|codex|google|omp|dsh`, `--model <part of the id>`
- Each row has `api_usd`, `output_tokens`, `days` (days with data in the period), and `requests` only when reading `day_provider`.

Stdout remains a bare JSON row array. Read the one-line stderr note too:
`worthit days: local days (day_provider)` for total/tool without `--model`, or
`worthit days: UTC days (day_model)` for `--by model` **or any `--model` filter**,
including `--by total` and `--by tool`. The note is printed in terminals and pipes;
internal question-bar lookups include it alongside the JSON for the model.
Never compare UTC and local views per day. `--since`/`--until` and week/month
grouping use the selected stored basis, so grouped boundaries can differ too.
No stored dates or values are converted.

`day_provider` uses local days; `day_model` (`--by model` or any `--model`
filter, including `--by total` and `--by tool`) uses UTC days. Never compare UTC
and local views per day; date filters and week/month groups use the selected stored
basis too. Stored usage never decreases on rescan because tools prune logs:
`day_provider`, `day_model` and `history.json` usage keep per-field MAX on every day,
including complete, partial, current and outside-window days. Later price cuts or
dedupe fixes cannot lower days already stored. Missing or left-out machines still
make allowance values floors. In `day`, PRs and commits replace independently inside
git's 14-day window when all that metric's sources answered; otherwise they keep MAX,
including outside that window.

## `worthit sql "SELECT …"` and `worthit schema`

One read-only `SELECT` or `WITH` statement over `~/.worthit/worthit.db`. Run `worthit schema` first: it returns every table and column with its meaning. At most 500 rows come back.

```
worthit sql "SELECT day, SUM(api_usd) usd FROM day_provider GROUP BY day ORDER BY usd DESC LIMIT 5"
worthit sql "SELECT day, provider, usd_per_full_week FROM plan_value ORDER BY day"
```


## Extra roots: registration only (RFC 0006 delivery 1a part B)

A machine with a declared root is read from saved data only until the next delivery.
Roots are recorded and shown, but **not read yet**. This applies to active, deselected,
retired and removed-setting roots, and to selected SSH aliases whose established physical
machine identity matches a declaration. Fresh default-home scanning, raw-config fallback,
and the local meter sync/store/repository-discovery lane are withheld on that machine.
Existing saved usage remains a floor; without saved data, usage is unknown, not historical
zero. Other machines keep their default-home behavior. Independent forge PR reads retain
their own coverage checks.

```sh
worthit hosts roots local
worthit hosts roots add local --file spec.json
worthit hosts roots select local <root-id> off
worthit hosts roots boundary local <root-id> --file proof.json
worthit hosts roots retire local <root-id> [--since YYYY-MM-DD]
```

For an SSH machine, replace `local` with an existing saved alias. An ordinary scan must
already have saved its salted `machine_id`; older scans containing only a host name do
not qualify. Otherwise add exits 2 with `scan <machine> once before adding a root`.
Run a normal scan once before registering that alias. Commands never connect, scan,
inspect a mount, probe permissions or open root content. The scan's separate metadata-only
preflight establishes physical-machine and effective OS-reader identity, with bounded
private pipes; no root path, spec or HMAC key travels to SSH. Changed or ambiguous matched
identities remain scoped floors with `identity_unknown`; they do not freeze other machines.
Registration cannot confer OS permissions. `boundary` records an operator attestation;
even a verified attestation does not enable usage reads in B.

The private spec is exactly `{path,sources,mappings?}`: `path` is absolute on that machine;
`sources` is a nonempty array of `{kind,home}` bindings, with kind `claude`, `codex` or
`meter` and a relative home (`.` allowed). `mappings` is absent or `[]`. Unknown keys,
duplicate JSON keys/bindings, control characters, traversal, shell expansions and URLs
are rejected. Antigravity, account/model files, nonempty mappings, update/unretire and
answered-root retirement fail explicitly as unsupported. All mutations return path-free
records; terminal output shows ids, selection, lifecycle, coverage and reader hash, while
redirected output is JSON. Exit 0 means success, 2 invalid/conflicting/unsupported input,
and 1 private-store I/O failure. Errors never echo paths or spec contents.

`WORTHIT_HOME/source-roots.json` keeps versioned private declarations and revisions;
`source-roots.key` is a stable 32-byte collector-local HMAC key. Both are owner-only and
settings are replaced atomically. Ordinary scans initialize these identity files even
without extra roots and save the physical `machine_id` for later offline registration.
Missing or malformed initialized settings/key fail closed. Coverage-only records under
`run-keep/roots/` retain tombstones when a setting is removed. A never-answered root can
retire into an empty version-1 snapshot under `run-keep/roots/retired/<root-id>.json`:
“retired with no saved scan, as stated by you”. Its `since` is the registration instant;
an optional retirement date cannot precede registration or be in the future. This is an
attestation, never observed zero usage. No root usage is added from that snapshot.

Run and weekly JSON expose every declaration in `source_roots`, using RFC 0006 statuses
and reasons and salted ids, never raw paths/specs. Selected roots remain `unreadable`;
unselected/tombstoned roots are `left_out`; retired roots remain `retired` with incomplete
coverage. `reader_id` identifies the OS reader separately from physical `machine_id`.
Every plan is a floor, changes are null with `not_compared` including `roots_changed`,
and root reasons make a weekly checkpoint unsafe. Usage/value/model-share/delivery-cost
comparisons and usage improvement claims are withheld; physical PR counts keep their
independent checks. Exact endpoint arrays are saved in nullable `plan_value.source_roots`
and weekly checkpoints. B preserves default-only proof/comparison behavior; part C owns
usage readers and final 1a guards for unknown legacy comparison baselines.

Audit `source_root` events contain only root/machine hashes, revision, attempted time,
status and reason codes, including preflight failures. Saved-only `get`, `projects`,
`days` and `sql` never refresh roots or connect. The demo has explicit empty roots.

## Retire a machine: `worthit hosts`

`worthit hosts` lists selected, not selected and retired SSH aliases; redirected stdout
is JSON. `worthit hosts retire <machine> [--since YYYY-MM-DD]` needs a readable saved
scan; without one, leave the alias out of the selection instead. Retirement moves
`run-keep/<alias>.json` to frozen `run-keep/retired/<alias>.json`. No run writes there.
`hosts.json` keeps `selected` and `retired: [{machine, retired_at, last_scan_at, since?}]`;
legacy stores without `retired` mean none retired. `retired_at` defaults to now.
`--since` means UTC midnight and cannot precede the saved scan timestamp or be future.
It records the user's statement in optional `since`. Measured plans relying on it carry
`retirement_note` and say "<machine>: retired since <date>, as stated by you" in notes,
allowance text and cards. Preserve that disclosure when reporting the plan.

Retired aliases are never scanned, even with `--hosts all` or an explicit alias. They
are neither missing nor left out. The picker displays them without offering them.
`machines_retired` reports `{machine, retired_at, last_scan_at, days_kept}`; the count is
snapshot days selected inside this run window. Mention each retired machine.
`retirement_conflicts: [{machine, same_as}]` means a retired host answers live as that
SSH alias or `this machine`; the snapshot merges into that answer with #24's whole
local-day/provider winner (USD, tokens, fresh tie), never summed. Missing frozen data
fails the run with advice to restore the snapshot or unretire. Unretire without a
snapshot removes the record and reselects the machine. Invalid `retired_at` or corrupt
`hosts.json` fails cleanly on every non-demo command: exit 2,
`worthit: cannot read <path>: <reason>. Fix or remove it.` No stack trace.
The partial oldest day and older history retain per-field MAX; git rows
have their separate coverage window. Frozen snapshots stay byte-stable as windows move.

Measured needs all active answers, none left out, no retained unit in the week, and the
week start >= every `retired_at`. A pre-retirement week stays floor. Machine notes name
the machine and the first possible measured week end (retired_at + seven days).
`plans[].weeks[].proof`: week 0 gets its actual proof; a ledger week gets `floor`
when retirement or a retained unit blocks it; otherwise the key is absent.
Ledger weeks carry no machine check: keep their values, but never label them measured
or use them for a change. `plans[].change_vs_last_week_pct` compares this run's measured
value with the measured `plan_value` observation recorded exactly seven days earlier:
the row exactly seven local calendar days earlier (also across DST), with the same provider and plan and positive
stored USD. That exact stored USD is the denominator, even if the ledger pool differs.
Otherwise the change is null: no nearby-date or floor fallback. Same-day runs replace
that daily observation; it does not record an exact run time or rolling period.
Known retirement/retained floors at either endpoint still suppress the change.
Weekly baseline proof is likewise
checked against current retirements without rewriting saved checkpoints or searching
past a floor. `worthit hosts unretire <machine>` restores the full frozen scan, removes
retirement and reselects the alias. Its next answer merges normally. There is no
automatic retirement; machine notes offer a one-line hint after 14 days without answer.

## Fresh run: `worthit --json`

Scans, prices and prints the whole data object (the same sections as `get`), plus
the root `audit_log` field: the absolute `<date>-worthit-audit.log` path in the
current folder. It uses the shared scan audit format and writes no Markdown or
PNG and runs no Chrome. `audit_log` is null with `--no-files` or `--demo`.
`--no-files` still updates the store; demo reads and writes no store or files.
On exit 1 after activity, the command attempts to retain the audit and names its
path on stderr, without printing success JSON. This output metadata does not
change saved `last.json` or the output shapes of `get`, `days` and `sql`.
Useful flags:

- `--git yes|no` include merged PRs and commits (default yes)
- `--hosts all|none|a,b` other machines over ssh (default: the remembered selection)
- `--days N` window to scan (default 21; `--days 90` backfills history once)
- Unchanged log files are served from a cache, so repeat runs are fast.

The human dashboard (`worthit` with no flags) also writes `<date>-worthit.md`, `.png` and `-audit.log` to the current folder. Do not run it for an agent task: use `--json`.

## Scheduled allowance checkpoint: `worthit weekly`

```
worthit weekly [--hosts all|none|a,b] [--allow-partial] [--no-files]
```

Fresh headless scan, all SSH hosts by default, git and AI off. It ignores scan-reuse
shortcuts and always uses the fixed `SHARE_TOPICS.allowance` template. No TTY, questions,
browser UI, clipboard or posting. Chrome or Chromium is required to render
`<date>-worthit-share-allowance.png` in the current folder. Alongside it,
`<date>-worthit-audit.log` lists scan reads, commands, selected SSH hosts and output
writes in the same format as a plain scan. `--no-files` skips both output files.
The local store is updated in either case.
`--demo` uses bundled synthetic data and leaves all stores and files untouched;
its baseline is always null.

JSON fields (also documented by `worthit schema`):

- `week: {from, to}` (YYYY-MM-DD), `generated_at` (ISO time), `text` (fixed post),
  `image` (absolute PNG path), `audit_log` (absolute audit log path beside the PNG).
  Both paths are null with `--no-files` or `--demo`.
- `plans: [{plan, usd_per_full_week, times_plan_price, proof, change_vs_last_week_pct, retirement_note?}]`.
  Proof is `measured` or `floor`; change is a whole-number percent or null.
  Ordinary and weekly percentage changes round symmetrically (halves away from zero):
  +5.5% becomes +6%, -5.5% becomes -6%. Negative zero is normalized to 0;
  allowance text, card and TUI show 0% neutrally with no arrow.
- `machines_read` (number included), `machines_missing: [{machine, saved_scan_at}]`,
  `machines_left_out` (aliases), `machines_retired: [{machine, retired_at, last_scan_at, days_kept}]`,
  `machines_retained: [{machine, days_kept, units: [{day, provider}]}]`.
- `compared_with`: null, or `{generated_at, week_to, plans: [{plan, usd_per_full_week, proof}]}`.
  This is the latest earlier checkpoint ending at least six days before this one's end.
  Only the same plan measured at both ends gets a change, in JSON, text and card.
  Never search past a floor. The first checkpoint has null changes even if the meter
  ledger has history; weekly never uses ledger comparisons.
  An unsafe rerun in the same week becomes the newest row, so next week's change is null.
- `moved: [{plan, from, to, pct}]` includes only eligible rounded absolute changes strictly >5%.
  `pct` is the same whole-number percent; +6% and -6% both count as moved, ±5% do not.
- `safe_to_post` is true iff missing and left-out lists are empty and no retained local-day
  unit overlaps this week. A floor alone, including a pre-retirement week, or retained
  units only in earlier weeks are safe.
- `reasons` is an array of explanations naming unsafe machines; retained reasons also
  name each day and provider.

Exit **0**: safe, or `--allow-partial` supplied. Exit **3**: unsafe, JSON still printed.
The override keeps `safe_to_post: false` and its reasons. Exit **1**: no result due to
scan failure, no allowance data this week, or PNG/audit/store failure.
An exit-1 run still writes the audit log; it prints no JSON and saves no weekly row.

SQLite `weekly (generated_at TEXT PRIMARY KEY, week_to TEXT, safe INTEGER, json TEXT)`
records one row per successful checkpoint, including unsafe runs and `--no-files`.
`safe` is 1 or 0 regardless of the exit override; `json` holds the complete printed object.
Query it with `worthit sql "SELECT generated_at, week_to, safe FROM weekly ORDER BY generated_at"`.

## How to read the numbers

- **API value** is what the same usage would cost at API list prices. It is not what the user paid.
- **`usd_per_full_week`** pools every clean, finished meter stretch of the week: priced dollars divided by meter points consumed. `times_plan_price` divides it by the plan's weekly price ($200/month ≈ $46/week).
- **Proof:** `measured` is read from the plan's own meter with every selected machine answering; `floor` means usage elsewhere may be missing, so the true value is at least this. Say "at least" for a floor and do not compare a floor week to week.
- **One account on several machines** draws the same meter line on each; worthit joins those lines into one stretch. Use on machines that keep no meter log cannot be tied to an account: it is left out of `usd_per_full_week` and counted only in `usd_per_full_week_all_machines`.
- **Week over week:** use `change_vs_last_week_pct`, comparing measured values recorded seven local calendar days apart.
- Ledger weeks in `plans[].weeks` must not be used to work out a change.
- **Months:** "times plan price" is against one subscription. A user with several accounts on a plan should divide by the number of accounts.
- **Resets** are listed in `events` and never assumed used. Usage counts in the period it happened.
- **omp and dsh** come from the Automagik usagemeter store. omp's own reported cost is used; dsh is priced at the rates those costs imply. Their source history only goes back as far as that store; no fixed retention period is assumed.
- **Open vs closed:** open = DeepSeek, GLM, Kimi, Qwen, Llama, Mistral, Gemma, MiniMax. Everything else is closed.
- A partial period is partial: check `days` before comparing months or weeks.

## Answering well

1. Quote the number with its period and unit ("$19,526 of API value in November so far, 12 days").
2. Say when it is a floor or an estimate.
3. For "why" questions, look at `events` for the same dates before guessing.
4. Never invent a number that no command returned; if the store has no data for the period, say so and offer `worthit --json --days 90`.

## Sharing a stat

`worthit share <topic>` turns the last finished run into a post for X. It does not scan and it never posts.

```
worthit share allowance     # weekly limits per plan and whether they moved
worthit share open          # open vs closed models
worthit share models        # the models used, most to least
worthit share value         # the best plan: dollars per weekly limit and times its price
worthit share ranking       # all plans side by side
worthit share waste         # allowance paid for and not used
worthit share "what each merged PR cost me"     # anything else: the person's agent writes it from the data
```

Piped (as you run it), it prints JSON: `{topic, written_by, text, characters, image, url, data_generated_at, warnings}`.

With no allowance plans in the saved run, `allowance`, `value`, `ranking` and fallbacks to `allowance` print `worthit share: no allowance data for this week` to stderr and exit 1 with no JSON. Topics with usable plan-independent data still work, including delivery with at least five features whose cost is withheld: `n/a, partial usage; not compared`.

- `text` is the suggested post. `image` is the card (`./<date>-worthit-share-<topic>.png`). `url` opens X with the text filled in.
- X's link cannot carry an image: tell the person to attach or paste the card.
- Free text is written by the person's own agent; if any number in it is not in the data, worthit falls back to the built-in `allowance` post and says so in `warnings`.
- `--ai no` keeps it to the built-in topics. `--demo` uses sample data.
- Inside the worthit screen the person can simply type it in the question bar ("share my open model stats"): the card and the post appear there and enter opens X.

## Helping the person

1. **A question about usage:** answer from `get`, `days` or `sql`; run `worthit --json` first only when `generated_at` is too old for the question.
2. **"Share this", "make me a post", "what should I post":** if they did not say what, offer the six topics in one line each. Run `worthit share <topic>`, then show them the `text`, the `image` path and the `url`, and repeat any `warnings`. Offer to adjust the wording yourself; keep every number exactly as in `text`.
3. **A weekly habit** (for example a Monday allowance post): `worthit weekly`; check `safe_to_post`, reasons and exit code before using its text and image.
4. **Never** post for them, open a browser for them unless asked, or read their logs yourself: worthit is the only reader.
5. If `worthit share` says there is no finished run, run `worthit --json` once and try again.


## Project usage: RFC 0004 deliveries 1 and 2

`worthit projects` reads the last saved run only: no scan, model or network. Terminal table;
piped JSON is the `projects` block plus `week`, `generated_at`, `machines_missing`,
`machines_left_out`, `machines_retained`, `machines_retired`. `worthit get projects` returns
the saved block. `worthit projects --demo` uses synthetic projects without reading a store.
An older saved run needs `worthit --json`. Repository identities stay local: never forward
them to an AI summary, question-bar tool or custom share topic, or put them in dashboard,
Markdown or share cards. AI lookups expose only usage data, not project/PR identity tables.

`projects` fields (not a new SQL table):

- `floor`: false only with full machine proof and `coverage.unresolved_rows === 0`.
  Log-derived usage is never called measured. When true, every usage USD/token/request
  number is “at least”; no project week-over-week field exists.
- `coverage`: `machines` requires every active machine answered, none left out, no retained
  day/provider unit overlapping the rolling seven days, and week start on/after every retirement.
  `unresolved_rows` counts core project_activity rows, including zero-dollar rows;
  `unresolved_usd` is their rounded value. `attributed_pct` is rounded 100 * project raw USD /
  (project raw USD + no_repository raw USD), null at zero total.
  `prs_sources` is git.coverage.prs; `prs_attributed` is true iff no PR lacks a project.
  Both are null with git off.
- `rows`: `{project, name, api_value_usd, output_tokens, requests, merged_prs,
  usd_per_merged_pr, models}`. Dollars round to whole dollars; tokens/requests are exact.
  Rows plus no_repository reconcile with totals within dollar rounding. Includes PR-only
  projects. `name` is the last path component, qualified with owner on collision.
  `models` holds `{model, tool, api_value_usd, output_tokens, requests, share_pct}`.
  `share_pct` is rounded 100 * raw model USD / raw project USD, null when project USD=0;
  it is a value share, with no PR credit per model. `usd_per_merged_pr` divides rounded
  project USD by PR count without rounding the ratio; null with zero PRs.
- `no_repository`: `{api_value_usd, output_tokens, requests, why_usd}`. why_usd has all six
  reasons: outside_a_repository, no_origin, origin_not_supported, folder_gone,
  no_folder_read, saved_before_projects. The last four are unresolved, even at $0.
- `prs_without_project`: `{merged_prs, why: {no_host_in_key}}`. PR keys with no host
  never match by repository name. Project counts plus this count equal git.merged_prs.
  When either PR coverage check is false, counts are “at least” and numeric costs use
  “partial PR count”, NEVER a lower bound. Per-PR costs follow the single rule below:
  machine floors override to null; with machines complete and full PR proof, usage-only
  floors retain numeric “at least” costs. Git off sets this block, both checks and every
  row's merged_prs/usd_per_merged_pr to null; suggest `worthit --json`.

Scan buckets gain `project` (canonical origin id or null) and `project_why` (null with
project, else one of six reasons). Claude resolves per request; Codex per session.
Walk upward from cwd to .git; gitfile -> gitdir -> commondir -> shared config origin.
File reads only, no git process, include or insteadOf. Canonical lowercase host[:nondefaultport]/path
supports http/https/ssh/git and user@host:path, strips scheme/user/credentials/trailing .git/slash,
and drops default ports. No-dot alias hosts, local paths, multiple origin URLs, remotes without
origin and unreadable configs are origin_not_supported. No remotes is no_origin; existing
folder outside git is outside_a_repository. Missing cwd/Antigravity/omp/dsh is no_folder_read.
Absent project key on an older saved bucket means saved_before_projects.

Deleted folder: sanitized Codex URL first, then versioned remembered live resolution, else
folder_gone. `folder_project (path TEXT PRIMARY KEY, project TEXT, resolved_at TEXT, ver INTEGER)`
lives only in that machine's scan-cache.db, never worthit.db or SSH payload. Only live resolution
inserts/replaces; mismatched ver ignored. WORTHIT_NO_CACHE/unwritable cache works without it.
Folder reuse keeps the latest live repository. The hostless usagemeter cwd_repo map is not used.
Scan every machine daily with git on to remember folders before worktrees disappear.

The core report adds `project_activity`: `{hour, provider, model, project, project_why, branch, cost_complete, output,
requests, usd}` from the exact selected/deduplicated/priced rows used for activity, including
meter rows. buildData uses the same rolling totals window; USD retains pricing precision until
display rounds. Persistent project history and days --by project remain delivery 3.

Delivery 1 adds no network request. Audit read lines name each additional .git/commondir/config
file; existing SSH scans return sanitized repository IDs with usage. URL credentials are
removed on the originating machine before any cache/transport. Fork origins and upstream PRs,
or nondefault clone ports and forge keys, stay separate without guessing.


### Delivery 2: saved branch-cost association and opened date proxy

One per-PR cost floor rule (RFC 0004 section 3): a machine floor withholds null every
per-PR ratio in git.usd_per_merged_pr, projects.rows[].usd_per_merged_pr and every
projects.delivery models/project_models/daily usd_per_pr_led. A usage-only floor retains
linked implementation lead/prs_led and numeric costs as at least, with projects.floor and
D2 cost_floor:true plus reasons; omp/dsh/Antigravity rows remain unlinked. A floor at either
comparison endpoint withholds cost comparisons (including git.usd_per_pr_change_pct),
while independent physical PR/commit count comparisons remain available. Under a machine floor, raw linked USD
is still visible as a floor while per-PR ratios are withheld. Terminal USD has two decimal places and percentages whole
numbers; JSON precision is unchanged.

`projects.delivery` is null with git off. `worthit get projects.delivery.daily` reads saved
UTC completion-day project/model rows without network; token-spend day is separate. The block
contains `source: opened`, `label: opened date proxy`, ISO `window {from,to}`, `coverage`,
`deliveries`, `models`, `project_models`, `daily`. Never forward repository/branch/PR identities
from it to agents, question lookups, custom share topics, Markdown, dashboard or cards.

Each delivery: `root,members,project,completed_day,lead_model,lead_api_value_usd,lead_share_pct,
implementation_api_value_usd,review_api_value_usd,api_value_usd,cost_floor,cost_reasons,
link_reasons,first_pass,provenance`. Provenance records member `key,branch,head_sha,merged_at,
completeness,reasons`. No-lead deliveries remain visible under `model:null`. The lead is the
unique positive largest linked implementation USD by model (tools combined), never review USD;
ties, absent or incomplete implementation/machine/link/window evidence produce no lead.
This association is not authorship or a model-quality ranking. Exact project/head branch and
merge-hour cutoff link usage; reused branch names are ambiguous. Scan buckets carry logged
`branch` (Claude per request, Codex per session start), null for old/unknown sources.
`cost_complete` is false for missing/fallback pricing. omp/dsh-tui never infer branches.
Reviews `review/pr-<number>-<sha8>` need a unique SHA-prefix match in complete same-repository
PR/MR commit history. Invalid, ambiguous and review-only cases never manufacture a lead.

All aggregate rows have `prs_led,api_value_usd,usd_per_pr_led,cost_floor,cost_reasons,first_pass,
not_first_pass,unknown,not_measured,eligible,first_pass_pct,first_pass_reason,coverage`;
project_models adds project and daily adds UTC completion day/project. Cost uses all retained
linked implementation + review USD for led deliveries / prs_led, null at zero. It retains
pricing precision; `cost_floor` boolean and named `cost_reasons` identify incomplete evidence.
`eligible=first_pass+not_first_pass`; exclude unknown/not-measured; below five eligible keep
counts but percentage null with insufficient_sample. No comparisons of partial periods.

First-pass record `{state,source:opened,reason,complete}` has four states: first_try,
not_first_try, unknown, not_measured. Opening and committer dates are UTC, never push times.
A strictly later material change on implementation first parents means not_first_try.
Pre-merge target ancestry and parent roles must prove a base integration; ignore sole
base-parent history, never use today’s target membership or commit subjects. Files compare
against the relevant parent, considering both old/new paths. Nonmaterial allowlist: docs/
paths, root README/README.md/LICENSE/LICENSE.md/CHANGELOG.md, .md/.mdx/.rst/.txt and
.png/.jpg/.jpeg/.gif/.webp/.svg/.ico. Complete empty changes harmless; mixed/code material.
Incomplete/rewritten/unproven evidence is unknown, never false. GitHub PR commit cap 250,
commit file cap 3000; GitLab uses complete recursive parent/commit tree inventories including
mode instead of trusting its silently capped commit /diff. Missing inventory/parents/times,
old host capability and bounded budgets have named unknown reasons.

LOCAL `WORTHIT_HOME/settings.json` key `projects.first_pass_exclude` is a canonical-id array,
e.g. `["github.com/acme/app-api"]`; it displays not measured and excludes denominators,
preceding every classifier/chain. Actual identifiers/config stay local and untracked.

Entire title Supersedes #n (GitHub) or Supersedes !n (GitLab) forms same-repository predecessor
chains. Combine costs once, root at original, complete on first merged member UTC day, even
when root closed unmerged; resolved chain not_first_try, later merge updates instead of adds.
Cycle/self/forks/wrong-type/cross-repository/unavailable targets remain unresolved/unknown
with no lead. Physical git.merged_prs and project merged_prs/ratios are never deduplicated.

Coverage globally and per model/project-model/day: raw merged_prs, canonical_deliveries,
linked_prs,linked_deliveries,ambiguous_prs,signal_known_prs,eligible,unknown,not_measured,
superseded_prs,unresolved_chains; implementation/review {rows,output_tokens,api_value_usd};
unlinked same counters plus by_reason (omp_no_branch,dsh_tui_no_branch,missing_branch,
no_repository,ambiguous_branch,no_matching_branch,review_unverified,incomplete_link_evidence,
after_merge); forges per host answered,reasons,metadata/commits/parents/diffs {complete,reasons}.
Unlinked rows use observed model/project/UTC spend day; deliveries use completion day.
Machine/usage floors stay separate from forge-source/completeness and first-pass eligibility.
Only authored merged items observed in 14 days plus predecessors are known, never unseen
successors. No new project-history SQL table. GitHub gh and self-managed GitLab glab included;
Gitea unknown/unlinked, host-qualified keys preserved.

Every metadata/commit/parent/compare/tree/chain request and pagination page is audited net and
named in README. Immutable metadata reused within run. Hard limits: 1200 requests, 30 pages,
300 items, 40 chain depth, 250 lineage/base nodes; exhaustion unknown. --git no makes none.


Delivery 2 upgrade/privacy rules: a legacy `gitea/path#n` row overlapping a host-qualified
Gitea path/number/exact merge time remains in pr_kind but is omitted from current physical
counts. Source `gitea legacy identities` is incomplete; audit says ambiguous legacy. Never
infer its host, even with one candidate. Unmatched legacy history/counts remain intact.
Privacy redacts implementation/review branches, commit ids and known short #N/!N references
as well as canonical repository/PR keys from all agent prose, lookups and custom shares.
GitHub commit JSON may return patch text; it is ignored and never persisted. No separate
raw-source request is added.
