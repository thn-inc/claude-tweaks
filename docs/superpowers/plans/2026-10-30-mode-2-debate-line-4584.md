# multi-agent-coordination.md Mode 2 documents a lens-less debate line the Review Console can never settle (#4584) Implementation Plan

**Goal:** Make Mode 2's confirmed-debate log line the one `review/step3-debate-and-refutation.md` writes, so the guide and the live producer agree.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T154207-spec-4584/work/4584-spec.md` (materialized from GitHub issue #4584)

---

### Task 1: Replace the lens-less confirmed-debate line

**Files:**
Modify: `plugin/skills/_shared/multi-agent-coordination.md`
Test: `tests/multi-agent-coordination.test.js`

In the Mode 2 "Decision-log entry format" block, replace the `confirmed (both agreed)` line with the producer's exact shape:

```
- AUTO {HH:MM:SS} — Debate: cross-lens disagreement on {path}:{line} converged positive after 1 round (lens "{lensA}" finding {pathA}:{lineA}; lens "{lensB}" finding {pathB}:{lineB} — both confirmed). Reversibility: high.
```

Add one sentence after the block, next to the existing `{lens}` sentence: the `confirmed` line is `review/step3-debate-and-refutation.md`'s, and it names every confirmed finding because the Review Console settles only the findings the line names (`bin/lib/console/resolve.js`'s `debateConvergedKeys`). Leave the `unconfirmed` and `contested` lines as they are.

`tests/multi-agent-coordination.test.js` line 1075-1076 pins the old phrase against this doc through `decisionLogPattern(PRIMITIVE_DOC, ['confirmed (both agreed)'])`. Move that test to the new shape.

- [ ] **Step 1: Failing test** — change that test's entry to a filled-in instance of the new line, and its pattern fragment to `converged positive after 1 round`. Add an assertion that the filled-in line settles both findings through `findingItems` or the existing #4563 producer pin's approach in `tests/bin-lib/console/resolve.test.js` only if `tests/multi-agent-coordination.test.js` can do it in about three lines; otherwise leave that to the existing #4563 producer pin. Run the test before Step 2: it must go red. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
- [ ] **Step 2: Implement** — the doc edit above.
- [ ] **Step 3: Run** `node --test tests/multi-agent-coordination.test.js` — PASS. Also run `grep -n -F "confirmed (both agreed)" plugin/skills/_shared/multi-agent-coordination.md` and quote that it returns no match.
- [ ] **Step 4: Commit** — one commit, `Name the findings in Mode 2's confirmed-debate line — ...`, `Refs #4584`.

---

## Self-review

- **Spec coverage:** the Deliverable is the doc edit. AC1 is the grep in Step 3, and AC2 is the exact `lens "{lensA}" finding {pathA}:{lineA}` shape plus the citation sentence.
- **Placeholders:** none.
