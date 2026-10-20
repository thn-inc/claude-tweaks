# Path-Containment Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `plugin/bin/lib/path-guard`'s `isAncestorOrSelf` the one lexical containment implementation under `plugin/bin`, with `shared-primitives.js`'s `isPathContained` reduced to a thin strict/`orEqual` wrapper over it, every hand-rolled `startsWith(root + path.sep)` test migrated, and the two convention docs naming the same helper.

**Architecture:** Decision (spec Deliverable 1): `isPathContained` *delegates* — it keeps its `(candidate, root, { orEqual })` signature and every existing call site, gains a `pathImpl` passthrough, and computes containment only through `isAncestorOrSelf`; its one extra rule (exclude the root itself unless `orEqual`) is expressed through the same `pathImpl.relative` equality `isAncestorOrSelf` uses. Delegation is chosen over removal because seven of the fifteen call sites need the strict (root-excluded) form, which `isAncestorOrSelf` does not offer — removal would mean retyping an equality branch at each, the drift #2324 consolidated away. The four call sites still hand-rolling containment (`issue-payload.js`, `ledger-write.js`, `release-local.js`, `archive-merged.js`) migrate to `isPathContained`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185709-record-3498/work/3498-spec.md`

**Scope keywords:** isPathContained, isAncestorOrSelf

## Global Constraints

- Every migrated caller's existing test suite passes **unmodified** (spec AC2) — no edits to `tests/bin-lib/shared-primitives.test.js`, `tests/bin-lib/path-guard/*.test.js`, or any caller suite listed in Task 1/Task 2.
- `tests/path-guard-conformance.test.js` exact `realpathSync`/`existsSync` token-count allowlist must stay green — no task adds or removes either token in any `plugin/bin/**/*.js` file.
- `docs/donts.md`'s `[IL-161]` line must keep naming `plugin/bin/lib/path-guard` (pinned by `tests/path-guard-conformance.test.js`'s "AC4.1" test).
- `plugin/bin/lib/path-guard/index.js` is not modified (its `isAncestorOrSelf` signature `(ancestor, candidate, { pathImpl = path } = {})` is the fixed interface).

## Review Focus

1. **Strict call sites stay strict** — `isPathContained(root, root)` without `orEqual` must still be `false`, including for equal paths spelled differently (`/a/` vs `/a`; win32 `C:\Repo` vs `c:\repo`), or `worktree-reap`/`reap-merged` could treat the harness domain directory itself as in-domain. Pinned in Task 1's characterization tests.
2. **A `..` traversal segment** in an unnormalized candidate (`/a/b/../../etc` under `/a`) was contained under the old `startsWith`; it must now be rejected. Pinned in Task 1.
3. **Filesystem root as `root`** (`/`) — old code rejected every candidate (`'//'` prefix); now contained. Pinned in Task 1.
4. **win32 casing and cross-drive** — on a win32 host every caller becomes case-insensitive and drive-aware. Pinned in Task 1 via `pathImpl: path.win32`.
5. **`archive-merged`'s tracked-entry guard** must still refuse a tracked file outside `work/` and still accept `work/` and anything below it, including a sibling named `work-x` being refused (prefix sibling). Covered by its existing suite plus Task 2's scan test.

---

### Task 1: Delegate `isPathContained` to `isAncestorOrSelf`, pin its behavior changes

**Files:**
- Modify: `plugin/bin/lib/shared-primitives.js:68-80` (header comment), `:199-202` (`isPathContained`), top-of-file requires
- Modify: `docs/plugin-structure.md:19` (the `isPathContained(...)` description inside the `plugin/bin/lib/` row)
- Create: `tests/bin-lib/path-guard/is-path-contained-characterization.test.js`
- Test (unmodified, must stay green): `tests/bin-lib/shared-primitives.test.js`, `tests/bin-lib/path-guard/path-guard.test.js`, `tests/bin-lib/path-guard/callers-characterization.test.js`, and the six caller suites — `tests/bin-lib/reconcile/reap-merged.test.js`, `tests/bin-lib/init/release-bootstrap.test.js`, `tests/bin-lib/init/release-bootstrap-cli.test.js`, the `worktree-reap`, `pre-tool-use`/teardown-gate, `load-delta` and `skill-load-report` suites found by `git grep -l -e worktree-reap -e pre-tool-use -e load-delta -e skill-load-report -- tests`

**Interfaces:**
- Produces: `isPathContained(candidate: string, root: string, { orEqual = false, pathImpl = path } = {}) -> boolean` — true when `isAncestorOrSelf(root, candidate, { pathImpl })` holds and (`orEqual` or `pathImpl.relative(root, candidate) !== ''`).

- [ ] **Step 1: Write the characterization tests** in `tests/bin-lib/path-guard/is-path-contained-characterization.test.js`. Header comment: lists the callers inheriting the change (pre-tool-use.js ×2, worktree-reap.js ×2, reap-merged.js ×2, release-bootstrap.js ×2, load-delta.js ×2, skill-load-report.js ×1, plus Task 2's four) and states that every caller passes realpath/`path.resolve`d paths, so on posix the only caller-visible differences are the `/` root and unnormalized input; on win32 hosts, casing and drive. Tests (use `path.posix` / `path.win32` explicitly via `pathImpl` so the file is host-independent; the posix cases also pass `pathImpl: path.posix`):

```js
const P = { pathImpl: path.posix };
const W = { pathImpl: path.win32 };
// Intended changes — each red against the pre-delegation startsWith implementation:
test('AC2.1: a ".." traversal segment no longer reads as contained', () => {
  assert.equal(isPathContained('/a/b/../../etc', '/a', P), false);
});
test('AC2.1: a root with a trailing separator contains its children', () => {
  assert.equal(isPathContained('/a/b', '/a/', P), true);
  assert.equal(isPathContained('/a/', '/a', P), false); // still strict: same directory
});
test('AC2.1: the filesystem root contains every absolute path', () => {
  assert.equal(isPathContained('/x', '/', P), true);
});
test('AC2.1: win32 compares case-insensitively and across drives', () => {
  assert.equal(isPathContained('c:\\repo\\x', 'C:\\Repo', W), true);
  assert.equal(isPathContained('D:\\Repo\\x', 'C:\\Repo', W), false);
  assert.equal(isPathContained('c:\\repo', 'C:\\Repo', W), false);
  assert.equal(isPathContained('c:\\repo', 'C:\\Repo', { ...W, orEqual: true }), true);
});
// Invariants — green before and after:
test('AC2.1: unchanged — a "..foo" child is contained, a prefix sibling is not', () => {
  assert.equal(isPathContained('/a/..foo', '/a', P), true);
  assert.equal(isPathContained('/a/bee', '/a/b', P), false);
  assert.equal(isPathContained('/a', '/a', P), false);
  assert.equal(isPathContained('/a', '/a', { ...P, orEqual: true }), true);
  assert.equal(isPathContained('/a/b', '/a/b/c', P), false); // the parent
});
test('AC1.1: isPathContained has no containment logic of its own — it delegates to path-guard', () => {
  const src = fs.readFileSync(require.resolve('../../../plugin/bin/lib/shared-primitives'), 'utf8');
  const body = src.slice(src.indexOf('function isPathContained'), src.indexOf('\n}\n', src.indexOf('function isPathContained')));
  assert.match(src, /require\('\.\/path-guard'\)/);
  assert.match(body, /isAncestorOrSelf\(/);
  assert.doesNotMatch(body, /startsWith/);
});
```

- [ ] **Step 2: Run to verify the intended-change tests fail**

Run: `node --test tests/bin-lib/path-guard/is-path-contained-characterization.test.js`
Expected: FAIL — the four "intended changes" tests and the AC1.1 delegation test fail; the "unchanged" test passes.

- [ ] **Step 3: Implement** in `plugin/bin/lib/shared-primitives.js`: `const { isAncestorOrSelf } = require('./path-guard');` and rewrite `isPathContained` to the Interfaces signature (no `startsWith`, no `===`). Rewrite the header-comment bullet (lines 68-80) to say it is a thin strict/`orEqual` wrapper over `path-guard`'s `isAncestorOrSelf` (#3498), keep the "pure string check, callers pass already-resolved paths" sentence, and note the four Task-2 sites were the last hand-rolled copies. Update `docs/plugin-structure.md:19`'s parenthetical for `isPathContained` the same way (drop "the `candidate === root || candidate.startsWith(root + path.sep)` containment check"; say it wraps `path-guard`'s `isAncestorOrSelf`, root excluded unless `orEqual`, #2324/#3498).

- [ ] **Step 4: Run the new file and every unmodified suite**

Run: `node --test tests/bin-lib/path-guard/ tests/bin-lib/shared-primitives.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/init/release-bootstrap.test.js tests/bin-lib/init/release-bootstrap-cli.test.js tests/path-guard-conformance.test.js` plus the suites the Files grep found.
Expected: PASS, with `git diff --stat -- tests` showing only the new file.

- [ ] **Step 5: Commit** (`refs #3498`).

---

### Task 2: Migrate the last four hand-rolled containment tests; pin AC1.1 with a scan

**Files:**
- Modify: `plugin/bin/lib/harness-health/issue-payload.js:41-46` (`repoRelativePath` — strict)
- Modify: `plugin/bin/lib/wrap-up/ledger-write.js:40` (`resolveLedgerPath` explicit-path root check — strict)
- Modify: `plugin/bin/release-local.js:294` (`writeInsideRoot` — `orEqual: true`)
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:1211-1215` (tracked-outside-`work/` filter — `orEqual: true` against `path.join(runDir, 'work')`; keep excluding an entry equal to `runDir` itself)
- Create: `tests/path-containment-conformance.test.js`
- Test (unmodified): `tests/bin-lib/harness-health/issue-payload.test.js`, `tests/bin-lib/wrap-up/ledger-write.test.js`, `tests/bin-lib/release-local/*.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: `isPathContained` from Task 1 (`require('../shared-primitives')` / `require('./lib/shared-primitives')` relative to each file).

- [ ] **Step 1: Write the scan test** in `tests/path-containment-conformance.test.js`:

```js
test('AC1.1: no plugin/bin JS file hand-rolls a startsWith(... path.sep) containment test', () => {
  // walk plugin/bin recursively for *.js; collect `${rel}:${lineNo}` for lines matching
  // /startsWith\(.*path\.sep/ (the spec's own grep pattern)
  assert.deepEqual(hits, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/path-containment-conformance.test.js`
Expected: FAIL listing exactly `issue-payload.js:44`, `archive-merged.js:1215`, `ledger-write.js:40`, `release-local.js:294` (`shared-primitives.js:201` is gone after Task 1).

- [ ] **Step 3: Migrate the four sites** to `isPathContained` with the strictness named in Files. `repoRelativePath`: compute `abs = path.resolve(root, targetPath)` and return `path.relative(root, abs)` in `/` form only when `isPathContained(abs, path.resolve(root))`. No behavior change on posix for any of the four (all compare resolved paths or `path.relative` output); win32 gains Task 1's casing/drive semantics.

- [ ] **Step 4: Run** `node --test tests/path-containment-conformance.test.js tests/bin-lib/harness-health/issue-payload.test.js tests/bin-lib/wrap-up/ledger-write.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/path-guard-conformance.test.js` and `node --test "tests/bin-lib/release-local/*.test.js"`.
Expected: PASS; `git diff --stat -- tests` shows only the new file.

- [ ] **Step 5: Commit** (`refs #3498`).

---

### Task 3: Point both convention docs at the one helper

**Files:**
- Modify: `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md:20` (containment bullet) and `:47` (anti-pattern row)
- Modify: `docs/donts.md:198` (`[IL-161]` line — keep `plugin/bin/lib/path-guard` in it)
- Modify: `tests/path-containment-conformance.test.js` (append AC3 test)

- [ ] **Step 1: Append the AC3 test**:

```js
test('AC3.1: docs/donts.md [IL-161] and the pre-tool-use-gate-exemptions skill name the same containment helper', () => {
  const il161 = read('docs/donts.md').split('\n').filter((l) => l.includes('[IL-161]'));
  const bullet = read('.claude/skills/pre-tool-use-gate-exemptions/SKILL.md').split('\n').find((l) => l.startsWith('- **A containment check'));
  for (const text of [il161.join('\n'), bullet]) assert.match(text, /isAncestorOrSelf/);
  assert.doesNotMatch(bullet, /`isPathContained` stays the lexical primitive/);
});
```

- [ ] **Step 2: Run** `node --test tests/path-containment-conformance.test.js` — Expected: FAIL on AC3.1 only.

- [ ] **Step 3: Edit the docs.** Skill bullet: lexical containment has one implementation, `plugin/bin/lib/path-guard`'s `isAncestorOrSelf()` (equality admitted, `..` matched as a whole segment, `pathImpl` for win32); call it through `shared-primitives.js`'s `isPathContained(candidate, root, { orEqual })` — its thin wrapper whose default excludes the root itself — never a retyped `startsWith(root + path.sep)` (`tests/path-containment-conformance.test.js` now fails one); keep the existing sentences on `isPipelineBookkeeping`/`checkTeardownGate`, the pure-string/`realTarget()` caveat, and `resolveWithin()` for resolved filesystem paths; delete the "`isPathContained` stays the lexical primitive for strings already resolved" clause. Anti-pattern row: name the scan test as the backstop. `[IL-161]` line: add that lexical containment of already-resolved paths goes through the same module's `isAncestorOrSelf()` (via `shared-primitives.js`'s `isPathContained` wrapper), keeping the line's existing content and `[IL-161]` tag.

- [ ] **Step 4: Run** `node --test tests/path-containment-conformance.test.js tests/path-guard-conformance.test.js tests/inform-tier-relay-realpath-conformance.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** (`refs #3498`).

---

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 — decide the primitive (delegate) | Task 1 (Architecture records the decision) |
| Deliverable 2 — migrate callers, suites unmodified, record behavior changes | Task 1 (six callers via delegation) + Task 2 (four hand-rolled sites) |
| Deliverable 3 — skill bullet + `[IL-161]` | Task 3 |
| AC1.1 grep clean | Task 2 Step 1 |
| AC1.1 no two independent implementations | Task 1 Step 1 (delegation test) |
| AC2.1 suites unmodified | Task 1/2 Step 4 (`git diff --stat -- tests`) |
| AC2.1 characterization per intended change | Task 1 Step 1 |
| AC3.1 same helper named | Task 3 Step 1 |
