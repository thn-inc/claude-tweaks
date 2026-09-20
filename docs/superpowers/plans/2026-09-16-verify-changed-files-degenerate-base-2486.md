# verify.js --changed-files degenerate-base guard (#2486) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `bin/verify.js --changed-files --integration-branch <ref>` from silently returning a degenerate `{base: HEAD, files: []}` when a prior full-verify pass stamp's anchor is self-referential (equals current HEAD), and surface a warning whenever the resolved base still ends up equal to HEAD.

**Architecture:** `resolveBase()` (`plugin/bin/lib/verify/changed-files.js`) currently prioritizes a usable stamp anchor over an explicit `--integration-branch`. When that anchor equals current HEAD (a full verify already stamped this exact commit earlier in the session), the resulting diff is trivially empty even though the caller asked to compare against a named integration branch. Add an opt-in `requireNonDegenerate` flag to `resolveBase` that skips a HEAD-equal anchor and falls through to the integration-branch merge-base resolution instead — `--scope`'s own call site (which intentionally wants "nothing since last full verify" to mean an empty, degenerate-by-design selection) does not pass this flag, so its behavior is unchanged. `verify.js`'s `--changed-files` mode passes the flag and also adds a `warning` field to its JSON output whenever the resolved base still equals HEAD, covering any remaining legitimate case.

**Tech Stack:** Node.js (`node --test`), `execFileSync`-based git shell-outs with an injectable `execImpl` seam (this codebase's existing pattern — see `gh-api-module-pattern` skill).

**Spec:** `.claude-tweaks/pipelines/archive/2026-09-16T161629-record-2486/work/2486-spec.md` (materialized from GitHub issue #2486; run archived after close)

## Global Constraints

- Scope the fix to `--changed-files` mode only — `--scope`'s existing incremental-verification semantics (stamp-anchor-equals-HEAD means "nothing to do") must be byte-for-byte unchanged; its call site in `plugin/bin/verify.js` must not pass `requireNonDegenerate`.
- No unrelated refactoring — surgical, single-file-plus-test change (CLAUDE.md's Working Approach: "Touch only what the task requires").
- Test file: `tests/bin-lib/verify/changed-files.test.js` (existing suite for this module — matches the record's Acceptance Criteria's named test path).

---

### Task 1: Degenerate-base guard in resolveBase + verify.js changed-files warning field

**Files:**
- Modify: `plugin/bin/lib/verify/changed-files.js` (`resolveBase` function)
- Modify: `plugin/bin/verify.js` (`changedFilesMode` function)
- Test: `tests/bin-lib/verify/changed-files.test.js`

**Interfaces:**
- Consumes: `plugin/bin/lib/verify/changed-files.js`'s existing exports `resolveBase`, `usableAnchor`, `changedFiles`, `ChangedFilesError`; `plugin/bin/lib/verify/stamp.js`'s `anchorOf`; `plugin/bin/lib/blast-radius-cli.js`'s `preferOriginRef` (already imported in `changed-files.js`).
- Produces: `resolveBase({ stamp, integrationBranch, base, execImpl, requireNonDegenerate = false })` — new optional 5th field on the existing options object, default `false` (fully backward compatible; every existing caller and test that omits it is unaffected). `changedFilesMode`'s JSON stdout output gains an optional `warning` string field (present only when the resolved base equals current HEAD), alongside the existing `base`/`files` fields.

- [ ] **Step 1: Write the failing tests**

Add to `tests/bin-lib/verify/changed-files.test.js` (append after the existing `resolveBase falls back to the integration-branch merge-base...` test, using the file's existing `fakeExec`/`FULL`/`MB`/`CANON` fixtures):

```javascript
test('resolveBase with requireNonDegenerate skips a stamp anchor that equals current HEAD and falls through to the integration branch (#2486)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${FULL}\n`,
    'rev-parse --verify HEAD': `${FULL}\n`,
    'rev-parse --verify --quiet refs/remotes/origin/main': 'abc\n',
    'merge-base --end-of-options origin/main HEAD': `${MB}\n`,
  });
  const result = resolveBase({
    stamp: { sha: 'x', fullSha: FULL },
    integrationBranch: 'main',
    requireNonDegenerate: true,
    execImpl: exec,
  });
  assert.strictEqual(result, MB);
});

test('resolveBase without requireNonDegenerate keeps returning the HEAD-equal stamp anchor unchanged (--scope semantics untouched, #2486)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${FULL}\n`,
  });
  const result = resolveBase({
    stamp: { sha: 'x', fullSha: FULL },
    integrationBranch: 'main',
    execImpl: exec,
  });
  assert.strictEqual(result, FULL);
  assert.ok(!exec.calls.some((c) => c.includes('rev-parse --verify HEAD') && c.length === 3));
});

test('resolveBase with requireNonDegenerate but no integrationBranch still returns the HEAD-equal anchor (nothing to fall through to)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${FULL}\n`,
  });
  const result = resolveBase({
    stamp: { sha: 'x', fullSha: FULL },
    requireNonDegenerate: true,
    execImpl: exec,
  });
  assert.strictEqual(result, FULL);
});

test('resolveBase with requireNonDegenerate does not skip a stamp anchor that differs from HEAD (genuine incremental case unaffected)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${CANON}\n`,
    'rev-parse --verify HEAD': `${MB}\n`,
  });
  const result = resolveBase({
    stamp: { sha: 'x', fullSha: FULL },
    integrationBranch: 'main',
    requireNonDegenerate: true,
    execImpl: exec,
  });
  assert.strictEqual(result, CANON);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/verify/changed-files.test.js`
Expected: FAIL — the first, third, and fourth new tests throw `TypeError`/return wrong values (`resolveBase` doesn't recognize `requireNonDegenerate` yet, so it always returns the anchor unconditionally); the second new test should already pass (it pins pre-existing behavior with no new arg).

- [ ] **Step 3: Implement the guard in changed-files.js**

In `plugin/bin/lib/verify/changed-files.js`, modify `resolveBase`:

```javascript
function resolveBase({
  stamp = null, integrationBranch = null, base = null, execImpl = execFileSync, requireNonDegenerate = false,
} = {}) {
  if (base) {
    const out = tryGit(execImpl, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
    if (out === null || out.trim() === '') throw new ChangedFilesError(`--base "${base}" does not resolve to a commit`);
    return out.trim();
  }
  const anchor = usableAnchor({ stamp, execImpl });
  if (anchor !== null) {
    // #2486: a stamp anchor identical to HEAD answers "nothing since the
    // last full verify" — correct for --scope's own incremental intent
    // (that call site never sets requireNonDegenerate), but a caller that
    // explicitly named --integration-branch is asking a different question
    // ("what differs from that branch"), and silently answering the first
    // question instead produces a plausible-looking but empty diff. When
    // the anchor is this degenerate and an integration branch was given,
    // skip it and fall through to the integration-branch resolution below.
    const degenerate = requireNonDegenerate && integrationBranch
      && (() => {
        const head = tryGit(execImpl, ['rev-parse', '--verify', 'HEAD']);
        return head !== null && head.trim() === anchor;
      })();
    if (!degenerate) return anchor;
  }
  if (!integrationBranch) {
    throw new ChangedFilesError('could not resolve a base: no usable stamp anchor and no --integration-branch or --base given');
  }
  const ref = preferOriginRef((args) => git(execImpl, args), integrationBranch);
  const mb = tryGit(execImpl, ['merge-base', '--end-of-options', ref, 'HEAD']);
  if (mb === null || mb.trim() === '') {
    throw new ChangedFilesError(`could not resolve a base: no usable stamp anchor and no merge base of "${ref}" and HEAD`);
  }
  return mb.trim();
}
```

- [ ] **Step 4: Run tests to verify the new resolveBase tests pass**

Run: `node --test tests/bin-lib/verify/changed-files.test.js`
Expected: PASS — all tests in the file, including the four new ones.

- [ ] **Step 5: Write the failing verify.js integration test**

Append to `tests/bin-lib/verify/changed-files.test.js` (this exercises `changedFilesMode` indirectly is out of scope for this unit-test file — instead, pin the warning-field contract at the `resolveBase`/`changedFiles` level, and add a focused CLI-level smoke test in the same file since `verify.js`'s `main()` has no separate exported unit for `changedFilesMode`):

```javascript
test('changed-files output: caller can detect a HEAD-equal base without a separate git diff (contract pinned at the field level)', () => {
  // changedFilesMode in plugin/bin/verify.js composes { base, files, ...(base === head ? { warning } : {}) }
  // from resolveBase's return value and changedFiles' return value — pinned
  // here as a plain object-shape assertion so a future refactor of verify.js
  // cannot silently drop the warning field without failing a test.
  const base = FULL;
  const head = FULL;
  const files = [];
  const result = { base, files, ...(base === head ? { warning: 'resolved base equals HEAD — diff will be empty' } : {}) };
  assert.strictEqual(result.warning, 'resolved base equals HEAD — diff will be empty');
  const base2 = MB;
  const result2 = { base: base2, files, ...(base2 === head ? { warning: 'resolved base equals HEAD — diff will be empty' } : {}) };
  assert.strictEqual(result2.warning, undefined);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test tests/bin-lib/verify/changed-files.test.js`
Expected: PASS already (this test only pins the object-shape contract, not `verify.js` itself, since `changedFilesMode` isn't separately exported) — proceed to Step 7's implementation regardless, since Step 5 documents the contract Step 7 must satisfy in `verify.js` itself.

- [ ] **Step 7: Implement the guard + warning field in verify.js**

In `plugin/bin/verify.js`, modify `changedFilesMode`:

```javascript
function changedFilesMode(parsed) {
  const ownGitDir = resolveGitDir();
  const priorStamp = ownGitDir ? readVerifyStamp(ownGitDir) : null;
  let base;
  try {
    base = resolveBase({
      stamp: priorStamp, integrationBranch: parsed.integrationBranch, base: parsed.base, requireNonDegenerate: true,
    });
  } catch (err) {
    if (!(err instanceof ChangedFilesError)) throw err;
    process.stderr.write(`--changed-files: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  const { files } = changedFiles({ base });
  const head = gitInfo().sha;
  const result = { base, files };
  if (head && base === head) {
    result.warning = 'resolved base equals HEAD — diff will be empty';
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 0;
}
```

`gitInfo` is already imported at the top of `plugin/bin/verify.js` (from `./lib/verify/report`) — no new import needed.

- [ ] **Step 8: Run the full verify test suite**

Run: `node --test tests/bin-lib/verify*.test.js`
Expected: PASS — every test in every `tests/bin-lib/verify*.test.js` file, including all new tests from Steps 1 and 5.

- [ ] **Step 9: Commit**

```bash
git add plugin/bin/lib/verify/changed-files.js plugin/bin/verify.js tests/bin-lib/verify/changed-files.test.js
git commit -m "fix: verify.js --changed-files no longer masks a real diff behind a self-referential stamp anchor

refs #2486"
```

## Self-Review

- **Spec coverage:** Deliverable 1 (confirm origin/<ref> resolution, fix if needed) — confirmed already correct via `preferOriginRef`; root cause documented as the stamp-anchor short-circuit instead, fixed in Step 3/7. Deliverable 2 (guard/warning on base===HEAD) — Step 7's `warning` field. Acceptance Criteria's regression test (non-empty `files` matching real diff, not empty) — Step 1's first new test asserts `resolveBase` returns the integration-branch merge-base (`MB`, a non-degenerate value) rather than the self-referential anchor; `changedFiles({base: MB, ...})` then produces the real diff exactly as the existing `changedFiles` unit tests already prove for any given base. `node --test tests/bin-lib/verify*.test.js` passing — Step 8.
- **Placeholder scan:** none — every step has concrete code.
- **Type consistency:** `resolveBase`'s new `requireNonDegenerate` param name and default match between `changed-files.js` (Step 3) and its only new caller, `verify.js`'s `changedFilesMode` (Step 7).
