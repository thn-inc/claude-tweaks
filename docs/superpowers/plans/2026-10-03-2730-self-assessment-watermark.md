# Self-assessment watermark write (#2730) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/claude-tweaks:feedback`'s self-assessment degradation path write a transcript-judge watermark too, narrowing the current blanket "self-assessment never reads or writes a watermark" exclusion to the one case where it's actually true (no transcript path ever resolved) — so a judge-dispatch failure (the transcript *did* resolve) no longer forces a full re-judge on the next bare `/feedback` invocation.

**Architecture:** Prose-only change. This plugin's "logic" for `/feedback`'s session evaluation is markdown read and executed by an LLM, not deterministic code — `bin/lib/transcript-judge/watermark.js`'s `writeWatermark`/`readWatermark` are already generic (arbitrary JSON payload, no schema validation), so no production code changes are needed. The fix is narrowing `_shared/transcript-judge.md`'s Degradation section and Watermark-write gating clause, plus `feedback/session-evaluation.md`'s watermark-payload note and its stale "no stamp written on a failed Gather-2 dispatch" claim, to the actual two-route reality the Degradation section's own opening paragraph already describes (no-transcript-resolves vs. terminal-dispatch-failure) rather than the blanket exclusion a later paragraph in the same file still asserted.

**Named-location drift caught at materialize time (#315):** the record's Key Files list named `plugin/skills/_shared/session-evaluation.md`; the real file is `plugin/skills/feedback/session-evaluation.md` (it was never under `_shared/`). Corrected before implementation.

**Tech Stack:** Markdown skill prose; `node --test` prose-conformance tests (`tests/transcript-judge-prose.test.js`, `tests/feedback-watermark-prose.test.js`).

**Spec:** `.claude-tweaks/pipelines/2026-10-03T051711-record-2730/work/2730-spec.md` (materialized from GitHub issue #2730)

## Global Constraints

- No change to `bin/lib/transcript-judge/watermark.js`'s public signature or behavior — it already accepts an arbitrary payload object.
- Every existing pinned regex in `tests/transcript-judge-prose.test.js` and `tests/feedback-watermark-prose.test.js` must still match (verified by running both files, not just the new assertions).
- A watermark file written before this change (no `mode` field) must still read correctly — the fix is additive, never a shape change to existing fields.

## Review Focus

- The narrowed exclusion is keyed on "did a transcript path resolve," not on "did the dispatch succeed" — a judge-dispatch failure after a transcript resolved writes a watermark; no transcript resolving at all still writes none.
- `session-evaluation.md`'s own stale claim ("No stamp is written at all when Gather 2's dispatch was reported as failed") directly contradicted the fix and needed correcting in the same pass — not just the shared file's Degradation section the record named.
- Reflect's own consumer file (`plugin/skills/reflect/SKILL.md`) does not branch on watermark absence as a self-assessment signal — confirmed by grep, no edit needed there (the Gotchas section's explicit ask).

---

### Task 1: Narrow the self-assessment watermark exclusion and its downstream claims

**Status: implemented and verified in this worktree.**

**Files:**
- Modify: `plugin/skills/_shared/transcript-judge.md` (Skip-check exemption paragraph, Degradation section, Watermark-write gating clause + payload shape)
- Modify: `plugin/skills/feedback/session-evaluation.md` (Watermark-payload intro + payload shape, Gather-2-failure paragraph)
- Test: `tests/transcript-judge-prose.test.js` (new assertions, section "#2730")
- Test: `tests/feedback-watermark-prose.test.js` (new assertions, section "#2730")

**Interfaces:**
- Consumes: `writeWatermark(transcriptPath, data, opts)` / `readWatermark(transcriptPath, opts)` (`bin/lib/transcript-judge/watermark.js`, unchanged).
- Produces: a `mode: "self-assessment"` field, additive to the existing watermark payload shape, consumed by any future human/tooling inspection of a watermark file; no mechanical reader branches on it today.

- [x] **Step 1: Narrow the Skip-check exemption paragraph's over-broad claim**

`_shared/transcript-judge.md`'s Skip-check section stated self-assessment "only fires when no transcript file resolves at all" — contradicted by the Degradation section's own two-route opening paragraph a few dozen lines later. Rewrote to describe both routes accurately while keeping the skip check's actual behavior (a no-op on both self-assessment routes) unchanged.

Run: `node --test tests/transcript-judge-prose.test.js`
Expected: PASS (82 assertions, including the untouched "self-assessment exemption for the skip check" pin)

- [x] **Step 2: Narrow the Degradation section's watermark exclusion**

Replaced "The self-assessment path never reads or writes a watermark — there is no resolved transcript path to key one on" with the two-route-aware rule: no watermark on the no-transcript-resolves route (genuinely nothing to key on), a `writeWatermark` call — with `mode: "self-assessment"` — on the terminal-dispatch-failure route, reusing the `bytesAtDispatch` already captured before the failed dispatch attempt.

Run: `node --test tests/transcript-judge-prose.test.js -t "#2730"`
Expected: PASS

- [x] **Step 3: Widen the Watermark-write section's gating clause and payload shape**

Dropped "and not the self-assessment degradation path above" from the `DONE`/`DONE_WITH_CONCERNS` gate (kept the pinned literal prefix intact for `tests/transcript-judge-prose.test.js`'s existing assertion), added the self-assessment route as an alternate trigger, and added a `mode` field (with absent-field-is-dispatched-case fallback note) to the shown payload shape.

Run: `node --test tests/transcript-judge-prose.test.js -t "watermark write is gated"`
Expected: PASS

- [x] **Step 4: Update feedback's own watermark-payload note and correct its stale Gather-2-failure claim**

`session-evaluation.md`'s watermark-payload intro now covers both triggers; its payload shape gained the `mode` field; its Gather-2-failure paragraph no longer claims "no stamp is written at all" on a failed dispatch — it now states the stamp still writes when self-assessment resolved a real transcript path, and names the one true no-stamp case (no-transcript-resolves) explicitly.

Run: `node --test tests/feedback-watermark-prose.test.js`
Expected: PASS (28 assertions)

- [x] **Step 5: Full verification**

Run: `npm test`
Expected: PASS (no regressions elsewhere — this is a two-file prose change with no production-code surface)
