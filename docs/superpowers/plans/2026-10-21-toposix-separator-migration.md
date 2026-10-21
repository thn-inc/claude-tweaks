# Shared toPosix Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every inline native-path-to-repo-display separator conversion in `plugin/bin` with `toPosix` from `plugin/bin/lib/shared-primitives.js`, and annotate each conversion deliberately kept.

**Architecture:** Pure refactor. `toPosix(p, sep = path.sep)` returns `p` unchanged when `sep === '/'` and `p.split(sep).join('/')` otherwise, so it is byte-identical to every `x.split(path.sep).join('/')` site on every host. A `.replace(/\\/g, '/')` site is only equivalent when its input is a native host path (from `path.join`/`path.relative`/`readdirSync`); on a POSIX host it also rewrites literal backslashes, so a site whose input can arrive from outside the host's path APIs (git/diff text, hand-written file lists, log text) is kept and annotated.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T121737-record-3317/work/3317-spec.md`

## Global Constraints

- No user-visible change (spec Release Note).
- `npm test` stays green.
- Final `grep -rnE "split\(path\.sep\)\.join\('/'\)|replace\(/\\\\\\\\/g, '/'\)" plugin/bin` returns only the kept sites listed under Task 3 (AC1.1). Absence-grep control: run at base `426664098` this exact command matched 23 lines across 16 files (including `pre-tool-use.js:111`), so it can go red.
- `npm test` green at HEAD (AC2.1) — proven by Common Step 5's verification run, not a per-task step.
- Never apply `toPosix` to a path later opened with fs (shared-primitives.js:213-216 comment).
- Import style: destructure from the relative `shared-primitives` path; when the file already imports from it, extend that existing destructure rather than adding a second `require`.

Waived AC1.1: verified by Task 3 Step 2's scratch grep with its output persisted as run-dir AC evidence, not a committed test (the record asks for a grep result, and adding a source-scan suite is beyond scope).
Waived AC2.1: verified by /build Common Step 5's full `npm test` run and /test's gate, not a per-task test.

## Review Focus

- A POSIX-host path containing a literal backslash: migrated `split(path.sep)` sites already left it alone, so behavior is unchanged; a migrated `.replace` site (Task 2) now keeps the backslash. Acceptable only because those inputs come from host path APIs — reviewer should confirm each Task 2 input really is native.
- An empty relative path (`path.relative(x, x) === ''`): `toPosix('')` returns `''`, same as before (qa-stamp maps `''` to `'.'` first — keep that ordering).
- `pre-tool-use.js` is loaded on every hook call: the replacement must not add a new module load cycle (shared-primitives is already required there).
- A kept site silently migrated would change POSIX behavior for backslash-bearing inputs — covered by the existing review-context/design-detect/baseline suites plus Task 3's annotations.
- A site missed by both regex forms (e.g. `replaceAll('\\', '/')`) is out of scope; report, do not migrate.

---

### Task 1: Migrate the `split(path.sep).join('/')` sites

**Files:**
- Modify: `plugin/bin/qa-stamp.js:106`
- Modify: `plugin/bin/docs-health.js:283`
- Modify: `plugin/bin/lib/flow/preflight.js:125`
- Modify: `plugin/bin/lib/harness-health/scope.js:295`
- Modify: `plugin/bin/lib/harness-health/issue-payload.js` (lines 45,178) (already imports `isPathContained` from `../shared-primitives`)
- Modify: `plugin/bin/lib/plan-audit/checks.js` (lines 428,477,511)
- Modify: `plugin/bin/lib/journey-health/scope.js:215`
- Modify: `plugin/bin/lib/docs-health/scope.js` (lines 57,129)
- Modify: `plugin/bin/lib/docs-health/findability.js:75`
- Modify: `plugin/bin/lib/code-health/candidates-test-hygiene.js` (lines 165,166) (already imports `escapeRegExp` from `../shared-primitives`)
- Test (existing, unchanged): `tests/bin-lib/{flow,harness-health,plan-audit,journey-health,docs-health,code-health}/`, `tests/qa-stamp*.test.js`, `tests/docs-health*.test.js`

**Interfaces:**
- Consumes: `toPosix(p: string, sep?: string): string` from `plugin/bin/lib/shared-primitives.js`
- Produces: nothing new

- [ ] **Step 1: Replace each `EXPR.split(path.sep).join('/')` with `toPosix(EXPR)`**, keeping any trailing chain (`.replace(/\.md$/, '')`) on the result. qa-stamp keeps `rel === '' ? '.' : rel` as the argument.
- [ ] **Step 2: Run the affected suites**

Run: `node --test tests/bin-lib/flow tests/bin-lib/harness-health tests/bin-lib/plan-audit tests/bin-lib/journey-health tests/bin-lib/docs-health tests/bin-lib/code-health`
Expected: exit 0, `ℹ fail 0`

- [ ] **Step 3: Confirm no split-form site remains**

Run: `grep -rn "split(path.sep).join('/')" plugin/bin`
Expected: only `plugin/bin/lib/hooks/pre-tool-use.js` (Task 2) — or nothing once Task 2 lands.

- [ ] **Step 4: Commit** — `Migrate split(path.sep) separator conversions to shared toPosix — refs #3317`

### Task 2: Migrate native-input `.replace` sites and retire `pre-tool-use.js`'s local `toPosix`

**Files:**
- Modify: `plugin/bin/lib/init/verify-scope-starter.js` (lines 96,219) — `relDir`/`rel` are built from `path.join` and `readdirSync` names (native).
- Modify: `plugin/bin/lib/verify/baseline.js:351` — input is `path.relative(root, headDir)` (native).
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:107-112` — delete the local `function toPosix(p)`; add `toPosix` to the existing `require('../shared-primitives')` destructure at line 38. Behavior is identical: the local body `p.split(path.sep).join('/')` equals the shared one for every input on every host (split/join on `/` is the identity). Keep the explanatory comment (git reports forward slashes) above the import or the first use.
- Test (existing): `tests/bin-lib/init/`, `tests/bin-lib/verify/`, `tests/hooks-pre-tool-use.test.js`

**Interfaces:**
- Consumes: `toPosix` as in Task 1
- Produces: nothing new

- [ ] **Step 1: Apply the three replacements and the `pre-tool-use.js` import swap**
- [ ] **Step 2: Run the affected suites**

Run: `node --test tests/bin-lib/init tests/bin-lib/verify tests/hooks-pre-tool-use.test.js`
Expected: exit 0, `ℹ fail 0`

- [ ] **Step 3: Commit** — `Migrate native-input separator conversions and pre-tool-use toPosix to the shared helper — refs #3317`

### Task 3: Annotate the deliberately kept sites

Kept (input is not guaranteed to be a native host path, so `toPosix` would change POSIX-host behavior):

| Site | Why kept |
|---|---|
| `plugin/bin/lib/review-context/build.js:83` (`isAlwaysStub`) | Documented to accept `/`- or `\`-separated paths on any host |
| `plugin/bin/lib/review-context/build.js:89` (`isMarkdown`) | Same contract |
| `plugin/bin/lib/verify/baseline.js:227` (`normalizeLog`) | Builds both spellings of a root to scrub from log text; must normalize either input spelling |
| `plugin/bin/lib/design-detect/index.js:165` (`fileMatchesFrontendPredicate`) | Classifies file paths from diff/record text of unknown origin, either separator |
| `plugin/bin/lib/design-detect/surface-lines.js:65` (`classifyFileKind`) | Same — path text, not a host path |
| `plugin/bin/lib/init/verify-scope-starter.js:96` (`walkForPackageDirs`) | Added at execution (ruling, decisions.md "Task 2 ruling"): `relDir` is built from user-written workspace-glob text, not a host path API |
| `plugin/bin/lib/init/verify-scope-starter.js:219` | Same — `rel` comes from `expandGlob` |

**Files:**
- Modify: the five sites above — add a one-line `//` comment directly above each (or extend the existing one) stating it is an any-host separator normalization, not a native-path conversion, so `toPosix` does not apply (#3317).

- [ ] **Step 1: Add the comments**
- [ ] **Step 2: Run the acceptance grep (AC1.1) and persist its evidence**

Run: `grep -rnE "split\(path\.sep\)\.join\('/'\)|replace\(/\\\\\\\\/g, '/'\)" plugin/bin`
Expected: exactly the five kept sites above.
Evidence (controller, not implementer): write the output to `/home/user/claude-tweaks/.claude-tweaks/pipelines/2026-10-21T121737-record-3317/evidence/ac1-grep.txt` via a plain Bash redirect, and log one `log-decision.js --section "/build" --status AUTO --step "AC evidence"` entry naming AC1.1, the command shape, the hit count, and that path.

- [ ] **Step 3: Run the affected suites**

Run: `node --test tests/bin-lib/review-context tests/bin-lib/design-detect tests/bin-lib/verify`
Expected: exit 0, `ℹ fail 0`

- [ ] **Step 4: Commit** — `Annotate any-host separator normalizations kept outside toPosix — refs #3317`
