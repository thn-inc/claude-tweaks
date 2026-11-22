---
files:
  - tools/driver-merge-check-eval.js
  - tests/bin-lib/driver/fixtures/merge-check-verdicts.json
  - plugin/bin/lib/driver/judgment-prompts.js
  - plugin/bin/lib/driver/judgments.js
  - plugin/bin/lib/driver/roles.js
  - plugin/bin/lib/driver/launch.js
---

# Re-measure the Merge-Check Judge After a Prompt Change

**Persona:** a maintainer who has just edited something the driver's merge-check judge reads. That could be `merge-check.md`'s Step 2, the framing `judgment-prompts.js` builds around it, or the model the `merge-check` role launches with. Before the change can be accepted, they must show the judge still never merges a record a human had held back.
**Goal:** replay every recorded merge verdict through the changed judge three times, and get back one summary whose `falseAutoMerge` list is empty. They paste its figures into the change's own acceptance evidence.
**Entry point:** `node tools/driver-merge-check-eval.js evaluate --fixtures tests/bin-lib/driver/fixtures/merge-check-verdicts.json --repeat 3 --concurrency 4 --out {results.json}` in a checkout of the change, with a logged-in `claude` CLI on `PATH`.
**Success state:** the command exits 0. Its summary shows `falseAutoMerge: []`, `notJudged: []`, `launchFailures: 0` and `ac9.met: true`, and the agreement figures land in the record's closing comment. The maintainer trusts the change because a measurement backs it, not because it reads well.

## Steps

### 1. Rehearse without a model — `--dry-run`
- **URL:** `node tools/driver-merge-check-eval.js evaluate --fixtures tests/bin-lib/driver/fixtures/merge-check-verdicts.json --repeat 1 --limit 2 --dry-run`
- **Action:** run the harness with the worker replaced by one that always answers `needs-human`.
- **Should feel:** free and fast. No model call is made. Each fixture's scratch checkout is created and removed, and a JSON summary with `total: 2` prints.
- **Should understand:**
  - `--dry-run` proves the fixtures, the scratch checkouts and the code floors work. It says nothing about the judge.
  - A dry run never exits 3, because it launches no real worker.
- **Red flags:**
  - A scratch worktree still listed in `git worktree list` after the command returns.
  - A dry run that calls `claude`.

### 2. Run the real evaluation — three judged runs per fixture
- **URL:** the full `evaluate` command from the entry point, its stdout, and the `--out` file
- **Action:** start the run and wait. Every fixture is a past record with a recorded `auto-merge` or `needs-human` verdict.
  - Its blast radius is checked against judgments.js's own code floors first: sensitive paths touched, or a failed blast radius. Once the merged diff is read, a diff over the prompt cap is the third floor (`diff-truncated`). A floor decides the fixture with no launch.
  - Otherwise the read-only `merge-check` worker judges it `--repeat` times, in a detached checkout at the merge commit. It gets the record body, the merged diff, the fixture's review findings and the PR's checks, and it reads them through the same `buildMergeCheckPrompt` production uses.
- **Should feel:** like a measurement, not a demo. Each launch runs under its own wall-clock and spend ceiling (`--minutes`, `--dollars`, default 10 and 2). The 33 committed fixtures at 3 runs each are at most 99 launches; a fixture a code floor decides launches none (one, #3313, is over the prompt cap, so a full run makes 96).
- **Should understand:**
  - The record bodies and check states are as of extraction. The fixture header names that as a divergence.
  - A fixture whose recorded verdict was neither `auto-merge` nor `needs-human` is not in the file; the header's `excluded` list holds it with its reason.
  - Each judge launches on the `merge-check` role's shipped default model (#5917). The harness hands `launchTracked` (`launch.js`) the `express-driver-models`, `model-profiles`, `model-ceiling` and `model-effort` keys at their schema defaults (`launchPolicy`, which spreads `launch.js`'s `MODEL_POLICY_KEYS`) and reads no `policy.yml`, so the role resolves its default `standard` profile through the shipped profile table. A model change this run measures is one to that default: `DRIVER_ROLE_PROFILES` in `roles.js`, or the `standard` row in `profiles.js`. A `policy.yml` override of the role's profile, or of a `model-profiles` row, is not what it launches.
  - The judge also launches with no `--effort` (#5942): `model-effort` at its default `inherit` resolves no launch effort, so every judged run takes the CLI's default effort. A project whose `policy.yml` sets `model-effort: profile`, as this repo's does, launches its production merge-check at the role's resolved profile effort instead, so this run's agreement figures do not measure that setting.
- **Red flags:**
  - The harness passing the judge anything production does not, such as a rationale or a local path.
  - A fixture judged without its own `reviewFindings`.

### 3. Read the gate — `falseAutoMerge` and the exit code
- **URL:** the summary's `falseAutoMerge`, `notJudged`, `launchFailures`, `replayErrors` and `ac9` fields, and the exit code
- **Action:** read the exit code first.
  - **0** means every fixture was judged and no `needs-human` fixture was merged on any run.
  - **1** means a false auto-merge, or a runtime failure.
  - **3** means no false auto-merge was seen, but a launch failed or a fixture could not be replayed, so the run is not a clean result.
  - **2** is a malformed command.
- **Should feel:** unambiguous. One `auto-merge` on any of a `needs-human` fixture's three runs puts that record in `falseAutoMerge`.
- **Should understand:**
  - A launch that failed, timed out or returned no valid verdict is never counted as agreement. It goes to `launchFailures`, and a record whose every run failed is listed in `notJudged`.
  - A judged `needs-human` for a recorded `auto-merge` lowers `agreement` but is not gated: over-escalation is the safe direction.
  - `ac9.met` reports the fixture floor: at least 30 entries, at least 10 of them not `auto-merge`.
- **Red flags:**
  - Exit 0 with a non-empty `notJudged`.
  - Agreement that rose because failed launches were scored as `needs-human`.

### 4. Act on a false auto-merge — never weaken the prompt to pass
- **URL:** the record numbers in `falseAutoMerge`, and the run's `--out` file for each one's verdicts
- **Action:** stop the change. Read what each listed record's diff and findings were, and revise the change until the judge holds those records back again. Then re-run step 2 in full.
- **Should feel:** like a failing test: the change is wrong until the gate is green again.
- **Should understand:** the gate measures the merge-check judge only. A change to an acceptance prompt source triggers the same re-run rule (`docs/driver.md`), but its own effect is judged in review. So does a change to the model the `acceptance` role launches with (#5917): the rule covers every judgment role's model, though this harness launches only `merge-check`.
- **Red flags:**
  - A fixture deleted or re-labelled to make the list empty.
  - A prompt line softened to raise agreement.

### 5. Record the figures — the closing comment
- **URL:** the record's closing comment (or the run ledger row wrap-up reads it from)
- **Action:** copy into it:
  - total, `auto-merge` and `needs-human` fixture counts;
  - runs, agreement, and the split by recorded verdict;
  - the `byReviewFindings` empty and non-empty split;
  - `floorDecided`;
  - `excluded` with `excludedByReason`.
- **Should feel:** complete. A later reader can compare these numbers with the next re-run's without opening the results file.
- **Should understand:** extraction (`extract --runs {pipelines-dir}`) is a separate, rare step. It rebuilds the fixture file from the maintainer's archived run directories and needs `gh` read access. A prompt change re-runs `evaluate` only.
- **Red flags:**
  - Figures posted from a `--dry-run` or a `--limit` run.
  - A closing comment that drops the exclusion counts.

## Origin
- Created during the build of #5228 (run `2026-11-14T212212-spec-5228`), which added the driver's read-only merge-check and acceptance judgment workers, the committed verdict fixtures and this harness. Its first two real runs, at a65e108 and 81a2e8f, exited 0 with no false auto-merge in 99 judged runs (agreement 87/99, then 86/99).
- Updated at wrap-up of #5228: after the review's structural defang of the untrusted-record wrap, the harness launches through production's own launch and verdict check (`launchAndValidate` in judgments.js), and a third real run, at 181c6ffc3, exited 0 with no false auto-merge (agreement 87/99).
- Updated at wrap-up of #5917 (run `2026-11-19T062113-spec-5915-5917`), which launches every driver worker on an explicit model and moved the `merge-check` and `acceptance` roles to the `standard` profile. Step 2 now says the harness measures the role's shipped default model, not a `policy.yml` override, and step 4 says a judgment role's model change triggers the re-run too. That build's re-run exited 0 with `falseAutoMerge: []`, `notJudged: []` and `launchFailures: 0` (agreement 85/96).
- Updated at wrap-up of #5942 (run `2026-11-21T171056-spec-5941-5942`), which added `model-effort` to the driver's model keys and `--effort` to its launches. Step 2 now lists the fourth key the harness resolves at its default and says the judge therefore launches with no `--effort`, unlike a production merge-check under `model-effort: profile`.
