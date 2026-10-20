# SessionStart banners say never to run their command (#3475) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution:** batched
**Batch:** send every task to one implementer as a single brief; review the combined diff once.

**Goal:** Every SessionStart inform-tier banner that prints a runnable command tells the model to relay it and never run it itself.

**Architecture:** One string edit in `plugin/bin/lib/hooks/session-start.js` (the standalone staged-proposals banner's trailing relay line), plus test assertions in `tests/hooks-session-start.test.js` pinning the never-run clause on both the unfinished-runs banner and the staged-proposals banner.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T175954-record-3475/work/3475-spec.md` (materialized from GitHub issue #3475)

## Global Constraints

- Convention source: `docs/hooks.md` line 23 (#3419), "a line carrying a runnable command also says `never run it yourself`".
- **Corrected premise (verified at build, logged to decisions.md):** the unfinished-runs banner (`session-start.js:146-148`) already ends its relay line with `and never run either command yourself` (added by #3497, `31d2ce142`). That line's copy is NOT changed. Only its test pin is added in the plain-run test.
- Touch nothing else. In particular, the console-residue banner (`session-start.js:189-191`) is left alone, because it deliberately instructs the model to run its own `--ack` command.

## Review Focus

- A plain interrupted run (no multi-spec re-entry suffix) must still carry the never-run clause. Today only the AC6.1 re-entry fixture pins it, so a regression on the plain path would pass. This is pinned in Task 1, Step 1(a).
- The staged-proposals banner must keep its existing relay directive. The new clause is appended to it and replaces nothing. This is pinned by the existing `Relay this list once…` assertion plus the new one.

---

### Task 1: Add the never-run clause to the staged-proposals banner and pin it on both banners

**Files:**
- Modify: `plugin/bin/lib/hooks/session-start.js:172`
- Test: `tests/hooks-session-start.test.js:82-88` (the `#803` test) and `:103-110` (the `#1493 I4` test)

**Interfaces:** none (copy change only).

- [ ] **Step 1: Write the failing assertions**

(a) In the `#803: the banner names a designated consumer…` test, after the existing `assert.match`, add:

```js
  assert.ok(ctx.includes('do not proceed silently without mentioning it, and never run either command yourself'), 'AC1.1: unfinished-runs banner says never run the command yourself');
```

(b) In the `#1493 I4: the tidy --approve banner names a designated consumer…` test, after the existing `assert.match`, add:

```js
  assert.ok(ctx.includes('naming its tidy --approve command — do not proceed silently without mentioning it, and never run it yourself.'), 'AC1.1: staged-proposals banner says never run the command yourself');
```

Rename the I4 test title to append ` — AC1.1: and never to run it` so the clause id is on the test name.

- [ ] **Step 2: Run to verify (b) fails and (a) passes**

Run: `node --test tests/hooks-session-start.test.js`
Expected: FAIL. Exactly one failure, the `#1493 I4` test. (a) already passes, because #3497 shipped that copy. Go-red for (a) means temporarily deleting `, and never run either command yourself` from line 147, confirming that test fails, then restoring the line.

- [ ] **Step 3: Implement**

In `plugin/bin/lib/hooks/session-start.js` line 172, change the trailing string to:

```js
          'Relay this list once, in your first reply to the user, one line per run naming its tidy --approve command — do not proceed silently without mentioning it, and never run it yourself.',
```

Update the comment directly above it (lines 164-167) only if it would now be false. It is not, so leave it.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/hooks-session-start.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/session-start.js tests/hooks-session-start.test.js
git commit -m "Make the staged-proposals SessionStart banner say never to run its command — pin both banners' never-run clause (refs #3475)"
```

AC2.1 (`npm test` passes) is covered by /build's Common Step 5 final verification, not by this task.

---

## Self-review

- **Spec coverage:** Deliverable 1 is already shipped (#3497). Its pin is added in Step 1(a). Deliverable 2 is covered by Step 3. Deliverable 3 is covered by Steps 1(a) and 1(b). AC1.1 is covered by Steps 1(a) and 1(b). AC2.1 is covered by Common Step 5.
- **Placeholders:** none.
- **Pins:** `git grep -n -F "naming its tidy --approve command"` hits only `session-start.js:172`, so no other test or prose pins the changed string.
