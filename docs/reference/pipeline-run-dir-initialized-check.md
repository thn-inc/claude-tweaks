# Pipeline Run Directory — Initialized-Run-Dir Requirement (#1566)

Split out of `pipeline-run-dir.md`'s Anchoring section (#2722) — `resolveRunArg`'s own
initialization-check detail, relevant to a `bin/*.js` author extending or auditing that resolver,
not to a skill-following session doing an ordinary worktree-creation catch-up. Cited from that
section; read this file only when working on `bin/hooks.js`'s `resolveRunArg` or auditing which
of its 8 shared callers opt out of this check.

Anchoring under the main checkout is necessary but not sufficient — `resolveRunArg`'s plain
anchored-directory branch also requires the resolved `--run` value to already be an
**initialized** run dir (carrying at least one of `decisions.md`/`run-state.json`/`config.yml`,
the same bar the `#280` fallback (`pipeline-run-dir.md`'s "Worktree-local `--run` fallback")
already applies to its own narrower case). A real, anchored, but wholly empty directory (a stray
`--run .` from a bare repo root, a caller bug interpolating `$RUN_ROOT` instead of the run dir) is
rejected rather than silently accepted and written to.

Two of the 8 shared callers opt out of this requirement via `resolveOpts.allowUninitialized`:
**`record-worktree`**, the sole legitimate first-writer in the dispatch mint-then-claim handoff
(`dispatch/SKILL.md` Step 4 mkdir-only mints a run dir, `flow/steps-and-gates.md` case 2 adopts it
with no `config.yml` yet, `worktree-setup.md` Step 4.5's `record-worktree` call performs the actual
first write into it); and **`archive-run`**, whose own downstream logic reports a stale,
never-claimed mint with a specific orphaned-mint-sweep pointer rather than a generic rejection.
That opt-in is narrower than it sounds: an uninitialized target must also sit under
`.claude-tweaks/pipelines/` at a run-id-shaped path (the same bar the `#280` fallback already
enforces) — without this, `allowUninitialized` would itself reopen `--run .`/`--run $RUN_ROOT`
against the main checkout root for exactly the two callers licensed to skip the initialization
check. The other 6 callers (`record-pr`, `spec-status`, `close-run`, `teardown-run`,
`check-resume-freshness`, `check-staged-inventory`) always target an already-initialized run dir in
real use, so they keep the default.
