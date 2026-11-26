# Per-record shaped-body temp file Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two records shaped in one session (a sweep, or sibling dispatches sharing a session id) never share a shaped-body temp file, and a body file composed for one record is refused before it is written onto another.

**Architecture:** `compose-record.js --check` gains an optional `--record <n>` flag. With it, the CLI refuses a body file whose basename does not end in `-{n}.md` (exit 6, naming both ids) before reading or shape-checking the body. Both `/specify` shaping resolve sites key the temp file as `specify-shaped-body-{n}.md` and pass `--record {n}` to their `--check` calls, so the check runs before `gh issue edit`/`writeRecord` writes anything.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T103003-record-4746/work/4746-spec.md`

Scope keywords: specify-shaped-body, SPECIFY_SHAPED_BODY

## Global Constraints

- Temp filename form: `specify-shaped-body-{n}.md`, where `{n}` is the record id pasted literally, the same way `gh issue edit {n}` is.
- The mismatch refusal happens before any write, and its message names both ids.
- Existing exit codes of `compose-record.js` (0/2/3/4/5) keep their meaning. The new refusal is exit 6.
- `plugin/skills/specify/shaping-mode-stamping.md` is 36,897 B and `shaping-mode.md` is 24,925 B against `RAIL_BYTES` 52,500. Both edits add under 400 B, leaving more than 15 KB of headroom in each.

## Review Focus

- A local-files record id containing dashes (e.g. `2026-01-foo`): the suffix rule `endsWith('-' + n + '.md')` must accept `specify-shaped-body-2026-01-foo.md` for `--record 2026-01-foo`. Pinned in Task 1.
- A body file with no trailing id (the old fixed `specify-shaped-body.md`) under `--record`: refused with exit 6, never accepted. Pinned in Task 1.
- `--record` without `--check` (combined with a payload or `--out`), or `--record` with no value: exit 2 usage error. Pinned in Task 1.
- A batch copy `specify-risk-body-{n}.md` (the per-record Risk flags batch file `planning.md`'s `{body}` may name) passes `--record {n}`. Pinned in Task 1 by a test using that basename.
- A mismatch refusal with an unreadable or unshaped body must still report the mismatch (exit 6), not exit 2 or 4: the id check runs first. Pinned in Task 1.

---

### Task 1: `compose-record.js --check --record <n>` refuses another record's body file

**Files:**
- Modify: `plugin/bin/compose-record.js`
- Modify: `docs/plugin-structure.md` (the `compose-record.js --check` command-reference line, ~line 370)
- Test: `tests/bin-lib/compose-record/cli.test.js`

**Interfaces:**
- Produces: CLI `compose-record.js --check <body-file> [--record <n>]`. Exit 6 when the body file's basename does not end in `-{n}.md`. Stderr is one line: `compose-record.js: body file {path} was composed for #{m}, not #{n} — refusing to write it` when the basename ends in `-{digits}.md`, else `compose-record.js: body file {path} names no record id — refusing to write it to #{n}`. `parseArgs` returns a `record` field (string or null).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/compose-record/cli.test.js`, following that file's existing `run(argv, deps)` style and temp-dir setup:
  - `--check --record matches the body file's trailing id → exit 0`: write a shaped body to `{dir}/specify-shaped-body-4746.md` and run `['--check', file, '--record', '4746']`. Expect 0.
  - `--check --record refuses a body file composed for another record`: `specify-shaped-body-4549.md` with `--record 4550`. Expect 6, and stderr includes both `#4549` and `#4550`.
  - `--check --record refuses the fixed session-wide filename`: `specify-shaped-body.md` with `--record 4550`. Expect 6, and stderr matches `/names no record id/` and includes `#4550`.
  - `--record mismatch is reported before the shape check`: an unshaped body at `specify-shaped-body-1.md` with `--record 2`. Expect 6, not 4. A non-existent file `specify-shaped-body-1.md` with `--record 2` also gives 6, not 2.
  - `--record accepts a dashed local-files id`: `specify-shaped-body-2026-01-foo.md` with `--record 2026-01-foo` and a shaped body. Expect 0.
  - `--record accepts the per-record batch copy name`: `specify-risk-body-7.md` with `--record 7`. Expect 0.
  - `--record without --check is a usage error`: `[payloadFile, '--out', out, '--record', '1']` gives 2; `['--check', file, '--record']` gives 2.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/compose-record/cli.test.js`
Expected: FAIL. `--record` is an unknown argument today, so the new cases exit 2.

- [ ] **Step 3: Implement.** In `parseArgs`, add `else if (a === '--record') o.record = next() ?? '';` with `record: null` in the defaults. In `run`'s `--check` branch: `--record` given with an empty value → usage error `--record <n> is required`. `o.record !== null` outside `--check` → usage error `--record is only valid with --check`. When `o.record` is set, check `path.basename(o.check).endsWith('-' + o.record + '.md')` before `readFileSync`. On failure, write the stderr line from Interfaces and return 6, taking `{m}` from `/-(\d+)\.md$/` on the basename. Update the header comment's usage and exit-code list (`6 = --record given and the body file's name carries a different record id, or none`) and `USAGE`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/compose-record/cli.test.js tests/exit-code-conformance.test.js tests/cli-entry-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Update `docs/plugin-structure.md`'s `compose-record.js --check <body-file>` line** to `--check <body-file> [--record <n>]`, adding that exit 6 refuses a body file whose name does not end in `-{n}.md` (#4746). Keep the rest of the line unchanged.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/compose-record.js tests/bin-lib/compose-record/cli.test.js docs/plugin-structure.md
git commit -m "Add compose-record --check --record guard — refuses another record's body file (refs #4746)"
```

### Task 2: Key both shaping resolve sites by record id, with a two-record regression test

**Files:**
- Modify: `plugin/skills/specify/shaping-mode-stamping.md:57` (Risk flags' `{tmp-shaped-body}` naming and the `session-tmp-resolve.js BODY=` argument), `:204-208` (the Compose-then-write-once fence), `:221` (exit handling sentence)
- Modify: `plugin/skills/specify/shaping-mode.md:79` (born-ready paragraph's temp-file name and `--check` call)
- Modify: `tests/specify-shaping-noop-check.test.js` (`CHECK_CALL` constant)
- Modify: `tests/specify-shaping-template-required-sections.test.js` (the `--check ... || exit` line regex)
- Create: `tests/specify-shaped-body-per-record.test.js`

**Interfaces:**
- Consumes: Task 1's `--check <file> --record <n>` and exit 6.

- [ ] **Step 1: Write the failing test** `tests/specify-shaped-body-per-record.test.js`, reading the skill files through `tests/helpers/read-skill`'s `readText`:
  - `both resolve sites name the record id in the shaped-body filename`: in `shaping-mode-stamping.md`, the Compose-then-write-once fence (the fenced block containing `SPECIFY_SHAPED_BODY=$(node -e "`) contains `'specify-shaped-body-{n}.md'` twice and no `'specify-shaped-body.md'`. The Risk flags paragraph contains `BODY=specify-shaped-body-{n}.md`. `shaping-mode.md`'s born-ready paragraph contains `specify-shaped-body-{n}.md`. Neither file contains the bare token `specify-shaped-body.md` anywhere (`assert.ok(!src.includes('specify-shaped-body.md'))`).
  - `both --check calls pass --record {n}`: the stamping fence's `--check` line matches `/--check "\$SPECIFY_SHAPED_BODY" --record \{n\} \|\| exit\s*$/`, and shaping-mode.md contains `--check "$SPECIFY_SHAPED_BODY" --record {n}`.
  - `shaping two records back to back in one session writes each its own body` (the regression test): extract the filename literal from the stamping fence's `sessionTmpPath(...)` call with `/sessionTmpPath\(process\.env\.CLAUDE_CODE_SESSION_ID, '([^']+)'\)/`. For records `4549` and `4550`, replace `{n}`, resolve each through `plugin/bin/session-tmp-resolve.js`'s exported `run(['--value', name], { env: { CLAUDE_CODE_SESSION_ID: 'same-session', TMPDIR: tmp }, stdout, stderr })` with one shared session id. Write body A to record 4549's path and then body B to record 4550's path. Assert that reading 4549's path returns body A and that the two paths differ. On today's fixed filename both resolve to one path and this goes red. Then run `compose-record.js`'s `run(['--check', path4549, '--record', '4550'])` and assert exit 6, so a cross-wired body is refused before the write.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/specify-shaped-body-per-record.test.js`
Expected: FAIL, because the skill files still name `specify-shaped-body.md`.

- [ ] **Step 3: Edit the prose.**
  - `shaping-mode-stamping.md:57`: `{tmp-shaped-body}` becomes `that body file (`specify-shaped-body-{n}.md`, keyed by record id so no two records shaped in one session share it)`, and the resolve argument becomes `BODY=specify-shaped-body-{n}.md`. Leave `PRIOR=`/`ANSWERS=` unchanged.
  - The fence at `:204-208`: both `'specify-shaped-body.md'` literals become `'specify-shaped-body-{n}.md'`, and the `--check` line becomes `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" --check "$SPECIFY_SHAPED_BODY" --record {n} || exit`. Keep the `SPECIFY_SHAPED_BODY=$(node -e "` opener byte-identical: `tests/skill-fence-guard-shapes.test.js` ratchets that exact line.
  - `:221`, after the `--check` (#2827) sentence: add `` `--record {n}` (#4746) refuses, with exit 6 and before any read, a body file whose name carries another record's id, or none: the row renders `failed`, quoting stderr verbatim. ``
  - `shaping-mode.md:79`: `the same `specify-shaped-body.md` path` becomes `the same `specify-shaped-body-{n}.md` path`, and the `--check` call becomes `--check "$SPECIFY_SHAPED_BODY" --record {n}`.
  - Update `tests/specify-shaping-noop-check.test.js`'s `CHECK_CALL` to end with `--record {n}`. Update `tests/specify-shaping-template-required-sections.test.js`'s regex to `/--check "\$SPECIFY_SHAPED_BODY" --record \{n\} \|\| exit\s*$/`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/specify-shaped-body-per-record.test.js tests/specify-shaping-noop-check.test.js tests/specify-shaping-template-required-sections.test.js tests/skill-fence-guard-shapes.test.js tests/specify-planning-conformance.test.js tests/risk-flags-prose-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Sweep.** Run `git grep -n -F -e 'specify-shaped-body.md' -- plugin tests docs`. Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/specify/shaping-mode-stamping.md plugin/skills/specify/shaping-mode.md tests/specify-shaped-body-per-record.test.js tests/specify-shaping-noop-check.test.js tests/specify-shaping-template-required-sections.test.js
git commit -m "Key the specify shaped-body temp file by record id — no cross-record body writes (refs #4746)"
```
