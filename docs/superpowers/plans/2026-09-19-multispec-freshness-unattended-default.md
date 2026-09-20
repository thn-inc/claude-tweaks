# Multi-Spec Boundary Freshness — Unattended Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `skills/flow/multispec-freshness.md`'s Escalation section (`plugin/skills/flow/multispec-freshness.md`) an `autonomy: unattended` default so a boundary-freshness HARD-GATE whose overlap touches only this run's own modified paths — never a remaining spec's declared `### Key Files` — and whose merge is conflict-free auto-selects option 1 (merge + re-validate premises) and logs an `AUTO` decision, instead of always raising `AskUserQuestion` with nobody present to answer it.

**Architecture:** Insert one new subsection ("Unattended default") into the Escalation section, between its intro paragraph and the existing `AskUserQuestion` call. It reuses the Check section's already-computed `incoming`/`remaining-Key-Files` sets (no new, independently-derived overlap definition) to test a narrower condition, attempts the merge, and either auto-applies option 1's existing procedure (logging a new `AUTO` line) or falls through unchanged to today's `AskUserQuestion`. `tests/multispec-boundary-freshness.test.js` (prose-conformance style, regex-pinned) gets new assertions pinning the new subsection's presence and its still-stops fallback conditions.

**Tech Stack:** Markdown skill-prose (no executable logic — this file is read by an LLM at runtime, not parsed by code) + `node --test` prose-conformance tests.

**Spec:** GitHub issue #2541 ("flow multi-spec: boundary freshness HARD-GATE has no unattended default"), materialized at `.claude-tweaks/pipelines/2026-09-19T190711-record-2541/work/2541-spec.md`.

## Global Constraints

- Reuse the gate's own existing overlap computation (`incoming`, `run-modified`, `remaining-Key-Files` — Check section steps 1-4) rather than a separate, potentially-diverging check (spec Gotchas).
- `MULTISPEC_KEEP_GOING` must not be confused with, or used to bypass, this new unattended auto-select — it is a distinct, autonomy-tier-gated default (spec Gotchas).
- `supervised`/`trusted` autonomy behavior is unchanged (spec AC3): only `unattended` takes the new branch.
- A conflicting merge, or an overlap that reaches a remaining spec's `### Key Files`, still stops at `AskUserQuestion` exactly as today (spec AC2, Deliverable 2).
- `npm test` must pass, including new coverage for the unattended auto-select path (spec AC4).

---

### Task 1: Add prose-conformance test coverage for the unattended default (write failing tests first)

**Files:**
- Modify: `tests/multispec-boundary-freshness.test.js` (append new `test(...)` blocks after the existing ones, before the final `test('multispec-batch-curation.md derives its batch diff base...')` block or after it — order among independent tests doesn't matter; append at end of file)

**Interfaces:**
- Consumes: `FRESHNESS` (existing const, path to `plugin/skills/flow/multispec-freshness.md`), `codeRegions()` (existing helper) — both already defined at the top of the file; no new helpers needed.
- Produces: nothing consumed by later tasks — this task only adds test assertions that Task 2's prose edit must satisfy.

- [ ] **Step 1: Write the failing tests**

Append to `tests/multispec-boundary-freshness.test.js`:

```javascript
test('multispec-freshness.md states an autonomy:unattended default before the AskUserQuestion call', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  const escalationStart = text.indexOf('## Escalation');
  assert.notStrictEqual(escalationStart, -1, 'Escalation section must exist');
  const askAt = text.indexOf('Call `AskUserQuestion`', escalationStart);
  assert.notStrictEqual(askAt, -1, 'AskUserQuestion call must exist in Escalation section');
  const unattendedAt = text.indexOf('**Unattended default.**', escalationStart);
  assert.notStrictEqual(unattendedAt, -1, 'Unattended default subsection must exist');
  assert.ok(unattendedAt < askAt, 'Unattended default subsection must precede the AskUserQuestion call');
});

test('multispec-freshness.md unattended default resolves the autonomy policy and gates on unattended only', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  assert.match(text, /resolve-policy\.js"\s+--values autonomy/, 'must resolve the autonomy policy value');
  assert.match(text, /autonomy: unattended/, 'must name the unattended tier explicitly');
  assert.match(text, /`supervised`\/`trusted`.*fall through to `AskUserQuestion`/, 'must state supervised/trusted are unaffected');
});

test('multispec-freshness.md unattended default reuses the existing overlap sets, never a fresh computation', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  const escalationStart = text.indexOf('## Escalation');
  const section = text.slice(escalationStart);
  assert.match(section, /incoming.*remaining-Key-Files/, 'must test incoming against remaining-Key-Files');
  assert.match(section, /never a fresh, independently-derived computation/, 'must disclaim a fresh computation');
});

test('multispec-freshness.md unattended default auto-applies option 1 and logs a distinct AUTO line on clean, non-overlapping merges', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  assert.match(text, /auto-selected option 1 under autonomy:unattended/, 'must log a distinct AUTO entry naming the auto-select');
  assert.match(text, /no `AskUserQuestion` for this boundary/, 'must state no AskUserQuestion fires on the auto-select path');
});

test('multispec-freshness.md unattended default still stops for a remaining-spec overlap, a merge conflict, or a broken premise', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  const escalationStart = text.indexOf('## Escalation');
  const section = text.slice(escalationStart);
  assert.match(section, /overlap reaches a remaining spec's `### Key Files`/, 'must still escalate on remaining-spec overlap');
  assert.match(section, /or the merge conflicts/, 'must still escalate on merge conflict');
  assert.match(section, /git merge --abort/, 'a conflicting auto-attempt must abort to restore the clean tree');
  assert.match(section, /[Ss]omething broke.*fall through to `AskUserQuestion`/, 'a broken premise found during auto-revalidation must still escalate');
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test tests/multispec-boundary-freshness.test.js`
Expected: FAIL — the five new tests fail (prose not yet present in `plugin/skills/flow/multispec-freshness.md`); the pre-existing tests in this file still PASS.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/multispec-boundary-freshness.test.js
git commit -m "test(flow): pin the boundary-freshness unattended-default prose (failing, #2541)

refs #2541"
```

---

### Task 2: Add the unattended default to multispec-freshness.md's Escalation section

**Files:**
- Modify: `plugin/skills/flow/multispec-freshness.md` (Escalation section, lines 21-36 in the pre-edit file — insert a new subsection between the intro paragraph, which ends `"...skipping ahead dodges nothing. (The check itself also runs at every boundary regardless of whether the prior spec completed, failed, or was skipped.)"`, and the line `"Call \`AskUserQuestion\`:"`)

**Interfaces:**
- Consumes: nothing new — the inserted prose references the Check section's already-named `incoming` and `remaining-Key-Files` sets (steps 3-4, already present in the file) and `_shared/auto-mode-contract.md`'s `autonomy` tier vocabulary (already used project-wide, e.g. `_shared/autonomy-ceiling.md`).
- Produces: the literal strings Task 1's tests assert on — no other file in this plan reads this prose programmatically.

- [ ] **Step 1: Insert the "Unattended default" subsection**

In `plugin/skills/flow/multispec-freshness.md`, locate this existing paragraph (end of the intro, immediately before `Call \`AskUserQuestion\`:`):

```
This gate is enumerated in `_shared/auto-mode-contract.md`'s "What `auto` does NOT silence" HARD-GATE row — a registered HARD-GATE, not a new mid-flow stop category. It fires even in `auto` mode. `MULTISPEC_KEEP_GOING` does not bypass it: keep-going skips past a *failed spec*, but boundary drift invalidates every remaining spec equally — skipping ahead dodges nothing. (The check itself also runs at every boundary regardless of whether the prior spec completed, failed, or was skipped.)

Call `AskUserQuestion`:
```

Replace it with (same intro paragraph, unchanged, plus the new subsection inserted before the `Call` line):

```
This gate is enumerated in `_shared/auto-mode-contract.md`'s "What `auto` does NOT silence" HARD-GATE row — a registered HARD-GATE, not a new mid-flow stop category. It fires even in `auto` mode. `MULTISPEC_KEEP_GOING` does not bypass it: keep-going skips past a *failed spec*, but boundary drift invalidates every remaining spec equally — skipping ahead dodges nothing. (The check itself also runs at every boundary regardless of whether the prior spec completed, failed, or was skipped.)

**Unattended default.** Before calling `AskUserQuestion`, resolve `AUTONOMY=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values autonomy)`. Only under `autonomy: unattended` — `supervised`/`trusted` always fall through to `AskUserQuestion` below, unchanged — reuse the Check section's already-computed `incoming` and `remaining-Key-Files` sets (never a fresh, independently-derived computation — two independently-maintained overlap definitions would drift) to test the narrower condition `incoming ∩ remaining-Key-Files = ∅` (this escalation's overlap touched only run-modified paths, not any remaining spec's declared `### Key Files`), then attempt `git merge origin/{integration-branch}`:

- **Narrower condition holds and the merge succeeds with no conflicts** — apply option 1 automatically: re-read each remaining spec's `### Key Files` and stated assumptions against the new tip, exactly as option 1 does below. Nothing broke → write one `AUTO` entry to the parent `decisions.md` naming the moved commits — `AUTO {time} — Boundary freshness check (before spec {N}): auto-selected option 1 under autonomy:unattended (overlap was run-modified-only; merge {before short}->{after short} clean). Reversibility: med (merge commit {sha}; the run's own commits precede it).` — and proceed with no `AskUserQuestion` for this boundary. Something broke during that re-validation → the merge already landed, but fall through to `AskUserQuestion` below to surface the break — a broken premise is exactly the case that still needs a human, auto-select or not.
- **Narrower condition fails (overlap reaches a remaining spec's `### Key Files`), or the merge conflicts** (`git merge --abort` first, to restore the clean tree) — fall through to `AskUserQuestion` below unchanged.

This narrows *which* overlap still escalates once `autonomy: unattended` is in effect — the same two-way split the Check section already applies at steps 5-6 (no overlap merges silently; overlap escalates), gated one tier finer.

Call `AskUserQuestion`:
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `node --test tests/multispec-boundary-freshness.test.js`
Expected: PASS — all tests in the file, including the five added in Task 1.

- [ ] **Step 3: Run the full suite**

Run: `npm test 2>&1 | tail -60`
Expected: PASS — no regressions elsewhere (this is a prose-only change to one file plus its own test file; no other suite reads `multispec-freshness.md`'s content).

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/flow/multispec-freshness.md
git commit -m "flow: give boundary-freshness HARD-GATE an autonomy:unattended default

Under autonomy:unattended, a boundary-freshness escalation whose overlap
touches only this run's own modified paths (never a remaining spec's
Key Files) and whose merge is conflict-free now auto-selects option 1
(merge + re-validate premises) and logs an AUTO decision instead of
raising AskUserQuestion with nobody present to answer it. A remaining-
spec overlap, a merge conflict, or a broken premise found during
re-validation still stops at AskUserQuestion exactly as before.
supervised/trusted autonomy is unaffected.

refs #2541"
```

---

## Self-Review Notes

- **Spec coverage:** Deliverable 1 (unattended auto-select on conflict-free, non-overlapping-with-next-spec merges, logged as AUTO) → Task 2 Step 1's new subsection's first bullet. Deliverable 2 (keep the stop for conflicting merge / overlap with next spec's files) → Task 2 Step 1's second bullet. AC1 (disjoint-commit boundary proceeds with AUTO, no AskUserQuestion) → Task 1's fourth test + Task 2's first bullet. AC2 (overlapping/conflicting move still stops) → Task 1's fifth test + Task 2's second bullet. AC3 (supervised/trusted unchanged) → Task 1's second test + the "Only under `autonomy: unattended`" gating clause. AC4 (`npm test` passes, new coverage) → Task 1 (new tests) + Task 2 Step 3 (full suite run). Gotcha 1 (reuse existing overlap computation) → Task 1's third test + Task 2's "never a fresh, independently-derived computation" clause. Gotcha 2 (`MULTISPEC_KEEP_GOING` is a distinct mechanism) → not directly tested (no code path to conflate — `MULTISPEC_KEEP_GOING` is not referenced anywhere in the new prose, so there is nothing to accidentally couple it to); the plan's Global Constraints record the distinction as an authoring reminder for Task 2.
- **Placeholder scan:** no TBD/TODO markers; every step shows literal prose or literal test code to write.
- **Type consistency:** N/A — this plan touches no typed code, only markdown prose and `node:test` assertions using only pre-existing helpers (`fs`, `assert`, `FRESHNESS`).
