# Reconcile Mirror: Untracked Files Block Only on Collision (#4462) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `classifyMirror` stops reading the main checkout as `dirty` because of an untracked file the incoming fast-forward range does not touch.

**Architecture:** `classifyMirror` (`plugin/bin/lib/reconcile/classify.js`) splits its working-tree read in two. Any tracked change (any `git status --porcelain` entry other than `??`) still returns `dirty` before the fetch, as today. Untracked entries are remembered and only consulted once the ref comparison says `behind`: the paths the incoming range adds (`git diff --name-only --diff-filter=A integration origin/integration`) are compared against them, and any collision (same path, or a file/directory conflict on a path prefix) returns `dirty`; otherwise the state is `behind`. `mirrorFastForward` (`mirror-ff.js`) is unchanged: it already acts only on `behind` and still runs `git merge --ff-only`, which refuses any collision this classifier misses.

**Tech Stack:** Node 18+, `node --test`, git CLI via `runGit` (`plugin/bin/lib/hooks/git-exec.js`), NUL parsers in `plugin/bin/lib/git-z.js`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T222722-record-4462/work/4462-spec.md` (record #4462)

**Scope keywords:** classifyMirror, mirrorFastForward

## Global Constraints

- From `plugin/skills/_shared/git-path-read.md` (governing contract, quoted): "Pass `-z` and split the output on NUL, never on newlines. Pass `--end-of-options` before any ref, range, or sha" and "a `-z` reader passes `{ raw: true }` so a leading-space first path survives." `tests/git-path-read-conformance.test.js` pins all three on the same source line: keep each `runGit(...)` argv on one line, and drop the `// git-path-read: not a path list (emptiness only)` marker from the status line, because its output now is a path list.
- From the `gh-api-module-pattern` project skill (governing skill for `plugin/bin/lib/` modules that shell out to `git`, quoted): "For `git` the separator is **`--end-of-options`, not `--`**".
- Keep `--no-optional-locks` on the `git status` call (`tests/git-status-optional-locks.test.js` pins it).
- Build-time fact (probed in a scratch repo, 2026-10-28): `git merge --ff-only` refuses when an untracked file sits at a path the incoming range adds, even when its content is byte-identical, and succeeds when the untracked path is unrelated. The classifier must therefore treat every collision as blocking, regardless of content.
- Out of scope (logged as `premise reversed` in `decisions.md` and carried to the ledger): tidy's run-trail lifecycle (Approach's second sentence). `mirror-ff.js` and `plugin/skills/tidy/step-7-5-worktree-always.md` are not modified.

## Review Focus

1. Non-ASCII untracked or incoming path (`café.txt`): without `-z` on both reads, git C-quotes it and a real collision reads as no collision. Pinned by Task 1's `café` test.
2. File/directory conflict: an untracked file `x` while the range adds `x/y.txt`, or an untracked `x/y.txt` while the range adds a file `x`. git refuses both; exact-string comparison misses both. Pinned by two Task 1 tests.
3. Case-only difference (`README.TXT` untracked, `readme.txt` incoming): on macOS/Windows (case-insensitive) git refuses. Compare case-insensitively, so the conservative answer is `dirty` everywhere. Pinned by Task 1's case test.
4. A staged-but-uncommitted new file (`A ` entry): tracked, so `dirty` before any fetch, never confused with untracked. Pinned by Task 1's staged-file test.
5. Untracked file with nothing incoming (`current`): must read `current`, not `dirty`. Pinned by Task 1's current test.

---

### Task 1: Classify untracked files by collision with the incoming range

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/classify.js` (the `classifyMirror` body, its header comment block above the function)
- Modify: `plugin/bin/lib/reconcile/index.js:341-349` (comment only: the "can flip its classification" sentence now holds only for an untracked file at a path the incoming range adds; say so in one clause)
- Modify: `tests/reconcile.test.js` (new tests after the existing `classifyMirror: dirty when the working tree has uncommitted changes…` test; the comment above `writePolicyViaSeedAndPull`, which says `'dirty'` is reported "for ANY uncommitted change, tracked or not" — correct it to tracked changes, or an untracked file the incoming range adds)
- Modify: `tests/hooks-session-start.test.js` (comment only, near "classifyMirror bails out on 'dirty'": the untracked cache file no longer trips `dirty` unless the incoming range adds it; the `.gitignore` line it justifies stays)
- No change (classified by the behavior-change prose sweep): `plugin/bin/lib/reconcile/mirror-ff.js` (consumes the state only), `plugin/bin/lib/reconcile/residue-summary.js` (`declined — dirty` wording still accurate), `docs/reconcile-checks.md` (does not describe the dirty rule), `docs/journeys/trust-a-post-merge-cleanup-verdict-3023.md` ("skipped as dirty" still a valid example).

**Interfaces:**
- Consumes: `runGit(args, cwd, { raw: true })` from `plugin/bin/lib/hooks/git-exec.js`; `parseStatusPorcelainZ(raw) -> [{ xy, path, origPath? }]` and `splitNul(raw) -> string[]` from `plugin/bin/lib/git-z.js`.
- Produces: `classifyMirror(repoRoot, integration, opts?) -> { state, failure }`. Signature and state vocabulary unchanged (`'current' | 'behind' | 'ahead' | 'diverged' | 'dirty' | null`). `module.exports` unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/reconcile.test.js`, using the existing `pairedFixture()` and `git()` helpers. Each test that needs an incoming commit pushes it from `seedDir` (`git add`, `commit`, `push origin main`) before writing the untracked file into `mainDir`.

```js
test('AC1.1: mirrorFastForward fast-forwards past an untracked file the incoming range does not touch, and leaves it in place', () => {
  // seed pushes b.txt; mainDir holds untracked stray file 'f' with contents 'x\n'
  // r.state === 'behind', r.action === 'fast-forwarded'
  // main == origin/main afterwards; fs.readFileSync(mainDir/f) === 'x\n'
});
test('classifyMirror: an untracked file the incoming range does not touch reads behind, not dirty (#4462)', () => {
  // seed pushes b.txt; untracked 'f' in mainDir -> state 'behind', failure null
});
test('classifyMirror: an untracked-only tree with nothing incoming reads current, not dirty (#4462)', () => {
  // no seed push; untracked 'f' -> state 'current'
});
test('classifyMirror: an untracked file at a path the incoming range adds reads dirty, and mirrorFastForward moves nothing (#4462)', () => {
  // seed pushes b.txt ('two\n'); mainDir untracked b.txt ('mine\n')
  // classifyMirror -> 'dirty'; mirrorFastForward -> { state: 'dirty', action: 'none' }, HEAD unchanged, b.txt still 'mine\n'
});
test('classifyMirror: an untracked file where the incoming range adds a directory of that name reads dirty (#4462)', () => {
  // seed pushes x/y.txt; mainDir untracked file 'x' -> 'dirty'
});
test('classifyMirror: an untracked file inside a directory the incoming range adds as a file reads dirty (#4462)', () => {
  // seed pushes file 'x'; mainDir untracked 'x/y.txt' -> 'dirty'
});
test('classifyMirror: an untracked file differing only by case from an incoming path reads dirty (#4462)', () => {
  // seed pushes readme.txt; mainDir (cloned before that push) gets untracked README.TXT only -> 'dirty'
});
test('classifyMirror: a non-ASCII untracked path colliding with an incoming path reads dirty (#4462)', () => {
  // seed pushes 'café.txt'; mainDir untracked 'café.txt' -> 'dirty'
});
test('classifyMirror: a staged new file reads dirty before any fetch is attempted (#4462)', () => {
  // mainDir: write new.txt, git add new.txt (no commit); set origin URL to
  // https://example.invalid/nope.git so a fetch would fail -> state 'dirty', failure null
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#4462|AC1.1" tests/reconcile.test.js`
Expected: FAIL — the AC1.1, behind, and current tests fail with `'dirty' !== 'behind'` / `'dirty' !== 'current'` (and AC1.1 with action `'none'`). The five collision/staged tests already pass against today's code (today every untracked file reads `dirty`); they are regression pins for the new code, proven by the guard mutations in Step 4b.

- [ ] **Step 3: Implement `classifyMirror(repoRoot, integration, opts = {})` in `plugin/bin/lib/reconcile/classify.js`**

1. Status read, one line: `runGit(['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all'], repoRoot, { raw: true })`. Parse with `parseStatusPorcelainZ`. Any record whose `xy !== '??'` returns `{ state: 'dirty', failure: null }` immediately (before the fetch). Collect the `??` paths, stripping one trailing `/` (a nested repository still lists as a directory under `--untracked-files=all`).
2. Fetch and `rev-list` counts exactly as today.
3. Only when `ahead === 0 && behind > 0` and at least one untracked path exists, run on one line: `runGit(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=A', '--end-of-options', integration, `origin/${integration}`], repoRoot, { raw: true })`. A failure returns `{ state: null, failure }`. Split with `splitNul`.
4. Collision rule, comparing lowercased paths: build `addedFiles` (the added paths) and `addedPrefixes` (every added path plus each of its ancestor directories, `a/b/c.txt` -> `a`, `a/b`, `a/b/c.txt`). An untracked path `u` collides when `addedPrefixes.has(u)` or any ancestor directory of `u` is in `addedFiles`. Any collision returns `dirty`; otherwise `behind`.
5. Every other state (`current`, `ahead`, `diverged`) ignores untracked files.

Rewrite the header comment above the function to say: tracked changes are checked before the fetch; untracked files block only on a collision with a path the incoming range adds, because `git merge --ff-only` refuses exactly that (even for identical content) and nothing else.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/reconcile.test.js`
Expected: PASS (all tests, the existing `dirty` tests included)

- [ ] **Step 4b: Prove each guard discriminates** — mutate, run, restore, one at a time (scratch only, never committed):
  - remove the lowercasing -> the case test goes red;
  - drop the `addedPrefixes` ancestor entries (exact paths only) -> the "adds a directory" test goes red;
  - drop the ancestor-of-`u` check -> the "adds as a file" test goes red;
  - drop `-z`/`raw: true` from the status read -> the `café` test goes red;
  - treat every record as untracked (skip the `xy !== '??'` return) -> the staged-file test goes red;
  - drop the collision check entirely -> the "path the incoming range adds" test goes red.
  Run each with `node --test --test-name-pattern="#4462|AC1.1" tests/reconcile.test.js`; Expected: exactly the named test FAIL. Restore the file from the Step 3 state before the next mutation.

- [ ] **Step 5: Run the neighbouring suites**

Run: `node --test tests/git-path-read-conformance.test.js tests/git-status-optional-locks.test.js tests/hooks-session-start.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/classify.js plugin/bin/lib/reconcile/index.js tests/reconcile.test.js tests/hooks-session-start.test.js
git commit -m "Narrow mirror dirty classification to untracked collisions — refs #4462"
```
