# Git source floors (#52)

These inspected images use only the `git-source-coverage` fixture's synthetic
source commands and data. The dashboard images render the actual `Tiles` and
`Delivery` drawing blocks; delivery cards render `cardHtml(cardSpec(...))`.
They do not exercise the interactive terminal shell or a live account.

- [Failed meter: dashboard](meter-sync-dashboard.png): at least 14 PRs and at least
  2 commits; no PR comparison; both costs explicitly use partial denominators.
- [Failed meter: delivery card](meter-sync-delivery.png): at least 10 features,
  partial cost and no comparison or earlier-week rows. The longer row note and
  footer are visible without clipping.
- [Every source answered: dashboard](good-dashboard.png): 14 PRs (+133%), measured
  2 commits, cost per PR -57%, 10 features (+100%) and cost per feature -50%.
- [Every source answered: delivery card](good-delivery.png): $20 per feature,
  -50% against $40, with measured feature counts.

The same fixture also checks a failed forge account (only PR coverage false) and
failed local git log (only commit coverage false). It asserts every existing
PR-derived percentage, personal best badges, card HTML and the shared fixed post
text. No new JSON proof fields are introduced. Null-change semantics are described
in `worthit schema` and `skills/worthit/SKILL.md`.

To reproduce, request the shared Mac test slot, then run the fixture once with
`WORTHIT_FIXTURE_ARTIFACTS=<scratch>` and an isolated HOME/WORTHIT_HOME. Rendering
needs no slot:

```sh
HOME=<synthetic-home> WORTHIT_HOME=<synthetic-store> node docs/issue-52/render.mjs <scratch>
```

This Mac's headless Chrome writes valid screenshots and then exits 2 with
`Teardown watchdog expired`. The docs-only renderer records that diagnostic and
accepts it only with the exact bytes-written receipt and a fresh PNG signature.
All four resulting images were opened and inspected. Production rendering is
unchanged.

A deliberate regression was tested only in a private throwaway copy: removing the
`merged_prs_change_pct` coverage guard made `make check` exit 2. Named case
`meter-sync: delivery-proof changes` failed (fixture exit 1): actual
`[133, null, null, null]`, required `[null, null, null, null]`. All nine fixture
folders ran, with only `git-source-coverage` failing. The implementation retained
the guard throughout.
