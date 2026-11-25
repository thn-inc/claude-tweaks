# /flow Double Whole-Branch Review Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record #3381's measurement and its decision, Outcome 3: keep both whole-branch reviews unchanged. The record is a maintainer-side write-up plus its `docs/REGISTRY.md` row.

**Architecture:** The measurement has already run, in the build's main session, and selected Outcome 3. Its scratch scripts are under the session scratchpad named below. Outcome 3 changes no skill, roster, `dispatch.md` or test (spec AC5). This plan lands only the write-up and the registry row that every `docs/reference/*.md` file carries.

**Tech Stack:** Markdown; `node` for the read-only re-verification script.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T100136-record-3381/work/3381-spec.md`

## Global Constraints

- Outcome 3 (spec Deliverables): "keep both unchanged; record only the write-up." Per AC5: "no skill, roster or `dispatch.md` text changes; the write-up records why."
- Per Deliverable 2, inputs come only from each qualifying run's `sdd-final-review.md` and its per-dispatch telemetry (`timing.json`). Never reconstruct a number or finding from narration.
- Thresholds stay exactly as written in the spec: 15% cost share (exactly 15% does not exceed), half of SDD Important/Critical overlapping, at least three runs, and a pooled SDD Important/Critical count of at least 4.
- `docs/` is maintainer-side and does not ship (`docs/decisions/0015-*`).
- No project skill under `.claude/skills/` governs `docs/reference/flow-double-review-measurement.md` or `docs/REGISTRY.md`. The six that name `docs/reference/` each govern a different probe document.

## Review Focus

- A number in the write-up that disagrees with the run directory it cites. The task re-derives every cost number from `timing.json` with the scratch script and compares.
- An overlap judgment that a reader cannot re-check. Every SDD Important/Critical finding has a row naming the closest `/review` finding and the reason for the judgment.
- The decision computed from the wrong pooled number. Pooling sums, so the pooled share is not a mean of per-run shares. The Decision table shows the sums.

---

### Task 1: Measurement write-up and registry row

**Role:** transcription

**Files:**
- Create: `docs/reference/flow-double-review-measurement.md`
- Modify: `docs/REGISTRY.md` (insert one row directly after the `docs/reference/dispatch-cost-baseline.md` row, line 30)

**Interfaces:**
- Consumes: the drafted write-up at `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/b5413c30-ed33-41ab-a604-2b08950c99a1/scratchpad/m3381/flow-double-review-measurement.md` and the cost script at `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/b5413c30-ed33-41ab-a604-2b08950c99a1/scratchpad/m3381/cost.js`
- Produces: nothing later tasks read

- [ ] **Step 1: Copy the drafted write-up into place, byte for byte**

Run: `cp "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/b5413c30-ed33-41ab-a604-2b08950c99a1/scratchpad/m3381/flow-double-review-measurement.md" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-3381/docs/reference/flow-double-review-measurement.md"`
Expected: exit 0. Then `cmp` the two files: they are identical.

- [ ] **Step 2: Re-derive every cost number from the run directories**

Run the script against the seven run directories, in the write-up's order. The archived ones live under `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/`; run 4 lives under `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/`:
`node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/b5413c30-ed33-41ab-a604-2b08950c99a1/scratchpad/m3381/cost.js" "{dir1}" … "{dir7}"`
Redirect the output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-25T100136-record-3381/evidence/cost-shares.txt`. Create that directory first with a separate `mkdir -p` call.
Expected, as run once during planning: per-run `buildSec`/`finalSec`/`secShare`/`outShare`/`tokShare` of 1642/378/23/25.8/29.9, 1275/483/37.9/31/35.5, 2398/353/14.7/19.2/17.7, 3459/814/23.5/25.5/29.8, 2579/356/13.8/22.8/20.1, 3205/481/15/30.5/28.6 and 2632/368/14/19.7/17.5. The last line is `{"pooledBuildSec":17190,"pooledFinalSec":3233,"pooledSecShare":18.8,"pooledOutShare":25.1,"pooledTokShare":25.4}`. Every value must equal the write-up's Cost table; any mismatch is a stop, reported back.

- [ ] **Step 3: Check the SDD side against `sdd-final-review.md`**

For each of the seven runs, `grep -n -i -E "critical|important"` that run's `sdd-final-review.md`. Expected: runs 3, 4, 5 and 7 (#5800, #4118, #5075, #6152) each carry exactly one Important finding and no Critical one. That finding's file and line match the write-up's overlap table. Runs 1, 2 and 6 carry none.

- [ ] **Step 4: Add the registry row**

Insert after `docs/REGISTRY.md` line 30, the `docs/reference/dispatch-cost-baseline.md` row, this exact line:

```
| docs/reference/flow-double-review-measurement.md | /flow's double whole-branch review decision (#3381) — seven qualifying runs' SDD final-stage cost share from per-dispatch `timing.json` and per-finding overlap between SDD's final review and a re-run of `/review`'s lenses at SDD's reviewed commit; the pooled numbers (18.8% cost, 0/4 overlap) that selected Outcome 3, keep both reviews; re-measured when either review procedure changes materially | `plugin/skills/build/dispatch.md`, `plugin/skills/review/step3-lens-dispatch.md` |
```

- [ ] **Step 5: Record the AC evidence**

Write one line to a session temp file with the Write tool:
`AC1/AC2: write-up cost numbers re-derived from timing.json by cost.js (7 runs, pooled 3233/17190 agent-s = 18.8%) — all match; SDD Important/Critical counts re-checked against sdd-final-review.md (pooled 4) — evidence/cost-shares.txt`
Then run:
`node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.179.0/bin/log-decision.js" --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-25T100136-record-3381" --section "/build" --status AUTO --step "AC evidence" --text-file "{that file}" --reversibility n/a`

- [ ] **Step 6: Commit**

```bash
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-3381" add docs/reference/flow-double-review-measurement.md docs/REGISTRY.md
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-3381" commit -m "Record the /flow double-review measurement — Outcome 3, keep both reviews (refs #3381)"
```
