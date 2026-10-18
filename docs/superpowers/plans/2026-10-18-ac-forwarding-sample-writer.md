# AC-Forwarding Sample Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/build`'s standing AC-forwarding verification (#496) write, read back, and delete `$PIPELINE_RUN_DIR/sdd-dispatch-sample.txt` from a worktree-isolated session without a harness refusal (record #3044).

**Architecture:** Add a fifth member to the sanctioned run-dir writer family (`log-decision.js`, `stage-item.js`, `set-config.js`, `set-verify-expectations.js`): `plugin/bin/write-run-artifact.js`, a thin `run(argv, deps)` CLI over `plugin/bin/lib/run-artifact/write.js`. The writer accepts only allowlisted artifact names (today just `sdd-dispatch-sample.txt`) and anchors `--run` with `plugin/bin/lib/stage-item/write.js`'s exported `resolveTarget`. Then `plugin/skills/build/dispatch.md` routes the copy step and the delete step through it.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T221758-record-3044/work/3044-spec.md`

## Global Constraints

- Sanctioned-writer exit codes (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`): 0 = done (echo the run-dir-realpath file path to stdout), 2 = malformed invocation, 3 = run dir missing, run dir not anchored under the main checkout, or the target is unwritable. Never exit 1. The `require.main === module` guard sets `process.exitCode`; it never calls `process.exit` (pinned by `tests/bin-lib/exit-code-conformance.test.js`).
- Anchoring: import `resolveTarget` from `plugin/bin/lib/stage-item/write.js`; never re-derive the predicate. Use the stage-item refusal messages: `run dir does not exist: …` and `run dir is not anchored under the main checkout (a worktree-local shadow): …`.
- Commit messages: `{Verb} {what} — {detail}`, body `refs #3044` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_01GpTFbqYexJcCNgUWjAsMZu`.
- Skill prose references in actionable text use `${CLAUDE_PLUGIN_ROOT}/bin/...` paths, as do the sibling writer call sites.
- Out of scope: #3386's `$PIPELINE_RUN_DIR/sdd-final-review.md` write in the same `dispatch.md` paragraph. It has the same defect class but is not this record's scope; the controller files it as a follow-up. Do not add it to the allowlist.

## Review Focus

1. A worktree-local shadow `--run` (the IL-127 shape) → exit 3, and the shadow's existing file stays byte-unchanged. Covered in Task 2.
2. An `--name` that is not allowlisted, including `decisions.md`, `config.yml`, `../sdd-dispatch-sample.txt`, and `staged/x` → exit 2 naming the allowlist, with nothing written. Covered in Tasks 1 and 2.
3. Prompt text with backticks, `$VAR`, quotes, a NUL-free multi-line body, and non-ASCII (`—`) → byte-identical round trip. Covered in Task 1.
4. `--delete` when the sample is already absent → exit 0, idempotent, so re-running the Present branch after a crash does not fail. Covered in Tasks 1 and 2.
5. Overwriting an existing sample → replaced in place, with no `*.tmp-*` file left in the run dir. Covered in Task 1.

---

### Task 1: run-artifact write module

**Files:**
- Create: `plugin/bin/lib/run-artifact/write.js`
- Test: `tests/bin-lib/run-artifact/write.test.js`

**Interfaces:**
- Produces:
  - `ARTIFACT_NAMES: readonly string[]` — `Object.freeze(['sdd-dispatch-sample.txt'])`
  - `isArtifactName(name: unknown) -> boolean` — exact membership in `ARTIFACT_NAMES`, so no traversal or sanitizing is needed
  - `writeArtifact({ runDir: string, name: string, content: string }) -> { file: string }` — throws `Error` when `name` is not allowlisted; writes `path.join(runDir, name)` via `require('../atomic-write').writeFileAtomic`
  - `deleteArtifact({ runDir: string, name: string }) -> { file: string, existed: boolean }` — throws on a non-allowlisted name; `fs.unlinkSync`, with `ENOENT` mapping to `existed: false`; any other error is rethrown

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/run-artifact/write.test.js` (tmp dir via `fs.mkdtempSync(path.join(os.tmpdir(), 'runart-'))`):
  - `isArtifactName accepts only the allowlist`: true for `'sdd-dispatch-sample.txt'`; false for `'decisions.md'`, `'config.yml'`, `'../sdd-dispatch-sample.txt'`, `'staged/sdd-dispatch-sample.txt'`, `''`, `undefined`.
  - `writeArtifact round-trips content byte-identically`: content `` 'line `one` $HOME "q" \'s\'\n— two\n' `` → `fs.readFileSync(file, 'utf8')` strictly equals it; `file === path.join(runDir, 'sdd-dispatch-sample.txt')`.
  - `writeArtifact overwrites in place and leaves no tmp file`: write `'a'`, then `'b'` → content `'b'`; `fs.readdirSync(runDir)` deep-equals `['sdd-dispatch-sample.txt']`.
  - `writeArtifact refuses a non-allowlisted name`: `assert.throws(() => writeArtifact({ runDir, name: 'decisions.md', content: 'x' }))`, and `decisions.md` does not exist afterward.
  - `deleteArtifact removes and is idempotent`: after a write → `{ existed: true }` and the file is gone; a second call → `{ existed: false }` with no throw.
  - `deleteArtifact refuses a non-allowlisted name`: throws.

- [ ] **Step 2: Run to verify it fails**
Run: `node --test tests/bin-lib/run-artifact/write.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/run-artifact/write'`

- [ ] **Step 3: Implement `plugin/bin/lib/run-artifact/write.js`** with the Interfaces above. Its header comment states three things: why this module exists (#3044 — the harness's tool-level pinning refuses Edit/Write to the run dir from a worktree session); that it is create/overwrite-only with a single writer per run, so it uses tmp+rename atomicity and no `withLock` (cli-wrapper-contract's "create-only writer" rule); and that the allowlist is the fail-closed gate a new artifact must be added to.

- [ ] **Step 4: Run to verify it passes**
Run: `node --test tests/bin-lib/run-artifact/write.test.js`
Expected: PASS, all 6 tests

- [ ] **Step 5: Commit**
```bash
git add plugin/bin/lib/run-artifact/write.js tests/bin-lib/run-artifact/write.test.js
git commit -m "Add run-artifact write module — allowlisted run-dir artifact writer for worktree sessions (refs #3044)"
```

### Task 2: write-run-artifact CLI and its registration

**Files:**
- Create: `plugin/bin/write-run-artifact.js`
- Test: `tests/bin-lib/run-artifact/cli.test.js`
- Modify: `plugin/skills/_shared/pipeline-run-dir.md` — the "hook-level exemption above is necessary but not sufficient" paragraph (~line 93-105), and the `- **Sanctioned-write CLIs**` bullet (~line 232)
- Modify: `docs/plugin-structure.md` — a lib line after the `plugin/bin/lib/verify-expectations/` line (~40), a CLI line after the `set-verify-expectations.js` line (~170), and `tests/bin-lib/run-artifact/*.test.js` appended to the unit-suite command (~160) with a `+ run-artifact` label
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (the *Sanctioned-writer* list on line 11, and shape (3) in the boundary-guard bullet on line 33, which lists stage-item `resolveTarget` importers) and `.claude/skills/gh-api-module-pattern/SKILL.md` (the frontmatter `description` writer list)

**Interfaces:**
- Consumes: Task 1's `isArtifactName`, `ARTIFACT_NAMES`, `writeArtifact`, `deleteArtifact`; `resolveTarget({ runDir, cwd, mainRoot })` from `plugin/bin/lib/stage-item/write.js`
- Produces: the CLI `node plugin/bin/write-run-artifact.js --run <run-dir> --name <artifact> (--file <src> | --delete) [--help]`; `module.exports = { run, parseArgs }`, with `run(argv, deps) -> 0|2|3` and `deps = { cwd, readFile, mainRoot, stdout, stderr }` (same shape as `stage-item.js`'s `realDeps`)

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/run-artifact/cli.test.js`. Copy `fixture()` and `fakeDeps()` from `tests/bin-lib/verify-expectations/cli.test.js` (a fake main checkout with a `.git` dir, a run dir under `.claude-tweaks/pipelines/`, and a linked worktree with a `.git` file carrying a shadow run dir). Use `cwd = worktree` for the worktree-session cases. Tests:
  - `AC1.1 a worktree-isolated session writes the sample into the anchored main-checkout run dir`: `--run <singleDir> --name sdd-dispatch-sample.txt --file <src>` → 0; the file content equals the source; stdout includes `path.join(fs.realpathSync(singleDir), 'sdd-dispatch-sample.txt')`; the shadow has no such file.
  - `a worktree-local shadow run dir is refused (exit 3) and its existing sample is byte-unchanged`: pre-write `'sentinel'` into the shadow → 3; stderr matches `/not anchored under the main checkout/`; the shadow still reads `'sentinel'`.
  - `a missing run dir exits 3`: stderr matches `/run dir does not exist/`.
  - `a non-allowlisted --name exits 2 and writes nothing`: one sub-case each for `decisions.md` and `../sdd-dispatch-sample.txt` → 2; stderr includes `sdd-dispatch-sample.txt` (the allowlist is named); no new file in the run dir.
  - `--file and --delete are mutually exclusive, and one is required`: both → 2; neither → 2.
  - `an unreadable --file exits 2`.
  - `AC2.2 --delete removes the sample and is idempotent`: after a write, `--delete` → 0 and the file is gone; again → 0.
  - `missing --run or --name exits 2`; `--help exits 0 and prints usage`; `an unknown argument exits 2`.
  - `the real binary runs end to end`: `execFileSync(process.execPath, [CLI, '--run', singleDir, '--name', 'sdd-dispatch-sample.txt', '--file', src], { cwd: main })` succeeds and the file exists. This proves the `require.main` guard is wired.

- [ ] **Step 2: Run to verify it fails**
Run: `node --test tests/bin-lib/run-artifact/cli.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/write-run-artifact'`

- [ ] **Step 3: Implement `plugin/bin/write-run-artifact.js`** on `stage-item.js`'s skeleton: a header comment with usage and the exit codes, `USAGE`, `parseArgs`, `realDeps`, `run`, `module.exports`, and the `require.main` guard. Validation order:
  1. Parse error → 2.
  2. `--help` → 0.
  3. Missing `--run`/`--name` → 2.
  4. `!isArtifactName(name)` → 2 with `--name must be one of: ${ARTIFACT_NAMES.join(', ')}`.
  5. `--file` and `--delete` both or neither → 2.
  6. Read `--file` as utf8 → 2 on failure.
  7. `resolveTarget` → 3 with the stage-item messages.
  8. Write or delete → 3 on throw.

  On success stdout is the file path. For `--delete`, print the path, plus ` (already absent)` when `existed === false`.

- [ ] **Step 4: Run to verify it passes**
Run: `node --test tests/bin-lib/run-artifact/cli.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Register the fifth writer in docs.**
  - `pipeline-run-dir.md` paragraph: add `` `bin/write-run-artifact.js` `` for an allowlisted top-level run-dir artifact (`--run <run-dir> --name <artifact> --file <src>`, or `--delete`, refs #3044), and change "none of the four" to "none of the five".
  - `pipeline-run-dir.md` Sanctioned-write CLIs bullet: add `` `bin/write-run-artifact.js` (`--run`, refs #3044) `` to the list, and change "as the third and fourth did" to "as the third, fourth and fifth did".
  - `docs/plugin-structure.md` lib line: `plugin/bin/lib/run-artifact/      → write.js — allowlisted top-level run-dir artifact writer (ARTIFACT_NAMES = sdd-dispatch-sample.txt; writeArtifact via atomic-write.js, deleteArtifact idempotent) — the fifth of the sanctioned-write family, reusing stage-item/write.js's anchored resolveTarget. Consumed by plugin/bin/write-run-artifact.js`
  - `docs/plugin-structure.md` CLI line: the usage, plus `# Write-run-artifact CLI (#3044) — write or delete an allowlisted run-dir artifact from a worktree-isolated session; exit 0 wrote/deleted (prints the path), 2 malformed invocation or non-allowlisted --name, 3 run dir missing or not anchored under the main checkout, or the file unwritable`
  - `.claude/skills/gh-api-module-pattern/*`: append `plugin/bin/write-run-artifact.js` (`write-run-artifact.js` in the SKILL.md description) to each family enumeration named in Files, together with its artifact (allowlisted top-level run-dir artifacts) wherever the sibling list pairs writer with file.

- [ ] **Step 6: Verify the doc pins still hold**
Run: `node --test tests/pipeline-run-dir-cli-boundary-pin.test.js tests/verify-expectations-writer-conformance.test.js tests/auto-decision-log-worktree-gate.test.js tests/claude-md-budget.test.js`
Expected: PASS

- [ ] **Step 7: Commit**
```bash
git add plugin/bin/write-run-artifact.js tests/bin-lib/run-artifact/cli.test.js plugin/skills/_shared/pipeline-run-dir.md docs/plugin-structure.md .claude/skills/gh-api-module-pattern/SKILL.md .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md
git commit -m "Add write-run-artifact.js — fifth sanctioned run-dir writer, reachable from a worktree session (refs #3044)"
```

### Task 3: Route dispatch.md's AC-forwarding sample through the writer

**Files:**
- Modify: `plugin/skills/build/dispatch.md:14-17` — the "Standing AC-forwarding verification (#496)" sentences and the **Present:** bullet only; leave the #3386 `sdd-final-review.md` sentences untouched
- Test: `tests/build-ac-forwarding-verification.test.js`

**Interfaces:**
- Consumes: Task 2's CLI shape, verbatim: `node "${CLAUDE_PLUGIN_ROOT}/bin/write-run-artifact.js" --run "$PIPELINE_RUN_DIR" --name sdd-dispatch-sample.txt --file "$SDD_SAMPLE"` and `… --name sdd-dispatch-sample.txt --delete`

- [ ] **Step 1: Update the tests first** in `tests/build-ac-forwarding-verification.test.js`:
  - In the first test, replace the line-22 regex with assertions that the section contains:
    - the session-scratch resolve `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" SDD_SAMPLE=sdd-dispatch-sample-{run-id}.txt`;
    - the write call above, verbatim (use `section.includes(...)`);
    - the phrase `never an Edit/Write straight to the run directory`.
  - Keep the `survives past SDD's own Finish step` and `Skip this entirely for a single-task plan` asserts.
  - In the third test, assert the **Present:** bullet contains the `--delete` call verbatim.
  - Add `AC1.1/AC2.1 the dispatch.md sample commands run from a worktree cwd and round-trip the sample`. Build a main-checkout/worktree fixture as in Task 2. Extract both commands from the live section with ``/`(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/write-run-artifact\.js"[^`]*)`/g``, and assert exactly 2 matches (one ending `--file "$SDD_SAMPLE"`, one ending `--delete`). Substitute `${CLAUDE_PLUGIN_ROOT}` → `path.join(ROOT, 'plugin')`, then run each via `execFileSync('/bin/sh', ['-c', cmd], { cwd: worktree, env: { ...process.env, PIPELINE_RUN_DIR: runDir, SDD_SAMPLE: src } })`. After the write, assert `runDir/sdd-dispatch-sample.txt` equals the source and that it contains the forwarded AC excerpt fixture string. After the delete, assert it is gone.

- [ ] **Step 2: Run to verify it fails**
Run: `node --test tests/build-ac-forwarding-verification.test.js`
Expected: FAIL — the new assertions find no `write-run-artifact.js` in the section (0 matches, expected 2)

- [ ] **Step 3: Edit `dispatch.md`.**
  - Replace "it must copy the composed reviewer prompt verbatim to `$PIPELINE_RUN_DIR/sdd-dispatch-sample.txt` before sending it" with an instruction to resolve a session-scoped scratch path (`eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" SDD_SAMPLE=sdd-dispatch-sample-{run-id}.txt)"`), write the composed reviewer prompt there verbatim with the Write tool, and persist it with the Task 2 write call before sending it — never an Edit/Write straight to the run directory, which a worktree-isolated session's harness refuses (`_shared/pipeline-run-dir.md`'s tool-level pinning note).
  - Keep the "a location under the pipeline run directory, not the SDD scratch directory, so it survives past SDD's own Finish step …" clause.
  - In the "When SDD returns" sentence, say the read targets the same `$PIPELINE_RUN_DIR/sdd-dispatch-sample.txt` path the writer echoed. A Read of the run directory is not refused; only writes are. Evidence: this run's controller read `$PIPELINE_RUN_DIR/context/worktree-setup.md` with the Read tool from the worktree session.
  - In **Present:**, replace "delete the sample file" with "delete the sample file with `node "${CLAUDE_PLUGIN_ROOT}/bin/write-run-artifact.js" --run "$PIPELINE_RUN_DIR" --name sdd-dispatch-sample.txt --delete`".

- [ ] **Step 4: Run to verify it passes**
Run: `node --test tests/build-ac-forwarding-verification.test.js tests/build-sdd-final-review-capture.test.js tests/build-dispatch-status-token-and-tree-immutability.test.js tests/build-dispatch-subfile-table-completeness.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add plugin/skills/build/dispatch.md tests/build-ac-forwarding-verification.test.js
git commit -m "Route build's AC-forwarding sample through write-run-artifact.js — no harness refusal from a worktree session (refs #3044)"
```
