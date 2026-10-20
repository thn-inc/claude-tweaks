# Friction denial-coverage control isolation (#3575) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tests/friction-main-checkout-denial-coverage.test.js` independent of whatever real run dirs exist under the main checkout's `.claude-tweaks/pipelines/`.

**Architecture:** `plugin/bin/friction-events.js` resolves two sibling sets: `findRunsByWorktreePath(worktreePath, …)` (scoped by `--worktree`, already the fixture) and `findAdHocRunsBySessionId(deps.cwd(), sessionId, …)` (scoped by the subprocess's **cwd** and the inherited `CLAUDE_CODE_SESSION_ID`). The test's `runFrictionEvents` helper is called without `cwd` at all three call sites, so the second lookup scans the real checkout the test process runs in. Fix is test-only: the helper requires `cwd` and every call passes the fixture `project`, so both lookups resolve against the fixture git repo the test creates. No production code changes.

**Tech Stack:** Node 18+, `node:test`, `child_process.execFileSync`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185537-record-3575/work/3575-spec.md` (materialized from GitHub issue #3575)

## Global Constraints

- No test or assertion in the file is removed or skipped.
- Test-only change; `plugin/` is not modified.
- `npm test` passes.

## Review Focus

- A real `*-adhoc-standalone` run dir carrying this session's id and a `wd-guard-refusal` event must not change any test's result (the reported failure).
- A real run dir carrying a `gate-denial` event must not inflate tests 1 and 3's `denialEvents.length === 1` (same leak, different event type) — covered by the same `cwd` fix, verified in Step 4.
- The control must still go red if the extractor manufactures an entry — verified by a temporary mutation in Step 5, then reverted.

---

### Task 1: Scope every friction-events.js call to the fixture checkout

**Files:**
- Modify: `tests/friction-main-checkout-denial-coverage.test.js:53-56` (helper) and its three call sites (`:98`, `:114`, `:137`)

**Interfaces:**
- Produces: `runFrictionEvents(args: string[], { cwd }: { cwd: string }): object[]` — throws when `cwd` is missing, so no future call can fall back to the test process's cwd.

- [ ] **Step 1: Plant a real-checkout run dir that triggers the leak**

Under the main checkout (`git rev-parse --git-common-dir`'s parent) `.claude-tweaks/pipelines/`, create `2026-10-19T000001-repro3575-adhoc-standalone/` with `run-state.json` = `{"sessionId":"<$CLAUDE_CODE_SESSION_ID>","worktree":"/nonexistent/repro-3575-worktree","status":"active"}` and `events.jsonl` holding one `{"type":"wd-guard-refusal","ts":"2026-10-19T00:00:02.000Z","tool":"Bash"}` line. (Already planted for this run — confirm it exists.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/friction-main-checkout-denial-coverage.test.js`
Expected: FAIL — `not ok 2 - \#2543 control` (`deepStrictEqual` against `[]` receives the planted `wd-guard-refusal`).

- [ ] **Step 3: Make `cwd` required in `runFrictionEvents` and pass `{ cwd: project }` at all three call sites**

The helper throws an `Error` naming `#3575` when `cwd` is falsy; add a short comment on the helper explaining that `findAdHocRunsBySessionId` scans the subprocess cwd's checkout with the inherited session id, so the fixture must be the cwd.

- [ ] **Step 4: Run the test with the planted dir present — PASS; then with a planted `gate-denial` too**

Run: `node --test tests/friction-main-checkout-denial-coverage.test.js`
Expected: `# pass 3`, `# fail 0`. Append a `{"type":"gate-denial","ts":"2026-10-19T00:00:03.000Z","tool":"Write"}` line to the planted `events.jsonl`, re-run, expect `# pass 3`.

- [ ] **Step 5: Prove the control still discriminates**

Temporarily change `plugin/bin/friction-events.js`'s output line to emit a manufactured `{type:'gate-denial'}` entry in addition to `friction`, run the test file, expect `not ok 2` (control red), then restore the file (`git diff --stat plugin/` empty).

- [ ] **Step 6: Remove the planted run dir and re-run**

Delete `2026-10-19T000001-repro3575-adhoc-standalone/` from the main checkout; run the test file again, expect `# pass 3`.

- [ ] **Step 7: Commit**

```bash
git add tests/friction-main-checkout-denial-coverage.test.js
git commit -m "Isolate friction denial-coverage tests from the real checkout's run dirs — friction-events.js runs with the fixture as cwd, refs #3575"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3; Deliverable 2 → Steps 4-5; AC 1 → Steps 1-2, 4, 6; AC 2 → Global Constraints + Step 3 (no assertion removed); AC 3 → `/build` Common Step 5 full suite.
- **Placeholders:** none.
