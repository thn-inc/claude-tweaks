# Reconcile Interrupted-Run Floor Revisit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the revisit ruling on the 24-hour floor for reconcile's `abandoned-interrupted` route (a): kept, dated 2026-10-31, with the measured counts.

**Architecture:** A docs-only change. The measurement already ran this session over the checkout's run directories. It shows that interrupted pipeline runs are regularly resumed 6–24 hours after their session ended, so a `dead` verdict (the owning session is gone) does not predict abandonment, and the floor stays. No constant and no test changes.

**Tech Stack:** Markdown; `node --test` via `npm test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T062110-spec-4437/work/4437-spec.md`

## Global Constraints

- `ORPHAN_MINT_TTL_MS` and `STALE_INTERRUPTED_TTL_MS` stay unchanged (`plugin/bin/lib/reconcile/archive-merged.js`).
- The ruling paragraph names the outcome (kept or changed), the date, and the measured counts.

## Measured data (inputs to Task 1 — do not re-derive)

Scratch script `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/954d2677-d2ec-4142-9657-ef50a24dca98/scratchpad/floor-measure.js`, run 2026-10-31 over the main checkout's `.claude-tweaks/pipelines/` and `pipelines/archive/` (run-id-named directories with an `events.jsonl`: 1,856). It counts one episode per own (non-`fallback`) `session-end` event with a `sessionId`, and a resume as the next own `skill_invoked`/`commit`/`verify`/`ask-user-question`/`pre-compact` event after it, from any session.

- All runs: 307 episodes in 220 runs; 134 resumed, 173 never.
- Pipeline runs (name without `-standalone`): 180 episodes; 108 resumed — under 1 h 79, 1–6 h 16, 6–12 h 3, 12–24 h 7, 24–72 h 3.
- Owner-block runs (`run-state.json` carries `owner`): 4 episodes, 1 resumed (under 1 h) — too few to judge on their own.
- Independent count: `grep` over every `events.jsonl` (any depth) finds 317 own `session-end` events with a `sessionId`; the 10 the script does not scan sit in 4 archive directories outside the run-id pattern (doubly nested or a short timestamp). Reconciled.

Effect of a shorter floor on those 108 resumed pipeline runs: a 12-hour floor would have archived 7 more than today's 24 hours, a 6-hour floor 10 more.

## Spec coverage

| Clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 2 (grep for the dated ruling) and Step 3 (AC evidence entry) |
| AC2.1 | Waived — floor kept (Task 1 Step 2) |
| AC3.1 | Task 1 Step 4 (full suite through `verify.js`) |

## Review Focus

- A reader of the ruling must be able to tell measured counts from inference: the "dead does not predict abandonment" claim rests on the resume gaps, so the paragraph states the counts, not just the conclusion.
- The paragraph must keep the original 2026-10-22 ruling visible, adding the revisit rather than replacing history.
- The revisit trigger sentence must not survive as an open trigger once the revisit is recorded.

---

### Task 1: Record the kept-floor ruling

**Files:**
- Modify: `docs/reconcile-checks.md:338`
- Waived `plugin/bin/lib/reconcile/archive-merged.js`: read only — the floor is kept, so `STALE_INTERRUPTED_TTL_MS`/`ORPHAN_MINT_TTL_MS` and their comment stay as they are (AC2 does not apply).
- Waived `tests/bin-lib/reconcile/archive-merged.test.js`: read only — the AC3 boundary tests already pin the kept 24-hour floor at lines 3001–3004.

**Interfaces:**
- Consumes: the Measured data section above.
- Produces: nothing code consumes.

- [ ] **Step 1: Replace the floor-ruling paragraph**

Replace the line starting `**The 24-hour floor.**` with this text, as one paragraph:

```markdown
**The 24-hour floor.** `STALE_INTERRUPTED_TTL_MS` is unchanged (maintainer ruling 2026-10-22, kept on revisit 2026-10-31, #4437): a dead verdict still needs the same 24 hours of silence the kind needed before. A dead verdict proves the owning session has ended, not that the run is abandoned, and interrupted runs are resumed by later sessions. Measured on this checkout on 2026-10-31 over 1,856 run directories with an `events.jsonl` (live and archived): 307 own `session-end` events, 134 of them followed by a later session's activity. For pipeline runs (no `-standalone` suffix), 108 of 180 resumed — 79 within an hour, 16 after 1–6 h, 3 after 6–12 h, 7 after 12–24 h, and 3 after 24–72 h — so a 12-hour floor would have archived 7 more of those resumed runs and a 6-hour floor 10 more. Only 4 of the events came from runs carrying an owner block, too few to judge owner-block runs on their own.
```

- [ ] **Step 2: Verify the ruling landed (AC1.1)**

Run: `grep -c "kept on revisit 2026-10-31, #4437" docs/reconcile-checks.md`
Expected: `1`

Run: `grep -c "Revisit trigger: revisit once the owner block has shipped for a release" docs/reconcile-checks.md`
Expected: `0`

Waived AC2.1: the floor is kept, so there is no new constant and no new boundary to pin; the existing 24-hour boundary tests stand.

- [ ] **Step 3: Record the AC evidence**

Write the measurement's output to the run directory and log one `AC evidence` entry naming AC1.1, the command shape, and the counts:

```bash
mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-31T062110-spec-4437/evidence"
node /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/954d2677-d2ec-4142-9657-ef50a24dca98/scratchpad/floor-measure.js "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines" > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-31T062110-spec-4437/evidence/floor-measure.txt"
```

Then `log-decision.js --run {run-dir} --section "/build" --status AUTO --step "AC evidence" --text-file {text-file}`, with the text file holding one line: AC1.1, `node floor-measure.js <pipelines-dir>`, the pipeline-run counts above, and the evidence path.

- [ ] **Step 4: Run the full suite (AC3.1)**

Run: `npm test` (through the build's verification step, `verify.js`)
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add docs/reconcile-checks.md
git commit -m "Record the kept 24-hour interrupted-run floor — revisit measured resumes (#4437)"
```
