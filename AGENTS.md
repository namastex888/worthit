# worthit repository contract

worthit is one command (`npx worthit`) that reads the logs AI coding tools already keep on a person's
machine, prices every request at API list rates and shows what a subscription's weekly limit was worth,
what was delivered with it and what it cost. It has three goals, in this order:

1. **Subscription allowance:** what one full weekly limit of each plan is worth, and whether it moved.
2. **Real productivity:** what was delivered (merged pull requests by kind) and the cost of a delivery.
3. **The fun part:** levels, streaks, the pet and shareable cards.

## Rules

- Node 22.5+ for the CLI and the TUI (`bin/`, `src/`), Python 3 for the core (`core/`). No build step.
- `dev` is the only branch. Pull requests target `dev`. Commits are conventional
  (`type(scope): description`).
- Every merge into `dev` cuts a release `v0.N.0` on its own (`.github/workflows/release.yml`), unless
  the commits since the last release are only `ci`, `docs`, `test` or `chore(release)`. Never edit a
  version by hand: `node scripts/version.mjs`.
- npm is the owner's step: `make publish` publishes the newest release as `worthit` and `usagemeter`.
  `make status` shows whether npm is behind.
- `make check` is the gate CI and the release run. Run it before every push.
- A design decision that sets a public contract (a data field, a command, a file the store keeps) gets
  an RFC first: `docs/rfcs/README.md`. A scoped bug or a small feature ships as a plain issue and PR.
- worthit reads; it never uploads. What leaves the machine is listed in the README and in the audit log
  of every run. A change that adds a network request names it in both.
- A number is either **measured** (the plan's own meter, every machine answered) or a **floor**
  ("at least"). A floor is never compared week to week. A change that blurs the two is a bug.
- The data a run prints must say which machines it read: `machines_missing` and `machines_left_out`.
- The agent skill (`skills/worthit/SKILL.md`) and `worthit schema` are a public contract for agents:
  a field that changes there changes in both, in the same PR.
- No real person's numbers, machine names, account names or repository names in the repo, in an issue,
  in a PR or in a public image. Screenshots, the demo and the Herdr mod's preview use `worthit --demo`.
- The Herdr mod lives in `herdr-mod/`. That folder never holds `layouts/` (herdr.dev would skip the
  whole repository). After any change: `herdr-app check herdr-mod/mods/worthit`.

## Testing

- Never test against a real store. Use `--demo`, or `WORTHIT_HOME=<a copy of a store>`.
- A fix for a data error comes with a fixture that reproduces it.
- A PR that changes what the TUI or a card draws includes a rendered image that was looked at.

## How work moves

One issue, one branch, one worktree, one pull request. An independent review on the exact head commit
(SHIP, FIX-FIRST or BLOCKED) comes before the merge; a new commit voids it. After the release, the build
is used the way a stranger would use it, and what breaks is filed as an issue. On merge the branch and
its worktree are removed.
