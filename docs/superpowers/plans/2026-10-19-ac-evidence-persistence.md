# AC-Evidence Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An acceptance criterion verified only by a scratch (uncommitted) check leaves its result in the run directory, and review cites that result instead of re-running the check.

**Architecture:** Prose-only change in two skill sub-files. `/build`'s plan-authoring checks gain a rule that routes a scratch check's result into one `decisions.md` entry through the existing sanctioned writer (`bin/log-decision.js --step "AC evidence"`), plus an `$PIPELINE_RUN_DIR/evidence/` log for long output. `/review`'s Step 1 Acceptance Criteria check reads that entry before declaring a criterion `not met`. Each change is pinned by a prose test, following the neighboring `tests/plan-authoring-*-prose.test.js` shape.

**Tech Stack:** Markdown skill prose, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T192635-record-3079/work/3079-spec.md` (record #3079)

Scope keywords: AC evidence

Waived AC3.1: verified by Task 3 Step 1's `git diff` + `wc -c` command, not a committed test — a no-change assertion on a file this plan does not touch.
Waived AC4.1: verified by Task 3 Step 3's full `npm test` run, not a committed test.

## Global Constraints

- `plugin/skills/build/SKILL.md` is not modified (spec Deliverable 3).
- The governing size limit is `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). The spec's 46,080-B figure is stale (logged as a premise reversal in `decisions.md`). Today: `plan-authoring-checks.md` 40,799 B, `code-mode-steps.md` 44,148 B, `build/SKILL.md` 47,644 B.
- The `decisions.md` entry is written only through `bin/log-decision.js`. Its observed line shape is `- AUTO {hh:mm:ss} — AC evidence: {text}. Reversibility: n/a.`, the same shape as every `--step` entry already in this run's `decisions.md`.
- Evidence logs live under `$PIPELINE_RUN_DIR/evidence/` as an absolute path, never a relative one (`_shared/pipeline-run-dir.md`). Use a `.txt` extension: the harness denies `.log` paths in Bash.
- Every edit to a `plugin/skills/**` file runs the full suite before merge, because byte-pinned conformance tests cover skill prose.

## Review Focus

1. **Design-mode build with no run directory.** `$PIPELINE_RUN_DIR` is unset, so there is no `decisions.md` to write to. The check must say the result stays in the handoff in that case rather than imply an impossible write. Pinned in Task 1's test ("no run directory").
2. **Standalone review (`$PIPELINE_RUN_DIR` unset).** Review behavior stays unchanged. Pinned in Task 2's test.
3. **Stale or inconsistent entry.** A recorded result whose command shape no longer matches the diff must not be blindly trusted. Review may still re-run it. Pinned in Task 2's test ("evidence, not proof").
4. **The two rules read as contradicting.** "Scratch checks stay scratch" (build/SKILL.md) versus "record the result". The check must say the first governs the code and the second the result. Pinned in Task 1's test.
5. **A subagent writes the evidence log with the Write tool from a worktree session.** That write is refused by cross-checkout pinning. The check names a plain Bash redirect as the write mechanism. Pinned in Task 1's test.

---

### Task 1: AC-evidence persistence check in plan-authoring-checks.md

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md` (insert one paragraph directly after the `**Acceptance-criterion clause-id check:**` paragraph, currently line 67)
- Test: `tests/plan-authoring-ac-evidence-prose.test.js` (create)

**Interfaces:**
- Produces: the bold label `**AC-evidence persistence check:**` and the step name `AC evidence`. Task 2's review prose cites both.

- [ ] **Step 1: Write the failing test** `tests/plan-authoring-ac-evidence-prose.test.js`, modeled on `tests/plan-authoring-retirement-sweep-prose.test.js`: read the live file, split on blank lines, take the one paragraph starting with `LABEL = '**AC-evidence persistence check:**'`, and assert in one `assertAcEvidenceCheck(text)` function that the paragraph:
  - occurs exactly once;
  - includes `scratch (uncommitted) check`;
  - includes `never a conversational build handoff`;
  - includes the command literal `` `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "AC evidence"` ``;
  - includes each of `the criterion it covers`, `the exact command shape`, `the pass/fail counts`;
  - includes `$PIPELINE_RUN_DIR/evidence/` and `cites that path in the same entry`;
  - includes `plain Bash redirect` (Review Focus 5);
  - includes `governs whether a check's *code* is committed, not whether its *result* is recorded` (Review Focus 4);
  - includes `no run directory` (Review Focus 1);
  - includes `review/code-mode-steps.md` and `#3079`.

  Tests:
  - `test('AC1.1 (#3079): plan-authoring-checks.md carries the AC-evidence persistence check', …)` — the positive test.
  - `test('AC1.1 (#3079): negative control — the pre-change file (paragraph absent) fails the pin', …)` — the paragraph is filtered out, `assert.notStrictEqual` proves the control changed the text, then `assert.throws`.
  - `test('AC1.1 (#3079): negative control — rewording the code-vs-result distinction fails the pin', …)` — replace the governs-phrase with `governs both a check's code and its result`, `assert.notStrictEqual`, then `assert.throws`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plan-authoring-ac-evidence-prose.test.js`
Expected: FAIL. The positive test reports `expected exactly one AC-evidence persistence check paragraph` (0 found).

- [ ] **Step 3: Insert the paragraph.** The spec fixes this copy. Use it verbatim, as one paragraph with no internal line breaks:

```
**AC-evidence persistence check:** when a plan task verifies an acceptance criterion only with a scratch (uncommitted) check — an audit script, a one-off probe, a rendered-page sweep — the plan names that check's run-dir evidence destination, never a conversational build handoff. The destination is one `decisions.md` entry, written via `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "AC evidence"` with a `--text` that carries the criterion it covers (its `AC{item}` id and wording), the exact command shape, and the pass/fail counts. When the check's output is too long for one line, the plan also writes the full log to `$PIPELINE_RUN_DIR/evidence/{name}.txt` — an absolute path under the run directory, never a relative one (`_shared/pipeline-run-dir.md`), written with a plain Bash redirect, since a worktree session's Write tool is refused there — and cites that path in the same entry. "Scratch checks stay scratch" governs whether a check's *code* is committed, not whether its *result* is recorded: the check's code still stays uncommitted, and only its result goes to the run directory. Under `/claude-tweaks:dispatch`'s two-call split, `build,test` and `review,polish,wrap-up` are separate Task calls that share only the run directory, so a result routed into the handoff is gone before review checks the criterion; `review/code-mode-steps.md` Step 1's Acceptance Criteria check reads these entries instead of re-running the check. A build with no run directory (design mode) reports the result in the handoff as before. #3079's incident: an AC of "a rendered contrast audit over the main routes reports 0 failures" was met by a scratch audit in call 1 whose `decisions.md` named "the AC2 rendered audit" with no result, counts, or log path, so call 2 re-ran the whole audit (68 page renders plus controls).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plan-authoring-ac-evidence-prose.test.js`
Expected: PASS, 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/plan-authoring-checks.md tests/plan-authoring-ac-evidence-prose.test.js
git commit -m "Add AC-evidence persistence plan-authoring check — refs #3079"
```

### Task 2: Review cites AC-evidence entries in Step 1 check 2

**Files:**
- Modify: `plugin/skills/review/code-mode-steps.md:31` (Step 1, item 2 "Acceptance Criteria". Keep its existing first two sentences byte-identical and append after them.)
- Test: `tests/review-ac-evidence-citation-prose.test.js` (create)

**Interfaces:**
- Consumes: Task 1's label `**AC-evidence persistence check:**` (cited by name as "AC-evidence persistence check") and step name `AC evidence`.

- [ ] **Step 1: Write the failing test** `tests/review-ac-evidence-citation-prose.test.js`: read the live `plugin/skills/review/code-mode-steps.md`, take the single line starting with `2. **Acceptance Criteria**`, and in one `assertAcEvidenceCitation(line)` function assert that the line:
  - includes `Before marking a criterion \`not met\` for lack of code or test evidence`;
  - includes `` an `AC evidence` entry naming it `` and `decisions.md`;
  - includes `cite it as the criterion's evidence instead of re-executing the check`;
  - includes `AC-evidence persistence check`;
  - includes `evidence, not proof` (Review Focus 3);
  - includes `When \`$PIPELINE_RUN_DIR\` is unset (standalone review), this check is unchanged` (Review Focus 2);
  - still includes `determine whether it's verifiable from the code and tests` (the original sentence survives).

  Tests:
  - `test('AC2.1 (#3079): check 2 reads decisions.md for an AC evidence entry and cites it rather than re-running', …)`
  - `test('AC2.2 (#3079): check 2 names the unset-$PIPELINE_RUN_DIR standalone case as unchanged', …)`, which asserts that phrase specifically.
  - `test('AC2.1 (#3079): negative control — the pre-change line fails the pin', …)` — run against the frozen pre-change line ``2. **Acceptance Criteria** — for each criterion, determine whether it's verifiable from the code and tests. Mark as `met`, `partially met`, or `not met`.`` and expect `assert.throws`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-ac-evidence-citation-prose.test.js`
Expected: FAIL. The two positive tests fail on the `not met` for lack of code assertion.

- [ ] **Step 3: Append to item 2.** Use this copy verbatim, on the same line, after `` Mark as `met`, `partially met`, or `not met`. ``:

```
Before marking a criterion `not met` for lack of code or test evidence, when `$PIPELINE_RUN_DIR` is set, read the run's `decisions.md` for an `AC evidence` entry naming it — `/claude-tweaks:build`'s AC-evidence persistence check (`build/plan-authoring-checks.md`) writes one per criterion a scratch check verified, carrying the criterion, the exact command shape, the pass/fail counts, and an `evidence/` log path when the output was long. When one exists, cite it as the criterion's evidence instead of re-executing the check. A recorded result is evidence, not proof: an entry that looks inconsistent with the diff (a stale command shape, a criterion the diff has since changed, non-zero failure counts) may still be re-run — this removes the forced re-run, it does not forbid one. When `$PIPELINE_RUN_DIR` is unset (standalone review), this check is unchanged.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/review-ac-evidence-citation-prose.test.js tests/review-risk-marker-verification.test.js`
Expected: PASS, 0 failures. The risk-marker suite pins neighboring Step 1 prose and must stay green.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/code-mode-steps.md tests/review-ac-evidence-citation-prose.test.js
git commit -m "Teach review Step 1 to cite AC-evidence entries — refs #3079"
```

### Task 3: Size and full-suite verification (AC3.1, AC3.2, AC4.1)

**Files:** none modified. This task is verification only, and the controller runs it after Tasks 1-2.

- [ ] **Step 1: AC3.1 — `build/SKILL.md` unchanged and under the rail**

Run: `git diff --stat origin/main -- plugin/skills/build/SKILL.md` then `wc -c plugin/skills/build/SKILL.md`
Expected: empty diff, and a byte count of at most 52,500.

- [ ] **Step 2: AC3.2 — context-cost test passes**

Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures. This also covers the composed bundles that include either edited sub-file.

- [ ] **Step 3: AC4.1 — full suite**

Run: `npm test > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/08dace7f-159d-4e40-ba1f-eb8c390df12c/scratchpad/npm-test.txt 2>&1; echo "exit=$?"`, then read the `# pass` / `# fail` tail of that file.
Expected: `exit=0`, `# fail 0`.
