# Wait instructions name wait-for.js — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every instruction that tells a dispatched agent how to wait on nested children, a CI run or a process names `plugin/bin/wait-for.js` (shipped by #5602) instead of `sleep 20` calls, with windows that keep their 20-minute meaning by the clock.

**Architecture:** Prose-only change to three copies of one rule (the core section is the definition; `task-prompt.md` item 7 restates it; the `context-handoff.md` template copies item 7 word for word), one bounded-polling paragraph, and their restatements; `tests/foreground-execution-instruction.test.js` re-pins the copies and runs the byte-pinned invocation line against the real CLI. A parked measurement record is filed by the controller.

**Tech Stack:** Markdown skill prose, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T155352-record-5604/work/5604-spec.md` (record #5604)

Scope keywords: sleep 20, 60-wait

## Global Constraints

- Invocation line, exactly (core writes `${CLAUDE_PLUGIN_ROOT}` where item 7 and the handoff template write `{plugin-root}`): `node "{plugin-root}/bin/wait-for.js" agents --ids {ids} --max-seconds 150`
- Unchanged word for word (spec Deliverable 2): the read-only probe commands, "stop when a whole window passes with no change", "a ceiling of 3 windows (60 minutes) per wave", the two stop reasons, "A failed wait call counts as no wait but ends its window", the read-only self-judge at the first bound, the rendered-UI exception, never reading a running child's `output_file`, never redoing a write-capable child in-session.
- The handoff template's `Async-wait discipline (required):` paragraph is item 7's body word for word (`tests/flow-context-handoff-conformance.test.js` squashes whitespace and requires `includes`): edit item 7 first, then copy it.
- `plugin/skills/dispatch/task-prompt.md` grows by no more than 1,200 bytes against the merge base (AC9; base 45,049 B, rail 52,500 B). `context-handoff.md` (17,805 B) has > 30 KB headroom.
- **Composed-bundle rail (found by plan audit, not in the spec):** the core file is a source of `/review`'s `review-dispatch` composed bundle (`plugin/bin/lib/compose-context/phases.js:31`: core + `_shared/run-dir-resolution.md`), whose largest variant is 52,221 B at base against the 52,500 B rail (279 B headroom). Every task that edits the core must leave that bundle at or under its base size; Tasks 1 and 2 each pair their additions with the exact narrative trims named in their task (evidence sentences only, never an instruction). Verify with `node --test tests/bin-lib/skill-audit/context-cost.test.js tests/review-dispatch-composition.test.js` and the plan-audit `headroom.composed` row.
- No `docs/` path cited in the new skill prose (it does not ship; cite `#5602` instead).
- Governing skill `.claude/skills/skill-prose-conformance-tests` (quoted verbatim):
  - "Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`."
  - "That forces each pattern to match exactly once in its slice. A strip that also breaks a neighbouring pattern reports two facts."
  - "Keep the patterns non-global: a `/g` regex makes `replace` strip every occurrence, which hides the twice-matched phrase, and its `.test()` carries `lastIndex` from one call to the next."
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "Reach for **byte-pinning** when the probe has to wrap the snippet in fixture-specific surroundings — then assert it byte-identical **and** execute it."
  - "| Sweeping a derived region set for a banned literal without asserting the set is non-empty | The extractor becomes part of the assertion, silently: a regex matching no region reports zero offenders and certifies a convention it never checked |"
  - "Keep the expected count, list, or threshold a literal; a test-local constant is fine."

## Review Focus

- A partial report (exit 0 with some children still pending): the prose must say call again with the remaining ids — Task 1 pins "call again while any child is outstanding".
- An agent whose `{plugin-root}` is wrong gets exit 127/2: the failed-call sentence must cover exit 2 and forbid a `sleep` retry — Task 1 pins both.
- A rendered dispatch prompt must carry the invocation with `{plugin-root}` filled, exactly once — Task 1 AC4 test.
- The bounded-watch loop in `_shared/pr-first-merge.md` keeps its `sleep 30` lines with no backtick and must not be matched by the AC3 sweep — Task 2 asserts it.
- Restated "60-wait window" phrasing outside the Key Files (`_shared/rendered-ui-units.md` line 7) would describe a primitive that no longer exists — Task 3 rewords it.

---

### Task 1: The keep-alive rule names wait-for.js in all three copies

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (Foreground Execution Discipline, the **Nested `Agent` children** paragraph, lines 66-117)
- Modify: `plugin/skills/dispatch/task-prompt.md` (Context pack item 7, lines 37-92)
- Modify: `plugin/skills/flow/context-handoff.md` (template `Async-wait discipline (required):` paragraph lines 84-138; step 3 "Wait" line 52)
- Test: `tests/foreground-execution-instruction.test.js`
- Test: `tests/flow-context-handoff-conformance.test.js`

**Interfaces:**
- Produces: `WAIT_FOR_FACTS` (pattern list) and `INVOCATION_NEEDLE = '/bin/wait-for.js" agents --ids'` in `tests/foreground-execution-instruction.test.js`; `primitiveCopies()` keeps its name and return shape.

**The prose (exact copy).** In item 7, replace `repeated \`sleep 20\` Bash calls, at most 60 (20 minutes) per wave of children (the set launched together), each wait logged as one line (what you wait on, the iteration against the bound, how many children are still pending), stopping` with:

> `node "{plugin-root}/bin/wait-for.js" agents --ids {ids} --max-seconds 150`, 20 minutes per wave of children (the set launched together), stopping

and directly after `and never end your turn with one outstanding.` insert:

> `{ids}` are the agent ids of the children whose notification has not arrived, comma-separated. Make each call a foreground Bash call with no `timeout` parameter: the command returns within 150 seconds, under the 180-second ceiling a dispatched agent's foreground call has (#5602). Exit 0 means a listed child stopped: its notification is in hand or arrives next; call again while any child is outstanding. Exit 3 with `"bound":"call"` means call again. Exit 3 with `"bound":"deadline"` means the 20-minute window is over: the bound has expired, and when the rule below grants another window, the next call is that window. Exit 2 is a failed wait call. The command's output line is the wait's log line, so write no separate one.

Replace `grant one more 60-wait window` with `grant one more 20-minute window`. Replace `A wait call that is blocked or fails is not a wait and never counts toward the bound; never retry it in another form (a longer, wrapped or backgrounded sleep):` with `A wait call that is blocked or fails is not a wait and does not move the window's deadline; never retry it in another form (a \`sleep\` of any length, or a longer, wrapped or backgrounded call):`.

The core section gets the same edits in its own voice: invocation `node "${CLAUDE_PLUGIN_ROOT}/bin/wait-for.js" agents --ids {ids} --max-seconds 150`, 20 minutes per wave of children (the set launched together; a child that keeps editing its worktree earns more windows, below), stopping …; the old `each wait logged per the bounded-polling paragraph below (what is waited on, the iteration against the bound, how many children are still pending),` is deleted; the inserted sentences go directly after `and never ends its turn with a child outstanding.`, identical to item 7's except `Each call is a foreground Bash call with no …` and `so the agent writes no separate one.`; the failed-call sentence keeps its `(a harness or hook refusal)` parenthetical as `(a harness or hook refusal, or exit 2)` and its trailing `and apply the fallback above.` Then copy item 7's body into the handoff template paragraph. **Core byte trims (same task, keeps the review-dispatch bundle under the rail).** In `subagent-dispatch-core.md`: (T1) delete ` Observed on record #315 — both dispatched implementers hit this denial on their first commit and both cleared it with one re-stamp, solely because the dispatch prompt had been pre-warned.` from the **A denial is recoverable** paragraph; (T2) in the **One plain command per Bash call.** paragraph replace ` Observed across five implementer dispatches on the skill-invocation-ledger build: every dispatch that baked this constraint into its prompt up front avoided the failure; none that omitted it did. #3480's medium-tier review lens agents, whose prompts lacked it, hit the guard about 14 times in three minutes on their own scratch files (#3675).` with ` Prompts that omitted it hit the guard repeatedly (#3675).`; (T3) in **Background work.** replace `can hang it until an outside caller intervenes. Observed as a harness-level \`contract-violation\` pattern: 13+ occurrences of agents narrating "waiting for the background task/Monitor notification" and stopping mid-turn in one build phase, plus 2 more in a review/wrap-up session, corrected only externally (#1965, #2271).` with `can hang it until an outside caller intervenes (#1965, #2271).` (no test pins any of the three: `git grep -F` over `tests plugin .claude/skills docs` finds each only in the core).

In `context-handoff.md` step 3, replace `(\`sleep 20\` at most 60 times, 20 minutes, stretched to at most 60 while the write-capable child keeps changing its worktree)` with `(\`wait-for.js agents\` calls for a 20-minute window, stretched to at most 3 windows, 60 minutes, while the write-capable child keeps changing its worktree)`.

- [ ] **Step 1: Write the failing tests** in `tests/foreground-execution-instruction.test.js`:
  - Remove from `SHARED_RULE` the `` `sleep\s+20`… `` primitive entry, the `how many children are still pending` entry, and replace the `blocked or fails … never counts toward the bound` entry with `/blocked\s+or\s+fails[^.]*?is\s+not\s+a\s+wait\s+and\s+does\s+not\s+move\s+the\s+window's\s+deadline;\s+never\s+retry\s+it\s+in\s+another\s+form\s+\(a\s+`sleep`\s+of\s+any\s+length/`.
  - Add `WAIT_FOR_FACTS` (non-global), each `[regex, fact]`: invocation `` /`node\s+"(?:\$\{CLAUDE_PLUGIN_ROOT\}|\{plugin-root\})\/bin\/wait-for\.js"\s+agents\s+--ids\s+\{ids\}\s+--max-seconds\s+150`,\s+20\s+minutes\s+per\s+wave\s+of\s+children/ ``; ids `` /`\{ids\}`\s+are\s+the\s+agent\s+ids\s+of\s+the\s+children\s+whose\s+notification\s+has\s+not\s+arrived,\s+comma-separated/ ``; foreground `` /foreground\s+Bash\s+call\s+with\s+no\s+`timeout`\s+parameter:\s+the\s+command\s+returns\s+within\s+150\s+seconds,\s+under\s+the\s+180-second\s+ceiling/ ``; exit 0 `/Exit\s+0\s+means\s+a\s+listed\s+child\s+stopped:\s+its\s+notification\s+is\s+in\s+hand\s+or\s+arrives\s+next;\s+call\s+again\s+while\s+any\s+child\s+is\s+outstanding/`; exit 3 call `` /Exit\s+3\s+with\s+`"bound":"call"`\s+means\s+call\s+again/ ``; exit 3 deadline `` /Exit\s+3\s+with\s+`"bound":"deadline"`\s+means\s+the\s+20-minute\s+window\s+is\s+over:[^.]*?the\s+next\s+call\s+is\s+that\s+window/ ``; exit 2 `/Exit\s+2\s+is\s+a\s+failed\s+wait\s+call/`; log line `/The\s+command's\s+output\s+line\s+is\s+the\s+wait's\s+log\s+line,\s+so\s+(?:write|the\s+agent\s+writes)\s+no\s+separate\s+one/`.
  - `test('AC1.1 AC1.2: every copy states each wait-for.js fact (#5604)')` — `missingFactsOf(WAIT_FOR_FACTS)(text)` is `[]` for each of `primitiveCopies()`; `test('AC1.2: each wait-for.js fact goes red when removed from any single copy')` — `assertEachPatternGoesRed(text, WAIT_FOR_FACTS, …)` per copy.
  - Replace `PRIMITIVE`/`EXPECTED_PRIMITIVE`/`statesPrimitiveOnce` with an invocation-once check: `countOf(text.replace(/\s+/g, ' '), INVOCATION_NEEDLE) === 1` and the copy matches `/--max-seconds\s+150`,\s+20\s+minutes\s+per\s+wave/`. Rename the agreement test to `'AC1.1: each copy holds the invocation line exactly once, with --max-seconds 150 and a 20-minute window (#5604)'`; its discrimination proof doctors each copy three ways (`--max-seconds 150` → `--max-seconds 100`, `20 minutes per wave` → `30 minutes per wave`, and a duplicated invocation appended) and requires exactly that copy red.
  - `PROGRESS_CHECK`'s grant entry becomes `/Per\s+wave,\s+while\s+any\s+child\s+shows\s+a\s+change,\s+log\s+one\s+wait\s+line\s+and\s+grant\s+one\s+more\s+20-minute\s+window/`; `STANDING_RULES`, `RENDERED_UI_EXCEPTION_FACTS`, `CORE_ABANDONED` stay byte-identical (cite AC6.1 AC6.2 in the PROGRESS_CHECK test names).
  - `renderedCounts`: replace `primitive` with `invocation: countOf(squashed, INVOCATION_NEEDLE)` and `filled: countOf(squashed, 'node "/p/root/bin/wait-for.js" agents --ids')`. Test `'AC4.1: a rendered first-call and second-call prompt each hold the invocation once, plugin root filled (#5604)'` asserts `invocation === 1`, `filled === 1`, and `!squashed.includes('{plugin-root}/bin/wait-for.js')` per call (keep the existing probe/runInBackground/projectTestCmd asserts). Its go-red: insert the line `` keep alive with `node "{plugin-root}/bin/wait-for.js" agents --ids {ids} --max-seconds 150`. `` before each template's `{context-pack}` line (reuse `withParagraphRestored`) and assert `invocation === 2`. The existing #5601 restore test keeps only its `probe === 2` assertion (the frozen pre-5601 fixture carries the old primitive, never the invocation).
  - `templateDefects`: replace `new RegExp(PRIMITIVE.source).test(squashed)` with `squashed.includes(INVOCATION_NEEDLE)`.
  - `test('AC5.1: the core invocation line runs against the real CLI and reports a call bound in window 1 (#5604)')`: extract `` /`(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/wait-for\.js" agents [^`]*)`/ `` from `coreForegroundSection`, `assert.strictEqual` it to the literal `'node "${CLAUDE_PLUGIN_ROOT}/bin/wait-for.js" agents --ids {ids} --max-seconds 150'`; fill `node` → `"${process.execPath}"`, `${CLAUDE_PLUGIN_ROOT}` → the checkout's `plugin` dir, both forward-slashed, `{ids}` → `fixture-a,fixture-b`, `--max-seconds 150` → `--max-seconds 1` (assert each replace changed the string); `spawnSync('bash', ['-c', cmd], { encoding: 'utf8', windowsHide: true, env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, CLAUDE_CODE_SESSION_ID: 'fixture-5604-' + process.pid } })` with `dir` a fresh `fs.mkdtempSync` removed in `t.after`; assert `status === 3`, `JSON.parse(stdout).bound === 'call'`, `.window === 1`. Control in the same test: the same command with `--max-seconds 151` exits 2.
  - In `tests/flow-context-handoff-conformance.test.js`: line 377's doctor anchor becomes `.replace('--max-seconds 150', '--max-seconds 120')`; line 392's pattern becomes `/Per wave, while any child shows a change, log one wait line and grant one more 20-minute window/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js tests/flow-context-handoff-conformance.test.js`
Expected: FAIL (the WAIT_FOR_FACTS, invocation-once, AC4.1, AC5.1 and 20-minute-window tests red; the prose still says `sleep 20`).

- [ ] **Step 3: Edit the three copies and step 3** exactly as "The prose" above, item 7 first, then the core section, then paste item 7's body into the handoff paragraph.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/foreground-execution-instruction.test.js tests/flow-context-handoff-conformance.test.js tests/dispatch-prompt-bundle-citations.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/review-dispatch-composition.test.js`
Expected: PASS, 0 failures (context-cost holds the composed-bundle rail).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/dispatch/task-prompt.md plugin/skills/flow/context-handoff.md tests/foreground-execution-instruction.test.js tests/flow-context-handoff-conformance.test.js
git commit -m "Name wait-for.js in the keep-alive rule's three copies — refs #5604"
```

### Task 2: Bounded polling names wait-for.js ci and pid; no backtick sleep in skills

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (the **Bounded polling for a long external wait.** paragraph, lines 123-137)
- Test: `tests/foreground-execution-instruction.test.js`
- Waived `plugin/skills/_shared/pr-first-merge.md`: read only, by the AC3.2 assertion below.

**Interfaces:**
- Consumes: `coreForegroundSection(text)` from the same test file.

**The prose (exact copy).** Replace `The compliant shape is a **bounded check-interval loop run with real foreground tool calls**: repeated \`Bash\` calls (or a \`Monitor\` watch over a polling script) that check the external condition on a fixed interval — e.g. \`sleep 20 && gh run view {id} --json status,conclusion\` — never a backgrounded watcher left to report back on its own.` with:

> The compliant shape is a **bounded check-interval loop run with real foreground tool calls**. For a pull request's checks, a workflow run or a local process it is `wait-for.js` (`wait-for.js ci --pr {n}`, `wait-for.js ci --run {id}`, `wait-for.js pid --pid {pid}`), called as the `agents` form above (foreground, no `timeout`, `--max-seconds 150`): 0 means read the result, 3 with `"bound":"call"` means call again, and 3 with `"bound":"deadline"` means the bound is exhausted (below). For any other condition (a deploy, a log line), repeated `Bash` calls (or a `Monitor` watch over a polling script) check it on a fixed interval, never a backgrounded watcher left to report back on its own.

The rest of the paragraph (cap the loop, the 20-second/15-attempt default, the re-arm) stays unchanged. **Byte trim (T4):** in the "Log every iteration" paragraph replace `This is the detail that matters most in practice: without it, "an agent doing bounded polling with real tool calls" and "an agent stuck in a silent loop" are indistinguishable from outside the transcript, and a coordinating session watching the dispatched work has no signal to check before interrupting with a false-alarm check-in (#2784).` with `Without it, bounded polling and a silent loop look the same from outside the transcript, and a coordinating session has no signal before a false-alarm check-in (#2784).`

- [ ] **Step 1: Write the failing tests** (appended to `tests/foreground-execution-instruction.test.js`)
  - `boundedPollingParagraph(core)`: from `coreForegroundSection`, the blank-line-split paragraph starting `**Bounded polling for a long external wait.**`, asserting exactly one.
  - `BOUNDED_POLLING = [[/wait-for\.js\s+ci\s+--pr/, …], [/wait-for\.js\s+ci\s+--run/, …], [/wait-for\.js\s+pid\b/, …], [/3\s+with\s+`"bound":"deadline"`\s+means\s+the\s+bound\s+is\s+exhausted/, …]]`; `test('AC7.1: the bounded-polling paragraph names wait-for.js ci --pr, ci --run and pid (#5604)')` asserts `missingFactsOf(BOUNDED_POLLING)` is `[]` and `assertEachPatternGoesRed` over the paragraph.
  - `backtickSleepHits(files)` → paths whose text matches `` /`sleep \d/ ``, where `files` is `[path, text][]`; `skillFiles(root)` walks every file under `root` recursively (all extensions) and reads it with `readText`.
  - `test('AC3.1 AC3.2: no file under plugin/skills puts a backtick directly before sleep and a digit (#5604)')`: `files = skillFiles(path.join(PLUGIN, 'skills'))`; `assert.ok(files.length > 100)`; `assert.deepEqual(backtickSleepHits(files), [])`; the `_shared/pr-first-merge.md` entry's text matches `/sleep 30/` (the anchor that must stay unmatched).
  - `test('AC3.3: the backtick-sleep sweep goes red on a fixture copy carrying such text')`: copy `files`, append ``' `sleep 20` '`` to the `_shared/subagent-dispatch-core.md` entry's text, and assert `backtickSleepHits` returns exactly that one path.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js`
Expected: FAIL after Step 1 — AC7.1 (no `wait-for.js ci` yet) and AC3.1 (`` `sleep 20 && gh run view `` still in the core).

- [ ] **Step 3: Replace the sentence** exactly as above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/foreground-execution-instruction.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/review-dispatch-composition.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md tests/foreground-execution-instruction.test.js
git commit -m "Name wait-for.js ci and pid in the bounded-polling paragraph — refs #5604"
```

### Task 3: Restatements state the new primitive

**Role:** transcription

**Files:**
- Modify: `docs/skill-graph.md` (line 279, the `_shared/subagent-dispatch-core.md` row under `/dispatch`)
- Modify: `docs/journeys/hand-a-phase-to-a-fresh-agent-at-the-context-cap-4027.md` (line 44)
- Modify: `docs/journeys/keep-a-second-reader-in-a-dispatched-review-3078.md` (lines 23, 33)
- Modify: `docs/journeys/keep-waiting-on-a-progressing-implementer-4557.md` (lines 13, 14, 20, 29, 30, 50)
- Modify: `docs/journeys/route-a-late-rendered-ui-review-result-5280.md` (lines 13, 30, 31, 60)
- Modify: `docs/journeys/block-on-a-child-agent-ci-or-process-5602.md` (lines 12, 42; outside Key Files; AC2 requires it)
- Modify: `docs/journeys/measure-sleep-poll-waits-5602.md` (lines 11, 29, 34; outside Key Files; AC2 requires it)
- Modify: `plugin/skills/_shared/rendered-ui-units.md` (line 7; outside Key Files; behavior-change sweep: "one more 60-wait window" names a primitive that no longer exists)
- Waived `docs/reference/blocking-wait-probe.md`: read only; Task 1's 150-second / 180-second ceiling facts come from it (the spec's Gotchas cite it), and it is history of #5602's probe, not instruction prose.

Replacements (each a phrase-level edit, rest of the line unchanged):
- skill-graph row 279: append `Since #5604 the rule's wait is one blocking command, \`wait-for.js agents --ids {ids} --max-seconds 150\`, in a 20-minute window per wave, and the bounded-polling paragraph names \`wait-for.js ci\` and \`wait-for.js pid\` for CI runs and processes.`
- 4027:44 `waits 20 minutes (\`sleep 20\`, at most 60 times) under its own prompt's rule, and up to 60 while` → `waits a 20-minute window (\`wait-for.js agents\` calls) under its own prompt's rule, and up to 3 windows (60 minutes) while`
- 3078:23 `makes foreground \`sleep 20\` Bash calls, at most 60 per wave (20 minutes); a wait call the harness blocks is never retried in another form. Each wait iteration gets one line naming the lenses waited on, the iteration against the bound, and how many children are still pending.` → `makes foreground \`wait-for.js agents --ids {ids} --max-seconds 150\` calls, 20 minutes per wave; a wait call the harness blocks is never retried in another form, a \`sleep\` included. Each call's JSON output line is the wait's log line, naming the children still pending.`; 3078:33 `60-wait bound` → `20-minute bound`
- 4557:13 `60 x \`sleep 20\` wait bound (20 minutes)` → `20-minute \`wait-for.js\` wait bound`; 4557:20 `waits with foreground \`sleep 20\` calls as before, logging one line per wait` → `waits with foreground \`wait-for.js agents\` calls as before, each call's output line its log line`; every `60-wait` in 4557 (lines 14, 29, 30, 50) → `20-minute`
- 5280:13 `60 x \`sleep 20\` wait bound (20 minutes)` → `20-minute \`wait-for.js\` wait bound`; every `60-wait` in 5280 (lines 30, 31, 60) → `20-minute`
- 5602 block-on:12 `Today the keep-alive rule tells it to call \`sleep 20\` up to 60 times per wave.` → `Before #5604 the keep-alive rule told it to make up to 60 twenty-second sleep calls per wave.`; :42 `took up to 60 \`sleep 20\` calls per wave` → `took up to 60 twenty-second sleep calls per wave`, and `The skill prose that tells agents to call it lands separately (#5604).` → `The keep-alive rule in \`_shared/subagent-dispatch-core.md\` names it since #5604.`
- 5602 measure:11 `tells every subagent to wait with repeated \`sleep 20\` calls` → `told every subagent, before #5604, to wait with repeated twenty-second sleep calls`; :29 `` `echo sleep 20` `` → `` `echo sleep 30` ``; :34 `` `sleep 20; gh pr checks 12` `` → `` `sleep 30; gh pr checks 12` ``
- rendered-ui-units.md:7 `one more 60-wait window` → `one more 20-minute window`

- [ ] **Step 1: Run the AC2 grep to confirm it matches now** (absence-grep control)

Run: `git grep -n -F "sleep 20" -- plugin/skills docs/journeys`
Expected: prints lines (control: it matches the target before the change).

- [ ] **Step 2: Make the replacements above.**

- [ ] **Step 3: Verify AC2.1 and the 60-wait sweep**

Run: `git grep -n -F "sleep 20" -- plugin/skills docs/journeys` — Expected: no output, exit 1.
Run: `git grep -n -F "60-wait" -- plugin docs/journeys docs/skill-graph.md` — Expected: no output, exit 1.
Run: `node --test tests/foreground-execution-instruction.test.js tests/rendered-ui-units-launch-sites.test.js` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/skill-graph.md docs/journeys/hand-a-phase-to-a-fresh-agent-at-the-context-cap-4027.md docs/journeys/keep-a-second-reader-in-a-dispatched-review-3078.md docs/journeys/keep-waiting-on-a-progressing-implementer-4557.md docs/journeys/route-a-late-rendered-ui-review-result-5280.md docs/journeys/block-on-a-child-agent-ci-or-process-5602.md docs/journeys/measure-sleep-poll-waits-5602.md plugin/skills/_shared/rendered-ui-units.md
git commit -m "Restate the wait-for.js primitive in skill-graph and journeys — refs #5604"
```

### Task 4 (controller, not dispatched): parked measurement record and size evidence

Run by the controller after Task 3, since it files a record through `/claude-tweaks:capture` and edits the PR body.

- [ ] **Step 1:** File the parked record via `/claude-tweaks:capture` with the `parked` label. Body carries (AC8.1-AC8.n): `Trigger: 2026-12-16` (30 days after the PR opened 2026-11-16) and the instruction to move it to 30 days after the release that carries this change if that release came later; the baseline re-derived at build time with `node tools/wait-polls.js --since-days 30` (2026-11-16: 70,598 of 764,463 subagent Bash calls sleep-led, 9.2%; per target: agent-notification 66,549, background-process 1,039, output-file 774, other 707, ci 637, worktree-git 570, verify 284, suite-slot 171, dev-server 109); that command as the one to run again (it runs past 3 minutes, so from a terminal); the threshold of 0.5% of subagent Bash calls; that the share covers this machine's transcript store only and no cloud routine runs; the instruction to report the share per target and file a follow-up for the largest remaining target when above the threshold.
- [ ] **Step 2:** Link the parked record in PR #5776's body (below the fixes block, above the session link).
- [ ] **Step 3 (AC9.1 AC9.2 evidence):** `git show {merge-base}:plugin/skills/dispatch/task-prompt.md` byte count vs `wc -c` of the working copy; growth ≤ 1,200 B; log one `AUTO` `AC evidence` decision line with both numbers.

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC8.1, AC8.2, AC8.3, AC8.4, AC8.5, AC8.6 | Task 4 Step 1 (record body) and Step 2 (PR link); the controller reads the filed body back with `gh issue view` and checks each clause |
| AC9.1, AC9.2 | Task 4 Step 3 (byte count against the merge base, logged as AC evidence) |

Waived AC2.2: informational (the base-commit count), its control is Task 3 Step 1.
Waived AC10.1: run by `/claude-tweaks:test`'s full verify, not a plan task.

## Check B hits left out of scope

`tests/fixtures/dispatch-prompt/foreground-paragraph-pre-5601.txt` (frozen pre-#5601 bytes, the restore control's input), `tests/wait-polls/cli.test.js` (fixtures of the measuring tool, which classifies `sleep 20` commands), `docs/reference/blocking-wait-probe.md` and `docs/superpowers/plans/2026-11-16-wait-for.md` (#5602's history), and this run's ledger: each quotes `sleep 20` as data or history, not as instruction, so none changes.
