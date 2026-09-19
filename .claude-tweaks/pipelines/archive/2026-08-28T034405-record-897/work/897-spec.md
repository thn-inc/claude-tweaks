---
record: 897
origin: human
risk: low
size: medium
ceremony: standard
grants: [build]
fingerprint: build-objectives-restructure:build-extract-plan-authoring-checks-and-common-step-2-dispat
surface: backend
---
# 897: build: extract plan-authoring checks and Common Step 2 dispatch detail into lazy-loaded sub-files

Surface: backend

## Overview

`plugin/skills/build/SKILL.md` measures 40,259 of 40,960 bytes — 701 bytes of headroom, the fullest file in the skill family — yet it is the always-loaded spine carrying rare-path detail needed only at specific steps. Extract two lazy-loaded sub-files: `plan-authoring.md` (the five plan-authoring check bullets from Spec Step 3) and `dispatch.md` (Common Step 2's subagent-branch detail). SKILL.md keeps step skeletons plus mandatory one-line pointers, following the established `plan-audit.md` lazy-load pattern.

Byte accounting (measured 2026-08-18, pre-#257): the five checks span 3,718 B (lines 118–126); the movable Common Step 2 block — the `tier=frontier` guard paragraph, the strategy precondition, and the **subagent** bullet — measures ≈5,300 B (the 196–207 range is 5,811 B minus the retained 496 B Working Directory Discipline blockquote). ≈9,000 B moves out; ≈600 B of pointer/stub lines comes back in; projected post-extraction size ≈31.9 KB against AC 1's ≤32,768 target. Re-measure both spans after #257 merges — the target holds with ~900 B margin, so a modest #257 addition doesn't sink it, but the plan must re-verify.

This buys the headroom open records need: #734's gate-over-producers check and #641's prose-check half are each one paragraph of roughly 0.6–1 KB (the incident behind #641 was a 636-byte paragraph vs 349 B of headroom) — impossible at 701 B of headroom, trivial in a near-empty `plan-authoring.md`.

**Complexity:** Medium
**Estimated tasks:** 5

## Non-Goals

- No new checks — #734's gate-over-producers content stays its own record and lands after this one
- No rewording of any check's substance — verbatim moves plus the three sanctioned connective edits named in Technical Approach
- No changes to `plan-audit.md` or check mechanization (#903)
- No degrade-trace logging (#904)

## Prerequisites

| Spec | Title | Status |
|------|-------|--------|
| #257 | build: pre-dispatch verification pass over each task's own stated acceptance command | **Hard block — do not start until #257's PR merges.** It edits `build/SKILL.md` + `plan-audit.md` (live claim, 72h TTL from 2026-08-18). After it merges, re-take the verbatim baseline from the post-#257 text; if its diff touched the extracted spans, the post-merge text IS the baseline. The Gotchas' merge checkpoints cover drift *during* this build, not a substitute for this gate. |

## Current State

- `plugin/skills/build/SKILL.md` — 40,259 bytes. Spec Step 3 (lines 118–126, 3,718 B) carries five plan-authoring check paragraphs: Plan-authoring check, Blocking-verification-downgrade check, Deictic-reference re-resolution check, Verbatim-command run-once check (the only one carrying an inline incident citation — #608/#610), Degrade-clause convention check — each ending "(Same check applies in Design Step 3 below.)". Design Step 3 (line 158) picks all five up via one cross-reference sentence ("Same plan-header artifact rule and plan-authoring check as Spec Step 3 apply"). Common Step 2 (lines 196–207) inlines: the `tier=frontier` guard paragraph (line 196), the numbered strategy precondition (lines 198–203), the Working Directory Discipline blockquote (line 205, 496 B — **stays**, it applies to both strategies), and the ~500-word **subagent** bullet (line 207: `size:`-header tier resolution, `tier=` token rules, AC-forwarding, frontier resolution, whole-branch review-model pinning). The maturity-scaled test-discipline table (lines 211–219, own intro sentence "Maturity-scaled test discipline (both strategies, all modes)") — **stays**.
- Lazy-load precedent: `plan-audit.md`, `build-options.md`, `worktree-setup.md`, `architecture-alignment.md` are all cited from SKILL.md steps by one-line "read X in this skill's directory" pointers.
- `docs/plugin-structure.md` — the per-skill sub-file table that must gain both new rows.
- Tests: conformance suites pin skill prose repo-wide (byte ceilings via `context-cost.js`'s constant, pinned by `tests/bin-lib/harness-health/skill-md.test.js`; content pins found by grepping distinctive phrases of the moved text across `tests/`).

## Deliverables

- [ ] `plugin/skills/build/plan-authoring.md` — new sub-file: the five checks moved verbatim (inline incident citations preserved where present — today only the Verbatim-command check has one), the per-check "(Same check applies in Design Step 3 below.)" suffixes dropped in favor of one header applicability line: "These checks apply to plan authoring in both Spec Step 3 and Design Step 3." Plus a one-line scope note that future plan-authoring checks land here.
- [ ] Spec Step 3 keeps its invocation/context/plan-header paragraphs and replaces the five check paragraphs with: "Before finalizing the plan, read `plan-authoring.md` in this skill's directory and apply every check it defines." Design Step 3's cross-reference sentence is replaced by the same pointer sentence (a direct pointer, no longer routed through Spec Step 3 — sanctioned structural change, see Technical Approach).
- [ ] `plugin/skills/build/dispatch.md` — new sub-file: the `tier=frontier` guard paragraph, the strategy precondition, and the **subagent** bullet's full detail. In SKILL.md, the **subagent** bullet is reduced to this retained skeleton: "**subagent** (default): read `dispatch.md` in this skill's directory and follow its full dispatch procedure — tier resolution, `tier=` token handling, AC-forwarding, and review-model pinning. After the final code review completes, **stop the skill and return here** — do not let it invoke `/superpowers:finishing-a-development-branch`." The **batched** bullet, the Working Directory Discipline blockquote, and the maturity-scaled test-discipline table stay in SKILL.md unchanged.
- [ ] `docs/plugin-structure.md` sub-file table gains both rows
- [ ] Conformance tests re-pinned to the new locations; full suite green

## Acceptance Criteria

1. `wc -c plugin/skills/build/SKILL.md` ≤ 32,768 bytes (derivation in Overview: ≈9,000 B out, ≈600 B in, from a 40,259 B pre-#257 baseline; re-verify the arithmetic against the post-#257 baseline in the plan)
2. Each of the five checks' full text appears exactly once repo-wide (in `plan-authoring.md`); grep each check's distinctive heading phrase to verify single-instance, and both Step 3 sites carry the pointer sentence naming `plan-authoring.md`
3. `dispatch.md` carries the `tier=frontier` guard and strategy precondition verbatim; SKILL.md's Common Step 2 subagent bullet is exactly the retained skeleton (Deliverables) and names `dispatch.md` as mandatory reading
4. Both new sub-files ≤ 40,960 bytes with ≥ 8 KB headroom each (`wc -c`) — 8 KB is a provisional floor sized for roughly ten future check paragraphs at the observed 0.6–1 KB each
5. `npm test` green — full suite, zero skips
6. `docs/plugin-structure.md`'s build sub-file table lists `plan-authoring.md` and `dispatch.md`

## Technical Approach

Verbatim extraction — never reword while moving (a move+reword diff is unreviewable and risks contract drift). Exactly three connective edits are sanctioned new/changed prose; anything beyond them is scope creep:

1. The applicability line replacing the five "(Same check applies in Design Step 3 below.)" suffixes.
2. The two pointer sentences (Spec Step 3 / Design Step 3) and the retained subagent-skeleton stub — quoted in Deliverables; use them as written.
3. Cross-file deictic repair: the moved text contains forward references written for one file ("the paragraph below", "binds only inside the **subagent** branch below" — SKILL.md lines 196 and 201). After the split these referents live in `dispatch.md`; rewrite each as a file-qualified reference ("the subagent procedure in this file", "binds only inside the subagent procedure below in this file") or restate without the deictic. Apply the same repair to any "above"/"below" in SKILL.md text that pointed *into* the moved spans.

Pointer lines copy the `plan-audit.md` citation pattern.

### Key Files

- `plugin/skills/build/SKILL.md` — shrinks; Spec Step 3, Design Step 3, Common Step 2 edited
- `plugin/skills/build/plan-authoring.md` — new
- `plugin/skills/build/dispatch.md` — new
- `docs/plugin-structure.md` — two table rows
- `tests/` — re-pins located by grepping distinctive phrases of the moved prose

## Gotchas

- The #257 gate is in Prerequisites (hard block). The merge checkpoints here cover *drift after starting*: merge origin/main immediately before plan authoring AND again right before the final whole-branch review; re-measure `wc -c` at merge time (merge-induced ceiling overflow is exactly #641's incident class)
- Conformance tests pin prose repo-wide — filename-matched test files are not enough; grep distinctive moved sentences across all of `tests/`
- Lazy-loaded checks bind only if read — the pointer must be a mandatory instruction inside the step body ("read … and apply every check it defines"), never a see-also
- Skill references inside actionable step text use the fully-qualified `/claude-tweaks:{skill}` form (CLAUDE.md Cross-references rule); bare short forms only in descriptive prose
- `docs/skill-graph.md` needs no edit — sub-files are not skill-graph edges

## Decision Rationale

See #896 (parent) — this is the first, enabling sub-issue of the decomposition: extraction precedes mechanization (headroom is the enabler), and a fresh `dispatch.md` was chosen over grafting onto the already-11,792-byte `build-options.md`.


<!-- work-fingerprint: build-objectives-restructure:build-extract-plan-authoring-checks-and-common-step-2-dispat -->
