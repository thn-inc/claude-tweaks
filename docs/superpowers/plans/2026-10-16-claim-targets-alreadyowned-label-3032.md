# claim-targets.js: alreadyOwned self-owned claim never gets bot:in-progress (#3032) Implementation Plan

**Goal:** Re-assert `bot:in-progress` on a self-owned (`alreadyOwned`) claim so a held claim never reads as unclaimed to downstream consumers.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T052237-record-3032/spec-3032/work/3032-spec.md` (materialized from GitHub issue #3032)

---

### Task 1: Re-assert bot:in-progress on the alreadyOwned branch

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js`
- Modify: `plugin/skills/flow/claim-targets.md`
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`

- [x] **Step 1: Failing test** — add `(g3)` asserting the self-owned branch re-asserts `bot:in-progress` via `gh issue edit --add-label`, and that a label failure lands in `labelFailures` without changing the exit code.
- [x] **Step 2: Implement** — in the self-owned branch (`identity.runId === opts.runId`), call `ensureAndAddLabel(deps.gh, issue)` in a try/catch before `continue`, pushing failures onto `labelFailures` (same shape as the fresh-claim path). Document the re-assert in `claim-targets.md`'s claim paragraph.
- [x] **Step 3: Run** `node --test tests/bin-lib/claim-targets/*.test.js` — PASS (43/43). Verified `(g3)` fails red without the fix (reverted and re-ran), passes green with it restored.

**Status:** Complete.
