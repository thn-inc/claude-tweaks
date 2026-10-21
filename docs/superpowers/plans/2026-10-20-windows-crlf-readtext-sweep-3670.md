# Windows CRLF readText sweep (#3670) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ten skill-prose test suites pass on a Windows (`core.autocrlf=true`) checkout by reading governed markdown through `readText()`, proving each extractor with a CRLF control, and fixing the second Windows layer in the suites that run what they extract.

**Architecture:** Test-side only. Each suite swaps its raw `fs.readFileSync(…, 'utf8')` read of governed markdown for `tests/helpers/read-skill.js`'s `readText()`, which normalizes EOL at the read, so every extraction regex stays as it is. Each extractor becomes a function of its text, so a new CRLF control test can feed it a CRLF round-trip of the LF text. The suites that execute an extracted snippet also get a forward-slash plugin root wherever the root is spliced into script text, and run bash explicitly.

**Tech Stack:** Node 18+ `node --test`, `node:assert`, `node:child_process`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T210939-record-3670/work/3670-spec.md`

**Scope keywords:** readFileSync

## Global Constraints

- No file under `plugin/` changes (AC5).
- No test removed, skipped, or weakened. Every existing assertion and extraction regex stays byte-identical, except where a regex is moved into a function that takes text (AC1).
- No `.gitattributes` `eol=lf` rule (spec Gotchas).
- Never build a CRLF case from a raw read: build it from the `readText()` value with `.replace(/\n/g, '\r\n')`, and assert `\r\n` is present and `\r\r\n` is absent (spec Deliverable 3, Gotchas).
- No win32 skip added to make anything green (spec Gotchas).
- Forward-slash plugin root: `require('../plugin/bin/lib/shared-primitives').toPosix(path.join(ROOT, 'plugin'))` (adjust the relative require depth per file). Use it only where the root is spliced into script text or interpolated by an unquoted heredoc into a JS literal. Native `fs` paths stay native.
- No literal `/bin/sh` spawn target. Run extracted bash with `execFileSync('bash', ['-c', script], …)`, or with `execSync(script, { shell: 'bash', … })`. `execSync`'s default win32 shell is `cmd.exe`.

**CRLF control shape** (one per extractor, modeled on #3562's `tests/pipeline-run-dir-adoption-anchoring.test.js` "CRLF control" test). This is the exact body each task adapts. `{DOC_PATH}` is the absolute path the suite reads. `{extract}` is the suite's extractor taking text and returning a comparable value, and it must throw or differ on unnormalized CRLF text:

```js
test('CRLF control (#3670): {suite} extracts the same result after a CRLF round-trip through readText()', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '{prefix}-crlf-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const lf = readText({DOC_PATH});
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.ok(crlf.includes('\r\n'), 'CRLF build must contain \\r\\n');
  assert.ok(!crlf.includes('\r\r\n'), 'CRLF build must not contain \\r\\r\\n');
  const file = path.join(tmp, path.basename({DOC_PATH}));
  fs.writeFileSync(file, crlf);
  assert.deepStrictEqual({extract}(readText(file)), {extract}(lf));
});
```

Go-red property (AC4): replacing that control's `readText(file)` with `fs.readFileSync(file, 'utf8')` must turn the control red. The extractor then sees `\r\n` and either throws its own "not found" assertion or returns a different value.

## Review Focus

1. A suite where the CRLF control passes but the module-level read still goes raw: the control only pins the extractor plus `readText()`. Reviewers check every governed-markdown read in each file now goes through `readText()` (grep `readFileSync` per file; the only allowed remaining hits are non-markdown reads such as JSON fixture outputs).
2. An extract-and-run suite that passes on POSIX but still hands win32 a backslash root inside a JS string literal. Check each splice site (`split('${CLAUDE_PLUGIN_ROOT}').join(…)`, env `CLAUDE_PLUGIN_ROOT` feeding an unquoted heredoc).
3. An extractor whose CRLF failure is silent rather than loud, so the control would compare `''` to `''` or `null` to `null`. Each control asserts the LF extraction is non-empty first, by way of the extractor's own `assert.ok`.
4. The `blast-radius-snippet` suite also runs its snippet. The record listed it as read-only, so the `execSync` `cmd.exe` default is a second layer (premise reversal logged).
5. The `tmp` dir cleanup on a failing control: `t.after` removes it on every outcome.

---

### Task 1: Read-only extract-and-compare suites (five files)

**Files:**
- Modify: `tests/bin-lib/issues/labels.test.js`
- Modify: `tests/capture-native-branch-guard-shapes.test.js`
- Modify: `tests/harness-health-runaway-section.test.js`
- Modify: `tests/init-port-isolation-conformance.test.js`
- Modify: `tests/plan-audit-check-e-prose.test.js`

**Interfaces:**
- Consumes: `readText(absPath)` from `tests/helpers/read-skill.js` (require path `../helpers/read-skill` from `tests/bin-lib/issues/`, `./helpers/read-skill` from `tests/`).
- Produces: nothing other tasks use.

Per file:

- `labels.test.js` — split `canonicalLabelsFromBootstrapDoc()` into the doc-path constant `BOOTSTRAP_DOC` and `extractCanonicalLabels(md)`, which holds the existing `match`, the `assert.ok`, and `JSON.parse`. `canonicalLabelsFromBootstrapDoc()` becomes `extractCanonicalLabels(readText(BOOTSTRAP_DOC))`. Add a CRLF control with `{extract}` = `extractCanonicalLabels`. Add `os` and `readText` requires.
- `capture-native-branch-guard-shapes.test.js` — module read becomes `readText(SKILL)`. Control `{extract}` = `(text) => bashFences(typeBranch(text))`. Add an `assert.ok(commands.length > 0)` inside the control on the LF side so `''` vs `''` cannot pass. Add `os` and `readText` requires.
- `harness-health-runaway-section.test.js` — `read` becomes `(rel) => readText(path.join(ROOT, rel))`. Control loops over `plugin/skills/harness-health/judge-procedure.md` and `plugin/skills/_shared/harness-health-analysis.md` with `{extract}` = `snippet`, one CRLF build per doc, all inside one test.
- `init-port-isolation-conformance.test.js` — `read` body becomes `readText(path.join(__dirname, '..', relPath))`. Move the AC7 regex into `extractAllocateLine(sub)`, which returns `match[0]` after its existing `assert.ok`, and have AC7 call it. Control `{extract}` = `extractAllocateLine` on `plugin/skills/init/bootstrap/step-06-5-port-isolation.md`.
- `plan-audit-check-e-prose.test.js` — `read` becomes `(rel) => readText(path.join(ROOT, rel))`. Move the `## Invocation` fence match plus its `assert.ok` into `invocationFence(md)`, which returns `fence[1]`. The flag-mirror test calls it. Control `{extract}` = `invocationFence` on `plugin/skills/build/plan-audit.md`. Add the `os` require.

- [ ] **Step 1: Add the five CRLF control tests** per the shape above, together with the extractor-to-function moves they need. They pass on LF already, because the control runs its own `readText()` round-trip. Their red signature is the go-red doctoring in Step 2.

- [ ] **Step 2: Verify each control discriminates (AC4) — doctor, run, restore in one command per file**

Run (once per file, from the worktree root): `node -e "const fs=require('fs');const f=process.argv[1];const o=fs.readFileSync(f,'utf8');try{fs.writeFileSync(f,o.replace('readText(file)',\"fs.readFileSync(file, 'utf8')\"));require('child_process').execFileSync(process.execPath,['--test',f],{stdio:'inherit'});console.log('UNEXPECTED PASS')}catch(e){console.log('RED as expected')}finally{fs.writeFileSync(f,o)}" tests/{file}`
Expected: `RED as expected` for each file, and `git diff --stat` shows no doctoring residue.

- [ ] **Step 3: Swap the module-level reads to `readText()`** as listed per file.

- [ ] **Step 4: Run the five suites**

Run: `node --test tests/bin-lib/issues/labels.test.js tests/capture-native-branch-guard-shapes.test.js tests/harness-health-runaway-section.test.js tests/init-port-isolation-conformance.test.js tests/plan-audit-check-e-prose.test.js`
Expected: `# fail 0`, with the pass count equal to the pre-change count plus 5 (AC1).

- [ ] **Step 5: Commit** — `git add` the five files by path, message `Route five read-only prose suites through readText() — CRLF controls, refs #3670`.

### Task 2: Extract-and-run suites (five files)

**Files:**
- Modify: `tests/blast-radius-snippet.test.js`
- Modify: `tests/tidy-release-note-repair-conformance.test.js`
- Modify: `tests/dispatch-firing-exclusion.test.js`
- Modify: `tests/multispec-not-run-callsite.test.js`
- Modify: `tests/verify-expectations-writer-conformance.test.js`

**Interfaces:**
- Consumes: `readText(absPath)` (`./helpers/read-skill`); `toPosix(p)` (`../plugin/bin/lib/shared-primitives`).
- Produces: nothing other tasks use.

Per file:

- `blast-radius-snippet.test.js` — `extractSnippet(doc = readText(DOC))` keeps its regex and assert. Its `execSync` call gains `shell: 'bash'`. The env `CLAUDE_PLUGIN_ROOT` stays native, because bash expands it into a quoted argv path, not a JS literal. Control `{extract}` = `extractSnippet`.
- `tidy-release-note-repair-conformance.test.js` — `read` becomes `(rel) => readText(path.join(ROOT, rel))`. Move the dispatcher-block extraction (the `start` indexOf, its assert, the fence regex, its assert) into `dispatcherScript(skill)`, which returns `m[1]`. The test splices `toPosix(path.join(ROOT, 'plugin'))`, because the snippet interpolates the root into `require('…')` inside `node -e "…"`. Control `{extract}` = `dispatcherScript` on `plugin/skills/tidy/SKILL.md`. Add the `os` require.
- `dispatch-firing-exclusion.test.js` — `NEXT_RANKING = readText(…)`. `extractSnippet(doc = NEXT_RANKING)`. Env `CLAUDE_PLUGIN_ROOT: toPosix(process.env.CLAUDE_PLUGIN_ROOT || path.join(ROOT, 'plugin'))`, because the unquoted `NODE_EVAL_EOF` heredoc puts it inside `require('${CLAUDE_PLUGIN_ROOT}/…')`. Control `{extract}` = `extractSnippet` on `plugin/skills/dispatch/next-ranking.md`. Add the `os` require.
- `multispec-not-run-callsite.test.js` — both governed reads (`FAILURE_HANDLING`, `consoleDoc`) go through `readText()`. `extractNotRunSnippet(doc = FAILURE_HANDLING)`. The script assignment uses `JSON.stringify(toPosix(path.join(ROOT, 'plugin')))`. Control `{extract}` = `extractNotRunSnippet` on `plugin/skills/flow/multispec-failure-handling.md`.
- `verify-expectations-writer-conformance.test.js` — `read` becomes `(...segments) => readText(path.join(ROOT, ...segments))`. The `readdirSync` loop body read becomes `readText(path.join(dir, name))`. Move the `Record the exemption (#2383)` extraction plus its assert into `oversightSnippet(doc)`, which returns `m[1].trim()`. The command splices `toPosix(PLUGIN)`. The spawn changes from `execFileSync('/bin/sh', ['-c', command], …)` to `execFileSync('bash', ['-c', command], …)` (spec Deliverable 2). Control `{extract}` = `oversightSnippet` on `plugin/skills/wrap-up/verification-brief.md`. The JSON fixture read at line 68 stays raw.

- [ ] **Step 1: Add the five CRLF control tests** with the extractor moves.
- [ ] **Step 2: Verify each control discriminates (AC4)** — same one-command doctor/run/restore as Task 1 Step 2, per file. Expected: `RED as expected` ×5, and no residue.
- [ ] **Step 3: Apply the `readText()` swaps and the second-layer fixes** listed per file.
- [ ] **Step 4: Run the five suites**

Run: `node --test tests/blast-radius-snippet.test.js tests/tidy-release-note-repair-conformance.test.js tests/dispatch-firing-exclusion.test.js tests/multispec-not-run-callsite.test.js tests/verify-expectations-writer-conformance.test.js`
Expected: `# fail 0`, with the pass count equal to the pre-change count plus 5 (AC1).

- [ ] **Step 5: Verify no literal `/bin/sh` spawn remains** — Run: `git grep -n "'/bin/sh'" -- tests/blast-radius-snippet.test.js tests/tidy-release-note-repair-conformance.test.js tests/dispatch-firing-exclusion.test.js tests/multispec-not-run-callsite.test.js tests/verify-expectations-writer-conformance.test.js`. Expected: no output.
- [ ] **Step 6: Commit** — `git add` the five files by path, message `Route five extract-and-run prose suites through readText() — CRLF controls, forward-slash root, bash spawn, refs #3670`.

### Task 3: CRLF checkout simulation (AC2) — orchestrator-run verification, no commit

- [ ] **Step 1: Build two scratch trees** under the session scratchpad, each with `tests/` and `plugin/` copied from the worktree. Tree A uses the ten test files at merge-base `7aa24bd26` (`git show 7aa24bd26:{path}`). Tree B uses the fixed files. In both trees, convert the governed docs each suite reads to `\r\n` (LF→CRLF on exactly the docs named in Tasks 1-2).
- [ ] **Step 2: Run** `node --test {ten files}` in each tree. Expected: Tree A has fails carrying the extractor messages; Tree B shows `# fail 0`. Quote both trees' `# pass` / `# fail` lines in the PR body.

### Task 4: Windows proof (AC3) — orchestrator-run, after push

- [ ] **Step 1:** `gh workflow run windows-regression.yml --ref worktree-record-3670`, then poll the run to completion in the foreground.
- [ ] **Step 2:** From the run log, quote each of the ten files' per-test `ok` lines, not the adjudication verdict alone, in the PR body. If the dispatch cannot run, say so explicitly. Investigate any further failure shape the log shows; never add a win32 skip.

### AC coverage

| AC clause | Covered by |
|---|---|
| AC1.1 — ten files pass `node --test` on macOS/Linux, nothing removed/skipped/weakened, plus a CRLF control each | Task 1 Step 4, Task 2 Step 4 |
| AC2.1 — CRLF scratch simulation fails pre-fix files with extractor messages and passes fixed files | Task 3 Step 2 |
| AC2.2 — quote both runs' `# pass` / `# fail` lines in the PR body | Task 3 Step 2 |
| AC3.1 — all ten files pass on `windows-latest` | Task 4 Step 2 |
| AC3.2 — dispatch `windows-regression.yml` on the branch and quote per-test `ok` lines | Task 4 Steps 1-2 |
| AC3.3 — say so explicitly if the dispatch cannot run | Task 4 Step 2 |
| AC4.1 — each CRLF control goes red when its `readText(` becomes a raw `fs.readFileSync` | Task 1 Step 2, Task 2 Step 2 |
| AC4.2 — each doctoring runs in the same command as its restore | Task 1 Step 2, Task 2 Step 2 |
| AC5.1 — no file under `plugin/` changes (diff stat of `plugin/` against origin/main is empty) | Task 2 Step 5 |
| AC6.1 — `npm test` passes | Common Step 5 final verification (`verify.js`) |
