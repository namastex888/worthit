# Saved days survive a fresh scan (issue #24)

All names and usage here are invented. `saved.json` is one scanner response from `box-a`: fourteen
days, January 1–14, with one Claude bucket per day. `fresh.json` is its response after logs were lost:
only January 14, with less usage and a different session key. The expected result keeps fourteen days.

Run `node test/fixtures/keep-saved-days/check.mjs` from a worktree. It also runs in `make check`.
The script uses temporary HOME and WORTHIT_HOME directories, fake local scanner and SSH responses,
and the real pricing, merge, history and JSON pipeline. It never scans this computer or contacts SSH.
For rolling-week assertions it shifts the literal fixture dates into the fourteen days before the
fixed test clock (2026-11-14 12:00 UTC). `expected-data.json` pins fourteen retained days and the
week's 705,000 output tokens and $7 rounded API value: seven saved 100,000-token Claude days plus
the other machine's 5,000-token day, with the fixture's small input/cache counters.

The assertions cover richer saved/fresh overlaps, new days, exact ties, a pricier-model/fewer-tokens
conflict (including a real CLI current-week USD comparison), providers rotating independently,
whole-unit breakdowns, inferred tool-store pricing, local-day boundaries, local scans,
machine isolation, duplicate aliases, persisted retained days, stable weekly totals/history rows, and
named dashboard/JSON notes. Every plan is a floor with no weekly comparison when a retained unit
intersects this week; retaining only older units does not change this week's proof.

Selection is per machine, local day and provider: higher API-list USD at this run's bundled prices
wins, then total tokens; fresh wins a full tie. The winning unit's rows stay together. The script
can write synthetic `data.json` and dashboard text with `WORTHIT_FIXTURE_ARTIFACT_DIR=<scratch>`.
Issue #25 adopts this folder as its fourth regression case. A successful response with fully empty
logs also keeps fourteen days, stable weekly data/history and the named machine/day note. Its
retained current-week units are passed to a synthetic `buildData` report to verify floor proof for
every plan and no weekly comparison.

Only saved days fully covered by the fresh scan's `since` cutoff are compared. Older days have
left the sliding window; they are not reported as lost. This minimal rule also drops the partially
covered cutoff day from saved data, even if logs were lost during that day. It keeps the fresh
`since` unchanged and does not clip individual hours or extend the scan window.

The real CLI check for an intact `--days 7` sliding window asserts no false retention and an
unchanged fresh window in the store. A separate synthetic `buildData` report receives that empty
retained list and `days: 7`; it verifies that those inputs do not force a floor or suppress an
otherwise eligible ledger comparison. It does not prove meter-derived measured proof end to end.
A lost-logs sliding-window check uses different saved and fresh `since` values, retains seven
eligible days, and asserts the merged `since` equals the fresh cutoff.
`truncated-saved.json` is deliberately incomplete: a real CLI run
must recover using fresh data and report no retained machines. Missing `since` skips retention;
an unreadable run file stays untouched for the weekly report to flag. Synthetic runs also verify
both Python entrypoints with `-I` and `PYTHONSAFEPATH=1`, plus folded long-alias notes that fit the
ranking panel. `dashboard.png` shows the folded note with a distinct-day range for two machines.
