# Reproduction observed-pairs fixture (#3326) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin that `categoriseReproduction` confirms the three independently worded same-line reproduction pairs #3326 observed (#3003, #3023, #3028), with each agent's finding text copied verbatim.

**Architecture:** Premise reversed at build (logged to the run's `decisions.md`). #3418 (`b3e8f2a39`) already lowered `SUBSTANCE_SIMILARITY_MIN` from 0.4 to 0.2, and at base `4dbf60b8d` all three pairs confirm (token-Jaccard 0.36/0.30, 0.36, 0.229). The pre-#3418 module splits all three. No matcher change: #3418's calibration over 73 archived pairs found identifier-weighted Jaccard separated same and different defects no better than plain Jaccard. A shared-identifier rule would also merge distinct defects on one line that name the same function, which is exactly #1980's guard. The remaining deliverable is the AC's fixture test.

**Tech Stack:** Node `node:test`, `node:assert`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T214421-record-3326/work/3326-spec.md`

## Global Constraints

- Finding text in fixtures is verbatim from the archived lens JSON. Sources are under the main checkout's `.claude-tweaks/pipelines/archive/`: `2026-10-16T172900-spec-3072-3003/spec-3003/review-ctx/lens-3c-agent{A,B}.json`, `2026-10-16T162827-spec-3023/review-ctx/lens-3b-agent{A,B}.json`, `2026-10-16T191151-record-3028/review-ctx/lens-3f-agent{A,B}.json`.
- #1980's guard stays: a same-location, different-substance pair still comes out unconfirmed.

## Review Focus

- The #3028 pair scores 0.229, just above the 0.2 threshold, so a future threshold or tokenizer change could quietly split it. Each pair's test asserts `confirmed.length` exactly, so any regression goes red.
- The #3028 pair straddles a severity bucket (low vs medium). It must confirm with `severityContested: true`, not land in unconfirmed. The test asserts the flag.
- #1980's different-substance guard is covered by the existing tests at `tests/multi-agent-coordination.test.js:216` and `AC2.1 reproduction (#3418)`. They are unchanged, and running the file proves they stay unconfirmed.

---

### Task 1: Fixture test for #3326's three observed pairs

**Files:**
- Test: `tests/multi-agent-coordination.test.js` — insert after the `#3418` block, right before the `// #2907: pairing must not depend on the order` comment.

**Interfaces:**
- Consumes: `c.categoriseReproduction(agentAFindings, agentBFindings) → { confirmed, unconfirmed }` from `plugin/bin/lib/coordination.js`. Findings are `{ path, line, severity, text }`.

- [ ] **Step 1: Write the test**

`test('AC1 reproduction (#3326): the three observed independently worded same-line pairs are confirmed', …)`. It iterates `[label, agentA, agentB]` fixtures:
  - `#3003 lens 3c`: both of each agent's `plugin/bin/qa-stamp.js` rows (:132 and :121, severity medium), verbatim.
  - `#3023 lens 3b`: `plugin/bin/lib/residue/probes/release.js:75` (severity low), verbatim.
  - `#3028 lens 3f`: `tests/bin-lib/compose-subject.test.js:454`, A low / B medium, verbatim.

  Per fixture it asserts `confirmed.length === agentA.length` and `unconfirmed.length === 0`, with the label in the message. For `#3028` it also asserts `confirmed[0].severityContested === true` and `confirmed[0].severity === 'low'`.

- [ ] **Step 2: Run, then prove it discriminates**

Run: `node --test --test-name-pattern="#3326" tests/multi-agent-coordination.test.js`
Expected: PASS at base (premise reversed — #3418 already confirms these pairs).

Discrimination: run the same file with `require('../plugin/bin/lib/coordination')` redirected to `git show b3e8f2a39~1:plugin/bin/lib/coordination.js`, the pre-#3418 module, written to the scratchpad. Do the redirect with a scratch `--require` hook that patches `Module._resolveFilename`. Expected: the #3326 test FAILs, on all three fixtures.

- [ ] **Step 3: Run the whole file**

Run: `node --test tests/multi-agent-coordination.test.js`
Expected: PASS. This includes the existing #1980 guard tests (`:216`, `AC2.1 reproduction (#3418)`).

- [ ] **Step 4: Commit**

```bash
git add tests/multi-agent-coordination.test.js
git commit -m "Pin #3326's observed reproduction pairs as confirmed — refs #3326"
```

---

## Self-review

- **Spec coverage:** Deliverable (robust same-substance for same-line pairs) is already on base via #3418; this task pins it against the observed inputs. AC1 → Task 1 Steps 1-2. AC2 (#1980 fixtures stay unconfirmed) → Task 1 Step 3.
- **Placeholders:** none.
