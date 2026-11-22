---
files:
  - plugin/bin/skill-gate.js
  - plugin/bin/lib/skill-gate/index.js
  - plugin/skills/_shared/skill-load-gate.md
  - plugin/skills/build/SKILL.md
  - plugin/skills/test/design-gate.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/flow/steps-and-gates.md
  - plugin/skills/flow/survey.md
  - tools/skill-gate-replay.js
---

# Skip a Skill That Has Nothing to Do

**Persona:** a maintainer running `/claude-tweaks:flow #{n}`, attended or dispatched, on a record whose diff gives `/claude-tweaks:journeys`, `/claude-tweaks:visual-review` or a `/claude-tweaks:design-wrapper` mode nothing to work on. Typical examples are a test-only change, a pipeline-artifact change, or a backend record with no UI file.
**Goal:** the run does not load a skill's text into context just for that skill to report "nothing to do". The maintainer can still see, in `decisions.md` and the review summary, which skill was skipped and why.
**Entry point:** any of the seven gated steps: build Common Steps 1.7 and 6, test Step 1.5, review Steps 6 and 6.5, and flow's polish and survey steps. Or the CLI directly: `node plugin/bin/skill-gate.js --skill journeys --integration-branch main`.
**Success state:** a skipped skill leaves one `SKIP … — {step} (skipped): condition: {reason} → fallback: {skill} not loaded` line in `decisions.md`, and the skill's SKILL.md never appears in the transcript. A diff the gate cannot judge loads the skill as before.

## Steps

### 1. Reach a gated step on a test-only diff — the run's `decisions.md`
- **URL:** `{run-dir}/decisions.md` after build Common Step 6 on a branch whose changed files all sit in the no-surface set (for example `tests/**` plus `docs/plans/*-ledger.md`).
- **Action:** read the `/build` section.
- **Should feel:** quiet and accounted for. There is one SKIP line with the gate's reason, and no journeys skill run.
- **Should understand:** journeys skips only when every changed file is in `_shared/skill-load-gate.md`'s no-surface set, none is under `docs/journeys/`, and no journey's `files:` lists one. One product file, or a test file that a journey lists, turns the verdict back into a load.
- **Red flags:** a skip with no SKIP line. A skip on a diff that touches `docs/journeys/`. A journey run whose output is "No user-facing journeys affected" on a diff the gate should have skipped.

### 2. Hit an input the gate cannot judge — the CLI's JSON and stderr
- **URL:** the gate's stdout JSON and stderr, for example with a base ref that does not resolve, an unreadable `docs/journeys/`, or a journey symlink that points outside the checkout.
- **Action:** run the step, or the CLI by hand, and read the result.
- **Should feel:** safe. The skill still loads.
- **Should understand:** every failure is `proceed` with a reason starting `cannot tell: `, one stderr line, and nothing logged. Exit 2 (a malformed call) or exit 3 (an unanchored `--run`) also means the caller loads the skill. With a run dir, the caller logs that fallback as `--step "{step} (gate)"`, never as a skipped skill.
- **Red flags:** a `skip` on any error path. A `SKIP` line written for a gate failure that reads like the skill was not loaded.

### 3. Read the review summary on a backend record — `### Visual Review`
- **URL:** the review summary of a `surface: backend` record whose diff overlaps a journey's `files:` but has no UI file.
- **Action:** read the Visual Review status.
- **Should feel:** the same outcome as before, reached without loading `visual-review/SKILL.md`.
- **Should understand:** review Step 6's gate returns `skip`, the status is `Skipped — no UI changes`, and the summary repeats the gate's `reason` verbatim with its `journeys` names. A UI trigger file in the diff proceeds whatever the declared surface.
- **Red flags:** the overlapping journeys missing from the summary. A web record's visual review skipped.

### 4. Check the saving before trusting it — the replay tool
- **URL:** `node tools/skill-gate-replay.js --since {date} --until {date}` output.
- **Action:** run it over the last 30 days of merged work.
- **Should feel:** measured. Per skill and mode there is a skip/proceed count, plus the journeys wrong-skip count with and without the journey-overlap guard.
- **Should understand:** a wrong skip is a skipped commit that changed a file under `docs/journeys/`. The guard-off count shows what the no-surface set alone would have skipped. At build time (2026-10-17 to 2026-11-16, 617 commits) journeys skipped 46 with 0 wrong. The design-wrapper modes skipped everything only because this repo's CLAUDE.md has no design-integration key.
- **Red flags:** a non-zero wrong-skip count. A replay run that takes minutes again; it bulk-reads git objects.

## Origin
- Created during build of #5605, which replaced the per-step `design-detect` caller pre-checks with one gate CLI, one shared contract and a replay tool.
- Related journeys: `get-a-visual-review-recommendation-only-for-a-ui-surface-2927.md` (the visual-review rule's prose twin, Step 0.5), `read-a-skill-load-delta-at-review-3307.md` (measuring skill-load cost).
