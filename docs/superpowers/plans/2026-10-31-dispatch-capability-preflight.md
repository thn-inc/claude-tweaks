# Dispatch-Capability Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:flow` and `/claude-tweaks:build` stop BLOCKED with a paste-ready resume command when the host has no `Agent`/`Task` tool; `/claude-tweaks:review` stamps one run-level `Independence: degraded` caveat when its lenses and tiebreaks were all self-judged, and `merge-check` then routes that run's merge to a human.

**Architecture:** Prose-only change to skill markdown plus `node --test` prose-conformance pins. The stop procedure lives once, in a new `## No-dispatch host (#4555)` section of `plugin/skills/build/execution-mode-policy.md`; flow (Step 2.4) and build (Common Step 1.5) each carry one short preflight paragraph citing `_shared/subagent-dispatch-core.md`'s no-`Agent` probe and that section. Review's marker reuses the summary-template and verdict-comment channels the #3817 Coverage caveat already uses; `assess-agent-autonomy/merge-check.md` gains one hard floor keyed on review's run-level `SKIP` line, the single choke point every auto-merge path passes through.

**Tech Stack:** Markdown skill files, Node 18+ `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T060641-record-4555/work/4555-spec.md` (record #4555; revised 2026-10-31 for the record's first two plan-review Decisions and the first plan review's lower-severity findings; revised 2026-11-01 for its four later Decisions — D3 SKIP-line timing, D4 Settle special case, D5 same-session detection, D6 closing rule)

**Scope keywords:** `No-dispatch host`, `Independence: degraded`, `Dispatch-capability preflight`

## Global Constraints

- No new `bin/` CLI, no new outcome word, no new Review Console section (spec Technical Approach).
- Cite, never restate: the probe is `_shared/subagent-dispatch-core.md`'s "`ToolSearch` finds none, deferred or otherwise" (its Foreground Execution Discipline fallback, line ~77, line-wrapped in the source); the #447 mechanism is `dispatch/sequential-execution.md`'s "When the dispatching session itself is cwd-pinned (#447)" section (spec Deliverables 1, 4).
- The stop never implements plan tasks inline and never switches to `batched` automatically (spec Deliverable 1, #491). This deliberately departs from `_shared/subagent-dispatch-core.md`'s self-judge fallback, which governs read-only lens/judge units, not plan implementation (degrade-clause convention check).
- SKIP line text, verbatim: `condition: no Agent/Task tool in this host → fallback: run stopped before build; resume from a top-level session`.
- Review run-level SKIP text, verbatim: `condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself` — Task 5's merge-check floor quotes this exact string; a test pins the two copies equal.
- Review caveat text, verbatim: `Independence: degraded — no Agent tool in this host; every lens and tiebreak was judged by the reviewer itself`.
- Decision Q1 (record body, verbatim): "The stop's paste-ready resume command depends on how the run was started. Under `/claude-tweaks:dispatch` it names `/claude-tweaks:dispatch #{n}`, to use after Settle runs. Outside dispatch it repeats the received invocation, keeping its `PIPELINE_RUN_DIR="…"` prefix whenever one was adopted."
- Decision Q2 (record body, verbatim): "Flow's preflight probe runs only when the step list includes `build`. Resumes without `build` proceed, and review's run-level `Independence: degraded` marker covers them. A run whose review is marked `Independence: degraded` never auto-merges: its merge decision routes to a human, and a test pins that."
- Decision D3 (record body, verbatim): "At flow Step 2.4, the no-dispatch-host `SKIP` line is written to `decisions.md` only when the run dir already has `config.yml`; otherwise its text goes in the stop report only, so a resume never adopts the dir as a recovery (case 3). This narrows the AC4 logging clause."
- Decision D4 (record body, verbatim): "Dispatch's Settle treats a no-dispatch-host `build-test-blocked` as a pre-flight-stop special case, like claims-branch-missing: no failure classification, no retry count, no failure comment. Under `DISPATCH_HEADLESS=1` it self-reports through `_shared/headless-self-report.md` as `flow-step-2.4-no-dispatch-host`." Implementer's judgment (D6): Settle recognizes the stop by the existing `ISSUE #{n}: failed:{gate}` report line, gate `no-dispatch-host` (a gate name, not a new outcome word), emitted on every dispatched call (`run-state.json` `dispatched: true`), headless or not; the case skips steps 1-7 because no claim of this run's can exist: a dispatched first call stops at flow Step 2.4 before its own Step 2.8 claim, and a `dispatch resume` call mints a fresh run directory whose id no earlier claim carries (`dispatch/resume.md` Step 4 writes no claim). A dispatched second call (`review,polish,wrap-up`) has no `build`, so flow never probes it (Decision Q2). Q1's `/claude-tweaks:dispatch #{n}` stays the resume command; when the record already has an open draft PR, that command's open-pr line names `/claude-tweaks:dispatch resume #{n}` whenever resume would accept it (`dispatch/open-pr-exclusion-report.md`).
- Decision D5 (record body, verbatim): "Review detects "same session as build" only inside one `/claude-tweaks:flow` call that ran both steps, and the spec states this is effectively unreachable once Deliverable 1 lands. No session stamp."
- Decision D6 (record body, verbatim): "Closing rule: the decisions above settle this record's spec. Any further edge case the plan reviewer finds in these areas is the implementer's judgment, not a needs-human gap: the plan records the chosen behaviour, and the review step checks it. Plan review stops the build only for a gap that contradicts an Acceptance Criterion or a decision above."
- The existing per-lens `single-read coverage` line and the `Tiebreak caveat:` line stay byte-unchanged.
- Premise correction (logged at Spec Step 3): a fork is not automatically a no-`Agent` host — a probe run in a fork found `Agent` (archived run `2026-10-31T113847-record-4555`). The preflight keys on the probe's result alone, never on the host's shape. A cwd-pinned session that has an `Agent` tool is not a no-dispatch host and must not be stopped.
- Rail (`RAIL_BYTES` = 52,500 B, `plugin/bin/lib/skill-audit/budgets.js`) — headroom after the origin/main catch-up (`e84277599`): `flow/SKILL.md` 50,930 B (1,570 free; Task 2 adds ~830 B), `dispatch/settle-and-merge.md` 46,146 B (Task 6 adds ~900 B), `build/SKILL.md` 51,765 B (735 free; Task 2 adds ~460 B), `review/step3-lens-dispatch.md` 51,396 B (1,104 free; Task 4 adds ~820 B), `review/code-mode-steps.md` 51,037 B (1,463 free; Task 4 adds ~60 B), composed `worktree-setup` bundle (`_shared/worktree-setup.md` + `build/worktree-setup.md`, `plan-audit.js` reports max 51,890 B, 610 free; Task 3 adds ~380 B, leaving ~230). `merge-check.md` 12,534 B and `execution-mode-policy.md` 3,417 B are far from the rail. Keep each addition to the exact text below; if a `rail:` test fails, cut words from the new paragraph only — never trim neighbouring prose.
- Governing project skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted rules that apply to every test here:
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself. Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`." … "Keep the patterns non-global."
  - "Prove each assertion on a mutated copy of the live text instead … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit style: `{Verb} {what} — {detail} (refs #4555)`, never "closes"/"fixes"; end with `Claude-Session: https://claude.ai/code/session_01Ngy9oYqyy55AY9hCig2pZz`.

## Review Focus

- A cwd-pinned Task subagent *with* an `Agent` tool (this very dispatch shape) must not be stopped — the flow/build paragraphs key on "probe finds none", never on "subagent" or "fork". Task 1 pins the probe-result-decides sentence.
- A flow resume whose step list omits `build` (dispatch's `review,polish,wrap-up` call) must not be stopped — Task 2 pins "When the step list includes `build`" and "A step list without `build` skips it"; Task 5 pins that such a run's degraded review cannot auto-merge.
- The preflight must sit before Step 2.8's claim, so a never-buildable run leaves no claim or draft PR — Task 2 pins 2.4 before 2.8. Build's preflight must precede Common Step 1.6's plan-reviewer dispatch and run in design mode too — Task 2 pins it inside Common Step 1.5, before 1.6.
- The dispatch resume command must not be the `PIPELINE_RUN_DIR="…"`-prefixed flow invocation (it would point at a torn-down run) — Task 1 pins both routes of Decision Q1.
- D3: the policy section's `SKIP` instruction must not let flow Step 2.4 write to a run dir with no `config.yml` (a dispatched first call's minted dir, before the Manifesto) — a `decisions.md` line there would flip a resume's adoption from case 2 to case 3. Task 1 pins the config.yml condition.
- D4: Settle must not count a no-dispatch-host stop against `dispatch-retry-ceiling` or post a failure comment — Task 6 pins the special case and its `flow-step-2.4-no-dispatch-host` self-report name.
- Review's existing #3817 pins must still pass unchanged (exactly-one `single-read coverage. Reversibility: high.` in skills; the verdict paragraph's `Coverage caveat:** line verbatim`; `COMPACT_ELIGIBLE`'s unanchored regex survives the appended sentence) — Task 4 runs the whole existing suite.

---

### Task 1: No-dispatch host section in execution-mode-policy.md

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/execution-mode-policy.md` (append a section after `## Schema impact`)
- Create: `tests/no-dispatch-host-preflight-conformance.test.js`

**Interfaces:**
- Produces: the heading `## No-dispatch host (#4555)` — Tasks 2, 3 and 5 cite it as `execution-mode-policy.md`'s No-dispatch host section. The test file's helpers `missingFactsOf`, `assertEachPatternGoesRed`, `sectionOf(text, heading)` (returns text from the heading to the next `## ` or EOF; asserts the heading exists) and `lineStartingWith(text, prefix)` — Tasks 2, 3 and 5 append tests to this file using them.

- [ ] **Step 1: Write the failing test** in `tests/no-dispatch-host-preflight-conformance.test.js`. Header comment names #4555. Copy `missingFactsOf`, `assertEachPatternGoesRed` and `lineStartingWith` from `tests/review-dispatched-reviewer-degrade-conformance.test.js` (same shapes). Read via `readText` from `./helpers/read-skill`. Patterns over `sectionOf(policyText, '## No-dispatch host (#4555)')`:

```js
const POLICY_FACTS = [
  [/`_shared\/subagent-dispatch-core\.md`'s probe, "`ToolSearch` finds none, deferred or otherwise"/, 'AC5.1: cites the canonical no-Agent probe'],
  [/The probe's result decides, never the host's shape/, 'the probe result decides, not fork/pinned shape'],
  [/`\/claude-tweaks:flow` Step 2\.4 runs it whenever the step list includes `build`/, 'AC10.1: flow probes only build step lists'],
  [/`\/claude-tweaks:build` Common Step 1\.5 runs it before Common Step 1\.6's plan reviewer and Common Step 2's `subagent` execution/, 'AC1.3: build enforcement point'],
  [/never implement plan tasks inline, never switch to `batched` on the run's behalf/, 'AC2.2: stop, never inline, never auto-batched'],
  [/^ *BLOCKED — this host has no Agent\/Task tool, so the `subagent` execution strategy cannot run\.$/m, 'AC2.1: BLOCKED cause line'],
  [/^ *Resume from a top-level session:\n *\{resume command\}$/m, 'AC2.1: resume command on its own line'],
  [/`\{resume command\}` depends on how the run was started/, 'AC9.1: resume command depends on entry route'],
  [/Under `\/claude-tweaks:dispatch` \(`run-state\.json` `dispatched: true`\) it is `\/claude-tweaks:dispatch #\{n\}`, to use after dispatch's Settle procedure runs/, 'AC9.2: dispatch route names /claude-tweaks:dispatch #{n}'],
  [/Otherwise it repeats the invocation the stopped run received, keeping its `PIPELINE_RUN_DIR="…"` prefix whenever one was adopted/, 'AC9.3: other routes repeat the invocation, prefix kept'],
  [/When the record already has an open draft PR, that command's open-pr line names `\/claude-tweaks:dispatch resume #\{n\}` whenever resume would accept it \(`dispatch\/open-pr-exclusion-report\.md`\)/, 'AC9.2: an open draft PR routes to dispatch resume'],
  [/Or run it in-session, in human-reviewed batches: `\/claude-tweaks:build \{received target\} batched`/, 'AC3.1: batched named as explicit human choice'],
  [/`\{received target\}` is the `#\{n\}` or design-doc path the build received/, 'AC3.1: design-mode build has no record number'],
  [/Under `subagent-only` that line is omitted/, 'AC3.2: subagent-only omits batched'],
  [/--status SKIP --text "condition: no Agent\/Task tool in this host → fallback: run stopped before build; resume from a top-level session"/, 'AC4.1: SKIP line in condition → fallback shape'],
  [/at flow Step 2\.4 only when it already has `config\.yml`/, 'D3: flow 2.4 logs only into a dir with config.yml'],
  [/otherwise the `SKIP` text goes in the stop report only, so a resume never adopts the directory as a recovery \(`flow\/steps-and-gates\.md`'s case 3\)/, 'D3: no config.yml → stop report only, never case 3'],
  [/Under `\/claude-tweaks:dispatch` \(`run-state\.json` `dispatched: true`, headless or not\), report through its existing channel/, 'AC4.2: every dispatched call reports the gate line, not only headless'],
  [/`OUTCOME: build-test-blocked`, `STATUS: BLOCKED`, `ISSUE #\{n\}: failed:no-dispatch-host` — never a new outcome word/, 'AC4.2: dispatch headless reports build-test-blocked'],
  [/Settle treats it as a pre-flight stop \(`dispatch\/settle-and-merge\.md`'s No-dispatch-host special case\)/, 'D4: policy points at the Settle special case'],
  [/This stop tears nothing down itself/, 'resume leaves state in place'],
  [/under `current-branch` the open-items ledger flow Step 1 created/, 'current-branch ledger stays in place'],
  [/A flow resume whose step list omits `build` is not probed here/, 'AC10.2: build-less resumes proceed'],
];
```

Tests: `test('AC5.1 AC1.3 AC2.1 AC2.2 AC3.1 AC3.2 AC4.1 AC4.2 AC9.1 AC9.2 AC9.3 AC10.1 AC10.2 AC11.1 AC11.2 AC12.1: execution-mode-policy.md states the no-dispatch-host stop (#4555)', …)` asserting `missingFactsOf(POLICY_FACTS)(section)` deep-equals `[]`; and `test('AC8.2: each policy fact can go red', …)` calling `assertEachPatternGoesRed(section, POLICY_FACTS, missing)`. Negative pin `test('AC9.2: the dispatch route never names the prefixed flow invocation', …)`: the sentence starting `Under \`/claude-tweaks:dispatch\` (\`run-state.json\` \`dispatched: true\`) it is` (item 1's, not item 4's) does not contain `PIPELINE_RUN_DIR`; control: a copy with ` PIPELINE_RUN_DIR="x"` appended to that sentence fails the same check.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/no-dispatch-host-preflight-conformance.test.js`
Expected: FAIL with the `## No-dispatch host (#4555)` heading-not-found assertion.

- [ ] **Step 3: Append the section** to `plugin/skills/build/execution-mode-policy.md`, exactly:

````markdown

## No-dispatch host (#4555)

A host with no `Agent`/`Task` tool — `_shared/subagent-dispatch-core.md`'s probe, "`ToolSearch` finds none, deferred or otherwise" — is exactly the case this decision forbids silent inline execution for: `subagent` cannot run there, and implementing the plan's tasks in-session would be the unlicensed third path above. The probe's result decides, never the host's shape: a fork or a cwd-pinned Task subagent whose probe finds `Agent` is not a no-dispatch host (#4555 found `Agent` present in a fork).

The enforcement point is the dispatch-capability preflight. `/claude-tweaks:flow` Step 2.4 runs it whenever the step list includes `build`, before it claims targets or creates a worktree, fresh or resumed; `/claude-tweaks:build` Common Step 1.5 runs it before Common Step 1.6's plan reviewer and Common Step 2's `subagent` execution. When the probe finds none:

1. Stop: never implement plan tasks inline, never switch to `batched` on the run's behalf. Report BLOCKED with the cause, and the resume command on its own line:

   ```
   BLOCKED — this host has no Agent/Task tool, so the `subagent` execution strategy cannot run.
   Resume from a top-level session:
   {resume command}
   ```

   `{resume command}` depends on how the run was started. Under `/claude-tweaks:dispatch` (`run-state.json` `dispatched: true`) it is `/claude-tweaks:dispatch #{n}`, to use after dispatch's Settle procedure runs. When the record already has an open draft PR, that command's open-pr line names `/claude-tweaks:dispatch resume #{n}` whenever resume would accept it (`dispatch/open-pr-exclusion-report.md`). Otherwise it repeats the invocation the stopped run received, keeping its `PIPELINE_RUN_DIR="…"` prefix whenever one was adopted — e.g. `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow #{n} {steps}` or `/claude-tweaks:build {received target}`, where `{received target}` is the `#{n}` or design-doc path the build received.
2. A standalone `/claude-tweaks:build` whose `execution-strategy` is not `subagent-only` adds one line, a choice for a human and never taken automatically: Or run it in-session, in human-reviewed batches: `/claude-tweaks:build {received target} batched`. Under `subagent-only` that line is omitted — the lock forbids `batched`.
3. When a pipeline run directory resolves — at flow Step 2.4 only when it already has `config.yml` — log one line per `_shared/auto-decision-log.md`: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --text "condition: no Agent/Task tool in this host → fallback: run stopped before build; resume from a top-level session" --reversibility n/a`; otherwise the `SKIP` text goes in the stop report only, so a resume never adopts the directory as a recovery (`flow/steps-and-gates.md`'s case 3).
4. Under `/claude-tweaks:dispatch` (`run-state.json` `dispatched: true`, headless or not), report through its existing channel — `OUTCOME: build-test-blocked`, `STATUS: BLOCKED`, `ISSUE #{n}: failed:no-dispatch-host` — never a new outcome word; Settle treats it as a pre-flight stop (`dispatch/settle-and-merge.md`'s No-dispatch-host special case).
5. This stop tears nothing down itself: what already exists — on a resume the claim, worktree and draft PR, under `current-branch` the open-items ledger flow Step 1 created — stays in place for the resume (under dispatch, its Settle procedure still acts on the reported outcome).
6. A flow resume whose step list omits `build` is not probed here: `/claude-tweaks:review`'s run-level **Independence: degraded** caveat covers it, and `assess-agent-autonomy`'s `merge-check` then routes that run's merge to a human.
````

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/no-dispatch-host-preflight-conformance.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit** — `git add` the two files by path; message `Name the no-dispatch host in execution-mode-policy — stop, resume command, SKIP line (refs #4555)`.

---

### Task 2: Preflight paragraphs in flow SKILL.md and build SKILL.md

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/flow/SKILL.md` (Step 2 list, lines ~139-140)
- Modify: `plugin/skills/build/SKILL.md` (Common Step 1.5, directly under its `### Common Step 1.5: Plan Audit` heading)
- Modify: `docs/skill-graph.md` (`## flow` table: one new row for target `build/execution-mode-policy.md`)
- Modify: `tests/flow-blocker-landing-conformance.test.js` (its Step 2 count-word pin, lines ~319-325)
- Test: `tests/no-dispatch-host-preflight-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's heading and test helpers.

- [ ] **Step 1: Append failing tests.** Also update `tests/flow-blocker-landing-conformance.test.js`'s count pin to the new sentence: `COUNT_MSG` reads `"Step 2's count word is five checks, after the dispatch-capability preflight"`, `assertCount` matches `/\nA dispatch-capability preflight, five checks, then a route, before pipeline starts\./`, and its control mutates `'five checks, then a route'` to `'four checks, then a route'` (the control must still go red; nothing else in that test changes). Region helpers: flow's item = `lineStartingWith(flowText, '- 2.4 — Dispatch-capability preflight (#4555).')`; build's paragraph = `lineStartingWith(buildText, '**Dispatch-capability preflight (#4555), first, whatever this step\'s skip gate decides:**')`. Assert each is non-empty.

```js
const FLOW_FACTS = [
  [/When the step list includes `build`/, 'AC10.1: flow gates only a step list with build'],
  [/on every entry — fresh, or a resume \(a step-list resume or an adopted `PIPELINE_RUN_DIR`\)/, 'AC1.2: flow runs it again on a build resume'],
  [/`_shared\/subagent-dispatch-core\.md`'s no-`Agent` probe/, 'AC1.1: flow cites the probe'],
  [/before 2\.5-2\.8, so a host that can never build leaves no claim or draft PR behind/, 'AC1.2: flow runs it before claim and worktree creation'],
  [/A step list without `build` skips it \(review's run-level \*\*Independence: degraded\*\* caveat covers that run\)/, 'AC10.2: build-less resumes proceed'],
  [/stop BLOCKED per `build\/execution-mode-policy\.md`'s No-dispatch host section/, 'AC2.1: flow stop cites the policy section'],
  [/never implement plan tasks inline/, 'AC2.2: flow never inline'],
];
const BUILD_FACTS = [
  [/before Common Step 1\.6's plan reviewer and Common Step 2's `subagent` execution/, 'AC1.3: build runs it before subagent execution (and before 1.6)'],
  [/`_shared\/subagent-dispatch-core\.md`'s no-`Agent` probe/, 'AC1.1: build cites the probe'],
  [/stop BLOCKED per `execution-mode-policy\.md`'s No-dispatch host section/, 'AC2.1: build stop cites the policy section'],
  [/never implement the plan's tasks inline, and never switch to `batched` on the run's behalf/, 'AC2.2: build never inline, never auto-batched'],
];
```

Tests: `test('AC1.1 AC1.2 AC2.1 AC2.2 AC10.1 AC10.2: flow Step 2.4 runs the dispatch-capability preflight (#4555)')`, `test('AC1.1 AC1.3 AC2.1 AC2.2: build Common Step 1.5 runs the dispatch-capability preflight (#4555)')`, each with a go-red twin via `assertEachPatternGoesRed`. Ordering pin `test('AC1.2: flow 2.4 precedes 2.8 (claim)')` — `indexOf('- 2.4 — Dispatch-capability preflight')` is `>= 0` and less than `indexOf('- 2.8 — Claim the targets')`, with a control that swaps the two lines in memory and asserts the comparison flips. Build placement pin `test('AC1.3: build preflight sits in Common Step 1.5, before Common Step 1.6')` — the paragraph's index lies between `indexOf('### Common Step 1.5: Plan Audit')` and `indexOf('### Common Step 1.6: Plan Review')`, with a control that moves the paragraph after the 1.6 heading in memory and asserts the check fails. Negative sweep `test('AC2.2: neither SKILL.md tells the agent to implement plan tasks inline')`: no line of either file matches `/implement(?:s|ing)? (?:the plan(?:'s tasks)?|plan tasks) inline/i` unless the same line also matches `/never implement/i`; control: append `Implement plan tasks inline.` to a copy and assert the sweep reports it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/no-dispatch-host-preflight-conformance.test.js`
Expected: FAIL on the missing `- 2.4 — Dispatch-capability preflight (#4555).` line.

- [ ] **Step 3: Edit the skills.**

In `plugin/skills/flow/SKILL.md` Step 2, change `Five checks, then a route, before pipeline starts.` (the #4553 blocker-landing change already made it "Five", adding 2.7b) to `A dispatch-capability preflight, five checks, then a route, before pipeline starts.` and insert directly above the `- 2.5 — Branch-divergence check` line:

```markdown
- 2.4 — Dispatch-capability preflight (#4555). When the step list includes `build`, on every entry — fresh, or a resume (a step-list resume or an adopted `PIPELINE_RUN_DIR`) — probe for an `Agent`/`Task` tool with `_shared/subagent-dispatch-core.md`'s no-`Agent` probe, before 2.5-2.8, so a host that can never build leaves no claim or draft PR behind. A step list without `build` skips it (review's run-level **Independence: degraded** caveat covers that run). None found → stop BLOCKED per `build/execution-mode-policy.md`'s No-dispatch host section (resume command, `SKIP` line, `build-test-blocked` under dispatch); never implement plan tasks inline.
```

In `plugin/skills/build/SKILL.md`, insert a new paragraph (blank line before and after) directly after the `### Common Step 1.5: Plan Audit` heading line, before the paragraph starting `Audit the plan against the actual repo`. It lives here, not in Common Step 2, because Common Step 1.6 dispatches a plan reviewer first and design mode skips 1.6 entirely; 1.5 runs in both modes, whatever its own skip gate decides:

```markdown
**Dispatch-capability preflight (#4555), first, whatever this step's skip gate decides:** under `subagent`, probe for an `Agent`/`Task` tool with `_shared/subagent-dispatch-core.md`'s no-`Agent` probe, before Common Step 1.6's plan reviewer and Common Step 2's `subagent` execution. None found → stop BLOCKED per `execution-mode-policy.md`'s No-dispatch host section — never implement the plan's tasks inline, and never switch to `batched` on the run's behalf.
```

In `docs/skill-graph.md`'s `## flow` table, add one row in that table's existing column shape: target `build/execution-mode-policy.md`; relationship: Step 2.4's dispatch-capability preflight (#4555) — run only when the step list includes `build` — stops a no-`Agent` host by citing that file's No-dispatch host section (stop message, resume command, `SKIP` line, `build-test-blocked`), which `/build` Common Step 1.5 cites too; the probe itself is `_shared/subagent-dispatch-core.md`'s.

- [ ] **Step 4: Verify.** Run, each its own call:
  - `node --test tests/no-dispatch-host-preflight-conformance.test.js` → PASS
  - `node --test tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js` → PASS
  - `node --test tests/flow-preflight-conformance.test.js tests/flow-claim-preflight.test.js tests/flow-blocker-landing-conformance.test.js` → PASS
  - `wc -c plugin/skills/flow/SKILL.md plugin/skills/build/SKILL.md` → each under 52500
  - Renumbering sweep (three forms): `git grep -n -i "five checks" -- plugin docs tests`, `git grep -n "2\.5-2\.[0-9]" -- plugin/skills/flow`, `git grep -n -i "five pre-flight\|four checks\|four pre-flight" -- plugin/skills docs tests` — every hit either already updated or not about flow Step 2.

- [ ] **Step 5: Commit** — the four files plus the new test by path; message `Add the dispatch-capability preflight to flow Step 2.4 and build Common Step 1.5 (refs #4555)`.

---

### Task 3: Cwd-pinned pointer in build/worktree-setup.md

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/worktree-setup.md` (one paragraph directly after the `## If worktree creation fails` table, before `## Impeccable hook consent (per-worktree)`)
- Modify: `docs/skill-graph.md` (`## build` table: one new row for target `dispatch/sequential-execution.md`)
- Test: `tests/no-dispatch-host-preflight-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's heading and test helpers.

- [ ] **Step 1: Append failing tests** over `lineStartingWith(text, '**Cwd-pinned session (#4555).**')` (asserted non-empty):

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

- [ ] **Step 3: Insert the paragraph** (blank line before and after), exactly:

```markdown
**Cwd-pinned session (#4555).** A session whose cwd the harness pins (`EnterWorktree` refused) follows `dispatch/sequential-execution.md`'s "When the dispatching session itself is cwd-pinned (#447)" section instead; that mechanism is not restated here. With an `Agent` tool it is not a no-dispatch host (`execution-mode-policy.md`'s No-dispatch host section).
```

In `docs/skill-graph.md`'s `## build` table add a row: target `dispatch/sequential-execution.md`; relationship: `worktree-setup.md`'s Cwd-pinned session paragraph (#4555) routes a harness-pinned session to that file's #447 section rather than restating the `git worktree add` + `cd`-prefix mechanism.

- [ ] **Step 4: Verify.** Each its own call:
  - `node --test tests/no-dispatch-host-preflight-conformance.test.js` → PASS
  - `node --test tests/bin-lib/skill-audit/context-cost.test.js` → PASS (the composed `worktree-setup` bundle stays under 52,500 B; its max goes from 51,890 B to about 52,270 B)
  - `node --test tests/build-worktree-setup-dispatch-stamp.test.js tests/worktree-setup-catchup-no-run-dir.test.js tests/worktree-setup-plugin-root-literal.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js` → PASS

- [ ] **Step 5: Commit** — files by path; message `Point build worktree setup at dispatch's #447 mechanism for cwd-pinned sessions (refs #4555)`.

---

### Task 4: Run-level Independence: degraded marker in review

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (new blockquote note directly after the `> **Foreground Execution Discipline:**` line, separated by a blank line)
- Modify: `plugin/skills/review/review-summary-template.md` (compact eligibility sentence, line ~10; a new slot line directly after each of the two `**Coverage caveat:**` slot lines, ~23 and ~40)
- Modify: `plugin/skills/review/code-mode-steps.md` (Verdict comment paragraph, ~line 391)
- Modify: `docs/skill-graph.md` (`## review` section's existing `_shared/subagent-dispatch-core.md` row: append one sentence)
- Test: `tests/review-dispatched-reviewer-degrade-conformance.test.js` (append)

**Interfaces:**
- Produces: the run-level SKIP text `condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself` on the line starting `> **No \`Agent\` tool in this host (run-level, #4555).**` — Task 5's merge-check floor quotes it verbatim and its test compares the two.

- [ ] **Step 1: Append failing tests** to `tests/review-dispatched-reviewer-degrade-conformance.test.js`, reusing its `missingFactsOf`, `assertEachPatternGoesRed`, `lineStartingWith`, `summaryForms`, `verdictParagraph`:

```js
const RUN_LEVEL_PREFIX = '> **No `Agent` tool in this host (run-level, #4555).**';
const RUN_LEVEL_FACTS = [
  [/When Step 3 starts, probe once with `_shared\/subagent-dispatch-core\.md`'s no-`Agent` probe/, 'AC6.1: run-level probe at Step 3 start'],
  [/--status SKIP --text "condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself"/, 'AC6.1: one run-level log line'],
  [/render `review-summary-template\.md`'s \*\*Independence: degraded\*\* line, which the PR verdict comment copies/, 'AC6.1: caveat reaches summary and verdict comment'],
  [/The per-lens single-read lines below and the tiebreak's ` Mode: inline\.`\/`Tiebreak caveat:` lines still write, unchanged/, 'AC6.2: per-lens and tiebreak lines unchanged'],
  [/Same session as build is known only inside one `\/claude-tweaks:flow` call that ran `build` too/, 'D5: same-session detection scope'],
  [/effectively unreachable, since flow and build stop a no-dispatch host before building; no session stamp/, 'D5: states it is effectively unreachable, no stamp'],
];
const INDEPENDENCE_SLOT = [
  [/\{only when Step 3 found no Agent tool — `step3-lens-dispatch\.md`'s run-level no-Agent note:\}/, 'the slot cites the run-level note'],
  [/\*\*Independence: degraded\*\* — no Agent tool in this host; every lens and tiebreak was judged by the reviewer itself/, 'AC6.1: the spec caveat text'],
  [/\{only when this review runs in the same `\/claude-tweaks:flow` call whose step list also ran `build` — omitted when that is unknown, e\.g\. a standalone review:; the reviewer is the same session that ran this build's implementation\}/, 'AC6.1: same-session clause with its detection signal and unknown-case omission'],
];
const VERDICT_INDEPENDENCE = [[/then its \*\*Independence: degraded\*\* line verbatim when it rendered/, 'AC6.1: verdict comment copies the Independence line']];
```

Tests (each with a go-red twin): `AC6.1 AC6.2 AC13.1: step3-lens-dispatch.md states the run-level no-Agent note` (over `lineStartingWith(text, RUN_LEVEL_PREFIX)`, asserted non-empty); `AC6.1: summary template carries the Independence slot in compact and full forms` (over each of `summaryForms`'s halves); `AC6.1: verdict comment copies the Independence line` (over `verdictParagraph`); `the compact form says an Independence line does not disqualify it` (pattern `/An \*\*Independence: degraded\*\* line is informational the same way\./`). Also `AC6.2: the per-lens and tiebreak caveat lines are unchanged` — `review-summary-template.md` still contains, byte-for-byte, the existing `**Tiebreak caveat:** {n} verdict(s) read inline by the reviewer, not an independent agent ({reason, e.g. no \`Agent\` tool, timed out})` line; the existing `partner-died paragraph states the degrade line shape and caveat once` test already pins the single-read line.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-dispatched-reviewer-degrade-conformance.test.js`
Expected: FAIL after Step 1, on the new run-level note assertion (existing tests still pass).

- [ ] **Step 3: Edit the review files.**

`step3-lens-dispatch.md` — insert after the Foreground note line, with one blank line before:

```markdown
> **No `Agent` tool in this host (run-level, #4555).** When Step 3 starts, probe once with `_shared/subagent-dispatch-core.md`'s no-`Agent` probe. None found → log one line, `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --text "condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself" --reversibility n/a` (standalone: one line in the report), and render `review-summary-template.md`'s **Independence: degraded** line, which the PR verdict comment copies. The per-lens single-read lines below and the tiebreak's ` Mode: inline.`/`Tiebreak caveat:` lines still write, unchanged. Same session as build is known only inside one `/claude-tweaks:flow` call that ran `build` too — effectively unreachable, since flow and build stop a no-dispatch host before building; no session stamp.
```

`review-summary-template.md` — append to the compact eligibility bullet (after `…does not disqualify the compact form either.`): ` An **Independence: degraded** line is informational the same way.` Then after each `**Coverage caveat:**` slot line insert:

```markdown
{only when Step 3 found no Agent tool — `step3-lens-dispatch.md`'s run-level no-Agent note:} **Independence: degraded** — no Agent tool in this host; every lens and tiebreak was judged by the reviewer itself{only when this review runs in the same `/claude-tweaks:flow` call whose step list also ran `build` — omitted when that is unknown, e.g. a standalone review:; the reviewer is the same session that ran this build's implementation}
```

`code-mode-steps.md` — in the Verdict comment paragraph change `then the summary's **Coverage caveat:** line verbatim when it rendered, then the` to `then the summary's **Coverage caveat:** line verbatim when it rendered, then its **Independence: degraded** line verbatim when it rendered, then the`.

`docs/skill-graph.md` `## review`'s `_shared/subagent-dispatch-core.md` row — append: `Since #4555 Step 3 also runs that file's no-\`Agent\` probe once at its start; none found writes one run-level \`SKIP\` line and the summary's **Independence: degraded** caveat, which the verdict comment copies, alongside (never replacing) the per-lens and tiebreak degrade lines.`

- [ ] **Step 4: Verify.** Each its own call:
  - `node --test tests/review-dispatched-reviewer-degrade-conformance.test.js` → PASS (old and new)
  - `node --test tests/review-tiebreak-step-conformance.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js` → PASS
  - `wc -c plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/code-mode-steps.md` → each under 52500

- [ ] **Step 5: Commit** — files by path; message `Stamp a run-level Independence: degraded caveat when review has no Agent tool (refs #4555)`.

---

### Task 5: merge-check routes an Independence: degraded review to a human

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/assess-agent-autonomy/merge-check.md` (Step 2: new bullet directly after the `**Review's findings are a hard input, not advisory**` bullet; the Calibration closing sentence at lines ~127-129; one Anti-Patterns row)
- Modify: `docs/skill-graph.md` (`## review` table: one new row for target `/assess-agent-autonomy`)
- Test: `tests/no-dispatch-host-preflight-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's test helpers; Task 4's run-level SKIP text on the `> **No \`Agent\` tool in this host (run-level, #4555).**` line of `plugin/skills/review/step3-lens-dispatch.md`.

**Why merge-check is the one site (behavioral-claim / gate-over-producers trace):** every auto-merge path requires a `merge-check` verdict of `auto-merge` — `wrap-up/auto-merge-short-circuit.md` Layer 2 (singleton, and `manifesto-authorized-merge.md`'s pre-authorized merge, whose line 23 keeps Layer 2), `dispatch/settle-and-merge.md`'s Auto-merge gate Layer 2 (group), and `_shared/express-lane.md` (runs no review, so the floor never fires there). A `needs-human` verdict then falls to "Any layer fails" / pending-review, and `wrap-up/review-console.md`'s and `flow/multispec-review-console.md`'s Needs-human carve-out keeps `consoleAutoResolve`'s default-merge from overriding it; `_shared/local-merge-auto-finish.md` runs only after that console decision. No other merge path exists (`grep -rln "merge-check" plugin/skills plugin/bin` lists the consumers). The signal's one producer is Task 4's `SKIP` line; the review summary's **Independence: degraded** line is its rendered copy.

- [ ] **Step 1: Append failing tests.** Region = `lineStartingWith(mergeCheckText, '- **An `Independence: degraded` review is a hard floor (#4555)**')`, asserted non-empty.

```js
const MERGE_FLOOR_FACTS = [
  [/if `\$PIPELINE_RUN_DIR\/decisions\.md` — or, when `--pack` was passed, the `decisions\.md` beside that pack — carries `\/claude-tweaks:review`'s run-level no-`Agent` `SKIP` line/, 'AC10.3: keys on review\'s run-level SKIP line, in a named file'],
  [/`condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself`/, 'AC10.3: quotes the exact SKIP text'],
  [/or its review summary rendered the \*\*Independence: degraded\*\* line \(with no run directory to read, that summary line alone decides\), render `needs-human`/, 'AC10.3: renders needs-human; no run dir → summary line decides'],
  [/so its merge routes to a human\. Do not weigh anything else\./, 'AC10.3: merge decision routes to a human, hard floor'],
];
```

Tests: `test('AC10.3: merge-check renders needs-human for an Independence: degraded review (#4555)')` asserting `missingFactsOf(MERGE_FLOOR_FACTS)(bullet)` is `[]`, with its go-red twin. `test('AC10.3: the SKIP text merge-check reads is the text review writes')`: extract `/condition: no Agent tool in this host → fallback: [^"`]+/` from Task 4's step3 line and from the merge-check bullet; assert equal; control: replace `reviewer itself` with `reviewer` in a copy of the step3 line (`assert.notEqual` first) and assert the comparison fails. `test('the Calibration closing sentence lists the Independence floor')`: merge-check text matches `/Every floor stated above still applies on its own terms: a\s+sensitive-path hit renders `needs-human` with nothing else weighed, and so do any review finding\s+at Medium or above and an `Independence: degraded` review\./` and no longer contains `Both floors stated above`; control: the pre-change sentence (inline literal) fails the first assertion. `test('merge-check Anti-Patterns names the Independence floor')`: a line starts with `` | Rendering `auto-merge` after a review marked `Independence: degraded` | ``.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/no-dispatch-host-preflight-conformance.test.js`
Expected: FAIL on the missing `- **An \`Independence: degraded\` review is a hard floor (#4555)**` bullet.

- [ ] **Step 3: Edit merge-check.md.**

Insert as one line directly after the `**Review's findings are a hard input, not advisory**` bullet (it ends `this mode never overrides a real review finding.`):

```markdown
- **An `Independence: degraded` review is a hard floor (#4555)**: if `$PIPELINE_RUN_DIR/decisions.md` — or, when `--pack` was passed, the `decisions.md` beside that pack — carries `/claude-tweaks:review`'s run-level no-`Agent` `SKIP` line (`review/step3-lens-dispatch.md`'s run-level note, text `condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself`), or its review summary rendered the **Independence: degraded** line (with no run directory to read, that summary line alone decides), render `needs-human` — no independent agent reviewed this diff, so its merge routes to a human. Do not weigh anything else.
```

Replace the Calibration closing sentence `Both floors stated above still apply on their own terms: a\nsensitive-path hit renders \`needs-human\` with nothing else weighed, and so does any review finding\nat Medium or above.` with `Every floor stated above still applies on its own terms: a\nsensitive-path hit renders \`needs-human\` with nothing else weighed, and so do any review finding\nat Medium or above and an \`Independence: degraded\` review.` (keep the existing line breaks; the trailing `Match a row here…` sentence is unchanged).

Append to the Anti-Patterns table:

```markdown
| Rendering `auto-merge` after a review marked `Independence: degraded` | No independent agent reviewed that diff; the floor routes its merge to a human whatever the diff looks like. |
```

In `docs/skill-graph.md`'s `## review` table add a row: target `/assess-agent-autonomy`; relationship: Since #4555, `merge-check.md`'s Independence floor reads Step 3's run-level no-`Agent` `SKIP` line (`step3-lens-dispatch.md`) and renders `needs-human`, so a review whose lenses and tiebreaks were all self-judged never auto-merges — every auto-merge path (`wrap-up/auto-merge-short-circuit.md`, `dispatch/settle-and-merge.md`) requires that verdict.

- [ ] **Step 4: Verify.** Each its own call:
  - `node --test tests/no-dispatch-host-preflight-conformance.test.js` → PASS
  - `node --test tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js` → PASS
  - `git grep -n -F "Both floors stated above" -- plugin tests docs` → no output (control: `git show HEAD~1:plugin/skills/assess-agent-autonomy/merge-check.md | grep -n -F "Both floors stated above"` prints line 127)
  - `grep -rln "Independence: degraded" plugin tests docs/skill-graph.md` → `execution-mode-policy.md`, `flow/SKILL.md`, the three review files, `merge-check.md`, the two test files, `docs/skill-graph.md` (and nothing else)

- [ ] **Step 5: Commit** — files by path; message `Route an Independence: degraded review's merge to a human in merge-check (refs #4555)`.

---

### Task 6: Settle treats a no-dispatch-host stop as a pre-flight stop

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md` (one paragraph directly after the `**Plan-review needs-human special case (#3377).**` paragraph, before the numbered step `1. The CLI in step 2 performs the ownership read itself`, blank line before and after)
- Modify: `docs/skill-graph.md` (`## dispatch` table: one new row for target `build/execution-mode-policy.md`)
- Test: `tests/no-dispatch-host-preflight-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's test helpers and its `ISSUE #{n}: failed:no-dispatch-host` report line (item 4 of the No-dispatch host section).

- [ ] **Step 1: Append failing tests** over `lineStartingWith(settleText, '**No-dispatch-host special case (#4555).**')` (asserted non-empty):

```js
const SETTLE_FACTS = [
  [/`ISSUE #\{n\}: failed:no-dispatch-host`/, 'D4: Settle recognizes the stop by its gate line'],
  [/treat it as a pre-flight stop, like the claims-branch-missing stop above/, 'D4: pre-flight-stop special case'],
  [/so no claim of this run's exists/, 'D4: no claim of this run\'s exists at the stop'],
  [/Skip steps 1-7: no release, no `failure-check` classification, no attempt counted against `dispatch-retry-ceiling`, no failure comment/, 'D4: steps 1-7 skipped — no release, classification, retry count or failure comment'],
  [/When `DISPATCH_HEADLESS=1` was set, read /, 'D4: the self-report is gated on DISPATCH_HEADLESS=1'],
  [/`_shared\/headless-self-report\.md` and follow its dedup-and-file procedure/, 'D4: headless self-report'],
  [/failing-check-name `flow-step-2\.4-no-dispatch-host`/, 'D4: self-report name'],
];
```

Tests: `test('AC12.1 AC12.2: Settle settles a no-dispatch-host stop as a pre-flight stop (#4555)')` asserting `missingFactsOf(SETTLE_FACTS)(paragraph)` is `[]`, with its go-red twin. Placement pin `test('AC12.1: the special case sits before Settle step 1')`: the paragraph's index is `>= 0` and below `indexOf('1. The CLI in step 2 performs the ownership read itself')`; control: a copy with the paragraph moved after that line fails the check. Cross-file pin `test('AC12.1: Settle and the policy section name the same gate')`: the gate token `failed:no-dispatch-host` appears in both Task 1's section and the Settle paragraph; control: a copy of the Settle paragraph with `no-dispatch-host` replaced by `no-dispatch` (`assert.notEqual` first) fails.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/no-dispatch-host-preflight-conformance.test.js`
Expected: FAIL on the missing `**No-dispatch-host special case (#4555).**` paragraph.

- [ ] **Step 3: Insert the paragraph**, exactly:

```markdown
**No-dispatch-host special case (#4555).** When the failure this call is settling is the dispatch-capability preflight's stop (`ISSUE #{n}: failed:no-dispatch-host`, `build/execution-mode-policy.md`'s No-dispatch host section), treat it as a pre-flight stop, like the claims-branch-missing stop above: the host, not the record, is at fault. It stops before this run's Step 2.8 claim — and a `dispatch resume` call's fresh run directory is one no earlier claim names — so no claim of this run's exists. Skip steps 1-7: no release, no `failure-check` classification, no attempt counted against `dispatch-retry-ceiling`, no failure comment, and no PR tombstone. When `DISPATCH_HEADLESS=1` was set, read `_shared/headless-self-report.md` and follow its dedup-and-file procedure (caller = `dispatch`), failing-check-name `flow-step-2.4-no-dispatch-host`, with the stop report as the diagnostic body.
```

In `docs/skill-graph.md`'s `## dispatch` table add a row: target `build/execution-mode-policy.md`; relationship: Since #4555, `settle-and-merge.md`'s No-dispatch-host special case recognizes that file's No-dispatch host stop (`ISSUE #{n}: failed:no-dispatch-host`) and settles it as a pre-flight stop — no `failure-check`, no retry count, no failure comment — filing headless through `_shared/headless-self-report.md` as `flow-step-2.4-no-dispatch-host`.

- [ ] **Step 4: Verify.** Each its own call:
  - `node --test tests/no-dispatch-host-preflight-conformance.test.js` → PASS
  - `node --test tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js` → PASS
  - `node --test tests/dispatch-retry-prior-attempt-conformance.test.js tests/dispatch-resume-prose.test.js` → PASS
  - `wc -c plugin/skills/dispatch/settle-and-merge.md` → under 52500

- [ ] **Step 5: Commit** — files by path; message `Settle a no-dispatch-host stop as a pre-flight stop in dispatch — no retry count, headless self-report (refs #4555)`.

---

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 / AC1.1-1.3, AC2.1-2.2, AC3.1-3.2, AC4.1-4.2 | 1 (procedure), 2 (entry points) |
| Deliverable 2 / AC5.1 | 1 |
| Deliverable 3 / AC6.1-6.2 | 4 |
| Deliverable 4 / AC7.1 | 3 |
| Deliverable 5 / AC8.1, AC8.2 | 1-5 (pins + go-red twins) |
| AC8.3 (`npm test` passes) | Common Step 5 final verification (full suite, run centrally) |
| Decision Q1 / AC9.1-9.3 | 1 |
| Decision Q2 / AC10.1-10.2 | 1, 2 |
| Decision Q2 / AC10.3 (never auto-merges, test pins it) | 5 |
| AC10.4 (amends AC1's "again on resume") | 2 (the flow item says a step list without `build` skips it) |
| Decision D3 / AC11.1-11.2 (SKIP only into a dir with `config.yml` at flow 2.4); AC11.3 (narrows AC4's logging clause — the narrowed item 3 is that clause) | 1 |
| Decision D4 / AC12.1-12.2 (Settle pre-flight-stop special case, headless self-report) | 1 (report line), 6 |
| Decision D5 / AC13.1-13.2 (same-session detection scope, effectively unreachable, no stamp) | 4 |
| Decision D6 (closing rule) | — (governs plan review; the implementer judgment it licenses is recorded in Global Constraints' D4 bullet) |

Waived AC9.4: "(Plan-review Q1: Reading B.)" is provenance, not a behavior to test.
Waived AC10.5: "(Q2: Reading B, with the auto-merge condition.)" is provenance, not a behavior to test.
Waived AC11.4: "(Plan-review Q1: Reading B.)" is provenance, not a behavior to test.
Waived AC12.3: "(Q2: Reading B.)" is provenance, not a behavior to test.
Waived AC13.3: "(Q3: Reading A.)" is provenance, not a behavior to test.
Waived AC14.1: the closing rule governs plan review, not a skill behavior to test.
Waived AC14.2: the closing rule governs plan review, not a skill behavior to test.
Waived AC14.3: the closing rule governs plan review, not a skill behavior to test.

Waived plugin/skills/_shared/subagent-dispatch-core.md: read-only — Tasks 1, 2 and 4 cite its no-`Agent` probe; the probe text was re-read at plan time (line ~77) and needs no change.
Waived _shared/subagent-dispatch-core.md: same file as above, short-form citation.
Waived plugin/skills/dispatch/sequential-execution.md: read-only — Task 3 cites its "When the dispatching session itself is cwd-pinned (#447)" heading, confirmed present at line 9.
Waived tidy/console-backfill.md: read-only — the spec's detect-and-stop precedent, cited in rationale only; nothing here edits or cites it.
Waived docs/skill-authoring.md: read-only — authoring conventions the paragraphs follow (cite, don't restate); no change.
