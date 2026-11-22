# Skill-Load Gate

Canonical contract for a lifecycle step that would load `journeys`, `visual-review` or `design-wrapper {mode}`. Call the gate first; a `skip` means the skill has nothing to do, so the step never invokes it and its text never enters context. Code: `bin/skill-gate.js`, rules in `bin/lib/skill-gate/`. Callers own outcomes; this file owns the call and the verdict handling.

## Invocation

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/skill-gate.js" --skill <skill> [--mode <mode>] [--surface <value>] (--files "<a,b>" | --integration-branch <ref>) [--run "$PIPELINE_RUN_DIR" --section "/<caller-skill>" --step "<step name>"]
```

- `--mode` — required for `design-wrapper` (`pre-build`, `test`, `review`, `polish`, `survey`), invalid for the other skills.
- `--surface` — found per `_shared/design-wrapper-handling.md`'s `--surface` bullet; omit when none resolves.
- `--files` — the caller's already-resolved changed-file list, comma-joined (a path containing a comma is split at it and each piece is judged as its own path, so the verdict for that path is unreliable). `--integration-branch` — the ref `_shared/integration-branch.md` resolves; the gate resolves the branch's changed files itself. Pass one of the two; `pre-build` takes neither (no diff exists yet).
- `--run`, `--section`, `--step` — all three together when the step has a run directory; a `skip` then appends one `SKIP` line to its `decisions.md`.

Exit 0 for either decision; 2 for a malformed invocation (usage on stderr); 3 when `--run` is missing or not anchored under the main checkout's .claude-tweaks/pipelines. Output is one JSON line: `{decision, reason, journeys?, logged?}`.

## Result handling

- `skip` — do not invoke the skill. Repeat the gate's `reason` verbatim in the caller's own output. `logged: false` (no `--run`, or the `decisions.md` write failed): the caller also names the step, the skill and the reason in its own output (standalone: its handoff). `journeys` (a `visual-review` skip) lists the journeys whose `files:` overlap the diff; report them.
- `proceed` — invoke the skill as the step documents. A reason starting `cannot tell: ` is still a proceed: the gate could not decide, wrote one stderr line and logged nothing.
- Exit 2 or 3, or no JSON on stdout — proceed (the gate failed open by not running). With a run directory, log one `SKIP` as `--step "{step} (gate)"` with text `condition: skill-gate exit {n} → fallback: {skill} loaded`, so the line reads as a gate failure and not a skipped skill. Exit 3 means the run directory is unanchored: report it only in the caller's own output, with no run-dir write.

A `skip` from `design-wrapper` uses the same wire reasons as the wrapper's own `{skipped: reason}`, so callers' result tables need no separate branch.

## The no-surface set

<!-- no-surface-set:start -->
- `test/**`
- `tests/**`
- `**/__tests__/**`
- `**/*.test.{js,jsx,ts,tsx,cjs,mjs,cts,mts}`
- `**/*.spec.{js,jsx,ts,tsx,cjs,mjs,cts,mts}`
- `.claude-tweaks/pipelines/**`
- `docs/superpowers/plans/**`
- `docs/plans/*-ledger.md`
<!-- no-surface-set:end -->

Test code and pipeline artifacts, which no persona of a journey uses. Matching is by whole segment and case-sensitive, and the gate does not normalise a path. Gotchas: a project keeping product code under top-level `test/` or `tests/` has that diff's journeys load skipped (logged); a journey listing such a file turns it back into a load.

## Rules

`skip` is reachable only as below; any input these rules do not name is a `proceed` whose reason names what could not be told.

- **`design-wrapper` `test`, `review`, `polish`, `survey`** — the verdict and reason of `evaluate()` (`bin/lib/design-detect`) for the same surface and files. `evaluate()` reads an unrecognised surface as no surface; the gate's own rules below proceed on one (`cannot tell:`).
- **`design-wrapper` `pre-build`** — the design-integration flag is checked first (`disabled`, or not configured, is `skip`, even beside an unrecognised surface); then `skip` for an absent, `backend` or `infra` surface. An unrecognised surface proceeds. No file sniff.
- **`visual-review`** — an empty or unresolved file list proceeds (`cannot tell:`), checked before the surface. `skip` only when the surface is absent, `terminal`, `backend` or `infra` and no changed file matches `fileMatchesFrontendPredicate`; the skip also prints `journeys`. `visual-review/SKILL.md` Step 0.5 is the prose twin of this rule; two differences: a UI file proceeds here whatever the declared surface, and an unrecognised declared surface is "not a signal" there while the gate proceeds with `cannot tell:`.
- **`journeys`** — `skip` only when every changed file is in the no-surface set, none is under `docs/journeys/`, and none is listed in any journey's `files:` (a literal, or an entry whose only wildcard is `*` in its last segment). A `**` or other wildcard entry proceeds.

## Deliberately not gated

- `visual-review`'s own call to `design-wrapper survey` after a browser review.
- `wrap-up/verification-brief.md` Step 2.5's visual-review safety net.
- `/claude-tweaks:specify`, `/claude-tweaks:tidy` and `/claude-tweaks:init` invoking the wrapper by a human's choice.

## Callers

| Step | `--skill` / `--mode` | Changed files |
|---|---|---|
| build Common Step 1.7 | `design-wrapper` / `pre-build` | none; no diff exists yet |
| build Common Step 6 | `journeys` | `--integration-branch` |
| test Step 1.5 | `design-wrapper` / `test` | `--files`, the step's `<changed-files>` |
| review Step 6 | `visual-review` | `--files`, the diff scope Step 2 resolved |
| review Step 6.5 | `design-wrapper` / `review` | `--files`, the same scope |
| flow polish | `design-wrapper` / `polish` | `--integration-branch` |
| flow survey | `design-wrapper` / `survey` | `--files`, the survey's `<changed-files>` |
