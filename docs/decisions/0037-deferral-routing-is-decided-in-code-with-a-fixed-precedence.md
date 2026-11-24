# 0037. Deferral routing is decided in code, in one fixed precedence, with the run frictions set only by repository policy

- **Status:** accepted
- **Date:** 2026-11-20
- **Context:** #5930, #5931, #5932, #5933 (Phase 6 of `docs/superpowers/specs/2026-11-18-pipeline-economy-design.md`)

## Context

Runs filed 317 of the 586 records created between 8 and 18 November 2026 as deferrals, about two
per merged pull request. The reasons named were `pre-existing-outside-diff` 135, `tangential` 80,
`needs-human-decision` 71 and `genuinely-larger` 56. Two rules sent agent-noticed work to new
records anyway: `tangential` always filed, and `pre-existing-outside-diff` filed unless all three
axes were low.

The choice between filing a deferred item and appending it to the digest
(`plugin/skills/_shared/materiality-floor.md`) was prose that a model followed at about eight
sites: review Step 3 routing, reflect Defer, the wrap-up residue sweep and leftover routing,
visual-review's record branches, control mode's `belowFloor`, review-console step 10 and release
disposition. No code applied it, so the rule could not be changed in one place, and a count of
routings measured nothing. Any lever meant to file less had to be applied at every site and would
drift between them.

## Decision

One pure function, `plugin/bin/lib/deferral-route/route.js`, decides the route. Every site that
routes an item carrying a gate `Defer-reason:` runs `plugin/bin/deferral-route.js` and follows its
verdict (`file`, `digest` or `refused`). The function is the authority. `materiality-floor.md` is
its explanation, and an exhaustive oracle test pins the two byte-equal.

The first rule that applies decides, in this fixed order:

1. `refused`: a missing or unknown reason, no origin, or an unknown severity.
2. `human`: human input always files.
3. `severity`: a `high` or `critical` finding always files.
4. `policy-reason`: a reason listed in `deferral-digest-reasons` goes to the digest, whatever its
   axes.
5. `tangential`: a tangential idea files.
6. `not-low`: any axis not low files.
7. `floor`: otherwise, the item goes to the digest.

A `tangential` or `not-low` file then meets two frictions, in order. The first is `no-evidence`
(`filed-record-evidence: required`): `pre-existing-outside-diff`, `genuinely-larger` and
`tangential` need `--evidence test:{path}` or `ref:{id}`. The second is `run-cap`
(`run-filed-record-cap`): once a run directory's tally has reached the cap, the item goes to the
digest. Both frictions route an item to the digest and never drop it.

Human input and high severity sit above every policy clause, and no policy key can move them.
The two friction keys are `policyOnly`. Only `.claude-tweaks/policy.yml` sets them, and a run's
`config.yml` is ignored, so a run can never loosen its own evidence rule or raise its own filing
cap. `deferral-digest-reasons` keeps the run-config overlay.

This repository opts in with `deferral-digest-reasons: pre-existing-outside-diff, tangential`,
`filed-record-evidence: required` and `run-filed-record-cap: 1`. Every key defaults to today's
behaviour for other projects.

## Alternatives considered

- **Keep the rule as prose at each site.** Rejected because no single place could change the rule
  or count its verdicts, and a new lever would have to be restated eight times.
- **Fix outside-the-diff findings inside the run.** Rejected because it grows a diff beyond its
  record.
- **Drop outside-the-diff findings outright.** Rejected because it loses the 90-day digest window,
  in which a repeated finding can still be promoted.
- **Let a run's `config.yml` set the friction keys too, like `deferral-digest-reasons`.** Rejected
  at plan review. A run would be able to switch off the frictions meant to limit it.
- **Put the policy clause ahead of the severity override.** Rejected. A small fix to a `high`
  finding could then be digested where release Step 3's `high-severity finding` gate never looks
  again.
- **Make the axes an input the function computes.** Rejected because the floor is defined on how
  a record would be scored at filing time, and only the filing skill can judge that. The axes stay
  the caller's judgement.
- **Have each site cite the floor's command instead of carrying the full form.** Declined (#5931).
  Each site needs a literal runnable command, and the conformance suite runs every documented copy
  through the real CLI, so the copies cannot drift. The cost is that a new flag touches eight
  sites, as `--run` and `--evidence` did.

## Consequences

- A rule change is one clause in `route.js` plus its oracle, and the verdicts are countable per
  `rule`.
- The CLI is a public contract that sites in live sessions on older releases call. Its output
  keys, its `verdict` and `rule` vocabularies and its exit codes only grow. A later input must be a
  flag whose default reproduces the previous verdict. Moving the rule back into prose, or removing
  a rule, needs expand-contract (CLAUDE.md).
- Digested items depend on `tidy/digest-sweep.md`'s lifecycle: a promotion proposal once three
  entries share an area, and expiry after 90 days un-promoted. Changing either changes this
  policy's effect. An unpromoted single entry expires unfiled, and that is accepted.
- The origin flags are caller-declared and the CLI cannot verify them. A site passes `--human`
  whenever the origin is unsure, because `--human` files.
- The evidence check is form-only. It cannot detect a fabricated citation.
- The cap counts verdicts given, not records landed. It is first come, first served within a run,
  and it is best-effort under concurrency: parallel callers in one run can file up to the cap plus
  the number of simultaneous callers. Each multi-spec member's `spec-{N}/` directory keeps its own
  tally.
- Outside this decision: the five health sweeps (their findings carry no gate reason), the
  console's can't-tell digest and ledger narrowing keep their own rules. Revisit them if any of
  these starts carrying a `Defer-reason:`.
- Revisit this decision if the digest lifecycle changes, or if the counted `rule` tallies show the
  cap or the evidence rule digesting work that later had to be filed by hand.
