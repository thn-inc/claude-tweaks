# Settle Blocker-Landing Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatched record stopped by `/flow`'s pre-claim blocker-landing check (#4553) settles as a non-failing stop: no retry counted, no `auto:merge` revoked, no `bot:blocked`. A claim and draft PR are released and tombstoned only when an earlier call of the same run took them. Dispatch's queue pull also stops selecting a record whose out-of-run blocker is `unlanded` until that blocker lands.

**Architecture:** Two halves. (1) Prose contract, pinned by `node --test` conformance suites: `/flow` names the stop's gate (`blocker-landing`) and its dispatch report line in `failure-cards.md`. Dispatch's Settle Step 6 gains a special case keyed on `ISSUE #{n}: failed:blocker-landing`, beside its existing pre-flight special cases. In the claimed case it runs steps 1-2 and step 5's PR tombstone only. `failure-check` learns how to classify the stop, and the headless self-report gets the name `flow-step-2.7b-blocker-landing`. (2) A selection-time exclusion. `preflight-records.js` gains `--prefetched-json` (records already fetched over `gh`, so it skips only the per-record `gh issue view`). A new CLI, `bin/dispatch-unlanded-blockers.js`, over `bin/lib/dispatch/unlanded-blockers.js`, hands the queue pull's remaining candidates to one `preflight-records.js --prefetched-json - --blocker-landing` call. It appends a `reason: 'unlanded-blocker'` entry per excluded record and prints the filtered pool. `queue-pull-script.md` runs it in a 9-line block, and its size headroom comes from moving three passes' rationale comments into `queue-pull-notes.md`.

**Tech Stack:** Markdown skill files; Node CLIs under `plugin/bin/`; `node --test` (built-in), `node:assert/strict`, `tests/helpers/read-skill.js`'s `readText`, `tests/helpers/conformance-asserts.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T094008-record-4792/work/4792-spec.md` (record #4792)

**Scope keywords:** blocker-landing, failed:blocker-landing, flow-step-2.7b, unlanded-blocker, dispatch-unlanded-blockers, prefetched-json, issuesFromRecordsJson, appendExclusion, queue-pull-notes

## Global Constraints

- Every `/claude-tweaks:{skill}` reference inside actionable instruction text is fully qualified; bare `/{skill}` only in descriptive prose (CLAUDE.md Cross-references).
- Relationships between skills are stated once, in `docs/skill-graph.md` (CLAUDE.md Cross-references) — add the new edges there (Tasks 2 and 7), never as a restated edge in a SKILL.md.
- **Size rail (blocks):** `RAIL_BYTES` = 52,500 B and `RAIL_LINES` = 2,000 (`plugin/bin/lib/skill-audit/budgets.js`), enforced by `tests/bin-lib/skill-audit/context-cost.test.js`'s `rail: every shipped skill .md fits one Read call`. Measured base bytes (`wc -c` at `067ba13de`) and planned results, from byte counts of this plan's own insertion texts:

  | File | Base | Planned | Headroom |
  |---|---|---|---|
  | `plugin/skills/flow/failure-cards.md` | 6,277 | ~6,970 | ~45.5 KB |
  | `plugin/skills/flow/multispec-dependency-ordering.md` | 5,289 | ~5,422 | ~47 KB |
  | `plugin/skills/dispatch/settle-and-merge.md` | 48,902 | ~50,700 | ~1,800 B (96.6%) |
  | `plugin/skills/assess-agent-autonomy/failure-check.md` | 3,935 | ~4,330 | ~48 KB |
  | `plugin/skills/dispatch/queue-pull-script.md` | 52,091 | ~50,680 | ~1,820 B (96.5%) |
  | `plugin/skills/dispatch/queue-pull-notes.md` | 6,123 | ~10,640 | ~41.8 KB |
  | `plugin/skills/dispatch/SKILL.md` | 51,877 | ~51,960 | ~540 B (99.0%) |
  | `plugin/skills/dispatch/blocked-exclusion-report.md` | 2,109 | ~2,530 | ~50 KB |
  | `plugin/skills/dispatch/mcp-transport.md` | 21,383 | ~22,500 | ~30 KB |

  `queue-pull-script.md` has 409 B of headroom at base, and the new pass adds ~1,176 B (a 677 B reason bullet plus a 499 B script block). The remedy is fixed up front in Task 6: the pass's logic lives in the unit-tested CLI (Tasks 4-5), so the script carries one call, and three rationale-only comment blocks (#2829's 1,262 B, #1224's 949 B, #1983's 643 B) move out to `queue-pull-notes.md`, leaving one 85-95 B pointer line each. `SKILL.md` gets only the reason name twice plus one queue-definition clause (82 B). Do not add anything else to it. None of the touched files is in a composed bundle: no `compose-context.js` call site names any of them (`grep -rn "compose-context.js" plugin/skills` | grep for each file — none).
- Commit style: `{Verb} {what} — {detail}, refs #4792`, never `closes`/`fixes`. End each commit message with the line `Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN` (a second `-m`).
- Fixed literals: gate token `blocker-landing`; report line `ISSUE #{n}: failed:blocker-landing`; self-report name `flow-step-2.7b-blocker-landing`; release reason `failed: blocker-landing` (`_shared/issue-claims.md`'s Release triggers table: `failed: {gate}`); exclusion reason `unlanded-blocker`; CLI `plugin/bin/dispatch-unlanded-blockers.js`; preflight flag `--prefetched-json`.
- Governing project skill `.claude/skills/skill-prose-conformance-tests/SKILL.md` (every task's tests), quoted verbatim:
  - "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** … `tests/helpers/conformance-asserts.js` (`missingFactsOf`, `assertEachPatternGoesRed`) is the home of both … Keep the patterns non-global".
  - "Build the control by **permutation, not deletion**: take the live text, splice the later block above the earlier one, and assert the same helper *throws* on the permuted string".
  - "Slice with `tests/helpers/conformance-asserts.js`'s `sectionOf(text, '## Heading')` and `lineStartingWith(text, prefix)` instead of writing another local copy" — **import** them; never copy them (the #4827 helper superseded the old per-suite copies; `tests/no-dispatch-host-preflight-conformance.test.js` now imports them).
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - From `executable-snippet-pins.md`: "**Run a snippet the Bash tool executes under both `bash --noprofile --norc` and `zsh -f`.** … Skip the zsh case with a visible reason when zsh is not on PATH (ubuntu CI), never silently". "**A `node -e` fence that spawns a plugin CLI runs against a stub CLI, with the plugin root passed through the environment.**" "Pass `CLAUDE_PLUGIN_ROOT` with forward slashes (`path.join(ROOT, 'plugin').split(path.sep).join('/')`)".
  - Anti-pattern row: "Pinning a skill file's size against a byte literal … Import `RAIL_BYTES` from `budgets.js` and assert against it".
- Governing project skill `.claude/skills/gh-api-module-pattern/SKILL.md` and its `cli-wrapper-contract.md` (Tasks 4-5, `plugin/bin/**`), quoted verbatim:
  - "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract".
  - "**A fail-closed branch around an injected dependency needs one test of the real dependency's failure shape, not only a stub that throws.**"
  - "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout)."
  - "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**"
  - "**Bound every remote-contacting call on the seam; a local-only call owes no bound.**" and "**A seam that pipes a child whose output the module does not control sets `maxBuffer: LARGE_MAX_BUFFER_BYTES`**".
  - "**A seam that writes a body widens to `runner(args, input)` and pipes it on stdin, instead of staging a temp file.**" (why `--prefetched-json -` reads stdin).
  - "Tests never touch real `gh`: fake runners branch on the `args` shape … and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled".
- `.claude/skills/bin-source-scan-conformance/SKILL.md` does not apply: no task adds or changes a source-scan suite. The new `plugin/bin` code must still pass the existing scans (`tests/path-guard-conformance.test.js`: no `fs.existsSync`/`fs.realpathSync`; `tests/windows-hide-spawn-conformance.test.js`; `tests/bin-lib/exit-code-conformance.test.js`), so Tasks 4-5 run them. `claim-targets-stop-addition` does not apply (no `claim-targets.js` exit changes). `regex-scan-linearity` does not apply (no unbounded-text regex added under `plugin/bin`).
- Scope and edit discipline (CLAUDE.md Working Approach): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it."

## Review Focus

- A handoff continuation (`/flow #{n} test` with the run's `PIPELINE_RUN_DIR`) re-runs Step 2.7b while this run already holds the claim and its draft PR. Settle must release the claim (steps 1-2) and close the PR via step 5's tombstone (Q2 Reading A), but not post step 5's failure comment on the issue. Task 2 pins both halves and that the tombstone pointer never matches `retry.js`'s `ATTEMPT_RE`.
- A first call that stops at 2.7b holds no claim and has opened no PR (`/build` Spec Step 1 opens it, after Step 2.8). Settle must not run `release-claim.js`, which on an absent blob still posts a release comment (a false one). Task 2 pins "Otherwise … skip steps 1-2 and the tombstone".
- The selection-time pass must fail open. Step 2.7b re-checks before any claim, so a skipped exclusion costs one dispatch that ends in this record's non-failing stop. A pass that stopped the firing on a probe failure would block every unrelated record. Only a refused exclusions write or an unreadable `$DISPATCH_GROUPS` stops (#3110). Task 5 pins each fail-open branch with an input that only that branch decides.
- `undetermined` keeps the candidate, because Step 2.7b proceeds on `undetermined` too (`flow/validation.md` item 6), so excluding it would be stricter than the gate it predicts. `open` is not this pass's to exclude (the `blocked` pass owns open blockers). Task 5 pins both.
- Cost: this repo runs `work-links: native` with 189 open `auto:build` records (probed 2026-11-03). Plain `preflight-records.js` would make one `gh issue view` per candidate on every queue pull, and the drain Loop re-pulls each iteration. `--prefetched-json` keeps the pass at one native-dependency GraphQL call plus one landing GraphQL call plus one compare per distinct candidate commit. Task 5's AC3.1 test asserts zero `issue view` calls.
- The Settle special case must precede Settle step 1 in the linear procedure, or the generic path runs first. Task 2 pins placement with a permutation control. The queue-pull pass must sit after the shipped Close-proposal staging and before the neighbour-in-flight pass. Task 6 pins that the same way.

---

### Task 1: Name the `blocker-landing` gate in /flow

**Role:** transcription

**Files:**
- Modify: `plugin/skills/flow/failure-cards.md` (line 3 header sentence; routing table, append a row after the line starting `| Step 3 Manifesto ceremony-check returned no`)
- Modify: `plugin/skills/flow/multispec-dependency-ordering.md` (insert after the line starting `A failed blocker query is not \`undetermined\``)
- Test: `tests/flow-blocker-landing-conformance.test.js` (append)

**Interfaces:**
- Produces: the failure-cards routing row starting `| Step 2.7b blocker landing`, naming gate `blocker-landing` and the report line `ISSUE #{n}: failed:blocker-landing`. Task 2's Settle paragraph cites it as "`flow/failure-cards.md`'s blocker-landing row".

- [ ] **Step 1: Write the failing test** — append to `tests/flow-blocker-landing-conformance.test.js`. Its existing `readText`, `path`, `assert`, `FLOW_DIR`, `ORDERING`, `outOfRunSection` and `mutate` are in scope. Add `const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');` and `const FAILURE_CARDS = path.join(FLOW_DIR, 'failure-cards.md');`.

  `CARD_ROW_PREFIX = '| Step 2.7b blocker landing'`. `cardRow(text)` returns `lineStartingWith(text, CARD_ROW_PREFIX)` after `assert.ok(row, 'failure-cards.md has no line starting "| Step 2.7b blocker landing"')`. `CARD_FACTS` (non-global, each matching once in the row):
  - `/`open` or `unlanded` out-of-run blocker/` — 'AC1.1: the row names both stopping verdicts'
  - `/gate `blocker-landing`/` — 'AC1.1: the row names the gate'
  - `/when the run already holds claims \(a continuation re-running the pre-claim checks\), the claims rules below still apply/` — 'AC4.1: a continuation\'s held claims keep the claims rules'
  - `/`OUTCOME: build-test-blocked`, one `ISSUE #\{n\}: failed:blocker-landing` line per target, and `STATUS: BLOCKED`/` — 'AC2.1: the dispatch report line'
  - `/Settle treats it as a non-failing stop \(`dispatch\/settle-and-merge\.md`'s Blocker-landing special case\)/` — 'AC2.1: cites the Settle special case'

  Tests:
  - `test('AC1.1 AC2.1 AC4.1: failure-cards.md names the blocker-landing gate and its dispatch report (#4792)')` — `assert.deepEqual(missingFactsOf(CARD_FACTS)(cardRow(readText(FAILURE_CARDS))), [])`.
  - `test('AC1.2: each failure-cards blocker-landing fact can go red')` — `assertEachPatternGoesRed(row, CARD_FACTS, missingFactsOf(CARD_FACTS))`.
  - `test('AC1.1: failure-cards.md is loaded on the blocker-landing stop')` — line 3 (the line starting `Loaded by`) matches `/or Step 2's blocker-landing stop\) \*\*only when a gate fails\*\*/`. Control: `mutate(text, ", or Step 2's blocker-landing stop", '')` fails the same factored check.
  - `test('AC1.1: the out-of-run section routes both hard fails to the blocker-landing gate (#4792)')` — factor `assertRoutesToGate(text)` = `assert.match(outOfRunSection(text), /Either hard fail is gate `blocker-landing`; under `\/claude-tweaks:dispatch` report it per `failure-cards\.md`'s blocker-landing row\./, 'ordering section routes hard fails to the blocker-landing gate')`. It passes on `readText(ORDERING)`. Control: `mutate(text, /Either hard fail is gate[^\n]*\n/, '')` makes `assertRoutesToGate` throw with that message.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-blocker-landing-conformance.test.js`
Expected: FAIL — `failure-cards.md has no line starting "| Step 2.7b blocker landing"`, the loaded-on test, and `ordering section routes hard fails to the blocker-landing gate`; every pre-existing test still passes.

- [ ] **Step 3: Edit the prose**

  In `failure-cards.md` line 3, replace `Loaded by \`/claude-tweaks:flow\` Step 4 (or Step 3's Manifesto ceremony-check) **only when a gate fails**.` with `Loaded by \`/claude-tweaks:flow\` Step 4 (or Step 3's Manifesto ceremony-check, or Step 2's blocker-landing stop) **only when a gate fails**.` Append this row as the last row of the routing table (directly after the `| Step 3 Manifesto ceremony-check returned no` row):

  ```
  | Step 2.7b blocker landing (or multi-spec Validation step 3) stopped on an `open` or `unlanded` out-of-run blocker — gate `blocker-landing` | No template: the stop message (`multispec-dependency-ordering.md`'s verdict table and its `unlanded` card) is the whole report; when the run already holds claims (a continuation re-running the pre-claim checks), the claims rules below still apply. Under `/claude-tweaks:dispatch` the call reports `OUTCOME: build-test-blocked`, one `ISSUE #{n}: failed:blocker-landing` line per target, and `STATUS: BLOCKED`; Settle treats it as a non-failing stop (`dispatch/settle-and-merge.md`'s Blocker-landing special case) |
  ```

  In `multispec-dependency-ordering.md`, after the line `A failed blocker query is not \`undetermined\` — the call exits non-zero and the run stops before claiming (\`multispec-preflight-failure.md\`).`, insert a blank line and:

  ```
  Either hard fail is gate `blocker-landing`; under `/claude-tweaks:dispatch` report it per `failure-cards.md`'s blocker-landing row.
  ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/flow-blocker-landing-conformance.test.js tests/flow-manifesto-ceremony-fallback-conformance.test.js tests/multispec-preflight-failure-conformance.test.js tests/bin-lib/skill-audit/house-structure.test.js tests/skill-graph-table-structure.test.js`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/flow/failure-cards.md plugin/skills/flow/multispec-dependency-ordering.md tests/flow-blocker-landing-conformance.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Name the blocker-landing gate in /flow — dispatch report line for the pre-claim stop, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN"
  ```

### Task 2: Settle the blocker-landing stop as a non-failing stop

**Role:** transcription
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md` (new paragraph directly after the paragraph starting `**No-dispatch-host special case (#4555).**`, before the line starting `1. The CLI in step 2 performs the ownership read itself`)
- Modify: `docs/skill-graph.md` (`## dispatch` table: new row directly after the row starting `| \`build/execution-mode-policy.md\` |`)
- Create: `tests/settle-blocker-landing-stop-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's failure-cards row (it must contain `failed:blocker-landing`).
- Produces: the Settle paragraph starting `**Blocker-landing special case (#4792).**`. Task 3's failure-check bullet cites it as "`dispatch/settle-and-merge.md`'s Blocker-landing special case".
- Behavioral claims and their mechanisms: "claim released" is `bin/release-claim.js` (Settle step 2), run only in the claimed case; "`auto:merge` still present" holds because step 3 (the only revoking site in Settle, besides step 6's ceiling removal) is skipped; "closes the draft PR with its resume command" is step 5's tombstone (`gh pr close`, after the `failure`-kind pointer per `_shared/pr-run-comments.md`), where the resume command is the PR body's `### Resume` section (`_shared/pr-early-run-lifecycle.md`); "no retry counted" holds because `countFailedAttempts` (`bin/lib/issues/retry.js`) counts only bodies matching `/^Attempt (\d+) failed: /`, and the pointer opens with `<!-- run-comment: failure -->`.

- [ ] **Step 1: Write the failing test** — create `tests/settle-blocker-landing-stop-conformance.test.js`, header comment naming #4792 and what it pins. Import `missingFactsOf`, `assertEachPatternGoesRed`, `lineStartingWith` from `./helpers/conformance-asserts`, `readText` from `./helpers/read-skill`, and `countFailedAttempts` from `../plugin/bin/lib/issues/retry`. Constants: `SETTLE = plugin/skills/dispatch/settle-and-merge.md`, `FAILURE_CARDS = plugin/skills/flow/failure-cards.md`, `SKILL_GRAPH = docs/skill-graph.md`, `SETTLE_PREFIX = '**Blocker-landing special case (#4792).**'`, `SETTLE_STEP1 = '1. The CLI in step 2 performs the ownership read itself'`. `requireLine(text, prefix, name)` = `lineStartingWith` plus `assert.ok(line, \`${name} has no line starting "${prefix}"\`)`.

  `SETTLE_FACTS` (non-global, each matching exactly once in the paragraph):
  - `/`ISSUE #\{n\}: failed:blocker-landing`/` — 'AC1.1: Settle recognizes the stop by its gate line'
  - `/on an `open` or `unlanded` out-of-run blocker/` — 'AC1.1: names both stopping verdicts'
  - `/treat it as a non-failing stop: the blocker, not the record, is at fault/` — 'AC1.1: non-failing stop'
  - `/The claimed case is when this run's `decisions\.md` already carries a `Step 2\.8: claimed #\{n\}` line/` — 'AC4.1: the claimed case keys on the Step 2.8 claim line'
  - `/In the claimed case, run steps 1-2 with `--reason "failed: blocker-landing"`/` — 'AC2.1: the claimed case releases the claim'
  - `/then step 5's PR tombstone and nothing else of step 5/` — 'AC4.1: the claimed case runs only step 5\'s tombstone'
  - `/post the `failure`-kind pointer with the sentence `Stopped before build: an out-of-run blocker has not landed\. Resume with the ### Resume command in this PR body once it lands\.`/` — 'AC4.1: the pointer carries the resume command'
  - `/then `gh pr close` the PR, so the record is not stranded behind the `open-pr` exclusion/` — 'AC4.1: the claimed case closes the draft PR'
  - `/Otherwise the stop came before any claim of this run's, so skip steps 1-2 and the tombstone/` — 'AC2.1: no release or tombstone without a claim of this run\'s'
  - `/no `failure-check` classification/` — 'AC2.1: no failure-check'
  - `/no `auto:merge`\/`auto:merge-pending` revocation/` — 'AC2.1: auto:merge stays'
  - `/no attempt counted against `dispatch-retry-ceiling`/` — 'AC1.1: does not count toward the retry ceiling'
  - `/no failure comment on the issue/` — 'AC1.1: no failure comment'
  - `/never reaches `bot:blocked` on this stop/` — 'AC1.1: never bot:blocked'
  - `/When `DISPATCH_HEADLESS=1` was set, read `_shared\/headless-self-report\.md`/` — 'self-report gated on DISPATCH_HEADLESS=1'
  - `/failing-check-name `flow-step-2\.7b-blocker-landing`/` — 'self-report name'

  Factor `assertSettle(text)` = `assert.deepEqual(missingFactsOf(SETTLE_FACTS)(requireLine(text, SETTLE_PREFIX, 'settle-and-merge.md')), [], 'the Settle special case must state every fact (#4792)')`.

  Tests:
  - `test('AC1.1 AC2.1 AC4.1: Settle settles a blocker-landing stop as a non-failing stop (#4792)')` — `assertSettle(readText(SETTLE))`.
  - `test('AC1.2: each Settle blocker-landing fact can go red')` — `assertEachPatternGoesRed(paragraph, SETTLE_FACTS, missingFactsOf(SETTLE_FACTS))`.
  - `test('AC1.2: reverting the Settle paragraph turns the suite red')` — split the live text on `'\n\n'`, filter out the chunk starting with `SETTLE_PREFIX`, and assert exactly one chunk was removed. Rejoin it, `assert.notEqual(reverted, text)`, then `assert.throws(() => assertSettle(reverted), /settle-and-merge\.md has no line starting/)`.
  - `test('AC1.1: the special case sits before Settle step 1')` — copy the placement test and its move-after-step-1 control from `tests/no-dispatch-host-preflight-conformance.test.js` (`AC12.1: the special case sits before Settle step 1`), using this file's prefix.
  - `test('AC1.1: Settle and failure-cards name the same gate')` — the token `failed:blocker-landing` is in both the Settle paragraph and the failure-cards line starting `| Step 2.7b blocker landing`. Control: the Settle paragraph with `replaceAll('blocker-landing', 'blocker-landed')` (`assert.notEqual` first) fails the same `includes` check.
  - `test('AC4.2: step 5 still carries the tombstone the claimed case runs')` — factor `assertTombstone(text)`. It slices from the line starting `5. Compose the failure comment` to the line starting `6. **If \`ceilingHit\`` (assert both indexes are not -1 before slicing). The slice must include `` **`run-state.json` carries a `pr` object — this is the failure tombstone** ``, `Attempt failed — see the full comment on #%s.` and `gh pr close {pr-number} --repo {owner}/{repo}`. Each check gets its own message. Control: a copy with the `gh pr close {pr-number}` line removed (`assert.notEqual` first) throws that check's message.
  - `test('AC4.1: the claimed-case pointer never counts as a failed attempt')` — capture the sentence from the paragraph with `/pointer with the sentence `([^`]+)`/` (assert a match), build `body = '<!-- run-comment: failure -->\n\n' + sentence`, and assert `countFailedAttempts([{ body }]) === 0`. Counter control: `countFailedAttempts([{ body: 'Attempt 1 failed: x' }]) === 1`.
  - `test('skill-graph names the blocker-landing Settle edge (#4792)')` — the `docs/skill-graph.md` line starting `| \`flow/failure-cards.md\` |` exists and contains `failed:blocker-landing`, `flow-step-2.7b-blocker-landing` and `PR tombstone`. Control: a copy with that line removed (`assert.notEqual` first) fails the existence check.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js`
Expected: FAIL — `settle-and-merge.md has no line starting "**Blocker-landing special case (#4792).**"` (and the skill-graph test); the AC4.2 step-5 test and the counter control already pass.

- [ ] **Step 3: Edit the prose** — insert after the No-dispatch-host paragraph, separated by blank lines, this exact paragraph:

  ```
  **Blocker-landing special case (#4792).** When the failure this call is settling is `/flow`'s pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing` — Step 2.7b, or multi-spec Validation step 3, on an `open` or `unlanded` out-of-run blocker; `flow/failure-cards.md`'s blocker-landing row), treat it as a non-failing stop: the blocker, not the record, is at fault, and no retry changes the outcome until the blocker lands. The claimed case is when this run's `decisions.md` already carries a `Step 2.8: claimed #{n}` line — an earlier call of this run claimed the record and opened its draft PR, and a handoff continuation re-ran the pre-claim checks. In the claimed case, run steps 1-2 with `--reason "failed: blocker-landing"`, then step 5's PR tombstone and nothing else of step 5: when `run-state.json` carries a `pr` object, post the `failure`-kind pointer with the sentence `Stopped before build: an out-of-run blocker has not landed. Resume with the ### Resume command in this PR body once it lands.` in place of `Attempt failed — see the full comment on #%s.`, then `gh pr close` the PR, so the record is not stranded behind the `open-pr` exclusion. Otherwise the stop came before any claim of this run's, so skip steps 1-2 and the tombstone. Either way, skip the rest of steps 3-7: no `failure-check` classification, no `auto:merge`/`auto:merge-pending` revocation, no attempt counted against `dispatch-retry-ceiling`, and no failure comment on the issue — the record keeps every grant and never reaches `bot:blocked` on this stop. When `DISPATCH_HEADLESS=1` was set, read `_shared/headless-self-report.md` and follow its dedup-and-file procedure (caller = `dispatch`), failing-check-name `flow-step-2.7b-blocker-landing`, with the stop card as the diagnostic body.
  ```

  In `docs/skill-graph.md`'s `## dispatch` table, insert after the `build/execution-mode-policy.md` row:

  ```
  | `flow/failure-cards.md` | Since #4792, `settle-and-merge.md`'s Blocker-landing special case recognizes the `blocker-landing` gate that file's routing table names for `/flow`'s pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing`) and settles it as a non-failing stop — no `failure-check`, no `auto:merge` revocation, no retry count, no failure comment on the issue. Only when an earlier call of the run claimed the record does it release that claim and run step 5's PR tombstone, closing the draft PR with its resume command; headless, it files through `_shared/headless-self-report.md` as `flow-step-2.7b-blocker-landing`. |
  ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js tests/no-dispatch-host-preflight-conformance.test.js tests/flow-claim-preflight.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/claim-mcp-projection-conformance.test.js tests/pr-run-comments.test.js tests/dispatch-retry-prior-attempt-conformance.test.js tests/dispatch-settle-and-merge-lazy-read.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS. The new paragraph lands inside `tests/flow-claim-preflight.test.js`'s Claim-contest slice (to `\n1. The CLI in step 2`); it carries none of that slice's needles (`Claim in-flight`, `flow-step-2.8-claim-*`), so those pins keep their meaning. `wc -c plugin/skills/dispatch/settle-and-merge.md` prints under 52,500 (planned ~50,700).

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/dispatch/settle-and-merge.md docs/skill-graph.md tests/settle-blocker-landing-stop-conformance.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Settle a blocker-landing stop as a non-failing stop in dispatch — no retry count, auto:merge kept, claimed-case PR tombstone, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN"
  ```

### Task 3: Teach failure-check the blocker-landing stop

**Role:** transcription

**Files:**
- Modify: `plugin/skills/assess-agent-autonomy/failure-check.md` (Step 2: Judge — new bullet after the `- **Ambiguous**:` bullet, which spans three wrapped lines, and before the line starting `- **\`NOTIFY_NOW\`**:`)
- Test: `tests/settle-blocker-landing-stop-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 2's paragraph name "Blocker-landing special case".

- [ ] **Step 1: Write the failing test** — append. `FAILURE_CHECK = plugin/skills/assess-agent-autonomy/failure-check.md`. The bullet is hard-wrapped to match the file, so `bulletOf(text)` takes the lines from the one starting `- **Blocker-landing stop**:` up to, but not including, the next line starting `- **` or `## `, joins them, and collapses whitespace (`.replace(/\s+/g, ' ')`). It asserts the start line exists with the message `failure-check.md has no line starting "- **Blocker-landing stop**:"`. Facts:
  - `/`ISSUE #\{n\}: failed:blocker-landing`/` — 'failure-check keys on the gate line'
  - `/Settle skips this mode for it \(`dispatch\/settle-and-merge\.md`'s Blocker-landing special case\)/` — 'failure-check cites the Settle special case'
  - `/classify it `transient`/` — 'AC2.1: a stray stop classifies transient, so auto:merge is preserved'
  - `/no build or test ran, so no diff is at fault/` — 'failure-check states why'

  Tests: `test('AC2.1: failure-check.md classifies the blocker-landing stop (#4792)')` (`missingFactsOf` → `[]`), and `test('each failure-check blocker-landing fact can go red')` (`assertEachPatternGoesRed` over `bulletOf(text)`). Placement: `test('the bullet sits inside Step 2: Judge')` — the bullet's start index is after `## Step 2: Judge` and before `## Step 3: Render`. Control: a copy with the bullet's lines moved to just after the `## Step 3: Render` line (`assert.notEqual` first) fails the same factored check.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js`
Expected: FAIL — `failure-check.md has no line starting "- **Blocker-landing stop**:"`; Task 2's tests still pass.

- [ ] **Step 3: Edit the prose** — insert the bullet, wrapped like its neighbours:

  ```
  - **Blocker-landing stop**: `/flow`'s pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing`)
    is not a failure this mode judges — Settle skips this mode for it (`dispatch/settle-and-merge.md`'s
    Blocker-landing special case). If one reaches this mode anyway, classify it `transient`: no build
    or test ran, so no diff is at fault, and the stop clears once the blocker lands.
  ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js tests/assess-agent-autonomy-transport-pin.test.js tests/github-rate-limit-conformance.test.js tests/component-return-to-caller-conformance.test.js tests/bin-lib/skill-audit/anti-patterns.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/assess-agent-autonomy/failure-check.md tests/settle-blocker-landing-stop-conformance.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Teach failure-check the blocker-landing stop — transient, never judged by Settle, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN"
  ```

### Task 4: Let preflight-records.js take already-fetched records over gh (`--prefetched-json`)

**Role:** integration

**Files:**
- Modify: `plugin/bin/preflight-records.js` (`parseArgs`, `USAGE`, header comment, `loadFromGh`, `realDeps`)
- Modify: `plugin/bin/lib/preflight-records/preflight-records.js` (`issuesFromRecordsJson` gains a trailing `flag = '--records-json'` parameter used in every error message)
- Modify: `docs/plugin-structure.md` (line starting `node plugin/bin/preflight-records.js <n>`)
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js` (append)

**Interfaces:**
- Produces: `node bin/preflight-records.js <n> [<n> ...] … --prefetched-json <path|-> …`. The file, or stdin when the value is `-` (read through a new `deps.readStdin()`; `realDeps.readStdin = () => fs.readFileSync(0, 'utf8')`), holds the requested records as the caller already fetched them over `gh`, in the `--records-json` shape (`{number, title, body, labels}`, validated by `issuesFromRecordsJson(raw, numbers, '--prefetched-json')`). Repo resolution, the origin-host gate, `work-links: native`'s dependency GraphQL call, and `--blocker-landing`'s query all run exactly as on the plain `gh` path. Only `fetchIssues` is skipped. Exit codes: every `--prefetched-json` input problem (unreadable, not JSON, wrong shape, a requested number missing, duplicated or extra) is exit 2, the same as `--records-json`'s. `--prefetched-json` together with `--records-json` is exit 2 (mutually exclusive). `--blocker-states-json` still requires `--records-json`. Task 5 consumes this.
- Implementation shape: extract `loadFromRecordsJson`'s read-parse-validate lines into one helper, `readRecordsInput(value, flag, numbers, deps)` → `{ ok: Map }` | `{ code: 2 }`, which reads `deps.readStdin()` for `-` and `deps.readFile(value)` otherwise. Call it from both paths, so the two flags cannot drift.
- Return-shape widening check: none (`issuesFromRecordsJson`'s return is unchanged; the new parameter defaults to today's literal, so every existing message test still passes). Its only caller is `plugin/bin/preflight-records.js:237` (`git grep -n issuesFromRecordsJson -- plugin tests`: lib definition, lib export, that call).

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/preflight-records/preflight-records.test.js`, reusing its `cliDeps`, `landingFixture`, `closedBlocker`, `isIssueView`, `isGraphQL`, `isCompare`, `issue`, `specBody`, `noGh`. Give `cliDeps` an optional `stdin` that it serves through `readStdin`.
  - `test('AC3.1: --prefetched-json - reads the records from stdin and makes no gh issue view call; the envelope equals the gh-fetched one')` — run `['10', '11']` through the plain gh path (landingFixture runner) and `['10', '11', '--prefetched-json', '-']` with `stdin` = the same two issues as JSON. The second makes zero `isIssueView` calls, and both print byte-identical stdout.
  - `test('AC3.1: --prefetched-json with --blocker-landing still judges landing over gh')` — `['10', '11', '--prefetched-json', '-', '--blocker-landing', '--integration-branch', 'dev']`, repository `{ b5: closedBlocker('eee555') }`, statuses `{ eee555: 'diverged\n' }`. `records['11'].blockerLanding` deep-equals `[{ blocker: 5, verdict: 'unlanded', commit: 'eee555', via: 'closer-pr' }]`, with exactly one GraphQL and one compare call (`compare/dev...eee555`), and zero issue views.
  - `test('--prefetched-json <path> reads the named file')` — `files: { '/p.json': … }`, the same envelope as the stdin case.
  - `test('--prefetched-json under work-links: native still makes the native dependency call')` — `workLinks: 'native'`, `--repo acme/w`; one native GraphQL call is recorded (the `isGraphQL` shape whose query is not `CLOSED_EVENT`), no issue view, and `envelope.workLinks === 'native'` with no `nativeLinksUnchecked` key.
  - `test('--prefetched-json input problems are exit 2, naming the flag')` — a table over: unreadable path; not JSON; not an array; a requested number missing; an extra number. Each exits 2, prints no stdout, and its stderr matches `/--prefetched-json/` with no `--records-json` in the line.
  - `test('--prefetched-json and --records-json together are a malformed invocation')` — exit 2, stderr names both flags, and the runner is never called.
  - `test('--prefetched-json with no value is a malformed invocation')` — `['10', '--prefetched-json']` and `['10', '--prefetched-json', '--waves']` exit 2.
  - `test('--help usage names --prefetched-json')` — usage matches `/\[--records-json <path>\] \[--prefetched-json <path>\]/`, while the existing `/\[--blocker-landing\] \[--blocker-states-json <path>\]/` pin still holds.
  - `test('issuesFromRecordsJson keeps its --records-json messages by default and names the given flag')` — `issuesFromRecordsJson({}, [1]).error === '--records-json must be a JSON array'` and `issuesFromRecordsJson({}, [1], '--prefetched-json').error === '--prefetched-json must be a JSON array'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: FAIL — the `--prefetched-json` CLI tests exit 2 with `unknown argument: --prefetched-json`, the usage test fails, and the `issuesFromRecordsJson` flag test fails on the second assertion; every pre-existing test still passes.

- [ ] **Step 3: Implement** — per the Interfaces block. Header comment: add a paragraph after the `--records-json` one, stating the flag, the stdin form, that only `fetchIssues` is skipped, the exit-2 input rule, and mutual exclusion. `USAGE` (and the header's usage line): insert ` [--prefetched-json <path>]` directly after `[--records-json <path>]`. In `docs/plugin-structure.md`'s `node plugin/bin/preflight-records.js` line, insert the same token after `[--records-json <path>]` in the synopsis, and append before the final clause: `; --prefetched-json <path|-> (#4792) reads records the caller already fetched over gh (\`-\` = stdin) and skips only the per-record fetch — native dependencies and blocker landing still query gh; its input problems are exit 2, and it is mutually exclusive with --records-json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js tests/bin-lib/preflight-records/blocker-landing.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js tests/multispec-preflight-failure-conformance.test.js tests/flow-blocker-landing-conformance.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/bin/preflight-records.js plugin/bin/lib/preflight-records/preflight-records.js docs/plugin-structure.md tests/bin-lib/preflight-records/preflight-records.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Add --prefetched-json to preflight-records — judge already-fetched records over gh without a per-record fetch, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN"
  ```

### Task 5: The unlanded-blocker exclusion CLI

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/dispatch/unlanded-blockers.js`
- Create: `plugin/bin/dispatch-unlanded-blockers.js`
- Create: `tests/bin-lib/dispatch/unlanded-blockers.test.js`
- Modify: `docs/plugin-structure.md` (new CLI line directly after the line starting `node plugin/bin/dispatch-resume.js`; append `unlanded-blockers.js` to the `plugin/bin/lib/dispatch/` entry, the line starting `plugin/bin/lib/dispatch/          →`)

**Interfaces:**
- `plugin/bin/lib/dispatch/unlanded-blockers.js` (pure, no I/O) exports:
  - `REASON = 'unlanded-blocker'`.
  - `poolRecords(groups)` — `groups.flat()` projected to `{number, title, body, labels}`, deduped by number, ascending. This is the `--prefetched-json` shape.
  - `landingExclusions(envelope, numbers)` — `{ exclusions, undetermined }`. There is one `{ reason: REASON, records: [n], detail: { blockers: [{ blocker, commit }] } }` per requested record with at least one `unlanded` verdict, its blockers in `blockerLanding` order. `undetermined` is `[{ record, blocker, via }]` for every `undetermined` verdict. `open`, `landed` and `not-applicable` contribute nothing. It throws a `TypeError` naming the record when `envelope.records[String(n)].blockerLanding` is not an array.
  - `withoutExcluded(groups, numbers)` — `groups` with every member whose number is in the `Set` removed, and empty groups dropped (a fast-lane bundle keeps its other members, as the other removing passes do).
- `plugin/bin/dispatch-unlanded-blockers.js`: `usage: dispatch-unlanded-blockers.js --groups <path> --exclusions <path> --integration-branch <name>`. It exports `run(argv, deps)`, `parseArgs` and `realDeps`, and its guard is `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. `deps`: `readFile(path)`, `preflight(args, input) → { status, stdout, stderr, error }`, `stdout(s)`, `stderr(s)`. `realDeps.preflight` is `spawnSync(process.execPath, [PREFLIGHT_JS, ...args], { input, encoding: 'utf8', timeout: PREFLIGHT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true })`, with `PREFLIGHT_JS = path.join(__dirname, 'preflight-records.js')`, `PREFLIGHT_TIMEOUT_MS = 300000` (a stated bound; each `gh` call inside is already bounded at 30 s by `GH_CALL_TIMEOUT_MS`) and `LARGE_MAX_BUFFER_BYTES` from `lib/shared-primitives.js`. Exclusions are written through `bin/lib/dispatch/exclusions.js`'s `appendExclusion` (the one sanctioned writer of `dispatch-exclusions.json`).
- `run` order and exit codes (documented in the header and `USAGE`):
  1. Malformed invocation (a missing flag, a flag with no value, an unknown argument) → usage on stderr, **exit 2**.
  2. `--groups` unreadable, not JSON, or not an array of arrays → `dispatch-unlanded-blockers.js: cannot read --groups {path}: {reason}`, **exit 1**.
  3. Empty pool → print the groups unchanged, exit 0, no `preflight` call.
  4. `--integration-branch` value empty or whitespace (the queue pull's `$INTEGRATION_BRANCH` failed to resolve) → `Warning: unlanded-blocker pass skipped — no integration branch resolved; no unlanded-blocker exclusions this pull`, print groups unchanged, exit 0, no `preflight` call.
  5. Call `deps.preflight([...numbers, '--prefetched-json', '-', '--blocker-landing', '--integration-branch', branch], JSON.stringify(pool))`, with no `--work-links` (preflight resolves the policy itself). Forward the child's stderr to ours unchanged, so its compare-failure causes are never lost.
  6. A non-zero or null `status`, or a thrown `preflight` dep → `Warning: unlanded-blocker pass skipped — preflight-records.js exited {status|signal|error}; no unlanded-blocker exclusions this pull`, groups unchanged, exit 0.
  7. Stdout that is not JSON, or `landingExclusions` throwing → `Warning: unlanded-blocker pass skipped — preflight-records.js printed no usable envelope ({reason}); no unlanded-blocker exclusions this pull`, groups unchanged, exit 0.
  8. `appendExclusion(exclusionsPath, e)` per exclusion. A throw (`appendExclusion: … unreadable`) → `dispatch-unlanded-blockers.js: {message}` and **exit 1**, with nothing printed on stdout. Per exclusion, also print `AUTO — dispatch: #{n} excluded, blocker #{b} closed but its closing commit {commit} is not on origin/{branch}` on stderr.
  9. Per undetermined verdict: `AUTO — dispatch: #{n} kept — blocker #{b} landing undetermined (via {via})` on stderr.
  10. Print `JSON.stringify(withoutExcluded(groups, excluded))` on stdout as one write, exit 0.
- Consumer classification (Consumer-enumeration check) of the new `reason: 'unlanded-blocker'` entries: the `#N`/`#N,#M` bullets and `exclusions-unreadable-report.md` are list-all readers by reason name (Task 6 names the reason). `blocked-exclusion-report.md` is a list-all renderer (Task 7 adds its line). `next-ranking.md` and `firing-exclusion.md` filter by their own reason lists (`oversized`, `neighbour-in-flight`, `firing`), so they never see this reason, and since excluded records are already out of `dispatch-groups.json` they need no change. `queue-pull-script.md`'s queue-order write-back (`reason === 'blocked'` only) and its truncate step (keeps `firing` only) run before this pass or ignore it, so they need no change.

- [ ] **Step 1: Write the failing tests** — create `tests/bin-lib/dispatch/unlanded-blockers.test.js`. Its fixture world copies `preflight-records.test.js`'s `landingFixture` shape locally (never import from another test file): records `10` (no edges) and `11` (body `Blocked by #5`), a GraphQL repository `{ b5: closedBlocker(sha) }`, a compare map, and a runner that throws `'unexpected ' + args.join(' ')` on anything else, including any `issue view`. **Real writer:** `realPreflight(world)` returns a `deps.preflight` that calls `require('../../../plugin/bin/preflight-records').run(args, { runner: world.runner, resolveWorkLinks: () => 'body-text', remoteUrl: () => 'https://github.com/acme/w.git', readFile: () => { throw new Error('no file reads'); }, readStdin: () => input, stdout, stderr })` and returns `{ status, stdout, stderr }`, so every envelope the CLI reads comes from the real `preflight-records.js` code. Files (groups, exclusions) live in a `fs.mkdtempSync` scratch dir removed in `t.after`.
  - `test('AC3.1: a pool with an unlanded out-of-run blocker excludes that record as unlanded-blocker, and includes it once the blocker lands (#4792)')` — groups `[[#10], [#11]]`, `--integration-branch dev`. Run 1: compare `{ sha1: 'diverged\n' }` → exit 0, stdout groups `[[#10]]`, and the exclusions file deep-equals `[{ reason: 'unlanded-blocker', records: [11], detail: { blockers: [{ blocker: 5, commit: 'sha1' }] } }]`. The recorded argv contains `'--prefetched-json', '-'`, `'--blocker-landing'` and `'--integration-branch', 'dev'`, and the world records zero `issue view` calls. Run 2 (fresh exclusions file, same pool, compare `{ sha1: 'behind\n' }`) → stdout groups contain `#11`, and the exclusions file is absent or holds no `unlanded-blocker` entry.
  - `test('AC3.1: an undetermined verdict keeps the candidate and logs one AUTO line')` — the compare throws (preflight: `undetermined`/`probe-failed`) → `#11` kept, no entry, stderr matches `/AUTO — dispatch: #11 kept — blocker #5 landing undetermined \(via probe-failed\)/`.
  - `test('an open blocker is left to the blocked pass')` — `b5` `state: 'OPEN'` → `#11` kept, no `unlanded-blocker` entry.
  - `test('a bundle keeps its other members; an all-excluded group disappears')` — groups `[[#10, #11], [#12]]`, where `#12` is also blocked by `#5` (unlanded) → stdout `[[#10]]`, with two entries in pool order.
  - `test('fail open: a non-zero preflight exit excludes nothing')` — the stub `preflight` returns `{ status: 1, stdout: '', stderr: 'preflight-records.js: blocker landing query failed: x\n' }` → exit 0, stdout byte-equal to the input groups' `JSON.stringify`, stderr carries both the forwarded line and `Warning: unlanded-blocker pass skipped — preflight-records.js exited 1`, and no exclusions file is created.
  - `test('fail open: unparseable or envelope-less output excludes nothing')` — stdout `'not json'`, then `'{"records":{}}'` → exit 0, groups unchanged, `printed no usable envelope`.
  - `test('fail open: an empty integration branch skips the pass without calling preflight-records')` — `--integration-branch ''` → exit 0, unchanged, the `no integration branch resolved` warning, and the `preflight` dep never called. This is the Empty-value probe: the queue pull passes `"$INTEGRATION_BRANCH"`, which is `''` when both resolution rungs fail.
  - `test('an empty pool makes no preflight call')` — groups `[]` → stdout `[]`, exit 0.
  - `test('a corrupt exclusions file stops the pass (exit 1)')` — exclusions file containing `{ not json`, an unlanded world → exit 1, stderr matches `/appendExclusion:/`, stdout empty.
  - `test('an unreadable --groups is exit 1; a malformed invocation is exit 2')` — a missing groups path → 1; `[]` argv, `--groups` with no value, `--bogus` → 2 with usage.
  - Guard-branch discrimination: each fail-open test above uses an input that only its own branch decides. The plan states that deleting branch 4, 6 or 7 turns its test red (branch 4: the `preflight` dep throws `'must not be called'`; branch 6: no exclusions file and unchanged stdout, which an unguarded parse of `''` would turn into a crash; branch 7: a missing `blockerLanding` would throw out of `run`).
  - `test('realDeps.preflight returns the real child failure shape')` — `realDeps.preflight(['--bogus'], '')` spawns the real `preflight-records.js` (no `gh` reached: `parseArgs` rejects first) and returns `status === 2` with stderr matching `/unknown argument: --bogus/` (cli-wrapper-contract: one test of the real dependency's failure shape).
  - Pure-function tests: `poolRecords` dedupes and sorts across groups and projects exactly the four keys; `landingExclusions` throws a `TypeError` naming `#11` when its `blockerLanding` is missing; `withoutExcluded` leaves the input arrays unmutated.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/unlanded-blockers.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/dispatch-unlanded-blockers'` (and `…/lib/dispatch/unlanded-blockers`).

- [ ] **Step 3: Implement** — the two modules per the Interfaces block. Header comment of the CLI: purpose (#4792), the `run` order above, the exit-code vocabulary (0 = pool on stdout, filtered or unchanged on a fail-open skip; 1 = the pass could not complete; 2 = malformed invocation), and why it fails open (Step 2.7b re-checks before any claim). No `fs.existsSync`/`fs.realpathSync` (path-guard scan); read files inside `try`. In `docs/plugin-structure.md`, insert after the `node plugin/bin/dispatch-resume.js` line:

  ```
  node plugin/bin/dispatch-unlanded-blockers.js --groups <path> --exclusions <path> --integration-branch <name>   # Unlanded-blocker exclusion CLI (#4792) — `queue-pull-script.md`'s selection-time pass: hands every remaining candidate (already fetched) to one `preflight-records.js --prefetched-json - --blocker-landing` call, appends one `reason: 'unlanded-blocker'` entry (`detail: {blockers: [{blocker, commit}]}`) per candidate with an `unlanded` out-of-run blocker through `exclusions.js`'s `appendExclusion`, and prints the pool without them; fails open (an `undetermined` verdict keeps the candidate, and a non-zero `preflight-records.js` exit, an unusable envelope, or an empty integration branch excludes nothing, with one `Warning:` line); exit 0 pool printed, 1 unreadable `--groups` or a refused exclusions write, 2 malformed invocation (tests in `tests/bin-lib/dispatch/unlanded-blockers.test.js`)
  ```

  Append to the `plugin/bin/lib/dispatch/` entry, before its closing `)`: `; unlanded-blockers.js (#4792 — the pure half of plugin/bin/dispatch-unlanded-blockers.js: poolRecords projects the candidate pool to preflight-records.js's --prefetched-json shape, landingExclusions turns its --blocker-landing envelope into unlanded-blocker entries plus the undetermined verdicts it keeps, withoutExcluded drops excluded members and empty groups)`.

- [ ] **Step 4: Run tests to verify they pass, then probe real input**

Run: `node --test tests/bin-lib/dispatch/unlanded-blockers.test.js tests/bin-lib/dispatch/exclusions.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/gh-host-seam-conformance.test.js tests/path-containment-conformance.test.js tests/package-json-test-script.test.js`
Expected: PASS.

  **Real-input probe** (read-only `gh`; writes only scratch files). Fetch real records whose bodies carry `Blocked by` lines, with `gh issue list --state open --search "\"Blocked by #\" in:body" --json number,title,body,labels --limit 15`, into a scratch file. Wrap them as per-record groups (`[[r1],[r2],…]`) with a scratchpad node script. Then run `node plugin/bin/dispatch-unlanded-blockers.js --groups {scratch-groups} --exclusions {scratch-exclusions} --integration-branch main`. `main` is the derived value: `resolve-policy.js --values integration-branch` printed `''` here, and `git remote show origin` reports `HEAD branch: main`. **Independent count:** run plain `node plugin/bin/preflight-records.js {same numbers} --blocker-landing --integration-branch main` (the `gh issue view` path, not `--prefetched-json`), and count `verdict === 'unlanded'` records with a `node -e` over its envelope. The count must equal the CLI's exclusion-entry count, and the CLI's kept set must equal the input set minus those records. At authoring (2026-11-03), the plain call over `4127 4499 4591 4624 4703 4929` printed `landed` for #4127's #4024, `open` for the rest's blockers, and `[]` for #4703/#4929: zero `unlanded`, so expect 0 = 0 unless the live state moved. Record both counts and the command in `decisions.md` per the AC-evidence persistence check: `log-decision.js --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`, with the full output at `$PIPELINE_RUN_DIR/evidence/unlanded-blockers-real-input.txt` (`mkdir -p "$PIPELINE_RUN_DIR/evidence"` first, plain Bash redirect).

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/bin/lib/dispatch/unlanded-blockers.js plugin/bin/dispatch-unlanded-blockers.js tests/bin-lib/dispatch/unlanded-blockers.test.js docs/plugin-structure.md
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Add the unlanded-blocker exclusion CLI — drop candidates whose out-of-run blocker never landed, fail open, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN"
  ```

### Task 6: Run the unlanded-blocker pass in dispatch's queue pull

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (new reason bullet after the line starting ``- `reason: 'shipped'` ``; three comment blocks cut to one line each; new pass block before the line `# #3278: neighbour-in-flight pass. Neighbour: a linking Key File or a strong`)
- Modify: `plugin/skills/dispatch/queue-pull-notes.md` (append one section at end of file)
- Modify: `plugin/skills/dispatch/SKILL.md` (Step 2's queue-definition line starting `The queue: **open + `; the `#N` bullet; the `#N[,#M,#O...]` bullet)
- Modify: `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md` (Success state; Step 1's Should understand; `files:`; Origin)
- Create: `tests/dispatch-unlanded-blocker-exclusion-fixture.test.js`

**Interfaces:**
- Consumes: Task 5's CLI (`dispatch-unlanded-blockers.js`, its `parseArgs`).
- Moved-prose pin check (comment blocks moved to `queue-pull-notes.md`). The distinctive phrases of each moved block were grepped across `tests plugin .claude/skills docs`: `#2786's evidence`, `No gh/network call`, `bypass -- the exclusion is computed once`, `independent of $WORK_LINKS`, `transient state the freshness signal`, `One batched aliased GraphQL call`, `unsatisfiable by construction`, `a dirty tree must not hide`. There were no hits outside `queue-pull-script.md`. The `Materialization hard gate`, `Named-location drift` and `fetchLinkedPRs)` hits are other files' own text, read by suites that never open `queue-pull-script.md`. The anchors suites use are kept byte-identical: `# #1224: open-linked-PR exclusion.` (`tests/dispatch-not-spec-shaped-exclusion-fixture.test.js` #3086, and `tests/dispatch-shipped-candidate-prose.test.js` uses `#1224: open-linked-PR exclusion`), the not-spec-shaped `START_ANCHOR` code line, and every `#1984` comment line (not moved: `tests/dispatch-shipped-candidate-prose.test.js` reads `#4314` and `opened before the record was created` from its first 2000 chars).
- Renumbering-completeness check (a sixth removing reason). Three greps, all run at authoring: (1) the reason list — ``git grep -n -F -e "`target-missing`, `shipped`" -e "`target-missing`/`shipped`" -- plugin docs README.md .claude/skills ':!docs/superpowers/plans'`` hits only the journey lines 21/29 and `SKILL.md` lines 192/194 (plus `queue-pull-script.md:8`'s `open-pr`/`target-missing`/`shipped` placement clause, which stays true); (2) the count word — `git grep -n -i -e "five reasons" -e "five removing" -e "fifth removing" -- plugin docs tests ':!docs/superpowers/plans'` hits only the journey (line 29 is changed; line 70 is history and stays); (3) the derived count — `tests/dispatch-named-form-exclusion-reasons.test.js` derives `REMOVING_REASONS` from the bullets and requires the journey's count word to equal its length (`six` after this task).

- [ ] **Step 1: Write the failing test** — create `tests/dispatch-unlanded-blocker-exclusion-fixture.test.js` (header: #4792, extract-and-run of the pass block plus the move pins). Use `readText` and `missingFactsOf`/`assertEachPatternGoesRed`/`lineStartingWith`/`sectionOf` from the shared helpers. `QUEUE_PULL` = `plugin/skills/dispatch/queue-pull-script.md`, `NOTES` = `plugin/skills/dispatch/queue-pull-notes.md`.
  - `extractPassBlock(text)` — from `# #4792: unlanded-blocker exclusion.` to the first `\nfi` after it (inclusive). Assert start and end, with the messages `extraction start anchor not found: # #4792: unlanded-blocker exclusion.` and `closing fi not found after the #4792 anchor`.
  - `runBlock(shell, { exit, out })` — scratch dir with `dispatch-groups.json` (`[[{"number":1}],[{"number":2}]]`), `dispatch-exclusions.json` (`[]`), and a stub plugin root holding `bin/dispatch-unlanded-blockers.js`. The stub writes `JSON.stringify(process.argv.slice(2))` to `process.env.STUB_ARGV`, writes `process.env.STUB_OUT` to stdout, and sets `process.exitCode = Number(process.env.STUB_EXIT)`. Spawn `[shell, [...flags, '-c', block]]` (`bash --noprofile --norc`, `zsh -f`) with env `CLAUDE_PLUGIN_ROOT` (the stub root, forward-slashed), `DISPATCH_GROUPS`, `DISPATCH_EXCLUSIONS`, `INTEGRATION_BRANCH=main`, `STUB_*`. Return `{ status, stderr, groups, tmpLeft }`, where `tmpLeft` is whether `dispatch-groups.json.tmp` still exists.
  - `test('AC3.1: the pass block replaces dispatch-groups.json with the CLI\'s pool on exit 0, under bash and zsh')` — `STUB_EXIT=0`, `STUB_OUT='[[{"number":1}]]'` → status 0, groups `[[{number:1}]]`, `tmpLeft === false`. The recorded argv equals `['--groups', G, '--exclusions', E, '--integration-branch', 'main']`, and `require('../plugin/bin/dispatch-unlanded-blockers').parseArgs(argv)` returns no `error`. Skip zsh with `t.skip('zsh not on PATH')` when `spawnSync('zsh', ['-f', '-c', 'true']).error`.
  - `test('the pass block stops the queue pull on a non-zero CLI exit and leaves dispatch-groups.json untouched')` — `STUB_EXIT=1` → status 1, stderr matches `/queue-pull stopped -- unlanded-blocker exclusion pass failed/`, groups byte-equal to the input, `tmpLeft === false`.
  - `test('the pass sits after the shipped Close-proposal staging and before the neighbour-in-flight pass')` — `requireOrder(text, [SHIPPED_STAGE, PASS_ANCHOR, NEIGHBOUR])`, with `SHIPPED_STAGE = '--id "shipped-close-$NUM"'`, `PASS_ANCHOR = '# #4792: unlanded-blocker exclusion.'` and `NEIGHBOUR = '# #3278: neighbour-in-flight pass.'`. The helper asserts each index is not -1 (`marker missing: …`) before asserting the order (`… must come after …`). Permutation control: splice the extracted block out and re-insert it just above the line containing `SHIPPED_STAGE`'s `for`-loop opener (`DISPATCH_FIRING_RUN_DIR=$(node`), with `assert.notEqual` first → throws `/must come after/`. Deletion control: remove the anchor line → throws `/marker missing/`.
  - `test('AC3.1: the unlanded-blocker reason bullet states its posture')` — the bullet is `lineStartingWith(text, "- \`reason: 'unlanded-blocker'\`")` (asserted present). Facts: `/`preflight-records\.js --blocker-landing` judges `unlanded`/` — 'judged by preflight-records'; `/This one DOES remove excluded candidates from `dispatch-groups\.json`, with no `#N`\/`#N,#M,\.\.\.` bypass/` — 'removing, no bypass'; `/eligible again on the first pull after its blocker lands/` — 'AC3.1: eligible again once landed'; `/an `undetermined` verdict keeps the candidate, and a failed `preflight-records\.js` call excludes nothing/` — 'fails open'. `missingFactsOf` → `[]`, plus `assertEachPatternGoesRed`. Also assert the bullet does not contain `stay IN \`dispatch-groups.json\``, so `tests/dispatch-named-form-exclusion-reasons.test.js` counts it as removing.
  - `test('three passes\' rationale moved to queue-pull-notes.md, one pointer line each')` — the lines starting `# #2829: not-spec-shaped exclusion.`, `# #1224: open-linked-PR exclusion.` and `# #1983: named-target existence exclusion.` each exist and end with `queue-pull-notes.md.`. `sectionOf(readText(NOTES), '## Where four exclusion passes sit, and why')` carries `**Not-spec-shaped pass (#2829).**`, `**Open-linked-PR pass (#1224).**`, `**Named-target existence pass (#1983).**` and `**Unlanded-blocker pass (#4792).**`. Absence (whitespace-collapsed haystack): `queue-pull-script.md` no longer contains `(#2786's evidence)`, `transient state the freshness signal` or `unsatisfiable by construction`. **Absence-grep control (run at authoring):** each of the three literals matches exactly once in the base file (`grep -c -F` printed `1`, `1`, `1`), so the absence check can fail. The test also proves this in memory: appending each literal to a copy makes that check report it.
  - `test('queue-pull-script.md fits the Read rail after the pass and the move')` — `Buffer.byteLength(readText(QUEUE_PULL)) <= RAIL_BYTES`, with `RAIL_BYTES` imported from `plugin/bin/lib/skill-audit/budgets.js` (never a byte literal).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/dispatch-unlanded-blocker-exclusion-fixture.test.js`
Expected: FAIL — `extraction start anchor not found: # #4792: unlanded-blocker exclusion.`, the bullet test, and the moved-rationale test; the rail test passes (52,091 B at base).

- [ ] **Step 3: Edit the prose**

  (a) In `queue-pull-script.md`, insert directly after the ``- `reason: 'shipped'` `` bullet line:

  ```
  - `reason: 'unlanded-blocker'` (`detail: {blockers: [{blocker, commit}]}`, #4792) — every remaining candidate with an out-of-run blocker that `preflight-records.js --blocker-landing` judges `unlanded` (closed, its closing commit not on `origin/{integration-branch}`), the verdict `/flow` Step 2.7b stops on before claiming. This one DOES remove excluded candidates from `dispatch-groups.json`, with no `#N`/`#N,#M,...` bypass, and the record is eligible again on the first pull after its blocker lands. `bin/dispatch-unlanded-blockers.js` runs the pass and fails open: an `undetermined` verdict keeps the candidate, and a failed `preflight-records.js` call excludes nothing.
  ```

  (b) Replace the 18-line comment from `# #2829: not-spec-shaped exclusion. Runs unconditionally, right after` through `# reads $DISPATCH_GROUPS.` (the line before `if node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_EXCLUSIONS" > "${DISPATCH_GROUPS}.tmp" 2>"$DISPATCH_SHAPE_GATE_ERR" <<NODE_EVAL_EOF`) with:

  ```
  # #2829: not-spec-shaped exclusion. Why here, and why no #N bypass: queue-pull-notes.md.
  ```

  (c) Replace the 14-line comment from `# #1224: open-linked-PR exclusion. Runs unconditionally (both the cache-hit` through `# fetchLinkedPRs).` (the line before `DISPATCH_GROUP_NUMS=$(node`) with:

  ```
  # #1224: open-linked-PR exclusion. Why it runs unconditionally: queue-pull-notes.md.
  ```

  (d) Replace the 9-line comment from `# #1983: named-target existence exclusion. Runs unconditionally, right after` through `# tree may lag, and a dirty tree must not hide a deletion.` with the line below. Keep the following `DISPATCH_STANDALONE_DIR=$(node` line and the `# {integration-branch} resolution follows …` comment unchanged.

  ```
  # #1983: named-target existence exclusion. Why at the integration tip: queue-pull-notes.md.
  ```

  (e) Insert directly before the line `# #3278: neighbour-in-flight pass. Neighbour: a linking Key File or a strong` (after the shipped Close-proposal staging block's closing `fi` and its blank line):

  ```
  # #4792: unlanded-blocker exclusion. Why here, and why it fails open: queue-pull-notes.md.
  if node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch-unlanded-blockers.js" --groups "$DISPATCH_GROUPS" --exclusions "$DISPATCH_EXCLUSIONS" --integration-branch "$INTEGRATION_BRANCH" > "${DISPATCH_GROUPS}.tmp"; then
    mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"
  else
    rm -f "${DISPATCH_GROUPS}.tmp"
    echo "dispatch: queue-pull stopped -- unlanded-blocker exclusion pass failed; see error above." >&2
    exit 1
  fi

  ```

  (f) Append to `queue-pull-notes.md` (a blank line, then):

  ```
  ## Where four exclusion passes sit, and why

  These paragraphs moved here from the comments heading each pass in `queue-pull-script.md` (#4792), which now keep one line apiece pointing at this section. Read them when changing a pass's position or posture; running the script needs none of them.

  **Not-spec-shaped pass (#2829).** It runs unconditionally, right after grouping and bundling complete (both the cache-hit and cache-miss branches leave `$DISPATCH_GROUPS` populated by then), and before every `gh`-backed probe: a candidate whose cached body fails `/flow`'s Materialization hard gate (`shapeGate`) would otherwise be claimed and handed to `/flow`, where it fails mid-build — the failure counts against `dispatch-retry-ceiling`, and a correctness-classified failure makes Settle revoke `auto:merge` (#2786's evidence). It makes no `gh` or network call: `shapeGate` is pure, run against the body already fetched into `$DISPATCH_GROUPS`. It sits ahead of the #1224 open-PR pass and the #1984 shipped-candidate classification so an excluded candidate costs neither pass's `gh` calls (the open-PR pass's batched GraphQL call, the shipped pass's up-to-5 live `gh pr view` calls) and never gets a staged Close proposal from the shipped pass. Like the open-pr, target-missing and shipped passes (and unlike oversized), it removes the excluded candidate from `$DISPATCH_GROUPS` unconditionally, with no `#N`/`#N,#M,...` bypass — the exclusion is computed once, before any selection form reads `$DISPATCH_GROUPS`.

  **Open-linked-PR pass (#1224).** It runs unconditionally (both cache branches leave `$DISPATCH_GROUPS` populated) and independent of `$WORK_LINKS`: unlike the native blocked-by check, PR linkage is not a dependency-tracking policy choice, and unlike the queue-order cache (#1571) a PR opening or closing after the cache was written is exactly the kind of transient state the freshness signal (built from `auto:build` issues' own `updatedAt`/`state`) never observes, so skipping it on a cache hit would silently reintroduce the bug #1224 fixed. It makes one batched aliased GraphQL call across every candidate still in `$DISPATCH_GROUPS` (after blocked-by, native, oversized and not-spec-shaped filtering — there is no point checking a candidate already excluded for another reason), via `bin/resolve-linked-prs.js` (`record.js`'s `buildLinkedPRQuery` + `bin/lib/issues/linked-prs.js`'s `fetchLinkedPRs`).

  **Named-target existence pass (#1983).** It runs unconditionally, right after the open-linked-PR exclusion and before the read-only cross-PR overlap report: a record whose named target no longer exists at the integration tip is not merely unlikely to build, its Acceptance Criteria is unsatisfiable by construction (the observed shape: a `by:docs-health` ledger correction whose flagged doc a since-merged tidy sweep already deleted). It checks the integration tip, not the working tree (`flow/materialize.md`'s Named-location drift note): a worktree session's tree may lag, and a dirty tree must not hide a deletion.

  **Unlanded-blocker pass (#4792).** It runs unconditionally, after the shipped-candidate classification and its Close-proposal staging and before the neighbour-in-flight pass, so a candidate an earlier pass removed adds nothing to its query and a removed candidate is never checked for in-flight neighbours. Landing state is transient — a blocker's closing commit can reach `origin/{integration-branch}` at any moment — so, like the open-linked-PR pass, it runs on a cache hit too. `bin/dispatch-unlanded-blockers.js` hands every remaining candidate, already fetched, to one `preflight-records.js --prefetched-json --blocker-landing` call (no per-record `gh issue view`), so the verdicts are exactly the ones `/flow` Step 2.7b computes before claiming. All candidates are that call's positional numbers, so a blocker that is itself a candidate is in-run and not judged; such a blocker is open, and the `blocked` pass already removed its dependents. It fails open, because Step 2.7b re-checks before any claim: an `undetermined` verdict keeps the candidate (2.7b proceeds on it too) with one `AUTO` line, and a non-zero `preflight-records.js` exit, unparseable output, or an empty `$INTEGRATION_BRANCH` prints one `Warning:` line and excludes nothing. Only a refused exclusions write (`appendExclusion` on a corrupt file) or an unreadable `$DISPATCH_GROUPS` stops the pull (#3110). An `open` verdict is not this pass's to exclude: the `blocked` pass owns open blockers.
  ```

  (g) In `SKILL.md`: in the queue-definition line, replace `+ not already shipped by a \`strong\`-tier merged-PR mention (#1984) + unclaimed**` with `+ not already shipped by a \`strong\`-tier merged-PR mention (#1984) + no \`unlanded\` out-of-run blocker (#4792) + unclaimed**`. In the `#N` bullet, replace ``` `blocked`/`open-pr`/`target-missing`/`shipped` as their Step 3 report lines ``` with ``` `blocked`/`open-pr`/`target-missing`/`shipped`/`unlanded-blocker` as their Step 3 report lines ```. In the `#N[,#M,#O...]` bullet, replace ``` (`blocked`, `open-pr`, `not-spec-shaped`, `target-missing`, `shipped`) ``` with ``` (`blocked`, `open-pr`, `not-spec-shaped`, `target-missing`, `shipped`, `unlanded-blocker`) ```. Add nothing else (headroom ~540 B).

  (h) In the journey: in the Success state, replace `` `target-missing`, or `shipped` — and `` with `` `target-missing`, `shipped`, or `unlanded-blocker` with the blocker and closing commit that never landed — and ``. In Step 1's Should understand, replace ``for five reasons (`blocked`, `open-pr`, `not-spec-shaped`, `target-missing`, `shipped`)`` with ``for six reasons (`blocked`, `open-pr`, `not-spec-shaped`, `target-missing`, `shipped`, `unlanded-blocker`)``. Add `  - plugin/bin/dispatch-unlanded-blockers.js` to `files:` after the `plugin/bin/dispatch-resume.js` entry. Append to Origin: `- Updated during build of #4792: names \`unlanded-blocker\`, the sixth removing exclusion (a closed out-of-run blocker whose closing commit never reached the integration branch), in Step 1 and the Success state; \`dispatch-unlanded-blockers.js\` added to \`files:\``.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dispatch-unlanded-blocker-exclusion-fixture.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-not-spec-shaped-exclusion-fixture.test.js tests/dispatch-named-target-exclusion-fixture.test.js tests/dispatch-tidy-named-target-coordination.test.js tests/dispatch-shipped-candidate-prose.test.js tests/dispatch-per-record-groups-prose.test.js tests/dispatch-mcp-timestamp-alias.test.js tests/dispatch-neighbour-in-flight-mcp.test.js tests/dispatch-near-dup-pairs-script.test.js tests/skill-fence-guard-shapes.test.js tests/node-eval-file-heredoc-syntax.test.js tests/node-e-snippet-syntax.test.js tests/session-tmp-root-migration.test.js tests/bin-lib/dispatch/reporting-fastlane-bundle-citation.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-size-single-source.test.js`
Expected: PASS. `tests/dispatch-named-form-exclusion-reasons.test.js` now derives six removing reasons, including `unlanded-blocker`, and finds them in both `SKILL.md` bullets and the journey's `six reasons`. `wc -c plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/SKILL.md` prints under 52,500 each (planned ~50,680 and ~51,960).

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/queue-pull-notes.md plugin/skills/dispatch/SKILL.md docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md tests/dispatch-unlanded-blocker-exclusion-fixture.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Exclude unlanded-blocker records at dispatch's queue pull — selection-time pass, three passes' rationale moved to queue-pull-notes, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN"
  ```

### Task 7: Report the unlanded-blocker exclusion and cover the gh-absent path

**Role:** transcription

**Files:**
- Modify: `plugin/skills/dispatch/blocked-exclusion-report.md` (after the `target-missing` line, the line starting ``` `#{number} excluded — named target {path} ```, before `**Exception — the headless drain steady state.**`)
- Modify: `plugin/skills/dispatch/mcp-transport.md` (new section directly before the heading `## Step 2 — open-linked-PR exclusion (#1224)`)
- Modify: `docs/skill-graph.md` (`## dispatch` table: new row directly after the row starting `| \`bin/dispatch-resume.js\` (\`bin/lib/dispatch/resume-eligibility.js\`) |`)
- Modify: `docs/plugin-structure.md` (the `dispatch` sub-file row, the sentence starting `queue-pull-notes.md holds Step 2's queue-build rationale`)
- Create: `tests/dispatch-unlanded-blocker-consumers-conformance.test.js`

**Interfaces:**
- Consumes: Task 5's CLI path (the skill-graph row and the MCP section name it). It does not depend on Task 6's test file.
- Degrade-clause convention check: the gh-absent clause cites `mcp-transport.md`'s own established conventions instead of restating a new one: the #2523 "no generic GraphQL bridge" section, the cross-PR overlap section's fail-open skip, and `flow/multispec-preflight-failure.md`'s `**Blocker landing.**` paragraph (the gh-absent `--blocker-states-json` path, under which a closed blocker reads `undetermined`, `classifyFromState` in `bin/lib/preflight-records/blocker-landing.js`).

- [ ] **Step 1: Write the failing test** — create `tests/dispatch-unlanded-blocker-consumers-conformance.test.js` (header: #4792). Use the shared helpers and `readText`.
  - `REPORT_FACTS` over the paragraph from the line starting ``Then read the same file's `reason: 'unlanded-blocker'` `` through the next fenced report line. Slice it on blank-line boundaries (`split('\n\n')`, the chunk starting with that prefix plus the next chunk), with whitespace collapsed. Facts: `/`reason: 'unlanded-blocker'` entries \(`records: \[number\], detail: \{blockers: \[\{blocker, commit\}\]\}` each, #4792/` — 'reads the unlanded-blocker entries'; `/under the same exception and empty-array rules below/` — 'inherits the headless-silence and empty rules'; `` /`#\{number\} excluded — blocker not landed: #\{blocker\} \(closing commit \{commit\}\), … — eligible again once it reaches the integration branch`/ `` — 'AC3.1: the report line names blocker, commit and when it is eligible again'. Tests: `missingFactsOf` → `[]` (`'AC3.1: blocked-exclusion-report.md renders unlanded-blocker entries (#4792)'`), plus `assertEachPatternGoesRed`. Placement: the paragraph's index is after the `target-missing` line and before `**Exception — the headless drain steady state.**`. The control moves the paragraph below the Exception paragraph (`assert.notEqual` first) and the same check throws.
  - `MCP_FACTS` over `sectionOf(readText(mcp-transport.md), '## Step 2 — unlanded-blocker exclusion (#4792)')`: `/skip the pass's `if node … dispatch-unlanded-blockers\.js … fi` block and exclude nothing/` — 'MCP path skips the pass'; `/the GitHub MCP server has no generic GraphQL bridge \(the #2523 section below\)/` — 'cites the #2523 convention'; `/reads every closed blocker `undetermined`, so it can never return the `unlanded` verdict/` — 'why no MCP substitute'; `/`\/claude-tweaks:flow` Step 2\.7b has the same blind spot on this transport/` — 'same blind spot as /flow'; `/the CLI prints one `Warning:` line and leaves `dispatch-groups\.json` unchanged/` — 'run as written, it fails open'. Tests: `[]` plus go-red. Placement: the heading sits after `## Step 2 — cross-PR overlap report (#1579)` and before `## Step 2 — native blocked-by / linked-PR batching: no generic GraphQL bridge (#2523)`, so its "above"/"below" deictics resolve (Deictic-reference check). Permutation control: move the section after the #2523 heading → `requireOrder` throws `/must come after/`.
  - `test('skill-graph names the unlanded-blocker queue-pull edge (#4792)')` — the line starting ``| `bin/dispatch-unlanded-blockers.js` (`bin/lib/dispatch/unlanded-blockers.js`) |`` exists and contains `queue-pull-script.md`, `--prefetched-json`, `reason: 'unlanded-blocker'`, `blocked-exclusion-report.md` and `mcp-transport.md`. Control: removing the line fails the existence check.
  - `test('plugin-structure.md describes queue-pull-notes.md\'s pass-placement section')` — the `dispatch` row contains `and where the not-spec-shaped, open-linked-PR, named-target and unlanded-blocker passes sit and why (#4792)`. Control: a copy with that clause removed fails the check.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-unlanded-blocker-consumers-conformance.test.js`
Expected: FAIL — the report paragraph is not found, `heading not found: ## Step 2 — unlanded-blocker exclusion (#4792)`, and the skill-graph and plugin-structure lines are missing.

- [ ] **Step 3: Edit the prose**

  In `blocked-exclusion-report.md`, after the `target-missing` report line and its blank line, insert:

  ```
  Then read the same file's `reason: 'unlanded-blocker'` entries (`records: [number], detail:
  {blockers: [{blocker, commit}]}` each, #4792 — `queue-pull-script.md`'s unlanded-blocker pass) and
  render one line per record, under the same exception and empty-array rules below:

  `#{number} excluded — blocker not landed: #{blocker} (closing commit {commit}), … — eligible again once it reaches the integration branch`

  ```

  In `mcp-transport.md`, insert directly before `## Step 2 — open-linked-PR exclusion (#1224)`:

  ```
  ## Step 2 — unlanded-blocker exclusion (#4792)

  `queue-pull-script.md`'s unlanded-blocker pass needs `gh`: `bin/dispatch-unlanded-blockers.js` calls `preflight-records.js --blocker-landing`, whose landing check is a batched GraphQL query plus REST compare calls, and the GitHub MCP server has no generic GraphQL bridge (the #2523 section below). On this transport skip the pass's `if node … dispatch-unlanded-blockers.js … fi` block and exclude nothing. No MCP substitute exists: `preflight-records.js`'s gh-free `--blocker-states-json` path reads every closed blocker `undetermined`, so it can never return the `unlanded` verdict this pass excludes on, and `/claude-tweaks:flow` Step 2.7b has the same blind spot on this transport (`flow/multispec-preflight-failure.md`'s Blocker landing paragraph) — skipping the pass loses no exclusion `/flow` would itself enforce. Run as written instead, the pass fails open the same way the cross-PR overlap fetch above does: `preflight-records.js` exits non-zero at its first `gh` call, and the CLI prints one `Warning:` line and leaves `dispatch-groups.json` unchanged.

  ```

  In `docs/skill-graph.md`'s `## dispatch` table, insert after the `bin/dispatch-resume.js` row:

  ```
  | `bin/dispatch-unlanded-blockers.js` (`bin/lib/dispatch/unlanded-blockers.js`) | Since #4792, `queue-pull-script.md`'s unlanded-blocker pass runs it over the remaining candidate pool: it hands the already-fetched candidates to `preflight-records.js --prefetched-json - --blocker-landing`, the judgment `/flow` Step 2.7b runs before claiming, and drops each candidate with an `unlanded` out-of-run blocker as `reason: 'unlanded-blocker'` until that blocker lands. It fails open (an `undetermined` verdict keeps the candidate; a failed `preflight-records.js` call excludes nothing); `blocked-exclusion-report.md` renders the entries, and `mcp-transport.md` skips the pass on a `gh`-absent firing. |
  ```

  In `docs/plugin-structure.md`'s `dispatch` row, replace `queue-pull-notes.md holds Step 2's queue-build rationale — the two pulls' \`--limit\` truncation behavior and the \`work-links: native\` GraphQL dependency filter — read only under \`work-links: native\` or when diagnosing a capped pull.` with `queue-pull-notes.md holds Step 2's queue-build rationale — the two pulls' \`--limit\` truncation behavior, the \`work-links: native\` GraphQL dependency filter, and where the not-spec-shaped, open-linked-PR, named-target and unlanded-blocker passes sit and why (#4792) — read only under \`work-links: native\`, when diagnosing a capped pull, or when changing one of those passes.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dispatch-unlanded-blocker-consumers-conformance.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-neighbour-in-flight-mcp.test.js tests/dispatch-mcp-timestamp-alias.test.js tests/flow-claim-preflight.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js tests/tidy-subfile-table-completeness.test.js tests/skill-catalog-completeness.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/dispatch/blocked-exclusion-report.md plugin/skills/dispatch/mcp-transport.md docs/skill-graph.md docs/plugin-structure.md tests/dispatch-unlanded-blocker-consumers-conformance.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Report unlanded-blocker exclusions and skip the pass on the MCP transport — report line, gh-absent section, skill-graph edge, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN"
  ```

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 (a conformance test over `settle-and-merge.md` asserts Step 6 names the blocker-landing stop and states it does not count toward the retry ceiling) | Task 2 `AC1.1 AC2.1 AC4.1` test (gate line, both verdicts, `no attempt counted against dispatch-retry-ceiling`), the placement test and the same-gate test; Task 1 row facts |
| AC1.2 (reverting the Step 6 text turns it red) | Task 2 `AC1.2` revert test (the paragraph removed → `assertSettle` throws) and the per-fact go-red test; Task 1 `AC1.2` go-red |
| AC2.1 (an `unlanded`-blocker record ends one Settle pass with the claim released and `auto:merge` still present) | Task 2 facts: the claimed case runs steps 1-2 (`release-claim.js`, `--reason "failed: blocker-landing"`), the unclaimed case holds no claim to release, steps 3-7 are skipped (no `failure-check`, no `auto:merge`/`auto:merge-pending` revocation), and the pointer never counts as an attempt; Task 1 report line; Task 3's `transient` fallback (which preserves `auto:merge`) |
| AC3.1 (a queue pull over a pool with an `unlanded` out-of-run blocker excludes that record with its own reason, and includes it once the blocker lands) | Task 5 `AC3.1` behavioral test (real `preflight-records.js` `run`, fake `gh`: `diverged` → excluded as `unlanded-blocker`, `behind` → included) plus its undetermined, open, bundle and fail-open tests; Task 4 `--prefetched-json` landing test; Task 6 extract-and-run of the queue-pull block (bash and zsh), order pin and bullet facts; Task 7 report line |
| AC4.1 (in the claimed case, Settle closes the run's draft PR with its resume command) | Task 2 facts (`Step 2.8: claimed #{n}` key, `then step 5's PR tombstone and nothing else of step 5`, the `### Resume` pointer sentence, `gh pr close` the PR), and the pointer-never-counts test; Task 1 row fact for a continuation's held claims |
| AC4.2 (a test or conformance check pins that step) | Task 2 `AC4.2` test (step 5's tombstone block — the `run-state.json` `pr` condition, the replaced `printf` sentence and `gh pr close {pr-number}` — still exists, with a removal control) plus the AC4.1 facts' go-red proofs |
