# Settle 5 wrap-up digest findings (#4814) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all five below-floor `wrap-up` findings promoted from digest #1426.

**Architecture:** Four independent edits: merge-mode's run-dir resolution prose, one verify remedy string, Section C step 2's mirror fallback (prose, one-liner, tests), and `pack.js`'s header reader. No new modules.

**Tech Stack:** Markdown skill prose, Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T075725-record-4814/work/4814-spec.md`

## Global Constraints

- Commit subject style: `{Verb} {what} — {detail}`, with `refs #4814`, never a closing keyword.
- Never run `git stash` in any form; never `cd &&`: one plain command per Bash call.
- Commit tests only where the task asks for them, sized like the neighboring test files. Touch only what the task requires.
- Governing skill `skill-prose-conformance-tests`, quoted: "assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt." Tasks 1 and 3 prove go-red by running the new test against the unmodified prose (Step 2) and, for the pack fall-through, by a mutated-block control. `gh-api-module-pattern`, `bin-source-scan-conformance`: no rule applies, since no task adds a shell-out, a CLI, or a source scan. `plugin/skills/wrap-up/cleanup-procedures-execution.md` is 44,988 B against the 52,500 B rail; this plan adds about 500 B, leaving about 7,000 B of headroom. `merge-mode.md` shrinks.

## Review Focus

- A spec header with no `record:` in its frontmatter but a body line quoting `record: 999`: the pack uses the filename's number and the mirror fallback skips the file (Tasks 3, 4).
- A spec file with no frontmatter at all and a bare `record:` body line: same outcomes (Tasks 3, 4).
- CRLF frontmatter must still resolve in both readers (existing tests cover it; they must stay green).
- `wrap-up-pack.json` whose `closingRecords` is a string, an object, `null`, or absent: falls through to the mirror, never yields zero records silently (Task 3).
- A merge-mode run with a live match must still adopt it over a closed run: `run-dir-resolve.js` line 299's branch runs only after step 2, so the single `--archived` call keeps that order (Task 1, prose states it).

---

### Task 1: Collapse merge mode to the single `--archived` call

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md:11`
- Test: `tests/wrap-up-merge-mode-conformance.test.js`
- Waived `plugin/bin/lib/hooks/run-dir-resolve.js`: read to confirm `--archived` runs steps 1-2 first (lines 299-301); no change.
- Waived `docs/journeys/merge-a-parked-unattended-pr-3784.md`: line 48 stays true after the collapse; no change.

**Interfaces:** none.

- [ ] **Step 1: Write the failing test.** In `MERGE_MODE_FACTS`: change `resolve-command` to `/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" resolve-run-dir --archived --spec-slug "spec-\{n\}"/`, delete `archived-fallback` (both facts would match one string, and `assertEachFactGoesRed` requires exactly one fact per strip), and add `'live-first': /runs the live resolution first and adopts a closed run only when it resolves nothing/`. Add:

```js
test('AC1.1: merge-mode.md makes one resolve-run-dir call (#4814)', () => {
  const text = read('plugin', 'skills', 'wrap-up', 'merge-mode.md');
  assert.strictEqual((text.match(/resolve-run-dir/g) || []).length, 1);
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`. Expected: FAIL (`AC1.1` sees 2 matches; `missingFactsOf` reports `resolve-command`, `live-first`).

- [ ] **Step 3: Implement.** In `merge-mode.md` line 11, replace from `else \`node ...resolve-run-dir --spec-slug "spec-{n}"\` with no \`--create\`.` through `once (#4677):` so the text reads exactly:

```
else `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --archived --spec-slug "spec-{n}"` once, with no `--create` (#4677). That call runs the live resolution first and adopts a closed run only when it resolves nothing: wrap-up's own Phase 4 closes and archives a pr-first run whose merge it left open, so the parked run is usually under `archive/`.
```

Leave the sentences that follow (`Which closed runs that call adopts…`) unchanged.

- [ ] **Step 4: Run it to verify it passes.** Same command. Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** both files: `Collapse merge mode to one resolve-run-dir call — --archived already runs the live steps first, refs #4814`.

### Task 2: Name both pending labels in the acceptance-labeling remedy

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:1043`
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`
- Modify: `docs/journeys/verify-wrap-ups-closure-checklist-900.md` (lines 69, 70, 84)

**Interfaces:** none. `git grep` shows no other reader of this string outside these three files.

- [ ] **Step 1: Write the failing test.** In `engine-verify.test.js`, replace every `missing demo:pending label` with `missing demo:pending or accept:pending label` (all occurrences, the `doesNotMatch` lines included, or those go vacuous).

- [ ] **Step 2: Run it to verify it fails.** Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`. Expected: FAIL on the `match` assertions, e.g. `#900: missing demo:pending or accept:pending label`.

- [ ] **Step 3: Implement.** Line 1043 becomes `` `#${target}: missing ${LABELS.DEMO_PENDING} or ${LABELS.ACCEPT_PENDING} label` ``. In the journey, change the three literal `missing demo:pending label` strings the same way.

- [ ] **Step 4: Run it to verify it passes.** Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** all three files: `Name both pending labels in the acceptance-labeling remedy — the check accepts accept:pending too, refs #4814`.

### Task 3: Section C step 2: failed mirror read, non-array pack, frontmatter-only `record:`

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (lines 84, 94, and the paragraph after the fence)
- Test: `tests/wrap-up-closing-records-array-fill.test.js`
- Test: `tests/wrap-up-record-resolution-conformance.test.js`

**Interfaces:** none.

- [ ] **Step 1: Write the failing tests.** In `wrap-up-closing-records-array-fill.test.js`:
  - Give `runFallback` a `pack` option in its options bag: when not `undefined`, write `JSON.stringify(pack)` to `path.join(dir, 'wrap-up-pack.json')` before the script runs (`${RUN_DIR}` already maps to `dir`).
  - Inside the existing per-shell `for`, add (shell skip as neighbors):

```js
for (const [label, pack] of Object.entries(NON_ARRAY_PACKS)) {
  test(`${shell.name}: a pack whose closingRecords is ${label} falls through to the mirror headers (#4814 AC1.1)`, { skip }, () => {
    const r = runFallback(shell, liveBlock(), { '101-spec.md': specHeader(101) }, { pack });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual({ count: r.count, els: r.els }, { count: 1, els: ['101'] });
  });
}
test(`${shell.name}: control — a guard exiting 0 on a non-array yields zero records, so the fall-through test can go red (#4814)`, { skip }, () => {
  const mutated = liveBlock().replace('if(!Array.isArray(c))process.exit(1)', 'if(!Array.isArray(c))process.exit(0)');
  assert.notStrictEqual(mutated, liveBlock(), 'the guard literal vanished: the control would be vacuous');
  const r = runFallback(shell, mutated, { '101-spec.md': specHeader(101) }, { pack: NON_ARRAY_PACKS.string });
  assert.deepStrictEqual({ count: r.count, els: r.els }, { count: 0, els: [] });
});
test(`${shell.name}: live block with no pack skips a body-quoted record: when the frontmatter has none (#4814 AC1.1)`, { skip }, () => {
  const r = runFallback(shell, liveBlock(), {
    '101-spec.md': specHeader(101),
    '303-spec.md': '---\norigin: capture\n---\n# Spec\n\nrecord: 999\n',
    '404-spec.md': '# Spec\n\nrecord: 999\n',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual({ count: r.count, els: r.els }, { count: 1, els: ['101'] });
});
```

  with, above that loop: `const NON_ARRAY_PACKS = { string: { inputs: { closingRecords: '101' } }, object: { inputs: { closingRecords: { 0: 101 } } }, null: { inputs: { closingRecords: null } }, absent: { inputs: {} } };`

  In `wrap-up-record-resolution-conformance.test.js`, add:

```js
test('AC1.1: Section C step 2 tells the agent what a failed mirror read means (#4814)', () => {
  const block = step2Block();
  const exit = block.indexOf('|| exit 1');
  const instruction = block.indexOf('**A failed mirror read is not that no-op.**');
  assert.ok(exit !== -1 && instruction > exit, 'the instruction follows the fence');
  assert.match(block, /Stop this step with no carrier commit, before step 3's branch finish/);
  assert.match(block, /`cleanup: closing-keyword carrier failed — \{first stderr line\}`/);
});
```

- [ ] **Step 2: Run them to verify they fail.** Run: `node --test tests/wrap-up-closing-records-array-fill.test.js tests/wrap-up-record-resolution-conformance.test.js`. Expected: FAIL only on the body-quoted test (`els` carries `999`) and the failed-mirror-read test. The non-array packs and the control pass at base: they pin existing behavior the digest said had no test, and the control is their go-red proof.

- [ ] **Step 3: Implement** in `cleanup-procedures-execution.md`:
  - Line 84: `read each \`{n}-spec.md\` match's numeric header \`record:\` field` becomes `read each \`{n}-spec.md\` match's numeric frontmatter \`record:\` field`.
  - Line 94, inside the `node -e`: replace `const m=fs.readFileSync(path.join(dir,f),"utf8").match(/^record:\s*(\d+)\s*$/m);if(m)console.log(m[1])` with `const h=/^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(dir,f),"utf8")),m=h&&h[1].match(/^record:\s*(\d+)\s*$/m);if(m)console.log(m[1])`.
  - Insert this paragraph, indented like its neighbors, after the paragraph ending `avoids duplicate empty commits if this step re-runs after an interruption).` and before `**Why a dedicated commit`:

```
   **A failed mirror read is not that no-op.** The fence's `|| exit 1` means the `work/` directory or a spec file could not be read, so the record set is unknown. Stop this step with no carrier commit, before step 3's branch finish, because a merge with no closing keyword leaves the record open, and report one `cleanup: closing-keyword carrier failed — {first stderr line}` line in the closing report.
```

- [ ] **Step 4: Run them to verify they pass.** Same command. Expected: PASS under bash and zsh, 0 failures.

- [ ] **Step 5: Commit** the three files: `Settle Section C step 2's mirror fallback — failed-read instruction, non-array pack test, frontmatter-only record, refs #4814`.

### Task 4: Read `record:` from the frontmatter only in `pack.js`

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js` (lines 159, 170-172)
- Test: `tests/bin-lib/wrap-up/pack.test.js`

**Interfaces:** `headerEntries(deps, dir)` keeps its signature and return shape.

- [ ] **Step 1: Write the failing test,** next to the #3399 body-line test:

```js
test('#4814 AC1.1: a record: line below the frontmatter never beats the filename', () => {
  for (const header of ['---\norigin: capture\n---\n# 1930\n\nrecord: 999\n', '# 1930\n\nrecord: 999\n']) {
    const inputs = resolveInputs({ runDir: mirrorWithHeader(header), cwd: '/nowhere', deps: okDeps() });
    assert.deepStrictEqual(inputs.records, [1930], header);
  }
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `node --test tests/bin-lib/wrap-up/pack.test.js`. Expected: FAIL, `[999]` against `[1930]`.

- [ ] **Step 3: Implement.** In `headerEntries`, compute `front` first and read `rec` from `front[1]` (`const rec = front !== null ? /^record:\s*(\d+)\s*$/m.exec(front[1]) : null;`). Extend the comment above the function: `record:` is read only from the leading frontmatter block too, so a quoted body line never wins.

- [ ] **Step 4: Run it to verify it passes.** Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/wrap-up/pack-cli.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** both files: `Read the header record from the frontmatter only — a quoted body line cannot win, refs #4814`.

---

## Self-review

- **Spec coverage:** D1 Task 1; D2 Task 2; D3, D4 and D5's mirror half Task 3; D5's pack half Task 4.
- Waived AC2.1: every promoted line in #1426 already carries `→ #4814` (read via `gh issue view 1426 --json comments`); the controller records this as an `AC evidence` decision, and no code changes it.
- Sibling readers outside this diff with the same whole-file `record:` read (`plugin/bin/lib/dispatch/first-call-artifact-check.js:116`, `plugin/skills/tidy/issue-claims-backstops.md:105`) are not in the record; the controller ledgers them as `deferred` with `Defer-reason: pre-existing-outside-diff`.
- **Placeholders:** none.
