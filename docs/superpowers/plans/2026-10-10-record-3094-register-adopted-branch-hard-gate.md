# Register the Adopted-Branch Collision Stop as a HARD-GATE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `_shared/auto-mode-contract.md`'s HARD-GATE / BLOCKED / STOP row names the adopted-branch collision stop, and `build/adopted-branch-collision-check.md` cites that row instead of justifying the stop by analogy.

**Architecture:** One clause appended to the contract's HARD-GATE row (after the `/test` Step 0 entry); item 4's Auto-mode paragraph in the build sub-file names the stop as a registered HARD-GATE; one conformance test pins both ends, in the shape of `tests/dispatch-mechanical-enforcement.test.js`'s #2488 row test.

**Tech Stack:** Markdown skill prose, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-10T143833-spec-3093-3094-3087/spec-3094/work/3094-spec.md`

## Global Constraints

- `plugin/skills/_shared/auto-mode-contract.md` is 41344 B; the shared ceiling is 46080 B. The added clause is under 300 B.
- `tests/adopted-branch-collision-prose-conformance.test.js:43-46` pins "**Auto mode:** … **not** a lever `_shared/auto-mode-contract.md` lists as silenceable" and "stop the build" — keep both phrases.
- `tests/dispatch-mechanical-enforcement.test.js:70-76` reads the same row and pins the #2488 clause — leave that clause untouched.
- Commit style `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa`.

## Review Focus

- The row is one physical line in a markdown table — the inserted clause must contain no newline and no unescaped `|`.

---

### Task 1: Register the stop and cite the registration

**Files:**
- Modify: `plugin/skills/_shared/auto-mode-contract.md:208`
- Modify: `plugin/skills/build/adopted-branch-collision-check.md` (item 4's `**Auto mode:**` paragraph, ~lines 82-87)
- Test: `tests/adopted-branch-collision-prose-conformance.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/adopted-branch-collision-prose-conformance.test.js`:

```js
test('the adopted-branch collision stop is registered in auto-mode-contract.md\'s HARD-GATE row, and the build sub-file cites the registration (#3094)', () => {
  const contract = read('plugin', 'skills', '_shared', 'auto-mode-contract.md');
  const row = contract.split('\n').find((l) => l.includes('HARD-GATE / BLOCKED / STOP conditions'));
  assert.ok(row, 'HARD-GATE / BLOCKED / STOP row not found');
  assert.match(row, /`\/build`'s adopted-branch collision stop \(`build\/adopted-branch-collision-check\.md`/);
  assert.match(norm(CHECK), /a registered HARD-GATE \(`_shared\/auto-mode-contract\.md`'s HARD-GATE \/ BLOCKED \/ STOP row\)/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/adopted-branch-collision-prose-conformance.test.js`
Expected: FAIL — the row has no adopted-branch clause.

- [ ] **Step 3: Register the stop in the contract**

In `plugin/skills/_shared/auto-mode-contract.md` line 208, replace

```
`/test` Step 0 (PR-bookkeeping precondition check).
```

with

```
`/test` Step 0 (PR-bookkeeping precondition check). `/build`'s adopted-branch collision stop (`build/adopted-branch-collision-check.md` items 3-4 — a same-name branch on `origin` that is `foreign`, or `unreachable` with a `remoteSha`, stops the build before the materialize commit; #3094).
```

(One physical line; no `|` added.)

- [ ] **Step 4: Cite the registration in the build sub-file**

In `plugin/skills/build/adopted-branch-collision-check.md`, item 4's `**Auto mode:**` paragraph, replace

```
   Render the card and **stop the build** before the materialize commit — the same HARD-GATE
   posture `flow/claim-targets.md` uses for a claim contest. Never let it degrade to a failed push
   and a local-only run.
```

with

```
   Render the card and **stop the build** before the materialize commit — a registered HARD-GATE
   (`_shared/auto-mode-contract.md`'s HARD-GATE / BLOCKED / STOP row), the same posture
   `flow/claim-targets.md` uses for a claim contest. Never let it degrade to a failed push and a
   local-only run.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/adopted-branch-collision-prose-conformance.test.js tests/dispatch-mechanical-enforcement.test.js tests/context-cost.test.js`
Expected: PASS. Then `wc -c plugin/skills/_shared/auto-mode-contract.md` — under 46080.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/auto-mode-contract.md plugin/skills/build/adopted-branch-collision-check.md tests/adopted-branch-collision-prose-conformance.test.js
git commit -m "Register the adopted-branch collision stop in the auto-mode HARD-GATE list — and cite the registration from the build sub-file (#3094)

Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa"
```
