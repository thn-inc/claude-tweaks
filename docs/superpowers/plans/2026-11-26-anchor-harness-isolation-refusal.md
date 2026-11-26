# Anchor HARNESS_ISOLATION_REFUSAL_RE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A failed Bash command whose `error` merely quotes a worktree-isolation refusal in the middle of its text no longer logs a `wd-guard-refusal` event, and the Bash prefilter skips it too.

**Architecture:** `HARNESS_ISOLATION_REFUSAL_RE` (built in `plugin/bin/lib/hooks/harness-refusal.js`) gains a `^` start anchor, because the probe showed the hook's `error` begins with the noun. `bash-prefilter.js`'s `failureCarriesRefusal` keeps a cheap substring gate but applies the same start-of-`error` rule, so the prefilter and the matcher agree. The measurement goes into the module header and the `claude-code` comment block of `tools/upstream-drift/manifest.yml`.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T105744-record-4523/work/4523-spec.md`

## Measurement (Deliverable 1, done before planning)

Headless `claude -p` probes on Claude Code **2.1.325**, 2026-11-26, darwin. Each probe used throwaway `PreToolUse`/`PostToolUseFailure` Bash hooks (`--settings`) that appended the raw hook stdin to a capture file. Evidence is in the run directory's `evidence/`.

| Template | How provoked | Result |
|---|---|---|
| session guard (`This session … Refusing to run it — …`) | `EnterWorktree`, then `g=git; $g -C .. status` (`out-guard2`) | `error` begins `This session is isolated in the worktree ` |
| worktree-gone, `${noun}` template (`… is outside that worktree. Refusing to run there.`) | an agent with `isolation: "worktree"` whose worktree was removed while a command ran (`out-gone-agent`) | `error` begins `This agent is isolated in the worktree ` |
| worktree-gone, session noun | `-w` and `EnterWorktree` sessions with the worktree removed (`out-gone-session2`, `out-gone-session-w`) | not reachable headless: the shell recovers to `$HOME` and returns the non-refusal "Working directory … no longer exists … Shell cwd recovered to …" message |
| worktree-gone, fixed agent template (`… only recovery target is the parent session's shared checkout. Refusing to run there — …`) | needs the hub-only isolation context (`j$e()`) | not reachable headless |
| agent guard | measured 2026-10-28 on 2.1.302 by #3819 | `error` begins with the noun |

The two templates that were not reachable are template literals in the 2.1.325 binary that begin with the noun (`${mSt(Qo).noun} is isolated …` and the literal `This agent is isolated …`). Both return through the same shell-error wrapper (`Ow(...)`) as the measured worktree-gone refusal, which added no prefix. Every template therefore begins with the noun, so the matcher is anchored at `^`. A side effect: anchoring also removes the restart-at-every-position scan on an `error` that repeats the noun and clause without a signature (`'This session is isolated in the worktree x '.repeat(5000)`: 69 ms unanchored, 1 ms anchored).

## Global Constraints

- The spec's acceptance criteria: AC1.1 "A test passes a failed-command `error` that quotes a refusal in the middle of its text and expects no `wd-guard-refusal` event." AC2.1 "The existing tests for the session, agent and worktree-gone refusals still pass." AC3.1 "`npm test` passes."
- `harness-refusal.js` "Requires nothing, by contract: bash-prefilter.js loads it on every failed Bash call, so any require here moves cost onto each of them." (module header). Add no `require`.
- `tests/hooks-harness-refusal.test.js`'s one-place-change test: neither `post-tool-use-failure.js` nor `bash-prefilter.js` may spell `Refusing to run`, `isolated in the worktree`, `This session` or `This agent` in code. Derive them from `harness-refusal.js`'s exports.
- `.claude/skills/hook-event-in-process-tests/SKILL.md` governs post-tool-use-failure tests: reuse the existing `ptufCtx`/`gitRepo()`/`harnessWorktreeOf()` in-process pattern in `tests/hooks-harness-refusal.test.js`. Never spawn `hooks.js`.
- `.claude/skills/regex-scan-linearity/SKILL.md`: "Probe with an input built from the regex's own alphabet. Feed the function a long run of characters its pattern accepts, without the terminator that ends a match, and time it." The probe above was run (1 ms anchored). No perf file is added: the change removes a super-linear shape and adds none.
- `.claude/skills/upstream-drift/SKILL.md` / `upstream-repin`: the `claude-code` entry's `must-match` assertions and `pinned` stay unchanged. Only its comment block grows. `tests/harness-refusal-drift-pin.test.js` must stay green.
- Commit subjects: `{Verb} {what} — {detail}`, body ends `refs #4523` (never `closes`/`fixes`) plus the `Claude-Session:` trailer.
- Project maturity `established`: write characterization tests before changing behavior. The existing per-template tests serve as that characterization (AC2.1).

## Review Focus

- An `error` that begins with whitespace or a newline before the noun. The probe saw none, so the anchored matcher would now miss it. This is accepted on the measurement, and the header comment states the assumption so a future re-probe knows what to check.
- A quoted refusal that starts the `error` (a command whose very first output byte is the refusal text) still logs. A line-based or prefix-based bound cannot tell it apart, and the harness never emits it, since the probe showed the refusal replaces command output. Accepted and documented.
- A JSON-escaped spelling in the raw payload (`Refusing`) must still reach the handler through the parsed `error`. The existing `earlyGate` escaped-payload assertion keeps covering it.
- The Edit-tool refusal text (`… so its writes are limited to that folder …`) stays `null`, as the existing non-refusals test already checks.
- Unparseable stdin: the prefilter returns skip, and the handler would do nothing with it either.

---

### Task 1: Anchor the matcher and record the measurement

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/hooks/harness-refusal.js` (header comment and `HARNESS_ISOLATION_REFUSAL_RE`)
- Modify: `tools/upstream-drift/manifest.yml` (the `claude-code` comment block above `- name: claude-code`; comments only)
- Modify: `docs/hooks.md:18` (the `post-tool-use-failure` bullet)
- Test: `tests/hooks-harness-refusal.test.js`

**Interfaces:**
- Produces: `HARNESS_ISOLATION_REFUSAL_RE` with source exactly `^(This session|This agent) is isolated in the worktree [\s\S]*?(Refusing to run it|Refusing to run there)` and no flags. `classifyRefusal(text)` is unchanged in shape: `{ actor, variant } | null`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-harness-refusal.test.js`
  - Change the source-pin test's expected string to start with `^` (rename it `harness-refusal: the derived regex is the #4523-anchored source exactly`).
  - Add a helper `quoteMidText(text)` returning `` `Exit code 1\nnot ok 3 - classifies the refusal\n  expected: '${text}'` `` (the refusal quoted after other output, the failing-test-fixture case the spec names).
  - Add `test('AC1.1: classifyRefusal returns null for an error that quotes a refusal mid-text', …)`: for each `[name, text]` of `FIXTURES`, `assert.strictEqual(classifyRefusal(quoteMidText(text)), null, name)`.
  - Add a loop over `FIXTURES` registering `` test(`AC1.1: post-tool-use-failure logs no wd-guard-refusal for ${name} quoted mid-text`, …) ``: `main = gitRepo()`, `wt = harnessWorktreeOf(main)`, `failure.run(ptufCtx(wt, quoteMidText(text.split(WT).join(wt))))`, then `assert.deepStrictEqual(adhocDirs(main), [], name)`.
  - Leave the existing per-template positive tests unchanged (AC2.1). They are the go-red partner: the same `FIXTURES` text unquoted must still log exactly one event.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-harness-refusal.test.js`
Expected: FAIL. The source pin fails, the classifyRefusal AC1.1 test fails (the unanchored regex classifies the quoted text), and the five post-tool-use-failure AC1.1 tests fail (`adhocDirs` has length 1).

- [ ] **Step 3: Implement**
  - In `harness-refusal.js`, prefix the `new RegExp(` source with `'^' +`. Keep the rest of the composition unchanged.
  - Extend the header comment by one paragraph saying that the pattern is anchored at the start of `error` (#4523), and that a 2026-11-26 probe on 2.1.325 showed the session-guard and `${noun}` worktree-gone `error` begin with the noun (the agent guard was measured 2026-10-28). The paragraph also says the session-noun and fixed worktree-gone templates were unreachable headless but are noun-first literals behind the same shell-error wrapper, and that a re-probe must confirm `error` still starts with the noun before this anchor is trusted on a new major release.
  - In `manifest.yml`, add one bullet to the `claude-code` comment block (after the "Limit:" paragraph) recording the same measurement. Its wording: the matcher is anchored at `^` because `error` begins with the noun; measured 2026-11-26 on 2.1.325 for the session guard and the `${noun}` worktree-gone template (agent noun), 2026-10-28 on 2.1.302 for the agent guard; the session-noun and fixed worktree-gone templates were not reachable headless and rest on their noun-first literals. Also note that the literal assertions cannot see a prefix the harness might add around a message, so a re-probe is the only check. Comments only. No assertion, `pinned` or key changes.
  - In `docs/hooks.md:18`, after "for both nouns (…)", add: "only when `error` begins with that noun — command output that merely quotes a refusal is not one (#4523)".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-harness-refusal.test.js tests/harness-refusal-drift-pin.test.js`
Expected: PASS, all tests (AC1.1, AC2.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/harness-refusal.js tools/upstream-drift/manifest.yml docs/hooks.md tests/hooks-harness-refusal.test.js
git commit -m "Anchor HARNESS_ISOLATION_REFUSAL_RE at the start of error — quoted refusal text no longer logs a wd-guard-refusal" -m "refs #4523"
```

### Task 2: Keep the Bash prefilter's signature check consistent with the matcher

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js` (the `require('./harness-refusal')` line, the comment above `failureCarriesRefusal`, `failureCarriesRefusal`, and its one call in `earlyGate`)
- Test: `tests/hooks-harness-refusal.test.js`

**Interfaces:**
- Consumes: `SESSION_NOUN`, `AGENT_NOUN`, `REFUSAL_SIGNATURES` from `./harness-refusal` (all exported already).
- Produces: `failureCarriesRefusal(input) -> boolean`, internal and not exported. It returns true only when `input.error` is a string that `startsWith(SESSION_NOUN)` or `startsWith(AGENT_NOUN)` and `includes` one of `REFUSAL_SIGNATURES`. Otherwise it returns false. The raw-payload substring branch is removed: a parse failure leaves the handler with nothing to act on, so it skips, and a JSON-escaped spelling is decoded in `input.error`. `earlyGate` calls `failureCarriesRefusal(input)` and keeps its `try { … } catch { carries = true; }` fail-open.

- [ ] **Step 1: Write the failing test** in `tests/hooks-harness-refusal.test.js`
  - Add `test('AC1.1: bash-prefilter earlyGate skips a failure whose error quotes a refusal mid-text', …)`. Reuse the existing test's `gate` helper shape (`earlyGate('post-tool-use-failure', () => JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'x' }, error }))`). For each `[name, text]` of `FIXTURES`, assert `gate(quoteMidText(text)).skip === true` (with `name` as the message).
  - In the same test, also assert `gate(editToolText).skip === true`, where `editToolText` is the noun-first Edit-tool refusal the non-refusals test already uses (hoist it to module scope). Only the signature check decides that input, so deleting the signature check turns this assertion red, and deleting the `startsWith` check turns the quoted-mid-text assertions red.
  - Leave `bash-prefilter earlyGate passes every refusal template to the handler`, including its `Refusing` escaped-payload assertion, unchanged. It is the positive partner for both guards.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/hooks-harness-refusal.test.js`
Expected: FAIL. The new test fails (`skip` is `false`, because the raw payload carries a signature).

- [ ] **Step 3: Implement `failureCarriesRefusal(input)`** as the Interfaces block states. Widen the destructure to `const { SESSION_NOUN, AGENT_NOUN, REFUSAL_SIGNATURES } = require('./harness-refusal');`. Rewrite the comment above the function so it says the gate mirrors the matcher's start anchor (#4523): `error` must begin with a noun and carry a signature. Drop the "raw payload OR the parsed `error`" sentence, and keep "Unparseable input skips: the handler does nothing with it either."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-harness-refusal.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/bash-prefilter.js tests/hooks-harness-refusal.test.js
git commit -m "Gate the failure prefilter on a noun-first error — keeps bash-prefilter consistent with the anchored matcher" -m "refs #4523"
```

## Spec coverage

| Spec item | Where |
|---|---|
| Deliverable 1 (measure, record in manifest) | Measurement section above; Task 1 Step 3 (manifest comment and module header) |
| Deliverable 2 (anchor, or bound and say why) | Task 1 |
| Deliverable 3 (prefilter consistent) | Task 2 |
| AC1.1 | Task 1 Step 1 (classifyRefusal and post-tool-use-failure), Task 2 Step 1 (prefilter) |
| AC2.1 | existing per-template tests, kept unchanged in both tasks |
| AC3.1 | `npm test` in /build Common Step 5 |
