# RFC 0004: Per-project and per-model delivery

| Field | Value |
|---|---|
| Status | Queued |
| Created | 2026-11-16 |
| Issue | none yet (the owner's ask of 2026-11-16) |
| Depends on | nothing for delivery 1; delivery 2 needs delivery 1's `project` in the scan |

## Summary

worthit learns what a **project** is: a git repository, named the same way on every machine. Delivery 1
shows, per project and per model inside it, the API-list value, output tokens, requests, merged pull
requests and the value per merged PR, in one new command, `worthit projects`. Delivery 2 links each
merged PR to the model that led its branch and adds a first-pass signal per model.

## Motivation

The owner's ask, in his words: "we need metrics in worthit to know whether the squads deliver on a given
model" and "we need worthit to have statistics per project". A week of agent squads is judged by these on
2026-11-23, so delivery 1 has to ship within days.

Today worthit answers per tool, per model and per day, for all work together:

- The scan already reads where a request ran. Claude Code writes `cwd` and `gitBranch` on every log line
  (`core/extract_usage.py:159`). Codex writes `cwd`, the branch and the repository URL once per session
  (`core/extract_usage.py:184`). Both end up on the session only (`:315`, `:414`), and a usage bucket has
  no project (`:304`). For Antigravity, omp and dsh the scan reads no folder today (`:549`, `:638`).
- Merged PRs are stored per repository (`pr_kind` keys like `github.com/acme/app-api#12`), but `git()`
  returns only their merge times (`src/collect.mjs:353`), so `git.merged_prs` is one number for
  everything (`src/collect.mjs:472`). Per PR it reads the repository, number, merge time and title
  (`src/collect.mjs:265`): no branch, no review.

So nobody can say what one repository cost, which model did the work in it, or what a merged PR cost
there.

## Design

### 1. What a project is

A project is a git repository. Its id is the URL of its `origin` remote, normalized to
`host/owner/name`: lower case, no scheme, no user or token, no port, no `.git`. Both
`git@github.com:acme/App-API.git` and `https://<token>@github.com/acme/app-api` give
`github.com/acme/app-api`. That is the form GitHub PR keys already have. The short name is the last part
(`app-api`); the owner is added when two projects share it.

- **Worktrees and subfolders.** The scanner walks up from the request's folder to the first `.git`. A
  worktree's `.git` file points at the main repository, and `origin` is read from that repository's
  `config`. It reads files only: no `git` process, no fetch.
- **Per request, not per session.** The id goes into the usage bucket's key, because a session can move
  into a worktree. Claude Code gives the folder per request; Codex gives it once per session.
- **Other machines.** The scanner already runs on each ssh machine, so the folder is resolved where it
  exists and only the id comes back with the usage. Nothing new is installed there.
- **Folders that are gone.** Squads remove a worktree when its PR merges, so a folder is often gone at
  scan time. The scanner tries, in order:
  1. the repository URL Codex wrote in the log;
  2. a folder-to-project map it keeps in the scan cache on that machine (`~/.worthit/` there), written
     when a folder resolves and replaced only by a later live answer for the same folder;
  3. on this machine, the usagemeter store's `cwd_repo` map (`src/collect.mjs:202`), matched by
     `owner/name`.

  What is left is counted as `folder_gone`, never guessed.
- **"No repository".** One bucket holds all usage without a project, with the reason for each part:
  `outside_a_repository`, `no_remote`, `folder_gone`, `no_folder_read` (Antigravity, omp, dsh) and
  `saved_before_projects` (a saved scan from before this delivery, until that machine answers again).

**The judged week.** A worktree removed before a machine's first scan with delivery 1 stays `folder_gone`
unless Codex or the meter map knows it. Every day without the scan half loses folders, so that half (the
id and the remembered map) can merge first if the rest is not ready. After it, scan every machine at
least daily with git on: `worthit --json --hosts all`.

Known limit: a fork has its usage under the fork (`origin`) and its PRs under the upstream repository.
Delivery 1 shows both rows and does not join them.

Alternatives: the root commit hash (survives renames, but needs a `git` process per folder, merges
forks and does not match PR keys); the folder name (collides, differs per machine); the usagemeter
`cwd_repo` map alone (this machine only, no host, needs git on).

### 2. Delivery 1: `worthit projects`

A run adds one block, `projects`, to its data (`--json`, `last.json`, `worthit get projects`). The window
is the run's rolling seven days, the same as `totals` and `git`: a run on 23 Nov covers 16 to 23 Nov.

```
worthit projects        # the last run's projects: a table in a terminal, JSON when piped
```

It reads the last run, like `get`: no scan, no network. Piped, it prints the block below plus `week`,
`generated_at` and the run's `machines_missing`, `machines_left_out`, `machines_retained` and
`machines_retired`. The last run may be one with git off: `worthit weekly` saves it too
(`bin/worthit.mjs:551`). Then the PR columns are empty and the command names the run that fills them,
`worthit --json`.

```json
{
  "floor": true,
  "coverage": { "machines": true, "attributed_pct": 81, "unknown_usd": 240, "prs": true },
  "rows": [
    { "project": "github.com/acme/app-api", "name": "app-api",
      "api_value_usd": 1260, "output_tokens": 12400000, "requests": 9100,
      "merged_prs": 21, "usd_per_merged_pr": 60,
      "models": [
        { "model": "opus-5-5", "tool": "claude", "api_value_usd": 840, "output_tokens": 7900000,
          "requests": 5200, "share_pct": 67 },
        { "model": "gpt-6.1-sol", "tool": "codex", "api_value_usd": 420, "output_tokens": 4500000,
          "requests": 3900, "share_pct": 33 } ] }
  ],
  "no_repository": { "api_value_usd": 300, "output_tokens": 2900000, "requests": 2300, "models": [],
    "why_usd": { "outside_a_repository": 60, "no_remote": 0, "folder_gone": 150,
                 "no_folder_read": 90, "saved_before_projects": 0 } }
}
```

**Usage: two checks, kept apart.** A sum of logs is never called "measured"; that word stays with the
plan's own meter.

- `coverage.machines` is the machine half of the existing proof rule (RFC 0002): every machine that is
  not retired answered, none is left out, no retained unit falls inside the week, and the week starts on
  or after every retirement.
- `coverage.unknown_usd` is usage that may belong to any project: `folder_gone`, `no_folder_read` and
  `saved_before_projects`. Anyone who uses Antigravity, omp or dsh has some every week.
- `floor` is false only when `coverage.machines` is true and `unknown_usd` is 0. Otherwise every row's
  value, tokens and requests are floors: say "at least".
- Delivery 1 has no week-over-week field for projects, so a floor cannot be compared by mistake. A later
  delivery that adds one needs `floor: false` at both ends.

**Merged PRs.** `git()` returns each PR's key with its merge time, and a PR counts for the project its
key names.

- The keys differ per forge today: GitHub has `host/owner/name#n` (`src/collect.mjs:266`), GitLab its
  host and full reference (`:342`), Gitea and the usagemeter store no host (`:297`, `:201`). A key with
  no host is matched by `owner/name` when exactly one project has it.
- A PR whose repository had no usage this week still gets a row, with zero usage.
- Only PRs authored by an account logged in on this machine count, as today.
- `usd_per_merged_pr` is the project's API value divided by its merged PRs, `null` with no PR. When
  `floor` is true and PRs are covered it is "at least".
- `coverage.prs` is `git.coverage.prs`. When it is false, `merged_prs` is "at least" and
  `usd_per_merged_pr` is labelled "partial PR count", by the rule the skill already has for
  `git.usd_per_merged_pr`. With git off (`--git no`, `worthit weekly`) both are `null`.

**What delivery 1 says about models.** Each model's share of the work inside each project. It does not
count PRs per model: a PR belongs to a project here. That is delivery 2.

**Not in delivery 1:** a dashboard block, a card, a history table, `worthit days --by project`.

Alternative: a block in the dashboard (it would put repository names into the PNG and the `.md` that
people share, and a drawing change needs more review than a read command).

### 3. Delivery 2: which model delivered

Three of this repository's own merged PRs were checked on 2026-11-16 (#79, #87, #92): none has a forge
review, a PR comment or a model trailer in its commits. So the design cannot rest on reviews or
trailers.

**The link.** The usage bucket's key also gets the branch (Claude Code logs it per request, Codex at
session start). A merged PR is linked to the requests with the same project and the PR's head branch,
made before the merge and after the previous merged PR that used the same branch name. The PR's **lead
model** is the model with the largest share of API value in those requests, shown with its share. Per
model, and per project and model: `prs_led` and `usd_per_pr_led`.

**The first-pass signal.** `first_pass` is true when the PR merged with no commit added after an
anchor. Proposed anchor: the moment the PR was opened, which every forge has (question 5). It only tells
PRs apart when a squad opens the PR before its review. In the three PRs above it does: each has a commit
dated after it was opened. Per model: `first_pass` (a count) and `first_pass_pct`, which is `null` under
five PRs with a known signal.

**What cannot be known, said plainly:**

- Who wrote a commit. The link is by branch: a person typing on a squad's branch counts for its model.
- The review. Verdicts (SHIP, FIX-FIRST) stay in the squads' terminals; the forge does not have them.
- Work on a machine that was not read, a Codex session that changed branch after it started, and
  sessions on the default branch or a detached commit (reviewers). Their PRs stay unlinked.
- Whether a model is better. Models get different tasks. The signal says what happened on the PRs a
  model led, with the count beside every rate.
- When a commit was pushed. A commit carries an author date and a commit date; neither is the push
  time, and a rebase changes the second. Which forge data stands for "a commit after the anchor", and
  whether a merge of the base branch counts, is fixed in the delivery issue against the forge's
  documentation.

**Coverage** is printed with the numbers: `merged_prs`, `linked_prs`, `signal_known_prs` and the forges
that answered. Rates are over known PRs only. Delivery 2 starts with GitHub; GitLab and Gitea PRs count
as unlinked until they follow. A partial week is never compared with another.

Alternatives: commit trailers (not written by every tool, absent from this repository's PRs); a share
of each PR per model (0.33 of a PR is hard to read); linking by time alone (wrong when squads run in
parallel).

### 4. What leaves the machine

- **Delivery 1: no new network request.** Two things change and are named in the README and the audit
  log. Each machine's scan reads the `.git` file and `config` of the folders its sessions ran in (audit
  `read` lines). The ssh scan now brings back repository ids with the usage, to the person's own machine.
- **Delivery 2: one new kind of request.** For each merged PR of the week, its head branch and its
  commits (and its reviews, if question 6 is yes), from GitHub through `gh`. Each request is an audit
  `net` line and a line in the README's list. `--git no` turns it off.

### 5. Privacy

- Repository names are the person's own data. They appear in local output only: `worthit projects`,
  `--json`, `last.json` and the audit log.
- They are not drawn into the dashboard, the PNG, the `.md` or any share card, and they are not put in
  the AI agent's prompt (question 3).
- A token inside a remote URL is removed on the machine that read it, before anything is stored or sent
  back.
- `--demo`, the fixtures, the README and every public image use synthetic projects (`app-api`,
  `web-client`).

### Public contract touched

Delivery 1: the `projects` block, the `worthit projects` command, and `project` in the scan's buckets.
`skills/worthit/SKILL.md`, `worthit schema` and the README change in the same PR. No new table.

### Tests

Fixture cases for delivery 1:
- the rows plus `no_repository` add up to `totals`, and the rows' `merged_prs` to `git.merged_prs`;
- a worktree, a subfolder, an ssh URL and an https URL with a token give one id, and the token is in no
  output;
- a folder that is gone but remembered is attributed; one that is not is `folder_gone` with `floor` true;
- a machine missing gives `floor` true; git off gives `null` PR fields.

## Deliveries

| # | Delivery | State |
|---|---|---|
| 1 | `project` in the scan, the `projects` block, `worthit projects`, the fixture cases | open |
| 2 | The PR-to-model link, `prs_led`, the first-pass signal and its coverage | open |
| 3 | Project history: a daily table, `worthit days --by project`, week-over-week | not scheduled |

## Open questions (for the owner)

Questions 1, 3 and 4 block delivery 1. Questions 5 to 7 block only delivery 2.

1. **Command or dashboard?** Recommended: the `worthit projects` command. Answer: command / dashboard.
2. **Is project and model enough for a squad?** worthit cannot see squads, only repositories and models.
   Recommended: enough for 23 Nov. Answer: enough / squads need their own label.
3. **Repository names in the AI agent's prompt?** Recommended: no. Answer: no / yes.
4. **A repository with no remote?** Recommended: it stays in "no repository" as `no_remote`.
   Answer: no repository / its own row by folder name.
5. **The first-pass anchor.** Recommended: PR opened, which works with today's data.
   Answer: PR opened / first review.
6. **Will squads post their verdict on the forge**, as a PR review on the head commit? Then delivery 2
   can read the review itself. Answer: yes / no.
7. **One lead model per PR, or shares?** Recommended: one lead model. Answer: lead / shares.
