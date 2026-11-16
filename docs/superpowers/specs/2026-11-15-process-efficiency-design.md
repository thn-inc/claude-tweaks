# Process efficiency — design

Date: 2026-11-15. Status: draft for approval.

## Why

Two designs already cut cost. The pipeline driver (`2026-11-11-pipeline-driver-design.md`) moves the express lane's steps into a program. The audit simplification (`2026-11-15-audit-simplification-design.md`) removes dead and duplicated code. Neither changes how the standard lane spends its time, and most runs still take that lane.

This design comes from session transcripts, 2026-10-08 to 2026-11-15: 666 sessions and 29,557 subagent transcripts across every project that uses the plugin, plus the decision logs of 419 archived reviews. What they show for the standard lane:

- A `/claude-tweaks:flow` session takes a median of 12 hours of wall clock, 550 model requests, 56 subagents and 3 compactions.
- Of 267 typed flow or dispatch runs, 12 finished with no follow-up from the maintainer. The mean was 7.7 interventions. About 44% of the maintainer's prompts were a bare go-ahead or a merge instruction.
- `/claude-tweaks:review` is the largest single cost: 88M output tokens, 13% of all output.
- The worktree guard refused 13,628 commands, 30% of all tool errors, 84% of them in subagents. Sampled refusals include `git log`, `grep -n` and `sed -n`.
- 52,181 Bash calls (5.6%) start with `sleep`; 99.5% of them are in subagents.
- `/claude-tweaks:journeys` ran in 312 sessions and used 8.1M output tokens, including on diffs with no user-facing surface.

It also carries the maintainer's direction from 2026-11-15: a process chosen per task instead of one fixed pipeline, and a standing loop that keeps measuring and improving the flow, with the dispatch hub as its display.

## Goals

1. The review step's tiebreak cost falls by at least half with verdicts no less consistent than a rerun of today's design.
2. A read-only command is never refused by the worktree guard for its shape.
3. No subagent waits by polling with `sleep`.
4. A skill that has nothing to do for a diff is not loaded for it.
5. Every run leaves per-step cost and yield facts that a program can read, and the replay tools that produced this design's numbers are kept.
6. The next design, a run graph for the standard lane, starts from those facts.

## Non-goals

- No skill is deleted or moved to another plugin. Low use in the measured window is not evidence a skill is unwanted.
- No change to release cadence.
- No change to the paired lens reviewers. See "Evidence: the pair".
- No change to the driver's phases or the audit's phases. This design orders itself around them.
- No hub code. The scoreboard's per-step view is a record in the dispatch repository.

## Evidence status

The numbers come from scratch scripts run on 2026-11-15, not from shipped tooling. Each unit's record re-derives its own counts at specify time. Three caveats apply throughout:

- "Blocked on questions" includes overnight waits.
- Cloud routine runs are not in the transcripts.
- This repository's own development sessions inflate CLI and read counts.

### Evidence: the pair

A replay of 44 archived reviews (266 lens pairs) read each reviewer's own output table. Of the confirmed findings that could be located in a table (426 of 498), reviewer A alone raised 65%, reviewer B alone 60%, and both 25%. A single reviewer would lose about a third of confirmed findings. The pair is kept.

### Evidence: the tiebreak

In those 44 reviews, 529 tiebreak agents used 24.6M cache-creation tokens, about as much as one side of the reviewer pairs. A replay judged 60 archived findings from nine reviews with one judge per review instead of one per finding:

| | One judge per finding (archived) | One judge per review (replay) |
|---|---|---|
| Agents | 63 | 10 |
| Output tokens | 132k | 64k |
| Cache-creation tokens | 2.83M | 0.63M |
| Agreement with the archived verdict | — | 52 of 60 (87%) |

A control arm reran one judge per finding on 14 of those findings and agreed with the archive on 12 (86%). The batched judge scored 12 of 14 on the same findings. The difference is rerun noise.

### Evidence: workflows

Probed on CLI 2.1.325: a headless `claude -p` worker has the Workflow tool; the plugin's PreToolUse hook fires for a workflow agent; a workflow script cannot read files, start processes or require a module. A simplified lens prompt run as a workflow found nothing where the archived review confirmed four findings, so a port must use the composed brief unchanged.

## Order and overlap

- Phase 0 is decisions. Each is needed only by the phase that names it.
- Phase 1 raises records that already exist. It files nothing.
- Phases 2, 5 and 8 touch disjoint file areas and can run in parallel with each other and with the audit's Phase 1.
- Phase 3 edits the guard's command scanner. It waits for #4448 (in progress on the same gate) and runs before or after the audit's unit 1.5, never beside it.
- Phase 4's unit 4.1 edits the wait instructions in `dispatch/task-prompt.md` and `dispatch/express-prompt.md`. It waits for the audit's unit 5.1, which removes three of the four copies of that block.
- Phase 6 waits for Phase 2 and for #4359, which both edit the review step's dispatch files.
- Phase 7 waits for Phase 5 and for the driver's Phase 4 (#5221).
- The audit's Phase 3 moves every `plugin/bin` CLI onto one argument parser. Any unit here that adds a CLI flag lands before that phase starts on the CLI, or after it; the record checks which.

## Phase 0 — Decisions

No build. The maintainer answers; the answer is written into this section.

Answered by the maintainer on 2026-11-15:

- **0.1:** limited. Redesign is free and no shim stays without a removal condition, but a change must not break a run in flight on the previous release, because live sessions run mixed plugin versions. `project-maturity` stays `established`; unit 1.3 rewords the `CLAUDE.md` paragraph to say this.
- **0.2:** yes for a command the maintainer types; no for a run a hub or routine starts. Unit 1.2 is ordered.
- **0.3:** decided after a sample of 30 low-priority records is read. The sample is below; the decision is still open.

Sample for 0.3, read on 2026-11-15: 30 of the 226 open `priority:low` records (every record whose number is 3 modulo 7), classified from the title and the first 300 characters of the body. All 30 were filed by an agent step (ledger resolve gate, reflect, review, release-gate review or the tidy digest sweep).

| Kind | Count | Records |
|---|---|---|
| A defect a run can hit | 5 | #4861, #4931, #4749, #4364, #5085 |
| Roll-up of findings already judged below the materiality floor | 5 | #5043, #5036, #4413, #4406, #4399 (174 findings between them) |
| Refactor, de-duplication or consistency with no defect named | 8 | #5071, #4903, #4763, #4735, #4357, #4259, #4910, #5064 |
| "Verify or re-measure later" follow-up | 3 | #5092, #5057, #4644 |
| Decision, process rule or small feature | 4 | #5050, #3986, #4686, #4525 |
| Prose or project-skill drift | 2 | #4952, #4672 |
| Exotic input or cosmetic | 2 | #5001, #5316 |
| Already fixed at HEAD by its own account | 1 | #4245 |

Recommendation, not yet decided: stop the digest sweep from promoting below-floor findings into records; close no-defect refactor records that no design adopts after four weeks; keep defects.

**0.1 Project maturity.** `.claude-tweaks/policy.yml` sets `project-maturity: established`, and `CLAUDE.md` says contract changes follow expand-contract. The maintainer said on 2026-11-15 that this is greenfield and drastic changes are allowed. Either the policy value and the paragraph change, or the stance is limited to named areas. Needed before Phase 6.

**0.2 A named record without a grant.** `/claude-tweaks:dispatch #N` and `drive.js #N` refuse a record with no `auto:build` label. In the transcripts this costs a refine, a label confirmation and a second dispatch for a record the maintainer just named. Either naming a record authorizes its build, or the refusal stays. The driver design made the opposite call (its undiscussed call 8). Needed before unit 1.2 is ordered.

**0.3 Backlog intake.** 1,459 records were opened in 30 days and 991 closed; 663 are open and 659 of those were filed since 2026-10-01. Either the materiality floor rises, or low-priority agent-filed records past an age are closed as not planned, or both, or neither.

## Phase 1 — Land what is already filed

No new records. Raise priority and order these.

| Records | What they remove | Note |
|---|---|---|
| #4623, #4624, #4620 | The typed merge instruction and the unreviewed-console residue | Open sub-issues of #4608. These three are the control-mode path; the other ten open sub-issues follow |
| #5232, then #5221 and #5225 | Model turns for bookkeeping on the express lane | Driver Phases 3 to 5, unchanged |
| #3976, #3975 | One archive commit per run on `main` (754 of 1,581 commits in 30 days) | Already raised by the audit's Phase 2 |
| #5258, #5250 | 4,167 failed Grep calls | Decide per platform, as filed |
| #5049 | Merge conflicts in `docs/plugin-structure.md` | Batch merges conflicted there in the sampled sessions |
| #4679 | Filing a finding the tiebreak said to drop | Feeds unit 2.2 |

**1.2 A typed dispatch carries its own build authority.** One new record, per decision 0.2: `/claude-tweaks:dispatch #N` and `drive.js #N`, when a human types them, build a record that has no `auto:build` label. A hub-started or routine-started run still requires the label. The record states how the two are told apart, and it changes the driver design's call 8.

**1.3 Reword the maturity paragraph.** One new record, per decision 0.1: the `CLAUDE.md` paragraph that begins "Established codebase" states the limited stance. It stays inside the file's line budget.

## Phase 1: Specified

Records: unit 1.2 as #5584, unit 1.3 as #5585 (merged 2026-11-16). No parent: the two units are independent.

- #5584 tells a typed command from a started run by a record the prompt hook writes when a person types the command, plus the session's environment. It fails closed. A session launched through `cc` carries no marker of who launched it, so until thn-inc/claude-user-config#50 ships, the label stays required in every such session.
- The label check is not in `claim-targets.js`. It is in the queue pull, the dispatch skill's two named-form bullets, the driver's admission and `dispatch resume`'s verdict.
- `CLAUDE.md` has no line-count test. `tests/claude-md-budget.test.js` bounds bytes; #5585 was written to that bound.

## Phase 2 — Tiebreak cost

## Phase 2: Specified

Records: parent #5539, unit 2.1 as #5540, unit 2.2 as #5541 (blocked by #5540).

**2.1 One judge per review.** Step 3.7 sends every unpaired finding to its own judge. Send a review's unpaired findings to one judge in chunks of at most eight, each judged independently, with the same evidence rules. The verdict line per finding in `decisions.md` keeps its present form, because other readers parse it; the record lists them. Done when a replay over at least 20 archived reviews shows agreement with the archived verdicts no lower than a one-per-finding rerun on the same findings, and cache-creation tokens for the step at most half.

**2.2 Judge tier by severity.** Every finding gets a Capable-tier judge, including `info` findings (#5148 names this). Adopt the tiebreak half of #5148 here, not as a second record: the record decides the tier for `low` and `info` from a replay, and leaves `medium` and above on Capable.

Files: `plugin/skills/review/step3-tiebreak.md`, `step3-routing.md`, `plugin/bin/lib/tiebreak.js`, `plugin/bin/lib/coordination.js` and their tests.

## Phase 3 — Guard: reads are never refused

## Phase 3: Specified

Records: parent #5586; #5587 (the tool reports which guard refused each command and whether it only reads), #5588 (two rewrite rules applied before the harness guard reads a command), #5589 (a CLI for the adopted-branch check, whose skill snippet produced 346 refusals), #5590 (replay, the shapes the plugin cannot fix, and the re-read of #4990 and #4931; blocked by the other three).

The premise below was wrong, and the records are written to what was measured on 2026-11-16 over 30 days:

- "The guard" is Claude Code's own worktree-isolation guard, which the plugin cannot change: 12,770 of 13,202 refusals (96.7%). The plugin's gates refused 432, and 4 of their 314 worktree-always Bash denials were reads. No record edits the plugin's scanner, so nothing here waits for #4448.
- What the plugin can do for a harness refusal is rewrite a refused read shape into an accepted one in PreToolUse (#5588), or stop its own skill text from producing the shape (#5589).
- Two classes stay refused: reads of another checkout (876 in 30 days) and long read-only chains. #5590 records them. An issue for the Claude Code tracker is drafted and not filed.
- Unit 3.1's "95% of refusals keyed by shape" cannot be met: the shape detectors leave 64% unclassified. #5587 keys the table on guard, reason and effect.

**3.1 Classify the refusals.** `tools/guard-refusals.js` (#4028) already reads transcripts and counts refused commands by reason and by detector shape. This unit adds what it lacks: for each shape, whether the command writes. Done when the table covers at least 95% of refusals in a 30-day window.

**3.2 Admit read-only shapes.** For each shape in the table that only reads, the scanner admits it. A shape the scanner cannot prove read-only stays refused. Every change passes the differential run in `.claude/skills/shell-scanner-bash-differential`. Done when a replay of the window's refused commands shows no read-only command refused and no write newly admitted.

The existing records that teach callers to avoid refused shapes (#4990, #4931) stay open until 3.2 lands, then are re-read: each is closed or narrowed.

## Phase 4 — Waits and skill gating

## Phase 4: Specified

Records: parent #5600; unit 4.1 as #5601 (the wait rule stated once, in the context pack), #5602 (`wait-for.js`) and #5604 (the prompts name it; blocked by #5601 and #5602); unit 4.2 as #5605.

What the measurement changed, 2026-11-16 over 30 days:

- 96.5% of sleep-led calls in subagents (52,132 of 54,034) are the keep-alive wait on a nested child agent, which the plugin's own prompts instruct. CI, a background verify and a sibling agent together are under 2%. So the wait command's first target is a child agent's stop.
- Whether a waiting process can see a child's stop was not observed. #5602 opens with a probe and stops if the answer is no; #5604 then returns to shaping.
- #5601 removes the duplicated block itself (the audit design's unit 5.1), so unit 4.1 no longer waits for that design. #4831 asks for part of the same removal.
- Three of the seven call sites in unit 4.2 already check before loading. `/claude-tweaks:journeys` wrote a journey file in 79% of its loads; the gate skips it only for diffs confined to tests and pipeline bookkeeping (8% of merged work commits). The saving is modest.

**4.1 A blocking wait.** The record first lists what subagents poll for (CI checks, a background verify, a sibling agent) from the transcripts. Each target gets a foreground command that returns when the state changes or a bound passes, and the prompts name it. Done when a 30-day replay of new transcripts shows `sleep`-led Bash calls in subagents under 0.5% of their Bash calls.

**4.2 Gate before load.** `/claude-tweaks:journeys`, `/claude-tweaks:visual-review` and `/claude-tweaks:design-wrapper` are invoked by `/claude-tweaks:build`, `/claude-tweaks:review` and `/claude-tweaks:flow` whatever the diff touches. The record first measures how often each ends with nothing produced. Then the decision moves into a CLI call the invoking step makes first, so a skill with nothing to do is never loaded. The gate logs a SKIP line. Done when a run on a diff with no user-facing surface loads none of the three.

## Phase 5 — Per-step facts and replay tools

## Phase 5: Specified

Records: parent #5554, unit 5.1 as #5555, unit 5.2 as #5556 (blocked by #5555), unit 5.3 as #5557. Unit 5.4 is thn-inc/dispatch#1586, which waits on #5556 and on its own design there.

**5.1 Timing for every run.** `timing.json` exists in 406 of 2,948 run directories. It is written only when a model step runs `phase-timing.js`. Of 255 November runs, 106 have none; 90 of those are dispatched runs and 93 are closed. The record writes the file in code when a run closes.

**5.2 Step yield.** One run artifact holds, per step: tokens, minutes, agents, and what the step produced. For review: findings raised, reported by both reviewers, confirmed and refuted by tiebreak. For any step: questions asked and minutes waited on each. Written by code from the decision log and the timing data; no model turn.

**5.3 Replay tools.** Move the scratch scripts behind this design into `tools/`, with tests sized like the neighbouring tools: the single-reviewer counterfactual from lens tables and the tiebreak replay harness. The judges stay agents of a Workflow script, so the replay's token totals compare with the archive's. Review yield across the archive is not a third tool: 5.2's function is run over archived run directories by a small report. `tools/` is maintainer-side and does not ship.

**5.4 Scoreboard view.** One record in the dispatch repository: the scoreboard reads the 5.2 artifact and shows cost against yield per step and lane. Filed there, designed there.

## Phase 6 — Review fan-out as a plugin workflow

## Phase 6: Specified

Records: parent #5594; #5595 (the pair lines are written by `categorise-reproduction`; blocked by #5541, #4359 and #5556), #5596 (probes of what a plugin-shipped workflow can do), #5597 (workflow agents counted in `timing.json`), #5598 (one call settles a review's lens replies; blocked by #5595), #5599 (the workflow path behind a policy key; blocked by all of them).

- A dispatched build agent and a driver worker have no Workflow tool. Most reviews run inside one, so the present Task dispatch stays as a permanent fallback. The removal condition is for the policy key, not for the dispatch.
- For the same reason #5596 and #5599 are built by a top-level session (`/claude-tweaks:flow`), not through `/claude-tweaks:dispatch`.
- The script returns each reviewer's reply as text and a shipped parser reads it. A schema would make a workflow agent answer through a structured-output call, which contradicts the brief's table-then-status block.
- There are seven pair-line forms, not six.
- Workflow agents' transcripts sit one level below where the timing reader looks; without #5597 the workflow path would look cheaper than it is.
- Not verified: starting a plugin-shipped workflow by name. #5596 probes it first and ends blocked if it fails.

One workflow script in `plugin/workflows/` runs the lens reviewers for a review: the composed brief unchanged, both reviewers of each pair, model and effort per lens as today. The script returns each reviewer's findings as structured output. Pairing, the ground-truth checks and the decision-log lines stay in the existing CLIs, called after the workflow returns, because a script cannot require a module. One of those is not in a CLI today: the per-finding pair lines (`Reproduction: … reproduced. Confirmed.` and five more forms) are written by the reviewing session from templates in `step3-lens-dispatch.md`. This phase moves that write into `review-coordination.js categorise-reproduction`, the way `resolve-tiebreak --run` already logs its own line. `/claude-tweaks:review` Step 3 names the workflow; that is the opt-in the tool requires.

Done when, over at least 20 reviews run both ways, the workflow path's confirmed findings are no fewer and the main session's tokens for Step 3 are lower, both read from the 5.2 artifact.

If decision 0.1 keeps `established`, this phase ships beside the present dispatch behind a policy key, with a recorded removal condition.

## Phase 7 — Run graph for the standard lane

## Phase 7: Specified

Record: #5580 (blocked by #5556). No parent. The driver's Phase 4 (#5221) closed on 2026-11-15 and is not a blocker.

- The HARD-GATEs are not a never-skip set today: three sit inside steps the ceremony roster lets the fast lane skip. The design doc must say, per gate, whether its step is in every graph.
- Of the 100 most recent closed runs, 92 are standard. A lane with fewer than 20 runs in the archive (driver has 3) gets no rule from the numbers.
- Any rule that gives a record fewer steps than today sits behind a policy value whose default reproduces today's graph.

A design, not a build: one record whose deliverable is a design doc that extends the driver design to the standard lane.

It must settle: the step vocabulary; the function from record facts (type, size, risk, surface, changed paths, task count) to the steps a run takes; which steps no record may skip, as assertions in that function; where a loop is allowed and its bound; and what replaces `_shared/ceremony-profile.md`'s skip roster. It selects steps from a fixed vocabulary. It does not let a model write the graph: record text is untrusted input, and published work on workflow selection finds selection sufficient where tasks differ mainly in difficulty or budget (arXiv 2603.22386, section 7.2, read through a summary).

Its numbers come from Phase 5.

## Phase 8 — Repository weight

## Phase 8: Specified

Records: unit 8.1 as #5562 (blocked by #3813, which moves the plan deletion before the `pr-first` merge), unit 8.2 as #5563. No parent: the two units are independent. #5563 ships the changelog key switched off; this repository opts in through #5566 (blocked by #5563), once that release is the installed plugin, so no running session reads a trimmed file with a release check that does not know the trim.

**8.1 Working plans out of git.** `docs/superpowers/plans/` holds 79 plan files (2.8 MB) that `/claude-tweaks:tidy` deletes in batches after their runs end: 699 added and 641 deleted on `main` in 30 days. The mechanism to delete each at wrap-up exists: the policy key `superpowers-plans-retention` has a `prune-after-wrapup` value, and this repository leaves it at `keep-forever`. The record sets it here, checks every reader first, and leaves the plugin default alone.

**8.2 Changelog size.** `CHANGELOG.md` is 557 KB in 335 sections; the newest 50 take 197 KB. Keep a bounded number of releases in the file, set by a new policy key that is off by default. Only 61 of the 320 tags have a GitHub release, so a link to GitHub releases covers the recent sections only; the trimmed file also names the commit at which it was last whole. The release residue probe and `/claude-tweaks:tidy`'s Backfill action must respect the floor, or the next tidy puts the removed headings back.

## Not planned

| Finding | Why not |
|---|---|
| One reviewer per lens | Loses about a third of confirmed findings |
| Deleting skills with no invocations in the window | Maintainer decision, 2026-11-15 |
| A second plugin for the UI skills | Saves nothing per session when both are installed |
| Fewer releases | Maintainer decision, 2026-11-15 |
| Removing issue citations from all shipped prose | Touches every skill file and would collide with every other unit; revisit after the audit's Phase 5 |
| Prose-pin policy | #4964 |
| A model-generated graph per task | See Phase 7 |

## Left to the builder

- The chunk size in 2.1, within the stated bound.
- The form of the 5.2 artifact, beyond the fields named.
- Whether 4.1 is one command with targets or one per target.
- Tests sized like the neighbouring suites.

## Calls made in this document that were not discussed

1. The pair is kept on the replay's evidence; no experiment with a single reviewer is planned.
2. Tiebreak batching keeps the per-finding line in `decisions.md` unchanged.
3. Phase 3 changes the guard instead of teaching more callers to avoid it.
4. The replay tools go in `tools/`, not in `plugin/`.
5. Phase 6 keeps pairing in the CLIs, outside the workflow script.
6. Phase 7 is a design record, and it selects steps; it does not generate graphs.
7. Phase 1 names three of #4608's thirteen open sub-issues as first.
8. Phase 8 is in this design although it came from the repository measurements, not the transcripts.
