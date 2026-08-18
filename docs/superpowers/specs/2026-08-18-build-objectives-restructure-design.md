# /build Objectives Restructure — Design

**Date:** 2026-08-18
**Status:** Approved in brainstorm; awaiting specify decomposition
**Origin:** Fruit-picking pass over `/build` against `_shared/feedback-objectives.md`'s nine maintainer objectives.

## Problem

Scoring `/build` against the maintainer-objective rubric surfaced three ripe findings sharing one root — incident-driven accretion with no consolidation mechanism:

1. **Context overhead:** `plugin/skills/build/SKILL.md` measures 40,259 bytes against the 40,960-byte soft ceiling — 701 bytes of headroom, the fullest file in the skill family. It is the always-loaded spine, yet carries rare-path detail: five plan-authoring check bullets needed only during Spec/Design Step 3, and a ~500-word Common Step 2 dispatch paragraph (tier resolution, frontier guard, AC-forwarding, review-model pinning). Open records #734 (sixth plan-authoring check) and #641 (seventh: size-headroom pre-check) are arithmetically near-impossible to land without a restructure — #641 is itself *about* this failure mode.
2. **Instruction efficacy:** long prose checks buried mid-step are the canonical "instructions the model routes around" shape. Evidence on record: #496 doubts whether #360's AC-forwarding survives into live SDD dispatch prompts; #778 documents a dispatched run silently skipping the Step 2.8 claim and the pr-first early-PR bootstrap with no degrade trace.
3. **Recovery quality:** `/build` has more conditional steps than any sibling (Common Steps 1.7, 2.5, 4.5, 5.5, 6.5, plus the pr-first bootstrap), and a skipped step is currently indistinguishable from a silently-failed one. Evidence: three unfinished pipeline runs with status *unknown* plus two leftover worktrees announced at a single SessionStart; #838 (PR object missing at wrap-up — no push, no degrade log); #778 again.

Moderate findings folded in where they overlap: Plan Audit's deterministic checks are model-executed grep procedures (automation efficiency), and the plan-check prose has no mechanical backstop (report fidelity is out of scope here — see Non-goals).

## Phase 1 — Extract: buy back SKILL.md headroom

**Deliverables**

- New sub-file `plugin/skills/build/plan-authoring.md`: the five plan-authoring check bullets (Plan-authoring, Blocking-verification-downgrade, Deictic-reference re-resolution, Verbatim-command run-once, Degrade-clause convention) move there verbatim. Spec Step 3 and Design Step 3 each keep a one-line mandatory pointer ("read `plan-authoring.md` in this skill's directory before finalizing the plan") — the same lazy-load pattern `plan-audit.md` already uses.
- New sub-file `plugin/skills/build/dispatch.md`: Common Step 2's subagent-branch detail moves there — tier resolution from the `size:` header, the `tier=` token rules, the `tier=frontier` guard and strategy precondition, AC-forwarding, and whole-branch review-model pinning. SKILL.md keeps the subagent/batched branch skeleton, the maturity-scaled test-discipline table, and the pointer. (`build-options.md` is already 11.8KB — a fresh sub-file, not a graft.)
- `docs/plugin-structure.md`'s per-skill sub-file table gains both rows; `docs/skill-graph.md` unchanged (sub-files are not edges).
- Conformance tests that pin the moved prose are re-pinned to the new locations — full suite before merge, and `wc -c` re-measured on SKILL.md afterward.

**Acceptance criteria**

- `plugin/skills/build/SKILL.md` under ~32KB (`wc -c`), with at least 8KB headroom to the 40,960 ceiling.
- All five checks appear exactly once in the repo (in `plan-authoring.md`), with pointers — not restatements — at both Step 3 sites.
- `npm test` green.

**Known tradeoff:** lazy-loaded checks bind only if the file is read at Step 3 — the same exposure `plan-audit.md` already accepts, and Phase 2 reduces how much rides on prose. Accepted knowingly.

## Phase 2 — Mechanize: `bin/plan-audit.js`

**Deliverables**

- New CLI `plugin/bin/plan-audit.js` (module files under `plugin/bin/lib/plan-audit/` if multi-file) running the deterministic plan checks against a plan file path:
  - **Check A** — every `Files:` path exists (or parent dir exists, for Create).
  - **Check B** — `Scope keywords:` sweep; list matched files absent from the plan.
  - **Check C** — the verification-command pre-check (#257 is `bot:in-progress`: verify its landed shape first and build *on* it, never beside it — if it shipped as prose, this phase mechanizes it; if it shipped as a CLI, this phase extends it).
  - **Headroom check (new)** — for every existing file the plan adds prose to, report current `wc -c` against the 40,960-byte sub-file ceiling and flag insertions that would breach it. This satisfies #553 and the check half of #641 outright.
- Structured output (per-check pass/fail + offending paths) the skill interprets; `plan-audit.md` shrinks to interpretation and policy handling (scope-creep policy resolution, `scope-keywords-required`, the interactive prompt).
- Tests under `tests/bin-lib/plan-audit/` (picked up by the recursive `npm test` glob).

**Acceptance criteria**

- Common Step 1.5 invokes the CLI instead of prose-guided grep execution; the skip-gate conditions in SKILL.md are unchanged.
- A fixture plan naming a missing path, an unswept scope keyword, and a near-ceiling insertion each produce the corresponding structured failure; a clean fixture passes.
- #553's and #641's check-half scenarios are covered by tests, so those records close (or reduce to prose-only remainders) when this lands.

**Boundary:** judgment-only checks (deictic re-resolution, degrade-clause convention, #734's gate-over-producers) stay prose in `plan-authoring.md` — no pretending they're mechanical.

## Phase 3 — Degrade-trace: skips leave evidence

**Deliverables**

- `_shared/auto-decision-log.md` gains a **degrade-trace rule** as a family-wide contract: any skill step that skips, defers, or degrades a documented conditional action during a run writes one `decisions.md` line stating the step, the condition that fired, and the fallback taken. The entry-status vocabulary is a closed set today — this adds a `SKIP` entry type via expand-contract (add the new type, migrate consumers that enumerate the vocabulary — including the Review Console reader and any tests pinning the set — no silent widening).
- Adoption in `/build` only, this pass (CLAUDE.md's "adopt in new skills first, migrate deliberately"): Common Steps 1.7, 2.5, 4.5, 5.5, 6.5, the pr-first bootstrap in Spec Step 1, and Common Step 7's phase-exit push each log their skip/degrade path. Sibling skills adopt via the per-skill fruit-picking passes.
- Standalone `/build` runs with no run dir state the skip inline in the handoff instead — the contract names both carriers.

**Acceptance criteria**

- The vocabulary change lands expand-contract: every consumer that enumerates entry statuses (skills, tests, Review Console) accepts `SKIP` in the same change.
- A `/build` run that skips Step 1.7 (non-frontend surface) and Step 6.5 (no `docs/REGISTRY.md`) produces one `SKIP` line each in `decisions.md`; a run where every step executes produces zero `SKIP` lines.
- The #778 class (pr-first bootstrap skipped) becomes diagnosable: the skip either has a logged line or is a contract violation a review can name.

## Sequencing

Phase 1 → Phase 2 → Phase 3. Phase 1 is the enabler (headroom); Phase 2 depends on #257's landed shape; Phase 3 is independent of both but cheapest to write once Phase 1's extraction has settled where the conditional-step text lives.

## Beneficiary records

- #641 / #553 — headroom check mechanized in Phase 2 (each record's remainder, if any, re-scoped at close).
- #734 — gains a landable home (`plan-authoring.md`); its check content is **not** written here.
- #496 / #778 / #838 — evidence for Phases 1–3; #778's silent-skip class is addressed by Phase 3; #496's live-dispatch probe stays its own record.
- #257 — coordination dependency for Phase 2, not a deliverable.

## Non-goals

- #734's gate-over-producers check content (own record, lands after Phase 1).
- Trust-calibration (locked-axes options prompt) and avoidable-interaction findings — need transcript data before they're findings at all.
- Friction items already on record (#447, #767 — worktree setup).
- Report-fidelity diff-vs-narrative auditing — real, but belongs with the SDD dispatch contract, not this restructure.
- Any change to sibling skills' conditional steps (Phase 3 contract is family-wide; adoption here is /build-only).

## Risks

| Risk | Mitigation |
|---|---|
| Lazy-loaded checks not read at Step 3 | Mandatory pointer phrasing matches the established `plan-audit.md` pattern; Phase 2 mechanizes the checks that matter most |
| #257 lands mid-build with a different Check C shape | Phase 2's first task re-reads #257's landed state before authoring |
| Conformance tests pin moved prose repo-wide | Full suite before merge (known: filename-matched test files aren't sufficient); re-pin, never fork wording |
| `SKIP` widens a closed vocabulary | Expand-contract: grep every consumer/test enumerating the set in the same change |
| Near-ceiling merge collisions while this is in flight | Re-merge origin/main before the final whole-branch review; re-measure `wc -c` at merge time |
