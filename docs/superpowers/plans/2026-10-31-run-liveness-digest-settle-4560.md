# Settle 3 below-floor run-liveness digest findings (#4560) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the three `run-liveness` findings digest #1426 promoted to #4560: fold `ownEventAt`'s two `events.jsonl` reads into one, write the sourced rationale for the death-witness conjunctions and `LEGACY_DEAD_MS`, and drop the resume-path probe short-circuit with a recorded reason.

**Architecture:** Deliverable 3 is a pure refactor inside `plugin/bin/lib/run-liveness/probes.js`: one shared helper computes the newest non-fallback event time from an already-read line array, used by both `ownEventRecency` (unchanged signature and return) and `ownEventAt` (now one `readEventLines` call). Deliverable 1 is comment-only, in `index.js` and `constants.js`. Deliverable 2 is dropped (no code change); the reason is posted on #4560 by the orchestrator after both code tasks land.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T095333-record-4560/work/4560-spec.md`

## Global Constraints

- `ownEventRecency(runDir)` keeps its exact signature and return shape `{ readable: boolean, lastOwnMs: number|null }` — `archive-merged.js` (`lastOwnEventMs`, `classifyRunDir`) calls it directly (spec Gotchas).
- `ownEventAt(runDir, ownerSessionId)` keeps its contract exactly: throws when `events.jsonl` is absent/unreadable; ignores `attribution: 'fallback'` lines for both fields; with `ownerSessionId !== undefined` only `session-end` events carrying that exact `sessionId` count toward `lastSessionEndMs`; `lastOwnMs` is unaffected by `ownerSessionId`.
- The `blocksResume` maintainer ruling (owner probes stay informational) must not change (spec Technical Approach item 2).
- Do not invent a rationale: every rationale comment cites its source (#3973's record body, or the run-directory-cleanup design doc, `19ea1a6b4:docs/superpowers/specs/2026-10-22-run-directory-cleanup-design.md`); where no rationale is recoverable, the comment says so.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit message style: `{Verb} {what} — {detail}`, ending `refs #4560` (never `closes`/`fixes`), plus the trailer line `Claude-Session: https://claude.ai/code/session_01JHXvgY6MvYsu7HvE4KdTLq`.
- Working directory: run every command from `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4560`; check `pwd` and `git rev-parse --show-toplevel` (each its own plain command) both print that path before committing. Never `git stash`.

## Review Focus

1. A run dir whose `events.jsonl` is a directory (unreadable, not absent) — `ownEventAt` must still throw, never return all-null. Pinned in Task 1 (`ownEventAt throws when events.jsonl is unreadable (a directory)`).
2. `events.jsonl` disappearing between the old two reads — the single pass removes that window; the one-read test in Task 1 pins that there is only one read.
3. A non-session-end event newer than every session-end — `lastOwnMs` must still be the newest of all non-fallback events. Covered by the existing `ownEventAt with an owner session id…` test (T3 is a session-end of another session, still counted for `lastOwnMs`).
4. Unparseable `ts` on a line — skipped for both fields, unchanged. Not newly exercised; the shared helper keeps the `Number.isNaN` skip verbatim.
5. Rationale comments drifting from the code they describe — Task 2 places each comment directly above the clause it explains.

## Acceptance-criteria coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 fixes Deliverable 3; Task 2 fixes Deliverable 1; Task 3 posts the fix/drop note on #4560 (Deliverable 2 dropped with its one-line reason) and records AC evidence in the run dir |
| AC2.1 | Already satisfied — the live digest comments 6386645770 and 6436927443 on #1426 were read on 2026-10-31 and all three promoted `[run-liveness]` lines end `→ #4560`; Task 3 Step 2 re-reads them and records the evidence in the run dir rather than editing #1426 |

Waived plugin/bin/lib/hooks/resume-freshness.js: Deliverable 2 is dropped, so this caller is read (to confirm it reads only the lock and commit entries) and not changed.
Waived plugin/bin/lib/flow/consolidated-pass.js: Deliverable 2 is dropped, so this caller is read and not changed.
Waived plugin/bin/lib/reconcile/archive-merged.js: only read — it calls `ownEventRecency`, whose signature and return shape Task 1 keeps; its suite runs in Task 1 Step 4.

---

### Task 1: Single `events.jsonl` pass in `ownEventAt`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/run-liveness/probes.js` (`ownEventRecency`, `ownEventAt`, and the header comment above `ownEventRecency` that says `ownEventAt` reads `readable`)
- Modify: `docs/plugin-structure.md:44` (the phrase "ownEventAt via run-liveness/probes.js's own ownEventRecency")
- Test: `tests/bin-lib/run-liveness/probes.test.js`
- Test: `tests/hooks-resume-freshness.test.js` (run, unchanged)
- Test: `tests/run-liveness-callers-conformance.test.js` (run, unchanged)

**Interfaces:**
- Consumes: `readEventLines(runDir) -> object[] | null` from `plugin/bin/lib/hooks/context.js` (already imported).
- Produces: unchanged exports `{ DEFAULT_PROBES, ownEventRecency, lastCommitMs }`. A new module-private helper `newestOwnMs(lines: object[]) -> number|null` (not exported).

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/run-liveness/probes.test.js`, after the existing `ownEventAt over an empty events.jsonl is all null` test (reuse its `runDirWith`, `T1`, `T2`):

```js
test('ownEventAt reads events.jsonl exactly once per call', () => {
  const dir = runDirWith([
    JSON.stringify({ type: 'skill_invoked', ts: T2, attribution: 'owner' }),
    JSON.stringify({ type: 'session-end', ts: T1, sessionId: 'A', attribution: 'owner' }),
  ]);
  const realRead = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (file, ...rest) {
    if (path.basename(String(file)) === 'events.jsonl') reads += 1;
    return realRead.call(this, file, ...rest);
  };
  let result;
  try { result = DEFAULT_PROBES.ownEventAt(dir, 'A'); } finally { fs.readFileSync = realRead; }
  assert.deepStrictEqual(result, { lastOwnMs: Date.parse(T2), lastSessionEndMs: Date.parse(T1) });
  assert.strictEqual(reads, 1);
});

test('ownEventAt throws when events.jsonl is unreadable (a directory)', () => {
  const dir = runDirWith(null);
  fs.mkdirSync(path.join(dir, 'events.jsonl'));
  assert.throws(() => DEFAULT_PROBES.ownEventAt(dir), /could not read events\.jsonl/);
});
```

- [ ] **Step 2: Run tests to verify the one-read test fails**

Run: `node --test --test-name-pattern="exactly once" tests/bin-lib/run-liveness/probes.test.js`
Expected: FAIL — `reads` is 2 (`ownEventRecency`'s read plus the session-end scan's read).

(The unreadable-directory test passes before and after; it pins the throw semantics the refactor must keep.)

- [ ] **Step 3: Implement the single pass in `plugin/bin/lib/run-liveness/probes.js`**

Extract `newestOwnMs(lines)` holding `ownEventRecency`'s current loop verbatim (skip falsy and `attribution === 'fallback'` events, skip `Number.isNaN(Date.parse(ev.ts))`, keep the max). `ownEventRecency` becomes: one `readEventLines`, `null` → `{ readable: false, lastOwnMs: null }`, else `{ readable: true, lastOwnMs: newestOwnMs(lines) }`. `ownEventAt` becomes: one `readEventLines`; `null` → throw the existing `could not read events.jsonl in ${runDir}` error; then the existing session-end loop over that same array; return `{ lastOwnMs: newestOwnMs(lines), lastSessionEndMs }`. Update the header comment's parenthetical "(archive-merged.js's isAbandonedInterrupted path and `ownEventAt` below; …)" so it no longer claims `ownEventAt` reads `readable` (it now distinguishes absent from empty through `readEventLines`'s own `null` vs `[]`).

In `docs/plugin-structure.md:44`, replace "ownEventAt via run-liveness/probes.js's own ownEventRecency" with "ownEventAt (one events.jsonl read shared with ownEventRecency's newest-own-event rule, #4560)". Change nothing else on that line.

- [ ] **Step 4: Run the suites to verify they pass**

Run: `node --test tests/bin-lib/run-liveness/probes.test.js tests/bin-lib/run-liveness/index.test.js tests/run-liveness-callers-conformance.test.js tests/hooks-resume-freshness.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-liveness/probes.js docs/plugin-structure.md tests/bin-lib/run-liveness/probes.test.js
git commit -m "Read events.jsonl once in ownEventAt — fold the session-end scan into the recency pass, refs #4560" -m "Claude-Session: https://claude.ai/code/session_01JHXvgY6MvYsu7HvE4KdTLq"
```

### Task 2: Rationale for the death-witness conjunctions and `LEGACY_DEAD_MS`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/run-liveness/index.js` (the `witnesses.push('session-end')` and `witnesses.push('legacy')` blocks in `gatherEvidence`, currently lines 161-174 — locate by the `witnesses.push` calls)
- Modify: `plugin/bin/lib/run-liveness/constants.js:9-10`

**Interfaces:**
- Consumes: nothing. Produces: nothing (comments only — no code token changes).

- [ ] **Step 1: Add the session-end comment** directly above `if (owner && (pid.detail === 'alive-no-start-time' …`, stating, with sources:
  - `owner` required: a legacy run has no heartbeat, so "no heartbeat since the SessionEnd" would hold vacuously and any `interrupted` stamp would kill it (#3973 Gotchas; design doc Part A).
  - `pid.detail` is `alive-no-start-time` or `no-pid`: this route is the witness only for the case the PID row cannot judge; when it can (gone / reused / matching start time) the PID row decides (#3973 precedence rules).
  - `status === 'interrupted'` and `lastEvent === 'session-end'`: the verdict-table row's own condition — the session ended through SessionEnd (#3973 verdict table).
  - `lastSessionEndMs !== null` and `heartbeatAt < lastSessionEndMs`: "no owner heartbeat since" the SessionEnd; a nested `claude -p` (#3845) can stamp a false `interrupted` while the owner keeps heartbeating, and the heartbeat comparison keeps that live run out of `dead` (#3973 precedence rules; design doc Non-goals).

- [ ] **Step 2: Add the legacy comment** directly above `if (!owner && lock.result === 'negative' …`, stating, with sources:
  - `!owner`: the route exists only for runs with no owner block (every run before #3973); owner-block runs die through the pid or session-end witness.
  - lock negative, commit negative with `absentOrOld`, owner-events negative: all three activity signals silent for `LEGACY_DEAD_MS` (or no worktree/commits at all) — the SessionEnd route alone is never enough for a legacy run, so a false `interrupted` from #3845 cannot kill an idle but live legacy run (#3973 verdict table, legacy row).
  - Removal condition lives in `docs/reconcile-checks.md` (`ownerlessNonCleanZeroSince`), tracked by #4436.

- [ ] **Step 3: Extend the `LEGACY_DEAD_MS` comment in `constants.js`** to say: 72 h was a design-time judgment (run-directory-cleanup design doc, 2026-10-22, "Claude's call" 3), not a measured value — no measurement behind the specific number is recorded; it applies the design's "close runs conservatively" rule, and the design allows tuning it only with evidence and never in the fail-open (shorter) direction without a measured reason. The same bound is reused as reconcile's `unknown` fallback floor (`archive-merged.js`).

- [ ] **Step 4: Verify no code token changed and the suites pass**

Run: `git diff -U0 plugin/bin/lib/run-liveness/index.js plugin/bin/lib/run-liveness/constants.js`
Expected: every added/removed line starts with `//` after its leading whitespace (comment-only diff).

Run: `node --test tests/bin-lib/run-liveness/index.test.js tests/bin-lib/run-liveness/constants.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-liveness/index.js plugin/bin/lib/run-liveness/constants.js
git commit -m "Document run-liveness death-witness rationale — sourced from #3973 and the run-directory-cleanup design, refs #4560" -m "Claude-Session: https://claude.ai/code/session_01JHXvgY6MvYsu7HvE4KdTLq"
```

### Task 3: Record the fix/drop note on #4560 (orchestrator, after Tasks 1-2)

**Role:** integration

Run by the `/build` orchestrator, not dispatched to an implementer (it writes GitHub state).

- [ ] **Step 1:** Post one comment on #4560 (`gh issue comment 4560 --body-file {file}`, body written with the Write tool to a session temp file) with one line per Deliverable:
  - D1 fixed — rationale comments in `index.js` (session-end and legacy conjunctions) and `constants.js` (`LEGACY_DEAD_MS`), sourced from #3973 and the 2026-10-22 run-directory-cleanup design; the 72 h value has no recorded measurement, and the comment says so.
  - D2 dropped — `runLiveness` deliberately consults every probe with no short-circuit (#3973) so its evidence stays complete; after D3 the resume paths' extra cost is one `events.jsonl` parse plus a `ps` spawn only when the owner pid is alive on this host with a stored start time, and short-circuiting through the `probes` seam would put fabricated `error` entries and an `unknown` verdict into the evidence these callers return; #4471 reshapes both callers next.
  - D3 fixed — `ownEventAt` reads `events.jsonl` once; the third parse (`classifyRunDir`'s own `ownEventRecency` before `runVerdict`) is left as is, as the spec allows.
- [ ] **Step 2:** Record AC evidence: write the posted comment URL and the #1426 check (`gh api repos/thn-inc/claude-tweaks/issues/1426/comments --paginate` filtered to `run-liveness` lines, all three promoted lines ending `→ #4560`) to `$PIPELINE_RUN_DIR/evidence/ac-4560.txt` (the main-checkout run dir, `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-31T095333-record-4560`; run `mkdir -p` on its `evidence/` first, as its own call) with a plain Bash redirect, and log one `log-decision.js --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file {file}` entry naming AC1.1 and AC2.1 and that path.
