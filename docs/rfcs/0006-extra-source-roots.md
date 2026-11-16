# RFC 0006: Extra source roots

| Field | Value |
|---|---|
| Status | Queued |
| Created | 2026-11-16 |
| Issue | #125 |
| Depends on | RFC 0002 snapshot/proof rules; RFC 0004 project resolution; RFC 0005 basis semantics (delivery 1a does not depend on its implementation) |

## Proposal in short

Declare read-only usage roots per local machine or saved SSH alias in the private worthit store.
Bind exact vendor homes within a root; scan only documented usage patterns, never sibling secrets.
Count canonical native and meter sources once, and report every root's coverage with hashed identities.
Keep unknown account/model usage, disclose incomplete plan attribution, and expose only derived metadata.
Freeze retired roots like machines; changed roots, mappings or attribution start a new comparable series.
Land the synthetic fixture first; ship conservative guards before lifting them with a recorded basis.

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
        "registered_at": "2026-11-16T00:00:00Z",
        "boundary": null,
        "revisions": [],
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
`registered_at` is an immutable ISO UTC instant; `retired_at` and `last_scan_at` are ISO UTC instants
or null, and `since` holds an optional UTC date assertion, or null.
Private revisions/tombstones are kept in the same document as `revisions`, an array of previous root
records without their own nested `revisions` key. Old stores without the file have no declared extra
roots; this says nothing about old scan coverage. A missing salt or malformed file in a previously
initialized store is an error, not a new population. Create/update atomically with owner-only
permissions. Raw paths and account ids never go
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
allowlisting alone is insufficient: reject a usage/derived/metadata symlink to a prohibited file.
Hardlinks are protected by the inode's OS permissions, not by guessing a secret sibling's filename;
the denied inode must remain denied through every link. Require separately exposed usage and metadata
mounts/ACLs, not a broadly readable home. Root registration records intent; it cannot confer OS
permissions or prove isolation by itself.

An operator verifies, under the actual OS reader identity locally and through the existing SSH alias:

- Positive reads of synthetic usage fixtures and, when enabled, derived files and git metadata.
- Negative **OS permission** checks for existing raw `.claude.json`, all relevant raw `settings.json`,
  `auth.json` and `.credentials.json`, including aliases/links. An isolated permission fixture uses
  harmless sentinel files with the same ACL/mount boundary. A deployment using separate usage-only
  mounts can also reach `verified`: its producer places an existing harmless sentinel for each
  prohibited class at that class's real location under the same ACL/mount boundary, confirms existence
  privately, and the actual reader must receive an OS denial there (including denied ancestor traversal).
  This requires a deployment denial-probe route; if the reader sees only ENOENT, it remains unverified.
  Do not expose any real raw config to establish the probe. An actual deployment check obtains a
  denial without reading content; a successful open is a failed boundary, immediately closed unread.
- Missing files are `not_present`, never proof of denied readability. If neither an existing raw-class
  file nor an existing same-boundary deployment sentinel yields denial, verification is `unverified`;
  fix/prove the boundary before admitting the
  root. The checker reports names by class, denial/result and hashed identity, never content or paths.

The scanner never opens raw config or probes its names with `access()`/`stat()`. Those permission and
existence probes belong to the separate operator check, which establishes denial without content reads.
`boundary --file` takes a strict object `{status, checked_at, revision, reader_id, proof_sha256}`:
`status` is `verified`, `unverified` or `failed`, `checked_at` an ISO UTC instant, `revision` the current
spec revision, `reader_id` the salted physical machine/OS identity hash, and `proof_sha256` the 64-hex
SHA-256 of an owner-kept private permission receipt. No raw identity/path/content is accepted here.
It is stored as the root record's `boundary` object, with null meaning unverified on add. It neither
advances the revision nor asserts usage completeness. Changed spec/reader identity invalidates it;
deployment permission/mount changes require a new check and record. It is an operator attestation,
not a claim that a receipt hash enforces OS isolation. Record only its status with run coverage;
an unverified/failed boundary makes the root unreadable (`boundary_unverified` / `boundary_failed`)
and skips content. Deployment permission
changes require renewed checks; a historical check is not a permanent security assertion. No permission
probe, mount change or credential migration is performed by this RFC.

Open SQLite read-only, including permitted read-only WAL/SHM sidecars for the named database only;
never checkpoint, create journals, chmod, repair, write caches or install anything under a source root.
If a consistent SQLite snapshot cannot be read without a write, report partial, not empty. Caches are
optional and collector-store-local, partitioned by physical machine, root revision and mapping/reader
rules; cache failure cannot authorize a source write or a wider read. For SSH extra roots, the remote
reader uses no path-keyed persistent cache; only the collector's sanitized, root-scoped cache may be
used. RFC 0004's reading-machine `folder_project` cache remains unchanged for default sources and must
never be consulted by an extra-root container cwd.

## 3. Optional account and model files

**Explicit owner decision:** recommend the workspace producer writes a derived account file exposed
read-only, containing only this allowlist:

```json
{"oauthAccount":{"accountUuid":"example-account","organizationUuid":"example-organization","planDisplayName":"example-plan","seatTier":"example-seat","organizationRateLimitTier":"example-tier","userRateLimitTier":"example-tier"}}
```

The outer object has exactly `oauthAccount`; its object permits only `accountUuid`, `organizationUuid`,
`planDisplayName`, `seatTier`, `organizationRateLimitTier`, `userRateLimitTier`. These preserve the
source field names: plan is `planDisplayName`, seat is `seatTier`, and the two named rate-limit tiers
remain distinct. `organizationType` and `billingType` are deliberately unknown, not copied or guessed.
Present fields must be nonempty bounded strings. `accountUuid` is required; omitted optional fields
are unknown, never inferred. Maximum file size is 16 KiB and maximum string length 256 characters.
Reject extra keys, duplicate keys, arrays in
place of objects, malformed/oversize content and unsafe text. These are identifiers/labels only, no
email, login, env, endpoint or credential. Usage rows use the shipped reader's `tag()` account/org tags
with exactly the same `USAGE_ACCT_SALT` behavior as default homes (`core/extract_usage.py:30-36`), so
one account is not split by source type. The collector's `account-v1` HMAC is only for attribution
basis, not a replacement usage tag. Raw derived ids may cross only the existing SSH pipe into collector
memory for that HMAC; never retain the raw file/ids (section 7). worthit does not produce it by reading
raw config. The workspace's separate trusted producer is outside the scanner identity and this
delivery's implementation scope.

Alternative: no derived account file; usage remains unattributed. Claude usage without a valid binding
does not inherit the host's login or a neighboring agent's plan. Codex uses the session's own account
id; absent identity stays unattributed, never `auth.json` fallback for an extra root. A derived current
Claude account does not establish historical ownership: apply it only where the source establishes
that account for the usage interval; absent historical evidence keep those rows unattributed. A plan
or seat cannot be inferred from an account id alone.

From delivery 1a, unattributed root rows are ineligible for the host-login/cap fallback, including
`cap_match_host` in `core/weekly.py:211-232`: a default home with one known login cannot lend that login
to an unknown root. A same-host cap, reset, nearby meter or session-name coincidence is not root account
evidence. Preserve provenance through pricing to enforce this; default-only attribution is unchanged.

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
on an identity race. Outside targets need an explicit binding before reading. Physical file identity
uses machine plus filesystem device/inode (and generation/birth identity where provided), independently
of the path spelling; hardlinks share identity. Canonical paths remain evidence of containment, not a
second discriminator that splits identical inodes. Across scans, inode reuse or uncertain filesystem
identity cannot prove equality/disjointness. Realpath is a fallback for same-path/symlink dedup only;
without reliable inode identity, distinct paths are not proven independent hardlinks. Withhold
completeness (`identity_unknown`) where that ambiguity affects counting or snapshot assembly.

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

**Aggregation order (delivery 1b adds steps 3-4).** Ownership is by canonical physical source, not by the
alias/root label under which it was discovered. Each usage row and its source manifest retain that id.
From 1a, new scan `source_ownership` is an array of `{collection,row,source_ids}`: `collection` is one of
`buckets`, `meters`, `events`, `meter_readings`, `meter_usage`, `sessions`; `row` is the zero-based index
in that collection; `source_ids` is its sorted distinct physical-file hash array (`[null]` if unknown).
Keep native buckets separated by owning file until whole-unit selection, so each usage contribution
has one owner and can be projected without splitting an unattributed aggregate. A session can list
several files but is not itself an additive usage total. This sidecar preserves existing meter row
layouts, is reindexed after merge, and is saved with the owning machine/frozen scan. Default-source
rows in a root-enabled scan need the same provenance; old absent ownership is unknown, never invented.

1. **Reader:** build one fresh machine candidate from defaults and active roots across its aliases,
   deduplicating physical files/events before aggregation. A source shared by roots/defaults owns one
   contribution. Keep source provenance sufficiently granular to extract one root's last selected
   rows when freezing it; a legacy aggregate without that provenance cannot be split by guess.
2. **Saved against fresh:** compare the candidate with its own saved machine candidate using #24's
   unchanged winner rule on **machine + collector-local day + provider**: higher API value, then
   tokens, full ties fresh; never union the two units. This is `day()`'s `.astimezone()` and local meter
   `fromtimestamp` in `core/merge_scans.py:11-13,34,52-58`, also `day_provider.day`. A failed/left-out/saved
   root makes the machine a floor but does not force the lower-scoring candidate to win. A max of two
   floors remains a floor. There is no model key; `day_model` stays UTC, derived from the merged rows.
   Preserve the existing partial-oldest-day cut and history's no-lowering rule. Neither a missing root
   nor this RFC authorizes lowering saved history or rewriting immutable judged/checkpoint rows.
3. **Retired roots:** assemble their frozen rows against the **chosen machine candidate**, including
   its saved winner, not merely against the live read inventory. Never host-match a root snapshot.
   With proven identities, if none of a snapshot's file ids is represented in the chosen candidate,
   add it once as disjoint physical-source usage. If all are already represented, it is redundant
   (`overlap`) and adds nothing, whether those rows came from fresh defaults, another root/alias or
   the chosen saved machine unit. A file merely read live but discarded by step 2 is not represented.
   Partial overlap or unknown identity is `identity_unknown`: retain the chosen candidate, keep the
   frozen snapshot as uncombined evidence, add no ambiguous rows and make the machine a floor.
   Process retired snapshots against the accumulated represented-id set, so two snapshots cannot
   add the same file twice. The disjoint retired-root/live-default case counts both usages once.
4. **Retired machines:** apply RFC 0002's whole-machine snapshot merge last, using its host matching
   and whole-unit rule; these snapshots already contain their roots. Do not also add their root
   snapshots. A retired machine answering under another alias still contributes once.
5. **Persist:** `run-keep/<machine>.json` alone holds the selected machine usage, with ownership and
   provenance identifying any frozen contribution already present. `run-keep/roots/<root-id>.json`
   holds only coverage/provenance, never a second active usage collection. On the next run, projected
   active candidates exclude exclusively retired sources only when provenance proves the partition;
   frozen rows are reassembled once by step 3. Rows still owned by active defaults/other roots stay
   in the candidate, so their frozen copies are overlap. If legacy provenance cannot establish the
   partition, keep the unsplit saved candidate and floor; do not add a root snapshot without proving
   disjointness against that retained data. Retirement and unretirement preserve these ownership
   transitions atomically; they never sum an active copy with its frozen copy.

The whole-unit winner rule applies to competing versions of the same machine scope, while step 3 is
addition of proven-disjoint sources. Losing fresh evidence is not an extra reported total. Saved
values and frozen uncombined evidence remain available under their own coverage/basis; unknown
legacy provenance stays unknown. History and `day_model` retain their existing MAX protections.

## 5. Container paths and project metadata

RFC 0004 still names projects by canonical origin, keeps unresolved usage in `no_repository`, and
excludes repository ids from agent/share outputs. A mapping's `from` is an absolute container POSIX
directory prefix; `to` is a relative mounted directory below the declared root, separately authorized
for metadata reads. Match complete path components, longest prefix first; duplicate/ambiguous prefixes
are invalid. Normalize lexically without traversal before mapping, then canonicalize the target and
require containment. From delivery 1a, an unmapped container cwd performs **no host path lookup and no
raw-path cache lookup**: bypass `resolve_project`'s `isdir` and `folder_project` paths for it, even if a
coincidentally equal host path exists. Only a safely validated logged origin can resolve it before
mapping ships; otherwise `project: null`, `project_why: "folder_gone"` (or `no_folder_read` without cwd).

Starting at the mapped cwd, walk upward only to its authorized metadata boundary. Read only `.git`
(directory or `gitdir:` file), `commondir`, and the shared git directory's `config`, as RFC 0004. Resolve
relative pointers from their containing directories. Absolute **container** pointers are mapped by the
same table, never interpreted directly as host paths; relative pointers must remain within authorized
metadata boundaries. Cross-boundary worktree/common dirs need their own explicit mapping. No git
process, network, fetch, hooks, includes or `insteadOf` expansion. Failed mappings or unreadable metadata
leave `project: null` and a separate mapping status; they do not fail usage reads. Missing/unmapped
folders keep RFC 0004's `folder_gone`; readable mapped folders with unreadable/unsupported git metadata
use `origin_not_supported`, and absent cwd uses `no_folder_read`. No new `project_why` enum is added.

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
| `registered_at` | immutable ISO UTC registration instant, including for a root that never answered |
| `reader_id` | salted physical machine/effective OS reader identity hash, null until preflight establishes it |
| `canonical_id` | salted canonical-root-path hash, null if unresolved |
| `selected`, `lifecycle` | boolean; `active` or `retired`; removed settings retain an unselected active tombstone |
| `status` | `read`, `missing`, `unreadable`, `partial`, `left_out`, `retired` or `saved` |
| `reasons` | sorted unique codes defined below, never exception text |
| `attempted_at`, `last_scan_at`, `retired_at` | ISO UTC instants or null |
| `window` | `{from,to,complete}`: UTC scan interval and boolean; a partial boundary day is not complete |
| `boundary` | `verified`, `unverified` or `failed` from section 2 |
| `sources` | per binding `{id,kind,status,reasons,canonical_ids,account,model,mapping}`; ids are salted hashes; canonical_ids are deduplicated physical-file hashes, null where identity is unproven |
| `account`, `model` in each source | `{status,rows_unknown}` using section 3 states; nonapplicable metadata is `disabled`; counts are nonnegative integers |
| `mapping` in each source | `{status,reasons}`: `disabled`, `read`, `missing`, `unreadable`, `partial`; status describes project resolution, not usage |
| `attribution` | `{account_complete,model_complete,unattributed_rows,unattributed_output_tokens,unattributed_api_value_usd,model_unknown_rows,unpriced_rows}`; booleans then nonnegative counters/value for the requested window |
| `retained` | array of `{day,provider,root_ids,why}` describing saved winner units; collector-local date and hashed root ids; model is not a merge key |

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
progress and trace output at the collector boundary before any emission or write, as section 7
specifies. Raw extra-root paths/identifiers may cross only the existing private reader pipe into
collector memory, never shared output, audit, saved scan or cache. Origin URLs with tokens are refused
in the reader before transport. Root paths never enter prompts, cards or reports.

## 7. Retirement, basis at both ends, and offline reads

Delivery 1b's `retire` freezes the root's last provably owned rows from the selected machine scan at
`WORTHIT_HOME/run-keep/roots/retired/<root-id>.json`. A version-1 frozen envelope holds `source_roots`,
its hashed identity/basis, `generated_at`, `since`, `registered_at`, `last_scan_at`, `no_saved_scan`
(boolean), a `source_ids` array of physical-file hashes and the existing usage collections for that
root only. `run-keep/roots/<root-id>.json` is a version-1 **coverage/provenance-only** record with those
identity/time fields and source ids, but no usage collections. The machine scan owns the active usage;
this record is never merged for usage. Frozen rows follow section 4's assembly, not machine-host merge.
No record contains raw paths and no scan writes a frozen snapshot.

A never-answered root **can be retired**. Freeze an empty envelope with `no_saved_scan: true`,
`last_scan_at: null`, `since: registered_at`, and empty source ids/usage collections; absence of an
answer is not proof of historical zero usage. Every view relying on it discloses "retired with no saved
scan, as stated by you". Distinguish this from a missing/corrupt snapshot of a root that did answer:
do not silently replace lost evidence with an empty envelope. Valid previously owned usage is kept.

`--since` is the RFC 0002 UTC date assertion, not before `last_scan_at` for a root that answered, or
`registered_at` for a never-answered root, and never in the future. Absent it, retirement is now.
Always disclose "retired since <date>, as stated by you" when relying on a supplied date. The empty
snapshot's scan `since` is a provenance lower bound, not a backdated `retired_at` or proof of coverage.

Machine retirement freezes its root revision/coverage set inside its machine snapshot; root retirement
cannot bypass a machine's older retirement boundary. Unretire restores selection and the saved source
ownership ledger; merge frozen rows once through section 4, without adding a frozen copy to a machine
unit that already contains it. A period starting before **any applicable root or machine retirement**
remains a floor; a later period still needs all
active machines/roots answered, none left out and no retained unit overlapping it. Retirement alone
does not produce weekly exit 3. Historical checkpoint/period rows are not rewritten.

Use one new owner-only `source-roots.key` file: 32 random bytes for HMAC-SHA-256, stable within the store,
kept on the **collector**, never sent to an SSH reader. Hashes are full lowercase 64 hex digits with
domain-separated UTF-8 canonical JSON: `HMAC(key, UTF8(JSON([domain, input_tuple])))`, sorted object
keys, compact encoding, unordered sets sorted and deduplicated. Domain strings are
`root-v1`, `machine-v1`, `canonical-v1`, `binding-v1`, `account-v1`, `mapping-v1`, `attribution-v1`,
`population-v1`, plus `reader-v1` for physical machine plus effective OS reader identity. Input tuples
for the first eight domains respectively name the registration key; existing physical host identity;
machine plus realpath; root plus binding; vendor plus account/organization; root plus mapping table;
root plus metadata policy/content hashes and known/unknown attribution; and the full population below.
`file-v1` is a separate domain for machine plus proven physical-file identity: device/inode and a
generation discriminator when available, **without realpath**, so hardlink aliases hash equally.
`canonical-v1` remains the root-path hash. A realpath-only fallback may deduplicate equal paths/links
but cannot produce a proven physical-file id for distinct-path/snapshot disjointness; use null and
`identity_unknown` for that claim. All of `sources[].canonical_ids` and snapshot `source_ids` mean
these `file-v1` physical-file hashes, despite the former field's name.
No unsalted path hash. Missing/unresolved inputs yield null, never a hash of an invented empty value.
An explicitly never-answered retirement records a known attested lifecycle with unknown physical
identity, not an empty observed source: its declared registration/retirement can enter the population
hash, while file identity stays null and pre-retirement coverage stays unknown/floor.
Loss/rotation of this key starts an unknown basis, not transparent historical continuity.

The remote reader cannot compute these HMACs. Its root-only result and progress protocol may carry
raw root/file/cwd, effective reader identity and derived account ids **only over the existing private
SSH stdout/stderr pipes**, into a bounded collector-memory adapter. The collector replaces them with
the above hashes, strips raw `cwd` from root-originated `sessions`/`events`, and rejects unrecognized
raw-bearing fields before any write/cache/audit/output. It must replace today's direct stdout-to-file
pipe for root-enabled scans; no raw staging file, crash dump, debug log or raw exception fallback.
Local root reads use the same memory adapter. Reader-side persistent root caches are disabled.
Usage account tags are still the shipped `tag()` computed in the reader (section 3); `account-v1`
belongs only to collector-side basis. No key export or second account-tag scheme is introduced.

**Delivery 1a's conservative guard:** persist `source_roots` with each endpoint already used by the
plain plan path and weekly checkpoint (and its `compared_with`). Add nullable JSON-text
`plan_value.source_roots` for that observation's exact array; old rows are null/unknown, never `[]`.
Whenever either endpoint has **any registered root**, including deselected/tombstoned roots, or its
old coverage is unknown and may have roots, withhold plan and weekly comparisons with
`plans[].not_compared: ["roots_changed"]`. Also suppress existing usage/value/model-share/delivery-cost
comparison and improvement claims affected by those roots; physical PR counts retain their separate
PR-source checks. With unknown historical root coverage, do not infer the old default population.
This is conservative even for a currently complete root. It requires coverage persistence and null
comparisons, **no population-basis hashing or RFC 0005 implementation**. Empty-root endpoint arrays
must be explicit before the guard can allow default-only comparisons under the existing rules.

Extend RFC 0005 `basis` with `source_roots: {version: 1, id: [...], mappings: [...], attribution: [...]}`.
Each array contains sorted distinct hashes from contributing days; `[null]` denotes unknown. `id` hashes
the full physical machine/default-source set plus all registered active, left-out, tombstoned and
retired roots, their spec revisions, canonical targets, bindings, lifecycle and retirement instants.
This is a separate root-population basis; RFC 0005 `machines.id` retains its own salt, format and
machine-only meaning. It is not redefined or rehashed with this RFC's key.
`mappings` hashes the mapping policies; `attribution` hashes optional-file decisions, validity and
accepted account/model metadata, with explicit unknown states. Successful reads after a metadata
failure start a new attribution basis. Reader-pattern/dedup changes also raise `rules.usage`; project
and model attribution rule changes follow RFC 0004/0005's rule versions. Do not include transient
attempt timestamps in identity hashes.

Delivery 1b persists this root basis with both endpoints: saved scans, a nullable JSON-text
`plan_value.source_roots_basis` column, `basis.source_roots` in weekly checkpoint and `compared_with`,
and every applicable RFC 0005 period/result/best when those exist. Before RFC 0005 implementation,
the minimal `basis` object here contains only `source_roots`; it makes no claim to supply prices,
PR-source, period tables or game contracts. The root guard is lifted only for known single equal root
bases and complete relevant root proof at both ends, plus all existing comparison checks. Once RFC
0005 is implemented, its full conditions also apply; root equality never bypasses them. Old rows
without root basis or coverage retain their values with `basis_unknown`; never assume they covered
today's defaults/roots, rehash their population from current
settings or infer coverage from absent errors. Empty current roots can compare only to an explicitly
recorded empty-root basis. Unknown legacy units cannot establish complete period coverage.

At **both** endpoints require full relevant coverage and one known equal hash in each required basis
array, alongside RFC 0005's prices, rules and PR-source conditions when implemented. Withhold usage,
value, plan, project and lead-model comparisons and game improvement claims when roots are added,
replaced, removed, deselected,
retired/unretired, retargeted, remapped or reattributed. Equal root counts do not suffice. A period with
several bases is not comparable even if the other period has the same set. Physical PR counts retain
their independent PR-source basis; roots cannot manufacture improvement in delivery costs or proxies.

`change.not_compared` adds `roots_changed`, `mappings_changed`, `attribution_changed`; unknown old
coverage uses `basis_unknown`, incomplete usage `floor`, and rule changes `rules_changed`. Emit every
applicable reason (RFC 0005 `machines_changed` may accompany `roots_changed`). From delivery 1a,
`plans[].not_compared` is a sorted unique array of reason codes beside `change_vs_last_week_pct`, in
both run JSON and weekly plans (including saved baseline plans); `[]` means no reason withheld the
comparison. The root-relevant codes are `roots_changed`, `mappings_changed`, `attribution_changed`,
`basis_unknown`, `floor`, `rules_changed`; existing non-root withholding uses `no_baseline` or
`invalid_baseline` when appropriate. A withheld change is null. `moved` remains an array and omits the
plan, explained by that plan's `not_compared`; there is no null moved entry.

From delivery 1a, an active root not `read` (including failed, left-out or saved), or a retained unit
overlapping the week, adds a weekly free-text `reasons` entry with hashed root id plus reason code
(and collector-local day/provider for a retained unit), and sets `safe_to_post: false`. A retired root
adds such an unsafe reason if its retirement boundary or unresolved snapshot/overlap blocks this week;
a valid retired snapshot for a fully post-retirement week is not unsafe merely for being `retired`.
Missing account/model evidence that makes plan proof incomplete also adds the hashed root reason.
Comparison-only basis mismatch can leave a complete current observation safe, but still nulls its
change and excludes it from `moved`; it does not authorize a post claiming improvement. Name
`plans[].not_compared`, root-aware `safe_to_post`/`reasons`, and `plan_value.source_roots` in schema
and skill deltas of 1a; name `plan_value.source_roots_basis` and `basis.source_roots` in 1b.
Existing weekly exit codes remain: incomplete proof stays incomplete, not a successful comparison.
Never turn missing coverage into zero usage at either end.

Saved-only/offline reads (`get`, `projects`, stored period queries and existing reuse behavior) read only
the saved store. They never validate a root path, refresh permissions, resolve a symlink, connect over
SSH or relabel saved coverage as fresh. An offline scan/transport failure retains values and marks
`saved` with `transport_failed`/`retained_unit` as appropriate. New settings do not change an old saved
run's basis: label it saved under its original basis; comparisons to the new one are withheld. Invalid
or lost snapshots remain visible coverage failures, not empty data.

No new network beyond the existing machine SSH session: send validated root specs as framed **stdin
data after the scanner script**, consumed by a fixed trusted bootstrap, never argv or env. Do not let
Python's script-stdin EOF parsing swallow the spec; the bootstrap reads explicit script/spec lengths.
No private path is interpolated in a command or visible in the remote process list. Return raw private
root protocol only through that session's pipes to the sanitizing collector-memory boundary above.
No SSH into containers, second transport, config upload, forge discovery or metadata fetch.
Extra-root reads stay read-only; optional collector caches
and private settings remain local. Each implementation delivery updates the README's disclosure/audit
contract, `worthit schema`, `skills/worthit/SKILL.md` and synthetic demo fields in the same PR.

## 8. Staged deliveries and fixtures

These are proposed delivery scopes, not claims of implementation or new issue acceptance checklists.
Each gets its own issue and PR after owner scheduling. No delivery enables an unguarded partial root
feature; default-home scanning remains usable on its own.

| # | Independently usable outcome | State |
|---|---|---|
| 1a | Fixture first, then useful read-only Claude/Codex/meter root usage: add/list/select and boundary commands/settings, canonical native AND meter dedup, coverage/audit, saved-machine winner/floor, plan-incompleteness disclosure and the conservative comparison guard. No RFC 0005 implementation dependency. | open |
| 1b | Manage changed/finished roots: update/retire/unretire, provenance-aware frozen root assembly and root-basis persistence at both ends; lift 1a's comparison guard only with equal known basis and complete proof. | open |
| 2 | Optional derived account/model files and explicit Antigravity usage bindings, with distinct attribution failures and unknown pricing. Existing root usage remains useful when optional metadata is disabled. | open |
| 3 | Container-to-mount mapping and read-only git metadata, token-URL refusal and partitioned optional project cache; projects resolve safely or remain unresolved without losing usage. | open |

Delivery 1a's **first commit is the synthetic fixture**, before any reader implementation. Establish
the negative control and unopened credential/raw-config sentinels first, then wire the new behavior
into the existing fixture runner as implementation lands; this docs PR adds/runs no fixture. Stage 1a
is a read-only usage outcome with conservative comparisons, not the entire lifecycle/basis program.
Stage 1b adds that independently useful lifecycle outcome after 1a; it does not implement RFC 0005's
unrelated periods/game/price basis. Each stage is one scoped issue/PR, with its own fixture receipts.

Stages 1a/1b reject not-yet-supported `antigravity`, `account`, `model` and nonempty `mappings` settings
with a clear unsupported-feature error; 1a also rejects update/retire/unretire until 1b. Never silently
ignore them. All final syntax is reserved here. From 1a an unmapped container cwd cannot use a host
folder or path-keyed cache; only a validated, token-free logged origin can resolve its project, otherwise
it stays unresolved. Host cap/login fallback cannot attribute unknown root usage. These safeguards and
the null-comparison guard ship **with** the first usage reader, not deferred to stages 2/3.

Fixture plan (synthetic identities, isolated HOME/WORTHIT_HOME/config/cache; no real store or mounts):

- Delivery 1a, fixture first: nested per-agent bindings; default/root overlap; unreadable and symlinked
  roots, unopened credential/raw-config sentinels and a single-login host whose `cap_match_host` cannot
  assign unattributed root rows. Include a matching host cwd and preseeded `folder_project` cache that
  an unmapped container cwd must never inspect. Then two symlinks and hardlinks to each
  native file **and** each meter path; distinct meter DBs with colliding ids; link escape/loop/retarget;
  one canonical contribution and coverage for every alias. Include same-host aliases and RFC 0002
  retired-machine/live overlap; unknown host/copy identity must not become complete by guess.
- Delivery 1a: missing, unreadable, partial, empty and malformed usage on a **first** scan and with saved
  units; exclusion without prior data; transport failure; interrupted enumeration; SQLite WAL snapshot
  consistency. A failed root makes the machine a floor; the unchanged score rule selects the winner
  (including a higher-scoring fresh floor), never sums versions or lowers protected history. Every
  root-bearing or unknown endpoint suppresses comparisons; offline commands perform zero root/SSH reads.
- Delivery 1a: OS reader can read allowed synthetic usage and is denied existing sentinel credentials
  **and raw configs**, including raw Gemini/Antigravity settings and link aliases. Absence is unverified,
  not denial; the operator's readable-raw-config finding rejects the boundary without reading its
  contents. Include deployment sentinels under a separate-mount boundary as well as ACLs, distinguishing
  denied traversal from ENOENT. Trace calls to prove the scanner never opens/probes prohibited names,
  fallback paths or sibling secrets; the separate operator check may `access`/`stat` those names.
- Delivery 1b: add/replace/remove/select/retire/unretire roots; same count with another identity; date
  boundaries at root and machine retirement; frozen snapshots byte-stable; lost snapshots; root source
  provenance on retained/legacy units; never-answered retirement with an empty attested snapshot,
  registration/date limits and later complete post-retirement proof. Retired root plus disjoint live
  default usage on one day/provider must count both once; a higher-scoring **saved machine** unit that
  already contains the retired root must not receive it again. Cover none/all/partial overlap against
  the chosen candidate and two snapshots sharing a physical file; unknown ownership retains the
  unsplit winner/floor and does not add ambiguous rows. Both plan comparison paths and existing
  RFC 0005 consumers refuse floors, old basis and changed population; explicitly empty-root bases
  compare only when equal.
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
  zero raw shared paths/content in collector stdout/stderr/progress/trace/audit/saved scans; inspect the
  root-enabled memory adapter so the permitted private pipe never becomes a raw staging file or log.
  Key stays collector-local; same-account default/root tags join, hardlink file ids match. Default-only
  stores still work. Update public schema/skill together. Run `make check`; any drawing change also supplies a
  rendered image actually inspected. RFC-only delivery runs no private proof or feature experiment.

## Open questions (for the owner)

Each answer is one word. `yes` alone takes every recommendation below; it does not assert delivery has
shipped. Questions 1, 2 and 4 block delivery 1a (and therefore 1b); question 3 blocks 1a's declaration
and 1b's lifecycle interface; questions 5-6 block delivery 2; question 7 blocks delivery 3.
Status remains Queued until the owner schedules and answers the blocking decisions.

1. **Patterns.** `bindings` (recommended): exact vendor homes, including nested agent homes, with
   section 2's narrow patterns. `discover`: design a separate enumerated agent-home layout first;
   delivery 1a waits for that contract rather than recursively guessing.
2. **A failed usage root.** `machine` (recommended): whole relevant machine usage is a floor, no plan
   proof or usage comparison. `scoped`: deliver only root-level observations until a separate plan
   partition/proof contract can establish which aggregate is complete; delivery 1a waits for it.
3. **Declaration and retirement.** `commands` (recommended): section 1 commands and RFC 0002 frozen
   snapshots/proof, with private settings: declaration/boundary in 1a, lifecycle in 1b. `settings`:
   edit the same validated local file only; define an equivalent explicit snapshot transition before
   shipping 1b's retirement. No deletion-as-retirement.
4. **Coverage location.** `roots` (recommended): new `source_roots`, preserving machine fields.
   `machines`: design a versioned combined machine/root schema first; delivery 1a waits for it.
5. **Account attribution.** `derived` (recommended): producer exposes account/organization ids, plan,
   seat and tiers **only**, under section 3's schema. `unattributed`: no derived account reads;
   keep tokens/API value and the per-plan incompleteness disclosure. Raw `.claude.json` stays denied.
6. **Model attribution.** `derived` (recommended): model **only** file, with per-record evidence first.
   `unknown`: no derived model reads; absent reliable recorded model stays model unknown with unpriced
   coverage. Raw Gemini/Antigravity `settings.json` stays denied under either answer.
7. **Project paths.** `mapped` (recommended): explicit prefix mappings plus read-only bounded metadata
   and token-URL refusal. `unresolved`: no mounted metadata reads; usage remains in RFC 0004's
   no-repository bucket when safe transcript evidence cannot name its project.
