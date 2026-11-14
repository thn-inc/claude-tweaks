---
files:
  - plugin/bin/ci-workflow-review.js
  - plugin/bin/lib/init/ci-workflow-review.js
  - plugin/bin/lib/merge-verification.js
  - plugin/skills/init/bootstrap/step-22-ci-workflow-review.md
  - plugin/skills/init/update-mode.md
  - plugin/skills/init/scope-selection-gate.md
  - plugin/skills/_shared/ci-skips-drafts.md
---

# Review an Existing CI Workflow at Init

**Persona:** Developer adopting claude-tweaks in a repository that already has its own PR-triggered GitHub Actions workflows, written before the plugin's merge gate existed.
**Goal:** Learn, before the first pipeline run parks or burns Actions minutes, which of those workflows break the merge gate's assumption that PR CI reports a check on every head it waits for.
**Entry point:** `/claude-tweaks:init` (Step 22 on a first run, or Update Mode's CI Workflow Review row on a re-run); `ci-review` alone runs just this step.
**Success state:** Each problem workflow is listed with the check it fails, a detail naming the trigger or job, and the `_shared/ci-skips-drafts.md` section that fixes it; nothing was edited; a workflow the review could not read is shown as unparsed, never as clean.

## Steps

### 1. Run init — the bootstrap pass or a re-run
- **URL:** `plugin/skills/init/bootstrap/step-22-ci-workflow-review.md` (first run), `plugin/skills/init/update-mode.md` § CI Workflow Review (re-run)
- **Action:** Run `/claude-tweaks:init`. Step 22 runs `node "${CLAUDE_PLUGIN_ROOT}/bin/ci-workflow-review.js" --root .`; a re-run reaches the same review through Update Mode's row with `--drift --json`.
- **Should feel:** Like a read-only lint pass — no prompt to accept a rewrite, no file changed.
- **Should understand:** The review reads only `.github/workflows/*.yml` and `*.yaml` and `.claude-tweaks/verify-scope.json`, each resolved inside the checkout. On a re-run the Scope Selection Gate's early exits (Done, Interactive Skip Phase 1) still run the held review, so it is never silently dropped.
- **Red flags:** The review appearing twice in one run; a re-run that exits early without showing it; any workflow file modified afterwards.

### 2. Read the findings table
- **URL:** the printed table and its summary line
- **Action:** Read each row: workflow file, check, detail, remedy section.
- **Should feel:** Pointed — every row names one file, one trigger or job, and one section to read.
- **Should understand:** The five checks are a draft skip with no `ready_for_review` trigger, a draft skip in a workflow a declared `ci` source names (the detail names that source and its job), a `paths:` filter with no other workflow that reports on every PR head, a PR workflow re-run by pushes that lacks workflow-level `cancel-in-progress: true`, and a push-all workflow gated only by step-level `if:` (#5152's runner cost). `findings: 0` alone is clean.
- **Red flags:** A finding with no remedy; a concurrency finding on a `types: [closed]` or `[labeled]` workflow no push ever re-runs.

### 3. Handle an unparsed workflow or a could-not-review line
- **URL:** the summary's `not clean: {K} workflow(s) unparsed` ending, or `ci-workflow-review: could not review — {stderr}`
- **Action:** For an unparsed row, read its reason and simplify the named construct (tabs, anchors or aliases, an unsupported form of a key a check reads). For exit 1, fix the named path: an invalid `verify-scope.json`, a `.github/workflows` that is not a directory, or a path that is unreadable, dangling or outside the checkout.
- **Should feel:** Honest — the review says what it could not read instead of guessing.
- **Should understand:** An unparsed workflow got none of the checks, except one unparsed only for a concurrency reason (`cancel-in-progress expression not evaluated`, `concurrency not read` or `cancel-in-progress value not read`), which still got every check but concurrency — so a project using `_shared/ci-skips-drafts.md`'s recommended expression guard keeps its draft-skip findings. Only an absent workflows directory or declaration is silent.
- **Red flags:** A summary reading clean while any workflow is unparsed; an expression guard hiding a draft-skip finding.

### 4. Apply a remedy by hand
- **URL:** `plugin/skills/_shared/ci-skips-drafts.md` (§ Workflow shape, § Coexistence with the `ci` verification source, § Path filters, § Concurrency), or `see thn-inc/claude-tweaks#5152` for the push-gating shape — the plugin's own issue, qualified because a bare `#5152` would name an issue in the project under review
- **Action:** Edit the workflow per the named section, then re-run `/claude-tweaks:init` (or `ci-review` alone) to confirm the row is gone.
- **Should feel:** Self-serve — the section has the YAML to copy.
- **Should understand:** The plugin never writes the fix; the plugin's own generated `track-issue-fixes.yml` is classified by Step 16 instead, unless it was hand-modified.
- **Red flags:** A fixed workflow still reported; the generated tracking workflow reported as a project finding while unmodified.

## Origin
- Created during build of #5162 (a deterministic, report-only review of a project's existing PR-triggered workflows at `/claude-tweaks:init` Step 22 and in Update Mode): Steps 1-4 built in this session.
- Related specs: #5153 (the merge gate's draft-skip handling and `_shared/ci-skips-drafts.md`), #5152 (the push-all runner cost check 5 generalises), #1924 (`verify-scope.json`'s `ci` source).
