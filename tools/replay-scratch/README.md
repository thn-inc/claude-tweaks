# Replay scratch scripts

Scratch scripts from the 2026-11-15 session behind `docs/superpowers/specs/2026-11-15-process-efficiency-design.md`. They produced that design's review and tiebreak numbers. They have no tests and assume this machine's layout. Unit 5.3 of the design replaces them with tested tools; until then they are here so a build can re-run the replay.

| File | What it does | Input |
|---|---|---|
| `review-yield.js` | Counts, per archived review, findings raised by both reviewers, by one, and each tiebreak outcome | One or more `.claude-tweaks/pipelines` roots |
| `baseline.js` | Per archived run: recorded verdicts, lens and tiebreak agent cost from `timing.json`, and the commit the review examined | The repository path, then run directories; one JSON line per run |
| `counterfactual.js` | Reads each lens reviewer's own table from its transcript and reports what one reviewer alone would have raised | The `baseline.js` output file |
| `prep-tiebreak.js` | Extracts the reviewed tree and writes tiebreak inputs (no verdicts) and the archived verdicts separately | Repository, baseline file, output directory, chunk size, run names |
| `tiebreak-replay.workflow.js` | Workflow script: one judge per chunk, plus a one-judge-per-finding control arm | `args`: the output directory and the run list |
| `score-tiebreak.js` | Compares replay verdicts with archived ones and totals tokens per arm | The output directory and the workflow's transcript directory |

Order: `baseline.js`, then `prep-tiebreak.js`, then run the workflow, then `score-tiebreak.js`.

Known limits: a finding is matched to an archived verdict by lens, path and line; `prep-tiebreak.js` leaves `.claude-tweaks/` out of the extracted tree, so a claim about a spec file cannot be judged; the workflow script must be started from a Claude Code session with the Workflow tool.
