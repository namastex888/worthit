# Fixture data checks

`make check` calls `node test/run-fixtures.mjs`. Every directory under `test/fixtures/`
must contain a plain `check.mjs`. Checks run sequentially in separate processes; a failure
names the folder, and the remaining folders still run. The regression folders listed
in `test/run-fixtures.mjs` are required, so deleting a folder or its check fails the gate too. Empty or
whitespace-only scripts fail with the folder's name while other checks still run. Add another
folder with a `check.mjs` to add a case; no registration or framework is needed.

`share-delivery-fallback` invokes the actual `share delivery --ai no --no-files` CLI
against a literal synthetic saved run. Missing delivery or an unavailable cost must
name the weekly allowance fallback in `warnings`, report `topic: allowance`, and
keep the saved run unchanged. Aliases and the bundled demo follow the same rule.
Usable delivery retains its topic with complete, partial or absent Git coverage,
including a zero cost and floor plan proof. The case pins the existing JSON shape
and PR #77's partial-count wording and comparison guard. The allowance card spec
is unchanged; this case does not launch Chrome or call a model or network service.

`log-evidence` uses real synthetic Claude/Codex files with controlled actual mtimes.
A 90-day scan seeds 35 stored days, a 21-day scan clears the older run-keep units,
and actual file removal leaves 30 recent daily logs plus surviving mixed-provider
and partial-model sources. Repeated 60/90-day scans and then all-pruned sources must
leave every stored provider/model/history/month value unchanged. Literal source
corrections separately raise USD, tokens and request counts while other fields fall;
each stored field keeps its own MAX. Meter-only remote usage exercises structural
saved JSON parsing. Removing its actual SSH config entry preserves left-out status,
even beyond the old generated-at cutoff. Corrupt saved JSON remains unknown;
actual atomic `.tmp` files and retired subdirectories are excluded. Legitimate
`tmp`, `fixture.tmp`, `.box` and `.tmp` aliases survive actual SSH config removal.
Fresh equivalent-machine
answers suppress duplicates; saved fallbacks do not. Explicit retirement preserves
snapshot bytes and stored usage. No scanInfo, left-out or proof flags are manufactured.
All expected values are literal synthetic values, not application-generated oracles.

`day-model-complete-day` copies the application source into scratch and reprices the
same literal Claude requests from two synthetic machines from $20/M to $10/M output
tokens. Complete Nov 10, partial Nov 7 and current Nov 14 all keep $6 through the real
scanner, pricing and CLI queries, including reruns. Its literal expectations pin
independent token/USD MAX across UTC/local boundaries, exact midnight, scan-start,
missing/cached/left-out and retirement scenarios. The history fixture preserves its
independent Git coverage assertions: delivery counts may fall inside their covered
window while usage never does. Schema assertions check unconditional usage MAX and
Git's separate 14-day coverage. Both cases are required by the runner. Price changes
and deliberate regression experiments only touch private scratch copies.

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
full Claude week but has no measured observation saved seven days earlier, so its
allowance change is null too. This distinguishes the left-out rule from
the separate rule for a run with no remote answers. Both runs use their own literal expectations.
Both stored weeks are checked through the real CLI's SQL command.

`coder-a` has one current feature and one previous fix. `coder-b` independently has
one current feature, one current fix and one previous feature. Combined delivery
is three current PRs (two features, one fix) and two previous PRs. The case adds the
inactive second account after the first account is already cached, reruns for
deduplication, selects the second account alone in a fresh store, and reverses the
active account order in another fresh store.

`ledger-week-proof` runs the actual CLI twice a week apart, withholding future source
logs for the first run. A missing box-b records a $3 floor; a fresh complete $9 run
must show no change in JSON, the TUI, allowance card HTML or actual `worthit share`
text. Two complete $9 runs show 0%. A literal stored $6 observation produces 50%
while the independent ledger pool stays $9, proving the denominator is the stored
value. Exact-day controls reject measured rows six or eight days back, the wrong
provider/plan, zero USD, absent/null proof and a same-day overwritten floor. A local
New York date crossing UTC midnight pins the run-day key; spring-forward and fall-back
controls require seven local calendar days rather than 168 elapsed hours. A first git
run creating its tables without `plan_value` must not log a missing-baseline error. Retained prior-week units
still override stored measured proof. Historical ledger rows remain unmeasured.
The common source cases and saved-days fixture expect null for ledger-only history:
today's complete machine answers cannot prove an earlier observation. Saved-days then
seeds a measured $10 baseline and checks a 100% change, including its intact seven-day window.

Each case keeps literal expectations in its own `expected-data.json`. Every root key must
be exercised, including the adopted saved-days expectations; unused or misspelled keys fail.
Repeated checks against one expectation are allowed. Edit expected values
only when an intentional contract or fixture change explains the new number.
Run `make check` before pushing. Deliberate regression experiments belong in a
private throwaway copy; leave the checked-out implementation intact.

`symmetric-percent` pins literal priced values 1000 → 997 (-0.3%), 200 → 211
(+5.5%) and 200 → 189 (-5.5%), plus exact ±5% threshold controls. Unchanged
fixture inputs exercise ordinary `buildData` with a literal prior ledger and
weekly `prepareWeekly` with a measured checkpoint. Both paths must return positive
zero, +6 and -6 without changing source values, proof or the JSON shape; weekly
`moved` uses the existing strictly-greater-than-5 rounded threshold. Allowance
text, card HTML/colors, TUI ANSI/colors and the actual Herdr mod plan builder
(with inert view nodes) pin neutral zero without arrows. Null, zero-baseline,
floor, missing, left-out and retained-unit guards remain covered. Schema and
agent skill both describe whole-number percentages. Before production edits the
fixture failed with ordinary and weekly -0 and -5; +6 and exact ±5 passed.
`symmetric-percent/render.mjs` builds the two inspected images
`docs/symmetric-percent-card.png` and `docs/symmetric-percent-tui.png` from bundled
demo data with only these literal synthetic edge plans. It uses private headless
browser profiles with network resolution disabled and reads no real store.

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
Issue #60 extends this same fixture with real synthetic scans on both exit 0 and
unsafe exit 3: the audit beside the PNG names local reads, scanner commands, selected
SSH attempts and output writes, and its absolute path matches JSON and SQLite.
The fixture compares the audited `merge_scans.py` arguments with the actual spawn on
success and failure, including tilde paths, and checks the README/header exclusions.
An INSERT trigger fails after the first successful audit write: no checkpoint is
saved, and the retained audit explains the attempted checkpoint and repeated audit
write attempts. Removing the merge command's audit entry fails this guard.
Only headless Chrome is replaced by a deterministic 1600x900 PNG executable; no browser
is launched. `--no-files` keeps each output folder empty, reports null paths and
still stores its checkpoint; demo also reports a null audit path without store writes.

`card-render` exercises share and weekly through the real CLI/render boundary.
The test-only `WORTHIT_TEST_CHROME` executable override selects a synthetic PNG
writer in the isolated PATH; normal card discovery keeps its fixed Chrome paths.
Valid 1600x900 images survive exit 2 or a teardown signal with a named diagnostic.
Missing, stale, invalid, truncated and wrong-size outputs fail, even beside an
existing destination. The fixture checks absolute image identity, private profile
and network flags, scratch cleanup, and weekly checkpoint/unsafe exit semantics.
Ordinary cases use the executable override for both CLI commands, including
external signals, stale scratch files and exact ENOENT/EACCES diagnostics.
A dedicated test-only preload injects EMFILE without a close event and fires the
real 60-second timeout callback as soon as the synthetic PNG is ready. Both CLIs
must settle, clear the deadline and name the timeout distinctly from an external
signal, without a real 60-second wait or production test configuration. The
weekly audit fixture checks tilde privacy and canonical file identity together.
No browser, real store or network is used.

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

Issue #54 adds literal merged-request rows for `10.0.0.5`, `gitlab.k8s`, bare
`gitlab` and the unindented `ERROR` host key. Each contributes one MR and its exact
persisted identity, replaces seeded daily counts in both stores, and passes its
unchanged config key plus a relative REST path to the synthetic subprocess. The
valid digit-TLD key advertises a distinct HTTPS `api_host` with a port, while bare
`gitlab` advertises an HTTP API host with a port; these config keys pass glab's
validator, and glab owns their API host/protocol configuration. The fake API mirrors glab 1.123.0's hostname
validator before reading any MR rows: keys containing `:` or `/` exit 1 with
`Error parsing --hostname: invalid hostname.`. Accordingly, `gitlab:3000` and
`localhost:3000` retain PR MAX in both stores, count no GitLab MR, report false PR
coverage and name the unusable answer. Port-key support is tracked separately in
#91. Every attempted API argv still needs its own `net` audit entry.

All auth error frames, including token-less self-hosted/logged-out and no-instance
cases, use the badge, margins and trailing padding from an authorized offline
`glab 1.123.0 (5686d7484)` capture of mutually exclusive `auth status --all
--hostname x` flags. That validation exits before auth/host contact. Fixed error
messages from the checked source replace only the frame's message; no real auth
output or credentials are used. Malformed blocks before and after token-less
gitlab.com keep coverage false, name their line and retain the readable IP host's
MR. Orphan/unreadable/empty blocks and token-read/client-init errors also preserve
PR MAX independently of commits. Both streams and the environment-token footer
are covered. The auth stub records and requires `GLAB_CHECK_UPDATE=false` and
`GLAB_SHOW_WHATS_NEW=false`, even with both inherited as true, proving discovery
suppresses update requests and notices. Case-prefixed assertions identify malformed
coverage failures. Counts and MR identities are literal; the old-regex negative
control belongs only in a private copy. Existing fixture registrations stay intact.

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

`dashboard-lines` runs the actual `--demo --git no --ai no` CLI through installed Ink.
Demo and fixture-only retained data each exercise controlled stdout widths 80/120,
non-TTY pipes at `COLUMNS=80` and `COLUMNS=200`, plus retained data on real sized
stdout PTYs at 80/120. The PTYs have closed stdin and are not interactive sessions;
`capture-pty.py` uses Python's standard library under `-I`, with no `isTTY` spoofing.
All cases pin account rows and amounts, Total unused, footers, later content and
an exact two-line Events-to-Summary gap. The notice is expected only on narrow
TTY stdout, never on pipes. Retained data includes one `box-z` day, floor plans
and $24 unused; production `src/demo-data.json` is unchanged.

Set `WORTHIT_FIXTURE_ARTIFACTS` to save captures and individual CLI/capture statuses.
`node test/fixtures/dashboard-lines/render.mjs <captures> <images> 80` renders only
the [80-column PTY stream excerpt](fixtures/dashboard-lines/retained-80.png), including
the actual notice position and Events-to-Summary spacing. It strips ANSI and
renders physical wrapping of fixed-width lines; it is not a terminal frame. The
previously inspected [120-column capture](fixtures/dashboard-lines/retained-120.png)
is unchanged. The new narrow Chrome process exited 2 after writing its inspected
PNG; the render wrapper exited 1, while all ten product CLI runs exited 0.
`evidence.json` separates these statuses and retains the old wide-image provenance.
Image generation is outside `make check`.
