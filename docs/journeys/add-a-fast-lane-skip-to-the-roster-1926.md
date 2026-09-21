---
files:
  - plugin/skills/_shared/ceremony-profile.md
  - plugin/bin/plan-audit.js
  - plugin/bin/lib/plan-audit/parser.js
  - plugin/skills/build/dispatch.md
  - plugin/skills/flow/steps-and-gates.md
  - tests/ceremony-profile-roster.test.js
---

# Add a Fast-Lane Skip Without Drifting the Roster

**Persona:** A claude-tweaks skill author who wants a `ceremony-profile: fast-lane` record to skip one more step — and a maintainer reading a fast-lane run's decision log who wants to know exactly what was skipped and why that was safe.
**Goal:** Land a new skip so that every consumer cites one roster row instead of restating the rule, the conformance test proves nothing restates it, and a fast-lane run's `decisions.md` names each skip with its writer.
**Entry point:** A checkout of this repo; `plugin/skills/_shared/ceremony-profile.md` open; a plan file to count.
**Success state:** The roster has a new tagged row (or a new "Mentions" row for a line that only renders a skip), every skill line pairing `fast-lane` with `skip` carries a tag or a rostered mention, `node --test tests/ceremony-profile-roster.test.js` is green, and `plan-audit.js --count-tasks` answers the single-task question from the plan file alone.

## Steps

### 1. Read the roster before touching a skill
- **URL:** `plugin/skills/_shared/ceremony-profile.md`
- **Action:** Read the three tables — Skips by profile (tag-keyed), Never skipped, Mentions that are not skips.
- **Should feel:** One page answers "what does fast-lane skip, and what may nothing skip" — no need to reconstruct it from five files.
- **Should understand:** The Step column is a tag (`review-step-1`, `plan-audit`, `sdd-whole-branch-review`, `polish`, …); a citing line writes `roster tag \`{tag}\`` next to `_shared/ceremony-profile.md` on the same physical line. Never-skipped rows (review Steps 2/3/5, the rendered-UI check, build Common Step 5, reflect's Near-misses/Fresh-start/Friction, the escape hatch, the `[IL-116]` floor, HARD-GATEs, `/claude-tweaks:test`'s Design CLI gate, `/claude-tweaks:review` Step 6.5) are the floor a new skip must not touch. The escape hatch downgrades only the current run's remaining wrap-up steps — it never re-runs a skipped step and never rewrites the record's `ceremony:*` label.
- **Red flags:** A skip you cannot place in a row; a rationale sentence you are about to paste into a skill file instead of citing the roster.

### 2. Count the plan's tasks the way the pipeline does
- **URL:** `node plugin/bin/plan-audit.js --count-tasks docs/superpowers/plans/{plan}.md`
- **Action:** Run it on a one-task plan and on this record's own plan.
- **Should feel:** Read-only and instant — one JSON line, no checks run.
- **Should understand:** `{"tasks": n, "batched": boolean}`; exit 2 for an unreadable plan or one with no `### Task N:` heading. `batched` is true only for a plan whose header carries `**Execution:** batched` (outside fenced code) or whose task title carries `[batch]` — the plan author's marker per `build/plan-authoring-checks.md`; `false` means "no marker present". `build/dispatch.md` skips SDD's final whole-branch review only when the profile is fast-lane **and** `tasks` is 1 **and** `batched` is false; a standalone `/claude-tweaks:build` with no `config.yml` never skips.
- **Red flags:** Reading the task count from the diff or from an agent's narration; a batch bundled into one `### Task` with no marker (it would qualify for the skip).

### 3. Add the skip, cite the tag, watch the test enforce it
- **URL:** the skill file gaining the skip, then `node --test tests/ceremony-profile-roster.test.js`
- **Action:** Add a roster row with a new tag; write the skip sentence in the consumer with `roster tag \`{tag}\`` on the same line as `fast-lane` and `skip`; run the test. Then, deliberately, add a line `Under fast-lane this step is skipped.` to any skill file and run it again.
- **Should feel:** The test names the offending file and line; remove the line and it is green again.
- **Should understand:** The check is per physical line and case-insensitive on `fast-lane` + `skip`; a line that only renders a skip (a summary template cell, the decision tree's entry line, the escape hatch's own gate) goes in the Mentions table with a `Line contains` substring instead of a tag. A wrapped sentence whose two words land on different lines is invisible to the test — keep them together.
- **Red flags:** Widening the test to make a line pass; a Mentions substring so short it would exempt an unrelated future skip in the same file.

### 4. Read a fast-lane run's decision log
- **URL:** `{run-dir}/decisions.md` after a fast-lane single-task run
- **Action:** Find the two new entries.
- **Should feel:** Each skip is named, once, with its writer — never silent.
- **Should understand:** `SKIP {time} — Whole-branch review skipped: fast-lane, single-task plan (task review covers the whole branch). Reversibility: n/a.` under `## /build`, and `SKIP {time} — polish skipped: fast-lane. Reversibility: n/a.` under `## /flow`, both written through `log-decision.js --status SKIP`. A fast-lane frontend record still gets `/claude-tweaks:test`'s Design CLI gate and `/claude-tweaks:review` Step 6.5; the polish PR checklist row is removed at polish's would-be exit, like `no-polish`, in a single-record run — a multi-spec run instead defers that removal to the pre-merge refresh (`_shared/pr-early-run-lifecycle.md`'s skip-rule scoping, #1712).
- **Red flags:** An `AUTO … Whole-branch review dispatched on {model}` line next to the SKIP line (the dispatch did not happen); a polish row left unchecked on the PR in a single-record run (in a multi-spec run this is expected until the pre-merge refresh, not a red flag).

## Origin
- Created during build of #1926 (fast lane that sheds cost: the ceremony-profile skip roster, the single-task whole-branch review skip, the polish skip) — the developer-facing half of the parent's ceremony-cost work (#1920).
- Related journeys: `pre-authorize-a-flow-runs-merge.md` (the auto-merge path a fast-lane record may take after these skips).
