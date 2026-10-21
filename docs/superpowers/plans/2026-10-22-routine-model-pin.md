# Routine Template Model Pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every shipped routine template, and the two `_shared` examples, off `model: claude-sonnet-5` onto `claude-sonnet-5-5`, bumping each template's `template_version`.

**Architecture:** A pure value edit across nine YAML templates and two markdown docs. Each template's `template_version` gets incremented so `/claude-tweaks:routine status` reports existing routines Drifted until `/claude-tweaks:routine update` runs. The one test that pins a shipped `template_version` literal moves with it.

**Tech Stack:** YAML routine templates, markdown, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T220159-record-3846/work/3846-spec.md` (record #3846)

Scope keywords: claude-sonnet-5

## Global Constraints

- Target model value: `claude-sonnet-5-5` (exact string, no date suffix, no quotes added where the existing line has none).
- Decision (Deliverable 1): pin `claude-sonnet-5-5`, not a family alias. The `claude-api` reference lists `claude-sonnet-5-5` as the current Sonnet ID and documents no non-dated family alias; whether RemoteTrigger's `job_config.ccr.session_context.model` accepts an alias such as `sonnet` cannot be verified without creating a live routine, and an unaccepted value would break every `routine create`. Recorded in the PR description (Task 3).
- Every changed template's `template_version` is incremented by exactly 1.
- `_shared/routine-template-schema.md:20` is in the template field table, above the kernel block — editing it does not touch `kernel_version`.
- Edit in place: change only the `model:` line and the `template_version:` line of each template; touch nothing else.

## Review Focus

- A template whose `model:` line is quoted (`"claude-sonnet-5"`) would escape a sed-style edit — the AC grep allows optional quotes; confirm every template's line after the edit.
- A `template_version` bumped by more than 1, or a template whose model changed with no bump — status would under- or over-report drift.
- A test that byte-pins a shipped `template_version` literal (only `tests/release-routine-template.test.js:21` today) goes red at merge if left at the old value.
- Instantiated records under a consumer project's `.claude-tweaks/routines/` are *not* edited by this change — `routine update` rewrites them; this repo commits none.
- The `notes` free text in `backlog/routine-template.yml` mentions `template_version 3` historically — it is prose about an old version, not a field, and must stay unchanged.

---

### Task 1: Move the nine templates and bump their versions

**Files:**
- Modify: `plugin/skills/backlog/routine-template.yml` (line 1 `template_version: 4` → `5`; line 7 model)
- Modify: `plugin/skills/dispatch/routine-template.yml` (line 6 `template_version: 10` → `11`; line 12 model)
- Modify: `plugin/skills/docs-health/routine-template.yml` (line 1 `9` → `10`; line 7 model)
- Modify: `plugin/skills/release/routine-template.yml` (line 1 `1` → `2`; line 7 model)
- Modify: `plugin/skills/harness-health/routine-template.yml` (line 1 `9` → `10`; line 7 model)
- Modify: `plugin/skills/journey-health/routine-template.yml` (line 1 `10` → `11`; line 7 model)
- Modify: `plugin/skills/code-health/routine-template.yml` (line 1 `9` → `10`; line 14 model)
- Modify: `plugin/skills/tidy/routine-template.yml` (line 1 `10` → `11`; line 7 model)
- Modify: `plugin/skills/specify/routine-template.yml` (line 1 `2` → `3`; line 7 model)
- Test: `tests/release-routine-template.test.js:21`

**Interfaces:**
- Consumes: nothing.
- Produces: every shipped template parses with `model === 'claude-sonnet-5-5'` and its bumped `template_version`.

- [ ] **Step 1: Update the pinned test first**

In `tests/release-routine-template.test.js:21`, change `assert.equal(TEMPLATE.template_version, 1);` to `assert.equal(TEMPLATE.template_version, 2);`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/release-routine-template.test.js`
Expected: FAIL — `1 !== 2` on the `template_version` assertion.

- [ ] **Step 3: Edit the nine templates**

In each file above, replace `model: claude-sonnet-5` with `model: claude-sonnet-5-5` and set `template_version` to the value listed.

- [ ] **Step 4: Run the routine suites to verify they pass**

Run: `node --test tests/release-routine-template.test.js tests/routine-template-schema.test.js tests/routine-template-parser.test.js tests/routine-record-freshness.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Run the AC grep verification (AC1.1)**

Run: `grep -rnE '^model: "?claude-sonnet-5"?$' plugin/skills --include="*.yml"`
Expected: no output, exit 1.

- [ ] **Step 6: Verify every template_version incremented by one (AC2.1)**

Run: `git diff -U0 HEAD -- 'plugin/skills/*/routine-template.yml'` (before Step 7's commit) and read the `-template_version:`/`+template_version:` pairs.
Expected: nine `-`/`+` pairs, each `+` value exactly one more than its `-` value, and nine `-model: claude-sonnet-5` / `+model: claude-sonnet-5-5` pairs; no other changed lines.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/backlog/routine-template.yml plugin/skills/dispatch/routine-template.yml plugin/skills/docs-health/routine-template.yml plugin/skills/release/routine-template.yml plugin/skills/harness-health/routine-template.yml plugin/skills/journey-health/routine-template.yml plugin/skills/code-health/routine-template.yml plugin/skills/tidy/routine-template.yml plugin/skills/specify/routine-template.yml tests/release-routine-template.test.js
git commit -m "Move routine templates to claude-sonnet-5-5 — bump every template_version (refs #3846)"
```

### Task 2: Update the two `_shared` examples

**Files:**
- Modify: `plugin/skills/_shared/routine-template-schema.md:20` — `(e.g. \`claude-sonnet-5\`)` → `(e.g. \`claude-sonnet-5-5\`)`
- Modify: `plugin/skills/_shared/routine-diagnostic-probe.md:39` — `"model": "claude-sonnet-5",` → `"model": "claude-sonnet-5-5",`

**Interfaces:**
- Consumes: Task 1's chosen value.
- Produces: no `claude-sonnet-5` literal (without the `-5` suffix) remains under `plugin/`.

- [ ] **Step 1: Edit both lines in place.**

- [ ] **Step 2: Verify no stale literal remains under plugin/**

Run: `grep -rnE 'claude-sonnet-5([^-]|$)' plugin`
Expected: no output, exit 1.

- [ ] **Step 3: Run the suites that read these files**

Run: `node --test tests/routine-template-schema.test.js tests/routine-fleet-security-hardening.test.js tests/integration-branch-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/_shared/routine-template-schema.md plugin/skills/_shared/routine-diagnostic-probe.md
git commit -m "Update routine model examples to claude-sonnet-5-5 (refs #3846)"
```

### Task 3: Confirm the out-of-plan keyword matches are fixture data (verification only)

The `claude-sonnet-5` scope keyword also matches files whose literal is a test's own fixture string or a transcript fixture, never the shipped template value (the spec's Current State: "`tests/routine-template-parser.test.js` and `tests/routine-record-freshness.test.js` pin their own fixture strings, not the shipped YAML"). Added per `scope-creep: add-to-plan`; none is edited.

**Files:**
- Test: `tests/routine-template-parser.test.js`
- Test: `tests/routine-record-freshness.test.js`
- Test: `tests/hooks-subagent-stop.test.js`
- Test: `tests/statusline.test.js`
- Test: `tests/bin-lib/timing/derive.test.js`
- Test: `tests/bin-lib/timing/transcript.test.js`
- Test: `tests/fixtures/timing/subagents-session/sess-1/subagents/agent-a1.jsonl`
- Test: `tests/fixtures/timing/subagents-session/sess-1/subagents/agent-a2.jsonl`
- Test: `docs/plans/2026-10-22-routine-model-pin-ledger.md` (this run's ledger — its title names the old pin)

- [ ] **Step 1: Verify none of them reads a shipped template or shared doc**

Run: `grep -lE "routine-template\.yml|routine-template-schema\.md|routine-diagnostic-probe\.md" tests/routine-template-parser.test.js tests/routine-record-freshness.test.js tests/hooks-subagent-stop.test.js tests/statusline.test.js tests/bin-lib/timing/derive.test.js tests/bin-lib/timing/transcript.test.js`
Expected: no output, exit 1 — each pins its own inline fixture.

- [ ] **Step 2: Verify the full test suite passes (AC3.1)**

Run: the shared verification procedure (`skills/test/verification.md` — `verify.js`), which runs `npm test`.
Expected: exit 0, including the routine template and record-freshness suites.

### Task 4: Record the decision and the release-note gap (orchestrator, no code)

**Files:** none in the repo — PR #3911 body and the run's `staged/`.

- [ ] **Step 1: Add a `### Model-pin decision` section to PR #3911's body** (after `### Spec summary`, outside every marker pair) carrying the Global Constraints decision text.

- [ ] **Step 2: Stage the Release Note revision** — the record's current `## Release Note` names the `routine update` remedy but not the Drifted status Deliverable 4 asks it to state. Executors never edit record bodies (`_shared/work-record.md`'s Consumers table), so stage the proposed replacement text as `staged/build-deviation-1.md` via `bin/stage-item.js --allocate` and log it `STAGED`:
  `Scheduled routines now default to Claude Sonnet 5.5 (claude-sonnet-5-5). Existing routines report Drifted in /claude-tweaks:routine status until you run /claude-tweaks:routine update on each.`
