# Settle Blocker-Landing Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatched record stopped by `/flow`'s pre-claim blocker-landing check (#4553) settles as a non-failing stop: no retry counted, no `auto:merge` revoked, no `bot:blocked`, a claim released only when one of this run's exists.

**Architecture:** Prose-only contract change across four skill files plus one skill-graph row, pinned by `node --test` conformance suites. `/flow` names the stop's gate (`blocker-landing`) and its dispatch report line in `failure-cards.md`; dispatch's Settle Step 6 gains a special case keyed on `ISSUE #{n}: failed:blocker-landing`, beside its existing pre-flight special cases; `failure-check` learns the stop's classification; the headless self-report gets the name `flow-step-2.7b-blocker-landing`.

**Tech Stack:** Markdown skill files; `node --test` (built-in), `node:assert/strict`, `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T062139-record-4792/work/4792-spec.md` (record #4792)

**Scope keywords:** blocker-landing, failed:blocker-landing, flow-step-2.7b

## Global Constraints

- Every `/claude-tweaks:{skill}` reference inside actionable instruction text is fully qualified; bare `/{skill}` only in descriptive prose (CLAUDE.md Cross-references).
- Relationships between skills are stated once, in `docs/skill-graph.md` (CLAUDE.md Cross-references) — add the new edge there, not as a restated edge in a SKILL.md.
- Size rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). `plugin/skills/dispatch/settle-and-merge.md` is 47,046 B at base; Task 2 adds about 1,150 B → ~48,200 B, headroom ~4,300 B (≈92% of the rail — a soft `nearCeiling`, not a breach). No other touched skill file is above 13 KB.
- Commit style: `{Verb} {what} — {detail}`, ending `refs #4792` — never `closes`/`fixes`. End each commit message with the line `Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN`.
- Gate token is exactly `blocker-landing`; report line exactly `ISSUE #{n}: failed:blocker-landing`; self-report name exactly `flow-step-2.7b-blocker-landing`; release reason exactly `failed: blocker-landing` (`_shared/issue-claims.md`'s Release triggers table: `failed: {gate}`).
- Governing project skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted verbatim: "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control." and "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** … Keep the patterns non-global". And for ordering: "Build the control by **permutation, not deletion**". Follow `tests/no-dispatch-host-preflight-conformance.test.js`'s `missingFactsOf` / `assertEachPatternGoesRed` / `lineStartingWith` / `requireLine` shapes (copy them; do not import from that file).
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

- A handoff continuation (`/flow #{n} test` with the run's `PIPELINE_RUN_DIR`) re-runs Step 2.7b while this run already holds the claim: Settle must release it (steps 1-2), not skip it — Task 2 pins the `Step 2.8: claimed #{n}` condition.
- A first call that stops at 2.7b holds no claim: Settle must not run `release-claim.js`, which on an absent blob still posts a release comment (a false one) — Task 2 pins "otherwise … skip them".
- A multi-record bundle stopped by one target's blocker: every target of the stopped run reports the gate line, not only the blocked one — Task 1 pins "one `ISSUE #{n}: failed:blocker-landing` line per target".
- The `open` verdict is the same stop as `unlanded` (both stop before Step 2.8) — Tasks 1 and 2 name both verdicts.
- The special case must precede Settle step 1 in the linear procedure, or the generic path runs first — Task 2 pins placement with a permutation control.

---

### Task 1: Name the `blocker-landing` gate in /flow

**Role:** transcription

**Files:**
- Modify: `plugin/skills/flow/failure-cards.md` (line 3 header; routing table rows at lines 7-11)
- Modify: `plugin/skills/flow/multispec-dependency-ordering.md` (after the line starting `A failed blocker query is not \`undetermined\``)
- Test: `tests/flow-blocker-landing-conformance.test.js` (append)

**Interfaces:**
- Produces: the failure-cards routing row starting `| Step 2.7b blocker landing` naming gate `blocker-landing` and the report line `ISSUE #{n}: failed:blocker-landing`; Task 2's Settle paragraph cites it as "`flow/failure-cards.md`'s blocker-landing row".

- [ ] **Step 1: Write the failing test** — append to `tests/flow-blocker-landing-conformance.test.js` (its existing `readText`, `path`, `FLOW_DIR`, `ORDERING` are in scope; add `const FAILURE_CARDS = path.join(FLOW_DIR, 'failure-cards.md');` plus local copies of `missingFactsOf` and `assertEachPatternGoesRed` from `tests/no-dispatch-host-preflight-conformance.test.js`).

  `CARD_ROW_PREFIX = '| Step 2.7b blocker landing'`; the row = the live line of `failure-cards.md` starting with it (assert it exists). Facts (non-global regexes):
  - `/`open` or `unlanded` out-of-run blocker/` — 'AC1.1: the row names both stopping verdicts'
  - `/gate `blocker-landing`/` — 'AC1.1: the row names the gate'
  - `/`OUTCOME: build-test-blocked`, one `ISSUE #\{n\}: failed:blocker-landing` line per target, and `STATUS: BLOCKED`/` — 'AC2.1: the dispatch report line'
  - `/Settle treats it as a non-failing stop \(`dispatch\/settle-and-merge\.md`'s Blocker-landing special case\)/` — 'AC2.1: cites the Settle special case'

  Tests: `test('AC1.1 AC2.1: failure-cards.md names the blocker-landing gate and its dispatch report (#4792)')` asserting `missingFactsOf(CARD_FACTS)(row)` deep-equals `[]`; `test('AC1.2: each failure-cards blocker-landing fact can go red')` calling `assertEachPatternGoesRed(row, CARD_FACTS, missing)`.

  Ordering pointer: `test('AC1.1: the out-of-run section routes both hard fails to the blocker-landing gate (#4792)')` — over `outOfRunSection(readText(ORDERING))`, assert it matches `/Either hard fail is gate `blocker-landing`; under `\/claude-tweaks:dispatch` report it per `failure-cards\.md`'s blocker-landing row\./`; control: the section with that sentence removed (`assert.notEqual` first) fails the same check (factor the check into one function both call).

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/flow-blocker-landing-conformance.test.js`
  Expected: FAIL — `failure-cards.md has no line starting "| Step 2.7b blocker landing"` and the ordering-pointer test failing.

- [ ] **Step 3: Edit the prose**

  In `failure-cards.md` line 3 change `Loaded by \`/claude-tweaks:flow\` Step 4 (or Step 3's Manifesto ceremony-check) **only when a gate fails**.` to `Loaded by \`/claude-tweaks:flow\` Step 4 (or Step 3's Manifesto ceremony-check, or Step 2's blocker-landing stop) **only when a gate fails**.` Append this row as the last row of the routing table:

  ```
  | Step 2.7b blocker landing (or multi-spec Validation step 3) stopped on an `open` or `unlanded` out-of-run blocker — gate `blocker-landing` | No template: the stop message (`multispec-dependency-ordering.md`'s verdict table and its `unlanded` card) is the whole report, and the run holds no claim from this call. Under `/claude-tweaks:dispatch` the call reports `OUTCOME: build-test-blocked`, one `ISSUE #{n}: failed:blocker-landing` line per target, and `STATUS: BLOCKED`; Settle treats it as a non-failing stop (`dispatch/settle-and-merge.md`'s Blocker-landing special case) |
  ```

  In `multispec-dependency-ordering.md`, insert after the line `A failed blocker query is not \`undetermined\` — the call exits non-zero and the run stops before claiming (\`multispec-preflight-failure.md\`).` a blank line and:

  ```
  Either hard fail is gate `blocker-landing`; under `/claude-tweaks:dispatch` report it per `failure-cards.md`'s blocker-landing row.
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/flow-blocker-landing-conformance.test.js`
  Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/skills/flow/failure-cards.md plugin/skills/flow/multispec-dependency-ordering.md tests/flow-blocker-landing-conformance.test.js
  git commit -m "Name the blocker-landing gate in /flow — dispatch report line for the pre-claim stop, refs #4792"
  ```

### Task 2: Settle the blocker-landing stop as a non-failing stop

**Role:** transcription
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md` (new paragraph directly after the paragraph starting `**No-dispatch-host special case (#4555).**`, before the line starting `1. The CLI in step 2 performs the ownership read itself`)
- Modify: `docs/skill-graph.md` (`## dispatch` table: new row directly after the row starting `| \`build/execution-mode-policy.md\` |`)
- Create: `tests/settle-blocker-landing-stop-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's failure-cards row (it must contain `failed:blocker-landing`).
- Produces: the Settle paragraph starting `**Blocker-landing special case (#4792).**` — Task 3's failure-check bullet cites it as "`dispatch/settle-and-merge.md`'s Blocker-landing special case".

- [ ] **Step 1: Write the failing test** — create `tests/settle-blocker-landing-stop-conformance.test.js`, header comment naming #4792 and what it pins. Copy `missingFactsOf`, `assertEachPatternGoesRed`, `lineStartingWith`, `requireLine` from `tests/no-dispatch-host-preflight-conformance.test.js`. `SETTLE = plugin/skills/dispatch/settle-and-merge.md`, `SETTLE_PREFIX = '**Blocker-landing special case (#4792).**'`, `SETTLE_STEP1 = '1. The CLI in step 2 performs the ownership read itself'`.

  `SETTLE_FACTS` (non-global, each matching once in the paragraph):
  - `/`ISSUE #\{n\}: failed:blocker-landing`/` — 'AC1.1: Settle recognizes the stop by its gate line'
  - `/on an `open` or `unlanded` out-of-run blocker/` — 'AC1.1: names both stopping verdicts'
  - `/treat it as a non-failing stop: the blocker, not the record, is at fault/` — 'AC1.1: non-failing stop'
  - `/Run steps 1-2 only when this run's `decisions\.md` already carries a `Step 2\.8: claimed #\{n\}` line/` — 'AC2.1: releases a claim this run holds'
  - `/with `--reason "failed: blocker-landing"`/` — 'AC2.1: release reason'
  - `/otherwise the stop came before any claim of this run's, so skip them/` — 'AC2.1: no release when no claim of this run exists'
  - `/no `auto:merge`\/`auto:merge-pending` revocation/` — 'AC2.1: auto:merge stays'
  - `/no attempt counted against `dispatch-retry-ceiling`/` — 'AC1.1: does not count toward the retry ceiling'
  - `/never reaches `bot:blocked` on this stop/` — 'AC1.1: never bot:blocked'
  - `/failing-check-name `flow-step-2\.7b-blocker-landing`/` — 'self-report name'
  - `/When `DISPATCH_HEADLESS=1` was set, read `_shared\/headless-self-report\.md`/` — 'self-report gated on DISPATCH_HEADLESS=1'

  Tests:
  - `test('AC1.1 AC2.1: Settle settles a blocker-landing stop as a non-failing stop (#4792)')` — `missingFactsOf(SETTLE_FACTS)(requireLine(SETTLE, SETTLE_PREFIX))` deep-equals `[]`.
  - `test('AC1.2: each Settle blocker-landing fact can go red')` — `assertEachPatternGoesRed` over the same paragraph.
  - `test('AC1.2: reverting the Settle paragraph turns the suite red')` — a copy of the file text with the whole paragraph (and its following blank line) removed: `assert.notEqual` first, then `lineStartingWith(reverted, SETTLE_PREFIX)` is `''`, and `missingFactsOf(SETTLE_FACTS)(reverted)` includes `'AC1.1: Settle recognizes the stop by its gate line'`.
  - `test('AC1.1: the special case sits before Settle step 1')` — copy the placement test and its move-after-step-1 permutation control from `tests/no-dispatch-host-preflight-conformance.test.js` (`AC12.1: the special case sits before Settle step 1`), with this file's prefix.
  - `test('AC1.1: Settle and failure-cards name the same gate')` — token `failed:blocker-landing` is in both the Settle paragraph and the failure-cards line starting `| Step 2.7b blocker landing`; control: the Settle paragraph with `blocker-landing` replaced by `blocker-landed` (`assert.notEqual` first) fails the same `includes` check.
  - `test('skill-graph names the blocker-landing Settle edge (#4792)')` — the `docs/skill-graph.md` line starting `| \`flow/failure-cards.md\` |` exists and contains `failed:blocker-landing` and `flow-step-2.7b-blocker-landing`.

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js`
  Expected: FAIL — `settle-and-merge.md has no line starting "**Blocker-landing special case (#4792).**"`.

- [ ] **Step 3: Edit the prose** — insert after the No-dispatch-host paragraph, separated by blank lines, this exact paragraph:

  ```
  **Blocker-landing special case (#4792).** When the failure this call is settling is `/flow`'s pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing` — Step 2.7b, or multi-spec Validation step 3, on an `open` or `unlanded` out-of-run blocker; `flow/failure-cards.md`'s blocker-landing row), treat it as a non-failing stop: the blocker, not the record, is at fault, and no retry changes the outcome until the blocker lands. Run steps 1-2 only when this run's `decisions.md` already carries a `Step 2.8: claimed #{n}` line — an earlier call of this run claimed the record, and a handoff continuation re-runs the pre-claim checks — with `--reason "failed: blocker-landing"`; otherwise the stop came before any claim of this run's, so skip them. Skip steps 3-7: no `failure-check` classification, no `auto:merge`/`auto:merge-pending` revocation, no attempt counted against `dispatch-retry-ceiling`, no failure comment, and no PR tombstone — the record keeps every grant and never reaches `bot:blocked` on this stop. When `DISPATCH_HEADLESS=1` was set, read `_shared/headless-self-report.md` and follow its dedup-and-file procedure (caller = `dispatch`), failing-check-name `flow-step-2.7b-blocker-landing`, with the stop card as the diagnostic body.
  ```

  In `docs/skill-graph.md`'s `## dispatch` table, insert after the `build/execution-mode-policy.md` row:

  ```
  | `flow/failure-cards.md` | Since #4792, `settle-and-merge.md`'s Blocker-landing special case recognizes the `blocker-landing` gate that file's routing table names for `/flow`'s pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing`) and settles it as a non-failing stop — no `failure-check`, no `auto:merge` revocation, no retry count, no failure comment — releasing a claim only when an earlier call of the run took one, and filing headless through `_shared/headless-self-report.md` as `flow-step-2.7b-blocker-landing`. |
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js tests/no-dispatch-host-preflight-conformance.test.js tests/flow-claim-preflight.test.js tests/dispatch-settle-and-merge-lazy-read.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/skills/dispatch/settle-and-merge.md docs/skill-graph.md tests/settle-blocker-landing-stop-conformance.test.js
  git commit -m "Settle a blocker-landing stop as a non-failing stop in dispatch — no retry count, auto:merge kept, refs #4792"
  ```

### Task 3: Teach failure-check the blocker-landing stop

**Role:** transcription

**Files:**
- Modify: `plugin/skills/assess-agent-autonomy/failure-check.md` (Step 2: Judge — new bullet after the `- **Ambiguous**:` bullet, before `- **\`NOTIFY_NOW\`**:`)
- Test: `tests/settle-blocker-landing-stop-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 2's paragraph name "Blocker-landing special case".

- [ ] **Step 1: Write the failing test** — append. `FAILURE_CHECK = plugin/skills/assess-agent-autonomy/failure-check.md`, bullet = the live line starting `- **Blocker-landing stop**:`. Facts:
  - `/`ISSUE #\{n\}: failed:blocker-landing`/` — 'failure-check keys on the gate line'
  - `/Settle skips this mode for it \(`dispatch\/settle-and-merge\.md`'s Blocker-landing special case\)/` — 'failure-check cites the Settle special case'
  - `/classify it `transient`/` — 'failure-check classifies it transient'
  - `/no build or test ran, so no diff is at fault/` — 'failure-check states why'

  Tests: `test('failure-check.md classifies the blocker-landing stop (#4792)')` (`missingFactsOf` → `[]`) and `test('each failure-check blocker-landing fact can go red')` (`assertEachPatternGoesRed`). Placement: `test('the bullet sits inside Step 2: Judge')` — its index is after `## Step 2: Judge` and before `## Step 3: Render`; control: a copy with the bullet line moved to just after the `## Step 3: Render` line (`assert.notEqual` first) fails the same check.

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js`
  Expected: FAIL — `failure-check.md has no line starting "- **Blocker-landing stop**:"`.

- [ ] **Step 3: Edit the prose** — insert the bullet:

  ```
  - **Blocker-landing stop**: `/flow`'s pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing`) is not a failure this mode judges — Settle skips this mode for it (`dispatch/settle-and-merge.md`'s Blocker-landing special case). If one reaches this mode anyway, classify it `transient`: no build or test ran, so no diff is at fault, and the stop clears once the blocker lands.
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js tests/assess-agent-autonomy-transport-pin.test.js tests/github-rate-limit-conformance.test.js tests/component-return-to-caller-conformance.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/skills/assess-agent-autonomy/failure-check.md tests/settle-blocker-landing-stop-conformance.test.js
  git commit -m "Teach failure-check the blocker-landing stop — transient, never judged by Settle, refs #4792"
  ```

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 (conformance test asserts Step 6 names the stop and that it does not count toward the retry ceiling) | Task 2 `AC1.1 AC2.1` test |
| AC1.2 (reverting the Step 6 text turns it red) | Task 2 `AC1.2` go-red and revert tests |
| AC2.1 (unlanded blocker → claim released, `auto:merge` still present after one Settle pass) | Task 2 `AC1.1 AC2.1` facts (release condition, skip of steps 3-7, no revocation); Task 1 report line |
