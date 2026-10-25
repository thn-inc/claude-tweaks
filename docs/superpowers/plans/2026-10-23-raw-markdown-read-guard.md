# Raw Markdown Read Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a new raw `fs.readFileSync` of a tracked markdown file in `tests/**/*.test.js` fail on Linux CI, and route every existing such read through `tests/helpers/read-skill.js`'s `readText`.

**Architecture:** One `node --test` conformance scan (`tests/raw-markdown-read-conformance.test.js`) reads each test file through the shared comment stripper, resolves which identifiers name a repo-rooted path (taint seeded by `__dirname`/`__filename`/`process.cwd()`, propagated through `const`/`let`/`for…of`/assignment bindings, stopped at content-producing calls), and flags every text-mode `readFileSync`/`promises.readFile` whose first argument is repo-rooted and is not provably a non-markdown file. A codemod (scratch, not committed) rewrites the flagged sites to `readText(...)`; anything that must stay raw goes on a per-file allowlist with a reason.

**Tech Stack:** Node 18+ `node:test`, `tests/helpers/strip-comments.js` (`stripComments`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES`), `tests/helpers/read-skill.js` (`readText`).

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-23T222244-record-3922/work/3922-spec.md`

## Global Constraints

- Scan scope: `tests/**/*.test.js` (spec Deliverable 1). Walk with a manual `withFileTypes` recursion and assert a floor on files walked — never `readdirSync({ recursive: true })` (bin-source-scan-conformance anti-pattern).
- Follow the `bin-source-scan-conformance` conventions: shared stripper only, `stripperVerdict` `misparsed`/`unparseable` reported as an offender, a floor on matched sites, matcher self-tests asserting exact flagged line numbers, negative cases, and a go-red proof.
- Allowlist entries carry a reason; "no unexplained allowlist entries" (spec AC 2).
- Migration is mechanical: `X.readFileSync(arg, 'utf8')` → `readText(arg)`; an immediately following `.replace(/\r\n/g, '\n')` becomes redundant and is dropped. No other edits to the touched tests.
- `npm test` green on the LF checkout (spec AC 2), and no test failure attributable to a raw markdown read on a CRLF checkout (spec AC 3, approximated pre-merge by a `core.autocrlf=true` checkout run).

## Review Focus

1. A read whose path variable is bound in one function to a temp dir and in another to the repo root (file-wide name reuse) — the scan resolves the nearest preceding binding, so a temp-dir read is not flagged. Self-test: two `dir` bindings, only the repo-rooted read flagged.
2. A file-content variable that flows into a later path (`const log = fs.readFileSync(fixture)` then `helper({ log })`) — taint must stop at content calls, or every temp-dir read downstream is flagged. Self-test pins it.
3. A list built from a walk of markdown plus one `.json` path (`[...findAllMdFiles(DIR), 'hooks.json']`) — a call result never proves non-markdown. Self-test pins it as flagged.
4. A test that compares a tracked file's raw bytes with production output reading the same file raw — `readText` on one side would break it on Windows only. Caught by the CRLF-checkout before/after comparison in Task 3; such a site is allowlisted with that reason.
5. A `readText` local name that already exists in a file (a private helper) — the codemod must not shadow or double-declare it. Handled in Task 2's codemod checks.

---

### Task 1: The conformance scan

**Files:**
- Create: `tests/raw-markdown-read-conformance.test.js`

**Interfaces:**
- Produces: `scanRawMarkdownReads(raw: string) -> { verdict: 'ok'|'misparsed'|'unparseable', sites: Array<{ line: number, kind: 'md'|'ambiguous'|'non-md', via: 'raw'|'readText' }> }` — module-local (the file exports nothing, like the sibling scans). `kind !== 'non-md' && via === 'raw'` is an offender.
- Produces: `ALLOWLIST: { [relPath: string]: { count: number, reason: string } }` — Task 2 fills it.

- [ ] **Step 1: Write the matcher self-tests (AC1.1)**

Planted-source tests, each asserting exact flagged line numbers:
- `go-red: a raw read of a repo markdown file is flagged` — `fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'x', 'SKILL.md'), 'utf8')` → one `md` offender at its line; the same line rewritten to `readText(...)` → zero offenders and one `via: 'readText'` site.
- `the #3890 helper shape is flagged` — `const ROOT = path.join(__dirname, '..'); const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');` → `ambiguous` offender.
- `a variable-mediated path is flagged` — `const SKILL = path.join(ROOT, 'SKILL.md'); fs.readFileSync(SKILL, 'utf8')`.
- `for…of over a repo walk is flagged` and `a walk list mixing md and one .json path is flagged` (Review Focus 3).
- Negatives: temp-dir read (`fs.mkdtempSync(path.join(os.tmpdir(), …))`); Buffer read with no encoding; definite `.json`/`.js` path; `JSON.parse(fs.readFileSync(…))`; a read inside a `//` comment; a `'readFileSync('` inside a string; Review Focus 1 (nearest binding) and 2 (content call stops taint).
- `a planted stripper mis-parse is an offender` — a raw file whose stripped text no longer compiles reports `verdict: 'misparsed'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/raw-markdown-read-conformance.test.js`
Expected: FAIL — `scanRawMarkdownReads is not defined`.

- [ ] **Step 3: Implement `scanRawMarkdownReads` plus the live-corpus tests**

Live tests: (a) every `tests/**/*.test.js` has `verdict: 'ok'`; (b) raw offenders per file equal `ALLOWLIST[rel].count` (exact, so drift either way fails) and every entry names a reason; (c) floor — files walked `> 800`, repo-rooted reads seen (raw + `readText`) `>=` the count at landing (fewer means the taint stopped matching, not that the reads went away). Classification: `md` when the argument or its resolved binding chain holds a `.md`/`.gitignore` literal; `non-md` only when it holds another known extension literal and no call other than `path.join|resolve|dirname|normalize`/`require.resolve`, or the read is the direct argument of `JSON.parse`; else `ambiguous`.

- [ ] **Step 4: Run — self-tests pass, live test (b) fails listing the existing offenders**

Run: `node --test tests/raw-markdown-read-conformance.test.js`
Expected: self-tests PASS; live offender test FAILS naming ~240 files.

- [ ] **Step 5: Commit** (`Add raw markdown read conformance scan — refs #3922`)

### Task 2: Route the flagged reads through `readText`

**Files:**
- Modify: every file the Task 1 live test names (~240 under `tests/`)
- Modify: `tests/raw-markdown-read-conformance.test.js` (`ALLOWLIST`, floor value)

**Interfaces:**
- Consumes: Task 1's offender list.

- [ ] **Step 1: Run a scratch codemod over the offender sites** — rewrite the call to `readText(<first arg>)`, drop an immediately following `.replace(/\r\n/g, '\n')`, add `const { readText } = require('<relative>/helpers/read-skill');` (or merge `readText` into an existing destructured require of that module), and remove a `fs` require left with no remaining reference. Stop and hand-edit any file that already declares a `readText` name.
- [ ] **Step 2: Run the scan** — Expected: zero raw offenders outside `ALLOWLIST`; set the floor to the landed count.
- [ ] **Step 3: Run `npm test` (AC2.1)** — Expected: only the 4 pre-existing environment failures (shallow-clone ancestor checks, symlinked parent) that fail on the base checkout too.
- [ ] **Step 4: Commit** (`Route raw markdown test reads through readText — refs #3922`)

### Task 3: CRLF-checkout proof

**Files:**
- Modify: `tests/raw-markdown-read-conformance.test.js` (allowlist entries only, if any)

- [ ] **Step 1: Verify on a CRLF checkout (AC3.1 pre-merge proxy)** — Run the full suite in a `core.autocrlf=true` checkout of the base commit and of the branch head (child git configured the same way). Expected: every base-only failure that is a raw markdown read is gone at head; no test fails at head that passed at base.
- [ ] **Step 2:** A head-only failure from a raw-vs-normalized comparison → restore that site's raw read and allowlist it with the reason. A remaining raw-markdown failure → a scan recall gap: add the planted case to Task 1's self-tests, widen the matcher, re-run.
- [ ] **Step 3:** Remaining CRLF failures of other classes (shell scripts, git patches, byte fixtures) are out of this record's scope — file one follow-up record naming them.
- [ ] **Step 4: Commit** any allowlist/matcher change.

### Task 4: Point the maintainer skill at the guard

**Files:**
- Modify: `.claude/skills/windows-checkout-test-parity/SKILL.md` (one Project Conventions line)
- Modify: `tests/helpers/read-skill.js` (header comment: the scan now enforces the rule)

- [ ] **Step 1:** Add the one-line pointers; run `node --test tests/raw-markdown-read-conformance.test.js`; commit.
