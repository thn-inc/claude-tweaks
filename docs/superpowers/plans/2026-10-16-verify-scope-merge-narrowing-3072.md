# verify.js --scope post-merge narrowing (#3072) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a run merges its integration branch on top of a full-pass stamp anchor, `verify.js --scope … --integration-branch {ref}` selects suites only for the branch's own delta, and reports how many merge-identical paths it dropped.

**Architecture:** `resolveBase`'s anchor-first contract is untouched. A new pure-ish helper `mergeNarrowing` in `plugin/bin/lib/verify/changed-files.js` detects a post-anchor merge whose other parent is an ancestor of `{ref}` and returns the anchor-delta minus paths whose HEAD content equals `{ref}`'s tip (working-tree changes always stay). `verify.js --scope` applies it after `changedFiles`, records it on `report.json`'s `scope.mergeNarrowing`, and prints one stdout line. The `--base` refusal message and `test/verification.md` are updated to match.

**Tech Stack:** Node 18+, `node --test`, git CLI via `execFileSync` (injectable `execImpl` seam).

**Spec:** `.claude-tweaks/pipelines/2026-10-16T172900-spec-3072-3003/spec-3072/work/3072-spec.md`

## Global Constraints

- Keep `resolveBase`'s anchor-first contract and the `base === fullSha` invariant intact (spec Technical Approach).
- Do not change the `--changed-files` (`requireNonDegenerate`) path's semantics (spec Gotchas — #2486/#3048 territory).
- Narrowing applies only when `--integration-branch` is given AND the resolved base is the usable stamp anchor AND a qualifying merge exists; otherwise behavior is byte-for-byte unchanged.
- `{ref}` resolves via `preferOriginRef`, the same way `resolveBase` does.
- Every git call passes `--end-of-options` before a caller-derived ref (repo convention, `gh-api-module-pattern`).
- Narrowing must be visible, never silent: `report.json` carries the count and the ref (spec Gotchas).

## Review Focus

- A merged-in file the branch then edited must stay selected (its HEAD content differs from `{ref}`) — pinned in Task 1 and Task 2.
- An uncommitted working-tree edit to a merge-identical path must stay selected — pinned in Task 1 (`git diff {ref} HEAD` does not see the working tree, so the helper unions `git status`).
- A merge of some branch that is NOT the integration branch after the anchor must not narrow — pinned in Task 1.
- An unresolvable `{ref}` (no such branch) must degrade to no narrowing, never a throw or an empty set — pinned in Task 1.
- No merge after the anchor (fast-forward or plain commits) leaves the set equal to `anchor..HEAD` — pinned in Task 1 and Task 2.

Scope keywords: mergeNarrowing, conflicts with the stamp anchor, Verification scoped

---

### Task 1: `mergeNarrowing` helper in changed-files.js

**Files:**
- Modify: `plugin/bin/lib/verify/changed-files.js` (add `mergeNarrowing`, a `-z` name-only parser, export it)
- Test: `tests/bin-lib/verify/changed-files.test.js` (append real-git fixture tests)

**Interfaces:**
- Produces: `mergeNarrowing({ anchor, integrationBranch, files, execImpl = execFileSync }) → null | { ref: string, excluded: string[], files: string[] }`
  - `null` when `anchor` or `integrationBranch` is falsy, when no merge commit in `{anchor}..HEAD` has a non-first parent that is an ancestor of `{ref}`, or when `{ref}` does not resolve.
  - Otherwise `excluded` = entries of `files` whose path is in neither `git diff --name-only -z {ref} HEAD` nor the working-tree status set; `files` = input `files` minus `excluded`, order preserved.

- [ ] **Step 1: Write the failing tests** — in `tests/bin-lib/verify/changed-files.test.js`, add `mergeNarrowing` to the existing top-of-file destructure (`changedFiles, resolveBase, usableAnchor, mergeNarrowing, ChangedFilesError,`), add `const fs = require('fs');`, `const os = require('os');`, `const { execFileSync } = require('child_process');` beside `const path = require('path');`, then append:

```js
// ── #3072: mergeNarrowing, against a real temp git repo ───────────────────

// integration branch `trunk`, feature branch `feat` cut from it; anchor = feat's tip at cut time.
function mergeRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'merge-narrowing-')));
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q', '-b', 'trunk');
  git('config', 'user.email', 'verify-test@example.invalid');
  git('config', 'user.name', 'verify test');
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  };
  const commit = (rel, content) => { write(rel, content); git('add', rel); git('commit', '-q', '-m', `add ${rel}`); };
  commit('README.md', 'root');
  git('checkout', '-q', '-b', 'feat');
  const anchor = git('rev-parse', 'HEAD');
  const exec = (cmd, args, opts) => execFileSync(cmd, args, { ...opts, cwd: repo });
  return { repo, git, write, commit, anchor, exec };
}

function changedSince(r, base) {
  return changedFiles({ base, execImpl: r.exec }).files;
}

function mergeTrunkWith(r, files) {
  r.git('checkout', '-q', 'trunk');
  for (const [rel, content] of files) r.commit(rel, content);
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--no-ff', '--no-edit', 'trunk');
}

test('mergeNarrowing: anchor → integration-branch merge → own-work commit keeps only the own-work path (#3072)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a'], ['ui/b.js', 'b'], ['ui/c.js', 'c']]);
  r.commit('src/own.py', 'own');
  const files = changedSince(r, r.anchor);
  assert.deepStrictEqual(files, ['src/own.py', 'ui/a.js', 'ui/b.js', 'ui/c.js']);
  const n = mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec });
  assert.strictEqual(n.ref, 'trunk');
  assert.deepStrictEqual(n.files, ['src/own.py']);
  assert.deepStrictEqual(n.excluded, ['ui/a.js', 'ui/b.js', 'ui/c.js']);
});

test('mergeNarrowing: no merge after the anchor returns null — the set stays anchor..HEAD (#3072)', () => {
  const r = mergeRepo();
  r.commit('src/own.py', 'own');
  r.commit('ui/a.js', 'a');
  const files = changedSince(r, r.anchor);
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec }), null);
});

test('mergeNarrowing: a merged-in path the branch then edited stays selected (#3072)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a'], ['ui/b.js', 'b']]);
  r.commit('ui/a.js', 'a — edited on the branch');
  const files = changedSince(r, r.anchor);
  const n = mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec });
  assert.deepStrictEqual(n.files, ['ui/a.js']);
  assert.deepStrictEqual(n.excluded, ['ui/b.js']);
});

test('mergeNarrowing: an uncommitted edit to a merge-identical path stays selected (#3072 Review Focus)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a'], ['ui/b.js', 'b']]);
  r.write('ui/b.js', 'b — uncommitted edit');
  const files = changedSince(r, r.anchor);
  const n = mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec });
  assert.deepStrictEqual(n.files, ['ui/b.js']);
  assert.deepStrictEqual(n.excluded, ['ui/a.js']);
});

test('mergeNarrowing: a merge of a non-integration branch after the anchor does not narrow (#3072 Review Focus)', () => {
  const r = mergeRepo();
  r.git('checkout', '-q', '-b', 'side', r.anchor);
  r.commit('lib/side.js', 'side');
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--no-ff', '--no-edit', 'side');
  const files = changedSince(r, r.anchor);
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec }), null);
});

test('mergeNarrowing: an unresolvable integration branch degrades to null, never a throw (#3072 Review Focus)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a']]);
  const files = changedSince(r, r.anchor);
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'no-such-branch', files, execImpl: r.exec }), null);
});

test('mergeNarrowing: no anchor or no integration branch returns null without touching git (#3072)', () => {
  const boom = () => { throw new Error('git must not be called'); };
  assert.strictEqual(mergeNarrowing({ anchor: null, integrationBranch: 'trunk', files: ['a'], execImpl: boom }), null);
  assert.strictEqual(mergeNarrowing({ anchor: 'abc', integrationBranch: null, files: ['a'], execImpl: boom }), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/verify/changed-files.test.js`
Expected: FAIL — `mergeNarrowing is not a function`

- [ ] **Step 3: Implement** — in `plugin/bin/lib/verify/changed-files.js`, add after `changedFiles` and before `module.exports`:

```js
// `git diff --name-only -z`: one NUL-terminated path per record, no status.
function parseNameOnlyZ(raw) {
  return raw.split('\0').filter((p) => p !== '');
}

// mergeNarrowing (#3072): a --scope run anchored on a full pass that has since
// merged its integration branch would otherwise select every suite the merged-in
// files touch, though those files are byte-identical to the integration tip that
// already passed its own CI. When a merge commit in {anchor}..HEAD has a non-first
// parent that is an ancestor of {ref}, drop every changed path whose HEAD content
// equals {ref}'s tip — unless the working tree also changes it. Returns null (no
// narrowing, today's behavior) when there is no such merge or {ref} does not
// resolve: the fallback over-verifies, never under-verifies. resolveBase's
// anchor-first contract is untouched — this filters its result, it never moves
// the base.
function mergeNarrowing({ anchor, integrationBranch, files, execImpl = execFileSync }) {
  if (!anchor || !integrationBranch) return null;
  const ref = preferOriginRef((args) => git(execImpl, args), integrationBranch);
  const merges = tryGit(execImpl, ['rev-list', '--merges', '--parents', '--end-of-options', `${anchor}..HEAD`]);
  if (merges === null) return null;
  const mergedRef = merges.split('\n').filter((l) => l.trim() !== '').some((line) => {
    const otherParents = line.trim().split(/\s+/).slice(2);
    return otherParents.some((p) => tryGit(execImpl, ['merge-base', '--is-ancestor', '--end-of-options', p, ref]) !== null);
  });
  if (!mergedRef) return null;
  const differs = tryGit(execImpl, ['diff', '--name-only', '-z', '--end-of-options', ref, 'HEAD']);
  if (differs === null) return null;
  const own = new Set(parseNameOnlyZ(differs));
  for (const f of parseStatusPorcelainZ(git(execImpl, ['status', '--porcelain', '-z', '--untracked-files=all']))) own.add(f);
  const excluded = files.filter((f) => !own.has(f));
  return { ref, excluded, files: files.filter((f) => own.has(f)) };
}
```

and extend the export: `changedFiles, resolveBase, usableAnchor, mergeNarrowing, ChangedFilesError,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/changed-files.test.js`
Expected: PASS (all, including the pre-existing fakeExec tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/changed-files.js tests/bin-lib/verify/changed-files.test.js
git commit -m "Add mergeNarrowing to verify changed-files — drop merge-identical paths after an integration-branch merge (refs #3072)"
```

### Task 2: Wire narrowing into `verify.js --scope`, report it, fix the refusal message, document it

**Files:**
- Modify: `plugin/bin/verify.js` (import; `--scope` block after `files = changedFiles(...)` ~line 332; `--base` refusal ~line 327; `composeReport` scope object ~line 556; stdout Scope lines ~line 653-671)
- Modify: `plugin/skills/test/verification.md` (Re-verify scoping section, lines 79-89: one new paragraph + the `Verification scoped` log-line format)
- Test: `tests/bin-lib/verify/cli.test.js` (append CLI fixtures; extend the H4 test at ~line 760 with a negative assertion)

**Interfaces:**
- Consumes: `mergeNarrowing` from Task 1.
- Produces: `report.json`'s `scope.mergeNarrowing` = `null | { ref: string, excluded: number, excludedFiles: string[] }`; stdout line `merge-narrowed: {n} merge-identical path(s) excluded (identical to {ref})` directly under the `Scope:` line when narrowing applied.

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/verify/cli.test.js`:

```js
// #3072: scopedRepo on its init branch (the integration branch), a feature
// branch cut from it carrying the full-pass anchor, then a --no-ff merge of the
// integration branch bringing in N `ui/**` files plus one own-work `src/**` commit.
function mergedScopedRepo() {
  const r = scopedRepo([
    { match: 'src/**', suites: ['unit'], static: true },
    { match: 'ui/**', suites: ['other'], static: true },
  ]);
  const trunk = r.branch;
  r.git('checkout', '-q', '-b', 'feat');
  return { ...r, trunk };
}

async function anchorFullPass(r, extraArgs = []) {
  const args = ['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0', ...extraArgs];
  const run = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: full/m);
  if (fs.existsSync(r.marker)) fs.unlinkSync(r.marker);
  return stampOf(r.gitDir).fullSha;
}

function mergeTrunk(r, rels) {
  r.git('checkout', '-q', r.trunk);
  for (const rel of rels) commitFile(r, rel, rel);
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--no-ff', '--no-edit', r.trunk);
}

test('--scope --integration-branch: after an integration-branch merge, only the own-work path selects suites and report.json counts the merge-identical ones (#3072 AC1)', async () => {
  const r = mergedScopedRepo();
  const anchor = await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js', 'ui/b.js', 'ui/c.js']);
  commitFile(r, 'src/own.js', 'own');
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: scoped — 1 changed file\(s\) since/m);
  assert.match(run.stdout, /^merge-narrowed: 3 merge-identical path\(s\) excluded \(identical to /m);
  const s = stampOf(r.gitDir);
  assert.strictEqual(s.fullSha, anchor, 'the anchor is untouched — narrowing filters, it never re-bases');
  assert.deepStrictEqual(s.changedFiles, ['src/own.js']);
  assert.deepStrictEqual(s.suitesRun, ['unit']);
  const report = JSON.parse(fs.readFileSync(s.reportPath, 'utf8'));
  assert.strictEqual(report.scope.base, anchor);
  assert.deepStrictEqual(report.scope.changedFiles, ['src/own.js']);
  assert.deepStrictEqual(report.scope.mergeNarrowing, { ref: r.trunk, excluded: 3, excludedFiles: ['ui/a.js', 'ui/b.js', 'ui/c.js'] });
});

test('--scope: without --integration-branch the same merged fixture selects every anchor..HEAD path, unnarrowed (#3072 AC4)', async () => {
  const r = mergedScopedRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js', 'ui/b.js']);
  commitFile(r, 'src/own.js', 'own');
  const run = await runCli(['--scope', r.declPath, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /merge-narrowed/);
  const report = JSON.parse(fs.readFileSync(stampOf(r.gitDir).reportPath, 'utf8'));
  assert.deepStrictEqual(report.scope.changedFiles, ['src/own.js', 'ui/a.js', 'ui/b.js']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
});

test('--scope --integration-branch: with no integration-branch merge after the anchor, the set equals anchor..HEAD (#3072 AC2)', async () => {
  const r = mergedScopedRepo();
  await anchorFullPass(r);
  commitFile(r, 'src/own.js', 'own');
  commitFile(r, 'ui/a.js', 'a');
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const report = JSON.parse(fs.readFileSync(stampOf(r.gitDir).reportPath, 'utf8'));
  assert.deepStrictEqual(report.scope.changedFiles, ['src/own.js', 'ui/a.js']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
});

test('--scope --integration-branch: a merged-in file the branch then edited stays selected (#3072 AC3)', async () => {
  const r = mergedScopedRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js', 'ui/b.js']);
  commitFile(r, 'ui/a.js', 'edited on the branch');
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const report = JSON.parse(fs.readFileSync(stampOf(r.gitDir).reportPath, 'utf8'));
  assert.deepStrictEqual(report.scope.changedFiles, ['ui/a.js']);
  assert.deepStrictEqual(report.scope.mergeNarrowing, { ref: r.trunk, excluded: 1, excludedFiles: ['ui/b.js'] });
});
```

And in the existing H4 test (`--scope: --base that contradicts the stamp anchor is a usage error…`, ~line 777), directly after `assert.match(run.stderr, /--scope: --base .* conflicts with the stamp anchor/);` add:

```js
  assert.doesNotMatch(run.stderr, /pass --integration-branch instead/, '#3072 AC5: the refusal must not imply --integration-branch overrides the anchor');
  assert.match(run.stderr, /after an integration-branch merge, --integration-branch narrows the scoped set to this branch's own delta/);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/verify/cli.test.js`
Expected: FAIL — the AC1/AC3 tests (no `merge-narrowed` line, `mergeNarrowing` undefined) and the H4 test (`pass --integration-branch instead` still present). The AC2/AC4 tests fail only on `report.scope.mergeNarrowing` being `undefined` rather than `null`.

- [ ] **Step 3: Implement** in `plugin/bin/verify.js`:

1. Import: `changedFiles, resolveBase, usableAnchor, mergeNarrowing, ChangedFilesError,` (the `require('./lib/verify/changed-files')` destructure, ~line 33).
2. Declare `let narrowing = null;` beside `let priorStamp = null;` (~line 252).
3. Replace the refusal (~line 327):

```js
        scopeUsageExit(`--scope: --base ${parsed.base} conflicts with the stamp anchor ${anchorSha.slice(0, 9)}; omit --base or clear the stamp (after an integration-branch merge, --integration-branch narrows the scoped set to this branch's own delta)`);
```

4. Replace `files = changedFiles({ base: resolvedBase }).files;` (~line 332) with:

```js
    files = changedFiles({ base: resolvedBase }).files;
    // #3072: anchored on a full pass and asked about an integration branch the
    // run has since merged — narrow to the branch's own delta. Only when the
    // resolved base IS the usable anchor; with no anchor, resolveBase already
    // returned the merge-base, which excludes merged-in files by construction.
    if (parsed.integrationBranch && anchorSha && resolvedBase === anchorSha) {
      narrowing = mergeNarrowing({ anchor: anchorSha, integrationBranch: parsed.integrationBranch, files });
      if (narrowing) files = narrowing.files;
    }
```

5. In the `composeReport` scope object (~line 556) add a trailing field: `mergeNarrowing: narrowing ? { ref: narrowing.ref, excluded: narrowing.excluded.length, excludedFiles: narrowing.excluded } : null`.
6. In the stdout block (~line 661), directly after `lines.push(\`${lead}; suites: …\`);` add:

```js
    if (narrowing) lines.push(`merge-narrowed: ${narrowing.excluded.length} merge-identical path(s) excluded (identical to ${narrowing.ref})`);
```

Then in `plugin/skills/test/verification.md`:

7. Insert a new paragraph between the scoped-invocation paragraph (the one beginning `` `{ref}` resolves via ``) and `**Standalone is always full.**`:

```markdown
**After an integration-branch merge.** A run that merged `{ref}` into its own branch after its last full pass would otherwise re-verify every file the merge brought in. The scoped invocation's existing `--integration-branch {ref}` narrows that: when a usable stamp anchor exists and a merge commit after it has `{ref}` history as its other parent, the runner drops every changed path whose content at HEAD equals `{ref}`'s tip (working-tree edits always stay), and keeps the anchor as the base. No call site changes — every scoped site already passes the flag. It is a deliberate tradeoff, never silent: the merged-in files are trusted on the premise that `{ref}`'s tip already passed its own CI, and `report.json`'s `scope.mergeNarrowing` (`{ref, excluded, excludedFiles}`, `null` when nothing was narrowed) plus a `merge-narrowed:` stdout line record what was skipped.
```

8. In the `**Report and log.**` paragraph, change the log-line template from
`` `AUTO {time} — Verification scoped: {mode} — {n} changed file(s) since {base-short}: {path → rule, …}; suites: {list|none}. Reversibility: high.` ``
to
`` `AUTO {time} — Verification scoped: {mode} — {n} changed file(s) since {base-short}: {path → rule, …}; suites: {list|none}{; merge-narrowed vs {ref}: {k} merge-identical path(s) excluded}. Reversibility: high.` ``
and append to that paragraph's end: `The braced merge-narrowed clause is present only when \`report.json\`'s \`scope.mergeNarrowing\` is non-null — \`{ref}\` and \`{k}\` are its \`ref\` and \`excluded\`.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/*.test.js`
Expected: PASS (all files). Then run the verification.md prose pins: `node --test tests/test-skill-affected-conformance.test.js tests/verification-skip-before-execute.test.js tests/verification-flake-handling.test.js tests/bin-lib/verify/snippet-conformance.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/verify.js plugin/skills/test/verification.md tests/bin-lib/verify/cli.test.js
git commit -m "Narrow verify --scope to the branch's own delta after an integration-branch merge — report excluded paths, fix the --base refusal (refs #3072)"
```

## Authoring checks (build/plan-authoring-checks.md)

- **Return-shape widening:** `report.json`'s `scope` object gains `mergeNarrowing`. `grep -rn "deepStrictEqual(report[0-9]*\.scope\b" tests/` → no whole-`scope` equality assertions (only `report.scope.unmatched`/`.matched` field asserts at `cli.test.js:631,659`), so no existing assertion is defanged.
- **Byte-pin:** `plugin/skills/test/verification.md` is 42,211 bytes; `plan-audit.js --bytes` reports 3,869 bytes headroom against the 46,080-byte per-file ceiling (the composed ceiling is `context-cost.js:34`'s 51,200); this task adds ~900 bytes. No basename-specific byte pin in `tests/` (grep of the ten tests citing `verification.md` found no `byteLength`/numeric bound). Composed-bytes headroom is checked by `plan-audit.js --bytes`.
- **Moved-prose pin:** no prose moves; `tests/test-skill-affected-conformance.test.js:47` slices from `### Re-verify scoping` — the new paragraph sits inside that section and adds no heading, so the slice still holds.
- **Behavioral-claim:** the verification.md sentence "No call site changes — every scoped site already passes the flag" is backed by the scoped-invocation snippet at `verification.md:82` (the one shared command every scoped site cites) carrying `--integration-branch {ref}`.
- **Reachability:** AC1/AC3 tests reach the gate (anchor usable + `--integration-branch` + a real `--no-ff` merge) and assert post-gate output (`report.json` `changedFiles`, `suitesRun`, `mergeNarrowing`).
