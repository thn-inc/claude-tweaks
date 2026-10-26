# refreshOwnerBlock resolves the owner pid (up to 8 ps spawns) before checking the heartbeat throttle (#4150) Implementation Plan

**Goal:** `refreshOwnerBlock` stops resolving the owner pid (up to 8 synchronous `ps` spawns via `ancestorClaudePid`) on every hook event while the run owner's heartbeat is still inside `HEARTBEAT_THROTTLE_MS`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T132738-record-4150/work/4150-spec.md` (materialized from GitHub issue #4150)

---

### Task 1: Check the heartbeat throttle window before the owner-pid probe

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js`
- Modify: `plugin/bin/lib/hooks/session-start.js`
- Test: `tests/hooks-context.test.js`

Design note: inside the throttle window the only outcome a pid probe can still change is a re-stamp (a resumed `claude --resume` under a new process, or pid reuse). The per-event hook path (`plugin/bin/hooks.js`, every non-session-start event) takes the throttle-first fast path by default and so defers such a re-stamp to the first event outside the window. SessionStart is where a resume lands and the existing #3973 tests pin an in-window re-stamp (`AC3.1`, at RT0+5s), so `session-start.js` passes an explicit option (`restampWhileFresh: true`) that keeps the full probe there — one call per session, not per tool call. The existing in-window re-stamp tests pass that option.

- [ ] **Step 1: Failing test** — in `tests/hooks-context.test.js`, add: (a) inside the window, `refreshOwnerBlock` calls neither `resolveOwnerPid` nor `pidStartTime`/`isPidAlive` (counting injected probes) and returns null; (b) outside the window the owner block is still heartbeated/re-stamped; (c) with `restampWhileFresh: true` an in-window resumed session still re-stamps. Point the existing in-window re-stamp tests at `restampWhileFresh: true`.
- [ ] **Step 2: Implement** — in `refreshOwnerBlock`, compute heartbeat freshness first and return null before any pid probe when fresh and `restampWhileFresh` is not set; pass `{ restampWhileFresh: true }` from `session-start.js`'s call.
- [ ] **Step 3: Run** `node --test tests/hooks-context.test.js` — PASS; confirm test (a) goes red against the pre-change ordering.
- [ ] **Step 4: Commit** — one commit, `Check the heartbeat throttle before the owner-pid probe — refs #4150`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (throttle before probe) → Step 2; Deliverable 3 + AC "no probe inside window" → Step 1(a); AC "outside the window still restamped" → Step 1(b); AC "goes red against current ordering" → Step 3; AC `npm test` → Common Step 5. Deliverable 2 (cache) is the spec's stated alternative ("Or"), not taken.
- **Placeholders:** none.
