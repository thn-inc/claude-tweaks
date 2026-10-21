---
files:
  - plugin/bin/lib/plan-audit/parser.js
  - plugin/bin/lib/plan-audit/checks.js
  - plugin/bin/plan-audit.js
  - plugin/skills/build/plan-audit.md
  - plugin/skills/build/plan-authoring-checks.md
---

# Catch a Dropped Verify Step at Plan Audit

**Persona:** A `/claude-tweaks:build` session, or a maintainer, auditing a fresh plan against the spec it implements. The spec's Technical Approach says "read the rows back from route A and route B, and change those readers only if the model change breaks them", and the plan was written by `/superpowers:writing-plans` with no task touching either route.
**Goal:** Learn at plan time, before any task is dispatched, that a file the spec told the build to verify or read back appears in no plan task. The alternative is the final whole-branch review finding the defect the spec predicted.
**Entry point:** `/claude-tweaks:build` Common Step 1.5 with the materialized spec passed as `--spec`, or a direct `node plugin/bin/plan-audit.js {plan-file} --spec {spec-file}`.
**Success state:**
- Each unlisted path is resolved in the plan before dispatch: it is now in the `Files:` block of the task that verifies or changes it, or it carries a `Waived {path}: {reason}` line naming the step that reads it.
- The re-run audit reports no `checkF.unlisted` entries.
- In auto mode the amendment is logged as one `AUTO` decision line, with no prompt.

## Steps

### 1. Read the Check F warning
- **URL:** plan-audit's second output line, e.g. `plan-audit: Check F: 2 unlisted spec path(s).`, plus the envelope's `checkF` object.
- **Action:** Read `checkF.unlisted`. Each entry is `{path, section}`: a repo path named in a backtick code span of the spec's `## Technical Approach` (its `### Key Files` included) or `## Gotchas` that no task's `Files:` bullet lists.
- **Should feel:** Like a precise pointer: "the spec named `src/routes/a.js` in Technical Approach, and no task touches it". Not a wall of keyword noise. On a well-formed plan the check is silent.
- **Should understand:**
  - Check F is warn-only. `ok` is always `true` and the exit code never changes because of it, so it never stops the build on its own.
  - Without `--spec` it is `{ok: true, skipped: 'no-spec'}`.
  - Paths named only in `## Acceptance Criteria` or `## Deliverables` are never reported. Check E covers the AC clauses, and the Deliverables are the plan's own task list.
  - A plugin-relative citation (`_shared/x.md`) counts as listed when a `Files:` bullet names the full path (`plugin/skills/_shared/x.md`), reported as `via: 'suffix'`.
- **Red flags:**
  - A Check F entry for a path that only appears under `## Acceptance Criteria`.
  - A non-zero exit code caused by Check F alone.
  - A basename like `parser.js`, an identifier, a glob, or a `{placeholder}` path reported as unlisted.

### 2. Treat a read-only Key File as a real finding
- **URL:** `plugin/skills/build/plan-audit.md`'s Check F bullet under "What each check covers".
- **Action:** For an unlisted path the build only needs to read, do not dismiss the warning. Either add the file to the verifying task's `Files:` block (as `Modify:` when the spec's condition may change it), or add `Waived {path}: {reason}` with a reason that names the step that reads it.
- **Should feel:** Obvious once stated. A file the build only reads is exactly what this check exists to catch, because that read-back step is the one that vanished in #3602's incident.
- **Should understand:**
  - A waiver suppresses the entry and moves it to `checkF.waived`.
  - A waiver may use the full path even when the spec cited a plugin-relative one.
  - A waiver that matches no extracted path lands in `checkF.orphanWaivers`, which means a stale or mistyped waiver to fix.
- **Red flags:**
  - A plan author reading an unlisted Key Files path as a false positive and ignoring it.
  - A waiver with no reason.
  - An orphan waiver left in the plan.

### 3. Check what the audit could not read
- **URL:** `checkF.unparsed` and the summary part `Check F: N unparsed spec block(s)`.
- **Action:** For each unparsed entry, read the named spec section yourself and check its paths against the plan, then log the scan with `--status SCANNED`. An entry is one of: a line with an unbalanced or double-backtick code span; `unclosed code fence in "## {section}"`; or `unclosed code fence before "## {section}"`.
- **Should feel:** Honest. The audit says what it could not read rather than reporting a clean result over text it skipped.
- **Should understand:** An unparsed entry is never counted as covered.
- **Red flags:**
  - A spec with an unclosed fence before Technical Approach producing a clean, empty Check F result.

### 4. Amend and re-run
- **URL:** `plugin/skills/build/plan-audit.md`'s `checkF.unlisted` Result-interpretation bullet.
- **Action:** Amend the plan, then re-run the audit once. In auto mode, log the amendment with `log-decision.js --status AUTO --step "Common Step 1.5 (Check F)"`. Interactive mode surfaces it inline, with no `AskUserQuestion`.
- **Should feel:** Cheap. One plan edit at authoring time instead of a fix wave after the whole-branch review.
- **Should understand:**
  - Check F shares Check E's trivial-plan skip gate.
  - Run it while authoring too, as `plan-authoring-checks.md`'s Verify-then-maybe-change check says.
- **Red flags:**
  - The amendment routed through the `scope-creep` policy.
  - Check F blocking dispatch.

## Origin
- Created during build of #3602 (plan-audit Check F, spec-named path coverage). Filed from a consumer project's feedback (fingerprint `feedback-31e632cd`): a spec's "read back / change only if" Technical Approach step vanished from the plan, and only the final whole-branch review caught the predicted defect.
- Related: `plan-a-change-to-a-file-near-the-read-rail-3310.md`, the sibling headroom signal in the same audit output.
