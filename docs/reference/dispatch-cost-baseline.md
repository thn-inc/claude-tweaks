# Dispatch cost baseline — record #3316's /flow run (pre-change)

The pre-change baseline for per-dispatch cost attribution (#3375). It is the comparison point the
cost-shape records cite: #3377, #3381, the per-task-tier record, the task-merge record and the
whole-branch-review decision record. It was taken before any of them changed how a build
dispatches, so a later run's numbers are read against this one.

This file is maintainer-side: `docs/` is not part of the plugin payload and does not ship
(`docs/decisions/0015-plugin-payload-boundary-is-the-plugin-subtree.md`).

The tables below are the verbatim stdout of `plugin/bin/phase-timing.js`, pasted from a real run of
the CLI. None of it is hand-typed or reconstructed. The numbers are tokens, tier and wall-clock
only; there are no pricing or dollar values.

## The run

| Field | Value |
|---|---|
| Run | `2026-10-17T110950-record-3316` (spec #3316, the post-merge Windows regression guard; PR #3390) |
| Plan | `docs/superpowers/plans/2026-10-17-windows-regression-guard-3316.md` (deleted `a4c24ac6a`, PR #3390's merge commit) |
| Plan tasks | 4 (`node plugin/bin/plan-audit.js {plan} --count-tasks` printed `{"tasks": 4, "batched": false}`) |
| Dispatch shape | SDD per-task: `Implement Task 1: issue filer CLI`, `Implement Task 2: Windows workflow`, `Review Task 1 (spec + quality)`, `Review Task 2 (spec + quality)`, `Re-review Task 2 fix round 1`. The plan's Tasks 3 and 4 are main-session tasks by design (a real-input probe and live CI runs), so they have no SDD dispatch. |
| `ceremony-profile` | `standard` (the run's `config.yml`) |
| `model-stance` | `default` (the run's `config.yml`) |
| Mode | `auto` |
| Session | `bfb315de-981e-4d1a-8cdc-15688ef61019`, the only session |

## Command

```
node plugin/bin/phase-timing.js --run <scratch> --markdown --transcript <main transcript>
```

`<scratch>` was `$TMPDIR/dispatch-baseline-3316` (`os.tmpdir()`), a fresh directory holding copies of
the run's `events.jsonl`, `run-state.json` and `config.yml` (the run has no `manifest.yml`). The
CLI writes `timing.json` into `--run`, so the archived run directory was never passed to it. That
scratch directory was not kept; to re-run, make a new empty directory, copy those three files into
it from `.claude-tweaks/pipelines/archive/2026-10-17T110950-record-3316/`, and pass it as `--run`.
`<main transcript>` is, as of this file's last verification,
`~/.claude/projects/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/bfb315de-981e-4d1a-8cdc-15688ef61019.jsonl`.
This is the path that reproduces the table below. The exit code was 0.

The session is not at the path it was captured from. Claude Code's transcript directory is a slug
of the session's cwd, so a session that moves between a worktree and the main checkout changes
directory. At capture time the same session lived under the worktree slug
`~/.claude/projects/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-flow-record-3316/`;
that directory is now empty. If the transcript moves again, locate it by the session id.

The session is still live. Its transcript keeps growing (2,734 rows and 17.6 MB at capture,
17.9 MB at re-verification), so a re-run's phase table drifts: the `merge` row read 71 minutes and
the `total` 212 at capture, and 80 and 221 at re-verification (a reviewer saw 79 and 220; the
fix-wave re-run printed 99 and 240, and an immediate repeat 100 and 241). Only the
Dispatches block below is stable. It is clipped to the run's event window, and two back-to-back
re-runs against the relocated transcript reproduced it byte for byte.

## Transcript sources

- Main transcript: the current path above.
- Subagents directory: `~/.claude/projects/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/bfb315de-981e-4d1a-8cdc-15688ef61019/subagents/`
  holding 35 `agent-*.jsonl` transcripts with 35 `.meta.json` files. The CLI read all 35 (at
  capture they sat in the worktree-slug directory's `bfb315de-…/subagents/`).

## Plugin version

- The run's branch (`worktree-flow-record-3316`, deleted from origin after the merge): `plugin/.claude-plugin/plugin.json`
  at the branch's last commit `01e4ce1a0` reads `6.143.0`.
- Installed: the plugin cache `~/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/` holds
  `6.143.0` for the user scope (updated 2026-10-17 08:01 UTC, before the run began) and `6.142.0`
  for this repo's project scope (updated 07:31 UTC). Which of the two the session resolved is not
  recorded in the run, so both are stated.

## Per-tier and per-role tables

The dispatch section of the CLI's stdout, verbatim:

```
Dispatches (run window; agent-seconds sum spans with overlap kept, elapsed is their union — not comparable to phase minutes):
| Tier | Dispatches | Agent-seconds | Elapsed (min) | Tokens (in/out) | Cache (read/create) |
|---|---|---|---|---|---|
| fast | 5 | 741 | 6 | 218/125128 | 10857501/559141 |
| standard | 24 | 2379 | 34 | 552/232134 | 19367615/1621536 |
| capable | 6 | 1317 | 16 | 318/127607 | 17698757/750048 |

| Role | Dispatches | Agent-seconds | Elapsed (min) | Tokens (in/out) | Cache (read/create) |
|---|---|---|---|---|---|
| re-review | 3 | 252 | 4 | 70/30159 | 2798690/230125 |
| whole-branch review | 1 | 398 | 7 | 66/35825 | 3446302/146640 |
| task review | 2 | 119 | 2 | 32/13528 | 886550/109590 |
| lens reviewer | 14 | 1204 | 6 | 350/171176 | 14685748/1078955 |
| implementer | 3 | 572 | 10 | 124/46040 | 4296907/236086 |
| unlabelled | 12 | 1892 | 26 | 446/188141 | 21809676/1129329 |
```

These replace an earlier version of the tables that undercounted subagent output tokens about 9x:
that reader kept the first line's usage per `message.id`, but a subagent turn opens with a
streaming snapshot (`stop_reason: null`, a tiny `output_tokens`) and closes with the final count,
so it kept the snapshot (output total 55,053 against the true 484,869). The reader now takes the max
per `message.id`. Input and cache columns were never affected (equal on every line of a turn). The
same pass fixed role patterns that missed common descriptions (`Scoped re-review of review fixes`
moved from `unlabelled` to `re-review`) and rounds `Elapsed (min)` once from the exact union of
spans rather than per disjoint cluster (standard 32 became 34).

The phase table the same invocation printed above these tables is not reproduced here; it is the
existing per-phase view and carries main-session tokens only. Do not sum it with the dispatch
tables (the CLI says so in the header line).

What the roles contain: `lens reviewer` is the `/review` lens fan-out (3a to 3g, each A/B); the
three `implementer` rows are Task 1, Task 2 and one ad-hoc implementer (`Implement Windows
test-runner glob fix`). `unlabelled` holds descriptions with no role pattern, which is signal in
itself here: the three fix waves (`Apply the review fix wave`, `Final-review fix wave for #3316`,
`Fix baseline normalizeLog and Windows tmp drive`), `Fix nine ledger minors in filer and
launcher`, the four curation-row judges, the two simplifier passes and two reviews named without a
`Task N`. The `whole-branch review` row is a single Capable dispatch.

Role-pattern misses sit inside `unlabelled`, so the `task review` row is a lower bound, not a
count. Two review-shaped dispatches were not matched and are counted as `unlabelled`: `Review the
Windows glob runner task` (a task review) and `Review adjudication and excerpt fixes`. Add them
back and the true task-review count is higher than the 2 shown. A later run must be read the same
way, or compare the `unlabelled` row alongside it.

## Tier policy in effect

Tier comes from the dispatch's meta `model` alias: `haiku` is fast, `sonnet` is standard, `opus`
is capable (24 `sonnet`, 5 `haiku`, 6 `opus`; no `inherit`, absent or unmapped model). Who
landed where, from the per-item data in `timing.json`:

- Fast (5): lens reviewers 3a convention (A, B) and 3f test quality (A, B), plus `Re-review Task 2
  fix round 1`.
- Standard (24): every other lens reviewer (3b security, 3c errors, 3d performance, 3e
  architecture, 3g ownability, each A and B), `Implement Task 1`, `Implement Task 2`, the ad-hoc
  glob implementer, `Review Task 1` and `Review Task 2`, `Re-review final fix wave`, `Scoped
  re-review of review fixes`, the three fix waves, both simplifier passes and the two unmatched
  reviews above.
- Capable (6): `Whole-branch review of #3316`, the four curation-row judges (Skills, Docs,
  Journeys, Decision records) and `Fix nine ledger minors in filer and launcher`.

So the lens fan-out split two ways, 3a and 3f on fast and the other five lenses on standard, and
implementers and task reviewers were all standard. A later run has "the same tier policy" only if
its dispatches map the same way: if a record moves implementers, task reviewers or lenses to a
different tier, the run is not comparable on tier columns and the comparison is by role instead.

## Completeness statement

- Single session. Every `sessionId` and `session` value in the run's `events.jsonl` is
  `bfb315de-981e-4d1a-8cdc-15688ef61019`, equal to `run-state.json`'s. One event
  (`wd-foreign-session`) names a second session, `7c42b2db-9aec-43da-84a0-7de8772c2a5a`; it is a
  sibling session whose command in this worktree was refused by the isolation guard, not a
  contributor to the run, and no `7c42b2db` transcript was read.
- The dispatch records are clipped to the run's event window (`2026-10-17T11:14:13Z` to
  `15:10:57Z`). `timing.json` reports `dispatches.excludedOutsideWindow: 0`: no subagent transcript
  was dropped for lying outside it. The 35 dispatches span `11:20:54Z` to `14:20:14Z`.
- 35 dispatches enumerated, 35 in the tables, and no `not found` line or null field was printed:
  every meta file had a readable transcript and every transcript had a meta file.
- Tier counts add to 35 (5 + 24 + 6) and role counts add to 35 (3 + 1 + 2 + 14 + 3 + 12).
- Output-token reconciliation. The tier table's output tokens sum to 484,869 (125,128 + 232,134 +
  127,607) and the role table's to the same 484,869 (30,159 + 35,825 + 13,528 + 171,176 + 46,040 +
  188,141). An independent count, a separate script that does not use `readUsage` or its dedupe
  rule (max `output_tokens` per `message.id` per agent file, summed over the 35 `agent-*.jsonl`
  files and 543 distinct message ids), also gives 484,869. The two agree exactly. The same session's
  main transcript totals 499,987 output tokens (the phase table's `total` row), the same under
  first-line and max-per-id, so the main-transcript path is unchanged.
- Nested dispatches (`spawnDepth` above 1) would be included; none occurred, every record has
  `spawnDepth: 1`.
- All 35 dispatches resolved their tier from the meta model alias (`haiku`, `sonnet`, `opus`); none
  fell through to the transcript model or to `unmapped`.

## Comparability rule

A later run is compared against this baseline only when all three hold; otherwise the comparison is
reported as not comparable rather than adjusted:

1. The same `model-stance` (`default`) and the same tier policy as the record above resolved, so a
   tier column means the same model family in both runs.
2. A plan task count within +-50% of this run's 4, that is 2 to 6 tasks per `plan-audit.js
   --count-tasks`.
3. SDD per-task dispatch (`Implement Task N` and `Review Task N` in the subagent descriptions),
   and a dispatched-over-plan task ratio within +-0.25 of this run's 0.5, that is 0.25 to 0.75.
   This run dispatched 2 of its 4 plan tasks through SDD (Tasks 3 and 4 were main-session tasks
   by plan design), so a comparison states its own ratio. A run that dispatches all of a 4-task
   plan (ratio 1.0) is not like for like, even though its task count is within range.

Also compare like with like on `ceremony-profile` (`standard` here) and read both runs through
the same CLI build; a record that changes the dispatch shape changes the role rows by design, which
is what the comparison is for.

## Candidates checked

The spec's "representative" definition has four parts: at least four tasks per
`plan-audit.js --count-tasks`, SDD per-task dispatch, the `standard` ceremony profile, and a single
session whose transcripts are still on disk.

| Run | Plan tasks | SDD per-task | `standard` | Single session, transcripts on disk | Result |
|---|---|---|---|---|---|
| `archive/2026-10-17T110950-record-3316` | 4 | yes (Tasks 1 and 2) | yes | yes | Qualifies; the baseline above |
| `2026-10-17T062549-spec-3307-3308-3306-3309-3310-3311` | per plan: #3307 6, #3306 3, #3309 3, #3308 1 (the #3310 and #3311 plans were not on the branch) | yes | yes | yes (session `6868a867-...`, 89 transcripts) | Not used: a multi-spec run still active (84 transcripts when the check began, 89 later) whose plans mix 6, 3, 3 and 1 tasks, so one table would blend six specs and move under later reads |
| `archive/2026-10-17T111000-spec-3376-3386` | 2-task plans | n/a | n/a | n/a | Fails the task count (ruled out at plan time) |
| `2026-10-17T100123-spec-3368-3365` | 3 (#3365) and 1 (#3368) | n/a | n/a | n/a | Fails the task count (ruled out at plan time) |

For the multi-spec run the task-count criterion applies per plan; only the #3307 plan (6 tasks)
meets it, so it was not run through the CLI and contributes no table. It remains available as a
second data point once it closes, but it is not part of this baseline.
