# Settle 3 digest findings in _shared (#4810) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two prose contradictions in `plugin/skills/_shared/` and close out the third finding, with each fix pinned so the same contradiction cannot come back.

**Architecture:** Each fix is a sentence-level edit to a shared contract, plus one `node --test` assertion in the suite that already pins that file. Deliverable 2 (the `pr-early-run-lifecycle.md` #4580/#3887 rebind restatement) is closed out, not edited. The orchestrator posts that close-out reason on #4810 (see "Close-out", below the tasks). No implementer task touches that file.

**Tech Stack:** Markdown skill prose; `node --test` (built-in runner, `node:assert/strict`).

**Spec:** `.claude-tweaks/pipelines/2026-11-01T210352-record-4810/work/4810-spec.md` (materialized from GitHub issue #4810)

## Global Constraints

- Touch only the files each task names. Do not reformat adjacent prose or reflow untouched lines.
- Commit messages follow `{Verb} {what} — {detail}` and carry `refs #4810`, never `closes`/`fixes`.
- Run only the suite each task names. The full suite runs centrally after the build, not inside a task.
- Both target files stay well under the 52,500-byte `RAIL_BYTES` read rail: `multi-agent-coordination.md` is 14,203 B and `auto-decision-log.md` is 28,924 B. Each edit adds under 400 B.

## Review Focus

1. A reader who scans Mode 2's Auto-resolution paragraph without the table must not conclude that `unconfirmed` or `contested` lands as AUTO. The rewritten sentence names each outcome next to its status (Task 1's test pins this).
2. A writer who passes `--reversibility n/a` on an AUTO line must find it legal in the schema, because it is already the CLI's default (`tests/bin-lib/log-decision/cli.test.js`'s first test writes `- AUTO … Reversibility: n/a.`). Task 2's test pins the doc's vocabulary equal to the CLI's live vocabulary.
3. The two line templates (`- {STATUS} {HH:MM:SS} — …`, with and without the lever suffix) must list the same values as the table row. Otherwise one copy drifts while the other is fixed. Task 2's test covers every such template line.
4. `auto-mode-card.md:50` and `auto-mode-contract.md:271` keep `Reversibility: {high|med|low}`, and that is intentional. Each is the template for one specific "applied {value}" line, a mutation that always carries a real reversibility. They are not the canonical enum. Neither task edits them.
5. The go-red controls must actually go red. Each test step names the mutation and the control that proves it changed the text.

---

### Task 1: Make Mode 2's Auto-resolution sentence agree with its table

**Files:**
- Modify: `plugin/skills/_shared/multi-agent-coordination.md:127-129` (Mode 2 → `### Auto-resolution`)
- Test: `tests/multi-agent-coordination.test.js` (append)

**Interfaces:**
- Consumes: nothing from Task 2.
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing test** (append to `tests/multi-agent-coordination.test.js`, reusing that file's existing `fs`/`path`/`assert` imports, and reading the doc the way the file already does if it has a helper for it)

Add a helper `assertMode2AutoResolutionMatchesTable(text)`:
- Slice `text` from `## Mode 2 — Debate` to `## Mode 3`.
- Within that slice, take the `### Comparison rule` table rows that match `` /^\| .+ \| .+ \| `(\w+)` \| (AUTO|STAGED) \|$/m ``, giving the pairs `confirmed→AUTO`, `unconfirmed→STAGED` and `contested→STAGED`. Assert exactly 3 pairs.
- Take the paragraph between `### Auto-resolution` and the next `###` heading in that slice.
- For each pair, assert that the paragraph contains `` `{outcome}` `` and that the outcome's status word appears in the same sentence. Split sentences on `. ` for this check.
- Assert that the paragraph does not match `/all three outcomes auto-resolve/i`.
- Assert that the paragraph still contains `ask the user inline`.

Tests:
- `test('AC1.1: Mode 2 Auto-resolution names each outcome with the status its table gives', …)` calls the helper on the live file.
- `test('go-red: Mode 2 Auto-resolution check fails on the pre-#4810 sentence', …)` replaces the live paragraph body with `All three outcomes auto-resolve. No "ask the user inline."`. It first asserts `notStrictEqual` against the live text (the control), then `assert.throws` on the helper.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/multi-agent-coordination.test.js`
Expected: FAIL. `AC1.1` fails because the live paragraph still reads `All three outcomes auto-resolve.` The go-red test passes.

- [ ] **Step 3: Implement.** Replace line 129, `All three outcomes auto-resolve. No "ask the user inline."`, with one paragraph in the style of Mode 1's closing sentence (line 60):

`No outcome is "ask the user inline." A `confirmed` outcome logs AUTO. An `unconfirmed` or `contested` outcome logs STAGED and goes to the Review Console, which is the user-facing gate (see Anti-Patterns).`

Exact copy is fixed by this plan. Keep the backticks around the three outcome names.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/multi-agent-coordination.test.js`
Expected: PASS, every test (including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/multi-agent-coordination.md tests/multi-agent-coordination.test.js
git commit -m "Align Mode 2 auto-resolution sentence with its table — only confirmed logs AUTO

refs #4810"
```

---

### Task 2: List `n/a` in the decision-log reversibility vocabulary

**Files:**
- Modify: `plugin/skills/_shared/auto-decision-log.md:92` (line template), `:102` (`Reversibility` table row), `:119` (lever-suffixed line template)
- Test: `tests/bin-lib/log-decision/cli.test.js` (append; it already imports `run` from `plugin/bin/log-decision`)

**Interfaces:**
- Consumes: `run(argv, deps)` from `plugin/bin/log-decision.js`. With `--reversibility bogus` it exits non-zero and writes `--reversibility must be one of high|med|low|n/a, optionally followed by " (qualifier)"` to stderr. That list is built from the CLI's `REVERSIBILITY` constant, so the test reads the live vocabulary without changing any code.
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing test** (append to `tests/bin-lib/log-decision/cli.test.js`)

Helpers:
- `cliReversibility()`: call `run(['--run', runDir, '--status', 'AUTO', '--text', 'x', '--reversibility', 'bogus'], deps(main, out))` on a `fixture()`. Parse stderr with `/must be one of ([^,]+),/` and split on `|`. Assert that it returns `['high','med','low','n/a']` in some order. Do not hard-code the list; derive it from stderr.
- `assertDocVocabulary(docText, vocab)`:
  - Find the table row matching `` /^\| Reversibility \| yes \| (.+?) — /m ``. Collect its backticked tokens with `` /`([^`]+)`/g ``. Assert that the sorted tokens deep-equal the sorted `vocab`.
  - Find every line starting `- {STATUS} {HH:MM:SS}`. Assert there are at least 2. For each line, read the `Reversibility: \{([^}]+)\}` group, split it on `|`, and assert that the sorted values deep-equal the sorted `vocab`.

Tests:
- `test('AC1.1: auto-decision-log.md lists exactly the reversibility values log-decision.js accepts', …)` reads `plugin/skills/_shared/auto-decision-log.md` live.
- `test('go-red: the vocabulary pin fails when n/a is dropped from the doc', …)` makes two mutations of the live doc:
  - The first removes `` / `n/a` `` from the table row.
  - The second replaces `{high|med|low|n/a}` with `{high|med|low}` on the first template line only.
  
  For each mutation, assert `notStrictEqual` against the live text (the control), then `assert.throws` on `assertDocVocabulary`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/log-decision/cli.test.js`
Expected: FAIL. `AC1.1` fails because the doc row lists only `high`/`med`/`low` and both templates read `{high|med|low}`. The go-red test also fails, because its mutations are no-ops against the unfixed doc and the control `notStrictEqual` trips. Both pass after Step 3.

- [ ] **Step 3: Implement**, with this exact copy:
  - Lines 92 and 119: `Reversibility: {high|med|low}` → `Reversibility: {high|med|low|n/a}`. Leave the rest of each line byte-identical.
  - Line 102 becomes:
    `| Reversibility | yes | `high` / `med` / `low` / `n/a` — drives Review Console sort order. `n/a` means nothing to revert: always on SCANNED, REFUSED, SKIP, and FAILED entries, and on an AUTO entry that changed nothing revertible (a detection, a dispatch-time model selection, a ledger creation). It is `log-decision.js`'s default when `--reversibility` is omitted |`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/bin-lib/log-decision/cli.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/auto-decision-log.md tests/bin-lib/log-decision/cli.test.js
git commit -m "List n/a in the decision-log reversibility vocabulary — AUTO lines use it and log-decision.js defaults to it

refs #4810"
```

---

## Close-out (orchestrator, not a dispatched task)

Deliverable 2 (`plugin/skills/_shared/pr-early-run-lifecycle.md`'s **Rebind a reused body (#4580)** paragraph restating **Rebind a retry's body (#3887)**) is closed out unchanged, for these reasons:

- The two paragraphs share about three sentences of mechanics: the compose step, `gh pr edit --body-file`, and the MCP fallback.
- They differ in trigger. #4580 rebinds only when the reused body names another run, and leaves a marker-less body alone. #3887 rebinds unconditionally after a `prior-attempt` adoption.
- They also differ in their AUTO and SKIP log lines (`rebound reused PR` vs `rebound reopened PR`).
- `tests/dispatch-retry-prior-attempt-conformance.test.js` deliberately pins each paragraph as self-contained: both log lines, the Step 3 compose caveat, and the MCP write inside the #4580 paragraph.
- The code is already single-sourced: one `rebind(number, kind)` in `plugin/bin/lib/flow/pr-early-open.js`.

Merging the prose would save a few hundred bytes and turn a self-contained contract into a cross-reference hop. The orchestrator posts this reason as a comment on #4810, which satisfies the "closed out with its reason recorded on this record" clause of AC1.

AC2 ("Each promoted entry line in #1426 carries this record's ref") is already satisfied. Digest comments 6540311142 and 6545541673 end all three entry lines with `→ #4810`. Nothing to do.

## Self-review

- **Spec coverage:**
  - Deliverable 1 → Task 1.
  - Deliverable 3 → Task 2.
  - Deliverable 2 → Close-out.
  - AC1 → Tasks 1–2 plus the Close-out comment.
  - AC2 → already satisfied (verified above).
- **Placeholders:** none.
- **Proportion:** two one-sentence edits, each with one pin and a go-red control.
