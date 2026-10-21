---
files:
  - plugin/skills/flow/SKILL.md
  - plugin/skills/flow/manifesto.md
  - plugin/skills/flow/manifesto-overrides.md
  - plugin/skills/wrap-up/manifesto-authorized-merge.md
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/wrap-up/auto-merge-short-circuit.md
  - plugin/bin/lib/dispatch/task-call.js
  - plugin/skills/flow/summary-template.md
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/bin/compose-subject.js
  - plugin/bin/lib/policy-schema.js
  - plugin/skills/_shared/autonomy-ceiling.md
---

# Pre-Authorize a Flow Run's Merge, or Recover if It Doesn't Merge

**Persona:** Maintainer running `/claude-tweaks:flow` — in default `auto` with the `pre-authorize-merge` token, or in `confirm`/`hybrid` mode — who is present at run start but may not be present when the run finishes, and doesn't want to come back later just to click "merge" once every check is green.
**Goal:** Grant merge authorization once, live, at the moment they're actually watching the Manifesto — instead of returning at an unpredictable later time to approve a merge whose green state may have already started to decay.
**Entry point:** Either the `pre-authorize-merge` token on the `/claude-tweaks:flow` invocation (default `auto`, no approval stop), or the Pipeline Config Manifesto's `Approve all / Override / Cancel` prompt, lever 13 (Merge authorization) in the levers table.
**Success state:** Either the run merges itself with zero further clicks the moment its last HARD-GATE clears (pre-authorized path), or — having declined or not answered — the maintainer gets a one-click Recommended merge option at the terminal Review Console, or, if the run ends without a decision, a paste-ready resume command that re-offers the merge without losing the PR reference.

## Steps

### 1. Answer the lever — Pipeline Config Manifesto (`AskUserQuestion`)
- **URL:** the Manifesto's `Approve all / Override / Cancel` prompt, reached by running `/claude-tweaks:flow {target} confirm` (or `hybrid`)
- **Action:** Reply `Override` with `13=pre-authorized` in the free-text `#=value` pairs, alongside any other overrides in the same reply.
- **Should feel:** A deliberate, one-time grant — not a setting they're leaving behind for every future run.
- **Should understand:** This is a live answer for *this run only* — it can never be set from `.claude-tweaks/policy.yml` as a standing default (`bin/lib/policy-schema.js`'s resolver discards a policy.yml value for this key outright). Answering `pre-authorized` here is one of two ways to set it; the other is typing the `pre-authorize-merge` token on the `/claude-tweaks:flow` invocation (default `auto` without the token stays `ask`).
- **Red flags:** The lever silently resolving `pre-authorized` with neither an override reply nor the `pre-authorize-merge` token on the invocation anywhere in the transcript — that would mean a run originated its own merge authorization (`_shared/auto-mode-contract.md`'s Merge authorization lever row).

### 1b. Or type the token — `/claude-tweaks:flow {target} pre-authorize-merge`
- **URL:** the `/claude-tweaks:flow` invocation itself, in default `auto` — no Manifesto approval stop
- **Action:** Add `pre-authorize-merge` to the invocation; the read-only Manifesto FYI table shows lever 13 as `pre-authorized` (source `arg`).
- **Should feel:** One word instead of reopening every lever with `confirm` — the rest of the run stays hands-off.
- **Should understand:** It authorizes this run only. It is ignored on a dispatched run (`run-state.json` `dispatched: true` — lever 13 stays `ask` and one `SKIP` line says so), and it has no effect under `interactive` or on a multi-record run (Step 1 prints a note saying which). Raising `autonomy` to `unattended` never sets it — `_shared/autonomy-ceiling.md` records why (#2734).
- **Red flags:** The FYI table showing `ask` after the token was typed on a single-record, non-dispatched `auto` run; or `pre-authorized` on a dispatched run.

### 2a. The run merges itself — terminal, no interaction
- **URL:** none — this happens inside `/claude-tweaks:wrap-up`'s Review Console step, unattended
- **Action:** Once the last HARD-GATE clears and the full suite has just passed, the Auto-merge short-circuit (`wrap-up/review-console.md`, `wrap-up/manifesto-authorized-merge.md`) fires the same merge call the terminal one-click path uses (`_shared/pr-first-merge.md` Step 3: `bin/compose-subject.js … --tag manifesto-authorized --pr {pr-number} --out-dir "{subject-dir}"`, then `gh pr merge --squash -t {title-arg} --body-file "{subject-dir}/body.md"`), and logs the decision.
- **Should feel:** Invisible — the maintainer notices only that the PR is already merged when they check back.
- **Should understand:** The content-judgment safety net (`assess-agent-autonomy merge-check`) still runs — the lever authorizes the merge decision, it doesn't skip the judgment that decides whether merging is safe. The squash commit's subject is Conventional-Commits shaped (`feat|fix|chore[(scope)][!]: {title} (#N)`, #2251 — the `(scope)` resolved by the composer from the `commit-scope`/`commit-scope-paths` policy keys over the PR's changed files, #3298); the `manifesto-authorized` tag now rides as a `[manifesto-authorized]` body paragraph rather than a subject prefix, which is still what `/help`'s auto-merged metric matches. This holds under `integration-model: local-merge` too: the short-circuit's Dispatch-call branch treats this human-run session as one of `/claude-tweaks:dispatch`'s Task calls only when `run-state.json` carries `dispatched: true` **and** its `dispatchSessionId` equals this session's `CLAUDE_CODE_SESSION_ID` (`bin/lib/dispatch/task-call.js`). Every other run, a human resuming a dispatched run from a new session included, merges directly from the main checkout (#3711). One exception lasts until `task-call.js` drops its `sessionId` fallback: a dispatched run whose `run-state.json` predates #3711 has no `dispatchSessionId`, and a resume re-stamps `sessionId` with the resumer's id, so that resume still reads as a Task call and stops at `ready-to-merge` — the accepted residual that module names.
- **Red flags:** A merge commit tagged `manifesto-authorized` with no corresponding `decisions.md` entry naming the lever; a pr-first merge that produced a merge commit instead of a single squash commit; a human-run `local-merge` run that ends reporting `OUTCOME: ready-to-merge` with nothing merged — that relay is reserved for dispatch's own Task calls, and no dispatcher is waiting to act on it (the one exception is the pre-#3711 resume above).

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
- **Should understand:** This line only appears when there's genuinely something to resume — a `merged` outcome, or a `local-merge` project with no PR to resume toward, renders nothing here. Appending `pre-authorize-merge` to that resume command pre-authorizes the merge on the adopted run too (one `set-config.js` write, logged), so the resumed wrap-up merges without a click. When the run's `autonomy` ceiling grants `consoleAutoResolve` (`unattended` only), the line prints `/claude-tweaks:wrap-up #{n} merge` in its place, because at that ceiling the resume re-resolves the Review Console with no question and re-parks the PR; running it merges in the same session with the typed command as the human confirmation (`merge-a-parked-unattended-pr-3784.md`).
- **Red flags:** The line appearing after the run already merged (nothing left to resume), or a resume command that doesn't actually re-offer the merge decision. An `unattended` run's summary printing the `/claude-tweaks:flow … wrap-up` resume instead of the `/claude-tweaks:wrap-up #{n} merge` row.

## Origin
- Created during build of #715 (Merge authorization at unattended: Manifesto-time lever, or one-click Recommended at the terminal summary?)
- Updated during wrap-up of #3298 (merge-subject scope source): step 2a's composer call carries `--pr {pr-number}`, and the subject grammar gained the optional policy-resolved `(scope)`
- Updated during build of #3522 (guard-safe merge fences): step 2a composes with `--out-dir "{subject-dir}"` and merges with `-t {title-arg} --body-file "{subject-dir}/body.md"` — no `eval`, no `$(…)` around `gh`
- Updated during build of #2734 (the autonomy ceiling does not set merge-authorization): new step 1b — the `pre-authorize-merge` invocation token — plus the token on step 3's resume command
- Updated during build of #3711 (dispatch-call discriminator): step 2a now holds under `local-merge` — a human-run `/flow` merges itself instead of stopping at `ready-to-merge`; new red flag for that stop
- Updated during wrap-up of #3784 (wrap-up merge mode): step 3's resume line renders `/claude-tweaks:wrap-up #{n} merge` instead when the ceiling grants `consoleAutoResolve`
- Related specs: #688/6626896c (shipped the pre-existing terminal one-click Recommended merge option this journey's step 2b covers)
