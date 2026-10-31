# Process-Kill Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dispatched agents from killing processes by image/name (machine-wide blast radius), narrow the plugin's own `lsof -ti tcp:{port}` teardowns to the listening process, and back the rule with a warn-tier PreToolUse gate that also catches the `pgrep`-fed, `/FI IMAGENAME`, and `Get-Process | Stop-Process` spellings, case-insensitively.

**Architecture:** Mirror the no-`git stash` rule's three layers: a canonical paragraph in `_shared/subagent-dispatch-core.md`, a short forwarded paragraph in every dispatch prompt that forwards the no-stash rule, and a warn-only PreToolUse gate (`checkProcessKillWarn`). The gate's parser `processKillByName` lives in `git-command.js` beside `powershellOpaqueCommand`; its program words join `GUARDED_PROGRAM_WORDS` as a new `processKill` family so `bash-prefilter.js`'s derived `PRE_TOOL_USE_WORDS` reaches it, and the prefilter matches that family (only) case-insensitively.

**Tech Stack:** Markdown skill prose, Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T172458-record-4548/work/4548-spec.md` (record #4548; supersedes this plan's earlier revision, which predated the two 2026-10-31 plan-review Decision bullets)

## Global Constraints

- Warn only: the gate appends to `warnings` (emitted as `systemMessage`); it never sets `permissionDecision`, never throws (body wrapped in `try { … } catch { /* no warning */ }`), and a parse failure means no warning (`docs/hooks.md` never-break-a-session invariant).
- Run-independent and location-independent: no `runDir`, `runState`, or linked-worktree condition (unlike `checkGitStashWarn`), because the hazard is machine-wide.
- Must warn (AC4 + Decisions): `pkill node`, `killall node`, `taskkill /F /IM node.exe`, `taskkill /im node.exe /f`, `Stop-Process -Name node`, `kill $(pgrep node)`, `pgrep -f x | xargs kill`, `taskkill /FI "IMAGENAME eq node.exe"`, `Get-Process node | Stop-Process`, `TASKKILL /IM node.exe`, `Stop-process -Name node`. Must stay silent: `kill 12345`, `taskkill /PID 12345 /T /F`, `kill -- -12345`.
- Decision (plan review, 2026-10-31), verbatim: "The command names of these kill forms match case-insensitively (`TASKKILL`, `Stop-process`), since `taskkill` and PowerShell cmdlets are case-insensitive on Windows. The hook's pre-check is case-insensitive for these words only, with a `TASKKILL /IM node.exe` test." — the git/mkdir/write/powershell families keep their case-sensitive prefilter match.
- `PRE_TOOL_USE_WORDS` is derived (`Object.values(GUARDED_PROGRAM_WORDS).flat()`) and `bash-prefilter.js` says "No word is typed here" — add the words to `GUARDED_PROGRAM_WORDS` in `git-command.js`, never as a literal list in `bash-prefilter.js`. `bash-prefilter.js` does change, but only to add the case-insensitive comparison for `GUARDED_PROGRAM_WORDS.processKill`.
- Governing skill `shell-scanner-bash-differential` (verbatim): "A new guarded program word or parser needs its own line in the differential corpus in `tests/hooks-bash-prefilter.test.js` (`docs/hooks.md`, #3092). The prefilter and the five guard parsers must agree on every command in it." — this change adds a sixth parser, so "five" becomes "six" there, in `docs/hooks.md`'s Bash prefilter bullet, and in `plugin/skills/_shared/policy-schema-coverage.md`'s parser enumeration.
- Governing skill `shell-scanner-bash-differential` (verbatim): "Test titles name the record and the behavior (`#4149: …`), never review-round labels (m1, F2, round N)." — every new test title starts `#4548:`.
- Governing skill `skill-prose-conformance-tests` (verbatim): "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt."
- Governing skill `pre-tool-use-gate-exemptions` governs deny gates and their exemptions; this gate is warn-only and carries no exemption, so none of its rules bind — no deny path may be added.
- `task-prompt.md` region anchors `## First call`, `## Second call`, `None of Templates A/B/C` must not move; insert the new paragraph directly after each no-stash paragraph.
- Byte rail (`RAIL_BYTES` 52,500): `plugin/skills/dispatch/task-prompt.md` is 50,155 B at base; two ~480 B paragraphs leave ~1,200 B headroom (near-ceiling flag, no breach). Keep the forwarded paragraph to the six lines given in Task 2. Every other touched skill file is under 45,000 B. Composed: the `review-dispatch` bundle (`review/step3-lens-dispatch.md:23`) measures 49,892 B at base; Task 1's ~900 B canonical paragraph, if that bundle carries `subagent-dispatch-core.md`, lands it near 50,800 B — under the rail; `tests/` `rail:` suites catch a breach.
- Prohibition-vs-existing-mandate: `grep -rniE "pkill|killall|taskkill /IM|taskkill /FI|Stop-Process|pgrep|pidof" plugin/skills plugin/agents` returns nothing at base — no instruction mandates a name kill. The only kill mandates are the three `lsof -ti tcp:` sites Task 3 narrows; `kill {pid}` and `kill -- -{pid}` in `wrap-up/cleanup-procedures-execution.md` Section D are PID-scoped and stay.
- Absence-grep control: `grep -rnF "lsof -ti tcp:" plugin/skills` matches 3 lines at base (`_shared/dev-url-detection.md:184`, `journey-health/deep-tier.md:42`, `wrap-up/cleanup-procedures-execution.md:321`); it must return nothing after Task 3.
- Commit messages: `{Verb} {what} — {detail}` style, `refs #4548`, never `closes`/`fixes`.

## Review Focus

1. `sudo -u root pkill node` and `FOO=1 pkill node`: warn — assignments, a `sudo` lead, and `sudo`'s value flags (`-u`, `-g`, `-U`, `-C`, `-D`, `-h`, `-p`) are walked past. Test in Task 4.
2. `pgrep node | xargs -n 1 kill` and `P=$(pgrep node); kill $P`: warn — `xargs` and its value flags (`-I`, `-n`, `-P`, `-L`, `-d`, `-E`, `-s`, `-a`) are walked past, and a `pgrep` anywhere in the command arms every `kill`-led segment. Test in Task 4.
3. Data mentions (`echo pkill`, `grep killall notes.txt`, `echo "$(pgrep node)"`, `pgrep node` alone): silent — only a segment's program position counts, and `pgrep` without a `kill` segment kills nothing. Test in Task 4.
4. PID-scoped forms that look close: `kill $(lsof -nP -iTCP:3000 -sTCP:LISTEN -t)`, `lsof -nP -iTCP:3000 -sTCP:LISTEN -t | xargs kill`, `Get-Process -Id 123 | Stop-Process`, `taskkill /FI "PID eq 123"`, `Stop-Process -Id 123`: silent. Test in Task 4.
5. Compound `npm run dev & sleep 1; pkill -f vite; killall node`: exactly one warning message per command. Test in Task 5.

## Spec Coverage Map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 1 (canonical paragraph + adjacency assertion) |
| AC2.1 | Task 1 Step 1 (`build/dispatch.md`) and Task 2 Step 1 (four prompt regions) |
| AC2.2 | Task 2 Step 1 (one assertion per region, so dropping any one site fails) |
| AC2.3 | Task 2 Step 5 (go-red proof: delete from `express-prompt.md`, watch the test fail) |
| AC3.1 | Task 3 Step 1 (corpus walk for `lsof -ti tcp:`) and Task 3 Step 4 grep |
| AC3.2 | Task 3 Step 1 (three sites carry the `-sTCP:LISTEN` form) |
| AC4.1 | Task 5 Step 1 (warn cases in `tests/hooks-pre-tool-use.test.js`) |
| AC4.2 | Task 5 Step 1 (silent cases) |
| AC4.3 | Task 5 Step 1 (each case is its own test in `tests/hooks-pre-tool-use.test.js`) |
| AC5.1 | Task 4 Step 1 (prefilter runs-full list, differential corpus witnesses, `earlyGate` case) |
| AC6.1 | Task 5 Step 5 (docs bullet), verified by the Task 5 review |
| AC7.1 | `/build` Common Step 5 full-suite verification (`verify.js`) |
| AC8.1 | Task 4 Step 1 (parser cases) and Task 5 Step 1 (handler cases) for `kill $(pgrep node)`, `pgrep -f x \| xargs kill`, `taskkill /FI "IMAGENAME eq node.exe"`, `Get-Process node \| Stop-Process` |
| AC8.2 | Task 5 Step 1 (one test per form) |
| AC9.1 | Task 4 Step 1 (`TASKKILL /IM node.exe`, `Stop-process -Name node` parser + prefilter cases) and Task 5 Step 1 (`TASKKILL /IM node.exe` handler test) |
| AC9.2 | Task 4 Step 1 (prefilter case-insensitive for processKill words, still case-sensitive for `GIT commit`) |
| AC9.3 | Task 5 Step 1 (`TASKKILL /IM node.exe` test) |

Waived AC8.3: provenance note ("Plan-review Q1: Reading B."), not a behavior — nothing to test.
Waived tests/dispatch-no-stash-conformance.test.js: read only — the sibling pattern the new `tests/dispatch-no-name-kill-conformance.test.js` copies; unchanged, re-run in Task 2 Step 4.
Waived bin/hooks.js: read only — the Gotcha's prefilter-skip hazard is covered by Task 4's `shouldRunFull`/`earlyGate` tests; no edit.

---

### Task 1: Canonical no-name-kill rule and its `build/dispatch.md` forwarding

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (new paragraph directly after the `**Never run \`git stash\` in any form.**` paragraph, line 45)
- Modify: `plugin/skills/build/dispatch.md` (line 19, directly after the `**Forbid \`git stash\` in every per-task implementer dispatch:**` sentence, which ends "…set its own work aside with a temporary WIP commit instead.")
- Create: `tests/dispatch-no-name-kill-conformance.test.js`

**Interfaces:**
- Produces: the literal phrase `Never kill a process by image or name` (canonical heading and every forwarded paragraph) that Tasks 2–3 extend the same test file around. Produces helpers `flat(s) = s.replace(/\s+/g, ' ')` and `readText` usage in the new test file.

- [ ] **Step 1: Write the failing test** `tests/dispatch-no-name-kill-conformance.test.js`, modelled on `tests/dispatch-no-stash-conformance.test.js` (same `readText` helper from `./helpers/read-skill`). Collapse whitespace before matching (`flat`). Tests (AC1.1, AC2.1):
  - `#4548: subagent-dispatch-core.md carries the no-name-kill paragraph right after the no-stash paragraph` — split the file on `\n\n`, find index i of the paragraph starting `**Never run \`git stash\` in any form.**`, assert paragraph i+1 starts with `**Never kill a process by image or name.**`; assert that paragraph contains the literals `` `taskkill /IM` ``, `` `pkill` ``, `` `killall` ``, `` `Stop-Process -Name` ``, `-sTCP:LISTEN`, `taskkill /PID {pid} /T /F`, and `leave the process running and report it`.
  - `#4548: build/dispatch.md forwards the no-name-kill rule to every per-task implementer` — assert `/Forbid name-based process kills in every per-task implementer dispatch/` and `` /_shared\/subagent-dispatch-core\.md`'s no-name-kill rule/ ``.
  - Frozen control (skill-prose-conformance-tests): put the adjacency check in a helper `nameKillFollowsStash(text) -> boolean`, and a `PRE_CHANGE_CORE` constant holding the base file's line 45 (the no-stash paragraph) verbatim, then `\n\n## Foreground Execution Discipline` (the heading that follows it at base). Assert `nameKillFollowsStash(PRE_CHANGE_CORE) === false` beside the live-file `true` — the control carries the stash anchor and lacks only the new paragraph.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js`
Expected: FAIL (neither file carries the rule)

- [ ] **Step 3: Add the canonical paragraph** to `subagent-dispatch-core.md`, as its own paragraph right after the no-stash one, exact text:

```
**Never kill a process by image or name.** `taskkill /IM`, `pkill`, `killall`, and `Stop-Process -Name` — and their equivalents, a `pgrep`-fed `kill`, `taskkill /FI "IMAGENAME eq …"`, `Get-Process … | Stop-Process` — match every process of that name on the machine, and the process table is shared machine-wide with every sibling session and worktree: one `taskkill /F /IM node.exe` takes down their dev servers and tooling along with yours (#4548). Kill only a PID you captured when you started the process, or the PID of the listener on a port you own: `lsof -nP -iTCP:{port} -sTCP:LISTEN -t` on POSIX (then `kill {pid}`), `taskkill /PID {pid} /T /F` on win32. If neither PID can be identified, leave the process running and report it rather than reaching for a broader kill. The PreToolUse hook warns on these shapes (`docs/hooks.md`), but the warning lands after the command has run.
```

- [ ] **Step 4: Forward it in `build/dispatch.md`** — insert directly after the no-stash forwarding sentence, in the same dispatcher voice:

```
**Forbid name-based process kills in every per-task implementer dispatch:** in the same invocation instruction, also direct `/superpowers:subagent-driven-development` to instruct each per-task implementer to never kill a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`, or a `pgrep`-fed `kill`) — the process table is shared machine-wide with every sibling session and worktree (`_shared/subagent-dispatch-core.md`'s no-name-kill rule, cited rather than restated) — and to kill only a PID it captured at start or the listener PID on a port it owns, leaving the process running and reporting it when neither can be identified.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js tests/dispatch-no-stash-conformance.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/build/dispatch.md tests/dispatch-no-name-kill-conformance.test.js
git commit -m "Add the canonical no-name-kill dispatch rule — refs #4548"
```

### Task 2: Forward the rule into the three literal prompt templates

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (directly after each of the two `Never run \`git stash\` or \`git stash pop\`` paragraphs, lines 218-221 and 411-414)
- Modify: `plugin/skills/dispatch/express-prompt.md` (directly after its no-stash paragraph, lines 75-78)
- Modify: `plugin/skills/flow/multispec-parallel-waves.md` (member prompt, after the paragraph at lines 107-110 that ends "LEDGER names whichever exists.")
- Modify: `tests/dispatch-no-name-kill-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's test file and `flat` helper.

- [ ] **Step 1: Append failing tests** (AC2.1, AC2.2). Regions (each `flat`-ened before matching):
  - `task-prompt.md` first call (`## First call` → `## Second call`) and second call (`## Second call` → `None of Templates A/B/C`), the split `tests/dispatch-no-stash-conformance.test.js` uses, with the same anchor-lost assertions.
  - `express-prompt.md`: `## Express call` → `## Post-merge sample review call`.
  - `multispec-parallel-waves.md`: `## Member prompt` → `## Failure handling`.
  One test per region, titled `#4548: {region name} forbids name-based process kills`, asserting `/Never kill a process by image or name/`, the literals `` `taskkill /IM` ``, `` `pkill` ``, `` `killall` ``, `` `Stop-Process -Name` ``, `` `pgrep` ``, and `/-sTCP:LISTEN/`. Frozen control: a `PRE_CHANGE_EXPRESS` constant holding `express-prompt.md`'s current no-stash paragraph verbatim; assert `/Never kill a process by image or name/` does not match it.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js`
Expected: FAIL naming all four regions

- [ ] **Step 3: Insert the paragraph** at all four sites, as its own paragraph (blank line before and after), hard-wrapped exactly like this, using `--` as the neighbours do:

```
Never kill a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`,
or a `pgrep`-fed `kill`) -- the process table is shared machine-wide with every sibling session
and worktree, so a name match kills their dev servers and tooling too. Kill only a PID you
captured when you started the process, or the listener on a port you own
(`lsof -nP -iTCP:{port} -sTCP:LISTEN -t`; win32: `taskkill /PID {pid} /T /F`); if you cannot
identify that PID, leave the process running and report it.
```

- [ ] **Step 4: Run to verify it passes**, plus the neighbouring pins on these files

Run: `node --test tests/dispatch-no-name-kill-conformance.test.js tests/dispatch-no-stash-conformance.test.js tests/dispatch-worktree-anchoring.test.js tests/foreground-execution-instruction.test.js tests/dispatch-express-routing-prose.test.js`
Expected: PASS. Then `wc -c plugin/skills/dispatch/task-prompt.md` prints under 52500.

- [ ] **Step 5: Go-red proof (AC2.3).** Delete the inserted paragraph from `express-prompt.md` only, re-run `node --test tests/dispatch-no-name-kill-conformance.test.js`, confirm exactly the express-prompt region test fails, then restore the paragraph by re-applying the Step 3 edit (never `git stash`/`git checkout`). Quote the failing test name in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/multispec-parallel-waves.md tests/dispatch-no-name-kill-conformance.test.js
git commit -m "Forward the no-name-kill rule into every dispatch prompt — refs #4548"
```

### Task 3: Listener-scoped teardowns

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/dev-url-detection.md:184`
- Modify: `plugin/skills/journey-health/deep-tier.md:42`
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md:321`
- Modify: `tests/dispatch-no-name-kill-conformance.test.js` (append)

- [ ] **Step 1: Append failing tests** (AC3.1, AC3.2):
  - `#4548: no skill file uses the client-matching lsof -ti tcp: kill` — a helper `filesContaining(root, literal)` walks every `plugin/skills/**/*.md` (recursive `fs.readdirSync`) and returns the relative paths whose text includes `lsof -ti tcp:`; assert it returns `[]`. Control: write a temp dir with one `.md` holding `lsof -ti tcp:3000 | xargs kill` and assert the helper returns that file (proves the walk can go red).
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

### Task 4: `processKillByName` parser and case-insensitive prefilter reach

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (new `PROCESS_KILL_WORDS` + `processKillByName` after `powershellOpaqueCommand`, ~line 1177; new `processKill` family in `GUARDED_PROGRAM_WORDS` ~line 3078 plus its line in the family comment above it; export both)
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js` (case-insensitive match for `GUARDED_PROGRAM_WORDS.processKill`, pre-tool-use only; header comment)
- Test: `tests/hooks-git-command.test.js`
- Test: `tests/hooks-bash-prefilter.test.js`

**Interfaces:**
- Produces: `PROCESS_KILL_WORDS = Object.freeze(['pkill', 'killall', 'taskkill', 'kill', 'stop-process'])` (all lowercase), exposed as `GUARDED_PROGRAM_WORDS.processKill`.
- Produces: `processKillByName(command: string, cwd: string|null) -> string[]` — one lowercased label per kill-by-name segment (`'pkill'`, `'killall'`, `'taskkill'`, `'kill'`, `'stop-process'`), empty array when none; never throws on a string input. Exported from `git-command.js`.

- [ ] **Step 1: Write failing tests.**
  In `tests/hooks-git-command.test.js`, a `// ─── processKillByName (#4548) ───` block. `const hit = (c) => processKillByName(c, '/repo').length > 0;`
  - `#4548: processKillByName flags image- and name-based kills` — `hit` true for: `pkill node`, `killall node`, `taskkill /F /IM node.exe`, `taskkill /im node.exe /f`, `taskkill //F //IM node.exe`, `taskkill -im node.exe`, `Stop-Process -Name node`, `stop-process -name node`, `Stop-process -Name node`, `kill -Name node`, `Stop-Process -ProcessName:node`, `TASKKILL /IM node.exe`, `/usr/bin/pkill node`, `C:\\Windows\\System32\\taskkill.exe /IM node.exe`, `sudo pkill node`, `sudo -u root pkill node`, `FOO=1 pkill node`.
  - `#4548: processKillByName flags pgrep-fed kills, IMAGENAME filters and Get-Process pipelines` (AC8.1) — `hit` true for: `kill $(pgrep node)`, ``kill `pgrep node` ``, `kill -9 $(pgrep -f vite)`, `pgrep -f x | xargs kill`, `pgrep node | xargs -n 1 kill`, `P=$(pgrep node); kill $P`, `kill $(pidof node)`, `taskkill /FI "IMAGENAME eq node.exe"`, `taskkill /F /fi "imagename eq node.exe"`, `Get-Process node | Stop-Process`, `Get-Process -Name node | Stop-Process -Force`.
  - `#4548: processKillByName stays silent on PID-scoped kills and data mentions` — `hit` false for: `kill 12345`, `kill -9 12345`, `kill -- -12345`, `taskkill /PID 12345 /T /F`, `taskkill /FI "PID eq 123"`, `lsof -nP -iTCP:3000 -sTCP:LISTEN -t | xargs kill`, `kill $(lsof -nP -iTCP:3000 -sTCP:LISTEN -t)`, `Stop-Process -Id 123`, `Get-Process -Id 123 | Stop-Process`, `echo pkill`, `grep killall notes.txt`, `echo "$(pgrep node)"`, `pgrep node`, `git commit -m "pkill node"`, `''`.
  - `#4548: processKillByName returns one label per matching segment` — `assert.deepStrictEqual(processKillByName('npm run dev & sleep 1; pkill -f vite; killall node', '/repo'), ['pkill', 'killall'])`.
  In `tests/hooks-bash-prefilter.test.js`:
  - import `processKillByName`; add `(c) => processKillByName(c, CWD).map((w) => ({ action: w }))` to `PARSERS_BY_EVENT['pre-tool-use']` only.
  - add corpus lines (sole-trigger witnesses first): `'pkill node'`, `'killall node'`, `'taskkill /F /IM node.exe'`, `'kill -Name node'`, `'stop-process -name node'`, then `'Stop-Process -Name node'`, `'TASKKILL /IM node.exe'`, `'kill $(pgrep node)'`, `'pgrep -f x | xargs kill'`, `'taskkill /FI "IMAGENAME eq node.exe"'`, `'Get-Process node | Stop-Process'`.
  - add `'pkill node'`, `'killall node'`, `'taskkill /F /IM node.exe'`, `'TASKKILL /IM node.exe'`, `'Stop-process -Name node'`, `'KILLALL node'` to the "pre-tool-use runs the full handler for" list (AC5.1, AC9.1).
  - `#4548: the processKill family is all lowercase, and only it matches case-insensitively` (AC9.2) — assert every `GUARDED_PROGRAM_WORDS.processKill` word equals its `toLowerCase()`; assert `shouldRunFull('pre-tool-use', bash('GIT commit -m x')) === false` and `shouldRunFull('pre-tool-use', bash('MKDIR d')) === false` (other families stay case-sensitive).
  - `#4548: post-tool-use stays git-scoped for kill words` — `shouldRunFull('post-tool-use', bash('pkill node')) === false` and `shouldRunFull('post-tool-use', bash('TASKKILL /IM node.exe')) === false`.
  - `#4548: earlyGate hands a bare pkill node to the full pre-tool-use handler` — `earlyGate('pre-tool-use', () => JSON.stringify(bash('pkill node'))).skip === false`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js`
Expected: FAIL (`processKillByName` is not a function; prefilter skips `pkill node` and `TASKKILL /IM node.exe`)

- [ ] **Step 3: Implement `processKillByName(command, cwd)`** in `git-command.js`, shaped like `powershellOpaqueCommand`:
  - Return `[]` for a non-string or when `!/kill|stop-process/i.test(command)` (cheap pre-check, case-insensitive).
  - Walk `forEachCommandSegment(command, cwd, (t, _cwd, quoting, again) => …)`, skipping `again` repeat visits. Normalize a word as `isPowershellLead` does (lowercase, strip `.exe`, basename on `/` and `\`), trying `t[i]` then `quoting.typed[i]`.
  - Effective lead: skip `SIMPLE_ASSIGNMENT_RE` tokens; if the lead normalizes to `sudo`, skip it, its `-`-prefixed flags, and the value after any of `-u -g -U -C -D -h -p`; if the lead then normalizes to `xargs`, skip it, its `-`-prefixed flags, and the value after any of `-I -n -P -L -d -E -s -a`.
  - Per segment, collect: `pgrepSeen` (lead is `pgrep`/`pidof`, or any token of the segment matches `/(?:\$\(|`)\s*(?:\S*[\/\\])?(?:pgrep|pidof)(?:\.exe)?(?=[\s)`]|$)/i`); `killLed` segments (lead `kill`); `getProcessSeen` (lead `get-process` with no token matching `/^-id(:.*)?$/i`); `stopConsumer` segments (lead `stop-process` with no token matching `/^-(id|inputobject)(:.*)?$/i`).
  - Direct matches, pushed per segment: `pkill`, `killall` → always; `taskkill` → any later token matches `/^(\/\/?|-)im$/i`, or a `/^(\/\/?|-)fi$/i` token followed by a token whose trimmed text does not start with `pid` (case-insensitive); `kill`, `stop-process` → any later token matches `/^-(name|processname)(:.*)?$/i`.
  - After the walk: when `pgrepSeen`, push `'kill'` for each `killLed` segment not already pushed; when `getProcessSeen`, push `'stop-process'` for each `stopConsumer` segment not already pushed.
  - Header comment: #4548, warn-only consumer (`pre-tool-use.js`'s `checkProcessKillWarn`), every lead is a `GUARDED_PROGRAM_WORDS.processKill` word except `pgrep`/`pidof`/`get-process`/`xargs`/`sudo` (each only arms or wraps a segment led by one of those words, so the prefilter still reaches it), and that command names match case-insensitively because `taskkill` and PowerShell cmdlets are case-insensitive on Windows.
  - Add `processKill: PROCESS_KILL_WORDS` to `GUARDED_PROGRAM_WORDS` with a family-comment line: `processKill: processKillByName's leads — pre-tool-use only, matched case-insensitively by the prefilter (#4548); post-tool-use stays git-scoped`. Export `processKillByName` and `PROCESS_KILL_WORDS`.

- [ ] **Step 4: Make the prefilter match `processKill` case-insensitively** in `bash-prefilter.js`: a `CASE_INSENSITIVE_WORDS_BY_EVENT = Object.freeze({ 'pre-tool-use': new Set(GUARDED_PROGRAM_WORDS.processKill) })`, looked up with the same own-property guard `wordsFor` uses; in `shouldRunFull`'s final `readings.some`, a reading also counts when any `commandWords` word's `toLowerCase()` is in that set. Add a header-comment sentence: the process-kill family matches case-insensitively, the other families do not (#4548).

- [ ] **Step 5: Run to verify they pass**, plus the gate-coverage neighbour

Run: `node --test tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/hooks-gate-coverage.test.js`
Expected: PASS

- [ ] **Step 6: Go-red proofs.** (a) Remove `processKill` from `GUARDED_PROGRAM_WORDS`: confirm the prefilter differential and witness tests fail; restore. (b) Drop the case-insensitive comparison from `shouldRunFull`: confirm the `TASKKILL /IM node.exe` and `Stop-process -Name node` runs-full tests fail; restore. (c) Drop the post-walk pgrep arming: confirm the pgrep-fed cases fail; restore. Quote each failing test name in the task report.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js plugin/bin/lib/hooks/bash-prefilter.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js
git commit -m "Parse name-based process kills and reach them from the prefilter — refs #4548"
```

### Task 5: Warn-tier `checkProcessKillWarn` gate and its docs

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (import `processKillByName` at line 28; new `checkProcessKillWarn` after `checkGitStashWarn`, ~line 940; call it on the line after `checkGitStashWarn(segments, warnings);`, line 2247)
- Modify: `docs/hooks.md` (new bullet directly after the Git-stash gate bullet, line 13; "five guard parsers" → "six guard parsers" and a case-insensitivity clause in the Bash prefilter bullet, line 16)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:32` ("the five guard parsers (`gitTargets`, `fileWriteTargets`, `mkdirTargets`, `teardownTargets`, `powershellOpaqueCommand`)" → "the six guard parsers (… `powershellOpaqueCommand`, `processKillByName`)")
- Modify: `.claude/skills/shell-scanner-bash-differential/SKILL.md:85` ("five guard parsers" → "six guard parsers")
- Test: `tests/hooks-pre-tool-use.test.js`

**Interfaces:**
- Consumes: Task 4's `processKillByName(command, cwd) -> string[]`.
- Produces: `checkProcessKillWarn(command: string|null, cwd: string|null, warnings: string[]) -> void` in `pre-tool-use.js` (not exported).

- [ ] **Step 1: Write failing tests** in `tests/hooks-pre-tool-use.test.js`, after the #2065 stash block, a `#4548` block. `dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4548-'))` (not a git repo — proves location independence); `const run = (cmd) => pre.run({ input: bashInput(cmd, dir), runDir: null, runState: null, cwd: dir });`.
  - One test per warn case (AC4.1, AC4.3, AC8.1, AC8.2, AC9.1, AC9.3), titled `#4548: \`{cmd}\` warns about killing by image or name`, asserting `out.json.systemMessage` matches `/by image or name/` and `/-sTCP:LISTEN/`, and `!(out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision)`: `pkill node`, `killall node`, `taskkill /F /IM node.exe`, `taskkill /im node.exe /f`, `Stop-Process -Name node`, `kill $(pgrep node)`, `pgrep -f x | xargs kill`, `taskkill /FI "IMAGENAME eq node.exe"`, `Get-Process node | Stop-Process`, `TASKKILL /IM node.exe`.
  - `#4548: a compound command with several name kills warns once` — for `npm run dev & sleep 1; pkill -f vite; killall node`, the systemMessage contains `by image or name` exactly once.
  - One test per silent case (AC4.2, AC4.3), titled `#4548: \`{cmd}\` is PID-scoped and stays silent`, asserting `!out.json || !/by image or name/.test(out.json.systemMessage || '')`: `kill 12345`, `taskkill /PID 12345 /T /F`, `kill -- -12345`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-pre-tool-use.test.js`
Expected: FAIL (no warning emitted)

- [ ] **Step 3: Implement `checkProcessKillWarn`**: return when `command` is falsy; inside `try`, if `processKillByName(command, cwd).length` push one message; `catch` swallows. Message text (exact):

```
claude-tweaks: killing a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`, a `pgrep`-fed `kill`) matches every process of that name on this machine — the process table is shared with every sibling session and worktree, so it can take down their dev servers and tooling. Kill only a PID you captured when you started the process, or the listener on a port you own (`lsof -nP -iTCP:{port} -sTCP:LISTEN -t`, then `kill {pid}`; win32: `taskkill /PID {pid} /T /F`).
```

  Call it as `checkProcessKillWarn(command, ctx.cwd, warnings);` on the line after `checkGitStashWarn(segments, warnings);`. Comment above the function: #4548, warn-only, run- and location-independent because the hazard is machine-wide (contrast with `checkGitStashWarn`'s linked-worktree condition), and reachable only because `GUARDED_PROGRAM_WORDS.processKill` feeds the prefilter, case-insensitively.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/hooks-pre-tool-use.test.js tests/hooks-bash-prefilter.test.js tests/hooks-gate-coverage.test.js`
Expected: PASS

- [ ] **Step 5: Docs (AC6.1).** In `docs/hooks.md`, after the Git-stash bullet, add a `**Process-kill-by-name gate (warn tier, #4548):**` bullet: `pre-tool-use.js`'s `checkProcessKillWarn` (parser `git-command.js`'s `processKillByName`) fires on a Bash segment led by `pkill` or `killall`; `taskkill` with an `/IM` token or a non-PID `/FI` filter (`/FI "IMAGENAME eq node.exe"`; flags case-insensitive, any position, `//IM` and `-im` too); `kill`/`Stop-Process` with `-Name`/`-ProcessName`; a `kill` segment in a command that also runs `pgrep`/`pidof` (`kill $(pgrep node)`, `pgrep -f x | xargs kill`); or a `Get-Process` (no `-Id`) piped to `Stop-Process`. Command names match case-insensitively (`TASKKILL`, `Stop-process`), since `taskkill` and PowerShell cmdlets are case-insensitive on Windows. Warn-only `systemMessage` naming the shared machine-wide process table and the PID-scoped alternative; run- and location-independent; never fires on `kill {pid}`, `kill -- -{pid}`, `taskkill /PID`, or a `-sTCP:LISTEN` listener lookup; its words are `GUARDED_PROGRAM_WORDS.processKill`, which the prefilter matches case-insensitively, so a bare `pkill node` or `TASKKILL /IM node.exe` reaches it. In the Bash prefilter bullet, change "five guard parsers" to "six guard parsers" and, after "as a shell word or path basename", add "(the process-kill family case-insensitively, #4548)". Make the same "five" → "six" edits in `policy-schema-coverage.md` (adding `processKillByName` to its parenthesised list) and `.claude/skills/shell-scanner-bash-differential/SKILL.md`.

- [ ] **Step 6: Go-red proof.** Make `checkProcessKillWarn` a no-op (early `return`), confirm the warn cases fail, restore. Quote one failing test name in the task report.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js docs/hooks.md plugin/skills/_shared/policy-schema-coverage.md .claude/skills/shell-scanner-bash-differential/SKILL.md tests/hooks-pre-tool-use.test.js
git commit -m "Warn on name-based process kills in PreToolUse — refs #4548"
```
