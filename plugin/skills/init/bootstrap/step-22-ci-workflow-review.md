# Step 22 — CI Workflow Review (detailed procedure)

*Optional Enhancement step — see `../SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

The merge gate assumes PR CI reports a check on every head it waits for, a draft that goes ready included (`_shared/ci-skips-drafts.md`); this step reports existing PR-triggered workflows that break that assumption (#5162).

**Re-run gate.** This step skips itself only when this invocation will reach Update Mode's Phase 1u.5, where `../update-mode.md`'s `CI Workflow Review` row reports the same review. That holds when both are true: Phase 1 routes to Update Mode (`$ARGUMENTS` carries `--update` or `update`, or Phase 1's existence check in `../SKILL.md` finds existing config), and `$ARGUMENTS` carries a Phase scope and no `bootstrap` (Phase scopes choose among Phases 2-8.5 and leave Phase 1 in place). Then print `ci-workflow-review: reported by Update Mode's CI Workflow Review (update-mode.md)` and stop. When Phase 1 routes to Update Mode and `$ARGUMENTS` carries no Phase scope and no Enhancement filter token, the Scope Selection Gate decides, so hold the review and print nothing yet: the gate's Option 4 ("Done"), or an Interactive "Done" chosen before Phase 1 runs, runs it before that exit (`../scope-selection-gate.md`), and Auto, Essentials or Interactive continuing into Phase 1 leave it to Phase 1u.5. In every other case it runs now: Initial Mode, the `bootstrap` scope, or Enhancement filter tokens with no Phase scope.

Every branch is computable here from `$ARGUMENTS` and Phase 1's existence check except the gate's answer, which is why that one case holds instead of guessing. `ci-review` given alone is a filter-token-only invocation, so it runs now.

**Run** one plain command: `node "${CLAUDE_PLUGIN_ROOT}/bin/ci-workflow-review.js" --root .` It shells out to nothing and reads only `.github/workflows/*.yml` and `*.yaml` (any case) and `.claude-tweaks/verify-scope.json`, each resolved inside the checkout.

**Read the result.**

- **Exit 0** — show the printed table and its summary line verbatim. `findings: 0` alone is clean. A summary ending `not clean: {K} workflow(s) unparsed` is never reported as clean: an unparsed workflow got none of the checks. A `skipped … — Step 16 classifies it` line names the plugin's own generated workflow (below).
- **Exit 1** — the review could not run: show `ci-workflow-review: could not review — {stderr}`. The causes are an invalid `verify-scope.json`, a `.github/workflows` that is not a directory, or either of them or its `.claude-tweaks`/`.github` parent being unreadable (a parent that is a regular file included), a dangling symlink, or resolved outside the checkout. Only an absent workflows directory or declaration is silent; one unreadable workflow file is an `unparsed` row under exit 0.
- **Exit 2** — a usage bug in the command line: report it, never as clean.

**The checks**, in report order. Each remedy is a section of `_shared/ci-skips-drafts.md`; read it there, never restate it.

| Check | Remedy |
|---|---|
| `draft-skip-no-ready-for-review` | `_shared/ci-skips-drafts.md` § Workflow shape |
| `draft-skip-with-ci-source` | `_shared/ci-skips-drafts.md` § Coexistence with the `ci` verification source |
| `paths-filter-no-always-reporting-job` | `_shared/ci-skips-drafts.md` § Path filters |
| `no-cancel-in-progress-concurrency` | `_shared/ci-skips-drafts.md` § Concurrency |
| `push-all-step-gated` | see #5152 |

**What this step never does.** It never writes, edits or regenerates a workflow or any other file, in any mode, `auto` included. It never reviews the plugin's generated `track-issue-fixes.yml` while it is the current or an earlier generated version (Step 16 classifies it); a hand-modified copy is reviewed like any project workflow. It never reads CI systems other than GitHub Actions, or run history.
