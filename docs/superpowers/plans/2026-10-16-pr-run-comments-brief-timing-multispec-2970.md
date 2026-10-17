# Multi-spec brief/timing PR comments (#2970) Implementation Plan

**Goal:** Spec-qualify the `brief` and `timing` PR run-comment markers under a multi-spec run, mirroring the overwrite-hazard fix already shipped for `verdict` (#2592), so a second spec's wrap-up no longer overwrites the first spec's Verification Brief / timing comment on the shared PR.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T194718-record-2970/work/2970-spec.md` (materialized from GitHub issue #2970)

---

### Task 1: Rule the multi-spec shape in `pr-run-comments.md`

**Files:**
- Modify: `plugin/skills/_shared/pr-run-comments.md`

- [ ] **Step 1: Failing test** — add assertions to `tests/pr-run-comments.test.js` expecting `pr-run-comments.md` to document a spec-qualified `brief:{spec}`/`timing:{spec}` marker shape (mirroring the existing verdict test) — run and confirm FAIL.
- [ ] **Step 2: Implement** — update the Comment kinds table's `brief`/`timing` marker cells to show both the single-spec and multi-spec (`:{spec}`) forms, and add a "Multi-spec brief and timing comments" subsection next to "Multi-spec verdict comments (#2592)" ruling: both kinds are spec-qualified, one comment per kind per spec, same Post-or-update procedure reused with `{kind}` = `brief:{spec}`/`timing:{spec}`. Update the Consumer table's `brief`/`timing` rows to note the multi-spec branch.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — `refs #2970`.

### Task 2: Compose the spec-qualified marker in `verification-brief.md` Step 4

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief.md`

- [ ] **Step 1: Failing test** — add assertions to `tests/pr-run-comments.test.js` expecting `verification-brief.md` to branch on `$MULTISPEC_PARENT_DIR` when composing the `brief`/`timing` PR-comment markers, deriving `{spec}` from `basename($PIPELINE_RUN_DIR)` (same convention as `code-mode-steps.md`'s verdict comment) — run and confirm FAIL.
- [ ] **Step 2: Implement** — in the `pr` object present branch (around the existing `<!-- run-comment: brief -->` / `<!-- run-comment: timing -->` lines), add the `$MULTISPEC_PARENT_DIR`-set case composing `<!-- run-comment: brief:{spec} -->` / `<!-- run-comment: timing:{spec} -->` instead, leaving the single-spec markers unchanged when unset.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — `refs #2970`.

### Task 3: Full-suite verification

- [ ] Run `npm test` and confirm no regressions.

---

## Self-review

- **Spec coverage:** Deliverable 1 (trace which multi-spec paths reach Step 4 per spec) is answered in the Current State research below rather than as its own code task — both direct `/flow #A,#B` and a dispatch bundle reach Step 4 per spec through the identical multi-spec `/flow` mechanism (a dispatch bundle is a multi-spec `/flow` invocation under the hood); the one case that does NOT hit the hazard is the Parent-Gate Procedure (records sharing a resolvable GitHub parent), which already composes one brief per parent by construction. Deliverables 2-3 are Tasks 1-2 (rule + implement) and the added test assertions (Task 1/2 Step 1) respectively.
- **Placeholders:** none.

## Research notes (Deliverable 1)

- `wrap-up/verification-brief.md`'s Routing section: every non-parent-linked record (the common case for a multi-spec `/flow #A,#B` run and for a dispatch file-overlap bundle with no shared parent) reaches Steps 1-4 — including the Acceptance-labeling bullet that composes/posts `brief` and `timing` — independently, per record.
- `wrap-up/execution-and-verification.md`'s `MULTISPEC_REVIEW_DEFER` skip list (items 3/4/6/7/8) does not cover acceptance labeling, so a multi-spec run's per-spec Phase 4 execution step still reaches the brief/timing post for every spec against the one shared PR.
- A dispatch bundle of file-overlap records *is* a multi-spec `/flow` invocation (`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow "#{n1},#{n2},..."`), so it shares this exact mechanism — not a separate implementation.
- The one path that does *not* hit the hazard: records sharing a resolvable GitHub parent (a `/specify` decomposition) route to the Parent-Gate Procedure instead, which already composes a single brief for the whole parent by construction (`settle-and-merge.md`'s sequencing + re-read-before-post idempotence) — this is "one brief for the whole closing set" the record's own Current State gestures at, and it is a different mechanism from the multi-spec-PR-sharing hazard this record targets.
