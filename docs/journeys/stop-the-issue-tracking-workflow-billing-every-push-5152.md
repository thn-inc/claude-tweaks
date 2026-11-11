---
files:
  - plugin/bin/lib/issue-branch-tracking.js
  - plugin/skills/init/bootstrap/step-16-non-default-branch-issue-tracking.md
  - plugin/skills/init/SKILL.md
  - .github/workflows/track-issue-fixes.yml
---

# Stop the Issue-Tracking Workflow Billing Every Push

**Persona:** Maintainer of a private repository that follows the pr-first model. They ran `/claude-tweaks:init` months ago and accepted Step 16's `track-issue-fixes.yml`. Every pipeline phase pushes, and the plugin's bookkeeping branches take pushes of their own. Each of those pushes started a billed Actions runner, even when no commit referenced an issue. They noticed it in the monthly Actions bill, not in any report.
**Goal:** Pushes that reference no issue cost no runner minutes, and they get the cheaper workflow without hand-editing a generated file or losing any edits of their own.
**Entry point:** Re-running `/claude-tweaks:init` (Step 16) in a project that already has `.github/workflows/track-issue-fixes.yml`, or running it for the first time.
**Success state:** The workflow file carries the job-level prefilter and the `claims-registry`/`health-state` exclusion. A push whose commit messages contain no `#` together with a closing-keyword stem shows both jobs as skipped and bills nothing. A push to a bookkeeping branch creates no workflow run at all. A push that says `fixes #42` still labels issue 42. The maintainer should feel the upgrade was safe: a file they never touched was refreshed silently, and a file they had edited was left alone unless they chose otherwise.

## Steps

### 1. Step 16 classifies the existing workflow file — `init/bootstrap/step-16-non-default-branch-issue-tracking.md`
- **URL:** —
- **Action:** Init reads the existing file and calls `classifyExistingWorkflow(content)`, which returns `current`, `prior-generated` or `modified`. The comparison ignores a leading byte-order mark, CRLF line endings and trailing newlines.
- **Should feel:** Unobtrusive: a re-run of init on an up-to-date project says nothing about this file.
- **Should understand:** `prior-generated` means the file is byte-identical to an earlier version the plugin generated, checked against `PRIOR_OUTPUT_SHA256`. That list covers every output in the generator's history, so nothing in such a file was written by a person.
- **Red flags:** A Windows checkout's CRLF copy classified as `modified`; a `current` file prompting or being rewritten.

### 2. An untouched earlier file is regenerated without a prompt — same file
- **URL:** —
- **Action:** On `prior-generated`, init rewrites the file from `generateWorkflowYaml()` and reports one line: `track-issue-fixes.yml: regenerated (was an unmodified earlier generator output)`.
- **Should feel:** Like the Step 14 cloud-setup script refresh: done, with a single line saying so.
- **Should understand:** The regenerated file differs from the old one only by what the generator added since: the prefilter, the bookkeeping-branch exclusion and their comments.
- **Red flags:** A question asked for a file nobody edited; a silent rewrite with no report line.

### 3. A hand-edited file is kept unless the maintainer chooses otherwise — same file
- **URL:** —
- **Action:** On `modified`, init asks one question, "Tracking wf". The two options are "Keep my file (Recommended)" and "Regenerate (discards local edits)". Keep leaves the file byte-for-byte unchanged and ends the step.
- **Should feel:** Respectful: local edits are never discarded by default.
- **Should understand:** Keeping the file also keeps the old billing behaviour. To get the prefilter, they either regenerate or port its two `if:` clauses and the `branches` list by hand.
- **Red flags:** Regenerate offered as the recommended option; the file touched after Keep.

### 4. A push with no issue reference gets no runner — `issue-branch-tracking.js`
- **URL:** —
- **Action:** **GitHub Actions** evaluates each job's `if:`. That is the existing non-default-branch condition ANDed with `contains(join(github.event.commits.*.message, ' '), '#')` and at least one stem from `PREFILTER_KEYWORD_STEMS` (`close`, `cloſe`, `fix`, `resolve`, `reſolve`). When it is false, the job shows as skipped and no runner starts.
- **Should feel:** Invisible on ordinary pushes: skipped jobs in the Actions tab, no minutes on the bill.
- **Should understand:** The prefilter is deliberately looser than the in-job extraction. It can start a runner that then finds nothing, but it never skips a push the extraction would have labeled. Tests prove this property, including a keyword and `#N` on different lines. The long-s spellings are there because the runner's `grep -iP` folds `ſ` to `s` and GitHub's `contains()` does not; a comment in the YAML says so.
- **Red flags:** A `fixes #42` push whose issue stays unlabeled; jobs running on a push whose messages contain no `#`.

### 5. Bookkeeping-branch pushes create no run — `issue-branch-tracking.js`
- **URL:** —
- **Action:** The trigger's `branches` list is `'**'`, `'!claims-registry'`, `'!health-state'`. The names come from the plugin's own `CLAIMS_BRANCH` and `HEALTH_STATE_BRANCH` constants.
- **Should feel:** Quiet: claim and health-state writes no longer appear in the Actions run list.
- **Should understand:** Renaming either branch in the plugin carries through to newly generated files; an older generated file is refreshed by step 2 on the next init.
- **Red flags:** A workflow run listed for a `claims-registry` or `health-state` push.

## Origin
- Created during the build of #5152 (generated issue-tracking workflow starts a runner on every push), reported from a private project on the pr-first model.
- Related: `bootstrap-release-automation-2253.md` (another init-generated workflow), `ci-test-gate.md`.
