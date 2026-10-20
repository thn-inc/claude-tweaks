# log-decision.js --text-file Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `bin/log-decision.js` read its entry text from a file (`--text-file <path>`) so git- or user-supplied text never passes through shell quoting, and migrate the two prose call sites that hand-escape such text.

**Architecture:** `parseArgs` gains `--text-file`; `run()` reads the file (utf8) and feeds its contents into the unchanged `formatEntry` path, so the entry is byte-identical to `--text "<contents>"`. The canonical "how to log git-supplied text" instruction is stated once in `_shared/auto-decision-log.md`'s Entry schema; the two call sites cite it instead of carrying an escape sentence.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T180000-record-3671/work/3671-spec.md`

Scope keywords: Escape any

## Global Constraints

- `--text` keeps working unchanged for every existing caller (same parsing, same output, same exit codes).
- Exit codes stay `0` appended / `2` malformed invocation / `3` run dir missing or not anchored — an unreadable or invalid `--text-file` is a malformed invocation (`2`).
- Release note: "No user-visible change."
- The run dir is anchored under the main checkout and refuses worktree-session `Write`s (`_shared/auto-decision-log.md`'s "Regardless of worktree state"), so the text file lives in the session temp root (`bin/session-tmp-resolve.js`, `_shared/session-tmp-root.md`), never in the run dir.

## Review Focus

1. A text file holding a trailing newline (what the Write tool usually produces) must yield the same entry as `--text` without it — `formatEntry` already trims; Task 1 pins it.
2. A text file with an interior line break (e.g. `git diff --name-only` output pasted as-is) would split one entry across lines and corrupt the log — reject with exit 2 and a message naming the one-line requirement (Task 1 test).
3. Passing both `--text` and `--text-file` is ambiguous — exit 2, nothing written (Task 1 test).
4. A missing/unreadable `--text-file` path exits 2 with the path named, nothing written (Task 1 test).
5. An empty (or whitespace-only) text file exits 2, nothing written (Task 1 test).

---

### Task 1: `--text-file` in `log-decision.js`, documented

**Files:**
- Modify: `plugin/bin/log-decision.js` (header comment lines 2-6, `USAGE`, `parseArgs`, `run`)
- Test: `tests/bin-lib/log-decision/cli.test.js`
- Modify: `docs/plugin-structure.md:172` (the `log-decision.js` CLI line)
- Modify: `plugin/skills/_shared/auto-decision-log.md` (Entry schema signature, line 69; one new paragraph right after the canonical-appender paragraph)

**Interfaces:**
- Produces: CLI flag `--text-file <path>`; `parseArgs` result gains `textFile: string|null`. Task 2's prose cites `_shared/auto-decision-log.md`'s new paragraph, whose bold lead-in is exactly `**Text from git or a user: \`--text-file\`.**`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/log-decision/cli.test.js` (reuse `fixture()`/`deps()`; write text files under the fixture's tmp root, outside the run dir). Covers AC1.1 (the equality test below) and AC3.1 (every pre-existing `--text` test in the file keeps passing unchanged):
  - `--text-file writes the same entry --text would, for each shell-hostile content`: for each of `'conflicted on "a b".md'`, `'conflicted on $(touch pwned) and $HOME'`, ``'conflicted on `rm -rf x`.md and back\\slash'`` — run `--status AUTO --text <c>` in one fixture and `--status AUTO --text-file <file holding c + '\n'>` in another; assert both exit 0, the two `decisions.md` contents are equal, and the content appears verbatim in the entry.
  - `--text and --text-file together exit 2 and write nothing` — stderr matches `/mutually exclusive/`.
  - `--text-file with an interior line break exits 2 and writes nothing` — content `'a.md\nb.md\n'` and `'a.md\r\nb.md'`; stderr matches `/one line/`.
  - `--text-file missing or empty exits 2 and writes nothing` — a nonexistent path (stderr names the path) and a file holding `'  \n'`.
  - Extend the existing `--help` assertion: usage output matches `/--text-file <path>/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/log-decision/cli.test.js`
Expected: FAIL — `unknown argument: --text-file` (exit 2) on the new tests; the pre-existing tests still pass.

- [ ] **Step 3: Implement in `plugin/bin/log-decision.js`**
  - `parseArgs`: `else if (a === '--text-file') o.textFile = next();` (initial `textFile: null`).
  - `run`, before the `--text is required` check: if both `o.text !== null` and `o.textFile !== null` → `usageError('--text and --text-file are mutually exclusive')`. If `o.textFile !== null`: read with `fs.readFileSync(o.textFile, 'utf8')` (catch → `usageError(\`could not read --text-file ${o.textFile}: ${err.message}\`)`), strip trailing whitespace, reject `/[\r\n]/` in what remains → `usageError('--text-file must hold one line of entry text (no interior line breaks)')`, then set `o.text` to the content. The existing `--text is required` check then covers the empty file; reword its message to `--text or --text-file is required`.
  - `USAGE` and the header comment: `--text "..."` becomes `--text "..." | --text-file <path>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/log-decision/cli.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Document the flag**
  - `docs/plugin-structure.md:172`: same `--text "..." | --text-file <path>` substitution in the command, and add to its comment: `--text-file reads the entry text from a file (one line), so git- or user-supplied text never passes through shell quoting`.
  - `plugin/skills/_shared/auto-decision-log.md` line 69 signature: `--text "<message>"` becomes `--text "<message>" | --text-file <path>`.
  - New paragraph after the canonical-appender paragraph (the one ending "…see the `STATUS` row below)."), bold lead-in `**Text from git or a user: \`--text-file\`.**`, stating: when the entry text interpolates anything git or a user supplied (a file name, an error message), never put it in a double-quoted `--text` — resolve a session temp path with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" DECISION_TEXT=decision-text-{run-id}.md` (it prints `DECISION_TEXT="{path}"`; `_shared/session-tmp-root.md`), write the one-line text there with the Write tool, and pass `--text-file "{path}"`; the entry is identical to `--text`'s. The file must hold one line; `--text`/`--text-file` are mutually exclusive. (Probe run once at authoring: the command printed `DECISION_TEXT="/var/folders/…/ct-session-…/decision-text-2026-10-20T180000-record-3671.md"`.)

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/log-decision.js tests/bin-lib/log-decision/cli.test.js docs/plugin-structure.md plugin/skills/_shared/auto-decision-log.md
git commit -m "Add --text-file to log-decision.js — entry text without shell quoting (refs #3671)"
```

### Task 2: Migrate the two call sites off hand-escaping

**Files:**
- Modify: `plugin/skills/flow/steps-and-gates.md:62` (the `#3014` CONFLICTING paragraph's abort-entry clause)
- Modify: `plugin/skills/wrap-up/execution-and-verification.md:84-87` (the leave-open "Log with …" sentence)
- Test: `tests/wrap-up-leave-open-mergeability-conformance.test.js:81-83`
- Test: `tests/flow-preflight-conformance.test.js:72-99`

**Interfaces:**
- Consumes: Task 1's `**Text from git or a user: \`--text-file\`.**` paragraph in `_shared/auto-decision-log.md`.

- [ ] **Step 1: Write the failing tests (update the pins)** — covers AC2.1 (no escape instruction: the `escape any` negative assertions) and AC2.2 (both name the file-based form: the `--text-file` assertions)
  - Wrap-up test: replace the `Escape any …` pin with `has('--text-file', 'log text: git-supplied text goes through --text-file')`, `has("`_shared/auto-decision-log.md`'s Text from git or a user", 'cites the canonical procedure')`, keep `has('mergeability: {outcome}', 'log text shape')` (replacing the `--text "mergeability: {outcome}"` pin), and assert `!/escape any/i.test(p)`. Add a go-red control test that mutates `EXEC` by replacing `--text-file` with `--text` in the paragraph and expects `assertLeaveOpenParagraph` to throw `/--text-file/`.
  - Flow test (`#3014` test): factor its section assertions into `assertConflictSection(section)`; add `assert.match(section, /--text-file/)`, `assert.match(section, /Text from git or a user/)`, `assert.doesNotMatch(section, /escape any/i)`; keep every existing assertion (including `merge aborted — HARD-GATE stop before \{next phase\}` and `--reversibility high` before `stop as a HARD-GATE failure`). Add a go-red control running `assertConflictSection` on the section with `--text-file` replaced by `--text`, expecting a throw.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/wrap-up-leave-open-mergeability-conformance.test.js tests/flow-preflight-conformance.test.js`
Expected: FAIL after Step 1 — `--text-file` missing from both paragraphs (both files pass today; Step 1 edits existing tests).

- [ ] **Step 3: Rewrite the two clauses**
  - `steps-and-gates.md`: `--text "catch-up of PR #{n}'s branch … stop before {next phase}"` — escape any … in file names) becomes `--text-file` holding `catch-up of PR #{n}'s branch with origin/{integration-branch} conflicted on {paths}; merge aborted — HARD-GATE stop before {next phase}` per `_shared/auto-decision-log.md`'s Text from git or a user paragraph, since git accepts `"`, `$`, backtick and `\` in file names. Drop the escape instruction.
  - `execution-and-verification.md`: `--text "mergeability: {outcome}"`. Escape any … first — … error text.` becomes `--text-file` holding `mergeability: {outcome}` (`_shared/auto-decision-log.md`'s Text from git or a user paragraph — `{files}` and `{reason}` are git-supplied file names and error text).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/wrap-up-leave-open-mergeability-conformance.test.js tests/flow-preflight-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Confirm no escape instruction remains anywhere**

Run: `git grep -n -i "escape any" -- plugin`
Expected: no `log-decision` call site hit (only `plugin/bin/lib/reconcile/pr-state.js`'s unrelated GraphQL comment).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/flow/steps-and-gates.md plugin/skills/wrap-up/execution-and-verification.md tests/wrap-up-leave-open-mergeability-conformance.test.js tests/flow-preflight-conformance.test.js
git commit -m "Migrate git-text log-decision call sites to --text-file — drop hand-escaping (refs #3671)"
```

Headroom (RAIL_BYTES 52,500): `steps-and-gates.md` 39,075 B, `execution-and-verification.md` 17,240 B, `_shared/auto-decision-log.md` 24,173 B (+~700 B) — all well under the rail.

## As-built notes (Common Step 4.5 — Beneficial deviations)

1. `--text-file` rejects content with an interior line break (exit 2): an entry is one line, and a multi-line file (e.g. pasted `git diff --name-only` output) would otherwise split one entry across lines. The spec's "same entry as `--text`" equality holds for every one-line content.
2. The text file lives in the session temp root under the per-purpose name `decision-text-{run-id}-{step-slug}.md` (`bin/session-tmp-resolve.js`), never the run dir — the run dir refuses worktree-session Writes, and a shared name would collide across callers (`_shared/session-tmp-root.md`'s per-purpose suffix rule).
3. `_shared/auto-decision-log.md`'s Text from git or a user paragraph is pinned by `tests/auto-decision-log-worktree-gate.test.js` with a go-red control, since both migrated call sites now cite it as the single source.
