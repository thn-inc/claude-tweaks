# PR-scan CI-filter tests: forward-slash spliced temp paths (#3699) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop two test suites from splicing native Windows temp paths into the JS single-quoted literals of `github-pr-scan.md`'s item-9 scripts, where `\a`, `\_`, `\t`, `\c` become escapes.

**Architecture:** Each suite routes its substitution through one helper that forward-slashes the spliced path with `toPosix(p, sep)`, mirroring production's `session-tmp-resolve.js` `formatPrintedPath`. The helper takes `sep` (default `path.sep`) so a Linux-runnable pin can feed a `path.win32` path with `path.win32.sep` — `toPosix` is a no-op when `sep` is `/`.

**Tech Stack:** Node 18+, `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124821-spec-3599-3602-3695-3696-3698-3699-3595/spec-3699/work/3699-spec.md`

## Global Constraints

- Forward-slash only where a path is spliced into script text; the tests' own `fs.writeFileSync`/`readFileSync` keep native paths.
- sweep-backstop keeps longer-name-first order: `$PR_SCAN_UNARMED` is a prefix of `$PR_SCAN_UNARMED_CANDIDATES`.
- `PLUGIN_ROOT` already reaches the script through the environment — no change.
- Do not claim `tests/sweep-backstop.test.js` goes fully green on Windows; only the post-merge `windows-regression` run can show that.

## Review Focus

- The item-9 scripts contain legitimate regex backslashes (the `HOUSEKEEPING_MARKER` pattern), so a pin asserting the whole script is backslash-free would fail for the wrong reason — pins inspect only the `require(` / `readFileSync(` / `writeFileSync(` string literals.
- A pin that finds zero literals would pass vacuously — each pin asserts at least one literal per substituted variable.

Waived plugin/bin/lib/shared-primitives.js: read only — `toPosix(p, sep = path.sep)` (line 217) is used as it is.
Waived plugin/bin/session-tmp-resolve.js: read only — `formatPrintedPath` is the production twin this substitution mirrors.

---

### Task 1: Forward-slash the spliced temp paths in both suites, with win32 pins (AC1.1, AC2.1, AC3.1)

**Files:**
- Modify: `tests/display-ci-readers-conformance.test.js:104` (the CI-filter substitution)
- Modify: `tests/sweep-backstop.test.js:101-103`, `:180-182` (both item-9 filter substitutions)

**Interfaces:**
- Produces (display-ci, module scope): `substituteCandidates(script, candidatesFile, sep = path.sep)` → `script.replace(/\$PR_SCAN_UNARMED_CANDIDATES/g, toPosix(candidatesFile, sep))`.
- Produces (sweep-backstop, module scope): `isolateItem9(script, { candidatesPath, inputPath }, sep = path.sep)` → `$PR_SCAN_UNARMED_CANDIDATES` first, then `$PR_SCAN_UNARMED`, each replaced by `toPosix(…, sep)`; both existing sites call it (keep the "Longer name first" comment on it).
- Shared literal extractor, local to each file: `spliceLiterals(script)` → every `'…'` argument matched by `/(?:require|readFileSync|writeFileSync)\(\s*'([^']*)'/g`.

- [ ] **Step 1: Failing tests** — append one test to each of `tests/display-ci-readers-conformance.test.js` and `tests/sweep-backstop.test.js`:
  - display-ci: `'#3699 AC1.1: the CI filter splices a win32 temp path with forward slashes'` — `win = path.win32.join('D:\\a\\_temp', 'ct-display-ci-x', 'candidates.json')`; `s = substituteCandidates(item9Scripts()[1], win, path.win32.sep)`; `lits = spliceLiterals(s)`; assert `lits.filter((l) => l === 'D:/a/_temp/ct-display-ci-x/candidates.json').length >= 2` (the `require` and the `writeFileSync`), and `lits.every((l) => !l.includes('\\'))`.
  - sweep-backstop: `'#3699 AC1.1: the item-9 filter splices win32 temp paths with forward slashes'` — `dir = path.win32.join('D:\\a\\_temp', 'ct-item9-x')`; `s = isolateItem9(extractNodeScripts(ITEM9)[0], { candidatesPath: path.win32.join(dir, 'pr-scan-unarmed-candidates.json'), inputPath: path.win32.join(dir, 'pr-scan-unarmed.json') }, path.win32.sep)`; assert `spliceLiterals(s)` includes `'D:/a/_temp/ct-item9-x/pr-scan-unarmed.json'` and `'D:/a/_temp/ct-item9-x/pr-scan-unarmed-candidates.json'`, every literal is backslash-free, and `s` contains no `$PR_SCAN_UNARMED`.
- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/display-ci-readers-conformance.test.js tests/sweep-backstop.test.js`
Expected: FAIL — the two new tests throw `ReferenceError` (`substituteCandidates` / `isolateItem9` / `spliceLiterals` not defined yet); every existing test still passes.

- [ ] **Step 3: Implement** — add `const { toPosix } = require('../plugin/bin/lib/shared-primitives');` and the helpers above to each file; replace line 104's inline `replace` with `substituteCandidates(scripts[1], candidatesFile)` and both sweep-backstop `split/join` chains with `isolateItem9(filterScript, { candidatesPath, inputPath })`. No assertion text changes.
- [ ] **Step 4: Run to verify they pass (AC3.1)**

Run: `node --test tests/display-ci-readers-conformance.test.js tests/sweep-backstop.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Verify the pins discriminate (AC2.1)** — after the commit, in a scratch `git worktree add <scratch> HEAD` (never edit-and-restore in the shared worktree): change each helper's `toPosix(x, sep)` to the raw `x`, run Step 4's command there. Expected: exactly the two `#3699 AC1.1` tests fail (a `\` found in a spliced literal); every other test passes. Remove the scratch worktree.
- [ ] **Step 6: Commit** — stage both test files by name:

```
Forward-slash the temp paths the PR-scan CI-filter tests splice — no win32 escapes in item-9 literals

refs #3699

Claude-Session: https://claude.ai/code/session_01YVBrdUJUP7EjvTUw6e89s9
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3 (display-ci helper, native paths kept for the test's own fs calls); Deliverable 2 → Step 3 (sweep-backstop helper at both sites); Deliverable 3 → Step 1 (one pin per suite). AC1 → Steps 1/4, AC2 → Step 5, AC3 → Step 4 plus the build's central `npm test`.
- **Placeholders:** none. **Type consistency:** helper names match between Interfaces, Step 1 and Step 3.
