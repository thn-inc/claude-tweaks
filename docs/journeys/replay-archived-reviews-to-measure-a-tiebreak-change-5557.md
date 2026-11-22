---
files:
  - tools/review-replay.js
  - tools/review-replay/archive.js
  - tools/review-replay/extract.js
  - tools/review-replay/prompt.js
  - tools/review-replay/score.js
  - tools/review-replay/counterfactual.js
  - tools/review-replay/schema.js
  - tools/review-replay/replay.workflow.js
  - plugin/skills/review/step3-tiebreak.md
  - plugin/bin/lib/tiebreak.js
  - plugin/bin/lib/timing/transcript.js
---

# Replay Archived Reviews to Measure a Tiebreak Change

**Persona:** a maintainer who wants to change how `/review` settles contested findings. Examples are judging several findings per agent (#5540), picking the judge's tier from the finding's severity (#5541), or rewording `step3-tiebreak.md`. They need to know what the change costs and what it does to verdicts before it ships, and they want a measurement over real past reviews, not a guess.
**Goal:** replay findings from archived review runs through one or more judge arms, then get agreement with the archived verdicts and agents and tokens per arm. Each number must be one they can paste into the change's PR.
**Entry point:** `node tools/review-replay.js baseline --runs .claude-tweaks/pipelines`, run in the main checkout, where the archived run directories live.
**Success state:** `score` exits 0. That means every replayed finding was judged by every arm. The maintainer posts agreement in total, per verdict class and per severity, plus agents and tokens per arm, set beside `baseline`'s archived cost. A judge that failed is visible by reason and never counted as a disagreement.

## Steps

### 1. See what the archive holds — `baseline`
- **URL:** `node tools/review-replay.js baseline --runs .claude-tweaks/pipelines [--select <run,...>]`
- **Action:** list the archived runs that have tiebreak verdicts. For each one, see its matched findings, the head and base it reviewed, and the archived tiebreak cost (agents and tokens from `timing.json`).
- **Should feel:** like an inventory. It is fast, makes no model call, and every run that was left out is named with its reason.
- **Should understand:**
  - A run is excluded, with a named reason, when its `decisions.md` is unreadable, it has no review, it applied no fix (`no-fix-commit`: its reviewed head cannot be recovered yet, #5631), or its head is not in the local clone.
  - A tiebreak line whose judge failed (`status:BLOCKED`, `no-evidence`, `could-not-parse` and the like) is counted under its reason. It is not a verdict.
- **Red flags:**
  - A run that disappears without being listed in `excluded`.
  - A failed judge counted as `cant-tell`.

### 2. Build the replay set — `extract` with the arms to compare
- **URL:** `node tools/review-replay.js extract --runs .claude-tweaks/pipelines --out <extract dir> --arm name=single,chunk=1,profile=capable,repeat=1 --arm name=chunk8,chunk=8,profile=capable,effort=low,repeat=1 [--select ...] [--min-runs n] [--min-findings n] [--quota sev=n,...]`
- **Action:** write, into a new empty directory, one source tree per run at the commit it reviewed. Then write the prompt files for each arm, built from today's `step3-tiebreak.md`, along with `manifest.json`, `fixture.json` and `archived-verdicts.json`.
- **Should feel:** declarative. An arm is data (chunk size, profile, repeats), so comparing a new variant means adding another `--arm`.
- **Should understand:**
  - Prompts never name the archived verdicts. A finding whose file is absent at the reviewed commit is excluded with `file-absent-at-head`, never written as a prompt.
  - An arm may set `effort=` (`low`, `medium`, `high`, `xhigh`, `max`) to run its judges at another effort than its profile's, and `score` checks the effort each judge recorded (step 4).
  - An unmet `--min-findings` or `--quota` is a shortfall: exit 3, and no arm is written.
  - A run with no `context/review-dispatch.md` takes today's discipline lines, and the output counts those runs.
- **Red flags:**
  - A prompt that contains an archived verdict or rationale.
  - An exit 0 with fewer findings than were asked for.

### 3. Run the judges — the Workflow script
- **URL:** `tools/review-replay/replay.workflow.js`, started through the Workflow tool with the contents of `<extract dir>/manifest.json` as its args
- **Action:** start one judge per arm, repeat and prompt file. Each judge runs on its arm's model and effort and is told only its label (`Replay judge {label}.`) and where its prompt file is.
- **Should feel:** hands-off. This is the one step that spends model tokens, and its size is known before it starts: arms times repeats times prompts.
- **Should understand:** a dispatched build agent has no Workflow tool. This step runs from an interactive session.
- **Red flags:**
  - A judge given anything beyond its label and prompt path.

### 4. Score the arms — `score`
- **URL:** `node tools/review-replay.js score --out <extract dir> --transcripts <workflow dir> [--reference <arm>]`
- **Action:** settle every reply through `plugin/bin/lib/tiebreak.js`, the same settle a review runs. The output gives:
  - agreement with the archived verdicts, in total, per archived class and per severity;
  - each arm's agreement with the reference arm;
  - agents and tokens per arm, read from `message.usage` in each `agent-{id}.jsonl`, with each `message.id` counted once at the maximum of each usage field across its lines.
- **Should feel:** trustworthy. Exit 0 means every finding was judged by every arm. Exit 3 means some were not, and those are listed in `notJudged` by reason: `no-reply`, `chunk-split`, `unidentified-agent`, `file-absent-in-tree`, `effort-mismatch`, or a settle reason such as `status:BLOCKED`.
- **Should understand:**
  - Only `verdict:cant-tell` and `evidence-unverified` settle as `cant-tell`. Every other non-verdict reason is notJudged.
  - When an arm's effort is not null (its `effort=`, or its profile's: `high` for standard, capable and frontier), every judge's turns must have recorded exactly that effort. A judge that recorded another, mixed or none is `effort-mismatch`, and `recordedEffort` per arm shows what was recorded. Synthetic error entries (`<synthetic>`) are ignored.
  - `effortFieldsDiffer` per arm counts the judges with a turn whose `perTurnEffort` differs from its `effort`. It is a report only: the check above reads `effort` alone, so a non-zero count does not cause `effort-mismatch`.
  - Tokens from an agent with no identity line are reported in `unidentifiedCost`, never dropped.
  - `score` settles every arm the way a review settles a Capable judge's reply. It does not run the escalation a review applies to a Standard judge's reply (#5541): in a `profile=standard` arm, a reply that raises a finding to `medium` or higher is scored on the Standard judge's own verdict, where a review would discard it and judge the finding again at Capable.
- **Red flags:**
  - Agreement that rose because notJudged findings were scored.
  - An arm with a non-null effort that exits 0 while its `recordedEffort` shows another effort.
  - A missing run tree that settles as `cant-tell` instead of exiting 1.

### 5. Check the lenses' overlap — `counterfactual` (optional)
- **URL:** `node tools/review-replay.js counterfactual --runs .claude-tweaks/pipelines --transcripts <claude projects dir> [--select ...]`
- **Action:** read the paired reviewers' transcripts for each archived review, and report the share of confirmed findings that one reviewer alone would have raised.
- **Should feel:** a quick second number for a pairing decision, from data already on disk.
- **Should understand:** a reviewer transcript with no findings table is unreadable, not zero findings. Any unreadable transcript, a lens dispatched to one reviewer only, or a set with no lens pair makes the run exit 3.
- **Red flags:**
  - Exit 0 with a non-zero `unreadableShare` or `unpairedLenses`.
  - Exit 0 with `lensPairs: 0`.

## Origin
- Created during the build of #5557 (run `2026-11-16T000458-record-5557`, PR #5574). That build turned the 2026-11-15 scratch replay into this tested tool. The first live run against the nine 2026-11-15 runs is tracked in #5630.
- Updated during the wrap-up of #5541: step 4 notes that `score` does not apply the escalation a review runs on a Standard-tier judge's raised finding.
- Updated during the build of #5990 (run `2026-11-21T173038-spec-5990`, PR #6014). Step 2 adds the `effort=` arm key. Step 4 adds the recorded-effort check (`effort-mismatch`, `recordedEffort`) and its red flag. This is the effort arm of the pipeline economy design's Phase 14.
