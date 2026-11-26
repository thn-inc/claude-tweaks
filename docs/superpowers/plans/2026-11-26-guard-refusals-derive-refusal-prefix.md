# Derive the guard-refusals tools' refusal prefix from REFUSAL_SIGNATURES (#4524) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tools/guard-refusals/transcripts.js` and `tools/guard-refusals/trace.js` find a harness refusal's tail by searching for each entry of `REFUSAL_SIGNATURES` (from `plugin/bin/lib/hooks/harness-refusal.js`) instead of the hard-coded `'Refusing to run'` literal.

**Architecture:** Both tools already `require` `harness-refusal.js`. They destructure `REFUSAL_SIGNATURES` at load time and test `REFUSAL_SIGNATURES.some(...)` (transcripts) or take the earliest index of any signature (trace). `harness-refusal.js` gets a comment-only update naming the two tools among its derivers. A new test swaps a widened `REFUSAL_SIGNATURES` into `require.cache` and then loads the tools fresh, so the tools really read the exported list.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T120946-record-4524/work/4524-spec.md`

## Global Constraints

- `harness-refusal.js` "Requires nothing, by contract: bash-prefilter.js loads it on every failed Bash call, so any require here moves cost onto each of them." (from the module's own header). The change there is comment-only. It adds no require and no export.
- Acceptance command, run against the pre-change tree on 2026-11-26 (absence-grep control, per plan-authoring-checks): `grep -n -F "'Refusing to run'" tools/guard-refusals/transcripts.js tools/guard-refusals/trace.js` matched `trace.js:64` and `transcripts.js:39` (the spec's lines 31/49 have since shifted) and exited 0. After the change it must print nothing and exit 1.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing project skills: `upstream-repin` names `REFUSAL_FRAGMENTS` ("Change a fragment there and in the manifest in the same commit"). No fragment changes here, so it does not apply. No other `.claude/skills/` rule names these files.
- Commit messages use `refs #4524`, never `closes`/`fixes`.

## Review Focus

1. A transcript whose refusal text ends `Refusing to run it there` (the existing `THERE_ID` fixture) must still classify as `harness-command`, and `clauseOf` must still cut at `Refusing to run`. The existing suites `tests/guard-refusals/transcripts.test.js` and `trace.test.js` pin this and must stay green.
2. A signature that does not start with `Refusing to run` must be honoured by both tools. The new test covers this.
3. A result that only quotes the isolation clause, with no signature after it, must stay unclassified. The existing quote-file test covers this.

---

### Task 1: Derive the refusal tail from REFUSAL_SIGNATURES in both tools

**Role:** integration

**Files:**
- Modify: `tools/guard-refusals/transcripts.js` (drop `REFUSAL_TAIL`, line 39. `classifyGuard` at about line 155 tests `REFUSAL_SIGNATURES.some((s) => text.indexOf(s, after) !== -1)`. The header comment at line 11 says the text holds ISOLATION_CLAUSE "and then one of REFUSAL_SIGNATURES")
- Modify: `tools/guard-refusals/trace.js` (`clauseOf`, lines 59-66: `end` is the smallest non-negative `text.indexOf(sig, start)` over `REFUSAL_SIGNATURES`, or -1 when none occurs. The comment at line 59 is updated to name REFUSAL_SIGNATURES. Add `const { REFUSAL_SIGNATURES } = require('../../plugin/bin/lib/hooks/harness-refusal');`)
- Modify: `plugin/bin/lib/hooks/harness-refusal.js` (header comment only: the "derive from it" sentence also names `tools/guard-refusals/transcripts.js` and `trace.js` (the signatures))
- Test: `tests/guard-refusals/refusal-signatures-derivation.test.js` (Create)

**Interfaces:**
- Consumes: `REFUSAL_SIGNATURES` (a frozen string array) and `ISOLATION_CLAUSE` from `plugin/bin/lib/hooks/harness-refusal.js`. `scanStore({ projectsDir, since, until })` from transcripts.js. `classifyReason(text)` from trace.js. `writeStore`, `use`, `result`, `WINDOW` from `tests/helpers/guard-refusals-store.js` (read that helper for their exact signatures).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test** `tests/guard-refusals/refusal-signatures-derivation.test.js`. Helper `loadWithSignatures(extra)`:
  1. Resolve the paths of harness-refusal.js, trace.js and transcripts.js.
  2. Delete the three from `require.cache`.
  3. Require harness-refusal.js. Overwrite its cache entry's `exports` with `{ ...orig, REFUSAL_SIGNATURES: Object.freeze([...orig.REFUSAL_SIGNATURES, extra]) }`.
  4. Require trace.js and transcripts.js fresh and return them.
  5. In `t.after`/`finally`, delete all three from `require.cache` again so other tests get pristine modules.

  Use `SYNTH = 'Declining to execute it'`, which lacks "Refusing to run".
  - Test `transcripts: a refusal ending in a signature without the shared prefix is counted`:
    1. Build a one-session store with `writeStore` holding a Bash `use` and an `is_error` `result` whose text is `` `This session${ISOLATION_CLAUSE}/wt, but this command is too complex to verify that it stays inside the worktree. ${SYNTH}.` ``.
    2. Call `scanStore({ projectsDir, ...WINDOW })` from the reloaded module.
    3. Assert `refusals.length === 1` and that the row's guard is `harness-command`.
    4. Also assert that the pristine module (the plain `require` of transcripts.js, loaded before the swap) counts 0 for the same store, so the test shows that the derivation, not the fixture, does the work.
  - Test `trace: clauseOf cuts at a signature without the shared prefix`: with the reloaded trace.js, `classifyReason` of `` `This session${ISOLATION_CLAUSE}/wt, but this command is too complex to verify that it stays inside the worktree. ${SYNTH}. names git in a form too complex` `` returns `'too-complex'`. Without the cut, the trailing `names git in a form too complex` text would classify `names-git`. Also assert that the pristine trace.js returns `'names-git'` for the same text.
- [ ] **Step 2: Run** `node --test tests/guard-refusals/refusal-signatures-derivation.test.js`. Expected: FAIL. Both reloaded-module assertions fail, because the literal `'Refusing to run'` ignores the swapped list.
- [ ] **Step 3: Implement** the three file edits listed in Files.
- [ ] **Step 4: Run** `node --test tests/guard-refusals/` (expected: all PASS), then `grep -n -F "'Refusing to run'" tools/guard-refusals/transcripts.js tools/guard-refusals/trace.js` (expected: no output, exit 1).
- [ ] **Step 5: Commit** the four files with message `Derive the guard-refusals refusal tail from REFUSAL_SIGNATURES — refs #4524`.

---

## Self-review

- **Spec coverage:** Deliverable 1 is Step 3. Deliverable 2 and AC1 are Step 1. AC2 (the grep) is Step 4. AC3 (`npm test`) is /build Common Step 5.
- **Placeholders:** none.
