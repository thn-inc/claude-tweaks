# Pipeline economy baseline

Run: 2026-11-19, plugin 6.173.1, record #5914. The measured reference for the figures in the pipeline economy design's `## Evidence` (`docs/superpowers/specs/2026-11-18-pipeline-economy-design.md`, which landed on `main` through PR #5927, merge commit `eb4f4468ca2d79477ff3ff2a5081e6a07df3c1b5`; the "Design" column below is checkable against it once this branch is current with `main`).

Command, from the worktree root:

```
node tools/pipeline-cost-report.js --since 2026-11-08 --until 2026-11-18 --match claude-tweaks
```

- **Window:** UTC; `--since` and `--until` are inclusive whole days, and a message is counted by its own timestamp.
- **Prices dated 2026-11-03.**
- **Session type** is the first claude-tweaks skill a session invoked; a session that did several things is counted once. Subagent spend is attributed to its parent session's type.
- **`<synthetic>` lines** (Claude Code's records of API errors such as a usage limit) are left out of every spend tally.
- **Funnel** is a point-in-time reading, stamped with its run date and plugin version (2026-11-19, 6.173.1); it is not bound to the window. It runs `drive.js --check` over every open record labelled `ready` + `auto:build`.
- **Runs line:** `Runs: N in the window` counts the run directories under the main checkout's `.claude-tweaks/pipelines/` and its `archive/` whose names start with a date inside the window (a run in both is counted once); `undated` counts the names there with no leading date, across the whole directory rather than the window.
- **Deferral rule** (decided at plan review): a record created in the window counts as deferred when any line of its body contains `Defer-reason:`, and its reason is the first word after the first occurrence. Prose that mentions `Defer-reason:` counts too, so the reason table includes words taken from such mentions: `line`, `and` and `from` below are not deferral reasons.

## Design figures beside the measured ones

| Figure | Design (2026-11-18) | Measured (2026-11-19) |
|---|---|---|
| Total list-price spend | $18,851 | $19,078.41 |
| Merged pull requests | 164 | 202 |
| Deferral records | 317 of 586 created | 322 of 597 created |
| Records closed | 207 | 207 |

Why a measured value can differ:

- **Spend:** likely explanation, not verified — transcripts are read live, so requests dated inside the window but written after the design's reading would be counted, and the session sets differ. The evidence is only that the design counted 208 sessions and the tool counts 206 main sessions with a request in the window under `--match claude-tweaks`; the design's session list was not re-derived, so neither cause is measured.
- **Merged pull requests:** the tool reads every pull request merged in the window (`is:pr is:merged merged:2026-11-08..2026-11-18`). Per merged PR therefore reads $94.45 total and $63.15 build, against the design's $115 and $78.
- **Deferral records:** records filed since the design was written (created rises from 586 to 597). The design's reason counts (pre-existing-outside-diff 135, tiebreak-cant-tell 35, …) sum to 410, more than its 317 records; the likely explanation is that it counted every `Defer-reason:` in a body, where the tool counts one reason per record (inferred from that sum alone, not from the design's method).
- **Records closed:** both readings give 207, so nothing closed in the window since the design's reading changed the count.

One cut differs by definition: the design's "$618 after a model switch (162 turns)" treated the call after a `<synthetic>` line as a model switch. Recipe for the check: take every main transcript (not subagent files) under the default `--projects` roots whose project slug contains `claude-tweaks` and whose mtime is on or after 2026-11-08, read it with `scanTranscript` from `tools/pipeline-cost-report/spend.js`, and for each request timestamped in the window whose model family differs from the previous request's, count it and add its `cacheWriteUsd`. With a `<synthetic>` line kept in the previous-call chain (as a model of its own), that gives 170 requests and $621.72, the design's reading; with `<synthetic>` lines left out of the chain, as the tool does, 17 requests and $50.92, the tool's `model switch` row. The other requests are classified by their remaining causes (idle, compaction, ordinary growth). Summing `cacheWriteUsd` over every in-window request of the same transcripts gives main-session cache writes of $3,043.64, against the design's $3,035.

## Tool output

```markdown
# Pipeline cost report

2026-11-08 to 2026-11-18, UTC, inclusive
Prices dated 2026-11-03
Session type is the first claude-tweaks skill a session invoked; a session that did several things is counted once.

## Spend

Total: $19,078.41 over 206 main sessions with at least one request in the window.

### By session type

| Session type | Spend | Share |
|--------------|-------|-------|
| flow | $7,579.99 | 40% |
| dispatch | $5,176.95 | 27% |
| specify | $3,225.76 | 17% |
| capture | $2,239.70 | 12% |
| release | $388.57 | 2% |
| sweep | $316.68 | 2% |
| no skill invoked | $129.44 | 1% |
| wrap-up | $21.33 | 0% |

### By model

| Model | Spend | Share |
|-------|-------|-------|
| opus | $12,116.06 | 64% |
| fable | $4,570.25 | 24% |
| sonnet | $2,281.48 | 12% |
| haiku | $110.63 | 1% |

### By agent

| Agent | Spend | Share |
|-------|-------|-------|
| main | $7,692.98 | 40% |
| subagent | $11,385.43 | 60% |

### By prompt size (thousand tokens)

| Prompt | Requests | Spend | Share |
|--------|----------|-------|-------|
| <50 | 3639 | $307.09 | 2% |
| 50-100 | 64547 | $2,826.16 | 15% |
| 100-150 | 45096 | $2,231.19 | 12% |
| 150-200 | 28807 | $1,782.50 | 9% |
| 200-300 | 37461 | $3,272.33 | 17% |
| 300-400 | 29638 | $3,233.26 | 17% |
| 400-500 | 23752 | $3,174.50 | 17% |
| 500-700 | 14084 | $2,251.38 | 12% |

### Cache re-writes by cause

| Cause | Requests | Tokens | Spend |
|-------|----------|--------|-------|
| session start | 1141 | 58261372 | $230.61 |
| ordinary growth | 244832 | 1014534852 | $5,048.43 |
| compaction | 327 | 27558164 | $272.57 |
| idle | 287 | 86723339 | $925.75 |
| model switch | 17 | 4571905 | $50.92 |

Per merged PR (202 merged): $94.45 total, $63.15 build (flow + dispatch).

## Funnel

Driver admission, run 2026-11-19, plugin 6.173.1.

Checked: 142; admitted: 15; unreadable: 0.

| Refusal reason | Records |
|---|---|
| size is not low | 68 |
| protected path | 68 |
| risk is not low | 57 |
| more than 3 Key Files | 54 |
| ceremony is not fast-lane | 49 |
| no Key Files | 18 |
| record has an open PR | 14 |
| record has an open blocker | 14 |
| frontend surface | 5 |
| auto:merge-pending grant matures only on the normal path | 3 |
| no type:* label | 2 |

| If these stopped refusing | Admitted |
|---|---|
| size is not low | 18 |
| auto:merge-pending grant matures only on the normal path | 17 |
| more than 3 Key Files | 20 |
| ceremony is not fast-lane | 19 |
| protected path | 31 |
| risk is not low | 15 |
| record has an open PR | 15 |
| no type:* label | 16 |
| record has an open blocker | 15 |
| no Key Files | 20 |
| frontend surface | 16 |

## Records

Created: 597; closed: 207; open now: 822; deferred: 322 (269 open, 53 closed).

| Defer reason | Open | Closed |
|---|---|---|
| tangential | 75 | 7 |
| pre-existing-outside-diff | 71 | 7 |
| needs-human-decision | 51 | 12 |
| genuinely-larger | 47 | 7 |
| blocked-dependency | 8 | 15 |
| blocked-external | 9 | 3 |
| tiebreak-cant-tell | 4 | 0 |
| needs-verification | 1 | 1 |
| line | 1 | 0 |
| and | 1 | 0 |
| from | 0 | 1 |
| console-backfill-confirmed-low | 1 | 0 |

Runs: 431 in the window; 11 undated.
Unreadable: 0
```
