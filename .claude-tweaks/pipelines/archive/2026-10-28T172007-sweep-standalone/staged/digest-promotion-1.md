# Tidy — staged digest cluster: `hooks` area (4 entries) → absorb into #4405

**Action:** Propose digest cluster, applied as an absorb into the existing open record rather than a new one
**Container:** digest #1426
**Target:** #4405 — "Settle 10 below-floor digest findings in hooks" (open)
**Reversibility:** med (outward GitHub body edit plus comment-line markers)

## Why absorb instead of filing a new record

`digest-sweep.md`'s cluster promotion files one spec-shaped issue per area once 3+ un-promoted entries share it. For `hooks`, #4405 already exists as the open settle record for this area, and filing a second one would split one area's settle work across two near-duplicate records. None of the 4 entries' materiality fingerprints appear in #4405's body (checked at staging time).

## Entries (verbatim from #1426)

1. comment 6436927443 — `[hooks]` Fail-closed rationale comment points at "the Global Constraints note in the plan this module was built from" with no plan path or record number; plans are deleted at close-out, so the pointer is dead — plugin/bin/lib/hooks/resume-freshness.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone — `materiality-9ce2c3f0`
2. comment 6436927443 — `[hooks]` adoptionRefusal still returns refusal token 'dead' beside the #4419 comment saying a runLiveness dead verdict stays adoptable, with no note that the token is a legacy reason name (info: reader confusion only) — plugin/bin/lib/hooks/run-dir-resolve.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone — `materiality-898a6f76`
3. comment 6450608149 — `[hooks]` Squash-erased "this branch" referents and a branch-only commit cite (df7bf7f9f) in the lost-cwd docs and comments; a ready patch rewrites them to #4303 / 4d81a3e0c (staged review-1.patch, applies cleanly on 4d81a3e0c) — plugin/skills/_shared/policy-schema-coverage.md, plugin/bin/lib/hooks/git-command.js, plugin/bin/lib/hooks/pre-tool-use.js, .claude/skills/pre-tool-use-gate-exemptions/SKILL.md — Defer-reason: pre-existing-outside-diff — 2026-10-27T161535-release-standalone — `materiality-ce0b7f15`
4. comment 6450608149 — `[hooks]` The lost-cwd paragraph's Known-gaps list says a case body is not followed, but the walk follows case arms; only the first command of an if/while/until/for body is missed (staged review-2.patch narrows the wording) — plugin/skills/_shared/policy-schema-coverage.md — Defer-reason: pre-existing-outside-diff — 2026-10-27T161535-release-standalone — `materiality-125d563c`

## Mutation on approval

1. Re-read #4405 (still open) and the 4 entry lines (still un-marked).
2. Append the 4 entry lines verbatim as Deliverables bullets in #4405's `## Deliverables`, and update its title/Current State count from 10 to 14.
3. Append ` → #4405` to each of the 4 entry lines in their #1426 comments (per-line markers).

## Decision-log reference

STAGED — Step 6: digest cluster `hooks` (4 entries) proposed as an absorb into #4405 (an open settle record for the same area already exists). Stage path: staged/digest-promotion-1.md.
