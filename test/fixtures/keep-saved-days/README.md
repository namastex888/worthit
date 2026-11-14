# Saved days survive a fresh scan (issue #24)

All names and usage here are invented. `saved.json` is one scanner response from `box-a`: fourteen
days, January 1–14, with one Claude bucket per day. `fresh.json` is its response after logs were lost:
only January 14, with less usage and a different session key. The expected result keeps fourteen days.

Run `node test/fixtures/keep-saved-days/check.mjs` from a worktree. It also runs in `make check`.
The script uses temporary HOME and WORTHIT_HOME directories, fake local scanner and SSH responses,
and the real pricing, merge, history and JSON pipeline. It never scans this computer or contacts SSH.
For rolling-week assertions it shifts the literal fixture dates into the fourteen days before today.

The assertions cover richer saved/fresh overlaps, new days, exact ties, a pricier-model/fewer-tokens
conflict (including a real CLI current-week USD comparison), providers rotating independently,
whole-unit breakdowns, inferred tool-store pricing, local-day boundaries, local scans,
machine isolation, duplicate aliases, persisted retained days, stable weekly totals/history rows, and
named dashboard/JSON notes. Every plan is a floor with no weekly comparison when a retained unit
intersects this week; retaining only older units does not change this week's proof.

Selection is per machine, local day and provider: higher API-list USD at this run's bundled prices
wins, then total tokens; fresh wins a full tie. The winning unit's rows stay together. The script
can write synthetic `data.json` and dashboard text with `WORTHIT_FIXTURE_ARTIFACT_DIR=<scratch>`.
Issue #25 can adopt this folder as its fourth regression case.

Only saved days fully covered by the fresh scan's `since` cutoff are compared. Older days have
left the sliding window; they are not reported as lost. This minimal rule also drops the partially
covered cutoff day from saved data, even if logs were lost during that day. It keeps the fresh
`since` unchanged and does not clip individual hours or extend the scan window.

The regression covers an intact sliding window, including `--days 7` with measured proof and an
eligible ledger comparison. `truncated-saved.json` is deliberately incomplete: a real CLI run
must recover using fresh data and report no retained machines. Missing `since` skips retention;
an unreadable run file stays untouched for the weekly report to flag. Synthetic runs also verify
both Python entrypoints with `-I` and `PYTHONSAFEPATH=1`, plus folded long-alias notes that fit the
ranking panel. `dashboard.png` shows the folded note with a distinct-day range for two machines.
