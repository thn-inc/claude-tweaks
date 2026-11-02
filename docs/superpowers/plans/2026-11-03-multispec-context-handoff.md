# Multi-Spec Context Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sequential multi-spec `/flow` run that crosses the 200k context cap at a phase boundary hands off, and its continuation resumes each record at that record's own step without re-running a completed step.

**Architecture:** One grammar, `#A:none;#B:build,test`, parsed by one module (`plugin/bin/lib/flow/record-steps.js`) and used on every surface: `context-gauge.js --record-steps`, `handoff.json`'s `recordSteps` and `resume`, the `NEXT_STEPS:` report line, and `/flow`'s new `record-steps=` token. A per-record list runs exactly its steps (no resume-onward, no auto-insert), and `none` keeps a finished record in the run's target list so its claim and the consolidated console still cover it.

**Tech Stack:** Node 18+ CJS under `plugin/bin/`, `node --test`, markdown skills.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T233750-record-4358/work/4358-spec.md`

Scope keywords: context-gauge, handoff.json, NEXT_STEPS, parseNextSteps

## Global Constraints

- Contract changes are expand-only. Every flat `--next-steps` / `NEXT_STEPS: test` / `handoff.json` shape stays byte-identical for a single-record run. An existing test asserting a flat result keeps passing unedited (`{ ok: true, steps }` gains no key).
- `RAIL_BYTES` is 52,500 B. Merge-base sizes: `plugin/skills/flow/SKILL.md` 51,654 B (headroom 846, this plan spends at most 450), `plugin/skills/dispatch/task-prompt.md` 52,420 B (headroom 80, this plan only shrinks it), `plugin/skills/dispatch/two-call-gate.md` 23,523 B, `plugin/skills/flow/context-handoff.md` 16,175 B, `plugin/skills/flow/multi-spec.md` 23,081 B, `plugin/skills/flow/steps-and-gates.md` 40,929 B.
- `record-steps=` is a `(producer-only)` bullet under `/flow`'s `## Input` (that section holds no table; the bullet form is the one `docs/skill-authoring.md`'s `argument-hint` bullet allows), because only the gauge's `resume` line and the dispatcher compose it. Per `docs/skill-authoring.md`'s `argument-hint` bullet it stays out of the hint and all mirrors, so the frontmatter and `## Syntax` do not change.
- Quoted from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe." Also: "**A value-taking flag given as the last argv element reads `undefined`, and a `!== null` presence check treats that as supplied.**" Validate with `typeof v !== 'string' || !v.trim() || v.startsWith('--')`. Look flags up with `Object.hasOwn(FLAGS, a)`. `run(argv, deps)` carries every side effect.
- Quoted from the same file, for the new `--record-steps` flag: "**Adding a flag that a CLI forwards into a library function needs one CLI-level test of the forwarding, and the same sweep of every restated command line.**" Sweep: `git grep -n -F -e '--next-steps' -- plugin docs .claude/skills`.
- Quoted from `.claude/skills/prose-code-twin-pin/SKILL.md`: "a test only asserting that individual literal strings are *present* somewhere is not" a real pin. The grammar's vocabulary (`FLOW_STEPS`) has one code source, so the module imports it and restates nothing.
- Quoted from `.claude/skills/skill-prose-conformance-tests`: a go-red control runs the same assertion code as the positive test, against mutated input. Factor conformance assertions into one function both tests call (see also `plan-authoring-checks.md`'s Go-red control check).
- Implementers: commit messages say `refs #4358`, never `closes`/`fixes`. Commit style `{Verb} {what} — {detail}`. Run targeted suites only (the full suite runs centrally). Run `pwd` and `git rev-parse --show-toplevel` as plain commands before committing; both must be `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4358`. One plain command per Bash call: no `&&`, no `cd`, no heredoc, no `$(...)`. Never `git stash`. Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- Path-guard: new `plugin/bin/lib/` code reads no file through `fs.existsSync`; `tests/path-guard-conformance.test.js` scans it.

## Review Focus

- A later record that has not started has no `spec-{N}/` dir yet, so the gauge's record set must come from `manifest.yml`, never from `resolveTargetRecords`' spec dirs. Pinned in Task 2.
- A one-entry per-record list (`#B:test`) runs exactly `test`, never "resume onward" to `wrap-up`. Pinned in Task 4.
- A flat `NEXT_STEPS: test` from a bundle would re-run records already past the boundary, so the dispatcher refuses it. Pinned in Task 3.
- The per-run `HANDOFF_BOUND` still applies to a `--record-steps` handoff. Pinned in Task 2.
- A resumed record whose `spec-{N}/config.yml` exists must not be re-scaffolded: the `cp` would overwrite an in-place lever edit (the ceremony escape hatch). Pinned in Task 4.

---

### Task 1: The per-record grammar and its CLI

**Files:**
- Create: `plugin/bin/lib/flow/record-steps.js`
- Create: `plugin/bin/record-steps.js`
- Test: `tests/bin-lib/flow/record-steps.test.js`

**Interfaces:**
- Produces: `parseRecordSteps(raw: string, { allowed = FLOW_STEPS minus 'review-console', targets = null } = {}) -> { ok: true, records: string[], recordSteps: { [record]: string[] }, steps: string[], canonical: string } | { ok: false, reason: string, message: string }`. `steps` is the union in `FLOW_STEPS` order. `canonical` is `formatRecordSteps(recordSteps)`.
- Produces: `formatRecordSteps(recordSteps) -> string`, an empty list printing `none`.
- Produces: CLI `node bin/record-steps.js --value <value> [--targets "#A,#B"]`: exit 0 prints `{records, recordSteps, steps, canonical}`; exit 2 on a malformed invocation or an invalid value, stderr naming the reason, nothing on stdout. No run dir, no 1 or 3.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/flow/record-steps.test.js`:
  - `#12:none;#34:build,test` parses to `records: ['#12','#34']`, `recordSteps: {'#12':[], '#34':['build','test']}`, `steps: ['build','test']`, `canonical` equal to the input; whitespace around `;`, `:` and `,` normalizes away.
  - `steps` is the lifecycle-ordered union: `#1:wrap-up;#2:test,review` gives `['test','review','wrap-up']`.
  - One `{ok:false}` test per reason, asserting `reason`: `empty` (`''`, `'   '`), `malformed-entry` (`#1`, `#1:`, `build,test`), `bad-record` (`1:test`, `#0:test`, `#1a:test`), `duplicate-record` (`#1:test;#1:review`), `invalid-step` (`#1:tset`, `#1:test,,review`, `#1:review-console`, and a step outside a passed `allowed`), `duplicate-step` (`#1:test,test`), `out-of-order` (`#1:review,test`), `mixed-none` (`#1:none,test`), `nothing-left` (`#1:none;#2:none`), `target-mismatch` (`targets: ['#1','#3']` against `#1:test;#2:test`, in both missing and extra directions; different order alone passes).
  - CLI through `run(argv, deps)`: exit 0 JSON; exit 2 for a trailing bare `--value`, an empty value, an unknown flag and an invalid value; the real binary spawned once with `windowsHide: true`; `--help` exits 0.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/flow/record-steps.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement** the module (split on `;`, then the first `:`, then `,`, with no regex over the unbounded value except the anchored `/^#[1-9]\d*$/` record test) and the CLI in the `run(argv, deps)` shape. `FLOW_STEPS` comes from `lib/claim-targets/claim-targets` (its only source). Add a `docs/plugin-structure.md` command line beside `context-gauge.js`'s.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/flow/record-steps.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/flow/record-steps.js plugin/bin/record-steps.js tests/bin-lib/flow/record-steps.test.js docs/plugin-structure.md
git commit -m "Add the per-record step grammar — refs #4358"
```

### Task 2: The gauge writes a per-record handoff

**Review risk:** high

**Files:**
- Modify: `plugin/bin/context-gauge.js`
- Modify: `plugin/bin/lib/timing/context-gauge.js` (`buildHandoff`, a manifest-records reader)
- Modify: `docs/plugin-structure.md:184`
- Test: `tests/bin-lib/timing/context-gauge.test.js`

**Interfaces:**
- Consumes: Task 1's `parseRecordSteps`, `formatRecordSteps`.
- Produces: CLI flag `--record-steps <value>`, mutually exclusive with `--next-steps` (both given → exit 2; an invalid value → exit 2).
- Produces: `handoff.json` for that form adds `recordSteps: {'#A':[],'#B':['build','test']}`; `nextSteps` is the union; `resume` is `PIPELINE_RUN_DIR="{run}" /claude-tweaks:flow "#A,#B" record-steps=#A:none;#B:build,test auto` (the mode token as today). The flat form's object and `resume` stay byte-identical, with no `recordSteps` key.
- Produces: boolean CLI flag `--keep-going`, valid only with `--record-steps` (alone → exit 2): `resume` gains the ` keep-going` token before the mode token, because that token lives only in `$ARGUMENTS` and a resumed run would otherwise revert to stop-on-first-failure. `handoff.json` needs no other key for it.
- Produces: `manifestRecords(runDir, { manifest } = {}) -> string[] | null` in the lib: `manifest.yml`'s `multispec.specs` ids as `#N`, in manifest order; `null` when the file is absent or lists none. A `deps.manifestRecords` seam in the CLI.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/timing/context-gauge.test.js` (fixtures create `manifest.yml` through the real `manifestInit` from `plugin/bin/lib/flow/manifest.js`, never hand-written YAML):
  - `AC1.1:` 250000 tokens, `--record-steps '#12:none;#34:build,test'`, manifest specs `[12,34]`, only `spec-12/` on disk: `handoff.json` carries `recordSteps`, `nextSteps: ['build','test']`, and the exact `resume` string above. Deleting the manifest-based set in favor of `resolveTargetRecords` must turn this red, since `#34` has no dir.
  - Keys are written in manifest order when the flag lists them in another order.
  - A mismatch (the flag omits a manifest record, or names an extra one) writes nothing: `over: true`, `handoff: null`, `reason` starting `handoff.json not written: --record-steps names`.
  - No manifest: nothing written, `reason` naming `manifest.yml`.
  - At the bound (3 earlier handoffs) nothing is written, with the existing bound reason.
  - A fallback-identified caller writes nothing (the existing `NOT_IDENTIFIED_REASON`).
  - Under the cap: `over: false`, no file.
  - `--record-steps … --keep-going` writes `resume` ending `record-steps=#12:none;#34:build,test keep-going auto`; without the flag the token is absent.
  - Exit 2 and nothing written: both flags together; `--record-steps` bare, empty, or invalid (`#12:tset`); `--keep-going` without `--record-steps`.
  - Update the existing flat refusal test (line 492's comment, line 499's regex) to `^handoff\.json not written: a multi-record run \(#945, #3817, #3926\) — a multi-record handoff needs --record-steps: continue in place$`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/timing/context-gauge.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement.** In `measure`, the record-steps branch sits where `targets` resolves today, after the bound check: read `deps.manifestRecords(runDir)`, compare as sets with the parsed `records`, then call `buildHandoff` with `targets` in manifest order and `recordSteps` re-keyed to that order. Update the header comment, `USAGE`, and `docs/plugin-structure.md:184` (add the flag and drop "handoff is single-record until #4358").

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/timing/context-gauge.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/context-gauge.js plugin/bin/lib/timing/context-gauge.js tests/bin-lib/timing/context-gauge.test.js docs/plugin-structure.md
git commit -m "Write a per-record handoff from the context gauge — refs #4358"
```

### Task 3: The dispatch parse accepts the per-record form

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/first-call-artifact-check.js` (`parseNextSteps`, `resolveFirstCallGate`)
- Test: `tests/bin-lib/dispatch/first-call-artifact-check.test.js`

**Interfaces:**
- Consumes: Task 1's `parseRecordSteps`; Task 2's `handoff.json`.
- Produces: `parseNextSteps(reply, allowed = FLOW_STEPS, { targets = null } = {})`. A flat value keeps returning exactly `{ ok: true, steps }`. A value whose first character is `#` returns `{ ok: true, steps, recordSteps, stepArg: 'record-steps={canonical}' }`, or `fail('next-steps-{reason}', 'handoff NEXT_STEPS: {message}')`. A flat value with `targets.length > 1` returns `fail('next-steps-flat-multi-record', …)`.
- Produces: `resolveFirstCallGate({ reply, artifact, targets })`, which forwards `targets`. Absent `targets` behaves as today.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/dispatch/first-call-artifact-check.test.js`:
  - `AC1.2:` round trip. Run the real `context-gauge.js` `run` over a real-writer manifest with `--record-steps '#12:none;#34:build,test'`, then feed `NEXT_STEPS: {the handoff's canonical value}` to `parseNextSteps(reply, FIRST_CALL_STEPS, { targets: ['#12','#34'] })`. Assert `recordSteps` gives `#12` no step and `#34` `['build','test']`, and that `stepArg` equals the `record-steps=` token in `handoff.json`'s `resume`.
  - Second-call variant: `#12:none;#34:test,review,polish,wrap-up` parses under `SECOND_CALL_STEPS`; the same value under `FIRST_CALL_STEPS` fails `next-steps-invalid-step`.
  - Flat `NEXT_STEPS: test` with `targets: ['#12','#34']` fails `next-steps-flat-multi-record`; `resolveFirstCallGate` returns `blocked` for it and `handoff` for a valid per-record line. Deleting the flat guard must turn this red.
  - A per-record line missing a target fails `next-steps-target-mismatch`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement** as the Interfaces block states. Extend the function's header comment.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/first-call-artifact-check.js tests/bin-lib/dispatch/first-call-artifact-check.test.js
git commit -m "Accept per-record NEXT_STEPS at the dispatch gate — refs #4358"
```

### Task 4: `/flow` resumes per record and the sequential loop gauges

**Review risk:** high

**Files:**
- Modify: `plugin/skills/flow/SKILL.md` (a bullet under `## Input`, Step 1 item 4, Step 4 item 4; at most 450 B net)
- Modify: `plugin/skills/flow/steps-and-gates.md` (new `### Per-record resume (record-steps=)` before `### Adopting an inherited run directory`)
- Modify: `plugin/skills/flow/multi-spec.md` (new `## Context cap (sequential runs)` before `## PR phase-checklist convention`)
- Modify: `plugin/skills/flow/context-handoff.md` (`## The check`'s first bullet, `## Dispatched call` item 4, `## Top-level run`)
- Test: `tests/flow-context-handoff-conformance.test.js`

**Interfaces:**
- Consumes: Tasks 1 and 2's CLI shapes.

Content the prose must state (the wording is the implementer's, the facts are not):

*SKILL.md.* A `record-steps=#A:{steps};#B:{steps}` bullet under `## Input`, marked `(producer-only)` right after its leading code span, pointing at `steps-and-gates.md`'s Per-record resume. Step 1 item 4: the token replaces the step list. Step 4 item 4 opens "runs outside `interactive`, never a `MULTISPEC_PARALLEL_WAVE=1` wave member", and a multi-spec run takes `multi-spec.md`'s Context cap section instead of this item's `--next-steps` form. The rest of the item stays.

*Per-record resume.* (1) Validate first with `node "${CLAUDE_PLUGIN_ROOT}/bin/record-steps.js" --value "{value}" --targets "{targets}"`; a non-zero exit stops before Step 2, as a Step 1 validation failure. (2) A step list beside the token is the same stop. (3) Every record's list runs exactly its steps: no resume-onward, and no `test` auto-insert before `review`. `build`'s automatic `stories` and `polish`'s bundled re-verify still apply, since each is one unit with its step. `none` runs nothing and the record stays a target. A resumed run carrying `keep-going` keeps it. (4) `{steps}` for Step 2.7b/2.8/`flow-preflight.js` is the CLI's `steps` union. (5) A record whose list starts past `test` enters `review` through `review/code-mode-steps.md` Step 1's own gate, which re-triggers `/claude-tweaks:test` when the stamp does not verify HEAD, so nothing is lost by omitting the auto-insert. (6) Pre-flight Verify Sweep does not re-run. A record with an existing `spec-{N}/config.yml` is not re-scaffolded. `manifest-init` keeps each spec's status (#3035). The Boundary freshness check runs only before a record that has not started. (7) The consolidated pass runs when any record's list carries `wrap-up`; otherwise Step 5's partial note applies.

*Context cap.* The sequential loop gauges after each passing gate of each record (same boundary units as `context-handoff.md`), with a step left in the run, under `auto`/`confirm`/`hybrid`, never under the `parallel` token or as a wave member. One Bash call, with `{parent}` the literal parent run dir, never `spec-{N}/`, because the gauge exits 2 on a `spec-` basename:
`node "${CLAUDE_PLUGIN_ROOT}/bin/context-gauge.js" --run "{parent}" --record-steps "{value}" [--keep-going]`, `--keep-going` only under the `keep-going` token.
Everywhere the handoff procedure reads the run, a multi-spec run uses the parent, because `$PIPELINE_RUN_DIR` is the per-spec `{parent}/spec-{N}/`, which holds no `run-state.json`: the `dispatched` read targets `$MULTISPEC_PARENT_DIR`, and `{run}` and `handoff.json` are the parent's. A read against `spec-{N}/` prints nothing and would misroute a dispatched bundle to the Top-level branch.
Compose `{value}` in run order: a record past its list, failed under `keep-going`, or `not-run` is `none`; the current record takes its remaining steps; a later record takes its full list with `test` written out before `review` (the auto-insert is not applied on resume). A run not bound `dispatched: true` leaves `wrap-up` off every list, and skips the gauge when only `wrap-up` steps remain. Result handling is `context-handoff.md`'s.

*context-handoff.md.* The first bullet becomes: a single-spec run uses `--next-steps`, a sequential multi-spec run uses `--record-steps` per `multi-spec.md`'s Context cap, and a `parallel` run or wave member does not gauge. Dispatched call item 4 keeps its literal `NEXT_STEPS: {comma-joined remaining steps}` and adds that a multi-spec run's line is `NEXT_STEPS: {the --record-steps value}`. `## The check` or `## Reading the result` states the parent-run rule above. Top-level run: a multi-spec child's lists carry no `wrap-up`, so after relaying, this agent runs `wrap-up` in run order for each record whose `manifest.yml` status is none of `complete`, `failed`, `not-run`, then the consolidated pass. The fenced template is unchanged. In `steps-and-gates.md`'s handed-off paragraph, a multi-spec run's Steps Complete note names `{MULTISPEC_PARENT_DIR}/handoff.json`.

- [ ] **Step 1: Write the failing conformance tests** in `tests/flow-context-handoff-conformance.test.js`, each factored into a gaps function with a go-red control calling the same function on mutated text:
  - `AC1.3:` the Context cap section names `--record-steps`, the literal parent run dir and `never spec-{N}/`, `none` for a finished/failed/not-run record, and the written-out `test` for a later record.
  - Per-record resume states "exactly", no `test` auto-insert, that `build`'s automatic `stories` and `polish`'s re-verify still apply, `none` stays a target, the `record-steps.js` validation call, the union for `{steps}`, the no-re-scaffold rule, and a citation of `code-mode-steps.md`.
  - The parent-run rule: the `dispatched` read names `$MULTISPEC_PARENT_DIR`, `{run}` is the parent, and the Steps Complete variant names `{MULTISPEC_PARENT_DIR}/handoff.json`. The Context cap names `--keep-going`.
  - Order pin: the Context cap section appears after `## Execution` in `multi-spec.md` (the Reachability check: a section past an unconditional stop would never fire).
  - The context-handoff bullet: `--record-steps` present, `parallel` excluded.
  - Top-level: `wrap-up` for each record whose status is none of `complete`, `failed`, `not-run` (all three literals pinned), then the consolidated pass.
  - Update line 211's and line 219's pins to the new sentences.
  - Run the real `record-steps.js` over the exact example token the prose prints, so the prose cannot name a grammar the parser refuses.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/flow-context-handoff-conformance.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Edit the four skill files.** Check `wc -c plugin/skills/flow/SKILL.md` stays under 52,500.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/flow-context-handoff-conformance.test.js`
Expected: PASS.

Also run: `node --test tests/argument-hint-input.test.js tests/argument-hint-mirrors.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/SKILL.md plugin/skills/flow/steps-and-gates.md plugin/skills/flow/multi-spec.md plugin/skills/flow/context-handoff.md tests/flow-context-handoff-conformance.test.js
git commit -m "Gauge the multi-spec loop and resume each record at its own step — refs #4358"
```

### Task 5: The dispatch continuation and the sweep

**Files:**
- Modify: `plugin/skills/dispatch/two-call-gate.md` (section 8 items 1 and 2)
- Modify: `plugin/skills/dispatch/continuation-call.md`
- Modify: `plugin/skills/dispatch/task-prompt.md` (lines 285 and 500, shrink only)
- Modify: `docs/journeys/hand-a-phase-to-a-fresh-agent-at-the-context-cap-4027.md` (line 34)
- Modify when it states a step list or a single-record handoff (read each, no-change otherwise): `docs/getting-started.md`, `docs/skill-graph.md`, `docs/journeys/clear-the-two-call-gate-for-a-dispatched-group-2775.md`, `plugin/skills/dispatch/reporting.md`, `plugin/bin/lib/flow/run-mode.js`
- Waived `docs/superpowers/plans/2026-10-31-process-kill-guard.md`: a shipped plan, history
- Test: `tests/dispatch-handoff-continuation-conformance.test.js`

**Interfaces:**
- Consumes: Task 3's `parseNextSteps(reply, allowed, { targets })` and `stepArg`.

Facts the prose must state:
- Section 8 item 1 keeps both literal `parseNextSteps(reply, FIRST_CALL_STEPS)` / `(reply, SECOND_CALL_STEPS)` spans, and adds that a bundle group passes its records as `{ targets }`, `#N` strings (`['#12','#34']`), never bare numbers, so a flat `NEXT_STEPS` from a bundle fails closed. Item 2: a per-record result's `stepArg` is the replacement.
- `continuation-call.md`: in a bundle, `NEXT_STEPS` is the per-record form, and both invocation lines take `record-steps={NEXT_STEPS}` in the step list's place, targets unchanged.
- `task-prompt.md`'s two `NEXT_STEPS` lines: `the comma-joined steps still to run` becomes `the steps still to run` (no pin holds the old phrase; `git grep` found only those two lines). The existing regex test keeps passing.
- The journey's "A run directory holding more than one record is refused…" sentence describes the new flat refusal and `--record-steps`.

- [ ] **Step 1: Write the failing tests** in `tests/dispatch-handoff-continuation-conformance.test.js`, with go-red controls via a shared gaps function:
  - `AC1.4:` the first template with `build,test auto` replaced by `record-steps=#12:none;#34:test auto` carries no `build,test`, keeps `STOP_SENTENCE`, and its `/claude-tweaks:flow "#{n1},#{n2},..."` line holds the token.
  - `continuation-call.md` names `record-steps=` and `stepArg`; section 8 names `{ targets }`, and the flat form fails closed.
  - Item 2's prose cites an export that exists: `gate.parseNextSteps` given a per-record reply returns a `stepArg` starting `record-steps=`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/dispatch-handoff-continuation-conformance.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Edit** the four files. Then sweep stale prose (the control: at `dc02e2700` this exact grep hits the five `plugin/`, `docs/` and `tests/` files it is written against):

Run: `git grep -n -i -e "multi-spec handoff" -e "handoff is single-record" -e "single-spec only" -e "no multi-spec handoff" -e "single-spec runs outside" -- plugin docs tests .claude/skills`
Expected: only `tests/flow-ledger-creation-timing-conformance.test.js:26`'s unrelated title, and any phrasing this plan deliberately kept.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/dispatch-handoff-continuation-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Verify no skip was added (AC2.1).** Controller-run scratch check:

Run: `git diff dc02e2700 HEAD -- tests`, piped to `grep -E "^\+.*(\.skip|skip:|todo:)"`
Expected: no match other than a line moved unchanged. The full suite runs at Common Step 5.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/dispatch/two-call-gate.md plugin/skills/dispatch/continuation-call.md plugin/skills/dispatch/task-prompt.md docs/journeys/hand-a-phase-to-a-fresh-agent-at-the-context-cap-4027.md tests/dispatch-handoff-continuation-conformance.test.js {each conditional file the sweep changed}
git commit -m "Continue a handed-off bundle per record — refs #4358"
```
