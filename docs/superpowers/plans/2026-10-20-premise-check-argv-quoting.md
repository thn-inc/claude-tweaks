# Premise-check argv quoting on Windows (#3716) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove, with real-shell tests run on POSIX and on windows-latest, that a Premise-check command composed by `buildPremiseCheck` for an anchor containing a double quote, a backslash, or a single quote reads unresolved when the anchor is absent and resolved when it is present. Fix the quoting only if Windows proves it wrong.

**Architecture:** One table-driven block of real-shell tests in the existing suite runs every anchor through the production path: `buildPremiseCheck` composes, then `defaultRunner` and `premiseReadsUnresolved` execute. The Windows ground truth comes from a `workflow_dispatch` of `windows-regression.yml` on this branch, read per file. A fix to `buildPremiseCheck` (composition) or `defaultRunner` (spawn) lands only when that run shows a failure.

**Tech Stack:** Node `node:test`, `child_process.execFileSync`, `/bin/sh` (POSIX) / MSYS `sh` on PATH (win32), GitHub Actions.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T125414-record-3716/work/3716-spec.md` (record #3716)

## Global Constraints

- Tests live in `tests/bin-lib/health-core/premise-self-check.test.js`, using its existing `tmpWithSpace()` helper (temp dir name contains a space).
- Never use a literal `/bin/sh` or `cmd.exe` in a test. Commands run only through `defaultRunner`/`premiseReadsUnresolved` (#3563).
- Windows evidence is the **per-file** result for `tests/bin-lib/health-core/premise-self-check.test.js` from the run's log or report, never the run verdict alone (#3568).
- Commit style: `{Verb} {what} — {detail}`, `refs #3716` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_011BdbSicF7Bima1GrGS3AuQ`.

## Acceptance-criteria clause ids

| Clause | Text | Covered by |
|---|---|---|
| AC1.1 | New tests pass on macOS/Linux | Task 1 Step 2 |
| AC1.2 | New tests pass in a windows-latest `windows-regression.yml` run, quoted from the per-file log result | Task 2 |
| AC2.1 | An anchor with `"` or `\` reads **unresolved** when absent (both platforms) | Task 1 test (absent half), Task 2 |
| AC2.2 | Same anchor reads **resolved** when present (both platforms) | Task 1 test (present half), Task 2 |

## Review Focus

1. **Backslash immediately before a double quote** (`\"`). MSVCRT argv quoting doubles backslashes only before a quote, so this is the most likely Windows mangle. Covered by the anchor row `a backslash before a double quote`.
2. **Trailing backslash.** Node's quoting doubles a trailing backslash inside a quoted arg, and a parser mismatch there swallows the closing quote. Covered by the anchor row `a trailing backslash`.
3. **A mangle that silently drops quotes or backslashes.** If the absent-case file held plain text, a dropped character would still read "absent", so the test could not see it. The absent-case file therefore holds the anchor with every `"`, `'` and `\` stripped: the dropped-character command then matches and reads resolved, and the test goes red. This was verified by a scratch go-red simulation: stripping `"`/`\` from the composed command flips the absent-case exit from 0 to 1 for all three quote/backslash anchors.
4. **A mangled command that errors (grep exit 2, sh syntax error).** Asserting the exact exit codes, `0` absent and `1` present, rather than only zero vs non-zero catches this.
5. **The test passing on POSIX proves nothing about Windows.** Never report Task 1's local pass as AC1.2. If the Windows run cannot be dispatched or has not finished, say so explicitly.

---

### Task 1: Real-shell quoting tests

**Files:**
- Test: `tests/bin-lib/health-core/premise-self-check.test.js` (insert immediately before `test('defaultRunner returns the exit code of a command that ran', …)`)

**Interfaces:**
- Consumes: `buildPremiseCheck(finding, targetPath, root) -> string` (`plugin/bin/lib/harness-health/issue-payload.js`), `defaultRunner(command, { cwd, timeoutMs }) -> exitCode`, `premiseReadsUnresolved(command, { root }) -> boolean` (`plugin/bin/lib/health-core/premise-self-check.js`). All are already imported by the test file.
- Produces: five tests named `AC1.1/AC2.1/AC2.2: real shell: an anchor containing {label} reads unresolved while absent and resolved once present`. Task 2 reads their per-file result.

- [ ] **Step 1: Add the table-driven tests** (exact code, already run once against the current tree, 19/19 pass on darwin):

```js
// #3716: on win32 the composed command crosses Node's argv quoting into MSYS
// sh.exe, where a double quote or a backslash in the anchor is what a mangled
// command would misread. The absent-case file holds the anchor with every quote
// and backslash stripped, so a mangle that drops them reads "resolved" and fails.
const QUOTING_ANCHORS = [
  ['a double quote', 'Run "npm test" first.'],
  ['a backslash', 'Paths look like C:\\Users\\me\\repo.'],
  ['a single quote', "Don't skip the hook."],
  ['a backslash before a double quote', 'Escape it as \\" inside strings.'],
  ['a trailing backslash', 'The line continues with \\'],
];

for (const [label, anchor] of QUOTING_ANCHORS) {
  test(`AC1.1/AC2.1/AC2.2: real shell: an anchor containing ${label} reads unresolved while absent and resolved once present`, () => {
    const dir = tmpWithSpace();
    const target = path.join(dir, 'guide.md');
    fs.writeFileSync(target, `# guide\n\n${anchor.replace(/["'\\]/g, '')}\n`);
    const command = buildPremiseCheck({ kind: 'patch', newString: anchor }, target, dir);
    assert.strictEqual(defaultRunner(command, { cwd: dir, timeoutMs: 5000 }), 0);
    assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), true);
    fs.writeFileSync(target, `# guide\n\n${anchor}\n`);
    assert.strictEqual(defaultRunner(command, { cwd: dir, timeoutMs: 5000 }), 1);
    assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), false);
  });
}
```

- [ ] **Step 2: Run** `node --test tests/bin-lib/health-core/premise-self-check.test.js`
  Expected: PASS, `# tests 19`, `# fail 0` (14 existing + 5 new). These tests pass on POSIX with no code change. They target the Windows platform, so there is no POSIX red step. The discrimination proof is Review Focus item 3.

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/health-core/premise-self-check.test.js
git commit -m "Pin Premise-check quoting for quote and backslash anchors through a real shell — refs #3716"
```

### Task 2: Windows ground truth and conditional fix

**Files:**
- Modify (only if the Windows run fails a new test): `plugin/bin/lib/harness-health/issue-payload.js` (`shQuote`/`buildPremiseCheck`) or `plugin/bin/lib/health-core/premise-self-check.js` (`defaultRunner` spawn)

**Interfaces:**
- Consumes: Task 1's five test names; the pushed branch `worktree-dispatch-record-3716`.
- Produces: the windows-latest run id plus the per-file result line(s) for `tests/bin-lib/health-core/premise-self-check.test.js`, which feed the build handoff and the PR.

- [ ] **Step 1: Push** the branch (phase-exit push form: `git -C "{worktree}" push origin worktree-dispatch-record-3716`).
- [ ] **Step 2: Dispatch** `gh workflow run windows-regression.yml --ref worktree-dispatch-record-3716 --repo thn-inc/claude-tweaks`. Resolve the run id with `gh run list --workflow windows-regression.yml --branch worktree-dispatch-record-3716 --repo thn-inc/claude-tweaks --limit 1 --json databaseId,headSha,status`, and confirm that `headSha` equals local `HEAD`.
- [ ] **Step 3: Wait** for completion in the foreground (`gh run watch {id} --exit-status` with a long timeout). Read the per-file result for `premise-self-check.test.js` from the `windows` job log (`gh run view {id} --log --job {windows-job-id}`) and the `verify-report` artifact. Quote the five new test names' `ok`/`not ok` lines verbatim. Never cite the run verdict alone (#3568).
- [ ] **Step 4 (only if any new test is `not ok` on Windows):** reproduce the failure from the log's assertion (which anchor, which half, and actual vs expected exit). Then fix at the narrowest site. Prefer the spawn site, since the argv crossing is the cause: on win32 deliver the command without putting its text in argv (for example via an env var that `sh -c` evaluates). Alternatively fix `shQuote` at the composition site. Keep Task 1's tests unchanged. Add an injected-exec unit test pinning the new win32 spawn shape alongside the existing `AC3.1` spawn test, re-run Task 1 Step 2 locally, commit (`refs #3716`), and repeat Steps 1–3.
- [ ] **Step 5:** If the run cannot be dispatched or has not finished by the end of the build call, say so explicitly in the handoff with the run id. Never substitute the POSIX result for AC1.2.

---

## Self-review

- **Spec coverage:** Deliverable 1 is covered by Task 1. Deliverables 2 and 3 are covered by Task 2. AC1 and AC2 map by clause id in the table above.
- **Placeholders:** none. Task 2 Step 4's fix is conditional by spec, and the spec names both candidate sites.
- **Proportion:** two tasks. The test code is inline because the spec fixes its values, and it was run once.
