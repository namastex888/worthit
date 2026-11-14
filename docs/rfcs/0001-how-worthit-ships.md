# RFC 0001: How worthit ships

| Field | Value |
|---|---|
| Status | In delivery, 2026-11-12 (#1: versions and releases; deliveries 1-3 open) |
| Created | 2026-11-14 |

## Summary

worthit ships through one loop of four steps: make it, review it, use it like a stranger, fix what broke.
Every merge into `dev` that ships code is a release. A number never reaches a person unless a check on
fixture data stands behind it.

## Motivation

In its first three days worthit shipped 16 releases. Every data error in that time was found by reading
real output after the release: a run that could not reach every machine reported a smaller week without
saying so, and pull requests from a second account were left out. The gate (`make check`) only proves
the files parse and the commands start. Nothing proved the numbers.

## Design

### Versions and releases (in use)

- One version, `0.N.0`, one above the last release (`scripts/version.mjs`).
- A merge into `dev` cuts it, tags `v0.N.0` and publishes the GitHub release with the npm tarball
  attached. Commits typed `ci`, `docs`, `test` or `chore(release)` cut nothing.
- npm is one manual step, because npm asks for a fingerprint: `make publish` publishes the newest tag
  under both names and is safe to run twice.

### The loop

1. **Make.** One issue, one branch, one worktree, one PR into `dev`.
2. **Review.** Before the merge, an independent review of the exact head commit: SHIP, FIX-FIRST or
   BLOCKED. The reviewer runs on a different model provider from the author. A new commit voids the
   verdict.
3. **Dogfood.** After each release, the new build is run the way a stranger would run it: `npx
   worthit@latest --demo`, then on a copy of a real store, then every command the README names. Each
   promise in the release notes is checked against the screen. What breaks is filed as an issue with the
   command, the observed output and the expected output.
4. **Fix.** A dogfood issue or a FIX-FIRST verdict is repaired in its own PR, with a fixture that
   reproduces it, and goes through review again.

### Tests on fixture data (delivery 1)

- A fixture store: small, synthetic logs for each tool worthit reads, for two machines and two weeks.
- `make check` runs the core on it and compares the week's data with an expected file.
- Cases that have already failed once are fixtures first: a machine that does not answer, a machine
  left out of the selection, a second code-host account, a machine that answers again with empty logs.

### Housekeeping

On merge, the PR's branch (local and remote) and its worktree are removed by whoever opened it.

## Deliveries

| # | Delivery | State |
|---|---|---|
| 0 | Versions and releases: `release.yml`, `scripts/version.mjs`, `make publish` | merged (#1, 2026-11-12) |
| 1 | Fixture store and a data check in `make check` | open |
| 2 | The dogfood checklist as a file in the repo, run after each release | open |
| 3 | Independent review recorded on each PR before merge | open |

## Open questions

These questions do not block delivery 1.

1. Should `make publish` be offered after every release, or only when a release changes what
   `npx worthit` does (a Herdr-mod-only release changes nothing on npm)?
2. Should merged branches be deleted by GitHub automatically?
