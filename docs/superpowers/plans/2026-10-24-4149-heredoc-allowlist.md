# Heredoc-Body Stripping Allowlist Implementation Plan (#4149)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the #3989 regression where the worktree-always write gate stops seeing real writes inside a heredoc body that a non-shell executor, a later-line consumer, or a misparsed delimiter runs.

**Architecture:** `stripHeredocBodies` (`plugin/bin/lib/hooks/git-command.js`) flips from a shell-name *denylist* (strip unless a shell is named) to a data-reader *allowlist*: a body is stripped only when every command on its opener's logical line is a known data reader. Two parser fixes make the scanner read heredocs the way bash does: an unquoted delimiter line ending in an odd backslash run joins the next line, and `<<` inside `$[ … ]` is arithmetic, not an opener. `fileWriteTargets` and `bash-prefilter.js`'s `hasFileRedirection` both consume `stripHeredocBodies`, so both inherit the fix with no change of their own.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T163054-spec-4149/work/4149-spec.md` (record #4149)

**Scope keywords:** stripHeredocBodies, bodyRunsAsShell, SHELL_INTERPRETER_WORDS, heredoc

## Global Constraints

- The scan fails closed: anything it cannot prove is data stays visible to `fileWriteTargets` (#3989's own posture, unchanged).
- Corrected premise (logged in `decisions.md`): the #3989 heredoc cases live in `tests/hooks-gate-coverage.test.js` (lines 362-557), not `tests/hooks-git-command.test.js` as the record's Key Files say. New cases go beside them.
- Every existing #3989 test in `tests/hooks-gate-coverage.test.js`, `tests/hooks-bash-prefilter.test.js` and `tests/hooks-dispatcher.test.js` (the frozen queue-pull snippet, AC1/AC2) stays green, except the one deliberate rewrite in Task 1 Step 1.
- `plugin/skills/_shared/policy-schema-coverage.md` is 22,438 B against the 52,500 B `RAIL_BYTES` rail; Task 3's paragraph rewrite is net-neutral to ±600 B, leaving >29 KB headroom.

Waived AC4.1: the full `npm test` suite runs once at `/claude-tweaks:build` Common Step 5 (`verify.js`), centrally, not per task.
Waived tests/hooks-git-command.test.js: corrected premise — the #3989 heredoc cases live in `tests/hooks-gate-coverage.test.js`; this file is not touched.

## Review Focus

1. **Real reader shapes must keep stripping**, or #3989's false-positive denial comes back: `node "$ROOT/bin/node-eval-file.js" … > out <<NODE_EVAL_EOF` (the frozen dispatcher snippet), `git commit -F - <<EOF`, `gh pr create --body-file - <<EOF`, `python3 - <<EOF`, `cat <<EOF > file` — Task 1 pins `git commit -F -` and `gh … --body-file -` alongside the existing node cases.
2. **A wrapper with an option value** (`sudo -u bob node <<EOF`) must fail closed (body kept), not resolve `bob` or `node` wrongly — Task 1 pins it.
3. **A subshell group opened on the opener line and closed later** (`(cat <<EOF` … `) | sh`) must keep the body, the same as `{ cat <<EOF` … `} | sh` — Task 1 pins both.
4. **A quoted delimiter is never joined** (bash does no line continuation in a quoted heredoc), and an even backslash run (`E\\`) is a literal, not a continuation — Task 2 pins both.
5. **`$[` arithmetic on a reader line** (`cat $[1<<3]`) must not open a heredoc even though `cat` is allowlisted — Task 3 pins it; deleting the `$[` depth guard turns that test red.

---

### Task 1: Allowlist data readers instead of denylisting shells

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js:552-602` (replace the shell denylist block), `:696-708` (`planHeredocBodies`), comments at `:790-797` and `:816-819`
- Test: `tests/hooks-gate-coverage.test.js` (new cases beside the #3989 block; rewrite the `stripHeredocBodies('A <<EOF…')` assertion at :512)
- Test: `tests/hooks-bash-prefilter.test.js:155-161` (one new assertion)

**Interfaces:**
- Consumes: `splitSegments`, `tokenize`, `SIMPLE_ASSIGNMENT_RE`, `programNames` (all already in `git-command.js`).
- Produces: `DATA_READER_WORDS: Set<string>` = `cat, tee, git, gh, read, node, python, python3, jq, wc`; `READER_WRAPPER_WORDS: Set<string>` = `sudo, doas, env, nice, time, nohup, command, exec`; `lineFeedsOnlyDataReaders(lineText: string) -> boolean`. `planHeredocBodies` keeps its signature and return shape.

- [ ] **Step 1: Write the failing tests** (AC1.1 for the executor/glob-name/later-pipe cases, AC2.1 for the data-only `cat` case) in `tests/hooks-gate-coverage.test.js`, one `test('#4149: …')` per group, with `f = [{ action: 'write', file: path.resolve('/r', 'f.js') }]`:
  - `'#4149: a body fed to a non-shell executor or a glob-named shell stays visible'` — `fileWriteTargets(cmd, '/r')` deep-equals `f` for `'make -f - <<EOF\nall:\n\techo x > f.js\nEOF'`, `'at now <<EOF\necho x > f.js\nEOF'`, `'/bin/ba[s]h <<EOF\necho x > f.js\nEOF'`, `'xargs sh -c x <<EOF\necho x > f.js\nEOF'`.
  - `'#4149: a group opened on the opener line keeps its body (consumer on a later line)'` — deep-equals `f` for `'{ cat <<EOF\necho x > f.js\nEOF\n} | sh'` and `'(cat <<EOF\necho x > f.js\nEOF\n) | sh'`.
  - `'#4149: a wrapper is followed to the program it runs, failing closed on an option value'` — `'sudo node x.js <<EOF\nif (a > 0) b();\nEOF'` and `'env FOO=1 node x.js <<EOF\nif (a > 0) b();\nEOF'` deep-equal `[]`; `'sudo -u bob node x.js <<EOF\necho x > f.js\nEOF'` deep-equals `f`.
  - `'#4149: a program name the parser can spell two ways counts only when both are readers'` — `fileWriteTargets('ca\\t <<EOF\necho x > f.js\nEOF', '/r')` deep-equals `f`.
  - `'#4149: every command on the opener line must be a reader'` — `'cd x && node y.js <<EOF\necho x > f.js\nEOF'` deep-equals `[{ action: 'write', file: path.resolve('/r/x', 'f.js') }]` (the deliberate fail-closed tradeoff: a non-reader segment keeps the body).
  - `'#4149: common reader shapes still strip'` — `'git commit -F - <<EOF\nfix: a > b\nEOF'`, `'gh pr create --body-file - <<EOF\na > b\nEOF'`, `'python3 - <<EOF\nif a > 0: pass\nEOF'`, `'cat <<EOF\nnothing here\nEOF'` each deep-equal `[]`.
  - Rewrite the `stripHeredocBodies('A <<EOF\nbody\nEOF\nB')` assertion (:512) to `stripHeredocBodies('cat <<EOF\nbody\nEOF\nB')` → `'cat <<EOF\nB'`, and add `assert.strictEqual(stripHeredocBodies('A <<EOF\nbody\nEOF\nB'), 'A <<EOF\nbody\nEOF\nB')` (an unknown program keeps its body).
  - In `tests/hooks-bash-prefilter.test.js`'s #3989 test, add `assert.strictEqual(hasFileRedirection('make -f - <<EOF\nall:\n\techo x > f.js\nEOF'), true);`.

- [ ] **Step 2: Run to verify the new cases fail (AC3.1)**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js`
Expected: FAIL — the `make -f -`/`at now`/`/bin/ba[s]h`/both group/`ca\t`/`sudo -u bob`/`cd x &&` cases return `[]`, the unknown-program `A <<EOF` assertion gets the stripped text, and the prefilter assertion is `false` (probed at 7070c0b8a). Already passing, kept as regression guards: `xargs sh -c` (the old denylist sees `sh`), the reader shapes, and `sudo node`/`env FOO=1 node`.

- [ ] **Step 3: Implement** — in `git-command.js`, delete `SHELL_INTERPRETER_WORDS`, `VERSIONED_SHELL_RE`, `WRAPPER_WORDS`, `isShellName`, `wrapperRunsShell` and `bodyRunsAsShell`; add `DATA_READER_WORDS`, `READER_WRAPPER_WORDS` and `lineFeedsOnlyDataReaders(lineText)`. The rule, per segment of `splitSegments(lineText)` (skip empty segments): return `false` if any token starts with `(` or `{`, contains `>(` or `<(`, or is `}`; skip leading `NAME=value` tokens; while the program token's names are in `READER_WRAPPER_WORDS`, advance past it and past following tokens that start with `-` or match `SIMPLE_ASSIGNMENT_RE`; return `false` when no program token remains, it contains `$` or a backtick, or `programNames(tok).every((n) => DATA_READER_WORDS.has(n))` is false. Return `true` when every segment passes. In `planHeredocBodies`, replace `bodyRunsAsShell(lineText)` with `!lineFeedsOnlyDataReaders(lineText)` and rename `runsAsShell` to `keep`. Rewrite the two comment blocks (`:790-797`, `:816-819`) to describe the allowlist, keeping the existing fail-closed list. `programNames` stays (still used).

- [ ] **Step 4: Run to verify everything passes**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js tests/hooks-dispatcher.test.js`
Expected: PASS, including every pre-existing #3989 case (the shell family, `$SHELL`, `cat <<EOF | tee >(bash)`, the frozen queue-pull snippet AC1/AC2).

- [ ] **Step 5: Re-prove each guard by mutation** (run `node --test tests/hooks-gate-coverage.test.js` after each, confirm red, restore, and quote the failing test names in the task report):
  - Delete the group/process-substitution token check → the `(cat <<EOF … ) | sh` case and the existing `cat <<EOF | tee >(bash)` case go red. (`{ cat` alone does not isolate it — its program token `{` already fails the reader check.)
  - Make the wrapper skip also consume the token after each skipped flag → the `sudo -u bob node` case goes red.
  - Drop `READER_WRAPPER_WORDS` handling (treat a wrapper as an ordinary program word) → the `sudo node` and `env FOO=1 node` cases go red.
  - Change `every` to `some` in the reader check → the `ca\t` case goes red (its names are `cat` and `t`; the existing `bas\h` case cannot isolate this, since neither `bash` nor `h` is a reader).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js
git commit -m "Strip a heredoc body only for an allowlisted data reader — closes the #3989 bypasses (refs #4149)"
```

### Task 2: Join a backslash-continued delimiter line the way bash does

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js:669-685` (`scanHeredocBody`)
- Test: `tests/hooks-gate-coverage.test.js`

**Interfaces:**
- Consumes: the heredoc record `h = { delim, quoted, stripTabs }` from `readHeredocOpener`.
- Produces: `scanHeredocBody(str, p, h)` unchanged signature and return shape `{ end, terminated, text }`.

- [ ] **Step 1: Write the failing test** (AC1.1, backslash-joined delimiter) in `tests/hooks-gate-coverage.test.js`: `'#4149: an unquoted heredoc joins a backslash-continued line before matching the delimiter'`:
  - `fileWriteTargets('cat <<EOF\nE\\\nOF\necho x > f.js\nEOF', '/r')` deep-equals `f` (bash ends the body at the joined `EOF`, so the next line runs).
  - `fileWriteTargets("cat <<'EOF'\nE\\\nOF\necho x > f.js\nEOF", '/r')` deep-equals `[]` (quoted: no continuation, the whole body is data).
  - `fileWriteTargets('cat <<EOF\nE\\\\\nOF\necho x > f.js\nEOF', '/r')` deep-equals `[]` (`E\\` is a literal backslash, not a continuation).

- [ ] **Step 2: Run to verify it fails (AC3.1)**

Run: `node --test tests/hooks-gate-coverage.test.js`
Expected: FAIL on the first assertion (returns `[]`); the other two already pass.

- [ ] **Step 3: Implement** — in `scanHeredocBody`, when `!h.quoted`, while the physical line ends in an odd-length run of backslashes and another line follows, drop the last backslash and append the next physical line (advancing `end` past it) before the `\r`/tab handling and the delimiter comparison. `text` still runs from `bodyStart` to the start of the matched (joined) delimiter line.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/hooks-gate-coverage.test.js`
Expected: PASS. Then re-prove by mutation: drop the `!h.quoted` condition → the quoted-delimiter assertion goes red; restore it and quote the red run in the task report.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-gate-coverage.test.js
git commit -m "Join a backslash-continued unquoted heredoc line before matching its delimiter (refs #4149)"
```

### Task 3: Treat `<<` inside `$[ … ]` as arithmetic, then sync the prose

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js:713-788` (`scanHeredocs`)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:27` (the "The scan keeps a body in the text, failing closed, …" sentences)
- Modify: `docs/hooks.md:15` ("heredoc bodies that a non-shell program reads")
- Modify: `docs/journeys/run-a-heredoc-node-script-from-the-main-checkout-3989.md` (lines 13 and 22) and `docs/journeys/run-shell-loops-without-a-hook-storm-3074.md:30` ("non-shell program" phrasings)
- Test: `tests/hooks-gate-coverage.test.js`

**Interfaces:**
- Consumes: Task 1's allowlist rule (its wording for the prose).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test** in `tests/hooks-gate-coverage.test.js`: `'#4149: \`<<\` inside \`$[ … ]\` arithmetic is not a heredoc opener, even on a reader line'` — `fileWriteTargets('cat $[1<<3]\necho x > f.js\n3]', '/r')` deep-equals `f`.

- [ ] **Step 2: Run to verify it fails (AC3.1)**

Run: `node --test tests/hooks-gate-coverage.test.js`
Expected: FAIL (returns `[]`).

- [ ] **Step 3: Implement** — in `scanHeredocs`, track `bracketDepth` (unclosed `$[` on the current logical line) beside `parenDepth`: `$` followed by `[` increments it and pushes `$[`; `]` with depth > 0 decrements it; reset it at each newline with `parenDepth`; read a `<<` as an opener only when both depths are 0. Then rewrite the prose: `policy-schema-coverage.md:27`'s "or the line runs a shell: …" clause becomes the allowlist rule (a body is stripped only when every command on the opener line is a data reader — name the ten words and the wrapper rule — and kept for group/process-substitution tokens, `$`/backtick program words, continuation lines, and expanding bodies), plus the two parser rules (backslash-continued unquoted delimiter, `$[ ]` arithmetic); `docs/hooks.md:15` and the two journeys say "an allowlisted data reader (`node`, `cat`, `python3`, …)" in place of "a non-shell program". Leave the `gate-coverage:begin/end` list untouched.

- [ ] **Step 4: Run to verify it passes, and sweep**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js tests/hooks-dispatcher.test.js`
Expected: PASS. Re-prove by mutation: make the opener check ignore `bracketDepth` → the `$[` test goes red; restore and quote the red run.
Run: `git grep -n -i -e "SHELL_INTERPRETER_WORDS" -e "VERSIONED_SHELL_RE" -e "wrapperRunsShell" -e "bodyRunsAsShell" -e "non-shell program" -e "or the line runs a shell" -- plugin docs/hooks.md docs/journeys`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-gate-coverage.test.js plugin/skills/_shared/policy-schema-coverage.md docs/hooks.md docs/journeys/run-a-heredoc-node-script-from-the-main-checkout-3989.md docs/journeys/run-shell-loops-without-a-hook-storm-3074.md
git commit -m "Read \$[ ] arithmetic as no heredoc opener and document the reader allowlist (refs #4149)"
```
