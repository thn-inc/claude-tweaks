# Pre-tool-use safeReal → canonicalRealpath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every path-identity and containment comparison left in `plugin/bin/lib/hooks/pre-tool-use.js` resolves both operands through path-guard's case-canonical `canonicalRealpath()`. A mis-cased cwd, target, or recorded worktree then compares equal to its correctly-cased spelling.

**Architecture:** Delete the file-local JS-form `safeReal()` helper and call `canonicalRealpath(p, { fsImpl })` at each of its 14 call sites. The audit below shows that both operands of every comparison already go through `safeReal`, so all sites move together and no comparison ends up mixing forms. `run(ctx, deps)` is the existing test-only injection bag. It gains `deps.fsImpl`, threaded to every migrated site, and `deps.toplevel`, an override of the git toplevel lookup, so E1 can be exercised on `tests/helpers/case-insensitive-fs.js` without a real case-insensitive volume.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124134-record-3682/work/3682-spec.md`

## Global Constraints

- No new dependencies; `node --test` only.
- Commit subjects: `{Verb} {what} — {detail}`; reference the record as `refs #3682`, never `closes`/`fixes`.
- End every commit message with `Claude-Session: https://claude.ai/code/session_01QL4RZPGQQaegkPMds8wSAf`.
- The production call site (`bin/hooks.js` `main()` → `mod.run({...})`) passes no `deps`. Every new `deps` key must default to production behavior when absent: `fsImpl` → real `fs` via path-guard's default, and `toplevel` → the file's own `toplevel()`.
- `tests/helpers/case-insensitive-fs.js` is posix-only — gate the new tests with the same `POSIX_ONLY` skip that `tests/bin-lib/path-guard/callers-characterization.test.js` uses.

## Per-site audit (Deliverable 1 — record this in the commit body)

Line numbers are at `fa8286fc8`. "Both via safeReal" means each operand of the comparison is a `safeReal(...)` result in this file. That makes moving them together a no-flip change.

| Line(s) | Function | Comparison | Other operand | Verdict |
|---|---|---|---|---|
| 563, 567 | `checkTeardownGate` | `safeReal(target) === mainRoot` | `mainRoot = safeReal(mainCheckoutRoot(cwd))` | both via safeReal — migrate |
| 565, 580–581 | `checkTeardownGate` | `isPathContained(cwdReal, targetReal, {orEqual})` (own-cwd, #693) | both via safeReal | migrate |
| 1752, 1755 | `checkBookkeepingStampsGate` | `safeReal(mainCheckoutRoot(t.dir)) === mainRoot` | both via safeReal | migrate |
| 1807 | `checkBookkeepingStampsGate` | not a comparison — leaf-symlink resolution handed to `wtDetect.repoInfo` | n/a | migrate (only the casing of repoInfo's input changes; repoInfo realpaths internally) |
| 1816–1818 | `checkBookkeepingStampsGate` | `targetMainRoot !== mainRoot` | both via safeReal | migrate |
| 2028, 2032 | `checkDispatchConfigGate` | `safeReal(top) === bound` | both via safeReal | migrate |
| 2083, 2094–2096, 2123–2126 | `runInner` E1 | `actual === assigned`, `otherWorktrees.has(actual)` | map keys and `assigned` both via safeReal | migrate |
| 2106, 2146–2147 | `runInner` E1 | `actualMainRoot !== mainRoot` | both via safeReal | migrate |

None of these values leaves the file for another comparison. They flow only into `appendEvent` payloads and message text. `findRunByWorktreePath` / `classifyOwnership` (context.js) receive the raw `target`/`cwd`, not a `safeReal` result. They are out of scope and unchanged.

## Review Focus

1. A mis-cased target that no longer exists on disk: `canonicalRealpath` → `null` → own-cwd guard allows. Keep the fail-open (Task 1 test `own-cwd: a missing target is allowed`).
2. A sibling directory that only shares a prefix (`/Vol/Repo/wt` vs `/Vol/Repo/wt2`) must not read as contained after canonicalisation (Task 1 test `own-cwd: a prefix sibling is not contained`).
3. E1 must still deny a commit in an unrelated in-project directory once casing is canonical — the canonical form must not widen the allow (Task 1 test `E1: a commit outside the assigned worktree is still denied`).
4. Correctly-cased paths behave exactly as before — the existing suites `tests/teardown-gate.test.js`, `tests/hooks-pre-tool-use.test.js`, `tests/hooks-bookkeeping-stamps-gate.test.js`, `tests/hooks-dispatcher.test.js` must stay green unchanged.
5. On win32, `.native` may return a different textual form than the JS realpath. Both operands share one function, so comparisons stay self-consistent. The fake-fs tests skip on win32 (posix-only helper).

---

### Task 1: Migrate every pre-tool-use identity comparison to canonicalRealpath

Covers: AC1.1 (the `#3682` own-cwd and E1 tests on the fake), AC2.1 (Step 5's targeted suites incl. `tests/path-guard-conformance.test.js`; the full `npm test` runs centrally at /build Common Step 5).

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (delete `safeReal` at 432–434; 14 call sites per the audit; `checkTeardownGate` 553; `checkDispatchConfigGate` 2012; `runInner` 2047–2148; `run()` header comment 2196–2205)
- Create: `tests/bin-lib/path-guard/pre-tool-use-identity.test.js`
- Modify: `tests/path-guard-conformance.test.js:123` (the `lib/hooks/pre-tool-use.js` ALLOWLIST entry)

**Interfaces:**
- Consumes: `canonicalRealpath(p, { fsImpl })` from `plugin/bin/lib/path-guard` (already imported at line 39); `caseInsensitiveFs(entries)` from `tests/helpers/case-insensitive-fs.js`.
- Produces:
  - `run(ctx, deps = {})`: `deps.fsImpl` (fs-like; forwarded as `{ fsImpl }` to every `canonicalRealpath` call below) and `deps.toplevel` (`(dir: string) => string | null`; replaces `toplevel(dir)` in E1 and `checkDispatchConfigGate`). Both are optional and test-only.
  - `checkTeardownGate(ctx, teardownWarnings = [], deps = {})`
  - `checkDispatchConfigGate(ctx, commandGitTargets, deps = {})`
  - `checkBookkeepingStampsGate` keeps its signature and reads `deps.fsImpl`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/path-guard/pre-tool-use-identity.test.js`

Require `run` from `plugin/bin/lib/hooks/pre-tool-use`. Set `process.env.CT_HOOKS_TEST_MODE = '1'`. Use fake-only paths under `/Vol/Repo` (they exist on no real disk, so every real-fs/git probe on them returns "not a repo" on both macOS and Linux) with `fsImpl = caseInsensitiveFs({ '/Vol': 'dir', '/Vol/Repo': 'dir', '/Vol/Repo/wt': 'dir', '/Vol/Repo/wt2': 'dir', '/Vol/Repo/other': 'dir' })`. Each test passes `{ skip: POSIX_ONLY }`. A deny is `out.json.hookSpecificOutput.permissionDecision === 'deny'`; an allow is that field being absent.

Own-cwd containment (`checkTeardownGate`). Input: `{ tool_name: 'Bash', tool_input: { command: 'git worktree remove <target>' }, session_id: 's1' }`, with `runDir: null` and `runState: null`:
  - `own-cwd (#3682): a mis-cased target naming the session's own cwd is denied` — cwd `/Vol/Repo/wt`, target `/vol/repo/WT` → deny, and the reason contains `own working directory`.
  - `own-cwd (#3682): a mis-cased cwd inside the target is denied` — cwd `/VOL/repo/wt`, target `/Vol/Repo/wt` → deny.
  - `own-cwd: the correctly-cased self-removal is denied (control)` — cwd and target `/Vol/Repo/wt` → deny.
  - `own-cwd: a prefix sibling is not contained` — cwd `/Vol/Repo/wt`, target `/vol/repo/WT2` → allow.
  - `own-cwd: a missing target is allowed` — cwd `/Vol/Repo/wt`, target `/vol/repo/gone` → allow.

E1 (`runInner` tail). Command `git commit -m x`, `session_id: 's1'`, `runDir` = a real `fs.mkdtempSync(path.join(os.tmpdir(), 'ptu-identity-'))` (appendEvent writes there), `runState: { status: 'active', worktree: <recorded>, sessionId: 's1' }`, and `deps = { fsImpl, toplevel: () => <toplevel> }`:
  - `E1 (#3682): a mis-cased recorded worktree matches the commit's own toplevel` — recorded `/vol/repo/WT`, cwd and toplevel `/Vol/Repo/wt` → allow (no `deny`).
  - `E1 (#3682): a mis-cased toplevel matches the correctly-cased recorded worktree` — recorded `/Vol/Repo/wt`, cwd and toplevel `/VOL/Repo/Wt` → allow.
  - `E1: a commit outside the assigned worktree is still denied` — recorded `/vol/repo/WT`, cwd and toplevel `/Vol/Repo/other` → deny.

If any earlier gate in `runInner` short-circuits these fake-only paths before E1 is reached, so that the control test cannot produce `deny`, use a real realpath'd `fs.mkdtempSync` directory as `/Vol/Repo/other` instead. Key the fake's entries on that real path, and record the substitution in a comment. Never weaken the control's `deny` assertion.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/path-guard/pre-tool-use-identity.test.js`
Expected: FAIL. The two `own-cwd (#3682)` mis-cased tests and the two `E1 (#3682)` tests fail, because the JS form echoes casing (or `deps.fsImpl` is ignored). The three controls pass.

- [ ] **Step 3: Implement in `plugin/bin/lib/hooks/pre-tool-use.js`**

1. Delete `safeReal`.
2. Replace each audited call with `canonicalRealpath(x, { fsImpl })`, where `fsImpl` comes from the function's `deps`.
3. `runInner` forwards `deps` to `checkTeardownGate` and `checkDispatchConfigGate`. Inside E1, `const topOf = (deps && deps.toplevel) || toplevel;` replaces `toplevel(target.dir)`, and `checkDispatchConfigGate` does the same.
4. Extend the `run()` header comment's `deps` paragraph so it names `fsImpl` and `toplevel` alongside `resolveIntegrationModel`.
5. Above the import of `canonicalRealpath`, add a one-line comment: every path-identity comparison in this file resolves both operands through it (#3682).

- [ ] **Step 4: Update the conformance ALLOWLIST** at `tests/path-guard-conformance.test.js:123`

The `lib/hooks/pre-tool-use.js` entry becomes `{ existsSync: 1, reason: '...' }`, with no `realpathSync` key. The reason says the remaining `existsSync` only asks whether the run dir already has a `config.yml`, with any occupant counting as present. It also says every realpath in this file goes through path-guard's `.native` `canonicalRealpath` / `resolveLeaf` (#3495, #3682). Drop the stale line numbers from the reason.

- [ ] **Step 5: Run the targeted suites**

Run: `node --test tests/bin-lib/path-guard/pre-tool-use-identity.test.js tests/path-guard-conformance.test.js tests/bin-lib/path-guard/callers-characterization.test.js tests/teardown-gate.test.js tests/hooks-pre-tool-use.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/hooks-dispatcher.test.js tests/hooks-gate-coverage.test.js tests/hooks-pipeline-shadow-guard.test.js tests/hooks-policy-exemption.test.js tests/hooks-bash-prefilter.test.js`
Expected: every file passes (`ℹ fail 0`).

- [ ] **Step 6: Prove discrimination by reverting**

Temporarily change one migrated call (e.g. `cwdReal`) back to `fs.realpathSync`, re-run the new test file, confirm the matching `#3682` test goes red, then restore it. Do the same for one E1 call (`assigned`). Quote both red outputs in the report.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js tests/bin-lib/path-guard/pre-tool-use-identity.test.js tests/path-guard-conformance.test.js
git commit -m "Move pre-tool-use identity comparisons to canonicalRealpath — own-cwd and E1 now case-canonical, refs #3682"
```

The commit body carries the per-site audit table's verdict column in one line per row.

### Task 2: Retire the "safeReal stays JS-form" prose

**Files:**
- Modify: `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md:43`
- Modify: `plugin/bin/lib/hooks/worktree-detect.js:11-12` (comment)
- Modify: `tests/hooks-worktree-detect.test.js:76` (test title)

**Interfaces:**
- Consumes: Task 1's outcome — `pre-tool-use.js` has no `safeReal` and no `realpathSync` token.
- Produces: none.

- [ ] **Step 1: Edit the skill row (SKILL.md:43).** Replace the clause "`safeReal` remains JS-form for the E1/worktree-identity comparisons and the teardown gate's own-cwd containment (pre-existing, outside #3495), so a new exemption … rather than copying `safeReal`". The new wording says #3682 moved those comparisons to `canonicalRealpath()` too, so every comparison in `pre-tool-use.js` resolves through path-guard. It adds that a new exemption does the same: resolve both sides through `canonicalRealpath()` / `resolveLeaf()`, never the JS `fs.realpathSync` or `worktree-detect`'s JS-form `safeReal`. Keep the rest of the row (the conformance-test note and the "enumerate every other operand" lesson) verbatim.

- [ ] **Step 2: Edit the `worktree-detect.js` comment (lines 11–12).** Drop "matching pre-tool-use.js's own identically-named/-purposed safeReal()". The returns-null rationale stays. Change no code.

- [ ] **Step 3: Rename the test at `tests/hooks-worktree-detect.test.js:76`** to `'safeReal: returns null (not the raw, unresolved path) when realpathSync fails'`. The body is unchanged.

- [ ] **Step 4: Verify**

Run: `git grep -n "safeReal" -- plugin/bin/lib/hooks/pre-tool-use.js .claude/skills/pre-tool-use-gate-exemptions/SKILL.md` — Expected: no line asserts that pre-tool-use still uses `safeReal`. The SKILL.md mention of `worktree-detect`'s helper is the only hit.
Run: `node --test tests/hooks-worktree-detect.test.js tests/path-guard-conformance.test.js tests/path-containment-conformance.test.js` — Expected: `ℹ fail 0` (the last reads a different bullet of the same SKILL.md; plan-authoring pin grep found no test pinning row 43's text).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/pre-tool-use-gate-exemptions/SKILL.md plugin/bin/lib/hooks/worktree-detect.js tests/hooks-worktree-detect.test.js
git commit -m "Retire the safeReal-stays-JS-form prose — pre-tool-use is fully case-canonical, refs #3682"
```
