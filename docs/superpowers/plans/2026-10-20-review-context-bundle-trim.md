# Review-Context Bundle Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `build-review-context.js build` from inlining full markdown file content, so a prose-heavy review bundle stays close to its diff size.

**Architecture:** `buildContext` (in `plugin/bin/lib/review-context/build.js`) already stubs a section for a file over the 64 KB per-file cap and for lockfiles and `.jsonl` files. This plan adds one more stub rule: every readable markdown file (`.md` / `.markdown`, case-insensitive) gets a one-line stub section pointing at the diff and the live file, and is listed in `oversizeSections`. Its diff hunks stay whole, because they are what the review is about. A deleted markdown file keeps today's empty-section behavior. Then `step3-lens-dispatch.md` and `docs/plugin-structure.md` are updated to describe the new layout.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real-git fixture repos.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T161315-record-3713/work/3713-spec.md` (record #3713)

## Global Constraints

- Keep the `oversizeSections` and `emptySections` reporting. A stubbed section is listed in `oversizeSections`. A deleted or unreadable file is listed in `emptySections`.
- Leave every non-markdown file's behavior unchanged: inlined at or under `PER_FILE_CAP_BYTES` (65536), and a stub when over it.
- Keep a markdown file's diff hunks whole. Only its per-file section is stubbed. Diff elision rules (always-stub files, and added or deleted files over the cap) are unchanged.
- `step3-lens-dispatch.md` is 48,602 B against the 52,500 B rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`). Task 2 adds about 250 B, which leaves about 3.6 KB of headroom.
- Commit messages use `{Verb} {what} — {detail}` and say "refs #3713", never "closes" or "fixes".

## Review Focus

1. A deleted `.md` file must stay an empty section listed in `emptySections`, never a stub that tells the agent to "read the live file", because no live file exists. Pinned in Task 1, Step 1, test `deleted markdown`.
2. An added `.md` file over the cap: its diff chunk is elided, so the stub must give the `git diff` pointer, not "its change is in the diff above". Pinned in Task 1, test `added over-cap markdown`.
3. Near-miss names must not match: `x.mdx`, `readme.md.txt`, `a.md/file.txt`, a bare `md`. Upper-case `README.MD` must match. Pinned in Task 1, test `isMarkdown`.
4. `--files-from` scoping still applies: a markdown file outside the list gets no section. This is covered by the existing `--files-from` test's mechanism, and no new test is needed because the stub happens inside the same per-file loop.
5. A modified non-markdown file under the cap must still be inlined in full. The existing tests `kept.txt` and AC2.1-AC2.2 `exact.txt` cover this and must stay green.

---

### Task 1: Stub markdown sections in `buildContext`

**Files:**
- Modify: `plugin/bin/lib/review-context/build.js`. Add `isMarkdown` next to `isAlwaysStub` (around line 79). Add the markdown branch in `buildContext`'s per-file loop (lines 230-260). Update the cap comment (lines 61-64) and the `buildContext` doc comment (lines 146-157) to name the markdown rule. Export `isMarkdown`.
- Test: `tests/bin-lib/review-context/build.test.js`. Add `isMarkdown` to the require block, and add a new `// --- Markdown sections (#3713) ---` block before the `CLI: malformed invocations` test, reusing the existing `initRepo`, `startFeatureBranch`, `commitAll`, `buildFrom`, `sectionOf`, `shortLines`, `lineCount` and `PER_FILE_CAP_BYTES` helpers.

**Interfaces:**
- Produces: `isMarkdown(file: string): boolean`. It is true when the basename (split on `/` or `\`) ends in `.md` or `.markdown`, case-insensitive. It is exported from `build.js`.
- Stub line, exact copy: `[section omitted: ${f} is ${bytes} bytes of markdown, not inlined; ${whereToLook(f)}]\n`, where `bytes` is `Buffer.byteLength(content)` of the content just read.

- [ ] **Step 1: Write the failing tests**

```js
test('isMarkdown: .md / .markdown match case-insensitively on the basename; near-misses do not', () => {
  for (const f of ['a.md', 'docs/X.MD', 'notes.markdown', 'a\\b\\c.md', 'plugin/skills/flow/SKILL.md']) {
    assert.strictEqual(isMarkdown(f), true, f);
  }
  for (const f of ['x.mdx', 'readme.md.txt', 'a.md/file.txt', 'md', 'x.txt']) {
    assert.strictEqual(isMarkdown(f), false, f);
  }
});

// Three ~40 KB shared markdown files, each modified on one early line — the #2734 shape.
function makeMarkdownRepo() {
  const repo = initRepo('review-ctx-md-');
  fs.mkdirSync(path.join(repo, 'docs'));
  for (const n of [1, 2, 3]) {
    fs.writeFileSync(path.join(repo, 'docs', `shared-${n}.md`), shortLines(40 * 1024, `# Doc ${n}\n`, LATE_MARKER));
  }
  fs.writeFileSync(path.join(repo, 'gone.md'), 'bye\n');
  startFeatureBranch(repo);
  for (const n of [1, 2, 3]) {
    fs.writeFileSync(path.join(repo, 'docs', `shared-${n}.md`), shortLines(40 * 1024, `# Doc ${n} (edited)\n`, LATE_MARKER));
  }
  fs.rmSync(path.join(repo, 'gone.md'));
  commitAll(repo, 'edit docs');
  return repo;
}

test('AC1.1: a diff touching large shared markdown files yields a bundle within 2x the diff size', () => {
  const { result, bundle, diffPart } = buildFrom(makeMarkdownRepo());
  assert.ok(!bundle.includes('DISTINCTIVE-LATE-LINE-MARKER'), 'no markdown file content is inlined');
  assert.ok(result.bytes <= 2 * Buffer.byteLength(diffPart), `bundle ${result.bytes} B vs diff ${Buffer.byteLength(diffPart)} B`);
});

test('AC2.1: a markdown stub points at the live file, keeps its hunk, and is listed in oversizeSections', () => {
  const { result, bundle, diffPart } = buildFrom(makeMarkdownRepo());
  const bytes = 40 * 1024;
  assert.strictEqual(
    sectionOf(bundle, 'docs/shared-1.md'),
    `[section omitted: docs/shared-1.md is ${bytes} bytes of markdown, not inlined; its change is in the diff above — read the live file for full content]\n`,
  );
  assert.match(diffPart, /^\+# Doc 1 \(edited\)$/m, 'the markdown hunk stays whole');
  for (const n of [1, 2, 3]) assert.ok(result.oversizeSections.includes(`docs/shared-${n}.md`));
});

test('deleted markdown: stays an empty section, never a live-file stub', () => {
  const { result, bundle } = buildFrom(makeMarkdownRepo());
  assert.deepStrictEqual(result.emptySections, ['gone.md']);
  assert.ok(!result.oversizeSections.includes('gone.md'));
  assert.strictEqual(sectionOf(bundle, 'gone.md'), '');
});

test('added over-cap markdown: diff chunk elided, stub gives the git diff pointer, listed once', () => {
  const repo = initRepo('review-ctx-mdbig-');
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  startFeatureBranch(repo);
  fs.writeFileSync(path.join(repo, 'big.md'), `${'m'.repeat(PER_FILE_CAP_BYTES)}\n`);
  commitAll(repo, 'add big doc');
  const { result, bundle, diffPart } = buildFrom(repo);
  assert.match(diffPart, /^\[\d+ bytes of diff elided for big\.md — see oversizeSections\]$/m);
  const section = sectionOf(bundle, 'big.md');
  assert.ok(section.startsWith(`[section omitted: big.md is ${PER_FILE_CAP_BYTES + 1} bytes of markdown, not inlined; its diff was elided too`), section);
  assert.strictEqual(lineCount(section), 1);
  assert.deepStrictEqual(result.oversizeSections, ['big.md']);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/bin-lib/review-context/build.test.js`
Expected: FAIL after Step 1. `isMarkdown is not a function`. The AC1.1 bundle is more than 2x the diff, and the AC2.1 section holds the inlined content.

- [ ] **Step 3: Implement `isMarkdown` and the markdown branch**

`isMarkdown(file)` tests the basename (the same normalization `isAlwaysStub` uses) against `/\.(md|markdown)$/i`. In the per-file loop, track whether the read succeeded. On a successful read of a markdown file, add the file to `oversize` and append the exact stub line from Interfaces before the cap check, then `continue`. A failed read (deleted or unreadable) keeps today's path unchanged. Update the two comments named under Files so they name the markdown rule.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/bin-lib/review-context/build.test.js`
Expected: PASS, every test in the file, including the pre-existing ones.

- [ ] **Step 5: Real-input probe (AC1.1 on real data)**

Run: `node plugin/bin/build-review-context.js build --base 63ce07e5a~1 --branch 63ce07e5a --dir {scratchpad}/probe-after`. That range is #2734's own squash commit, the diff this record's Current State measured.
Expected: `bytes` is well under the pre-change baseline of 674,834 B, which was measured at plan time against the 123,167 B diff. Allowing for the five non-markdown files (about 118 KB together, still inlined), the expected bundle is about 245 KB, or about 2x the diff. Record the printed `bytes` in the commit body.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/review-context/build.js tests/bin-lib/review-context/build.test.js
git commit -m "Stub markdown sections in the review-context bundle — refs #3713"
```

### Task 2: Describe the markdown stub and the diff boundary in the review docs

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md:72`. This is the `A section can legitimately come out empty` paragraph.
- Modify: `docs/plugin-structure.md:47`. This is the `plugin/bin/lib/review-context/` row.
- Test: `tests/bin-lib/review-context/prose.test.js`

**Interfaces:**
- Consumes: Task 1's stub rule (every readable markdown file is stubbed and listed in `oversizeSections`, and its hunks are kept).

- [ ] **Step 1: Write the failing test**

```js
test('3713: step3-lens-dispatch.md names the markdown stub and where the diff ends', () => {
  assert.ok(LENS_DISPATCH.includes('every markdown file'), 'must name the markdown stub rule');
  assert.ok(LENS_DISPATCH.includes('The diff ends at the first `===== {path} =====` line'), 'must say where the diff ends');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/bin-lib/review-context/prose.test.js`
Expected: FAIL after Step 1, with `must name the markdown stub rule`.

- [ ] **Step 3: Edit the paragraph and the structure row**

In `step3-lens-dispatch.md:72`, make two edits:

- After "the full diff sits at the top of the same bundle", insert the sentence `The diff ends at the first \`===== {path} =====\` line; the per-file sections follow it.` Place it so the paragraph still reads as one flow.
- Reword the stub sentence to: `A section over the 64 KB per-file cap, every markdown file's section, and every lockfile or \`.jsonl\` file's, is a one-line stub instead — a markdown hunk stays whole in the diff, and the live file holds the rest.`

The test anchors on `every markdown file`, so keep that exact phrase.

In `docs/plugin-structure.md:47`, after "lockfiles and `.jsonl`", add `; every markdown file's section is stubbed too, its hunks kept, #3713`. Keep the rest of the row as it is.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/bin-lib/review-context/prose.test.js`
Expected: PASS.
Run: `wc -c plugin/skills/review/step3-lens-dispatch.md`
Expected: under 52,500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-lens-dispatch.md docs/plugin-structure.md tests/bin-lib/review-context/prose.test.js
git commit -m "Describe the markdown section stub in the review lens docs — refs #3713"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (cap markdown, size threshold) | Task 1. The existing 64 KB cap stays, and markdown sections are always stubbed. |
| Deliverable 2 (keep the oversizeSections and emptySections reporting, and keep step3 accurate) | Task 1 (the deleted-markdown and listed-once tests) and Task 2 |
| AC1.1 | Task 1, test `AC1.1` and the Step 5 real-input probe |
| AC2.1 | Task 1, test `AC2.1` (the stub points at the live file) |
| Waived AC3.1: `npm test` passes | Verified by `/build` Common Step 5's full-suite run, not by a task test |
