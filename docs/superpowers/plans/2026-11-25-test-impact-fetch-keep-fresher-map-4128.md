# Decide whether test-impact fetch may overwrite a fresher local map with an older CI map (#4128) Implementation Plan

**Goal:** `tools/test-impact.js fetch` keeps a cached map that is valid, passing, clean, descends from the chosen CI run's head commit and is an ancestor of `HEAD`, instead of replacing it with the older CI map.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T072335-record-3902/spec-4128/work/4128-spec.md` (materialized from GitHub issue #4128)

---

### Task 1: Widen fetch's cache check to keep a fresher clean local map

**Files:**
- Modify: `tools/test-impact.js`
- Test: `tests/test-impact-cli.test.js`
- Waived `plugin/bin/lib/verify/impact.js`: read only — the map-problem reasons that decide when `verify.js` calls `fetch`

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe (AC1-AC6: kept when clean/passing/descends-from-CI/ancestor-of-HEAD with no `gh run download` call and a log line naming both commits; replaced when dirty, when `exitCode !== 0`, on a diverged line, when not an ancestor of `HEAD`, and when an ancestry check makes git error — without a non-zero exit), reusing the file's `mapText` helper and fake `deps.git`, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` item: one new branch beside the existing equality short-circuit, two `deps.git(['merge-base', '--is-ancestor', '--end-of-options', ...])` calls each in its own try/catch (git error → not kept), the stdout line `fetch: cached map at {cachedCommit} descends from CI map {headSha}, kept → {out}`, and the header comment plus any doc that describes `fetch`'s cache rule updated to the new rule. Do not relax the downloaded-map checks.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS; existing fetch cases unchanged and passing (AC7). Show AC1's test failing with the widened check reverted (AC8), in a scratch checkout.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4128`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above (AC9 `npm test` is Common Step 5's verification run).
- **Placeholders:** none.
