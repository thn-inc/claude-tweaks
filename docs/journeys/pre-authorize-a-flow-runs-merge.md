---
files:
  - plugin/skills/flow/manifesto.md
  - plugin/skills/flow/manifesto-overrides.md
  - plugin/skills/wrap-up/manifesto-authorized-merge.md
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/flow/summary-template.md
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/bin/compose-subject.js
  - plugin/bin/lib/policy-schema.js
---

# Pre-Authorize a Flow Run's Merge, or Recover if It Doesn't Merge

**Persona:** Maintainer running `/claude-tweaks:flow` in `confirm`/`hybrid` mode who is present at run start but may not be present when the run finishes, and doesn't want to come back later just to click "merge" once every check is green.
**Goal:** Grant merge authorization once, live, at the moment they're actually watching the Manifesto — instead of returning at an unpredictable later time to approve a merge whose green state may have already started to decay.
**Entry point:** The Pipeline Config Manifesto's `Approve all / Override / Cancel` prompt, lever 13 (Merge authorization) in the levers table.
**Success state:** Either the run merges itself with zero further clicks the moment its last HARD-GATE clears (pre-authorized path), or — having declined or not answered — the maintainer gets a one-click Recommended merge option at the terminal Review Console, or, if the run ends without a decision, a paste-ready resume command that re-offers the merge without losing the PR reference.

## Steps

### 1. Answer the lever — Pipeline Config Manifesto (`AskUserQuestion`)
- **URL:** the Manifesto's `Approve all / Override / Cancel` prompt, reached by running `/claude-tweaks:flow {target} confirm` (or `hybrid`)
- **Action:** Reply `Override` with `13=pre-authorized` in the free-text `#=value` pairs, alongside any other overrides in the same reply.
- **Should feel:** A deliberate, one-time grant — not a setting they're leaving behind for every future run.
- **Should understand:** This is a live answer for *this run only* — it can never be set from `.claude-tweaks/policy.yml` as a standing default (`bin/lib/policy-schema.js`'s resolver discards a policy.yml value for this key outright). Answering `pre-authorized` here is the only way to set it; the `auto`-mode default is always `ask`.
- **Red flags:** The lever silently resolving `pre-authorized` with no override reply anywhere in the transcript — that would mean the interactive-human-only invariant broke.

### 2a. The run merges itself — terminal, no interaction
- **URL:** none — this happens inside `/claude-tweaks:wrap-up`'s Review Console step, unattended
- **Action:** Once the last HARD-GATE clears and the full suite has just passed, the Auto-merge short-circuit (`wrap-up/review-console.md`, `wrap-up/manifesto-authorized-merge.md`) fires the same merge call the terminal one-click path uses (`_shared/pr-first-merge.md` Step 3: `bin/compose-subject.js … --tag manifesto-authorized --shell`, then `gh pr merge --squash -t "$SUBJECT_TITLE" -b "$SUBJECT_BODY"`), and logs the decision.
- **Should feel:** Invisible — the maintainer notices only that the PR is already merged when they check back.
- **Should understand:** The content-judgment safety net (`assess-agent-autonomy merge-check`) still runs — the lever authorizes the merge decision, it doesn't skip the judgment that decides whether merging is safe. The squash commit's subject is Conventional-Commits shaped (`feat|fix|chore[!]: {title} (#N)`, #2251); the `manifesto-authorized` tag now rides as a `[manifesto-authorized]` body paragraph rather than a subject prefix, which is still what `/help`'s auto-merged metric matches.
- **Red flags:** A merge commit tagged `manifesto-authorized` with no corresponding `decisions.md` entry naming the lever; a pr-first merge that produced a merge commit instead of a single squash commit.

### 2b. Decline or leave it unanswered — terminal Review Console
- **URL:** the Wrap-Up Review Console's one-click Recommended `AskUserQuestion` merge option
- **Action:** Answer the console's merge prompt when it appears at the end of the run.
- **Should feel:** The fallback path — no worse than before this lever existed, just still requires being present at the end.
- **Should understand:** This is the pre-existing terminal one-click path (shipped ahead of this journey); the lever only adds a way to skip needing to be present for it.
- **Red flags:** The Review Console offering a merge option even though the branch's own checks haven't actually passed — the option must reflect the same green state the run just proved, not a stale or assumed one.

### 3. Resume a run that ended without merging — `/claude-tweaks:flow ... wrap-up`
- **URL:** the terminal `## Next Actions` block's resume-to-merge line, rendered only under `integration-model: pr-first` when this run's own outcome is `armed`/`pending-review`
- **Action:** Copy-paste the printed command: `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up`.
- **Should feel:** Reassuring, not a dead end — the PR reference and run state are still there, waiting.
- **Should understand:** This line only appears when there's genuinely something to resume — a `merged` outcome, or a `local-merge` project with no PR to resume toward, renders nothing here.
- **Red flags:** The line appearing after the run already merged (nothing left to resume), or a resume command that doesn't actually re-offer the merge decision.

## Origin
- Created during build of #715 (Merge authorization at unattended: Manifesto-time lever, or one-click Recommended at the terminal summary?)
- Related specs: #688/6626896c (shipped the pre-existing terminal one-click Recommended merge option this journey's step 2b covers)
