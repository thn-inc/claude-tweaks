# Flow — Express Entry (Step 2.9)

Loaded by `/claude-tweaks:flow` Step 2.9, after Step 2.8's claim and before Step 3's Config Manifesto (#4025). It routes one small, low-risk record through `_shared/express-lane.md`'s single-agent procedure instead of the pipeline. A run that misses any entry condition continues at Step 3 unchanged, with nothing from this file run for it.

## Entry conditions

All five must hold:

1. **One record, freshly claimed.** `$ARGUMENTS` names exactly one record reference — not a list, not a topic name — and `$PIPELINE_RUN_DIR` was unset on entry, so Step 2.8 minted the run dir and claimed under it. An inherited run dir (a resume) never enters, nor does a `work-backend: local-files` run, which Step 2.8 skips.
2. **No step list.** Step 1.4 resolved the default full pipeline. An explicit step list never enters the lane — every `/claude-tweaks:dispatch` call passes one, and dispatch routes its own express groups before either call.
3. **Auto mode.** Step 1.1 resolved mode `auto` — typed, or the intrinsic default. `confirm`, `hybrid` and `interactive` (typed, or `interactive` from `auto-mode: default-off`) promise a Manifesto approval stop or per-step stops the lane would skip before it merges on green, so they take the normal path.
4. **The worktree strategy.** Step 1.3 resolved `worktree`; a `current-branch` run has no worktree for the procedure to run in.
5. **An eligible gate verdict.** `node "${CLAUDE_PLUGIN_ROOT}/bin/express-lane.js" gate --issue {n} --run "$PIPELINE_RUN_DIR"` exits 0 and its one verdict carries `eligible: true` — the CLI owns the rules (`_shared/express-lane.md`'s Eligibility); never override its verdict. `eligible: false`, or any non-zero exit (1 a failed fetch or policy read, 2 `gh` absent — the lane requires `gh` — 3 an unanchored run dir), is not eligible: continue at Step 3.

## Express path

1. **Worktree.** Create or adopt this run's worktree per `_shared/worktree-setup.md`'s Adopt-or-create (not isolated → its Pre-creation reconcile, then `EnterWorktree` named per `build/worktree-setup.md`'s Worktree name derivation), then its Post-creation catch-up, unconditionally.
2. **Bind.** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "$PIPELINE_RUN_DIR" "{worktree}"`, and confirm its `worktree recorded` line. Never `--dispatch`: this run is not dispatch-bound, so the #3225 dispatch config gate — which denies a commit in a `dispatched: true` run with no `config.yml` — stays off while the procedure commits before any `config.yml` exists.
   A failure in step 1 or 2 — the worktree cannot be created or adopted (its pre-flight stops included), or `record-worktree` prints no `worktree recorded` line — is outcome `blocked`: Step 2.8 has already claimed, so render the note below naming the failed step; the claim and run dir stay for a human, and the run never continues at Step 3 on an unbound worktree.
3. **Procedure.** Run `_shared/express-lane.md`'s Procedure from step 2 (Step 2.8 already claimed), with `{run-dir}` = `$PIPELINE_RUN_DIR`; when Step 1 detected `pre-authorize-merge`, step 7 appends `,merge-authorization=pre-authorized` to step 5's `configSet` (the Manifesto that writes it on the normal path never runs here), so step 9's merge authorization reads it.

## On the outcome

- **`express-escalated`** — continue at Step 3, unchanged, with no note. Step 3's adoption pack reads the run dir as case 3 (`steps-and-gates.md`'s Adopting an inherited run directory): no `config.yml`, no `dispatched` stamp, and `decisions.md` content beyond Step 2.8's claim (the `## /express-lane` entries). Its backfills — PR-early lifecycle and materialize commit — are the normal path's own first steps; the worktree is already recorded, and the committed edit leaves the clean tree `/claude-tweaks:build`'s Adopt-or-create adopts.
- **Any other outcome** (`merged`, `armed`, `pending-review`, `blocked`) — render the note below and end the run: no Manifesto, no Pipeline Summary. On `blocked`, the worktree, branch, claim and run dir stay for a human (`_shared/express-lane.md`'s Outcomes), and the note's detail line names what stopped it.

```
## Flow: Express lane

#{n} — {outcome}
PR: {PR link | none}
Run dir: {run-dir}
{blocked only: the failed command or claim card}
```
