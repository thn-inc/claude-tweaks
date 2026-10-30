# Hold needs-human-decision SDD rulings for a human (#4587) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `sdd-ruling-*` staged item whose one valid `Defer-reason:` is `needs-human-decision` resolves `pending — sdd-ruling-needs-human-decision` under `console-resolve.js --policy console-auto`, and the reconciler's `decideConsoleExecute` withholds it the same way. It is never auto-ratified.

**Architecture:** `sddRulingDeferralReason` (`plugin/bin/lib/console/sdd-ruling.js`) is the one classifier both trigger points call: `console/resolve.js`'s `stagedItems` for the console, and `reconcile/console-execute.js`'s `decideConsoleExecute` for the reconciler. Add a fourth member to the frozen `SDD_RULING_REASONS` and return it from the deferral branch when the single valid reason is `needs-human-decision`. Both callers already treat any non-null return as pending or as a gap, so the new reason reaches both without a branch of its own. The appendix's `sdd-ruling-*` bullet is the code's prose twin. `tests/build-sdd-ruling-deferral-gate.test.js` already iterates `Object.values(SDD_RULING_REASONS)` against it, so the new member must reach the appendix in the same task.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T090414-record-4587/work/4587-spec.md`

Scope keywords: sddRulingDeferralReason, SDD_RULING_REASONS

**Check B classification (behavior-change prose sweep).** These keyword hits are outside the task Files blocks:
- `plugin/bin/lib/console/resolve.js`: no change. `stagedItems` already passes any non-null reason through as `pending`.
- `plugin/bin/lib/wrap-up/pack.js:420`: no change. The comment only says the ruling's reason is gated by `sddRulingDeferralReason`, which stays true.
- `docs/skill-graph.md`: no change. Its `/superpowers:subagent-driven-development` edge describes the producer, not the console rule.
- `tests/build-sdd-ruling-deferral-gate.test.js`: no change. Its iterating pin covers the new member once the appendix names it (Task 1).
- `docs/journeys/route-an-sdd-deferral-ruling-through-the-fix-now-gate-3880.md`: step 4's "`apply` means … a deferral with exactly one valid reason" goes stale and the reason list lacks the new literal. `/build` Common Step 6 (`/claude-tweaks:journeys`) updates it, not a plan task.

## Global Constraints

- The new reason literal is exactly `sdd-ruling-needs-human-decision`, the frozen key is `NEEDS_HUMAN_DECISION`, and the resolved row reads `pending — sdd-ruling-needs-human-decision` (spec AC1).
- Rulings with any other valid reason resolve exactly as today (spec AC2). The `tangential` reason still ratifies (spec Deliverable 4).
- The reason VALUE check stays exact and case-sensitive. `Needs-Human-Decision` is not a `DEFER_REASONS` member, so it keeps resolving `sdd-ruling-deferral-no-defer-reason` as today.
- Governing skill `prose-code-twin-pin` (row "Pinning a code vocabulary into prose by naming each member"), verbatim: "Iterate the export by default". The new reason goes into `SDD_RULING_REASONS` so the existing iterating pin covers it. Never add a per-field assertion in place of that pin.
- Governing skill `parse-signal-discipline`, verbatim: "Decide a read failure in the caller that attempted the read, never" in the classifier. `UNREADABLE` stays caller-decided, and `sddRulingDeferralReason` keeps seeing text only.
- `plugin/skills/wrap-up/review-console-appendix.md` is 16,075 B against `RAIL_BYTES` 52,500 B. Task 1 adds about 250 B, leaving roughly 36 KB of headroom.
- Commit messages say `refs #4587`, never `closes`/`fixes`. Style: `{Verb} {what} — {detail}`.

## Review Focus

1. A `Defers: no` header with `Defer-reason: needs-human-decision`. Any `Defer-reason:` header line makes the item a deferral, so it must resolve pending too. Task 1 pins it.
2. A header with two `Defer-reason:` lines where one is `needs-human-decision` stays `sdd-ruling-deferral-no-defer-reason` (the duplicate rule wins first). Task 1 pins it.
3. A mixed-case `Defer-reason: Needs-Human-Decision` value stays `sdd-ruling-deferral-no-defer-reason`, because the value check is exact. Task 1 pins it.
4. Every other `DEFER_REASONS` member still ratifies at both trigger points. Tasks 1 and 2 loop over the list minus `needs-human-decision`.
5. The reconciler's end-to-end detect path (`consoleExecuteDetect` reading a real staged file) withholds the new reason. Task 2 pins it.

---

### Task 1: Classify `needs-human-decision` rulings as pending, with the appendix twin

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/sdd-ruling.js` (`SDD_RULING_REASONS` at lines 18-22, the deferral branch at lines 40-42, header comment lines 9-14)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (the auto-resolution paragraph's reason list, lines 48-50; the `sdd-ruling-*` console-auto bullet, lines 101-111)
- Test: `tests/bin-lib/console/resolve.test.js` (the existing test at line 1436, the `SDD_RULING_REASONS` deep-equal at lines 1498-1502, and new tests beside the #3880 block)
- Test: `tests/bin-lib/console/cli.test.js` (a new end-to-end test)
- No change: `tests/build-sdd-ruling-deferral-gate.test.js`. It already iterates `Object.values(SDD_RULING_REASONS)` against the appendix and goes green once the appendix names the new literal.
- No change: `plugin/bin/lib/console/resolve.js:646-649`. Its `stagedItems` returns `{ resolution: 'pending', reason: r }` for any non-null `r`.

**Interfaces:**
- Produces: `SDD_RULING_REASONS.NEEDS_HUMAN_DECISION === 'sdd-ruling-needs-human-decision'`. `sddRulingDeferralReason(text: string|null|undefined): string|null` returns it when the header is a deferral carrying exactly one `Defer-reason:` line whose value is exactly `needs-human-decision`.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/console/resolve.test.js`:

- Change the existing test `defers-yes-valid-reason-resolves-apply` at line 1436 to use `Defer-reason: blocked-external` in place of `needs-human-decision`. Keep its name and its `apply` assertion.
- Change the deep-equal at lines 1498-1502 to include `NEEDS_HUMAN_DECISION: 'sdd-ruling-needs-human-decision'` as the fourth key.
- Add these tests (use the file's existing `RULING()`/`resolveStaged()` helpers; `DEFER_REASONS` comes from `plugin/bin/lib/issues/record`):

```js
test('AC1.1: a Defers: yes ruling whose one Defer-reason is needs-human-decision resolves pending — sdd-ruling-needs-human-decision under console-auto (#4587)', () => {
  const item = resolveStaged('sdd-ruling-1.md', RULING('Defers: yes\nDefer-reason: needs-human-decision\n'));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-needs-human-decision');
  assert.strictEqual(item.section, 'Pending review');
});

test('AC1.1: Defers: no with Defer-reason: needs-human-decision is still a deferral and resolves pending (#4587)', () => {
  const item = resolveStaged('sdd-ruling-1.md', RULING('Defers: no\nDefer-reason: needs-human-decision\n'));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-needs-human-decision');
});

test('AC2.1: every other valid Defer-reason still ratifies, tangential included (#4587)', () => {
  const others = DEFER_REASONS.filter((r) => r !== 'needs-human-decision');
  assert.ok(others.includes('tangential') && others.length === DEFER_REASONS.length - 1);
  for (const r of others) {
    assert.strictEqual(resolveStaged('sdd-ruling-1.md', RULING(`Defers: yes\nDefer-reason: ${r}\n`)).resolution, 'apply', r);
  }
});

test('AC2.1: a duplicated or mis-cased needs-human-decision reason keeps its existing no-defer-reason resolution (#4587)', () => {
  for (const header of ['Defers: yes\nDefer-reason: needs-human-decision\nDefer-reason: tangential\n', 'Defers: yes\nDefer-reason: Needs-Human-Decision\n']) {
    const item = resolveStaged('sdd-ruling-1.md', RULING(header));
    assert.strictEqual(item.resolution, 'pending', header);
    assert.strictEqual(item.reason, 'sdd-ruling-deferral-no-defer-reason', header);
  }
});
```

In `tests/bin-lib/console/cli.test.js`, add one end-to-end test using `mainCheckoutWithRun`/`baseDeps`. It runs `console-resolve.js`'s `run(['--run', fx.runDir, '--policy', 'console-auto'], d)` on a run whose `staged` holds `sdd-ruling-1.md` (header `Title:`/`Kind: sdd-ruling`/`Ruling:`/`Defers: yes`/`Defer-reason: needs-human-decision`/`Staged-at:`/`Ledger:`, blank line, body) under the default `autonomy: unattended`. Then it runs `plugin/bin/console-residue.js`'s exported `run(['--run', fx.runDir], deps)` with deps `{ cwd: () => fx.root, mainRoot: fx.root, now: () => Date.parse('2026-09-06T12:00:00Z'), pluginRoot: '/plug', stdout, stderr }`, the shape `tests/bin-lib/console/residue-cli.test.js`'s `harness` uses:

```js
test('AC1.1: an unattended needs-human-decision ruling lands in console.json as pending and appears in console-residue.js --run output (#4587)', async () => {
  // ... fixture + console-resolve run as above; exit code 0
  const cj = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'));
  const item = cj.items.find((i) => i.id === 'sdd-ruling-1.md');
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-needs-human-decision');
  // ... console-residue run; exit code 0
  assert.ok(residueOut.includes('  - sdd-ruling-1.md — Pending review: pending (sdd-ruling-needs-human-decision)'), residueOut);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js`
Expected: FAIL. The new AC1.1 tests get `apply` where they expect `pending`, and the deep-equal reports the missing `NEEDS_HUMAN_DECISION` key. This red run is the AC3.1 evidence: the tests fail without the `sdd-ruling.js` change. Quote its failing-test lines in the task report.

- [ ] **Step 3: Implement in `plugin/bin/lib/console/sdd-ruling.js`**

- Add `NEEDS_HUMAN_DECISION: 'sdd-ruling-needs-human-decision'` to `SDD_RULING_REASONS`.
- In the `defers === 'yes' || reasons.length > 0` branch, a single reason that is a `DEFER_REASONS` member and equals `'needs-human-decision'` returns `SDD_RULING_REASONS.NEEDS_HUMAN_DECISION`. Any other member still returns `null`. A missing, invalid or duplicated reason still returns `NO_DEFER_REASON`.
- Extend the header comment (lines 9-14) by one sentence: a deferral whose one reason is `needs-human-decision` resolves pending under that reason, since the reason itself says a human must decide (#4587).

- [ ] **Step 4: Update the appendix twin in `plugin/skills/wrap-up/review-console-appendix.md`**

- Lines 48-50: the list becomes `pending — sdd-ruling-deferral-no-defer-reason`, `pending — sdd-ruling-needs-human-decision`, `pending — sdd-ruling-unclassified`, or `pending — sdd-ruling-unreadable`, followed by the existing parenthetical.
- The console-auto bullet at lines 101-111: after "…whose bare value is in `_shared/deferral-gate.md`'s vocabulary", add ", other than `needs-human-decision`". After the `pending — sdd-ruling-deferral-no-defer-reason` clause, add "a deferral whose one reason is `needs-human-decision` resolves `pending — sdd-ruling-needs-human-decision`, since its own reason says a human must decide (#4587);". Leave every other phrase in the bullet byte-identical. `tests/build-sdd-ruling-deferral-gate.test.js` pins "line, more than one, or a value other than `yes`/`no` resolves", "a staged file that cannot be read at all resolves `pending — sdd-ruling-unreadable`" and "the reconciler's `consoleAutoResolve` path withholds the same rows (`_shared/console-execution.md`)".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js tests/build-sdd-ruling-deferral-gate.test.js tests/console-execute.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/console/sdd-ruling.js plugin/skills/wrap-up/review-console-appendix.md tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js
git commit -m "Hold needs-human-decision SDD rulings pending at the unattended console — refs #4587"
```

### Task 2: Reconciler-side coverage for the new reason

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/reconcile/console-execute.js` (the `decideConsoleExecute` doc comment at lines 285-291 names the reasons a ruling gap carries; add `sdd-ruling-needs-human-decision` beside the others there). No logic change: line 390-391 already pushes any non-null `sddRulingDeferralReason` result into `rulingGateGaps`.
- Test: `tests/console-execute.test.js` (new tests in the `#3880: rulingGateGaps` block, lines 541-651)

**Interfaces:**
- Consumes: Task 1's `SDD_RULING_REASONS.NEEDS_HUMAN_DECISION` and `sddRulingDeferralReason`.
- Produces: nothing new. `rulingGateGaps` entries keep the shape `{ id, reason }`.

- [ ] **Step 1: Write the tests**

Add `const RULING_TEXT_NEEDS_HUMAN = 'Title: r\nKind: sdd-ruling\nDefers: yes\nDefer-reason: needs-human-decision\nStaged-at: abc\n\nbody\n';` beside the existing `RULING_TEXT_*` constants (`DEFER_REASONS` comes from `plugin/bin/lib/issues/record`), then:

```js
test('AC1.1: decideConsoleExecute withholds a needs-human-decision ruling as a gap (sdd-ruling-needs-human-decision) (#4587)', () => {
  const cj = rulingConsoleJson([{ id: 'staged-1', kind: 'staged', summary: 'r', isRulingRow: true }]);
  const result = decideConsoleExecute(cj, tickedComment(['staged-1']), Date.now(), { rulingTexts: { 'staged-1': RULING_TEXT_NEEDS_HUMAN } });
  assert.deepStrictEqual(result.rulingGateGaps, [{ id: 'staged-1', reason: 'sdd-ruling-needs-human-decision' }]);
});

test('AC2.1: decideConsoleExecute leaves every other valid Defer-reason ruling floor-clearing, tangential included (#4587)', () => {
  for (const r of DEFER_REASONS.filter((x) => x !== 'needs-human-decision')) {
    const text = `Title: r\nKind: sdd-ruling\nDefers: yes\nDefer-reason: ${r}\nStaged-at: abc\n\nbody\n`;
    const cj = rulingConsoleJson([{ id: 'staged-1', kind: 'staged', summary: 'r', isRulingRow: true }]);
    assert.deepStrictEqual(decideConsoleExecute(cj, tickedComment(['staged-1']), Date.now(), { rulingTexts: { 'staged-1': text } }).rulingGateGaps, [], r);
  }
});
```

Add one end-to-end test beside `AC3.1 AC3.3: consoleExecuteDetect reads each ruling row's staged file…`, with the same `{ skip: process.platform === 'win32' }` option and the same `makeRulingRepo`/`detectWithFakePr` helpers. One ruling row with `stagedPath: 'staged/sdd-ruling-1.md'` holds `RULING_TEXT_NEEDS_HUMAN`. Assert `result.ready[0].rulingGateGaps` deep-equals `[{ id: 'staged-1', reason: 'sdd-ruling-needs-human-decision' }]`.

- [ ] **Step 2: Run the tests**

Run: `node --test tests/console-execute.test.js`
Expected: PASS once Task 1 has landed, because the classifier already routes the reason. Prove these tests discriminate in a scratch worktree (`git worktree add`, never in place): revert only Task 1's `sdd-ruling.js` change there and show the AC1.1 tests go red. Quote that red output in the task report.

- [ ] **Step 3: Update the `decideConsoleExecute` doc comment in `plugin/bin/lib/reconcile/console-execute.js`**

At lines 289-291, say that a ruling gap's `reason` is any `SDD_RULING_REASONS` value `sddRulingDeferralReason` returns, `sdd-ruling-needs-human-decision` included (#4587).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/console-execute.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/console-execute.js tests/console-execute.test.js
git commit -m "Pin the reconciler's withhold of needs-human-decision rulings — refs #4587"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (`sddRulingDeferralReason` returns the new pending reason) | Task 1 Step 3 |
| Deliverable 2 (the appendix bullet names it) | Task 1 Step 4 |
| Deliverable 3 (`decideConsoleExecute` treats it the same way) | Task 2 |
| Deliverable 4 (test: needs-human-decision pending, tangential ratifies) | Task 1 Step 1, Task 2 Step 1 |
| AC1.1 (console.json `pending — sdd-ruling-needs-human-decision` + `console-residue.js --run`) | Task 1's `cli.test.js` test |
| AC2.1 (other valid reasons unchanged) | Task 1 and Task 2 AC2.1 tests |
| AC3.1 (the new test fails when the `sdd-ruling.js` change is reverted) | Task 1 Step 2 red run, Task 2 Step 2 scratch-worktree revert |
