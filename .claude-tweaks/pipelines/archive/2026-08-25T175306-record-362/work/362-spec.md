---
record: 362
origin: human
risk: low
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 362: Guidance gap: a spec's self-flagged risk has no forced resolution step, and brief-compliance-only reviews can rubber-stamp it

Surface: backend

## Current State

claude-tweaks already tracks "flagged risk" content on a shaped record in several places, but no
step ever forces independent verification of it against the real artifact it's about:

- `skills/specify/shaping-mode.md`'s framing-check step folds a `solution-baked` verdict's named
  assumptions into the body's `## Gotchas` section as bullets, each carrying its own validation
  status (e.g. "assumes X — unvalidated").
- `skills/specify/red-team.md`'s persona write-back inserts an inline HTML-comment ambiguity marker
  (naming the flagging persona, the finding, and an optional suggested resolution) directly after the
  flagged sentence, and accumulates general findings into an `## Open Questions` table.
- `skills/specify/spec-template.md`'s "Empirical Premise-Check Deliverables" section already calls
  for a blocking "Task 0" deliverable when a spec's technical approach rests on an assumption about
  external system behavior — but this only fires at spec-authoring time, for that one class of
  assumption.
- `skills/review/SKILL.md` Step 1 ("Spec Compliance Check") is the whole-branch gate that checks a
  build against its spec. Its method is explicitly brief-compliance: each Acceptance Criterion is
  marked `met` / `partially met` / `not met` based on whether the code satisfies what the spec
  *states* — never whether the spec's own stated value is correct against ground truth. A criterion
  built exactly to a wrong, unverified spec value reads as `met`.
- `skills/build/SKILL.md`'s per-task review (extended for #360) forwards the spec's own Acceptance
  Criteria into every per-task review dispatch, so a task brief that *misstates* a spec criterion can
  be caught — but per-task review checks diff-vs-brief, not brief-vs-reality, so a spec whose flagged
  risk was itself wrong survives unnoticed at that layer too.

Net effect: a Gotchas bullet still marked "unvalidated," an inline ambiguity marker, or an
`## Open Questions` row can ride through build and Step 1's compliance check with no forced
verification against the real schema/tool/validator for that artifact — exactly the failure mode
described in the filed report (a flagged risk survived four sequential brief-compliance reviews and
was only caught by a final review explicitly instructed to independently fact-check it).

**Premise re-verified on the current base (2026-08-25, this build's own check):** `skills/review/code-mode-steps.md`
Step 1 (the file `SKILL.md` delegates Spec Compliance Check to since #887's extraction) still runs
the exact brief-compliance-only method described above — Deliverables/Acceptance Criteria/Non-Goals
checked against the spec's own stated text, with a two-row Gate table (`Minor gaps` / `Significant
gaps` → flag-and-proceed or `BLOCKED`) and no sub-check for unresolved risk markers. A repo-wide
re-grep for other "unresolved assumption" marker conventions beyond the three named above (Gotchas
validation-status bullets, red-team's inline `<!-- ambiguity: -->` markers, `## Open Questions` rows)
turned up none — `decomposition-mode.md`, `work-record.md`, and `_shared/multi-agent-coordination.md`
all reference the same three conventions, never a fourth. The gap is real and unfixed; this record is
not stale.

## Deliverables

- [ ] Extend `skills/review/SKILL.md` Step 1 (Spec Compliance Check) with a named sub-check that
      runs before/alongside the existing Acceptance Criteria check: scan the spec (the materialized
      copy at `{run-dir}/work/{n}-spec.md`, the same file Step 1 and `build/SKILL.md` already read —
      no separate fetch) for unresolved risk markers — Gotchas bullets whose validation status is not
      "validated" (e.g. contains "unvalidated," "assumed," "unconfirmed"), inline ambiguity markers
      (red-team's per-sentence HTML-comment convention), and `## Open Questions` rows.
- [ ] For each marker found, the sub-check's instruction requires independently verifying it against
      the real external validator/schema/tool for that artifact — explicitly stating that a
      structural/syntax check alone is insufficient (necessary but not sufficient), matching the
      filed report's own framing.
- [ ] Extend Step 1's Gate table (or add a row) so an unresolved risk marker that cannot be
      independently verified routes to `BLOCKED` — the same tier as "Significant gaps" — never
      "proceed" or "minor gap."
- [ ] Cross-reference the new sub-check from `spec-template.md`'s "Empirical Premise-Check
      Deliverables" section, so a spec author and Step 1's reviewer read the same rule from either
      side of the spec/review boundary.

**Materialization note:** `skills/review/SKILL.md` Step 1 (Spec Compliance Check) was extracted into
`skills/review/code-mode-steps.md` under #887, before this record was filed. The deliverable above
targeting "`skills/review/SKILL.md` Step 1" is satisfied by editing Step 1's actual current home,
`skills/review/code-mode-steps.md` — same section, same step number, relocated file — per
`materialize.md`'s Named-location drift guidance (#315): verify the named location before scoping
the edit to it, don't build against a stale path.

## Acceptance Criteria

- [ ] `skills/review/code-mode-steps.md` Step 1 (Spec Compliance Check — the current home of
      `skills/review/SKILL.md`'s former Step 1, post-#887 extraction) documents a named sub-check
      whose marker vocabulary — Gotchas non-"validated" bullets, red-team's inline ambiguity markers,
      `## Open Questions` rows — matches the real syntax already shipped in
      `shaping-mode.md`/`red-team.md` (grep-verified, not invented terminology).
- [ ] The sub-check's instruction text explicitly distinguishes a structural/syntax check from
      verification against the artifact's real external validator/schema/tool, and states the former
      is insufficient on its own.
- [ ] Step 1's Gate table routes "unresolved risk marker, not independently verified" to `BLOCKED`.
- [ ] `spec-template.md`'s Empirical Premise-Check Deliverables section cross-references the new Step
      1 sub-check.
- [ ] No new label or facet is introduced — confirm via `git diff --stat` that only prose in
      `skills/review/code-mode-steps.md` and `skills/specify/spec-template.md` (and any skill-prose
      conformance test pinning either file's Step 1 / Empirical Premise-Check text) changed.
- [ ] `npm test` passes.

## Technical Approach

Primary edit: `skills/review/code-mode-steps.md` Step 1 (Spec Compliance Check — the current home of
`skills/review/SKILL.md`'s former Step 1, see Materialization note above), following the same style
`build/SKILL.md`'s existing "Forward the spec's Acceptance Criteria to per-task review" instruction
(added for #360) already uses in this codebase — explicit, named, sourced from the materialized spec
file, not a new plumbing mechanism. Do not invent new marker syntax: reuse exactly the three
conventions already shipped (Gotchas validation-status bullets, red-team's inline ambiguity markers,
`## Open Questions` table). Re-grep `skills/specify/` and `skills/_shared/` for any other
"unresolved assumption" marker convention before finalizing the exact scan list, in case one exists
outside the three files already read for this shaping pass — re-run for this build (2026-08-25):
none found beyond the three (see Current State's re-verification note).

### Key Files

- `plugin/skills/review/code-mode-steps.md` — Step 1 (Spec Compliance Check) gets a new named
  sub-check (risk-marker scan + independent-verification instruction) and an added Gate table row
  routing an unresolved, unverifiable marker to `BLOCKED`.
- `plugin/skills/specify/spec-template.md` — "Empirical Premise-Check Deliverables" section gets a
  cross-reference to the new Step 1 sub-check.

## Gotchas

- The concrete incident that prompted this report happened outside claude-tweaks (a dependency's own
  plan/review flow). This spec is scoped to adding the missing guidance inside claude-tweaks's own
  `/review` skill — not to auditing or patching whatever external flow actually failed.
- Overlap with #360 (closed) is real but the two don't conflate: #360 fixed per-task review not
  checking the parent spec's Acceptance Criteria at all. #362 is one layer further — even with AC
  correctly forwarded, a *wrong* AC (because it inherited an unverified flagged risk) still reads as
  `met` under Step 1's existing brief-compliance method. #362's fix targets Step 1's *verification
  method* against ground truth, not *what* gets forwarded to per-task review.
- "Independently verify against the real validator/schema/tool" is necessarily artifact-specific —
  word the sub-check's instruction as the general principle (never accept a structural check as
  sufficient) rather than prescribing one universal verification mechanism, since the real tool
  varies per spec (an API schema, a CLI's actual flag set, a config file's real shape).
- The marker-vocabulary list above (Gotchas validation-status bullets, red-team's inline ambiguity
  markers, `## Open Questions`) is drawn from a shaping-time read of `shaping-mode.md`, `red-team.md`, and
  `spec-template.md` — validated (2026-08-25, this build) against a full repo-wide grep for other
  assumption-marking conventions: none found beyond the three.
- `skills/review/SKILL.md`'s Step 1 text moved into `skills/review/code-mode-steps.md` under #887
  (a file extraction, not a content change to Step 1 itself) — the spec's own Deliverables/AC text
  above still says "`skills/review/SKILL.md` Step 1" verbatim (preserved from the original filing);
  the Materialization note and Technical Approach above are this build's authoritative pointer to
  the real file, per `materialize.md`'s Named-location drift guidance.
- This record was previously attempted (2026-08-24, run `2026-08-23T211418-record-362`) and released
  after a test-gate failure traced to pre-existing repo-wide CHANGELOG/shipped-versions drift on
  `origin/main` (filed separately as #1373) — not this record's own diff. This attempt starts fresh
  against the current base.

## Original request

Guidance gap: a spec's self-flagged risk has no forced resolution step, and brief-compliance-only reviews can rubber-stamp it

**Summary:** A spec's self-flagged "Open risk / assumption" survived four sequential task-level reviews unresolved, because those reviews only checked brief-compliance — the brief itself carried the unverified, ultimately-wrong value. Only a final whole-branch review caught it, and only because it was explicitly told to independently fact-check the flagged risk rather than confirm the diff matched the brief.

**Kind:** Gap

**Affected component:** general planning/review guidance — no specific claude-tweaks skill was involved in the concrete instance (it happened in a dependency's own plan/review flow), but claude-tweaks has no guidance of its own on this either, and is the natural place to carry it (per the routing contract's rule 7).

**Use case:** A design/spec document flagged a config field's shape as an "Open risk / assumption" (verified against no real schema at spec-writing time, only inferred by analogy to a similar-looking convention). The plan built from that spec carried the flagged, unverified value into a task brief. Four sequential task-level reviews all passed the resulting file as "spec compliant," because each review's method was "does the diff match the brief" — and the brief itself was wrong. The bug was only caught by a final, broader review that was separately instructed to independently verify the flagged risk against real ground truth (the actual schema/tool), not just confirm brief-compliance.

The gap: there's no guidance connecting "a spec flags a risk" to "a task is required to actually resolve that risk before the work is considered done, using the real validator/tool/schema for the artifact in question — not just a structural check (e.g. syntax validity, which is necessary but not sufficient for content with an external schema)." A prose flag in a design doc reads as informational, not as an open action item that must close before the work ships.

**Suggested guidance to carry:** when a spec/design doc flags an "Open risk / assumption," the plan implementing it should either (a) give the relevant task an explicit step that resolves the risk using the artifact's real validator/schema/tool, not just a syntax check, or (b) make resolving the risk its own task. Separately: task-level review criteria that check only brief-compliance cannot catch a wrong brief by construction — a broader/final review pass should be told which spec-flagged risks were carried through, so it can independently verify them rather than trust that "implementation happened" means "the risk was resolved."

This generalizes to any generated config/content with a real external schema or contract that a plan's author might get wrong by inference rather than verification.

**Plugin version:** 6.79.0

---
Filed via /claude-tweaks:feedback.

**Related:** #360
