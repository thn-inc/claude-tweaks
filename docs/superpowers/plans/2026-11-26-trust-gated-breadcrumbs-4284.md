# Windows: the core.longpaths breadcrumb lands in a fallback-guessed, unrelated run dir (#2783 shape) (#4284) Implementation Plan

**Goal:** `logWindowsLongpathsEvent` and `logWorktreeStalenessEvent` in `plugin/bin/lib/hooks/post-tool-use.js` write to `ctx.ownedRun.dir` even when that run is only a `fallback` guess; route both through one trust-gated helper so a fallback guess gets nothing.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T092151-record-4284/work/4284-spec.md` (materialized from GitHub issue #4284)

---

### Task 1: Route both breadcrumb writers through one trust-gated helper

**Files:**
- Modify: `plugin/bin/lib/hooks/post-tool-use.js`
- Test: `tests/friction-adhoc-enterworktree-roundtrip.test.js`
- Test: `tests/hooks-post-tool-use-worktree-staleness.test.js`

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can. Concretely: (AC2) add `platform: 'win32'` to the first `post.run` call in `tests/friction-adhoc-enterworktree-roundtrip.test.js` so the existing `nothing may land in the unrelated sibling run` assertion covers the Windows path on Linux; (AC3) in `tests/hooks-post-tool-use-worktree-staleness.test.js`, with `platform: 'win32'` and core.longpaths unset, a `{ dir, attribution: 'fallback' }` ownedRun gets no `events.jsonl`, and a `{ dir, attribution: 'session' }` ownedRun gets exactly one `windows-longpaths` event. Run: `node --test tests/friction-adhoc-enterworktree-roundtrip.test.js tests/hooks-post-tool-use-worktree-staleness.test.js` — Expected: FAIL (the new fallback assertions).
- [ ] **Step 2: Implement** — add one helper (e.g. `appendOwnedRunEvent(ctx, type, data)`) that returns unless `ctxLib.isTrustedOwnedRun(ctx.ownedRun)` and otherwise calls `ctxLib.appendEvent(ctx.ownedRun.dir, type, data, ctx.ownedRun.attribution)`; make `logWorktreeStalenessEvent` and `logWindowsLongpathsEvent` call it. Non-`fallback` attribution (including an absent attribution, per `isTrustedOwnedRun`) still receives the event (#1782).
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS. AC4 go-red: temporarily remove the trust check from the helper and confirm AC2 and AC3's fallback case fail; restore it.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4284`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is
  covered by Task 1's Files/Steps above. AC5 (a `windows-regression.yml` dispatch on the branch) is a CI-side proof run after the PR branch is pushed, not a plan task.
- **Placeholders:** none.
