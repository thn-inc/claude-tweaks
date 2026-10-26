# stories/refine.md 5a: resolve story URL against the run APP_URL like qa-prompts.md resolved_url (#4184) Implementation Plan

**Goal:** `plugin/skills/stories/refine.md` step 5a opens `<story.url>` raw; give it the same `resolved_url` rewrite `plugin/skills/test/qa-prompts.md` uses, citing it rather than restating it.

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-25T080733-record-4184/work/4184-spec.md` (materialized from GitHub issue #4184)

---

### Task 1: Make refine 5a open `resolved_url`, citing qa-prompts.md's rewrite

**Files:**
- Modify: `plugin/skills/stories/refine.md`
- Modify: `docs/skill-graph.md`
- Test: `tests/stories-refine-resolved-url.test.js`

- [ ] **Step 1: Failing test** — create `tests/stories-refine-resolved-url.test.js`, shaped like its neighbour `tests/qa-prompts-step-origin.test.js` (same `readText` helper from `./helpers/read-skill`, same `between()` slicing and `expectRed()` go-red pattern). Shared constant `REWRITE_STEP = "Resolve each story's dispatch URL against \`APP_URL\`"` (the bold step name in `qa-prompts.md` line 66). Assertions:
  - `qa-prompts.md` contains `REWRITE_STEP` and computes `resolved_url` (pins the source side of the shared name).
  - `refine.md`'s 5a section (from `## 5a.` to `## 5b.`) contains `REWRITE_STEP`, names `qa-prompts.md`, and names `resolved_url` (pins that refine cites the same rewrite by the same name).
  - The 5a section contains `open <resolved_url>` and `goto <resolved_url>`, and contains no `<story.url>` at all (AC: never a raw `<story.url>`).
  - The 5b section (from `## 5b.` to `## 5c.`) re-opens `resolved_url`, not a raw story URL.
  - A go-red test: each assertion fails on a mutation that reverts only the prose it pins, matched by the assertion's own message.
  Run: `node --test tests/stories-refine-resolved-url.test.js` — Expected: FAIL (refine.md still opens `<story.url>`).
- [ ] **Step 2: Implement** —
  - `refine.md` 5a step 2: before sub-step a, resolve the story's URL to `resolved_url` against `APP_URL` (this `/stories` run's resolved URL — its `URL` input, or `_shared/dev-url-detection.md`'s auto-detected value) using `qa-prompts.md`'s (in the `/claude-tweaks:test` skill's directory) **Resolve each story's dispatch URL against `APP_URL`** step — cite it, do not restate its root-relative / differing-origin / matching-origin rules. One clause of why: refine's update mode revalidates stories carried over from earlier runs and worktrees, exactly when the recorded origin is stale. Sub-step a becomes `open <resolved_url>`, sub-step b's re-navigation becomes `goto <resolved_url>`.
  - `refine.md` 5b step 5b: "Re-open the story's URL" → re-open its `resolved_url` (the stale-origin bug is identical there).
  - `docs/skill-graph.md` line 575 (`/stories` ↔ `/test` row): add one clause stating `/stories`' refinement (`refine.md` 5a) resolves each story's URL with `/test`'s `qa-prompts.md` `resolved_url` rewrite, cited rather than restated — the edge is stated once there (CLAUDE.md Cross-references).
- [ ] **Step 3: Run** `node --test tests/stories-refine-resolved-url.test.js tests/qa-prompts-step-origin.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message `Resolve refine 5a story URL against APP_URL — cite qa-prompts.md resolved_url, refs #4184`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (same `resolved_url` rewrite, cited not restated) → Step 2's refine.md bullets. AC1 (5a opens `resolved_url`, never raw `<story.url>`) → Step 1's 5a assertions. AC2 (prose-conformance assertion pins that refine and qa-prompts name the same rewrite) → Step 1's `REWRITE_STEP` assertions on both files.
- **Placeholders:** none.
