# Fixture data checks

`make check` calls `node test/run-fixtures.mjs`. Every directory under `test/fixtures/`
must contain a plain `check.mjs`. Checks run sequentially in separate processes; a failure
names the folder, and the remaining folders still run. The four original regression
folders are required, so deleting a folder or its check fails the gate too. Add another
folder with a `check.mjs` to add a case; no registration or framework is needed.

The first three folders share literal **source logs** in `test/sources/box-a/` and
`box-b/`, rather than scan responses. `support/materialize.py` puts the Claude Code,
Codex and Antigravity JSONL in their normal scanner paths and installs `meter.sql`
as a tiny SQLite source store. `claude-limits.jsonl` supplies the Claude weekly meter.
The real CLI runs the real extractor, weekly pricing, data shaping and store queries.
The SSH command executes the actual scanner piped to it, against box-b's separate home.
`keep-saved-days` adopts the independently delivered issue #24 fixture, extends it with a
successful empty response and a lost-logs sliding cutoff, and pins its week in an expected file.

The environment is built from an allowlist. HOME, WORTHIT_HOME, tool config dirs,
meter state and XDG dirs all point inside scratch. PATH contains only Node, Python,
`which` and deterministic fixture commands. SSH never connects; code-host searches
read `pull-requests.json`, with distinct responses per requested author and date range.
The meter command only returns the fixture store. Unrecognized commands fail and are
recorded. Network calls from Node and Python are rejected. No real accounts, machines,
config, stores or credentials are needed. The runner also gives plain checks an
isolated environment, including issue #24's existing check.

`clock.mjs` and `sitecustomize.py` freeze only test subprocesses at 2026-11-14 12:00 UTC.
Python's synthetic hostname distinguishes the two machines. There is no production
clock override. Expected snapshots omit generated times, account hashes and paths;
only the presence of a saved scan time is normalized to `<saved scan>`.

## Source ledger and expectations

The previous week has requests on Nov 2, 4 and 6; the current week on Nov 9, 11 and 13.
Each tool has three requests in each week on each machine. Box-a emits 100,000 output
tokens per request; box-b emits 200,000. Inputs and cache counters are zero. Claude
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

Claude's three sessions agree on a meter rising from 0 to 50 to 100% each week.
Both machine lines agree, so the complete fresh run measures $9 per full weekly
limit. Missing or left-out machines must force a floor and suppress the allowance
comparison. A cold missing box-b yields $18; its saved scan yields $54 on no answer.
Leaving box-b out yields a current $18 while the store preserves the earlier $54.
Both stored weeks are checked through the real CLI's SQL command.

`coder-a` has one current feature and one previous fix. `coder-b` independently has
one current feature, one current fix and one previous feature. Combined delivery
is three current PRs (two features, one fix) and two previous PRs. The case adds the
inactive second account after the first account is already cached, reruns for
deduplication, selects the second account alone in a fresh store, and reverses the
active account order in another fresh store.

Each case keeps literal expectations in its own `expected-data.json`. Edit those
only when an intentional contract or fixture change explains the new number.
Run `make check` before pushing. Deliberate regression experiments belong in a
private throwaway copy; leave the checked-out implementation intact.
