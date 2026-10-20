# Blast-radius prompt-prose test-path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared `isTestPath` classifier in `blast-radius.js` treat prompt prose (markdown under `skills/`, `agents/`, `commands/`) as implementation, so merge-check counts an edit to `plugin/skills/test/*.md` as production lines.

**Architecture:** Move `isPromptProsePath` and `PROMPT_PROSE_DIRS` out of `plugin/bin/lib/dispatch/ceremony-derive.js` into `plugin/bin/lib/issues/blast-radius.js`, the shared home (`ceremony-derive.js` already `require`s it, so the move adds no dependency edge). `isTestPath` returns `false` for any prompt-prose path. `ceremony-derive.js` imports both names back and re-exports them unchanged, so its public exports and its tests stay the same. Its `computeDiffFacts` drops the local `isTest` remap, which is now redundant.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124156-record-3680/work/3680-spec.md`

## Global Constraints

- Prompt-prose directory set stays exactly `['skills', 'agents', 'commands']`, matched at any path prefix, `.md` suffix, case-insensitive. Moved unchanged, not redefined.
- `ceremony-derive.js` keeps exporting `isPromptProsePath` and `PROMPT_PROSE_DIRS`. `tests/bin-lib/dispatch/ceremony-derive.test.js:6` imports both from there. Its prose-twin pin (lines 158-170) reads `PROMPT_PROSE_DIRS` from that module.
- `blast-radius.js` must not `require` `ceremony-derive.js`, which would create a cycle.

## Review Focus

1. A non-markdown file under `skills/test/` (`plugin/skills/test/fixture.json`) still classifies as test. Only `.md` is prompt prose. Pinned in Task 1.
2. Markdown under a `test/` directory inside `agents/`/`commands/` (`.claude/commands/test/run.md`) is non-test, the same as `skills/`. Pinned in Task 1.
3. Markdown under `skills/` nested inside a top-level `tests/` tree (`tests/fixtures/skills/x/SKILL.md`) now reads as implementation. This is deliberate. It errs toward production, which is the safe direction for merge-check and the same trade `ceremony-derive.js`'s existing comment documents. Pinned in Task 1 so the choice is visible, not accidental.
4. A story YAML under `skills/` (`plugin/skills/stories/x.yaml`) still classifies as test via `STORY_PATH_RE`. It is not `.md`, so it is unaffected. Covered by Review Focus 1's assertion shape and needs no new test.
5. `computeDiffFacts`'s existing `AC1.1` case (`tests/bin-lib/dispatch/ceremony-derive.test.js:110`) must stay green once the local remap is gone. That proves the shared fix covers it.

## Consumer enumeration

`git grep -n "classifyDiffFiles" -- plugin` returns three consumers, each classified:
- `plugin/bin/lib/blast-radius-cli.js:140` `computeBlastRadius`: reads `isTest` via `blastRadiusSummary`. This is the merge-check facts consumer, and the fix is intended for it.
- `plugin/bin/lib/dispatch/ceremony-derive.js:51` `computeDiffFacts`: already remapped `isTest` for prompt prose, so the remap is dropped here (identical result).
- `plugin/skills/wrap-up/docs-health-integration.md:18`: reads only `isSensitive`, so it is unaffected.

`plugin/bin/lib/issues/initiative-budget.js:33` has its own, separate `isTestPath`. It is out of scope: there, treating a path as test excludes it from auto-repair, which is the conservative direction.

---

### Task 1: Exclude prompt prose from the shared `isTestPath`

**Files:**
- Modify: `plugin/bin/lib/issues/blast-radius.js`
- Modify: `plugin/bin/lib/dispatch/ceremony-derive.js`
- Test: `tests/bin-lib/issues/blast-radius.test.js`

**Interfaces:**
- Produces: `blast-radius.js` exports `isPromptProsePath(path: string): boolean` and `PROMPT_PROSE_DIRS: readonly string[]` in addition to its current exports (`classifyDiffFiles`, `blastRadiusSummary`, `isSensitivePath`, `globToRegExp`).
- `ceremony-derive.js`'s exports are unchanged: `computeDiffFacts, deriveCeremonyProfile, isDocsPath, isPromptProsePath, PROMPT_PROSE_DIRS, shouldDerive`. The last three names are re-exported from `blast-radius.js`.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/issues/blast-radius.test.js`, under a `// --- #3680: prompt prose is never a test file ---` header)

```js
test('AC1.1: a prompt-prose file under skills/test/ is non-test and counted as implementation', () => {
  const classified = classifyDiffFiles([{ path: 'plugin/skills/test/qa-prompts.md', additions: 5, deletions: 0 }]);
  assert.strictEqual(classified[0].isTest, false);
  const summary = blastRadiusSummary(classified);
  assert.strictEqual(summary.implFiles, 1);
  assert.strictEqual(summary.implLines, 5);
  assert.strictEqual(summary.testFiles, 0);
  assert.strictEqual(summary.testLines, 0);
});

test('AC2.1: tests/foo.test.js and tests/fixtures/x.json still classify as test', () => {
  const classified = classifyDiffFiles([
    { path: 'tests/foo.test.js', additions: 1, deletions: 0 },
    { path: 'tests/fixtures/x.json', additions: 1, deletions: 0 },
  ]);
  assert.deepStrictEqual(classified.map((f) => f.isTest), [true, true]);
});

test('#3680: prompt prose under agents/ or commands/ test directories is non-test too', () => {
  const classified = classifyDiffFiles([
    { path: '.claude/commands/test/run.md', additions: 1, deletions: 0 },
    { path: 'plugin/agents/test/qa.md', additions: 1, deletions: 0 },
  ]);
  assert.deepStrictEqual(classified.map((f) => f.isTest), [false, false]);
});

test('#3680: a non-markdown file under skills/test/ is still a test file', () => {
  assert.strictEqual(classifyDiffFiles([{ path: 'plugin/skills/test/fixture.json', additions: 1, deletions: 0 }])[0].isTest, true);
});

test('#3680: skill-shaped markdown nested in a tests/ tree errs toward implementation (deliberate)', () => {
  assert.strictEqual(classifyDiffFiles([{ path: 'tests/fixtures/skills/x/SKILL.md', additions: 1, deletions: 0 }])[0].isTest, false);
});

test('#3680: isPromptProsePath and PROMPT_PROSE_DIRS live in blast-radius.js and are re-exported by ceremony-derive.js', () => {
  const br = require('../../../plugin/bin/lib/issues/blast-radius');
  const cd = require('../../../plugin/bin/lib/dispatch/ceremony-derive');
  assert.strictEqual(typeof br.isPromptProsePath, 'function');
  assert.deepStrictEqual([...br.PROMPT_PROSE_DIRS], ['skills', 'agents', 'commands']);
  assert.strictEqual(cd.isPromptProsePath, br.isPromptProsePath);
  assert.strictEqual(cd.PROMPT_PROSE_DIRS, br.PROMPT_PROSE_DIRS);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/blast-radius.test.js`
Expected: FAIL. The AC1.1, agents/commands, tests/fixtures/skills and export tests fail, while the AC2.1 and fixture.json tests pass, since they pin behavior that already holds.

- [ ] **Step 3: Implement**

In `blast-radius.js`, add `PROMPT_PROSE_DIRS` (a frozen array), `PROMPT_PROSE_RE` and `isPromptProsePath(path)`, moved verbatim from `ceremony-derive.js` lines 17-33 together with their comment. Extend that comment with one line saying that `isTestPath` also uses it, and why (#3680: merge-check would otherwise count `skills/test/*.md` as test lines, understating implementation blast radius). Change `isTestPath` to return `false` when `isPromptProsePath(path)` holds, before the existing three-regex test. Add both names to `module.exports`.

In `ceremony-derive.js`, delete the moved definitions and import `isPromptProsePath` and `PROMPT_PROSE_DIRS` from `'../issues/blast-radius'` alongside `classifyDiffFiles` and `blastRadiusSummary`. Keep a short comment saying they now live in `blast-radius.js` and that the prose-twin pin still reads them through this module. Replace `computeDiffFacts`'s `.map(...)` remap and its comment (lines 48-54) with a plain `const classified = classifyDiffFiles(files || []);`. `module.exports` is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/blast-radius.test.js tests/bin-lib/dispatch/ceremony-derive.test.js`
Expected: PASS. Every test in both files passes, including `ceremony-derive.test.js`'s existing `AC1.1: a plugin-prose diff (plugin/skills/test/qa-prompts.md + a test file) does not derive fast-lane`, which shows the shared fix replaces the dropped remap.

- [ ] **Step 5: Prove the new tests discriminate**

Temporarily revert only `isTestPath`'s new prompt-prose guard and re-run `node --test tests/bin-lib/issues/blast-radius.test.js`. AC1.1, the agents/commands case and the tests/fixtures/skills case must fail. Restore the guard. With the remap already removed, `ceremony-derive.test.js`'s AC1.1 must also fail while the guard is reverted, which proves the shared classifier is now its only protection. Do not commit the revert.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/blast-radius.js plugin/bin/lib/dispatch/ceremony-derive.js tests/bin-lib/issues/blast-radius.test.js
git commit -m "Exclude prompt prose from blast-radius isTestPath — skills/test/*.md counts as implementation in merge-check (refs #3680)"
```

### Final verification (folded into /build Common Step 5)

Run `npm test` (the full suite). Expected: no failures beyond the base branch's own baseline.

Waived AC3.1: a full-suite pass is the build's verification gate (`/claude-tweaks:build` Common Step 5 and `/claude-tweaks:test`), not a test step this plan writes.
