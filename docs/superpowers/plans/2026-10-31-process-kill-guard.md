# Process-Kill Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dispatched agents from killing processes by image/name (machine-wide blast radius) and narrow the plugin's own `lsof -ti tcp:{port}` teardowns to the listening process only.

**Architecture:** Mirror the existing no-`git stash` rule's three layers: a canonical prose paragraph in `_shared/subagent-dispatch-core.md`, a short forwarded sentence in every dispatch prompt that already forwards the no-stash rule, and a warn-tier PreToolUse gate (`checkProcessKillWarn`) whose parser lives in `git-command.js` beside `powershellOpaqueCommand` and whose program words join `GUARDED_PROGRAM_WORDS` so `bash-prefilter.js`'s derived `PRE_TOOL_USE_WORDS` reaches it.

**Tech Stack:** Markdown skill prose, Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T135322-record-4548/work/4548-spec.md` (record #4548)

## Global Constraints

- Warn only: the gate appends to `warnings` (emitted as `systemMessage`); it never sets `permissionDecision`, never throws (wrap the body in `try { … } catch { /* no warning */ }`), and a parse failure means no warning (`docs/hooks.md` never-break-a-session invariant).
- Run-independent and location-independent: no `runDir`, `runState`, or linked-worktree condition (unlike `checkGitStashWarn`).
- Must warn: `pkill node`, `killall node`, `taskkill /F /IM node.exe`, `taskkill /im node.exe /f`, `Stop-Process -Name node`. Must stay silent: `kill 12345`, `taskkill /PID 12345 /T /F`, `kill -- -12345`, `lsof -nP -iTCP:3000 -sTCP:LISTEN -t | xargs kill`.
- `PRE_TOOL_USE_WORDS` is derived (`Object.values(GUARDED_PROGRAM_WORDS).flat()`), and `bash-prefilter.js` says "No word is typed here" — add the words to `GUARDED_PROGRAM_WORDS` in `git-command.js`, never as a literal list in `bash-prefilter.js`.
- Governing skill `shell-scanner-bash-differential` (verbatim): "A new guarded program word or parser needs its own line in the differential corpus in `tests/hooks-bash-prefilter.test.js` (`docs/hooks.md`, #3092). The prefilter and the five guard parsers must agree on every command in it." — this change adds a sixth parser, so update "five" to "six" there and in `docs/hooks.md`'s Bash prefilter bullet.
- `task-prompt.md` region anchors `## First call`, `## Second call`, `None of Templates A/B/C` must not move; insert the new sentence directly after each no-stash paragraph.
- Byte rail (`RAIL_BYTES` 52,500): `plugin/skills/dispatch/task-prompt.md` is 49,154 B at base; two ~330 B sentences leave ~2,700 B headroom (near-ceiling flag, no breach). All other touched skill files are under 45 KB.
- Prohibition-vs-existing-mandate: `grep -rn "pkill\|killall\|taskkill /IM\|Stop-Process" plugin/skills` returns nothing at base — no instruction mandates a name kill, so no reconciling edit is needed. The only kill mandates are the three `lsof -ti tcp:` sites Task 2 narrows.
- Absence-grep control: `grep -rnF "lsof -ti tcp:" plugin/skills` matches 3 lines at base (`_shared/dev-url-detection.md:184`, `journey-health/deep-tier.md:42`, `wrap-up/cleanup-procedures-execution.md:322`); it must return nothing after Task 2.
- Commit messages: `{Verb} {what} — {detail}` style, `refs #4548`, never `closes`/`fixes`.

## Review Focus

1. Uppercase / mixed-case spellings: `TASKKILL /IM x`, `stop-process -name node`. Expected: `/IM` and `-Name` flags match case-insensitively; program-word lead matched case-insensitively by the parser. `stop-process` is added to the word family so the prefilter reaches it; an all-caps `TASKKILL` lead is a documented accepted miss (prefilter word match is case-sensitive — same posture as `POWERSHELL_LEADS`). Test: `stop-process -name node` warns (Task 3).
2. Git Bash path-mangling spelling `taskkill //F //IM node.exe` and dash form `taskkill -im node.exe`. Expected: warn. Test in Task 3.
3. `sudo pkill node` / `FOO=1 pkill node`. Expected: warn (assignments and a `sudo` lead with its flags are walked past). Test in Task 3.
4. A command mentioning the words as data (`echo pkill`, `grep killall file`). Expected: silent — only the segment's program position counts. Test in Task 3.
5. Compound command `npm run dev & sleep 1; pkill -f vite`. Expected: warn once (one message per command, not per segment). Test in Task 3.

## Spec Coverage Map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 1 (canonical paragraph + adjacency assertion) |
| AC2.1 | Task 1 Step 1 (four prompt regions + `build/dispatch.md` assertions) |
| AC2.2 | Task 1 Step 1 (one assertion per region, so dropping any one site fails) |
| AC2.3 | Task 1 Step 6 (go-red proof: delete from `express-prompt.md`, watch the test fail) |
| AC3.1 | Task 2 Step 1 (corpus walk for `lsof -ti tcp:`) and Task 2 Step 4 grep |
| AC3.2 | Task 2 Step 1 (three sites carry the `-sTCP:LISTEN` form) |
| AC4.1 | Task 3 Step 1 (warn cases in `tests/hooks-pre-tool-use.test.js`) |
| AC4.2 | Task 3 Step 1 (silent cases) |
| AC4.3 | Task 3 Step 1 (each case is a test in `tests/hooks-pre-tool-use.test.js`) |
| AC5.1 | Task 3 Step 1 (prefilter runs-full list + differential corpus witnesses) |
| AC6.1 | Task 3 Step 5 (docs bullet), verified by the Task 3 review |
| AC7.1 | `/build` Common Step 5 full-suite verification (`verify.js`) |

Waived plugin/bin/lib/hooks/bash-prefilter.js: read only — its `PRE_TOOL_USE_WORDS` is derived from `GUARDED_PROGRAM_WORDS`, so the words are added in `git-command.js` (Task 3) and this file needs no edit.
Waived tests/dispatch-no-stash-conformance.test.js: read only — the sibling pattern the new `tests/dispatch-no-name-kill-conformance.test.js` copies (Task 1); unchanged, and re-run in Task 1 Step 5.
Waived bin/hooks.js: read only — the Gotcha's prefilter-skip hazard is covered by Task 3's prefilter tests; no edit.

---

### Task 1: Canonical no-name-kill rule, forwarded into every dispatch prompt

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (new paragraph directly after the `**Never run \`git stash\` in any form.**` paragraph, line 45)
- Modify: `plugin/skills/build/dispatch.md` (line 19, directly after the `**Forbid \`git stash\` in every per-task implementer dispatch:**` sentence)
- Modify: `plugin/skills/dispatch/task-prompt.md` (directly after each of the two `Never run \`git stash\` or \`git stash pop\`` paragraphs, ~lines 216 and 409)
- Modify: `plugin/skills/dispatch/express-prompt.md` (directly after its no-stash paragraph, ~line 75)
- Modify: `plugin/skills/flow/multispec-parallel-waves.md` (wave-member prompt, ~line 107-110, after the `never run \`git stash\`` sentence)
- Create: `tests/dispatch-no-name-kill-conformance.test.js`

**Interfaces:**
- Produces: the literal phrase `Never kill a process by image or name` (canonical heading and every forwarded sentence) that Task 1's test and reviewers key on.

- [ ] **Step 1: Write the failing test** `tests/dispatch-no-name-kill-conformance.test.js`, modelled on `tests/dispatch-no-stash-conformance.test.js` (same `readText` helper, same `firstCallRegion`/`secondCallRegion` split for `task-prompt.md`). Collapse whitespace in every region (`s.replace(/\s+/g, ' ')`) before matching, since templates hard-wrap. Regions:
  - `task-prompt.md` first call, second call (the existing split).
  - `express-prompt.md`: from `## Express call` to `## Post-merge sample review call`.
  - `multispec-parallel-waves.md`: from `## Member prompt` to `## Failure handling`.
  For each of those four regions assert all of: `/Never kill a process by image or name/`, the literals `` `taskkill /IM` ``, `` `pkill` ``, `` `killall` ``, `` `Stop-Process -Name` ``, and `/-sTCP:LISTEN/`.
  - `build/dispatch.md`: assert `/Forbid name-based process kills in every per-task implementer dispatch/` and `/_shared\/subagent-dispatch-core\.md`'s no-name-kill rule/`.
  - `_shared/subagent-dispatch-core.md`: assert the paragraph starting `**Never kill a process by image or name.**` exists, contains the four kill literals, `-sTCP:LISTEN`, `taskkill /PID {pid} /T /F`, and `leave the process running and report it`; and assert adjacency: the paragraph immediately following the `**Never run \`git stash\` in any form.**` paragraph (split the file on `\n\n`, find the stash paragraph's index i, assert paragraph i+1 starts with `**Never kill a process by image or name.**`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js`
Expected: FAIL (every site lacks the phrase)

- [ ] **Step 3: Add the canonical paragraph** to `subagent-dispatch-core.md`, as its own paragraph right after the no-stash one, exact text:

```
**Never kill a process by image or name.** `taskkill /IM`, `pkill`, `killall`, and `Stop-Process -Name` match every process of that name on the machine, and the process table is shared machine-wide with every sibling session and worktree — one `taskkill /F /IM node.exe` takes down their dev servers and tooling along with yours (#4548). Kill only a PID you captured when you started the process, or the PID of the listener on a port you own: `lsof -nP -iTCP:{port} -sTCP:LISTEN -t` on POSIX (then `kill {pid}`), `taskkill /PID {pid} /T /F` on win32. If neither PID can be identified, leave the process running and report it rather than reaching for a broader kill.
```

- [ ] **Step 4: Forward it.** In `build/dispatch.md`, directly after the no-stash forwarding sentence (ending "…set its own work aside with a temporary WIP commit instead."), insert, in the same dispatcher voice:

```
**Forbid name-based process kills in every per-task implementer dispatch:** in the same invocation instruction, also direct `/superpowers:subagent-driven-development` to instruct each per-task implementer to never kill a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`) — the process table is shared machine-wide with every sibling session and worktree (`_shared/subagent-dispatch-core.md`'s no-name-kill rule, cited rather than restated) — and to kill only a PID it captured at start or the listener PID on a port it owns, leaving the process running and reporting it when neither can be identified.
```

  In `task-prompt.md` (both calls) and `express-prompt.md`, insert after the no-stash paragraph a new paragraph, hard-wrapped at the same ~95 columns as its neighbours, using `--` as they do:

```
Never kill a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`)
-- the process table is shared machine-wide with every sibling session and worktree, so a name
match kills their dev servers and tooling too. Kill only a PID you captured when you started the
process, or the listener on a port you own (`lsof -nP -iTCP:{port} -sTCP:LISTEN -t`; win32:
`taskkill /PID {pid} /T /F`); if you cannot identify that PID, leave the process running and
report it.
```

  In `multispec-parallel-waves.md`'s member prompt, insert the same paragraph after the "Never push, … never run `git stash`. Commit your work … LEDGER names whichever exists." paragraph.

- [ ] **Step 5: Run test to verify it passes**, plus the neighbouring pins

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js tests/dispatch-no-stash-conformance.test.js`
Expected: PASS

- [ ] **Step 6: Go-red proof.** Temporarily delete the forwarded paragraph from `express-prompt.md` only, re-run the new test, confirm exactly the express region fails, restore it (via `git show HEAD:<path>` content or re-applying the edit — never `git stash`/`git checkout`).

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/build/dispatch.md plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/multispec-parallel-waves.md tests/dispatch-no-name-kill-conformance.test.js
git commit -m "Forbid name-based process kills in dispatch prompts — refs #4548"
```

### Task 2: Listener-scoped teardowns

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/dev-url-detection.md:184`
- Modify: `plugin/skills/journey-health/deep-tier.md:42`
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md:322`
- Modify: `tests/dispatch-no-name-kill-conformance.test.js` (append)

- [ ] **Step 1: Append failing tests** to `tests/dispatch-no-name-kill-conformance.test.js`:
  - walk every `plugin/skills/**/*.md` (recursive `fs.readdirSync`) and assert none contains the literal `lsof -ti tcp:`.
  - for each of the three files above, assert it contains `` `lsof -nP -iTCP:{port} -sTCP:LISTEN -t | xargs kill` ``.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js`
Expected: FAIL naming the three files

- [ ] **Step 3: Edit the three sites**, replacing `` `lsof -ti tcp:{port} | xargs kill` `` with `` `lsof -nP -iTCP:{port} -sTCP:LISTEN -t | xargs kill` ``:
  - `dev-url-detection.md` Standalone bullet: also add, right after the command, `(the listener only — a bare \`lsof -i tcp:{port}\` also matches every client connected to the port, such as the browser driving the check)`. Keep the win32 clause `on win32, where \`lsof\` does not exist, \`taskkill /PID {pid} /T /F\`` byte-identical (`tests/ephemeral-server-handoff-conformance.test.js` pins it).
  - `deep-tier.md` step 4: command swap only.
  - `cleanup-procedures-execution.md` Section D: "the `lsof -nP -iTCP:{port} -sTCP:LISTEN -t | xargs kill` listener-scoped fallback for a stale PID is a no-lease/POSIX-only path" — keep `no-lease/POSIX-only` (`tests/dev-url-detection-lease-conformance.test.js` pins it).

- [ ] **Step 4: Verify**

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js tests/ephemeral-server-handoff-conformance.test.js tests/dev-url-detection-lease-conformance.test.js` and `grep -rnF "lsof -ti tcp:" plugin/skills`
Expected: PASS; grep prints nothing (exit 1)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/dev-url-detection.md plugin/skills/journey-health/deep-tier.md plugin/skills/wrap-up/cleanup-procedures-execution.md tests/dispatch-no-name-kill-conformance.test.js
git commit -m "Scope dev-server teardown kills to the listener — refs #4548"
```

### Task 3: Warn-tier `checkProcessKillWarn` gate and prefilter reach

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (new `PROCESS_KILL_WORDS` + `processKillByName` beside `powershellOpaqueCommand` ~line 1153-1178; new `processKill` family in `GUARDED_PROGRAM_WORDS` ~line 3078 and its header comment; export)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (import `processKillByName`; new `checkProcessKillWarn` after `checkGitStashWarn`; call it right after `checkGitStashWarn(segments, warnings);` ~line 2247)
- Modify: `docs/hooks.md` (new bullet directly after the Git-stash gate bullet, line 13; "five guard parsers" → "six guard parsers" in the Bash prefilter bullet)
- Modify: `.claude/skills/shell-scanner-bash-differential/SKILL.md:85` ("five guard parsers" → "six guard parsers")
- Test: `tests/hooks-pre-tool-use.test.js`
- Test: `tests/hooks-bash-prefilter.test.js`

**Interfaces:**
- Produces: `processKillByName(command: string, cwd: string|null) -> string[]` — one lowercased program word per segment that kills by name (empty array when none); exported from `git-command.js`.
- Produces: `PROCESS_KILL_WORDS = Object.freeze(['pkill', 'killall', 'taskkill', 'kill', 'Stop-Process', 'stop-process'])` as `GUARDED_PROGRAM_WORDS.processKill`.
- Produces: `checkProcessKillWarn(command: string|null, cwd, warnings: string[]) -> void` in `pre-tool-use.js` (not exported).

- [ ] **Step 1: Write failing tests.**
  In `tests/hooks-pre-tool-use.test.js`, after the #2065 stash block, add a `#4548` block using `pre.run({ input: bashInput(cmd, dir), runDir: null, runState: null, cwd: dir })` with `dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4548-'))` (not a git repo — proves location independence):
  - warns (`out.json.systemMessage` matches `/by image or name/` and `/-sTCP:LISTEN/`; `!(out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision)`): `pkill node`, `killall node`, `taskkill /F /IM node.exe`, `taskkill /im node.exe /f`, `Stop-Process -Name node`, `stop-process -name node`, `kill -Name node`, `taskkill //F //IM node.exe`, `taskkill -im node.exe`, `sudo pkill node`, `FOO=1 pkill node`.
  - one message for `npm run dev & sleep 1; pkill -f vite; killall node`: the systemMessage contains `by image or name` exactly once.
  - silent (`!out.json || !/by image or name/.test(out.json.systemMessage || '')`): `kill 12345`, `taskkill /PID 12345 /T /F`, `kill -- -12345`, `kill -9 12345`, `lsof -nP -iTCP:3000 -sTCP:LISTEN -t | xargs kill`, `echo pkill`, `grep killall notes.txt`.
  In `tests/hooks-bash-prefilter.test.js`:
  - import `processKillByName`; add `(c) => processKillByName(c, CWD).map((w) => ({ action: w }))` to `PARSERS_BY_EVENT['pre-tool-use']` only.
  - add corpus lines `'pkill node'`, `'killall node'`, `'taskkill /F /IM node.exe'`, `'kill -Name node'`, `'Stop-Process -Name node'`, `'stop-process -name node'` (each is the sole-trigger witness for its word).
  - add `'pkill node'`, `'killall node'`, `'taskkill /F /IM node.exe'` to the "pre-tool-use runs the full handler for" list, and `'pkill node'` to a new assertion that `shouldRunFull('post-tool-use', bash('pkill node')) === false` (post-tool-use stays git-only).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-pre-tool-use.test.js tests/hooks-bash-prefilter.test.js`
Expected: FAIL (`processKillByName` is not a function / no warning / prefilter skips `pkill node`)

- [ ] **Step 3: Implement `processKillByName`** in `git-command.js`, shaped like `powershellOpaqueCommand`: cheap precheck `if (!/kill|stop-process/i.test(command)) return [];`, then `forEachCommandSegment(command, cwd, (t, _cwd, quoting, again) => …)` (skip `again` repeat visits). Per segment: skip `SIMPLE_ASSIGNMENT_RE` tokens; if the lead normalizes to `sudo`, skip it and any following `-`-prefixed tokens. Normalize the lead as `isPowershellLead` does (lowercase, strip `.exe`, basename on `/` and `\`). Then:
  - `pkill`, `killall` → match.
  - `taskkill` → match when any later token matches `/^(\/\/?|-)im$/i`.
  - `kill`, `stop-process` → match when any later token matches `/^-(name|processname)(:.*)?$/i`.
  Push the normalized lead per matching segment. Header comment: names #4548, the warn-only posture, that every lead here is a `GUARDED_PROGRAM_WORDS.processKill` word, and that an all-caps lead (`TASKKILL`) is an accepted miss because the prefilter word match is case-sensitive. Add the `processKill` family to `GUARDED_PROGRAM_WORDS` and a line for it in that constant's family comment (`processKill: processKillByName's leads — pre-tool-use only; post-tool-use stays git-scoped`). Export `processKillByName` and `PROCESS_KILL_WORDS`.

- [ ] **Step 4: Implement `checkProcessKillWarn`** in `pre-tool-use.js`: returns early when `command` is falsy; inside `try`, if `processKillByName(command, cwd).length` push one message; `catch` swallows. Message text (exact):

```
claude-tweaks: killing a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`) matches every process of that name on this machine — the process table is shared with every sibling session and worktree, so it can take down their dev servers and tooling. Kill only a PID you captured when you started the process, or the listener on a port you own (`lsof -nP -iTCP:{port} -sTCP:LISTEN -t`, then `kill {pid}`; win32: `taskkill /PID {pid} /T /F`).
```

  Call it as `checkProcessKillWarn(command, ctx.cwd, warnings);` on the line after `checkGitStashWarn(segments, warnings);`. Comment above the function: warn-only, run- and location-independent because the hazard is machine-wide (contrast with `checkGitStashWarn`'s linked-worktree condition), and reachable only because `GUARDED_PROGRAM_WORDS.processKill` feeds the prefilter.

- [ ] **Step 5: Docs.** In `docs/hooks.md`, after the Git-stash bullet, add a `**Process-kill-by-name gate (warn tier, #4548):**` bullet: `pre-tool-use.js`'s `checkProcessKillWarn` (parser `git-command.js`'s `processKillByName`) fires on a Bash segment led by `pkill` or `killall`, `taskkill` with an `/IM` token (case-insensitive, any position, `//IM` and `-im` too), or `kill`/`Stop-Process` with `-Name`/`-ProcessName`; warn-only `systemMessage` naming the shared machine-wide process table and the PID-scoped alternative; run- and location-independent; never fires on `kill {pid}`, `kill -- -{pid}`, or `taskkill /PID`; its words are `GUARDED_PROGRAM_WORDS.processKill`, so the prefilter reaches a bare `pkill node`. Change "five guard parsers" to "six guard parsers" in the Bash prefilter bullet and in `.claude/skills/shell-scanner-bash-differential/SKILL.md` line 85.

- [ ] **Step 6: Run to verify they pass**, plus the gate-coverage neighbours

Run: `node --test tests/hooks-pre-tool-use.test.js tests/hooks-bash-prefilter.test.js tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js`
Expected: PASS

- [ ] **Step 7: Go-red proofs.** (a) Remove `processKill` from `GUARDED_PROGRAM_WORDS` and confirm the prefilter tests fail (`pkill node` skipped, witness missing); restore. (b) Make `checkProcessKillWarn` a no-op and confirm the warn cases fail; restore.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js plugin/bin/lib/hooks/pre-tool-use.js docs/hooks.md .claude/skills/shell-scanner-bash-differential/SKILL.md tests/hooks-pre-tool-use.test.js tests/hooks-bash-prefilter.test.js
git commit -m "Warn on name-based process kills in PreToolUse — refs #4548"
```
