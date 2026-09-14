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
- **Set**: read the current body — `gh pr view {number} --json body` when `gh` is present,
  `mcp__github__pull_request_read` (`get` method) when it is absent
  (`_shared/github-write-transport.md`'s Detection rule). Locate the checklist span using
  whichever delimiter pair this read actually returned: the `<!-- phases-start -->`/
  `<!-- phases-end -->` pair on a `gh`-present read (the real body, unsanitized); the
  `[claude-tweaks-phases-start]`/`[claude-tweaks-phases-end]` pair on a `gh`-absent MCP read
  (the HTML-comment pair is invisibly stripped from what this read returns, per
  `_shared/pr-early-run-lifecycle.md`'s Root cause section, even though it still exists in the
  stored body). Flip that phase's checklist row from
  `- [ ] {phase}` to `- [x] {phase}` inside whichever span was found, leaving everything else —
  including the *other* delimiter pair, which this read may not even show — untouched, then
  write back through the same transport that did the read, to
  `/tmp/pr-checklist-{run-id}-{n}.md` — scoped by `{run-id}`, same reason as `_shared/pr-early-run-lifecycle.md`'s
  Step 3 path. Re-read that file's first line back before `gh pr edit` and confirm it still names
  this run's `{run-id}`; hard-stop this update on a mismatch rather than push a wrong body:

  ```bash
  gh pr edit {number} --repo {host}/{owner}/{repo} --body-file /tmp/pr-checklist-{run-id}-{n}.md
  ```

<!-- when: transport=mcp -->
  `gh`-absent: `mcp__github__update_pull_request` with the same composed body — this write is
  unsanitized (`_shared/pr-early-run-lifecycle.md`'s Root cause section), so it carries both
  delimiter pairs through untouched regardless of which one was used to locate the span.
<!-- /when -->

  Compose-then-write-once — read, patch the checklist section in memory, write the whole body
  back in one call. Never a partial/streaming edit.

**Best-effort, like the phase-exit push it follows.** A failed `gh pr edit` logs a warning to
`decisions.md` and the phase continues — the next phase's own checklist update naturally
re-flips every row still unchecked from prior phases, since it reads the live body fresh each
time rather than tracking a local diff.

**Multi-spec runs share one PR.** A dispatch bundle or a `/flow` multi-spec run has multiple
records built on the same branch behind the same draft PR, so this procedure's checklist rows
are **cumulative across every spec in the run, never reset per spec** — see
`flow/multispec-pr-checklist.md` for the full rationale and the per-spec status source
(`manifest.yml`'s `specs[].status`) a maintainer should read instead when they need spec-level,
not run-level, granularity.

## Pre-merge title/description refresh

Unconditional `AUTO` step, never a stop (`_shared/auto-mode-contract.md`'s "What auto silences" —
refreshing PR metadata is not a user decision). Runs once, immediately before
`_shared/pr-first-merge.md` Step 2 undrafts the PR — by then the PR may be stale: its title/body
were composed at run start (`_shared/pr-early-run-lifecycle.md`'s Step 3) and the phase checklist
reflects whichever phases had exited as of each best-effort `gh pr edit` (Phase-checklist update
above), not necessarily every phase this run actually completed.

1. **Merge-size probe (#641).** First `git fetch origin {integration-branch}` — unlike `gh pr
   merge --auto` below (server-side, no local checkout needed), this probe's `git merge-tree`
   resolves a local ref, and a worktree can sit hours behind `origin/{integration-branch}`
   without this fetch; skipping it would let the probe silently predict against a stale base,
   compounding the race this step already discloses below. Then run `node
   "${CLAUDE_PLUGIN_ROOT}/bin/merge-size-probe.js" --integration-branch origin/{integration-branch}` against this
   run's branch. It predicts, via `git merge-tree --write-tree`, the post-merge size
   of every branch-touched `skills/_shared/*.md`/`SKILL.md` file — a branch that is green alone
   (`tests/bin-lib/skill-audit/context-cost.test.js` only sees the working tree) can still tip a
   shared file over the 45 KB ceiling once merged with a concurrent sibling's own additions, a
   failure that today only surfaces inside the merge sequence itself. A non-empty `overflow` never
   blocks this merge — this section invents no new pipeline stop
   (`_shared/auto-mode-contract.md`'s strict rule) — it discloses at **warn** tier in the run
   summary (a visible line, not a silent log entry), one per file: `merge-size-probe: {path}
   predicted at {bytes} B, {over} B over the 45 KB ceiling once merged with {integration-branch}`,
   and logs `AUTO {time} — PR-early run lifecycle: merge-size probe predicted {n} file(s) over
   ceiling post-merge; disclosed in run summary. Reversibility: n/a (prediction only).` This is a
   prediction against freshly-fetched `origin/{integration-branch}` as of probe time, not a
   guarantee — a sibling that merges after the probe but before this branch does can still produce
   a fresh overflow the probe never saw. A probe failure (unresolvable ref, a real merge conflict)
   degrades like any other best-effort step here: log a warning and continue — the merge sequence
   surfaces a real conflict on its own.
2. Re-run the Phase-checklist update procedure above once more, unconditionally — idempotent
   (a phase whose own update already landed re-flips the same rows to the same values); this is
   the final catch-all for any phase whose own best-effort update silently failed.
<!-- when: integration-model=pr-first -->
3. **Rewrite the `Fixes` block from `manifest.yml` outcomes (#2015).** Pass parent
   `manifest.yml`'s `multispec.specs` (`bin/lib/flow/manifest.js`'s `readManifest`) to
   `composeFixesBlock`, replacing the fixes span with its output: one `Fixes #{m}` per
   `complete` spec, one `Refs #{m} — not run/failed: {reason}` otherwise. Log: `AUTO {time} —
   PR-early run lifecycle: rewrote Fixes block for PR #{number} — {c} complete, {r}
   not-run/failed. Reversibility: high (gh pr edit).`
<!-- /when -->
4. Read the record's current title (`gh issue view {n} --json title -q .title` for the
   lowest-numbered record). If it no longer matches the PR's own title (the record was retitled
   after PR creation), refresh it: `gh pr edit {pr-number} --repo {host}/{owner}/{repo} --title "{current record title} (#{n})"`.
5. Log: `AUTO {time} — PR-early run lifecycle: refreshed PR #{number} title/checklist before merge. Reversibility: high (gh pr edit).`

Best-effort, like the phase-checklist update it extends — a failed `gh pr edit` at any step above
logs a warning and the merge proceeds; a stale title/checklist/`Fixes` block is cosmetic, never a
merge blocker.

## Merge-time gh-absent degrade

Cited by `_shared/pr-first-merge.md` Step 2.5. `gh` absent at merge time: the `merge-verification`
lever is unenforceable without `gh` — proceed as `off` and disclose it at **warn** tier in the run
summary (a visible line, not a silent log entry): `merge-verification: {resolved} unenforceable —
gh absent; proceeded as off`. Same no-MCP-fallback reason as `_shared/pr-early-run-lifecycle.md`'s
run-start `gh absent` row (its Skip / degrade behavior table).
