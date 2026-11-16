# RFC 0004 delivery 1

`check.mjs` runs synthetic Claude/Codex logs through the real scanner, machine cache,
pricing core and buildData, then the saved CLI command. No real store or usage source
is read. The registered fixture covers:

- Live folder, subfolder and linked worktree (.git file -> gitdir -> commondir).
- SSH, credentialed HTTPS, default/nondefault ports, unsupported alias and duplicate origins.
- Cached replay, credential-free payloads/cache tails, remembered deleted folders,
  outdated rule version, no-cache fallback, Codex URL precedence and live folder reuse.
- All no-repository reasons, legacy buckets and unpriced dsh meter rows.
- Tokens/requests/value and project/unattributed/PR-only PR reconciliation.
- Separate machine, unresolved-row and PR proof; $0 unresolved rows; git-off nulls.
- Machine missing/left out, retained-unit overlap and pre-retirement week floors.
- Saved read command and synthetic demo, including valued --demo rejection before store access.
- Actual fake-agent captures for summary, question-bar get/SQL and custom share topic/DATA.
  Agent SQL runs in a usage-only in-memory database; public local PR SQL remains available.

`render.mjs` is a separate real Chrome render of the allowance card from the synthetic
project demo. Its PNG is inspected as visual evidence; project names do not appear on cards.
It is deliberately outside `make check` so every render can receive its own Mac slot.


## Visual receipt, 2026-11-16

One separately approved real Chrome invocation of `node test/fixtures/project-stats/render.mjs`
exited 0. The shipped renderer returned no error or note. The resulting
[synthetic allowance card](demo-allowance.png) was opened and visually inspected:
legible text, intact layout and floor labels, no project names.

- PNG: 1600 x 900, 119440 bytes.
- SHA-256: `089a735ad2f9879d886d1211730da7465f2cabd1f4239a51967ef235844600e3`.
- Only bundled synthetic demo data; isolated HOME, WORTHIT_HOME and config/cache directories.

Focused fixture: first invocation exited 1 on the remembered-folder expectation explained
beside the assertion; the second, separately approved invocation exited 0. The second also
covered structural redaction with a short repository name `api`, preserving metric keys.
Full `make check` evidence and exact candidate revision are recorded in the delivery PR.
