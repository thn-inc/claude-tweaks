---
files:
  - plugin/skills/tidy/scan-procedures.md
  - plugin/skills/tidy/step-6-auto.md
  - plugin/skills/tidy/SKILL.md
  - plugin/skills/tidy/approve-mode.md
  - plugin/skills/tidy/step-6-interactive.md
  - plugin/skills/tidy/plan-citation-check.md
  - plugin/skills/_shared/policy-schema.md
  - plugin/bin/declined-learning.js
  - plugin/bin/plan-retention.js
  - plugin/bin/lib/plan-retention/route.js
  - plugin/bin/lib/plan-retention/probe.js
---

# Keep Recent Plans and Approve a Bulk Prune

**Persona:** a maintainer running `/claude-tweaks:tidy`, usually at the default `moderate` tier and with `superpowers-plans-retention` unset. They expect the plan archive under `docs/superpowers/plans/` to be left alone unless they decide otherwise.

**Goal:** tidy never deletes a recent plan on its own. Once the archive has grown into noise, the maintainer gets one bulk-prune proposal to approve or decline, and a decline is remembered.

**Entry point:** `/claude-tweaks:tidy` (standalone auto, interactive, or `tidy --approve {run-dir}`) reaching Step 4, Audit Execution Plans.

**Success state:**
- Under the default `keep-forever`, no `docs/superpowers/plans/` plan is deleted without an approval.
- At most one `Prune plan (archive)` row is staged, and only once 30 or more uncited would-be-Delete plans are past the 7-day cutoff.
- Approving it removes exactly the listed plans in one commit. Declining it keeps the proposal away for about 180 days.

## Steps

### 1. Tidy reads the retention policy before classifying plans
- **URL:** `tidy/scan-procedures.md` Step 4, the **Plan retention (#4465)** paragraph
- **Action:** Step 4 runs `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values superpowers-plans-retention`. It classifies each plan with the existing table, then routes only the would-be Deletes by the value.
- **Should feel:** the maintainer's own setting decides, not a hard-coded cleanup habit.
- **Should understand:**
  - `prune-after-wrapup` keeps today's Delete.
  - `keep-forever` (the default) keeps the plan.
  - `ask` stages each would-be Delete as `Prune plan (ask)`.
  - `~/.claude/plans/` (Claude Code's plan-mode scratch) keeps the old table under every value.
  - A Keep row stays Keep under every value.
- **Red flags:**
  - A plan under Applied as `deleted` while the key is unset.
  - `~/.claude/plans/` routed by the key.
  - An in-progress spec's plan staged for pruning.

### 2. Recent and uncommitted plans stay put
- **URL:** the same paragraph's cutoff sentence
- **Action:** Under `keep-forever`, each would-be Delete's age comes from `bin/plan-retention.js`, which reads the plan's first-add commit date and reports it as `firstAdded` (a date, or `uncommitted`).
- **Should feel:** last week's work is safe, even if its record already closed.
- **Should understand:**
  - Plans younger than 7 days are Keep.
  - `firstAdded: "uncommitted"` (no first-add commit, or a git probe that failed) counts as within the cutoff, so the plan is Keep. This also holds under `ask`.
  - Below 30 past-cutoff candidates, tidy does not even run the citation check. Every such plan is a plain Keep, counted under **Clean:**.
- **Red flags:**
  - A plan created this week staged or deleted.
  - An uncommitted plan in a `Prune plan` row.
  - Cited plans showing up in Yours below the threshold.

### 3. One bulk proposal appears once the archive is noise
- **URL:** Step 6, **Approve ({N})**; `tidy/step-6-auto.md`'s **Prune plan** row
- **Action:** once 30 or more uncited would-be-Delete plans are past the cutoff, and no live decline exists, tidy collects them into one staged `tidy-prune-plan-{n}` proposal.
- **Should feel:** a single deliberate maintenance decision, in line with ADR-0007's "explicit user direction", not a drip of deletions.
- **Should understand:**
  - The row is **Stage** at every tier, `aggressive` included.
  - Before staging, `bin/plan-retention.js` (run from `{REPO_ROOT}`) looks the decline up itself. A live decline, or a lookup that throws, routes the plans back to Keep.
  - The citation check runs before the list is built, so a cited plan is never listed. When the CLI reports `citationCheck: true` and any candidate is cited, tidy re-runs the same call — every plan again — with one `--cited {plan}` per cited plan, and that run's routes replace the first.
- **Red flags:**
  - A `Prune plan` auto-applied at any tier.
  - An archive listing fewer than 30 plans at staging time.
  - The same archive re-staged on the run after a decline.
  - An archive built from a `--cited` re-run that passed only the cited plans.

### 4. Approve: the listed plans go, in one commit
- **URL:** Step 7, via `SKILL.md`'s **Prune plan** Action Vocabulary row, then the Step 7.5 checklist
- **Action:** approve the row, in the same session or later with `tidy --approve {run-dir}`.
- **Should feel:** safe after an unbounded wait, because each plan is re-checked before it goes.
- **Should understand:**
  - Each plan is re-verified first:
    - `plan-citation-check.md` is still clean.
    - Its classification still holds: the related spec is still complete, an orphan still has no spec, or a very-old plan's spec is still not started.
    - It is still past the 7-day cutoff (for `(archive)`), or still committed (for `(ask)`), read from a fresh `bin/plan-retention.js` run with the staging `--retention` value.
    - `superpowers-plans-retention` is unchanged.
  - A plan that fails any check is dropped as `stale — skipped`.
  - The rest are removed with `git rm` in one commit. Git history keeps them.
  - The 30 threshold gates staging, not execution, so drops can leave fewer than 30.
  - Step 7.5 shows `Pruned plans: {n}`.
- **Red flags:**
  - A plan removed after its record reopened.
  - A plan removed after the policy changed to `ask` or `prune-after-wrapup`.
  - A Prune plan execution with no Step 7.5 line.

### 5. Decline: the proposal stays away
- **URL:** the Approve gate's override path (`tidy/step-6-interactive.md`, `tidy/approve-mode.md`)
- **Action:** exclude the whole `Prune plan (archive)` item.
- **Should feel:** heard. Saying no once is enough.
- **Should understand:**
  - Tidy records the decline from `{REPO_ROOT}`, and the maintainer's reason never touches a command line:
    it resolves a payload path with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" D=tidy-plan-decline.json`,
    writes `{"description":"tidy Prune plan (archive): docs/superpowers/plans/","reason":"{why}"}` to it with the `Write` tool (`{why}` JSON-escaped),
    then runs `node "${CLAUDE_PLUGIN_ROOT}/bin/declined-learning.js" record-decline --source tidy < "{D}"`.
  - Later runs route the plans back to Keep until reconcile's 180-day `pruneDeclines` expires the decline.
  - Excluding only some rows records nothing.
  - A `Prune plan (ask)` exclusion never records a decline, because `ask` asks every run.
  - A failed `record-decline` degrades open: one SKIP note, and the proposal may recur.
- **Red flags:**
  - A partial exclusion that silences the archive for 180 days.
  - An `ask` decline that later suppresses a `keep-forever` archive.
  - A declined archive back on the very next run.
  - The maintainer's decline reason interpolated into a shell command (a `printf` or `echo` pipe) instead of a written payload file.

## Origin
- Created during build of #4465. Tidy Step 4 used to auto-delete plans of closed records at `moderate`, which contradicted `superpowers-plans-retention`'s `keep-forever` default and ADR-0007's recent-work cutoff. The 30-plan threshold and the decline memory were decided by the user at plan review.
- Updated during build of #4594. The cutoff, the 30 threshold, the uncited recount and the decline lookup moved from Step 4's prose into `bin/plan-retention.js`; the journey's shape is unchanged, and its steps now name the CLI's `firstAdded`, `citationCheck` and `--cited` re-run.
