# Harness Refusal Agent Noun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log a `wd-guard-refusal` friction event for every Claude Code worktree-isolation Bash refusal, covering the `This agent` noun and the worktree-gone `Refusing to run there` templates. Each event gets `actor` (`session`/`agent`) and `variant` (`guard`/`worktree-gone`), and reflect's Friction lens breaks the count down by actor.

**Architecture:** `plugin/bin/lib/hooks/harness-refusal.js` stays the one place the friction-event path's refusal text lives. Out of scope: the timing turn classifier keeps its own separate `GUARD_REFUSAL_RE` in `plugin/bin/lib/timing/turn-class.js` (session noun only); that follow-up is ledgered, per the plan review. It gains the agent noun, the worktree-gone signature, a widened regex built from those string constants, and a pure `classifyRefusal(text)`. `post-tool-use-failure.js` logs the classification. `bash-prefilter.js` gates on either signature. The upstream-drift manifest's `claude-code` entry and its drift-pin test move in lockstep.

**Tech Stack:** Node 18+ CommonJS, `node --test`, YAML manifest read by `tools/upstream-drift/`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T171821-record-3819/work/3819-spec.md`

**Scope keywords:** harness-refusal, HARNESS_ISOLATION_REFUSAL_RE, REFUSAL_SIGNATURE, REFUSAL_FRAGMENTS

## Global Constraints

- `harness-refusal.js` must still `require` nothing: `bash-prefilter.js` loads it on every failed Bash call. Build every regex from string constants only.
- The existing `This session … Refusing to run it` match stays matched, and is classified `actor: 'session'`, `variant: 'guard'`.
- Event fields are exactly `actor` ∈ {`session`, `agent`} and `variant` ∈ {`guard`, `worktree-gone`}. Every other event field is unchanged: `tool: 'Bash'`, `reason: 'harness-worktree-isolation'`, `command` (200-character cap), `test` when `CT_HOOKS_TEST_MODE=1`.
- Neither `post-tool-use-failure.js` nor `bash-prefilter.js` spells any refusal literal in code. Both derive from `./harness-refusal`, as the existing one-place test enforces.
- Manifest occurrence counts are the values measured against the installed Claude Code 2.1.302 binary on 2026-10-28, listed in Task 2. Do not guess them.

## Facts measured before planning (2026-10-28, Claude Code 2.1.302)

- **Binary templates.** These are from `/Users/thomasholknielsen/.local/share/claude/versions/2.1.302`, where `${noun}` is `NI(e).noun` (`This session` or `This agent`):
  - Git-operations refusal: `${noun} is isolated in the worktree ${s}, but this command ${Ie}. Refusing to run it — ${y} git operations must target its own worktree. ${De}`
  - Cwd in a different worktree: `… is isolated in the worktree ${b}, but this command's working directory (…) is in a different worktree (…). Refusing to run it there — ${h} commands must run inside its own worktree. …`
  - Cwd in the shared checkout: `… is isolated in the worktree ${n}, but this command's working directory resolved to the shared checkout (${e}). Refusing to run it there — …`
  - Worktree-gone, fixed noun: `This agent is isolated in the worktree ${Ie}, but its working directory "${Un}" no longer exists and the only recovery target is the parent session's shared checkout. Refusing to run there — the isolation worktree appears to have been removed. Report this instead of retrying.`
  - Worktree-gone, `${noun}` variant: `${NI(so).noun} is isolated in the worktree …, but its working directory "…" no longer exists and the recovery target (…) is outside that worktree. Refusing to run there. Report this instead of retrying.`
- **Occurrence counts (byte search).** `noun:"This session"` 1x, `noun:"This agent"` 1x, ` is isolated in the worktree ` 9x, `Refusing to run it` 5x, `Refusing to run there` 3x, `Refusing to run it — ` 1x, `Refusing to run it there` 2x, `Refusing to run there — ` 1x, `outside that worktree. Refusing to run there.` 2x (the template plus a compiled string-table copy).
- **Live hook payload.** A `claude -p` probe in a scratch repo had an `isolation: "worktree"` agent run `d=.; sed -n 1,2p $d/README.md`. The parent session's `PostToolUseFailure` hook fired with `tool_name: "Bash"`, an `agent_id`, and `error`: `This agent is isolated in the worktree <wt>, but this command runs sed with a value computed at runtime (the variable d) where an option may stand (…) in a plain command, so what it runs cannot be shown not to be git. Refusing to run it — a worktree-isolated agent's git operations must target its own worktree. Run the plain command from <wt>.` This confirms the spec's ASSUMPTION Gotcha.
- **Design decision.** `variant` comes from which signature matched (`Refusing to run there` means `worktree-gone`), not from a `no longer exists` substring. The two are equivalent at 2.1.302, since both worktree-gone templates and only they end `Refusing to run there`. The signature is already a pinned manifest fragment with unique anchors. `no longer exists` occurs 57x in the binary, so it cannot be anchored, and an unpinned literal would drift silently. This departs from the spec's Technical Approach sentence ("`variant` from the presence of 'no longer exists'"). It is a deliberate deviation for build Common Step 4.5 (architecture alignment) to classify. The outcome the Acceptance Criteria name (both worktree-gone templates give `variant: worktree-gone`) is unchanged.

## Review Focus

1. A different-worktree guard refusal ends `Refusing to run it there`. It must classify `variant: 'guard'`, not `worktree-gone`: `Refusing to run there` never matches inside `Refusing to run it there`. Pinned in Task 1's classifier test.
2. A harness message that carries the noun and the isolation clause but no `Refusing to run` signature must not match. Example: the Edit-tool refusal `This agent is isolated in the worktree <wt>, so its writes are limited to that folder. …`. Pinned in Task 1.
3. The prefilter must still pass (skip: false) every matched refusal, including both worktree-gone texts and a JSON-escaped spelling. Pinned in Task 1.
4. Events logged before this change carry no `actor`/`variant`. The Friction lens must read a missing `actor` as `session` and a missing `variant` as `guard`, never drop such events. Stated in Task 3's prose.
5. Rewording only one worktree-gone template in the binary must surface as drift on that template's own anchor, while the other assertions stay ok. Pinned in Task 2.

---

### Task 1: Widen the matcher, classify, log actor/variant, keep the prefilter firing

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/harness-refusal.js` (whole module, about 30 lines)
- Modify: `plugin/bin/lib/hooks/post-tool-use-failure.js` (header comment and `run`)
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js:37` (require) and `:148-157` (`failureCarriesRefusal` and its comment)
- Test: `tests/hooks-harness-refusal.test.js`

**Interfaces:**
- Produces (exports of `harness-refusal.js`, all strings or frozen arrays):
  - `SESSION_NOUN = 'This session'`
  - `AGENT_NOUN = 'This agent'`
  - `ISOLATION_CLAUSE = ' is isolated in the worktree '`
  - `REFUSAL_SIGNATURE = 'Refusing to run it'` (unchanged name and value)
  - `WORKTREE_GONE_SIGNATURE = 'Refusing to run there'`
  - `REFUSAL_SIGNATURES = Object.freeze([REFUSAL_SIGNATURE, WORKTREE_GONE_SIGNATURE])`
  - `REFUSAL_FRAGMENTS = Object.freeze([SESSION_NOUN, AGENT_NOUN, ISOLATION_CLAUSE, REFUSAL_SIGNATURE, WORKTREE_GONE_SIGNATURE])`
  - `HARNESS_ISOLATION_REFUSAL_RE`, with exactly the source ``String.raw`(This session|This agent) is isolated in the worktree [\s\S]*?(Refusing to run it|Refusing to run there)` `` and no flags. Build it with the existing `escapeRegex`, not as a literal.
  - `classifyRefusal(text: unknown) -> { actor: 'session'|'agent', variant: 'guard'|'worktree-gone' } | null`. Returns `null` for a non-string or no match. `actor` is `'session'` when capture 1 equals `SESSION_NOUN`, else `'agent'`. `variant` is `'worktree-gone'` when capture 2 equals `WORKTREE_GONE_SIGNATURE`, else `'guard'`.
- `post-tool-use-failure.js` keeps re-exporting the same `HARNESS_ISOLATION_REFUSAL_RE` object.

- [ ] **Step 1: Write the failing tests in `tests/hooks-harness-refusal.test.js` (AC1.1, AC1.2, AC4.1)**

Replace the two pinned tests, "derived regex keeps the pre-#3304 source exactly" and "fragments are the three literals", with the new source and the five-literal list above. Extend the one-place test's literal list to `['Refusing to run', 'isolated in the worktree', 'This session', 'This agent']`. Then add five fixture texts, modelled on the binary templates and the live payload:

```js
const WT = '/w/.claude/worktrees/agent-a1';
const SESSION_GUARD = `This session is isolated in the worktree ${WT}, but this command runs sed with a value computed at runtime (the variable d) where an option may stand in a plain command, so what it runs cannot be shown not to be git. Refusing to run it — a worktree-isolated session's git operations must target its own worktree. Run the plain command from ${WT}.`;
const AGENT_GUARD = SESSION_GUARD.replace('This session', 'This agent').replace("session's", "agent's");
const AGENT_OTHER_WORKTREE = `This agent is isolated in the worktree ${WT}, but this command's working directory (/w/other) is in a different worktree (/w/other). Refusing to run it there — a worktree-isolated agent's commands must run inside its own worktree. Re-run the command from ${WT}.`;
const GONE_FIXED = `This agent is isolated in the worktree ${WT}, but its working directory "${WT}/sub" no longer exists and the only recovery target is the parent session's shared checkout. Refusing to run there — the isolation worktree appears to have been removed. Report this instead of retrying.`;
const GONE_NOUN = `This session is isolated in the worktree ${WT}, but its working directory "${WT}/sub" no longer exists and the recovery target (/w) is outside that worktree. Refusing to run there. Report this instead of retrying.`;
```

Tests to add:
- `classifyRefusal: each refusal template classifies by noun and signature`. Expected values:
  - `SESSION_GUARD` → `{actor:'session', variant:'guard'}`
  - `AGENT_GUARD` → `{actor:'agent', variant:'guard'}`
  - `AGENT_OTHER_WORKTREE` → `{actor:'agent', variant:'guard'}`
  - `GONE_FIXED` → `{actor:'agent', variant:'worktree-gone'}`
  - `GONE_NOUN` → `{actor:'session', variant:'worktree-gone'}`
- `classifyRefusal: non-refusals return null`. Each of these returns `null`:
  - `'Exit code 1\nfatal: not a git repository'`
  - `undefined`
  - `42`
  - the Edit-tool text `` `This agent is isolated in the worktree ${WT}, so its writes are limited to that folder. This path is in a different worktree (/w). Edit the copy of this file under ${WT} instead.` ``
- `post-tool-use-failure logs one wd-guard-refusal with actor/variant per refusal template`. For each of the five fixtures:
  - Build a fresh `gitRepo()` and `harnessWorktreeOf(main)` from `./helpers/git-fixtures`.
  - Call `require('../plugin/bin/lib/hooks/post-tool-use-failure').run(ctx)`, where `ctx` has the same shape as `failureCtx` in `tests/hooks-post-tool-use-failure.test.js`, with the fixture's `WT` replaced by the real worktree path.
  - Read the minted `*-adhoc-standalone` dir's events with `ctxLib.readEventLines`.
  - Assert exactly one `wd-guard-refusal` with `reason: 'harness-worktree-isolation'` and the expected `actor`/`variant`.
- `a worktree-gone refusal whose cwd no longer exists logs into the session's trusted owned run`.
  - Build a `gitRepo()` and pass `ctx.cwd` as a path under it that does not exist (the removed working directory).
  - Set `ctx.ownedRun = { dir: <a run dir created under the repo's .claude-tweaks/pipelines/> }` with no `attribution`.
  - Pass `GONE_FIXED` as the error.
  - Assert that dir's `events.jsonl` holds one `wd-guard-refusal` with `actor: 'agent'` and `variant: 'worktree-gone'`.
  - This pins the reachable path; Task 3's prose states the unreachable one.
- `post-tool-use-failure logs nothing for an unrelated Bash failure`. An ordinary `'Exit code 128\nfatal: …'` error mints no ad-hoc dir.
- `bash-prefilter earlyGate passes every refusal template to the handler`. For each of the five fixtures, `earlyGate('post-tool-use-failure', () => JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'x' }, error: text })).skip === false`. Also `GONE_FIXED`'s payload with `Refusing` rewritten as `\\u0052efusing` (JSON-escaped) still gives `skip: false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-harness-refusal.test.js`
Expected: FAIL. The regex-source and fragments tests fail, `classifyRefusal is not a function`, and the prefilter test fails for `GONE_FIXED`/`GONE_NOUN`.

- [ ] **Step 3: Implement**

- `harness-refusal.js`: add the constants, `REFUSAL_SIGNATURES`, the widened regex and `classifyRefusal` from the Interfaces block. Update the header comment to name both nouns and the worktree-gone templates (#3819). Still no `require`.
- `post-tool-use-failure.js`: replace the `.test(error)` gate with `const refusal = classifyRefusal(error); if (!refusal) return {};`. Add `actor: refusal.actor, variant: refusal.variant` to the `appendEvent` payload, after `reason`. Keep the `HARNESS_ISOLATION_REFUSAL_RE` re-export. Widen the header comment to name the agent noun and worktree-gone text.
- `bash-prefilter.js`: `failureCarriesRefusal` returns true when any of `REFUSAL_SIGNATURES` is in `raw` or in `input.error`. Update the comment above it, which today names only `REFUSAL_SIGNATURE`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-harness-refusal.test.js tests/hooks-post-tool-use-failure.test.js tests/hooks-bash-prefilter.test.js tests/friction-adhoc-enterworktree-roundtrip.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Go-red control test run (scratch, not committed) (AC2.1)**

In `harness-refusal.js`, temporarily build `HARNESS_ISOLATION_REFUSAL_RE` from the pre-change shape: `escapeRegex(SESSION_NOUN + ISOLATION_CLAUSE) + '[\\s\\S]*?' + escapeRegex(REFUSAL_SIGNATURE)`, with no capture groups. Make `classifyRefusal` return `{actor:'session', variant:'guard'}` on a match. Run `node --test tests/hooks-harness-refusal.test.js`. Expected: the `AGENT_GUARD`, `AGENT_OTHER_WORKTREE`, `GONE_FIXED` and `GONE_NOUN` logging cases fail, and the `SESSION_GUARD` logging case passes. Quote the failing test names in the task report, then restore the file (`git diff` on it must show only the Step 3 change).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/harness-refusal.js plugin/bin/lib/hooks/post-tool-use-failure.js plugin/bin/lib/hooks/bash-prefilter.js tests/hooks-harness-refusal.test.js
git commit -m "Count agent and worktree-gone isolation refusals — refs #3819"
```

### Task 2: Pin the new fragments and anchors against the binary

**Files:**
- Modify: `tools/upstream-drift/manifest.yml:357-426` (the `claude-code` comment block and `assertions`)
- Test: `tests/harness-refusal-drift-pin.test.js`

**Interfaces:**
- Consumes: `REFUSAL_FRAGMENTS` (five entries) and `WORKTREE_GONE_SIGNATURE` from Task 1.
- Produces: a `claude-code` `assertions` list of exactly nine, in this order:
  - 0 `must-match: 'noun:"This session"'`
  - 1 `must-match: 'noun:"This agent"'`
  - 2 `" is isolated in the worktree "`
  - 3 `"Refusing to run it"`
  - 4 `"Refusing to run there"`
  - 5 the existing git anchor, unchanged (`manifest.yml:421`'s single-quoted `Refusing to run it` + space + the six-character escape backslash-u-2-0-1-4 + space, never the em dash character itself)
  - 6 `"Refusing to run it there"` (cwd anchor)
  - 7 the fixed worktree-gone anchor, single-quoted YAML, spelled like assertion 5: `Refusing to run there` + space + the six-character escape backslash-u-2-0-1-4 + space. The binary holds the escape, not the character; the em dash character here would fail AC3 and the `DASH`-based stand-in tests.
  - 8 `"outside that worktree. Refusing to run there."` (noun worktree-gone anchor)

  Every entry has `file: "plugin/bin/lib/hooks/harness-refusal.js"` and `upstream-path: "."`. Assertions 0–6 keep their current `claims` text; the old index-2 claim now sits at index 3, with the old 3/4 claims moving to 5/6. Write new claims for 1 (`AGENT_NOUN`), 4 (`WORKTREE_GONE_SIGNATURE`), 7 (`the fixed-noun worktree-gone refusal …`) and 8 (`the noun worktree-gone refusal …`). The claim for 7 must contain `fixed worktree-gone refusal`, and the claim for 8 must contain `noun worktree-gone refusal`. Task 2's tests match on those phrases.

- [ ] **Step 1: Update the drift-pin test in `tests/harness-refusal-drift-pin.test.js`**

- `binaryStandIn` gains `goneFixedVerb = 'Refusing'` and `goneNounVerb = 'Refusing'` parameters. It appends the two worktree-gone template excerpts from the "Facts measured" section as plain strings, keeping `${…}` literal and using `DASH` for the em dash, with the verb parameterized.
- Index constants become `GIT_ANCHOR = 5`, `CWD_ANCHOR = 6`, `GONE_FIXED_ANCHOR = 7`, `GONE_NOUN_ANCHOR = 8`. The intact test expects nine `'ok'` statuses.
- The existing git/cwd rewording tests expect `othersStatuses` to be eight `'ok'`.
- Add `rewording only the fixed worktree-gone template is reported as drift on its anchor`, with `goneFixedVerb: 'Declining'`. Expect status `drift`, `results[7].status === 'unmatched'`, `results[7].claims` matching `/fixed worktree-gone refusal/`, and the other eight `'ok'`.
- Add the same test for the noun template, with `goneNounVerb: 'Declining'`, index 8, and `/noun worktree-gone refusal/`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/harness-refusal-drift-pin.test.js`
Expected: FAIL. AC1.1's fragment pin reports no assertion containing `"This agent"` / `"Refusing to run there"`, and the nine-status test fails.

- [ ] **Step 3: Update the manifest**

Rewrite the `claude-code` assertions to the nine listed in Interfaces. Rewrite the comment block's count sentence with the measured counts from "Facts measured": nine assertions; five fragments with their per-version counts; four anchors with their counts. Note that the noun worktree-gone anchor's 2x is the template plus a compiled string-table copy. Keep every other key and comment paragraph unchanged.

- [ ] **Step 4: Run the tests and the real check to verify they pass (AC3.1)**

Run: `node --test tests/harness-refusal-drift-pin.test.js tools/upstream-drift/tests/*.test.js`
Expected: PASS.
Run: `node tools/upstream-drift/run.js findings --dep claude-code --offline`
Expected: prints `[]` and `no findings`, against the installed 2.1.302.

- [ ] **Step 5: Commit**

```bash
git add tools/upstream-drift/manifest.yml tests/harness-refusal-drift-pin.test.js
git commit -m "Pin agent-noun and worktree-gone refusal text in the claude-code drift entry — refs #3819"
```

### Task 3: Friction lens breakdown and prose sweep

**Files:**
- Modify: `plugin/skills/reflect/full-mode.md`. Edit lines 55-56 (the transcript-grep signatures) and 121-125 (the harness-guard sentence), and add one paragraph after "**Aggregate volume.**" (line 231-234).
- Modify: `docs/hooks.md:11` and `:16` (the `post-tool-use-failure` prefilter sentence)
- Modify: `docs/skill-authoring.md:202`
- Test: `tests/harness-refusal-drift-pin.test.js` (its last test)

**Interfaces:**
- Consumes: `WORKTREE_GONE_SIGNATURE` and `REFUSAL_SIGNATURE` from Task 1; the event fields `actor`/`variant`.

- [ ] **Step 1: Extend the last test in `tests/harness-refusal-drift-pin.test.js`**

`the reflect Friction lens transcript grep names the same signature` also asserts that `prose.includes('`' + WORKTREE_GONE_SIGNATURE + '`')`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/harness-refusal-drift-pin.test.js`
Expected: FAIL, because `reflect/full-mode.md does not name` the worktree-gone signature.

- [ ] **Step 3: Edit the prose**

- **full-mode.md transcript-grep fallback.** The deny-message signatures become `Refusing to run it`, `Refusing to run there` and `requires an isolated worktree`.
- **full-mode.md harness-guard sentence (lines 121-125).** The quoted frame names both nouns: "This session/This agent is isolated in the worktree … Refusing to run it" or "… Refusing to run there". The logged event carries `actor` and `variant`. A dispatched agent's refusal reaches the same hook: measured 2026-10-28, an `isolation: "worktree"` agent's refused Bash call fires the parent session's `PostToolUseFailure`.
- **New full-mode.md paragraph after Aggregate volume.** Title it `**Isolation-refusal breakdown (#3819).**`. For `wd-guard-refusal` events with `reason: harness-worktree-isolation`:
  - Report the count split by `actor`: `session` is the operator's own; `agent` is a dispatched agent's. An agent's refusal is still the run's friction, usually traceable to the dispatch prompt the run wrote.
  - Name every `variant: worktree-gone` event individually: the agent's isolation worktree was removed under it, which is lost isolation and not a command-shape refusal.
  - An event with no `actor`/`variant` (logged before #3819) counts as `actor: session`, `variant: guard`.
  - **Known limitation**, stated in the same paragraph (plan review, ledgered follow-up). An agent refusal from its own still-live isolation worktree lands in an ad-hoc dir keyed to that worktree, and `friction-events.js` merges it only once that worktree is removed (`findAdHocRunsBySessionId`). A worktree-gone refusal in a session with no trusted owned run has no listed cwd to key a stamp on, so it lands on the fallback guess, which the primary read drops. The agent and worktree-gone counts are therefore lower bounds.
  - Keep it to one paragraph of 5-7 lines; `full-mode.md` is at 37,691 of 52,500 rail bytes.
- **`docs/hooks.md:11`.** Name both nouns and the worktree-gone templates, plus the `actor`/`variant` fields.
- **`docs/hooks.md:16`.** "carries `Refusing to run it`" becomes "carries `Refusing to run it` or `Refusing to run there` (`REFUSAL_SIGNATURES`)".
- **`docs/skill-authoring.md:202`.** The frame becomes "`This session` / `This agent` is isolated in the worktree … `Refusing to run it` / `Refusing to run there`", adding that each event records `actor` and `variant`.

- [ ] **Step 4: Run the affected suites**

Run: `node --test tests/harness-refusal-drift-pin.test.js tests/reflect-friction-lens-vocab.test.js tests/feedback-harness-refusal-attribution-conformance.test.js`
Expected: PASS.
Run: `git grep -n "This session is isolated in the worktree … Refusing to run it" -- docs plugin`
Expected: no remaining hit, except text that is explicitly about the session noun only.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/reflect/full-mode.md docs/hooks.md docs/skill-authoring.md tests/harness-refusal-drift-pin.test.js
git commit -m "Break isolation-refusal friction down by actor and name worktree-gone events — refs #3819"
```

### Task 4: Full suite (folded verification)

- [ ] **Step 1: Run the full test suite verification (AC5.1)**

Run `npm test` (redirected to a `.txt` file) and confirm 0 failures. This is the record's `npm test passes` acceptance criterion. Build's Common Step 5 runs it through the verify runner.
