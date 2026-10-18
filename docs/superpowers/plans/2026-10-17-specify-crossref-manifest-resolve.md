# specify crossReferenceKeyFiles manifest re-resolve (#3161) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `crossReferenceKeyFiles` bash fence in `/specify`'s decomposition-mode loop locate `$SPECIFY_DECOMP_MANIFEST` itself, so it does not crash when run as its own Bash call.

**Architecture:** Prepend the same `SPECIFY_DECOMP_MANIFEST=$(node -e "… sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-decomp-manifest.json') || …")` assignment the "Fresh manifest" and "Accumulate" fences already use (record-creation-subissues.md lines 18-21 / 174-177) to the cross-reference fence. The cross-reference `node -e` body is unchanged. A new extract-and-run conformance test runs each fence as a separate `bash -c` process (no shared shell state, the way the agent runs them) and proves the fix with a go-red control.

**Tech Stack:** Markdown skill prose, bash, Node `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T193955-record-3161/work/3161-spec.md` (materialized from GitHub issue #3161)

Scope keywords: SPECIFY_DECOMP_MANIFEST

## Global Constraints

- Resolve the manifest via `sessionTmpPath(...)`, per `plugin/skills/_shared/session-tmp-root.md`'s convention: the identical expression (including the `|| require('path').join(require('os').tmpdir(), 'specify-decomp-manifest.json')` fallback) the Accumulate fence uses.
- No change to the fence's cross-reference logic (the `node -e` body that calls `crossReferenceKeyFiles(units, grep)`): only how it locates the manifest file.
- Leave every other fence untouched, so the existing pins in `tests/specify-ceremony-tally-prose.test.js` and `tests/specify-decomposition-crossref-prose.test.js` (e.g. `crossReferenceKeyFiles(units, grep)`) stay green.

## Review Focus

- Fence run with no inherited shell state: must exit 0 and print a JSON array (the record's exact failure). Covered by Task 1's positive test.
- Go-red: the same positive assertion run against the fence with the re-resolution stripped must fail. Task 1's control.
- Fence run in a non-git cwd: `git grep` fails, and the fence's own try/catch returns `[]`. The scratch project in Task 1 is not a git repo, so the positive test exercises this path too.

---

### Task 1: Re-resolve the manifest in the crossReferenceKeyFiles fence, pinned by an extract-and-run test

**Files:**
- Modify: `plugin/skills/specify/record-creation-subissues.md:192-201` (the bash fence after `**Cross-reference forward/backward Key Files (record #490).**`)
- Test: `tests/specify-crossref-manifest-resolve.test.js` (new; neighbors `tests/specify-decomposition-crossref-prose.test.js` and `tests/specify-ceremony-tally-prose.test.js`)

**Interfaces:**
- Consumes: the live skill file's fences, extracted by bold label plus the next ` ```bash ` fence (the `fenceAfter(label)` shape from `tests/specify-ceremony-tally-prose.test.js`, copied into the new file rather than imported, since test files here do not export helpers). Labels: `**Fresh manifest for this invocation.**`, `**Accumulate this unit for the cross-reference pass below.**`, `**Cross-reference forward/backward Key Files (record #490).**`.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing test** `tests/specify-crossref-manifest-resolve.test.js`

  Setup, per test: scratch dir via `fs.mkdtempSync(path.join(os.tmpdir(), 'ct-crossref-manifest-'))` with `proj/` (cwd) and `tmp/` (passed as `TMPDIR` so `sessionTmpPath` lands inside the scratch dir), a body file, and env `{ ...process.env, CLAUDE_PLUGIN_ROOT: <repo>/plugin, CLAUDE_CODE_SESSION_ID: 'crossref-manifest-test-session', TMPDIR: tmp }`. Each fence runs via `spawnSync('bash', ['-c', fence], { cwd, env, encoding: 'utf8' })`, one process per fence, so no shell variable carries over. Clean up with `t.after(() => fs.rmSync(root, { recursive: true, force: true }))`.

  Factor the positive assertions into one function used by both tests (the Go-red control check):

  ```js
  function assertCrossrefFenceRunsStandalone(crossrefFence) {
    // init fence, then accumulate twice (SUB_ISSUE_TITLE/SUB_ISSUE_NUM/SPECIFY_SUB_ISSUE_BODY/SUB_ISSUE_CEREMONY env),
    // each in its own bash -c process, asserting status 0; then:
    const r = spawnSync('bash', ['-c', crossrefFence], { cwd, env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `cross-reference fence exited ${r.status}: ${r.stderr}`);
    assert.ok(Array.isArray(JSON.parse(r.stdout)), 'cross-reference fence must print a JSON array');
  }
  ```

  Tests:
  1. `'crossReferenceKeyFiles fence re-resolves $SPECIFY_DECOMP_MANIFEST via sessionTmpPath'`: the extracted fence text contains `SPECIFY_DECOMP_MANIFEST=$(` and `sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-decomp-manifest.json')`, and the assignment comes before `crossReferenceKeyFiles(units, grep)`. (AC option a.)
  2. `'crossReferenceKeyFiles fence runs as its own Bash call against a scratch manifest'`: `assertCrossrefFenceRunsStandalone(CROSSREF_FENCE)` passes. (AC option b.)
  3. `'go-red control: the fence without its own re-resolution fails the same assertion'`: build `stripped` by removing the `SPECIFY_DECOMP_MANIFEST=$(node -e "` … `")` assignment from `CROSSREF_FENCE` (regex `/^SPECIFY_DECOMP_MANIFEST=\$\(node -e "[\s\S]*?^"\)\n/m`), assert `stripped !== CROSSREF_FENCE` (the mutation actually applied), then `assert.throws(() => assertCrossrefFenceRunsStandalone(stripped))`. Run it with `SPECIFY_DECOMP_MANIFEST` deleted from the spawned env so the test machine's own environment cannot mask it.

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/specify-crossref-manifest-resolve.test.js`
  Expected: FAIL. Tests 1 and 2 fail against the current fence (no assignment; `readFileSync('')` throws ENOENT). Test 3 fails because the regex finds nothing to strip (`stripped === CROSSREF_FENCE`).

- [ ] **Step 3: Implement**: in `plugin/skills/specify/record-creation-subissues.md`'s cross-reference fence, insert as its first lines the four-line `SPECIFY_DECOMP_MANIFEST=$(node -e "` / `const { sessionTmpPath } = …` / `console.log(sessionTmpPath(…) || …)` / `")` block, byte-identical to lines 174-177 (the Accumulate fence). Leave the `node -e "const {crossReferenceKeyFiles}=…" "$SPECIFY_DECOMP_MANIFEST"` call as it is.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `node --test tests/specify-crossref-manifest-resolve.test.js tests/specify-decomposition-crossref-prose.test.js tests/specify-ceremony-tally-prose.test.js tests/session-tmp-root-migration.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/skills/specify/record-creation-subissues.md tests/specify-crossref-manifest-resolve.test.js
  git commit -m "Re-resolve the decomposition manifest in specify's crossReferenceKeyFiles fence — refs #3161"
  ```

---

## Self-review

- **Spec coverage:** Deliverable (re-resolve via `sessionTmpPath`, cross-reference logic unchanged) → Task 1 Step 3. AC (a) → test 1; AC (b) → test 2; go-red proof → test 3.
- **Placeholders:** none.
