---
record: 361
origin: human
risk: low
size: low
ceremony: standard
grants: [build]
surface: backend
---
# 361: review-effort-derivation: risk:low can under-provision review depth for UI-surface specs

Surface: backend

## Current State

`review-effort-derivation.md`'s `risk:*` × `size:*` table (feeding `/claude-tweaks:review`'s Step 2.5) derives review-effort primarily around backend blast-radius. A UI-only spec that changed a table's rendering/sorting, with no schema/API/infra surface, resolved to `review-effort: low` via `risk:low × size:medium` — correctly reflecting low backend-blast-radius. Yet that same spec's effort-independent steps (Step 6 live visual review, Step 6.5 Impeccable critique/audit, which run at every effort tier) surfaced a P0 UX bug, a WCAG 4.1.2 ARIA-validity violation, and a WCAG 1.4.10 reflow failure — none catchable by the `low`-tier's narrower code-review lens set (Security + Error Handling only), and none caught by the build's own per-task/whole-plan reviews either.

## Deliverables

- [ ] Evaluate whether `risk:*` labeling guidance for UI-surface specs should weight "adds new interactive DOM elements" as an independent signal, distinct from backend blast-radius.
- [ ] If adopted: document a rule bumping effort by one tier when a spec's diff touches rendering/interaction code with no corresponding backend surface, so the code-review lens set reflects UI-specific risk, not just the always-run visual/design steps.
- [ ] If not adopted: record the explicit decision and rationale for why the current backend-centric calibration is judged sufficient despite this case.

## Acceptance Criteria

1. A decision is recorded in `review-effort-derivation.md` (or a linked doc) on whether UI-surface specs get an independent risk-bump signal.
2. If adopted, the `risk:*` × `size:*` table (or its accompanying guidance prose) documents the new UI-signal rule with a concrete trigger condition ("diff touches rendering/interaction code with no backend surface").
3. If declined, the rationale is recorded so a future re-litigation of this exact case has the prior reasoning available.

## Technical Approach

This is explicitly filed as "a general policy-tuning suggestion... not a regression report" — the concrete trigger is one UI-only spec where all 3 real findings came from the effort-independent visual/design-quality steps, not the code-review lens set. The fix, if adopted, is a documentation/policy change to `review-effort-derivation.md`'s guidance prose (and possibly the risk-labeling instructions in `_shared/work-record.md`'s Scoring axis or wherever risk tiers are judged at shaping time) — not a code change, since the risk labels are human/LLM-judged at `/specify` time, not mechanically derived.

### Key Files

- `plugin/skills/review/review-effort-derivation.md` — add or explicitly decline the UI-signal rule
- `plugin/skills/_shared/work-record.md` — Scoring axis guidance, if the risk-judging criteria need updating to reflect the new signal

## Gotchas

- This is explicitly not a proposal to widen the `low` tier's lens set — Steps 6/6.5 already run at every tier and already caught the real defects; the question is only whether the code-review lens set's tier should also reflect UI risk.
- A single confirmed case is the evidence base — treat this as a policy-tuning discussion to resolve deliberately, weighing false-positive cost (over-triggering the risk bump on routine UI specs) before changing the table.

## Original request

review-effort-derivation: risk:low can under-provision review depth for UI-surface specs

**Summary:** The `risk:*` × `size:*` table that derives `review-effort` (feeding `/claude-tweaks:review`'s Step 2.5) is calibrated primarily around backend blast-radius and can under-provision review depth for UI-heavy specs where the real risk is user-facing (accessibility, reflow, dead controls) rather than backend severity.

**Kind:** Gap

**Affected component:** review-effort-derivation.md (the risk × record-size table feeding `/claude-tweaks:review` Step 2.5)

**Use case:** A spec that changed a UI table's rendering/sorting, with no schema/API/infra surface, resolved `review-effort` to `low` via `risk:low × size:medium` labels — correctly reading as low backend-blast-radius. Yet the spec's own effort-independent steps (Step 6 live visual review, Step 6.5 Impeccable critique/audit — which run at every effort tier regardless) surfaced a P0 UX bug, a WCAG 4.1.2 ARIA-validity violation, and a WCAG 1.4.10 reflow failure — none catchable by the `low`-tier's narrower code-review lens set (Security + Error Handling only), and none caught by the build's own extensive per-task/whole-plan reviews either.

This is not a proposal to widen the `low` tier's lens set — the real defects were live-browser-visual/accessibility, which Steps 6/6.5 already run at every effort tier. Rather: the `risk:*` labeling convention appears calibrated primarily around backend blast-radius (schema changes, API surface, infra), which can undercount actual review-depth need for UI-surface specs. Worth considering whether `risk:*` guidance for UI-surface specs should weight "adds new interactive DOM elements" as an independent signal — e.g. bumping effort by one tier when a spec's diff touches rendering/interaction code with no corresponding backend surface, so the *code-review* lens set also reflects the real risk profile, not just the always-run visual/design steps.

Reported as a general policy-tuning suggestion from a private project's own run, not a regression report — the concrete trigger case is a single UI-only spec where 3 real, confirmed findings all came from the effort-independent visual/design-quality steps while the code-review lens set (correctly, for that lower tier) found nothing.

**Plugin version:** 6.78.0

---
Filed via /claude-tweaks:feedback.
<!-- fingerprint: review-effort-risk-size-undercounts-ui-surface-risk -->

