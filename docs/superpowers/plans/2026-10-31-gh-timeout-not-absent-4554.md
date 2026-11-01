# pr-early-open: a gh timeout is not "gh is not available" (#4554) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A timed-out `gh --version` probe reads as `gh` present, and a `gh` call that times out inside `pr-early-open.js` prints a hint naming the timeout and both override knobs instead of a bare `ETIMEDOUT`.

**Architecture:** `ghAvailable` (the shared probe for ~20 CLIs) classifies its catch with the existing `isTimeoutError` from `shared-primitives.js`; `pr-early-open.js`'s outer `catch` appends one hint line when `isTimeoutError(e)`. No caller changes, exit codes unchanged (timeout path stays exit 1).

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T115908-record-4385/spec-4554/work/4554-spec.md` (materialized from GitHub issue #4554)

## Global Constraints

- `ghAvailable` keeps its boolean return and its injectable `deps.execFileSync` seam; returns `true` only when `isTimeoutError(err)` — every other failure (ENOENT, non-zero exit, generic error) stays `false`.
- Use the shared `isTimeoutError` (`plugin/bin/lib/shared-primitives.js:248`, already exported); never add a local variant.
- Do not drop or change the probe's `timeout: GH_TIMEOUT_MS` bound (#2567).
- The `pr-early-open.js` hint names the effective timeout in ms (`GH_TIMEOUT_MS`), `CLAUDE_TWEAKS_GH_TIMEOUT_MS`, and `gh-timeout-ms`; wording matches `claim-targets.js:317-319` ("override via the gh-timeout-ms policy key or the CLAUDE_TWEAKS_GH_TIMEOUT_MS env var"). Exit code stays 1. Example line: `gh timed out after ${GH_TIMEOUT_MS} ms — override via the gh-timeout-ms policy key or the CLAUDE_TWEAKS_GH_TIMEOUT_MS env var (max 60000)`.
- The existing `CLI: gh absent exits 2 naming the MCP path` test stays byte-unchanged and passing.
- Do not touch `openPrEarly`'s internal degrade paths (exit 3) or `docs-health/commit-ref.js`.
- Governing skill `gh-api-module-pattern` (quoted verbatim): "**`GH_TIMEOUT_MS` is a resolved value, not a literal — import it, never retype its default at a new call site.**" and "Past it the child is killed and the throw carries `{code: 'ENOBUFS', signal: 'SIGTERM'}` (probed on Node 22), which `shared-primitives.js`'s `isTimeoutError` matches on `err.signal === 'SIGTERM'`, so the kill is reported as a timeout" — the probe uses `stdio: 'ignore'` (no buffer), so ENOBUFS cannot reach `ghAvailable`; keep `stdio: 'ignore'`. The hint's ms value interpolates the imported `GH_TIMEOUT_MS`, never a literal 5000.

## Review Focus

- A non-zero exit from `gh --version` (a broken install: plain `Error` with `status: 1`, no `code`/`killed`/`signal`) must stay "absent" (`false`) — the existing generic-error test pins it; keep it green.
- `signal: 'SIGTERM'` alone (no `code`, `killed` falsy) is a timeout per the shared helper — covered by a new test row.
- A non-timeout error reaching the outer catch must not gain the hint — pinned by the existing `CLI: an internal error (unparseable gh output) exits 1` test plus an added `doesNotMatch` assertion there.
- The timeout path must never print `gh is not available` nor exit 2.

---

### Task 1: Classify a timed-out probe as present and hint on a timed-out gh call

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js` (import at line 13; `ghAvailable` catch at ~lines 35-43)
- Modify: `plugin/bin/pr-early-open.js` (import at line 65; outer `catch (e)` at ~lines 243-245)
- Test: `tests/bin-lib/repo-resolve.test.js`
- Test: `tests/bin-lib/flow/pr-early-open.test.js`
- Waived `plugin/bin/lib/shared-primitives.js`: reference only (`isTimeoutError`, `GH_TIMEOUT_MS`)
- Waived `plugin/bin/lib/claim-targets/claim-targets.js`: reference only (hint wording)

**Interfaces:**
- Consumes: `isTimeoutError(err) -> boolean` and `GH_TIMEOUT_MS` (getter) from `plugin/bin/lib/shared-primitives.js`.
- Produces: `ghAvailable(deps?) -> boolean` (unchanged signature).

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/repo-resolve.test.js`, after the existing ENOENT case, add:
- `ghAvailable: a timed-out probe (code ETIMEDOUT) -> true (gh is present, just slow, #4554)` — runner throws `Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' })`; `assert.equal(result, true)`.
- `ghAvailable: a killed probe with no code -> true (#4554)` — runner throws `Object.assign(new Error('killed'), { killed: true })`; `true`.
- `ghAvailable: a SIGTERM-signalled probe -> true (#4554)` — runner throws `Object.assign(new Error('terminated'), { signal: 'SIGTERM' })`; `true`.
(The existing ENOENT → `false` and generic-error → `false` tests stay unchanged.)

In `tests/bin-lib/flow/pr-early-open.test.js`, next to the existing internal-error CLI test, add:
- `CLI: a gh timeout exits 1 with the timeout hint, never the gh-absent message (#4554)` — `const fx = cliFixture(); const h = cliDeps(fx);` wrap `h.deps.gh` so `repo view` throws `Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' })`; assert `await run(cliArgv(fx), h.deps) === 1`; `assert.match(err, /CLAUDE_TWEAKS_GH_TIMEOUT_MS/)`; `assert.match(err, /gh-timeout-ms/)`; `assert.match(err, /timed out after \d+ ms/)`; `assert.doesNotMatch(err, /gh is not available/)`.
- In the existing `CLI: an internal error (unparseable gh output) exits 1` test, add `assert.doesNotMatch(h.err.join(''), /gh-timeout-ms/)` (a non-timeout failure gets no hint).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/repo-resolve.test.js tests/bin-lib/flow/pr-early-open.test.js`
Expected: FAIL — the three new `ghAvailable` timeout tests (returns `false`) and the new CLI timeout test (no hint in stderr).

- [ ] **Step 3: Implement**

- `repo-resolve.js`: `const { GH_TIMEOUT_MS, isTimeoutError } = require('./shared-primitives');` and change the catch to `catch (err) { return isTimeoutError(err); }`. Extend the function's comment with one line: a timed-out probe proves the binary spawned (#4554) — the next real call surfaces the timeout.
- `pr-early-open.js`: add `isTimeoutError` to the existing `./lib/shared-primitives` import; in the final `catch (e)`, return `internal(...)` with the hint line appended on its own line when `isTimeoutError(e)` (Global Constraints wording); otherwise unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/repo-resolve.test.js tests/bin-lib/flow/pr-early-open.test.js`
Expected: PASS, 0 fail; the `CLI: gh absent exits 2 naming the MCP path` test still passes unchanged.

- [ ] **Step 5: Discrimination (scratch worktree only)**

In a scratch `git worktree add --detach` of HEAD (never the shared worktree): revert the `repo-resolve.js` catch → the three new `ghAvailable` tests go red; revert the `pr-early-open.js` hint → the new CLI timeout test goes red. Remove the scratch worktree.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/repo-resolve.js plugin/bin/pr-early-open.js tests/bin-lib/repo-resolve.test.js tests/bin-lib/flow/pr-early-open.test.js
git commit -m "Treat a timed-out gh probe as present — pr-early-open names the timeout knobs on a gh timeout, refs #4554"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3 (repo-resolve) + Step 1 repo-resolve tests (AC1, AC2); Deliverable 2 → Step 3 (pr-early-open) + CLI timeout test (AC3, AC4); AC5 → existing gh-absent test unchanged (Step 4); AC6 → Steps 4-5.
- **Placeholders:** none.
- **Proportion:** one task, four files, plan shorter than the spec.
