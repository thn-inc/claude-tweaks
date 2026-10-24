# worktree-always PreToolUse hook false-positives on numeric comparisons inside a Bash heredoc (#3989) Implementation Plan

**Goal:** Stop the `worktree-always` gate from reading a `>` inside a heredoc body (e.g. `if (openIds.length > 0) ...` in a `node-eval-file.js` heredoc) as a real shell redirect, while a real top-level redirect into a repo file stays denied.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T061121-record-3989/work/3989-spec.md` (materialized from GitHub issue #3989)

**Premise correction (verified at build):** the record names `checkWorktreeRequired` in `plugin/bin/lib/hooks/pre-tool-use.js` as the matcher's home. It is not: `checkWorktreeRequired` only consumes `fileWriteTargets(command, cwd)`. The redirect matcher is `redirectWriteTargets` in `plugin/bin/lib/hooks/git-command.js`, run per segment by `fileWriteTargets` through `forEachCommandSegment`/`splitSegments`. `splitSegments` cuts at every unquoted newline, so each heredoc body line becomes its own segment and `> 0)` resolves as a write target `0)` relative to cwd. The code says so itself: the "Known limit" comment above `redirectWriteTargets`. `plugin/bin/lib/hooks/bash-prefilter.js`'s `hasFileRedirection` reuses that same parser, so the prefilter and the parser must change together. They must never disagree (`_shared/policy-schema-coverage.md`, "Bare shell redirection is covered (#3080)").

---

### Task 1: Make the redirect scan heredoc-aware and pin it with regression tests

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (new exported `stripHeredocBodies(command)`; `fileWriteTargets` scans the stripped command; replace the "Known limit" comment above `redirectWriteTargets`)
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js` (`hasFileRedirection` scans `stripHeredocBodies(command)` too, so the prefilter matches the parser exactly)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (worktree-always coverage block: document the heredoc-body exemption and the shell-interpreter carve-out, in the "Bare shell redirection is covered (#3080)" paragraph, outside the `gate-coverage:begin/end` fenced list)
- Test: `tests/hooks-gate-coverage.test.js` (unit cases on `fileWriteTargets`, beside the existing `#3080` cases, plus an in-process e2e case beside `e2e #3080`)
- Test: `tests/hooks-dispatcher.test.js` (real-CLI e2e beside `#3080 AC` cases, via `runBashPreToolUse` + `policyRepoWithRun`)
- Test: `tests/hooks-bash-prefilter.test.js` (`hasFileRedirection` cases beside the `#3080` loops)

**Design (binding — the implementer follows this, not a looser reading):**

`stripHeredocBodies(command)` returns the command with every heredoc body and its closing-delimiter line removed. The opener line stays, and so does the newline that ends it, so whatever follows the closing delimiter starts its own segment. Example: `"A <<EOF\nbody\nEOF\nB"` → `"A <<EOF\nB"`. It is a single char-level scan:

- **Opener detection** happens only outside quotes. Track single quotes, double quotes and backslash escapes with the same rules as `splitSegments`. Ignore anything after an unquoted word-boundary `#` comment up to the end of that line. A heredoc operator is `<<`, optionally followed by `-`, then optional spaces/tabs, then a delimiter word. `<<<` is a here-string, not a heredoc: never treat it as one. `<<` inside an open arithmetic `$((`/`((` span is a bit shift, not a heredoc. Track unclosed `((` depth outside quotes on the current logical line and skip `<<` while that depth is above zero, so `echo $((1<<2))` followed by a real redirect line is never swallowed. The delimiter word ends at whitespace or a shell metachar (`;&|<>()`). Its value is the word with quote characters and backslashes removed (`'EOF'`, `"EOF"`, `\EOF`, `E"O"F` all mean `EOF`). An empty delimiter is not an opener. Several openers on one line queue up in order.
- **Body**: after the newline that ends the opener's logical line (an unescaped `\n` outside quotes; a quote or a trailing `\` continuation that spans lines delays it), each queued heredoc consumes lines in order. Its body runs until a line equal to the delimiter. For `<<-`, compare after stripping leading tabs. Strip one trailing `\r` before comparing. No quote, comment or `((` tracking happens inside a body. An unterminated body runs to end of string, as bash does.
- **Shell-interpreter carve-out (keeps the gate's purpose):** a body fed to a shell is executed as shell, so its redirects are real. If any token on the opener's logical line has a basename (after stripping quotes, `.exe` and the path) in `sh`, `bash`, `zsh`, `dash`, `ksh`, `mksh`, `ash`, `fish`, `busybox`, `eval`, `source` or `.`, keep that line's bodies unstripped. That covers `bash <<EOF`, `cat <<EOF | sh`, `sudo bash <<EOF` and `env bash <<EOF`. Do the same, failing closed, when the program word of any segment on the opener line is unresolvable. The program word is the first token after leading `NAME=value` assignments, and it is unresolvable when it contains `$` or a backtick (`$SHELL <<EOF`). A `$` in an argument (`node "$(git branch --show-current)" <<EOF`) does not trigger it.
- `fileWriteTargets` runs `forEachCommandSegment(stripHeredocBodies(command), cwd, ...)`. Body lines are never shell-executed for a non-shell reader, so this also drops cd/write-shape false positives inside bodies. `gitTargets`, `mkdirTargets` and the rest of the module are unchanged (out of scope).
- `hasFileRedirection` runs `forEachCommandSegment(stripHeredocBodies(command), '.', ...)`. `commandWords` and the rest of `shouldRunFull` are unchanged, so the prefilter remains a superset for write-shape words.
- `stripHeredocBodies` must never throw. Any internal failure returns the original command unchanged (fail closed to today's behavior).

- [ ] **Step 1: Failing tests** — add these cases, then confirm each new assertion fails against the current code. Run the new files and see red for the new cases.
  - `tests/hooks-gate-coverage.test.js` unit cases (`fileWriteTargets(cmd, '/r')`):
    - `node x.js <<EOF\nif (a.length > 0) b();\nEOF` → `[]`
    - quoted `<<'EOF'`, `<<"EOF"` and tab-stripped `<<-EOF` (closing line `\tEOF`) variants → `[]`
    - `node x.js > out.js <<EOF\nif (a > 0) b();\nEOF` → exactly `[{ action: 'write', file: path.resolve('/r', 'out.js') }]`. The top-level redirect on the opener line survives, the body one does not.
    - `node x.js <<EOF\na > b\nEOF\necho x > after.js` → exactly the `after.js` target. Commands after the closing delimiter are still scanned.
    - `bash <<EOF\necho x > f.js\nEOF` and `cat <<EOF | sh\necho x > f.js\nEOF` → still resolve the `f.js` target (shell carve-out).
    - `$SHELL <<EOF\necho x > f.js\nEOF` → still resolves `f.js` (unresolvable program word fails closed).
    - `cat <<< "a > b"` and `cat <<<x > f.js` → the here-string is not a heredoc, and the second still resolves `f.js`.
    - `echo $((1<<2))\necho x > f.js` → still resolves `f.js` (arithmetic shift is not a heredoc).
    - `echo "<<EOF"\necho x > f.js` → still resolves `f.js` (quoted `<<` is not an opener).
  - `tests/hooks-dispatcher.test.js` real-CLI e2e, in a `policyRepoWithRun()` project:
    - **AC1:** the frozen `queue-pull-script.md` grouping snippet (lines 212–256 of `plugin/skills/dispatch/queue-pull-script.md`, the `node .../node-eval-file.js ... > "$DISPATCH_GROUPS" <<NODE_EVAL_EOF ... NODE_EVAL_EOF` block containing `if (openIds.length > 0) excludedNative.push(...)`, with every `$DISPATCH_*` argument and `${CLAUDE_PLUGIN_ROOT}` replaced by literal `os.tmpdir()`-based paths so its only write target is under the temp dir) is NOT denied. Keep the fixture byte-identical to the doc apart from those substitutions.
    - **AC2:** the same command with a top-level `echo x > {project}/tracked-file.js` line appended after `NODE_EVAL_EOF` IS denied.
  - `tests/hooks-gate-coverage.test.js` in-process e2e (beside `e2e #3080`): the heredoc-body comparison is not denied, and a top-level redirect into the repo is denied.
  - `tests/hooks-bash-prefilter.test.js`: `hasFileRedirection('node x.js <<EOF\nif (a > 0) b();\nEOF')` is `false`. `hasFileRedirection('bash <<EOF\necho x > f.js\nEOF')` and `hasFileRedirection('node x.js <<EOF\na\nEOF\necho x > f.js')` are `true`. The differential corpus in that file stays green.
- [ ] **Step 2: Implement** — `stripHeredocBodies` in `git-command.js` per the Design above, export it, and wire it into `fileWriteTargets` and `hasFileRedirection`. Replace the "Known limit" comment above `redirectWriteTargets` with one stating the new behavior and the shell carve-out. Update `_shared/policy-schema-coverage.md`'s "Bare shell redirection is covered (#3080)" paragraph with one or two sentences. Name the heredoc-body exemption (`#3989`), the shell-interpreter / unresolvable-program carve-out, and the fact that both the parser and the prefilter apply it. Leave the `gate-coverage:begin/end` list unchanged: `tests/hooks-gate-coverage.test.js` pins it to `GATE_COVERAGE`, and the operator set does not change.
- [ ] **Step 3: Run** the three test files from Step 1 — PASS:
  `node --test tests/hooks-gate-coverage.test.js tests/hooks-dispatcher.test.js tests/hooks-bash-prefilter.test.js`
- [ ] **Step 4: Commit** — one commit, `Make worktree-always redirect scan skip heredoc bodies — refs #3989`.

---

## Self-review

- **Spec coverage:**
  - Deliverable 1 (heredoc-aware matcher) is Step 2 plus the Design section.
  - Deliverable 2 (`policy-schema-coverage.md` documents the exemption) is Step 2.
  - Deliverable 3 (regression test: allowed heredoc comparison, denied top-level redirect) is Step 1, in all three suites.
  - AC1 (exact snippet runs without denial) is the frozen-snippet e2e. AC2 (real top-level redirect still denied) is the appended-redirect e2e plus the unit cases. AC3 (`npm test` passes) is covered by /build Common Step 5.
- **Placeholders:** none.
