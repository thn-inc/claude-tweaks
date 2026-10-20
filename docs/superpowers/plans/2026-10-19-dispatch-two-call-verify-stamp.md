# Dispatch Two-Call Verify Stamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/flow {target} build,test` first call's test phase always leaves a `verify.js` pass stamp at the final HEAD, so the second call's review Step 1.5 (`verify.js --stamp-status`) reads `verifiedHead: true` instead of re-running `/test`.

**Architecture:** `plugin/skills/test/verification.md`'s Skip-if-recent **Mismatch** bullet (the `VERIFICATION_SHA` ≠ `HEAD` case) currently hand-classifies the `{VERIFICATION_SHA}..HEAD` delta with `git diff --name-only` and, when every path is bookkeeping-only, says "skip this procedure entirely" — the runner never runs, so the pass stamp stays at `VERIFICATION_SHA`. `verify.js --stamp-status`'s `verifiedHead` requires `stamp.sha === HEAD` (pinned at `tests/bin-lib/verify/cli.test.js:366`, "a moved HEAD is never verified, even for a full-scope stamp"), so a dispatched group's second call (no conversation signal) sees no verified HEAD. The runner already owns the right behavior: a scoped invocation over a bookkeeping-only delta resolves to scope `none`, runs no suite, prints `still-verified: bookkeeping-only delta ({paths})`, and re-stamps HEAD with a `none` stamp anchored on the prior full pass — which `--stamp-status` reports as `verifiedHead: true` (pinned at `tests/bin-lib/verify/cli.test.js:585` and `:1332`). The fix routes the Mismatch bullet through that scoped invocation instead of a hand-rolled skip, adds the site to the Re-verify scoping table (the single source for *when* a site asks for scope), and pins both with a prose-conformance test.

**Tech Stack:** Markdown skill prose; `node --test` conformance test (built-in, no deps).

**Spec:** `.claude-tweaks/pipelines/2026-10-19T202749-record-3284/work/3284-spec.md` (record #3284)

## Global Constraints

- Prose edits stay surgical: change only the Mismatch bullet and add one table row; do not reword the Match/Signal-absent bullets or other table rows.
- `plugin/skills/test/verification.md` is ~45 KB against the 50 KB governed-corpus ceiling — the net edit must be byte-neutral or smaller (measure `wc -c` before and after).
- Commit message style: `{Verb} {what} — {detail}`, referencing the record as `refs #3284` (never `closes`/`fixes`).
- Skill references inside actionable instruction text use the fully-qualified `/claude-tweaks:{skill}` form.

## Review Focus

1. A project with **no** `.claude-tweaks/verify-scope.json` — the scoped invocation is a usage error (exit 2) without a declaration, so the Mismatch bullet must fall back to the full procedure there, never to a skip.
2. A **non-bookkeeping** delta (e.g. a `docs/journeys/**` commit after build's pass) — must still run the suites its paths map to, with the existing "Verification re-run — tree changed since build's pass" note; the bullet must not imply every mismatch is free.
3. The **Match** bullet and the **Signal absent** bullet keep their behavior unchanged (`tests/verification-skip-before-execute.test.js` pins Step 2's ordering — do not move the Skip-if-recent heading).
4. The `still-verified: bookkeeping-only delta` literal appears in `flow/multi-spec.md` exactly once (pinned) — this change must not add that literal to `multi-spec.md`.
5. The existing Re-verify scoping table rows asserted by `tests/test-skill-affected-conformance.test.js` stay intact.

Waived AC1.1: an end-to-end two-call dispatch property, not unit-testable here — the runner half (`none` stamp ⇒ `verifiedHead: true`) is already pinned at `tests/bin-lib/verify/cli.test.js:585`, Task 1 pins the prose half, and this run's own dispatched second call (`review,polish,wrap-up` against the same `PIPELINE_RUN_DIR`) observes the clause live at its review Step 1.5.

---

### Task 1: Route the Skip-if-recent Mismatch case through the runner, and pin it

**Files:**
- Modify: `plugin/skills/test/verification.md` (Skip-if-recent **Mismatch** bullet, ~line 25; Re-verify scoping table, ~lines 68-77)
- Test: `tests/test-skill-affected-conformance.test.js` (append one test)

**Interfaces:**
- Consumes: the existing scoped runner invocation in `verification.md`'s "Re-verify scoping" section (`node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --run "$PIPELINE_RUN_DIR" --scope .claude-tweaks/verify-scope.json --integration-branch {ref} …`) — referenced, not restated.
- Produces: nothing consumed by code; a prose contract read by `/claude-tweaks:test` and `/claude-tweaks:build`.

- [ ] **Step 1: Write the failing test** — append to `tests/test-skill-affected-conformance.test.js`:

```js
test('verification.md Skip-if-recent Mismatch re-stamps HEAD through the runner, never a hand-rolled skip (#3284)', () => {
  const v = read('plugin/skills/test/verification.md');
  const start = v.indexOf('- **Mismatch**');
  const end = v.indexOf('- **Signal absent**');
  assert.ok(start !== -1 && end > start, 'Mismatch bullet must precede the Signal absent bullet');
  const bullet = v.slice(start, end);
  assert.ok(!bullet.includes('skip this procedure entirely'), 'a moved HEAD must never skip without the runner — the stamp would stay at VERIFICATION_SHA');
  assert.ok(!bullet.includes('git diff --name-only'), 'the runner classifies the delta, not a hand-rolled git diff');
  assert.ok(bullet.includes('scoped invocation'), 'the Mismatch case runs the scoped invocation');
  assert.ok(bullet.includes('re-stamps HEAD'), 'the bullet states why: the runner re-stamps HEAD');
  assert.ok(bullet.includes('#3284'));
  assert.ok(bullet.includes('no declaration'), 'no-declaration projects fall back to the full procedure');
  const table = v.slice(v.indexOf('### Re-verify scoping'));
  const row = table.split('\n').find((l) => l.startsWith('|') && l.includes('`VERIFICATION_SHA` ≠ HEAD'));
  assert.ok(row, 'the scoping table names the build→test VERIFICATION_SHA mismatch site');
  assert.ok(row.includes('scoped (`none` on a bookkeeping-only delta)'), row);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test-skill-affected-conformance.test.js`
Expected: FAIL — the new test reports `a moved HEAD must never skip without the runner` (the current bullet still contains `skip this procedure entirely`).

- [ ] **Step 3: Rewrite the Mismatch bullet and add the table row in `plugin/skills/test/verification.md`**

Replace the whole **Mismatch** bullet with one that says, in this order: the tree changed since build's verification; do not classify the delta by hand and skip — run the scoped invocation (Re-verify scoping below) so the runner classifies `{VERIFICATION_SHA}..HEAD` against `.claude-tweaks/verify-scope.json`; a bookkeeping-only delta (every path on a `suites: []` rule — keep the existing examples: the shipped declaration's `docs/plans/*-ledger.md` and `.claude-tweaks/pipelines/**` rules, a run ledger commit, a materialized `work/*-spec.md`) resolves to `none`, runs no suite, prints `still-verified: bookkeeping-only delta ({paths})`, and re-stamps HEAD; why that matters (#3284): a skip that never invoked the runner leaves the pass stamp at `VERIFICATION_SHA`, which `--stamp-status` never reports as verifying a moved HEAD, so a dispatched group's second call (no conversation signal) re-triggers `/claude-tweaks:test` at review Step 1.5; any other delta runs the suites its paths map to, noted as `"Verification re-run — tree changed since build's pass ({old-sha} → {current-sha})."`; a project with no declaration runs the full procedure below (the scoped invocation is a usage error without one). Keep the result byte-neutral or shorter than the bullet it replaces.

Add one row to the Re-verify scoping table, directly after the `Build Common Step 5` row:

`| In-pipeline `test` after build, `VERIFICATION_SHA` ≠ HEAD (`/claude-tweaks:flow`) | scoped (`none` on a bookkeeping-only delta) |`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/test-skill-affected-conformance.test.js tests/verification-skip-before-execute.test.js tests/verification-flake-handling.test.js tests/bin-lib/verify/snippet-conformance.test.js`
Expected: PASS, `# fail 0`.

Then prove the new test discriminates (never `git stash` — the stash stack is shared across worktrees): temporarily re-insert the literal `skip this procedure entirely` into the new Mismatch bullet with the Edit tool, re-run `node --test tests/test-skill-affected-conformance.test.js`, confirm the #3284 test fails, then revert that one edit and re-run to green.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/verification.md tests/test-skill-affected-conformance.test.js
git commit -m "Route Skip-if-recent mismatch through the runner — a bookkeeping-only delta now re-stamps HEAD so a dispatched second call trusts the first call's pass (refs #3284)"
```
