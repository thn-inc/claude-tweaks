# 0041. The express lane ships on by default and fails closed on an invalid value

- **Status:** accepted
- **Date:** 2026-11-25
- **Context:** #4591 (the decision was approved on 2026-10-30 during #4365's brainstorm; the
  fail-closed rule was decided on 2026-11-25 at plan review)

## Context

The express lane (#4025, shipped in #4354) builds a small, low-risk singleton record, runs its
impacted tests, opens its PR and merges on green in one agent, outside `/claude-tweaks:flow`'s
frame. It runs no review before the merge. Its policy key `express-lane`
defaulted to `false`, so a project got the lane only by setting the key in `policy.yml`. No project
did, so the lane never ran.

Decision record 0012 ships the top autonomy tier shut: `unattended`'s born-authorized filing needs a
second, explicit opt-in, because turning it on would let machinery originate a merge grant. Turning
the express lane on by default looks like the same kind of step. This record explains why it is not.

## Decision

`express-lane` defaults to `true`. A project turns the lane off with `express-lane: false`.

**An invalid value fails closed.** When `policy.yml` sets `express-lane` to something that is not a
boolean (`off`, `no`, `False`), `express-lane.js gate` refuses every record with the reason
`express-lane value invalid — treated as off`, and the record goes down the normal path. The generic
invalid-value fallback, which replaces a malformed value with the key's schema default, stays
unchanged for every other key. Without this rule, a typo'd opt-out would fall back to the new
default and turn autonomous merging on.

**Why on, while 0012 ships the top tier shut.** 0012 guards who may grant merge authority. The
express lane grants none. It removes review ceremony only:

- It merges only a record that already carries `auto:merge` and `auto:build`, or, from
  `/claude-tweaks:flow`, one whose merge authorization passes `manifesto-authorized-merge.md`'s
  Applicability check. Without either, the PR stays in draft for a human.
- It takes only `risk:low` × `size:low` × `ceremony:fast-lane` records with a `type:*` label and at
  most 3 Key Files, and refuses a record that carries a kept risk flag.
- Before it merges, it still runs the content judgment the normal auto-merge path runs:
  `/claude-tweaks:assess-agent-autonomy`'s `merge-check`, told the lane ran no review. Any verdict
  but a confirmed `auto-merge` leaves the PR in draft as `pending-review`.
- It refuses frontend surfaces, the shipped protected paths (`protected-paths`) and the project's
  `merge-sensitive-paths`.
- It requires `integration-model: pr-first`, `gh`, and green PR CI. A repo with no PR CI reads as
  pending, so its express merges park.
- Every record the gate refuses, and every record that escalates mid-lane, goes down the normal path.

**What stands in for the skipped review.** Post-merge sampling: `express-review-sample-every`
(default 5) sends every Nth express merge through the normal review lenses after it lands, and files
what they find as records. The bare `/claude-tweaks:dispatch` drain sweeps every due PR, and
#4365's foreground check reviews a session's own express PR right after it merges.

## Alternatives considered

- **Keep the lane opt-in.** Rejected: with the key defaulted to `false`, the lane never ran, so its
  merge bounds and sampling were never exercised on real records.
- **Use the generic fallback for a malformed value.** Rejected: the fallback resolves to the schema
  default, which is now `true`, so `express-lane: off` would turn autonomous merging on for a
  project that tried to turn it off.

## Consequences

- An existing install with `pr-first`, PR CI and small `auto:merge` records starts express-merging
  on upgrade, with no policy edit.
- The queue pull (`bin/lib/express/queue.js`) still reads only the value, so an invalid value keeps
  an otherwise-eligible singleton out of a fast-lane bundle; the gate then sends it down the normal
  path. The gate is the one place that acts on an invalid value.
- A project that wants every record reviewed before merge sets `express-lane: false`.

**Revisit when** a sampled post-merge review finds a regression that an express merge shipped, or
sampled reviews file findings on express PRs at a higher rate than on normal-path PRs.
