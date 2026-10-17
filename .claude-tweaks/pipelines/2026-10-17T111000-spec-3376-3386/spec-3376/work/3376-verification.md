# #3376 verification evidence — superpowers 7.0.0 re-pin

Evidence for ACs 6-8, produced against commit c4a1a339a (`pinned: "7.0.0"`, 19 assertions). Quoted output is raw.

## Drift run

**Method (AC6.2):** the read-only `/upstream-drift` skill is a project skill not invocable from the dispatched subagent that produced this file, so this uses the spec-permitted substitution: a scratch node script (outside the repo) that loads the manifest with `loadManifest('tools/upstream-drift/manifest.yml')` and runs `checkVersion(entry)` and `checkAssertions(entry)` from `tools/upstream-drift/checks.js` against the `superpowers` entry. `tools/upstream-drift/run.js` was never run (it files issues).

Raw output:

```
VERSION status=ok
VERSION detail=superpowers: installed version(s) [6.2.0, 6.3.0, 6.4.1, 7.0.0] include pinned 7.0.0
ASSERTIONS status=ok
ASSERTIONS results=19
ASSERTIONS by status={"ok":19}
 1 ok plugin/skills/_shared/subagent-output-contract.md <- skills/subagent-driven-development/implementer-prompt.md
 2 ok plugin/skills/build/SKILL.md <- skills/subagent-driven-development/SKILL.md
 3 ok plugin/skills/build/SKILL.md <- skills/subagent-driven-development/SKILL.md
 4 ok CLAUDE.md <- skills/brainstorming/SKILL.md
 5 ok plugin/skills/_shared/local-files-preflight-stop.md <- skills/subagent-driven-development/scripts/sdd-workspace
 6 ok plugin/skills/build/failure-recovery.md <- skills/subagent-driven-development/SKILL.md
 7 ok plugin/bin/lib/hooks/worktree-detect.js <- skills/using-git-worktrees/SKILL.md
 8 ok plugin/skills/build/dispatch.md <- skills/subagent-driven-development/SKILL.md
 9 ok plugin/skills/_shared/scratch-worktree.md <- skills/using-git-worktrees/SKILL.md
10 ok plugin/bin/lib/hooks/worktree-reap.js <- skills/finishing-a-development-branch/SKILL.md
11 ok plugin/skills/build/worktree-setup.md <- skills/using-git-worktrees/SKILL.md
12 ok plugin/skills/wrap-up/cleanup-procedures.md <- skills/finishing-a-development-branch/SKILL.md
13 ok plugin/skills/init/bootstrap/step-02-create-directory-structure.md <- skills/brainstorming/SKILL.md
14 ok plugin/skills/init/bootstrap/step-02-create-directory-structure.md <- skills/writing-plans/SKILL.md
15 ok plugin/skills/build/plan-authoring-checks.md <- skills/subagent-driven-development/SKILL.md
16 ok plugin/skills/build/dispatch.md <- skills/subagent-driven-development/SKILL.md
17 ok plugin/skills/build/dispatch.md <- skills/subagent-driven-development/SKILL.md
18 ok plugin/skills/build/plan-authoring-checks.md <- skills/subagent-driven-development/SKILL.md
19 ok plugin/skills/build/plan-authoring-checks.md <- skills/writing-plans/SKILL.md
```

Summary: version `ok`; assertions `ok`; 19 results; 19 `ok`; 0 `skipped`, 0 `unmatched`, 0 `missing-file`. (AC6.1)

## Discrimination check

**Method (AC7.1):** in `tools/upstream-drift/manifest.yml`, the pre-flight-scan assertion's `must-match` (assertion #15 in the order above; manifest line 285) was temporarily changed from `Before dispatching Task 1, scan the plan once for conflicts, writing down` to `Before dispatching Task 1, scan the plan once for conflictZ`, and the same scratch script was re-run. The manifest was then restored with `git checkout -- tools/upstream-drift/manifest.yml`; the altered manifest was never staged or committed.

Raw output with the altered literal (18 identical `ok` rows elided as `...`):

```
VERSION status=ok
VERSION detail=superpowers: installed version(s) [6.2.0, 6.3.0, 6.4.1, 7.0.0] include pinned 7.0.0
ASSERTIONS status=drift
ASSERTIONS results=19
ASSERTIONS by status={"ok":18,"unmatched":1}
...
15 unmatched plugin/skills/build/plan-authoring-checks.md <- skills/subagent-driven-development/SKILL.md
...
PREFLIGHT assertion #15 status=unmatched
PREFLIGHT detail=/Users/thomasholknielsen/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/subagent-driven-development/SKILL.md no longer contains "Before dispatching Task 1, scan the plan once for conflictZ"
```

The altered assertion goes `unmatched` and the overall assertions status goes `drift`, as expected.

Restore and re-check:

```
$ git checkout -- tools/upstream-drift/manifest.yml
$ git diff --exit-code tools/upstream-drift/manifest.yml; echo "diff_exit=$?"
diff_exit=0
```

Re-run of the drift check after restore:

```
VERSION status=ok
VERSION detail=superpowers: installed version(s) [6.2.0, 6.3.0, 6.4.1, 7.0.0] include pinned 7.0.0
ASSERTIONS status=ok
ASSERTIONS results=19
ASSERTIONS by status={"ok":19}
PREFLIGHT assertion #15 status=ok
PREFLIGHT detail=/Users/thomasholknielsen/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/subagent-driven-development/SKILL.md still contains "Before dispatching Task 1, scan the plan once for conflicts, writing down"
```

## Contract-path changes 6.2.0 -> 7.0.0

**Method (AC8.1):** `diff -u` between `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0/skills/{path}` and `.../7.0.0/skills/{path}` for each of the six `contract-paths`, plus the `sdd-workspace` script that assertion 5 pins. Bounded read of the hunks against what `plugin/skills/build/dispatch.md`, `plugin/skills/build/SKILL.md` and `plugin/skills/_shared/local-files-preflight-stop.md` rely on (the `.superpowers/sdd` workspace, `progress.md`, the per-task review loop, `## Final Review`, Cleanup/Finish). This is a read, not a behavioral verification. No `plugin/` file was edited.

Relevant changes, one per bullet:

- `skills/subagent-driven-development/SKILL.md` (Process, ledger): `Ruling:` records replace "ask the human" at every conflict, plan-defect and load-bearing-finding stop. Parked findings are now `Task <N>: parked — <finding> — Ruling: <why>` (the `Ruling` capitalized). Touches `plugin/skills/build/dispatch.md`, whose carry-forward instruction matches `parked —` and `minor (deferred):` lines in `progress.md`; both literals are still present in 7.0.0 (lines 362 and 416), so the literal match holds. **Behavior change, not a literal break:** in 6.2.0 a load-bearing per-task finding at the fix-loop breaker stopped the run for the human (`"Any load-bearing finding?" -> "STOP: report BLOCKED to human partner"`, 6.2.0 lines 98 and 368), and pre-flight conflicts were put to the human as one batched question (6.2.0 line 151). In 7.0.0 the controller rules on both itself and ledgers the load-bearing breaker ruling as `Task <N>: Ruling: <finding> — <what you decided and why>` (7.0.0 line 422) and pre-flight rulings as a bare `Ruling:` line (7.0.0 lines 176-180, 23). Neither of those line shapes matches `minor (deferred):` or `parked —`, so `dispatch.md`'s carry-forward does not copy them into the run ledger. A follow-up record to be filed will address this.
- `skills/subagent-driven-development/SKILL.md` (Finish): new first step collects every ledger line containing `Ruling:` into the final message under "Rulings I made" before the workspace is deleted (7.0.0 lines 473-479). Touches `plugin/skills/build/dispatch.md`, which already names this step ("deleted immediately after Finish's own 'Rulings I made' collection"); the text is consistent with 7.0.0. This is also where the behavior change above bites: with the ruling lines not carried forward, load-bearing and pre-flight rulings survive only in SDD's final "Rulings I made" message, never in the run ledger that `/wrap-up` reads.
- `skills/subagent-driven-development/SKILL.md` (Final Review): the heading `## Final Review` is unchanged (assertion 8 `ok`); only the script invocation gains `bash `, and residual load-bearing findings after the single fix wave are now ruled on and ledgered instead of stopping on (6.2.0 line 412: "or stop on load-bearing ones"; 7.0.0 line 466: "or rule on the load-bearing ones and ledger what you decided"). What still escapes the fix wave "surface[s] to your human partner when finishing-a-development-branch presents the options" (7.0.0 lines 468-469; same sentence at 6.2.0 lines 413-414). `/build` suppresses finishing-a-development-branch (`plugin/skills/build/SKILL.md` Common Step 2, lines 209-211, "stop the skill and return here"), so that surfacing channel does not exist under `/build` — the same carry-forward gap as above. Touches `plugin/skills/build/dispatch.md`.
- `skills/subagent-driven-development/SKILL.md` (per-task review loop): same five-round fix loop; plan-conflict findings are ruled on rather than raised to the human; scripts are now invoked as `bash scripts/{sdd-workspace,task-brief,review-package}`. Touches `plugin/skills/build/dispatch.md`, which alone directs SDD's per-task and whole-branch review (`plugin/skills/build/SKILL.md` defers to `dispatch.md`).
- `skills/subagent-driven-development/SKILL.md` (controller pre-flight scan): the scan now writes a table to the ledger and rules on conflicts instead of batching a question to the human. Touches `plugin/skills/build/plan-authoring-checks.md` (outside the three named files; covered by the new assertion 15).
- `skills/subagent-driven-development/SKILL.md` (new sections): "Rulings, not stalls" with four stop classes, "Batch small same-shape work", "Waiting on dispatched subagents", and a new no-subagents contract in the dispatch. Additive; touches `plugin/skills/build/dispatch.md` conceptually (per-task dispatch shape) and breaks none of the three files' instructions.
- `skills/subagent-driven-development/scripts/sdd-workspace` (not a contract path; read because assertion 5 pins it): now records a `plan-path` marker per workspace and, on a basename collision, suffixes the directory (`<slug>-<parent>` then `-<n>`); `.gitignore` is create-only. The literal `base="$root/.superpowers/sdd"` that `plugin/skills/_shared/local-files-preflight-stop.md` is pinned to is unchanged (assertion 5 `ok`). The workspace stays under `.superpowers/sdd/`; `dispatch.md`'s `.superpowers/sdd/{run-slug}/` description holds except that a colliding slug can now carry a parent-directory suffix.
- `skills/subagent-driven-development/implementer-prompt.md`: adds a "You Do Not Dispatch Subagents" section. The four-status vocabulary line that `plugin/skills/_shared/subagent-output-contract.md` mirrors is untouched (assertion 1 `ok`). Touches none of the three files.
- `skills/finishing-a-development-branch/SKILL.md`: adds an "If removal is refused" branch (ask the human; never `--force`) and a rationalization-table row. Touches `plugin/skills/build/SKILL.md`'s references to it (lines 209-211, 306, 332, 339: `/build` suppresses the skill's invocation and routes to it only as a post-review handoff line); that still holds, since the skill is unchanged in role and the new branch only concerns worktree removal.
- `skills/brainstorming/SKILL.md`: rewritten; the old terminal line is gone and `invoke superpowers:writing-plans and no other skill` is the surviving one (assertion 4, retargeted in Task 1). Touches `CLAUDE.md`'s override only, which still holds. No change to the three files.
- `skills/writing-plans/SKILL.md`: rewritten (plan-audience wording, Review Focus section, and an Execution Handoff that now asks the human to review the plan first and offers `Subagent-driven` / `Native` options, or only a review confirmation when a method was already supplied, instead of the 6.2.0 numbered `Subagent-Driven` / `Inline Execution` pair). Touches `plugin/skills/build/SKILL.md`'s references to it (lines 116, 128, 154, 164): the "For agentic workers" header is still present (7.0.0 line 59, naming subagent-driven-development or executing-plans) and an execution handoff section still exists (7.0.0 line 179), so `/build`'s "ignore the header" and "stop before the execution choice" instructions still hold; only the handoff's wording changed.
- `skills/using-git-worktrees/SKILL.md`: No changes affecting these files (the diff is empty).

The literal matches in the three named files all hold (every assertion `ok`), and no instruction in them is made false. One change is a real behavior change that touches `plugin/skills/build/dispatch.md`'s carry-forward ("Carry forward surviving SDD ledger residue before Finish"): load-bearing breaker rulings (`Task <N>: Ruling: ...`), bare pre-flight `Ruling:` lines and residual final-review rulings are not matched by its `minor (deferred):` / `parked —` filter, and `/build` suppresses finishing-a-development-branch, the channel 7.0.0 names for surfacing residual load-bearing findings. Those rulings now survive only in SDD's final "Rulings I made" message, not in the run ledger `/wrap-up` reads. A follow-up record to be filed will address `dispatch.md`'s carry-forward; this re-pin does not change it.
