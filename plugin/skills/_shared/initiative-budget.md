# Initiative Budget

Single source of truth for the in-run initiative budget — the narrow carve-out that lets a run
**repair a reference its own change broke** instead of filing a record about it. Referenced, not
restated, by every consumer: `_shared/auto-mode-contract.md` ("code modifications outside the
skill's documented scope" row), `_shared/autonomy-ceiling.md` (the `trusted` tier row),
`wrap-up/docs-health-integration.md` (D1 staging), `wrap-up/review-console.md` (the Review
Console), `wrap-up/execution-and-verification.md` (Phase 4 execution's separate commit).

It has **no lever of its own.** It is authorized by `autonomy: trusted` or `unattended`
(`_shared/autonomy-ceiling.md`) and by nothing else. Do not add an `initiative-budget:` key to
`policy.yml` or the Manifesto — the ceiling is the dial, and a second dial for the same decision
is how the two drift apart.

## What it authorizes

Exactly one behavior: applying a **pointer repair** during the run instead of staging it for the
Wrap-Up Review Console. Everything else a run notices is still filed or staged, unchanged.

A pointer repair is a reference that points at something **this run renamed, moved, or removed** —
a path, an anchor, a symbol name, a step number, a heading. The old target provably no longer
exists; the new one provably does.

## Why this is not the scope expansion the contract forbids

`_shared/auto-mode-contract.md` lists *"code modifications outside the skill's documented scope"*
under what `auto` never silences, on this reasoning: *"If a skill is asked to do X and would modify
Y to make X work, that's a scope expansion the user must authorize."*

That row is about a skill reaching outward to make its own work succeed. A pointer repair is the
inverse: Y is broken **because of** X, and X is not finished while Y still points at what X moved.
Repairing it is completing the change, not expanding it. `/claude-tweaks:assess-agent-autonomy`
already reaches the same conclusion independently — it classifies "a stale cross-reference repaired
after a file split" as `auto-merge` eligible, calling it *pointer repair*, on the grounds that the
refutation attempt comes up empty: no agent behaves differently afterward, it just finds the target.

**The distinction is causal, and it is the whole carve-out.** A gap the run merely *noticed* — a
pre-existing inconsistency, a typo it did not create, a doc that was already stale — is still filed,
never fixed, at any ceiling. Losing that distinction turns the budget into a licence to make small
edits anywhere, which is exactly what the contract row exists to prevent.

## Floor rule

Implemented by `bin/lib/issues/initiative-budget.js`'s `permittedInitiative`. A fix applies only
when **all** of the following hold; anything ambiguous or unrecognized fails closed, exactly as if
the ceiling were `supervised`:

| Check | Rule |
|---|---|
| Ceiling | `trusted` or `unattended`, matched exactly. `Trusted`, `TRUSTED`, and any unknown value deny. |
| Kind | `pointer-repair`, from an **allowlist**. A kind the module has not been taught denies — the `[IL-101]` inversion, for the same reason. |
| Causal link | `brokenBy` names a file **this run changed**. A repair that cannot name what broke it is a scope expansion wearing a repair's clothes. |
| Budget | At most **3** fixes per run. |
| Size | At most **2 files** and **20 changed lines** per fix. |
| Tests | Never a test file. Retargeting a test's assertion at a renamed path makes a failing test pass, which is the one shape that turns "repair" into "silence the check". |
| Merge-sensitive | Never a path matching `merge-sensitive-paths` (`_shared/policy-schema.md`); the match is also made case-folded (lower-cased path against lower-cased globs), and a `sensitivePaths` that is not an array of glob strings is unreadable, which denies and holds. |

The budget is per run, not per skill or per commit — three repairs across a whole run, so a run
that finds a fourth stages it like any other proposal rather than starting a fresh allowance.

Every result also carries a boolean `hold`, computed from the floor conditions whichever check
fails first: `true` when kind, causal link, tests or merge-sensitive fails, when the ceiling is
unknown, or when the fix itself is missing or malformed; `false` for an allowed fix and for a fix
denied only by a `supervised` ceiling, the budget or a size cap. `wrap-up/reference-sweep.md` Step
4 writes `hold` into the finding's JSON and the staged file's `Hold:` header, and the Review
Console resolver approves only when both say no and its own test-path and merge-sensitive check
over the staged diff finds no hit.

## Commit discipline

Initiative fixes go in their **own commit**, never mixed into the run's work commits, with a
trailer naming the run:

```
Repair references broken by this run's own change

Initiative-Fix: {run-id}

Claude-Session: {session-url}
```

This is not cosmetic. `/claude-tweaks:review` is handed a diff to review against a spec; folding
unrequested edits into it makes the review scope illegible and the diff harder to reason about —
the risk the design doc flagged for this feature specifically. A separate commit keeps the run's
work reviewable on its own and makes every initiative fix trivially `git revert`-able in isolation.

## Logging

One `decisions.md` entry per applied fix, in the shape every other auto-decision uses:

```
AUTO {time} — {what}. Reason: {policy-source}. Reversibility: high.
```

Example:

```
AUTO 15:04:22 — Initiative fix 1/3: repaired 2 references in docs/plugin-structure.md broken by skills/build/worktree-setup.md (pointer repair, 4 lines). Reversibility: high (separate commit, git revert).
```

A fix applied with no log entry is forbidden, exactly as for every other auto-resolved decision.

## Review Console

Every applied fix renders in the Review Console's Auto-applied section, one row per fix, naming
the file repaired, the change that broke it, and the commit. They are reported, never re-approved
— the point of the budget is that they already happened. A fix that was **denied** by the floor
rule renders in its normal staged section instead, with the denial reason, so a run that trips a
cap is visibly different from a run that found nothing.

## Error handling

Every failure path fails toward staging, not toward silence or toward applying:

- The floor check denies for any reason — stage the proposal as normal; the console shows it.
- The repair's edit fails to apply, or the target is ambiguous (two plausible new targets) —
  abandon it, log the abandonment, stage it instead.
- The separate commit fails — the edits are still in the tree; do not fold them into a work
  commit to recover. Surface the failure and let the console present them.
- The run's changed-file set cannot be determined — deny every fix. Without it the causal link is
  unverifiable, and an unverifiable causal link is the one thing this budget must never assume.
