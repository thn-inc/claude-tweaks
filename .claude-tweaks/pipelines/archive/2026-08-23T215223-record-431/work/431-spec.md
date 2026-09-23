---
record: 431
origin: human
risk: medium
size: medium
ceremony: standard
grants: [build]
fingerprint: reflect:demo-verdict-provenance
surface: backend
---
# 431: Demo verdict provenance: distinguish batch sign-off from walkthrough-backed approval in trust evidence

Surface: backend

## Current State

- `bin/lib/issues/trust.js` computes the grant/merge trust table's coverage/verdict for a cell by reading `demo:approved`/`demo:pending` labels as evidence (`coverage = dispositioned/cell.total` feeding `verdict`, trust.js:388-419) — every `demo:approved` label is read as equivalent regardless of how it was produced.
- `/claude-tweaks:demo`'s Step 3 approval action (`skills/demo/SKILL.md`) supports a `#N,#M,...` batch invocation, an explicit human-supplied list applied without a per-record walkthrough — a deliberately cheap, legitimate sign-off path distinct from the per-item walkthrough (Step 2).
- A per-record walkthrough-backed `demo:approved` label and a batch-applied `demo:approved` label are byte-identical on the wire; nothing in the label, the record body, or `trust.js`'s computation distinguishes them.
- Reference incident: a backlog-ops session (2026-08-14) batch-approved 22 `demo:pending` records (5 parent issues closed) with no per-record walkthroughs. The resulting `demo:approved` labels now read as demonstrated-acceptance evidence in the same coverage/verdict computation as walkthrough-backed approvals, with nothing recorded distinguishing the two (staged finding, wrap-up reflect, #365).

## Deliverables

- A provenance signal, recorded at apply time, for whether a `demo:approved` verdict came from a per-record walkthrough or a batch sign-off — e.g. a demo comment noting the provenance, or a distinct label variant (`demo:approved-batch` alongside today's `demo:approved`). The exact representation is an implementation choice to be made and justified (see Gotchas), not dictated by this record.
- `skills/demo/SKILL.md` Step 3's Approve action (the `--add-label demo:approved` call and its `work-backend: local-files` `facets.acceptance = 'approved'` equivalent) updated to write the chosen provenance signal whenever the approval came from a `#N,#M` batch invocation, with no added friction to the single-record walkthrough path.
- `bin/lib/issues/trust.js`'s coverage/verdict computation (around `coverage`/`dispositioned`/`verdict`, trust.js:388-419) updated to read the provenance signal and either weight batch-sourced evidence differently or annotate it distinctly in the rendered trust table.

## Acceptance Criteria

- A batch approval via `/claude-tweaks:demo #N,#M,...` (`skills/demo/SKILL.md` Step 3) records a provenance signal on each approved record, distinguishable from a single-record walkthrough-backed approval, with no extra prompt or confirmation step added to the batch flow.
- A single-record walkthrough-backed approval (`skills/demo/SKILL.md`'s per-item walkthrough, Step 2) continues to apply `demo:approved` exactly as today, with no new friction.
- `bin/lib/issues/trust.js`'s coverage/verdict computation reads the provenance signal, and its output (coverage number, verdict, or trust-table rendering) visibly differs between a cell backed entirely by batch sign-offs and one backed by walkthroughs, per whichever weighting/annotation approach is chosen.
- Pre-existing `demo:approved` labels applied before this change (no provenance signal) are handled without erroring or silently miscounting — treated as walkthrough-backed (today's implicit assumption) or as unknown-provenance, whichever the chosen design justifies and states explicitly.
- `node --test tests/` passes, including new or updated coverage for `trust.js`'s provenance-aware computation.

## Technical Approach

- Read side: `bin/lib/issues/trust.js`'s existing coverage computation (trust.js:388-419) is the single surface that needs to become provenance-aware.
- Write side: `skills/demo/SKILL.md` Step 3's Approve action is the single surface that needs to record provenance, gated on whether the invocation is a `#N,#M` batch (Step 1's existing batch-detection logic) versus a single-ref walkthrough.
- Two representation options were named in the originating finding (a demo comment noting provenance, or a `demo:approved-batch` label variant) — pick one and justify the choice against the other (label variants are cheap to grep/count for `trust.js` but multiply the label surface; a comment is free-form but harder to parse deterministically) rather than treating both as required.
- Bootstrap any new label per `_shared/label-bootstrap.md` before the first write, same as any new scoring label.

## Gotchas

- The batch sign-off itself is explicitly legitimate and must stay cheap (per the originating finding) — this record is scoped to labeling the evidence, not to adding friction to the batch path itself. A design that makes batch approval slower to "fix" the provenance gap defeats the point.
- Backward compatibility: every `demo:approved` label applied before this change carries no provenance signal. The Acceptance Criteria requires an explicit, justified default for this case (not silent miscounting) — pick one and state it in the implementation.
- The representation format (comment vs. label variant) and how `trust.js` should react to a mixed-provenance cell (weight down vs. annotate distinctly vs. both) are open design choices, deliberately left to the implementer rather than pre-selected by this record — treat this as intentional scope, not a gap to fill in before building.

## Original request

Demo verdict provenance: distinguish batch sign-off from walkthrough-backed approval in trust evidence

**Related:** #365

# Reflect — staged finding 4

**Category:** tangential
**Severity:** med
**Reversibility:** high
**Source:** full mode, lens "Near-misses"
**Causal:** systemic
**Files:** skills/demo/SKILL.md, bin/lib/issues/trust.js

## Finding

This session applied a human-instructed blanket approval to 22 demo:pending records (5 parents closed) with no per-record walkthroughs. The resulting demo:approved labels are byte-identical to walkthrough-backed verdicts, so the trust table's coverage/verdict computation now reads batch sign-off as demonstrated-acceptance evidence. Systemic: any future bulk approval inflates the evidence base the grant/merge trust column summarizes, and nothing recorded distinguishes the two.

## Suggested resolution

Backlog candidate: record verdict provenance at apply time (e.g. a demo comment noting walkthrough vs batch, or a demo:approved-batch label variant) and have trust.js weight or annotate coverage accordingly. Needs design judgment — the human batch decision is legitimate and must stay cheap; the gap is only that the evidence is unlabeled.

## Decision-log reference

STAGED 21:26 — Step 3: tangential idea "demo verdict provenance" — backlog candidate. Surface at the Queue writes gate.


Origin: wrap-up reflect (backlog-ops session, 2026-08-14)


<!-- work-fingerprint: reflect:demo-verdict-provenance -->

