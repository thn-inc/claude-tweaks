---
files:
  - plugin/bin/express-lane.js
  - plugin/bin/lib/express/cli.js
  - plugin/bin/lib/express/eligibility.js
  - plugin/bin/lib/express/sampling.js
  - plugin/bin/lib/express/queue.js
  - plugin/skills/_shared/express-lane.md
  - plugin/skills/dispatch/express-prompt.md
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/flow/express-entry.md
  - plugin/bin/lib/policy-schema.js
---

# Ship a Small Record on the Express Lane

**Persona:** A maintainer of a GitHub-backed (`pr-first`) project whose backlog holds two-line fixes: a citation, a typo, a one-constant change. Each one currently costs a 50-minute `/claude-tweaks:flow` run of ledger, plan, SDD, review and wrap-up. They want those records merged in minutes without losing the CI gate or a review safety net.
**Goal:** Turn on the express lane, watch an eligible record build, test and merge in one agent, see an unsuitable one fall back to the full pipeline untouched, and know that a share of express merges still gets a real review afterwards.
**Entry point:** `.claude-tweaks/policy.yml` in a repo with PR CI; a `ready` record labelled `risk:low`, `size:low`, `ceremony:fast-lane` and `type:*`, with one to three `### Key Files`.
**Success state:**
- The record's PR merged on green from one express call.
- The run's `decisions.md` holds the claim, a `check` proceed line naming the verified HEAD, and one express summary.
- The dispatch report shows `express: merged`.
- An ineligible record ran the normal two-call path with nothing changed.

## Steps

### 1. Opt in
- **URL:** `.claude-tweaks/policy.yml`
- **Action:** Add `express-lane: true`. Leave `express-review-sample-every` at its default `5` unless a different post-merge review share is wanted.
- **Should feel:** One deliberate switch. Off, nothing about `/dispatch` or `/flow` changes. Not one extra call, read or fetch.
- **Should understand:**
  - The lane is off by default and runs only under `integration-model: pr-first`, with `gh` available.
  - It needs PR CI. An empty check rollup reads pending, never green, so a repo without CI parks every express merge.
- **Red flags:** An express routing note in a run on a repo that never opted in; `/flow` reading `express-entry.md` or calling `gh issue view` with the lane off.

### 2. Ask the gate why a record is (or isn't) eligible
- **URL:** `node plugin/bin/express-lane.js gate --issue {n}`
- **Action:** Run it on a two-line markdown record, then on a `risk:medium` one.
- **Should feel:** A straight answer with reasons. No judgment call to second-guess.
- **Should understand:**
  - The verdict is `eligible: true|false`, and `reasons` names every failed rule verbatim (`risk is not low`, `more than 3 Key Files`, `protected path: …`, `frontend surface`, …).
  - Protected paths are the same in every project: hook code, `skills/_shared/`, CI and forge config (`.github/`, `.gitlab-ci.yml`, `.circleci/`, git hooks), `CODEOWNERS`, `package.json`, the agent's permission files (`.claude/settings*.json`, `.mcp.json`), and the policy and verify-scope files. A Key File is judged as the path it resolves to, so `a/../skills/_shared/x.md` is protected too.
  - A `Surface:` of `terminal` counts as a frontend, like `web`, `mobile` and `desktop`.
  - Exit 2 means `gh` is absent, so the lane is never taken.
- **Red flags:** An eligible verdict for a record that touches `hooks/` or a merge-sensitive path; a verdict that lists only the first failure.

### 3. Dispatch and watch one agent ship it
- **URL:** `/claude-tweaks:dispatch` (or `/claude-tweaks:flow #{n}` for one record, auto mode, worktree strategy, no step list)
- **Action:** Let the drain pick the eligible record.
- **Should feel:** Fast and quiet. One express call does everything: claim, edit the Key Files, commit, run the impacted tests, `check`, push, open the PR and merge on green. No Manifesto, ledger, plan or Review Console.
- **Should understand:**
  - With the lane on, the queue keeps an eligible record out of fast-lane bundles, so it dispatches as its own singleton group.
  - The agent edits only the record's Key Files and test files.
  - `express-lane.js check` refuses to proceed without a runner pass stamp for HEAD. It also refuses a diff outside the bounds: a non-Key-File change, implementation lines plus deleted test lines over `auto-merge-max-lines`, or a protected or merge-sensitive path.
  - The push happens only when HEAD still equals the sha `check` verified.
  - The merge still needs `auto:merge` (or, from `/flow`, a typed `pre-authorize-merge`), a confirmed merge-check verdict, and green CI. Otherwise the PR waits in draft as `pending-review`.
- **Red flags:**
  - A merge with a red or unread check state.
  - A commit that landed after `check` and was pushed anyway.
  - `express: blocked` for a PR that actually merged. `verify` reads the archived run dir when the post-merge reconcile moved it.

### 4. See a record fall back without losing work
- **URL:** the same run, when a test fails or the diff grows past the bounds
- **Action:** Read the run's `decisions.md` and the dispatch report.
- **Should feel:** Safe. The record quietly takes the full pipeline from where the lane left it, and nothing is torn down or redone.
- **Should understand:**
  - Escalation happens only before the push, logged as `Express lane: escalated #{n} to /flow (reason: failing-test|out-of-bounds|gate-denial|express-error)`.
  - The worktree, branch, claim and run dir stay as they are. `/dispatch`'s ordinary build-and-test call (or `/flow` Step 3) adopts them.
  - The normal path judges "already shipped" against the integration branch, not the express commit.
  - A record that escalated never re-enters the lane in the same run.
- **Red flags:** An `already-shipped` close of an escalated record; a second express attempt in the same run dir; an escalation line after the PR exists.

### 5. Trust the post-merge sample review
- **URL:** the end of a bare `/claude-tweaks:dispatch` drain, `node plugin/bin/express-lane.js samples`
- **Action:** After several express merges, let a drain finish, then read the `express-review` comment on a sampled PR.
- **Should feel:** The robustness check still exists. It just runs after merge, off the critical path.
- **Should understand:**
  - Every Nth express merge (by ordinal, so the selection is stable) gets the normal review lenses at a tier of at least `medium`, at most 3 per firing. A capped backlog is named in the drain report.
  - Each confirmed finding is filed as a record at every autonomy level, then a marker comment means the PR is never sampled again.
  - A sampled PR left unreviewed 30 days after its merge ages out.
  - Sampling runs only at the end of a bare drain, so an express merge made from `/flow` or an explicit `/dispatch #N` is reviewed only when a later bare drain runs within the 30-day lookback (whether the merging session should sample it is #4365).
- **Red flags:** A sampled PR with a marker comment but a finding that was never filed; the same finding filed twice after a retried sweep (each filed body names `express-review of PR #{n}`, which the retry searches for before filing).

## Origin
- Created during build of #4025: the express lane, a single-agent path for eligible trivial records, with an escalation hand-off to `/flow` and post-merge sampling.
- Related journeys: `add-a-fast-lane-skip-to-the-roster-1926.md` (the fast-lane ceremony an express-eligible record carries), `pre-authorize-a-flow-runs-merge.md` (the typed merge authorization the `/flow` entry honours), `recover-from-a-dispatch-config-deny-3225.md` (the config gate the express bind avoids by ordering).
