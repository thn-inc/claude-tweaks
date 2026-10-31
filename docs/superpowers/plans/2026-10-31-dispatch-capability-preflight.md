# Dispatch-Capability Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:flow` and `/claude-tweaks:build` stop BLOCKED with a paste-ready resume command when the host has no `Agent`/`Task` tool, and `/claude-tweaks:review` stamps one run-level `Independence: degraded` caveat when its lenses and tiebreaks were all self-judged.

**Architecture:** Prose-only change to skill markdown plus `node --test` prose-conformance pins. The stop procedure lives once, in a new `## No-dispatch host (#4555)` section of `plugin/skills/build/execution-mode-policy.md`; flow and build each carry one short preflight paragraph citing `_shared/subagent-dispatch-core.md`'s no-`Agent` probe and that section. Review's marker reuses the summary-template and verdict-comment channels the #3817 Coverage caveat already uses.

**Tech Stack:** Markdown skill files, Node 18+ `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T113847-record-4555/work/4555-spec.md` (record #4555)

**Scope keywords:** `No-dispatch host`, `Independence: degraded`, `Dispatch-capability preflight`

## Global Constraints

- No new `bin/` CLI, no new outcome word, no new Review Console section (spec Technical Approach).
- Cite, never restate: the probe is `_shared/subagent-dispatch-core.md`'s "`ToolSearch` finds none, deferred or otherwise"; the #447 mechanism is `dispatch/sequential-execution.md`'s "When the dispatching session itself is cwd-pinned (#447)" section (spec Deliverables 1, 4).
- The stop never implements plan tasks inline and never switches to `batched` automatically (spec Deliverable 1, #491).
- SKIP line text, verbatim: `condition: no Agent/Task tool in this host → fallback: run stopped before build; resume from a top-level session`.
- Review caveat text, verbatim: `Independence: degraded — no Agent tool in this host; every lens and tiebreak was judged by the reviewer itself`.
- The existing per-lens `single-read coverage` line and the `Tiebreak caveat:` line stay byte-unchanged.
- Premise correction (logged at Spec Step 3): a fork is not automatically a no-`Agent` host — a probe run in a fork found `Agent`. The preflight keys on the probe's result alone, never on the host being a fork. A cwd-pinned session that has an `Agent` tool is not a no-dispatch host and must not be stopped.
- Rail (`RAIL_BYTES` = 52,500 B, `plugin/bin/lib/skill-audit/budgets.js`) — headroom at merge base: `flow/SKILL.md` 50,366 B (2,134 free), `build/SKILL.md` 51,305 B (1,195 free), `review/step3-lens-dispatch.md` 50,801 B (1,699 free), `review/code-mode-steps.md` 51,037 B (1,463 free), composed `worktree-setup` bundle (`_shared/worktree-setup.md` + `build/worktree-setup.md`) 51,890 B (610 free). Keep each addition to the exact text below; the `rail:` tests in `tests/bin-lib/skill-audit/context-cost.test.js` fail over the rail.
- Governing project skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted rules that apply to every test here:
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself. Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`." … "Keep the patterns non-global."
  - "Prove each assertion on a mutated copy of the live text instead … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit style: `{Verb} {what} — {detail} (refs #4555)`, never "closes"/"fixes"; end with `Claude-Session: https://claude.ai/code/session_01JHXvgY6MvYsu7HvE4KdTLq`.

## Review Focus

- A cwd-pinned Task subagent *with* an `Agent` tool (this very dispatch shape) must not be stopped — the flow/build paragraphs must key on "probe finds none", never on "subagent" or "fork". Task 1's policy test pins the probe-result-decides sentence.
- A flow resume whose step list omits `build` (e.g. dispatch's `review,polish,wrap-up` call) must not be stopped by the build preflight — Task 2 pins the "When the step list includes `build`" condition.
- The preflight must sit before Step 2.8's claim, so a never-buildable run leaves no claim or draft PR — Task 2 pins that 2.4 appears before 2.8 in the file.
- `subagent-only` must not see the `batched` line — Task 1 pins the omission clause.
- Review's existing #3817 pins must still pass unchanged (exactly-one `single-read coverage. Reversibility: high.` in skills; the verdict paragraph's `Coverage caveat:** line verbatim`) — Task 4 runs the whole existing suite.

---

### Task 1: No-dispatch host section in execution-mode-policy.md

**Role:** integration

**Files:**
- Modify: `plugin/skills/build/execution-mode-policy.md` (append a section after `## Schema impact`)
- Create: `tests/no-dispatch-host-preflight-conformance.test.js`

**Interfaces:**
- Produces: the heading `## No-dispatch host (#4555)` — Tasks 2 and 3 cite it as `execution-mode-policy.md`'s No-dispatch host section. The test file's helpers `missingFactsOf`, `assertEachPatternGoesRed`, `sectionOf(text, heading)` (returns text from the heading to the next `## ` or EOF; asserts the heading exists) — Tasks 2 and 3 append tests to this file using them.

- [ ] **Step 1: Write the failing test** in `tests/no-dispatch-host-preflight-conformance.test.js`. Header comment names #4555. Copy `missingFactsOf` and `assertEachPatternGoesRed` from `tests/review-dispatched-reviewer-degrade-conformance.test.js` (same shapes). Read via `readText` from `./helpers/read-skill`. Patterns over `sectionOf(policyText, '## No-dispatch host (#4555)')`:

```js
const POLICY_FACTS = [
  [/`_shared\/subagent-dispatch-core\.md`'s probe, "`ToolSearch` finds none, deferred or otherwise"/, 'AC5.1: cites the canonical no-Agent probe'],
  [/The probe's result decides, never the host's shape/, 'the probe result decides, not fork/pinned shape'],
  [/never implement plan tasks inline, never switch to `batched` on the run's behalf/, 'AC2.2: stop, never inline, never auto-batched'],
  [/^ *BLOCKED — this host has no Agent\/Task tool, so the `subagent` execution strategy cannot run\.$/m, 'AC2.1: BLOCKED cause line'],
  [/^ *Resume from a top-level session:\n *\{resume command\}$/m, 'AC2.1: resume command on its own line'],
  [/Or run it in-session, in human-reviewed batches: `\/claude-tweaks:build #\{n\} batched`/, 'AC3.1: batched named as explicit human choice'],
  [/Under `subagent-only` that line is omitted/, 'AC3.2: subagent-only omits batched'],
  [/--status SKIP --text "condition: no Agent\/Task tool in this host → fallback: run stopped before build; resume from a top-level session"/, 'AC4.1: SKIP line in condition → fallback shape'],
  [/`OUTCOME: build-test-blocked`, `STATUS: BLOCKED` — never a new outcome word/, 'AC4.2: dispatch headless reports build-test-blocked'],
  [/This stop tears nothing down itself/, 'resume leaves claim/worktree/PR in place'],
];
```

Tests: `test('AC5.1 AC2.1 AC2.2 AC3.1 AC3.2 AC4.1 AC4.2: execution-mode-policy.md states the no-dispatch-host stop (#4555)', …)` asserting `missingFactsOf(POLICY_FACTS)(section)` deep-equals `[]`; and `test('AC8.2: each policy fact can go red', …)` calling `assertEachPatternGoesRed(section, POLICY_FACTS, missing)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/no-dispatch-host-preflight-conformance.test.js`
Expected: FAIL with the `## No-dispatch host (#4555)` heading-not-found assertion.

- [ ] **Step 3: Append the section** to `plugin/skills/build/execution-mode-policy.md`, exactly:

````markdown

## No-dispatch host (#4555)

A host with no `Agent`/`Task` tool — `_shared/subagent-dispatch-core.md`'s probe, "`ToolSearch` finds none, deferred or otherwise" — is exactly the case this decision forbids silent inline execution for: `subagent` cannot run there, and implementing the plan's tasks in-session would be the unlicensed third path above. The probe's result decides, never the host's shape: a fork or a cwd-pinned Task subagent whose probe finds `Agent` is not a no-dispatch host (#4555 found `Agent` present in a fork).

The enforcement point is the dispatch-capability preflight `/claude-tweaks:flow` Step 2.4 runs before it claims targets or creates a worktree, fresh or resumed, and `/claude-tweaks:build` Common Step 2 runs before `subagent` execution. When the probe finds none:

1. Stop: never implement plan tasks inline, never switch to `batched` on the run's behalf. Report BLOCKED with the cause, and the resume command on its own line:

   ```
   BLOCKED — this host has no Agent/Task tool, so the `subagent` execution strategy cannot run.
   Resume from a top-level session:
   {resume command}
   ```

   `{resume command}` is the invocation the stopped run received, e.g. `/claude-tweaks:flow #{n} {steps}` or `/claude-tweaks:build #{n}`.
2. A standalone `/claude-tweaks:build` whose `execution-strategy` is not `subagent-only` adds one line, a choice for a human and never taken automatically: Or run it in-session, in human-reviewed batches: `/claude-tweaks:build #{n} batched`. Under `subagent-only` that line is omitted — the lock forbids `batched`.
3. When a pipeline run directory resolves, log one line per `_shared/auto-decision-log.md`: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --text "condition: no Agent/Task tool in this host → fallback: run stopped before build; resume from a top-level session" --reversibility n/a`.
4. Under `/claude-tweaks:dispatch`'s headless call, report through its existing channel — `OUTCOME: build-test-blocked`, `STATUS: BLOCKED` — never a new outcome word.
5. This stop tears nothing down itself: on a resume the claim, worktree and draft PR already exist and stay in place for the top-level resume (a dispatching session's own Settle procedure still acts on the reported outcome).
````

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/no-dispatch-host-preflight-conformance.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit** — `git add` the two files by path; message `Name the no-dispatch host in execution-mode-policy — stop, resume command, SKIP line (refs #4555)`.

---

### Task 2: Preflight paragraphs in flow and build SKILL.md

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/SKILL.md` (Step 2 list, line ~139-140)
- Modify: `plugin/skills/build/SKILL.md` (Common Step 2, after the paragraph starting "Execution depends on the chosen execution strategy")
- Modify: `docs/skill-graph.md` (`## flow` section: one new row for target `build/execution-mode-policy.md`)
- Test: `tests/no-dispatch-host-preflight-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's heading and test helpers.

- [ ] **Step 1: Append failing tests.** Region helpers: flow's item = the line starting `- 2.4 — Dispatch-capability preflight (#4555).`; build's paragraph = the line starting `**Dispatch-capability preflight (#4555):**`. Assert each line exists.

```js
const FLOW_FACTS = [
  [/When the step list includes `build`/, 'flow gates only a step list with build'],
  [/on every entry — fresh, or a resume \(a step-list resume or an adopted `PIPELINE_RUN_DIR`\)/, 'AC1.2: flow runs it again on resume'],
  [/`_shared\/subagent-dispatch-core\.md`'s no-`Agent` probe/, 'AC1.1: flow cites the probe'],
  [/before 2\.5-2\.8, so a host that can never build leaves no claim or draft PR behind/, 'AC1.2: flow runs it before claim and worktree creation'],
  [/stop BLOCKED per `build\/execution-mode-policy\.md`'s No-dispatch host section/, 'AC2.1: flow stop cites the policy section'],
  [/never implement plan tasks inline/, 'AC2.2: flow never inline'],
];
const BUILD_FACTS = [
  [/before `subagent` execution/, 'AC1.3: build runs it before subagent execution'],
  [/`_shared\/subagent-dispatch-core\.md`'s no-`Agent` probe/, 'AC1.1: build cites the probe'],
  [/stop BLOCKED per `execution-mode-policy\.md`'s No-dispatch host section/, 'AC2.1: build stop cites the policy section'],
  [/never implement the plan's tasks inline, and never switch to `batched` on the run's behalf/, 'AC2.2: build never inline, never auto-batched'],
];
```

Tests: `test('AC1.1 AC1.2 AC2.1 AC2.2: flow Step 2.4 runs the dispatch-capability preflight (#4555)')`, `test('AC1.1 AC1.3 AC2.1 AC2.2: build Common Step 2 runs the dispatch-capability preflight (#4555)')`, each with a go-red twin via `assertEachPatternGoesRed`. Ordering pin: `test('AC1.2: flow 2.4 precedes 2.8 (claim)')` — `indexOf('- 2.4 — Dispatch-capability preflight')` is `>= 0` and less than `indexOf('- 2.8 — Claim the targets')`, with a control that swaps the two lines in memory and asserts the comparison flips. Build placement pin: the build paragraph's index lies between `indexOf('### Common Step 2: Execute the Plan')` and `indexOf('**subagent** (default): read \`dispatch.md\`')`. Negative sweep `test('AC2.2: neither SKILL.md tells the agent to implement plan tasks inline')`: no line of either file matches `/implement(?:s|ing)? (?:the plan(?:'s tasks)?|plan tasks) inline/i` unless the same line also matches `/never implement/i`; control: append `Implement plan tasks inline.` to a copy and assert the sweep reports it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/no-dispatch-host-preflight-conformance.test.js`
Expected: FAIL on the missing `- 2.4 — Dispatch-capability preflight (#4555).` line.

- [ ] **Step 3: Edit the skills.**

In `plugin/skills/flow/SKILL.md` Step 2, change `Four checks, then a route, before pipeline starts.` to `A dispatch-capability preflight, four checks, then a route, before pipeline starts.` and insert directly above the `- 2.5 — Branch-divergence check` line:

```markdown
- 2.4 — Dispatch-capability preflight (#4555). When the step list includes `build`, on every entry — fresh, or a resume (a step-list resume or an adopted `PIPELINE_RUN_DIR`) — probe for an `Agent`/`Task` tool with `_shared/subagent-dispatch-core.md`'s no-`Agent` probe, before 2.5-2.8, so a host that can never build leaves no claim or draft PR behind. None found → stop BLOCKED per `build/execution-mode-policy.md`'s No-dispatch host section (resume command, `SKIP` line, `build-test-blocked` under dispatch); never implement plan tasks inline.
```

In `plugin/skills/build/SKILL.md` Common Step 2, insert a new paragraph (blank line before and after) directly after the paragraph that starts `Execution depends on the chosen execution strategy (see Build Options).`:

```markdown
**Dispatch-capability preflight (#4555):** before `subagent` execution, probe for an `Agent`/`Task` tool with `_shared/subagent-dispatch-core.md`'s no-`Agent` probe. None found → stop BLOCKED per `execution-mode-policy.md`'s No-dispatch host section — never implement the plan's tasks inline, and never switch to `batched` on the run's behalf.
```

In `docs/skill-graph.md`'s `## flow` table, add one row in that table's existing column shape: target `build/execution-mode-policy.md`; relationship: Step 2.4's dispatch-capability preflight (#4555) stops a no-`Agent` host by citing that file's No-dispatch host section (stop message, `SKIP` line, `build-test-blocked`), which `/build` Common Step 2 cites too; the probe itself is `_shared/subagent-dispatch-core.md`'s.

- [ ] **Step 4: Verify.** Run, each its own call:
  - `node --test tests/no-dispatch-host-preflight-conformance.test.js` → PASS
  - `node --test tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js` → PASS
  - `node --test tests/flow-preflight-conformance.test.js tests/flow-claim-preflight.test.js` → PASS
  - `wc -c plugin/skills/flow/SKILL.md plugin/skills/build/SKILL.md` → each under 52500
  - Renumbering sweep (three forms): `grep -rn "Four checks" plugin docs`, `grep -rn "2\.5-2\.[0-9]" plugin/skills/flow`, `grep -rn "four pre-flight\|four checks" plugin/skills docs` — every hit either already updated or not about flow Step 2.

- [ ] **Step 5: Commit** — the three files plus the test by path; message `Add the dispatch-capability preflight to flow Step 2.4 and build Common Step 2 (refs #4555)`.

---

### Task 3: Cwd-pinned pointer in build/worktree-setup.md

**Role:** transcription

**Files:**
- Modify: `plugin/skills/build/worktree-setup.md` (one paragraph directly after the `## If worktree creation fails` table, before `## Impeccable hook consent (per-worktree)`)
- Modify: `docs/skill-graph.md` (`## build` section: one new row for target `dispatch/sequential-execution.md`)
- Test: `tests/no-dispatch-host-preflight-conformance.test.js` (append)

- [ ] **Step 1: Append failing tests** over the paragraph line starting `**Cwd-pinned session (#4555).**`:

```js
const POINTER_FACTS = [
  [/`dispatch\/sequential-execution\.md`'s "When the dispatching session itself is cwd-pinned \(#447\)" section/, 'AC7.1: cites the #447 section'],
  [/that mechanism is not restated here/, 'AC7.1: pointer, not a copy'],
  [/is not a no-dispatch host \(`execution-mode-policy\.md`'s No-dispatch host section\)/, 'a pinned session with Agent is not stopped'],
];
```

Plus `test('AC7.1: build/worktree-setup.md carries no second copy of the #447 mechanism')`: the file contains neither `` `cd {worktree-path} &&` `` nor `explicit \`cd\``; control appends `` `cd {worktree-path} &&` `` to a copy and asserts the check reports it. Go-red twin for POINTER_FACTS.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/no-dispatch-host-preflight-conformance.test.js`
Expected: FAIL on the missing `**Cwd-pinned session (#4555).**` paragraph.

- [ ] **Step 3: Insert the paragraph**, exactly:

```markdown
**Cwd-pinned session (#4555).** A session whose cwd the harness pins (its `EnterWorktree` is refused) follows `dispatch/sequential-execution.md`'s "When the dispatching session itself is cwd-pinned (#447)" section instead of these rows; that mechanism is not restated here. If its probe finds an `Agent` tool, it is not a no-dispatch host (`execution-mode-policy.md`'s No-dispatch host section).
```

In `docs/skill-graph.md`'s `## build` table add a row: target `dispatch/sequential-execution.md`; relationship: `worktree-setup.md`'s Cwd-pinned session paragraph (#4555) routes a harness-pinned session to that file's #447 section rather than restating the `git worktree add` + `cd`-prefix mechanism.

- [ ] **Step 4: Verify.** Each its own call:
  - `node --test tests/no-dispatch-host-preflight-conformance.test.js` → PASS
  - `node --test tests/bin-lib/skill-audit/context-cost.test.js` → PASS (the composed `worktree-setup` bundle stays under 52,500 B)
  - `node --test tests/build-worktree-setup-dispatch-stamp.test.js tests/worktree-setup-catchup-no-run-dir.test.js tests/worktree-setup-plugin-root-literal.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js` → PASS

- [ ] **Step 5: Commit** — files by path; message `Point build worktree setup at dispatch's #447 mechanism for cwd-pinned sessions (refs #4555)`.

---

### Task 4: Run-level Independence: degraded marker in review

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (new blockquote note directly after the `> **Foreground Execution Discipline:**` line, separated by a blank line)
- Modify: `plugin/skills/review/review-summary-template.md` (compact eligibility sentence, line ~10; a new slot line directly after each of the two `**Coverage caveat:**` slot lines, ~23 and ~40)
- Modify: `plugin/skills/review/code-mode-steps.md` (Verdict comment paragraph, ~line 392)
- Modify: `docs/skill-graph.md` (`## review` section's existing `_shared/subagent-dispatch-core.md` row: append one sentence)
- Test: `tests/review-dispatched-reviewer-degrade-conformance.test.js` (append)

- [ ] **Step 1: Append failing tests** to `tests/review-dispatched-reviewer-degrade-conformance.test.js`, reusing its `missingFactsOf`, `assertEachPatternGoesRed`, `lineStartingWith`, `summaryForms`, `verdictParagraph`:

```js
const RUN_LEVEL_PREFIX = '> **No `Agent` tool in this host (run-level, #4555).**';
const RUN_LEVEL_FACTS = [
  [/When Step 3 starts, probe once with `_shared\/subagent-dispatch-core\.md`'s no-`Agent` probe/, 'AC6.1: run-level probe at Step 3 start'],
  [/--status SKIP --text "condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself"/, 'AC6.1: one run-level log line'],
  [/render `review-summary-template\.md`'s \*\*Independence: degraded\*\* line, which the PR verdict comment copies/, 'AC6.1: caveat reaches summary and verdict comment'],
  [/The per-lens single-read lines below and the tiebreak's ` Mode: inline\.`\/`Tiebreak caveat:` lines still write, unchanged/, 'AC6.2: per-lens and tiebreak lines unchanged'],
];
const INDEPENDENCE_SLOT = [
  [/\{only when Step 3 found no Agent tool — `step3-lens-dispatch\.md`'s run-level no-Agent note:\}/, 'the slot cites the run-level note'],
  [/\*\*Independence: degraded\*\* — no Agent tool in this host; every lens and tiebreak was judged by the reviewer itself/, 'AC6.1: the spec caveat text'],
  [/; the reviewer is the same session that ran this build's implementation\}/, 'AC6.1: same-session-as-build clause'],
];
const VERDICT_INDEPENDENCE = [[/then its \*\*Independence: degraded\*\* line verbatim when it rendered/, 'AC6.1: verdict comment copies the Independence line']];
```

Tests (each with a go-red twin): `AC6.1 AC6.2: step3-lens-dispatch.md states the run-level no-Agent note` (over `lineStartingWith(text, RUN_LEVEL_PREFIX)`, asserted non-empty); `AC6.1: summary template carries the Independence slot in compact and full forms` (over each of `summaryForms`'s halves); `AC6.1: verdict comment copies the Independence line` (over `verdictParagraph`); `the compact form says an Independence line does not disqualify it` (pattern `/An \*\*Independence: degraded\*\* line is informational the same way\./`). Also `AC6.2: the per-lens and tiebreak caveat lines are unchanged` — `review-summary-template.md` still contains, byte-for-byte, the existing `**Tiebreak caveat:** {n} verdict(s) read inline by the reviewer, not an independent agent ({reason, e.g. no \`Agent\` tool, timed out})` line; the existing `partner-died paragraph states the degrade line shape and caveat once` test already pins the single-read line.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-dispatched-reviewer-degrade-conformance.test.js`
Expected: FAIL after Step 1, on the new run-level note assertion (existing tests still pass).

- [ ] **Step 3: Edit the review files.**

`step3-lens-dispatch.md` — insert after the Foreground note line, with one blank line before:

```markdown
> **No `Agent` tool in this host (run-level, #4555).** When Step 3 starts, probe once with `_shared/subagent-dispatch-core.md`'s no-`Agent` probe. None found → log one line, `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --text "condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself" --reversibility n/a` (standalone: one line in the report), and render `review-summary-template.md`'s **Independence: degraded** line, which the PR verdict comment copies. The per-lens single-read lines below and the tiebreak's ` Mode: inline.`/`Tiebreak caveat:` lines still write, unchanged.
```

`review-summary-template.md` — append to the compact eligibility bullet (after `…does not disqualify the compact form either.`): ` An **Independence: degraded** line is informational the same way.` Then after each `**Coverage caveat:**` slot line insert:

```markdown
{only when Step 3 found no Agent tool — `step3-lens-dispatch.md`'s run-level no-Agent note:} **Independence: degraded** — no Agent tool in this host; every lens and tiebreak was judged by the reviewer itself{only when this session also ran this build's implementation:; the reviewer is the same session that ran this build's implementation}
```

`code-mode-steps.md` — in the Verdict comment paragraph change `then the summary's **Coverage caveat:** line verbatim when it rendered, then the` to `then the summary's **Coverage caveat:** line verbatim when it rendered, then its **Independence: degraded** line verbatim when it rendered, then the`.

`docs/skill-graph.md` `## review`'s `_shared/subagent-dispatch-core.md` row — append: `Since #4555 Step 3 also runs that file's no-\`Agent\` probe once at its start; none found writes one run-level \`SKIP\` line and the summary's **Independence: degraded** caveat, which the verdict comment copies, alongside (never replacing) the per-lens and tiebreak degrade lines.`

- [ ] **Step 4: Verify.** Each its own call:
  - `node --test tests/review-dispatched-reviewer-degrade-conformance.test.js` → PASS (old and new)
  - `node --test tests/review-tiebreak-step-conformance.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js` → PASS
  - `grep -rln "Independence: degraded" plugin tests` → the three review files and the review test file (plus nothing else)
  - `wc -c plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/code-mode-steps.md` → each under 52500

- [ ] **Step 5: Commit** — files by path; message `Stamp a run-level Independence: degraded caveat when review has no Agent tool (refs #4555)`.

---

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 / AC1.1-1.3, AC2.1-2.2, AC3.1-3.2, AC4.1-4.2 | 1 (procedure), 2 (entry points) |
| Deliverable 2 / AC5.1 | 1 |
| Deliverable 3 / AC6.1-6.2 | 4 |
| Deliverable 4 / AC7.1 | 3 |
| Deliverable 5 / AC8.1, AC8.2 | 1-4 (pins + go-red twins) |
| AC8.3 (`npm test` passes) | Common Step 5 final verification (full suite, run centrally) |
