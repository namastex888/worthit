# RFC 0004: Per-project and per-model delivery

| Field | Value |
|---|---|
| Status | In delivery, 2026-11-16 (delivery 1 shipped: #117; delivery 2 shipped: #127; history not scheduled) |
| Created | 2026-11-16 |
| Issue | #115: delivery 1; #119, #123: delivery 2 |
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

- The scan already reads where a request ran, when the log says so. It keeps `cwd` and `gitBranch` from
  each Claude Code usage line (`core/extract_usage.py:159`), and `cwd`, the branch and the repository
  URL from a Codex session's first record (`:184`). Both end up on the session only (`:315`, `:414`),
  and a usage bucket has no project (`:304`). For Antigravity, omp and dsh the scan reads no folder
  (`:549`, `:638`).
- Merged PRs are stored per repository (`pr_kind` keys like `github.com/acme/app-api#12`), but `git()`
  returns only their merge times (`src/collect.mjs:353`), so `git.merged_prs` is one number for
  everything (`src/collect.mjs:472`). Per PR it reads the repository, number, merge time and title
  (`src/collect.mjs:265`): no branch, no opening time, no review.

So nobody can say what one repository cost, which model did the work in it, or what a merged PR cost
there.

## Design

### 1. What a project is

A project is a git repository, named by the URL of its `origin` remote.

**Finding the repository.** The scanner walks up from the request's folder to the first `.git`:

1. `.git` is a folder: that is the git directory.
2. `.git` is a file (a linked worktree, a submodule): its `gitdir:` line names the git directory. A
   relative path is resolved from the folder that holds the file.
3. If the git directory holds a `commondir` file, its content, resolved from the git directory, names
   the shared directory (`../..` for a linked worktree). Otherwise the git directory is the shared one.
4. The `url` of `origin` is read from `config` in the shared directory.

It reads files only: no `git` process, no fetch, no `include` or `insteadOf` followed.

**The id** is `host[:port]/path`, lower case, without scheme, user, token, a trailing `.git` or `/`.

- Supported: `https://`, `http://`, `ssh://` and `git://` URLs, and `user@host:path`. Both
  `git@github.com:acme/App-API.git` and `https://<token>@github.com/acme/app-api` give
  `github.com/acme/app-api`.
- A port that is not the scheme's default is kept, so two forges on one host stay apart. The price: a
  clone through such a port (ssh on 2222, say) has its usage under `host:port` and its PRs under the
  forge's `host`. The two rows do not join.
- Not supported, and left unresolved (`origin_not_supported`), never merged by guess: a host with no dot
  (an ssh `Host` alias such as `work-gh`; aliases are not expanded), a local path or `file://`, more
  than one `url` for `origin`, remotes but none named `origin`, a `config` that cannot be read.
- The same rule names a PR's repository from its key. A key with no host names no project (section 2).
- The short `name` is the last part (`app-api`); the owner is added when two projects share it.

**In the scan.** Each usage bucket gets two new key parts:

| Field | Type |
|---|---|
| `project` | the id, or `null` |
| `project_why` | `null` when `project` is set, otherwise one reason from the table below |

A bucket with no `project` key at all (a saved scan from before this delivery) reads as
`saved_before_projects`. The id is per request for Claude Code and per session for Codex.

| Reason | Meaning | Could it belong to a project? |
|---|---|---|
| `outside_a_repository` | the folder exists and no `.git` is above it | no |
| `no_origin` | a repository with no remote at all (question 4) | no |
| `origin_not_supported` | see above | yes |
| `folder_gone` | the folder no longer exists and nothing remembers it | yes |
| `no_folder_read` | no folder in the log record: Antigravity, omp, dsh, and any Claude Code or Codex record without `cwd` | yes |
| `saved_before_projects` | a unit scanned before this delivery | yes |

The last four are **unresolved** usage.

**Other machines.** The scanner already runs on each ssh machine, so a folder is resolved where it
exists and only the id comes back with the usage. Nothing new is installed there.

**Folders that are gone.** Squads remove a worktree when its PR merges. The scanner tries, in order:

1. the repository URL Codex wrote in the log, cleaned by the id rule before it is cached or sent;
2. the remembered map on that machine, a new table in its `scan-cache.db`:
   `folder_project (path TEXT PRIMARY KEY, project TEXT, resolved_at TEXT, ver INTEGER)`. `path` is
   the folder as logged, `project` a cleaned id, `resolved_at` an ISO time, `ver` the version of the id
   rule. Only a live resolution writes a row or replaces one. An older `scan-cache.db` gets the table on
   its first scan. A row with another `ver` is not used and is rewritten when its folder resolves again.
   With no cache (`WORTHIT_NO_CACHE`, a folder that cannot be written) the scan runs
   without it. It never leaves that machine, and deleting it loses only gone folders.

What is left is `folder_gone`, never guessed. The usagemeter store's `cwd_repo` map
(`src/collect.mjs:202`) is not used: it holds `owner/name` with no host. A path reused for another
repository is counted for the repository it last resolved to.

**The judged week.** A worktree removed before a machine's first scan with delivery 1 stays
`folder_gone` unless Codex logged its URL. After delivery 1, scan every machine at least daily
with git on: `worthit --json --hosts all`.

**Saved units.** A fresh answer does not always replace an older unit: the merge keeps the whole older
machine, day and tool unit when it scores higher (`core/merge_scans.py:43-63`). Such a unit stays
`saved_before_projects` until a unit with projects replaces it.

Known limit: a fork has its usage under the fork (`origin`) and its PRs under the upstream repository.
Delivery 1 shows both rows and does not join them.

Alternatives: the root commit hash (survives renames, but needs a `git` process per folder, merges
forks and does not match PR keys); the folder name (collides, differs per machine); the usagemeter
`cwd_repo` map (this machine only, no host, needs git on).

### 2. Delivery 1: `worthit projects`

A run adds one block, `projects`, to its data (`--json`, `last.json`, `worthit get projects`). The window
is the run's rolling seven days, the same as `totals` and `git`: a run on 23 Nov covers 16 to 23 Nov.

```
worthit projects        # the last run's projects: a table in a terminal, JSON when piped
```

It reads the last run, like `get`: no scan, no network. Piped, it prints the block below plus `week`,
`generated_at` and the run's `machines_missing`, `machines_left_out`, `machines_retained` and
`machines_retired`. The last run may be one with git off: `worthit weekly` saves it too
(`bin/worthit.mjs:551`). Then the PR fields are `null` and the command names the run that fills them,
`worthit --json`.

```json
{
  "floor": true,
  "coverage": { "machines": true, "unresolved_rows": 37, "unresolved_usd": 240, "attributed_pct": 81,
                "prs_sources": true, "prs_attributed": true },
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
  "no_repository": { "api_value_usd": 300, "output_tokens": 2900000, "requests": 2300,
    "why_usd": { "outside_a_repository": 60, "no_origin": 0, "origin_not_supported": 0,
                 "folder_gone": 150, "no_folder_read": 90, "saved_before_projects": 0 } },
  "prs_without_project": { "merged_prs": 0, "why": { "no_host_in_key": 0 } }
}
```

**Where the rows come from.** The pricing core adds one aggregate to its report, `project_activity`:
rows of `{hour, provider, model, project, project_why, output, requests, usd}`. It is filled in the two
places that fill `activity`, from the same selected, deduplicated, priced rows: the scan buckets
(`core/weekly.py:378-382`) and the usagemeter rows for omp and dsh (`:358-368`), which are not scan
buckets and always get `no_folder_read`. Summed over project and model it gives `activity` back.
`buildData` cuts it with the window it uses for `totals`.

**Numbers.**

- Dollars are rounded to whole dollars like `totals`; tokens and requests are exact.
- `share_pct` is a model's share of the project's API value, not of its requests:
  `round(100 * model usd / project usd)`, `null` when the project's value is 0.
- `attributed_pct` is `round(100 * API value of all rows / API value of rows plus no_repository)`,
  `null` when that total is 0.
- `usd_per_merged_pr` is `api_value_usd / merged_prs`, not rounded, `null` with no PR.

**Usage: is it complete?** A sum of logs is never called "measured"; that word stays with the plan's own
meter.

- `coverage.machines` is the machine half of the existing proof rule (RFC 0002): every machine that is
  not retired answered, none is left out, no retained unit falls inside the week, and the week starts on
  or after every retirement.
- `coverage.unresolved_rows` counts the `project_activity` rows in the week whose reason is unresolved.
  `unresolved_usd` is their value: an amount, not the test. A row can cost $0 and still hide a project's
  tokens (dsh has unpriced rows).
- `floor` is false only when `coverage.machines` is true and `unresolved_rows` is 0. Otherwise every
  row's value, tokens and requests are floors: say "at least". Anyone who uses Antigravity, omp or dsh
  has `floor: true` every week.
- Delivery 1 has no week-over-week field for projects, so a floor cannot be compared by mistake. A later
  delivery that adds one needs `floor: false` at both ends.

**Merged PRs.** `git()` returns each PR's key with its merge time. A PR counts for the project its key
names, whether or not that project had usage this week.

- Keys today: GitHub `github.com/owner/name#n` (`src/collect.mjs:266`) and GitLab host plus full
  reference (`:342`) name a project. Gitea keys and usagemeter-only keys carry no host (`:297`, `:201`).
- A key with no host is never matched to a project by its name. It is counted in
  `prs_without_project`, reason `no_host_in_key`. Giving Gitea keys their host moves to delivery 2.
- Which PRs are counted does not change: live forge queries ask for PRs the logged-in accounts
  authored; rows kept from earlier runs and usagemeter rows count as stored.
- Two checks, kept apart. `coverage.prs_sources` is `git.coverage.prs`: every source answered.
  `coverage.prs_attributed` is true when `prs_without_project.merged_prs` is 0.
- Per-PR costs follow the single rule in section 3: a machine floor takes precedence and
  withholds the ratio as null. With machines complete, when either PR check is false, `merged_prs` is "at least" and `usd_per_merged_pr` is labelled "partial PR
  count", never a lower bound: the rule the skill already has for `git.usd_per_merged_pr`. When both
  are true and `floor` is true, `usd_per_merged_pr` is "at least".
- With git off (`--git no`, `worthit weekly`), `merged_prs`, `usd_per_merged_pr`, both PR checks and
  `prs_without_project` are `null`.

**What delivery 1 says about models.** Each model's share of the API value inside each project. It does
not count PRs per model: a PR belongs to a project here. That is delivery 2.

**Not in delivery 1:** a dashboard block, a card, a history table, `worthit days --by project`, ssh alias
expansion, a host for Gitea keys.

Alternative: a block in the dashboard (it would put repository names into the PNG and the `.md` that
people share, and a drawing change needs more review than a read command).

### 3. Delivery 2: which model delivered

Delivery 2 (#119) uses source `opened`, always displayed as an **opened date proxy**. It is
an observed branch-cost association, never authorship, model quality or a forge review/SHIP verdict.
Dates are committer dates, not push times; rebased history cannot establish first-pass truth.

**Attribution.** Scan buckets and `project_activity` carry `branch` (string or null) and
`cost_complete` (boolean on priced core rows; scan buckets carry branch). Claude records supply their per-record branch; Codex supplies its session
branch (later branch switches cannot be detected). Old buckets have no branch and remain unlinked.
No git folder stays in delivery 1's no-repository bucket: never infer a project from a basename.
`omp` and `dsh-tui` meter rows have no branch and remain explicitly unlinked in coverage.
Implementation usage links by canonical project and exact head branch through the merge hour
(inclusive); only rows in the retained scan window are available. Reused implementation branch names
among observed items in that window are ambiguous even when merge dates differ.

Local review branches must match `review/pr-<number>-<sha8>` with eight hexadecimal SHA characters.
The number is resolved on the same canonical repository and forge, and the prefix must uniquely
match a commit in that item's complete commit history. Missing, ambiguous or unverifiable identities
stay unlinked. Review USD joins delivery cost but never lead selection, even for review-only items.

The lead is the unique model with largest positive linked implementation API-list value, combining
tools with the same model id. Ties, absent implementation, unpriced implementation, incomplete
machine/link evidence yield no lead. A usage-only project floor retains the observed linked implementation lead; unlinked omp/dsh/Antigravity rows remain explicitly covered. `lead_model`, `lead_api_value_usd` and
`lead_share_pct` retain the winning model's own implementation value/share separately from cost.

**One per-PR cost floor rule.** A machine floor withholds (null) every per-PR cost across
`git.usd_per_merged_pr`, `projects.rows[].usd_per_merged_pr` and every
`projects.delivery.{models,project_models,daily}[].usd_per_pr_led`. A usage-only floor
(unresolved omp/dsh/Antigravity or other project rows) retains linked leads, `prs_led` and
numeric costs as "at least", with `projects.floor` and delivery `cost_floor: true` and named
reasons. A floor at either comparison endpoint withholds cost comparisons, including
`git.usd_per_pr_change_pct`; independent physical PR/commit counts remain available. Under a machine floor, raw
linked implementation/review USD remains visible as a floor while per-PR ratios are withheld. No floor
is compared. Terminal USD uses two decimal places and percentages whole numbers; JSON
keeps its existing precision.

**Saved output.** `projects.delivery` is null with git off; otherwise it contains:

- `source: "opened"`, `label: "opened date proxy"`, `window: {from, to}` (ISO instants),
  `coverage`, `deliveries`, `models`, `project_models`, and `daily`.
- `deliveries`: `{root, members, project, completed_day, lead_model, lead_api_value_usd,
  lead_share_pct, implementation_api_value_usd, review_api_value_usd, api_value_usd,
  cost_floor, cost_reasons, link_reasons, provenance, first_pass: {state, source, reason, complete}}`.
  `members` retains every observed chain item's canonical key. Completion uses the first merged
  member's UTC day, even if its root was closed unmerged. Only canonical deliveries whose completion
  instant is in the current rolling seven days appear; older observed chains can therefore remove
  an in-window physical superseder from delivery counts. Raw `git.merged_prs`, project `merged_prs`
  and their delivery 1 ratios remain physical counts and are never deduplicated.
- `models`: metric rows by model; `project_models`: by project/model; `daily`: by UTC completion
  day/project/model, distinct from usage day. Every metric row has `prs_led`, `api_value_usd`,
  `usd_per_pr_led`, `cost_floor`, `first_pass`, `not_first_pass`, `unknown`, `not_measured`,
  `eligible`, `first_pass_pct`, `first_pass_reason`. USD retains pricing precision. Cost is all linked
  implementation plus review USD of canonical deliveries led by this model / `prs_led`, null at zero.
  `cost_floor` is a boolean with `cost_reasons` naming incomplete machine/usage/link/window evidence; it never implies an exact total.
  Rates exclude unknown/not-measured, require five known eligible deliveries, and otherwise show
  counts, null percentage and `insufficient_sample`.
- `coverage` is present globally and on every model/project-model/day metric row. It contains
  raw `merged_prs`, `canonical_deliveries`, `linked_prs`, `linked_deliveries`, `ambiguous_prs`,
  `signal_known_prs`, `eligible`, `unknown`, `not_measured`, `superseded_prs`, `unresolved_chains`,
  `implementation` and `review` usage counters `{rows, output_tokens, api_value_usd}`, and
  `unlinked` counters of the same shape plus `by_reason`. Reasons explicitly include
  `omp_no_branch`, `dsh_tui_no_branch`, `missing_branch`, `ambiguous_branch` and `review_unverified`.
  `forges` records each host's answered/reason and metadata/commits/parents/diffs
  `{complete, reasons}`. Scope counters retain physical PRs separately from canonical deliveries;
  a `model: null` bucket retains every no-lead delivery (including daily rows) and unlinked usage
  so missing model attribution remains visible. Unlinked usage is scoped by its observed model,
  project if available, and UTC usage day; delivery counters use UTC completion day. Global and
  project/day null-model buckets include unassignable physical PRs. No sum of model physical counts
  is implied when a delivery has multiple member models; canonical counts remain additive.
  Observation is limited to authored merged items observed in the last 14 days plus recursively
  resolved predecessors; unseen future superseders and unseen successors outside that window cannot
  be inferred. `cost_floor` is boolean and its separate `cost_reasons` list is always preserved.

Lookup: `worthit projects` / `worthit get projects.delivery.daily` reads the last saved result with
no network. No persistent project-history table yet: RFC 0005 builds `day_project`; this RFC's
delivery 3 keeps `days --by project` and week-over-week history.
Repository identifiers remain excluded from all agent and share paths, including this new block.

**Four first-pass states.** `first_try`, `not_first_try`, `unknown`, `not_measured`.
The LOCAL existing `WORTHIT_HOME/settings.json` key `projects.first_pass_exclude` is an array of
canonical repository ids (example `github.com/acme/app-api`). It takes precedence over automatic
classification and chains. It is private configuration, never tracked. Missing data, timestamps,
ancestry or complete file lists mean unknown, not false. A later material implementation committer
timestamp strictly after opening means not-first-try; no later material change on complete lineage
means first-try as a date proxy only. Known rewritten/rebased or unprovable merge history is unknown.

Traverse implementation first parents, stopping at a proven ancestor of the forge's target snapshot
before merge. For GitHub ordinary two-parent merge results, parent 1 is that target snapshot only
when parent 2 equals the PR head; squash/rebase/other shapes cannot supply that proof. GitLab also validates the normal merge result second parent against the MR head and uses its first parent as the pre-merge target snapshot; historical `diff_refs` must be available. A two-parent integration into
the implementation is harmless only when its first parent continues implementation and its second
parent is proven in that pre-merge base ancestry; ignore commits solely in that second-parent
history. Never use current target membership or subjects as proof. Other merge roles are unknown.
Compare files with the relevant first parent, considering BOTH old/new paths for renames/deletions.
Only `docs/` paths, root `README`, `README.md`, `LICENSE`, `LICENSE.md`, `CHANGELOG.md`, and
extensions `.md`, `.mdx`, `.rst`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`
are nonmaterial; everything else and mixed changes are material. Empty complete diffs are harmless.
A docs prefix cannot override code. Missing patches for material files need not hide materiality,
but missing/truncated file inventories cannot prove absence. GitHub PR commit cap 250, commit files
cap 3000 (compare file lists capped at 300 are never used for changed-file proof), and GitLab collapsed/too_large/overflow/compare timeout are explicit
unknown reasons, never short-page proof of completeness. GitLab commit `/diff` can silently stop at
an instance file cap: a short diff page alone is NOT proof. Changed files there are obtained by
comparing complete paginated recursive repository-tree inventories of the relevant parent and
commit (path, mode, type and object id, including deletions/old paths), rather than trusting `/diff`.
Any incomplete tree inventory is unknown. Bounded request limits also yield unknown.

**Supersede chains.** An entire title `Supersedes #41` on GitHub or `Supersedes !41` on GitLab
(case insensitive, surrounding whitespace allowed) references a predecessor in the same repository.
Resolve recursively, including closed unmerged roots; a chain is one logical delivery rooted at the
original. A valid observed superseder means not-first-try; opt-out still wins. Combine each member's
linked costs once; the earliest merged member supplies completion day. Later merged members update
this delivery, never add another. Cycles, self-links, forks/multiple successors, wrong typed or
cross-repository references and unavailable targets stay unresolved, have unknown signal and no
lead; one unresolved connected component occupies at most one canonical delivery to avoid inflation.
Preserve members and reasons. No claim about unobserved superseders is possible.

**Forge scope.** GitHub via `gh`, GitLab including self-managed via `glab` are included. An older or
unsupported host/response yields unknown with reason. Gitea stays unknown/unlinked; its new physical
keys use the hostname from its item URL, never the synthetic `gitea/` prefix. An old hostless
`gitea/path#n` row overlapping a qualified path/number/exact merge time is retained in `pr_kind`
but excluded from that run's physical counts: the `gitea legacy identities` source is incomplete,
and the audit names ambiguous legacy evidence, even with one observed host. No host is inferred.
Unmatched hostless history/counts remain intact in delivery 1's `no_host_in_key`. No account/auth settings change.

Tree inventory requests are read-only GitLab `GET /projects/:id/repository/tree?ref=:sha&recursive=true`; every page is audited.

API contracts: [GitHub PRs](https://docs.github.com/en/rest/pulls/pulls),
[GitHub commits](https://docs.github.com/en/rest/commits/commits),
[GitLab MRs](https://docs.gitlab.com/api/merge_requests/),
[GitLab commits](https://docs.gitlab.com/api/commits/).

### 4. What leaves the machine

- **Delivery 1: no new network request.** Two things change and are named in the README and the audit
  log. Each machine's scan reads the `.git` file, `commondir` and `config` of the folders its sessions
  ran in (audit `read` lines). The ssh scan now brings back repository ids with the usage, to the
  person's own machine.
- **Delivery 2: read-only per-item forge metadata.** GitHub through `gh`: `repos/:owner/:repo/pulls/:number`, `/commits`, `repos/:owner/:repo/commits/:sha` (parents, committer time, paginated changed files), `repos/:owner/:repo/compare/:sha...:base` (ancestry). GitLab including self-managed through `glab`: `projects/:id/merge_requests/:iid`, `/commits`, `projects/:id/repository/commits/:sha`, `/repository/compare`, and paginated `/repository/tree?ref=:sha&recursive=true` inventories at parent/commit refs, including file mode. Supersede predecessors and base ancestry add bounded requests of those same families. Every request/page is an audit `net` line. Immutable requests are cached within a run. Limits: 1200 requests, 30 pages per inventory, 300 items, 40 predecessor depth, 250 lineage/base-graph nodes; hitting a limit is explicit unknown. See the [GitLab repositories API](https://docs.gitlab.com/api/repositories/). `--git no` disables all these requests. No review-event, separate raw-source, publication or forge-mutation requests. GitHub commit JSON can return file patch text; it is ignored and never persisted in saved results.

### 5. Privacy

- Repository names are the person's own data. They appear in local output only: `worthit projects`,
  `--json`, `last.json`, `worthit get projects` and the audit log.
- They are not drawn into the dashboard, the PNG, the `.md` or any share card.
- Repository ids, implementation/review branches, commit ids and known short PR/MR references (`#N`/`!N`) do not reach the AI agent (question 3) by any path: the summary prompt, the question bar's
  lookups, or a custom share topic. A fixture covers each path.
- A token inside a remote URL, read from `config` or from a Codex log, is removed on the machine that
  read it, before anything is cached, stored or sent back.
- `--demo`, the fixtures, the README and every public image use synthetic projects (`app-api`,
  `web-client`).

### Public contract touched

Delivery 1, all in one PR with `skills/worthit/SKILL.md`, `worthit schema` and the README:

- the `projects` block and the `worthit projects` command;
- `project` and `project_why` in the scan's buckets, and `project_activity` in the core's report;
- the `folder_project` table in each machine's `scan-cache.db`. No new table in `worthit.db`.

### Tests

Fixture cases for delivery 1:
- the rows plus `no_repository` add up to `totals` (tokens and requests exactly, dollars within the
  rounding), and the rows' `merged_prs` plus `prs_without_project` to `git.merged_prs`;
- a linked worktree (gitfile, `commondir`), a subfolder, an ssh URL and an https URL with a token give
  one id, and the token is in no output; two ports give two ids; an alias host is
  `origin_not_supported`;
- a folder that is gone but remembered is attributed; one that is not is `folder_gone`;
- `floor` is true for each of: an unresolved row worth $0, a Claude Code record without `cwd`, a machine
  missing, a machine left out, a retained unit inside the week, a week that starts before a retirement;
- a PR key with no host lands in `prs_without_project` and sets `prs_attributed` false; git off gives
  `null` PR fields.

## Deliveries

| # | Delivery | State |
|---|---|---|
| 1 | One PR: `project` in the scan, the remembered map, `project_activity`, the `projects` block, `worthit projects`, schema, skill, README, the fixture cases | shipped: #117 (closes #115) |
| 2 | The PR-to-model link, `prs_led`, the first-pass signal and its coverage; a host for Gitea PR keys | shipped: #127 (closes #119, #123) |
| 3 | Project history: `worthit days --by project`, week-over-week; the daily `day_project` table is built once in RFC 0005 | not scheduled |

## Owner decisions, 2026-11-16

Accepted answers, exactly: 1 `command`; 2 `enough`; 3 `no`; 4 `bucket`;
5 `opened`; 7 `lead`. Question 6 is not required: delivery 2 uses the accepted opened date proxy, never review verdicts.
Deliveries 1 (#117, closing #115) and 2 (#127, closing #119 and #123) have shipped.
The status remains In delivery: project history is not scheduled, and RFC 0005 owns the daily table.

## Questions (owner answers recorded above)

Answers 1, 3 and 4 settled delivery 1. Question 2 blocks nothing. Questions 5 to 7 concerned
delivery 2; question 6 remains unanswered and is not required by the accepted opened-date proxy.

1. **Where is it shown?** `command`: `worthit projects` (recommended). `dashboard`: a block in the
   dashboard.
2. **Is project and model enough for a squad?** worthit sees repositories and models, not squads.
   `enough`: nothing more (recommended for 23 Nov). `labels`: squads get their own label. Labels would
   be a later delivery either way; delivery 1 is the same for both answers.
3. **Repository names to the AI agent?** `no` (recommended) or `yes`.
4. **A repository with no remote?** `bucket`: it stays in "no repository" as `no_origin`
   (recommended). `row`: its own row, named by its folder on that machine.
5. **The first-pass source.** `opened`: the date proxy, always shown as a proxy (recommended, because
   the forge has no reviews today). `review`: the forge's review event. **Answer: `opened`.**
6. **Will squads post their verdict on the forge**, as a PR review on the head commit? `yes` or `no`.
7. **Credit for a PR.** `lead`: one lead model per PR (recommended). `shares`: a share per model.
