# Review Tiebreak Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every review finding still `unconfirmed` or `contested` after the earlier passes gets one independent Capable agent verdict, settled by the merged `#3945` resolver, at every effort tier and in every mode.

**Architecture:** A new lazy-loaded sub-file, `plugin/skills/review/step3-tiebreak.md`, runs as Step 3.7, after the earlier passes and before Step 3 Routing. It writes `review-findings.json` first, then dispatches tiebreak agents in waves. Each reply goes through `review-coordination.js resolve-tiebreak`, and the result is logged with `log-decision.js`. The other review files only point at it, and stale statements are corrected. Prose-conformance tests pin every acceptance criterion.

**Tech Stack:** Markdown skill files, Node 18+ `node:test` conformance tests, existing CLIs `plugin/bin/review-coordination.js`, `plugin/bin/log-decision.js`, `plugin/bin/session-tmp-resolve.js`, `plugin/bin/resolve-profile.js`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T110840-spec-3926-3817-3945-3947/spec-3947/work/3947-spec.md`

## Global Constraints

- Read `docs/skill-authoring.md` before editing any `plugin/skills/**/*.md`. A skill reference inside actionable instruction text uses the fully-qualified `/claude-tweaks:{skill}` form.
- Resolver facts are cited from the merged code, never restated. These are: the outcome vocabulary (`confirmed`/`drop`/`digest`/`console`), the `tiebreak:{id}` marker, `logStatus`/`logStep`/`logText`, the kinds `unconfirmed|contested`, and the artifact name `review-findings.json`. Name `plugin/bin/lib/tiebreak.js` and the `review-coordination.js` subcommands, and nothing more.
- `plugin/skills/review/step3-lens-dispatch.md` is 51,184 B and must end at or below 51,584 B (≤400 B net growth), under `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`).
- `plugin/skills/review/code-mode-steps.md` is 48,363 B and must stay under `RAIL_BYTES`.
- The tiebreak fan-out uses `[Use: Capable]`, resolved with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable --run-dir "$PIPELINE_RUN_DIR"`. `Frontier` never appears in it.
- The tiebreak agent sees only this allowlist: the claim text, the severity, the `path:line`, the diff scope, and, for a contested finding, each position as a one-line claim plus a severity label. It never sees the reporting agent's evidence or reasoning.
- Commits: `{Verb} {what} — {detail}`, ending `refs #3947` and the `Claude-Session: https://claude.ai/code/session_01FpdYVraJkdUQ3be3TGkufJ` trailer. Never write "closes".
- Build rulings, logged in `spec-3947/decisions.md`:
  - (R1) The new digest value is `Defer-reason: tiebreak-cant-tell`. It sits in `_shared/materiality-floor.md` beside `direct-filing-sweep`, not in `DEFER_REASONS`.
  - (R2) A dispatched reviewer dispatches the tiebreak agents itself, under `_shared/subagent-dispatch-core.md`'s nested-children rule. The probe returned `NESTED-OK`.
  - (R3) Tiebreak evidence must quote the whole cited source line (carried from the `#3945` review).
  - (R4) Earlier passes' STAGED lines stay as written. A tiebreak `confirmed` line supersedes its STAGED line through `console/resolve.js`'s `#3772` matcher. `console/resolve.js` is unchanged.

## Review Focus

1. A reply quoting a single token (`const`) verifies under the resolver's ±5 window. The prompt must demand the whole cited line, which Task 1's template test pins.
2. An empty, failed, timed-out or non-`DONE` tiebreak dispatch must still produce exactly one verdict line, never a silent gap. Task 1's test pins the "passed as an empty reply" rule.
3. A contested finding is judged at the higher position severity, and its positions carry no reasoning. Task 1's test pins the position line shape `- {one-line claim} ({severity})`.
4. A standalone `/review` (no run dir) must write no artifact, no `decisions.md` line, and nothing staged. Task 1's test pins the standalone paragraph.
5. A large finding count must not become one unbounded fan-out. Task 1's test pins the named wave size (8).

---

### Task 1: The tiebreak step file and its Step 3.7 wiring

**Files:**
- Create: `plugin/skills/review/step3-tiebreak.md`
- Modify: `plugin/skills/review/code-mode-steps.md`:
  - the Step 3.5 & 3.6 "Skip all three entirely … proceed directly to Step 3 Routing" sentence
  - the "After Step 3.5, every finding has a final bucket" paragraph
  - the "Step 3 Routing — Code Review Findings" paragraph's "`unconfirmed` and `contested` findings bypass Step 3 Routing" sentence
  - a new `### Step 3.7: Tiebreak (every tier)` heading inserted directly before `### Step 3 Routing — Code Review Findings`
- Create test: `tests/review-tiebreak-step-conformance.test.js`

**Interfaces:**
- Consumes the merged resolver. This task never changes it.
  - `review-coordination.js write-findings <run-dir> <findings.json>`
  - `review-coordination.js resolve-tiebreak <finding.json> <reply-file> [--root <dir>]`, which prints JSON with `outcome`, `severity`, `recommendation`, `logStatus`, `logStep`, `logText`, `listInConsole`.
  - `log-decision.js --run --status --step --text --reversibility high --section /review`
  - From `plugin/bin/lib/tiebreak.js`: `buildFindingsArtifact`, `resolveTiebreak`, `checkTiebreakCoverage`, `findingId`. From `plugin/bin/lib/log-decision/append.js`: `formatEntry`.
- Produces:
  - The heading anchors later tasks point at: `## Placement`, `## Dispatch`, `## Resolve and act`, `## Standalone review`, `## Dispatched reviewer`.
  - The test helpers `missingFactsOf` and `assertEachPatternGoesRed`, copied in the shape `tests/review-dispatched-reviewer-degrade-conformance.test.js` uses. Tasks 2–7 reuse them from this file.

- [ ] **Step 1: Write the failing tests** in `tests/review-tiebreak-step-conformance.test.js`. Each pin has a go-red proof built with `assertEachPatternGoesRed` over the live text.
  - `AC1.1 the step names every effort tier and mode`. The patterns are, each as a backticked literal in the file:
    - the tiers `low`, `medium`, `high`, `xhigh`, `max`
    - the modes `auto`, `confirm`, `hybrid`, `interactive`
    - the words "standalone" and "dispatched"
  - `AC1.2 placement cites every earlier pass in order`. Inside the `## Placement` section, these appear in strictly increasing index order:
    1. `step3-lens-dispatch.md` + "absence-claim"
    2. "vacuity"
    3. `step3-cross-lens-corroboration.md`
    4. `step3-debate-and-refutation.md` + "Step 3.5"
    5. "Step 3.6"

    The go-red proof swaps two entries and asserts the order check fails.
  - `AC1.3 entry status includes both sides of a nearLocation pair`: the text matches `/nearLocation/` and `/each .*judged on its own/`.
  - `AC2.1 the dispatch prompt satisfies the subagent contract`. Taken from the fenced template block under `## Dispatch`:
    - `[Use: Capable`
    - a literal `Verdict: confirmed | refuted | cant-tell` line
    - `Evidence: {path}:{line}`
    - `Severity:`
    - `Recommendation: file | drop`
    - the trailing-`STATUS:` instruction
    - the `READ-ONLY REVIEW` line placeholder
  - `AC2.2 no Frontier in the tiebreak fan-out`: `## Dispatch` does not match `/Frontier/`. The proof injects "Frontier" and asserts the check fails.
  - `AC12.1 the prompt input is exactly the allowlist`. The template's input lines, the lines before the "Reply with" line, are exactly the field labels `Finding:`, `Severity:`, `Location:`, `Diff scope:`, `Positions:` (contested only), checked as a deep-equal list. The template does not match `/evidence|reasoning/i` inside the input lines.
  - `Review Focus`:
    - the template says the quote is the whole cited line (`/whole (cited )?source line/`)
    - `## Resolve and act` matches `/empty reply/`
    - the positions line shape is `- {one-line claim} ({severity})`
    - `## Dispatch` names a wave size of `8`
  - `AC7.1 standalone lists can't-tell ≥ medium with the recommendation and stages nothing`. `## Standalone review` matches:
    - `/medium or higher/`
    - `/recommendation/`
    - `/nothing is staged/`
    - `/no `review-findings\.json`/`
  - `AC8.1 dispatched reviewer`. `## Dispatched reviewer` matches:
    - `/nested-children rule/`
    - `/Mode: inline\./`
    - `/before .*Review Console resolves/`
    - a sentence forbidding every finding being marked can't-tell (`/never .*can't-tell .*every finding|marking every finding can't-tell is not/`)

    It must not contain `skip dispatch` (the `#3078` CARVE_OUT phrase).
  - `AC3.1 fixture: one verdict line per listed finding, nearLocation pair judged separately`.
    - Build two findings at `plugin/bin/foo.js` lines 20 and 21, with different claims and kind `unconfirmed`. Pass them through `buildFindingsArtifact` and assert two distinct ids.
    - Resolve one with a `confirmed` reply quoting the whole line 20 of a 40-line fixture reader. Resolve the other with an empty reply.
    - Render each with `formatEntry({status: r.logStatus, now, step: r.logStep, text: r.logText, reversibility: 'high'})` into a tmp dir's `decisions.md`, alongside `review-findings.json`.
    - Assert `checkTiebreakCoverage(dir).missing` is `[]`, and that each id appears in exactly one line.
    - Assert the second outcome is `digest` or `console`, never `drop`.
  - `code-mode-steps wiring`. `code-mode-steps.md`:
    - contains `### Step 3.7: Tiebreak (every tier)` before `### Step 3 Routing — Code Review Findings`
    - names `step3-tiebreak.md`
    - no longer contains "bypass Step 3 Routing — they route directly to the Wrap-Up Console"

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js`
  Expected: FAIL (ENOENT on `step3-tiebreak.md`, and the wiring assertions fail).

- [ ] **Step 3: Write `plugin/skills/review/step3-tiebreak.md`.** Sections, in this order:
  - **Opening.** One paragraph on when it is loaded: from `code-mode-steps.md` Step 3.7, at every tier and in every mode, standalone or dispatched.
  - **`## Placement`.** The five earlier passes, as an ordered list, each cited by file and section:
    1. `step3-lens-dispatch.md`'s reproduction categorisation and absence-claim ground-truth check
    2. `step3-lens-dispatch.md`'s lens 3f vacuity downgrade
    3. `step3-cross-lens-corroboration.md` (`medium`)
    4. `step3-debate-and-refutation.md` Step 3.5 debate (`high`+) and Per-Candidate Refutation (`xhigh`/`max`)
    5. Step 3.6 gap sweep

    Then the entry status: every finding still `unconfirmed` or `contested`, including both sides of a `nearLocation` pair, each judged on its own.
  - **`## Findings artifact`.** In a pipeline run, write the entry set to `review-findings.json` with `review-coordination.js write-findings "$PIPELINE_RUN_DIR" "{path}"` before any dispatch. The JSON goes through `bin/session-tmp-resolve.js` (`review-{ctx-id}-tiebreak-findings.json`). Each entry is `{lens, path, line, claim, reporterSeverity, kind, positions?}`, where kind is `unconfirmed` or `contested`. Cite `plugin/bin/lib/tiebreak.js` for the shape and do not restate it. A non-zero exit stops the step: log `STAGED … Tiebreak: findings artifact not written ({exit}).`, and the archive gate keeps the run open.
  - **`## Dispatch`.**
    - One agent per finding, in parallel waves of **8**. Wait for all agents of a wave to return before starting the next.
    - `[Use: Capable]`, resolved with the command in Global Constraints.
    - The Working Directory, Read-only Reviewer and Foreground disciplines come from the composed review-dispatch bundle, exactly as `step3-lens-dispatch.md`'s notes state. Cite them, do not restate.
    - The fenced template, inlined verbatim:
      - Input lines: `Finding:`, `Severity:`, `Location:`, `Diff scope:`, and `Positions:` with `- {one-line claim} ({severity})` lines for a contested finding.
      - Then: `Reply with exactly these lines, then your status line:`
      - `Verdict: confirmed | refuted | cant-tell`
      - `Evidence: {path}:{line} \`{the whole cited source line, verbatim}\`` (required for confirmed and refuted; the line must be within 5 of the finding's line)
      - `Severity: critical | high | medium | low | info`
      - `Recommendation: file | drop — {one-line reason}`
      - the trailing `STATUS:` instruction, in the wording `step3-debate-and-refutation.md`'s refutation template uses
      - the `READ-ONLY REVIEW` placeholder line
      - a `SCRATCH:` line
    - Never give the agent the reporting lens's evidence or reasoning. Never reuse the reporting lens agent.
  - **`## Resolve and act`.**
    - For each finding, write its JSON and the agent's reply to session-tmp files, then run `resolve-tiebreak … --root {checkout under review}`. An empty, failed, timed-out or non-`DONE` dispatch is passed as an empty reply file. The resolver makes it can't-tell, so do not restate that rule.
    - Log one line through `log-decision.js --status {logStatus} --step {logStep} --text {logText} --reversibility high --section /review`.
    - Then act on `outcome`:
      - `confirmed`: enters Step 3 Routing at the returned severity, as an input the routing table lists.
      - `drop`: logged only.
      - `digest`: one materiality-digest entry with `Defer-reason: tiebreak-cant-tell` and area `review`, written through the digest path `step3-routing.md`'s Defer bullet uses (`_shared/materiality-floor.md`'s Entry format, Dedup, and Digest URL and count surfacing). The count goes in the Step 7 summary.
      - `console`: the logged STAGED line is the decision item. Its `Recommendation:` travels in the line.
    - The R4 paragraph: the earlier STAGED low-confidence or contested line for the finding is not rewritten. A `confirmed` verdict supersedes it through `console/resolve.js`'s `#3772` matcher. Under the other outcomes the Review Console shows what it shows today, until the console sub-issue lands.
    - Any reviewer-read verdict (a Direct-verification override, or an inline fallback) goes through the same resolver, with ` Mode: inline.` appended to `logText` before logging.
  - **`## Standalone review`.**
    - With no `$PIPELINE_RUN_DIR`: no `review-findings.json` and no `decisions.md` line. The verdict lines (`logLine`) go in the review report under `### Tiebreak`.
    - Can't-tell findings of severity medium or higher are listed in the closing output with the tiebreak's recommendation. Low can't-tell findings are listed in the report only. Nothing is staged.
  - **`## Dispatched reviewer`.**
    - The R2 mechanism: the reviewer dispatches the tiebreak agents itself under `_shared/subagent-dispatch-core.md`'s nested-children rule, the same rule `step3-lens-dispatch.md`'s Foreground note gives lens dispatches.
    - The fallback ladder: (1) nested dispatch. (2) For a finding whose agent is unavailable (no `Agent` tool) or times out at that bound, the reviewer reads the live code, fills the same template, feeds its own reply to the resolver, and logs with ` Mode: inline.` (a documented loss of independence, named in a Step 7 `Tiebreak caveat:` line).
    - Marking every finding can't-tell is not an allowed fallback.
    - The invariant: every listed finding has its verdict line before the run's Review Console resolves.
    - This agrees with `#3817`'s degrade, which governs lens dispatch. Cite it.

- [ ] **Step 4: Wire Step 3.7 into `code-mode-steps.md`.**
  - Insert the heading `### Step 3.7: Tiebreak (every tier)` with one paragraph: read `step3-tiebreak.md` in this skill's directory and run it after Step 3's reproduction, Cross-Lens Corroboration and Steps 3.5–3.6, before Step 3 Routing. Only its `confirmed` results join routing.
  - Change the Step 3.5/3.6 skip sentence's target to "Step 3.7".
  - Change the "final bucket" paragraph's last sentence to say `unconfirmed` and `contested` findings go to Step 3.7.
  - Replace the routing paragraph's bypass sentence with: `unconfirmed` and `contested` findings reach routing only through Step 3.7's `confirmed` outcome.
  - Run `grep -rn` in `tests/` for each sentence you change, and update any pin in this same task.

- [ ] **Step 5: Run the tests**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/review-dispatch-composition.test.js tests/bin-lib/skill-audit/budgets.test.js`
  Expected: PASS. Then check `wc -c plugin/skills/review/code-mode-steps.md` is below 52500.

- [ ] **Step 6: Commit**
  `git add plugin/skills/review/step3-tiebreak.md plugin/skills/review/code-mode-steps.md tests/review-tiebreak-step-conformance.test.js` (plus any updated pins), then commit `Add the review tiebreak step and wire it as Step 3.7 — refs #3947`.

### Task 2: `step3-lens-dispatch.md` pointer, low-tier paragraph, Direct-verification override

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md`:
  - the `**Low-tier single-read dispatch (\`low\` only).**` paragraph
  - the `> **Direct-verification override.**` paragraph
  - one pointer sentence
- Modify test pin: `tests/review-cross-lens-corroboration-conformance.test.js` (`SINGLE_READ_RULE`)
- Test: append to `tests/review-tiebreak-step-conformance.test.js`

**Interfaces:**
- Consumes Task 1's `step3-tiebreak.md` anchors and the test helpers.
- Produces the new low-tier sentence, `Every finding a single-read agent returns enters as \`unconfirmed\` and goes to the tiebreak (\`step3-tiebreak.md\`)`, which Task 4's routing text cites.

- [ ] **Step 1: Append the failing tests.**
  - `AC4.1 low tier hands findings to the tiebreak`. The low-tier paragraph:
    - matches `/goes to the tiebreak \(`step3-tiebreak\.md`\)/`
    - does not match `/only path to `confirmed` is the Direct-verification override/`
    - does not contain `confirmed via direct verification`
  - `AC4.2 the override stays documented and emits a resolver verdict line`. The `> **Direct-verification override.**` line exists, matches `/resolve-tiebreak/` and `/Mode: inline\./`, and does not match `/the resolution path that actually confirms/`.
  - `pointer`. The file names `step3-tiebreak.md` at least twice.
  - `AC10.1 rail`. `fs.statSync(STEP3).size` is ≤ 51584 and < `RAIL_BYTES`, with `RAIL_BYTES` imported from `plugin/bin/lib/skill-audit/budgets.js`.
  - Each test gets a go-red proof.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js`
  Expected: FAIL after Step 1 (the AC4 and pointer tests fail; Task 1's tests still pass).

- [ ] **Step 3: Edit the paragraphs.**
  - **Low-tier paragraph.** Replace from "Every finding a single-read agent returns" through "routes to the Wrap-Up Console's Low-confidence subsection as usual." with the new sentence, plus this STAGED line: `STAGED {HH:MM:SS} — Single-read (low tier): lens "{lens}" finding {path}:{line} unconfirmed; handed to the tiebreak. Reversibility: high.` It keeps the word `unconfirmed`, so the console's Low-confidence classification still sees it (R4).
  - **Direct-verification override.** Keep the paragraph and its lens 3f exception sentence verbatim, since `tests/review-vacuity-evidence-conformance.test.js` pins `however it became \`unconfirmed\`` and `reading source never re-confirms it`.
    - Replace the elevation instruction with: any use of the override writes the reviewer's reading as a tiebreak reply and resolves it with `resolve-tiebreak` (`step3-tiebreak.md`'s Resolve and act, ` Mode: inline.`), so it emits the same verdict line.
    - Delete the "expect Direct-verification override to be the resolution path that actually confirms" sentence.
  - The net byte change, pointer included, is ≤ +400. Measure `wc -c` before and after.

- [ ] **Step 4: Update the pin.** In `tests/review-cross-lens-corroboration-conformance.test.js`, set `SINGLE_READ_RULE` to the new sentence. Run `grep -rn` across `tests/` for every other sentence changed in Step 3 and update each pin here.

- [ ] **Step 5: Run the tests**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/review-cross-lens-corroboration-conformance.test.js tests/review-vacuity-evidence-conformance.test.js tests/foreground-execution-instruction.test.js tests/review-dispatched-reviewer-degrade-conformance.test.js tests/session-limit-degrade-conformance.test.js tests/review-no-executable-content-skip.test.js`
  Expected: PASS. `wc -c plugin/skills/review/step3-lens-dispatch.md` ≤ 51584.

- [ ] **Step 6: Commit** `Route low-tier and direct-verification findings through the tiebreak — refs #3947`.

### Task 3: Per-Candidate Refutation through the resolver, gap-sweep hand-off

**Files:**
- Modify: `plugin/skills/review/step3-debate-and-refutation.md`:
  - the Per-Candidate Refutation intro's parallel-execution note (`refuted`/`not-refuted` verdict)
  - step 4's template
  - step 5 (Resolve)
  - the "After Step 3.5, every finding has a final bucket" paragraph
  - the Step 3.6 gap-sweep output hand-off
- Test: append to `tests/review-tiebreak-step-conformance.test.js`

**Interfaces:**
- Consumes `resolve-tiebreak` and Task 1's Resolve and act section.
- Produces the rule that a refutation `drop` counts as a tiebreak `refuted` verdict, and a refutation can't-tell joins `unconfirmed` for Step 3.7.

- [ ] **Step 1: Append the failing tests.**
  - `AC5.1 refutation template`. Step 4's fenced template contains `Verdict: confirmed | refuted | cant-tell` and `Evidence: {path}:{line}`, and no longer contains `refuted / not-refuted`.
  - `AC5.2 refutation rule`. Step 5:
    - matches `/resolve-tiebreak/`
    - matches `/`drop`.*tiebreak `refuted` verdict/`
    - matches `/can't-tell.*`unconfirmed`.*Step 3\.7|tiebreak/`
    - states that only `confirmed` and `drop` write the resolver's line
  - `gap-sweep hand-off`. The Step 3.6 section matches `/step3-tiebreak\.md/`.
  - `final bucket`. The paragraph no longer says `are already staged to the Wrap-Up Console`.
  - Each test gets a go-red proof.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js`
  Expected: FAIL after Step 1 (the AC5 tests fail).

- [ ] **Step 3: Edit the file.**
  - **Template.** It keeps "try to FALSIFY", but the reply becomes the tiebreak reply fields: `Verdict: confirmed | refuted | cant-tell`, where confirmed means the finding stands; `Evidence:` quoting the whole source line; `Severity:`; `Recommendation:`; and the `STATUS:` line.
  - **Step 5.** Feed the reply to `resolve-tiebreak` with the candidate as `{lens, path, line, claim, reporterSeverity, kind: "unconfirmed"}`. The resolver reads kind only for a contested finding's positions.
    - `confirmed`: the candidate stands. Log the resolver's line.
    - `drop`: dropped. Log the resolver's line; this counts as a tiebreak `refuted` verdict and the finding is not re-tiebroken.
    - `digest`/`console` (can't-tell, including a failed or evidence-free reply): do not log the resolver's line. Log the existing downgrade line and add the finding to `unconfirmed`, so Step 3.7 tiebreaks it and logs its one verdict line.
    - Ruling, to record in the plan's ledger note: `resolveRefutation` and the `resolve-refutation` verb stay in code, unchanged and still pinned by their tests. This pass stops citing them, because `resolve-tiebreak` already fails toward scrutiny.
  - **Gap-sweep.** Its single-source findings enter `unconfirmed` and go to `step3-tiebreak.md`.
  - **Final-bucket paragraph.** `unconfirmed` and `contested` findings go to Step 3.7 (`step3-tiebreak.md`).
  - Run `grep -rn` across `tests/` for each changed sentence and update the pins in this task.

- [ ] **Step 4: Run the tests**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/multi-agent-coordination.test.js tests/subagent-status-line-prose-conformance.test.js tests/subagent-contract-clauses.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** `Feed refutation replies to the tiebreak resolver — refs #3947`.

### Task 4: `step3-routing.md` takes tiebreak-confirmed findings

**Files:**
- Modify: `plugin/skills/review/step3-routing.md`:
  - the `## Inputs` list
  - the unconfirmed-sources bullets "No reproduction agreement" and "Low-tier single-read"
  - the `**Effort-tier surfacing.**` paragraph
  - the `xhigh`/`max` inline-surfacing paragraphs
- Test: append to `tests/review-tiebreak-step-conformance.test.js`

**Interfaces:** Consumes Task 1's `confirmed` outcome and Task 2's low-tier sentence.

- [ ] **Step 1: Append the failing tests.**
  - `AC6.1`. `step3-routing.md`:
    - no longer matches `/route straight to the Wrap-Up Review Console's Low-confidence/`
    - its `## Inputs` list matches `/tiebreak-confirmed findings \(`step3-tiebreak\.md`\)/`
    - the low-tier bullet no longer says `the Direct-verification override is the only path to \`confirmed\``
  - Go-red proofs.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js`
  Expected: FAIL after Step 1 (the AC6 tests fail).

- [ ] **Step 3: Edit the file.**
  - Add the `## Inputs` bullet.
  - The two source bullets say the tiebreak settles these findings. The override stays documented and emits a resolver line (Task 2).
  - **Effort-tier surfacing.** The table holds `confirmed` findings, tiebreak-confirmed ones included. `unconfirmed`/`contested` findings go to Step 3.7 first; its `console` outcome is what reaches the Review Console.
  - **`xhigh`/`max` paragraphs.** "`unconfirmed`" becomes "tiebreak can't-tell (`digest`/`console`)", and the staging wording is kept.
  - Keep the `- Vacuity claim without execution evidence (lens 3f` bullet verbatim (pinned).
  - Run `grep -rn` across `tests/` for each changed sentence (`step3-routing-prose-exempt-conformance`, `review-vacuity-evidence-conformance`, `review-fix-ephemeral-server-conformance`, `review-qa-rerun-after-fix-wave-conformance`) and update the pins in this task.

- [ ] **Step 4: Run the tests**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/step3-routing-prose-exempt-conformance.test.js tests/review-vacuity-evidence-conformance.test.js tests/review-fix-ephemeral-server-conformance.test.js tests/review-qa-rerun-after-fix-wave-conformance.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** `Route tiebreak-confirmed findings into Step 3 Routing — refs #3947`.

### Task 5: Fix the two stale statements in `multi-agent-coordination.md`

**Files:**
- Modify: `plugin/skills/_shared/multi-agent-coordination.md`:
  - Comparison rule item 3 (line ~50)
  - the Auto-resolution table's `unconfirmed` row "(path/line/severity mismatch)"
  - the Decision-log STAGED line (line ~80)
  - the paragraph after it (line ~83)
- Modify: `plugin/skills/_shared/staged-patch.md`, the Artifact format examples (`review-unconfirmed-{n}.patch`)
- Modify tests: `tests/staged-patch-contract.test.js` (`STAGING_SITES` row for `multi-agent-coordination.md`) and `tests/multi-agent-coordination.test.js` (the `staged/review-unconfirmed-1.patch` entry string, line ~635)
- Test: append to `tests/review-tiebreak-step-conformance.test.js`

**Interfaces:** None.

- [ ] **Step 1: Append the failing tests.**
  - `AC9.1`. `multi-agent-coordination.md`:
    - does not contain `Cross-bucket mismatches do not reproduce` or `review-unconfirmed-{n}.patch`
    - contains `staged/review-unconfirmed-{n}.md`
    - matches `/straddl.*still reproduces.*lower severity.*severityContested/`
  - `AC9.2` (the replacement is accurate against the code). `categoriseReproduction` on a high/medium pair at one location with near-identical text returns one `confirmed` with `severityContested: true` and severity `medium`, while `findingsMatch` on the same pair returns `false`. This holds the prose to `reconcileSeverity`.
  - Go-red proofs for the prose pins.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js`
  Expected: FAIL after Step 1 (AC9.1 fails; AC9.2 passes, because it pins the code the prose must match).

- [ ] **Step 3: Edit the files.**
  - **Item 3:** `critical` + `high` form one bucket and `medium` + `low` + `info` the other. `findingsMatch` requires the same bucket. A pair that agrees on location and substance but straddles the boundary still reproduces: `confirmed` at the lower severity, flagged `severityContested` (`reconcileSeverity` in `bin/lib/coordination.js`, #733).
  - **Table row:** "(path/line or substance mismatch)".
  - **STAGED line:** `… Stage path: staged/review-unconfirmed-{n}.md.`
  - **Paragraph after it:** the file is a finding description (severity, lens, source, where, finding, suggested follow-up), not a patch. The console classifies it as Low-confidence (`bin/lib/console/resolve.js`'s `review-unconfirmed-` row). Such a finding first goes to `/claude-tweaks:review`'s tiebreak (`review/step3-tiebreak.md`). Remove the `_shared/staged-patch.md` gate sentence for this file.
  - **`staged-patch.md`:** drop `review-unconfirmed-{n}.patch` from the examples.
  - **`staged-patch-contract.test.js`:** remove the `multi-agent-coordination.md` `STAGING_SITES` row, since it no longer stages a `.patch`.
  - **`multi-agent-coordination.test.js`:** change the entry string to `.md`.

- [ ] **Step 4: Run the tests**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/staged-patch-contract.test.js tests/multi-agent-coordination.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** `Correct the reproduction bucket rule and the unconfirmed stage path — refs #3947`.

### Task 6: The `tiebreak-cant-tell` digest value

**Files:**
- Modify: `plugin/skills/_shared/materiality-floor.md` (a new `### Tiebreak can't-tell value` subsection after `### Direct-filing producers' \`Defer-reason:\` value`)
- Test: append to `tests/review-tiebreak-step-conformance.test.js`

**Interfaces:** Consumed by Task 1's Resolve and act `digest` bullet.

- [ ] **Step 1: Append the failing tests.**
  - `R1`. `materiality-floor.md` contains `Defer-reason: tiebreak-cant-tell` and names `step3-tiebreak.md`.
  - `DEFER_REASONS` (`require('../plugin/bin/lib/issues/record.js').DEFER_REASONS`) does not include `tiebreak-cant-tell`, and still has length 6.
  - `step3-tiebreak.md`'s Resolve and act section contains `tiebreak-cant-tell`.
  - Go-red proofs.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js`
  Expected: FAIL after Step 1.

- [ ] **Step 3: Write the subsection.**
  - A review finding the independent tiebreak could not confirm or refute, at severity `low`/`info` (the resolver's `digest` outcome), is routed here by `/claude-tweaks:review`'s Step 3.7 with this value.
  - It is an entry-format value like `direct-filing-sweep`, deliberately not in `DEFER_REASONS`: an unverified finding never failed fix-now. Its routing comes from the resolver's severity split, not the three-axis floor.
  - Dedup and count surfacing apply unchanged.

- [ ] **Step 4: Run the tests**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/materiality-floor-conformance.test.js tests/deferral-gate-conformance.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** `Add the tiebreak-cant-tell digest value — refs #3947`.

### Task 7: Skill-graph edges and the full suite

**Files:**
- Modify: `docs/skill-graph.md`, `## review` section: the `_shared/materiality-floor.md` row, the `_shared/subagent-dispatch-core.md` row, and a new `bin/review-coordination.js` row
- Test: append to `tests/review-tiebreak-step-conformance.test.js`

**Interfaces:** None.

- [ ] **Step 1: Append the failing tests.**
  - `AC11.1`. The `## review` section of `docs/skill-graph.md` (sliced to the next `## `):
    - has a row starting `` | `bin/review-coordination.js` | `` that names `step3-tiebreak.md`, `resolve-tiebreak` and `write-findings`
    - its `_shared/materiality-floor.md` row names `tiebreak-cant-tell`
    - its `_shared/subagent-dispatch-core.md` row names the tiebreak
  - No `plugin/skills/**/SKILL.md` contains `step3-tiebreak.md`: the edge lives only in the graph and the review sub-files.
  - Go-red proofs.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js`
  Expected: FAIL after Step 1.

- [ ] **Step 3: Edit the three rows.**
  - New row: Step 3.7's tiebreak (`step3-tiebreak.md`) writes `review-findings.json` (`write-findings`) and resolves every reply (`resolve-tiebreak`, resolver `bin/lib/tiebreak.js`). The archive gate reads the same artifact (`check-coverage`).
  - The materiality row adds Step 3.7's `digest` outcome (`tiebreak-cant-tell`).
  - The dispatch-core row adds the tiebreak dispatches to its list, including the nested-children rule for a dispatched reviewer.
  - No `/dispatch`-section row: the dispatched-reviewer mechanism is `/review`-internal and owned by the `## review` rows.

- [ ] **Step 4: Run the graph tests and the full suite**
  Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js`
  Expected: PASS. Then run `npm test`: Expected `# fail 0` (prose pins live far from the files they pin).

- [ ] **Step 5: Commit** `Record the tiebreak step's skill-graph edges — refs #3947`.

## AC coverage

The spec lists its criteria as 1–8, 12, 9, 10, 11. plan-audit numbers them by position, so the first column uses plan-audit's positional ids and the second gives the spec's own number. Test names in the test file use the spec's numbers.

| Audit id | Spec AC | Clause | Task | Test |
|---|---|---|---|---|
| AC1.1, AC1.2 | 1 | Tiers and modes are named; placement after the earlier passes is pinned by an ordering test | 1 | `AC1.1 …`, `AC1.2 …`, `AC1.3 …` |
| AC2.1, AC2.2 | 2 | Contract elements are present; Frontier is absent from the fan-out | 1 | `AC2.1 …`, `AC2.2 …` |
| AC3.1, AC3.2 | 3 | One verdict line per listed finding; two `nearLocation` findings give two verdict lines, each judged on its own | 1 | `AC3.1 fixture …` (asserts both) |
| AC4.1, AC4.2 | 4 | The low-tier paragraph no longer settles by direct verification; the override stays and emits a resolver line | 2 | `AC4.1 …`, `AC4.2 …` |
| AC5.1, AC5.2, AC5.3 | 5 | A quoted refutation is a `refuted` verdict; an evidence-free one stays `unconfirmed` and is tiebroken; pinned on the template and the rule text | 3 | `AC5.1 …` (template), `AC5.2 …` (rule) |
| AC6.1, AC6.2, AC6.3 | 6 | No direct-to-Low-confidence route; tiebreak-confirmed findings are listed as an input; pinned | 4 | `AC6.1` (asserts both clauses) |
| AC7.1, AC7.2 | 7 | Standalone closing output lists can't-tell ≥ medium with the recommendation and stages nothing; pinned on the step text | 1 | `AC7.1 …` |
| AC8.1, AC8.2 | 8 | Mechanism, fallback ladder and invariant are stated; no contradiction with `#3817`; the all-can't-tell fallback is forbidden, pinned | 1 | `AC8.1 …` (includes the no-`skip dispatch` and forbid-all-can't-tell assertions), plus `tests/review-dispatched-reviewer-degrade-conformance.test.js` kept green in Task 2 |
| AC9.1 | 12 | The input is exactly the allowlist; the field list is asserted | 1 | `AC12.1 …` |
| AC10.1, AC10.2 | 9 | The two stale statements are gone; the replacements match `coordination.js` and the real staged filenames | 5 | `AC9.1` (prose), `AC9.2` (`categoriseReproduction`/`findingsMatch` behavior; `.md` filename) |
| AC11.1 | 10 | `step3-lens-dispatch.md` is under 52,500 B and the rail test passes | 2 | `AC10.1 rail`, plus `tests/bin-lib/skill-audit/budgets.test.js` |
| AC12.1, AC12.2 | 11 | Graph edges exist, no `SKILL.md` restates an edge, and `npm test` passes | 7 | `AC11.1`, plus the Task 7 Step 4 `npm test` full run |
