# Process-Kill Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dispatched agents from killing processes by image/name (machine-wide blast radius), narrow the plugin's own `lsof -ti tcp:{port}` teardowns to the listening process, and back the rule with a warn-tier PreToolUse gate that also catches the `pgrep`-fed, non-PID `/FI`, `Get-Process | Stop-Process`, and wrapped (`powershell -Command`/`pwsh -c`/`cmd /c`/`sh -c`/`bash -c`) spellings, case-insensitively.

**Architecture:** Mirror the no-`git stash` rule's three layers: a canonical paragraph in `_shared/subagent-dispatch-core.md`, a short forwarded paragraph in every dispatch prompt that forwards the no-stash rule, and a warn-only PreToolUse gate (`checkProcessKillWarn`). The gate's parser `processKillByName` lives in `git-command.js` beside `powershellOpaqueCommand` and recurses into a wrapper's command-string argument; its program words join `GUARDED_PROGRAM_WORDS` as a new `processKill` family so `bash-prefilter.js`'s derived `PRE_TOOL_USE_WORDS` reaches it, and the prefilter matches that family (only) case-insensitively. `task-prompt.md` has 27 B of rail headroom, so its lazy Continuation-call section moves to its own file first.

**Tech Stack:** Markdown skill prose, Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T191312-record-4548/work/4548-spec.md` (record #4548; supersedes this plan's 2026-10-31 revisions, which predated the wrapper and any-non-PID-`/FI` Decision bullets and the #4559 merge that reworded the no-stash anchors)

## Global Constraints

- Warn only: the gate appends to `warnings` (emitted as `systemMessage`); it never sets `permissionDecision`, never throws (body wrapped in `try { … } catch { /* no warning */ }`), and a parse failure means no warning (`docs/hooks.md` never-break-a-session invariant).
- Run-independent and location-independent: no `runDir`, `runState`, or linked-worktree condition (unlike `checkGitStashWarn`), because the hazard is machine-wide.
- Must warn (AC4 + Decisions): `pkill node`, `killall node`, `taskkill /F /IM node.exe`, `taskkill /im node.exe /f`, `Stop-Process -Name node`, `kill $(pgrep node)`, `pgrep -f x | xargs kill`, `taskkill /FI "IMAGENAME eq node.exe"`, `taskkill /FI "WINDOWTITLE eq dev*"`, `Get-Process node | Stop-Process`, `TASKKILL /IM node.exe`, `Stop-process -Name node`, and each wrapper: `powershell -Command "Stop-Process -Name node"`, `powershell -c "Stop-Process -Name node"`, `pwsh -Command "Get-Process node | Stop-Process"`, `pwsh -c "Stop-Process -Name node"`, `cmd /c taskkill /IM node.exe`, `sh -c 'pkill node'`, `bash -c "killall node"`. Must stay silent: `kill 12345`, `taskkill /PID 12345 /T /F`, `kill -- -12345`, `taskkill /FI "PID eq 123"`.
- Decision (plan review, 2026-10-31), verbatim: "The command names of these kill forms match case-insensitively (`TASKKILL`, `Stop-process`), since `taskkill` and PowerShell cmdlets are case-insensitive on Windows. The hook's pre-check is case-insensitive for these words only, with a `TASKKILL /IM node.exe` test." — the git/mkdir/write/powershell families keep their case-sensitive prefilter match.
- Decision (plan review, 2026-10-31), verbatim: "The hook also scans the quoted command argument of `powershell -Command`/`-c`, `pwsh -Command`/`-c`, `cmd /c`, `sh -c` and `bash -c` with the same name-kill matcher, with a test per wrapper."
- Decision (plan review, 2026-10-31), verbatim: "Any `taskkill /FI` filter other than a PID filter warns, not only `IMAGENAME`." Chosen behaviour (closing rule: implementer judgment, recorded here): a filter is a PID filter, and silent, only when its text is `PID eq {digits}` (case-insensitive); a range PID filter (`PID ne 0`, `PID gt 100`) matches many processes and warns.
- Wrapped kills need no new prefilter words: `commandWords` splits on whitespace without reading quotes, so `sh -c 'pkill node'` already yields `pkill`, `cmd /c taskkill …` yields `taskkill`, and `powershell`/`pwsh` are already `GUARDED_PROGRAM_WORDS.powershell`. Task 4 pins each wrapper through `shouldRunFull` anyway.
- `PRE_TOOL_USE_WORDS` is derived (`Object.values(GUARDED_PROGRAM_WORDS).flat()`) and `bash-prefilter.js` says "No word is typed here" — add the words to `GUARDED_PROGRAM_WORDS` in `git-command.js`, never as a literal list in `bash-prefilter.js`. `bash-prefilter.js` does change, but only to add the case-insensitive comparison for `GUARDED_PROGRAM_WORDS.processKill`.
- Governing skill `shell-scanner-bash-differential` (verbatim): "A new guarded program word or parser needs its own line in the differential corpus in `tests/hooks-bash-prefilter.test.js` (`docs/hooks.md`, #3092). The prefilter and the five guard parsers must agree on every command in it." — this change adds a sixth parser, so "five" becomes "six" there, in `docs/hooks.md`'s Bash prefilter bullet, and in `plugin/skills/_shared/policy-schema-coverage.md`'s parser enumeration.
- Governing skill `shell-scanner-bash-differential` (verbatim): "Test titles name the record and the behavior (`#4149: …`), never review-round labels (m1, F2, round N)." — every new test title starts `#4548:`.
- Governing skill `skill-prose-conformance-tests` (verbatim): "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt."
- Governing skill `pre-tool-use-gate-exemptions` governs deny gates and their exemptions; this gate is warn-only and carries no exemption, so none of its rules bind — no deny path may be added.
- `task-prompt.md` region anchors `## First call`, `## Second call`, `None of Templates A/B/C`, and the `## Continuation call` heading must not move; the new paragraph goes directly after each no-stash paragraph.
- Byte rail (`RAIL_BYTES` 52,500, `plugin/bin/lib/skill-audit/budgets.js`). Measured after the 2026-11-01 catch-up merge: `task-prompt.md` 52,473 B (27 B headroom — the remedy is Task 2: move the lazy Continuation-call body, read only on `OUTCOME: handoff`, to `dispatch/continuation-call.md`, 1,030 B out, 114 B pointer in), then Task 3's two 371 B paragraphs land it at 52,299 B (201 B headroom; #4831 owns restoring ≥250 B by deduplicating the wait rule — not this record). `build/dispatch.md` 45,666 B → ~46,300 B. `subagent-dispatch-core.md` 37,495 B → ~38,400 B; it composes with `run-dir-resolution.md` into the review-dispatch bundle (`plan-audit.js` measures 51,065 B at base), ~52,015 B after Task 1 — under the rail by ~485 B; Task 1 Step 5's `review-dispatch-composition` run and the `rail:` suites catch a breach, and the canonical paragraph is not lengthened beyond the given text. Every other touched skill file is under 45,000 B. Keep each paragraph to the text given.
- Prohibition-vs-existing-mandate: `grep -rniE "pkill|killall|taskkill /IM|taskkill /FI|Stop-Process|pgrep|pidof" plugin/skills plugin/agents` returns nothing at base — no instruction mandates a name kill. The only kill mandates are the three `lsof -ti tcp:` sites Task 4 narrows; `kill {pid}` and `kill -- -{pid}` in `wrap-up/cleanup-procedures-execution.md` Section D are PID-scoped and stay.
- Absence-grep control: `grep -rnF "lsof -ti tcp:" plugin/skills` matches 3 lines at base (`_shared/dev-url-detection.md:184`, `journey-health/deep-tier.md:42`, `wrap-up/cleanup-procedures-execution.md:321`, re-measured after the merge); it must return nothing after Task 4.
- Sibling work: #4589 (draft PR #4858, a sibling session) will render `task-prompt.md`'s fenced blocks through a CLI; this plan edits prose beside the fenced blocks, not their content, beyond inserting one paragraph inside each. The pre-review catch-up resolves any textual conflict.
- Commit messages: `{Verb} {what} — {detail}` style, `refs #4548`, never `closes`/`fixes`; end each with `Claude-Session: https://claude.ai/code/session_016yg3zoAQvBoSL4MJGrJGi7`.

## Review Focus

1. `sudo -u root pkill node`, `FOO=1 pkill node`, `timeout 10 pkill node`, `env pkill node`, `nohup killall node`: warn — assignments and the command wrappers (`sudo`, `doas`, `env`, `nice`, `time`, `nohup`, `command`, `exec`, `timeout`) with their value flags are walked past. Test in Task 5. Recorded, not matched (narrow-miss posture, as `powershellOpaqueCommand` takes): PowerShell aliases and abbreviations (`spps`, `gps`, `-n` for `-Name`), and a `pgrep` outside a wrapper arming a `kill` inside it (`pgrep node | xargs -I{} sh -c 'kill {}'`).
2. `pgrep node | xargs -n 1 kill` and `P=$(pgrep node); kill $P`: warn — `xargs` and its value flags (`-I`, `-n`, `-P`, `-L`, `-d`, `-E`, `-s`, `-a`) are walked past, and a `pgrep` anywhere in the command arms every `kill`-led segment. Test in Task 5.
3. Data mentions and benign wrappers: `echo pkill`, `grep killall notes.txt`, `echo "$(pgrep node)"`, `pgrep node` alone, `bash script.sh`, `sh -c 'echo pkill'`, `bash -c 'kill 123'`, `powershell -File kill.ps1`: silent — only a segment's program position counts, and a wrapper's argument is judged by the same matcher. Test in Task 5.
4. PID-scoped forms that look close: `kill $(lsof -nP -iTCP:3000 -sTCP:LISTEN -t)`, `lsof -nP -iTCP:3000 -sTCP:LISTEN -t | xargs kill`, `Get-Process -Id 123 | Stop-Process`, `taskkill /FI "PID eq 123"`, `Stop-Process -Id 123`: silent; `taskkill /FI "PID ne 0"`: warns (a range). Test in Task 5.
5. Nesting and compounds: `bash -c "sh -c 'pkill node'"` warns (recursion), the recursion is depth-capped so a pathological nest never throws, and `npm run dev & sleep 1; pkill -f vite; killall node` yields exactly one warning message per command. Test in Tasks 5 and 6.

## Spec Coverage Map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 1 (canonical paragraph + adjacency assertion) |
| AC2.1 | Task 1 Step 1 (`build/dispatch.md`) and Task 3 Step 1 (four prompt regions) |
| AC2.2 | Task 3 Step 1 (one assertion per region, so dropping any one site fails) |
| AC2.3 | Task 3 Step 5 (go-red proof: delete from `express-prompt.md`, watch the test fail) |
| AC3.1 | Task 4 Step 1 (corpus walk for `lsof -ti tcp:`) and Task 4 Step 4 grep |
| AC3.2 | Task 4 Step 1 (three sites carry the `-sTCP:LISTEN` form) |
| AC4.1 | Task 6 Step 1 (warn cases in `tests/hooks-pre-tool-use.test.js`) |
| AC4.2 | Task 6 Step 1 (silent cases) |
| AC4.3 | Task 6 Step 1 (each case is its own test in `tests/hooks-pre-tool-use.test.js`) |
| AC5.1 | Task 5 Step 1 (prefilter runs-full list, differential corpus witnesses, `earlyGate` case) |
| AC6.1 | Task 6 Step 5 (docs bullet), verified by the Task 6 review |
| AC7.1 | `/build` Common Step 5 full-suite verification (`verify.js`) |
| AC8.1 | Task 5 Step 1 (parser cases) and Task 6 Step 1 (handler cases) for `kill $(pgrep node)`, `pgrep -f x \| xargs kill`, `taskkill /FI "IMAGENAME eq node.exe"`, `Get-Process node \| Stop-Process` |
| AC8.2 | Task 6 Step 1 (one test per form) |
| AC9.1 | Task 5 Step 1 (`TASKKILL /IM node.exe`, `Stop-process -Name node` parser + prefilter cases) |
| AC9.2 | Task 5 Step 1 (prefilter case-insensitive for processKill words, still case-sensitive for `GIT commit`) and Task 6 Step 1 (`TASKKILL /IM node.exe` handler test) |
| AC10.1 | Task 5 Step 1 (one parser case per wrapper) and Task 6 Step 1 (one handler test per wrapper) |
| AC11.1 | Task 5 Step 1 (`WINDOWTITLE`/`USERNAME`/`STATUS` filters warn, `PID eq` silent) and Task 6 Step 1 (`taskkill /FI "WINDOWTITLE eq dev*"` handler test) |

Waived AC8.3: provenance note ("Plan-review Q1: Reading B."), not a behavior — nothing to test.
Waived AC9.3: provenance note ("Q2: Reading B."), not a behavior — nothing to test.
Waived AC10.2: provenance note (the plan-review question it answers), not a behavior — nothing to test.
Waived AC11.2: provenance note (the plan-review question it answers), not a behavior — nothing to test.
Waived AC12.1: the closing rule governs plan review and the chosen edge behaviours recorded in Global Constraints, not code — nothing to test.
Waived AC12.2: as AC12.1.
Waived AC12.3: as AC12.1.
Waived tests/dispatch-no-stash-conformance.test.js: read only — the sibling pattern the new `tests/dispatch-no-name-kill-conformance.test.js` copies; unchanged, re-run in Tasks 1 and 3.
Waived bin/hooks.js: read only — the Gotcha's prefilter-skip hazard is covered by Task 5's `shouldRunFull`/`earlyGate` tests; no edit.

---

### Task 1: Canonical no-name-kill rule and its `build/dispatch.md` forwarding

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (new paragraph directly after the `**Never run \`git stash\` in any form.**` paragraph, line 45)
- Modify: `plugin/skills/build/dispatch.md` (line 19, directly after the `**Forbid \`git stash\` in every dispatch that can run git:**` sentence, which ends "…or set its own work aside with a temporary WIP commit instead.", and before `**Stash guard around every dispatch that can run git (#4559):**`)
- Create: `tests/dispatch-no-name-kill-conformance.test.js`

**Interfaces:**
- Produces: the literal phrase `Never kill a process by image or name` (canonical heading and every forwarded paragraph) that Tasks 3–4 extend the same test file around. Produces helper `flat(s) = s.replace(/\s+/g, ' ')` and `readText` usage (`./helpers/read-skill`) in the new test file.

- [ ] **Step 1: Write the failing test** `tests/dispatch-no-name-kill-conformance.test.js`, modelled on `tests/dispatch-no-stash-conformance.test.js`. Collapse whitespace before matching (`flat`). Tests (AC1.1, AC2.1):
  - `#4548: subagent-dispatch-core.md carries the no-name-kill paragraph right after the no-stash paragraph` — via a helper `nameKillFollowsStash(text) -> boolean`: split on `\n\n`, find index i of the paragraph starting `**Never run \`git stash\` in any form.**`, return whether paragraph i+1 starts with `**Never kill a process by image or name.**`. Assert it is `true` on the live file, and that the paragraph contains the literals `` `taskkill /IM` ``, `` `pkill` ``, `` `killall` ``, `` `Stop-Process -Name` ``, `-sTCP:LISTEN`, `taskkill /PID {pid} /T /F`, and `leave the process running and report it`.
  - Frozen control (skill-prose-conformance-tests): a `PRE_CHANGE_CORE` constant holding the base file's line 45 (the no-stash paragraph) verbatim, then `\n\n## Foreground Execution Discipline` (the heading that follows it at base). Assert `nameKillFollowsStash(PRE_CHANGE_CORE) === false` — the same helper the live assertion calls.
  - `#4548: build/dispatch.md forwards the no-name-kill rule to every dispatch that can run commands` — assert `/\*\*Forbid name-based process kills in every dispatch that can run commands:\*\*/`, `` /_shared\/subagent-dispatch-core\.md`'s no-name-kill rule/ ``, and that its index sits after the `**Forbid \`git stash\`` label and before the `**Stash guard around every dispatch` label.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js`
Expected: FAIL (neither file carries the rule)

- [ ] **Step 3: Add the canonical paragraph** to `subagent-dispatch-core.md`, as its own paragraph right after the no-stash one, exact text:

```
**Never kill a process by image or name.** `taskkill /IM`, `pkill`, `killall`, and `Stop-Process -Name` — and their equivalents, a `pgrep`-fed `kill`, `taskkill /FI` with any non-PID filter, `Get-Process … | Stop-Process` — match every process of that name on the machine, and the process table is shared machine-wide with every sibling session and worktree: one `taskkill /F /IM node.exe` takes down their dev servers and tooling along with yours (#4548). Kill only a PID you captured when you started the process, or the PID of the listener on a port you own: `lsof -nP -iTCP:{port} -sTCP:LISTEN -t` on POSIX (then `kill {pid}`), `taskkill /PID {pid} /T /F` on win32. If neither PID can be identified, leave the process running and report it rather than reaching for a broader kill. The PreToolUse hook warns on these shapes, wrapped in `sh -c`/`cmd /c`/`powershell -Command` too (`docs/hooks.md`), but the warning lands after the command has run.
```

- [ ] **Step 4: Forward it in `build/dispatch.md`** — insert, after the no-stash forbid sentence and a single space, in the same dispatcher voice:

```
**Forbid name-based process kills in every dispatch that can run commands:** in the same invocation instruction, also direct `/superpowers:subagent-driven-development` to instruct every dispatch it composes that can run commands — each per-task implementer, its fix rounds and re-dispatches, every fix-wave and whole-branch-fix implementer, and every reviewer — to never kill a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`, or a `pgrep`-fed `kill`) — the process table is shared machine-wide with every sibling session and worktree (`_shared/subagent-dispatch-core.md`'s no-name-kill rule, cited rather than restated) — and to kill only a PID it captured at start or the listener PID on a port it owns, leaving the process running and reporting it when neither can be identified.
```

- [ ] **Step 5: Run test to verify it passes**, plus the neighbouring pins and the review-dispatch bundle rail

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js tests/dispatch-no-stash-conformance.test.js tests/review-dispatch-composition.test.js tests/build-dispatch-subfile-table-completeness.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/build/dispatch.md tests/dispatch-no-name-kill-conformance.test.js
git commit -m "Add the canonical no-name-kill dispatch rule — refs #4548"
```

### Task 2: Move `task-prompt.md`'s lazy Continuation-call body to its own file (rail headroom)

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (the `## Continuation call — after \`OUTCOME: handoff\` (#4027)` section, lines 547-549: keep the heading, replace the body with a pointer)
- Create: `plugin/skills/dispatch/continuation-call.md`
- Modify: `tests/dispatch-handoff-continuation-conformance.test.js` (line 47-48: the continuation-section region reads the new file)
- Modify: `tests/dispatch-resume-prose.test.js` (line 398-400: the "Continuation call paragraph is not edited" pin reads the new file)
- Modify: `docs/plugin-structure.md` (line 124, the `dispatch` sub-file row: add `continuation-call.md` to the file list, and in the prose change "its Continuation call section is the same call's template re-inlined with the step list replaced by that `NEXT_STEPS` value" to say the section points at `continuation-call.md`, which holds that rule)

**Interfaces:**
- Produces: `plugin/skills/dispatch/continuation-call.md`, holding the moved paragraph; `task-prompt.md` keeps the heading so every "task-prompt.md's Continuation call" citation (`docs/skill-graph.md:238`, `two-call-gate.md` §8, `task-prompt.md:145`) still resolves.

- [ ] **Step 1: Re-point the two tests (failing first).** In `tests/dispatch-handoff-continuation-conformance.test.js`, the second test reads `read('continuation-call.md')` and takes `region(t, '# Dispatch Step 5 — Continuation call', null, …)`, keeping every assertion; add `#4548: task-prompt.md's Continuation call heading points at continuation-call.md` asserting `/## Continuation call — after `OUTCOME: handoff` \(#4027\)\n\nRead `continuation-call\.md` in this skill's directory\./` on `task-prompt.md`. In `tests/dispatch-resume-prose.test.js`, the "is not edited" test reads `plugin/skills/dispatch/continuation-call.md` instead of `TASK_PROMPT` (same regex).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dispatch-handoff-continuation-conformance.test.js tests/dispatch-resume-prose.test.js`
Expected: FAIL (`continuation-call.md` does not exist)

- [ ] **Step 3: Move the text.** Create `continuation-call.md` with exactly: a `# Dispatch Step 5 — Continuation call (#4027)` heading, a blank line, `Read by the dispatching session when a call reports \`OUTCOME: handoff\` (\`two-call-gate.md\` section 8).`, a blank line, then the current `task-prompt.md` line 549 paragraph verbatim except one deictic re-resolution: "that call's own template above" becomes "that call's own template in `task-prompt.md`" (the template is no longer above it). In `task-prompt.md`, the section becomes exactly the heading, a blank line, and `Read \`continuation-call.md\` in this skill's directory.` with a trailing newline.

- [ ] **Step 4: Verify** — the moved prose and the citations

Run: `node --test tests/dispatch-handoff-continuation-conformance.test.js tests/dispatch-resume-prose.test.js tests/skill-catalog-completeness.test.js` and `wc -c plugin/skills/dispatch/task-prompt.md`
Expected: PASS; `wc -c` prints 51,557 (±5).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/continuation-call.md tests/dispatch-handoff-continuation-conformance.test.js tests/dispatch-resume-prose.test.js docs/plugin-structure.md
git commit -m "Move dispatch's Continuation-call rule to its own file — refs #4548"
```

### Task 3: Forward the rule into the three literal prompt templates

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (directly after each of the two `Never run \`git stash\` in any form --` paragraphs, lines 237-241 and 438-442)
- Modify: `plugin/skills/dispatch/express-prompt.md` (directly after its no-stash paragraph, lines 85-89)
- Modify: `plugin/skills/flow/multispec-parallel-waves.md` (member prompt, after the paragraph at lines 107-111 that ends "LEDGER names whichever exists.")
- Modify: `tests/dispatch-no-name-kill-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's test file and `flat` helper; Task 2's headroom.

- [ ] **Step 1: Append failing tests** (AC2.1, AC2.2). Regions (each `flat`-ened before matching):
  - `task-prompt.md` first call (`## First call` → `## Second call`) and second call (`## Second call` → `None of Templates A/B/C`), the split `tests/dispatch-no-stash-conformance.test.js` uses, with the same anchor-lost assertions.
  - `express-prompt.md`: `## Express call` → `## Post-merge sample review call`.
  - `multispec-parallel-waves.md`: `## Member prompt` → `## Failure handling`.
  One test per region, titled `#4548: {region name} forbids name-based process kills`, all calling one helper `assertNameKillRule(region)` that asserts `/Never kill a process by image or name/`, the literals `` `taskkill /IM` ``, `` `pkill` ``, `` `killall` ``, `` `Stop-Process -Name` ``, `` `pgrep` ``, and `/-sTCP:LISTEN/`. Frozen control: a `PRE_CHANGE_EXPRESS` constant holding `express-prompt.md`'s current no-stash paragraph (lines 85-89) verbatim; assert `assert.throws(() => assertNameKillRule(flat(PRE_CHANGE_EXPRESS)))`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js`
Expected: FAIL naming all four regions

- [ ] **Step 3: Insert the paragraph** at all four sites, as its own paragraph (blank line before and after), hard-wrapped exactly like this:

```
Never kill a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`,
a `pgrep`-fed `kill`): the process table is shared machine-wide with sibling sessions. Kill only
a PID you started or your own port's listener (`lsof -nP -iTCP:{port} -sTCP:LISTEN -t`; win32:
`taskkill /PID {pid} /T /F`); otherwise leave the process running and report it.
```

- [ ] **Step 4: Run to verify it passes**, plus the neighbouring pins on these files

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js tests/dispatch-no-stash-conformance.test.js tests/dispatch-worktree-anchoring.test.js tests/foreground-execution-instruction.test.js tests/dispatch-express-routing-prose.test.js tests/dispatch-handoff-continuation-conformance.test.js` and `wc -c plugin/skills/dispatch/task-prompt.md`
Expected: PASS; `wc -c` prints 52,299 (±5), under 52,500.

- [ ] **Step 5: Go-red proof (AC2.3).** Delete the inserted paragraph from `express-prompt.md` only, re-run `node --test tests/dispatch-no-name-kill-conformance.test.js`, confirm exactly the express-prompt region test fails, then restore the paragraph by re-applying the Step 3 edit (never `git stash`/`git checkout`). Quote the failing test name in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/multispec-parallel-waves.md tests/dispatch-no-name-kill-conformance.test.js
git commit -m "Forward the no-name-kill rule into every dispatch prompt — refs #4548"
```

### Task 4: Listener-scoped teardowns

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/dev-url-detection.md:184`
- Modify: `plugin/skills/journey-health/deep-tier.md:42`
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md:321`
- Modify: `tests/dispatch-no-name-kill-conformance.test.js` (append)

- [ ] **Step 1: Append failing tests** (AC3.1, AC3.2):
  - `#4548: no skill file uses the client-matching lsof -ti tcp: kill` — a helper `filesContaining(root, literal)` walks every `plugin/skills/**/*.md` (recursive `fs.readdirSync`) and returns the relative paths whose text includes `lsof -ti tcp:`; assert it returns `[]`. Control: write a temp dir (`fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4548-'))`) with one `.md` holding `lsof -ti tcp:3000 | xargs kill` and assert the same helper returns that file.
  - `#4548: the three teardown sites use the listener-scoped form` — for each of the three files, assert it contains `` `lsof -nP -iTCP:{port} -sTCP:LISTEN -t | xargs kill` ``.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js`
Expected: FAIL naming the three files

- [ ] **Step 3: Edit the three sites**, replacing `` `lsof -ti tcp:{port} | xargs kill` `` with `` `lsof -nP -iTCP:{port} -sTCP:LISTEN -t | xargs kill` ``:
  - `dev-url-detection.md` Standalone bullet: also add, right after the command, `(the listener only — a bare \`lsof -i tcp:{port}\` also matches every client connected to the port, such as the browser driving the check)`. Keep the clause `on win32, where \`lsof\` does not exist, \`taskkill /PID {pid} /T /F\`` byte-identical (`tests/ephemeral-server-handoff-conformance.test.js` pins it). This bullet is in `### Cleanup`, outside Step 2.7, so `tests/dev-url-detection-lease-conformance.test.js`'s Step 2.7 lsof-position check is unaffected.
  - `deep-tier.md` step 4: command swap only.
  - `cleanup-procedures-execution.md` Section D: "the `lsof -nP -iTCP:{port} -sTCP:LISTEN -t | xargs kill` listener-scoped fallback for a stale PID is a no-lease/POSIX-only path" — keep `no-lease/POSIX-only` and `kill {pid}` … `with a port-isolation lease` (`tests/dev-url-detection-lease-conformance.test.js` pins both).

- [ ] **Step 4: Verify**

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js tests/ephemeral-server-handoff-conformance.test.js tests/dev-url-detection-lease-conformance.test.js` and `grep -rnF "lsof -ti tcp:" plugin/skills`
Expected: PASS; grep prints nothing (exit 1)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/dev-url-detection.md plugin/skills/journey-health/deep-tier.md plugin/skills/wrap-up/cleanup-procedures-execution.md tests/dispatch-no-name-kill-conformance.test.js
git commit -m "Scope dev-server teardown kills to the listener — refs #4548"
```

### Task 5: `processKillByName` parser (wrappers included) and case-insensitive prefilter reach

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (new `PROCESS_KILL_WORDS` + `processKillByName` after `powershellOpaqueCommand`, which ends at line 1177; new `processKill` family in `GUARDED_PROGRAM_WORDS` at lines 3078-3083 plus its line in the family comment above it; export both)
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js` (case-insensitive match for `GUARDED_PROGRAM_WORDS.processKill`, pre-tool-use only; header comment)
- Test: `tests/hooks-git-command.test.js`
- Test: `tests/hooks-bash-prefilter.test.js`

**Interfaces:**
- Produces: `PROCESS_KILL_WORDS = Object.freeze(['pkill', 'killall', 'taskkill', 'kill', 'stop-process'])` (all lowercase), exposed as `GUARDED_PROGRAM_WORDS.processKill`.
- Produces: `processKillByName(command: string, cwd: string|null) -> string[]` — one lowercased label per kill-by-name segment (`'pkill'`, `'killall'`, `'taskkill'`, `'kill'`, `'stop-process'`), a wrapper segment contributing its inner command's labels, empty array when none; never throws on a string input. Exported from `git-command.js`.

- [ ] **Step 1: Write failing tests.**
  In `tests/hooks-git-command.test.js`, a `// ─── processKillByName (#4548) ───` block. `const hit = (c) => processKillByName(c, '/repo').length > 0;`
  - `#4548: processKillByName flags image- and name-based kills` — `hit` true for: `pkill node`, `killall node`, `taskkill /F /IM node.exe`, `taskkill /im node.exe /f`, `taskkill //F //IM node.exe`, `taskkill -im node.exe`, `Stop-Process -Name node`, `stop-process -name node`, `Stop-process -Name node`, `kill -Name node`, `Stop-Process -ProcessName:node`, `TASKKILL /IM node.exe`, `/usr/bin/pkill node`, `C:\\Windows\\System32\\taskkill.exe /IM node.exe`, `sudo pkill node`, `sudo -u root pkill node`, `FOO=1 pkill node`, `env pkill node`, `env -u HOME FOO=1 pkill node`, `timeout 10 pkill node`, `timeout -s KILL 5 killall node`, `nohup killall node`, `command pkill node`, `exec pkill node`, `nice -n 5 pkill node`, `doas pkill node`, `time pkill node`, `sudo nice pkill node`.
  - `#4548: processKillByName flags pgrep-fed kills, non-PID taskkill filters and Get-Process pipelines` (AC8.1, AC11.1) — `hit` true for: `kill $(pgrep node)`, ``kill `pgrep node` ``, `kill -9 $(pgrep -f vite)`, `pgrep -f x | xargs kill`, `pgrep node | xargs -n 1 kill`, `P=$(pgrep node); kill $P`, `kill $(pidof node)`, `taskkill /FI "IMAGENAME eq node.exe"`, `taskkill /F /fi "imagename eq node.exe"`, `taskkill /FI "WINDOWTITLE eq dev*"`, `taskkill /FI "USERNAME eq me" /F`, `taskkill /FI "STATUS eq NOT RESPONDING"`, `taskkill /FI "PID ne 0"`, `Get-Process node | Stop-Process`, `Get-Process -Name node | Stop-Process -Force`.
  - `#4548: processKillByName scans each wrapper's command argument` (AC10.1) — `hit` true for: `powershell -Command "Stop-Process -Name node"`, `powershell -c "Stop-Process -Name node"`, `POWERSHELL.EXE -command "taskkill /IM node.exe"`, `pwsh -Command "Get-Process node | Stop-Process"`, `pwsh -c "Stop-Process -Name node"`, `cmd /c taskkill /IM node.exe`, `cmd /C "taskkill /F /IM node.exe"`, `sh -c 'pkill node'`, `bash -c "killall node"`, `bash -lc 'kill $(pgrep node)'`, `bash -c "sh -c 'pkill node'"`.
  - `#4548: processKillByName stays silent on PID-scoped kills, data mentions and benign wrappers` — `hit` false for: `kill 12345`, `kill -9 12345`, `kill -- -12345`, `taskkill /PID 12345 /T /F`, `taskkill /FI "PID eq 123"`, `lsof -nP -iTCP:3000 -sTCP:LISTEN -t | xargs kill`, `kill $(lsof -nP -iTCP:3000 -sTCP:LISTEN -t)`, `Stop-Process -Id 123`, `Get-Process -Id 123 | Stop-Process`, `echo pkill`, `grep killall notes.txt`, `echo "$(pgrep node)"`, `pgrep node`, `git commit -m "pkill node"`, `bash script.sh`, `sh -c 'echo pkill'`, `bash -c 'kill 123'`, `cmd /c "taskkill /PID 12 /F"`, `powershell -File kill.ps1`, `''`.
  - `#4548: processKillByName returns one label per matching segment` — `assert.deepStrictEqual(processKillByName('npm run dev & sleep 1; pkill -f vite; killall node', '/repo'), ['pkill', 'killall'])`.
  - `#4548: processKillByName caps wrapper recursion without throwing` — a command of 12 nested `bash -c` layers around `pkill node` (built by a loop wrapping with alternating quote styles) returns an array (no throw); and `bash -c "sh -c 'pkill node'"` (depth 2) returns `['pkill']`.
  In `tests/hooks-bash-prefilter.test.js`:
  - import `processKillByName`; add `(c) => processKillByName(c, CWD).map((w) => ({ action: w }))` to `PARSERS_BY_EVENT['pre-tool-use']` only.
  - add corpus lines (sole-trigger witnesses first): `'pkill node'`, `'killall node'`, `'taskkill /F /IM node.exe'`, `'kill -Name node'`, `'stop-process -name node'`, then `'Stop-Process -Name node'`, `'TASKKILL /IM node.exe'`, `'kill $(pgrep node)'`, `'pgrep -f x | xargs kill'`, `'taskkill /FI "IMAGENAME eq node.exe"'`, `'Get-Process node | Stop-Process'`, `"sh -c 'pkill node'"`, `'cmd /c taskkill /IM node.exe'`, `'pwsh -c "Stop-Process -Name node"'`.
  - add `'pkill node'`, `'killall node'`, `'taskkill /F /IM node.exe'`, `'TASKKILL /IM node.exe'`, `'Stop-process -Name node'`, `'KILLALL node'`, `"sh -c 'pkill node'"`, `'bash -c "killall node"'`, `'cmd /c taskkill /IM node.exe'`, `'powershell -c "Stop-Process -Name node"'`, `'pwsh -Command "Get-Process node | Stop-Process"'` to the "pre-tool-use runs the full handler for" list (AC5.1, AC9.1, AC10.1).
  - `#4548: the processKill family is all lowercase, and only it matches case-insensitively` (AC9.2) — assert every `GUARDED_PROGRAM_WORDS.processKill` word equals its `toLowerCase()`; assert `shouldRunFull('pre-tool-use', bash('GIT commit -m x')) === false` and `shouldRunFull('pre-tool-use', bash('MKDIR d')) === false` (other families stay case-sensitive).
  - `#4548: post-tool-use stays git-scoped for kill words` — `shouldRunFull('post-tool-use', bash('pkill node')) === false` and `shouldRunFull('post-tool-use', bash('TASKKILL /IM node.exe')) === false`.
  - `#4548: earlyGate hands a bare pkill node to the full pre-tool-use handler` — `earlyGate('pre-tool-use', () => JSON.stringify(bash('pkill node'))).skip === false`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js`
Expected: FAIL (`processKillByName` is not a function; prefilter skips `pkill node` and `TASKKILL /IM node.exe`)

- [ ] **Step 3: Implement `processKillByName(command, cwd)`** in `git-command.js`, shaped like `powershellOpaqueCommand`, as a thin export over a private `processKillLabels(command, cwd, depth)` (`depth` starts at 0; at `depth > 4` return `[]`):
  - Return `[]` for a non-string or when `!/kill|stop-process/i.test(command)` (cheap pre-check, case-insensitive; every wrapped kill carries one of these substrings).
  - Walk `forEachCommandSegment(command, cwd, (t, _cwd, quoting, again) => …)`, skipping `again` repeat visits. Normalize a word as `isPowershellLead` does (lowercase, strip `.exe`, basename on `/` and `\`), trying `t[i]` then `quoting.typed[i]`.
  - Effective lead: skip `SIMPLE_ASSIGNMENT_RE` tokens; then, repeatedly, while the lead normalizes to a command wrapper — the module's `READER_WRAPPER_WORDS` (`sudo`, `doas`, `env`, `nice`, `time`, `nohup`, `command`, `exec`) or `timeout` — skip it, its `-`-prefixed flags, the value after its value flags (`sudo`: `-u -g -U -C -D -h -p`; `doas`: `-u -C`; `env`: `-u -C`; `nice`: `-n`; `timeout`: `-s -k --signal --kill-after`), any `NAME=value` assignment after `env`, and `timeout`'s first non-flag token (the duration); if the lead then normalizes to `xargs`, skip it, its `-`-prefixed flags, and the value after any of `-I -n -P -L -d -E -s -a`. (Plan review, medium: these prefixes would otherwise leave a reachable `pkill` silent.)
  - Wrappers (Decision): lead in `KNOWN_SHELL_WORDS` (the module's own set) with a later token matching `/^-[A-Za-z]*c[A-Za-z]*$/` → recurse on the token after it (`t[j+1]`, the unquoted value); lead `isPowershellLead` with a later token whose lowercase is `-command` or `-c` → recurse on `t.slice(j + 1).join(' ')`; lead normalizing to `cmd` with a later token matching `/^\/\/?[ck]$/i` → recurse on `t.slice(j + 1).join(' ')`. Each recursion is `processKillLabels(inner, cwd, depth + 1)` and its labels are pushed for this segment. `-EncodedCommand` (base64) is not decoded.
  - Per segment, collect: `pgrepSeen` (lead is `pgrep`/`pidof`, or any token of the segment matches `/(?:\$\(|`)\s*(?:\S*[\/\\])?(?:pgrep|pidof)(?:\.exe)?(?=[\s)`]|$)/i`); `killLed` segments (lead `kill`); `getProcessSeen` (lead `get-process` with no token matching `/^-id(:.*)?$/i`); `stopConsumer` segments (lead `stop-process` with no token matching `/^-(id|inputobject)(:.*)?$/i`).
  - Direct matches, pushed per segment: `pkill`, `killall` → always; `taskkill` → any later token matches `/^(\/\/?|-)im$/i`, or a `/^(\/\/?|-)fi$/i` token followed by a token whose trimmed text does not match `/^pid\s+eq\s+\d+$/i`; `kill`, `stop-process` → any later token matches `/^-(name|processname)(:.*)?$/i`.
  - After the walk: when `pgrepSeen`, push `'kill'` for each `killLed` segment not already pushed; when `getProcessSeen`, push `'stop-process'` for each `stopConsumer` segment not already pushed.
  - Header comment: #4548, warn-only consumer (`pre-tool-use.js`'s `checkProcessKillWarn`); every lead is a `GUARDED_PROGRAM_WORDS.processKill` word except `pgrep`/`pidof`/`get-process`/`xargs`/`sudo` (each only arms or wraps a segment led by one of those words) and the wrappers (`sh`/`bash`/… `-c`, `cmd /c`, `powershell`/`pwsh -Command`/`-c`), whose argument still carries a kill word the whitespace-splitting prefilter reads; command names match case-insensitively because `taskkill` and PowerShell cmdlets are case-insensitive on Windows; a `PID eq {n}` filter is the only silent `/FI` filter.
  - Add `processKill: PROCESS_KILL_WORDS` to `GUARDED_PROGRAM_WORDS` with a family-comment line: `processKill: processKillByName's leads — pre-tool-use only, matched case-insensitively by the prefilter (#4548); post-tool-use stays git-scoped`. Export `processKillByName` and `PROCESS_KILL_WORDS`.

- [ ] **Step 4: Make the prefilter match `processKill` case-insensitively** in `bash-prefilter.js`: a `CASE_INSENSITIVE_WORDS_BY_EVENT = Object.freeze({ 'pre-tool-use': new Set(GUARDED_PROGRAM_WORDS.processKill) })`, looked up with the same own-property guard `wordsFor` uses; in `shouldRunFull`'s final `readings.some`, a reading also counts when any `commandWords` word's `toLowerCase()` is in that set. Add a header-comment sentence: the process-kill family matches case-insensitively, the other families do not (#4548).

- [ ] **Step 5: Run to verify they pass**, plus the gate-coverage neighbour

Run: `node --test tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/hooks-gate-coverage.test.js`
Expected: PASS

- [ ] **Step 6: Go-red proofs.** (a) Remove `processKill` from `GUARDED_PROGRAM_WORDS`: confirm the prefilter differential and witness tests fail; restore. (b) Drop the case-insensitive comparison from `shouldRunFull`: confirm the `TASKKILL /IM node.exe` and `Stop-process -Name node` runs-full tests fail; restore. (c) Drop the post-walk pgrep arming: confirm the pgrep-fed cases fail; restore. (d) Drop the wrapper recursion: confirm the wrapper test fails; restore. (e) Change the `/FI` rule back to `IMAGENAME`-only: confirm the `WINDOWTITLE` case fails; restore. Quote each failing test name in the task report.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js plugin/bin/lib/hooks/bash-prefilter.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js
git commit -m "Parse name-based process kills and reach them from the prefilter — refs #4548"
```

### Task 6: Warn-tier `checkProcessKillWarn` gate and its docs

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (import `processKillByName` in the `require('./git-command')` block ending line 30; new `checkProcessKillWarn` after `checkGitStashWarn`, which ends at line 948; call it on the line after `checkGitStashWarn(segments, warnings);`, line 2285)
- Modify: `docs/hooks.md` (new bullet directly after the Git-stash gate bullet, line 13; "five guard parsers" → "six guard parsers" and a case-insensitivity clause in the Bash prefilter bullet, line 16)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:32` ("the five guard parsers (`gitTargets`, `fileWriteTargets`, `mkdirTargets`, `teardownTargets`, `powershellOpaqueCommand`)" → "the six guard parsers (… `powershellOpaqueCommand`, `processKillByName`)")
- Modify: `.claude/skills/shell-scanner-bash-differential/SKILL.md:85` ("five guard parsers" → "six guard parsers")
- Test: `tests/hooks-pre-tool-use.test.js`

**Interfaces:**
- Consumes: Task 5's `processKillByName(command, cwd) -> string[]`.
- Produces: `checkProcessKillWarn(command: string|null, cwd: string|null, warnings: string[]) -> void` in `pre-tool-use.js` (not exported).

- [ ] **Step 1: Write failing tests** in `tests/hooks-pre-tool-use.test.js`, after the stash warn block, a `#4548` block. `dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4548-'))` (not a git repo, no policy file — proves location independence and keeps `checkPowershellOpaqueCommand`'s deny out of the way); `const run = (cmd) => pre.run({ input: bashInput(cmd, dir), runDir: null, runState: null, cwd: dir });`.
  - One test per warn case (AC4.1, AC4.3, AC8.1, AC8.2, AC9.2, AC10.1, AC11.1), titled `#4548: \`{cmd}\` warns about killing by image or name`, all calling one helper `assertKillWarning(out)` that asserts `out.json.systemMessage` matches `/by image or name/` and `/-sTCP:LISTEN/`, and `!(out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision)`: `pkill node`, `killall node`, `taskkill /F /IM node.exe`, `taskkill /im node.exe /f`, `Stop-Process -Name node`, `kill $(pgrep node)`, `pgrep -f x | xargs kill`, `taskkill /FI "IMAGENAME eq node.exe"`, `taskkill /FI "WINDOWTITLE eq dev*"`, `Get-Process node | Stop-Process`, `TASKKILL /IM node.exe`, `powershell -Command "Stop-Process -Name node"`, `powershell -c "Stop-Process -Name node"`, `pwsh -Command "Get-Process node | Stop-Process"`, `pwsh -c "Stop-Process -Name node"`, `cmd /c taskkill /IM node.exe`, `sh -c 'pkill node'`, `bash -c "killall node"`.
  - `#4548: a compound command with several name kills warns once` — for `npm run dev & sleep 1; pkill -f vite; killall node`, the systemMessage contains `by image or name` exactly once.
  - One test per silent case (AC4.2, AC4.3), titled `#4548: \`{cmd}\` is PID-scoped and stays silent`, asserting `!out.json || !/by image or name/.test(out.json.systemMessage || '')`: `kill 12345`, `taskkill /PID 12345 /T /F`, `kill -- -12345`, `taskkill /FI "PID eq 123"`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-pre-tool-use.test.js`
Expected: FAIL (no warning emitted)

- [ ] **Step 3: Implement `checkProcessKillWarn`**: return when `command` is falsy; inside `try`, if `processKillByName(command, cwd).length` push one message; `catch` swallows. Message text (exact):

```
claude-tweaks: killing a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`, a `pgrep`-fed `kill`, also inside `sh -c`/`cmd /c`/`powershell -Command`) matches every process of that name on this machine — the process table is shared with every sibling session and worktree, so it can take down their dev servers and tooling. Kill only a PID you captured when you started the process, or the listener on a port you own (`lsof -nP -iTCP:{port} -sTCP:LISTEN -t`, then `kill {pid}`; win32: `taskkill /PID {pid} /T /F`).
```

  Call it as `checkProcessKillWarn(command, ctx.cwd, warnings);` on the line after `checkGitStashWarn(segments, warnings);`. Comment above the function: #4548, warn-only, run- and location-independent because the hazard is machine-wide (contrast with `checkGitStashWarn`'s linked-worktree condition), and reachable only because `GUARDED_PROGRAM_WORDS.processKill` feeds the prefilter, case-insensitively.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/hooks-pre-tool-use.test.js tests/hooks-bash-prefilter.test.js tests/hooks-gate-coverage.test.js`
Expected: PASS

- [ ] **Step 5: Docs (AC6.1).** In `docs/hooks.md`, after the Git-stash bullet, add a `**Process-kill-by-name gate (warn tier, #4548):**` bullet: `pre-tool-use.js`'s `checkProcessKillWarn` (parser `git-command.js`'s `processKillByName`) fires on a Bash segment led by `pkill` or `killall`; `taskkill` with an `/IM` token or any `/FI` filter but `PID eq {n}` (`/FI "IMAGENAME eq node.exe"`, `/FI "WINDOWTITLE eq …"`; flags case-insensitive, any position, `//IM` and `-im` too); `kill`/`Stop-Process` with `-Name`/`-ProcessName`; a `kill` segment in a command that also runs `pgrep`/`pidof` (`kill $(pgrep node)`, `pgrep -f x | xargs kill`); a `Get-Process` (no `-Id`) piped to `Stop-Process`; or any of these inside the command argument of `sh`/`bash` `-c`, `cmd /c`, or `powershell`/`pwsh` `-Command`/`-c` (scanned with the same matcher, nesting capped; `-EncodedCommand` is not decoded). Command names match case-insensitively (`TASKKILL`, `Stop-process`), since `taskkill` and PowerShell cmdlets are case-insensitive on Windows. Warn-only `systemMessage` naming the shared machine-wide process table and the PID-scoped alternative; run- and location-independent; never fires on `kill {pid}`, `kill -- -{pid}`, `taskkill /PID`, `taskkill /FI "PID eq {n}"`, or a `-sTCP:LISTEN` listener lookup; its words are `GUARDED_PROGRAM_WORDS.processKill`, which the prefilter matches case-insensitively, so a bare `pkill node` or `TASKKILL /IM node.exe` reaches it, and a wrapped kill reaches it through the kill word inside the argument. In the Bash prefilter bullet, change "five guard parsers" to "six guard parsers" and, after "as a shell word or path basename", add "(the process-kill family case-insensitively, #4548)". Make the same "five" → "six" edits in `policy-schema-coverage.md` (adding `processKillByName` to its parenthesised list) and `.claude/skills/shell-scanner-bash-differential/SKILL.md`. Verify with three greps (renumbering check): `git grep -n -e "five guard parsers" -- docs plugin .claude tests` prints nothing; `git grep -n -e "six guard parsers" -- docs plugin .claude` prints the three edited lines; `git grep -n -i -e "powershellOpaqueCommand\`)" -- docs plugin` shows no parser list still ending at `powershellOpaqueCommand`.

- [ ] **Step 6: Go-red proof.** Make `checkProcessKillWarn` a no-op (early `return`), confirm the warn cases fail, restore. Quote one failing test name in the task report.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js docs/hooks.md plugin/skills/_shared/policy-schema-coverage.md .claude/skills/shell-scanner-bash-differential/SKILL.md tests/hooks-pre-tool-use.test.js
git commit -m "Warn on name-based process kills in PreToolUse — refs #4548"
```
