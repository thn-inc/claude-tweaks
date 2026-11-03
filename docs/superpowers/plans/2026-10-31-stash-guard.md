# Stash Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dispatched agents from silently destroying the repo-wide git stash: name every stack-mutating form in the forwarded no-stash rule, detect and undo stack changes around every dispatch that can run git with a new `stash-guard.js` CLI, and widen the stash warning hook to `drop`/`clear`.

**Architecture:** A new self-contained CLI `plugin/bin/stash-guard.js` (`snapshot` / `compare [--restore]`) on the repo's `run(argv, deps)` seam with an injectable `git` runner. Identity is the stash commit sha (`%H`), never `stash@{n}`. A dispatch is identified by `--task <k>`, `--label <slug>`, or both (the record's plan-review Decision, Reading B). Given `--run` and a dispatch identifier, `compare --restore` appends its own `AUTO`/`FAILED` decisions.md lines through `plugin/bin/lib/log-decision/append.js` (plan departure from the spec, logged in decisions.md: `FAILED` is not a `log-decision.js` status, and stash subjects are git-derived text that must not pass through shell quoting). `build/dispatch.md` directs SDD's controller to run the CLI around every dispatch that can run git — per-task implementers, their fix rounds and re-dispatches, fix-wave and whole-branch-fix implementers, and SDD's reviewers — and forwards the widened no-stash rule to the same set. The PreToolUse hook's `checkGitStashWarn` gains `drop`/`clear`.

**Tech Stack:** Node 18+ (CI runs Node 20), `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T204133-record-4559/work/4559-spec.md` (record #4559; re-materialized for this resumed run — it carries four `**Decision (plan review, 2026-10-31):**` Acceptance Criteria; the third, on a dirty tree after a reviewer's restore, and the fourth, the closing rule, are new since the 155142 copy)

## Global Constraints

- Commit messages: `{Verb} {what} — {detail}`, ending `refs #4559` (never `closes`/`fixes`), plus the trailer line `Claude-Session: https://claude.ai/code/session_01Ngy9oYqyy55AY9hCig2pZz`.
- Plan-review Decision (spec, verbatim): "The stash guard wraps every dispatch that can run git: each per-task implementer dispatch and its review fix rounds and NEEDS_CONTEXT/BLOCKED re-dispatches, fix-wave and whole-branch-fix implementers, and SDD reviewers. `stash-guard.js` gains a dispatch identifier beside `--task <k>` (for example `--label fix-wave`), used in the snapshot file name, so a whole-branch fix wave has a valid snapshot key." The forwarded no-stash rule in `build/dispatch.md` reaches the same dispatch set (the plan-review question covered both "the stash guard and the no-stash rule").
- Second plan-review Decision (spec, verbatim): "A reviewer dispatch whose stash guard reports a stash change has its verdict voided. The controller restores the stash, confirms `git status` is clean, and dispatches the review again; the restore is logged and listed in the handoff." (AC12; Task 5.)
- Third plan-review Decision (spec, verbatim): "When the tree is not clean after a reviewer's stash restore, or the retried review changes the stash again, there is no stop. Log it, list it in the handoff, and dispatch the review once more with the dirty paths named; that verdict stands. At most one retry per review." (AC13.1–AC13.4; Task 5.) Chosen behaviour for the two triggers, per the fourth Decision's closing rule: a dirty tree after the first restore → the one retry is dispatched with the dirty paths named in its prompt, and its verdict stands; the retry itself changing the stash again → the CLI has already restored it, the controller logs it and lists it in the handoff, and the retry's verdict stands — no third dispatch. Either way the controller never discards worktree changes and never stops.
- Concurrent guards (plan-review row, implementer's judgment per the closing rule): two guards can run at once — `/flow` `parallel` wave members build in sibling worktrees that share one stash stack. `compare --restore` re-reads the stack immediately before each `stash store` and skips a sha already back on it (reported under `alreadyPresent`, never stored twice). A sibling guard's restore can still show up as `added` in this guard's compare, marking an implementer `DONE_WITH_CONCERNS` or voiding a reviewer verdict: that false positive is accepted, the same trade the spec's sibling-drop Gotcha makes, and the reviewer case is bounded by the one retry.
- Fourth plan-review Decision (closing rule): further edge cases in these areas are the implementer's judgment, recorded in this plan and checked at review — never a needs-human gap unless they contradict an Acceptance Criterion or a Decision above.
- Never run `git stash` in any form yourself while implementing (tests use their own temp repos via `git -C <tmpdir>`); never `git reset`/`git checkout .`; stage named files only.
- Every commit from `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4559`, with `pwd` and `git rev-parse --show-toplevel` checked first.
- Exit codes (spec, verbatim): "Exit 0 = unchanged, 3 = changed, 2 = usage, unreadable baseline, or a git failure."
- Read stash entries "via `git -C <dir> stash list --format=%H%x00%gs` (NUL-separated, never split on spaces)". "Never key entries by `stash@{n}`. Indices shift on every push or drop."
- Restore uses `git -C <dir> stash store -m "<subject>" <sha>` — "it touches no worktree, so it is safe to run automatically."
- `apply` stays silent in the hook: "It changes the worktree, not the stack, and widening it would warn on the documented WIP-recovery flow."
- Do not add a profile floor for git-running implementers; `low` → Fast stays unchanged (Deliverable 5).
- Governing skill `gh-api-module-pattern` (quoted): "Export `defaultRunner` = `execFileSync('gh', args, { encoding: 'utf8' })` — always an argv array, never a shell string (no injection surface, no quoting bugs)." / "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.** The scan reads each `child_process` call's own argument text: it accepts a literal `windowsHide` key there" / "Tests never touch real `gh`: fake runners branch on the `args` shape … and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled".
- Governing skill `gh-api-module-pattern` / `cli-wrapper-contract.md` (quoted): "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract" / "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe." / "A value-taking flag given as the last argv element reads `undefined` … Validate the value inside `parseArgs` … `typeof v !== 'string' || !v.trim() || v.startsWith('--')` returns a usage error" / "A CLI that reports a decision as data logs that entry itself … Report a failed append the way the siblings do, as `logged: false` … plus one stderr line naming the `decisions.md` append, never through the exit code." / "a new self-logging CLI joins it in the same change: `tests/phase-exit-call-sites-conformance.test.js` pins that list equal to its `SELF_LOGGING_SOURCES` map and checks that each CLI's comment-stripped source requires `log-decision/append` and calls `formatEntry(`."
- Source-scan lint: no `fs.existsSync` / `fs.realpathSync` tokens in `plugin/bin/stash-guard.js` (`tests/path-guard-conformance.test.js`); read files with `fs.readFileSync` in a try/catch instead. Run `tests/path-guard-conformance.test.js` and `tests/windows-hide-spawn-conformance.test.js` alongside the focused tests for any `plugin/bin/` task.
- Governing skill `skill-prose-conformance-tests` (applied): every new prose assertion is proven able to go red — a go-red control mutates the pinned text and runs the same assertion function against it, expecting a throw.
- Byte headroom vs `RAIL_BYTES` = 52,500: `plugin/skills/dispatch/task-prompt.md` 50,155 B after the catch-up merge (≈95.5%, near ceiling — keep each rewording under +250 B, so the file stays under ~50,700 B), `plugin/skills/build/dispatch.md` 36,563 B, `plugin/skills/dispatch/express-prompt.md` 14,262 B.
- Run focused tests only; the full suite runs once in /build's Common Step 5.

## Waivers

Waived AC8.1: proven by Task 3 Step 5's behavior-change prose sweep (a grep with its go-red probe against the old line 13), not a committed test — the hook tests pin the behavior, and a test pinning the absence of one phrase in `docs/hooks.md` would be a byte pin on prose.
Waived AC10.1: `npm test` is `/build`'s Common Step 5 full run and `/claude-tweaks:test`'s gate, not a plan task.
Waived AC11.3: names which plan-review reading was chosen; AC11.1 and AC11.2 carry its behavior.
Waived AC12.4: names which plan-review reading was chosen; AC12.1–AC12.3 carry its behavior.
Waived AC13.5: names which plan-review reading was chosen; AC13.1–AC13.4 carry its behavior.
Waived AC14.1: a closing rule for plan review (which gaps count as needs-human), not a behavior of the built code; recorded under Global Constraints.
Waived AC14.2: the same closing rule — this plan records the chosen behaviour (Global Constraints, third Decision) and review checks it; no code behavior to test.
Waived AC14.3: the same closing rule — governs when plan review stops the build, not a behavior of the built code.
Waived plugin/skills/_shared/subagent-dispatch-core.md: read-only reference — the copies cite its "in any form" rule and the new wording needs no new citation anchor there (spec Key Files: "edit only if the copies' new wording needs a citation anchor").

## Review Focus

1. A stash subject containing `"`, `$`, backtick, `: ` and spaces — must round-trip through snapshot → compare --restore unchanged, and its paste-ready command must be shell-safe inside double quotes (Task 1 tests pin both).
2. Several entries removed at once — every one restored, original relative order preserved (restore oldest-first), each reported (Task 1 test).
3. A baseline file that is missing, unparseable JSON, `null`, or holds a non-sha `sha` — exit 2, nothing restored, no `git stash store` with an attacker-shaped argument (Task 1 tests).
4. `--run` pointing at a worktree-local shadow / missing dir — restore still happens, exit code unchanged, `logged: false` + stderr (Task 1 test).
5. The hook on `git stash drop` inside a compound command (`git status && git stash drop`) and on `git stash clear` — warns from a linked worktree, stays silent from the main checkout (Task 3 tests).

---

### Task 1: `stash-guard.js` CLI

**Review risk:** high

**Files:**
- Create: `plugin/bin/stash-guard.js`
- Test: `tests/stash-guard.test.js`

**Interfaces:**
- Consumes: `plugin/bin/lib/log-decision/append.js` — `resolveTarget({ runDir, cwd, mainRoot }) -> { ok, reason?, file? }`, `formatEntry({ status, now, step, text, reversibility }) -> string`, `appendEntries({ runDir, items: [{ section, entry }] })`, `hms(now) -> 'HH:MM:SS'`.
- Produces (used by Tasks 2 and 5):
  - CLI: `node plugin/bin/stash-guard.js snapshot --repo <dir> --out <file>` and `node plugin/bin/stash-guard.js compare --repo <dir> --baseline <file> [--restore] [--run <run-dir> (--task <k> | --label <slug> | --task <k> --label <slug>)]`.
  - Dispatch identifier: `--task <k>` (positive integer) and/or `--label <slug>` (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, filename-safe). The `{who}` text in the log lines below is `implementer for task {k}` (task only), `{label} dispatch for task {k}` (both), or `{label} dispatch` (label only).
  - `snapshot` writes `[{sha, subject}]` JSON to `<file>`, prints one line `{"out":"<file>","count":<n>}`, exit 0; exit 2 on usage / git failure / write failure.
  - `compare` prints one JSON line: `{removed:[{sha,subject}], added:[{sha,subject}]}`; with `--restore` also `restored:[sha]`, `alreadyPresent:[sha]` (a removed sha found back on the stack by the pre-store re-read — not stored again), `restoreFailed:[{sha, subject, error, command}]`; with `--run` also `logged: boolean` and, when false, `logError: string`. Exit 0 unchanged, 3 changed, 2 usage / unreadable or invalid baseline / git failure.
  - `module.exports = { run, parseArgs, readStack, storeCommand, USAGE }` where `readStack(git, repo) -> [{sha, subject}]` and `storeCommand(subject, sha) -> string`.
  - decisions.md lines (section `/build`, step `Stash guard`), only when `--run` is given and something changed:
    - `- AUTO HH:MM:SS — Stash guard: {who} removed stash entr{y|ies} {sha subject}[, {sha subject}…]; restored via git stash store. Reversibility: high.` (restored entries only)
    - `- AUTO HH:MM:SS — Stash guard: {who} removed stash entr{y|ies} {sha subject}[, …]; already back on the stack before restore, not stored again. Reversibility: n/a (a detection, not a mutation).` (`alreadyPresent` entries only)
    - one per failed restore, hand-composed: `- FAILED HH:MM:SS — Stash guard: {who} removed stash entry {sha} {subject}; restore failed: {error} — recover with: {command}. Reversibility: n/a (write did not land).`
    - `- AUTO HH:MM:SS — Stash guard: {who} added stash entr{y|ies} {sha subject}[, …]; left on the stack, never popped automatically. Reversibility: n/a (a detection, not a mutation).`

- [ ] **Step 1: Write the failing tests in `tests/stash-guard.test.js`**

Fixture: a temp repo from `tests/helpers/git-fixtures.js`'s `gitRepo()` with a committed file, git identity pinned through `env` (`GIT_AUTHOR_NAME`/`EMAIL`, `GIT_COMMITTER_NAME`/`EMAIL`); helpers `stashPush(dir, message)` (modify the file, `git -C dir stash push -q -m message`) and `stack(dir)` (raw `git -C dir stash list --format=%H%x00%gs` parsed). Invoke via `run(argv, deps)` with captured `stdout`/`stderr` and the real git runner except where a test injects one; clean temp dirs in `test.after`. Tests:

- `AC2.1: snapshot then compare with no stash change exits 0 with {"removed":[],"added":[]}` — one entry pushed, snapshot, compare: exit 0, stdout `{"removed":[],"added":[]}\n` exactly.
- `AC3.1: a git stash drop between snapshot and compare --restore exits 3, reports the sha, and restores the entry with its subject` — push two entries, snapshot, `git stash drop stash@{1}`, compare `--restore`: exit 3; `removed` equals `[{sha, subject}]` of the dropped one; `restored` is `[sha]`; afterwards `stack(dir)` contains that sha with the identical subject.
- `AC3.2: without --restore the stack is left unchanged` — same drop, compare without `--restore`: exit 3, `removed` names the sha, `stack(dir)` still lacks it, output has no `restored` key.
- `AC4.1: a forced restore failure reports restoreFailed and prints a git stash store line` — inject `deps.git` that delegates to the real runner but throws on `stash store`: exit 3, `restoreFailed[0].sha` is the dropped sha, `restored` is `[]`, and stderr has a line matching `/^git stash store -m ".*" [0-9a-f]{40}$/m`.
- `AC5.1: a subject with spaces, a colon and a quote round-trips through snapshot and compare --restore` — message `it's "quoted": a $x \`y\` test` (subject becomes `On <branch>: it's "quoted": …`); drop it; restore; restored subject `===` original. Also assert `storeCommand(subject, sha)` equals `git stash store -m "On <branch>: it's \"quoted\": a \$x \`y\` test" <sha>`.
- `added entries are reported and never popped` — snapshot, push a new entry, compare `--restore`: exit 3, `added` has it, it is still on the stack.
- `a removed entry already back on the stack before its store is reported under alreadyPresent and not stored twice` — push one entry, snapshot, drop it; inject `deps.git` delegating to the real runner that, on the pre-store `stash list` re-read, first runs the real `git -C dir stash store -m <subject> <sha>` itself (a sibling guard's restore), then delegates: exit 3, `alreadyPresent` is `[sha]`, `restored` is `[]`, and `stack(dir)` holds that sha exactly once.
- `several removed entries are all restored in their original order` — push three, snapshot, `git stash clear`, compare `--restore`: `stack(dir)` order of shas equals the baseline order.
- `an unreadable, unparseable, null, or non-sha baseline exits 2 and stores nothing` — four cases; an injected `git` that throws on `stash store` must never be reached.
- `usage errors exit 2` — no verb, unknown verb, `--repo` last with no value, `--run` with neither `--task` nor `--label`, `--task 0`, `--label Fix_Wave`, `--label` last with no value, `--label fix-wave` without `--run`, `--run` without `--restore`.
- `AC11.2: --label alone and --task with --label name the dispatch in the decisions.md line` — anchored fake run dir (as below), one drop each: `--label fix-wave` writes `— Stash guard: fix-wave dispatch removed stash entry `; `--task 2 --label review` writes `— Stash guard: review dispatch for task 2 removed stash entry `; both exit 3 and restore the entry.
- `with --run, the AUTO and FAILED lines land in decisions.md under /build` — anchored fake run dir (copy `withRunDir` from `tests/bin-lib/pre-review-catchup/cli.test.js`: fake `.git` dir at the fixture root, `deps.mainRoot` = that root, `deps.cwd` = that root), one successful restore and one injected failure: `decisions.md` holds `## /build`, an `- AUTO … — Stash guard: implementer for task 2 removed stash entry …; restored via git stash store. Reversibility: high.` line and a `- FAILED … — Stash guard: … recover with: git stash store -m "…" <sha>. Reversibility: n/a (write did not land).` line; stdout `logged: true`.
- `an unanchored --run still restores, keeps exit 3, and reports logged:false` — `--run` at a dir with no `.git` ancestor match: entry restored, exit 3, `logged: false`, `logError` set, stderr names `decisions.md`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/stash-guard.test.js`
Expected: FAIL with `Cannot find module '../plugin/bin/stash-guard'`

- [ ] **Step 3: Implement `plugin/bin/stash-guard.js`**

Header comment states verbs, envelope, exit codes, the self-logging posture and that `--out` is a create-or-overwrite with no lock. Shape follows `plugin/bin/pre-review-catchup.js`: `parseArgs(argv) -> { verb, repo, out, baseline, restore, run, task, label, help } | { error }` (flags looked up with `Object.hasOwn`; `--task` a positive integer; `--label` a lowercase hyphenated slug; `--run` requires `--restore` and at least one of `--task`/`--label`, and each of `--task`/`--label` requires `--run`); a `who(task, label)` helper builds the `{who}` text; `realDeps = { git, readFile, writeFile, cwd, mainRoot: undefined, now, appendEntries, stdout, stderr }` with `git: (args) => childProcess.execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })`.

- `readStack(git, repo)`: `git(['-C', repo, 'stash', 'list', '--no-show-signature', '--format=%H%x00%gs'])`, split on `\n`, drop empties, split each at the first `\0` (a line without one throws). `--no-show-signature` keeps a user's `log.showSignature=true` from injecting gpg text (probed: accepted by `stash list`).
- Baseline validation: an array whose every element has string `sha` matching `/^[0-9a-f]{40}([0-9a-f]{24})?$/` and string `subject`; anything else exits 2.
- `removed` = baseline entries absent from the current stack (baseline order); `added` = current entries absent from the baseline (current order).
- `--restore`: before any store, resolve the `--run` target (`resolveTarget`) and emit its stderr warning if refused (hoist the warning ahead of the write). Restore `removed` from last to first (`stash list` is newest-first, so this stores the oldest first and keeps relative order); immediately before each store, re-read the stack with `readStack` and, when the sha is already on it, push it to `alreadyPresent` and skip the store (a failed re-read falls through to the store — a duplicate costs one `git stash drop`, a skipped restore can cost the entry); otherwise `git(['-C', repo, 'stash', 'store', '-m', subject, sha])`; a throw goes to `restoreFailed` with `error` (stderr/message collapsed to one line) and `command = storeCommand(subject, sha)`, and `command` is also written to stderr on its own line after a `stash-guard.js: restore failed for <sha>; recover with:` line.
- `storeCommand(subject, sha)`: `git stash store -m "${subject.replace(/[\\"$`]/g, '\\$&')}" ${sha}`.
- Logging (only with `--run`, only when `removed` or `added` is non-empty): build the lines listed under Interfaces (AUTO via `formatEntry`, FAILED hand-composed with `hms(deps.now())` — `formatEntry` rejects `FAILED`), append them in one `deps.appendEntries({ runDir, items })` call with `section: '/build'`; a throw or refused target sets `logged: false`, `logError`, and one stderr line `stash-guard.js: could not append the decisions.md entry: …`; it never changes the exit code.
- Entry: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/stash-guard.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS (0 failures)

- [ ] **Step 5: Prove discrimination** — temporarily change the restore loop to skip the `stash store` call; `node --test tests/stash-guard.test.js` must show AC3.1 and AC5.1 red; restore the code and re-run green. Temporarily split stash lines on `' '` instead of `'\0'`; AC5.1 must go red; restore.

- [ ] **Step 6: Commit**

```bash
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4559" add plugin/bin/stash-guard.js tests/stash-guard.test.js
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4559" commit -F {message-file}
```
Message: `Add stash-guard.js — snapshot the stash stack and restore entries an implementer removed, refs #4559`

---

### Task 2: Register `stash-guard.js` as a self-logging CLI and FAILED writer

**Files:**
- Modify: `plugin/skills/_shared/auto-decision-log.md` (self-logging paragraph ~line 242; FAILED writer roster at ~line 73 "its five writers", the `STATUS` row ~line 97, the `FAILED` row ~line 156 "its five writers")
- Modify: `tests/phase-exit-call-sites-conformance.test.js:151-166` (`SELF_LOGGING_SOURCES`)
- Modify: `tests/release-run-dir-lifecycle-conformance.test.js:520-530` (`FAILED_WRITER_FACTS` pins the "five writers" counts and the `STATUS` row's writer list)
- Modify: `docs/plugin-structure.md` (CLI command list, beside the `pre-review-catchup.js` line ~204)
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (the "fourteen CLIs append their own `decisions.md` entries" sentence, ~line 43)

**Interfaces:**
- Consumes: Task 1's CLI shape and decisions.md lines.
- Produces: roster name `stash-guard.js compare`.

- [ ] **Step 1: Update the two tests** — add `'stash-guard.js compare': ['plugin/bin/stash-guard.js'],` as the last `SELF_LOGGING_SOURCES` entry; in `tests/release-run-dir-lifecycle-conformance.test.js`, change the three `FAILED_WRITER_FACTS` to `six writers` (both count pins) and the `STATUS` row pin to ``…, `release\/bookkeeping\.md`, `release\/disposition\.md` and `stash-guard\.js` rather than`` (the go-red via `assertFactsAndGoRed` stays), update the test title and message from "five" to "six", and add `assert.doesNotMatch(readText(DECISION_LOG), /its five writers/, …)` beside the existing stale "two writers" check.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/phase-exit-call-sites-conformance.test.js tests/release-run-dir-lifecycle-conformance.test.js`
Expected: FAIL after Step 1 (the listed self-loggers in auto-decision-log.md no longer equal the map's keys; the FAILED writer facts still read "five")

- [ ] **Step 3: Update the prose**
  - `auto-decision-log.md` self-logging paragraph: after `#4304's \`pre-review-catchup.js\` appends the same way.` add ` #4559's \`stash-guard.js compare\` appends the same way.` (it must sit before `A skill never re-logs`, which ends the test's capture).
  - `auto-decision-log.md` FAILED roster: the three places that name FAILED's hand-composing writers gain `stash-guard.js` (and "five writers" becomes "six writers" at both mentions); grep the file for `five` afterwards to confirm no stale count remains.
  - `auto-decision-log.md` `STATUS` row: the writer list reads ``…, `release/bookkeeping.md`, `release/disposition.md` and `stash-guard.js` rather than`` (exactly what the Step 1 pin matches).
  - `docs/plugin-structure.md`: one CLI line in the existing format, its grammar copied from Task 1's `USAGE` string (not hand-paraphrased): `node plugin/bin/stash-guard.js snapshot --repo <dir> --out <file> | compare --repo <dir> --baseline <file> [--restore [--run <run-dir> (--task <k> | --label <slug> | --task <k> --label <slug>)]]   # Stash-guard CLI (#4559) — …; exit 0 unchanged, 3 changed, 2 usage/unreadable baseline/git failure (tests in tests/stash-guard.test.js)` — `--run` only with `--restore`, and `--task`/`--label` only with `--run`.
  - `cli-wrapper-contract.md`: "fourteen CLIs" → "fifteen CLIs", add #4559's `stash-guard.js compare` to that sentence's parenthetical list and its enumerated roster.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/phase-exit-call-sites-conformance.test.js tests/release-run-dir-lifecycle-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — the five files by path. Message: `Register stash-guard.js as a self-logging CLI and FAILED writer — roster, structure doc, contract skill, refs #4559`

---

### Task 3: Hook warns on `git stash drop` and `git stash clear`

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:890-938` (`checkGitStashWarn` and its header comment)
- Modify: `tests/hooks-pre-tool-use.test.js:1316-1320` (the `#2065 … apply and drop … stay silent` test) plus new tests after it
- Modify: `docs/hooks.md:13`

**Interfaces:**
- Consumes: existing test helpers `mainAndWorktree()`, `bashInput(cmd, cwd)`, `pre.run(...)`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests** — replace the `#2065: \`git stash apply\` and \`git stash drop\` … stay silent` test with:
  - `AC7.1/AC7.3: git stash drop, drop stash@{0}, clear, and a compound git status && git stash drop from a linked worktree warn` — each of `git stash drop`, `git stash drop stash@{0}`, `git stash clear`, `git status && git stash drop`: `out.json.systemMessage` matches `/git stash is repository-wide/` and `out.json.hookSpecificOutput` is absent (warn, never deny).
  - `AC7.2: git stash list, show and apply from a linked worktree stay silent` — each `deepStrictEqual(out, {})`.
  - `#4559: git stash drop from the main checkout is silent` — `deepStrictEqual(out, {})`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "AC7|4559" tests/hooks-pre-tool-use.test.js`
Expected: FAIL after Step 1 (`git stash drop` currently returns `{}`)

- [ ] **Step 3: Implement** — in `checkGitStashWarn`, add `|| next === 'drop' || next === 'clear'` to `mutatesStack`; reword the warning to "can push onto, pop, or drop a SIBLING worktree's stash entry" (keep the `git stash is repository-wide` and `SIBLING worktree` phrases the existing tests pin); rewrite the header comment so `drop`/`clear` are named as stack-destroying (#4559) and only `list`/`show`/`apply`/`branch` stay silent, with `apply`'s reason (it changes the worktree, not the stack). In `docs/hooks.md` line 13: the gate fires on bare `git stash`, `push`/`save`/flag-first forms, `pop`, `drop` and `clear`; the silent list becomes `list`, `show`, `apply`, `branch` — no wording may call `drop` read-only.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-pre-tool-use.test.js tests/hooks-bash-prefilter.test.js`
Expected: PASS

- [ ] **Step 5: Behavior-change prose sweep (AC8.1: `docs/hooks.md` no longer describes `drop` as read-only)** — `git -C <worktree> grep -n -i -E "drop.{0,40}(read-only|silent)|(read-only|silent).{0,60}drop" -- plugin docs .claude/skills` must return no stash-related hit; fix any it finds in this task. Prove the regex matches the old text first: before Step 3's edit, `grep -n -i -E "(read-only|silent).{0,60}drop" docs/hooks.md` prints line 13. AC10.1 (`npm test` passes) is /build's Common Step 5 full run.

- [ ] **Step 6: Commit** — the three files. Message: `Warn on git stash drop and clear from a linked worktree — the stack-destroying subcommands were silent, refs #4559`

---

### Task 4: Forwarded no-stash rule names every stack-mutating form

**Files:**
- Modify: `plugin/skills/build/dispatch.md:19` (the `**Forbid \`git stash\` in every per-task implementer dispatch:**` sentence) and `:14` (the `size:` → profile mapping)
- Modify: `plugin/skills/dispatch/task-prompt.md:216-219` and `:409-412`
- Modify: `plugin/skills/dispatch/express-prompt.md:75-78`
- Modify: `tests/dispatch-no-stash-conformance.test.js`

**Interfaces:**
- Consumes: none.
- Produces: the in-file helper `noStashParagraph(region)` and the `build/dispatch.md` region it reads (its paragraph ends at the next `**` bold label — after Task 5, the Stash guard label), reused by Task 5's same-paragraph assertion. `assertNoStashRule` is Task 4's own and is not reused.

- [ ] **Step 1: Write the failing tests** — in `tests/dispatch-no-stash-conformance.test.js`:
  - add `EXPRESS_PROMPT` (read `plugin/skills/dispatch/express-prompt.md`) and an `expressCallRegion` (from `## Express call` to `## Post-merge sample review call`, anchor asserts like the existing two) to `REGIONS`;
  - `noStashParagraph(region)`: the text from `Never run \`git stash\`` to the next blank line (for `build/dispatch.md`: from `**Forbid \`git stash\` in every per-task implementer dispatch:**` to the next `**` bold label);
  - `assertNoStashRule(name, paragraph)`: asserts `/in any form/`, `` /`drop`/ ``, `` /`clear`/ ``, `` /`pop`/ ``, `` /`store`/ ``, `` /`save`/ `` and `/git show <rev>:<path>/` each match;
  - `AC1.1/AC1.2: {region} forbids git stash in any form and names drop and clear` for the three prompt regions and for `build/dispatch.md`;
  - `AC11.1: build/dispatch.md forwards the no-stash rule to every dispatch that can run git` — the existing `/Forbid \`git stash\` in every per-task implementer dispatch/` pin becomes `/Forbid \`git stash\` in every dispatch that can run git/`, and the forbid paragraph matches each member literally: `/per-task implementer/`, `/fix round/`, `/NEEDS_CONTEXT\/BLOCKED re-dispatch/`, `/fix-wave/`, `/whole-branch-fix/`, `/task reviewer/`, `/scoped re-review/`, `/final code reviewer/`; a go-red control deleting `whole-branch-fix` from the paragraph makes it throw;
  - `AC1.3: reverting one region to the old two-command wording fails the assertion` — for each region, replace its paragraph with the old text (``Never run `git stash` or `git stash pop` -- the stash stack is shared repo-wide across every worktree of this checkout, so it can pop or clobber a sibling worktree's in-flight work. To compare against a baseline without mutating the tree, use `git show <rev>:<path>`; to set your own work aside, make a temporary WIP commit instead.``) and `assert.throws(() => assertNoStashRule(...))`;
  - `AC9.1/AC9.2: build/dispatch.md keeps low → Fast and records the no-profile-floor decision` — matches ``/`low` → Fast, `medium` → Standard, `high` → Capable/`` and `/No floor raises git-running implementers to Standard \(#4559\)/`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/dispatch-no-stash-conformance.test.js`
Expected: FAIL after Step 1 (the current paragraphs name neither `drop` nor `clear`, and the build/dispatch.md label still says "every per-task implementer dispatch")

- [ ] **Step 3: Reword the four copies**
  - `task-prompt.md` (both calls) and `express-prompt.md`, keeping the `--` phrasing and ~100-column wrapping:
    ```
    Never run `git stash` in any form -- bare `git stash`/`push`, `save`, `pop`, `drop`, `clear` or
    `store`; only the read-only `git stash list` and `git stash show` are allowed. The stash stack is
    shared repo-wide across every worktree of this checkout, so any of them can pop, drop or clobber
    a sibling worktree's in-flight work. To compare against a baseline without mutating the tree, use
    `git show <rev>:<path>`; to set your own work aside, make a temporary WIP commit instead.
    ```
  - `build/dispatch.md` forbid sentence: bold label becomes `**Forbid \`git stash\` in every dispatch that can run git:**`, and the sentence reads "…to instruct every dispatch it composes that can run git — each per-task implementer, its fix rounds (a resumed or a fresh implementer) and its NEEDS_CONTEXT/BLOCKED re-dispatches, every fix-wave and whole-branch-fix implementer, and every task reviewer, scoped re-review and final code reviewer — to never run `git stash` in any form — bare `git stash`/`push`, `save`, `pop`, `drop`, `clear` and `store` alike; only the read-only `git stash list` and `git stash show` are allowed — the stash stack is shared repo-wide …" (keep the existing citation `` (`_shared/subagent-dispatch-core.md`'s no-stash rule, cited rather than restated) `` and the `git show <rev>:<path>` / WIP-commit tail).
  - `build/dispatch.md` line 14, right after the `(… from file-count heuristics).` parenthetical: "No floor raises git-running implementers to Standard (#4559): every SDD per-task implementer commits, so a floor would retire `low` → Fast and the `transcription` → Fast marker for every build, while the forwarded no-stash rule and the stash guard below cover every tier — re-propose it only with new evidence."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/dispatch-no-stash-conformance.test.js tests/dispatch-express-routing-prose.test.js`
Expected: PASS

- [ ] **Step 5: Byte check** — `wc -c plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/build/dispatch.md`; task-prompt.md must stay under 52,500 (record the number in the commit body).

- [ ] **Step 6: Commit** — the four files. Message: `Forbid git stash in any form in every forwarded no-stash rule — name drop, clear and store; record the no-profile-floor decision, refs #4559`

---

### Task 5: Controller runs the stash guard around every dispatch that can run git

**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/dispatch.md:19` (new bold label directly after the forbid sentence)
- Modify: `plugin/skills/build/handoff-template.md` (new `### Stash guard (if any)` section after `### Blocked items (if any)`)
- Modify: `plugin/skills/_shared/session-tmp-root.md` (Consumers: `**Extended (#4559):**` line)
- Modify: `tests/dispatch-no-stash-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's CLI flags (`--task`, `--label`), envelope, exit codes and decisions.md lines; Task 4's `noStashParagraph` and its build/dispatch.md region boundary.
- Produces: none.

- [ ] **Step 1: Write the failing tests** — `stashGuardParagraph(text)`: from `**Stash guard around every dispatch that can run git (#4559):**` to the next `**` bold label. Assertions (`assertStashGuardInstruction`), each member pinned as a literal (Dispatcher-voice check):
  - `AC6.1`: matches `/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/stash-guard\.js" snapshot --repo/`, `/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/stash-guard\.js" compare --repo .* --restore/`, `/immediately before (the|each) dispatch/` and `/before (that|the) task's review/`;
  - `AC11.1`: matches each dispatch kind the Decision names — `/per-task implementer dispatch/`, `/fix round/`, `/NEEDS_CONTEXT\/BLOCKED re-dispatch/`, `/fix-wave/`, `/whole-branch-fix/`, `/task reviewer/`, `/scoped re-review/`, `/final code reviewer/`;
  - `AC11.2`: matches `/--task \{k\} --label/`, `/--label fix-wave/` and `/stash-guard-\{id\}\.json/`;
  - `AC6.2`: matches `/AUTO \{time\} — Stash guard: \{who\} removed stash entr/`, `/FAILED/`, `/handoff/`, `` /a `DONE` result becomes `DONE_WITH_CONCERNS`/ ``, `` /a `NEEDS_CONTEXT` or `BLOCKED` result keeps its status/ ``, `/never popped/`;
  - `AC12.1`: matches `/verdict is void/`;
  - `AC12.2`: matches `/git status --porcelain/` and `/dispatch(es)? the (same )?review again/`;
  - `AC12.3`: the reviewer-restore sentence names the log and the handoff (`/reviewer's restore is logged like any other and listed in the handoff/`), and `handoff-template.md`'s Stash guard section matches `/verdict voided/`;
  - `AC13.1`: matches `/no stop/` in the reviewer-restore branch and does **not** match `` /report the task `BLOCKED`/ `` (the superseded behaviour);
  - `AC13.2`: matches `/with the dirty paths named/`, `/Stash guard: \{role\} for task \{k\} \{left the tree dirty after restore/` and `/--step "Stash guard" --text-file/`, and `handoff-template.md`'s Stash guard section matches `/tree dirty after restore/`;
  - `AC13.3`: matches `/verdict stands/`, and `handoff-template.md`'s Stash guard section matches `/retry verdict stands/`;
  - `AC13.4`: matches `/at most one retry per review/` and `/never a third/`;
  - `AC6.3`: go-red controls — the paragraph with the `snapshot` command deleted, separately with `whole-branch-fix` deleted, separately with the `verdict is void` sentence deleted, and separately with `verdict stands` deleted, each make `assertStashGuardInstruction` throw; and the paragraph with the old ``report the task `BLOCKED` naming the stash change`` sentence re-inserted makes it throw.
  - Same paragraph as the forbid sentence: using Task 4's `build/dispatch.md` region, the stash-guard label starts exactly where `noStashParagraph`'s forbid paragraph ends (the next `**` bold label after the forbid sentence), and both sit on the same line of `build/dispatch.md`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/dispatch-no-stash-conformance.test.js`
Expected: FAIL after Step 1 (no stash-guard paragraph yet)

- [ ] **Step 3: Write the prose** — in the forwarded-instruction voice of its neighbours ("in the same invocation instruction, also direct `/superpowers:subagent-driven-development` to…"), one paragraph appended after the forbid sentence on line 19, label `**Stash guard around every dispatch that can run git (#4559):**`:
  - the guarded set, named literally: each per-task implementer dispatch; every fix round of that task (a resumed or a fresh implementer); every NEEDS_CONTEXT/BLOCKED re-dispatch; each task reviewer and scoped re-review; the final code reviewer, its fix-wave dispatch and that fix's scoped re-review; every whole-branch-fix implementer (a pre-review catch-up repair, a ruling's targeted fix dispatch). SDD dispatches these one at a time, so each snapshot/compare pair brackets exactly one agent;
  - run `node "${CLAUDE_PLUGIN_ROOT}/bin/stash-guard.js" snapshot --repo "{worktree}" --out "{snapshot}"` immediately before the dispatch, and `node "${CLAUDE_PLUGIN_ROOT}/bin/stash-guard.js" compare --repo "{worktree}" --baseline "{snapshot}" --restore --run "$PIPELINE_RUN_DIR" {dispatch id}` as soon as it returns, before the next dispatch — for a task's implementer, before the task's review — both from the worktree root (the stash stack is repo-wide, so the controller's own worktree sees every entry);
  - `{dispatch id}`: `--task {k}` for the task's first implementer dispatch; `--task {k} --label {role}` for the task's other dispatches (`fix-{r}`, `redispatch-{r}`, `review`, `re-review-{r}`); `--label {role}` alone for a whole-branch dispatch (`final-review`, `--label fix-wave`, `fix-wave-re-review`, `whole-branch-fix-{r}`). `{id}` is `task-{k}`, `task-{k}-{role}` or `{role}` to match;
  - `{snapshot}` = `$PIPELINE_RUN_DIR/stash-guard-{id}.json` when `$PIPELINE_RUN_DIR` resolves, else the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value stash-guard-{id}.json` prints (`_shared/session-tmp-root.md`); a standalone `/build` omits `--run` and the dispatch id;
  - exit 0: nothing to do. Exit 3: the CLI already restored every removed entry with `git stash store` and, with `--run`, logged `AUTO {time} — Stash guard: {who} removed stash entr{y,ies} {sha subject …}; restored via git stash store. Reversibility: high.` under `/build` (`{who}` is `implementer for task {k}`, `{role} dispatch for task {k}` or `{role} dispatch`); a failed restore is logged as a `FAILED` line carrying its paste-ready `git stash store -m "<subject>" <sha>` command (`restoreFailed[].command`, also on stderr); an `added` entry is logged and left on the stack, never popped automatically; for an implementer or fix dispatch, a `DONE` result becomes `DONE_WITH_CONCERNS` (a `DONE_WITH_CONCERNS` stays as it is) and the stash change (shas and subjects from `removed`/`added`) is named in the next review of that work, while a `NEEDS_CONTEXT` or `BLOCKED` result keeps its status — the stash change never upgrades a failed dispatch into a reviewed one — and the stash change is named in its re-dispatch instead (the task reviewer or scoped re-review for a task's implementer or fix round, the fix wave's scoped re-review for a whole-branch fix); for a reviewer dispatch (task reviewer, scoped re-review, final code reviewer, fix-wave re-review), its verdict is void — the CLI has already restored the removed entries; run `git status --porcelain` in the worktree, and when it prints nothing, dispatch the same review again under a fresh snapshot/compare pair (role `{role}-retry`), never acting on the voided verdict; when it prints paths there is no stop either — log `AUTO {time} — Stash guard: {role} for task {k} {left the tree dirty after restore ({paths}) | changed the stash again on retry}; review dispatched once more, verdict stands. Reversibility: n/a (a detection; the controller never discards worktree changes).` (a whole-branch reviewer drops `for task {k}`) — the paths are git-derived text, so never a double-quoted `--text`: write the text after `Stash guard: ` with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value stash-guard-{id}-note.txt` prints, then `log-decision.js --run "$PIPELINE_RUN_DIR" --status AUTO --section "/build" --step "Stash guard" --text-file "{note}" --reversibility "n/a (…)"` (`_shared/auto-decision-log.md`'s Text from git or a user rule) — and dispatch the retry with the dirty paths named in its prompt; that retry's verdict stands. When the retry itself changes the stash again, the CLI has already restored it; log the same line's second form and list it in the handoff, and the retry's verdict stands — at most one retry per review, never a third dispatch, and no stop; the reviewer's restore is logged like any other and listed in the handoff; every `restoreFailed` command and `added` entry also goes into Common Step 7's handoff (`handoff-template.md`'s Stash guard section) — for a standalone `/build` the handoff is their only record; `logged: false` means the lines did not land, so the handoff carries them too;
  - exit 2 (unreadable baseline, git failure, or a failed `snapshot`): log `SKIP {time} — Stash guard: {id} {snapshot|compare} exited 2 → fallback: stash change undetected for this dispatch. Reversibility: n/a.` with `log-decision.js --status SKIP --section "/build"` (standalone: the handoff's Skipped steps);
  - no new stop: the data-preserving action runs automatically and its evidence lands in `decisions.md` and the Review Console.
  - `handoff-template.md`: `### Stash guard (if any)` — one line per failed restore (the paste-ready command on its own line), per added entry (`{sha} {subject} — left on the stack`), and per reviewer restore (`{role} for task {k}: verdict voided, {sha} {subject} restored, review dispatched again`, extended with `; tree dirty after restore: {paths}` and/or `; retry changed the stash again — retry verdict stands` when those apply); omit the section when every compare exited 0.
  - `session-tmp-root.md`: `**Extended (#4559):** \`skills/build/dispatch.md\`'s stash guard (\`stash-guard-{id}.json\`, the standalone /build snapshot path).`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/dispatch-no-stash-conformance.test.js tests/build-dispatch-subfile-table-completeness.test.js`
Expected: PASS

- [ ] **Step 5: Byte check** — `wc -c plugin/skills/build/dispatch.md plugin/skills/build/handoff-template.md`; both under 52,500 (build/dispatch.md is 36,563 B before Tasks 4–5).

- [ ] **Step 6: Commit** — the four files. Message: `Run the stash guard around every dispatch that can run git — snapshot before, compare --restore after, refs #4559`

