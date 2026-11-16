# Neutral rounded zero

Synthetic presentation regression for issue #104, authored before production
changes. The fail-first run reproduced the defects with passing controls.
Fresh `dev` includes PRs #114 and #116;
the null controls preserve #116's distinct usage and count baseline labels.

`check.mjs` covers exact zero, negative zero, rounded +0.3% and -0.3%, and
positive/negative half-percent controls. It checks seven dashboard deltas,
delivery card HTML and color, the CLI's Markdown writer, and actual serial
`share delivery --ai no --no-files` invocations. Null comparisons and partial PR
counts are controls. The usage-floor cost line must preserve the fixes share,
fit its 98-column box and have balanced parentheses. The schema assertion pins
the rounding description to the plan's change field.

The two #130 label-fit cases share the exact `box()` / `clip()` path responsible
for the delivery parenthesis. They preserve complete demo floor labels and the
empty ranking's explanation at the existing box widths. They permit narrow
wording or line-break repairs without a shared box-renderer change.

The dashboard HTML and Markdown use the real CLI writer functions, evaluated
with synthetic data and inert filesystem/audit effects. Card HTML uses the real
card renderer. No screenshot process or browser is launched. Optional
`WORTHIT_FIXTURE_ARTIFACTS` retains synthetic HTML, JSON, Markdown and share text.
Run only with explicit synthetic `HOME`, `WORTHIT_HOME` and `TMPDIR`.

Reviewer render proposal (each run needs its own authorized slot):

- Inspect `zero-dashboard.html`, `tiny-rise-dashboard.html`,
  `tiny-drop-dashboard.html` and `usage-floor-dashboard.html` in the retained
  fixture artifacts; capture the real HTML at 1000 pixels wide, tall enough for
  all lines. Inspect all seven neutral comparisons and the complete floor line.
- Inspect `floor-trend-dashboard.html` and `empty-ranking-dashboard.html` for
  complete labels and sentences at the existing 39- and 56-column widths.
- Capture the corresponding `*-card.html` at 1600 by 900. Include `rise` and
  `drop` controls and inspect their opposite cost colors. Use fresh output and
  browser profile directories with network disabled; retain raw browser exit
  and image validation separately. Chrome runs outside the Codex sandbox.
- Refresh the full-demo `docs/demo.gif` and `herdr-mod/preview.png` from
  `node bin/worthit.mjs --demo --git yes --ai no` in a synthetic environment.
  Preserve their established framing and inspect COST PER PR and Delivery.
- With separate authorization, run `test/fixtures/ledger-week-proof/check.mjs`
  with retained artifacts. Its `ledger-both-measured.json` and
  `ledger-floor-then-measured.json` supply synthetic source data for the existing
  ledger images. Use `cardHtml(cardSpec('allowance', data))` for each allowance
  card. Use the production CLI `ansiHtml` with `blocks.LimitTrend(data)` and
  `blocks.AllowanceHistory(data)` for the floor-then-measured dashboard. Inspect
  existing images first and refresh those showing a zero arrow, preserving
  dimensions. Do not substitute real stores or label ledger floors measured.
- Run `herdr-app check herdr-mod/mods/worthit` outside Codex, under its own
  authorization, with isolated HOME, WORTHIT_HOME and HERDR_APP_HOME. Seed only
  synthetic demo data if needed. The PR must state that the Claude reviewer ran
  and inspected renders outside Codex, and report the actual outcomes.

Existing requested image inventory (no images regenerated):

| Artifact | Dimensions | Bytes |
| --- | --- | ---: |
| `docs/demo.gif` | 737 × 2100 | 548885 |
| `herdr-mod/preview.png` | 740 × 1260 | 114826 |
| `docs/ledger-both-measured-allowance.png` | 1600 × 900 | 92284 |
| `docs/ledger-floor-then-measured-allowance.png` | 1600 × 900 | 86943 |
| `docs/ledger-floor-then-measured-dashboard.png` | 1000 × 600 | 47397 |
