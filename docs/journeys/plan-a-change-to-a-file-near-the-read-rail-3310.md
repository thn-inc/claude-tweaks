---
files:
  - plugin/bin/lib/plan-audit/checks.js
  - plugin/bin/plan-audit.js
  - plugin/skills/build/plan-audit.md
  - plugin/skills/build/SKILL.md
  - plugin/bin/lib/skill-audit/budgets.js
  - plugin/bin/lib/skill-audit/context-cost.js
  - docs/decisions/0024-skill-size-limits-guard-platform-limits-only.md
---

# Plan a Change to a File Near the Read Rail

**Persona:** A claude-tweaks plugin maintainer, or a `/claude-tweaks:build` session, planning a task that grows a `plugin/skills/**/*.md` file already close to the Read-limit rail.
**Goal:** Know before building whether the planned growth fits in one Read call, and if it does not, pick the remedy that actually reduces the number that is too big.
**Entry point:** `/claude-tweaks:build` Common Step 1.5's plan audit, or a direct `node plugin/bin/plan-audit.js {plan-file} --repo-root .`.
**Success state:** The maintainer reads the headroom result against `RAIL_BYTES` (52,500 B) and knows whether the file is in the near band, over the rail, or composed into a bundle near the rail. They plan the matching remedy (cut bytes or move a lazy section out for a raw file; fence or compose for a composed bundle) before any code is written.

## Steps

### 1. Read the headroom summary
- **URL:** plan-audit's second output line, e.g. `plan-audit: Headroom: 1 near rail.`, plus the JSON envelope's `headroom` object.
- **Action:** Read `headroom.nearCeiling`, `headroom.breaches` and `headroom.composed` for each governed file the plan modifies (`Modify:`/`Delete:`/`Test:`, never `Create:`).
- **Should feel:** Like a heads-up with a number attached, not a vague worry that "the file feels long". Each entry names the file, its bytes, and its remaining headroom against one constant.
- **Should understand:**
  - The only limit is `RAIL_BYTES` (52,500 B, from `plugin/bin/lib/skill-audit/budgets.js`), the size at which a file stops fitting in one Read call. There is no separate per-file or composed ceiling anymore (decision 0024).
  - Each file's bytes are measured the way the rail measures them: `context-cost.js`'s `measuredBytes`, with CRLF line endings normalized to LF and `<!-- when: … -->` marker lines stripped. A file's plan-audit bytes and its `rail:` test bytes are the same number.
  - `nearCeiling` means at or above 90% of the rail (47,250 B). It never fails the check.
  - A `breaches` entry (over 52,500 B) is a stop.
  - `headroom.composed` rows measure every compose call site whose sources the plan touches, against the same rail, with no per-step exceptions.
  - The envelope keys kept their old names (`nearCeiling`, the composed row's `ceiling` field); they now carry rail values.
- **Red flags:**
  - A `ceiling` value other than 52500 in a composed row.
  - A file at 51,201 B reported as a breach. That size was over the old per-file limit; it is now near-rail only.
  - The summary still saying `near-ceiling`.
  - A marker-heavy file, or any file in a Windows CRLF checkout, reported as a breach while the `rail:` tests pass it. That is the raw `stat` size, not the measured size.

### 2. Pick the remedy that matches the number
- **URL:** `plugin/skills/build/plan-audit.md`'s headroom bullets, and decision 0024's goal 4.
- **Action:** Decide which number is near the rail, and plan the remedy for that number as an explicit plan task:
  - For a raw file in `nearCeiling` or `breaches`, cut bytes, or move a genuinely lazy section (one some runs never read) into its own cited file.
  - For a composed row near or over the rail, fence the condition-specific passages with `when:` markers, or compose them.
- **Should feel:** Decisive. The remedy follows from what was measured, not from habit.
- **Should understand:**
  - Fencing does not help a raw file. The rail measures the raw file with only the marker lines stripped, so fenced text still counts.
  - A "read X now" split that every run follows is never the answer. It moves bytes without cutting what a run loads.
  - Plan-time guidance follows the same rule:
    - `/claude-tweaks:specify` raises a Rail-headroom flag for a group whose shared file sits within 10% of the rail.
    - `/claude-tweaks:build`'s byte-pin check measures against `RAIL_BYTES` and any per-file pin still present in `tests/`.
- **Red flags:**
  - A plan that fences a raw file to clear a breach.
  - A plan that splits a file into a sibling every run reads.
  - A plan that names no remedy at all for a breach.

### 3. Merge without a size-prediction step
- **URL:** `plugin/skills/_shared/pr-checklist-refresh.md`'s Pre-merge title/description refresh.
- **Action:** Nothing size-related. The pre-merge refresh no longer runs a merge-size probe; its items now start at the phase-checklist re-run.
- **Should feel:** Quieter. A concurrent sibling's merge can no longer tip a file red at a line that predicted nothing about the Read limit.
- **Should understand:**
  - The `rail:` tests in `tests/bin-lib/skill-audit/context-cost.test.js` run on the merged tree and fail CI only when a shipped skill file or composed bundle genuinely cannot be read in one call.
  - Cost below the rail is shown, never gated: `/claude-tweaks:review`'s skill load delta, and `/claude-tweaks:harness-health`'s transcript-measured load.
- **Red flags:**
  - A post-merge size-prediction line in a run summary.
  - A pre-merge refresh whose items are not numbered contiguously from 1.

## Origin
- Created during build of #3310, the cutover step of parent #3305: every skill-size consumer moved to the Read rail, and decision 0024 was recorded.
- Step 1 updated during build of #3459: the per-file headroom bytes now use the rail's own measurement (marker-stripped, CRLF-normalized) instead of the raw file size.
- Related:
  - `act-on-a-red-read-limit-rail-3306.md`: what to do when the rail test itself goes red.
  - `read-a-skill-load-delta-at-review-3307.md`: the cost shown at review time.
  - `read-a-size-outlier-in-the-bloat-scan-3308.md`: the coherence signal.
  - `measure-composed-bytes-per-call-site-1990.md`: the composed measurement behind step 1's composed rows.
