# Unresumable-State Adoption Precondition (#4419) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `run-dir-resolve.js`'s `deadState` to an adoption-precondition name, delete the caller-less `isDeadRunDir`, move its pinned properties onto `adoptionRefusal`, and reword the docs from "dead" to "unresumable" — with no behaviour change.

**Architecture:** A rename and a deletion inside one module (`plugin/bin/lib/hooks/run-dir-resolve.js`), the test migrations that follow from it, and two wording edits. `adoptionRefusal`'s check order and reason strings (including `'dead'`) stay exactly as they are. Adoption deliberately does not consult `runLiveness` (crash-resume ruling, 2026-10-26).

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T123848-spec-4336-4419-4420-4421/spec-4419/work/4419-spec.md`

## Global Constraints

- `adoptionRefusal`'s outcomes are unchanged for every input; the `'dead'` reason string stays and keeps exactly the two preconditions (`status: 'interrupted'`, or `status: 'active'` with a recorded `worktree` that no longer exists).
- `run-dir-resolve.js` must not require `run-liveness` (AC 5).
- The renamed predicate stays module-private (not exported).
- Leave `adoptionRefusal`'s lazy `require('./run-integrity')` as it is (load-time cycle `run-integrity` → `context` → this module).
- `docs/hooks.md` holds one very long line per bullet: edit the sentence in place, never reflow the bullet.
- `git grep -n isDeadRunDir -- plugin tests docs` returns nothing outside `docs/plans/` (AC 1).

## Review Focus

- A bare mint (no `run-state.json`) passed to `adoptionRefusal` must return `null` and not throw — it is adopted, never refused (Task 1 pins it).
- A malformed `run-state.json` must return `'unreadable-run-state'` and not throw (Task 1 pins it).
- An `active` run whose worktree survives but whose owner pid is gone (a crash) must stay adoptable by `newestMatch` — refusing it would mint a fresh run and drop the old `config.yml`, staged items and claim (Task 1's crash-resume test pins it).
- `active` with no recorded `worktree` must stay `null` (adoptable); the existing `withState({ status: 'active' })` assertion already pins this and must stay unchanged.
- Stale comments: the `newestMatch` and `adoptionRefusal` header comments still say "dead check" / "dead per #1962" after the rename — Task 1 rewords them so the code and docs agree.

---

### Task 1: Rename the precondition, delete `isDeadRunDir`, migrate its tests

**Files:**
- Modify: `plugin/bin/lib/hooks/run-dir-resolve.js:83-101` (rename `deadState`, replace the #1962 comment block, delete `isDeadRunDir`), `:104-110` (`adoptionRefusal` header comment), `:126` (call site), `:136-144` (`newestMatch` header comment), `:316` (export list)
- Test: `tests/hooks-run-dir-resolve.test.js:16` (import), `:292-302` (the two `isDeadRunDir` tests), `:305-307` (comment above #4151 AC1.1)
- Test: `tests/bin-lib/run-liveness/index.test.js:11` (import), `:235` (AC11.1 call)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `unresumableState(state: object|null) -> boolean` (module-private, same body as today's `deadState`); `module.exports = { resolve, formatTimestamp, adoptionRefusal, RUN_ID_RE }`. Task 2's docs describe these names.

- [ ] **Step 1: Write the migrated and new tests**

In `tests/hooks-run-dir-resolve.test.js`:
- Line 16: drop `isDeadRunDir` from the destructured import.
- Replace the two `isDeadRunDir:` tests (lines 292-302) with:

Add `const { ownerBlock } = require('../plugin/bin/lib/hooks/context');` below the `run-dir-resolve` import (Real-writer fixture: the owner block comes from the module that writes it in production, not a hand-typed literal).

```js
test('AC4.1 AC4.2: adoptionRefusal on a bare mkdir-only mint (no run-state.json) is adoptable and never throws', () => {
  const main = gitRepo();
  const bare = mkRunDir(main, '2026-01-01T000000-record-1');
  let reason;
  assert.doesNotThrow(() => { reason = adoptionRefusal(bare); });
  assert.strictEqual(reason, null);
});

test('AC4.1 AC4.2: adoptionRefusal on a malformed run-state.json is refused as unreadable rather than throwing', () => {
  const main = gitRepo();
  const dir = mkRunDir(main, '2026-01-01T000000-record-2');
  fs.writeFileSync(path.join(dir, 'run-state.json'), '{not json');
  let reason;
  assert.doesNotThrow(() => { reason = adoptionRefusal(dir); });
  assert.strictEqual(reason, 'unreadable-run-state');
});

// #4419: adoption is not a liveness verdict. An `active` run whose worktree survives but
// whose owner process is gone is exactly a crash a resuming session must adopt.
test('AC3.1 AC3.2 #4419: step 2 adopts an active run whose worktree survives but whose owner pid is gone (crash-resume)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const crashed = mkRunDir(main, '2026-01-01T000000-record-4419');
  const owner = ownerBlock({
    sessionId: 'crashed-session',
    now: Date.parse('2026-01-01T00:00:00Z'),
    deps: {
      resolveOwnerPid: () => ({ pid: 2147483646, pidSource: 'env' }),
      pidStartTime: () => 'T1',
      hostname: () => 'h',
    },
  });
  writeRunState(crashed, { status: 'active', worktree: wt, sessionId: 'crashed-session', owner });
  const out = resolve({ cwd: main, env: {}, specSlug: 'record-4419' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, false);
  assert.strictEqual(out.path, crashed);
});
```

- Comment above `#4151 AC1.1` (line 307): change "consults instead of `isDeadRunDir` alone (#1962)" to "consults for its refusal reasons, the #1962 unresumable check among them".

In `tests/bin-lib/run-liveness/index.test.js`:
- Line 11: import `adoptionRefusal` instead of `isDeadRunDir` from the same module.
- Line 235: `assert.doesNotThrow(() => adoptionRefusal(fx.runDir));`

- [ ] **Step 2: Run the tests and the AC 1 grep to see the starting state**

Run: `node --test tests/hooks-run-dir-resolve.test.js tests/bin-lib/run-liveness/index.test.js`
Expected: PASS — the migrated tests and the crash-resume test pin behaviour that already holds (this is a no-behaviour-change refactor; they are characterization tests).

Run: `git grep -n isDeadRunDir -- plugin tests docs ':!docs/plans'`
Expected: FAIL for AC1.1 — hits remain in `plugin/bin/lib/hooks/run-dir-resolve.js` (definition and export).

Prove the crash-resume test discriminates: temporarily add `if (state.owner && state.owner.pid === 2147483646) return 'dead';` just before `adoptionRefusal`'s final `return null;`, re-run `node --test tests/hooks-run-dir-resolve.test.js`, and confirm the `AC3.1 AC3.2 #4419: step 2 adopts … (crash-resume)` test FAILS. Remove the line.

AC2.1-AC2.5 are covered by leaving every existing `adoptionRefusal`/`newestMatch` test byte-identical: `git diff -U0 tests/hooks-run-dir-resolve.test.js` after Step 1 shows only the import lines, the two replaced `isDeadRunDir` tests, the new AC3.1 test and the one comment line; the AC2.2, AC2.3, AC2.4 and AC2.5 assertions (`interrupted` → `'dead'`, worktree gone → `'dead'`, worktree present → `null`, no worktree → `null`) are among the unchanged lines.

- [ ] **Step 3: Rename and delete in `plugin/bin/lib/hooks/run-dir-resolve.js`**

- Rename `deadState` → `unresumableState` (definition and the one call in `adoptionRefusal`; `return 'dead'` stays).
- Replace the #1962 comment block above `isDeadRunDir` with a header comment directly above `unresumableState` stating: these are adoption preconditions — an adopted run needs a live status (`interrupted` is an explicit can't-resume stamp) and its recorded worktree on disk — not a liveness verdict; `runLiveness` is deliberately not consulted here, because a `dead` verdict on an `active` run is the crash-resume (owner pid gone) or long-idle (legacy 72h) case, and both must stay adoptable (#3979 red-team, #4419). Keep the #1962 rationale (adopting such a dir inherits a closed PR number, stale config.yml/staged items and a foreign claim runId).
- Delete `isDeadRunDir` entirely and remove it from `module.exports`.
- `adoptionRefusal`'s header comment: "then the #1962 dead check" → "then the #1962 unresumable check (`unresumableState` above)".
- `newestMatch`'s header comment: "dead per #1962" → "unresumable per #1962".

- [ ] **Step 4: Verify**

Run: `node --test tests/hooks-run-dir-resolve.test.js tests/bin-lib/run-liveness/index.test.js`
Expected: PASS

Run: `git grep -n "isDeadRunDir\|deadState" -- plugin tests docs ':!docs/plans'`
Expected: no output (exit 1)

Run: `grep -n "require(.*run-liveness" plugin/bin/lib/hooks/run-dir-resolve.js`
Expected: no output (AC5.1)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/run-dir-resolve.js tests/hooks-run-dir-resolve.test.js tests/bin-lib/run-liveness/index.test.js
git commit -m "Rename run-dir adoption precondition to unresumableState — delete caller-less isDeadRunDir, pin crash-resume adoption (#4419)"
```

---

### Task 2: Reword the adoption docs from "dead" to "unresumable"

**Files:**
- Modify: `docs/hooks.md:30` (the `newestMatch` sentence "Step 2 also skips a dead directory and any other unadoptable one …" inside the Background convergence bullet — one line, edit in place)
- Modify: `plugin/skills/_shared/pipeline-run-dir.md:26-27` ("that is dead (`interrupted`, or `active` with its stamped worktree gone)")

**Interfaces:**
- Consumes: Task 1's names (`adoptionRefusal`, the `'dead'` reason string unchanged).
- Produces: nothing code depends on.

- [ ] **Step 1: Write the wording check**

The check is the pair of counts below: the old "dead" phrasing must be gone from both files and "unresumable" present in both.

- [ ] **Step 2: Run the check to verify it fails**

Run: `grep -l "unresumable" docs/hooks.md plugin/skills/_shared/pipeline-run-dir.md`
Expected: FAIL — exit 1, no output (neither doc says "unresumable" yet).

- [ ] **Step 3: Edit `docs/hooks.md` and `plugin/skills/_shared/pipeline-run-dir.md`**

`docs/hooks.md`: Replace "Step 2 also skips a dead directory and any other unadoptable one (" with "Step 2 also skips an unresumable directory (`interrupted`, or `active` with its stamped worktree gone) and any other unadoptable one (", and after "falling through to the next-newest match (#1962/#4151)" add "; liveness is not part of the adoption decision — `runLiveness` is never consulted, so a crashed run whose worktree survives stays adoptable (#4419)". Same line, no reflow.

`plugin/skills/_shared/pipeline-run-dir.md`: Replace "that is dead\n  (`interrupted`, or `active` with its stamped worktree gone)" with "that is unresumable\n  (`interrupted`, or `active` with its stamped worktree gone; liveness is not consulted, so a crashed run whose worktree survives is still adopted)". Keep the existing ~100-column wrapping of that paragraph.

- [ ] **Step 4: Run the check to verify it passes**

Run: `grep -c "skips a dead directory" docs/hooks.md; grep -c "that is dead" plugin/skills/_shared/pipeline-run-dir.md; grep -c "unresumable" docs/hooks.md plugin/skills/_shared/pipeline-run-dir.md`
Expected: `0`, `0`, and a count ≥ 1 for each file.

Run: `npm test` (via `node plugin/bin/verify.js` at the build's Common Step 5)
Expected: 0 failures (AC6.1) — conformance suites pin skill prose.

- [ ] **Step 5: Commit**

```bash
git add docs/hooks.md plugin/skills/_shared/pipeline-run-dir.md
git commit -m "Reword run-dir adoption docs from dead to unresumable — liveness is not part of adoption (#4419)"
```
