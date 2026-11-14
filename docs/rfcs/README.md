# worthit RFCs

An RFC here is a short design for one open decision: something that needs a decision before code or
sets a public contract (a data field, a command, a file the store keeps, what leaves the machine).
Work that is already scoped as an issue ships as a plain fix and needs no RFC. The process follows
Automagik's.

## Status values

| Status | Meaning |
|---|---|
| Queued | Written, not yet in delivery. Its open questions wait for the owner. |
| Accepted | Scheduled by the owner, with no delivery merged yet. |
| In delivery | Accepted, with some deliveries merged and the rest still open. |
| Delivered | Every delivery merged. Kept as the record of the design. |
| Parked | Not scheduled. It keeps its number. |
| Superseded | Replaced by a later RFC or owner decision, named in its Status. |

## Process

1. An RFC lands as docs only. Every commit in its PR is typed `docs(rfcs): ...`, so the merge cuts no
   release.
2. The owner schedules it and answers the questions that block it. It moves to Accepted.
3. Each delivery is one issue and one PR that closes it. A delivery is small and complete for the person
   running `npx worthit` at merge. Its PR names the RFC ("RFC 0002") in the title or the description.
4. When the first delivery merges the RFC is In delivery; when the last one merges, Delivered. The status
   line names the PRs, and its date is the date of the last merged change.

Milestones are named for an outcome a person can feel, never for a version: every merge cuts a release,
so a version number says nothing about what a person gets.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-how-worthit-ships.md) | How worthit ships | In delivery (versions and releases: in use since v0.1.0; review, dogfood and tests: open) |
