---
files:
  - plugin/bin/lib/accept/tripwire.js
  - plugin/bin/accept-park.js
  - plugin/bin/lib/accept/target.js
  - plugin/bin/lib/accept/park.js
  - plugin/bin/lib/issues/record-risk-flags.js
  - plugin/bin/risk-flags.js
  - plugin/skills/_shared/tripwire-classification.md
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/skills/_shared/local-acceptance-park.md
  - plugin/skills/specify/shaping-mode-stamping.md
  - plugin/skills/tidy/actions-github-issues.md
---

# See Why an Unflagged Risky Change Parked

**Persona:** A maintainer running claude-tweaks with `control-mode: on` and `risk-path-globs` set in `.claude-tweaks/policy.yml` (for example `migrations: migrations/**`). They shaped a record with no risk flags and expected its PR to merge to dev unattended. The build ended up touching a migration file.
**Goal:** Find out why the run parked instead of merging, trust that the reason is real, and decide what to do: accept it locally, or correct a false positive.
**Entry point:** A `/claude-tweaks:flow` or `/claude-tweaks:dispatch` run reaches the merge decision (`pr-first-merge.md` Step 2.9, the driver merge, or tidy's arm), which calls `accept-park.js decide --head {sha}`.
**Success state:** The record carries the crossed flag on `Risk-flags:` and names it on `Risk-flags-added-by-tripwire:`. The PR is parked for local acceptance, and the packet's Deploy status names the category, the glob or agent evidence, and the touched path. The maintainer knows which of the two next steps applies.

## Steps

### 1. The merge decision diffs what was actually built
- **URL:** `node plugin/bin/accept-park.js decide --run {run-dir} --record {n} --head {sha} [--classification {file}]`
- **Action:** Nothing. Before the merge, `decide` does the following:
  1. Fetches the PR head by its sha and the integration branch.
  2. Diffs the head against the merge base.
  3. Matches each changed path against the `risk-path-globs` categories. Globs are normalized like paths, so `./migrations/**`, `/migrations/**` and `migrations/` all match.
  4. Adds the agent's classification of the diff (`_shared/tripwire-classification.md`) as a second signal.

  A category that was crossed but not declared is appended to the record's `Risk-flags:` line and named on `Risk-flags-added-by-tripwire:`. The acceptance target becomes `local` with reason `tripwire`.
- **Should feel:** Like a backstop that only adds caution. It never removes a flag and never stops the build; it only moves where you accept the work.
- **Should understand:**
  - When the tripwire cannot run, the target is forced to `local` and the reason says which step failed (`git diff failed: exit 128`, `git merge-base failed: no merge base`, a malformed glob block). A run that could not check is never reported as clean.
  - Re-running the decision on the same diff finds the flag already declared and writes nothing new.
  - With `control-mode` off, none of this runs.
- **Red flags:**
  - The PR merges although the diff touches a configured risk path nobody flagged.
  - A failed diff or fetch reads as "nothing crossed".
  - A flag disappears from `Risk-flags:` during the decision.

### 2. Read the reason in the parked packet
- **URL:** The PR's acceptance packet, `## Deploy status` section
- **Action:** Open the packet. Next to `target: local` and `reason:`, the Deploy status carries one line per signal:
  - `tripwire: the diff crosses migrations (migrations/**: migrations/001.sql), which nobody flagged, so this run is local`
  - `tripwire: you removed the migrations flag at intent; the diff touches migrations/001.sql, so this run is local`, when the maintainer removed the flag during shaping (read from the record's trusted `Risk flag {slug} removed by the maintainer during shaping` comment)
  - notes, such as `agent classification not run`, or a glob that uses unsupported `{`, `[` or `?` syntax
  - `tripwire could not run: {step}` when the check failed
- **Should feel:** Specific. You can see which file, which category and which glob or agent judgment caused it, without opening logs.
- **Should understand:**
  - The packet text is neutralized: a path or evidence string can never forge a `target:` line. An absolute path inside a failure reason (git's own stderr, a lock file) shows as `<path>`.
  - When `/claude-tweaks:tidy`'s record-linked arm made the decision, no packet is posted. Tidy's report carries the same lines instead: `Held (not armed): PR #{n} — local acceptance target, never parked; recommend /claude-tweaks:accept #{record}`, followed by the decision's `tripwire…` lines verbatim.
  - A removal made at intent time does not suppress the tripwire. The removal judged the planned work, and the diff is new evidence of what was built.
- **Red flags:**
  - A parked PR whose packet has no `tripwire` line, although the reason is `tripwire`.
  - A tidy `Held (not armed)` line for a tripwire decision with no `tripwire` line after it.
  - A local checkout path or a raw error message appears in a packet line.

### 3. Decide what to do with it
- **URL:** `/claude-tweaks:accept #N` (see the "Accept a Locally Parked PR" journey), or `.claude-tweaks/policy.yml`
- **Action:** Choose one.
  - **The risk is real:** run `/claude-tweaks:accept #N`, try the change locally, and give the verdict.
  - **It is a false positive:** fix its cause, by narrowing the glob in `risk-path-globs` or by restructuring the change. Removing the flag by hand through `/claude-tweaks:specify` or `/claude-tweaks:backlog refine` does not stop the next merge decision on a diff that still crosses the category: the tripwire re-adds it.
- **Should feel:** In control, with the trade-off stated: the automatic path can only add caution, and taking caution away is a human edit to policy.
- **Should understand:**
  - A later `/claude-tweaks:specify` re-shape keeps the `Risk-flags-added-by-tripwire:` line, minus any flag the human removed, so the flag's origin stays visible.
  - Under `integration-model: local-merge` the tripwire does not run yet; #5805 tracks that.
- **Red flags:**
  - A hand removal silently suppresses the re-add on the same diff.
  - The re-shaped record loses the tripwire provenance line while the flag stays.

## Origin
- Created during the build of #4619 (diff tripwire)
- Related specs: #4615 (acceptance target and the local park), #4618 (risk flags at intent time), #5805 (local-merge wiring), #5806 (glob syntax alignment)
