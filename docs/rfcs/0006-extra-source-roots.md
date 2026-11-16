# RFC 0006: Extra source roots

| Field | Value |
|---|---|
| Status | Queued |
| Created | 2026-11-16 |
| Issue | #125 |
| Depends on | RFC 0002 snapshot/proof rules; RFC 0004 project resolution; RFC 0005 basis at both ends |

## Proposal in short

Declare read-only usage roots per local machine or saved SSH alias in the private worthit store.
Bind exact vendor homes within a root; scan only documented usage patterns, never sibling secrets.
Count canonical native and meter sources once, and report every root's coverage with hashed identities.
Keep unknown account/model usage, disclose incomplete plan attribution, and expose only derived metadata.
Freeze retired roots like machines; changed roots, mappings or attribution start a new comparable series.
Ship synthetic fixtures and complete coverage/basis guards with each independently usable delivery.

## Problem and evidence

An agent can run under a separate user in a container with no shell or SSH. A read-only volume on its
host can expose its usage while the host scanner's normal home discovery misses it. Reading through
the host's existing alias needs no login inside the container. Issue #125 and all five comments define
the source and privacy requirements; its proposal and questions are design inputs, not a delivery
checklist. This RFC proposes contracts, and implements none of them.

The issue's synthetic proof used the unchanged v0.45.0 extractor: recognized Claude/Codex links exposed
nested usage, and another link to the same native realpath did not add usage. One meter link exposed
meter rows. Actual agent-generated shapes, SSH reads, account attribution, cross-alias deduplication
and several meter links were not established. No link rollout is required. The design below requires
new fixtures; it does not claim those unproven cases work today.

## 1. Selection and private settings

Recommend `worthit hosts roots` commands, with `local` reserved for this machine. An SSH machine must
already be a saved alias; these commands never create a login, connect, inspect a mount or scan. Paths
are absolute on the selected machine, not on the collector. A root is a directory containing explicitly
bound vendor homes; it need not be an entire user home.

```text
worthit hosts roots <machine>
worthit hosts roots add <machine> --file <spec.json>
worthit hosts roots update <machine> <root-id> --file <spec.json>
worthit hosts roots select <machine> <root-id> on|off
worthit hosts roots boundary <machine> <root-id> --file <proof.json>
worthit hosts roots retire <machine> <root-id> [--since YYYY-MM-DD]
worthit hosts roots unretire <machine> <root-id>
```

`add` accepts the root spec below, assigns a stable private registration key, and selects it. `update`
replaces a spec atomically, preserving its registration and old revisions, saved units and coverage;
changing `path` is a replacement population, even if counts are unchanged. `select off` leaves the root
out, not retired. `unretire` restores the frozen revision and selects it for the next run. Mutations
return the saved root record without paths; listing returns all records for that machine. In a terminal
they show ids, selection, lifecycle and last coverage; otherwise JSON. Exit 0 means success, 2 invalid
input or conflicting state, 1 a store I/O failure. No command prints raw paths or spec contents in errors.

No delete command is proposed. Manual deletion of a setting leaves a tombstone and retained data on the
next scan: it is left out until explicitly restored or retired. Absence cannot declare retirement.
`boundary` records the operator check described in section 2; it cannot make permissions more liberal
and refuses retired roots. A preflight-only failed scan can establish the reader hash without admitting
content; listing shows that hash so the operator can bind the proof to it.
`update` cannot change a retired spec; unretire first. Invalid settings abort before scanning or writing
run results, without replacing a valid older setting with an empty set.

New local `WORTHIT_HOME/source-roots.json` is a versioned document:

```json
{
  "version": 1,
  "machines": {
    "local": {
      "roots": [{
        "key": "generated-private-registration-key",
        "selected": true,
        "revision": 1,
        "spec": {
          "path": "/mnt/example-usage",
          "sources": [
            {"kind": "claude", "home": "agents/agent-a/.claude", "account": "derived/agent-a-account.json"},
            {"kind": "codex", "home": "agents/agent-b/.codex"},
            {"kind": "meter", "home": "meter"},
            {"kind": "antigravity", "home": ".gemini/antigravity", "model": "derived/model.json"}
          ],
          "mappings": [{"from": "/workspace/example", "to": "repositories/example"}]
        },
        "retired_at": null,
        "last_scan_at": null,
        "since": null
      }]
    }
  }
}
```

Only `spec` is supplied to `--file`. `sources` is a nonempty array; `kind` is exactly `claude`, `codex`,
`meter` or `antigravity`. `home` is an explicit relative directory (`.` allowed). `account` is optional
and Claude-only; `model` is optional and Antigravity-only. Both name exact derived files relative to the
root. `mappings` defaults to `[]`; its fields are defined in section 5. Unknown keys, duplicate bindings,
control characters, traversal (`..`), shell expansions, URLs and nonabsolute root paths are rejected.
Paths travel as data, never interpolated shell code. The parser must reject duplicate JSON keys too.

`key` is generated once, `revision` increases on spec/selection/lifecycle changes, `selected` is boolean,
and the three time fields are ISO UTC instants or null (`since` holds an optional UTC date assertion).
Private revisions/tombstones are kept in the same document as `revisions`, an array of previous root
records. Old stores without the file have no declared extra roots; this says nothing about old scan
coverage. A missing salt or malformed file in a previously initialized store is an error, not a new
population. Create/update atomically with owner-only permissions. Raw paths and account ids never go
in the repository, demo, shared output or a diagnostic. No environment variable discovery is added.

Every selected machine scans its selected active roots as well as its existing default sources.
`--hosts all` includes every active root on every active saved machine. Existing host selection also
selects the roots beneath it; there is no run-time root wildcard or root exclusion flag. An unselected
root remains population evidence even before its first successful scan. A machine retirement supersedes
its root selections while preserving them for machine unretirement.

## 2. The read boundary

These prohibitions apply to **extra-root reads**, including roots overlapping defaults. They do not
silently change the shipped default-home reader's attribution/fallback behavior. Extra-root discovery
must not feed a whole home into that reader and trigger its raw-config fallback. If a default candidate
is also inside a declared root, the stricter extra-root policy wins for that physical candidate. A
separate proposal is needed to change nonoverlapping default-home behavior.

| Binding | Permitted usage paths relative to `home` |
|---|---|
| Claude | `projects/**/*.jsonl`, `projects/**/*.jsonl.zst`, `session-archive/**/*.jsonl`, `session-archive/**/*.jsonl.zst` |
| Codex | `sessions/**/*.jsonl`, `archived_sessions/**/*.jsonl` |
| Meter | exactly `meter.db` and `claude-limits.jsonl` |
| Antigravity | `log/*.log`, `*.log`, `conversations/*.db`, `brain/*/.system_generated/logs/transcript.jsonl` and `transcript_full.jsonl` |

`**` recurses only below those named usage directories; `*` matches one path component. Antigravity's
two transcript names follow the existing preference for `transcript_full.jsonl` over `transcript.jsonl`
in one conversation, not a double count. Bind `.gemini/antigravity` and `.gemini/antigravity-cli`
separately when both run. No arbitrary `antigravity*` subtree, generic JSON scan or automatic ACP home
discovery is allowed. A nested per-agent home works by naming it explicitly, as in section 1. New vendor
shapes require a documented pattern/rule change and fixture, not a broader recursive scan.

Never open raw `.claude.json`, Gemini/Antigravity `settings.json`, `auth.json` or `.credentials.json`:
not for attribution, model fallback, cache warming, recursive discovery or diagnostics. No credentials,
MCP settings, env blocks or other raw config are mounted readable to the scanner identity. Filename
allowlisting alone is insufficient: reject a usage/derived/metadata symlink or hardlink to a prohibited
file. Require separately exposed usage and metadata mounts/ACLs, not a broadly readable home. Root
registration records intent; it cannot confer OS permissions or prove isolation by itself.

An operator verifies, under the actual OS reader identity locally and through the existing SSH alias:

- Positive reads of synthetic usage fixtures and, when enabled, derived files and git metadata.
- Negative **OS permission** checks for existing raw `.claude.json`, all relevant raw `settings.json`,
  `auth.json` and `.credentials.json`, including aliases/links. An isolated permission fixture uses
  harmless sentinel files with the same ACL/mount boundary. An actual deployment check obtains a
  denial without reading content; a successful open is a failed boundary, immediately closed unread.
- Missing files are `not_present`, never proof of denied readability. If no existing prohibited file
  can be checked, boundary verification is `unverified`; fix/prove the boundary before admitting the
  root. The checker reports names by class, denial/result and hashed identity, never content or paths.

The scanner does not open raw config even to test permission. The separate operator check establishes
denial. `boundary --file` takes a strict object `{status, checked_at, revision, reader_id, proof_sha256}`:
`status` is `verified`, `unverified` or `failed`, `checked_at` an ISO UTC instant, `revision` the current
spec revision, `reader_id` the salted physical machine/OS identity hash, and `proof_sha256` the 64-hex
SHA-256 of an owner-kept private permission receipt. No raw identity/path/content is accepted here.
It is stored as the root record's `boundary` object, with null meaning unverified on add. It neither
advances the revision nor asserts usage completeness. Changed spec/reader identity invalidates it;
deployment permission/mount changes require a new check and record. It is an operator attestation,
not a claim that a receipt hash enforces OS isolation. Record only its status with run coverage;
an unverified/failed boundary makes the
root unreadable (`boundary_unverified` / `boundary_failed`) and skips content. Deployment permission
changes require renewed checks; a historical check is not a permanent security assertion. No permission
probe, mount change or credential migration is performed by this RFC.

Open SQLite read-only, including permitted read-only WAL/SHM sidecars for the named database only;
never checkpoint, create journals, chmod, repair, write caches or install anything under a source root.
If a consistent SQLite snapshot cannot be read without a write, report partial, not empty. Caches are
optional and collector-store-local, partitioned by physical machine, root revision and mapping/reader
rules; cache failure cannot authorize a source write or a wider read.

## 3. Optional account and model files

**Explicit owner decision:** recommend the workspace producer writes a derived account file exposed
read-only, containing only this allowlist:

```json
{"oauthAccount":{"accountUuid":"example-account","organizationUuid":"example-organization","plan":"example-plan","seat":"example-seat","tiers":["example-tier"]}}
```

The outer object has exactly `oauthAccount`; its object permits only `accountUuid`, `organizationUuid`,
`plan`, `seat`, `tiers`. Present scalar fields must be nonempty bounded strings, `tiers` an array of such
strings. `accountUuid` is required; omitted optional fields are unknown, never inferred. Maximum file
size is 16 KiB and maximum string length 256 characters. Reject extra keys, duplicate keys, arrays in
place of objects, malformed/oversize content and unsafe text. These are identifiers/labels only, no
email, login, env, endpoint or credential. Hash account/organization ids before they leave the reader;
never retain the raw file. worthit does not produce it by reading raw config. The workspace's separate
trusted producer is outside the scanner identity and this delivery's implementation scope.

Alternative: no derived account file; usage remains unattributed. Claude usage without a valid binding
does not inherit the host's login or a neighboring agent's plan. Codex uses the session's own account
id; absent identity stays unattributed, never `auth.json` fallback for an extra root. A derived current
Claude account does not establish historical ownership: apply it only where the source establishes
that account for the usage interval; absent historical evidence keep those rows unattributed. A plan
or seat cannot be inferred from an account id alone.

**Separate explicit decision:** recommend a derived model file containing exactly
`{"model":"example-model"}`. It is optional, at most 16 KiB, a nonempty string at most 256 characters;
the same strict parsing/extra-key rules apply. It contains **model only**, no copied settings object.
Prefer an explicit per-record model from the allowed logs/database; a current derived label cannot
override it or establish a past model switch. Where no reliable model applies, report `model: null`
(display "model unknown"). Alternative: no derived model file, so those rows keep model unknown.

For each optional file report `disabled` (no binding), `read`, `missing` (ENOENT), `unreadable` (access or
I/O failure) or `malformed` (schema/content failure). These states concern attribution, **not usage
completeness**: a root whose usage read completely stays `read` when optional metadata fails. Never
fall back to raw config. A metadata failure cannot drop the usage or attach it to another plan/model.

Unattributed usage still contributes tokens, requests and all API value supported by its known model.
Model-unknown usage still contributes tokens/requests and any independently supported API value (for
example an explicitly reported cost); never price it by guessing a model. Unknown-price rows remain
visible with unpriced counters and RFC 0005 `outside_table` treatment. Every affected plan view says
"per-plan numbers incomplete: unattributed usage included in totals", with unattributed row/token/value
counters; zero-dollar rows also trigger this. Do not claim that known plans exhaust the total. Plan
proof/comparisons are withheld when missing attribution could affect them; a working plan meter does
not prove attribution. Optional-file failure alone does not imply missing usage for aggregate totals.

## 4. Canonical identity, overlap and saved units

Resolve canonical paths on the machine doing the read. Deduplicate **files**, not just root directory
strings, across defaults, overlapping roots, nested bindings and symlinks before parsing. Follow links
only to a canonical target within explicitly authorized usage/derived/metadata subtrees on that machine;
links cannot widen permission scope. Detect loops and retargeting, recheck after open, and fail closed
on an identity race. Outside targets need an explicit binding before reading. Canonical file identity
is realpath plus filesystem device/inode where available; hardlinks share identity too. If identity
cannot be established, withhold completeness rather than assume two paths are independent.

Apply the same rule to `meter.db` and `claude-limits.jsonl`; read one physical database/file once, then
use the existing row/event identity rules. Do not sum the same event from native logs and meter: keep
the shipped provider arbitration (native Claude/Codex usage, supported meter-only providers, plan meter
readings separately). Distinct meter databases are not deduplicated merely because row ids match; a
copied database without provenance is not proven independent either and blocks complete coverage
(`identity_unknown`). Multiple meter aliases are a required new fixture, not a compatibility claim
inherited from the one-link proof.

Every alias/default/root that refers to a read file gets coverage credit, but its usage contributes
once. Record the owning canonical source id and the aliases it covers. Conflicting optional account
bindings make attribution unknown, not two usages. A changed symlink target changes the basis even
when its registration/path is unchanged. Cross-machine equal path strings never imply equal files.

Within one physical machine, collect the union of roots requested through its aliases and merge scans
under the existing reported-host duplicate identity, not alias names. A default-root overlap cannot
duplicate usage, nor can a retired snapshot answering under another alias (RFC 0002). Conflicting alias
specs remain separately reported, with one physical contribution and conservative coverage. The known
limit is the shipped reported-host identity: hostname collisions, renamed/reinstalled hosts and copied
logs across genuinely distinct machines are not solved here. When identity is ambiguous, report
`identity_unknown`, keep saved evidence, and claim no complete/comparable population.

Do not sum saved and fresh versions of the same unit. Preserve the current whole-unit winner rule:
machine + UTC day + provider (including its current model-day handling), higher API value then tokens,
full ties fresh, and replacement only for fully scanned units. Root provenance accompanies every unit;
until finer-grained source units have their own approved merge contract, one failed required root
prevents replacement of that machine/day/provider unit. Keep the older winner and successful fresh
evidence without adding them together. Incomplete history days may rise, never fall. A wholly scanned
day may replace only under the existing history contract; no migration rewrites immutable judged days
or weekly checkpoints. Unknown legacy root provenance is retained as unknown, not retrofitted.

## 5. Container paths and project metadata

RFC 0004 still names projects by canonical origin, keeps unresolved usage in `no_repository`, and
excludes repository ids from agent/share outputs. A mapping's `from` is an absolute container POSIX
directory prefix; `to` is a relative mounted directory below the declared root, separately authorized
for metadata reads. Match complete path components, longest prefix first; duplicate/ambiguous prefixes
are invalid. Normalize lexically without traversal before mapping, then canonicalize the target and
require containment. Do not try the host's coincidentally equal container path when mapping fails.

Starting at the mapped cwd, walk upward only to its authorized metadata boundary. Read only `.git`
(directory or `gitdir:` file), `commondir`, and the shared git directory's `config`, as RFC 0004. Resolve
relative pointers from their containing directories. Absolute **container** pointers are mapped by the
same table, never interpreted directly as host paths; relative pointers must remain within authorized
metadata boundaries. Cross-boundary worktree/common dirs need their own explicit mapping. No git
process, network, fetch, hooks, includes or `insteadOf` expansion. Failed mappings or unreadable metadata
leave the existing `project: null`, `project_why: "origin_not_supported"` (or `no_folder_read` if no cwd)
and a separate mapping status; they do not fail usage reads.

Reject an origin URL with embedded credentials/tokens **before cache or output**, including Codex's
logged repository URL. Reject HTTP(S) userinfo, SSH passwords/nonstandard credential userinfo, token
query/fragment parameters and malformed URL encodings; a normal `git@host:path` transport user is not
a token. Do not echo the refused value. RFC 0004's otherwise supported origin cleaning still applies,
but its example that cleans a token-bearing URL is not permission to accept one for extra roots.
No raw URL is cached, transmitted or diagnosed; cache only the sanitized project id after validation.
Key any collector mapping cache by root identity/revision, mapping hash and RFC 0004 rule version;
mapping changes invalidate it, never relabel historical saved units. Missing evidence stays unresolved.

## 6. Coverage, audit and public fields

Keep `machines_missing` and `machines_left_out` for **machines**. Add `source_roots`, an array in scan
JSON, run `--json`/`last.json`, `worthit weekly` (including `compared_with`), saved scans and relevant
period/plan coverage snapshots. `worthit get source_roots`, and `worthit projects`' saved coverage, read
these with no scan/network. Before roots are supported, absent fields mean unknown legacy coverage;
new runs with no extra roots explicitly store `[]`.

Each entry has these fields (all lists present, nullable fields explicit):

| Field | Contract |
|---|---|
| `id`, `machine_id`, `revision` | salted root registration hash, physical-machine hash (null until established), positive settings revision |
| `reader_id` | salted physical machine/effective OS reader identity hash, null until preflight establishes it |
| `canonical_id` | salted canonical-root-path hash, null if unresolved |
| `selected`, `lifecycle` | boolean; `active` or `retired`; removed settings retain an unselected active tombstone |
| `status` | `read`, `missing`, `unreadable`, `partial`, `left_out`, `retired` or `saved` |
| `reasons` | sorted unique codes defined below, never exception text |
| `attempted_at`, `last_scan_at`, `retired_at` | ISO UTC instants or null |
| `window` | `{from,to,complete}`: UTC scan interval and boolean; a partial boundary day is not complete |
| `boundary` | `verified`, `unverified` or `failed` from section 2 |
| `sources` | per binding `{id,kind,status,reasons,canonical_ids,account,model,mapping}`; ids are salted hashes, canonical_ids are deduplicated file hashes |
| `account`, `model` in each source | `{status,rows_unknown}` using section 3 states; nonapplicable metadata is `disabled`; counts are nonnegative integers |
| `mapping` in each source | `{status,reasons}`: `disabled`, `read`, `missing`, `unreadable`, `partial`; status describes project resolution, not usage |
| `attribution` | `{account_complete,model_complete,unattributed_rows,unattributed_output_tokens,unattributed_api_value_usd,model_unknown_rows,unpriced_rows}`; booleans then nonnegative counters/value for the requested window |
| `retained` | array of `{day,provider,model,root_ids,why}` describing saved winner units; model may be null; UTC date and hashed root ids |

Per-binding usage status is `read`, `missing`, `unreadable`, `partial`, `left_out`, `retired` or `saved`.
`read` means every declared usage binding was enumerated/parsed through the requested window; an
existing, readable, genuinely empty usage directory can be read with zero rows. Missing optional
vendor subdirectories on a first scan are empty only when the binding home exists and enumeration
succeeds; a missing binding home or an expected file/subtree seen on an earlier scan is `missing`.
For meter, both named inputs absent is `missing`; one absent means `partial`, not a claim of a complete
plan meter. The failure exists on the **first scan too**, even with no saved fallback. Malformed usage
records or truncated reads are `partial`, never silently skipped as complete. One successful source
and one failed source make the root `partial`; no readable required content makes it `missing` or
`unreadable` as appropriate. A root not attempted due to transport failure is `unreadable`.

`left_out` means active but unselected, even without saved rows; `retired` means frozen; `saved` means
only retained data was available, never a live answer. `reasons` uses `not_found`, `permission_denied`,
`io_error`, `parse_error`, `partial_window`, `transport_failed`, `not_selected`, `removed_setting`,
`retained_unit`, `before_retirement`, `identity_unknown`, `overlap`, `link_outside`, `link_changed`,
`boundary_unverified`, `boundary_failed`, `metadata_missing`, `metadata_unreadable`, `metadata_malformed`,
`mapping_missing`, `mapping_unreadable`, `mapping_outside`, `token_url_refused`, `legacy_coverage_unknown`.
`overlap` is informational after successful dedup; metadata/mapping reasons alone do not change usage
status. `sources[].id` hashes the binding, never a raw relative home. No error includes file contents.

An unanswered required root is a **machine usage floor**, not an isolated dollar amount subtracted
from an otherwise measured machine: its unknown contribution cannot be bounded or assigned to plans.
Keep successful usage, and keep retained provenance. All plan proof, usage aggregates, per-project
coverage, per-PR costs, period admission and comparison checks consume this root completeness in
addition to RFCs 0002/0004/0005's existing checks. Do not label sums of logs measured. Metadata-only
unknowns instead affect the relevant plan/model/project cut; independent aggregate/PR counts survive.

Audit every attempted root, even empty, failed, deduplicated or first scan, with `root_id`, `machine_id`,
`attempted_at`, `status`, `reasons` and `revision`; preflight transport failures get an attempt outcome.
Also record unattempted roots as `left_out`/`retired`/`saved` with `attempted_at: null`. Existing audit
destination/format remains; this adds a `source_root` event payload with those fields. Sanitize errors,
progress and trace output before emission. No raw shared paths, cwd, origin URL or account ids leave
the reader. These fields are available locally but root paths never enter prompts, cards or reports.

## 7. Retirement, basis at both ends, and offline reads

`retire` requires a valid saved root scan and freezes it at
`WORTHIT_HOME/run-keep/roots/retired/<root-id>.json`; active root provenance/saved units live at
`run-keep/roots/<root-id>.json`. Each is a version-1 scan envelope containing `source_roots`, its hashed
identity/basis, `generated_at`, `since` and the existing usage collections. They contain no raw paths.
No run writes frozen snapshots. Refuse retirement without a saved scan; exclusion still reports a floor.
`--since` is the RFC 0002 UTC date assertion, not before `last_scan_at` or in the future; absent it,
retirement is now. Always disclose "retired since <date>, as stated by you" when relying on it.

Retired snapshots merge with a live matching physical source by the existing whole-unit winner rule,
never addition. Machine retirement freezes its root revision/coverage set inside its machine snapshot;
root retirement cannot bypass a machine's older retirement boundary. Unretire restores the frozen
snapshot and selection, then merges the next live answer without lowering history. A period starting
before **any applicable root or machine retirement** remains a floor; a later period still needs all
active machines/roots answered, none left out and no retained unit overlapping it. Retirement alone
does not produce weekly exit 3. Historical checkpoint/period rows are not rewritten.

Use one new owner-only `source-roots.key` file: 32 random bytes for HMAC-SHA-256, stable within the store,
never exported. Hashes are full lowercase 64 hex digits with domain-separated UTF-8 canonical JSON
(sorted object keys, compact encoding; unordered sets sorted and deduplicated). Domain strings are
`root-v1`, `machine-v1`, `canonical-v1`, `binding-v1`, `account-v1`, `mapping-v1`, `attribution-v1`,
`population-v1`, plus `reader-v1` for physical machine plus effective OS reader identity. Input tuples
for the first nine domains respectively name the registration key; existing physical host identity;
machine plus realpath; root plus binding; vendor plus account/organization; root plus mapping table;
root plus metadata policy/content hashes and known/unknown attribution; and the full population below.
No unsalted path hash. Missing/unresolved inputs yield null, never a hash of an invented empty value.
Loss/rotation of this key starts an unknown basis, not transparent historical continuity.

Extend RFC 0005 `basis` with `source_roots: {version: 1, id: [...], mappings: [...], attribution: [...]}`.
Each array contains sorted distinct hashes from contributing days; `[null]` denotes unknown. `id` hashes
the full physical machine/default-source set plus all registered active, left-out, tombstoned and
retired roots, their spec revisions, canonical targets, bindings, lifecycle and retirement instants.
Root population is thus also included in RFC 0005 `machines.id`, not just the number of machines.
`mappings` hashes the mapping policies; `attribution` hashes optional-file decisions, validity and
accepted account/model metadata, with explicit unknown states. Successful reads after a metadata
failure start a new attribution basis. Reader-pattern/dedup changes also raise `rules.usage`; project
and model attribution rule changes follow RFC 0004/0005's rule versions. Do not include transient
attempt timestamps in identity hashes.

Persist the whole basis with both endpoints: saved scans, `plan_value`, weekly checkpoint and its
`compared_with`, every applicable RFC 0005 period/result/best. When RFC 0005 delivery is not yet present,
the root delivery must still persist these guards for existing plan/weekly comparisons; it cannot
enable roots and defer truth rules. Old rows without root basis or coverage retain their values with
`basis_unknown`; never assume they covered today's defaults/roots, rehash their population from current
settings or infer coverage from absent errors. Empty current roots can compare only to an explicitly
recorded empty-root basis. Unknown legacy units cannot establish complete period coverage.

At **both** endpoints require full relevant coverage and one known equal hash in each required basis
array, alongside RFC 0005's prices, rules and PR-source conditions. Withhold usage/value/plan/project/
lead-model comparisons and game improvement claims when roots are added, replaced, removed, deselected,
retired/unretired, retargeted, remapped or reattributed. Equal root counts do not suffice. A period with
several bases is not comparable even if the other period has the same set. Physical PR counts retain
their independent PR-source basis; roots cannot manufacture improvement in delivery costs or proxies.

`change.not_compared` adds `roots_changed`, `mappings_changed`, `attribution_changed`; unknown old
coverage uses `basis_unknown`, incomplete usage `floor`, and rule changes `rules_changed`. Emit every
applicable reason (RFC 0005 `machines_changed` may accompany `roots_changed`). The plain plan path and
weekly path return the same reasons beside their null change/moved fields. Existing weekly exit codes
remain: an incomplete proof stays incomplete, not a successful comparison. Never turn missing coverage
into zero usage at either end.

Saved-only/offline reads (`get`, `projects`, stored period queries and existing reuse behavior) read only
the saved store. They never validate a root path, refresh permissions, resolve a symlink, connect over
SSH or relabel saved coverage as fresh. An offline scan/transport failure retains values and marks
`saved` with `transport_failed`/`retained_unit` as appropriate. New settings do not change an old saved
run's basis: label it saved under its original basis; comparisons to the new one are withheld. Invalid
or lost snapshots remain visible coverage failures, not empty data.

No new network beyond the existing machine SSH session: send validated root specs through that session
as data and return only sanitized scans/coverage. No SSH into containers, second transport, config
upload, forge discovery or metadata fetch. Extra-root reads stay read-only; optional collector caches
and private settings remain local. Each implementation delivery updates the README's disclosure/audit
contract, `worthit schema`, `skills/worthit/SKILL.md` and synthetic demo fields in the same PR.

## 8. Staged deliveries and fixtures

These are proposed delivery scopes, not claims of implementation or new issue acceptance checklists.
Each gets its own issue and PR after owner scheduling. No delivery enables an unguarded partial root
feature; default-home scanning remains usable on its own.

| # | Independently usable outcome | State |
|---|---|---|
| 1 | Explicit Claude/Codex/meter bindings through local/existing SSH machines; commands/settings, safe boundary, canonical native AND meter dedup, root coverage/audit, saved merge/retire/unretire, basis guards at both ends. Usage works with account/model unknown; per-plan incompleteness is disclosed. No new project mapping or derived file reads yet. | open |
| 2 | Optional derived account/model files and explicit Antigravity usage bindings, with distinct attribution failures and unknown pricing. Existing root usage remains useful when optional metadata is disabled. | open |
| 3 | Container-to-mount mapping and read-only git metadata, token-URL refusal and partitioned optional project cache; projects resolve safely or remain unresolved without losing usage. | open |

Delivery 1 rejects not-yet-supported `antigravity`, `account`, `model` and nonempty `mappings` settings
with a clear unsupported-feature error; it never silently ignores them. All final syntax is reserved
here. The first stage is intentionally a complete safety/coverage slice, not a promise of a tiny PR.
Its default project cut remains unresolved unless existing allowed transcript evidence establishes it;
it must already refuse embedded tokens on those URLs. Later stages change attribution/basis explicitly.

Fixture plan (synthetic identities, isolated HOME/WORTHIT_HOME/config/cache; no real store or mounts):

- Delivery 1: nested per-agent bindings; default/root overlap; two symlinks and hardlinks to each
  native file **and** each meter path; distinct meter DBs with colliding ids; link escape/loop/retarget;
  one canonical contribution and coverage for every alias. Include same-host aliases and retired-live
  overlap; unknown host/copy identity must not become complete by guess.
- Delivery 1: missing, unreadable, partial, empty and malformed usage on a **first** scan and with saved
  units; exclusion without prior data; transport failure; interrupted enumeration; SQLite WAL snapshot
  consistency. Failed root blocks the whole relevant machine unit, retains the winner, never sums
  overlaps or lowers incompletely scanned history; offline commands perform zero root/SSH reads.
- Delivery 1: OS reader can read allowed synthetic usage and is denied existing sentinel credentials
  **and raw configs**, including raw Gemini/Antigravity settings and link aliases. Absence is unverified,
  not denial; readable raw config rejects the root without reading its contents. Trace open calls to
  prove the scanner never requests prohibited files, fallback paths or sibling secrets.
- Delivery 1: add/replace/remove/select/retire/unretire roots; same count with another identity; date
  boundaries at root and machine retirement; frozen snapshots byte-stable; lost snapshots; root source
  provenance on retained/legacy units. Both plan comparison paths and every RFC 0005 consumer refuse
  floors, old basis and changed population; explicitly empty-root bases compare only when equal.
- Delivery 2: valid/missing/denied/malformed/oversize/extra-key/duplicate-key account and model files;
  conflicts, account switches and absent historical evidence; model from record beats current label;
  raw fallback never opens. Unknown usage remains additive, priced value retained where supportable,
  unpriced counters visible, every per-plan view discloses its gap. Metadata failures alone do not
  claim usage failure. Attribution changes invalidate both comparison endpoints.
- Delivery 3: mapped cwd and linked worktree with relative/absolute container `gitdir` and `commondir`;
  prefix boundaries, escapes, missing/denied metadata, removed cwd and stale cache; token-bearing
  origins in config **and transcripts** refused before cache/output; clean canonical project works.
  Mapping changes cannot reuse old cache or create apparent improvement. Project rows plus
  `no_repository` still reconcile to totals; no repo/path/account leaks to prompts or share output.
- Each stage: local and synthetic SSH transport fixtures, failure-path audit for every attempted root,
  zero raw shared paths/content in stdout/stderr/progress/trace/audit/saved scans; default-only stores
  still work. Update public schema/skill together. Run `make check`; any drawing change also supplies a
  rendered image actually inspected. RFC-only delivery runs no private proof or feature experiment.

## Open questions (for the owner)

Each answer is one word. `yes` alone takes every recommendation below; it does not assert delivery has
shipped. Questions 1-4 block delivery 1; questions 5-6 block delivery 2; question 7 blocks delivery 3.
Status remains Queued until the owner schedules and answers the blocking decisions.

1. **Patterns.** `bindings` (recommended): exact vendor homes, including nested agent homes, with
   section 2's narrow patterns. `discover`: design a separate enumerated agent-home layout first;
   delivery 1 waits for that contract rather than recursively guessing.
2. **A failed usage root.** `machine` (recommended): whole relevant machine usage is a floor, no plan
   proof or usage comparison. `scoped`: deliver only root-level observations until a separate plan
   partition/proof contract can establish which aggregate is complete; delivery 1 waits for it.
3. **Declaration and retirement.** `commands` (recommended): section 1 commands and RFC 0002 frozen
   snapshots/proof, with private settings. `settings`: edit the same validated local file only; define
   an equivalent explicit snapshot transition before shipping retirement. No deletion-as-retirement.
4. **Coverage location.** `roots` (recommended): new `source_roots`, preserving machine fields.
   `machines`: design a versioned combined machine/root schema first; delivery 1 waits for it.
5. **Account attribution.** `derived` (recommended): producer exposes account/organization ids, plan,
   seat and tiers **only**, under section 3's schema. `unattributed`: no derived account reads;
   keep tokens/API value and the per-plan incompleteness disclosure. Raw `.claude.json` stays denied.
6. **Model attribution.** `derived` (recommended): model **only** file, with per-record evidence first.
   `unknown`: no derived model reads; absent reliable recorded model stays model unknown with unpriced
   coverage. Raw Gemini/Antigravity `settings.json` stays denied under either answer.
7. **Project paths.** `mapped` (recommended): explicit prefix mappings plus read-only bounded metadata
   and token-URL refusal. `unresolved`: no mounted metadata reads; usage remains in RFC 0004's
   no-repository bucket when safe transcript evidence cannot name its project.
