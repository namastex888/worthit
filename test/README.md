# Fixture data checks

`make check` calls `node test/run-fixtures.mjs`. Every directory under `test/fixtures/`
must contain a plain `check.mjs`. Checks run sequentially in separate processes; a failure
names the folder, and the remaining folders still run. The four original regression
folders are required, so deleting a folder or its check fails the gate too. Empty or
whitespace-only scripts fail with the folder's name while other checks still run. Add another
folder with a `check.mjs` to add a case; no registration or framework is needed.

The first three folders share literal **source logs** in `test/sources/box-a/`,
`box-b/` and the left-out control `box-c/`, rather than scan responses. `support/materialize.py` puts the Claude Code,
Codex and Antigravity JSONL in their normal scanner paths and installs `meter.sql`
as a tiny SQLite source store. `claude-limits.jsonl` supplies the Claude weekly meter.
The real CLI runs the real extractor, weekly pricing, data shaping and store queries.
The SSH command executes the actual scanner piped to it, against the selected machine's
separate home and distinct hostname.
`keep-saved-days` adopts the independently delivered issue #24 fixture, extends it with a
successful empty response and a lost-logs sliding cutoff, and pins its week in an expected file.

The environment is built from an allowlist. HOME, WORTHIT_HOME, tool config dirs,
meter state and XDG dirs all point inside scratch. PATH contains only Node, Python,
`which` and deterministic fixture commands. SSH never connects; code-host searches
read `pull-requests.json`, with distinct responses per requested author and date range.
The meter command only returns the fixture store. Only the `ssh`, `gh` and `usagemeter`
stubs record their invocations, including unsupported arguments that fail. Other unavailable
commands would fail with ENOENT if invoked and are not recorded. Network calls from Node and
Python are rejected. No real accounts, machines,
config, stores or credentials are needed. The runner also gives plain checks an
isolated environment, including issue #24's existing check.

`clock.mjs` and `sitecustomize.py` freeze only test subprocesses at 2026-11-14 12:00 UTC.
Python's synthetic hostname distinguishes each machine. There is no production
clock override. Expected snapshots omit generated times, account hashes and paths;
only the presence of a saved scan time is normalized to `<saved scan>`.

## Source ledger and expectations

The previous week has requests on Nov 2, 4 and 6; the current week on Nov 9, 11 and 13.
Each tool has three requests in each week on each machine. Box-a emits 100,000 output
tokens per request; box-b emits 200,000. Box-c has its own session and source row IDs,
with the same 100,000 output tokens and reported costs as box-a. Inputs and cache counters are zero. Claude
Sonnet, GPT Sol and Gemini Carbon each cost $10 per million output tokens in the
repository's price table. The omp source rows report $1/request on box-a and $2 on
box-b; dsh reports $2 and $4. No expected value is generated from application output
or the application's pricing functions.

| Each week | Box-a | Box-b | Both |
|---|---:|---:|---:|
| Output tokens, all five tools | 1,500,000 | 3,000,000 | 4,500,000 |
| API value | $18 | $36 | $54 |
| Requests | 15 | 15 | 30 |
| Claude / Codex / Antigravity / omp, each | $3 | $6 | $9 |
| dsh | $6 | $12 | $18 |

Box-c alone has 1,500,000 output tokens, $18 and 15 requests per week. The box-a + box-c
control has 3,000,000 tokens, $36 and 30 requests; each tool contributes $6 except dsh's $12.

Claude's three sessions agree on a meter rising from 0 to 50 to 100% each week.
Both machine lines agree, so the complete fresh run measures $9 per full weekly
limit. Missing or left-out machines must force a floor and suppress the allowance
comparison. A cold missing box-b yields $18; its saved scan yields $54 on no answer.
Leaving box-b out yields a current $18 while the store preserves the earlier $54.
The left-out case also selects box-c while the previously saved box-b is left out: two
machines answer, current usage is $36, box-b is named as left out, and the plan stays a
floor with no allowance comparison. A fresh-store box-a + box-c control measures $6 per
full Claude week with an eligible comparison. This distinguishes the left-out rule from
the separate rule for a run with no remote answers. Both runs use their own literal expectations.
Both stored weeks are checked through the real CLI's SQL command.

`coder-a` has one current feature and one previous fix. `coder-b` independently has
one current feature, one current fix and one previous feature. Combined delivery
is three current PRs (two features, one fix) and two previous PRs. The case adds the
inactive second account after the first account is already cached, reruns for
deduplication, selects the second account alone in a fresh store, and reverses the
active account order in another fresh store.

Each case keeps literal expectations in its own `expected-data.json`. Every root key must
be exercised, including the adopted saved-days expectations; unused or misspelled keys fail.
Repeated checks against one expectation are allowed. Edit expected values
only when an intentional contract or fixture change explains the new number.
Run `make check` before pushing. Deliberate regression experiments belong in a
private throwaway copy; leave the checked-out implementation intact.

`weekly-checkpoint` runs `worthit weekly` with closed stdin on those source logs.
It checks complete, missing, explicitly allowed partial, left-out, floor-only,
current retained and prior retained results; unsafe reasons name machines and
retained day/provider units. A warm `WORTHIT_REUSE` store must still scan both SSH
hosts. Repeated frozen-clock runs keep separate checkpoint rows. Two actual
checkpoints a week apart check measured changes in JSON, fixed text and allowance
card HTML; the earlier run temporarily withholds future source rows in scratch.
Literal seeded checkpoints test a floor baseline, six-day eligibility, a future
timestamp and unsafe-baseline selection. Mixed-plan proofs and exact/just-over
positive and negative 5% boundaries exercise the same drawing and template helpers.
The first checkpoint ignores an existing ledger. Empty sources and a missing
Python executable exit 1. Every run uses isolated fixture homes; UI, git, AI and
clipboard commands fail if called. `docs/weekly-checkpoint-demo.png` is a rendered,
visually checked allowance card from bundled demo data with first-checkpoint changes.
Demo checkpoints ignore a sentinel baseline and leave both default and explicit
fixture stores byte-for-byte unchanged; an absent demo store is never created.

`git-source-coverage` seeds literal daily PR and commit counts in both stores and
uses synthetic meter, local git, gh (two accounts), glab (two hosts), and tea
commands. A meter sync failure through `--json` preserves both metrics; the next
good answer replaces them, including a stored day with no current rows. Status,
discovery, individual account/host and git-log failures check
independent per-metric MAX behavior and named audit failures. Expectations live
in `expected-data.json`; every root key is exercised.

The same case checks absent gh/glab/tea executables and explicit logged-out
inventories (skipped without FAILED), malformed inventories and logged-in auth
errors (failed), older gh login output, and a partial tea page followed by failure.
Nonzero sync and successful budget-limited sync still read existing PRs and logs
while keeping stored maxima. A repo whose newest cwd disappeared falls back to
its older checkout. No-checkout controls pin exact session milliseconds at the
14-day lower boundary and one millisecond before it, with no FAILED audit label.
Main Claude files use the published meter shape `{cwd}` and `<session>.jsonl`;
a separate sub-agent row has session context. Additive mtime and exact-session
controls each make the other path stale, pinning the boundary and one millisecond
before it independently. The minimal tables include the published `files.mtime_ms`,
not checked_ms as a proxy. A missing-query-table case keeps conservative commit MAX
and still counts another readable checkout. Literal glab 1.123.0 output shapes
cover token-less gitlab.com alone, a self-hosted login beside it, token-bearing
host errors, and the no-authenticated-instances message. Only synthetic identities
are used; source references are recorded with the PR.

`retire-machine` primes a real scan with fourteen literal daily Claude source rows
(Oct 25–Nov 7, 200,000 output tokens and $2 per day), retires box-b, and verifies
all fourteen frozen days, empty missing/left-out lists, measured $6 Claude allowance
and $36 / 3,000,000 current totals from the two active machines. Its pre-retirement
comparison remains a floor. Actual later source logs/checkpoints restore a measured
week-over-week change; an early week stays a floor, safe with exit 0 when nothing
else is missing, and machine notes name its first eligible week end. A separate retired
plus active box-c missing case stays floor with null change and weekly exit 3. A
21-day history followed by a seven-day frozen snapshot and another 21-day run pins
the retired machine older days against accidental replacement in history and SQLite. Separate duplicate-host stores check another alias and local answers,
higher saved/fresh winners and a fresh tie without summing units. Moving windows keep
snapshot bytes and earlier history unchanged; unretire restores bytes and selection.
The seven-day source case preserves a 700,000-token/$7 partial oldest day and the
100,000-token/$1 older day with a git row in history.json and SQLite. All identities
are synthetic. Proof-rule mutations run only in a private throwaway checkout.

Issue #52 extends `git-source-coverage` with `delivery-proof`: the same literal
forge titles (10 current features / 5 previous, 2 fixes / 1 previous), two
meter-only PRs, local commit logs and $200 usage in each week run through real
`git()` subprocess discovery, `buildData()` and persistence. Failed meter sync
makes both metrics floors; failed gh account only PRs; failed git log only commits.
The complete-source control has 14 PRs (+133%), $200/14 per PR (-57%), 10 features
(+100%) and $20 per feature (-50%). Incomplete PR coverage nulls every PR-derived
change and suppresses PR personal bests. Drawn dashboard blocks, delivery card HTML
and fixed share text assert at least on counts, partial denominators on costs and
no comparisons; complete PR coverage preserves changes even if commits failed.
`WORTHIT_FIXTURE_ARTIFACTS` optionally saves synthetic data/drawn text for image
inspection. Source failures are never simulated by editing output proof flags.
