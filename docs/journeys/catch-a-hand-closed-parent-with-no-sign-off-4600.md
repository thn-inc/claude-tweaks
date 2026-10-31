---
files:
  - plugin/bin/lib/issues/acceptance.js
  - plugin/bin/lib/issues/below-floor-parent-close.js
  - plugin/skills/_shared/github-pr-scan-acceptance.md
  - plugin/skills/tidy/step-1-records.md
  - tests/closed-parent-acceptance-backstop.test.js
---

# Catch a Hand-Closed Parent With No Sign-Off

**Persona:** a maintainer who decomposed a risky feature into sub-issues with `/claude-tweaks:specify`. At least one sub-issue is above the oversight floor. Once the last sub-issue shipped, they closed the parent issue by hand from the GitHub UI, or by setting `closed: true` on a local record, without running `/claude-tweaks:demo`. Since #4466, no tidy scope looked at such a parent, so the feature left the backlog with nobody having signed off on it.

**Goal:** the next `/claude-tweaks:tidy` run names that parent once and points at `/claude-tweaks:demo #{n}`. It stays quiet about every parent that owes no sign-off.

**Entry point:** `/claude-tweaks:tidy`. On `work-backend: github-issues` that is Step 4.8's `parent-gate` scope (`_shared/github-pr-scan-acceptance.md`); on `work-backend: local-files` it is Step 1's Shape 7 (`tidy/step-1-records.md`).

**Success state:**
- A parent closed in the last 30 days that has no acceptance label (or `acceptance` facet) and no #4466 close marker, and whose sub-issue risk exceeds `risk-floor`, appears exactly once: `[acceptance-gap] #{n}: {title} — closed with no acceptance disposition — recommend /claude-tweaks:demo #{n}`. Local-files rows use `{id}` instead of `#{n}`.
- A parent that #4466 closed below the floor does not appear, even after its floor or a sub-issue's `risk:*` label changes.

## Steps

### 1. Tidy sweeps the recently closed parents alongside the open ones
- **URL:** `github-pr-scan-acceptance.md`, `## Scope: \`parent-gate\``, the parent fetch block (Shape 7's `queryRecords` calls under `local-files`)
- **Action:**
  - On GitHub, the scan fetches the closed `parent-issue` and `family:parent` parents from the last 31 days, with their comments.
  - Client-side it keeps only those closed within 30 days.
  - It marks a parent whose comments carry #4466's `## Closed below the oversight floor` heading. That comment must come from a trusted author or the current `gh` login (`isCloseMarkerComment`).
  - Local-files: Shape 7 adds a `{ isParentIssue: true, closed: true }` query. It keeps a parent whose `closedAt` is missing or unparseable, and reads the marker from the parent record's body.
- **Should feel:** invisible. The open-parent `[parent-gate]` rows read exactly as before.
- **Should understand:**
  - The marker, not today's floor, is what proves #4466 closed a parent.
  - A marker comment from anyone else counts as no marker, so a forged comment can never hide a gap.
  - On GitHub, if `gh api user` returns no login, the fetch block throws and the whole scope stops. It reports no rows and quotes the error, rather than reading a marker the current `gh` identity posted as missing.
- **Red flags:**
  - A parent closed more than 30 days ago that reappears.
  - A parent listed twice because it carries both labels.
  - `[parent-gate]` or `[acceptance-gap]` rows reported after the empty-login guard threw.

### 2. Each closed parent gets one verdict
- **URL:** `plugin/bin/lib/issues/acceptance.js`, `closedParentGap`
- **Action:** the scan reaches a verdict for each closed parent in this order:
  1. The #4466 marker means no row.
  2. An acceptance label or facet, or a not-planned or duplicate close, means no row.
  3. A parent with no discoverable sub-issues is counted in a warning.
  4. Otherwise the sub-issue risk aggregate is compared against `risk-floor`, and exceeding it prints the row.
  5. On GitHub, a sub-issue missing from the state map counts as unread. A readable sub-issue above the floor still proves the gap. Otherwise the parent is counted in a warning.
- **Should feel:** decisive. One row per real gap, never a guess.
- **Should understand:**
  - `needsBackstop` still excludes every parent unless the parent-gate sweep passes `parentExceedsFloor: true`.
  - The `acceptance-gap` scope and Shape 8 never report a parent, so no parent is reported twice.
- **Red flags:**
  - A row for a parent below the floor.
  - A row for a parent with a `demo:approved`/`accept:approved` label.
  - A row with an unread sub-issue when none of the readable ones exceed the floor.

### 3. The maintainer acts on the row, or on the warning
- **URL:** `/claude-tweaks:tidy`'s report, then `/claude-tweaks:demo #{n}`
- **Action:** the maintainer runs `/claude-tweaks:demo #{n}` to give the feature its human verdict. A `WARNING: … closed parent(s) print no [acceptance-gap] row (no-sub-issues | unread-sub-issue)` line beside the rows names the parents tidy could not judge.
- **Should feel:** like a reminder, not a chore. The row is staged and changes nothing until the maintainer acts.
- **Should understand:**
  - The row is the ordinary `[acceptance-gap]` form: same `info` severity, same routing, mutating nothing.
  - The warning points at `work-links` or `backlog-fetch-limit` on GitHub, and at the sub-issue records' `parent` facet on local-files.
- **Red flags:**
  - A warning that never names a count.
  - A run where the warning is dropped from the report.

## Origin

Built by `/claude-tweaks:flow` record #4600 (run `2026-10-31T190944-record-4600`), resuming the plan-review stop of run `2026-10-31T074012-record-4600`.
