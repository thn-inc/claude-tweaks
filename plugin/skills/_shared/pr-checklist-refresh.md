# PR Checklist & Pre-Merge Refresh — phase-checklist updates, pre-merge title/description refresh

Canonical procedure for keeping a `pr-first` (`_shared/integration-model.md`) run's draft PR
current after `_shared/pr-early-run-lifecycle.md` opens it at run start (that file's "Run start:
push, then open (or reuse) the draft PR" Steps 1-4): flipping the phase checklist at every phase
exit, and refreshing the PR's title/checklist/`Fixes` block once more immediately before
`_shared/pr-first-merge.md` Step 2 undrafts it. Split out of `_shared/pr-early-run-lifecycle.md`
by #2002 so the two merge-time compose call sites (`wrap-up/auto-merge-short-circuit.md`,
`wrap-up/review-console.md`) no longer need to compose that file's run-start-only Steps 1-4,
Root cause, and Resume sections to reach the content they actually need at merge time.

## Callers

| Caller | Invokes from |
|---|---|
| Each phase's skill file (build, test, review, polish, wrap-up) | At its own phase exit — "Phase-checklist update" below |
| `_shared/pr-first-merge.md` Step 2 | "Pre-merge title/description refresh" below, before Step 2 undrafts the PR |
| `_shared/pr-first-merge.md` Step 2.5 | "Merge-time gh-absent degrade" below |

## Phase-checklist update (every phase exit)

At each phase's own exit (build, test, review, polish, wrap-up — after that phase's own
phase-exit push, `_shared/git-discipline.md`), check `run-state.json`'s `pr` field:

- **Not set, `local-merge` run**: skip entirely — no PR to update.
- **Not set, `pr-first` run (a degraded run)**: before skipping, check whether recovery is safe —
  `git rev-parse --abbrev-ref --symbolic-full-name @{u}` against the worktree branch. **Fails**
  (no upstream configured — the branch never actually reached `origin`, regardless of which phase
  degraded it): retry `_shared/pr-early-run-lifecycle.md`'s "Run start: push, then open (or reuse)
  the draft PR" Steps 2-4 now, from this phase's own worktree — the `#989` one-shot push exemption
  is guaranteed to apply cleanly on this attempt, since it keys on exactly this precondition.
  **Succeeds** (upstream is set but no PR — a rarer case, e.g. an interrupted `gh pr create`): skip
  this phase's checklist update as before; do not attempt recovery blind against a branch state
  this section cannot fully diagnose.
- **Set**, `gh` present: one call does the whole update —

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/pr-checklist.js" --run "{run-dir}" --phase {phase} --fixes {n}[,{m}...]
  ```

  `{run-dir}`: a bundle's parent run dir, else this run's own;
  `--remove` drops a skipped phase's row at its would-be exit. It reads `run-state.json`'s `pr`,
  runs `repairPrBody` (logging any restore), flips or removes the one row, runs the Spec-summary
  check below, verifies the body's first line names this run, and writes via `gh pr edit`. Exit codes:
  - **0**, by `action`: `written`/`no-op` done, but a flip's `row-absent`/`no-phases-span` checked
    nothing → warn; `logFailed` → hand-log the restore line (`bin/log-decision.js`); `no-pr` → the
    degraded-run recovery above; `gh-absent` → MCP below.
  - **4** (run marker mismatch, nothing written): log `AUTO {time} — PR checklist refresh: refused
    on PR #{number} — run marker mismatch ({stderr}). Reversibility: n/a.`; never edit by hand.
  - **5** (`gh` failed): the "Best-effort" warning below.
  - **2**, **3**: a bad call (flags, `--summary-file`, run dir) — fix, re-run.

  **Refresh the Spec summary after a premise reversal (#3050).** `bin/pr-checklist.js` reads this
  run's `premise reversed:` entries ("Premise-reversal decisions" below) and reports, under `summary`,
  which the `### Spec summary` heading's note lacks as `uncovered`/`reason`. Empty `uncovered`
  (`no-reversals`, or `already-noted` — every reversal already noted) → Spec summary stays
  byte-unchanged. Non-empty → write a one-paragraph summary to a session temp file
  (`bin/session-tmp-resolve.js`, e.g. `PR_SUMMARY_REVISION=pr-summary-revision-{run-id}.md`) with
  the Write tool — this run's diff, nothing it does not show, covering every spec in a bundle —
  and re-run it with `--summary-file "{file}"`: the row is already checked, so only the
  note changes — one `Revised during build: {original claim} → {implemented behavior}` above the
  paragraph. Best-effort: a re-run with `summary.changed` `false` and non-empty `uncovered` logs
  a warning to `decisions.md` naming the `reason`; the row is written — never a phase-exit or
  merge blocker.

  **`gh` absent (MCP).** Read the body with `mcp__github__pull_request_read` (`get` method)
  (`_shared/github-write-transport.md`'s Detection rule), then:

  **Repair before locating anything (#2997).** Run `repairPrBody` (`bin/lib/flow/pr-body.js` —
  the same module `_shared/pr-early-run-lifecycle.md`'s Step 3 composes with) against the body
  this read returned, unconditionally — it is a no-op when every marker is already present, so
  calling it every time costs nothing. When it restores anything (the #2996 shape), use its
  returned body for the rest of this update and log one line naming what came back:
  `AUTO {time} — PR checklist refresh: restored {restored.join(', ')} on PR #{number} (body
  carried none/some of the expected markers). Reversibility: high (gh pr edit).` This replaces the former best-effort skip on a
  missing delimiter pair — a missing marker is now restored, never silently left absent.

  Locate the `[claude-tweaks-phases-start]`/`[claude-tweaks-phases-end]` pair (an MCP read strips
  the HTML-comment pair, per `_shared/pr-early-run-lifecycle.md`'s Root cause section) and flip
  that phase's row from `- [ ] {phase}` to `- [x] {phase}` inside it (drop it for a skipped
  phase), touching nothing else. Write the body to a session temp file `{body-file}` (`bin/session-tmp-resolve.js`,
  e.g. `PR_CHECKLIST_BODY=pr-checklist-{run-id}-{n}.md`) with the Write tool, then run `node
  "${CLAUDE_PLUGIN_ROOT}/bin/revise-pr-summary.js" --run-dir "{run-dir}" --body-file
  "{body-file}"`; on non-empty `uncovered`, re-run with `--summary-file "{file}" --out "{body-file}"`; a
  non-zero exit → warn, write checklist-only. Re-read that file's first line back before the write and
  confirm it still names this run's `{run-id}`; hard-stop on a mismatch rather than push a wrong body.

<!-- when: transport=mcp -->
  `gh`-absent: `mcp__github__update_pull_request` with the same composed body — unsanitized
  (`_shared/pr-early-run-lifecycle.md`'s Root cause section), so both delimiter pairs survive
  regardless of which located the span.
<!-- /when -->

  Compose-then-write-once — read, patch the checklist section in memory, write the whole body
  back in one call. Never a partial/streaming edit.

**Best-effort, like the phase-exit push it follows.** A failed `gh pr edit` (the CLI's exit 5) logs a
warning to `decisions.md` and the phase continues — its row stays unchecked until the pre-merge
refresh below re-runs this procedure for that phase.

**Multi-spec runs share one PR.** A dispatch bundle or a `/flow` multi-spec run has multiple
records built on the same branch behind the same draft PR, so this procedure's checklist rows
are **cumulative across every spec in the run, never reset per spec** — see
`flow/multispec-pr-checklist.md` for the full rationale and the per-spec status source
(`manifest.yml`'s `specs[].status`) to read instead for spec-level granularity.

**Premise-reversal decisions (#3050).** The one `decisions.md` entry shape the Spec-summary
refresh above reads. It is written through `bin/log-decision.js` (`--status AUTO`): to the run's
own top-level `decisions.md` for a single-record run, or to that spec's `spec-{id}/decisions.md`
in a bundle (the same placement as `_shared/pr-early-run-lifecycle.md`'s Deferred-closure
decisions):

`premise reversed: {original claim} → {implemented behavior}`

`/claude-tweaks:build` logs it whenever the build changes a mechanism the spec described: an
`ASSUMPTION — verify at build:` probe that came back reversed, or a Spec Step 3 plan departing
from a spec premise. The marker opens the entry's `--text` (a line quoting it mid-sentence is not
an entry), and `{original claim}` must not itself contain ` → `. Its reader is
`parsePremiseReversals` (`bin/lib/flow/pr-body.js`). Do not log a differently-worded line for the
same decision; the refresh would silently miss it.

## Pre-merge title/description refresh

Unconditional `AUTO` step, never a stop (`_shared/auto-mode-contract.md`'s "What auto silences" —
refreshing PR metadata is not a user decision). Runs once, immediately before
`_shared/pr-first-merge.md` Step 2 undrafts the PR — by then the PR may be stale: its title/body
were composed at run start (`_shared/pr-early-run-lifecycle.md`'s Step 3) and the phase checklist
reflects whichever phases had exited as of each best-effort `gh pr edit` (Phase-checklist update
above), not necessarily every phase this run actually completed.

1. Re-run the Phase-checklist update procedure above once more, unconditionally, its Spec-summary refresh included — once per
   phase this run exited (`--remove` for a skipped one), each call re-flipping its own row and a
   no-op when that row already landed; this is the final catch-all for any phase whose own
   best-effort update failed. **Multi-spec
   deferred polish-row removal:** if the `polish` row is present and still unchecked
   (`- [ ] polish`) at this point, check every spec's outcome in the parent `manifest.yml`'s
   `specs[]`; when no spec in the run ever ran polish (every spec's `surface:` was non-frontend —
   `backend` or `infra` — or `no-polish`/`ceremony-profile: fast-lane` applied run-wide), remove
   the row here (`--phase polish --remove`) — the deferred counterpart to `_shared/pr-early-run-lifecycle.md`'s multi-spec
   skip-rule scoping (see `flow/multispec-pr-checklist.md`).
   A single-record run never reaches this branch — its row was already removed or checked at
   polish's own would-be exit.
<!-- when: integration-model=pr-first -->
2. **Rewrite the `Fixes` block from outcomes (#2015, #3136).** Read parent `manifest.yml`
   (`bin/lib/flow/manifest.js`'s `readManifest`) to tell a bundle run from a single-record one —
   it returns `null` when this run dir carries no `manifest.yml` at all.
   - **Bundle run (`readManifest` returns a `multispec.specs` list):** pass both the parent run
     dir and that `specs` list to `readDeferredClosures` — it reads every `spec-{id}/decisions.md`
     for a logged deferred-closure entry (`_shared/pr-early-run-lifecycle.md`'s "Deferred-closure
     decisions" section defines the one shape it recognizes) and returns a Map of spec id ->
     reason. Pass `specs` and that Map to `composeFixesBlock`, replacing the fixes span with its
     output: one `Fixes #{m}` per `complete` spec with no deferred-closure entry, one
     `Refs #{m} — deferred: {reason}` for a spec carrying one (even when `complete` — the
     deferred-closure check overrides the status check), one `Refs #{m} — not run/failed: {reason}`
     for every other non-complete spec.
   - **Single-record run (`readManifest` returns `null`):** pass this run's own run dir and the
     one record id to `readSingleRecordDeferredClosure` — it reads the run's own top-level
     `decisions.md` (never a `spec-{id}/` subdirectory; there is no sibling spec to namespace
     against) for the same deferred-closure entry shape. A reason found: build a one-entry Map
     (`new Map([[String(recordId), reason]])`) and pass `[{ id: recordId, status: 'complete' }]`
     plus that Map to `composeFixesBlock`, replacing the fixes span with its single-line output
     (`Refs #{n} — deferred: {reason}`). No reason found: leave the existing `Fixes #{n}` line
     untouched — this is the one branch that writes nothing, since the line composed at run start
     (`_shared/pr-early-run-lifecycle.md`'s Step 3) is already correct and a no-op `gh pr edit`
     buys nothing.
   Log (bundle or single-record, same shape either way): `AUTO {time} — PR-early run lifecycle:
   rewrote Fixes block for PR #{number} — {c} complete, {d} deferred, {r} not-run/failed.
   Reversibility: high (gh pr edit).` A single-record run with no deferred-closure entry logs
   nothing here — there was nothing to rewrite.

   **Then check the forge's closing links (#4199).** GitHub links every closing-keyword phrase in the
   body, not only the `Fixes` lines, and re-derives the links on every edit (probe PR #4234), so a
   reason or summary reading "closes #{n}" re-links a `Refs` record. Run
   `node "${CLAUDE_PLUGIN_ROOT}/bin/closing-links.js" --run "{run-dir}" --mode pre-merge`:
   it reads `closingIssuesReferences`, rewrites every phrase naming a record outside the `Fixes`
   lines to `closes issue #{n}` (GitHub links no such phrase), writes the body, re-reads, and logs
   `unlinked #{n}` or `#{n} still linked` to `decisions.md`.
   A `still-linked` result is left for `pr-first-merge-post-merge.md`'s Step 4.0. Exit 3-5:
   warn, log one `SKIP` line, and proceed (Step 4.0 is the backstop). `gh-absent`: one `SKIP` line
   (`_shared/auto-decision-log.md`'s Degrade-trace rule).
<!-- /when -->
3. Read the record's current title (`gh issue view {n} --json title -q .title` for the
   lowest-numbered record). If it no longer matches the PR's own title (the record was retitled
   after PR creation), refresh it: `gh pr edit {pr-number} --repo {host}/{owner}/{repo} --title "{current record title} (#{n})"`.
4. Log: `AUTO {time} — PR-early run lifecycle: refreshed PR #{number} title/checklist before merge. Reversibility: high (gh pr edit).`

Best-effort, like the phase-checklist update it extends — a failed `gh pr edit` at any step above
logs a warning and the merge proceeds; a stale title or an unchecked-but-present checklist row is
cosmetic, never a merge blocker. A **missing** run marker, phases pair, or `Fixes` block is not
cosmetic (#2997): step 1 above already repairs it via `repairPrBody`, so step 2's rewrite always
finds a span to replace — mechanical, never a new pipeline stop.

## Merge-time gh-absent degrade

Cited by `_shared/pr-first-merge.md` Step 2.5. `gh` absent at merge time: the `merge-verification`
lever is unenforceable without `gh` — proceed as `off` and disclose it at **warn** tier in the run
summary (a visible line, not a silent log entry): `merge-verification: {resolved} unenforceable —
gh absent; proceeded as off`. Same no-MCP-fallback reason as `_shared/pr-early-run-lifecycle.md`'s
run-start `gh absent` row (its Skip / degrade behavior table).
