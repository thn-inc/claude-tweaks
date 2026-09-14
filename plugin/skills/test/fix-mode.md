Fix Mode (Auto + Interactive) — invocation and reporting for `/claude-tweaks:test` Step 3. Read after confirming tests failed and the failures look straightforward (type errors, lint violations, simple test failures).

# Step 3: Fix Mode

## Auto mode

When a pipeline run directory exists, apply the `/claude-tweaks:test` row from the silences table in `_shared/auto-mode-contract.md`. Resolve `auto-fix-threshold` — `AUTO_FIX_THRESHOLD=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" auto-fix-threshold)` (run dir per `_shared/run-dir-resolution.md`; the resolver serves the run's Manifesto answer, then `policy.yml`, then the schema default) and route per the `/claude-tweaks:test` row in `_shared/auto-mode-contract.md`. QA failures never auto-fix — they always stage.

**Auto-fix flow:** make the changes, re-run the failed checks. On re-verification pass, log `AUTO {time} — Step 3: auto-fixed {N} {type} failures. Reversibility: high; commit: {hash}.` and proceed. On re-verification fail or new issues, downgrade to STAGED and surface at Review Console.

**Stage flow:** write the proposed fix to `staged/test-fix-{n}.patch` per `_shared/staged-patch.md` — a `Target:` / `Invariant:` / `Finding:` / `Staged-at:` preamble followed by the diff, validated with `git apply --check` from the worktree before logging (a failing check is handled per that file's Staging-time gate and surfaced here) — and log `STAGED {time} — Step 3: {N} {type} failures staged for review. Stage path: staged/test-fix-{n}.patch.`. The test gate fails until the user resolves at the Review Console, which applies the diff or, when later phases moved the target, re-derives the edit from `Invariant:`.

## Interactive mode

> **Prompt ordering:** Per CLAUDE.md's "never present more than one batch decision table per message" rule — if both lint/type and QA failures are present, present the lint/type prompt first, resolve, then present the QA prompt. Never combine them into a single message.

Call `AskUserQuestion` with:

- `question`: `"{N} failure(s) found. How do you want to handle them?"`, `header`: `"Fix failures"`, `multiSelect`: `false`
- Option 1 — `label`: `"Fix automatically"`, `description`: `"I'll address these failures now"`. Suffixed `(Recommended)` when failures are mechanical (lint/type/simple test failures) — not unconditionally.
- Option 2 — `label`: `"Show details only"`, `description`: `"I'll investigate but not change code"`
- Option 3 — `label`: `"Skip"`, `description`: `"I'll fix these manually"`

If the user chooses to fix:
- **Mechanical failures (lint/type):** make the changes directly, re-run the failed checks, report results.
- **Behavioral test failures:** follow the reproduce-first discipline in `_shared/reproduce-first-discipline.md` (reproduce via `/superpowers:systematic-debugging`, fix the confirmed cause, escalate rather than guess if it can't be reproduced; once green, walk the causal-depth chain per the discipline's step 3), then re-run the failed checks to verify the fix and that nothing else regressed.
- Report the results.

**Auto-fix for lint/type-only failures (interactive default):** When failures are exclusively lint errors or type errors (no test failures), auto-fix and re-verify without asking. State: "Auto-fixing {N} lint/type errors" and re-run the failed checks. If re-verification passes, proceed. If re-verification fails or new issues appear, stop and present the 3-option choice above. For test failures or mixed failure types (lint + test), always present the choice — and resolve test failures via reproduce-first debugging, not blind patching.

**QA failures** are not auto-fixable — they indicate broken user-facing behavior that requires investigation. For QA failures, call `AskUserQuestion` with:

- `question`: `"{N} QA story failure(s) found. QA failures require investigation — they cannot be auto-fixed. What do you want to do?"`, `header`: `"QA failures"`, `multiSelect`: `false`
- Option 1 — `label`: `"Show failure details (Recommended)"`, `description`: `"I'll investigate the root cause via the reproduce-first discipline (/superpowers:systematic-debugging)"`
- Option 2 — `label`: `"Re-run failed stories"`, `description`: `"/claude-tweaks:test qa retry={RUN_DIR}"`
- Option 3 — `label`: `"Skip"`, `description`: `"I'll investigate manually"`

When investigating a QA failure (option 1), follow the reproduce-first discipline in `_shared/reproduce-first-discipline.md` via `/superpowers:systematic-debugging` — the QA story failure is already a reproduction; confirm it, find the confirmed cause, then fix it, without patching the symptom (e.g., loosening a selector).
