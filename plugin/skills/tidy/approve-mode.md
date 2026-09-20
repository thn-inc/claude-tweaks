# Tidy — `--approve` Mode

Entered when `/claude-tweaks:tidy --approve [run-dir]` is invoked — `SKILL.md`'s Input row routes
here instead of Steps 1-5's scan. This mode never re-scans the backlog; it resumes a single past
run's already-staged Approve set, in a later, human-present session (a tidy run that staged items
under `moderate`/`aggressive` auto-mode routing, or an interactive run whose batch approval was
deferred). **Human-present only** — a Routine never fires `--approve`: `routine-template.yml`
ships one weekly full-sweep firing with no `--approve` variant, and there is no unattended
batch-approval mechanism for it to drive.

## Resolving the target run

**No-arg default:** the newest `{$RUN_ROOT}/.claude-tweaks/pipelines/*-tidy-standalone*/` or
`*-sweep-standalone*/` directory (glob match across both shapes + ISO-timestamp-prefix sort,
newest last) whose `staged/` holds one or more files — a `*-sweep-standalone*` run's staged items
originate from tidy's own Step 1 component run inside sweep's shared run dir, and are approvable
the same way as a standalone tidy run's — $RUN_ROOT anchored per `_shared/pipeline-run-dir.md`'s
Anchoring section (`git rev-parse --git-common-dir`, normalized; never a bare relative path,
`[IL-127]`). If the newest matching directory's `staged/` is empty, walk to the next-newest across
both shapes by the same sort; if none of them have a non-empty `staged/`, report `no staged tidy
proposals found` and stop — nothing to approve. `backlog/attention-mode.md`'s Tidy row shares this
same glob-and-sort rule but only ever looks at the single newest matching directory (its own
accepted limitation) and omits the row when that one's `staged/` is empty, so this walk-back can
resolve a run the attention row doesn't currently surface — the two are the same rule, not the
same result, whenever the newest run's `staged/` is empty but an older one's isn't.

**Explicit `[run-dir]` argument:** validated as an existing directory that resolves under
`$RUN_ROOT` (same anchoring check — reject and stop on a path outside the main checkout, the
`[IL-127]` shape, rather than silently operating on a worktree-local shadow), whose name matches
`*-tidy-standalone*` or `*-sweep-standalone*` — reject and stop (`{run-dir} is not a
tidy-standalone or sweep-standalone run — --approve only resolves *-tidy-standalone* or
*-sweep-standalone* run directories`) on any other run dir, since no other standalone-auto
skill's run dir ever carries an Approve-set this mode can execute — and that has a `staged/`
subdirectory. An explicit target with an empty or absent `staged/` reports `nothing
staged in {run-dir}` and stops — no next-newest fallback for an explicit path; the caller named it
on purpose.

## Re-entering the Approve rendering

Re-render `step-6-auto.md`'s `**Approve ({N})**` report section with the same renderer Step 6
itself uses (#2612) — never by hand-re-deriving the three-line-per-item shape:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/render-tidy-report.js" --run "{run-dir}"
```

This reads `staged/*.json` sidecars directly, so a later `--approve` run renders the identical
Approve section a fresh run would from the same `staged/` contents. Then obtain approval the
interactive way — this skill's own Interaction style directive at the top of `SKILL.md`: one
`AskUserQuestion` call, one option ("Approve all") marked Recommended, plus an override path
naming specific items to exclude. This mode is never reached from `auto` mode itself — it exists
precisely because an earlier auto or interactive run left items staged rather than applied.

## Re-verify before applying

Before applying **any** approved item, re-verify its precondition fresh — per
`_shared/reverify-before-write.md`'s stale-confirmation-gate pattern, this run's own staged
snapshot was taken at scan time, and the wait between that scan and this later `--approve`
invocation is unbounded. Re-read the live state each item's staged action depends on (the record's
current labels/state, the PR's current mergeability, the file's current contents — whatever the
item's own action type reads): a target that has since changed, closed, or been resolved some
other way reports `stale — skipped` in the verification output rather than applying, and is
dropped from the approved set. Never apply on an unread premise.

## Executing the approved set

On approval (minus any items dropped as stale above), Steps 7 and 7.5 run exactly as they would
for a same-session batch approval — execute per the Action Vocabulary table and the resolved
Action Execution file, then the Step 7.5 verification checklist and commit, `--scope` prefix rules
included when the original run recorded one.

## Archiving the run

Once Step 7.5's commit lands, the resolved run directory archives via the existing mechanism —
`node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "{run-dir}"` (marks it terminal, safe
even if a prior invocation already closed it) followed by
`node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run "{run-dir}"` (moves `config.yml`,
`decisions.md`, `report.md` when present, `staged/`, and everything else the run directory holds
into `.claude-tweaks/pipelines/archive/`). Any item dropped as stale above is not silently lost —
it stays visible in the archived `decisions.md`/`report.md`, the same way a skipped staged item
already survives archival on any other run.
