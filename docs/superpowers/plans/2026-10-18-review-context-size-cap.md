# Review Context Size Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound each file's contribution to `/review`'s shared lens bundle — per-file sections over 64 KB, and every lockfile / `*.jsonl`, become one-line stubs; added/deleted files' diff hunks get the same rule — and report every stubbed path in a new `oversizeSections` field.

**Architecture:** All logic stays in `plugin/bin/lib/review-context/build.js`'s `buildContext`. A pure helper splits the `git diff` output on `diff --git` headers and elides added/deleted chunks that are over the cap or always-stub; the per-file loop checks the always-stub matcher *before* reading, then stubs read content over the cap. The CLI passes the result through unchanged; prose documents the new field.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real-git fixture repos.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T214422-record-3020/work/3020-spec.md`

Scope keywords: emptySections

## Global Constraints

- `PER_FILE_CAP_BYTES = 64 * 1024`, a named exported constant in `build.js`.
- Full content inlined only when **under** the cap is the spec wording, but AC2 pins "a file of exactly `PER_FILE_CAP_BYTES` bytes is inlined in full" — so the stub condition is `Buffer.byteLength(content) > PER_FILE_CAP_BYTES`.
- Always-stub basenames (at least): `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, `composer.lock`, plus any basename ending `.jsonl`. Matched on basename.
- Diff marker line, exact: `[{N} bytes of diff elided for {path} — see oversizeSections]`.
- A *modified* file's diff hunks are never elided (even a modified lockfile — spec Deliverable 5's last sentence and the first Gotcha state modified hunks stay whole unconditionally).
- `readFile` remains the only file seam — no `stat` call; size is measured from the content read.
- `oversizeSections` is deduped: a path elided in the diff and stubbed in its section is listed once.
- A failed read goes to `emptySections`, never to `oversizeSections` (a deleted file whose *diff* was elided is listed in `oversizeSections` for the diff and in `emptySections` for its unreadable section — two different facts).
- No prose may claim the whole bundle is strictly bounded; `--files-from` remains the escape hatch.

## Review Focus

1. A file path containing spaces — the `diff --git a/P b/P` header must still parse to the right path so elision and dedupe line up with `--name-only`'s path. Test added in Task 1 (`added file with a space in its name is elided and listed once`).
2. A deleted lockfile — matcher must run before the read so it lands in `oversizeSections`, not `emptySections` (spec Gotcha). Test in Task 1.
3. A binary added file (`Binary files /dev/null and b/x differ`, no `@@`/`---` lines) — splitter must not crash; its chunk is tiny so it stays whole unless always-stub. Covered by the splitter's header-only parse (no reliance on `+++` lines); no extra test (binary fixtures add noise for no new branch).
4. `--files-from` scoping excludes an elided file — the elided path must still be reported in `oversizeSections` (appended after the in-scope files) so the marker line's "see oversizeSections" is never a dangling reference. Test in Task 1.
5. Rename chunks (`diff --git a/old b/new`, `rename from/to`) — not added/deleted, so left whole; header parse must not throw on asymmetric paths. Covered by the symmetric-path check returning `null` → chunk kept.

---

### Task 1: Cap per-file sections and elide oversize added/deleted diff chunks

**Files:**
- Modify: `plugin/bin/lib/review-context/build.js`
- Modify: `plugin/bin/build-review-context.js` (header comment lines 6-7 only)
- Test: `tests/bin-lib/review-context/build.test.js`

**Interfaces:**
- Produces (exported from `build.js`): `PER_FILE_CAP_BYTES: number` (65536); `isAlwaysStub(file: string): boolean` (basename match, accepts `/`- or `\`-separated paths); `buildContext(...)` now returns `{ dir, contextPath, bytes, files, emptySections, oversizeSections }` where `oversizeSections: string[]`.
- Internal (may be exported for tests, not required): `elideDiff(diff: string): { text: string, elided: string[] }`.

- [ ] **Step 1: Write the failing tests** in `build.test.js`. Add a second fixture builder `makeOversizeFixtureRepo()` (real git, same style as `makeFixtureRepo`):
  - base commit: `big-modified.txt` (content of `PER_FILE_CAP_BYTES` bytes of `'a'`, ending `\n` included in the count), `exact.txt` (small), `old.lock` not needed; `doomed.txt` small; `yarn.lock` (small) to be deleted.
  - feature commit: `big-modified.txt` rewritten so its first line changes and total size is `PER_FILE_CAP_BYTES + 1` bytes; `exact.txt` becomes exactly `PER_FILE_CAP_BYTES` bytes (modified); added `big-added.txt` of `PER_FILE_CAP_BYTES + 1` bytes; added `fixture.jsonl` (`{"a":1}\n`); added `package-lock.json` (`{}\n`); added `has space.txt` of `PER_FILE_CAP_BYTES + 1` bytes; deleted `doomed.txt`; deleted `yarn.lock`.

  Tests (names carry the AC clause ids):
  - `AC1.1, AC1.2: a modified file of PER_FILE_CAP_BYTES + 1 bytes gets a stub section, is listed, and keeps its hunk in the diff` — section for `big-modified.txt` is a single stub line (assert the bundle does not contain `'a'.repeat(1000)` inside that section, i.e. the text between `===== big-modified.txt =====\n` and the next `\n=====` is one line matching `/^\[section omitted: big-modified\.txt is 65537 bytes/`); `oversizeSections` includes `big-modified.txt`; the diff part (text before the first `\n===== `) contains `diff --git a/big-modified.txt b/big-modified.txt` and an `@@` hunk for it with no elision marker for that path.
  - `AC2.1-AC2.2: a file of exactly PER_FILE_CAP_BYTES bytes is inlined in full and not listed` — section for `exact.txt` equals its full content; `oversizeSections` excludes it.
  - `AC3.1: small fixture.jsonl and package-lock.json are stubbed and listed despite being under the cap` — both sections are stub lines (`/^\[section omitted: fixture\.jsonl — always stubbed/`), both in `oversizeSections`.
  - `AC4.1-AC4.2: a deleted file lands in emptySections only` — on the original `makeFixtureRepo()`, `result.oversizeSections` deep-equals `[]` and `result.emptySections` deep-equals `['doomed.txt']` (existing assertions at the current lines 89 and 129/148 stay unchanged and still pass).
  - `AC6.1, AC6.2: added over-cap file and added small fixture.jsonl get the single elision marker, listed once; modified over-cap file keeps its full hunk` — diff part contains `[65537 bytes of diff elided for big-added.txt — see oversizeSections]`-shaped line (assert via regex `/^\[\d+ bytes of diff elided for big-added\.txt — see oversizeSections\]$/m`) and the same for `fixture.jsonl`; `big-added.txt`'s content (`'b'.repeat(1000)`) appears nowhere in the bundle; `oversizeSections.filter(p => p === 'big-added.txt').length === 1` and likewise for `fixture.jsonl`; `big-modified.txt` hunk present (shared with AC1.3).
  - `deleted lockfile is stubbed (matcher before read), not empty` — `yarn.lock` in `oversizeSections`, not in `emptySections`; its deletion chunk is elided.
  - `added file with a space in its name is elided and listed once` — marker for `has space.txt`; listed once.
  - `--files-from scope still reports a diff-elided path outside the list` — `filesFrom` listing only `exact.txt`; `oversizeSections` contains `big-added.txt` (diff-elided) after any in-scope entries.
  - Extend the existing CLI end-to-end build test (current line 118): `AC5.1: the parsed JSON line has an oversizeSections array` — `assert.ok(Array.isArray(parsed.oversizeSections))`.
  - `isAlwaysStub` unit test: true for `a/b/Cargo.lock`, `x.jsonl`, `poetry.lock`, `composer.lock`, `Gemfile.lock`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`; false for `package.json`, `x.json`, `jsonl.txt`, `my-yarn.lock`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/review-context/build.test.js`
Expected: FAIL after Step 1 — `isAlwaysStub is not a function` / `oversizeSections` undefined.

- [ ] **Step 3: Implement in `build.js`**
  - `PER_FILE_CAP_BYTES = 64 * 1024`; `ALWAYS_STUB_BASENAMES` Set of the eight names; `isAlwaysStub(file)` — basename after normalizing `\` to `/`, true when in the Set or ends with `.jsonl`.
  - `elideDiff(diff)`: split with `diff.split(/^(?=diff --git )/m)` (rejoining the parts reproduces the input exactly). For each chunk, determine kind from its extended header (lines before the first `@@`/`---`/`Binary`): `new file mode` → added, `deleted file mode` → deleted, else leave untouched. Path from the header line `diff --git a/P b/P`: take `s = line.slice('diff --git '.length)`; when `s` starts with `a/` and `(s.length - 5)` is even, `P = s.slice(2, 2 + (s.length - 5) / 2)` and require `s === 'a/' + P + ' b/' + P`; otherwise (quoted path, rename) return `null` and keep the chunk whole. Elide when `Buffer.byteLength(chunk) > PER_FILE_CAP_BYTES || isAlwaysStub(P)`: replace the chunk with its first line (the `diff --git` header) + `\n` + `[${N} bytes of diff elided for ${P} — see oversizeSections]\n`, where `N` is `Buffer.byteLength` of the replaced remainder. Return `{ text, elided }` (`elided` in diff order).
  - `buildContext`: `const { text: diffText, elided } = elideDiff(diff); let out = diffText;`. In the file loop, **comment that the name matcher runs before the read so a deleted lockfile counts as stubbed rather than empty**: if `isAlwaysStub(f)` → stub line `[section omitted: ${f} — always stubbed (lockfile or .jsonl); its change is in the diff above — read the live file for full content]\n`, no read. Else read as now (catch → `emptySections`, unchanged); if `Buffer.byteLength(content) > PER_FILE_CAP_BYTES` → stub line `[section omitted: ${f} is ${bytes} bytes, over the ${PER_FILE_CAP_BYTES}-byte per-file cap; its change is in the diff above — read the live file for full content]\n`. Push `f` to `oversizeSections` when its section was stubbed or `elided` includes it (dedupe via a Set); after the loop append `elided` paths not yet listed. Update the module's bundle-shape comment (lines 41-45) to mention stub sections/elided chunks degrading the same way. Add `oversizeSections` to the return value and `PER_FILE_CAP_BYTES`, `isAlwaysStub` to `module.exports`.
  - `build-review-context.js` header lines 6-7: field list becomes `{dir, contextPath, bytes, files, emptySections, oversizeSections}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/review-context/build.test.js tests/bin-lib/review-context/exit-code.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/review-context/build.js plugin/bin/build-review-context.js tests/bin-lib/review-context/build.test.js
git commit -m "Cap review-context bundle sections at 64 KB — stub oversize files, lockfiles and .jsonl; refs #3020"
```

### Task 2: Document `oversizeSections` and pin it

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md:70` (JSON field list) and `:72` (degradation paragraph)
- Modify: `docs/plugin-structure.md:198` (field list in the `build-review-context.js` row)
- Test: `tests/bin-lib/review-context/prose.test.js`

**Interfaces:**
- Consumes: the field name `oversizeSections` and the 64 KB cap from Task 1.

**Byte budget:** `step3-lens-dispatch.md` is 44,920 bytes now; the addition is one sentence (~300 bytes). The full suite's skill-size / composed-bytes tests are the binding check — run them in Step 4.

- [ ] **Step 1: Write the failing test** in `prose.test.js`: `AC7.1-AC7.2: step3-lens-dispatch.md and docs/plugin-structure.md both name oversizeSections` — read `docs/plugin-structure.md` alongside `LENS_DISPATCH`; assert each `includes('oversizeSections')`; also assert `LENS_DISPATCH` matches `/\{dir, contextPath, bytes, files, emptySections, oversizeSections\}/`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/review-context/prose.test.js`
Expected: FAIL after Step 1 on the new test.

- [ ] **Step 3: Edit the prose**
  - `step3-lens-dispatch.md:70`: `{dir, contextPath, bytes, files, emptySections}` → `{dir, contextPath, bytes, files, emptySections, oversizeSections}`.
  - `step3-lens-dispatch.md:72`: append one sentence: a section over the 64 KB per-file cap, and every lockfile or `.jsonl` file, is a one-line stub instead (`oversizeSections` names them, as it does an added or deleted file whose diff hunk was elided); it degrades the same way — the change is in the diff, and the lens reads the live file when it needs the full content. Do not claim the bundle is bounded overall.
  - `docs/plugin-structure.md:198`: same field-list change.

- [ ] **Step 4: Run the targeted suites, then the full suite**

Run: `node --test tests/bin-lib/review-context/prose.test.js` → PASS.
Run: `npm test` with output redirected to a scratchpad log file → summary shows `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-lens-dispatch.md docs/plugin-structure.md tests/bin-lib/review-context/prose.test.js
git commit -m "Document oversizeSections in the review lens dispatch and plugin structure — refs #3020"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1-3 (cap, matcher, buildContext stubs, `oversizeSections`) | Task 1 |
| Deliverable 4 (CLI header, step3 prose, plugin-structure) | Task 1 (CLI header), Task 2 (prose) |
| Deliverable 5 (diff block elision) | Task 1 |
| Deliverable 6 (tests) | Tasks 1, 2 |
| AC8.1 (`npm test` passes) | Task 2 Step 4 |
