# 0040. Learned-skills PRs merge without review once green

- **Status:** accepted
- **Date:** 2026-11-23
- **Context:** #6109 (reverses the ruling in #5290; the 2026-11-23 ruling is #6088)

## Context

#5290 ruled that a learned-skills PR waits for a human, because "an instruction change that merges
with no review is what the floor exists to stop". The floor is `merge-check`'s agent-instruction
floor: a diff that edits skill or agent instructions is never merged without a person looking at it.

The evidence since then says the review does not happen in practice:

- The maintainer reports not reading these diffs.
- The PRs merge in batches, minutes apart, which is a click-through and not a review.
- Waiting costs real time: 36 learned-skills PRs in a week, with a median of 19 hours open.
- The PRs touch the same skill files, so they conflict while they wait. #6083 was a hand fold of ten
  conflicting PRs.

#6088 (2026-11-23) ruled that the floor buys nothing here and costs a queue, and reversed #5290 for
this one PR kind.

## Decision

The learned-skills PR merges once CI is green, under the policy key `learned-skills-auto-merge`.

**Boundary.** The reversal covers the learned-skills PR only. A record's own diff, the record-owned
run-branch route and console-approved skill updates keep `merge-check`'s agent-instruction floor
unchanged.

**Green.** Every check on the PR head completed successfully. No checks, only skipped checks, or any
pending check counts as not green.

**Who can turn it on.** The key is boolean, advanced tier, schema default `false`. Its unset default
derives `true` only when `autonomy` resolves `unattended` and `control-mode` does not resolve `on`:

- `unattended` alone turns the default on because that setting is the maintainer's own consent to
  unreviewed merges.
- `control-mode: on` vetoes an unset default, and so does an invalid `control-mode` value in
  `policy.yml` (`On`, `yes`): a malformed control-point setting fails closed, never open.
- An explicit value always wins, in both directions.
- The key is `policyOnly`, so a run config can never set it. It stays factory-settable: the factory
  layer is the maintainer's own user-wide consent, like `policy.yml`. The derivation also reads
  `autonomy` with the run-config source skipped, so a run config cannot turn the key on indirectly
  through `autonomy: unattended` either. The key removes a human-review floor, and a run's own agent
  writes that run's config (the reason `control-mode` became `policyOnly` in #5830).

**Rollout.** The decision takes effect only once the learned-skills `drain` and the PR-scan
sub-issues land. Until then the existing "waits for a human" prose stays authoritative, and the key
alone changes nothing.

**Undo.** A bad merge is undone with `git revert` of its squash commit.

## Alternatives considered

- **Keep the floor and speed up the review.** Rejected: the diffs are not being read, so a faster
  queue only produces faster click-throughs.
- **Reuse `housekeeping-auto-merge`.** Rejected: it would widen what a housekeeping grant means in
  every consumer project.
- **Let a run config set the key.** Rejected: the run's own agent writes that config.

## Consequences

- Under `autonomy: unattended` without `control-mode: on`, learned-skills PRs stop queueing and land
  as soon as CI is green.
- The agent-instruction floor still holds for every other PR kind. Any proposal to widen this
  exception should meet the same bar: a named PR kind, evidence that review does not happen, and a
  revert path.
- A maintainer who wants the review back sets `learned-skills-auto-merge: false` explicitly, or
  `control-mode: on`.
